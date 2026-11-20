\set ON_ERROR_STOP on
-- Ended and Paused Behaviors (migration 20261120120000). Run against a local database:
-- psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -f tests/sql/behavior-end-and-pause-smoke.sql

begin;

-- Local times use the compatible rule: a repeated time takes the earlier instant and a
-- skipped time moves forward by the gap.
do $$
begin
  if cadence_private.behavior_local_instant('2026-11-01', '00:00', 'America/Havana')
    is distinct from '2026-11-01T04:00:00Z'::timestamptz then
    raise exception 'Ambiguous local midnight did not use the earlier instant.';
  end if;
  if cadence_private.behavior_local_instant('2026-11-01', '01:30', 'America/New_York')
    is distinct from '2026-11-01T05:30:00Z'::timestamptz then
    raise exception 'A repeated local time did not use the earlier instant.';
  end if;
  if cadence_private.behavior_local_instant('2026-03-08', '02:30', 'America/New_York')
    is distinct from '2026-03-08T07:30:00Z'::timestamptz then
    raise exception 'A skipped local time did not move forward by the gap.';
  end if;
  if cadence_private.behavior_end_instant('2026-11-20', null, 'America/New_York')
    is distinct from '2026-11-21T05:00:00Z'::timestamptz then
    raise exception 'An end with no time did not stop at the end of its day.';
  end if;
  -- An Evening window still open at an 8 PM end is stopped; one that closed is kept.
  if not cadence_private.behavior_stops_occurrence('2026-11-20', '20:00', null, null, null, 'America/New_York',
      '2026-11-20T22:00:00Z', '2026-11-21T02:00:00Z') then
    raise exception 'An open window was not stopped at the end.';
  end if;
  if cadence_private.behavior_stops_occurrence('2026-11-20', '20:00', null, null, null, 'America/New_York',
      '2026-11-20T17:00:00Z', null) then
    raise exception 'An exact time before the end was stopped.';
  end if;
  -- A pause stops times from its start until the start of its back-on day.
  if not cadence_private.behavior_stops_occurrence(null, null, '2026-11-21', null, '2026-11-24', 'America/New_York',
      '2026-11-23T14:00:00Z', null) then
    raise exception 'A time inside the pause was not stopped.';
  end if;
  if cadence_private.behavior_stops_occurrence(null, null, '2026-11-21', null, '2026-11-24', 'America/New_York',
      '2026-11-24T14:00:00Z', null) then
    raise exception 'A time on the back-on day was stopped.';
  end if;
  if exists (select 1 from pg_proc where proname in (
    'archive_due_behaviors', 'archive_my_due_behaviors', 'archive_due_behaviors_for_owner', 'behavior_end_date_boundary'
  )) then
    raise exception 'The end-date archive job still exists.';
  end if;
  if cadence_private.account_sync_min_writer_contract() <> 7 or cadence_private.account_sync_current_contract() <> 7 then
    raise exception 'Account sync contract 7 is not the current and minimum writer contract.';
  end if;
end;
$$;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('13900000-0000-4000-8000-000000000011', 'authenticated', 'authenticated',
  'ended-paused@example.invalid', '{}', '{}');

create function pg_temp.configuration(end_value jsonb, pause_value jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', null, 'location_text', null, 'where_kind', null,
    'schedule_graph', jsonb_build_array(jsonb_build_object(
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
      'time_entries', jsonb_build_array(jsonb_build_object(
        'kind', 'exact', 'preset', null, 'start_time', '09:00:00', 'end_time', null, 'sort_order', 0)))),
    'browser_reminder_enabled', true, 'email_reminder_enabled', false, 'reminder_offset_minutes', 0,
    'active', true, 'timezone', 'America/New_York', 'end', end_value, 'pause', pause_value);
$$;

create function pg_temp.plan(kind text, previous jsonb, next jsonb, fields text[], reason text)
returns jsonb
language sql
as $$
  select jsonb_build_object('event_kind', kind, 'previous_configuration', previous, 'next_configuration', next,
    'changed_fields', to_jsonb(fields), 'recorded_at', clock_timestamp(), 'effective_at', clock_timestamp(),
    'effective_local_date', (clock_timestamp() at time zone 'America/New_York')::date,
    'timezone', 'America/New_York', 'source', 'manual', 'reason_code', reason);
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13900000-0000-4000-8000-000000000011","role":"authenticated"}', true);

-- Create with an end: the snapshot carries it, and a baseline names end and pause.
select public.create_behavior_with_schedule_graph(
  jsonb_build_object('category_id', null, 'title', 'Ended and paused contract', 'description', null,
    'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'scheduled_time', '09:00:00',
    'timezone', 'America/New_York', 'browser_reminder_enabled', true, 'email_reminder_enabled', false,
    'reminder_offset_minutes', 0, 'active', true, 'archived_at', null, 'archive_notes', '[]'::jsonb,
    'default_duration_minutes', null, 'end_on', '2000-01-10', 'end_time', '08:00:00',
    'auto_archived_at', null, 'created_at', '1999-12-01T00:00:00Z'),
  jsonb_build_object('previous_title', null, 'next_title', 'Ended and paused contract', 'previous_description', null,
    'next_description', null, 'changed_fields', jsonb_build_array('title'), 'recorded_at', '1999-12-01T00:00:00Z',
    'source', 'manual', 'reason', null),
  pg_temp.plan('baseline', null, pg_temp.configuration('{"on":"2000-01-10","time":"08:00:00"}', 'null'),
    array['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled',
      'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause'], 'behavior_created'),
  jsonb_build_array(jsonb_build_object('id', null,
    'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
    'time_entries', jsonb_build_array(jsonb_build_object('id', null, 'kind', 'exact', 'preset', null,
      'start_time', '09:00:00', 'end_time', null, 'sort_order', 0)))));

do $$
declare behavior public.behaviors; rejected boolean := false;
begin
  select * into behavior from public.behaviors where title = 'Ended and paused contract';
  if behavior.end_on <> '2000-01-10' or behavior.end_time <> '08:00' or not behavior.active then
    raise exception 'Create did not store the end.';
  end if;

  -- 9 AM on the last day is after an 8 AM end: generation may not insert it.
  begin
    perform public.apply_occurrence_generation_plan(behavior.user_id, behavior.id, behavior.current_configuration_event_id,
      clock_timestamp(), jsonb_build_array(jsonb_build_object(
        'scheduled_for', '2000-01-10T14:00:00Z', 'local_date', '2000-01-10',
        'behavior_configuration_event_id', behavior.current_configuration_event_id,
        'schedule_kind', 'exact', 'schedule_start_time', '09:00:00')), '[]'::jsonb, '[]'::jsonb);
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Behavior end or pause changed after occurrence planning.' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Generation inserted a row after the end.'; end if;

  -- The day before is still running.
  perform public.apply_occurrence_generation_plan(behavior.user_id, behavior.id, behavior.current_configuration_event_id,
    clock_timestamp(), jsonb_build_array(jsonb_build_object(
      'scheduled_for', '2000-01-09T14:00:00Z', 'local_date', '2000-01-09',
      'behavior_configuration_event_id', behavior.current_configuration_event_id,
      'schedule_kind', 'exact', 'schedule_start_time', '09:00:00')), '[]'::jsonb, '[]'::jsonb);
  if not exists (select 1 from public.occurrences where behavior_id = behavior.id and local_date = '2000-01-09') then
    raise exception 'Generation refused a row before the end.';
  end if;
end;
$$;

-- Seed a past row after the end with the database owner, as an offline stop would leave.
reset role;
insert into public.occurrences (user_id, behavior_id, behavior_configuration_event_id, scheduled_for, local_date,
  status, schedule_kind, schedule_start_time)
select user_id, id, current_configuration_event_id, '2000-01-11T14:00:00Z', '2000-01-11', 'unresolved', 'exact', '09:00:00'
from public.behaviors where title = 'Ended and paused contract';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13900000-0000-4000-8000-000000000011","role":"authenticated"}', true);

do $$
declare behavior public.behaviors;
begin
  select * into behavior from public.behaviors where title = 'Ended and paused contract';
  -- A past row the end stops may go; a past row before the end may not.
  perform public.apply_occurrence_generation_plan(behavior.user_id, behavior.id, behavior.current_configuration_event_id,
    clock_timestamp(), '[]'::jsonb, '[]'::jsonb,
    (select jsonb_agg(to_jsonb(occurrence)) from public.occurrences occurrence
      where occurrence.behavior_id = behavior.id and occurrence.local_date = '2000-01-11'));
  if exists (select 1 from public.occurrences where behavior_id = behavior.id and local_date = '2000-01-11') then
    raise exception 'A past row after the end was kept.';
  end if;
  begin
    perform public.apply_occurrence_generation_plan(behavior.user_id, behavior.id, behavior.current_configuration_event_id,
      clock_timestamp(), '[]'::jsonb, '[]'::jsonb,
      (select jsonb_agg(to_jsonb(occurrence)) from public.occurrences occurrence
        where occurrence.behavior_id = behavior.id and occurrence.local_date = '2000-01-09'));
    raise exception 'A past row before the end was removed.';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Occurrence delete targets changed after planning.' then raise; end if;
  end;
end;
$$;

-- Clearing the end and setting a pause writes a normal revision naming both.
do $$
declare behavior public.behaviors; updated jsonb; event public.behavior_configuration_events;
begin
  select * into behavior from public.behaviors where title = 'Ended and paused contract';
  updated := public.update_behavior_with_schedule_graph(behavior.id,
    jsonb_build_object('category_id', null, 'title', behavior.title, 'description', null,
      'recurrence_rule', behavior.recurrence_rule, 'scheduled_time', '09:00:00', 'timezone', 'America/New_York',
      'browser_reminder_enabled', true, 'email_reminder_enabled', false, 'reminder_offset_minutes', 0,
      'active', true, 'archived_at', null, 'archive_notes', '[]'::jsonb,
      'end_on', null, 'end_time', null, 'pause_from_on', '2030-01-01', 'pause_from_time', '18:30:00',
      'pause_back_on', '2030-01-05'),
    jsonb_build_object('stored_title', behavior.title, 'stored_description', null),
    cadence_private.current_behavior_schedule_graph(behavior.user_id, behavior.id),
    behavior.updated_at, null,
    pg_temp.plan('revision', pg_temp.configuration('{"on":"2000-01-10","time":"08:00:00"}', 'null'),
      pg_temp.configuration('null', '{"from_on":"2030-01-01","from_time":"18:30:00","back_on":"2030-01-05"}'),
      array['end', 'pause'], 'behavior_paused'),
    cadence_private.current_behavior_schedule_graph(behavior.user_id, behavior.id));
  if (updated ->> 'pause_back_on') <> '2030-01-05' or updated ->> 'end_on' is not null then
    raise exception 'Update did not store the pause and clear the end.';
  end if;
  if (updated ->> 'updated_at')::timestamptz = behavior.updated_at then
    raise exception 'A pause change did not move the revision.';
  end if;
  select * into event from public.behavior_configuration_events
  where behavior_id = behavior.id order by recorded_at desc, id desc limit 1;
  if event.changed_fields <> array['end', 'pause'] or event.reason_code <> 'behavior_paused' then
    raise exception 'The pause revision named %.', event.changed_fields;
  end if;

  -- An upcoming pause keeps its wall-clock time when the timezone changes.
  perform public.update_profile_and_behavior_timezones_with_config_events('America/Los_Angeles',
    (select timezone from public.profiles where id = behavior.user_id),
    jsonb_build_array(jsonb_build_object('behavior_id', behavior.id,
      'expected_updated_at', (updated ->> 'updated_at')::timestamptz,
      'run', jsonb_build_object('end_on', null, 'end_time', null, 'pause_from_on', '2030-01-01', 'pause_from_time', '18:30:00'),
      'configuration_event_plan', pg_temp.plan('revision',
        pg_temp.configuration('null', '{"from_on":"2030-01-01","from_time":"18:30:00","back_on":"2030-01-05"}'),
        pg_temp.configuration('null', '{"from_on":"2030-01-01","from_time":"18:30:00","back_on":"2030-01-05"}')
          || '{"timezone":"America/Los_Angeles"}', array['timezone'], 'timezone_changed')
        || jsonb_build_object('timezone', 'America/Los_Angeles',
          'effective_local_date', (clock_timestamp() at time zone 'America/Los_Angeles')::date))));
  if not exists (select 1 from public.behaviors where id = behavior.id and timezone = 'America/Los_Angeles'
      and pause_from_time = '18:30') then
    raise exception 'The timezone change lost the upcoming pause.';
  end if;
end;
$$;

reset role;
rollback;
