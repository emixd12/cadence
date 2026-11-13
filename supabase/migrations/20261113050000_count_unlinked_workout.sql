-- Ticket 324: count an unlinked workout by hand. The user marks the Occurrence Completed
-- through the manual status path first; this function then attaches the workout for
-- timing. A match with no link is the user's own record: it never changes a status, and
-- reconcile never removes or refreshes it (no link fences it). User sessions only: never
-- the connector completion job, MCP or another channel.
create function public.attach_unlinked_source_activity(
  p_occurrence_id uuid,
  p_source text,
  p_activity_ref text,
  p_activity_start_at timestamptz,
  p_activity_end_at timestamptz,
  p_activity_revision timestamptz,
  p_recorded_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := cadence_private.connector_caller();
  recorded timestamptz := cadence_private.connector_recorded_instant(p_recorded_at);
  occurrence_row public.occurrences;
  latest public.occurrence_status_events;
  behavior_timezone text;
  behavior_active boolean;
  inserted_match public.occurrence_source_matches;
begin
  if coalesce(auth.jwt() ->> 'cadence_channel', '') <> '' then
    raise exception 'Only the user can count a workout by hand.' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('hevy')
    or p_activity_ref is null or p_activity_ref !~ '^[a-z][a-z0-9_]*/[a-f0-9]{64}$'
    or position(p_source || '/' in p_activity_ref) <> 1
    or p_activity_start_at is null or p_activity_end_at is null or p_activity_end_at <= p_activity_start_at then
    raise exception 'The activity is invalid.' using errcode = '22023';
  end if;
  select * into occurrence_row from public.occurrences occurrence
  where occurrence.user_id = owner_id and occurrence.id = p_occurrence_id
  for update;
  if occurrence_row.id is null then
    return jsonb_build_object('attached', false, 'reason', 'occurrence_unavailable');
  end if;
  select coalesce(behavior.timezone, 'America/New_York'), behavior.active and behavior.archived_at is null
  into behavior_timezone, behavior_active
  from public.behaviors behavior
  where behavior.user_id = owner_id and behavior.id = occurrence_row.behavior_id;
  if not coalesce(behavior_active, false) then
    return jsonb_build_object('attached', false, 'reason', 'occurrence_unavailable');
  end if;
  -- A linked Behavior gets its workouts from reconcile, never by hand.
  if exists (
    select 1 from public.behavior_source_links link
    where link.user_id = owner_id and link.behavior_id = occurrence_row.behavior_id
      and link.source = p_source and link.enabled
  ) then
    return jsonb_build_object('attached', false, 'reason', 'linked');
  end if;
  if not exists (
    select 1 from public.connector_connections connection
    where connection.user_id = owner_id and connection.provider = p_source and connection.status = 'connected'
  ) then
    return jsonb_build_object('attached', false, 'reason', 'source_not_connected');
  end if;
  if p_activity_end_at > recorded then
    return jsonb_build_object('attached', false, 'reason', 'activity_unfinished');
  end if;
  -- The workout's own local day, in the Behavior's timezone (D28.7).
  if (p_activity_start_at at time zone behavior_timezone)::date <> occurrence_row.local_date then
    return jsonb_build_object('attached', false, 'reason', 'outside_day');
  end if;
  if occurrence_row.local_date < ((recorded at time zone behavior_timezone)::date - 30) then
    return jsonb_build_object('attached', false, 'reason', 'outside_window');
  end if;
  -- The user's own Completed mark must stand: never a connector's, never another status.
  latest := cadence_private.connector_latest_event(owner_id, occurrence_row.id);
  if occurrence_row.status <> 'completed' or latest.id is null
    or latest.source_capture_method not in ('manual_tap', 'manual_text') then
    return jsonb_build_object('attached', false, 'reason', 'not_completed');
  end if;
  -- Invariant 2: an activity is matched at most once per Behavior, ever.
  if exists (
    select 1 from public.occurrence_source_matches match
    where match.user_id = owner_id and match.source = p_source
      and match.activity_ref = p_activity_ref and match.behavior_id = occurrence_row.behavior_id
  ) then
    return jsonb_build_object('attached', false, 'reason', 'already_matched');
  end if;

  insert into public.occurrence_source_matches (
    user_id, occurrence_id, behavior_id, link_id, source, activity_ref, activity_start_at,
    activity_end_at, activity_revision, scheduled_start_at, scheduled_end_at, role
  ) values (
    owner_id, occurrence_row.id, occurrence_row.behavior_id, null, p_source, p_activity_ref,
    p_activity_start_at, p_activity_end_at, p_activity_revision, occurrence_row.scheduled_for,
    cadence_private.connector_scheduled_end(occurrence_row, behavior_timezone), 'attached'
  ) returning * into inserted_match;
  return jsonb_build_object('attached', true, 'reason', 'attached', 'match_id', inserted_match.id);
end;
$$;

revoke all on function public.attach_unlinked_source_activity(uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz)
  from public, anon, service_role;
grant execute on function public.attach_unlinked_source_activity(uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated;
