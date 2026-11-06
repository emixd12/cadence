-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-276-leave-reminder-identity-smoke.sql
-- Ticket 276: the leave reminder job's Google identity read.
-- leave_reminder_google_subject() returns the caller's own single Google
-- provider id for a leave reminder token. It refuses a normal session, an MCP
-- token, anon and the service role, returns null without exactly one Google
-- identity, and never reads another account. Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('27600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'leave-identity-a@example.invalid', '{}', '{}'),
  ('27600000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'leave-identity-b@example.invalid', '{}', '{}'),
  ('27600000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'leave-identity-c@example.invalid', '{}', '{}');

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('google-sub-a', '27600000-0000-4000-8000-000000000001', '{"sub":"google-sub-a"}', 'google', now(), now(), now()),
  ('leave-identity-a@example.invalid', '27600000-0000-4000-8000-000000000001', '{"sub":"27600000-0000-4000-8000-000000000001"}', 'email', now(), now(), now()),
  ('google-sub-b', '27600000-0000-4000-8000-000000000002', '{"sub":"google-sub-b"}', 'google', now(), now(), now());

set local role authenticated;

do $$
declare
  subject text;
begin
  -- A leave reminder token reads its own subject, never another account's.
  perform set_config('request.jwt.claims', '{"sub":"27600000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"leave_reminder"}', true);
  subject := public.leave_reminder_google_subject();
  if subject is distinct from 'google-sub-a' then
    raise exception 'Account A read % instead of its own Google subject.', coalesce(subject, 'null');
  end if;

  perform set_config('request.jwt.claims', '{"sub":"27600000-0000-4000-8000-000000000002","role":"authenticated","cadence_channel":"leave_reminder"}', true);
  if public.leave_reminder_google_subject() is distinct from 'google-sub-b' then
    raise exception 'Account B did not read its own Google subject.';
  end if;

  -- No Google identity: null, so the Calendar check fails closed.
  perform set_config('request.jwt.claims', '{"sub":"27600000-0000-4000-8000-000000000003","role":"authenticated","cadence_channel":"leave_reminder"}', true);
  if public.leave_reminder_google_subject() is not null then
    raise exception 'An account without a Google identity returned a subject.';
  end if;

  -- A normal session and an MCP token are refused.
  perform set_config('request.jwt.claims', '{"sub":"27600000-0000-4000-8000-000000000001","role":"authenticated","session_id":"27600000-0000-4000-8000-0000000000aa"}', true);
  begin
    perform public.leave_reminder_google_subject();
    raise exception 'A normal session read the Google subject.';
  exception when insufficient_privilege then
    if sqlerrm <> 'leave_reminder_token_required' then raise; end if;
  end;

  perform set_config('request.jwt.claims', '{"sub":"27600000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"mcp","cadence_grant_id":"27600000-0000-4000-8000-0000000000bb","cadence_client_id":"client"}', true);
  begin
    perform public.leave_reminder_google_subject();
    raise exception 'An MCP token read the Google subject.';
  exception when insufficient_privilege then
    if sqlerrm <> 'leave_reminder_token_required' then raise; end if;
  end;

  -- A leave reminder token is not an MCP grant.
  perform set_config('request.jwt.claims', '{"sub":"27600000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"leave_reminder"}', true);
  begin
    perform public.integration_record_activity('cadence.read', array[]::uuid[], 'ok', null);
    raise exception 'A leave reminder token used an MCP grant function.';
  exception when insufficient_privilege then
    if sqlerrm <> 'integration_grant_required' then raise; end if;
  end;
end;
$$;

-- Two Google identities: null.
reset role;
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('google-sub-a2', '27600000-0000-4000-8000-000000000001', '{"sub":"google-sub-a2"}', 'google', now(), now(), now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"27600000-0000-4000-8000-000000000001","role":"authenticated","cadence_channel":"leave_reminder"}', true);
do $$
begin
  if public.leave_reminder_google_subject() is not null then
    raise exception 'An account with two Google identities returned a subject.';
  end if;
end;
$$;

-- anon and the service role cannot execute it.
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.leave_reminder_google_subject()', 'execute') then
    raise exception 'anon can execute leave_reminder_google_subject.';
  end if;
  if has_function_privilege('service_role', 'public.leave_reminder_google_subject()', 'execute') then
    raise exception 'The service role can execute leave_reminder_google_subject.';
  end if;
  if not has_function_privilege('authenticated', 'public.leave_reminder_google_subject()', 'execute') then
    raise exception 'authenticated cannot execute leave_reminder_google_subject.';
  end if;
end;
$$;

select 'ticket-276 leave reminder identity smoke: pass' as result;

rollback;
