\set ON_ERROR_STOP on

-- Ticket 351: marking an Occurrence Completed automatically stops any running
-- time-tracking session on that Occurrence at `planned_status_marked_at` (clamped
-- to `started_at` on clock skew). Not Completed, Unresolved, and unchanged Completed
-- transitions leave running sessions untouched. Synthetic local fixtures; rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('35100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-351@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('35100000-0000-4000-8000-000000000001', 'ticket-351@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;

insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('35110000-0000-4000-8000-000000000001', '35100000-0000-4000-8000-000000000001', 'Shower', '{"type":"daily"}', '08:00', 'America/New_York'),
  ('35110000-0000-4000-8000-000000000002', '35100000-0000-4000-8000-000000000001', 'Morning routine', '{"type":"daily"}', '08:00', 'America/New_York');

insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, parent_behavior_id, sub_behavior_sort_order, inherit_parent_schedule) values
  ('35110000-0000-4000-8000-000000000003', '35100000-0000-4000-8000-000000000001', 'Facewash', '{"type":"daily"}', '08:00', 'America/New_York', '35110000-0000-4000-8000-000000000002', 0, true);

insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status) values
  ('35120000-0000-4000-8000-000000000001', '35100000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000001', '2026-11-23T13:00:00Z', '2026-11-23', 'exact', '08:00', 'unresolved'),
  ('35120000-0000-4000-8000-000000000002', '35100000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000001', '2026-11-22T13:00:00Z', '2026-11-22', 'exact', '08:00', 'unresolved'),
  ('35120000-0000-4000-8000-000000000003', '35100000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000001', '2026-11-21T13:00:00Z', '2026-11-21', 'exact', '08:00', 'unresolved'),
  ('35120000-0000-4000-8000-000000000004', '35100000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000003', '2026-11-23T13:00:00Z', '2026-11-23', 'exact', '08:00', 'unresolved');

insert into public.occurrence_time_sessions (id, user_id, occurrence_id, behavior_id, started_at, stopped_at) values
  ('35130000-0000-4000-8000-000000000001', '35100000-0000-4000-8000-000000000001', '35120000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000001', '2026-11-23T13:00:00Z', null),
  ('35130000-0000-4000-8000-000000000002', '35100000-0000-4000-8000-000000000001', '35120000-0000-4000-8000-000000000002', '35110000-0000-4000-8000-000000000001', '2026-11-22T13:05:00Z', null),
  ('35130000-0000-4000-8000-000000000003', '35100000-0000-4000-8000-000000000001', '35120000-0000-4000-8000-000000000003', '35110000-0000-4000-8000-000000000001', '2026-11-21T13:00:00Z', null),
  ('35130000-0000-4000-8000-000000000004', '35100000-0000-4000-8000-000000000001', '35120000-0000-4000-8000-000000000004', '35110000-0000-4000-8000-000000000003', '2026-11-23T13:00:00Z', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '35100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text,
  true
);

do $$
declare
  res jsonb;
  ev_id uuid;
  stopped timestamptz;
begin
  -- 1. Unresolved -> Completed stops the running session at status_marked_at.
  res := public.apply_occurrence_status_transition(
    '35120000-0000-4000-8000-000000000001',
    'unresolved', null,
    'completed', '2026-11-23T13:12:00Z', '2026-11-23T13:12:00Z',
    'explicit_user_mark', '2026-11-23T13:12:00Z', '2026-11-23T13:12:00Z',
    'manual_tap', 'high', true
  );
  select stopped_at into stopped from public.occurrence_time_sessions where id = '35130000-0000-4000-8000-000000000001';
  if stopped is distinct from '2026-11-23T13:12:00Z'::timestamptz then
    raise exception 'Expected session 1 stopped_at = 2026-11-23T13:12:00Z, got %', stopped;
  end if;

  -- Starting a new timer after Completed and reapplying Completed (unchanged) must leave it running.
  ev_id := (res->'status_event'->>'id')::uuid;
  insert into public.occurrence_time_sessions (id, user_id, occurrence_id, behavior_id, started_at, stopped_at)
  values ('35130000-0000-4000-8000-000000000005', '35100000-0000-4000-8000-000000000001', '35120000-0000-4000-8000-000000000001', '35110000-0000-4000-8000-000000000001', '2026-11-23T13:20:00Z', null);

  perform public.apply_occurrence_status_transition(
    '35120000-0000-4000-8000-000000000001',
    'completed', ev_id,
    'completed', '2026-11-23T13:12:00Z', '2026-11-23T13:12:00Z',
    null, null, null, null, null, true
  );
  select stopped_at into stopped from public.occurrence_time_sessions where id = '35130000-0000-4000-8000-000000000005';
  if stopped is not null then
    raise exception 'Unchanged Completed transition must not stop a running session; got %', stopped;
  end if;

  -- 2. Clock skew: started_at (13:05) > status_marked_at (13:04) clamps stopped_at to started_at.
  perform public.apply_occurrence_status_transition(
    '35120000-0000-4000-8000-000000000002',
    'unresolved', null,
    'completed', '2026-11-22T13:04:00Z', '2026-11-22T13:04:00Z',
    'explicit_user_mark', '2026-11-22T13:04:00Z', '2026-11-22T13:04:00Z',
    'manual_tap', 'high', true
  );
  select stopped_at into stopped from public.occurrence_time_sessions where id = '35130000-0000-4000-8000-000000000002';
  if stopped is distinct from '2026-11-22T13:05:00Z'::timestamptz then
    raise exception 'Expected clamped stopped_at = 2026-11-22T13:05:00Z, got %', stopped;
  end if;

  -- 3. Unresolved -> Not Completed leaves the running session untouched; correcting to Completed stops it.
  res := public.apply_occurrence_status_transition(
    '35120000-0000-4000-8000-000000000003',
    'unresolved', null,
    'not_completed', null, '2026-11-21T13:10:00Z',
    'explicit_user_mark', '2026-11-21T13:10:00Z', '2026-11-21T13:10:00Z',
    'manual_tap', 'high', true
  );
  select stopped_at into stopped from public.occurrence_time_sessions where id = '35130000-0000-4000-8000-000000000003';
  if stopped is not null then
    raise exception 'Not Completed must not stop a running session; got %', stopped;
  end if;

  ev_id := (res->'status_event'->>'id')::uuid;
  perform public.apply_occurrence_status_transition(
    '35120000-0000-4000-8000-000000000003',
    'not_completed', ev_id,
    'completed', '2026-11-21T13:15:00Z', '2026-11-21T13:15:00Z',
    'explicit_user_correction', '2026-11-21T13:15:00Z', '2026-11-21T13:15:00Z',
    'manual_tap', 'high', true
  );
  select stopped_at into stopped from public.occurrence_time_sessions where id = '35130000-0000-4000-8000-000000000003';
  if stopped is distinct from '2026-11-21T13:15:00Z'::timestamptz then
    raise exception 'Expected session 3 stopped_at = 2026-11-21T13:15:00Z, got %', stopped;
  end if;

  -- 4. Routine bulk Completed via apply_parent_slot_status_transition stops the child running session.
  perform public.apply_parent_slot_status_transition(
    '35110000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'occurrence_id', '35120000-0000-4000-8000-000000000004',
      'expected_status', 'unresolved',
      'expected_latest_event_id', null,
      'planned_status', 'completed',
      'planned_completed_at', '2026-11-23T13:08:00Z',
      'planned_status_marked_at', '2026-11-23T13:08:00Z',
      'planned_event_semantics', 'explicit_user_mark',
      'planned_event_recorded_at', '2026-11-23T13:08:00Z',
      'planned_event_effective_at', '2026-11-23T13:08:00Z',
      'planned_event_source_capture_method', 'manual_tap',
      'planned_event_source_confidence', 'high',
      'planned_cancel_pending_reminders', true
    ))
  );
  select stopped_at into stopped from public.occurrence_time_sessions where id = '35130000-0000-4000-8000-000000000004';
  if stopped is distinct from '2026-11-23T13:08:00Z'::timestamptz then
    raise exception 'Expected routine step session stopped_at = 2026-11-23T13:08:00Z, got %', stopped;
  end if;
end $$;

rollback;
