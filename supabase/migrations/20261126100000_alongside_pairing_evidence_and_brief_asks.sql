-- Tickets 360 and 361 follow-up (D33). Additive: one new function, one new table, its
-- RLS policies and grants to authenticated only. No drop, no data writes.
--
-- 1. advisor_read_pairing_evidence(date): the pairing planner's evidence from the coach's
--    stored signals, for the Daily Brief and Chat agent channels. Before this, the brief
--    and Chat minted a coach agent client to call coach_read_signals, which gave them the
--    coach channel for a two-field read. This returns only `done_together` pairs and
--    `crowded_hour` hours for the caller's own account, so coach_signals stays readable
--    in full by the coach channel alone.
-- 2. brief_alongside_asks: one row per Behavior whose alongside question a saved Daily
--    Brief first included, so a later day's brief does not ask about it again. Ids and a
--    date only, no text. Hosted-only: not part of account sync or exports. Account and
--    Behavior deletion cascade.
begin;

-- 1. Pairing evidence -------------------------------------------------------------------

-- The caller's pairing evidence for one local date, as
--   {"done_together": [{"behavior_id", "other_behavior_id"}], "crowded_hours": [hour]}.
-- Signals are stored early in the local morning; until any signal is stored for
-- p_local_date, the day before is used. A done_together pair counts only when both
-- Behaviors are the caller's; an hour counts only as a whole number from 0 to 23.
-- Daily Brief and Chat agent channels only. Read only.
create function public.advisor_read_pairing_evidence(p_local_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_date date;
begin
  if v_agent not in ('daily_brief', 'chat') then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_local_date is null then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  v_date := case when exists (
    select 1 from cadence_advisor_private.coach_signals as signal
    where signal.user_id = v_user_id and signal.local_date = p_local_date
  ) then p_local_date else p_local_date - 1 end;
  return jsonb_build_object(
    'done_together', coalesce((
      select jsonb_agg(jsonb_build_object('behavior_id', signal.behavior_id, 'other_behavior_id', other.id)
        order by signal.behavior_id, other.id)
      from cadence_advisor_private.coach_signals as signal
      join public.behaviors as other
        on other.user_id = v_user_id
        and other.id = case when signal.facts ->> 'other_behavior_id'
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (signal.facts ->> 'other_behavior_id')::uuid end
      where signal.user_id = v_user_id and signal.local_date = v_date
        and signal.kind = 'done_together' and signal.behavior_id is not null
    ), '[]'::jsonb),
    'crowded_hours', coalesce((
      select jsonb_agg(hours.hour order by hours.hour)
      from (
        select distinct (signal.facts ->> 'hour')::integer as hour
        from cadence_advisor_private.coach_signals as signal
        where signal.user_id = v_user_id and signal.local_date = v_date
          and signal.kind = 'crowded_hour'
          and jsonb_typeof(signal.facts -> 'hour') = 'number'
          and (signal.facts ->> 'hour') ~ '^([0-9]|1[0-9]|2[0-3])$'
      ) as hours
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.advisor_read_pairing_evidence(date) from public, anon, service_role;
grant execute on function public.advisor_read_pairing_evidence(date) to authenticated;

-- 2. Brief alongside asks ----------------------------------------------------------------

create table public.brief_alongside_asks (
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null,
  -- The local date of the first saved brief that asked.
  local_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, behavior_id),
  constraint brief_alongside_asks_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade
);

alter table public.brief_alongside_asks enable row level security;
create policy brief_alongside_asks_select_own on public.brief_alongside_asks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy brief_alongside_asks_insert_own on public.brief_alongside_asks
  for insert to authenticated with check ((select auth.uid()) = user_id);
revoke all on table public.brief_alongside_asks from anon, authenticated;
grant select, insert on table public.brief_alongside_asks to authenticated;

commit;
