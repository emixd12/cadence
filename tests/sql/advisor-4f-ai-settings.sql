\set ON_ERROR_STOP on

-- Advisor plan Phase 4 (4F): the one AI features approval and the shared settings.
-- Synthetic local fixtures only; all changes roll back.
--   1. An account that has not answered reads every feature off and no approval.
--   2. Approving saves every feature and source and records the approval once.
--   3. A tips-only change keeps the Daily Brief revision, so today's saved brief stays.
--   4. Daily Brief off keeps the shared source choices on.
--   5. A stale Daily Brief revision is refused.
--   6. An agent token can read; only the person's session can save.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('4f000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'advisor-4f@example.invalid',
  '{"provider":"email","providers":["email"]}', '{}');
insert into auth.sessions (id, user_id) values ('4f000000-0000-4000-8000-000000000011', '4f000000-0000-4000-8000-000000000001');

create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected SQLSTATE %, got success from: %', expected, statement;
exception when others then
  if sqlstate <> expected then
    raise exception 'Expected SQLSTATE %, got % from: %', expected, sqlstate, statement;
  end if;
end;
$$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

set local role authenticated;

do $$
declare
  person constant text := '{"sub":"4f000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"4f000000-0000-4000-8000-000000000011"}';
  agent constant text := '{"sub":"4f000000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}';
  settings jsonb;
  approved text;
begin
  perform set_config('request.jwt.claims', person, true);

  -- 1.
  settings := public.read_ai_settings();
  if settings ->> 'approved_at' is not null or (settings ->> 'tips_enabled')::boolean or (settings ->> 'chat_enabled')::boolean
    or (settings ->> 'daily_brief_enabled')::boolean then
    raise exception 'An unanswered account read %', settings;
  end if;

  -- 2.
  settings := public.save_ai_settings(true, true, true, true, false, false, false, false, true, true, 0);
  approved := settings ->> 'approved_at';
  if approved is null or not (settings ->> 'chat_enabled')::boolean or not (settings ->> 'include_notes')::boolean
    or not (settings ->> 'use_connected_sources')::boolean then
    raise exception 'Approval saved %', settings;
  end if;

  -- 3.
  settings := public.save_ai_settings(true, false, true, true, false, false, false, false, true, true, 1);
  if (settings ->> 'tips_enabled')::boolean or (public.read_daily_brief_preferences() ->> 'revision')::integer <> 1
    or settings ->> 'approved_at' <> approved then
    raise exception 'A tips-only change read % with brief revision %', settings, public.read_daily_brief_preferences() ->> 'revision';
  end if;

  -- 4.
  settings := public.save_ai_settings(false, false, true, true, false, false, false, true, true, true, 1);
  if (settings ->> 'daily_brief_enabled')::boolean or not (settings ->> 'include_notes')::boolean
    or not (settings -> 'excluded_sources' ->> 'hevy')::boolean then
    raise exception 'Brief off read %', settings;
  end if;

  -- 5.
  perform pg_temp.expect_error($q$select public.save_ai_settings(true, true, true, true, false, false, false, false, true, true, 1)$q$, '55000');

  -- 6.
  perform set_config('request.jwt.claims', agent, true);
  if not (public.read_ai_settings() ->> 'chat_enabled')::boolean then raise exception 'The agent read was wrong'; end if;
  perform pg_temp.expect_error($q$select public.save_ai_settings(true, true, true, true, false, false, false, false, true, true, 2)$q$, '42501');
end;
$$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.read_ai_settings()', 'EXECUTE')
    or has_function_privilege('service_role', 'cadence_advisor_private.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint)', 'EXECUTE')
    or has_table_privilege('authenticated', 'cadence_advisor_private.ai_feature_settings', 'SELECT')
  then
    raise exception 'AI settings privileges are too wide.';
  end if;
end;
$$;

rollback;
