-- Advisor plan Phase 4, workstream 4C: base schedule proposals ("Try for two weeks").
--
-- When the person keeps moving the same Behavior the same way on the same weekday, the
-- advisor proposes changing the Behavior's schedule itself:
--   "Change your schedule: Gym at 6:30 PM every Tuesday from Tuesday, Nov 24 (now 7:00 AM)."
-- Answers: Try for two weeks, Change for good, No. A trial asks "Keep Gym at 6:30 PM
-- every Tuesday?" after fourteen days with Keep and Go back. The rules that need no
-- database live in packages/core/src/services/behavior-change-proposal.ts.
--
-- 1. cadence_advisor_private.behavior_change_proposals: server only, never synced or
--    exported. It stores the exact schedule list now and after (T2), the first day the
--    change affects, the evidence and the status.
-- 2. coach_propose_behavior_change: the coach agent token only, and it writes only this
--    table. The coach still cannot edit a Behavior: a Yes runs the person's own schedule
--    edit on the web's existing path (T5), and then records the answer here.
-- 3. coach_behavior_change_state: what the nightly job needs to decide (an open proposal,
--    recent Nos), on the coach token.
-- 4. read_behavior_change_proposal and answer_behavior_change_proposal: the person only.
--
-- Account rules, checked under a per-account lock: at most one open proposal (proposed
-- or in a trial), and a No for the same Behavior and direction is not asked again for 30
-- days. An unanswered proposal closes after seven days. A trial's check-in with no answer
-- for seven days keeps the change, and the person is told once.
begin;

create table cadence_advisor_private.behavior_change_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null,
  run_id uuid references cadence_advisor_private.agent_runs(id) on delete set null,
  -- The coach visit's local day.
  created_local_date date not null,
  weekdays text[] not null check (
    cardinality(weekdays) between 1 and 6
    and weekdays <@ array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  ),
  from_time text not null check (from_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  to_time text not null check (to_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and to_time <> from_time),
  direction text not null check (direction in ('later', 'earlier')),
  -- Integration-contract schedule lists (recurrence + time_entries), max six each.
  schedules_before jsonb not null check (jsonb_typeof(schedules_before) = 'array'
    and jsonb_array_length(schedules_before) between 1 and 6 and octet_length(schedules_before::text) <= 8192),
  schedules_after jsonb not null check (jsonb_typeof(schedules_after) = 'array'
    and jsonb_array_length(schedules_after) between 1 and 6 and octet_length(schedules_after::text) <= 8192),
  first_affected_date date not null check (first_affected_date > created_local_date),
  -- One sentence: the model's validated reason or the code's own.
  reason text not null check (char_length(reason) between 1 and 200),
  -- {source: 'repeated_move' | 'card', signal_ids, counts...}. Counts and ids only.
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and evidence ? 'source'
    and evidence ->> 'source' in ('repeated_move', 'card') and octet_length(evidence::text) <= 4096),
  status text not null default 'proposed' check (status in (
    'proposed', 'accepted_trial', 'accepted', 'declined', 'kept', 'reverted', 'expired'
  )),
  -- Why a proposal or trial closed without a direct answer, or how a trial ended.
  close_reason text check (close_reason in (
    'unanswered', 'schedule_changed', 'kept', 'no_answer', 'edited_during_trial'
  )),
  accepted_local_date date,
  check_in_date date,
  -- Set when the one-time line about a kept trial ("stays at 6:30 PM") was shown.
  notice_shown_at timestamptz,
  answered_at timestamptz,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint behavior_change_proposals_behavior_owner_fkey
    foreign key (user_id, behavior_id) references public.behaviors(user_id, id) on delete cascade,
  constraint behavior_change_proposals_trial_dates check (
    (status <> 'accepted_trial') or (accepted_local_date is not null and check_in_date > accepted_local_date)
  )
);

-- One open proposal per account.
create unique index behavior_change_proposals_one_open
  on cadence_advisor_private.behavior_change_proposals (user_id)
  where status in ('proposed', 'accepted_trial');
create index behavior_change_proposals_user_behavior_idx
  on cadence_advisor_private.behavior_change_proposals (user_id, behavior_id, status, status_changed_at desc);

alter table cadence_advisor_private.behavior_change_proposals enable row level security;
alter table cadence_advisor_private.behavior_change_proposals force row level security;
revoke all on table cadence_advisor_private.behavior_change_proposals from public, anon, authenticated, service_role;

-- The person, signed in on web or the Mac, or refuse. Agents and MCP grants never answer.
create function cadence_private.require_person_for_behavior_change()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null or cadence_oauth_private.current_agent_channel() is not null
      or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'Schedule proposals are answered by the person.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke all on function cadence_private.require_person_for_behavior_change() from public, anon, authenticated, service_role;

-- Closes what time has closed, for one account, as of its local date p_today:
--   proposed for more than seven days        -> expired (unanswered)
--   trial check-in unanswered for seven days -> kept (no_answer); the person is told once
create function cadence_private.settle_behavior_change_proposals(p_user_id uuid, p_today date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update cadence_advisor_private.behavior_change_proposals as p
  set status = 'expired', close_reason = 'unanswered', status_changed_at = now()
  where p.user_id = p_user_id and p.status = 'proposed' and p.created_local_date < p_today - 7;

  update cadence_advisor_private.behavior_change_proposals as p
  set status = 'kept', close_reason = 'no_answer', status_changed_at = now()
  where p.user_id = p_user_id and p.status = 'accepted_trial' and p.check_in_date <= p_today - 7;
end;
$$;
revoke all on function cadence_private.settle_behavior_change_proposals(uuid, date) from public, anon, authenticated, service_role;

-- Coach token only. Stores one proposal for the run's account, or says why not:
-- {"id": uuid} or {"refused": "open_proposal" | "declined_recently" | "behavior_inactive"}.
-- p_proposal is the propose_behavior_change operation input (core validates its shape).
create function public.coach_propose_behavior_change(p_run_id uuid, p_proposal jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
  v_behavior_id uuid;
  v_direction text;
  v_id uuid;
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_proposal is null or jsonb_typeof(p_proposal) <> 'object'
      or jsonb_typeof(p_proposal -> 'weekdays') <> 'array'
      or jsonb_typeof(p_proposal -> 'evidence') <> 'object' then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = 'coach' and run.finished_at is null;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;
  v_behavior_id := (p_proposal ->> 'behavior_id')::uuid;
  v_direction := case when (p_proposal ->> 'to_time') > (p_proposal ->> 'from_time') then 'later' else 'earlier' end;

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('behavior_change:' || v_user_id::text, 0));
  perform cadence_private.settle_behavior_change_proposals(v_user_id, v_run.local_date);

  if not exists (select 1 from public.behaviors as b
      where b.user_id = v_user_id and b.id = v_behavior_id and b.active) then
    return jsonb_build_object('refused', 'behavior_inactive');
  end if;
  if exists (select 1 from cadence_advisor_private.behavior_change_proposals as p
      where p.user_id = v_user_id and p.status in ('proposed', 'accepted_trial')) then
    return jsonb_build_object('refused', 'open_proposal');
  end if;
  if exists (select 1 from cadence_advisor_private.behavior_change_proposals as p
      where p.user_id = v_user_id and p.behavior_id = v_behavior_id and p.direction = v_direction
        and p.status = 'declined' and p.status_changed_at > now() - interval '30 days') then
    return jsonb_build_object('refused', 'declined_recently');
  end if;

  insert into cadence_advisor_private.behavior_change_proposals (
    user_id, behavior_id, run_id, created_local_date, weekdays, from_time, to_time, direction,
    schedules_before, schedules_after, first_affected_date, reason, evidence
  ) values (
    v_user_id, v_behavior_id, v_run.id, v_run.local_date,
    array(select jsonb_array_elements_text(p_proposal -> 'weekdays')),
    p_proposal ->> 'from_time', p_proposal ->> 'to_time', v_direction,
    p_proposal -> 'schedules_before', p_proposal -> 'schedules_after',
    (p_proposal ->> 'first_affected_date')::date, p_proposal ->> 'reason', p_proposal -> 'evidence'
  ) returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function public.coach_propose_behavior_change(uuid, jsonb) from public, anon, service_role;
grant execute on function public.coach_propose_behavior_change(uuid, jsonb) to authenticated;

-- Coach token only: is a proposal open, and which Nos are inside the 30-day cooldown.
create function public.coach_behavior_change_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'has_open', exists (select 1 from cadence_advisor_private.behavior_change_proposals as p
      where p.user_id = v_user_id and p.status in ('proposed', 'accepted_trial')),
    'declined', coalesce((select jsonb_agg(jsonb_build_object(
        'behavior_id', p.behavior_id, 'direction', p.direction,
        'declined_at', p.status_changed_at) order by p.status_changed_at desc)
      from cadence_advisor_private.behavior_change_proposals as p
      where p.user_id = v_user_id and p.status = 'declined'
        and p.status_changed_at > now() - interval '30 days'), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.coach_behavior_change_state() from public, anon, service_role;
grant execute on function public.coach_behavior_change_state() to authenticated;

-- The person: the one proposal to show, as of their local date p_today. Settles what time
-- has closed first. Returns null, or the row: an open proposal, a trial, or a kept trial
-- whose one-time line has not been shown yet.
create function public.read_behavior_change_proposal(p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_person_for_behavior_change();
  v_row cadence_advisor_private.behavior_change_proposals;
begin
  if p_today is null then
    raise exception 'behavior_change_invalid_input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('behavior_change:' || v_user_id::text, 0));
  perform cadence_private.settle_behavior_change_proposals(v_user_id, p_today);
  select * into v_row from cadence_advisor_private.behavior_change_proposals as p
  where p.user_id = v_user_id and (
    p.status in ('proposed', 'accepted_trial')
    or (p.status = 'kept' and p.close_reason in ('no_answer', 'edited_during_trial') and p.notice_shown_at is null)
  )
  order by (p.status in ('proposed', 'accepted_trial')) desc, p.status_changed_at desc
  limit 1;
  if v_row.id is null then
    return null;
  end if;
  return to_jsonb(v_row) - 'user_id' - 'run_id';
end;
$$;
revoke all on function public.read_behavior_change_proposal(date) from public, anon, service_role;
grant execute on function public.read_behavior_change_proposal(date) to authenticated;

-- The person records an answer, after the server applied any schedule edit it needs.
--   try              proposed -> accepted_trial (needs p_check_in_date)
--   for_good         proposed -> accepted
--   no               proposed -> declined
--   schedule_changed proposed -> expired: the schedule changed before the answer
--   keep             accepted_trial -> kept
--   go_back          accepted_trial -> reverted
--   edited           accepted_trial -> kept: the person edited the schedule during the
--                    trial, so Go back is not offered (T4); the person is told once
--   notice_seen      the one-time line about a kept trial was shown
-- Repeating an answer that already took effect returns the row with "replayed": true.
-- Any other answer on a closed proposal raises behavior_change_closed.
create function public.answer_behavior_change_proposal(
  p_proposal_id uuid,
  p_answer text,
  p_today date,
  p_check_in_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_person_for_behavior_change();
  v_row cadence_advisor_private.behavior_change_proposals;
  v_from text;
  v_to text;
  v_close text;
begin
  if p_proposal_id is null or p_today is null or p_answer not in (
      'try', 'for_good', 'no', 'schedule_changed', 'keep', 'go_back', 'edited', 'notice_seen')
      or ((p_answer = 'try') <> (p_check_in_date is not null))
      or (p_check_in_date is not null and p_check_in_date <= p_today) then
    raise exception 'behavior_change_invalid_input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('behavior_change:' || v_user_id::text, 0));
  select * into v_row from cadence_advisor_private.behavior_change_proposals as p
  where p.user_id = v_user_id and p.id = p_proposal_id for update;
  if v_row.id is null then
    raise exception 'behavior_change_not_found' using errcode = 'P0002';
  end if;

  if p_answer = 'notice_seen' then
    if v_row.status <> 'kept' or v_row.close_reason not in ('no_answer', 'edited_during_trial') then
      raise exception 'behavior_change_closed' using errcode = 'P0001';
    end if;
    update cadence_advisor_private.behavior_change_proposals as p
    set notice_shown_at = coalesce(p.notice_shown_at, now())
    where p.id = v_row.id returning * into v_row;
    return to_jsonb(v_row) - 'user_id' - 'run_id';
  end if;

  v_from := case when p_answer in ('try', 'for_good', 'no', 'schedule_changed') then 'proposed' else 'accepted_trial' end;
  v_to := case p_answer
    when 'try' then 'accepted_trial' when 'for_good' then 'accepted' when 'no' then 'declined'
    when 'schedule_changed' then 'expired' when 'keep' then 'kept' when 'go_back' then 'reverted'
    when 'edited' then 'kept' end;
  v_close := case p_answer
    when 'schedule_changed' then 'schedule_changed' when 'keep' then 'kept'
    when 'edited' then 'edited_during_trial' else null end;

  if v_row.status = v_to and v_row.close_reason is not distinct from v_close then
    return (to_jsonb(v_row) - 'user_id' - 'run_id') || jsonb_build_object('replayed', true);
  end if;
  if v_row.status <> v_from then
    raise exception 'behavior_change_closed' using errcode = 'P0001';
  end if;

  update cadence_advisor_private.behavior_change_proposals as p
  set status = v_to,
      close_reason = v_close,
      accepted_local_date = case when p_answer = 'try' then p_today else p.accepted_local_date end,
      check_in_date = case when p_answer = 'try' then p_check_in_date else p.check_in_date end,
      -- The edited-during-trial line is shown with the check-in itself.
      notice_shown_at = case when p_answer = 'edited' then now() else p.notice_shown_at end,
      answered_at = case when p_answer in ('schedule_changed', 'edited') then p.answered_at else now() end,
      status_changed_at = now()
  where p.id = v_row.id
  returning * into v_row;
  return to_jsonb(v_row) - 'user_id' - 'run_id';
end;
$$;
revoke all on function public.answer_behavior_change_proposal(uuid, text, date, date) from public, anon, service_role;
grant execute on function public.answer_behavior_change_proposal(uuid, text, date, date) to authenticated;

commit;
