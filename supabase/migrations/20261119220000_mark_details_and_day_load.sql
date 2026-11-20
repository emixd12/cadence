-- Advisor plan Phase 4, workstream 4G (Emi, D8): three new data points.
--
-- 1. "Done at": when an item is marked Completed well after its set time, the person
--    may say when it was really done. 2. "Why not done": an optional one-tap reason on
--    Not Completed. Both are appended as their own status event that keeps the status
--    (previous_status = status, explicit_user_correction, revising the latest event), so
--    history stays append-only and the detail syncs to the Mac like any mark.
--      done-at:  reason_code 'done_at', effective_at = the done time; the Occurrence's
--                completed_at becomes that time and status_marked_at keeps the tap time.
--      reason:   reason_code 'not_done:<reason>'; effective_at is kept; the Occurrence
--                does not change.
--    packages/core/src/resolvers/status.resolver.ts plans both; this function checks
--    and commits one, the way apply_occurrence_status_transition does for a mark.
--
-- 3. Day load: one server-only row per account per local day, built only from real
--    lengths (calendar events' own start and end; a Behavior's set length or logged
--    completion average). Never a model estimate or the default 30-minute window. No
--    titles. The coach's early-morning visit (4B, 03:00 to 05:59 local) computes the row
--    for the day about to start, since a live calendar read must start today, and stores
--    it with coach_record_day_load. The coach reads rows back with coach_day_loads.
--
-- Owner approval: production apply needs Emi's go-ahead (advisor plan, Phase 4 brief, 4G).
begin;

-- 1 and 2 ---------------------------------------------------------------------------

create function public.apply_occurrence_mark_detail(
  target_occurrence_id uuid,
  expected_latest_event_id uuid,
  planned_completed_at timestamptz,
  planned_event_recorded_at timestamptz,
  planned_event_effective_at timestamptz,
  planned_event_reason_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_occurrence public.occurrences%rowtype;
  updated_occurrence public.occurrences%rowtype;
  latest_status_event public.occurrence_status_events%rowtype;
  inserted_status_event public.occurrence_status_events%rowtype;
  behavior_timezone text;
  day_start timestamptz;
begin
  if current_user_id is null then
    raise exception 'Occurrence changes require an authenticated user.' using errcode = '42501';
  end if;
  if expected_latest_event_id is null or planned_event_recorded_at is null or planned_event_reason_code is null then
    raise exception 'A mark detail requires its latest event and a complete plan.' using errcode = '22023';
  end if;

  select occurrence.* into current_occurrence
  from public.occurrences as occurrence
  where occurrence.user_id = current_user_id and occurrence.id = target_occurrence_id
  for update;
  if not found then
    raise exception 'Occurrence not found.' using errcode = 'P0002';
  end if;

  select status_event.* into latest_status_event
  from public.occurrence_status_events as status_event
  where status_event.user_id = current_user_id and status_event.occurrence_id = current_occurrence.id
  order by status_event.recorded_at desc, status_event.created_at desc, status_event.id desc
  limit 1;
  if latest_status_event.id is distinct from expected_latest_event_id then
    raise exception 'Occurrence status history changed concurrently. Review the latest status and try again.'
      using errcode = '40001';
  end if;
  if planned_event_recorded_at < latest_status_event.recorded_at then
    raise exception 'A mark detail cannot come before the latest status event.' using errcode = '22023';
  end if;

  select coalesce(behavior.timezone, 'America/New_York') into behavior_timezone
  from public.behaviors as behavior
  where behavior.user_id = current_user_id and behavior.id = current_occurrence.behavior_id;

  if planned_event_reason_code = 'done_at' then
    if current_occurrence.status <> 'completed' or latest_status_event.status <> 'completed'
      or current_occurrence.status_marked_at is null then
      raise exception 'Occurrence status changed concurrently. Review the latest status and try again.'
        using errcode = '40001';
    end if;
    day_start := (current_occurrence.local_date::timestamp) at time zone behavior_timezone;
    if planned_completed_at is null or planned_event_effective_at is distinct from planned_completed_at
      or planned_completed_at > current_occurrence.status_marked_at or planned_completed_at < day_start then
      raise exception 'The done time must fall on the item''s day and before it was marked.' using errcode = '22023';
    end if;
  elsif planned_event_reason_code in (
    'not_done:no_time', 'not_done:forgot', 'not_done:low_energy', 'not_done:away', 'not_done:chose_not_to'
  ) then
    if current_occurrence.status <> 'not_completed' or latest_status_event.status <> 'not_completed' then
      raise exception 'Occurrence status changed concurrently. Review the latest status and try again.'
        using errcode = '40001';
    end if;
    if planned_completed_at is not null
      or planned_event_effective_at is distinct from current_occurrence.status_marked_at then
      raise exception 'A reason keeps the Not Completed mark as it is.' using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported mark detail: %.', planned_event_reason_code using errcode = '22023';
  end if;

  if planned_event_reason_code = 'done_at' then
    update public.occurrences as occurrence
    set completed_at = planned_completed_at
    where occurrence.user_id = current_user_id and occurrence.id = current_occurrence.id
    returning occurrence.* into updated_occurrence;
  else
    updated_occurrence := current_occurrence;
  end if;

  insert into public.occurrence_status_events (
    user_id, occurrence_id, behavior_id, previous_status, status, status_semantics,
    recorded_at, effective_at, local_date, timezone, source_capture_method, source_confidence,
    revises_event_id, reason_code
  ) values (
    current_user_id, updated_occurrence.id, updated_occurrence.behavior_id, latest_status_event.status,
    latest_status_event.status, 'explicit_user_correction', planned_event_recorded_at,
    planned_event_effective_at, updated_occurrence.local_date, behavior_timezone, 'manual_tap', 'high',
    latest_status_event.id, planned_event_reason_code
  )
  returning * into inserted_status_event;

  return jsonb_build_object(
    'occurrence', to_jsonb(updated_occurrence),
    'status_event', to_jsonb(inserted_status_event)
  );
end;
$$;

comment on function public.apply_occurrence_mark_detail(uuid, uuid, timestamptz, timestamptz, timestamptz, text) is
  'Advisor plan 4G: appends a same-status detail event (done_at or not_done:<reason>) to the authenticated owner''s Occurrence while its latest status event is the expected one.';

revoke all on function public.apply_occurrence_mark_detail(uuid, uuid, timestamptz, timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_occurrence_mark_detail(uuid, uuid, timestamptz, timestamptz, timestamptz, text)
  to authenticated;

-- 3 ---------------------------------------------------------------------------------

create table cadence_advisor_private.day_loads (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  run_id uuid references cadence_advisor_private.agent_runs(id) on delete set null,
  -- Null when no calendar was read (calendar source off, none connected, or the read failed).
  calendar_minutes integer check (calendar_minutes is null or calendar_minutes between 0 and 1440),
  calendar_events integer check (calendar_events is null or calendar_events >= 0),
  -- Cadence items with a real length, and their summed length.
  item_minutes integer not null check (item_minutes >= 0),
  items_counted integer not null check (items_counted >= 0),
  -- Items left out because they have neither a set length nor a logged average.
  items_no_length integer not null check (items_no_length >= 0),
  load_version text not null check (load_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  computed_at timestamptz not null default now(),
  primary key (user_id, local_date),
  check ((calendar_minutes is null) = (calendar_events is null))
);

alter table cadence_advisor_private.day_loads enable row level security;
alter table cadence_advisor_private.day_loads force row level security;
revoke all on table cadence_advisor_private.day_loads from public, anon, authenticated, service_role;

-- Coach token only. Stores (or replaces) one day's row for the caller. The day must be
-- the run's local day or up to 180 days before it; rows older than 400 days are removed.
create function public.coach_record_day_load(p_run_id uuid, p_local_date date, p_load_version text, p_load jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_load is null or jsonb_typeof(p_load) <> 'object' or p_local_date is null then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = 'coach' and run.finished_at is null;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;
  if p_local_date > v_run.local_date or p_local_date < v_run.local_date - 180 then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;

  delete from cadence_advisor_private.day_loads as load
  where load.user_id = v_user_id and load.local_date < v_run.local_date - 400;

  insert into cadence_advisor_private.day_loads (
    user_id, local_date, run_id, calendar_minutes, calendar_events, item_minutes, items_counted,
    items_no_length, load_version, computed_at
  ) values (
    v_user_id, p_local_date, v_run.id, (p_load ->> 'calendar_minutes')::integer,
    (p_load ->> 'calendar_events')::integer, (p_load ->> 'item_minutes')::integer,
    (p_load ->> 'items_counted')::integer, (p_load ->> 'items_no_length')::integer, p_load_version, now()
  )
  on conflict (user_id, local_date) do update set
    run_id = excluded.run_id, calendar_minutes = excluded.calendar_minutes,
    calendar_events = excluded.calendar_events, item_minutes = excluded.item_minutes,
    items_counted = excluded.items_counted, items_no_length = excluded.items_no_length,
    load_version = excluded.load_version, computed_at = excluded.computed_at;
end;
$$;
revoke all on function public.coach_record_day_load(uuid, date, text, jsonb) from public, anon, service_role;
grant execute on function public.coach_record_day_load(uuid, date, text, jsonb) to authenticated;

-- Coach token only. The caller's day-load rows from p_from to p_to (at most 400 days).
create function public.coach_day_loads(p_from date, p_to date)
returns table (
  local_date date, calendar_minutes integer, calendar_events integer, item_minutes integer,
  items_counted integer, items_no_length integer, load_version text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if cadence_advisor_private.current_agent() <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  return query
  select load.local_date, load.calendar_minutes, load.calendar_events, load.item_minutes,
    load.items_counted, load.items_no_length, load.load_version
  from cadence_advisor_private.day_loads as load
  where load.user_id = (select auth.uid()) and load.local_date between p_from and p_to
  order by load.local_date;
end;
$$;
revoke all on function public.coach_day_loads(date, date) from public, anon, service_role;
grant execute on function public.coach_day_loads(date, date) to authenticated;

commit;
