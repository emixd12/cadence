\set ON_ERROR_STOP on

-- Advisor Phase 3A1: brief move proposals and answers (migration 20261118120000).
-- Proposals are written by the Daily Brief agent only; No and Undo hold for the day;
-- "Don't suggest moving this" stops new lines; every answer is logged once per key;
-- Yes applies the line's length with the new duration sources. The Behavior's timezone
-- is picked so it is about 10:00 there now. Synthetic local fixtures; all changes roll back.
begin;

create temporary table t3a1 (name text primary key, value text) on commit drop;
grant all on t3a1 to authenticated;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('3a100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'brief-moves@example.invalid',
   '{"provider":"email","providers":["email"]}', '{}');

do $$
declare
  offset_hours integer := 10 - extract(hour from now() at time zone 'UTC')::integer;
  tz text := case when offset_hours >= 0 then 'Etc/GMT-' || offset_hours else 'Etc/GMT+' || (-offset_hours) end;
  today date;
begin
  today := (now() at time zone tz)::date;
  insert into t3a1 values ('tz', tz), ('today', today::text);
  update public.profiles set timezone = tz where id = '3a100000-0000-4000-8000-000000000001';
  insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, default_duration_minutes) values
    ('3a110000-0000-4000-8000-000000000001', '3a100000-0000-4000-8000-000000000001', 'Gym', '{"type":"daily"}', '13:00', tz, null),
    ('3a110000-0000-4000-8000-000000000002', '3a100000-0000-4000-8000-000000000001', 'Read', '{"type":"daily"}', '15:00', tz, 20),
    ('3a110000-0000-4000-8000-000000000003', '3a100000-0000-4000-8000-000000000001', 'Stretch', '{"type":"daily"}', '16:00', tz, 10);
  insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, schedule_end_time, status) values
    ('3a120000-0000-4000-8000-000000000001', '3a100000-0000-4000-8000-000000000001', '3a110000-0000-4000-8000-000000000001',
     (today + time '13:00') at time zone tz, today, 'exact', '13:00', null, 'unresolved'),
    ('3a120000-0000-4000-8000-000000000002', '3a100000-0000-4000-8000-000000000001', '3a110000-0000-4000-8000-000000000002',
     (today + time '15:00') at time zone tz, today, 'exact', '15:00', null, 'unresolved'),
    ('3a120000-0000-4000-8000-000000000003', '3a100000-0000-4000-8000-000000000001', '3a110000-0000-4000-8000-000000000003',
     (today + time '16:00') at time zone tz, today, 'exact', '16:00', null, 'unresolved');
end $$;

create function pg_temp.at_local(clock time) returns timestamptz language sql stable as $$
  select ((select value from t3a1 where name = 'today')::date + clock) at time zone (select value from t3a1 where name = 'tz')
$$;
create function pg_temp.today() returns date language sql stable as $$ select value::date from t3a1 where name = 'today' $$;
create function pg_temp.revision(occurrence uuid) returns timestamptz language sql stable as $$
  select updated_at from public.occurrences where id = occurrence
$$;
create function pg_temp.line(item uuid, clock_start time, clock_end time) returns jsonb language sql stable as $$
  select jsonb_build_object('occurrence_id', item, 'proposed_start_at', pg_temp.at_local(clock_start),
    'proposed_end_at', pg_temp.at_local(clock_end), 'reason', 'calendar_overlap',
    'expected_revision', pg_temp.revision(item),
    'line', jsonb_build_object('reason', 'Your 1 pm meeting runs into Gym.', 'lengthSource', 'fallback', 'lengthMinutes', 30))
$$;
grant execute on function pg_temp.at_local(time) to authenticated;
grant execute on function pg_temp.today() to authenticated;
grant execute on function pg_temp.revision(uuid) to authenticated;
grant execute on function pg_temp.line(uuid, time, time) to authenticated;

set local role authenticated;

do $$
declare
  gym uuid := '3a120000-0000-4000-8000-000000000001';
  read_item uuid := '3a120000-0000-4000-8000-000000000002';
  stretch uuid := '3a120000-0000-4000-8000-000000000003';
  r jsonb;
  rows_written integer;
  gym_proposal uuid;
  read_proposal uuid;
  run uuid;
begin
  -- The person cannot write proposals; only the Daily Brief agent can.
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  begin
    perform public.record_brief_move_proposals(null, pg_temp.today(), jsonb_build_array(pg_temp.line(gym, '17:00', '17:30')));
    raise exception 'A person wrote a proposal';
  exception when insufficient_privilege then null;
  end;
  -- The coach cannot either.
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}', true);
  begin
    perform public.record_brief_move_proposals(null, pg_temp.today(), jsonb_build_array(pg_temp.line(gym, '17:00', '17:30')));
    raise exception 'The coach wrote a proposal';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}', true);
  perform public.agent_ensure_grant();
  select run_id into run from public.agent_run_start('on_demand', 'openai/gpt-5.6-luna', 'test');
  select count(*) into rows_written from public.record_brief_move_proposals(run, pg_temp.today(), jsonb_build_array(
    pg_temp.line(gym, '17:00', '17:30'), pg_temp.line(read_item, '18:00', '18:20')));
  if rows_written <> 2 then raise exception 'Expected two proposals, got %', rows_written; end if;
  select id into gym_proposal from public.move_proposals where occurrence_id = gym and status = 'proposed';
  select id into read_proposal from public.move_proposals where occurrence_id = read_item and status = 'proposed';
  if (select line ->> 'reason' from public.move_proposals where id = gym_proposal) <> 'Your 1 pm meeting runs into Gym.'
    or (select agent_run_id from public.move_proposals where id = gym_proposal) <> run then
    raise exception 'The proposal did not keep its line or run';
  end if;

  -- Yes through the agent: the fallback length is a valid duration source now.
  r := public.move_occurrence_for_day(gym, pg_temp.revision(gym), pg_temp.at_local('17:00'), pg_temp.at_local('17:30'), 1800,
    'fallback', 'calendar_overlap', gym_proposal, 'yes-1', repeat('a', 64));
  if r ->> 'outcome' <> 'applied' or r #>> '{move,source}' <> 'daily_brief' or r #>> '{move,duration_source}' <> 'fallback' then
    raise exception 'Yes did not apply with the fallback length: %', r;
  end if;
  r := public.answer_move_proposal(gym_proposal, 'yes', 'applied', 'yes-1', (r #>> '{move,id}')::uuid);
  if r #>> '{proposal,status}' <> 'accepted' or r #>> '{answer,source}' <> 'daily_brief' or r #>> '{proposal,move_id}' is null then
    raise exception 'Yes was not recorded: %', r;
  end if;
  -- Same key again: replayed, nothing new logged.
  r := public.answer_move_proposal(gym_proposal, 'yes', 'applied', 'yes-1', null);
  if (r ->> 'replayed')::boolean is not true or (select count(*) from public.move_proposal_answers where proposal_id = gym_proposal) <> 1 then
    raise exception 'A retried answer was logged twice: %', r;
  end if;
  -- Same key, different kind: refused.
  begin
    perform public.answer_move_proposal(gym_proposal, 'no', 'applied', 'yes-1', null);
    raise exception 'A reused key with another kind was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'move_answer_idempotency_key_reused' then raise; end if;
  end;

  -- Undo (the person), then the line reads undone, and a Refresh does not offer Gym again.
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  r := public.revert_occurrence_move(gym, pg_temp.revision(gym), null, null, null);
  r := public.answer_move_proposal(gym_proposal, 'undo', 'applied', 'undo-1', (r #>> '{move,id}')::uuid);
  if r #>> '{proposal,status}' <> 'undone' or r #>> '{answer,source}' <> 'person' then
    raise exception 'Undo was not recorded as undone: %', r;
  end if;

  -- No on Read.
  r := public.answer_move_proposal(read_proposal, 'no', 'applied', 'no-1');
  if r #>> '{proposal,status}' <> 'declined' then raise exception 'No was not recorded: %', r; end if;
  -- A closed line refuses another applied answer.
  begin
    perform public.answer_move_proposal(read_proposal, 'other_time', 'applied', 'ot-1');
    raise exception 'A declined line accepted Other time';
  exception when invalid_parameter_value then
    if sqlerrm <> 'move_proposal_closed' then raise; end if;
  end;
  -- A refused answer is logged and changes nothing.
  r := public.answer_move_proposal(read_proposal, 'other_time', 'refused', 'ot-2', null, 'slot_taken');
  if r #>> '{proposal,status}' <> 'declined' or r #>> '{answer,refusal_reason}' <> 'slot_taken' then
    raise exception 'A refused answer changed status: %', r;
  end if;

  -- "Don't suggest moving this" on Stretch is the person's own switch.
  perform public.set_behavior_move_preference('3a110000-0000-4000-8000-000000000003', true);

  -- Refresh: Gym (undone) and Read (declined) are skipped, Stretch (never move) too.
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}', true);
  begin
    perform public.set_behavior_move_preference('3a110000-0000-4000-8000-000000000003', false);
    raise exception 'The agent changed a move preference';
  exception when insufficient_privilege then null;
  end;
  select count(*) into rows_written from public.record_brief_move_proposals(run, pg_temp.today(), jsonb_build_array(
    pg_temp.line(gym, '18:30', '19:00'), pg_temp.line(read_item, '19:00', '19:20'), pg_temp.line(stretch, '19:30', '19:40')), true);
  if rows_written <> 0 then raise exception 'A declined, undone or never-move item was offered again (% rows)', rows_written; end if;

end $$;

-- Person-only writes: the length correction replaces the cached estimate.
do $$
declare
  rev timestamptz;
  rows_written integer;
begin
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}', true);
  rows_written := public.upsert_behavior_advisor_estimates(jsonb_build_array(jsonb_build_object(
    'behavior_id', '3a110000-0000-4000-8000-000000000001', 'input_hash', repeat('b', 64), 'duration_minutes', 45, 'alongside', false,
    'model', 'openai/gpt-5.6-luna')));
  if rows_written <> 1 or (select duration_minutes from public.behavior_advisor_estimates where behavior_id = '3a110000-0000-4000-8000-000000000001') <> 45 then
    raise exception 'The estimate was not cached';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  begin
    perform public.upsert_behavior_advisor_estimates('[]'::jsonb);
    raise exception 'A person wrote the estimate cache';
  exception when insufficient_privilege then null;
  end;
  select updated_at into rev from public.behaviors where id = '3a110000-0000-4000-8000-000000000001';
  begin
    perform public.set_behavior_default_length('3a110000-0000-4000-8000-000000000001', 40, rev - interval '1 second');
    raise exception 'A stale length correction was accepted';
  exception when raise_exception then
    if sqlerrm <> 'behavior_revision_changed' then raise; end if;
  end;
  perform public.set_behavior_default_length('3a110000-0000-4000-8000-000000000001', 40, rev);
  if (select default_duration_minutes from public.behaviors where id = '3a110000-0000-4000-8000-000000000001') <> 40
    or exists (select 1 from public.behavior_advisor_estimates where behavior_id = '3a110000-0000-4000-8000-000000000001') then
    raise exception 'The correction did not replace the cached estimate';
  end if;
end $$;

select 'advisor 3A1 brief move answers: ok' as result;
rollback;
