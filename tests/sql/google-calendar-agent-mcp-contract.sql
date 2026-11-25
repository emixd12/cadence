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

  if not has_table_privilege('service_role', 'public.longitudinal_calendar_reviews', 'SELECT')
    or not has_table_privilege('service_role', 'public.longitudinal_calendar_reviews', 'INSERT')
    or not has_table_privilege('service_role', 'public.longitudinal_calendar_reviews', 'UPDATE')
    or not has_table_privilege('service_role', 'public.longitudinal_calendar_reviews', 'DELETE')
  then
    raise exception 'service_role missing expected table privileges on public.longitudinal_calendar_reviews.';
  end if;

  if has_function_privilege('anon', 'public.calendar_agent_read_credential(uuid,text,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.calendar_agent_read_credential(uuid,text,bigint)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.purge_expired_google_calendar_ai_data()', 'EXECUTE')
    or has_function_privilege('anon', 'public.count_google_calendar_ai_chats()', 'EXECUTE')
    or has_function_privilege('authenticated', 'cadence_advisor_private.purge_google_calendar_ai_data(uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'cadence_advisor_private.purge_google_calendar_ai_data(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'cadence_advisor_private.assert_google_calendar_agent_generation(uuid,bigint)', 'EXECUTE')
    or has_function_privilege('service_role', 'cadence_advisor_private.assert_google_calendar_agent_generation(uuid,bigint)', 'EXECUTE')
    or has_function_privilege('anon', 'public.move_occurrence_to_date(uuid,date,timestamptz,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.move_occurrence_to_date(uuid,date,timestamptz,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.move_occurrence_to_date(uuid,date,timestamptz,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
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
  ('20261125-0000-4000-8000-000000000001', 'google_calendar', current_date - 10, 45, 1, 540, 585, 1, 'standard', now() - interval '10 days', null),
  ('20261125-0000-4000-8000-000000000001', 'google_calendar', current_date, 90, 2, 540, 720, 1, 'agent_mcp', now(), now() + interval '30 days'),
  ('20261125-0000-4000-8000-000000000001', 'outlook_calendar', current_date - 40, 30, 1, 600, 630, 1, 'standard', now() - interval '40 days', null);

-- Generation fence triggers: stale/wrong generation must raise SQLSTATE 55000.
do $$
begin
  begin
    insert into public.daily_calendar_load (user_id, source, local_date, busy_minutes, event_count, earliest_start_minute, latest_end_minute, connection_generation, grant_purpose, synced_at, expires_at)
    values ('20261125-0000-4000-8000-000000000001', 'google_calendar', current_date + 1, 30, 1, 540, 570, 999, 'agent_mcp', now(), now() + interval '30 days');
    raise exception 'Inserting daily_calendar_load with wrong generation should have failed.';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    insert into public.longitudinal_calendar_reviews (id, user_id, cadence, window_start, window_end, summary_json, contains_google_calendar, google_calendar_grant_generation, created_at, expires_at)
    values ('20261125-0000-4000-8000-000000002099', '20261125-0000-4000-8000-000000000001', 'weekly', current_date - 7, current_date, '{"ok":true}', true, 999, now(), now() + interval '30 days');
    raise exception 'Inserting longitudinal_calendar_reviews with wrong generation should have failed.';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

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

  -- Legacy REST-origin ('standard') Google row is removed; non-expired Google MCP and Outlook rows remain.
  if exists (select 1 from public.daily_calendar_load where user_id = '20261125-0000-4000-8000-000000000001' and source = 'google_calendar' and grant_purpose = 'standard') then
    raise exception 'Expiry sweep failed to remove legacy standard Google daily_calendar_load row.';
  end if;

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

  -- After disconnect, attempting to insert a Google agent_mcp daily_calendar_load row
  -- or stamp chat_conversations with the disconnected generation must raise SQLSTATE 55000.
  begin
    insert into public.daily_calendar_load (user_id, source, local_date, busy_minutes, event_count, earliest_start_minute, latest_end_minute, connection_generation, grant_purpose, synced_at, expires_at)
    values ('20261125-0000-4000-8000-000000000001', 'google_calendar', current_date + 2, 30, 1, 540, 570, 1, 'agent_mcp', now(), now() + interval '30 days');
    raise exception 'Inserting daily_calendar_load after disconnect should have failed.';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    update public.chat_conversations
    set google_calendar_grant_generation = 1
    where id = '20261125-0000-4000-8000-000000001002';
    raise exception 'Stamping chat_conversations with disconnected generation should have failed.';
  exception when sqlstate '55000' then
    null;
  end;

  -- Nulling an expired chat_conversations.summary via expiry sweep still succeeds after disconnect.
  insert into public.chat_conversations (id, user_id, title, summary, google_calendar_first_touched_at, google_calendar_grant_generation, summary_google_calendar_expires_at)
  values ('20261125-0000-4000-8000-000000001003', '20261125-0000-4000-8000-000000000001', 'Backfilled expired summary', 'Legacy summary', now() - interval '35 days', null, now() - interval '1 hour');

  perform public.purge_expired_google_calendar_ai_data();
  if exists (select 1 from public.chat_conversations where id = '20261125-0000-4000-8000-000000001003' and summary is not null) then
    raise exception 'Nulling expired chat_conversations.summary failed after disconnect.';
  end if;

  -- Now unlinking Google identity succeeds because agent grant is disconnected.
  delete from auth.identities where id = '20261125-0000-4000-8000-000000000101';
end;
$$;

-- 6. Cross-day move_occurrence_to_date RPC contract
insert into public.behaviors (
  id, user_id, title, recurrence_rule, scheduled_time, timezone, default_duration_minutes
) values (
  '20261125-0000-4000-8000-000000003001',
  '20261125-0000-4000-8000-000000000001',
  'WS-1B Cross-Day Move Test',
  '{"type":"daily"}'::jsonb,
  '09:00',
  'America/New_York',
  30
);

insert into public.occurrences (
  id, user_id, behavior_id, local_date, scheduled_for, schedule_kind, schedule_start_time, schedule_end_time, status
) values (
  '20261125-0000-4000-8000-000000004001',
  '20261125-0000-4000-8000-000000000001',
  '20261125-0000-4000-8000-000000003001',
  '2026-11-26',
  '2026-11-26T14:00:00Z'::timestamptz,
  'exact',
  '09:00',
  null,
  'unresolved'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"20261125-0000-4000-8000-000000000001","role":"authenticated","session_id":"20261125-0000-4000-8000-000000000011"}', true);

do $$
declare
  v_rev timestamptz;
  v_res jsonb;
  v_row public.occurrences;
begin
  select updated_at into v_rev
  from public.occurrences
  where id = '20261125-0000-4000-8000-000000004001';

  -- Stale expected_revision returns ok = false, reason = 'revision_changed'.
  v_res := public.move_occurrence_to_date(
    '20261125-0000-4000-8000-000000004001',
    '2026-11-27',
    '2026-11-27T15:00:00Z'::timestamptz,
    '2026-11-27T15:00:00Z'::timestamptz,
    '2026-11-27T15:30:00Z'::timestamptz,
    v_rev - interval '1 minute'
  );
  if (v_res ->> 'ok')::boolean or v_res ->> 'reason' <> 'revision_changed' then
    raise exception 'Expected revision_changed for stale revision, got %', v_res;
  end if;

  -- Valid timed cross-day move updates local_date, scheduled_for, effective_start_at, effective_end_at.
  v_res := public.move_occurrence_to_date(
    '20261125-0000-4000-8000-000000004001',
    '2026-11-27',
    '2026-11-27T15:00:00Z'::timestamptz,
    '2026-11-27T15:00:00Z'::timestamptz,
    '2026-11-27T15:30:00Z'::timestamptz,
    v_rev
  );
  if not (v_res ->> 'ok')::boolean
    or v_res -> 'previous' ->> 'local_date' <> '2026-11-26'
    or v_res -> 'occurrence' ->> 'local_date' <> '2026-11-27'
  then
    raise exception 'Expected timed cross-day move to succeed, got %', v_res;
  end if;

  select * into v_row from public.occurrences where id = '20261125-0000-4000-8000-000000004001';
  if v_row.local_date <> '2026-11-27'
    or v_row.scheduled_for <> '2026-11-27T15:00:00Z'::timestamptz
    or v_row.effective_start_at <> '2026-11-27T15:00:00Z'::timestamptz
    or v_row.effective_end_at <> '2026-11-27T15:30:00Z'::timestamptz
  then
    raise exception 'Timed cross-day move did not persist expected occurrence columns.';
  end if;

  -- Valid null-duration cross-day move succeeds and restores the original date.
  v_rev := v_row.updated_at;
  v_res := public.move_occurrence_to_date(
    '20261125-0000-4000-8000-000000004001',
    '2026-11-26',
    '2026-11-26T14:00:00Z'::timestamptz,
    null,
    null,
    v_rev
  );
  if not (v_res ->> 'ok')::boolean
    or v_res -> 'previous' ->> 'local_date' <> '2026-11-27'
    or v_res -> 'occurrence' ->> 'local_date' <> '2026-11-26'
  then
    raise exception 'Expected null-duration cross-day move to succeed, got %', v_res;
  end if;

  select * into v_row from public.occurrences where id = '20261125-0000-4000-8000-000000004001';
  if v_row.local_date <> '2026-11-26'
    or v_row.effective_start_at is not null
    or v_row.effective_end_at is not null
  then
    raise exception 'Null-duration cross-day move did not clear effective times or restore date.';
  end if;

  -- Unpaired (non-null, null) raises SQLSTATE 22023.
  begin
    perform public.move_occurrence_to_date(
      '20261125-0000-4000-8000-000000004001',
      '2026-11-27',
      '2026-11-27T15:00:00Z'::timestamptz,
      '2026-11-27T15:00:00Z'::timestamptz,
      null,
      v_row.updated_at
    );
    raise exception 'Unpaired effective_start_at / effective_end_at should have raised 22023.';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

reset role;

rollback;
