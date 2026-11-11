-- Ticket 314 (decision D28): connector completion tables and the only write path for
-- connector completions. docs/plans/2026-11-10-connector-completion-architecture.md,
-- section 3, holds the data model, the safety invariants and the matching rules.
--
-- Additive only. Every table holds user_id, has RLS, and cascades on account deletion.
-- No grant to service_role: Ticket 321 adds the job's account selection separately.
-- apply_occurrence_status_transition is unchanged and still rejects `derived`.
--
-- Stored provider data: activity_ref is the contract's opaque account-scoped
-- activity ID, selector_keys are account-scoped SHA-256 digests (D28.3), and
-- account_digest is the connection's existing digest. No title, routine name,
-- credential or raw provider identifier is stored.
begin;

create table public.behavior_source_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  behavior_id uuid not null,
  source text not null check (source in ('hevy')),
  selector_kind text not null check (selector_kind in ('any', 'provider_keys')),
  selector_keys text[] not null default '{}',
  -- Bound by trigger to the source's connected account digest; never client-chosen.
  -- The empty default is replaced by the trigger before the check runs.
  account_digest text not null default '' check (account_digest ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint behavior_source_links_user_id_key unique (user_id, id),
  constraint behavior_source_links_one_per_behavior unique (user_id, behavior_id, source),
  constraint behavior_source_links_behavior_fk foreign key (user_id, behavior_id)
    references public.behaviors(user_id, id) on delete cascade,
  constraint behavior_source_links_selector_shape check (
    (selector_kind = 'any' and cardinality(selector_keys) = 0)
    or (selector_kind = 'provider_keys' and cardinality(selector_keys) between 1 and 32
      and array_to_string(selector_keys, ',') ~ '^[a-f0-9]{64}(,[a-f0-9]{64})*$')
  )
);

-- D28.4: one enabled any-workout link per source.
create unique index behavior_source_links_one_any_per_source
  on public.behavior_source_links (user_id, source)
  where enabled and selector_kind = 'any';

create table public.occurrence_source_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null,
  behavior_id uuid not null,
  link_id uuid,
  source text not null check (source in ('hevy')),
  activity_ref text not null check (activity_ref ~ '^[a-z][a-z0-9_]*/[a-f0-9]{64}$'),
  activity_start_at timestamptz not null,
  activity_end_at timestamptz not null,
  activity_revision timestamptz,
  scheduled_start_at timestamptz not null,
  -- Null for an exact time.
  scheduled_end_at timestamptz,
  role text not null check (role in ('completion', 'attached')),
  state text not null default 'active' check (state in ('active', 'removed')),
  applied_event_id uuid,
  reverted_event_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint occurrence_source_matches_user_id_key unique (user_id, id),
  -- Invariant 2: an activity is matched at most once per Behavior, ever.
  constraint occurrence_source_matches_once_per_behavior unique (user_id, source, activity_ref, behavior_id),
  constraint occurrence_source_matches_occurrence_fk foreign key (user_id, occurrence_id, behavior_id)
    references public.occurrences(user_id, id, behavior_id) on delete cascade,
  constraint occurrence_source_matches_link_fk foreign key (user_id, link_id)
    references public.behavior_source_links(user_id, id) on delete set null (link_id),
  constraint occurrence_source_matches_applied_fk foreign key (user_id, applied_event_id)
    references public.occurrence_status_events(user_id, id) on delete set null (applied_event_id),
  constraint occurrence_source_matches_reverted_fk foreign key (user_id, reverted_event_id)
    references public.occurrence_status_events(user_id, id) on delete set null (reverted_event_id),
  constraint occurrence_source_matches_interval check (activity_end_at > activity_start_at),
  constraint occurrence_source_matches_role_shape check (
    role = 'completion' or (applied_event_id is null and reverted_event_id is null)
  ),
  constraint occurrence_source_matches_revert_shape check (reverted_event_id is null or state = 'removed')
);

-- Invariant 2: one standing connector completion per Occurrence.
create unique index occurrence_source_matches_one_standing_completion
  on public.occurrence_source_matches (user_id, occurrence_id)
  where role = 'completion' and reverted_event_id is null;
create index occurrence_source_matches_occurrence_idx
  on public.occurrence_source_matches (user_id, occurrence_id);

create table public.connector_completion_state (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source text not null check (source in ('hevy')),
  -- The background job's next visit (Ticket 321). Null while nothing is due.
  next_check_at timestamptz,
  -- The last reconcile that read the source successfully.
  last_reconciled_at timestamptz,
  last_attempted_at timestamptz,
  read_cursor text check (read_cursor is null or char_length(read_cursor) <= 256),
  consecutive_failures integer not null default 0 check (consecutive_failures between 0 and 1000),
  -- Background checks counted per local date (invariant 12).
  check_count_date date,
  check_count integer not null default 0 check (check_count between 0 and 1000),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, source)
);

alter table public.behavior_source_links enable row level security;
alter table public.occurrence_source_matches enable row level security;
alter table public.connector_completion_state enable row level security;

revoke all on table public.behavior_source_links from public, anon, authenticated, service_role;
revoke all on table public.occurrence_source_matches from public, anon, authenticated, service_role;
revoke all on table public.connector_completion_state from public, anon, authenticated, service_role;

-- The owner writes links through RLS; the trigger below binds the account digest.
grant select, delete on table public.behavior_source_links to authenticated;
grant insert (behavior_id, source, selector_kind, selector_keys, enabled) on table public.behavior_source_links to authenticated;
grant update (selector_kind, selector_keys, enabled) on table public.behavior_source_links to authenticated;
-- Only the three functions below write matches.
grant select on table public.occurrence_source_matches to authenticated;
grant select on table public.connector_completion_state to authenticated;
grant insert (user_id, source, next_check_at, last_reconciled_at, last_attempted_at, read_cursor, consecutive_failures,
  check_count_date, check_count) on table public.connector_completion_state to authenticated;
grant update (next_check_at, last_reconciled_at, last_attempted_at, read_cursor, consecutive_failures,
  check_count_date, check_count) on table public.connector_completion_state to authenticated;

create policy behavior_source_links_select_own on public.behavior_source_links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy behavior_source_links_insert_own on public.behavior_source_links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy behavior_source_links_update_own on public.behavior_source_links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy behavior_source_links_delete_own on public.behavior_source_links
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy occurrence_source_matches_select_own on public.occurrence_source_matches
  for select to authenticated using ((select auth.uid()) = user_id);
create policy connector_completion_state_select_own on public.connector_completion_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy connector_completion_state_insert_own on public.connector_completion_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy connector_completion_state_update_own on public.connector_completion_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Binds a link to the source's connected account and keeps invariant 11: a selector
-- key belongs to one enabled link per source. Turning a link off needs no connection.
create function cadence_private.behavior_source_link_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  connected_digest text;
begin
  if tg_op = 'UPDATE' and not new.enabled
    and new.selector_kind = old.selector_kind and new.selector_keys = old.selector_keys then
    new.account_digest := old.account_digest;
    new.updated_at := statement_timestamp();
    return new;
  end if;
  select connection.account_digest into connected_digest
  from public.connector_connections connection
  where connection.user_id = new.user_id and connection.provider = new.source
    and connection.status = 'connected';
  if connected_digest is null then
    raise exception 'source_not_connected' using errcode = '22023';
  end if;
  new.account_digest := connected_digest;
  new.selector_keys := array(select distinct key from unnest(new.selector_keys) key order by key);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':source_link:' || new.source, 0)
  );
  if new.enabled and new.selector_kind = 'provider_keys' and exists (
    select 1 from public.behavior_source_links other
    where other.user_id = new.user_id and other.source = new.source and other.enabled
      and other.id <> new.id and other.selector_kind = 'provider_keys'
      and other.selector_keys && new.selector_keys
  ) then
    raise exception 'selector_already_linked' using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := statement_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function cadence_private.behavior_source_link_guard() from public, anon, authenticated, service_role;

create trigger behavior_source_link_guard
  before insert or update on public.behavior_source_links
  for each row execute function cadence_private.behavior_source_link_guard();

-- Shared preconditions for the three writers. Returns null when they hold, or a
-- stable reason. Locks the Occurrence. Runs inside the definer functions only.
create function cadence_private.connector_match_precondition(
  owner_id uuid,
  target_link public.behavior_source_links,
  target_occurrence public.occurrences,
  activity_start timestamptz,
  activity_end timestamptz,
  recorded timestamptz
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  behavior_timezone text;
  behavior_active boolean;
begin
  if target_link.id is null or not target_link.enabled then return 'link_unavailable'; end if;
  if target_occurrence.id is null or target_occurrence.behavior_id <> target_link.behavior_id then
    return 'link_unavailable';
  end if;
  select behavior.timezone, behavior.active and behavior.archived_at is null
  into behavior_timezone, behavior_active
  from public.behaviors behavior
  where behavior.user_id = owner_id and behavior.id = target_link.behavior_id;
  if not coalesce(behavior_active, false) then return 'link_unavailable'; end if;
  if not exists (
    select 1 from public.connector_connections connection
    where connection.user_id = owner_id and connection.provider = target_link.source
      and connection.status = 'connected'
  ) then
    return 'source_not_connected';
  end if;
  if not exists (
    select 1 from public.connector_connections connection
    where connection.user_id = owner_id and connection.provider = target_link.source
      and connection.status = 'connected' and connection.account_digest = target_link.account_digest
  ) then
    return 'account_changed';
  end if;
  if activity_end > recorded then return 'activity_unfinished'; end if;
  if abs(extract(epoch from (activity_start - target_occurrence.scheduled_for))) > 48 * 3600 then
    return 'outside_schedule';
  end if;
  -- D28.6: today and the 30 prior local dates, in the Behavior's timezone.
  if target_occurrence.local_date < ((recorded at time zone coalesce(behavior_timezone, 'America/New_York'))::date - 30) then
    return 'outside_window';
  end if;
  return null;
end;
$$;
revoke all on function cadence_private.connector_match_precondition(uuid, public.behavior_source_links, public.occurrences, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create function cadence_private.connector_caller()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  channel text := coalesce(auth.jwt() ->> 'cadence_channel', '');
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  -- A user session or the connector completion job only; never MCP or another job.
  if channel not in ('', 'connector_completion') then
    raise exception 'This channel cannot write connector completions.' using errcode = '42501';
  end if;
  return owner_id;
end;
$$;
revoke all on function cadence_private.connector_caller() from public, anon, authenticated, service_role;

create function cadence_private.connector_recorded_instant(recorded timestamptz)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- The injected instant must be the present, within five minutes either way.
  if recorded is null or abs(extract(epoch from (recorded - statement_timestamp()))) > 300 then
    raise exception 'The recorded instant must be the current time.' using errcode = '22023';
  end if;
  return recorded;
end;
$$;
revoke all on function cadence_private.connector_recorded_instant(timestamptz) from public, anon, authenticated, service_role;

create function cadence_private.connector_scheduled_end(target_occurrence public.occurrences, behavior_timezone text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when target_occurrence.schedule_kind <> 'range' or target_occurrence.schedule_end_time is null then null
    else ((target_occurrence.local_date + target_occurrence.schedule_end_time) at time zone behavior_timezone)
      + case when target_occurrence.schedule_end_time <= target_occurrence.schedule_start_time
          then interval '1 day' else interval '0' end
  end;
$$;
revoke all on function cadence_private.connector_scheduled_end(public.occurrences, text) from public, anon, authenticated, service_role;

create function cadence_private.connector_latest_event(owner_id uuid, target_occurrence_id uuid)
returns public.occurrence_status_events
language sql
stable
security invoker
set search_path = ''
as $$
  select status_event.*
  from public.occurrence_status_events status_event
  where status_event.user_id = owner_id and status_event.occurrence_id = target_occurrence_id
  order by status_event.recorded_at desc, status_event.created_at desc, status_event.id desc
  limit 1;
$$;
revoke all on function cadence_private.connector_latest_event(uuid, uuid) from public, anon, authenticated, service_role;

-- Unresolved → Completed from one activity (D28.1, D28.7). Writes the Occurrence, one
-- status event with fixed connector provenance, one completion match and the
-- reminder cancellation in one transaction. Callers cannot pass provenance.
create function public.apply_connector_completion(
  p_link_id uuid,
  p_occurrence_id uuid,
  p_activity_ref text,
  p_activity_start_at timestamptz,
  p_activity_end_at timestamptz,
  p_activity_revision timestamptz,
  p_expected_latest_event_id uuid,
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
  link_row public.behavior_source_links;
  occurrence_row public.occurrences;
  latest public.occurrence_status_events;
  behavior_timezone text;
  reason text;
  inserted_event public.occurrence_status_events;
  inserted_match public.occurrence_source_matches;
  cancelled integer;
begin
  if p_activity_ref is null or p_activity_ref !~ '^[a-z][a-z0-9_]*/[a-f0-9]{64}$'
    or p_activity_start_at is null or p_activity_end_at is null or p_activity_end_at <= p_activity_start_at then
    raise exception 'The activity is invalid.' using errcode = '22023';
  end if;
  select * into link_row from public.behavior_source_links link
  where link.user_id = owner_id and link.id = p_link_id;
  select * into occurrence_row from public.occurrences occurrence
  where occurrence.user_id = owner_id and occurrence.id = p_occurrence_id
  for update;
  reason := cadence_private.connector_match_precondition(owner_id, link_row, occurrence_row,
    p_activity_start_at, p_activity_end_at, recorded);
  if reason is not null then return jsonb_build_object('applied', false, 'reason', reason); end if;
  if position(link_row.source || '/' in p_activity_ref) <> 1 then
    raise exception 'The activity does not belong to the link source.' using errcode = '22023';
  end if;
  if occurrence_row.status <> 'unresolved' then
    return jsonb_build_object('applied', false, 'reason', 'not_unresolved');
  end if;
  latest := cadence_private.connector_latest_event(owner_id, occurrence_row.id);
  if latest.id is distinct from p_expected_latest_event_id then
    return jsonb_build_object('applied', false, 'reason', 'history_changed');
  end if;
  if exists (
    select 1 from public.occurrence_source_matches match
    where match.user_id = owner_id and match.source = link_row.source
      and match.activity_ref = p_activity_ref and match.behavior_id = link_row.behavior_id
  ) then
    return jsonb_build_object('applied', false, 'reason', 'already_matched');
  end if;
  if exists (
    select 1 from public.occurrence_source_matches match
    where match.user_id = owner_id and match.occurrence_id = occurrence_row.id
      and match.role = 'completion' and match.reverted_event_id is null
  ) then
    return jsonb_build_object('applied', false, 'reason', 'completion_stands');
  end if;

  select coalesce(behavior.timezone, 'America/New_York') into behavior_timezone
  from public.behaviors behavior where behavior.user_id = owner_id and behavior.id = occurrence_row.behavior_id;

  update public.occurrences occurrence set
    status = 'completed',
    completed_at = p_activity_end_at,
    status_marked_at = recorded
  where occurrence.user_id = owner_id and occurrence.id = occurrence_row.id;

  insert into public.occurrence_status_events (
    user_id, occurrence_id, behavior_id, previous_status, status, status_semantics,
    recorded_at, effective_at, local_date, timezone, source_capture_method,
    source_confidence, revises_event_id, reason_code
  ) values (
    owner_id, occurrence_row.id, occurrence_row.behavior_id, 'unresolved', 'completed', 'system_rule_declared',
    recorded, p_activity_end_at, occurrence_row.local_date, behavior_timezone, 'derived',
    'high', latest.id, 'connector:' || link_row.source
  ) returning * into inserted_event;

  insert into public.occurrence_source_matches (
    user_id, occurrence_id, behavior_id, link_id, source, activity_ref, activity_start_at,
    activity_end_at, activity_revision, scheduled_start_at, scheduled_end_at, role, applied_event_id
  ) values (
    owner_id, occurrence_row.id, occurrence_row.behavior_id, link_row.id, link_row.source, p_activity_ref,
    p_activity_start_at, p_activity_end_at, p_activity_revision, occurrence_row.scheduled_for,
    cadence_private.connector_scheduled_end(occurrence_row, behavior_timezone), 'completion', inserted_event.id
  ) returning * into inserted_match;

  update public.reminder_deliveries reminder set status = 'cancelled', error = null
  where reminder.user_id = owner_id and reminder.occurrence_id = occurrence_row.id and reminder.status = 'pending';
  get diagnostics cancelled = row_count;

  return jsonb_build_object('applied', true, 'reason', 'applied', 'status_event_id', inserted_event.id,
    'match_id', inserted_match.id, 'cancelled_reminders', cancelled);
end;
$$;

-- Further evidence on a Completed Occurrence, or a timing refresh of an existing
-- active match for the same activity, Behavior and Occurrence. Invariant 13: never
-- changes a status, a status timestamp, a status event or a reminder.
create function public.attach_source_activity(
  p_link_id uuid,
  p_occurrence_id uuid,
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
  link_row public.behavior_source_links;
  occurrence_row public.occurrences;
  existing public.occurrence_source_matches;
  behavior_timezone text;
  reason text;
  inserted_match public.occurrence_source_matches;
begin
  if p_activity_ref is null or p_activity_ref !~ '^[a-z][a-z0-9_]*/[a-f0-9]{64}$'
    or p_activity_start_at is null or p_activity_end_at is null or p_activity_end_at <= p_activity_start_at then
    raise exception 'The activity is invalid.' using errcode = '22023';
  end if;
  select * into link_row from public.behavior_source_links link
  where link.user_id = owner_id and link.id = p_link_id;
  select * into occurrence_row from public.occurrences occurrence
  where occurrence.user_id = owner_id and occurrence.id = p_occurrence_id
  for update;
  reason := cadence_private.connector_match_precondition(owner_id, link_row, occurrence_row,
    p_activity_start_at, p_activity_end_at, recorded);
  if reason is not null then return jsonb_build_object('attached', false, 'reason', reason); end if;
  if position(link_row.source || '/' in p_activity_ref) <> 1 then
    raise exception 'The activity does not belong to the link source.' using errcode = '22023';
  end if;
  if occurrence_row.status <> 'completed' then
    return jsonb_build_object('attached', false, 'reason', 'not_completed');
  end if;
  select * into existing from public.occurrence_source_matches match
  where match.user_id = owner_id and match.source = link_row.source
    and match.activity_ref = p_activity_ref and match.behavior_id = link_row.behavior_id
  for update;
  if existing.id is not null then
    if existing.state <> 'active' or existing.occurrence_id <> occurrence_row.id then
      return jsonb_build_object('attached', false, 'reason', 'already_matched');
    end if;
    if p_activity_revision is null or (existing.activity_revision is not null and p_activity_revision <= existing.activity_revision) then
      return jsonb_build_object('attached', false, 'reason', 'revision_not_newer');
    end if;
    update public.occurrence_source_matches match set
      activity_start_at = p_activity_start_at,
      activity_end_at = p_activity_end_at,
      activity_revision = p_activity_revision,
      updated_at = statement_timestamp()
    where match.user_id = owner_id and match.id = existing.id;
    return jsonb_build_object('attached', true, 'reason', 'timing_refreshed', 'match_id', existing.id);
  end if;

  select coalesce(behavior.timezone, 'America/New_York') into behavior_timezone
  from public.behaviors behavior where behavior.user_id = owner_id and behavior.id = occurrence_row.behavior_id;
  insert into public.occurrence_source_matches (
    user_id, occurrence_id, behavior_id, link_id, source, activity_ref, activity_start_at,
    activity_end_at, activity_revision, scheduled_start_at, scheduled_end_at, role
  ) values (
    owner_id, occurrence_row.id, occurrence_row.behavior_id, link_row.id, link_row.source, p_activity_ref,
    p_activity_start_at, p_activity_end_at, p_activity_revision, occurrence_row.scheduled_for,
    cadence_private.connector_scheduled_end(occurrence_row, behavior_timezone), 'attached'
  ) returning * into inserted_match;
  return jsonb_build_object('attached', true, 'reason', 'attached', 'match_id', inserted_match.id);
end;
$$;

-- Marks one match removed. Invariant 4: reverts to Unresolved only when the
-- Occurrence has no active match left, a connector completion stands on it, it is
-- still Completed, and the completion's event is still its latest status event.
create function public.remove_source_match(
  p_match_id uuid,
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
  match_row public.occurrence_source_matches;
  link_row public.behavior_source_links;
  occurrence_row public.occurrences;
  standing public.occurrence_source_matches;
  latest public.occurrence_status_events;
  behavior_timezone text;
  reason text;
  inserted_event public.occurrence_status_events;
begin
  select * into match_row from public.occurrence_source_matches match
  where match.user_id = owner_id and match.id = p_match_id;
  if match_row.id is null then return jsonb_build_object('removed', false, 'reason', 'match_unavailable'); end if;
  select * into occurrence_row from public.occurrences occurrence
  where occurrence.user_id = owner_id and occurrence.id = match_row.occurrence_id
  for update;
  select * into match_row from public.occurrence_source_matches match
  where match.user_id = owner_id and match.id = p_match_id
  for update;
  if match_row.state <> 'active' then return jsonb_build_object('removed', false, 'reason', 'already_removed'); end if;
  select * into link_row from public.behavior_source_links link
  where link.user_id = owner_id and link.id = match_row.link_id;
  reason := cadence_private.connector_match_precondition(owner_id, link_row, occurrence_row,
    match_row.activity_start_at, match_row.activity_end_at, recorded);
  if reason is not null then return jsonb_build_object('removed', false, 'reason', reason); end if;

  update public.occurrence_source_matches match set state = 'removed', updated_at = statement_timestamp()
  where match.user_id = owner_id and match.id = match_row.id;

  if exists (
    select 1 from public.occurrence_source_matches match
    where match.user_id = owner_id and match.occurrence_id = occurrence_row.id and match.state = 'active'
  ) then
    return jsonb_build_object('removed', true, 'reverted', false, 'reason', 'other_match_active');
  end if;
  select * into standing from public.occurrence_source_matches match
  where match.user_id = owner_id and match.occurrence_id = occurrence_row.id
    and match.role = 'completion' and match.reverted_event_id is null
  for update;
  latest := cadence_private.connector_latest_event(owner_id, occurrence_row.id);
  if standing.id is null or standing.applied_event_id is null or occurrence_row.status <> 'completed'
    or latest.id is distinct from standing.applied_event_id then
    return jsonb_build_object('removed', true, 'reverted', false, 'reason', 'status_kept');
  end if;

  select coalesce(behavior.timezone, 'America/New_York') into behavior_timezone
  from public.behaviors behavior where behavior.user_id = owner_id and behavior.id = occurrence_row.behavior_id;
  update public.occurrences occurrence set status = 'unresolved', completed_at = null, status_marked_at = null
  where occurrence.user_id = owner_id and occurrence.id = occurrence_row.id;
  insert into public.occurrence_status_events (
    user_id, occurrence_id, behavior_id, previous_status, status, status_semantics,
    recorded_at, effective_at, local_date, timezone, source_capture_method,
    source_confidence, revises_event_id, reason_code
  ) values (
    owner_id, occurrence_row.id, occurrence_row.behavior_id, 'completed', 'unresolved', 'system_rule_declared',
    recorded, null, occurrence_row.local_date, behavior_timezone, 'derived',
    'high', latest.id, 'connector:' || match_row.source
  ) returning * into inserted_event;
  update public.occurrence_source_matches match set reverted_event_id = inserted_event.id, updated_at = statement_timestamp()
  where match.user_id = owner_id and match.id = standing.id;
  return jsonb_build_object('removed', true, 'reverted', true, 'reason', 'reverted', 'status_event_id', inserted_event.id);
end;
$$;

revoke all on function public.apply_connector_completion(uuid, uuid, text, timestamptz, timestamptz, timestamptz, uuid, timestamptz)
  from public, anon, service_role;
revoke all on function public.attach_source_activity(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz)
  from public, anon, service_role;
revoke all on function public.remove_source_match(uuid, timestamptz) from public, anon, service_role;
grant execute on function public.apply_connector_completion(uuid, uuid, text, timestamptz, timestamptz, timestamptz, uuid, timestamptz)
  to authenticated;
grant execute on function public.attach_source_activity(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.remove_source_match(uuid, timestamptz) to authenticated;

commit;
