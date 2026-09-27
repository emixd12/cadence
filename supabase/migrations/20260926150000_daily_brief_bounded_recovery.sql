begin;

-- Ticket 168: a completed server attempt is not proof that the user saw the
-- Daily Brief. Count admissions per owner installation, local date and
-- disclosure revision so deliberate retries can recover undelivered results
-- without clearing quota or admission records. One automatic start plus three
-- deliberate retries are allowed; the six-starts-per-minute account limit and
-- one-active-generation rule still apply first. No prompt or generated content
-- is stored.

alter table cadence_advisor_private.daily_brief_runs
  add column admissions smallint not null default 1
    check (admissions between 1 and 4);

create or replace function cadence_advisor_private.begin_daily_brief(
  p_installation_id uuid,
  p_retry boolean,
  p_expected_revision bigint
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
  active_until timestamptz;
  owner_timezone text;
  owner_local_date date;
  recent_starts timestamptz[] := '{}';
  lease uuid;
  row_count integer;
  same_attempt_day boolean;
begin
  if p_installation_id is null or p_retry is null
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
    raise exception 'Daily Brief preferences changed or are disabled.' using errcode = '40001';
  end if;

  if not cadence_advisor_private.daily_brief_calendar_fence_is_current(
    actor_id,
    preference.include_calendar,
    preference.calendar_connection_generation,
    preference.calendar_selection_revision
  ) then
    raise exception 'Daily Brief Calendar disclosure changed.' using errcode = '40001';
  end if;

  select coalesce(profile.timezone, 'America/New_York') into owner_timezone
  from public.profiles as profile
  where profile.id = actor_id;
  owner_timezone := coalesce(owner_timezone, 'America/New_York');
  owner_local_date := (observed_at at time zone owner_timezone)::date;

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
    if not p_retry then
      return jsonb_build_object('state', 'already_attempted');
    end if;
    -- Server completion does not prove presentation. A deliberate retry may
    -- replace a completed, failed or abandoned attempt, within a daily bound.
    if existing.admissions >= 4 then
      return jsonb_build_object('state', 'retry_exhausted');
    end if;
  end if;

  -- A retry with no current attempt is an initial acquisition. This covers a
  -- client-side failure before admission and an installation evicted by the cap.
  -- Completed attempts remain suppressed above; active attempts remain pending.

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
    user_id,
    installation_id,
    local_date,
    timezone,
    preference_revision,
    status,
    lease_token,
    started_at,
    lease_expires_at,
    finished_at,
    admissions
  ) values (
    actor_id,
    p_installation_id,
    owner_local_date,
    owner_timezone,
    preference.revision,
    'pending',
    lease,
    observed_at,
    observed_at + interval '75 seconds',
    null,
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
  insert into cadence_advisor_private.daily_brief_rate_limits as admission (
    user_id,
    generation_starts,
    updated_at
  ) values (
    actor_id,
    recent_starts,
    observed_at
  )
  on conflict (user_id) do update set
    generation_starts = excluded.generation_starts,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'state', 'acquired',
    'lease_token', lease,
    'local_date', owner_local_date
  );
end;
$$;

comment on column cadence_advisor_private.daily_brief_runs.admissions is
  'Admissions for this installation, local date and preference revision (1 automatic plus up to 3 deliberate retries). No prompt or generated content is stored.';

commit;
