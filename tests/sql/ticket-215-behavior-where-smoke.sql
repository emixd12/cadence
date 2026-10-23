-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:<db-port>/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-215-behavior-where-smoke.sql
-- Ticket 215: Behavior Where through the authenticated graph writers. Covers the
-- current payload and the pre-Where payload the previous web build sends between
-- the hosted migration and the web deployment. Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('21500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'where-smoke@example.invalid', '{}', '{}');

create function pg_temp.where_graph()
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'id', null,
    'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
    'sort_order', 0,
    'time_entries', jsonb_build_array(jsonb_build_object(
      'id', null, 'kind', 'exact', 'preset', null,
      'start_time', '09:00:00', 'end_time', null, 'sort_order', 0
    ))
  ));
$$;

-- A configuration snapshot as a client plans it. Legacy snapshots omit where_kind.
create function pg_temp.where_snapshot(place text, where_value text, legacy boolean, offset_minutes integer default 0)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', null,
    'location_text', place,
    'schedule_graph', pg_temp.where_graph() #- '{0,id}' #- '{0,time_entries,0,id}',
    'browser_reminder_enabled', true,
    'email_reminder_enabled', false,
    'reminder_offset_minutes', offset_minutes,
    'active', true,
    'timezone', 'America/New_York'
  ) || case when legacy then '{}'::jsonb else jsonb_build_object('where_kind', where_value) end;
$$;

create function pg_temp.where_payload(title text, place text, where_value text, legacy boolean, offset_minutes integer default 0)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', null, 'title', title, 'description', null,
    'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
    'scheduled_time', '09:00:00', 'timezone', 'America/New_York',
    'browser_reminder_enabled', true, 'email_reminder_enabled', false,
    'reminder_offset_minutes', offset_minutes, 'active', true, 'archived_at', null,
    'archive_notes', '[]'::jsonb, 'default_duration_minutes', null, 'end_date', null,
    'auto_archived_at', null, 'location_text', place
  ) || case when legacy then '{}'::jsonb else jsonb_build_object('where_kind', where_value) end;
$$;

create function pg_temp.create_where_behavior(title text, place text, where_value text, legacy boolean)
returns uuid
language plpgsql
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  fields jsonb := case when legacy
    then '["category_id","location_text","schedule_graph","browser_reminder_enabled","email_reminder_enabled","reminder_offset_minutes","active","timezone"]'::jsonb
    else '["category_id","location_text","where_kind","schedule_graph","browser_reminder_enabled","email_reminder_enabled","reminder_offset_minutes","active","timezone"]'::jsonb end;
begin
  return (public.create_behavior_with_schedule_graph(
    pg_temp.where_payload(title, place, where_value, legacy) || jsonb_build_object('created_at', recorded_at),
    jsonb_build_object('previous_title', null, 'next_title', title, 'previous_description', null,
      'next_description', null, 'changed_fields', jsonb_build_array('title'),
      'recorded_at', recorded_at, 'source', 'manual', 'reason', null),
    jsonb_build_object('event_kind', 'baseline', 'previous_configuration', null,
      'next_configuration', pg_temp.where_snapshot(place, where_value, legacy),
      'changed_fields', fields, 'recorded_at', recorded_at, 'effective_at', recorded_at,
      'effective_local_date', (recorded_at at time zone 'America/New_York')::date,
      'timezone', 'America/New_York', 'source', 'manual', 'reason_code', 'behavior_created'),
    pg_temp.where_graph()
  ) ->> 'id')::uuid;
end;
$$;

create function pg_temp.update_where_behavior(target uuid, title text, previous jsonb, next_place text,
  next_where text, legacy boolean, fields jsonb, offset_minutes integer default 0)
returns void
language plpgsql
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  graph jsonb := cadence_private.current_behavior_schedule_graph('21500000-0000-4000-8000-000000000001', target);
begin
  perform public.update_behavior_with_schedule_graph(
    target,
    pg_temp.where_payload(title, next_place, next_where, legacy, offset_minutes),
    jsonb_build_object('stored_title', title, 'stored_description', null,
      'normalized_title', title, 'normalized_description', null),
    graph,
    (select updated_at from public.behaviors where id = target),
    null,
    jsonb_build_object('event_kind', 'revision', 'previous_configuration', previous,
      'next_configuration', pg_temp.where_snapshot(next_place, next_where, legacy, offset_minutes),
      'changed_fields', fields, 'recorded_at', recorded_at, 'effective_at', recorded_at,
      'effective_local_date', (recorded_at at time zone 'America/New_York')::date,
      'timezone', 'America/New_York', 'source', 'manual', 'reason_code', 'behavior_edited'),
    graph
  );
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"21500000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  located uuid;
  plain uuid;
  home uuid;
  event record;
begin
  -- Previous web build: location text means A place; no text means Not set.
  located := pg_temp.create_where_behavior('Legacy located', '1 Example Street', null, true);
  plain := pg_temp.create_where_behavior('Legacy plain', null, null, true);
  -- Current web build.
  home := pg_temp.create_where_behavior('Current home', null, 'home', false);

  if (select where_kind from public.behaviors where id = located) is distinct from 'place'
    or (select where_kind from public.behaviors where id = plain) is not null
    or (select where_kind from public.behaviors where id = home) is distinct from 'home' then
    raise exception 'Created Behaviors did not store the expected Where.';
  end if;
  select * into event from public.behavior_configuration_events where behavior_id = located;
  if event.next_configuration ->> 'where_kind' is distinct from 'place'
    or not ('where_kind' = any(event.changed_fields)) then
    raise exception 'A pre-Where baseline did not store the canonical Where snapshot.';
  end if;

  begin
    perform pg_temp.create_where_behavior('Inconsistent', '1 Example Street', 'home', false);
    raise exception 'Home with place text was accepted.';
  exception when check_violation then null;
  end;

  -- Previous web build clears the text of A place: Not set, recorded as both fields.
  perform pg_temp.update_where_behavior(located, 'Legacy located',
    pg_temp.where_snapshot('1 Example Street', null, true), null, null, true, '["location_text"]');
  if (select where_kind from public.behaviors where id = located) is not null then
    raise exception 'Clearing A place from a pre-Where client did not set Not set.';
  end if;
  if (select changed_fields from public.behavior_configuration_events
      where behavior_id = located and event_kind = 'revision') is distinct from array['location_text', 'where_kind'] then
    raise exception 'The pre-Where revision did not record the canonical changed fields.';
  end if;

  -- Previous web build cannot describe Home in a plan; the edit is refused and Home stays.
  begin
    perform pg_temp.update_where_behavior(home, 'Current home',
      pg_temp.where_snapshot(null, null, true), null, null, true, '["reminder_offset_minutes"]', 15);
    raise exception 'A pre-Where plan replaced Home.';
  exception when invalid_parameter_value then null;
  end;
  if (select (where_kind, reminder_offset_minutes) from public.behaviors where id = home)
    is distinct from ('home'::text, 0) then
    raise exception 'A refused pre-Where edit changed the Home Behavior.';
  end if;

  -- Current web build changes Where alone.
  perform pg_temp.update_where_behavior(home, 'Current home',
    pg_temp.where_snapshot(null, 'home', false), null, 'anywhere', false, '["where_kind"]');
  if (select where_kind from public.behaviors where id = home) is distinct from 'anywhere' then
    raise exception 'A current Where change was not stored.';
  end if;

  -- A current plan that disagrees with the payload is refused.
  begin
    perform pg_temp.update_where_behavior(home, 'Current home',
      pg_temp.where_snapshot(null, 'home', false), null, 'home', false, '["where_kind"]');
    raise exception 'A stale current Where plan was accepted.';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

reset role;

do $$
begin
  begin
    update public.behaviors set where_kind = 'office', location_text = null
    where user_id = '21500000-0000-4000-8000-000000000001';
    raise exception 'An unknown Where was accepted.';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
