-- Ticket 362 (D33, "Pairing the schedule") smoke check for 20261126210000_alongside_schedule_pairing.sql.
-- Run against a local database with all migrations applied, as postgres:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/ticket-362-alongside-schedule-pairing-smoke.sql
-- Everything runs in one transaction and rolls back.
--   1. The coach token stores a pairing proposal (evidence source alongside_pairing).
--   2. The person reads it back with its evidence, answers Change for good, and Undo.
--   3. The older sources still store (a tip-backed time proposal for another Behavior).
--   4. The table refuses a pairing row without a host, with the guest as its own host,
--      with an unknown basis, as a length change, and an unknown evidence source.
--   5. The coach still sees the No cooldown by direction: a No on the pairing refuses a
--      second proposal in the same direction for the same Behavior.
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('0e620000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'schedule-pairing-smoke@example.invalid', '{}', '{}', now(), now());
update public.profiles set timezone = 'UTC' where id = '0e620000-0000-4000-8000-000000000001';
insert into auth.sessions (id, user_id) values ('0e620000-0000-4000-8000-000000000002', '0e620000-0000-4000-8000-000000000001');
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, default_duration_minutes) values
  ('0e620000-0000-4000-8000-000000000010', '0e620000-0000-4000-8000-000000000001', 'Magnesium',
   '{"frequency":"daily","interval":1}', '07:00', 'UTC', 5),
  ('0e620000-0000-4000-8000-000000000011', '0e620000-0000-4000-8000-000000000001', 'Read',
   '{"frequency":"daily","interval":1}', '20:00', 'UTC', 30),
  ('0e620000-0000-4000-8000-000000000012', '0e620000-0000-4000-8000-000000000001', 'Gym',
   '{"frequency":"daily","interval":1}', '07:00', 'UTC', 60);

set local role authenticated;

do $$
declare
  person constant text := '{"sub":"0e620000-0000-4000-8000-000000000001","role":"authenticated","session_id":"0e620000-0000-4000-8000-000000000002"}';
  coach constant text := '{"sub":"0e620000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}';
  pill constant uuid := '0e620000-0000-4000-8000-000000000010';
  readb constant uuid := '0e620000-0000-4000-8000-000000000011';
  gym constant uuid := '0e620000-0000-4000-8000-000000000012';
  today constant date := current_date;
  morning jsonb := '[{"recurrence": {"frequency": "daily", "interval": 1}, "time_entries": [{"kind": "exact", "start_time": "07:00"}]}]';
  evening jsonb := '[{"recurrence": {"frequency": "daily", "interval": 1}, "time_entries": [{"kind": "exact", "start_time": "20:00"}]}]';
  pairing_body jsonb;
  tip_body jsonb;
  run_id uuid;
  result jsonb;
  pairing_id uuid;
begin
  pairing_body := jsonb_build_object('behavior_id', pill, 'change_kind', 'time', 'weekdays',
    '["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]'::jsonb,
    'from_time', '07:00', 'to_time', '20:00', 'schedules_before', morning, 'schedules_after', evening,
    'first_affected_date', today, 'reason', 'You said Yes to Magnesium during Read on 4 days in the last 28.',
    'evidence', jsonb_build_object('source', 'alongside_pairing', 'basis', 'brief_yes', 'host_behavior_id', readb,
      'signal_ids', '[]'::jsonb, 'yes_days', 4, 'window_days', 28));
  tip_body := jsonb_build_object('behavior_id', gym, 'change_kind', 'time', 'weekdays', '["tuesday"]'::jsonb,
    'from_time', '07:00', 'to_time', '18:30', 'schedules_before', morning,
    'schedules_after', '[{"recurrence": {"frequency": "weekly", "interval": 1, "days_of_week": ["monday","wednesday","thursday","friday","saturday","sunday"]}, "time_entries": [{"kind": "exact", "start_time": "07:00"}]}, {"recurrence": {"frequency": "weekly", "interval": 1, "days_of_week": ["tuesday"]}, "time_entries": [{"kind": "exact", "start_time": "18:30"}]}]'::jsonb,
    'first_affected_date', today, 'reason', 'You moved Gym to about 6:30 PM on 3 Tuesdays.',
    'evidence', jsonb_build_object('source', 'tip', 'signal_kind', 'repeated_move', 'signal_ids', '[]'::jsonb,
      'card_id', 'set-it-where-you-keep-moving-it', 'tip_text', 'You moved Gym to about 6:30 PM on 3 Tuesdays.', 'counts', '[]'::jsonb));

  perform set_config('request.jwt.claims', coach, true);
  select r.run_id into run_id from public.agent_run_start('scheduled', 'openai/gpt-5.6-luna', 'coach-tips-2') as r;

  -- 1 and 3.
  result := public.coach_propose_behavior_change(run_id, pairing_body);
  pairing_id := (result ->> 'id')::uuid;
  if pairing_id is null then raise exception 'pairing proposal not stored: %', result; end if;
  result := public.coach_propose_behavior_change(run_id, tip_body);
  if result ->> 'id' is null then raise exception 'tip proposal not stored: %', result; end if;

  -- 2. The person sees the evidence and answers.
  perform set_config('request.jwt.claims', person, true);
  result := public.read_behavior_change_proposal(today, pairing_id);
  if result -> 'evidence' ->> 'source' <> 'alongside_pairing' or (result -> 'evidence' ->> 'host_behavior_id')::uuid <> readb
      or result ->> 'status' <> 'proposed' then
    raise exception 'pairing read: %', result;
  end if;
  result := public.answer_behavior_change_proposal(pairing_id, 'for_good', today);
  if result ->> 'status' <> 'accepted' then raise exception 'for good: %', result; end if;
  result := public.answer_behavior_change_proposal(pairing_id, 'undo', today);
  if result ->> 'status' <> 'reverted' or result ->> 'close_reason' <> 'undone' then raise exception 'undo: %', result; end if;

  -- 5. A second pairing proposal, answered No; the next one in the same direction is refused.
  perform set_config('request.jwt.claims', coach, true);
  result := public.coach_propose_behavior_change(run_id, pairing_body);
  pairing_id := (result ->> 'id')::uuid;
  if pairing_id is null then raise exception 'second pairing proposal not stored: %', result; end if;
  perform set_config('request.jwt.claims', person, true);
  result := public.answer_behavior_change_proposal(pairing_id, 'no', today);
  if result ->> 'status' <> 'declined' then raise exception 'no: %', result; end if;
  perform set_config('request.jwt.claims', coach, true);
  result := public.coach_propose_behavior_change(run_id, pairing_body);
  if result ->> 'refused' is distinct from 'declined_recently' then raise exception 'cooldown: %', result; end if;
  raise notice 'ticket 362 schedule pairing smoke: ok (part 1)';
end $$;

reset role;

-- 4. The table refuses malformed pairing rows.
do $$
declare
  owner constant uuid := '0e620000-0000-4000-8000-000000000001';
  pill constant uuid := '0e620000-0000-4000-8000-000000000010';
  bad jsonb;
  checked integer := 0;
begin
  foreach bad in array array[
    '{"source": "alongside_pairing", "basis": "brief_yes"}'::jsonb,
    jsonb_build_object('source', 'alongside_pairing', 'basis', 'brief_yes', 'host_behavior_id', pill),
    '{"source": "alongside_pairing", "basis": "guess", "host_behavior_id": "0e620000-0000-4000-8000-000000000011"}'::jsonb,
    '{"source": "pairing_guess", "host_behavior_id": "0e620000-0000-4000-8000-000000000011"}'::jsonb
  ] loop
    begin
      insert into cadence_advisor_private.behavior_change_proposals (user_id, behavior_id, created_local_date, change_kind, weekdays,
        from_time, to_time, direction, schedules_before, schedules_after, first_affected_date, reason, evidence)
      values (owner, pill, current_date, 'time', array['monday'], '07:00', '20:00', 'later', '[]', '[]', current_date, 'r', bad);
      raise exception 'a malformed pairing row was stored: %', bad;
    exception when check_violation then checked := checked + 1;
    end;
  end loop;
  begin
    insert into cadence_advisor_private.behavior_change_proposals (user_id, behavior_id, created_local_date, change_kind,
      from_minutes, to_minutes, direction, first_affected_date, reason, evidence)
    values (owner, pill, current_date, 'length', 5, 10, 'longer', current_date, 'r',
      '{"source": "alongside_pairing", "basis": "brief_yes", "host_behavior_id": "0e620000-0000-4000-8000-000000000011"}');
    raise exception 'a pairing length row was stored';
  exception when check_violation then checked := checked + 1;
  end;
  if checked <> 5 then raise exception 'expected 5 refusals, got %', checked; end if;
  raise notice 'ticket 362 schedule pairing smoke: ok (part 2)';
end $$;

rollback;
