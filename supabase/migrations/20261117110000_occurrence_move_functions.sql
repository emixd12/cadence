-- Advisor Phase 2A: per-day move and Undo (functions).
--
-- move_occurrence_for_day and revert_occurrence_move are the only writers of
-- occurrence_moves and of an Occurrence's effective time. Every caller uses them: the
-- person's web session, the agents (Daily Brief, chat) and outside MCP clients. Rules
-- live here so every client, including future phone apps, inherits them
-- (docs/DATETIME_STRATEGY.md, "Moves"):
--   - Only today's Unresolved Occurrence of a time-based Behavior moves, and only
--     while its revision (updated_at) is the one the caller read.
--   - The new start stays on the Occurrence's local date in the Behavior's timezone,
--     and is not in the past. A late move may end after midnight.
--   - Undo reverses only the latest move of that Occurrence's day.
--   - The same idempotency key returns the first result and applies nothing;
--     the same key with different input is refused.
--   - A failed check returns a structured refusal (outcome "refused" and a reason),
--     not an error, so callers can explain it and offer alternatives.
-- The caller computes durations and checks the free slot against other Occurrences
-- and the calendar (lib/services/occurrence-move.service.ts); these functions enforce
-- the rules that must hold whoever calls.
begin;

-- Each move gives the Occurrence a new revision, even two moves inside one
-- transaction, so "first to arrive wins" holds for callers that send updated_at back.
-- Runs after set_occurrences_updated_at (triggers fire in name order).
create function cadence_private.stamp_occurrence_move_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('cadence.occurrence_move_write', true), '') = 'on' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end $$;

revoke all on function cadence_private.stamp_occurrence_move_revision() from public, anon, authenticated, service_role;

create trigger stamp_occurrence_move_revision
  before update on public.occurrences
  for each row execute function cadence_private.stamp_occurrence_move_revision();

-- Who is calling: an agent channel, an outside MCP grant, or the person's own session.
create function cadence_private.occurrence_move_caller(p_operation text)
returns table (source text, client_ref uuid, integration boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_oauth_private.current_agent_channel();
  v_grant cadence_oauth_private.grants;
begin
  if auth.uid() is null then
    raise exception 'Occurrence moves require an authenticated user.' using errcode = '42501';
  end if;
  if v_agent is null and auth.jwt() ->> 'cadence_grant_id' is null then
    return query select 'person'::text, null::uuid, false;
    return;
  end if;
  v_grant := cadence_oauth_private.current_integration_grant(true);
  if not ('cadence.occurrences.move' = any(v_grant.scopes)
      or (v_agent is null and 'cadence.occurrences.write' = any(v_grant.scopes))) then
    raise exception 'integration_insufficient_scope' using errcode = '42501';
  end if;
  return query select coalesce(v_agent, 'mcp'), v_grant.client_ref, true;
end $$;

revoke all on function cadence_private.occurrence_move_caller(text) from public, anon, authenticated, service_role;

create function cadence_private.occurrence_move_result(
  p_outcome text, p_reason text, p_occurrence public.occurrences, p_move public.occurrence_moves
) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'outcome', p_outcome,
    'reason', p_reason,
    'occurrence', case when p_occurrence.id is null then null else to_jsonb(p_occurrence) - 'user_id' end,
    'move', case when p_move.id is null then null
      else to_jsonb(p_move) - array['user_id', 'client_ref', 'idempotency_key', 'request_hash'] end,
    'latest_move', (
      select to_jsonb(latest) - array['user_id', 'client_ref', 'idempotency_key', 'request_hash']
      from public.occurrence_moves latest
      where latest.user_id = p_occurrence.user_id and latest.occurrence_id = p_occurrence.id
      order by latest.chain_position desc limit 1
    )
  )
$$;

revoke all on function cadence_private.occurrence_move_result(text, text, public.occurrences, public.occurrence_moves)
  from public, anon, authenticated, service_role;

-- Shared body of move and revert.
create function cadence_private.apply_occurrence_move(
  p_kind text,
  p_occurrence_id uuid,
  p_expected_revision timestamptz,
  p_to_start_at timestamptz,
  p_to_end_at timestamptz,
  p_planned_seconds integer,
  p_duration_source text,
  p_reason text,
  p_proposal_id uuid,
  p_revert_move_id uuid,
  p_idempotency_key text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation text := case p_kind when 'move' then 'move_occurrence_for_day' else 'revert_occurrence_move' end;
  v_caller record;
  v_occurrence public.occurrences;
  v_behavior public.behaviors;
  v_latest public.occurrence_moves;
  v_existing public.occurrence_moves;
  v_inserted public.occurrence_moves;
  v_none public.occurrence_moves;
  v_today date;
  v_from_start timestamptz;
  v_from_end timestamptz;
  v_from_planned boolean;
  v_to_start timestamptz;
  v_to_end timestamptz;
  v_to_planned boolean := false;
  v_duration_source text;
  v_reason text;
  v_id uuid := gen_random_uuid();
begin
  select * into v_caller from cadence_private.occurrence_move_caller(v_operation);

  if p_kind not in ('move', 'revert') or p_occurrence_id is null or p_expected_revision is null
    or (p_idempotency_key is not null and (length(p_idempotency_key) not between 1 and 255
      or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'))
    or (p_kind = 'move' and (p_to_start_at is null or p_to_end_at is null or p_to_end_at < p_to_start_at
      or p_planned_seconds is null or p_planned_seconds not between 0 and 86400
      or p_duration_source is null or p_duration_source not in ('behavior_duration', 'logged_average', 'planned_length', 'kept_length', 'explicit')))
    or (p_reason is not null and p_reason !~ '^[a-z][a-z0-9_]{0,63}$')
  then
    raise exception 'occurrence_move_invalid_input' using errcode = '22023';
  end if;

  -- Same key: return the first result, or refuse a different request.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      v_user_id::text || coalesce(v_caller.client_ref::text, 'person') || p_idempotency_key, 226));
    select * into v_existing from public.occurrence_moves m
      where m.user_id = v_user_id
        and coalesce(m.client_ref, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_caller.client_ref, '00000000-0000-0000-0000-000000000000'::uuid)
        and m.idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      if v_existing.request_hash is distinct from p_request_hash then
        raise exception 'occurrence_move_idempotency_key_reused' using errcode = '22023';
      end if;
      select * into v_occurrence from public.occurrences o where o.user_id = v_user_id and o.id = v_existing.occurrence_id;
      if v_caller.integration then
        perform public.integration_record_activity(v_operation, array[v_existing.occurrence_id], 'success', null);
      end if;
      return cadence_private.occurrence_move_result('replayed', null, v_occurrence, v_existing);
    end if;
  end if;

  select * into v_occurrence from public.occurrences o
    where o.user_id = v_user_id and o.id = p_occurrence_id
    for update;
  if v_occurrence.id is null then
    v_reason := 'occurrence_not_found';
  else
    select * into v_behavior from public.behaviors b where b.user_id = v_user_id and b.id = v_occurrence.behavior_id;
    v_today := (now() at time zone v_behavior.timezone)::date;
    select * into v_latest from public.occurrence_moves m
      where m.user_id = v_user_id and m.occurrence_id = v_occurrence.id
      order by m.chain_position desc limit 1;

    -- Order matters: the person sees the most basic reason first.
    if v_occurrence.status <> 'unresolved' then
      v_reason := 'occurrence_resolved';
    elsif v_occurrence.local_date <> v_today then
      v_reason := 'not_today';
    elsif v_occurrence.updated_at <> p_expected_revision then
      v_reason := 'revision_changed';
    elsif p_kind = 'move' and v_occurrence.schedule_kind <> 'exact' then
      v_reason := 'range_behavior';
    elsif p_kind = 'move' and (p_to_start_at at time zone v_behavior.timezone)::date <> v_occurrence.local_date then
      v_reason := 'start_not_on_day';
    elsif p_kind = 'move' and p_to_start_at < now() - interval '1 minute' then
      v_reason := 'time_passed';
    elsif p_kind = 'move' and p_to_start_at = coalesce(v_occurrence.effective_start_at, v_occurrence.scheduled_for)
      and (v_occurrence.effective_start_at is null or p_to_end_at = v_occurrence.effective_end_at) then
      v_reason := 'no_change';
    elsif p_kind = 'revert' and (v_latest.id is null or v_latest.kind <> 'move'
        or v_latest.timezone <> v_behavior.timezone or v_occurrence.effective_start_at is null) then
      v_reason := 'nothing_to_undo';
    elsif p_kind = 'revert' and p_revert_move_id is not null and p_revert_move_id <> v_latest.id then
      v_reason := 'not_latest_move';
    end if;
  end if;

  if v_reason is not null then
    if v_caller.integration then
      perform public.integration_record_activity(v_operation,
        array_remove(array[v_occurrence.id], null), 'conflict', v_reason);
    end if;
    return cadence_private.occurrence_move_result('refused', v_reason, v_occurrence, v_none);
  end if;

  v_from_planned := v_occurrence.effective_start_at is null;
  v_from_start := coalesce(v_occurrence.effective_start_at, v_occurrence.scheduled_for);
  v_from_end := coalesce(v_occurrence.effective_end_at,
    v_occurrence.scheduled_for + make_interval(secs => coalesce(p_planned_seconds, 0)));

  if p_kind = 'move' then
    v_to_start := p_to_start_at;
    v_to_end := p_to_end_at;
    v_duration_source := p_duration_source;
  else
    -- Undo restores the time before the latest move: its plan, or the earlier move.
    v_to_start := v_latest.from_start_at;
    v_to_end := v_latest.from_end_at;
    v_to_planned := v_latest.from_planned;
    v_duration_source := 'restored';
  end if;

  insert into public.occurrence_moves (
    id, user_id, occurrence_id, behavior_id, local_date, weekday, timezone, kind,
    from_start_at, from_end_at, from_planned, to_start_at, to_end_at, to_planned, duration_source,
    revises_move_id, chain_root_id, chain_position, reason, source, proposal_id,
    client_ref, idempotency_key, request_hash
  ) values (
    v_id, v_user_id, v_occurrence.id, v_occurrence.behavior_id, v_occurrence.local_date,
    extract(isodow from v_occurrence.local_date)::smallint, v_behavior.timezone, p_kind,
    v_from_start, v_from_end, v_from_planned, v_to_start, v_to_end, v_to_planned, v_duration_source,
    v_latest.id, coalesce(v_latest.chain_root_id, v_id), coalesce(v_latest.chain_position, 0) + 1,
    p_reason, v_caller.source, case when p_kind = 'move' then p_proposal_id end,
    v_caller.client_ref, p_idempotency_key, case when p_idempotency_key is null then null else p_request_hash end
  ) returning * into v_inserted;

  perform set_config('cadence.occurrence_move_write', 'on', true);
  update public.occurrences o
  set effective_start_at = case when v_to_planned then null else v_to_start end,
      effective_end_at = case when v_to_planned then null else v_to_end end
  where o.user_id = v_user_id and o.id = v_occurrence.id
  returning * into v_occurrence;
  perform set_config('cadence.occurrence_move_write', '', true);

  -- Proposals: an accepted one records its move; any other open one for this
  -- Occurrence is superseded, since the Occurrence now sits somewhere else.
  if p_kind = 'move' and p_proposal_id is not null then
    update public.move_proposals p
    set status = 'accepted', move_id = v_inserted.id, status_changed_at = now()
    where p.user_id = v_user_id and p.id = p_proposal_id and p.occurrence_id = v_occurrence.id and p.status = 'proposed';
  end if;
  update public.move_proposals p
  set status = 'superseded', status_changed_at = now()
  where p.user_id = v_user_id and p.occurrence_id = v_occurrence.id and p.status = 'proposed';

  -- A conflict notice for this Occurrence is answered by moving it again or undoing.
  update public.move_conflicts c
  set status = case p_kind when 'move' then 'moved' else 'reverted' end, resolved_at = now()
  where c.user_id = v_user_id and c.occurrence_id = v_occurrence.id and c.status = 'open';

  if v_caller.integration then
    perform public.integration_record_activity(v_operation, array[v_occurrence.id], 'success', null);
  end if;
  return cadence_private.occurrence_move_result('applied', null, v_occurrence, v_inserted);
end $$;

revoke all on function cadence_private.apply_occurrence_move(text, uuid, timestamptz, timestamptz, timestamptz, integer, text, text, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create function public.move_occurrence_for_day(
  p_occurrence_id uuid,
  p_expected_revision timestamptz,
  p_to_start_at timestamptz,
  p_to_end_at timestamptz,
  p_planned_seconds integer,
  p_duration_source text,
  p_reason text default null,
  p_proposal_id uuid default null,
  p_idempotency_key text default null,
  p_request_hash text default null
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cadence_private.apply_occurrence_move('move', p_occurrence_id, p_expected_revision, p_to_start_at, p_to_end_at,
    p_planned_seconds, p_duration_source, p_reason, p_proposal_id, null, p_idempotency_key, p_request_hash)
$$;

create function public.revert_occurrence_move(
  p_occurrence_id uuid,
  p_expected_revision timestamptz,
  p_move_id uuid default null,
  p_idempotency_key text default null,
  p_request_hash text default null
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cadence_private.apply_occurrence_move('revert', p_occurrence_id, p_expected_revision, null, null,
    null, null, null, null, p_move_id, p_idempotency_key, p_request_hash)
$$;

-- The wrappers run as their owner and read the caller from auth.uid() and the token.
revoke all on function public.move_occurrence_for_day(uuid, timestamptz, timestamptz, timestamptz, integer, text, text, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.move_occurrence_for_day(uuid, timestamptz, timestamptz, timestamptz, integer, text, text, uuid, text, text)
  to authenticated;
revoke all on function public.revert_occurrence_move(uuid, timestamptz, uuid, text, text) from public, anon, service_role;
grant execute on function public.revert_occurrence_move(uuid, timestamptz, uuid, text, text) to authenticated;

-- Reason chips ------------------------------------------------------------------------
-- The optional one-tap reason after a move. The first tap is kept; a later or
-- repeated tap returns the stored reason and changes nothing.
create function public.record_occurrence_move_reason(p_move_id uuid, p_person_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_stored text;
begin
  if v_user_id is null then
    raise exception 'Move reasons require an authenticated user.' using errcode = '42501';
  end if;
  if p_person_reason is null or p_person_reason not in ('running_late', 'conflict', 'low_energy', 'other') then
    raise exception 'occurrence_move_invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.occurrence_moves m where m.user_id = v_user_id and m.id = p_move_id and m.kind = 'move') then
    raise exception 'Move not found.' using errcode = 'P0002';
  end if;
  insert into public.occurrence_move_reasons (move_id, user_id, person_reason)
  values (p_move_id, v_user_id, p_person_reason)
  on conflict (user_id, move_id) do nothing;
  select r.person_reason into v_stored from public.occurrence_move_reasons r where r.user_id = v_user_id and r.move_id = p_move_id;
  return v_stored;
end $$;

revoke all on function public.record_occurrence_move_reason(uuid, text) from public, anon, service_role;
grant execute on function public.record_occurrence_move_reason(uuid, text) to authenticated;

-- Status beats a pending move -----------------------------------------------------------
-- Once an Occurrence is Completed or Not Completed it is not moved, and any open
-- proposal or conflict notice for it is withdrawn.
create function cadence_private.withdraw_moves_on_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'unresolved' and old.status = 'unresolved' then
    update public.move_proposals p
    set status = 'withdrawn', status_changed_at = now()
    where p.user_id = new.user_id and p.occurrence_id = new.id and p.status = 'proposed';
    update public.move_conflicts c
    set status = 'cleared', resolved_at = now()
    where c.user_id = new.user_id and c.occurrence_id = new.id and c.status = 'open';
  end if;
  return new;
end $$;

revoke all on function cadence_private.withdraw_moves_on_resolve() from public, anon, authenticated, service_role;

create trigger withdraw_moves_on_resolve
  after update of status on public.occurrences
  for each row execute function cadence_private.withdraw_moves_on_resolve();

-- Move conflicts --------------------------------------------------------------------------
-- After a schedule edit, the app finds today's moved Occurrences whose moved time now
-- collides with another Occurrence (packages/core/src/resolvers/move.resolver.ts) and
-- records them here: new collisions open a notice, open notices no longer found are
-- cleared. p_conflicts: [{"occurrence_id": "...", "conflicting_occurrence_id": "..."}].
create function public.sync_move_conflicts(p_local_date date, p_conflicts jsonb)
returns setof public.move_conflicts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Move conflicts require an authenticated user.' using errcode = '42501';
  end if;
  if p_local_date is null or jsonb_typeof(p_conflicts) is distinct from 'array' or jsonb_array_length(p_conflicts) > 200 then
    raise exception 'occurrence_move_invalid_input' using errcode = '22023';
  end if;

  update public.move_conflicts c
  set status = 'cleared', resolved_at = now()
  where c.user_id = v_user_id and c.local_date = p_local_date and c.status = 'open'
    and not exists (
      select 1 from jsonb_array_elements(p_conflicts) item
      where (item ->> 'occurrence_id')::uuid = c.occurrence_id
    );

  insert into public.move_conflicts (user_id, occurrence_id, behavior_id, move_id, local_date, conflicting_occurrence_id)
  select v_user_id, o.id, o.behavior_id, latest.id, o.local_date, (item ->> 'conflicting_occurrence_id')::uuid
  from jsonb_array_elements(p_conflicts) item
  join public.occurrences o on o.user_id = v_user_id and o.id = (item ->> 'occurrence_id')::uuid
  cross join lateral (
    select m.id from public.occurrence_moves m
    where m.user_id = v_user_id and m.occurrence_id = o.id
    order by m.chain_position desc limit 1
  ) latest
  where o.local_date = p_local_date and o.status = 'unresolved' and o.effective_start_at is not null
    -- "Keep it here" answers the notice for this move and this other item.
    and not exists (
      select 1 from public.move_conflicts kept
      where kept.user_id = v_user_id and kept.move_id = latest.id and kept.status = 'kept'
        and kept.conflicting_occurrence_id is not distinct from (item ->> 'conflicting_occurrence_id')::uuid
    )
  on conflict (user_id, occurrence_id) where status = 'open' do nothing;

  return query select * from public.move_conflicts c
    where c.user_id = v_user_id and c.local_date = p_local_date and c.status = 'open'
    order by c.detected_at, c.id;
end $$;

revoke all on function public.sync_move_conflicts(date, jsonb) from public, anon, service_role;
grant execute on function public.sync_move_conflicts(date, jsonb) to authenticated;

-- "Yes, keep it here" on a conflict notice.
create function public.keep_moved_occurrence(p_conflict_id uuid)
returns public.move_conflicts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.move_conflicts;
begin
  update public.move_conflicts c
  set status = 'kept', resolved_at = now()
  where c.user_id = auth.uid() and c.id = p_conflict_id and c.status = 'open'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.move_conflicts c where c.user_id = auth.uid() and c.id = p_conflict_id;
    if v_row.id is null then raise exception 'Move conflict not found.' using errcode = 'P0002'; end if;
  end if;
  return v_row;
end $$;

revoke all on function public.keep_moved_occurrence(uuid) from public, anon, service_role;
grant execute on function public.keep_moved_occurrence(uuid) to authenticated;

commit;
