-- Advisor plan Phase 1A: agent run log, 30-day content store and spend budget.
--
-- Every function here accepts only a first-party agent token (cadence_channel
-- 'daily_brief', 'coach' or 'chat', see 20261116200000). The agent always
-- comes from the token, never from an argument, so one agent cannot spend
-- another agent's share or write another agent's runs. The person's own
-- session, MCP tokens and the job channels are refused.
--
-- Run log (settles Ticket 185):
--   agent_runs           metadata only, kept long-term for analytics.
--   agent_run_contents   brief text, quips, chat turns and replay inputs.
--                        Deleted 30 days after it is written. Text derived
--                        from a calendar is deleted at the end of its local
--                        day. No opt-in for now; the privacy copy follow-up
--                        is docs/MESSAGING_CHANGES.md P-060.
--
-- Spend budget (modelled on reserve_travel_provider_spend, 20261017150000):
-- each model call reserves an estimate before it runs and settles the actual
-- cost after. Each account has a monthly total, split into per-agent shares.
-- A protected share stays available to its agent: other agents cannot spend
-- the part of it that is still unused. Total, shares, per-account overrides
-- and the global daily circuit breaker are rows, so they change without a
-- deploy (docs/COSTS.md, "Advisor agent budget").
begin;

-- Returns the caller's agent, or refuses every other token.
create function cadence_advisor_private.current_agent()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_agent text := auth.jwt() ->> 'cadence_channel';
begin
  if (select auth.uid()) is null then
    raise exception 'agent_auth_required' using errcode = '42501';
  end if;
  if v_agent is null or v_agent not in ('daily_brief', 'coach', 'chat')
      or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  return v_agent;
end;
$$;
revoke all on function cadence_advisor_private.current_agent() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Run log
-- ---------------------------------------------------------------------------

create table cadence_advisor_private.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('daily_brief', 'coach', 'chat')),
  trigger text not null check (trigger in ('on_demand', 'retry', 'scheduled', 'chat_turn')),
  model text check (model is null or model ~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'),
  prompt_version text check (prompt_version is null or prompt_version ~ '^[A-Za-z0-9._:-]{1,128}$'),
  local_date date not null,
  timezone text not null,
  input_hash text check (input_hash is null or input_hash ~ '^[a-f0-9]{64}$'),
  model_calls integer not null default 0 check (model_calls between 0 and 1000),
  input_tokens integer check (input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens >= 0),
  cost_microdollars bigint not null default 0 check (cost_microdollars >= 0),
  tool_calls text[] not null default '{}'::text[] check (cardinality(tool_calls) <= 200),
  outcome text check (outcome in (
    'success', 'refused_budget', 'invalid_output', 'model_error', 'timeout', 'superseded', 'error'
  )),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  error_reason text check (error_reason is null or error_reason ~ '^[a-z][a-z0-9_:]{0,95}$'),
  -- Phase 2 links move_proposals here.
  linked_proposal_ids uuid[] not null default '{}'::uuid[] check (cardinality(linked_proposal_ids) <= 100),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((outcome is null) = (finished_at is null)),
  check (outcome is distinct from 'success' or error_code is null)
);
create index agent_runs_user_recent_idx on cadence_advisor_private.agent_runs (user_id, started_at desc);
create index agent_runs_agent_recent_idx on cadence_advisor_private.agent_runs (agent, started_at desc);

create table cadence_advisor_private.agent_run_contents (
  id bigint generated always as identity primary key,
  run_id uuid not null references cadence_advisor_private.agent_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('input', 'output')),
  seq integer not null default 0 check (seq between 0 and 10000),
  body jsonb not null check (octet_length(body::text) <= 524288),
  calendar_derived boolean not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (run_id, kind, seq),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index agent_run_contents_expiry_idx on cadence_advisor_private.agent_run_contents (expires_at);
create index agent_run_contents_user_expiry_idx on cadence_advisor_private.agent_run_contents (user_id, expires_at);

alter table cadence_advisor_private.agent_runs enable row level security;
alter table cadence_advisor_private.agent_run_contents enable row level security;
revoke all on table cadence_advisor_private.agent_runs from public, anon, authenticated, service_role;
revoke all on table cadence_advisor_private.agent_run_contents from public, anon, authenticated, service_role;

create function public.agent_run_start(p_trigger text, p_model text, p_prompt_version text)
returns table (run_id uuid, local_date date, timezone text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_timezone text;
  v_run cadence_advisor_private.agent_runs;
begin
  select profile.timezone into v_timezone from public.profiles as profile where profile.id = v_user_id;
  if v_timezone is null then
    raise exception 'agent_profile_required' using errcode = '22023';
  end if;
  insert into cadence_advisor_private.agent_runs (user_id, agent, trigger, model, prompt_version, local_date, timezone)
  values (v_user_id, v_agent, p_trigger, p_model, p_prompt_version,
    (statement_timestamp() at time zone v_timezone)::date, v_timezone)
  returning * into v_run;
  return query select v_run.id, v_run.local_date, v_run.timezone;
end;
$$;

-- Cost comes from the run's settled reservations, never from the caller.
create function public.agent_run_finish(
  p_run_id uuid,
  p_outcome text,
  p_error_code text,
  p_error_reason text,
  p_input_hash text,
  p_model_calls integer,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_reasoning_tokens integer,
  p_tool_calls text[] default '{}'::text[],
  p_linked_proposal_ids uuid[] default '{}'::uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
begin
  update cadence_advisor_private.agent_runs as run
  set outcome = p_outcome,
    error_code = case when p_outcome = 'success' then null else p_error_code end,
    error_reason = p_error_reason,
    input_hash = p_input_hash,
    model_calls = coalesce(p_model_calls, 0),
    input_tokens = p_input_tokens,
    cached_input_tokens = p_cached_input_tokens,
    output_tokens = p_output_tokens,
    reasoning_tokens = p_reasoning_tokens,
    tool_calls = coalesce(p_tool_calls, '{}'::text[]),
    linked_proposal_ids = coalesce(p_linked_proposal_ids, '{}'::uuid[]),
    cost_microdollars = coalesce((
      select sum(coalesce(spend.actual_microdollars, spend.estimated_microdollars))
      from cadence_advisor_private.agent_spend_reservations as spend
      where spend.run_id = run.id and spend.user_id = v_user_id
    ), 0),
    finished_at = statement_timestamp()
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = v_agent and run.finished_at is null;
  return found;
end;
$$;

-- Stores content for 30 days, or until the end of the run's local day when
-- it is derived from a calendar. Also removes the caller's expired content.
create function public.agent_run_store_content(
  p_run_id uuid,
  p_kind text,
  p_seq integer,
  p_body jsonb,
  p_calendar_derived boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
  v_now timestamptz := statement_timestamp();
  v_expires_at timestamptz := statement_timestamp() + interval '30 days';
begin
  if p_calendar_derived is null or p_body is null then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = v_agent;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;
  if p_calendar_derived then
    v_expires_at := least(v_expires_at, ((v_run.local_date + 1)::timestamp at time zone v_run.timezone));
    if v_expires_at <= v_now then
      return false;
    end if;
  end if;
  delete from cadence_advisor_private.agent_run_contents as content
  where content.user_id = v_user_id and content.expires_at <= v_now;
  insert into cadence_advisor_private.agent_run_contents (run_id, user_id, kind, seq, body, calendar_derived, created_at, expires_at)
  values (v_run.id, v_user_id, p_kind, coalesce(p_seq, 0), p_body, p_calendar_derived, v_now, v_expires_at);
  return true;
end;
$$;

-- The scheduled deletion job (daily cron, lib/services/agent-run-maintenance.service.ts).
create function public.purge_expired_agent_run_contents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from cadence_advisor_private.agent_run_contents where expires_at <= statement_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spend budget
-- ---------------------------------------------------------------------------

-- One row. Owner decision, November 16, 2026: US$5.00 per account per local month.
create table cadence_advisor_private.agent_budget_settings (
  id boolean primary key default true check (id),
  monthly_total_microdollars bigint not null check (monthly_total_microdollars between 0 and 1000000000),
  -- Defect circuit breaker across all accounts, per UTC day.
  global_daily_microdollars bigint not null check (global_daily_microdollars between 0 and 100000000000),
  updated_at timestamptz not null default now()
);

create table cadence_advisor_private.agent_budget_shares (
  agent text primary key check (agent in ('daily_brief', 'coach', 'chat')),
  monthly_microdollars bigint not null check (monthly_microdollars between 0 and 1000000000),
  protected boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Optional per-account values. agent 'total' overrides the account total.
create table cadence_advisor_private.agent_budget_account_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('total', 'daily_brief', 'coach', 'chat')),
  monthly_microdollars bigint not null check (monthly_microdollars between 0 and 1000000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, agent)
);

create table cadence_advisor_private.agent_spend_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('daily_brief', 'coach', 'chat')),
  run_id uuid references cadence_advisor_private.agent_runs(id) on delete set null,
  model text not null check (model ~ '^[a-z0-9][a-z0-9._:/-]{0,127}$'),
  local_month date not null check (extract(day from local_month) = 1),
  utc_date date not null,
  estimated_microdollars bigint not null check (estimated_microdollars > 0),
  actual_microdollars bigint check (actual_microdollars >= 0),
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  check ((actual_microdollars is null) = (settled_at is null))
);
create index agent_spend_reservations_month_idx
  on cadence_advisor_private.agent_spend_reservations (user_id, local_month, agent);
create index agent_spend_reservations_run_idx
  on cadence_advisor_private.agent_spend_reservations (run_id) where run_id is not null;

create table cadence_advisor_private.agent_spend_global_day (
  utc_date date primary key,
  microdollars bigint not null default 0 check (microdollars >= 0),
  updated_at timestamptz not null default now()
);

alter table cadence_advisor_private.agent_budget_settings enable row level security;
alter table cadence_advisor_private.agent_budget_shares enable row level security;
alter table cadence_advisor_private.agent_budget_account_overrides enable row level security;
alter table cadence_advisor_private.agent_spend_reservations enable row level security;
alter table cadence_advisor_private.agent_spend_global_day enable row level security;
revoke all on table cadence_advisor_private.agent_budget_settings from public, anon, authenticated, service_role;
revoke all on table cadence_advisor_private.agent_budget_shares from public, anon, authenticated, service_role;
revoke all on table cadence_advisor_private.agent_budget_account_overrides from public, anon, authenticated, service_role;
revoke all on table cadence_advisor_private.agent_spend_reservations from public, anon, authenticated, service_role;
revoke all on table cadence_advisor_private.agent_spend_global_day from public, anon, authenticated, service_role;

-- Starting values (owner, November 16, 2026). The global breaker is an
-- engineering default (US$25 per UTC day), recorded in docs/COSTS.md.
insert into cadence_advisor_private.agent_budget_settings (monthly_total_microdollars, global_daily_microdollars)
values (5000000, 25000000);
insert into cadence_advisor_private.agent_budget_shares (agent, monthly_microdollars, protected) values
  ('daily_brief', 500000, true),
  ('coach', 1000000, false),
  ('chat', 3500000, false);

-- Reserves an estimate before one model call. A refused request reserves
-- nothing. reason: 'agent_share', 'account_total' or 'global_day'.
create function public.reserve_agent_spend(p_run_id uuid, p_model text, p_estimated_microdollars integer)
returns table (allowed boolean, reservation_id uuid, reason text, retry_after_seconds integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := statement_timestamp();
  v_utc_date date := (statement_timestamp() at time zone 'UTC')::date;
  v_timezone text;
  v_month date;
  v_month_resets_at timestamptz;
  v_day_resets_at timestamptz;
  v_settings cadence_advisor_private.agent_budget_settings;
  v_total bigint;
  v_share bigint;
  v_used_agent bigint;
  v_used_all bigint;
  v_held_for_others bigint;
  v_global bigint;
  v_reservation_id uuid;
  -- One call never reserves more than US$1.00.
  request_ceiling constant integer := 1000000;
begin
  if p_estimated_microdollars is null or p_estimated_microdollars < 1 or p_estimated_microdollars > request_ceiling then
    raise exception 'agent_spend_out_of_range' using errcode = '22023';
  end if;
  if p_run_id is not null and not exists (
    select 1 from cadence_advisor_private.agent_runs as run
    where run.id = p_run_id and run.user_id = v_user_id and run.agent = v_agent and run.finished_at is null
  ) then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;
  select profile.timezone into v_timezone from public.profiles as profile where profile.id = v_user_id;
  if v_timezone is null then
    raise exception 'agent_profile_required' using errcode = '22023';
  end if;
  v_month := date_trunc('month', v_now at time zone v_timezone)::date;
  v_month_resets_at := (v_month + interval '1 month')::timestamp at time zone v_timezone;
  v_day_resets_at := (v_utc_date + 1)::timestamp at time zone 'UTC';

  -- Lock order: the account, then the global day.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 1116));

  select * into v_settings from cadence_advisor_private.agent_budget_settings where id;
  v_total := coalesce((select o.monthly_microdollars from cadence_advisor_private.agent_budget_account_overrides as o
    where o.user_id = v_user_id and o.agent = 'total'), v_settings.monthly_total_microdollars, 0);

  with shares as (
    select s.agent, s.protected,
      coalesce(o.monthly_microdollars, s.monthly_microdollars) as share
    from cadence_advisor_private.agent_budget_shares as s
    left join cadence_advisor_private.agent_budget_account_overrides as o
      on o.user_id = v_user_id and o.agent = s.agent
  ), used as (
    select r.agent, sum(coalesce(r.actual_microdollars, r.estimated_microdollars)) as amount
    from cadence_advisor_private.agent_spend_reservations as r
    where r.user_id = v_user_id and r.local_month = v_month
    group by r.agent
  )
  select
    coalesce(max(shares.share) filter (where shares.agent = v_agent), 0),
    coalesce(max(used.amount) filter (where shares.agent = v_agent), 0),
    coalesce((select sum(u.amount) from used as u), 0),
    coalesce(sum(greatest(shares.share - coalesce(used.amount, 0), 0))
      filter (where shares.protected and shares.agent <> v_agent), 0)
  into v_share, v_used_agent, v_used_all, v_held_for_others
  from shares left join used on used.agent = shares.agent;

  if v_used_agent + p_estimated_microdollars > v_share then
    return query select false, null::uuid, 'agent_share'::text,
      greatest(1, ceil(extract(epoch from (v_month_resets_at - v_now))))::integer, v_month_resets_at;
    return;
  end if;
  if v_used_all + p_estimated_microdollars > v_total - v_held_for_others then
    return query select false, null::uuid, 'account_total'::text,
      greatest(1, ceil(extract(epoch from (v_month_resets_at - v_now))))::integer, v_month_resets_at;
    return;
  end if;

  insert into cadence_advisor_private.agent_spend_global_day (utc_date, updated_at)
  values (v_utc_date, v_now) on conflict (utc_date) do nothing;
  select g.microdollars into v_global from cadence_advisor_private.agent_spend_global_day as g
  where g.utc_date = v_utc_date for update;
  if v_global + p_estimated_microdollars > coalesce(v_settings.global_daily_microdollars, 0) then
    return query select false, null::uuid, 'global_day'::text,
      greatest(1, ceil(extract(epoch from (v_day_resets_at - v_now))))::integer, v_day_resets_at;
    return;
  end if;

  insert into cadence_advisor_private.agent_spend_reservations (
    user_id, agent, run_id, model, local_month, utc_date, estimated_microdollars, reserved_at
  ) values (v_user_id, v_agent, p_run_id, p_model, v_month, v_utc_date, p_estimated_microdollars, v_now)
  returning id into v_reservation_id;
  update cadence_advisor_private.agent_spend_global_day as g
  set microdollars = g.microdollars + p_estimated_microdollars, updated_at = v_now
  where g.utc_date = v_utc_date;

  return query select true, v_reservation_id, null::text, 0, null::timestamptz;
end;
$$;

-- Records the actual cost once. The actual may exceed the estimate; the
-- month and the global day then count the actual.
create function public.settle_agent_spend(p_reservation_id uuid, p_actual_microdollars integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_reservation cadence_advisor_private.agent_spend_reservations;
begin
  if p_actual_microdollars is null or p_actual_microdollars < 0 or p_actual_microdollars > 10000000 then
    raise exception 'agent_spend_out_of_range' using errcode = '22023';
  end if;
  update cadence_advisor_private.agent_spend_reservations as r
  set actual_microdollars = p_actual_microdollars, settled_at = statement_timestamp()
  where r.id = p_reservation_id and r.user_id = v_user_id and r.agent = v_agent and r.settled_at is null
  returning * into v_reservation;
  if v_reservation.id is null then
    return false;
  end if;
  update cadence_advisor_private.agent_spend_global_day as g
  set microdollars = greatest(0, g.microdollars + p_actual_microdollars - v_reservation.estimated_microdollars),
    updated_at = statement_timestamp()
  where g.utc_date = v_reservation.utc_date;
  return true;
end;
$$;

revoke all on function public.agent_run_start(text, text, text) from public, anon, service_role;
revoke all on function public.agent_run_finish(uuid, text, text, text, text, integer, integer, integer, integer, integer, text[], uuid[]) from public, anon, service_role;
revoke all on function public.agent_run_store_content(uuid, text, integer, jsonb, boolean) from public, anon, service_role;
revoke all on function public.reserve_agent_spend(uuid, text, integer) from public, anon, service_role;
revoke all on function public.settle_agent_spend(uuid, integer) from public, anon, service_role;
revoke all on function public.purge_expired_agent_run_contents() from public, anon, authenticated;
grant execute on function public.agent_run_start(text, text, text) to authenticated;
grant execute on function public.agent_run_finish(uuid, text, text, text, text, integer, integer, integer, integer, integer, text[], uuid[]) to authenticated;
grant execute on function public.agent_run_store_content(uuid, text, integer, jsonb, boolean) to authenticated;
grant execute on function public.reserve_agent_spend(uuid, text, integer) to authenticated;
grant execute on function public.settle_agent_spend(uuid, integer) to authenticated;
grant execute on function public.purge_expired_agent_run_contents() to service_role;

comment on table cadence_advisor_private.agent_runs is
  'Advisor plan Phase 1A, Ticket 185: one row per agent run. Metadata only, no text; kept long-term.';
comment on table cadence_advisor_private.agent_run_contents is
  'Advisor plan Phase 1A, Ticket 185: run text and replay inputs. Deleted after 30 days; calendar-derived text at the end of its local day.';
comment on function public.reserve_agent_spend(uuid, text, integer) is
  'Reserves an estimated model cost for the token''s agent before a call. Refuses past the agent share, the account total less unused protected shares, or the global daily breaker. Refused requests reserve nothing.';

commit;
