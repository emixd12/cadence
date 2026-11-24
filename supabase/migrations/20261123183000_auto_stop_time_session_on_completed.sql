-- Ticket 351 (owner decision 2026-11-23): transitioning an Occurrence to Completed
-- automatically stops any running time-tracking session on that Occurrence at
-- `planned_status_marked_at` (clamped to `started_at` on clock skew), inside the same
-- transaction. Not Completed, Unresolved, and unchanged Completed transitions leave
-- running sessions untouched. Existing already-completed rows are not backfilled.
begin;

create or replace function public.apply_occurrence_status_transition(
  target_occurrence_id uuid,
  expected_status text,
  expected_latest_event_id uuid,
  planned_status text,
  planned_completed_at timestamptz,
  planned_status_marked_at timestamptz,
  planned_event_semantics text,
  planned_event_recorded_at timestamptz,
  planned_event_effective_at timestamptz,
  planned_event_source_capture_method text,
  planned_event_source_confidence text,
  planned_cancel_pending_reminders boolean
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
  latest_status_event_id uuid;
  inserted_status_event public.occurrence_status_events%rowtype;
  status_changed boolean;
begin
  if current_user_id is null then
    raise exception 'Occurrence status changes require an authenticated user.'
      using errcode = '42501';
  end if;

  if
    expected_status is null
    or expected_status not in ('unresolved', 'completed', 'not_completed')
  then
    raise exception 'Unsupported expected occurrence status: %.', expected_status
      using errcode = '22023';
  end if;

  if
    planned_status is null
    or planned_status not in ('unresolved', 'completed', 'not_completed')
  then
    raise exception 'Unsupported planned occurrence status: %.', planned_status
      using errcode = '22023';
  end if;

  if
    planned_cancel_pending_reminders is null
    or planned_cancel_pending_reminders is distinct from (
      planned_status <> 'unresolved'
    )
  then
    raise exception 'Reminder-cancellation intent does not match the planned occurrence status.'
      using errcode = '22023';
  end if;

  select occurrence.*
  into current_occurrence
  from public.occurrences as occurrence
  where occurrence.user_id = current_user_id
    and occurrence.id = target_occurrence_id
  for update;

  if not found then
    raise exception 'Occurrence not found.'
      using errcode = 'P0002';
  end if;

  select status_event.*
  into latest_status_event
  from public.occurrence_status_events as status_event
  where status_event.user_id = current_user_id
    and status_event.occurrence_id = current_occurrence.id
  order by
    status_event.recorded_at desc,
    status_event.created_at desc,
    status_event.id desc
  limit 1;

  latest_status_event_id := latest_status_event.id;

  if current_occurrence.status <> expected_status then
    if
      current_occurrence.status = planned_status
      and latest_status_event.id is not null
      and latest_status_event.previous_status = expected_status
      and latest_status_event.status = planned_status
      and latest_status_event.status_semantics = planned_event_semantics
      and latest_status_event.revises_event_id is not distinct from expected_latest_event_id
    then
      return jsonb_build_object(
        'status_changed', false,
        'concurrent_duplicate', true,
        'occurrence', to_jsonb(current_occurrence),
        'status_event', null
      );
    end if;

    raise exception 'Occurrence status changed concurrently. Review the latest status and try again.'
      using errcode = 'P0001';
  end if;

  if latest_status_event_id is distinct from expected_latest_event_id then
    raise exception 'Occurrence status history changed concurrently. Review the latest status and try again.'
      using errcode = 'P0001';
  end if;

  if planned_status = 'unresolved' then
    if planned_completed_at is not null or planned_status_marked_at is not null then
      raise exception 'Unresolved occurrence snapshots cannot keep status timestamps.'
        using errcode = '22023';
    end if;
  elsif planned_status = 'completed' then
    if planned_completed_at is null or planned_status_marked_at is null then
      raise exception 'Completed occurrence snapshots require completion and status-mark timestamps.'
        using errcode = '22023';
    end if;
  elsif planned_completed_at is not null or planned_status_marked_at is null then
    raise exception 'Not Completed occurrence snapshots require only a status-mark timestamp.'
      using errcode = '22023';
  end if;

  status_changed := current_occurrence.status <> planned_status;

  if not status_changed then
    if
      planned_event_semantics is not null
      or planned_event_recorded_at is not null
      or planned_event_effective_at is not null
      or planned_event_source_capture_method is not null
      or planned_event_source_confidence is not null
    then
      raise exception 'An unchanged occurrence status cannot append a status event.'
        using errcode = '22023';
    end if;

    if
      (
        current_occurrence.completed_at is not null
        and current_occurrence.completed_at is distinct from planned_completed_at
      )
      or (
        current_occurrence.status_marked_at is not null
        and current_occurrence.status_marked_at is distinct from planned_status_marked_at
      )
    then
      raise exception 'An unchanged occurrence status cannot rewrite existing status timestamps.'
        using errcode = '22023';
    end if;

    if
      current_occurrence.completed_at is distinct from planned_completed_at
      or current_occurrence.status_marked_at is distinct from planned_status_marked_at
    then
      update public.occurrences as occurrence
      set
        completed_at = coalesce(
          current_occurrence.completed_at,
          planned_completed_at
        ),
        status_marked_at = coalesce(
          current_occurrence.status_marked_at,
          planned_status_marked_at
        )
      where occurrence.user_id = current_user_id
        and occurrence.id = current_occurrence.id
      returning occurrence.* into updated_occurrence;
    else
      updated_occurrence := current_occurrence;
    end if;

    if planned_cancel_pending_reminders then
      update public.reminder_deliveries as reminder_delivery
      set
        status = 'cancelled',
        error = null
      where reminder_delivery.user_id = current_user_id
        and reminder_delivery.occurrence_id = current_occurrence.id
        and reminder_delivery.status = 'pending';
    end if;

    return jsonb_build_object(
      'status_changed', false,
      'concurrent_duplicate', false,
      'occurrence', to_jsonb(updated_occurrence),
      'status_event', null
    );
  end if;

  if
    planned_event_semantics is null
    or planned_event_recorded_at is null
    or planned_event_source_capture_method is null
    or planned_event_source_confidence is null
  then
    raise exception 'A changed occurrence status requires a complete status-event plan.'
      using errcode = '22023';
  end if;

  if planned_event_semantics <> (
    case
      when expected_status = 'unresolved' and expected_latest_event_id is null
        then 'explicit_user_mark'
      else 'explicit_user_correction'
    end
  )
  then
    raise exception 'Status-event semantics do not match the accepted status transition.'
      using errcode = '22023';
  end if;

  if
    planned_event_source_capture_method not in ('manual_tap', 'manual_text')
    or planned_event_source_confidence <> 'high'
  then
    raise exception 'Manual status changes require manual-tap or manual-text, high-confidence provenance.'
      using errcode = '22023';
  end if;

  if planned_status = 'completed' then
    if
      planned_event_recorded_at is distinct from planned_status_marked_at
      or planned_event_effective_at is distinct from planned_completed_at
    then
      raise exception 'Completed status-event timestamps do not match the snapshot plan.'
        using errcode = '22023';
    end if;
  elsif planned_status = 'not_completed' then
    if
      planned_event_recorded_at is distinct from planned_status_marked_at
      or planned_event_effective_at is distinct from planned_status_marked_at
    then
      raise exception 'Not Completed status-event timestamps do not match the snapshot plan.'
        using errcode = '22023';
    end if;
  elsif planned_event_effective_at is not null then
    raise exception 'Unresolved status events cannot have an effective timestamp.'
      using errcode = '22023';
  end if;

  update public.occurrences as occurrence
  set
    status = planned_status,
    completed_at = planned_completed_at,
    status_marked_at = planned_status_marked_at
  where occurrence.user_id = current_user_id
    and occurrence.id = current_occurrence.id
  returning occurrence.* into updated_occurrence;

  insert into public.occurrence_status_events (
    user_id,
    occurrence_id,
    behavior_id,
    previous_status,
    status,
    status_semantics,
    recorded_at,
    effective_at,
    local_date,
    timezone,
    source_capture_method,
    source_confidence,
    revises_event_id,
    reason_code
  )
  select
    current_user_id,
    updated_occurrence.id,
    updated_occurrence.behavior_id,
    expected_status,
    planned_status,
    planned_event_semantics,
    planned_event_recorded_at,
    planned_event_effective_at,
    updated_occurrence.local_date,
    coalesce(behavior.timezone, 'America/New_York'),
    planned_event_source_capture_method,
    planned_event_source_confidence,
    case
      when planned_event_semantics = 'explicit_user_correction'
        then latest_status_event_id
      else null
    end,
    null
  from public.behaviors as behavior
  where behavior.user_id = current_user_id
    and behavior.id = updated_occurrence.behavior_id
  returning * into inserted_status_event;

  if inserted_status_event.id is null then
    raise exception 'Occurrence behavior was not found while recording status history.'
      using errcode = 'P0002';
  end if;

  if planned_cancel_pending_reminders then
    update public.reminder_deliveries as reminder_delivery
    set
      status = 'cancelled',
      error = null
    where reminder_delivery.user_id = current_user_id
      and reminder_delivery.occurrence_id = updated_occurrence.id
      and reminder_delivery.status = 'pending';
  end if;

  if planned_status = 'completed' then
    update public.occurrence_time_sessions as time_session
    set
      stopped_at = greatest(time_session.started_at, planned_status_marked_at)
    where time_session.user_id = current_user_id
      and time_session.occurrence_id = updated_occurrence.id
      and time_session.stopped_at is null;
  end if;

  return jsonb_build_object(
    'status_changed', true,
    'concurrent_duplicate', false,
    'occurrence', to_jsonb(updated_occurrence),
    'status_event', to_jsonb(inserted_status_event)
  );
end;
$$;

comment on function public.apply_occurrence_status_transition(
  uuid,
  text,
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  boolean
) is
  'Atomically applies one resolver-planned manual occurrence status transition, appends its status event, cancels pending reminders when planned, stops any running time session when transitioning to completed, and rejects stale plans with a non-retryable application error.';

commit;
