\set ON_ERROR_STOP on

-- Tickets 360 and 361 follow-up (migration 20261126100000, D33). Synthetic local
-- fixtures only; all changes roll back. Run after `npm run supabase -- db reset`:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/alongside-pairing-evidence-and-brief-asks.sql
--
-- advisor_read_pairing_evidence:
--   1. The Daily Brief and Chat agent channels read it; the person's session, the coach
--      channel and an MCP grant token are refused (42501).
--   2. Own account only: another account's signals, and a done_together partner that is
--      another account's Behavior, never appear.
--   3. Only done_together pairs (behavior_id, other_behavior_id) and whole crowded_hour
--      hours from 0 to 23. No other kind, no other fact.
--   4. Today, else yesterday while nothing is stored for today; a day with only other
--      kinds stored does not fall back.
--   5. Read only: stable, security definer with an empty search_path, execute granted to
--      authenticated alone, coach_signals unchanged and still closed to API roles.
-- brief_alongside_asks:
--   6. The person inserts and reads their own rows only; a repeat keeps the first date;
--      no update or delete grant; anon has nothing.
--   7. Behavior deletion and account deletion remove the rows.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('36100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pairing-a@example.invalid', '{"provider":"email","providers":["email"]}', '{}'),
  ('36100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pairing-b@example.invalid', '{"provider":"email","providers":["email"]}', '{}');
insert into auth.sessions (id, user_id) values
  ('36100000-0000-4000-8000-000000000011', '36100000-0000-4000-8000-000000000001');
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('36110000-0000-4000-8000-000000000001', '36100000-0000-4000-8000-000000000001', 'Red light helmet', '{"type":"daily"}', '14:00', 'UTC'),
  ('36110000-0000-4000-8000-000000000002', '36100000-0000-4000-8000-000000000001', 'Reading', '{"type":"daily"}', '20:00', 'UTC'),
  ('36110000-0000-4000-8000-000000000003', '36100000-0000-4000-8000-000000000002', 'Gym', '{"type":"daily"}', '07:00', 'UTC');

-- Day D = 2026-11-24. A: two done_together signals (one names B's Behavior), a crowded
-- hour, and a completion_drop carrying the same fact names. D+3: A has only a
-- completion_drop. B: a crowded hour and a done_together naming A's Behavior on D; a
-- fractional hour on D+1.
insert into cadence_advisor_private.coach_signals (user_id, local_date, kind, behavior_id, facts, signal_version) values
  ('36100000-0000-4000-8000-000000000001', '2026-11-24', 'done_together', '36110000-0000-4000-8000-000000000001',
    '{"other_behavior_id":"36110000-0000-4000-8000-000000000002","together_days":9,"pattern":"together"}', 'v2'),
  ('36100000-0000-4000-8000-000000000001', '2026-11-24', 'done_together', '36110000-0000-4000-8000-000000000002',
    '{"other_behavior_id":"36110000-0000-4000-8000-000000000003","together_days":4}', 'v2'),
  ('36100000-0000-4000-8000-000000000001', '2026-11-24', 'crowded_hour', null, '{"hour":19,"items_in_hour":3.4}', 'v2'),
  ('36100000-0000-4000-8000-000000000001', '2026-11-24', 'completion_drop', '36110000-0000-4000-8000-000000000001',
    '{"other_behavior_id":"36110000-0000-4000-8000-000000000002","hour":7,"rate":0.2}', 'v2'),
  ('36100000-0000-4000-8000-000000000001', '2026-11-27', 'completion_drop', '36110000-0000-4000-8000-000000000002', '{"rate":0.1}', 'v2'),
  ('36100000-0000-4000-8000-000000000002', '2026-11-24', 'crowded_hour', null, '{"hour":8}', 'v2'),
  ('36100000-0000-4000-8000-000000000002', '2026-11-24', 'done_together', '36110000-0000-4000-8000-000000000003',
    '{"other_behavior_id":"36110000-0000-4000-8000-000000000001"}', 'v2'),
  ('36100000-0000-4000-8000-000000000002', '2026-11-25', 'crowded_hour', null, '{"hour":7.5}', 'v2');

create temporary table pairing_signal_count on commit drop as
  select count(*) as n, md5(string_agg(id::text || kind || facts::text, ',' order by id)) as digest
  from cadence_advisor_private.coach_signals;

-- 5. Function shape and grants.
do $$
declare
  fn constant regprocedure := 'public.advisor_read_pairing_evidence(date)'::regprocedure;
  proc record;
begin
  select provolatile, prosecdef, proconfig into proc from pg_catalog.pg_proc where oid = fn;
  if proc.provolatile <> 's' then raise exception 'advisor_read_pairing_evidence is not stable: %', proc.provolatile; end if;
  if not proc.prosecdef then raise exception 'advisor_read_pairing_evidence is not security definer'; end if;
  if not (proc.proconfig @> array['search_path=""']) then raise exception 'search_path is %', proc.proconfig; end if;
  if not has_function_privilege('authenticated', fn, 'execute') then raise exception 'authenticated cannot execute'; end if;
  if has_function_privilege('anon', fn, 'execute') then raise exception 'anon can execute'; end if;
  if has_function_privilege('service_role', fn, 'execute') then raise exception 'service_role can execute'; end if;
  if has_table_privilege('authenticated', 'cadence_advisor_private.coach_signals', 'select') then
    raise exception 'authenticated can select coach_signals';
  end if;
  if not has_table_privilege('authenticated', 'public.brief_alongside_asks', 'select')
      or not has_table_privilege('authenticated', 'public.brief_alongside_asks', 'insert') then
    raise exception 'authenticated lacks select or insert on brief_alongside_asks';
  end if;
  if has_table_privilege('authenticated', 'public.brief_alongside_asks', 'update')
      or has_table_privilege('authenticated', 'public.brief_alongside_asks', 'delete') then
    raise exception 'authenticated may update or delete brief_alongside_asks';
  end if;
  if has_table_privilege('anon', 'public.brief_alongside_asks', 'select')
      or has_table_privilege('anon', 'public.brief_alongside_asks', 'insert') then
    raise exception 'anon reaches brief_alongside_asks';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.brief_alongside_asks'::regclass) then
    raise exception 'brief_alongside_asks has RLS off';
  end if;
end;
$$;

set local role authenticated;

do $$
declare
  person constant text := '{"sub":"36100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"36100000-0000-4000-8000-000000000011"}';
  brief constant text := '{"sub":"36100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"daily_brief"}';
  chat constant text := '{"sub":"36100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"chat"}';
  coach constant text := '{"sub":"36100000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"coach"}';
  grant_token constant text := '{"sub":"36100000-0000-4000-8000-000000000001","role":"authenticated","cadence_grant_id":"36100000-0000-4000-8000-000000000099"}';
  chat_b constant text := '{"sub":"36100000-0000-4000-8000-000000000002","role":"authenticated","cadence_channel":"chat"}';
  expected_a constant jsonb := jsonb_build_object(
    'done_together', jsonb_build_array(jsonb_build_object(
      'behavior_id', '36110000-0000-4000-8000-000000000001', 'other_behavior_id', '36110000-0000-4000-8000-000000000002')),
    'crowded_hours', jsonb_build_array(19));
  empty constant jsonb := '{"done_together":[],"crowded_hours":[]}';
  result jsonb;
  token text;
begin
  -- 1. Refused channels.
  foreach token in array array[person, coach, grant_token] loop
    perform set_config('request.jwt.claims', token, true);
    begin
      perform public.advisor_read_pairing_evidence('2026-11-24');
      raise exception 'A refused caller read pairing evidence: %', token;
    exception when sqlstate '42501' then null;
    end;
  end loop;
  perform set_config('request.jwt.claims', person, true);
  begin
    perform 1 from cadence_advisor_private.coach_signals;
    raise exception 'The person selected coach_signals directly';
  exception when sqlstate '42501' then null;
  end;

  -- 2 and 3. Daily Brief and Chat channels: own pairs and hours only.
  foreach token in array array[brief, chat] loop
    perform set_config('request.jwt.claims', token, true);
    result := public.advisor_read_pairing_evidence('2026-11-24');
    if result <> expected_a then raise exception 'Evidence for A on D was %', result; end if;
    begin
      perform public.advisor_read_pairing_evidence(null);
      raise exception 'A null date was accepted';
    exception when sqlstate '22023' then null;
    end;
  end loop;

  perform set_config('request.jwt.claims', chat_b, true);
  result := public.advisor_read_pairing_evidence('2026-11-24');
  if result <> '{"done_together":[],"crowded_hours":[8]}'::jsonb then raise exception 'Evidence for B on D was %', result; end if;
  -- A fractional hour is not an hour.
  result := public.advisor_read_pairing_evidence('2026-11-25');
  if result <> empty then raise exception 'Evidence for B on D+1 was %', result; end if;

  -- 4. Today, else yesterday.
  perform set_config('request.jwt.claims', brief, true);
  result := public.advisor_read_pairing_evidence('2026-11-25');
  if result <> expected_a then raise exception 'D+1 should fall back to D: %', result; end if;
  result := public.advisor_read_pairing_evidence('2026-11-27');
  if result <> empty then raise exception 'D+3 has signals stored and must not fall back: %', result; end if;
  result := public.advisor_read_pairing_evidence('2026-11-26');
  if result <> empty then raise exception 'D+2 falls back to D+1, which has none: %', result; end if;

  -- 6. brief_alongside_asks as the person.
  perform set_config('request.jwt.claims', person, true);
  insert into public.brief_alongside_asks (user_id, behavior_id, local_date)
  values ('36100000-0000-4000-8000-000000000001', '36110000-0000-4000-8000-000000000001', '2026-11-24');
  insert into public.brief_alongside_asks (user_id, behavior_id, local_date)
  values ('36100000-0000-4000-8000-000000000001', '36110000-0000-4000-8000-000000000001', '2026-11-25')
  on conflict do nothing;
  if (select local_date from public.brief_alongside_asks
      where behavior_id = '36110000-0000-4000-8000-000000000001') <> '2026-11-24' then
    raise exception 'A repeat changed the first asked date';
  end if;
  begin
    insert into public.brief_alongside_asks (user_id, behavior_id, local_date)
    values ('36100000-0000-4000-8000-000000000002', '36110000-0000-4000-8000-000000000003', '2026-11-24');
    raise exception 'A wrote a row for B';
  exception when sqlstate '42501' then null;
  end;
  begin
    insert into public.brief_alongside_asks (user_id, behavior_id, local_date)
    values ('36100000-0000-4000-8000-000000000001', '36110000-0000-4000-8000-000000000003', '2026-11-24');
    raise exception 'A recorded B''s Behavior';
  exception when sqlstate '23503' then null;
  end;
  begin
    update public.brief_alongside_asks set local_date = '2026-11-01';
    raise exception 'The person updated an asked row';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claims', chat_b, true);
  if exists (select 1 from public.brief_alongside_asks) then raise exception 'B sees A''s asked rows'; end if;
  perform set_config('request.jwt.claims', person, true);
  if (select count(*) from public.brief_alongside_asks) <> 1 then raise exception 'A should see one asked row'; end if;
end;
$$;

reset role;

do $$
begin
  -- 5. The reads wrote nothing.
  if (select n from pairing_signal_count) <> (select count(*) from cadence_advisor_private.coach_signals)
    or (select digest from pairing_signal_count) <> (select md5(string_agg(id::text || kind || facts::text, ',' order by id))
      from cadence_advisor_private.coach_signals) then
    raise exception 'coach_signals changed';
  end if;

  -- 7. Behavior deletion, then account deletion, remove the asked rows.
  insert into public.brief_alongside_asks (user_id, behavior_id, local_date)
  values ('36100000-0000-4000-8000-000000000001', '36110000-0000-4000-8000-000000000002', '2026-11-24');
  delete from public.occurrences where behavior_id = '36110000-0000-4000-8000-000000000001';
  delete from public.behaviors where id = '36110000-0000-4000-8000-000000000001';
  if exists (select 1 from public.brief_alongside_asks where behavior_id = '36110000-0000-4000-8000-000000000001') then
    raise exception 'Behavior deletion kept its asked row';
  end if;
  if not exists (select 1 from public.brief_alongside_asks where behavior_id = '36110000-0000-4000-8000-000000000002') then
    raise exception 'Behavior deletion removed another Behavior''s asked row';
  end if;
  delete from auth.users where id = '36100000-0000-4000-8000-000000000001';
  if exists (select 1 from public.brief_alongside_asks where user_id = '36100000-0000-4000-8000-000000000001') then
    raise exception 'Account deletion kept asked rows';
  end if;
end;
$$;

rollback;
