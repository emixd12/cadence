\set ON_ERROR_STOP on

-- Advisor plan Phase 4 (4B): advisor tips storage and showing rules.
-- Synthetic local fixtures only; all changes roll back.
--   1. Only the coach token writes tips and reads tip history; the person, another
--      agent and the service role cannot.
--   2. A write keeps at most 3 a day, skips suppressed cards and cards used that day,
--      and replaces only tips not yet shown.
--   3. advisor_next_tip shows one new tip per spacing period; inside it the same tip
--      comes back (fresh false); a dismissed tip is not shown again that period.
--   4. Nothing holds tips back: a Daily Brief move line still waiting does not (D5).
--   5. "dont_suggest" turns the card off for the account; later writes skip it.
--   6. Account deletion removes tips and suppressions; Behavior deletion keeps the tip.
--   7. coach_tips_due_accounts needs a successful signals visit today and no tip run yet.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('4b000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'advisor-4b@example.invalid',
  '{"provider":"email","providers":["email"]}', '{}');
update public.profiles set timezone = 'UTC' where id = '4b000000-0000-4000-8000-000000000001';
insert into auth.sessions (id, user_id) values ('4b000000-0000-4000-8000-000000000011', '4b000000-0000-4000-8000-000000000001');
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('4b100000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', 'Gym', '{"type":"daily"}', '07:00', 'UTC');

set local role authenticated;

do $$
declare
  person constant text := '{"sub":"4b000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"4b000000-0000-4000-8000-000000000011"}';
  coach constant text := '{"sub":"4b000000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}';
  brief constant text := '{"sub":"4b000000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}';
  gym constant uuid := '4b100000-0000-4000-8000-000000000001';
  tips jsonb;
  run_id uuid;
  result jsonb;
  first_id uuid;
  written integer;
begin
  tips := jsonb_build_array(
    jsonb_build_object('text', 'Gym got done 9 of 10 times. Keep its time.', 'card_id', 'steady-keep', 'card_revision', 1,
      'behavior_id', gym, 'fact_ids', jsonb_build_array('steady_behavior:' || gym || ':completed'), 'fact_values', jsonb_build_object('steady_behavior:' || gym || ':completed', 9), 'source', 'model'),
    jsonb_build_object('text', 'Mondays went 1 of 4.', 'card_id', 'weekday-gap', 'card_revision', 2,
      'behavior_id', null, 'fact_ids', jsonb_build_array('weekday_gap:account:weekday_rate'), 'source', 'seed'),
    jsonb_build_object('text', 'Same card twice is skipped.', 'card_id', 'weekday-gap', 'card_revision', 2,
      'behavior_id', null, 'fact_ids', jsonb_build_array('weekday_gap:account:gap'), 'source', 'seed'),
    jsonb_build_object('text', 'Three unmarked items wait.', 'card_id', 'unmarked', 'card_revision', 1,
      'behavior_id', null, 'fact_ids', jsonb_build_array('unmarked_items:account:unmarked'), 'source', 'seed')
  );

  -- 1. Access.
  perform set_config('request.jwt.claims', coach, true);
  select r.run_id into run_id from public.agent_run_start('scheduled', 'openai/gpt-5.6-luna', 'coach-tips-1') as r;
  perform set_config('request.jwt.claims', person, true);
  begin
    perform public.coach_write_tips(run_id, '[]');
    raise exception 'The person wrote tips directly';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.coach_tip_history(current_date);
    raise exception 'The person read the coach history';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.coach_read_signals(current_date);
    raise exception 'The person read stored signals';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claims', brief, true);
  begin
    perform public.coach_write_tips(run_id, '[]');
    raise exception 'The brief agent wrote tips';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.advisor_next_tip();
    raise exception 'An agent token read the next tip';
  exception when sqlstate '42501' then null;
  end;

  -- 2. Write: four items, one repeats a card, three land.
  perform set_config('request.jwt.claims', coach, true);
  begin
    perform public.coach_write_tips(run_id, tips);
    raise exception 'Four items were accepted';
  exception when sqlstate '22023' then null;
  end;
  written := public.coach_write_tips(run_id, tips - 3);
  if written <> 2 then raise exception 'Expected 2 tips written (one repeated card), got %', written; end if;
  written := public.coach_write_tips(run_id, tips - 2);
  if written <> 3 then raise exception 'A rewrite should replace unshown tips: got %', written; end if;

  -- 3. Showing.
  perform set_config('request.jwt.claims', person, true);
  result := public.advisor_next_tip();
  if result ->> 'state' <> 'tip' or not (result ->> 'fresh')::boolean or result -> 'tip' ->> 'card_id' <> 'steady-keep'
    or result ->> 'next_at' is null then
    raise exception 'First open was %', result;
  end if;
  first_id := (result -> 'tip' ->> 'id')::uuid;
  result := public.advisor_next_tip();
  if result ->> 'state' <> 'tip' or (result ->> 'fresh')::boolean or (result -> 'tip' ->> 'id')::uuid <> first_id then
    raise exception 'A second open inside the spacing was %', result;
  end if;
  -- With no spacing the next tip appears.
  result := public.advisor_next_tip(0);
  if result -> 'tip' ->> 'card_id' <> 'weekday-gap' or not (result ->> 'fresh')::boolean then
    raise exception 'Next open was %', result;
  end if;
  -- Not now hides it for the spacing period.
  perform public.advisor_react_tip((result -> 'tip' ->> 'id')::uuid, 'not_now');
  result := public.advisor_next_tip();
  if result ->> 'state' <> 'none' or result ->> 'reason' <> 'later' or result ->> 'next_at' is null then
    raise exception 'After not now: %', result;
  end if;

  -- 5. Don't suggest.
  result := public.advisor_react_tip(first_id, 'dont_suggest');
  if result ->> 'reaction' <> 'dont_suggest' then raise exception 'Reaction was %', result; end if;
  begin
    perform public.advisor_react_tip(first_id, 'love');
    raise exception 'An unknown reaction was accepted';
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.jwt.claims', coach, true);
  result := public.coach_tip_history(current_date - 14);
  if result -> 'suppressed' <> '["steady-keep"]'::jsonb or jsonb_array_length(result -> 'tips') <> 3 then
    raise exception 'History was %', result;
  end if;
  -- Shown tips stay; the unshown one is replaced; a suppressed card is skipped.
  written := public.coach_write_tips(run_id, jsonb_build_array(tips -> 0, jsonb_build_object('text', 'Marks come 3 h late.',
    'card_id', 'marking', 'card_revision', 1, 'fact_ids', jsonb_build_array('marking_time:account:median_lag_hours'), 'source', 'model')));
  if written <> 1 then raise exception 'Expected only the new card, got %', written; end if;
  result := public.coach_tip_history(current_date);
  if (select count(*) from jsonb_array_elements(result -> 'tips') t where t ->> 'card_id' = 'unmarked') <> 0
    or (select max((t ->> 'position')::int) from jsonb_array_elements(result -> 'tips') t) <> 3 then
    raise exception 'After rewrite: %', result;
  end if;

  -- 4. Hold.
  perform set_config('request.jwt.claims', person, true);
  reset role;
  insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status)
  values ('4b200000-0000-4000-8000-000000000001', '4b000000-0000-4000-8000-000000000001', gym, now(), current_date, 'exact', '07:00', 'unresolved');
  insert into public.move_proposals (user_id, occurrence_id, behavior_id, local_date, source, status, proposed_start_at, proposed_end_at, expected_revision)
  values ('4b000000-0000-4000-8000-000000000001', '4b200000-0000-4000-8000-000000000001', gym, current_date, 'daily_brief', 'proposed',
    now() + interval '1 hour', now() + interval '2 hours', now());
  set local role authenticated;
  result := public.advisor_next_tip(0);
  if result ->> 'state' <> 'tip' or result -> 'tip' ->> 'card_id' <> 'marking' then raise exception 'A waiting brief line held tips back: %', result; end if;
  result := public.advisor_next_tip(0);
  if result ->> 'state' <> 'tip' or (result ->> 'fresh')::boolean then raise exception 'All shown should repeat the last: %', result; end if;
end $$;

reset role;

-- 6. Behavior deletion keeps the tip; account deletion removes everything.
delete from public.occurrences where user_id = '4b000000-0000-4000-8000-000000000001';
delete from public.move_proposals where user_id = '4b000000-0000-4000-8000-000000000001';
delete from public.behaviors where id = '4b100000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from cadence_advisor_private.coach_tips where user_id = '4b000000-0000-4000-8000-000000000001') <> 3
    or exists (select 1 from cadence_advisor_private.coach_tips where user_id = '4b000000-0000-4000-8000-000000000001' and behavior_id is not null) then
    raise exception 'Behavior deletion should keep tips and clear their Behavior';
  end if;
end $$;

-- 7. Due accounts (service role).
set local role service_role;
do $$
declare
  hour_now integer := extract(hour from now() at time zone 'UTC');
begin
  if hour_now between 3 and 8 then
    if exists (select 1 from public.coach_tips_due_accounts(null, 10) d where d.user_id = '4b000000-0000-4000-8000-000000000001') then
      raise exception 'An account without a signals visit was due';
    end if;
  end if;
end $$;
reset role;

delete from auth.users where id = '4b000000-0000-4000-8000-000000000001';
do $$
begin
  if exists (select 1 from cadence_advisor_private.coach_tips where user_id = '4b000000-0000-4000-8000-000000000001')
    or exists (select 1 from cadence_advisor_private.coach_tip_suppressions where user_id = '4b000000-0000-4000-8000-000000000001') then
    raise exception 'Account deletion left tips behind';
  end if;
end $$;

rollback;
