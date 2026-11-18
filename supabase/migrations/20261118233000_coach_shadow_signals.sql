-- Advisor plan Phase 3, workstream 3D: coach signals in shadow.
--
-- An hourly job (/api/advisor/coach/signals/process) visits accounts where it is
-- early morning local time and that were active in the last seven days. For each
-- one it computes coach signals with no model call and stores them here. Nothing
-- shows them yet: Phase 4 matches them to advice cards and writes quips.
--
-- Signals (packages/core/src/resolvers/coach-signals.resolver.ts):
--   completion_drop        a Behavior's completion rate dropped
--   repeated_move          the same Behavior was moved the same way on several days
--   late_marking           decisions are usually recorded on a later day
--   new_behavior_settled   a new Behavior is past its first two weeks
--   brief_answers          how the person answered the brief's move lines
-- Facts hold counts, times of day and ids only: never titles, notes or calendar data.
--
-- Access follows the connector completion job (Ticket 321) and Phase 1A:
--   - The service role calls one function that returns which accounts are due. It
--     reads no table and writes nothing.
--   - Every other read and write runs as the person on the coach agent's own token
--     channel (cadence_channel = 'coach'), under RLS. The coach token stays
--     read-only for the integration operations; only coach_record_signals writes,
--     and only into this server-only table.
--   - Each visit is one agent_runs row (agent 'coach', trigger 'scheduled', no model
--     call), so a re-run of the same local day replaces that day's signals.
--
-- Owner approval: Emi approved the hourly cron and this production table on
-- 2026-11-18 (advisor plan, Phase 3 brief, 3D).
begin;

create table cadence_advisor_private.coach_signals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid references cadence_advisor_private.agent_runs(id) on delete set null,
  local_date date not null,
  kind text not null check (kind in (
    'completion_drop', 'repeated_move', 'late_marking', 'new_behavior_settled', 'brief_answers'
  )),
  -- Null for an account-wide signal.
  behavior_id uuid,
  facts jsonb not null check (jsonb_typeof(facts) = 'object' and octet_length(facts::text) <= 4096),
  signal_version text not null check (signal_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  created_at timestamptz not null default now(),
  constraint coach_signals_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade
);
create unique index coach_signals_day_key
  on cadence_advisor_private.coach_signals
  (user_id, local_date, kind, coalesce(behavior_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index coach_signals_kind_recent_idx on cadence_advisor_private.coach_signals (kind, local_date desc);

alter table cadence_advisor_private.coach_signals enable row level security;
alter table cadence_advisor_private.coach_signals force row level security;
revoke all on table cadence_advisor_private.coach_signals from public, anon, authenticated, service_role;

-- Finds a visit's account by its local morning without a sequential scan of runs.
create index agent_runs_coach_day_idx
  on cadence_advisor_private.agent_runs (user_id, local_date)
  where agent = 'coach' and trigger = 'scheduled';

-- Service role only. Returns, in user_id order after p_after, accounts where it is
-- between 03:00 and 05:59 local time, that were active in the last seven days, and
-- that have no successful visit for their local day yet. 03:00 is the first try;
-- the next two hourly runs pick up an account whose visit failed or was skipped.
-- An account with three visits that day is left alone until tomorrow.
-- Active: a status mark, a move or a sign-in in the last seven days.
create function public.coach_due_accounts(p_after uuid, p_limit integer)
returns table (user_id uuid, local_date date)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := statement_timestamp();
  v_since timestamptz := statement_timestamp() - interval '7 days';
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'coach_invalid_limit' using errcode = '22023';
  end if;
  return query
  select profile.id, (v_now at time zone profile.timezone)::date
  from public.profiles as profile
  join pg_catalog.pg_timezone_names as zone on zone.name = profile.timezone
  where profile.id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
    and extract(hour from (v_now at time zone profile.timezone)) between 3 and 5
    and (
      exists (select 1 from public.occurrence_status_events as event
        where event.user_id = profile.id and event.recorded_at >= v_since)
      or exists (select 1 from public.occurrence_moves as move
        where move.user_id = profile.id and move.created_at >= v_since)
      or exists (select 1 from auth.users as account
        where account.id = profile.id and account.last_sign_in_at >= v_since)
    )
    and not exists (
      select 1 from cadence_advisor_private.agent_runs as run
      where run.user_id = profile.id and run.agent = 'coach' and run.trigger = 'scheduled'
        and run.local_date = (v_now at time zone profile.timezone)::date
        and run.outcome = 'success'
    )
    and (
      select count(*) from cadence_advisor_private.agent_runs as run
      where run.user_id = profile.id and run.agent = 'coach' and run.trigger = 'scheduled'
        and run.local_date = (v_now at time zone profile.timezone)::date
    ) < 3
  order by profile.id
  limit p_limit;
end;
$$;
revoke all on function public.coach_due_accounts(uuid, integer) from public, anon, authenticated;
grant execute on function public.coach_due_accounts(uuid, integer) to service_role;

-- Coach token only. Replaces the signals of the run's local day with p_signals, a
-- JSON array of {kind, behavior_id, facts}. A re-run of the same day therefore
-- leaves one set. Also removes the caller's signals older than 180 days.
create function public.coach_record_signals(p_run_id uuid, p_signal_version text, p_signals jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
  v_count integer;
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_signals is null or jsonb_typeof(p_signals) <> 'array' or jsonb_array_length(p_signals) > 500 then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = 'coach' and run.finished_at is null;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;

  delete from cadence_advisor_private.coach_signals as signal
  where signal.user_id = v_user_id
    and (signal.local_date = v_run.local_date or signal.local_date < v_run.local_date - 180);

  insert into cadence_advisor_private.coach_signals (user_id, run_id, local_date, kind, behavior_id, facts, signal_version)
  select v_user_id, v_run.id, v_run.local_date, item ->> 'kind',
    nullif(item ->> 'behavior_id', '')::uuid, item -> 'facts', p_signal_version
  from jsonb_array_elements(p_signals) as item;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.coach_record_signals(uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.coach_record_signals(uuid, text, jsonb) to authenticated;

commit;
