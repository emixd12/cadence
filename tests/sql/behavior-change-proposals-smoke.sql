-- Advisor Phase 4C smoke check for 20261119213000_behavior_change_proposals.sql.
-- Run against a local database with all migrations applied, as postgres:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/behavior-change-proposals-smoke.sql
-- Everything runs in one transaction and rolls back.
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('0c000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'behavior-change-smoke@example.invalid', '{}', '{}', now(), now());
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone)
values ('0c000000-0000-4000-8000-000000000010', '0c000000-0000-4000-8000-000000000001', 'Gym',
  '{"frequency":"weekly","interval":1,"daysOfWeek":["monday","tuesday","thursday"]}', '07:00', 'America/New_York');
insert into cadence_advisor_private.agent_runs (id, user_id, agent, trigger, local_date, timezone)
values ('0c000000-0000-4000-8000-000000000020', '0c000000-0000-4000-8000-000000000001', 'coach', 'scheduled', '2026-11-19', 'America/New_York');

create temporary table smoke_proposal (body jsonb) on commit drop;
insert into smoke_proposal values ('{
  "behavior_id": "0c000000-0000-4000-8000-000000000010",
  "weekdays": ["tuesday"], "from_time": "07:00", "to_time": "18:30",
  "schedules_before": [{"recurrence": {"frequency": "weekly", "interval": 1, "days_of_week": ["monday", "tuesday", "thursday"]}, "time_entries": [{"kind": "exact", "start_time": "07:00"}]}],
  "schedules_after": [{"recurrence": {"frequency": "weekly", "interval": 1, "days_of_week": ["monday", "thursday"]}, "time_entries": [{"kind": "exact", "start_time": "07:00"}]},
                      {"recurrence": {"frequency": "weekly", "interval": 1, "days_of_week": ["tuesday"]}, "time_entries": [{"kind": "exact", "start_time": "18:30"}]}],
  "first_affected_date": "2026-11-24",
  "reason": "You moved it to about 6:30 PM on 4 of the last 5 Tuesdays.",
  "evidence": {"source": "repeated_move", "signal_ids": [], "weekday": "tuesday", "matching_days": 5, "moved_days": 4}
}');
grant select on smoke_proposal to authenticated;

create temporary table smoke_result (step text, value jsonb) on commit drop;
grant insert, select on smoke_result to authenticated;

-- 1. The person cannot propose; the coach can, once.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  perform public.coach_propose_behavior_change('0c000000-0000-4000-8000-000000000020', (select body from smoke_proposal));
  raise exception 'person proposed';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claims', '{"sub":"0c000000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}', true);
insert into smoke_result select 'first', public.coach_propose_behavior_change('0c000000-0000-4000-8000-000000000020', (select body from smoke_proposal));
insert into smoke_result select 'second', public.coach_propose_behavior_change('0c000000-0000-4000-8000-000000000020', (select body from smoke_proposal));
insert into smoke_result select 'state', public.coach_behavior_change_state();
-- The coach cannot read or answer as the person.
do $$ begin
  perform public.read_behavior_change_proposal('2026-11-19');
  raise exception 'coach read the person view';
exception when insufficient_privilege then null; end $$;

-- 2. The person reads it, says No; a repeat No replays; Try is refused on a closed proposal.
select set_config('request.jwt.claims', '{"sub":"0c000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into smoke_result select 'read', public.read_behavior_change_proposal('2026-11-19');
insert into smoke_result select 'no', public.answer_behavior_change_proposal((select (value ->> 'id')::uuid from smoke_result where step = 'first'), 'no', '2026-11-19');
insert into smoke_result select 'no_again', public.answer_behavior_change_proposal((select (value ->> 'id')::uuid from smoke_result where step = 'first'), 'no', '2026-11-19');
do $$ begin
  perform public.answer_behavior_change_proposal((select (value ->> 'id')::uuid from smoke_result where step = 'first'), 'try', '2026-11-19', '2026-12-03');
  raise exception 'answered a closed proposal';
exception when raise_exception then
  if sqlerrm <> 'behavior_change_closed' then raise; end if;
end $$;

-- 3. The same Behavior and direction is not proposed again within 30 days.
select set_config('request.jwt.claims', '{"sub":"0c000000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}', true);
insert into smoke_result select 'cooldown', public.coach_propose_behavior_change('0c000000-0000-4000-8000-000000000020', (select body from smoke_proposal));
-- The other direction is allowed.
insert into smoke_result select 'earlier', public.coach_propose_behavior_change('0c000000-0000-4000-8000-000000000020',
  (select body || '{"to_time": "06:00"}'::jsonb from smoke_proposal));

-- 4. Try, then the check-in passes unanswered for seven days: kept, told once.
select set_config('request.jwt.claims', '{"sub":"0c000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into smoke_result select 'try', public.answer_behavior_change_proposal((select (value ->> 'id')::uuid from smoke_result where step = 'earlier'), 'try', '2026-11-19', '2026-12-03');
insert into smoke_result select 'during_trial', public.read_behavior_change_proposal('2026-12-09');
insert into smoke_result select 'kept', public.read_behavior_change_proposal('2026-12-10');
insert into smoke_result select 'notice_seen', public.answer_behavior_change_proposal((select (value ->> 'id')::uuid from smoke_result where step = 'earlier'), 'notice_seen', '2026-12-10');
insert into smoke_result select 'after_notice', coalesce(public.read_behavior_change_proposal('2026-12-10'), 'null'::jsonb);
reset role;

do $$
declare
  r jsonb;
begin
  select value into r from smoke_result where step = 'first';
  if r ->> 'id' is null then raise exception 'first proposal not stored: %', r; end if;
  select value into r from smoke_result where step = 'second';
  if r ->> 'refused' <> 'open_proposal' then raise exception 'second proposal: %', r; end if;
  select value into r from smoke_result where step = 'state';
  if (r ->> 'has_open')::boolean is not true then raise exception 'state: %', r; end if;
  select value into r from smoke_result where step = 'read';
  if r ->> 'status' <> 'proposed' or r ? 'user_id' then raise exception 'read: %', r; end if;
  select value into r from smoke_result where step = 'no';
  if r ->> 'status' <> 'declined' or r ? 'replayed' then raise exception 'no: %', r; end if;
  select value into r from smoke_result where step = 'no_again';
  if (r ->> 'replayed')::boolean is not true then raise exception 'no again: %', r; end if;
  select value into r from smoke_result where step = 'cooldown';
  if r ->> 'refused' <> 'declined_recently' then raise exception 'cooldown: %', r; end if;
  select value into r from smoke_result where step = 'earlier';
  if r ->> 'id' is null then raise exception 'earlier: %', r; end if;
  select value into r from smoke_result where step = 'try';
  if r ->> 'status' <> 'accepted_trial' or r ->> 'check_in_date' <> '2026-12-03' then raise exception 'try: %', r; end if;
  select value into r from smoke_result where step = 'during_trial';
  if r ->> 'status' <> 'accepted_trial' then raise exception 'during trial: %', r; end if;
  select value into r from smoke_result where step = 'kept';
  if r ->> 'status' <> 'kept' or r ->> 'close_reason' <> 'no_answer' then raise exception 'kept: %', r; end if;
  select value into r from smoke_result where step = 'after_notice';
  if r <> 'null'::jsonb then raise exception 'notice shown twice: %', r; end if;
  raise notice 'behavior change proposals smoke: ok';
end $$;

rollback;
