\set ON_ERROR_STOP on

-- Workstream WS-1B (2026-11-25): Google Calendar AI MCP grant reactivation,
-- Ticket 335 unlink lock on both grants, atomic §2(d) disconnect purge across
-- all AI stores, <=30-day derived-finding expiry sweep keeping Chat threads
-- intact, longitudinal review opt-in & RLS, and permission boundaries.
-- Synthetic users only; everything rolls back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('20261125-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ws1b-owner-a@example.invalid', '{}', '{}'),
  ('20261125-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ws1b-owner-b@example.invalid', '{}', '{}');

insert into auth.sessions (id, user_id)
values
  ('20261125-0000-4000-8000-000000000011', '20261125-0000-4000-8000-000000000001'),
  ('20261125-0000-4000-8000-000000000012', '20261125-0000-4000-8000-000000000002');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
values
  ('20261125-0000-4000-8000-000000000101', '20261125-0000-4000-8000-000000000001', 'google-sub-a', '{"sub":"google-sub-a"}', 'google', now(), now()),
  ('20261125-0000-4000-8000-000000000102', '20261125-0000-4000-8000-000000000001', 'apple-sub-a', '{"sub":"apple-sub-a"}', 'apple', now(), now()),
  ('20261125-0000-4000-8000-000000000103', '20261125-0000-4000-8000-000000000002', 'google-sub-b', '{"sub":"google-sub-b"}', 'google', now(), now());

-- 1. Permission boundaries (anon / authenticated / service_role)
do $$
begin
  if not has_function_privilege('service_role', 'public.calendar_agent_begin_attempt(uuid,text,text,text,bigint,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.calendar_agent_consume_attempt(text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.calendar_agent_install_credential(uuid,text,bigint,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.calendar_agent_read_credential(uuid,text,bigint)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.calendar_agent_disconnect(uuid,text,bigint,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.purge_expired_google_calendar_ai_data()', 'EXECUTE')
  then
    raise exception 'service_role missing expected execute privileges.';
  end if;

  if has_function_privilege('anon', 'public.calendar_agent_read_credential(uuid,text,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.calendar_agent_read_credential(uuid,text,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.purge_expired_google_calendar_ai_data()', 'EXECUTE')
    or has_function_privilege('anon', 'public.count_google_calendar_ai_chats()', 'EXECUTE')
    or has_function_privilege('authenticated', 'cadence_advisor_private.purge_google_calendar_ai_data(uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'cadence_advisor_private.purge_google_calendar_ai_data(uuid)', 'EXECUTE')
  then
    raise exception 'Unexpected privilege exposure on private/service_role functions.';
  end if;
end;
$$;

-- 2. Agent grant lifecycle + auto-clear exclude_google_calendar + Ticket 335 unlink lock
insert into cadence_advisor_private.daily_brief_preferences (
  user_id, enabled, include_calendar, revision,
  use_connected_sources, exclude_google_calendar, exclude_outlook_calendar, exclude_icloud_calendar, exclude_hevy
) values (
  '20261125-0000-4000-8000-000000000001', true, false, 1,
  true, true, false, false, false
);

do $$
declare
  v_gen bigint;
  v_installed boolean;
  v_token text;
  v_excluded boolean;
begin
  v_gen := public.calendar_agent_begin_attempt(
    '20261125-0000-4000-8000-000000000001',
    'google-sub-a',
    repeat('a', 64),
    'sealed-verifier',
    0,
    'web',
    'client-nonce',
    'agent-oauth-client-id'
  );
  if v_gen <> 0 then
    raise exception 'Expected generation 0, got %', v_gen;
  end if;

  v_installed := public.calendar_agent_install_credential(
    '20261125-0000-4000-8000-000000000001',
    'google-sub-a',
    0,
    repeat('a', 64),
    'sealed-agent-token',
    'agent-oauth-client-id'
  );
  if not v_installed then
    raise exception 'Expected agent credential install to succeed.';
  end if;

  v_token := public.calendar_agent_read_credential(
    '20261125-0000-4000-8000-000000000001',
    'google-sub-a',
    1
  );
  if v_token <> 'sealed-agent-token' then
    raise exception 'Expected sealed-agent-token, got %', v_token;
  end if;

  select exclude_google_calendar into v_excluded
  from cadence_advisor_private.daily_brief_preferences
  where user_id = '20261125-0000-4000-8000-000000000001';
  if v_excluded then
    raise exception 'Expected exclude_google_calendar to be cleared on AI connect.';
  end if;

  -- Ticket 335 lock: deleting Google identity while agent grant is connected must fail.
  begin
    delete from auth.identities where id = '20261125-0000-4000-8000-000000000101';
    raise exception 'Unlinking Google identity with connected agent grant should have failed.';
  exception when sqlstate 'P0001' then
    null;
  end;
end;
$$;

-- 3. Seed Google-Calendar-derived rows across all stores & test <=30-day expiry sweep
insert into public.chat_conversations (id, user_id, title, summary, google_calendar_first_touched_at, google_calendar_grant_generation, summary_google_calendar_expires_at)
values
  ('20261125-0000-4000-8000-000000001001', '20261125-0000-4000-8000-000000000001', 'GCal expired summary', 'Old summary', now() - interval '35 days', 1, now() - interval '1 hour'),
  ('20261125-0000-4000-8000-000000001002', '20261125-0000-4000-8000-000000000001', 'Non-GCal chat', 'Keep summary', null, null, null);

insert into public.daily_calendar_load (user_id, source, local_date, busy_minutes, event_count, earliest_start_minute, latest_end_minute, connection_generation, grant_purpose, synced_at, expires_at)
values
  ('20261125-0000-4000-8000-000000000001', 'google_calendar', current_date - 35, 60, 1, 540, 600, 1, 'agent_mcp', now() - interval '35 days', now() - interval '5 days'),
  ('20261125-0000-4000-8000-000000000001', 'google_calendar', current_date, 90, 2, 540, 720, 1, 'agent_mcp', now(), now() + interval '30 days'),
  ('20261125-0000-4000-8000-000000000001', 'outlook_calendar', current_date - 40, 30, 1, 600, 630, 1, 'standard', now() - interval '40 days', null);

insert into public.longitudinal_calendar_reviews (id, user_id, cadence, window_start, window_end, summary_json, contains_google_calendar, google_calendar_grant_generation, created_at, expires_at)
values
  ('20261125-0000-4000-8000-000000002001', '20261125-0000-4000-8000-000000000001', 'weekly', current_date - 37, current_date - 31, '{"ok":true}', true, 1, now() - interval '35 days', now() - interval '5 days'),
  ('20261125-0000-4000-8000-000000002002', '20261125-0000-4000-8000-000000000001', 'weekly', current_date - 7, current_date, '{"ok":true}', true, 1, now(), now() + interval '30 days');

insert into cadence_advisor_private.daily_brief_days (user_id, local_date, timezone, briefing, included_google_calendar, google_calendar_grant_generation)
values
  ('20261125-0000-4000-8000-000000000001', current_date, 'America/New_York', '{"opening":"hi"}', true, 1);

do $$
declare
  v_purged integer;
  v_summary text;
begin
  v_purged := public.purge_expired_google_calendar_ai_data();
  if v_purged < 3 then
    raise exception 'Expected at least 3 expired items purged, got %', v_purged;
  end if;

  -- Q4 Option 2: conversation itself stays, summary is nulled.
  select summary into v_summary from public.chat_conversations where id = '20261125-0000-4000-8000-000000001001';
  if not found or v_summary is not null then
    raise exception 'Expired chat summary was not nulled while keeping conversation.';
  end if;

  -- Non-expired Google load and Outlook load remain.
  if not exists (select 1 from public.daily_calendar_load where user_id = '20261125-0000-4000-8000-000000000001' and source = 'google_calendar' and local_date = current_date)
    or not exists (select 1 from public.daily_calendar_load where user_id = '20261125-0000-4000-8000-000000000001' and source = 'outlook_calendar')
  then
    raise exception 'Expiry sweep deleted non-expired or Outlook rows.';
  end if;
end;
$$;

-- 4. Count helper + read_ai_settings / save_ai_settings longitudinal review opt-in
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"20261125-0000-4000-8000-000000000001","role":"authenticated","session_id":"20261125-0000-4000-8000-000000000011"}', true);
do $$
declare
  v_count integer;
  v_settings jsonb;
begin
  v_count := public.count_google_calendar_ai_chats();
  if v_count <> 1 then
    raise exception 'Expected 1 Google-Calendar-touched chat, got %', v_count;
  end if;

  v_settings := public.read_ai_settings();
  if v_settings ->> 'google_calendar_source' <> 'agent_mcp'
    or (v_settings ->> 'longitudinal_calendar_review_enabled')::boolean
    or v_settings ->> 'longitudinal_calendar_review_cadence' <> 'weekly'
  then
    raise exception 'Unexpected read_ai_settings defaults: %', v_settings;
  end if;

  v_settings := public.save_ai_settings(true, true, true, true, false, false, false, false, false, false, 2, true, 'monthly');
  if not (v_settings ->> 'longitudinal_calendar_review_enabled')::boolean
    or v_settings ->> 'longitudinal_calendar_review_cadence' <> 'monthly'
  then
    raise exception 'save_ai_settings did not persist longitudinal review opt-in: %', v_settings;
  end if;
end;
$$;
reset role;

-- 5. Atomic §2(d) disconnect purge inside calendar_agent_disconnect
do $$
declare
  v_old text;
begin
  v_old := public.calendar_agent_disconnect(
    '20261125-0000-4000-8000-000000000001',
    'google-sub-a',
    1,
    'disconnected'
  );
  if v_old <> 'sealed-agent-token' then
    raise exception 'Expected old token on disconnect, got %', v_old;
  end if;

  if exists (select 1 from public.chat_conversations where id = '20261125-0000-4000-8000-000000001001')
    or not exists (select 1 from public.chat_conversations where id = '20261125-0000-4000-8000-000000001002')
    or exists (select 1 from cadence_advisor_private.daily_brief_days where user_id = '20261125-0000-4000-8000-000000000001')
    or exists (select 1 from public.daily_calendar_load where user_id = '20261125-0000-4000-8000-000000000001' and source = 'google_calendar')
    or not exists (select 1 from public.daily_calendar_load where user_id = '20261125-0000-4000-8000-000000000001' and source = 'outlook_calendar')
    or exists (select 1 from public.longitudinal_calendar_reviews where user_id = '20261125-0000-4000-8000-000000000001')
  then
    raise exception 'Atomic disconnect purge failed to wipe Google AI data or touched non-Google data.';
  end if;

  -- Now unlinking Google identity succeeds because agent grant is disconnected.
  delete from auth.identities where id = '20261125-0000-4000-8000-000000000101';
end;
$$;

rollback;
