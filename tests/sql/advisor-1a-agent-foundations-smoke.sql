\set ON_ERROR_STOP on

-- Advisor plan Phase 1A: first-party caller, spend budget and run log.
-- Synthetic local fixtures only; all changes roll back.
--   1. Each agent channel gets its own grant, scopes, activity label and
--      idempotency namespace; Settings never shows them.
--   2. A call that would pass an agent's share is refused before any spend,
--      and chat cannot spend the brief's protected share.
--   3. The deletion job removes content older than 30 days and keeps the run.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('1a000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'advisor-1a-a@example.invalid',
    '{"provider":"email","providers":["email"]}', '{}'),
  ('1a000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'advisor-1a-b@example.invalid',
    '{"provider":"email","providers":["email"]}', '{}');
update public.profiles set timezone = 'America/Los_Angeles' where id = '1a000000-0000-4000-8000-0000000000a1';

create temporary table advisor_1a_ids (name text primary key, id uuid) on commit drop;
grant all on advisor_1a_ids to authenticated;

set local role authenticated;

-- 1. First-party caller --------------------------------------------------

-- The person's own session cannot act as an agent.
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  begin
    perform public.agent_ensure_grant();
    raise exception 'A session token created an agent grant';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reserve_agent_spend(null, 'gpt-5.6-luna', 1000);
    raise exception 'A session token reserved agent spend';
  exception when insufficient_privilege then null;
  end;
  -- An agent token that also carries a grant claim is refused.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '1a000000-0000-4000-8000-0000000000a1',
    'role', 'authenticated', 'cadence_channel', 'chat', 'cadence_grant_id', gen_random_uuid())::text, true);
  begin
    perform public.agent_ensure_grant();
    raise exception 'An agent token with a grant claim was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare
  brief record;
  chat record;
  again record;
  r jsonb;
begin
  -- Before the grant exists, integration functions refuse the agent.
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1","role":"authenticated","cadence_channel":"daily_brief"}', true);
  begin
    perform public.integration_record_activity('get_timeline', '{}', 'success', null);
    raise exception 'Activity recorded without an agent grant';
  exception when insufficient_privilege then null;
  end;

  select * into brief from public.agent_ensure_grant();
  if brief.client_id <> 'cadence:agent:daily_brief' or brief.client_label <> 'Cadence Daily Brief'
      or brief.scopes <> array['cadence.read'] then
    raise exception 'Daily Brief grant is wrong: %', row_to_json(brief);
  end if;
  select * into again from public.agent_ensure_grant();
  if again.grant_id <> brief.grant_id then raise exception 'ensure created a second grant'; end if;
  insert into advisor_1a_ids values ('brief_grant', brief.grant_id);

  -- A read is recorded under the agent's own label.
  perform public.integration_record_activity('get_timeline', '{}', 'success', null);

  -- The brief has no write scope.
  begin
    perform public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-16', 'Brief wrote', null);
    raise exception 'The Daily Brief wrote a day note';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1","role":"authenticated","cadence_channel":"chat"}', true);
  select * into chat from public.agent_ensure_grant();
  if chat.grant_id = brief.grant_id or chat.client_label <> 'Cadence chat'
      or chat.scopes <> array['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'] then
    raise exception 'Chat grant is wrong: %', row_to_json(chat);
  end if;
  insert into advisor_1a_ids values ('chat_grant', chat.grant_id);

  -- Chat writes as the person, with its own idempotency key and label.
  r := public.integration_apply_day_note_write('advisor-1a-key', repeat('b', 64), '2026-11-16', 'Written by chat', null);
  if ((r #>> '{receipt,output_json}')::jsonb #>> '{day_note,note}') <> 'Written by chat' then
    raise exception 'Chat write output is wrong: %', r;
  end if;
  if (select note from public.day_notes where local_date = '2026-11-16') <> 'Written by chat' then
    raise exception 'Chat write did not land on the person''s day note';
  end if;
  r := public.integration_apply_day_note_write('advisor-1a-key', repeat('b', 64), '2026-11-16', 'Written by chat', null);
  if (select revision from public.day_notes where local_date = '2026-11-16') <> 1 then
    raise exception 'Replay wrote twice';
  end if;
end $$;

reset role;
do $$ begin
  if (select count(*) from cadence_oauth_private.activity a
      join cadence_oauth_private.clients c on c.id = a.client_ref
      where a.user_id = '1a000000-0000-4000-8000-0000000000a1'
        and c.client_name = 'Cadence Daily Brief' and a.operation = 'get_timeline' and a.outcome = 'success') <> 1 then
    raise exception 'Daily Brief read was not recorded under its label';
  end if;
  if (select count(*) from cadence_oauth_private.activity a
      join cadence_oauth_private.clients c on c.id = a.client_ref
      where a.user_id = '1a000000-0000-4000-8000-0000000000a1'
        and c.client_name = 'Cadence chat' and a.operation = 'update_day_note' and a.outcome = 'success') <> 2 then
    raise exception 'Chat write and replay were not recorded under its label';
  end if;
  if (select c.client_id from cadence_oauth_private.idempotency_records r
      join cadence_oauth_private.clients c on c.id = r.client_ref
      where r.idempotency_key = 'advisor-1a-key') <> 'cadence:agent:chat' then
    raise exception 'Chat idempotency key is not in the chat namespace';
  end if;
  -- OAuth flows never see a first-party client.
  if (cadence_oauth_private.active_client('cadence:agent:chat')).id is not null then
    raise exception 'A first-party client is visible to OAuth';
  end if;
  -- An incident revoke-all leaves agents alone.
  if public.oauth_revoke_all_grants() <> 0 then raise exception 'revoke-all touched agent grants'; end if;
end $$;
set local role authenticated;

do $$ declare stolen uuid := (select id from advisor_1a_ids where name = 'chat_grant'); begin
  -- An MCP-style token naming an agent grant is refused.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '1a000000-0000-4000-8000-0000000000a1',
    'role', 'authenticated', 'cadence_channel', 'mcp', 'cadence_grant_id', stolen)::text, true);
  begin
    perform public.integration_record_activity('get_timeline', '{}', 'success', null);
    raise exception 'An MCP token resolved an agent grant';
  exception when insufficient_privilege then null;
  end;
  -- Settings lists no agent grants or agent activity, and cannot revoke them.
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  if exists (select 1 from public.oauth_list_grants()) then raise exception 'Settings lists an agent grant'; end if;
  if exists (select 1 from public.oauth_list_activity()) then raise exception 'Settings lists agent activity'; end if;
  if public.oauth_revoke_grant(stolen) then raise exception 'Settings revoked an agent grant'; end if;
end $$;

-- 2. Spend budget ----------------------------------------------------------

do $$
declare
  run record;
  decision record;
  i integer;
  expected_reset timestamptz := (date_trunc('month', statement_timestamp() at time zone 'America/Los_Angeles')
    + interval '1 month') at time zone 'America/Los_Angeles';
begin
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1","role":"authenticated","cadence_channel":"daily_brief"}', true);
  select * into run from public.agent_run_start('on_demand', 'gpt-5.6-luna', 'fixture-v1');
  insert into advisor_1a_ids values ('brief_run', run.run_id);
  if run.timezone <> 'America/Los_Angeles' then raise exception 'Run timezone is %', run.timezone; end if;

  -- The brief's US$0.50 share: 99 reservations of US$0.005 fit, then one settles above its estimate.
  for i in 1..99 loop
    select * into decision from public.reserve_agent_spend(run.run_id, 'gpt-5.6-luna', 5000);
    if not decision.allowed then raise exception 'Reservation % was refused inside the share', i; end if;
  end loop;
  if not public.settle_agent_spend(decision.reservation_id, 4000) then raise exception 'Settle failed'; end if;
  if public.settle_agent_spend(decision.reservation_id, 1) then raise exception 'Settled twice'; end if;
  -- Used: 98 x 5,000 + 4,000 = 494,000. 6,000 fits; 6,001 does not.
  select * into decision from public.reserve_agent_spend(run.run_id, 'gpt-5.6-luna', 6001);
  if decision.allowed or decision.reason <> 'agent_share' or decision.resets_at <> expected_reset then
    raise exception 'Share overrun not refused: %', row_to_json(decision);
  end if;
  select * into decision from public.reserve_agent_spend(run.run_id, 'gpt-5.6-luna', 6000);
  if not decision.allowed then raise exception 'Exact share refused'; end if;
  select * into decision from public.reserve_agent_spend(run.run_id, 'gpt-5.6-luna', 1);
  if decision.allowed then raise exception 'Full share accepted another call'; end if;
end $$;

reset role;
do $$ begin
  if (select sum(coalesce(actual_microdollars, estimated_microdollars)) from cadence_advisor_private.agent_spend_reservations
      where user_id = '1a000000-0000-4000-8000-0000000000a1') <> 500000 then
    raise exception 'Refused requests reserved spend';
  end if;
  -- Give account B a chat share larger than the total, to prove the brief's share stays protected.
  insert into cadence_advisor_private.agent_budget_account_overrides (user_id, agent, monthly_microdollars)
  values ('1a000000-0000-4000-8000-0000000000b2', 'chat', 5000000);
end $$;
set local role authenticated;

do $$ declare decision record; i integer; begin
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000b2","role":"authenticated","cadence_channel":"chat"}', true);
  -- US$5.00 total less the brief's unused US$0.50 leaves chat US$4.50.
  for i in 1..9 loop
    select * into decision from public.reserve_agent_spend(null, 'gpt-5.6-luna', 500000);
    if not decision.allowed then raise exception 'Chat reservation % refused below US$4.50', i; end if;
  end loop;
  select * into decision from public.reserve_agent_spend(null, 'gpt-5.6-luna', 1);
  if decision.allowed or decision.reason <> 'account_total' then
    raise exception 'Chat spent the protected brief share: %', row_to_json(decision);
  end if;
  -- The brief still has its full share.
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000b2","role":"authenticated","cadence_channel":"daily_brief"}', true);
  select * into decision from public.reserve_agent_spend(null, 'gpt-5.6-luna', 500000);
  if not decision.allowed then raise exception 'Brief lost its protected share'; end if;
  -- Another agent cannot settle the brief's reservation.
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000b2","role":"authenticated","cadence_channel":"chat"}', true);
  if public.settle_agent_spend(decision.reservation_id, 0) then raise exception 'Chat settled a brief reservation'; end if;
end $$;

-- 3. Run log and content retention ------------------------------------------

do $$ declare run_id uuid := (select id from advisor_1a_ids where name = 'brief_run'); begin
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1","role":"authenticated","cadence_channel":"daily_brief"}', true);
  if not public.agent_run_store_content(run_id, 'input', 0, '{"facts":"fixture"}', false) then
    raise exception 'Input content not stored';
  end if;
  if not public.agent_run_store_content(run_id, 'output', 0, '{"text":"fixture"}', true) then
    raise exception 'Output content not stored';
  end if;
  if not public.agent_run_finish(run_id, 'success', null, null, repeat('c', 64), 1, 8700, 0, 480, 300) then
    raise exception 'Run not finished';
  end if;
  if public.agent_run_finish(run_id, 'error', 'late', null, null, 0, null, null, null, null) then
    raise exception 'Run finished twice';
  end if;
  -- Another agent cannot write to the brief's run.
  perform set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-0000000000a1","role":"authenticated","cadence_channel":"coach"}', true);
  begin
    perform public.agent_run_store_content(run_id, 'output', 1, '{}', false);
    raise exception 'Coach wrote to a brief run';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

reset role;
do $$
declare
  run cadence_advisor_private.agent_runs;
  v_run_id uuid := (select id from advisor_1a_ids where name = 'brief_run');
  purged integer;
begin
  select * into run from cadence_advisor_private.agent_runs where id = v_run_id;
  if run.cost_microdollars <> 500000 or run.input_tokens <> 8700 or run.outcome <> 'success' then
    raise exception 'Run metadata is wrong: %', row_to_json(run);
  end if;
  -- Calendar-derived output expires at the end of the run's local day; other content after 30 days.
  if (select expires_at from cadence_advisor_private.agent_run_contents as contents where contents.run_id = run.id and kind = 'output')
      <> ((run.local_date + 1)::timestamp at time zone 'America/Los_Angeles') then
    raise exception 'Calendar-derived content outlives its local day';
  end if;
  if (select expires_at from cadence_advisor_private.agent_run_contents as contents where contents.run_id = run.id and kind = 'input')
      <> (select created_at + interval '30 days' from cadence_advisor_private.agent_run_contents as contents where contents.run_id = run.id and kind = 'input') then
    raise exception 'Content is not kept for exactly 30 days';
  end if;

  -- Age the input past 30 days; the output stays inside its window.
  update cadence_advisor_private.agent_run_contents as contents
  set created_at = statement_timestamp() - interval '31 days', expires_at = statement_timestamp() - interval '1 day'
  where contents.run_id = run.id and kind = 'input';
  set local role service_role;
  purged := public.purge_expired_agent_run_contents();
  reset role;
  if purged <> 1 then raise exception 'Deletion job removed % rows', purged; end if;
  if exists (select 1 from cadence_advisor_private.agent_run_contents as contents where contents.run_id = run.id and kind = 'input') then
    raise exception 'Expired content survived';
  end if;
  if not exists (select 1 from cadence_advisor_private.agent_run_contents as contents where contents.run_id = run.id and kind = 'output') then
    raise exception 'Current content was deleted';
  end if;
  if not exists (select 1 from cadence_advisor_private.agent_runs where id = run.id and cost_microdollars = 500000) then
    raise exception 'Deletion job removed run metadata';
  end if;
end $$;

-- Only the service role runs the deletion job.
set local role authenticated;
do $$ begin
  perform public.purge_expired_agent_run_contents();
  raise exception 'A user ran the deletion job';
exception when insufficient_privilege then null;
end $$;

rollback;
