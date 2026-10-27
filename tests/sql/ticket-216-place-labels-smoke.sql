-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:<db-port>/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-216-place-labels-smoke.sql
-- Ticket 216: completion place labels, device markers and suggestion dismissals.
-- Covers the opt-in, Completed-only labels, status-change deletion, retention,
-- turning labels off, owner isolation, the account snapshot and the daily purge.
-- Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('21600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'labels-smoke@example.invalid', '{}', '{}'),
  ('21600000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'labels-other@example.invalid', '{}', '{}');

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
  snapshot jsonb := jsonb_build_object('category_id', null, 'location_text', null, 'where_kind', 'home',
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
      'auto_archived_at', null, 'location_text', null, 'where_kind', 'home', 'created_at', recorded_at),
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
  ('behavior', pg_temp.create_behavior('21600000-0000-4000-8000-000000000001', 'Stretch')),
  ('other_behavior', pg_temp.create_behavior('21600000-0000-4000-8000-000000000002', 'Other'));
reset role;

insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_start_time)
select '21600000-0000-4000-8000-0000000000a1', '21600000-0000-4000-8000-000000000001', id,
  '2026-10-22T13:00:00Z', '2026-10-22', '09:00:00' from pg_temp.ids where name = 'behavior';
insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_start_time, status, completed_at, status_marked_at)
select '21600000-0000-4000-8000-0000000000a2', '21600000-0000-4000-8000-000000000001', id,
  '2026-05-01T13:00:00Z', '2026-05-01', '09:00:00', 'completed', '2026-05-01T13:00:00Z', '2026-05-01T13:00:00Z'
from pg_temp.ids where name = 'behavior';
insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_start_time, status, completed_at, status_marked_at)
select '21600000-0000-4000-8000-0000000000b1', '21600000-0000-4000-8000-000000000002', id,
  '2026-10-22T13:00:00Z', '2026-10-22', '09:00:00', 'completed', '2026-10-22T13:00:00Z', '2026-10-22T13:00:00Z'
from pg_temp.ids where name = 'other_behavior';


create function pg_temp.label(occurrence uuid, local_date date, label text, rule_version text default 'place-label-rules@1')
returns void
language sql
as $$
  insert into public.completion_place_labels (id, user_id, behavior_id, local_date, label, rule_version, recorded_at)
  select occurrence, '21600000-0000-4000-8000-000000000001', id, local_date, label, rule_version, statement_timestamp()
  from pg_temp.ids where name = 'behavior';
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21600000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  saved public.place_label_settings%rowtype;
  snapshot jsonb;
begin
  -- Off by default: no row, and nothing location-derived can be stored.
  if exists (select 1 from public.place_label_settings) then raise exception 'Labels were on by default.'; end if;
  begin
    insert into public.place_markers (user_id, id, place_key, latitude_e6, longitude_e6, accuracy_meters, rule_version, recorded_at)
    values ('21600000-0000-4000-8000-000000000001', 'home', repeat('a', 43), 41878100, -87629800, 20, 'place-label-rules@1', statement_timestamp());
    raise exception 'A marker was stored while labels were off.';
  exception when raise_exception then
    if sqlerrm <> 'Completion place labels are off.' then raise; end if;
  end;

  select * into saved from public.save_place_label_settings(true, '90_days', false, null, null);
  if not saved.enabled or saved.enabled_at is null or saved.retention <> '90_days' then
    raise exception 'Turning labels on did not record consent.';
  end if;
  begin
    perform public.save_place_label_settings(true, '1_year', false, null, null);
    raise exception 'A stale settings save was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'Place label settings changed%' then raise; end if;
  end;

  -- Unresolved occurrences cannot hold a label.
  begin
    perform pg_temp.label('21600000-0000-4000-8000-0000000000a1', '2026-10-22', 'home');
    raise exception 'An Unresolved occurrence was labeled.';
  exception when raise_exception then
    if sqlerrm <> 'A place label needs a Completed occurrence.' then raise; end if;
  end;
end;
$$;

reset role;
update public.occurrences set status = 'completed', completed_at = '2026-10-22T13:05:00Z', status_marked_at = '2026-10-22T13:05:00Z'
where id = '21600000-0000-4000-8000-0000000000a1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21600000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  saved public.place_label_settings%rowtype;
begin
  perform pg_temp.label('21600000-0000-4000-8000-0000000000a1', '2026-10-22', 'home');
  perform pg_temp.label('21600000-0000-4000-8000-0000000000a2', '2026-05-01', 'saved_place:' || repeat('b', 43));
  insert into public.place_markers (user_id, id, place_key, latitude_e6, longitude_e6, accuracy_meters, rule_version, recorded_at)
  values ('21600000-0000-4000-8000-000000000001', 'home', repeat('a', 43), 41878100, -87629800, 20, 'place-label-rules@1', statement_timestamp());
  insert into public.where_suggestion_dismissals (id, user_id, suggestion, rule_version, dismissed_at)
  select id, '21600000-0000-4000-8000-000000000001', 'anywhere', 'where-suggestion-rules@1', statement_timestamp()
  from pg_temp.ids where name = 'behavior';

  begin
    perform pg_temp.label('21600000-0000-4000-8000-0000000000a1', '2026-10-22', 'home', 'place-label-rules@2');
    raise exception 'An unknown rule version was accepted.';
  exception when check_violation then null;
  end;
  begin
    insert into public.place_markers (user_id, id, place_key, latitude_e6, longitude_e6, accuracy_meters, rule_version, recorded_at)
    values ('21600000-0000-4000-8000-000000000001', 'saved_place:' || repeat('c', 43), repeat('d', 43), 0, 0, 20, 'place-label-rules@1', statement_timestamp());
    raise exception 'A marker with a mismatched place key was accepted.';
  exception when check_violation then null;
  end;
  begin
    insert into public.place_markers (user_id, id, place_key, latitude_e6, longitude_e6, accuracy_meters, rule_version, recorded_at)
    values ('21600000-0000-4000-8000-000000000001', 'saved_place:' || repeat('c', 43), repeat('c', 43), 0, 0, 101, 'place-label-rules@1', statement_timestamp());
    raise exception 'An inaccurate marker was accepted.';
  exception when check_violation then null;
  end;
  begin
    insert into public.where_suggestion_dismissals (id, user_id, suggestion, rule_version, dismissed_at)
    select '21600000-0000-4000-8000-0000000000a1', '21600000-0000-4000-8000-000000000001', 'home', 'where-suggestion-rules@1', statement_timestamp();
    raise exception 'A dismissal without a Behavior was accepted.';
  exception when foreign_key_violation then null;
  end;

  -- The account snapshot carries every new kind and no foreign rows.
  if (select count(*) from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
      where entity ->> 'kind' in ('place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal')) <> 5 then
    raise exception 'The account snapshot did not include the place label rows.';
  end if;
  if exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
      where entity ->> 'kind' = 'place_marker' and entity -> 'value' ->> 'latitude_e6' <> '41878100') then
    raise exception 'The snapshot did not keep integer marker coordinates.';
  end if;

  -- A shorter retention deletes older labels in the same save.
  select * into saved from public.place_label_settings;
  perform public.save_place_label_settings(true, '90_days', true, saved.updated_at, '2026-07-24');
  if (select count(*) from public.completion_place_labels) <> 1
    or (select marker_prompt_dismissed_at from public.place_label_settings) is null then
    raise exception 'The retention save did not delete older labels or record Not now.';
  end if;
end;
$$;

-- Owner isolation: the other account sees nothing and cannot label foreign rows.
select set_config('request.jwt.claims', '{"sub":"21600000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.completion_place_labels) or exists (select 1 from public.place_markers)
    or exists (select 1 from public.place_label_settings) or exists (select 1 from public.where_suggestion_dismissals) then
    raise exception 'Another account read place label rows.';
  end if;
  perform public.save_place_label_settings(true, '90_days', false, null, null);
  begin
    insert into public.completion_place_labels (id, user_id, behavior_id, local_date, label, rule_version, recorded_at)
    select '21600000-0000-4000-8000-0000000000a1', '21600000-0000-4000-8000-000000000002', id, '2026-10-22', 'home', 'place-label-rules@1', statement_timestamp()
    from pg_temp.ids where name = 'other_behavior';
    raise exception 'Another account labeled a foreign occurrence.';
  exception when foreign_key_violation or unique_violation then null;
    when raise_exception then
      if sqlerrm = 'Another account labeled a foreign occurrence.' then raise; end if;
  end;
  begin
    insert into public.completion_place_labels (id, user_id, behavior_id, local_date, label, rule_version, recorded_at)
    select '21600000-0000-4000-8000-0000000000b1', '21600000-0000-4000-8000-000000000001', id, '2026-10-22', 'home', 'place-label-rules@1', statement_timestamp()
    from pg_temp.ids where name = 'behavior';
    raise exception 'A label was written for another owner.';
  exception when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm = 'A label was written for another owner.' then raise; end if;
  end;
end;
$$;
reset role;

-- Status away from Completed deletes the label for every writer.
update public.occurrences set status = 'not_completed', completed_at = null
where id = '21600000-0000-4000-8000-0000000000a1';
do $$
begin
  if exists (select 1 from public.completion_place_labels where id = '21600000-0000-4000-8000-0000000000a1') then
    raise exception 'Leaving Completed kept the label.';
  end if;
end;
$$;

-- The daily purge deletes labels past each account's retention.
update public.occurrences set status = 'completed', completed_at = '2026-05-01T13:00:00Z'
where id = '21600000-0000-4000-8000-0000000000a1';
insert into public.completion_place_labels (id, user_id, behavior_id, local_date, label, rule_version, recorded_at)
select '21600000-0000-4000-8000-0000000000a2', '21600000-0000-4000-8000-000000000001', id, '2026-05-01', 'elsewhere', 'place-label-rules@1', statement_timestamp()
from pg_temp.ids where name = 'behavior';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  if public.purge_expired_completion_place_labels() < 1 then raise exception 'The daily purge deleted nothing.'; end if;
end;
$$;
reset role;
do $$
begin
  if exists (select 1 from public.completion_place_labels where id = '21600000-0000-4000-8000-0000000000a2') then
    raise exception 'The daily purge kept an expired label.';
  end if;
end;
$$;

-- Turning labels off deletes labels, markers and dismissals.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21600000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  saved public.place_label_settings%rowtype;
begin
  select * into saved from public.place_label_settings;
  perform public.save_place_label_settings(false, '90_days', true, saved.updated_at, null);
  if exists (select 1 from public.completion_place_labels) or exists (select 1 from public.place_markers)
    or exists (select 1 from public.where_suggestion_dismissals)
    or (select enabled_at from public.place_label_settings) is not null then
    raise exception 'Turning labels off kept location-derived rows.';
  end if;
end;
$$;
reset role;

rollback;
