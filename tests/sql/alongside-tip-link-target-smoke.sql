-- Ticket 385 smoke check for 20261126240000_alongside_tip_link_target.sql.
-- Run against a local database with all migrations applied, as postgres:
--   psql -v ON_ERROR_STOP=1 -f tests/sql/alongside-tip-link-target-smoke.sql
-- Everything runs in one transaction and rolls back.
--   1. coach_write_tips stores a tip whose link_target is 'alongside'.
--   2. An unknown link target is still refused (check_violation).
--   3. The check still allows every earlier target, and only those plus 'alongside'.
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('0e385000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'alongside-link-smoke@example.invalid', '{}', '{}', now(), now());
update public.profiles set timezone = 'UTC' where id = '0e385000-0000-4000-8000-000000000001';
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone, default_duration_minutes) values
  ('0e385000-0000-4000-8000-000000000010', '0e385000-0000-4000-8000-000000000001', 'Stretch',
   '{"frequency":"daily","interval":1}', '07:00', 'UTC', 10);

set local role authenticated;

do $$
declare
  coach constant text := '{"sub":"0e385000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}';
  stretch constant uuid := '0e385000-0000-4000-8000-000000000010';
  run_id uuid;
  written integer;
  refused boolean := false;
begin
  perform set_config('request.jwt.claims', coach, true);
  select r.run_id into run_id from public.agent_run_start('scheduled', 'openai/gpt-5.6-luna', 'coach-tips-2') as r;

  -- 1. The alongside link is accepted.
  written := public.coach_write_tips(run_id, jsonb_build_array(
    jsonb_build_object('text', 'Stretch has no answer yet about being done alongside other things.',
      'card_id', 'do-it-during-something-else', 'card_revision', 1, 'behavior_id', stretch,
      'fact_ids', '["setup_gaps:stretch:alongside_unanswered"]'::jsonb, 'source', 'seed',
      'link_target', 'alongside', 'link_behavior_id', stretch)
  ));
  if written <> 1 then raise exception 'expected the alongside tip to be written, got %', written; end if;

  -- 2. An unknown target is refused.
  begin
    perform public.coach_write_tips(run_id, jsonb_build_array(
      jsonb_build_object('text', 'Unknown target.', 'card_id', 'give-it-a-length', 'card_revision', 2,
        'behavior_id', null, 'fact_ids', '["account:length"]'::jsonb, 'source', 'seed',
        'link_target', 'nowhere', 'link_behavior_id', stretch)
    ));
  exception when check_violation then
    refused := true;
  end;
  if not refused then raise exception 'an unknown link target was accepted'; end if;
end;
$$;

reset role;

-- 1 (stored) and 3 (the list).
do $$
declare
  definition text;
  target text;
begin
  if not exists (select 1 from cadence_advisor_private.coach_tips
      where user_id = '0e385000-0000-4000-8000-000000000001' and link_target = 'alongside'
        and link_behavior_id = '0e385000-0000-4000-8000-000000000010') then
    raise exception 'the alongside tip was not stored';
  end if;
  select pg_get_constraintdef(c.oid) into definition
  from pg_constraint c
  where c.conrelid = 'cadence_advisor_private.coach_tips'::regclass and c.conname = 'coach_tips_link_target_check';
  if definition is null then raise exception 'coach_tips_link_target_check is missing'; end if;
  foreach target in array array['time', 'length', 'where', 'description', 'behavior', 'unmarked', 'behaviors', 'alongside'] loop
    if position(quote_literal(target) in definition) = 0 then
      raise exception 'link target % is no longer allowed: %', target, definition;
    end if;
  end loop;
  if (select count(*) from regexp_matches(definition, '''[a-z]+''::text', 'g')) <> 8 then
    raise exception 'the link target list changed beyond alongside: %', definition;
  end if;
end;
$$;

rollback;
