\set ON_ERROR_STOP on

-- Advisor plan Phase 3 (3A2): the saved brief, the per-account day count and Refresh.
-- Synthetic local fixtures only; all changes roll back.
--   1. A shown brief is saved with its lease; every later open that day, on any
--      device, gets the saved brief back with no new attempt.
--   2. A refresh is a new attempt; two are allowed a day, then refresh_limit_reached.
--   3. A refresh with nothing saved is the morning brief and is not counted.
--   4. A client that wants move lines replaces a brief saved without them, uncounted.
--   5. The pre-Phase-3 three-argument begin_daily_brief still works.
--   6. agent_brief_refresh_funded is for the daily_brief agent only and protects the
--      rest of the month's morning briefs.
--   7. The day-end purge clears the saved text and keeps the count row.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('3a200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'advisor-3a2@example.invalid',
  '{"provider":"email","providers":["email"]}', '{}');
update public.profiles set timezone = 'America/Los_Angeles' where id = '3a200000-0000-4000-8000-000000000001';
insert into auth.sessions (id, user_id) values ('3a200000-0000-4000-8000-000000000011', '3a200000-0000-4000-8000-000000000001');

set local role authenticated;

do $$
declare
  person constant text := '{"sub":"3a200000-0000-4000-8000-000000000001","role":"authenticated","session_id":"3a200000-0000-4000-8000-000000000011"}';
  agent constant text := '{"sub":"3a200000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}';
  phone constant uuid := '3a200000-0000-4000-8000-000000000101';
  laptop constant uuid := '3a200000-0000-4000-8000-000000000102';
  decision jsonb;
  run_id uuid;
  funded record;
  i integer;
begin
  perform set_config('request.jwt.claims', person, true);
  perform public.save_daily_brief_preferences(true, false, 0);

  -- The old form still answers (the paused device path).
  decision := public.begin_daily_brief(laptop, false, 1);
  if decision ->> 'state' <> 'acquired' then raise exception 'Three-argument admission was %', decision; end if;
  perform public.finish_daily_brief(laptop, (decision ->> 'lease_token')::uuid, false, 1);

  -- 1. Morning brief with move lines.
  decision := public.begin_daily_brief(phone, false, 1, false, true);
  if decision ->> 'state' <> 'acquired' or (decision ->> 'refresh')::boolean or (decision ->> 'refreshes_used')::integer <> 0 then
    raise exception 'Morning admission was %', decision;
  end if;
  perform set_config('request.jwt.claims', agent, true);
  select r.run_id into run_id from public.agent_run_start('on_demand', 'openai/gpt-5.6-luna', 'fixture-3a2') as r;
  perform set_config('request.jwt.claims', person, true);
  if not public.save_daily_brief(phone, (decision ->> 'lease_token')::uuid, 1, run_id, false, true, '{"text":"Morning."}') then
    raise exception 'Morning save failed';
  end if;
  -- A lease saves once.
  if public.save_daily_brief(phone, (decision ->> 'lease_token')::uuid, 1, run_id, false, true, '{"text":"Again."}') then
    raise exception 'A completed lease saved twice';
  end if;
  -- An unknown run id is refused.
  begin
    decision := public.begin_daily_brief(phone, false, 1, true, true);
    perform public.save_daily_brief(phone, (decision ->> 'lease_token')::uuid, 1, gen_random_uuid(), true, true, '{"text":"x"}');
    raise exception 'An unknown run id was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- Any device reopens the saved brief with no new attempt.
  decision := public.begin_daily_brief(laptop, false, 1, false, true);
  if decision ->> 'state' <> 'saved' or decision -> 'briefing' ->> 'text' <> 'Morning.' or (decision ->> 'run_id')::uuid <> run_id
    or not (decision ->> 'with_moves')::boolean or (decision ->> 'refreshes_used')::integer <> 0 then
    raise exception 'Reopen was %', decision;
  end if;

  -- 2. Two refreshes, then the limit. (The refused save above rolled back its admission.)
  for i in 1..2 loop
    decision := public.begin_daily_brief(phone, false, 1, true, true);
    if decision ->> 'state' <> 'acquired' or not (decision ->> 'refresh')::boolean or (decision ->> 'refreshes_used')::integer <> i - 1 then
      raise exception 'Refresh % admission was %', i, decision;
    end if;
    if not public.save_daily_brief(phone, (decision ->> 'lease_token')::uuid, 1, run_id, true, true, jsonb_build_object('text', 'Refresh ' || i)) then
      raise exception 'Refresh % save failed', i;
    end if;
  end loop;
  decision := public.begin_daily_brief(laptop, false, 1, true, true);
  if decision ->> 'state' <> 'refresh_limit_reached' then raise exception 'Third refresh was %', decision; end if;
  decision := public.begin_daily_brief(laptop, false, 1, false, true);
  if decision -> 'briefing' ->> 'text' <> 'Refresh 2' or (decision ->> 'refreshes_used')::integer <> 2 then
    raise exception 'Reopen after refreshes was %', decision;
  end if;
end $$;

-- 7. Day-end purge: clears the text once the local day has ended.
reset role;
do $$
begin
  if (select briefs_shown from cadence_advisor_private.daily_brief_days) <> 3 then raise exception 'briefs_shown is wrong'; end if;
  update cadence_advisor_private.daily_brief_days set local_date = local_date - 1;
  if public.purge_ended_daily_brief_days() <> 1 then raise exception 'Purge cleared the wrong number of days'; end if;
  if exists (select 1 from cadence_advisor_private.daily_brief_days where briefing is not null) then raise exception 'Purge kept text'; end if;
  if (select refreshes_used from cadence_advisor_private.daily_brief_days) <> 2 then raise exception 'Purge lost the count'; end if;
  delete from cadence_advisor_private.daily_brief_days;
  delete from cadence_advisor_private.daily_brief_runs;
  delete from cadence_advisor_private.daily_brief_rate_limits;
end $$;
set local role authenticated;

do $$
declare
  person constant text := '{"sub":"3a200000-0000-4000-8000-000000000001","role":"authenticated","session_id":"3a200000-0000-4000-8000-000000000011"}';
  agent constant text := '{"sub":"3a200000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}';
  phone constant uuid := '3a200000-0000-4000-8000-000000000101';
  decision jsonb;
  funded record;
begin
  perform set_config('request.jwt.claims', person, true);
  -- 3. A refresh with nothing saved is the morning brief.
  decision := public.begin_daily_brief(phone, false, 1, true, true);
  if decision ->> 'state' <> 'acquired' or (decision ->> 'refresh')::boolean then raise exception 'Refresh-first was %', decision; end if;
  if not public.save_daily_brief(phone, (decision ->> 'lease_token')::uuid, 1, null, false, false, '{"text":"Old client."}') then
    raise exception 'Old-client save failed';
  end if;

  -- 4. An old client's brief (no move lines) reopens for old clients and is replaced,
  --    uncounted, for a client that wants move lines.
  decision := public.begin_daily_brief(phone, false, 1, false, false);
  if decision ->> 'state' <> 'saved' then raise exception 'Old-client reopen was %', decision; end if;
  decision := public.begin_daily_brief(phone, false, 1, false, true);
  if decision ->> 'state' <> 'acquired' or (decision ->> 'refresh')::boolean then raise exception 'Move-line upgrade was %', decision; end if;
  if not public.save_daily_brief(phone, (decision ->> 'lease_token')::uuid, 1, null, false, true, '{"text":"With moves."}') then
    raise exception 'Upgrade save failed';
  end if;
  -- (The upgrade's uncounted refresh is checked after this block.)

  -- 6. Funding: the person's own session may not ask; the agent may.
  begin
    perform public.agent_brief_refresh_funded(5000);
    raise exception 'A person session read refresh funding';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claims', agent, true);
  select * into funded from public.agent_brief_refresh_funded(5000);
  if not funded.funded or funded.remaining_microdollars <> 500000 then raise exception 'Fresh month funding was %', funded; end if;
  -- A brief priced at the whole share cannot be funded on any day but the month's last.
  select * into funded from public.agent_brief_refresh_funded(400000);
  if funded.funded and funded.needed_microdollars > 400000 then raise exception 'Unaffordable refresh was funded: %', funded; end if;
end $$;

reset role;
do $$ begin
  if (select refreshes_used from cadence_advisor_private.daily_brief_days) <> 0 then raise exception 'The upgrade counted as a refresh'; end if;
  if (select briefing ->> 'text' from cadence_advisor_private.daily_brief_days) <> 'With moves.' then raise exception 'The upgrade was not saved'; end if;
end $$;

rollback;
