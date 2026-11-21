-- Behaviors of Opportunity (Task 7): the Daily Brief's "Add for today" lines.
--
-- The brief can offer to add an opportunity Behavior to today in a free window. The
-- person answers Yes, No, Other time, Undo or "Don't suggest adding this". Yes and Other
-- time add the Occurrence through add_opportunity_occurrence as the person (added_by
-- daily_brief); Undo removes it through remove_opportunity_occurrence. This migration
-- stores the lines and answers around them, with the same rules as move_proposals
-- (20261117100000, 20261118120000): server only, never synced, owner-read RLS, writes
-- only through security-definer functions, the Daily Brief agent token for proposals.
-- Rules: docs/DATETIME_STRATEGY.md, "Brief opportunity lines".
--
-- 1. opportunity_proposals: one row per offered line. Kept 30 days after its day.
-- 2. opportunity_proposal_answers: one append-only row per answer.
-- 3. behavior_move_preferences.never_suggest_add: "Don't suggest adding this".
-- 4. Functions: record_brief_opportunity_proposals and withdraw_brief_opportunity_proposal
--    (Daily Brief agent only), answer_opportunity_proposal (the person or the Daily Brief
--    agent), set_behavior_opportunity_preference (the person).
-- 5. coach_signals kind opportunity_ready_to_schedule.
begin;

-- 1. opportunity_proposals ---------------------------------------------------------------
create table public.opportunity_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null,
  local_date date not null,
  source text not null default 'daily_brief' check (source in ('daily_brief')),
  agent_run_id uuid,
  status text not null default 'proposed' check (status in (
    'proposed', 'accepted', 'declined', 'other_time', 'superseded', 'withdrawn', 'undone'
  )),
  proposed_start_at timestamptz not null,
  proposed_end_at timestamptz not null check (proposed_end_at >= proposed_start_at),
  reason text check (reason is null or reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- The shown line: title, length and its source, Where, other times, travel state.
  -- Built by Cadence only; no model text and no calendar text.
  line jsonb not null default '{}'::jsonb
    check (jsonb_typeof(line) = 'object' and octet_length(line::text) <= 16384),
  replaces_proposal_id uuid,
  -- The Occurrence that Yes or Other time added, for Undo. Not a foreign key: Undo
  -- deletes that Occurrence and the proposal keeps the id as a record.
  occurrence_id uuid,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint opportunity_proposals_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade,
  constraint opportunity_proposals_replaces_owner_fkey
    foreign key (user_id, replaces_proposal_id) references public.opportunity_proposals(user_id, id) on delete set null (replaces_proposal_id)
);

create index opportunity_proposals_user_status_date_idx on public.opportunity_proposals (user_id, local_date, status);
create index opportunity_proposals_user_behavior_idx on public.opportunity_proposals (user_id, behavior_id, status, local_date);
create trigger set_opportunity_proposals_updated_at
  before update on public.opportunity_proposals
  for each row execute function public.set_updated_at();

alter table public.opportunity_proposals enable row level security;
create policy opportunity_proposals_select_own on public.opportunity_proposals
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.opportunity_proposals from anon, authenticated;
grant select on table public.opportunity_proposals to authenticated;

-- 2. opportunity_proposal_answers --------------------------------------------------------
create table public.opportunity_proposal_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid not null,
  behavior_id uuid not null,
  local_date date not null,
  kind text not null check (kind in ('yes', 'no', 'other_time', 'undo', 'never_add')),
  outcome text not null check (outcome in ('applied', 'refused')),
  refusal_reason text check (refusal_reason is null or refusal_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- The Occurrence added (Yes, Other time) or removed (Undo).
  occurrence_id uuid,
  source text not null check (source in ('person', 'daily_brief')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  constraint opportunity_proposal_answers_refusal_check check ((outcome = 'refused') = (refusal_reason is not null)),
  constraint opportunity_proposal_answers_proposal_owner_fkey
    foreign key (user_id, proposal_id) references public.opportunity_proposals(user_id, id) on delete cascade,
  constraint opportunity_proposal_answers_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade
);

create unique index opportunity_proposal_answers_idempotency_key
  on public.opportunity_proposal_answers (user_id, idempotency_key, proposal_id);
create index opportunity_proposal_answers_user_date_idx on public.opportunity_proposal_answers (user_id, local_date);
create index opportunity_proposal_answers_user_behavior_idx on public.opportunity_proposal_answers (user_id, behavior_id, created_at);

alter table public.opportunity_proposal_answers enable row level security;
create policy opportunity_proposal_answers_select_own on public.opportunity_proposal_answers
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.opportunity_proposal_answers from anon, authenticated;
grant select on table public.opportunity_proposal_answers to authenticated;

-- 3. "Don't suggest adding this" ---------------------------------------------------------
alter table public.behavior_move_preferences
  add column never_suggest_add boolean not null default false;

-- 4. Functions ---------------------------------------------------------------------------

-- Writes the brief's opportunity lines, linked to the run. p_proposals:
-- [{"behavior_id", "proposed_start_at", "proposed_end_at", "reason", "line",
--   "replaces_proposal_id"}]. With p_supersede (a Refresh), the day's undecided lines are
-- closed as superseded first. A Behavior declined or undone today, switched to "Don't
-- suggest adding this", or no longer an active opportunity Behavior is skipped. The
-- person's lines from more than 30 days ago are deleted here (answers cascade).
create function public.record_brief_opportunity_proposals(
  p_agent_run_id uuid,
  p_local_date date,
  p_proposals jsonb,
  p_supersede boolean default false
) returns setof public.opportunity_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_item jsonb;
  v_behavior public.behaviors;
  v_ids uuid[] := array[]::uuid[];
  v_row public.opportunity_proposals;
begin
  if p_local_date is null or jsonb_typeof(p_proposals) is distinct from 'array' or jsonb_array_length(p_proposals) > 8 then
    raise exception 'opportunity_proposal_invalid_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || p_local_date::text, 304));

  delete from public.opportunity_proposals p
  where p.user_id = v_user_id and p.local_date < p_local_date - 30;

  if p_supersede then
    update public.opportunity_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.local_date = p_local_date and p.status = 'proposed';
  end if;

  for v_item in select value from jsonb_array_elements(p_proposals) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'line') is distinct from 'object'
      or (v_item ->> 'proposed_start_at') is null or (v_item ->> 'proposed_end_at') is null
      or (v_item ->> 'proposed_end_at')::timestamptz < (v_item ->> 'proposed_start_at')::timestamptz then
      raise exception 'opportunity_proposal_invalid_input' using errcode = '22023';
    end if;
    select * into v_behavior from public.behaviors b
      where b.user_id = v_user_id and b.id = (v_item ->> 'behavior_id')::uuid;
    if v_behavior.id is null or not v_behavior.is_opportunity or not v_behavior.active
      or v_behavior.archived_at is not null
      or (now() at time zone v_behavior.timezone)::date <> p_local_date then
      continue;
    end if;
    -- No, Undo and "Don't suggest adding this" hold for the rest of the day.
    if exists (select 1 from public.opportunity_proposals p
        where p.user_id = v_user_id and p.behavior_id = v_behavior.id and p.local_date = p_local_date
          and p.status in ('declined', 'undone'))
      or exists (select 1 from public.behavior_move_preferences pref
        where pref.user_id = v_user_id and pref.behavior_id = v_behavior.id and pref.never_suggest_add) then
      continue;
    end if;
    -- One undecided line per Behavior and day: a new line replaces the old one.
    update public.opportunity_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.behavior_id = v_behavior.id and p.local_date = p_local_date and p.status = 'proposed';

    insert into public.opportunity_proposals (
      user_id, behavior_id, local_date, source, agent_run_id, status,
      proposed_start_at, proposed_end_at, reason, line, replaces_proposal_id
    ) values (
      v_user_id, v_behavior.id, p_local_date, 'daily_brief', p_agent_run_id, 'proposed',
      (v_item ->> 'proposed_start_at')::timestamptz, (v_item ->> 'proposed_end_at')::timestamptz,
      nullif(v_item ->> 'reason', ''), v_item -> 'line',
      (select p.id from public.opportunity_proposals p
        where p.user_id = v_user_id and p.id = nullif(v_item ->> 'replaces_proposal_id', '')::uuid)
    ) returning * into v_row;
    v_ids := v_ids || v_row.id;
  end loop;

  return query select * from public.opportunity_proposals p
    where p.user_id = v_user_id and p.id = any(v_ids) order by p.proposed_start_at, p.id;
end $$;

revoke all on function public.record_brief_opportunity_proposals(uuid, date, jsonb, boolean) from public, anon, service_role;
grant execute on function public.record_brief_opportunity_proposals(uuid, date, jsonb, boolean) to authenticated;

-- Re-check on open closes a line when nothing fits today. Daily Brief agent only, the
-- agent's own person, and only a line still 'proposed'.
create function public.withdraw_brief_opportunity_proposal(p_proposal_id uuid)
returns public.opportunity_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_row public.opportunity_proposals;
begin
  if p_proposal_id is null then
    raise exception 'opportunity_proposal_invalid_input' using errcode = '22023';
  end if;
  update public.opportunity_proposals p
  set status = 'withdrawn', status_changed_at = now()
  where p.user_id = v_user_id and p.id = p_proposal_id and p.status = 'proposed'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.opportunity_proposals p where p.user_id = v_user_id and p.id = p_proposal_id;
    if v_row.id is null then
      raise exception 'opportunity_proposal_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end $$;

revoke all on function public.withdraw_brief_opportunity_proposal(uuid) from public, anon, service_role;
grant execute on function public.withdraw_brief_opportunity_proposal(uuid) to authenticated;

-- Records one answer to one line and moves its status when the answer took effect.
-- The add or remove itself runs before, as the person.
-- The same key and proposal returns the stored answer and changes nothing.
-- Status moves:  no, never_add:   proposed -> declined (never_add on an answered line keeps it)
--                yes:             proposed -> accepted (occurrence_id set)
--                other_time:      proposed or superseded -> other_time (occurrence_id set)
--                undo:            accepted or other_time -> undone
-- A refused answer is recorded and changes no status.
create function public.answer_opportunity_proposal(
  p_proposal_id uuid,
  p_kind text,
  p_outcome text,
  p_idempotency_key text,
  p_occurrence_id uuid default null,
  p_refusal_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_agent text := cadence_oauth_private.current_agent_channel();
  v_source text;
  v_proposal public.opportunity_proposals;
  v_existing public.opportunity_proposal_answers;
  v_answer public.opportunity_proposal_answers;
  v_next text;
begin
  if v_user_id is null then
    raise exception 'Opportunity answers require an authenticated user.' using errcode = '42501';
  end if;
  if auth.jwt() ->> 'cadence_grant_id' is not null or (v_agent is not null and v_agent <> 'daily_brief') then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  v_source := case when v_agent = 'daily_brief' then 'daily_brief' else 'person' end;
  if p_proposal_id is null or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 255
    or p_kind not in ('yes', 'no', 'other_time', 'undo', 'never_add')
    or p_outcome not in ('applied', 'refused')
    or (p_outcome = 'refused') <> (p_refusal_reason is not null)
    or (p_refusal_reason is not null and p_refusal_reason !~ '^[a-z][a-z0-9_]{0,63}$')
    or (p_outcome = 'applied' and p_kind in ('yes', 'other_time', 'undo') and p_occurrence_id is null) then
    raise exception 'opportunity_answer_invalid_input' using errcode = '22023';
  end if;

  select * into v_proposal from public.opportunity_proposals p
    where p.user_id = v_user_id and p.id = p_proposal_id for update;
  if v_proposal.id is null then
    raise exception 'opportunity_proposal_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.opportunity_proposal_answers a
    where a.user_id = v_user_id and a.idempotency_key = p_idempotency_key and a.proposal_id = p_proposal_id;
  if v_existing.id is not null then
    if v_existing.kind <> p_kind then
      raise exception 'opportunity_answer_idempotency_key_reused' using errcode = '22023';
    end if;
    return jsonb_build_object('replayed', true, 'answer', to_jsonb(v_existing) - 'user_id',
      'proposal', to_jsonb(v_proposal) - 'user_id');
  end if;

  if p_outcome = 'applied' then
    -- Yes and Other time name an added Occurrence of this Behavior, today.
    if p_kind in ('yes', 'other_time') and not exists (select 1 from public.occurrences o
        where o.user_id = v_user_id and o.id = p_occurrence_id and o.behavior_id = v_proposal.behavior_id
          and o.origin = 'opportunity' and o.local_date = v_proposal.local_date) then
      raise exception 'opportunity_answer_invalid_input' using errcode = '22023';
    end if;
    if p_kind = 'undo' and p_occurrence_id is distinct from v_proposal.occurrence_id then
      raise exception 'opportunity_answer_invalid_input' using errcode = '22023';
    end if;
    v_next := case
      when p_kind in ('no', 'never_add') and v_proposal.status = 'proposed' then 'declined'
      when p_kind = 'yes' and v_proposal.status = 'proposed' then 'accepted'
      when p_kind = 'other_time' and v_proposal.status in ('proposed', 'superseded') then 'other_time'
      when p_kind = 'undo' and v_proposal.status in ('accepted', 'other_time') then 'undone'
    end;
    if v_next is null and p_kind = 'never_add' then
      v_next := v_proposal.status;
    end if;
    if v_next is null then
      raise exception 'opportunity_proposal_closed' using errcode = '22023';
    end if;
    update public.opportunity_proposals p
    set status = v_next,
        occurrence_id = case when p_kind in ('yes', 'other_time') then p_occurrence_id else p.occurrence_id end,
        status_changed_at = case when v_next <> p.status then now() else p.status_changed_at end
    where p.user_id = v_user_id and p.id = v_proposal.id
    returning * into v_proposal;
  end if;

  insert into public.opportunity_proposal_answers (
    user_id, proposal_id, behavior_id, local_date, kind, outcome, refusal_reason, occurrence_id, source, idempotency_key
  ) values (
    v_user_id, v_proposal.id, v_proposal.behavior_id, v_proposal.local_date, p_kind, p_outcome, p_refusal_reason,
    p_occurrence_id, v_source, p_idempotency_key
  ) returning * into v_answer;

  return jsonb_build_object('replayed', false, 'answer', to_jsonb(v_answer) - 'user_id',
    'proposal', to_jsonb(v_proposal) - 'user_id');
end $$;

revoke all on function public.answer_opportunity_proposal(uuid, text, text, text, uuid, text) from public, anon, service_role;
grant execute on function public.answer_opportunity_proposal(uuid, text, text, text, uuid, text) to authenticated;

-- "Don't suggest adding this". The person only. Switching it on closes the Behavior's
-- undecided lines.
create function public.set_behavior_opportunity_preference(p_behavior_id uuid, p_never_suggest_add boolean)
returns public.behavior_move_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.behavior_move_preferences;
begin
  if v_user_id is null or cadence_oauth_private.current_agent_channel() is not null
      or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'Opportunity preferences are the person''s own setting.' using errcode = '42501';
  end if;
  if p_behavior_id is null or p_never_suggest_add is null then
    raise exception 'opportunity_preference_invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.behaviors b where b.user_id = v_user_id and b.id = p_behavior_id) then
    raise exception 'Behavior not found.' using errcode = 'P0002';
  end if;
  insert into public.behavior_move_preferences (user_id, behavior_id, never_suggest_add, updated_at)
  values (v_user_id, p_behavior_id, p_never_suggest_add, now())
  on conflict (user_id, behavior_id) do update
    set never_suggest_add = excluded.never_suggest_add, updated_at = now()
  returning * into v_row;
  if p_never_suggest_add then
    update public.opportunity_proposals p
    set status = 'declined', status_changed_at = now()
    where p.user_id = v_user_id and p.behavior_id = p_behavior_id and p.status = 'proposed';
  end if;
  return v_row;
end $$;

revoke all on function public.set_behavior_opportunity_preference(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_behavior_opportunity_preference(uuid, boolean) to authenticated;

-- 5. Coach signal kind -------------------------------------------------------------------
alter table cadence_advisor_private.coach_signals
  drop constraint coach_signals_kind_check;

alter table cadence_advisor_private.coach_signals
  add constraint coach_signals_kind_check check (kind in (
    -- Version 1 (3D).
    'completion_drop', 'repeated_move', 'late_marking', 'new_behavior_settled', 'brief_answers',
    -- Version 2 (4B).
    'weekly_numbers', 'weekday_gap', 'time_of_day_gap', 'timing_mode_gap', 'steady_behavior',
    'never_done', 'dip_recovery', 'day_shape', 'unmarked_items', 'marking_time',
    'done_together', 'crowded_hour', 'setup_gaps',
    -- Version 2, added after the owner's review (D8).
    'reminder_response', 'session_length', 'moved_vs_unmoved',
    -- Behaviors of Opportunity (Task 7).
    'opportunity_ready_to_schedule'
  ));

commit;
