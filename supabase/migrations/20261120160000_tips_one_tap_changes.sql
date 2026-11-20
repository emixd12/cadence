-- Advisor plan follow-up: tips with one-tap changes (Nov 20, 2026).
--
-- A tip such as "You moved Gym to near 6:30 PM on 4 days of the last 28." now carries
-- its offer: "Set Gym to 6:30 PM every day?" with Try for two weeks, Change for good and
-- No, or a link that opens the right editor. The offer is a schedule proposal (4C) that
-- carries the tip's sentence; the tip remembers its proposal or its link.
-- Emi approved this migration on Nov 20 (review "Tips with one-tap changes", item 4).
--
-- behavior_change_proposals:
--   1. change_kind 'time' (as before) or 'length': a length change carries from_minutes
--      and to_minutes and no times, weekdays or schedule lists.
--   2. evidence may come from a tip (source 'tip', with the tip's sentence).
--   3. one open proposal per Behavior, not per account (Emi, decision 3). The person
--      still sees one question at a time.
--   4. a Yes applies today (Emi, decision 2): the first affected date may be today, a
--      change may cover all seven weekdays, and a trial's check-in is 14 days on.
--   5. a new answer, undo, after Change for good: accepted -> reverted (close_reason
--      'undone'), while the schedule or length is unchanged since the tap.
--   6. No on a tip-backed proposal also answers its tip with "not now".
-- coach_tips:
--   7. proposal_id, link_target and link_behavior_id; coach_write_tips takes them,
--      tip_json returns them, coach_tip_history says which tips' proposals got a No.
--
-- Nothing is deleted. Existing rows stay valid (they are all change_kind 'time').
-- Installed Macs read these through the hosted routes only and ignore the new fields.
begin;

-- 1-4. behavior_change_proposals ------------------------------------------------------

alter table cadence_advisor_private.behavior_change_proposals
  add column change_kind text not null default 'time' check (change_kind in ('time', 'length')),
  add column from_minutes integer check (from_minutes between 1 and 1440),
  add column to_minutes integer check (to_minutes between 5 and 720),
  alter column weekdays drop not null,
  alter column from_time drop not null,
  alter column to_time drop not null,
  alter column schedules_before drop not null,
  alter column schedules_after drop not null,
  drop constraint behavior_change_proposals_weekdays_check,
  add constraint behavior_change_proposals_weekdays_check check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  ),
  drop constraint behavior_change_proposals_direction_check,
  add constraint behavior_change_proposals_direction_check
    check (direction in ('later', 'earlier', 'longer', 'shorter')),
  drop constraint behavior_change_proposals_check1,
  add constraint behavior_change_proposals_first_affected_check
    check (first_affected_date >= created_local_date),
  drop constraint behavior_change_proposals_evidence_check,
  add constraint behavior_change_proposals_evidence_check check (
    jsonb_typeof(evidence) = 'object' and evidence ? 'source'
    and evidence ->> 'source' in ('repeated_move', 'card', 'tip') and octet_length(evidence::text) <= 4096
  ),
  drop constraint behavior_change_proposals_close_reason_check,
  add constraint behavior_change_proposals_close_reason_check check (close_reason in (
    'unanswered', 'schedule_changed', 'kept', 'no_answer', 'edited_during_trial', 'undone'
  )),
  add constraint behavior_change_proposals_kind_fields check (
    case change_kind
      when 'time' then weekdays is not null and from_time is not null and to_time is not null
        and schedules_before is not null and schedules_after is not null
        and from_minutes is null and to_minutes is null and direction in ('later', 'earlier')
      else from_minutes is not null and to_minutes is not null and from_minutes <> to_minutes
        and weekdays is null and from_time is null and to_time is null
        and schedules_before is null and schedules_after is null
        and direction in ('longer', 'shorter') and evidence ->> 'source' = 'tip'
    end
  );

drop index cadence_advisor_private.behavior_change_proposals_one_open;
create unique index behavior_change_proposals_one_open_per_behavior
  on cadence_advisor_private.behavior_change_proposals (user_id, behavior_id)
  where status in ('proposed', 'accepted_trial');

-- 7. coach_tips: a tip's offer or link ------------------------------------------------

alter table cadence_advisor_private.coach_tips
  add column proposal_id uuid references cadence_advisor_private.behavior_change_proposals(id) on delete set null,
  -- What the tip's link opens: a Behavior's editor on one field, Needs decision, or the list.
  add column link_target text check (link_target in (
    'time', 'length', 'where', 'description', 'behavior', 'unmarked', 'behaviors'
  )),
  -- The Behavior whose editor the link opens (for an account-wide tip, the first one
  -- missing that field). Deleting the Behavior keeps the tip.
  add column link_behavior_id uuid,
  add constraint coach_tips_link_behavior_owner_fkey
    foreign key (user_id, link_behavior_id) references public.behaviors(user_id, id) on delete set null (link_behavior_id);
create index coach_tips_proposal_idx on cadence_advisor_private.coach_tips (proposal_id) where proposal_id is not null;

-- Coach token only. Stores one proposal for the run's account, or says why not:
-- {"id": uuid} or {"refused": "open_proposal" | "declined_recently" | "behavior_inactive",
-- "open_id"?: uuid, "open_card_id"?: text}. With open_proposal, open_id names the
-- Behavior's open proposal and open_card_id its tip's card, so a re-run of the tip run
-- can link a rewritten tip to the proposal it made before.
create or replace function public.coach_propose_behavior_change(p_run_id uuid, p_proposal jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
  v_kind text;
  v_behavior_id uuid;
  v_direction text;
  v_open cadence_advisor_private.behavior_change_proposals;
  v_id uuid;
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  v_kind := coalesce(p_proposal ->> 'change_kind', 'time');
  if p_proposal is null or jsonb_typeof(p_proposal) <> 'object'
      or jsonb_typeof(p_proposal -> 'evidence') <> 'object' or v_kind not in ('time', 'length')
      or (v_kind = 'time' and jsonb_typeof(p_proposal -> 'weekdays') is distinct from 'array') then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = 'coach' and run.finished_at is null;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;
  v_behavior_id := (p_proposal ->> 'behavior_id')::uuid;
  v_direction := case
    when v_kind = 'length' then
      case when (p_proposal ->> 'to_minutes')::integer > (p_proposal ->> 'from_minutes')::integer then 'longer' else 'shorter' end
    when (p_proposal ->> 'to_time') > (p_proposal ->> 'from_time') then 'later' else 'earlier' end;

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended('behavior_change:' || v_user_id::text, 0));
  perform cadence_private.settle_behavior_change_proposals(v_user_id, v_run.local_date);

  if not exists (select 1 from public.behaviors as b
      where b.user_id = v_user_id and b.id = v_behavior_id and b.active) then
    return jsonb_build_object('refused', 'behavior_inactive');
  end if;
  select * into v_open from cadence_advisor_private.behavior_change_proposals as p
  where p.user_id = v_user_id and p.behavior_id = v_behavior_id and p.status in ('proposed', 'accepted_trial');
  if v_open.id is not null then
    return jsonb_strip_nulls(jsonb_build_object('refused', 'open_proposal', 'open_id', v_open.id,
      'open_card_id', case when v_open.status = 'proposed' and v_open.evidence ->> 'source' = 'tip' then v_open.evidence ->> 'card_id' end));
  end if;
  if exists (select 1 from cadence_advisor_private.behavior_change_proposals as p
      where p.user_id = v_user_id and p.behavior_id = v_behavior_id and p.direction = v_direction
        and p.status = 'declined' and p.status_changed_at > now() - interval '30 days') then
    return jsonb_build_object('refused', 'declined_recently');
  end if;

  insert into cadence_advisor_private.behavior_change_proposals (
    user_id, behavior_id, run_id, created_local_date, change_kind, weekdays, from_time, to_time,
    from_minutes, to_minutes, direction, schedules_before, schedules_after, first_affected_date, reason, evidence
  ) values (
    v_user_id, v_behavior_id, v_run.id, v_run.local_date, v_kind,
    case when v_kind = 'time' then array(select jsonb_array_elements_text(p_proposal -> 'weekdays')) end,
    p_proposal ->> 'from_time', p_proposal ->> 'to_time',
    (p_proposal ->> 'from_minutes')::integer, (p_proposal ->> 'to_minutes')::integer, v_direction,
    p_proposal -> 'schedules_before', p_proposal -> 'schedules_after',
    (p_proposal ->> 'first_affected_date')::date, p_proposal ->> 'reason', p_proposal -> 'evidence'
  ) returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- The person: the proposal to show, as of their local date p_today. Settles what time
-- has closed first. Returns null or the row. With several open (one per Behavior), the
-- first in line is: a check-in that is due, a one-time notice, a question, a trial.
-- p_proposal_id names one of the person's proposals instead, whatever its status: the
-- answer route reads the one it answers (a question not first in line, or Undo).
drop function public.read_behavior_change_proposal(date);
create function public.read_behavior_change_proposal(p_today date, p_proposal_id uuid default null)
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
  where p.user_id = v_user_id
    and (p_proposal_id is null or p.id = p_proposal_id)
    and (
      p_proposal_id is not null
      or p.status in ('proposed', 'accepted_trial')
      or (p.status = 'kept' and p.close_reason in ('no_answer', 'edited_during_trial') and p.notice_shown_at is null)
    )
  order by case
      when p.status = 'accepted_trial' and p.check_in_date <= p_today then 0
      when p.status = 'kept' then 1
      when p.status = 'proposed' then 2
      else 3 end,
    p.status_changed_at desc
  limit 1;
  if v_row.id is null then
    return null;
  end if;
  return to_jsonb(v_row) - 'user_id' - 'run_id';
end;
$$;
revoke all on function public.read_behavior_change_proposal(date, uuid) from public, anon, service_role;
grant execute on function public.read_behavior_change_proposal(date, uuid) to authenticated;

-- The person records an answer, after the server applied any edit it needs.
--   try              proposed -> accepted_trial (needs p_check_in_date)
--   for_good         proposed -> accepted
--   no               proposed -> declined; a tip that carries the proposal is answered "not now"
--   schedule_changed proposed -> expired: the schedule changed before the answer
--   keep             accepted_trial -> kept
--   go_back          accepted_trial -> reverted
--   undo             accepted -> reverted (undone): Undo after Change for good
--   edited           accepted_trial -> kept: the person edited the schedule during the
--                    trial, so Go back is not offered (T4); the person is told once
--   notice_seen      the one-time line about a kept trial was shown
-- Repeating an answer that already took effect returns the row with "replayed": true.
-- Any other answer on a closed proposal raises behavior_change_closed.
create or replace function public.answer_behavior_change_proposal(
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
      'try', 'for_good', 'no', 'schedule_changed', 'keep', 'go_back', 'undo', 'edited', 'notice_seen')
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

  v_from := case
    when p_answer in ('try', 'for_good', 'no', 'schedule_changed') then 'proposed'
    when p_answer = 'undo' then 'accepted'
    else 'accepted_trial' end;
  v_to := case p_answer
    when 'try' then 'accepted_trial' when 'for_good' then 'accepted' when 'no' then 'declined'
    when 'schedule_changed' then 'expired' when 'keep' then 'kept' when 'go_back' then 'reverted'
    when 'undo' then 'reverted' when 'edited' then 'kept' end;
  v_close := case p_answer
    when 'schedule_changed' then 'schedule_changed' when 'keep' then 'kept'
    when 'edited' then 'edited_during_trial' when 'undo' then 'undone' else null end;

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

  -- No on a tip's offer is also "not now" for the tip (the card then rests 30 days for
  -- this Behavior: coach_tip_history reports it).
  if p_answer = 'no' then
    update cadence_advisor_private.coach_tips as tip
    set reaction = 'not_now', reacted_at = statement_timestamp(), shown_at = coalesce(tip.shown_at, statement_timestamp())
    where tip.user_id = v_user_id and tip.proposal_id = v_row.id and tip.reaction is null;
  end if;
  return to_jsonb(v_row) - 'user_id' - 'run_id';
end;
$$;

-- 7. coach_tips functions ---------------------------------------------------------------

create or replace function public.coach_tip_history(p_since date)
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
  if p_since is null then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'tips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'local_date', tip.local_date, 'position', tip.position, 'card_id', tip.card_id,
        'behavior_id', tip.behavior_id, 'fact_ids', to_jsonb(tip.fact_ids), 'fact_values', tip.fact_values,
        'source', tip.source, 'shown_at', tip.shown_at, 'reaction', tip.reaction,
        'proposal_declined', coalesce(proposal.status = 'declined', false)
      ) order by tip.local_date, tip.position)
      from cadence_advisor_private.coach_tips as tip
      left join cadence_advisor_private.behavior_change_proposals as proposal
        on proposal.id = tip.proposal_id and proposal.user_id = tip.user_id
      where tip.user_id = v_user_id and tip.local_date >= p_since
    ), '[]'::jsonb),
    'suppressed', coalesce((
      select jsonb_agg(s.card_id order by s.card_id)
      from cadence_advisor_private.coach_tip_suppressions as s
      where s.user_id = v_user_id
    ), '[]'::jsonb)
  );
end;
$$;

-- p_tips: [{text, card_id, card_revision, behavior_id, fact_ids, fact_values, source,
-- proposal_id?, link_target?, link_behavior_id?}]. A proposal_id must name one of the
-- account's proposals for the same Behavior; otherwise it is dropped.
create or replace function public.coach_write_tips(p_run_id uuid, p_tips jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
  v_item jsonb;
  v_position smallint;
  v_count integer := 0;
  v_behavior_id uuid;
  v_proposal_id uuid;
  v_link_behavior_id uuid;
begin
  if v_agent <> 'coach' then
    raise exception 'agent_channel_required' using errcode = '42501';
  end if;
  if p_tips is null or jsonb_typeof(p_tips) <> 'array' or jsonb_array_length(p_tips) > 3 then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = 'coach' and run.finished_at is null;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;

  -- One writer per account and day at a time.
  perform pg_advisory_xact_lock(hashtextextended('coach_tips:' || v_user_id::text || ':' || v_run.local_date::text, 0));

  delete from cadence_advisor_private.coach_tips as tip
  where tip.user_id = v_user_id and tip.local_date = v_run.local_date
    and tip.shown_at is null and tip.reaction is null;

  select coalesce(max(tip.position), 0) into v_position
  from cadence_advisor_private.coach_tips as tip
  where tip.user_id = v_user_id and tip.local_date = v_run.local_date;

  for v_item in select value from jsonb_array_elements(p_tips) loop
    exit when v_position >= 3;
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'fact_ids') <> 'array'
        or jsonb_typeof(coalesce(v_item -> 'fact_values', '{}'::jsonb)) <> 'object' then
      raise exception 'agent_invalid_input' using errcode = '22023';
    end if;
    continue when exists (select 1 from cadence_advisor_private.coach_tip_suppressions as s
      where s.user_id = v_user_id and s.card_id = v_item ->> 'card_id');
    continue when exists (select 1 from cadence_advisor_private.coach_tips as tip
      where tip.user_id = v_user_id and tip.local_date = v_run.local_date and tip.card_id = v_item ->> 'card_id');
    v_behavior_id := nullif(v_item ->> 'behavior_id', '')::uuid;
    select p.id into v_proposal_id from cadence_advisor_private.behavior_change_proposals as p
    where p.user_id = v_user_id and p.id = nullif(v_item ->> 'proposal_id', '')::uuid and p.behavior_id = v_behavior_id;
    select b.id into v_link_behavior_id from public.behaviors as b
    where b.user_id = v_user_id and b.id = nullif(v_item ->> 'link_behavior_id', '')::uuid;
    v_position := v_position + 1;
    insert into cadence_advisor_private.coach_tips (
      user_id, local_date, position, text, card_id, card_revision, behavior_id, fact_ids, fact_values, source, run_id,
      proposal_id, link_target, link_behavior_id
    ) values (
      v_user_id, v_run.local_date, v_position, v_item ->> 'text', v_item ->> 'card_id',
      (v_item ->> 'card_revision')::integer, v_behavior_id,
      array(select jsonb_array_elements_text(v_item -> 'fact_ids')),
      coalesce(v_item -> 'fact_values', '{}'::jsonb), v_item ->> 'source', v_run.id,
      v_proposal_id, nullif(v_item ->> 'link_target', ''), v_link_behavior_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function cadence_advisor_private.tip_json(p_tip cadence_advisor_private.coach_tips)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_tip.id, 'local_date', p_tip.local_date, 'text', p_tip.text, 'card_id', p_tip.card_id,
    'card_revision', p_tip.card_revision, 'behavior_id', p_tip.behavior_id, 'shown_at', p_tip.shown_at,
    'reaction', p_tip.reaction, 'proposal_id', p_tip.proposal_id, 'link_target', p_tip.link_target,
    'link_behavior_id', p_tip.link_behavior_id
  );
$$;

commit;
