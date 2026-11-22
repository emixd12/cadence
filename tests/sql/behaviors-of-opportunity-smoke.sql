-- Behaviors of Opportunity (migration 20261121100000). Local-only rollback fixture.
-- Covers: unscheduled opportunity create and edit, refusing an unscheduled Behavior that
-- is not an opportunity, add_opportunity_occurrence (exact, range, Done now, replay and
-- refusals), generation never touching opportunity rows, remove_opportunity_occurrence
-- (clean, and each refusal), RLS isolation, and account sync contract 8.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('17800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'opportunity-a@example.invalid', '{}', '{}'),
  ('17800000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'opportunity-b@example.invalid', '{}', '{}');

create function pg_temp.configuration(graph jsonb, offset_minutes integer, opportunity boolean)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', null, 'location_text', null, 'where_kind', null, 'schedule_graph', graph,
    'browser_reminder_enabled', true, 'email_reminder_enabled', false, 'reminder_offset_minutes', offset_minutes,
    'active', true, 'timezone', 'America/New_York', 'end', null, 'pause', null, 'is_opportunity', opportunity);
$$;

create function pg_temp.daily_graph(with_ids boolean)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
    'time_entries', jsonb_build_array(jsonb_build_object(
      'kind', 'exact', 'preset', null, 'start_time', '09:00:00', 'end_time', null, 'sort_order', 0)
      || case when with_ids then '{"id":null}'::jsonb else '{}'::jsonb end))
    || case when with_ids then '{"id":null}'::jsonb else '{}'::jsonb end);
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

create function pg_temp.behavior_payload(title text, scheduled boolean, opportunity boolean, offset_minutes integer)
returns jsonb
language sql
as $$
  select jsonb_build_object('category_id', null, 'title', title, 'description', null,
    'recurrence_rule', case when scheduled then jsonb_build_object('frequency', 'daily', 'interval', 1) else 'null'::jsonb end,
    'scheduled_time', case when scheduled then '09:00:00' end,
    'timezone', 'America/New_York', 'browser_reminder_enabled', true, 'email_reminder_enabled', false,
    'reminder_offset_minutes', offset_minutes, 'active', true, 'archived_at', null, 'archive_notes', '[]'::jsonb,
    'default_duration_minutes', null, 'auto_archived_at', null, 'is_opportunity', opportunity,
    'created_at', '2026-11-01T12:00:00Z');
$$;

create function pg_temp.definition_plan(title text)
returns jsonb
language sql
as $$
  select jsonb_build_object('previous_title', null, 'next_title', title, 'previous_description', null,
    'next_description', null, 'changed_fields', jsonb_build_array('title'), 'recorded_at', '2026-11-01T12:00:00Z',
    'source', 'manual', 'reason', null);
$$;

create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'America/New_York')::date;
$$;

create function pg_temp.expect_error(statement text, expected_state text, expected_message text)
returns void
language plpgsql
as $$
begin
  execute statement;
  raise exception 'Expected "%" from: %', expected_message, statement;
exception when others then
  if sqlstate <> expected_state or sqlerrm <> expected_message then
    raise exception 'Expected % "%", got % "%" from: %', expected_state, expected_message, sqlstate, sqlerrm, statement;
  end if;
end;
$$;

grant execute on function pg_temp.expect_error(text, text, text) to authenticated;
grant execute on function pg_temp.configuration(jsonb, integer, boolean) to authenticated;
grant execute on function pg_temp.daily_graph(boolean) to authenticated;
grant execute on function pg_temp.plan(text, jsonb, jsonb, text[], text) to authenticated;
grant execute on function pg_temp.behavior_payload(text, boolean, boolean, integer) to authenticated;
grant execute on function pg_temp.definition_plan(text) to authenticated;
grant execute on function pg_temp.today() to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ------------------------------------------------------------------ create and edit

do $$
declare
  created jsonb;
  behavior public.behaviors;
  event public.behavior_configuration_events;
begin
  created := public.create_behavior_with_schedule_graph(
    pg_temp.behavior_payload('Unscheduled walk', false, true, 0),
    pg_temp.definition_plan('Unscheduled walk'),
    pg_temp.plan('baseline', null, pg_temp.configuration('[]', 0, true),
      array['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled',
        'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity'],
      'behavior_created'),
    '[]'::jsonb);
  select * into behavior from public.behaviors where id = (created ->> 'id')::uuid;
  if not behavior.is_opportunity or behavior.recurrence_rule is not null or behavior.scheduled_time is not null then
    raise exception 'The unscheduled opportunity Behavior was not stored as sent.';
  end if;
  if exists (select 1 from public.behavior_schedules where behavior_id = behavior.id) then
    raise exception 'The unscheduled opportunity Behavior has a schedule.';
  end if;
  select * into event from public.behavior_configuration_events where id = behavior.current_configuration_event_id;
  if event.next_configuration -> 'is_opportunity' <> 'true'::jsonb or event.next_configuration -> 'schedule_graph' <> '[]'::jsonb then
    raise exception 'The baseline snapshot does not carry the opportunity flag: %', event.next_configuration;
  end if;

  -- A plan written without the flag (a client from before this change) still matches.
  created := public.create_behavior_with_schedule_graph(
    pg_temp.behavior_payload('Scheduled stretch', true, false, 0),
    pg_temp.definition_plan('Scheduled stretch'),
    pg_temp.plan('baseline', null, pg_temp.configuration(pg_temp.daily_graph(false), 0, false) - 'is_opportunity',
      array['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled',
        'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause'],
      'behavior_created'),
    pg_temp.daily_graph(true));
  if (created ->> 'is_opportunity')::boolean then
    raise exception 'A Behavior created without the flag became an opportunity.';
  end if;

  created := public.create_behavior_with_schedule_graph(
    pg_temp.behavior_payload('Scheduled and opportunity read', true, true, 0),
    pg_temp.definition_plan('Scheduled and opportunity read'),
    pg_temp.plan('baseline', null, pg_temp.configuration(pg_temp.daily_graph(false), 0, true),
      array['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled',
        'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity'],
      'behavior_created'),
    pg_temp.daily_graph(true));
end;
$$;

-- An unscheduled Behavior that is not an opportunity is refused, by the graph rule and by
-- the table rule.
select pg_temp.expect_error($s$
  select public.create_behavior_with_schedule_graph(
    pg_temp.behavior_payload('Unscheduled plain', false, false, 0),
    pg_temp.definition_plan('Unscheduled plain'),
    pg_temp.plan('baseline', null, pg_temp.configuration('[]', 0, false),
      array['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled',
        'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity'],
      'behavior_created'),
    '[]'::jsonb)
$s$, '22023', 'A behavior needs between one and six schedules.');

reset role;
select pg_temp.expect_error($s$
  update public.behaviors set is_opportunity = false where title = 'Unscheduled walk'
$s$, '23514', 'new row for relation "behaviors" violates check constraint "behaviors_schedule_or_opportunity"');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  behavior public.behaviors;
  updated jsonb;
  event public.behavior_configuration_events;
begin
  select * into behavior from public.behaviors where title = 'Unscheduled walk';

  -- An edit that keeps no schedules succeeds while the flag stays on.
  updated := public.update_behavior_with_schedule_graph(behavior.id,
    pg_temp.behavior_payload('Unscheduled walk', false, true, 15) - 'created_at',
    jsonb_build_object('stored_title', behavior.title, 'stored_description', null),
    '[]'::jsonb, behavior.updated_at, null,
    pg_temp.plan('revision', pg_temp.configuration('[]', 0, true), pg_temp.configuration('[]', 15, true),
      array['reminder_offset_minutes'], 'behavior_edited'),
    '[]'::jsonb);
  if (updated ->> 'reminder_offset_minutes')::integer <> 15 or not (updated ->> 'is_opportunity')::boolean then
    raise exception 'The unscheduled edit was not stored.';
  end if;

  -- Turning the flag off needs a schedule (the table rule refuses null legacy columns;
  -- the graph rule refuses an empty graph).
  select * into behavior from public.behaviors where id = behavior.id;
  begin
    perform public.update_behavior_with_schedule_graph(behavior.id,
      pg_temp.behavior_payload('Unscheduled walk', true, false, 15) - 'created_at',
      jsonb_build_object('stored_title', behavior.title, 'stored_description', null),
      '[]'::jsonb, behavior.updated_at, null,
      pg_temp.plan('revision', pg_temp.configuration('[]', 15, true), pg_temp.configuration('[]', 15, false),
        array['is_opportunity'], 'behavior_edited'),
      '[]'::jsonb);
    raise exception 'The flag turned off with no schedule.';
  exception when invalid_parameter_value then
    if sqlerrm <> 'A behavior needs between one and six schedules.' then raise; end if;
  end;

  -- With a schedule, the flag turns off and the revision names both changes.
  updated := public.update_behavior_with_schedule_graph(behavior.id,
    pg_temp.behavior_payload('Unscheduled walk', true, false, 15) - 'created_at',
    jsonb_build_object('stored_title', behavior.title, 'stored_description', null),
    '[]'::jsonb, behavior.updated_at, null,
    pg_temp.plan('revision', pg_temp.configuration('[]', 15, true), pg_temp.configuration(pg_temp.daily_graph(false), 15, false),
      array['schedule_graph', 'is_opportunity'], 'behavior_edited'),
    pg_temp.daily_graph(true));
  if (updated ->> 'is_opportunity')::boolean then
    raise exception 'Turning the flag off was not stored.';
  end if;
  select * into event from public.behavior_configuration_events
  where behavior_id = behavior.id order by recorded_at desc, id desc limit 1;
  if event.changed_fields <> array['schedule_graph', 'is_opportunity'] then
    raise exception 'The revision named %.', event.changed_fields;
  end if;

  -- And back on, removing the schedule again.
  select * into behavior from public.behaviors where id = behavior.id;
  updated := public.update_behavior_with_schedule_graph(behavior.id,
    pg_temp.behavior_payload('Unscheduled walk', false, true, 15) - 'created_at',
    jsonb_build_object('stored_title', behavior.title, 'stored_description', null),
    cadence_private.current_behavior_schedule_graph(behavior.user_id, behavior.id), behavior.updated_at, null,
    pg_temp.plan('revision', pg_temp.configuration(pg_temp.daily_graph(false), 15, false), pg_temp.configuration('[]', 15, true),
      array['schedule_graph', 'is_opportunity'], 'behavior_edited'),
    '[]'::jsonb);
  if not (updated ->> 'is_opportunity')::boolean or exists (
    select 1 from public.behavior_schedules where behavior_id = behavior.id
  ) then
    raise exception 'Turning the flag back on did not remove the schedule.';
  end if;
end;
$$;

-- ------------------------------------------------------------------ add

do $$
declare
  walk public.behaviors;
  added jsonb;
  occurrence public.occurrences;
  replay jsonb;
begin
  select * into walk from public.behaviors where title = 'Unscheduled walk';

  -- Exact time.
  added := public.add_opportunity_occurrence(walk.id, pg_temp.today(), '12:00', null, null, 'user', false,
    '17800000-0000-4000-8000-000000000101');
  select * into occurrence from public.occurrences where id = (added #>> '{occurrence,id}')::uuid;
  if not (added ->> 'created')::boolean or occurrence.origin <> 'opportunity' or occurrence.added_by <> 'user'
    or occurrence.status <> 'unresolved' or occurrence.schedule_kind <> 'exact'
    or occurrence.behavior_schedule_slot_id is not null
    or occurrence.behavior_configuration_event_id <> walk.current_configuration_event_id
    or occurrence.scheduled_for <> (pg_temp.today() + time '12:00') at time zone 'America/New_York'
    or added -> 'status_event' <> 'null'::jsonb
  then
    raise exception 'The exact opportunity was not stored as sent: %', added;
  end if;

  -- The same call again returns the same row.
  replay := public.add_opportunity_occurrence(walk.id, pg_temp.today(), '12:00', null, null, 'user', false,
    '17800000-0000-4000-8000-000000000101');
  if (replay ->> 'created')::boolean or replay #>> '{occurrence,id}' <> occurrence.id::text
    or (select count(*) from public.occurrences where behavior_id = walk.id) <> 1
  then
    raise exception 'A replay made a second row.';
  end if;

  -- Time range, from Chat.
  added := public.add_opportunity_occurrence(walk.id, pg_temp.today(), '17:00', '18:30', 'evening', 'chat');
  if added #>> '{occurrence,schedule_kind}' <> 'range' or added #>> '{occurrence,schedule_end_time}' <> '18:30:00'
    or added #>> '{occurrence,schedule_preset}' <> 'evening' or added #>> '{occurrence,added_by}' <> 'chat'
  then
    raise exception 'The range opportunity was not stored as sent: %', added;
  end if;

  -- Done now: Completed with its status event in the same call.
  added := public.add_opportunity_occurrence(walk.id, pg_temp.today(), '07:15', null, null, 'user', true);
  select * into occurrence from public.occurrences where id = (added #>> '{occurrence,id}')::uuid;
  if occurrence.status <> 'completed' or occurrence.completed_at <> now() or occurrence.status_marked_at <> now()
    or (select count(*) from public.occurrence_status_events event
      where event.occurrence_id = occurrence.id and event.previous_status = 'unresolved' and event.status = 'completed'
        and event.status_semantics = 'explicit_user_mark' and event.source_capture_method = 'manual_tap'
        and event.recorded_at = now() and event.effective_at = now()) <> 1
    or added #>> '{status_event,occurrence_id}' <> occurrence.id::text
  then
    raise exception 'Done now did not store a Completed row with its status event.';
  end if;

  -- An MCP Done now records manual_text provenance.
  added := public.add_opportunity_occurrence(walk.id, pg_temp.today(), '07:30', null, null, 'mcp', true);
  if added #>> '{status_event,source_capture_method}' <> 'manual_text' then
    raise exception 'An MCP Done now recorded %.', added #>> '{status_event,source_capture_method}';
  end if;
end;
$$;

-- A scheduled-and-opportunity Behavior may get an added row at its scheduled time: the
-- schedule identity covers scheduled rows only.
do $$
declare
  both_kinds public.behaviors;
begin
  select * into both_kinds from public.behaviors where title = 'Scheduled and opportunity read';
  perform public.apply_occurrence_generation_plan(both_kinds.user_id, both_kinds.id, both_kinds.current_configuration_event_id,
    clock_timestamp(), jsonb_build_array(jsonb_build_object(
      'scheduled_for', (pg_temp.today() + time '09:00') at time zone 'America/New_York', 'local_date', pg_temp.today(),
      'behavior_configuration_event_id', both_kinds.current_configuration_event_id,
      'schedule_kind', 'exact', 'schedule_start_time', '09:00:00')), '[]'::jsonb, '[]'::jsonb);
  perform public.add_opportunity_occurrence(both_kinds.id, pg_temp.today(), '09:00', null, null, 'daily_brief');
  if (select count(*) from public.occurrences where behavior_id = both_kinds.id and local_date = pg_temp.today()) <> 2 then
    raise exception 'The added row and the scheduled row did not both stay.';
  end if;

  -- Generation may not update or delete the added row.
  begin
    perform public.apply_occurrence_generation_plan(both_kinds.user_id, both_kinds.id, both_kinds.current_configuration_event_id,
      clock_timestamp(), '[]'::jsonb, '[]'::jsonb,
      (select jsonb_agg(to_jsonb(occurrence)) from public.occurrences occurrence
        where occurrence.behavior_id = both_kinds.id and occurrence.origin = 'opportunity'));
    raise exception 'Generation deleted an opportunity row.';
  exception when invalid_parameter_value then
    if sqlerrm <> 'Occurrence generation cannot change an opportunity Occurrence.' then raise; end if;
  end;
  begin
    perform public.apply_occurrence_generation_plan(both_kinds.user_id, both_kinds.id, both_kinds.current_configuration_event_id,
      clock_timestamp(), '[]'::jsonb,
      (select jsonb_agg(jsonb_build_object('id', occurrence.id, 'previous_scheduled_for', occurrence.scheduled_for,
        'scheduled_for', occurrence.scheduled_for + interval '1 hour', 'local_date', occurrence.local_date,
        'behavior_configuration_event_id', both_kinds.current_configuration_event_id,
        'schedule_kind', 'exact', 'schedule_start_time', '10:00:00'))
        from public.occurrences occurrence where occurrence.behavior_id = both_kinds.id and occurrence.origin = 'opportunity'),
      '[]'::jsonb);
    raise exception 'Generation moved an opportunity row.';
  exception when invalid_parameter_value then
    if sqlerrm <> 'Occurrence generation cannot change an opportunity Occurrence.' then raise; end if;
  end;
end;
$$;

-- Refusals.
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00')
$s$, (select id from public.behaviors where title = 'Scheduled stretch')),
  'P0001', 'This Behavior is not available as an opportunity.');
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today() + 1, '12:00')
$s$, (select id from public.behaviors where title = 'Unscheduled walk')),
  '22023', 'An opportunity can be added to today only.');
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00', null, null, 'daily_brief', true)
$s$, (select id from public.behaviors where title = 'Unscheduled walk')),
  '22023', 'A Daily Brief suggestion cannot mark an Occurrence Completed.');
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00', null, null, 'someone')
$s$, (select id from public.behaviors where title = 'Unscheduled walk')),
  '22023', 'Unsupported opportunity source: someone.');
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00:30')
$s$, (select id from public.behaviors where title = 'Unscheduled walk')),
  '22023', 'Opportunity times must be whole minutes.');
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00', null, 'morning')
$s$, (select id from public.behaviors where title = 'Unscheduled walk')),
  '22023', 'An exact time cannot have a time-of-day preset.');
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00', null, null, 'user', false,
    '17800000-0000-4000-8000-000000000101')
$s$, (select id from public.behaviors where title = 'Scheduled and opportunity read')),
  'P0001', 'The Occurrence ID is already in use.');

-- Paused, ended and archived Behaviors leave the pool.
reset role;
update public.behaviors set pause_from_on = pg_temp.today() - 1, pause_back_on = pg_temp.today() + 2
where title = 'Scheduled and opportunity read';
update public.behaviors set end_on = pg_temp.today() - 1 where title = 'Scheduled stretch';
update public.behaviors set is_opportunity = true where title = 'Scheduled stretch';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00')
$s$, (select id from public.behaviors where title = 'Scheduled and opportunity read')),
  'P0001', 'This Behavior is not running at that time.');
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00')
$s$, (select id from public.behaviors where title = 'Scheduled stretch')),
  'P0001', 'This Behavior is not running at that time.');
reset role;
update public.behaviors set end_on = null, active = false, archived_at = now() where title = 'Scheduled stretch';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select pg_temp.expect_error(format($s$
  select public.add_opportunity_occurrence(%L, pg_temp.today(), '12:00')
$s$, (select id from public.behaviors where title = 'Scheduled stretch')),
  'P0001', 'An archived Behavior cannot be added.');

-- ------------------------------------------------------------------ remove

-- Seed what each refusal needs with the database owner.
reset role;
insert into public.reminder_deliveries (user_id, occurrence_id, channel, scheduled_send_at, status)
values ('17800000-0000-4000-8000-000000000001', '17800000-0000-4000-8000-000000000101', 'browser_push', now() + interval '1 hour', 'pending');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  walk public.behaviors;
  removed jsonb;
  noted uuid;
  timed uuid;
  reverted uuid;
begin
  select * into walk from public.behaviors where title = 'Unscheduled walk';

  removed := public.remove_opportunity_occurrence('17800000-0000-4000-8000-000000000101');
  if not (removed ->> 'removed')::boolean or (removed ->> 'cancelled_reminder_count')::integer <> 1
    or exists (select 1 from public.occurrences where id = '17800000-0000-4000-8000-000000000101')
    or exists (select 1 from public.reminder_deliveries where occurrence_id = '17800000-0000-4000-8000-000000000101')
  then
    raise exception 'A clean opportunity was not removed with its reminder: %', removed;
  end if;

  noted := (public.add_opportunity_occurrence(walk.id, pg_temp.today(), '13:00') #>> '{occurrence,id}')::uuid;
  timed := (public.add_opportunity_occurrence(walk.id, pg_temp.today(), '14:00') #>> '{occurrence,id}')::uuid;
  reverted := (public.add_opportunity_occurrence(walk.id, pg_temp.today(), '15:00', null, null, 'user', true) #>> '{occurrence,id}')::uuid;
  perform set_config('cadence_test.noted', noted::text, true);
  perform set_config('cadence_test.timed', timed::text, true);
  perform set_config('cadence_test.reverted', reverted::text, true);
end;
$$;

reset role;
update public.occurrences set note = 'Went to the park' where id = current_setting('cadence_test.noted')::uuid;
insert into public.occurrence_time_sessions (user_id, occurrence_id, behavior_id, started_at, stopped_at)
select user_id, id, behavior_id, now() - interval '10 minutes', now()
from public.occurrences where id = current_setting('cadence_test.timed')::uuid;
insert into public.occurrence_status_events (user_id, occurrence_id, behavior_id, previous_status, status,
  status_semantics, recorded_at, local_date, timezone, source_capture_method, source_confidence)
select user_id, id, behavior_id, 'completed', 'unresolved', 'explicit_user_correction', now(), local_date,
  'America/New_York', 'manual_tap', 'high'
from public.occurrences where id = current_setting('cadence_test.reverted')::uuid;
update public.occurrences set status = 'unresolved', completed_at = null, status_marked_at = null
where id = current_setting('cadence_test.reverted')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select pg_temp.expect_error(format('select public.remove_opportunity_occurrence(%L)',
  (select id from public.occurrences where origin = 'opportunity' and status = 'completed' limit 1)),
  'P0001', 'Only an Unresolved opportunity can be removed.');
select pg_temp.expect_error(format('select public.remove_opportunity_occurrence(%L)', current_setting('cadence_test.noted')),
  'P0001', 'An opportunity with a Note cannot be removed.');
select pg_temp.expect_error(format('select public.remove_opportunity_occurrence(%L)', current_setting('cadence_test.timed')),
  'P0001', 'An opportunity with tracked time cannot be removed.');
select pg_temp.expect_error(format('select public.remove_opportunity_occurrence(%L)', current_setting('cadence_test.reverted')),
  'P0001', 'An opportunity with status history cannot be removed.');
select pg_temp.expect_error(format('select public.remove_opportunity_occurrence(%L)',
  (select occurrence.id from public.occurrences occurrence join public.behaviors behavior on behavior.id = occurrence.behavior_id
    where behavior.title = 'Scheduled and opportunity read' and occurrence.origin = 'scheduled')),
  'P0001', 'Only an added opportunity can be removed.');

-- ------------------------------------------------------------------ RLS isolation

select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.occurrences) or exists (select 1 from public.behaviors) then
    raise exception 'Account B can read account A rows.';
  end if;
end;
$$;
reset role;
create temporary table opportunity_ids on commit drop as
select
  (select id from public.behaviors where title = 'Unscheduled walk') as behavior_id,
  current_setting('cadence_test.noted')::uuid as occurrence_id;
grant select on opportunity_ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select pg_temp.expect_error(format('select public.add_opportunity_occurrence(%L, pg_temp.today(), %L)',
  (select behavior_id from opportunity_ids), '12:00'), 'P0002', 'Behavior not found.');
select pg_temp.expect_error(format('select public.remove_opportunity_occurrence(%L)',
  (select occurrence_id from opportunity_ids)), 'P0002', 'Occurrence not found.');
select pg_temp.expect_error(format('select public.add_opportunity_occurrence(%L, pg_temp.today(), %L, null, null, %L, false, %L)',
  (select behavior_id from opportunity_ids), '12:00', 'user', (select occurrence_id from opportunity_ids)),
  'P0002', 'Behavior not found.');

-- ------------------------------------------------------------------ account sync contract 8

select set_config('request.jwt.claims', '{"sub":"17800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '17800000-0000-4000-8000-000000000001', true);
do $$
declare
  current_snapshot jsonb := public.read_account_sync_snapshot(8);
  legacy_snapshot jsonb := public.read_account_sync_snapshot(7);
begin
  if cadence_private.account_sync_current_contract() < 8 or cadence_private.account_sync_min_writer_contract() <> 8 then
    raise exception 'Account sync contract 8 is not in force as the minimum writer contract.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(current_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and entity #>> '{value,title}' = 'Unscheduled walk'
      and entity #> '{value,is_opportunity}' = 'true'::jsonb and entity #> '{value,recurrence_rule}' = 'null'::jsonb
  ) or not exists (
    select 1 from jsonb_array_elements(current_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'occurrence' and entity #>> '{value,origin}' = 'opportunity'
      and entity #>> '{value,added_by}' = 'chat'
  ) then
    raise exception 'The contract 8 snapshot does not carry the opportunity fields.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(legacy_snapshot -> 'entities') entity
    where (entity ->> 'kind' = 'behavior' and (entity -> 'value') ? 'is_opportunity')
      or (entity ->> 'kind' = 'occurrence' and ((entity -> 'value') ? 'origin' or (entity -> 'value') ? 'added_by'))
  ) then
    raise exception 'The contract 7 snapshot shows contract 8 fields.';
  end if;
end;
$$;

reset role;
rollback;
