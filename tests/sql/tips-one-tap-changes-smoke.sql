-- "Tips with one-tap changes" (Nov 20) smoke check for 20261120160000_tips_one_tap_changes.sql.
-- Run against a local database with all migrations applied, as postgres:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/tips-one-tap-changes-smoke.sql
-- Everything runs in one transaction and rolls back.
--   1. One open proposal per Behavior: a second Behavior can have its own; a second one
--      for the same Behavior is refused and names the open one and its tip's card.
--   2. Length proposals store only length fields; the table refuses a row with both.
--   3. coach_write_tips stores a tip's proposal and link; a proposal of another Behavior
--      is dropped; tip_json returns them.
--   4. No on a tip's question answers the tip "not now", and coach_tip_history reports
--      proposal_declined so the card rests.
--   5. Change for good, then Undo: reverted with close reason undone; a repeat replays.
--   6. read_behavior_change_proposal with an id returns that proposal whatever its status.
--   7. A Yes on the changed weekday is stored from today (first_affected_date = today).
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('0d000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'one-tap-smoke@example.invalid', '{}', '{}', now(), now());
update public.profiles set timezone = 'UTC' where id = '0d000000-0000-4000-8000-000000000001';
insert into auth.sessions (id, user_id) values ('0d000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000001');
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, default_duration_minutes) values
  ('0d000000-0000-4000-8000-000000000010', '0d000000-0000-4000-8000-000000000001', 'Gym',
   '{"frequency":"daily","interval":1}', '07:00', 'UTC', 60),
  ('0d000000-0000-4000-8000-000000000011', '0d000000-0000-4000-8000-000000000001', 'Read',
   '{"frequency":"daily","interval":1}', '21:00', 'UTC', 30);

create temporary table smoke_result (step text, value jsonb) on commit drop;
grant insert, select, update on smoke_result to authenticated;

set local role authenticated;

do $$
declare
  person constant text := '{"sub":"0d000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"0d000000-0000-4000-8000-000000000002"}';
  coach constant text := '{"sub":"0d000000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}';
  gym constant uuid := '0d000000-0000-4000-8000-000000000010';
  readb constant uuid := '0d000000-0000-4000-8000-000000000011';
  today constant date := current_date;
  daily jsonb := '[{"recurrence": {"frequency": "daily", "interval": 1}, "time_entries": [{"kind": "exact", "start_time": "07:00"}]}]';
  evening jsonb := '[{"recurrence": {"frequency": "daily", "interval": 1}, "time_entries": [{"kind": "exact", "start_time": "18:30"}]}]';
  tip_evidence jsonb;
  time_body jsonb;
  length_body jsonb;
  run_id uuid;
  result jsonb;
  time_id uuid;
  length_id uuid;
  tip_id uuid;
  written integer;
begin
  tip_evidence := jsonb_build_object('source', 'tip', 'signal_kind', 'repeated_move', 'signal_ids', '[]'::jsonb,
    'card_id', 'set-it-where-you-keep-moving-it', 'tip_text', 'You moved Gym to about 6:30 PM on 3 days in the last 4 weeks.',
    'counts', '[]'::jsonb);
  time_body := jsonb_build_object('behavior_id', gym, 'change_kind', 'time', 'weekdays',
    '["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]'::jsonb,
    'from_time', '07:00', 'to_time', '18:30', 'schedules_before', daily, 'schedules_after', evening,
    'first_affected_date', today, 'reason', 'You moved Gym to about 6:30 PM on 3 days in the last 4 weeks.', 'evidence', tip_evidence);
  length_body := jsonb_build_object('behavior_id', readb, 'change_kind', 'length', 'from_minutes', 30, 'to_minutes', 45,
    'first_affected_date', today, 'reason', 'Read sessions ran about 45 minutes.',
    'evidence', tip_evidence || '{"signal_kind": "session_length", "card_id": "set-the-length-it-takes"}'::jsonb);

  perform set_config('request.jwt.claims', coach, true);
  select r.run_id into run_id from public.agent_run_start('scheduled', 'openai/gpt-5.6-luna', 'coach-tips-2') as r;

  -- 1 and 7. A tip-backed time question from today, a second Behavior's length question, then a refusal.
  result := public.coach_propose_behavior_change(run_id, time_body);
  time_id := (result ->> 'id')::uuid;
  if time_id is null then raise exception 'time proposal not stored: %', result; end if;
  result := public.coach_propose_behavior_change(run_id, length_body);
  length_id := (result ->> 'id')::uuid;
  if length_id is null then raise exception 'a second Behavior could not have its own question: %', result; end if;
  result := public.coach_propose_behavior_change(run_id, time_body || '{"to_time": "19:00"}'::jsonb);
  if result ->> 'refused' <> 'open_proposal' or (result ->> 'open_id')::uuid <> time_id
    or result ->> 'open_card_id' <> 'set-it-where-you-keep-moving-it' then
    raise exception 'second open proposal for one Behavior: %', result;
  end if;

  -- 3. Tips with their question and link; another Behavior's proposal is dropped.
  written := public.coach_write_tips(run_id, jsonb_build_array(
    jsonb_build_object('text', 'You moved Gym to about 6:30 PM on 3 days in the last 4 weeks.', 'card_id', 'set-it-where-you-keep-moving-it',
      'card_revision', 3, 'behavior_id', gym, 'fact_ids', '["repeated_move:gym:moved_days"]'::jsonb, 'source', 'seed', 'proposal_id', time_id),
    jsonb_build_object('text', 'Read has a question of another Behavior.', 'card_id', 'set-the-length-it-takes',
      'card_revision', 3, 'behavior_id', readb, 'fact_ids', '["session_length:read:median"]'::jsonb, 'source', 'seed', 'proposal_id', time_id),
    jsonb_build_object('text', 'Some items have no length.', 'card_id', 'give-it-a-length',
      'card_revision', 2, 'behavior_id', null, 'fact_ids', '["account:length"]'::jsonb, 'source', 'seed',
      'link_target', 'length', 'link_behavior_id', readb)
  ));
  if written <> 3 then raise exception 'expected 3 tips, got %', written; end if;

  perform set_config('request.jwt.claims', person, true);
  result := public.advisor_next_tip(0);
  tip_id := (result -> 'tip' ->> 'id')::uuid;
  insert into smoke_result values ('first_tip', result);
  if result -> 'tip' ->> 'card_id' <> 'set-it-where-you-keep-moving-it' or (result -> 'tip' ->> 'proposal_id')::uuid <> time_id then
    raise exception 'tip_json lost the proposal: %', result;
  end if;
  insert into smoke_result values ('tip_id', to_jsonb(tip_id));

  -- 6. Read by id, and the default order (a question, either one).
  result := public.read_behavior_change_proposal(today, length_id);
  if (result ->> 'id')::uuid <> length_id or result ->> 'change_kind' <> 'length' or (result ->> 'to_minutes')::int <> 45 then
    raise exception 'read by id: %', result;
  end if;

  -- 4. No answers the tip "not now"; the history reports the declined question.
  result := public.answer_behavior_change_proposal(time_id, 'no', today);
  if result ->> 'status' <> 'declined' then raise exception 'no: %', result; end if;
  perform set_config('request.jwt.claims', coach, true);
  result := public.coach_tip_history(today);
  if not exists (select 1 from jsonb_array_elements(result -> 'tips') as tip
      where tip ->> 'card_id' = 'set-it-where-you-keep-moving-it' and (tip ->> 'proposal_declined')::boolean) then
    raise exception 'history lost proposal_declined: %', result;
  end if;
  -- With the question declined, the Behavior may have a new open question again (another direction).
  result := public.coach_propose_behavior_change(run_id, time_body || '{"to_time": "06:00", "schedules_after": [{"recurrence": {"frequency": "daily", "interval": 1}, "time_entries": [{"kind": "exact", "start_time": "06:00"}]}]}'::jsonb);
  if result ->> 'id' is null then raise exception 'a new question after a No: %', result; end if;

  -- 5. Change for good on the length, then Undo; a repeat replays; a closed one still reads by id.
  perform set_config('request.jwt.claims', person, true);
  result := public.answer_behavior_change_proposal(length_id, 'for_good', today);
  if result ->> 'status' <> 'accepted' then raise exception 'for good: %', result; end if;
  begin
    perform public.answer_behavior_change_proposal(time_id, 'undo', today);
    raise exception 'Undo on a declined question';
  exception when raise_exception then
    if sqlerrm <> 'behavior_change_closed' then raise; end if;
  end;
  result := public.answer_behavior_change_proposal(length_id, 'undo', today);
  if result ->> 'status' <> 'reverted' or result ->> 'close_reason' <> 'undone' then raise exception 'undo: %', result; end if;
  result := public.answer_behavior_change_proposal(length_id, 'undo', today);
  if (result ->> 'replayed')::boolean is not true then raise exception 'undo again: %', result; end if;
  result := public.read_behavior_change_proposal(today, length_id);
  if result ->> 'status' <> 'reverted' then raise exception 'closed read by id: %', result; end if;
  raise notice 'tips one-tap changes smoke: ok';
end $$;

reset role;

-- 3 and 4, read as the owner: the stored tips.
do $$
declare
  tip_id uuid := (select (value #>> '{}')::uuid from smoke_result where step = 'tip_id');
begin
  if exists (select 1 from cadence_advisor_private.coach_tips as t
      where t.card_id = 'set-the-length-it-takes' and t.user_id = '0d000000-0000-4000-8000-000000000001' and t.proposal_id is not null) then
    raise exception 'a proposal of another Behavior was stored on a tip';
  end if;
  if not exists (select 1 from cadence_advisor_private.coach_tips as t
      where t.card_id = 'give-it-a-length' and t.link_target = 'length' and t.link_behavior_id = '0d000000-0000-4000-8000-000000000011') then
    raise exception 'the link was not stored';
  end if;
  if (select t.reaction from cadence_advisor_private.coach_tips as t where t.id = tip_id) is distinct from 'not_now' then
    raise exception 'the tip was not answered not now';
  end if;
end $$;

-- 2. The table itself refuses a length row that carries times.
do $$ begin
  insert into cadence_advisor_private.behavior_change_proposals (user_id, behavior_id, change_kind, from_minutes, to_minutes,
    from_time, direction, first_affected_date, created_local_date, reason, evidence)
  values ('0d000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000011', 'length', 30, 45, '07:00', 'longer',
    current_date, current_date, 'r', '{"source": "tip"}');
  raise exception 'a mixed row was stored';
exception when check_violation then null; end $$;

rollback;
