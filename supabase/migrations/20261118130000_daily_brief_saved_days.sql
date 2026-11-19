-- Advisor plan, Phase 3A2: the saved brief, per-account counting and Refresh.
--
-- 1. daily_brief_days: one row per account and local day. It holds the brief that
--    was shown (opening, travel inputs and versions; move lines live in
--    move_proposals and are rebuilt from there) and how many refreshes were used.
--    Saving is required: a brief that cannot be saved is not shown. Reopening on
--    any device returns this row with no model call. The text is kept only until
--    the end of its local day (it may be derived from calendar or travel facts);
--    the counts stay for analytics.
-- 2. begin_daily_brief gains p_refresh and p_moves. Briefs are counted per account
--    per day: one morning brief plus up to two refreshes (Emi, Nov 18). A failed
--    attempt that showed nothing is not a refresh. A client that wants move lines
--    gets a new brief when the saved one was built without them (an installed app
--    from before Phase 3 opened first); that is not counted as a refresh.
-- 3. save_daily_brief: stores the shown brief and completes the attempt's lease in
--    one transaction, replacing finish_daily_brief(true) on the hosted path.
-- 4. agent_brief_refresh_funded: a refresh is allowed only while the rest of the
--    month's morning briefs stay funded from the Daily Brief share.
-- 5. agent_runs.trigger gains 'refresh'.
begin;

-- 5. agent_runs trigger ----------------------------------------------------------------
alter table cadence_advisor_private.agent_runs drop constraint agent_runs_trigger_check;
alter table cadence_advisor_private.agent_runs add constraint agent_runs_trigger_check
  check (trigger in ('on_demand', 'retry', 'refresh', 'scheduled', 'chat_turn'));

-- 1. daily_brief_days ------------------------------------------------------------------
create table cadence_advisor_private.daily_brief_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  timezone text not null,
  -- The agent run of the shown brief. Null only if the run log was unavailable.
  run_id uuid references cadence_advisor_private.agent_runs(id) on delete set null,
  -- The shown brief without its move lines. Null once its local day has ended.
  briefing jsonb check (briefing is null or (jsonb_typeof(briefing) = 'object' and octet_length(briefing::text) <= 65536)),
  -- Whether the shown brief offered move lines (a client that opted in to move_lines_v1).
  with_moves boolean not null default false,
  refreshes_used smallint not null default 0 check (refreshes_used between 0 and 2),
  -- Briefs shown today: the morning brief, each refresh, and an upgrade for move lines.
  briefs_shown smallint not null default 1 check (briefs_shown between 1 and 10),
  first_saved_at timestamptz not null default statement_timestamp(),
  saved_at timestamptz not null default statement_timestamp(),
  primary key (user_id, local_date)
);
create index daily_brief_days_saved_idx on cadence_advisor_private.daily_brief_days (local_date) where briefing is not null;

alter table cadence_advisor_private.daily_brief_days enable row level security;
alter table cadence_advisor_private.daily_brief_days force row level security;
create policy daily_brief_days_owner_only
  on cadence_advisor_private.daily_brief_days
  as restrictive for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on table cadence_advisor_private.daily_brief_days from public, anon, authenticated, service_role;

-- 2. begin_daily_brief -----------------------------------------------------------------
create function cadence_advisor_private.begin_daily_brief(
  p_installation_id uuid,
  p_retry boolean,
  p_expected_revision bigint,
  p_refresh boolean,
  p_moves boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  observed_at timestamptz;
  preference cadence_advisor_private.daily_brief_preferences%rowtype;
  existing cadence_advisor_private.daily_brief_runs%rowtype;
  saved cadence_advisor_private.daily_brief_days%rowtype;
  active_until timestamptz;
  owner_timezone text;
  owner_local_date date;
  recent_starts timestamptz[] := '{}';
  lease uuid;
  row_count integer;
  same_attempt_day boolean;
  refreshing boolean := coalesce(p_refresh, false);
begin
  if p_installation_id is null or p_retry is null or p_refresh is null or p_moves is null
    or p_expected_revision is null or p_expected_revision not between 0 and 2147483647
  then
    raise exception 'Daily Brief request is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':daily-brief', 0)
  );
  observed_at := pg_catalog.clock_timestamp();

  select * into preference
  from cadence_advisor_private.daily_brief_preferences
  where user_id = actor_id
  for update;

  if preference.user_id is null or not preference.enabled
    or preference.revision <> p_expected_revision
  then
    raise exception 'Daily Brief preferences changed or are disabled.' using errcode = '55000';
  end if;

  if not cadence_advisor_private.daily_brief_calendar_fence_is_current(
    actor_id,
    preference.include_calendar,
    preference.calendar_connection_generation,
    preference.calendar_selection_revision
  ) then
    raise exception 'Daily Brief Calendar disclosure changed.' using errcode = '55000';
  end if;

  select coalesce(profile.timezone, 'America/New_York') into owner_timezone
  from public.profiles as profile
  where profile.id = actor_id;
  owner_timezone := coalesce(owner_timezone, 'America/New_York');
  owner_local_date := (observed_at at time zone owner_timezone)::date;

  -- Phase 3: the saved brief answers every later open of the day, on any device.
  select * into saved
  from cadence_advisor_private.daily_brief_days as day
  where day.user_id = actor_id
    and day.local_date = owner_local_date
    and day.timezone = owner_timezone;

  if saved.briefing is null then
    -- Nothing was shown today, so a refresh is the morning brief.
    refreshing := false;
  elsif refreshing then
    if saved.refreshes_used >= 2 then
      return jsonb_build_object('state', 'refresh_limit_reached', 'refreshes_used', saved.refreshes_used);
    end if;
  elsif not p_moves or saved.with_moves then
    return jsonb_build_object(
      'state', 'saved',
      'briefing', saved.briefing,
      'run_id', saved.run_id,
      'with_moves', saved.with_moves,
      'refreshes_used', saved.refreshes_used,
      'local_date', owner_local_date
    );
  end if;
  -- Otherwise a client that wants move lines found a brief built without them: a new
  -- morning brief replaces it and is not counted as a refresh.

  select * into existing
  from cadence_advisor_private.daily_brief_runs as run
  where run.user_id = actor_id
    and run.installation_id = p_installation_id
  for update;

  same_attempt_day := existing.user_id is not null
    and existing.local_date = owner_local_date
    and existing.preference_revision = preference.revision;

  if same_attempt_day then
    if existing.status = 'pending' and existing.lease_expires_at > observed_at then
      return jsonb_build_object(
        'state', 'pending',
        'retry_after_seconds', greatest(1, ceil(extract(epoch from existing.lease_expires_at - observed_at))::integer)
      );
    end if;
    -- A refresh or a move-line upgrade after a completed attempt is a new attempt.
    if existing.status = 'completed' and (refreshing or saved.briefing is not null) then
      same_attempt_day := false;
    elsif not p_retry and not refreshing then
      return jsonb_build_object('state', 'already_attempted');
    elsif existing.admissions >= 4 then
      -- A deliberate retry may replace a failed or abandoned attempt, within a daily bound.
      return jsonb_build_object('state', 'retry_exhausted');
    end if;
  end if;

  select max(run.lease_expires_at) into active_until
  from cadence_advisor_private.daily_brief_runs as run
  where run.user_id = actor_id
    and run.status = 'pending'
    and run.lease_expires_at > observed_at;
  if active_until is not null then
    return jsonb_build_object(
      'state', 'pending',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from active_until - observed_at))::integer)
    );
  end if;

  select coalesce(array_agg(started_at order by started_at), '{}') into recent_starts
  from cadence_advisor_private.daily_brief_rate_limits as admission
  cross join lateral unnest(admission.generation_starts) as start_entry(started_at)
  where admission.user_id = actor_id
    and started_at > observed_at - interval '60 seconds';

  if cardinality(recent_starts) >= 6 then
    return jsonb_build_object(
      'state', 'rate_limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from recent_starts[1] + interval '60 seconds' - observed_at))::integer)
    );
  end if;

  if existing.user_id is null then
    select count(*) into row_count
    from cadence_advisor_private.daily_brief_runs
    where user_id = actor_id;

    if row_count >= 8 then
      delete from cadence_advisor_private.daily_brief_runs as run
      where run.user_id = actor_id
        and run.installation_id = (
          select candidate.installation_id
          from cadence_advisor_private.daily_brief_runs as candidate
          where candidate.user_id = actor_id
            and (candidate.status <> 'pending' or candidate.lease_expires_at <= observed_at)
          order by coalesce(candidate.finished_at, candidate.lease_expires_at, candidate.started_at), candidate.installation_id
          limit 1
        );
    end if;
  end if;

  lease := gen_random_uuid();
  insert into cadence_advisor_private.daily_brief_runs as run (
    user_id, installation_id, local_date, timezone, preference_revision, status,
    lease_token, started_at, lease_expires_at, finished_at, admissions
  ) values (
    actor_id, p_installation_id, owner_local_date, owner_timezone, preference.revision, 'pending',
    lease, observed_at, observed_at + interval '75 seconds', null,
    case when same_attempt_day then existing.admissions + 1 else 1 end
  )
  on conflict (user_id, installation_id) do update set
    local_date = excluded.local_date,
    timezone = excluded.timezone,
    preference_revision = excluded.preference_revision,
    status = excluded.status,
    lease_token = excluded.lease_token,
    started_at = excluded.started_at,
    lease_expires_at = excluded.lease_expires_at,
    finished_at = null,
    admissions = excluded.admissions;

  recent_starts := array_append(recent_starts, observed_at);
  insert into cadence_advisor_private.daily_brief_rate_limits as admission (user_id, generation_starts, updated_at)
  values (actor_id, recent_starts, observed_at)
  on conflict (user_id) do update set
    generation_starts = excluded.generation_starts,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'state', 'acquired',
    'lease_token', lease,
    'local_date', owner_local_date,
    'refresh', refreshing,
    'refreshes_used', coalesce(saved.refreshes_used, 0)
  );
end;
$$;

-- The three-argument form stays for callers built before Phase 3 (the device path).
create or replace function cadence_advisor_private.begin_daily_brief(
  p_installation_id uuid,
  p_retry boolean,
  p_expected_revision bigint
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cadence_advisor_private.begin_daily_brief(p_installation_id, p_retry, p_expected_revision, false, false);
$$;

create function public.begin_daily_brief(
  p_installation_id uuid,
  p_retry boolean,
  p_expected_revision bigint,
  p_refresh boolean,
  p_moves boolean
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.begin_daily_brief(p_installation_id, p_retry, p_expected_revision, p_refresh, p_moves);
$$;

-- 3. save_daily_brief ------------------------------------------------------------------
create function cadence_advisor_private.save_daily_brief(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_run_id uuid,
  p_refresh boolean,
  p_with_moves boolean,
  p_briefing jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  observed_at timestamptz;
  preference cadence_advisor_private.daily_brief_preferences%rowtype;
  attempt cadence_advisor_private.daily_brief_runs%rowtype;
  saved cadence_advisor_private.daily_brief_days%rowtype;
begin
  if p_installation_id is null or p_lease_token is null or p_refresh is null or p_with_moves is null
    or p_briefing is null or jsonb_typeof(p_briefing) <> 'object'
    or p_expected_revision is null or p_expected_revision not between 0 and 2147483647
  then
    raise exception 'Daily Brief save is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':daily-brief', 0)
  );
  observed_at := pg_catalog.clock_timestamp();

  select * into preference
  from cadence_advisor_private.daily_brief_preferences
  where user_id = actor_id;
  if preference.user_id is null or not preference.enabled or preference.revision <> p_expected_revision then
    return false;
  end if;

  select * into attempt
  from cadence_advisor_private.daily_brief_runs as run
  where run.user_id = actor_id
    and run.installation_id = p_installation_id
    and run.lease_token = p_lease_token
    and run.status = 'pending'
    and run.lease_expires_at >= observed_at
    and run.preference_revision = p_expected_revision
  for update;
  if attempt.user_id is null
    or attempt.local_date <> (observed_at at time zone attempt.timezone)::date
  then
    return false;
  end if;

  if p_run_id is not null and not exists (
    select 1 from cadence_advisor_private.agent_runs as run
    where run.id = p_run_id and run.user_id = actor_id and run.agent = 'daily_brief'
  ) then
    raise exception 'Daily Brief run is unknown.' using errcode = '22023';
  end if;

  select * into saved
  from cadence_advisor_private.daily_brief_days as day
  where day.user_id = actor_id and day.local_date = attempt.local_date
  for update;

  if p_refresh then
    if saved.briefing is null or saved.timezone <> attempt.timezone or saved.refreshes_used >= 2 then
      return false;
    end if;
    update cadence_advisor_private.daily_brief_days as day
    set run_id = p_run_id, briefing = p_briefing, with_moves = p_with_moves,
      refreshes_used = day.refreshes_used + 1, briefs_shown = least(day.briefs_shown + 1, 10), saved_at = observed_at
    where day.user_id = actor_id and day.local_date = attempt.local_date;
  else
    insert into cadence_advisor_private.daily_brief_days as day (
      user_id, local_date, timezone, run_id, briefing, with_moves, refreshes_used, briefs_shown, first_saved_at, saved_at
    ) values (
      actor_id, attempt.local_date, attempt.timezone, p_run_id, p_briefing, p_with_moves, 0, 1, observed_at, observed_at
    )
    on conflict (user_id, local_date) do update set
      -- A timezone change starts the day's count again; a move-line upgrade keeps it.
      timezone = excluded.timezone,
      run_id = excluded.run_id,
      briefing = excluded.briefing,
      with_moves = excluded.with_moves,
      refreshes_used = case when day.timezone = excluded.timezone then day.refreshes_used else 0 end,
      briefs_shown = least(day.briefs_shown + 1, 10),
      saved_at = excluded.saved_at;
  end if;

  update cadence_advisor_private.daily_brief_runs as run
  set status = 'completed', lease_expires_at = null, finished_at = observed_at
  where run.user_id = actor_id
    and run.installation_id = p_installation_id
    and run.lease_token = p_lease_token;

  return true;
end;
$$;

create function public.save_daily_brief(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_run_id uuid,
  p_refresh boolean,
  p_with_moves boolean,
  p_briefing jsonb
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief(
    p_installation_id, p_lease_token, p_expected_revision, p_run_id, p_refresh, p_with_moves, p_briefing
  );
$$;

-- 4. agent_brief_refresh_funded --------------------------------------------------------
-- Funded when what the Daily Brief already spent this local month, plus this refresh,
-- plus one morning brief for every remaining day of the month, fits the Daily Brief
-- share. A morning brief is priced at this month's average brief cost, or at the
-- caller's estimate when that is higher or there is no history yet.
create function public.agent_brief_refresh_funded(p_brief_microdollars integer)
returns table (funded boolean, needed_microdollars bigint, remaining_microdollars bigint, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := statement_timestamp();
  v_timezone text;
  v_today date;
  v_month date;
  v_days_left integer;
  v_share bigint;
  v_used bigint;
  v_average bigint;
  v_brief bigint;
  v_needed bigint;
begin
  if v_agent <> 'daily_brief' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_brief_microdollars is null or p_brief_microdollars < 1 or p_brief_microdollars > 1000000 then
    raise exception 'agent_spend_out_of_range' using errcode = '22023';
  end if;
  select profile.timezone into v_timezone from public.profiles as profile where profile.id = v_user_id;
  if v_timezone is null then
    raise exception 'agent_profile_required' using errcode = '22023';
  end if;
  v_today := (v_now at time zone v_timezone)::date;
  v_month := date_trunc('month', v_today)::date;
  v_days_left := ((v_month + interval '1 month')::date - v_today) - 1;

  select coalesce(o.monthly_microdollars, s.monthly_microdollars) into v_share
  from cadence_advisor_private.agent_budget_shares as s
  left join cadence_advisor_private.agent_budget_account_overrides as o
    on o.user_id = v_user_id and o.agent = s.agent
  where s.agent = 'daily_brief';

  select coalesce(sum(coalesce(r.actual_microdollars, r.estimated_microdollars)), 0) into v_used
  from cadence_advisor_private.agent_spend_reservations as r
  where r.user_id = v_user_id and r.agent = 'daily_brief' and r.local_month = v_month;

  select avg(run.cost_microdollars)::bigint into v_average
  from cadence_advisor_private.agent_runs as run
  where run.user_id = v_user_id and run.agent = 'daily_brief' and run.outcome = 'success'
    and run.model_calls > 0 and run.local_date >= v_month;

  v_brief := greatest(coalesce(v_average, 0), p_brief_microdollars);
  v_needed := v_brief * (v_days_left + 1);
  return query select v_used + v_needed <= coalesce(v_share, 0), v_needed, greatest(coalesce(v_share, 0) - v_used, 0),
    ((v_month + interval '1 month')::timestamp at time zone v_timezone);
end;
$$;

-- 1. Day-end purge of saved text -------------------------------------------------------
-- Run beside purge_expired_agent_run_contents by the daily maintenance cron.
create function public.purge_ended_daily_brief_days()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update cadence_advisor_private.daily_brief_days as day
  set briefing = null
  where day.briefing is not null
    and ((day.local_date + 1)::timestamp at time zone day.timezone) <= statement_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function cadence_advisor_private.begin_daily_brief(uuid, boolean, bigint, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.begin_daily_brief(uuid, boolean, bigint, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function cadence_advisor_private.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.agent_brief_refresh_funded(integer) from public, anon, service_role;
revoke all on function public.purge_ended_daily_brief_days() from public, anon, authenticated;
grant execute on function cadence_advisor_private.begin_daily_brief(uuid, boolean, bigint, boolean, boolean) to authenticated;
grant execute on function public.begin_daily_brief(uuid, boolean, bigint, boolean, boolean) to authenticated;
grant execute on function cadence_advisor_private.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb) to authenticated;
grant execute on function public.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb) to authenticated;
grant execute on function public.agent_brief_refresh_funded(integer) to authenticated;
grant execute on function public.purge_ended_daily_brief_days() to service_role;

comment on table cadence_advisor_private.daily_brief_days is
  'Advisor Phase 3: the brief shown today per account (text kept until the end of its local day) and its morning/refresh counts.';
comment on function public.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb) is
  'Stores the shown Daily Brief and completes the attempt in one transaction. Required before the brief is returned.';
comment on function public.agent_brief_refresh_funded(integer) is
  'Daily Brief agent only: whether a refresh leaves the rest of the month''s morning briefs funded from the Daily Brief share.';

commit;
