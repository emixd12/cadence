\set ON_ERROR_STOP on

-- Advisor Phase 2A: move_occurrence_for_day and revert_occurrence_move
-- (migration 20261117110000). Each case of the precedence table in
-- docs/DATETIME_STRATEGY.md "Moves", the tap-time checks, callers and scopes, reason
-- chips and conflict notices. The Behavior's timezone is picked so it is about 10:00
-- there now, which keeps "today" and "later today" stable whenever the test runs.
-- Synthetic local fixtures only; all changes roll back.
begin;

create temporary table moves_2a (name text primary key, value text) on commit drop;
grant all on moves_2a to authenticated;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('2a100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'moves-fn@example.invalid',
   '{"provider":"email","providers":["email"]}', '{}'),
  ('2a100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'moves-fn-other@example.invalid',
   '{"provider":"email","providers":["email"]}', '{}');

do $$
declare
  offset_hours integer := 10 - extract(hour from now() at time zone 'UTC')::integer;
  tz text := case when offset_hours >= 0 then 'Etc/GMT-' || offset_hours else 'Etc/GMT+' || (-offset_hours) end;
  today date;
begin
  today := (now() at time zone tz)::date;
  insert into moves_2a values ('tz', tz), ('today', today::text);
  insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, default_duration_minutes) values
    ('2a110000-0000-4000-8000-000000000001', '2a100000-0000-4000-8000-000000000001', 'Gym', '{"type":"daily"}', '13:00', tz, 60),
    ('2a110000-0000-4000-8000-000000000002', '2a100000-0000-4000-8000-000000000001', 'Walk', '{"type":"daily"}', '08:00', tz, null);
  insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, schedule_end_time, status) values
    -- Gym today at 13:00, Unresolved.
    ('2a120000-0000-4000-8000-000000000001', '2a100000-0000-4000-8000-000000000001', '2a110000-0000-4000-8000-000000000001',
     (today + time '13:00') at time zone tz, today, 'exact', '13:00', null, 'unresolved'),
    -- Gym yesterday.
    ('2a120000-0000-4000-8000-000000000002', '2a100000-0000-4000-8000-000000000001', '2a110000-0000-4000-8000-000000000001',
     ((today - 1) + time '13:00') at time zone tz, today - 1, 'exact', '13:00', null, 'unresolved'),
    -- Walk today as a Morning range.
    ('2a120000-0000-4000-8000-000000000003', '2a100000-0000-4000-8000-000000000001', '2a110000-0000-4000-8000-000000000002',
     (today + time '08:00') at time zone tz, today, 'range', '08:00', '12:00', 'unresolved'),
    -- Gym tomorrow (for the status rule).
    ('2a120000-0000-4000-8000-000000000004', '2a100000-0000-4000-8000-000000000001', '2a110000-0000-4000-8000-000000000001',
     ((today + 1) + time '13:00') at time zone tz, today + 1, 'exact', '13:00', null, 'unresolved');
end $$;

create function pg_temp.at_local(clock time) returns timestamptz language sql stable as $$
  select ((select value from moves_2a where name = 'today')::date + clock) at time zone (select value from moves_2a where name = 'tz')
$$;
create function pg_temp.revision(occurrence uuid) returns timestamptz language sql stable as $$
  select updated_at from public.occurrences where id = occurrence
$$;
grant execute on function pg_temp.at_local(time) to authenticated;
grant execute on function pg_temp.revision(uuid) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2a100000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  gym uuid := '2a120000-0000-4000-8000-000000000001';
  r jsonb;
  first_move jsonb;
  second_move jsonb;
  rev timestamptz;
begin
  -- A person moves Gym from 13:00 to 15:00 for today.
  rev := pg_temp.revision(gym);
  r := public.move_occurrence_for_day(gym, rev, pg_temp.at_local('15:00'), pg_temp.at_local('16:00'), 3600,
    'behavior_duration', null, null, 'tap-1', repeat('1', 64));
  if r ->> 'outcome' <> 'applied' or r #>> '{move,source}' <> 'person' or (r #>> '{move,from_planned}')::boolean is not true
    or (r #>> '{move,chain_position}')::integer <> 1 or r #>> '{move,chain_root_id}' <> r #>> '{move,id}' then
    raise exception 'First move is wrong: %', r;
  end if;
  first_move := r -> 'move';
  if (select effective_start_at from public.occurrences where id = gym) <> pg_temp.at_local('15:00')
    or (select scheduled_for from public.occurrences where id = gym) <> pg_temp.at_local('13:00') then
    raise exception 'The move changed the plan or missed effective time';
  end if;

  -- Same key, same request: the first result, nothing applied twice.
  r := public.move_occurrence_for_day(gym, rev, pg_temp.at_local('15:00'), pg_temp.at_local('16:00'), 3600,
    'behavior_duration', null, null, 'tap-1', repeat('1', 64));
  if r ->> 'outcome' <> 'replayed' or r #>> '{move,id}' <> first_move ->> 'id'
    or (select count(*) from public.occurrence_moves where occurrence_id = gym) <> 1 then
    raise exception 'A retried tap applied twice: %', r;
  end if;
  -- Same key, different request: refused.
  begin
    perform public.move_occurrence_for_day(gym, rev, pg_temp.at_local('17:00'), pg_temp.at_local('18:00'), 3600,
      'behavior_duration', null, null, 'tap-1', repeat('2', 64));
    raise exception 'A reused key with different input was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'occurrence_move_idempotency_key_reused' then raise; end if;
  end;

  -- Two moves from the same revision: the first wins, the second is refused with the current state.
  r := public.move_occurrence_for_day(gym, rev, pg_temp.at_local('17:00'), pg_temp.at_local('18:00'), 3600,
    'behavior_duration', null, null, null, null);
  if r ->> 'outcome' <> 'refused' or r ->> 'reason' <> 'revision_changed'
    or (r #>> '{occurrence,effective_start_at}')::timestamptz <> pg_temp.at_local('15:00')
    or r #>> '{latest_move,id}' <> first_move ->> 'id' then
    raise exception 'A stale second move was not refused with the current state: %', r;
  end if;

  -- A re-move from the current revision continues the chain.
  r := public.move_occurrence_for_day(gym, pg_temp.revision(gym), pg_temp.at_local('17:00'), pg_temp.at_local('18:00'), 3600,
    'kept_length', 'late_start', null, null, null);
  second_move := r -> 'move';
  if r ->> 'outcome' <> 'applied' or (second_move ->> 'chain_position')::integer <> 2
    or second_move ->> 'revises_move_id' <> first_move ->> 'id' or second_move ->> 'chain_root_id' <> first_move ->> 'id'
    or (second_move ->> 'from_start_at')::timestamptz <> pg_temp.at_local('15:00') or (second_move ->> 'from_planned')::boolean then
    raise exception 'Re-move is wrong: %', r;
  end if;

  -- Undo reverses only the latest move: naming the replaced one is refused.
  r := public.revert_occurrence_move(gym, pg_temp.revision(gym), (first_move ->> 'id')::uuid, null, null);
  if r ->> 'outcome' <> 'refused' or r ->> 'reason' <> 'not_latest_move' then
    raise exception 'Undo of a replaced move was not refused: %', r;
  end if;
  -- Undo the latest: back to the earlier move.
  r := public.revert_occurrence_move(gym, pg_temp.revision(gym), (second_move ->> 'id')::uuid, 'undo-1', repeat('3', 64));
  if r ->> 'outcome' <> 'applied' or r #>> '{move,kind}' <> 'revert'
    or (select effective_start_at from public.occurrences where id = gym) <> pg_temp.at_local('15:00') then
    raise exception 'Undo did not restore the earlier move: %', r;
  end if;
  -- Undo again: the latest record is an Undo, so there is nothing to undo.
  r := public.revert_occurrence_move(gym, pg_temp.revision(gym), null, null, null);
  if r ->> 'outcome' <> 'refused' or r ->> 'reason' <> 'nothing_to_undo' then
    raise exception 'A second Undo was not refused: %', r;
  end if;
  -- Move, then Undo back to the plan: effective time clears.
  r := public.move_occurrence_for_day(gym, pg_temp.revision(gym), pg_temp.at_local('11:00'), pg_temp.at_local('12:00'), 3600,
    'behavior_duration', null, null, null, null);
  r := public.revert_occurrence_move(gym, pg_temp.revision(gym), null, null, null);
  -- That Undo restored 15:00 (the move before 11:00). Undo is one step; a person returns
  -- to the plan by moving to the planned time.
  if (select effective_start_at from public.occurrences where id = gym) <> pg_temp.at_local('15:00') then
    raise exception 'Undo did not restore the previous time';
  end if;

  -- Tap-time checks.
  r := public.move_occurrence_for_day('2a120000-0000-4000-8000-000000000002', pg_temp.revision('2a120000-0000-4000-8000-000000000002'),
    pg_temp.at_local('15:00'), pg_temp.at_local('16:00'), 3600, 'behavior_duration', null, null, null, null);
  if r ->> 'reason' <> 'not_today' then raise exception 'A past day moved: %', r; end if;
  r := public.move_occurrence_for_day('2a120000-0000-4000-8000-000000000003', pg_temp.revision('2a120000-0000-4000-8000-000000000003'),
    pg_temp.at_local('15:00'), pg_temp.at_local('16:00'), 3600, 'planned_length', null, null, null, null);
  if r ->> 'reason' <> 'range_behavior' then raise exception 'A range Behavior moved: %', r; end if;
  r := public.move_occurrence_for_day(gym, pg_temp.revision(gym), pg_temp.at_local('23:30') + interval '1 hour',
    pg_temp.at_local('23:30') + interval '2 hours', 3600, 'behavior_duration', null, null, null, null);
  if r ->> 'reason' <> 'start_not_on_day' then raise exception 'A move left the day: %', r; end if;
  r := public.move_occurrence_for_day(gym, pg_temp.revision(gym), pg_temp.at_local('23:30'),
    pg_temp.at_local('23:30') + interval '1 hour', 3600, 'behavior_duration', null, null, null, null);
  if r ->> 'outcome' <> 'applied' then raise exception 'A late move that ends after midnight was refused: %', r; end if;
  r := public.move_occurrence_for_day(gym, pg_temp.revision(gym), now() - interval '2 hours',
    now() - interval '1 hour', 3600, 'behavior_duration', null, null, null, null);
  if r ->> 'reason' <> 'time_passed' then raise exception 'A move into the past was accepted: %', r; end if;
  r := public.move_occurrence_for_day(gen_random_uuid(), now(), pg_temp.at_local('15:00'), pg_temp.at_local('16:00'),
    3600, 'behavior_duration', null, null, null, null);
  if r ->> 'reason' <> 'occurrence_not_found' then raise exception 'A missing Occurrence was not refused: %', r; end if;

  -- Reason chips: the first tap is kept.
  if public.record_occurrence_move_reason((first_move ->> 'id')::uuid, 'running_late') <> 'running_late'
    or public.record_occurrence_move_reason((first_move ->> 'id')::uuid, 'low_energy') <> 'running_late' then
    raise exception 'A later reason tap replaced the first';
  end if;
end $$;

-- Status beats a pending move: the proposal is withdrawn and the Occurrence no longer moves.
reset role;
insert into public.move_proposals (id, user_id, occurrence_id, behavior_id, local_date, source, proposed_start_at,
  proposed_end_at, expected_revision) values
  ('2a130000-0000-4000-8000-000000000001', '2a100000-0000-4000-8000-000000000001', '2a120000-0000-4000-8000-000000000001',
   '2a110000-0000-4000-8000-000000000001', (select value from moves_2a where name = 'today')::date, 'daily_brief',
   now() + interval '1 hour', now() + interval '2 hours', now());
update public.occurrences set status = 'completed', completed_at = now(), status_marked_at = now()
  where id = '2a120000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare r jsonb;
begin
  if (select status from public.move_proposals where id = '2a130000-0000-4000-8000-000000000001') <> 'withdrawn' then
    raise exception 'A status mark did not withdraw the open proposal';
  end if;
  r := public.move_occurrence_for_day('2a120000-0000-4000-8000-000000000001', pg_temp.revision('2a120000-0000-4000-8000-000000000001'),
    pg_temp.at_local('15:00'), pg_temp.at_local('16:00'), 3600, 'behavior_duration', null, null, null, null);
  if r ->> 'reason' <> 'occurrence_resolved' then raise exception 'A resolved Occurrence moved: %', r; end if;
  -- Another account cannot see or move it.
  perform set_config('request.jwt.claims', '{"sub":"2a100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  r := public.move_occurrence_for_day('2a120000-0000-4000-8000-000000000004', now(), pg_temp.at_local('15:00'),
    pg_temp.at_local('16:00'), 3600, 'behavior_duration', null, null, null, null);
  if r ->> 'reason' <> 'occurrence_not_found' then raise exception 'Another account reached the Occurrence: %', r; end if;
end $$;

-- Callers and scopes: an outside client needs Occurrence write (or move); the Daily
-- Brief moves under its own scope; the coach cannot move.
reset role;
set local role service_role;
select public.oauth_register_client('dcr-advisor-2a', 'dcr', 'Move fixture', null, null,
  array['https://client.example/callback'], 'web', '{}'::jsonb, null, null) is not null as registered;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2a100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare consent jsonb; r jsonb; walk uuid := '2a120000-0000-4000-8000-000000000003';
begin
  -- Today's Walk becomes an exact-time Occurrence so it can move.
  consent := public.oauth_approve_consent('dcr-advisor-2a', 'https://client.example/callback',
    repeat('a', 43), 'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('c', 64));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '2a100000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'cadence_grant_id', consent ->> 'grant_id')::text, true);
  begin
    perform public.move_occurrence_for_day(walk, now(), pg_temp.at_local('15:00'), pg_temp.at_local('16:00'),
      3600, 'planned_length', null, null, null, null);
    raise exception 'A read-only grant moved an Occurrence';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"sub":"2a100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  consent := public.oauth_approve_consent('dcr-advisor-2a', 'https://client.example/callback',
    repeat('b', 43), 'https://app.cadence-me.com/mcp', array['cadence.read', 'cadence.occurrences.write'], repeat('d', 64));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '2a100000-0000-4000-8000-000000000001',
    'role', 'authenticated', 'cadence_grant_id', consent ->> 'grant_id')::text, true);
  r := public.move_occurrence_for_day('2a120000-0000-4000-8000-000000000003', pg_temp.revision(walk),
    pg_temp.at_local('15:00'), pg_temp.at_local('16:00'), 3600, 'planned_length', null, null, 'mcp-key', repeat('4', 64));
  -- The Walk is a range, so the outside client gets the same refusal a person would.
  if r ->> 'reason' <> 'range_behavior' then raise exception 'MCP caller got the wrong answer: %', r; end if;

  perform set_config('request.jwt.claims', '{"sub":"2a100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}', true);
  perform public.agent_ensure_grant();
  begin
    perform public.move_occurrence_for_day('2a120000-0000-4000-8000-000000000004', now(), pg_temp.at_local('15:00'),
      pg_temp.at_local('16:00'), 3600, 'behavior_duration', null, null, null, null);
    raise exception 'The coach moved an Occurrence';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
update public.occurrences set schedule_kind = 'exact', schedule_end_time = null
  where id = '2a120000-0000-4000-8000-000000000003';
set local role authenticated;
do $$
declare r jsonb; walk uuid := '2a120000-0000-4000-8000-000000000003';
begin
  perform set_config('request.jwt.claims', '{"sub":"2a100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}', true);
  perform public.agent_ensure_grant();
  r := public.move_occurrence_for_day(walk, pg_temp.revision(walk), pg_temp.at_local('15:00'), pg_temp.at_local('15:30'),
    1800, 'logged_average', 'calendar_overlap', null, 'brief-key', repeat('5', 64));
  if r ->> 'outcome' <> 'applied' or r #>> '{move,source}' <> 'daily_brief' or r #>> '{move,reason}' <> 'calendar_overlap' then
    raise exception 'The Daily Brief could not move: %', r;
  end if;

  -- Move conflicts: a collision opens one notice per Occurrence; a later sync without it clears it.
  perform set_config('request.jwt.claims', '{"sub":"2a100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  if (select count(*) from public.sync_move_conflicts((select value from moves_2a where name = 'today')::date,
      jsonb_build_array(jsonb_build_object('occurrence_id', walk, 'conflicting_occurrence_id', '2a120000-0000-4000-8000-000000000001')))) <> 1
    or (select count(*) from public.sync_move_conflicts((select value from moves_2a where name = 'today')::date,
      jsonb_build_array(jsonb_build_object('occurrence_id', walk)))) <> 1 then
    raise exception 'Conflict notices did not open once';
  end if;
  -- Moving again answers the notice.
  r := public.move_occurrence_for_day(walk, pg_temp.revision(walk), pg_temp.at_local('16:00'), pg_temp.at_local('16:30'),
    1800, 'kept_length', null, null, null, null);
  if exists (select 1 from public.move_conflicts where occurrence_id = walk and status = 'open')
    or not exists (select 1 from public.move_conflicts where occurrence_id = walk and status = 'moved') then
    raise exception 'Moving again did not answer the conflict notice';
  end if;
  -- A notice that stops applying clears.
  perform public.sync_move_conflicts((select value from moves_2a where name = 'today')::date,
    jsonb_build_array(jsonb_build_object('occurrence_id', walk)));
  perform public.sync_move_conflicts((select value from moves_2a where name = 'today')::date, '[]'::jsonb);
  if not exists (select 1 from public.move_conflicts where occurrence_id = walk and status = 'cleared') then
    raise exception 'A conflict that stopped applying stayed open';
  end if;
  -- "Keep it here" answers a notice; the same collision does not reopen it.
  perform public.sync_move_conflicts((select value from moves_2a where name = 'today')::date,
    jsonb_build_array(jsonb_build_object('occurrence_id', walk)));
  perform public.keep_moved_occurrence((select id from public.move_conflicts where occurrence_id = walk and status = 'open'));
  perform public.sync_move_conflicts((select value from moves_2a where name = 'today')::date,
    jsonb_build_array(jsonb_build_object('occurrence_id', walk)));
  if exists (select 1 from public.move_conflicts where occurrence_id = walk and status = 'open')
    or not exists (select 1 from public.move_conflicts where occurrence_id = walk and status = 'kept') then
    raise exception 'A kept move was flagged again';
  end if;
end $$;

-- People still cannot write moves, reasons or effective time directly.
do $$ begin
  begin
    insert into public.occurrence_move_reasons (move_id, user_id, person_reason)
      select id, user_id, 'other' from public.occurrence_moves limit 1;
    raise exception 'A person inserted a reason directly';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
