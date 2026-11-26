-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:<db-port>/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-383-where-guess-dismissal-smoke.sql
-- Ticket 383 (D37): migration 20261126130000. While Completion places is off, a
-- dismissal is admitted for the guess keys only (home, anywhere, add_place); a
-- saved-place dismissal and every marker stay refused. While on, nothing changes. Rows
-- stay owner-only, and turning labels off still deletes every dismissal.
-- Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('38300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'guess-dismissal@example.invalid', '{}', '{}'),
  ('38300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'guess-dismissal-other@example.invalid', '{}', '{}');

create function pg_temp.create_behavior(owner uuid, title text)
returns uuid
language plpgsql
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  graph jsonb := jsonb_build_array(jsonb_build_object(
    'id', null, 'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
    'time_entries', jsonb_build_array(jsonb_build_object('id', null, 'kind', 'exact', 'preset', null,
      'start_time', '09:00:00', 'end_time', null, 'sort_order', 0))));
  snapshot jsonb := jsonb_build_object('category_id', null, 'location_text', null, 'where_kind', null,
    'schedule_graph', graph #- '{0,id}' #- '{0,time_entries,0,id}', 'browser_reminder_enabled', true,
    'email_reminder_enabled', false, 'reminder_offset_minutes', 0, 'active', true, 'timezone', 'America/New_York');
  created uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  created := (public.create_behavior_with_schedule_graph(
    jsonb_build_object('category_id', null, 'title', title, 'description', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
      'scheduled_time', '09:00:00', 'timezone', 'America/New_York', 'browser_reminder_enabled', true,
      'email_reminder_enabled', false, 'reminder_offset_minutes', 0, 'active', true, 'archived_at', null,
      'archive_notes', '[]'::jsonb, 'default_duration_minutes', null, 'end_date', null,
      'auto_archived_at', null, 'location_text', null, 'where_kind', null, 'created_at', recorded_at),
    jsonb_build_object('previous_title', null, 'next_title', title, 'previous_description', null,
      'next_description', null, 'changed_fields', jsonb_build_array('title'),
      'recorded_at', recorded_at, 'source', 'manual', 'reason', null),
    jsonb_build_object('event_kind', 'baseline', 'previous_configuration', null, 'next_configuration', snapshot,
      'changed_fields', '["category_id","location_text","where_kind","schedule_graph","browser_reminder_enabled","email_reminder_enabled","reminder_offset_minutes","active","timezone"]'::jsonb,
      'recorded_at', recorded_at, 'effective_at', recorded_at,
      'effective_local_date', (recorded_at at time zone 'America/New_York')::date,
      'timezone', 'America/New_York', 'source', 'manual', 'reason_code', 'behavior_created'),
    graph) ->> 'id')::uuid;
  return created;
end;
$$;

create table pg_temp.ids (name text primary key, id uuid not null);
grant select, insert on pg_temp.ids to authenticated;

set local role authenticated;
insert into pg_temp.ids values
  ('home', pg_temp.create_behavior('38300000-0000-4000-8000-000000000001', 'Take vitamins')),
  ('anywhere', pg_temp.create_behavior('38300000-0000-4000-8000-000000000001', 'Stretch')),
  ('add_place', pg_temp.create_behavior('38300000-0000-4000-8000-000000000001', 'Swim')),
  ('saved', pg_temp.create_behavior('38300000-0000-4000-8000-000000000001', 'Climb')),
  ('other', pg_temp.create_behavior('38300000-0000-4000-8000-000000000002', 'Other'));
reset role;

create function pg_temp.dismiss(name text, suggestion text, owner uuid default '38300000-0000-4000-8000-000000000001')
returns void
language sql
as $$
  insert into public.where_suggestion_dismissals (id, user_id, suggestion, rule_version, dismissed_at)
  select id, owner, suggestion, 'where-suggestion-rules@1', statement_timestamp()
  from pg_temp.ids where ids.name = dismiss.name
  on conflict (id) do update set suggestion = excluded.suggestion, dismissed_at = excluded.dismissed_at;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"38300000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Labels off (no settings row): guess keys are admitted, on insert and on update.
do $$
begin
  if exists (select 1 from public.place_label_settings) then raise exception 'Labels were on by default.'; end if;
  perform pg_temp.dismiss('home', 'home');
  perform pg_temp.dismiss('anywhere', 'anywhere');
  perform pg_temp.dismiss('add_place', 'add_place');
  if (select count(*) from public.where_suggestion_dismissals) <> 3 then
    raise exception 'A guess dismissal was refused while labels were off.';
  end if;
  perform pg_temp.dismiss('home', 'anywhere');
  if (select suggestion from public.where_suggestion_dismissals d join pg_temp.ids i on i.id = d.id where i.name = 'home') <> 'anywhere' then
    raise exception 'Updating a guess dismissal was refused while labels were off.';
  end if;
  perform pg_temp.dismiss('home', 'home');

  -- Still refused while off: a saved-place dismissal, on insert and on update.
  begin
    perform pg_temp.dismiss('saved', 'saved_place:' || repeat('a', 43));
    raise exception 'A saved-place dismissal was stored while labels were off.';
  exception when raise_exception then
    if sqlerrm <> 'Completion place labels are off.' then raise; end if;
  end;
  begin
    perform pg_temp.dismiss('home', 'saved_place:' || repeat('a', 43));
    raise exception 'A dismissal was updated to a saved place while labels were off.';
  exception when raise_exception then
    if sqlerrm <> 'Completion place labels are off.' then raise; end if;
  end;
  -- Unknown keys are still refused: the labels-off trigger runs before the check constraint.
  begin
    perform pg_temp.dismiss('saved', 'elsewhere');
    raise exception 'An unknown suggestion key was accepted.';
  exception when check_violation then null;
    when raise_exception then
      if sqlerrm <> 'Completion place labels are off.' then raise; end if;
  end;
  -- Markers keep the unchanged check.
  begin
    insert into public.place_markers (user_id, id, place_key, latitude_e6, longitude_e6, accuracy_meters, rule_version, recorded_at)
    values ('38300000-0000-4000-8000-000000000001', 'home', repeat('a', 43), 41878100, -87629800, 20, 'place-label-rules@1', statement_timestamp());
    raise exception 'A marker was stored while labels were off.';
  exception when raise_exception then
    if sqlerrm <> 'Completion place labels are off.' then raise; end if;
  end;
end;
$$;

-- Owner-only: the other account sees none of these rows and cannot write one for the owner.
select set_config('request.jwt.claims', '{"sub":"38300000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.where_suggestion_dismissals) then
    raise exception 'Another account read guess dismissals.';
  end if;
  begin
    perform pg_temp.dismiss('saved', 'home');
    raise exception 'A dismissal was written for another owner.';
  exception when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm = 'A dismissal was written for another owner.' then raise; end if;
  end;
  begin
    perform pg_temp.dismiss('home', 'home', '38300000-0000-4000-8000-000000000002');
    raise exception 'A dismissal named another account''s Behavior.';
  exception when foreign_key_violation or unique_violation or insufficient_privilege then null;
    when raise_exception then
      if sqlerrm = 'A dismissal named another account''s Behavior.' then raise; end if;
  end;
  -- Its own Behavior: a guess dismissal while its labels are off.
  perform pg_temp.dismiss('other', 'home', '38300000-0000-4000-8000-000000000002');
  if (select count(*) from public.where_suggestion_dismissals) <> 1 then
    raise exception 'The other account could not dismiss its own guess.';
  end if;
end;
$$;

-- Labels on: unchanged. Every key is admitted, including a saved place.
select set_config('request.jwt.claims', '{"sub":"38300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  saved public.place_label_settings%rowtype;
begin
  perform public.save_place_label_settings(true, '90_days', false, null, null);
  perform pg_temp.dismiss('saved', 'saved_place:' || repeat('a', 43));
  if (select count(*) from public.where_suggestion_dismissals) <> 4 then
    raise exception 'A dismissal was refused while labels were on.';
  end if;

  -- Turning labels off still deletes every dismissal, guess keys included.
  select * into saved from public.place_label_settings;
  perform public.save_place_label_settings(false, '90_days', false, saved.updated_at, null);
  if exists (select 1 from public.where_suggestion_dismissals) then
    raise exception 'Turning labels off kept dismissals.';
  end if;
  -- And a guess can be dismissed again while off.
  perform pg_temp.dismiss('home', 'home');
  if (select count(*) from public.where_suggestion_dismissals) <> 1 then
    raise exception 'A guess dismissal was refused after turning labels off.';
  end if;
end;
$$;
reset role;

-- The other account's row is untouched by the owner's turn-off.
do $$
begin
  if (select count(*) from public.where_suggestion_dismissals where user_id = '38300000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'The owner''s turn-off deleted another account''s dismissal.';
  end if;
end;
$$;

rollback;
