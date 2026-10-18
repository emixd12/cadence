\set ON_ERROR_STOP on

-- Ticket 222 OAuth and integration persistence smoke. Runs inside one
-- transaction and rolls back, so it leaves no rows behind.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('22200000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
   'ticket-222-a@example.invalid', '', '2026-10-18T00:00:00Z',
   '{"provider":"email","providers":["email"]}', '{}', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z'),
  ('22200000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
   'ticket-222-b@example.invalid', '', '2026-10-18T00:00:00Z',
   '{"provider":"email","providers":["email"]}', '{}', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z');

insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, active)
values
  ('22200000-0000-4000-8000-0000000000a1', '22200000-0000-4000-8000-00000000000a',
   'Ticket 222 fixture A', '{"frequency":"daily","interval":1}', '09:00', true),
  ('22200000-0000-4000-8000-0000000000b1', '22200000-0000-4000-8000-00000000000b',
   'Ticket 222 fixture B', '{"frequency":"daily","interval":1}', '09:00', true);

create temporary table ticket_222_facts (name text primary key, value text not null) on commit drop;
grant all on ticket_222_facts to authenticated, service_role, anon;

-- Exposure: the private schema and its tables are unreachable for API roles.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(role_name, 'cadence_oauth_private', 'USAGE') then
      raise exception '% must not have usage on cadence_oauth_private', role_name;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'cadence_oauth_private' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    raise exception 'Every private OAuth table must enable RLS';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'oauth\_%' or p.proname like 'integration\_%')
      and (p.prosecdef is distinct from (p.proname <> 'integration_apply_write')
        or p.proconfig is distinct from array['search_path=""'])
  ) then
    raise exception 'OAuth functions require an empty search_path; only the product write wrapper must be SECURITY INVOKER';
  end if;
  if has_function_privilege('authenticated', 'public.oauth_verify_access_token(text, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.oauth_exchange_authorization_code(text, text, text, text, text, text, text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.oauth_revoke_all_grants()', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.oauth_rotate_refresh_token(text, text, text, text[], text, text)', 'EXECUTE') then
    raise exception 'Token-endpoint functions must be executable by service_role only';
  end if;
  if has_function_privilege('service_role', 'public.oauth_approve_consent(text, text, text, text, text[], text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.oauth_list_grants()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.integration_idempotency_begin(text, text, text)', 'EXECUTE') then
    raise exception 'User-session functions must be executable by authenticated only';
  end if;
end;
$$;

-- Registration (service_role).
set local role service_role;
do $$
declare
  client jsonb;
  rejected boolean := false;
begin
  client := public.oauth_register_client(
    'dcr-ticket-222', 'dcr', 'Ticket 222 Client', null, null,
    array['https://client.example/callback', 'http://127.0.0.1/callback'], 'native', '{}'::jsonb, null, null
  );
  if client ->> 'client_id' <> 'dcr-ticket-222' or (client ->> 'metadata_stale')::boolean then
    raise exception 'DCR registration returned unexpected metadata';
  end if;
  perform public.oauth_register_client(
    'https://chatgpt.com/oauth/client.json', 'cimd', 'ChatGPT', null, null,
    array['https://chatgpt.com/connector_platform_oauth_redirect'], 'web', '{}'::jsonb, 'chatgpt', now() + interval '1 hour'
  );
  begin
    perform public.oauth_register_client(
      'dcr-fake-claude', 'dcr', 'Not Claude', null, null,
      array['https://evil.example/callback'], 'web', '{}'::jsonb, 'claude', null
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'A verified label must require the known client identity';
  end if;
  if public.oauth_get_client('missing-client') is not null then
    raise exception 'Unknown clients must resolve to null';
  end if;
end;
$$;
reset role;

-- Consent as user A (authenticated session).
set local role authenticated;
set local request.jwt.claims = '{"sub":"22200000-0000-4000-8000-00000000000a","role":"authenticated"}';
do $$
declare
  consent jsonb;
  rejected boolean := false;
begin
  begin
    perform public.oauth_approve_consent(
      'dcr-ticket-222', 'https://evil.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('1', 64)
    );
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Unregistered redirect URIs must be rejected';
  end if;

  -- Loopback redirect URIs match on any port.
  consent := public.oauth_approve_consent(
    'dcr-ticket-222', 'http://127.0.0.1:49152/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    'https://app.cadence-me.com/mcp', array['cadence.read', 'cadence.occurrences.write'], repeat('a', 64)
  );
  insert into ticket_222_facts values ('grant_a', consent ->> 'grant_id');

  -- Second code for the same grant (re-consent keeps one active grant).
  consent := public.oauth_approve_consent(
    'dcr-ticket-222', 'https://client.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    'https://app.cadence-me.com/mcp', array['cadence.read', 'cadence.occurrences.write'], repeat('b', 64)
  );
  if consent ->> 'grant_id' <> (select value from ticket_222_facts where name = 'grant_a') then
    raise exception 'Re-consent must reuse the active grant';
  end if;

  -- Codes for wrong-redirect and wrong-resource exchanges.
  perform public.oauth_approve_consent(
    'dcr-ticket-222', 'https://client.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('7a', 32)
  );
  perform public.oauth_approve_consent(
    'dcr-ticket-222', 'https://client.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('7b', 32)
  );
  perform public.oauth_approve_consent(
    'dcr-ticket-222', 'https://client.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('7c', 32)
  );

  -- A code that will expire.
  perform public.oauth_approve_consent(
    'dcr-ticket-222', 'https://client.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('c', 64)
  );

  if (select count(*) from public.oauth_list_grants()) <> 1 then
    raise exception 'User A must see exactly one grant';
  end if;
end;
$$;
reset role;

-- Backdate code c so it is expired.
update cadence_oauth_private.authorization_codes
set created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute'
where code_hash = repeat('c', 64);

-- Token endpoint (service_role): single use, PKCE, expiry, rotation, reuse.
set local role service_role;
do $$
declare
  result jsonb;
  verified jsonb;
begin
  -- Wrong PKCE verifier burns the code.
  result := public.oauth_exchange_authorization_code(
    repeat('a', 64), 'dcr-ticket-222', 'http://127.0.0.1:49152/callback', 'https://app.cadence-me.com/mcp',
    'wrong-verifier-wrong-verifier-wrong-verifier-000', repeat('0', 63) || '1', repeat('0', 63) || '2'
  );
  if (result ->> 'ok')::boolean then
    raise exception 'A wrong PKCE verifier must fail';
  end if;
  result := public.oauth_exchange_authorization_code(
    repeat('a', 64), 'dcr-ticket-222', 'http://127.0.0.1:49152/callback', 'https://app.cadence-me.com/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('0', 63) || '1', repeat('0', 63) || '2'
  );
  if (result ->> 'ok')::boolean then
    raise exception 'A burned code must not be exchangeable';
  end if;

  -- Expired code.
  result := public.oauth_exchange_authorization_code(
    repeat('c', 64), 'dcr-ticket-222', 'https://client.example/callback', 'https://app.cadence-me.com/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('0', 63) || '3', repeat('0', 63) || '4'
  );
  if (result ->> 'ok')::boolean then
    raise exception 'An expired code must fail';
  end if;

  result := public.oauth_exchange_authorization_code(
    repeat('7a', 32), 'dcr-ticket-222', 'https://client.example/other', 'https://app.cadence-me.com/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('0', 63) || '5', repeat('0', 63) || '6'
  );
  if (result ->> 'ok')::boolean then
    raise exception 'A wrong redirect URI must fail';
  end if;
  result := public.oauth_exchange_authorization_code(
    repeat('7b', 32), 'dcr-ticket-222', 'https://client.example/callback', 'https://other.example/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('0', 63) || '7', repeat('0', 63) || '8'
  );
  if (result ->> 'ok')::boolean then
    raise exception 'A wrong resource must fail';
  end if;
  result := public.oauth_exchange_authorization_code(
    repeat('7c', 32), 'other-client', 'https://client.example/callback', 'https://app.cadence-me.com/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('0', 63) || '9', repeat('0', 62) || '10'
  );
  if (result ->> 'ok')::boolean then
    raise exception 'A different client must not exchange the code';
  end if;

  result := public.oauth_exchange_authorization_code(
    repeat('b', 64), 'dcr-ticket-222', 'https://client.example/callback', 'https://app.cadence-me.com/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('1', 64), repeat('2', 64)
  );
  if not (result ->> 'ok')::boolean
    or result -> 'scopes' <> '["cadence.occurrences.write", "cadence.read"]'::jsonb then
    raise exception 'A valid exchange must succeed with the granted scopes: %', result;
  end if;

  -- Single use: replay fails and revokes the issued family.
  result := public.oauth_exchange_authorization_code(
    repeat('b', 64), 'dcr-ticket-222', 'https://client.example/callback', 'https://app.cadence-me.com/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('3', 64), repeat('4', 64)
  );
  if (result ->> 'ok')::boolean or not coalesce((result ->> 'reuse_detected')::boolean, false) then
    raise exception 'A replayed code must fail with reuse detection';
  end if;
  verified := public.oauth_verify_access_token(repeat('1', 64), 'https://app.cadence-me.com/mcp');
  if (verified ->> 'active')::boolean then
    raise exception 'Code replay must revoke the tokens issued from that code';
  end if;
end;
$$;
reset role;

-- Fresh code for the rotation and isolation checks.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22200000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.oauth_approve_consent(
  'dcr-ticket-222', 'https://client.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'https://app.cadence-me.com/mcp', array['cadence.read', 'cadence.occurrences.write'], repeat('d', 64)
) is not null as consented;
reset role;

set local role service_role;
do $$
declare
  result jsonb;
  verified jsonb;
begin
  result := public.oauth_exchange_authorization_code(
    repeat('d', 64), 'dcr-ticket-222', 'https://client.example/callback', 'https://app.cadence-me.com/mcp',
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('5', 64), repeat('6', 64)
  );
  if not (result ->> 'ok')::boolean then
    raise exception 'Fresh exchange failed: %', result;
  end if;

  verified := public.oauth_verify_access_token(repeat('5', 64), 'https://app.cadence-me.com/mcp');
  if not (verified ->> 'active')::boolean or verified ->> 'user_id' <> '22200000-0000-4000-8000-00000000000a' then
    raise exception 'A valid access token must verify for user A';
  end if;
  if (public.oauth_verify_access_token(repeat('5', 64), 'https://other.example/mcp') ->> 'active')::boolean then
    raise exception 'A token for another resource must not verify';
  end if;

  -- Rotation with a narrower scope.
  result := public.oauth_rotate_refresh_token(
    repeat('6', 64), 'dcr-ticket-222', 'https://app.cadence-me.com/mcp', array['cadence.read'],
    repeat('7', 64), repeat('8', 64)
  );
  if not (result ->> 'ok')::boolean or result -> 'scopes' <> '["cadence.read"]'::jsonb then
    raise exception 'Refresh rotation failed: %', result;
  end if;
  if (public.oauth_rotate_refresh_token(
    repeat('8', 64), 'dcr-ticket-222', null, array['cadence.read', 'cadence.behaviors.write'],
    repeat('9', 64), repeat('e', 64)
  ) ->> 'error') <> 'invalid_scope' then
    raise exception 'Rotation must not widen scopes';
  end if;

  -- Reusing the rotated refresh token revokes the whole family.
  result := public.oauth_rotate_refresh_token(
    repeat('6', 64), 'dcr-ticket-222', 'https://app.cadence-me.com/mcp', null,
    repeat('9', 64), repeat('e', 64)
  );
  if (result ->> 'ok')::boolean or not coalesce((result ->> 'reuse_detected')::boolean, false) then
    raise exception 'Refresh reuse must be detected';
  end if;
  if (public.oauth_verify_access_token(repeat('7', 64), 'https://app.cadence-me.com/mcp') ->> 'active')::boolean then
    raise exception 'Refresh reuse must revoke access tokens in the family';
  end if;
  if (public.oauth_rotate_refresh_token(
    repeat('8', 64), 'dcr-ticket-222', null, null, repeat('9', 64), repeat('e', 64)
  ) ->> 'ok')::boolean then
    raise exception 'Refresh reuse must revoke the newest refresh token too';
  end if;
end;
$$;
reset role;

-- New family for integration and revocation checks.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22200000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.oauth_approve_consent(
  'dcr-ticket-222', 'https://client.example/callback', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'https://app.cadence-me.com/mcp', array['cadence.read', 'cadence.occurrences.write'], repeat('f', 64)
) is not null as consented;
reset role;
set local role service_role;
select (public.oauth_exchange_authorization_code(
  repeat('f', 64), 'dcr-ticket-222', 'https://client.example/callback', 'https://app.cadence-me.com/mcp',
  'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', repeat('ab', 32), repeat('cd', 32)
) ->> 'ok')::boolean as exchanged;
do $$
declare
  decision jsonb;
  attempt integer;
begin
  for attempt in 1..31 loop
    decision := public.oauth_consume_rate_limit(
      'mcp_write', (select value::uuid from ticket_222_facts where name = 'grant_a'), null
    );
    if (decision ->> 'allowed')::boolean <> (attempt <= 30) then
      raise exception 'Unexpected mcp_write decision at attempt %', attempt;
    end if;
  end loop;
  decision := public.oauth_consume_rate_limit('client_registration', null, repeat('9', 64));
  if not (decision ->> 'allowed')::boolean or (decision ->> 'limit_count')::integer <> 10 then
    raise exception 'Unexpected registration rate-limit decision';
  end if;
end;
$$;
reset role;

-- Integration session for user A (internal token with the grant claim).

do $$
declare
  claims text;
begin
  claims := json_build_object(
    'sub', '22200000-0000-4000-8000-00000000000a',
    'role', 'authenticated',
    'cadence_grant_id', (select value from ticket_222_facts where name = 'grant_a')
  )::text;
  perform set_config('request.jwt.claims', claims, true);
end;
$$;
set local role authenticated;
do $$
declare
  begin_state record;
  plain_session_rejected boolean := false;
begin
  select * into begin_state from public.integration_idempotency_begin('key-1', 'set_occurrence_status', repeat('1', 64));
  if begin_state.state <> 'started' then
    raise exception 'First idempotency claim must start, got %', begin_state.state;
  end if;
  select * into begin_state from public.integration_idempotency_begin('key-1', 'set_occurrence_status', repeat('1', 64));
  if begin_state.state <> 'in_progress' then
    raise exception 'A concurrent claim must report in_progress';
  end if;
  if not public.integration_idempotency_complete('key-1', repeat('1', 64), '{"status":"completed"}'::jsonb) then
    raise exception 'Completing a claim must succeed';
  end if;
  select * into begin_state from public.integration_idempotency_begin('key-1', 'set_occurrence_status', repeat('1', 64));
  if begin_state.state <> 'replay' or begin_state.result <> '{"status":"completed"}'::jsonb then
    raise exception 'A completed key must replay the stored result';
  end if;
  select * into begin_state from public.integration_idempotency_begin('key-1', 'set_occurrence_status', repeat('2', 64));
  if begin_state.state <> 'mismatch' then
    raise exception 'A different payload must report mismatch';
  end if;

  perform public.integration_record_activity('set_occurrence_status', array[]::uuid[], 'success', null);
  if (select count(*) from public.oauth_list_activity(10, null)) <> 1 then
    raise exception 'User A must see their activity record';
  end if;

  perform set_config('request.jwt.claims', '{"sub":"22200000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  begin
    perform public.integration_record_activity('get_timeline', null, 'success', null);
  exception when insufficient_privilege then
    plain_session_rejected := true;
  end;
  if not plain_session_rejected then
    raise exception 'Integration functions must require the grant claim';
  end if;
end;
$$;
reset role;

-- External references require a caller-owned behavior.
do $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '22200000-0000-4000-8000-00000000000a',
    'role', 'authenticated',
    'cadence_grant_id', (select value from ticket_222_facts where name = 'grant_a')
  )::text, true);
end;
$$;
set local role authenticated;
do $$
declare
  behavior_id uuid := '22200000-0000-4000-8000-0000000000a1';
  rejected boolean := false;
begin
  begin
    perform public.integration_link_external_reference('behavior', '22200000-0000-4000-8000-0000000000b1', 'facets-x');
  exception when invalid_parameter_value then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Linking another account behavior must fail';
  end if;
  if public.integration_link_external_reference('behavior', behavior_id, 'facets-1') <> 'linked'
    or public.integration_link_external_reference('behavior', behavior_id, 'facets-1') <> 'existing'
    or public.integration_link_external_reference('behavior', behavior_id, 'facets-2') <> 'conflict' then
    raise exception 'External reference link states are wrong';
  end if;
  if public.integration_find_external_reference('behavior', 'facets-1') is distinct from behavior_id then
    raise exception 'External reference lookup failed';
  end if;
end;
$$;
reset role;

-- Cross-user isolation: user B sees nothing of user A and cannot act on it.
do $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '22200000-0000-4000-8000-00000000000b',
    'role', 'authenticated',
    'cadence_grant_id', (select value from ticket_222_facts where name = 'grant_a')
  )::text, true);
end;
$$;
set local role authenticated;
do $$
declare
  rejected boolean := false;
  direct_read_blocked boolean := false;
begin
  if (select count(*) from public.oauth_list_grants()) <> 0
    or (select count(*) from public.oauth_list_activity(10, null)) <> 0 then
    raise exception 'User B must not see user A grants or activity';
  end if;
  if public.oauth_revoke_grant((select value::uuid from ticket_222_facts where name = 'grant_a')) then
    raise exception 'User B must not revoke user A grant';
  end if;
  begin
    perform public.integration_idempotency_begin('key-1', 'set_occurrence_status', repeat('1', 64));
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'User B must not use user A grant claim';
  end if;
  begin
    perform 1 from cadence_oauth_private.grants;
  exception when insufficient_privilege then
    direct_read_blocked := true;
  end;
  if not direct_read_blocked then
    raise exception 'Direct private-table reads must be blocked';
  end if;
end;
$$;
reset role;

-- Revocation cascades: user A disconnects, and every token stops working.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22200000-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.oauth_revoke_grant((select value::uuid from ticket_222_facts where name = 'grant_a')) as revoked;
reset role;
set local role service_role;
do $$
begin
  if (public.oauth_verify_access_token(repeat('ab', 32), 'https://app.cadence-me.com/mcp') ->> 'active')::boolean then
    raise exception 'Revoking the grant must deactivate its access tokens';
  end if;
  if (public.oauth_rotate_refresh_token(
    repeat('cd', 32), 'dcr-ticket-222', null, null, repeat('ef', 32), repeat('01', 32)
  ) ->> 'ok')::boolean then
    raise exception 'Revoking the grant must deactivate its refresh tokens';
  end if;
  if exists (
    select 1 from public.oauth_purge_expired() as purge where purge is null
  ) then
    raise exception 'Purge must return counts';
  end if;
end;
$$;
reset role;

-- Incident function revokes every active grant.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22200000-0000-4000-8000-00000000000b","role":"authenticated"}';
select public.oauth_approve_consent(
  'https://chatgpt.com/oauth/client.json', 'https://chatgpt.com/connector_platform_oauth_redirect',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'https://app.cadence-me.com/mcp',
  array['cadence.read'], repeat('12', 32)
) is not null as consented;
reset role;
set local role service_role;
do $$
begin
  if public.oauth_revoke_all_grants() < 1 then
    raise exception 'The incident function must revoke active grants';
  end if;
end;
$$;
reset role;

-- Account deletion removes grants, tokens, codes, and activity.
delete from auth.users where id in (
  '22200000-0000-4000-8000-00000000000a',
  '22200000-0000-4000-8000-00000000000b'
);
do $$
begin
  if exists (select 1 from cadence_oauth_private.grants)
    or exists (select 1 from cadence_oauth_private.tokens)
    or exists (select 1 from cadence_oauth_private.token_families)
    or exists (select 1 from cadence_oauth_private.authorization_codes)
    or exists (select 1 from cadence_oauth_private.activity)
    or exists (select 1 from cadence_oauth_private.idempotency_records)
    or exists (select 1 from cadence_oauth_private.external_references)
    or exists (select 1 from cadence_oauth_private.rate_limit_counters where grant_id is not null) then
    raise exception 'Account deletion must cascade through OAuth records';
  end if;
end;
$$;

select 'ticket-222 oauth persistence smoke passed' as result;

rollback;
