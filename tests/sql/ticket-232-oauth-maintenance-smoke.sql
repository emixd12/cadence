\set ON_ERROR_STOP on
-- Run only in the assigned disposable database. All fixtures roll back.
begin;
do $$
declare
  u uuid := gen_random_uuid();
  c uuid;
  g uuid;
  f uuid;
  i integer;
  expiry timestamptz;
  counts jsonb;
  table_name text;
  remaining integer;
begin
  insert into auth.users (id, email) values (u, 'maintenance-232@example.invalid');
  insert into cadence_oauth_private.clients (client_id, registration_type, client_name, redirect_uris)
    values ('used-232', 'dcr', 'Synthetic used client', array['https://client.example/callback']) returning id into c;
  insert into cadence_oauth_private.grants (user_id, client_ref, resource, scopes)
    values (u, c, 'https://app.cadence-me.com/mcp', array['cadence.read']) returning id into g;
  -- Used DCR and CIMD registrations have no registration expiry and must survive.
  insert into cadence_oauth_private.clients (client_id, registration_type, client_name, redirect_uris, metadata_expires_at)
    values ('https://client.example/metadata', 'cimd', 'Synthetic CIMD', array['https://client.example/callback'], now() - interval '1 day');
  insert into cadence_oauth_private.token_families (grant_id, user_id, absolute_expires_at)
    values (g, u, now() + interval '1 day') returning id into f;
  for i in 1..2 loop
    expiry := now() + case when i = 1 then interval '-1 minute' else interval '1 minute' end;
    insert into cadence_oauth_private.clients (client_id, registration_type, client_name, redirect_uris, registration_expires_at)
      values ('unused-232-' || i, 'dcr', 'Synthetic unused client', array['https://client.example/callback'], expiry);
    insert into cadence_oauth_private.authorization_codes
      (code_hash, grant_id, user_id, client_ref, redirect_uri, code_challenge, resource, scopes, created_at, expires_at)
      values (repeat(i::text, 64), g, u, c, 'https://client.example/callback', repeat('a',43),
        'https://app.cadence-me.com/mcp', array['cadence.read'], expiry - interval '2 minutes', expiry);
    insert into cadence_oauth_private.tokens
      (token_hash, token_type, family_id, grant_id, user_id, scopes, resource, created_at, expires_at)
      values (repeat(i::text,64), 'access', f, g, u, array['cadence.read'],
        'https://app.cadence-me.com/mcp', expiry - interval '2 minutes', expiry);
    insert into cadence_oauth_private.idempotency_records
      (user_id, client_ref, idempotency_key, grant_id, operation, request_hash, state, created_at, expires_at)
      values (u, c, 'key-' || i, g, 'update_occurrence_note', repeat(i::text,64), 'pending', expiry - interval '2 minutes', expiry);
    insert into cadence_oauth_private.pending_authorizations
      (browser_hash, client_id, redirect_uri, code_challenge, resource, scopes, offline_access, expires_at)
      values (repeat(i::text,64), 'used-232', 'https://client.example/callback', repeat('a',43),
        'https://app.cadence-me.com/mcp', array['cadence.read'], false, expiry);
    insert into cadence_oauth_private.activity (user_id, grant_id, client_ref, operation, outcome, occurred_at)
      values (u, g, c, 'get_timeline', 'success', case when i=1 then now() - interval '91 days' else now() end);
    insert into cadence_oauth_private.rate_limit_counters (action, bucket_key, window_started_at, attempt_count, updated_at)
      values ('client_registration', repeat(i::text,64), now() - interval '3 hours', 1,
        case when i=1 then now() - interval '3 hours' else now() end);
  end loop;
  insert into cadence_oauth_private.token_families (grant_id, user_id, created_at, absolute_expires_at)
    values (g, u, now() - interval '2 days', now() - interval '1 day');
  counts := public.oauth_purge_expired();
  if counts <> '{"authorization_codes":1,"access_tokens":1,"token_families":1,"clients":1,"idempotency_records":1,"activity":1,"rate_limit_counters":1}'::jsonb then
    raise exception 'Unexpected purge counts';
  end if;
  foreach table_name in array array['authorization_codes','tokens','token_families','idempotency_records','pending_authorizations','activity','rate_limit_counters'] loop
    execute format('select count(*) from cadence_oauth_private.%I', table_name) into remaining;
    if remaining <> 1 then raise exception 'Purge did not preserve valid rows in %', table_name; end if;
  end loop;
  if (select count(*) from cadence_oauth_private.clients) <> 3
    or not exists (select 1 from cadence_oauth_private.clients where client_id = 'used-232')
    or not exists (select 1 from cadence_oauth_private.clients where registration_type = 'cimd') then
    raise exception 'Used/shared metadata must remain';
  end if;
  if public.oauth_purge_expired() <> '{"authorization_codes":0,"access_tokens":0,"token_families":0,"clients":0,"idempotency_records":0,"activity":0,"rate_limit_counters":0}'::jsonb then
    raise exception 'Purge retry must be idempotent';
  end if;
end;
$$;
rollback;
select 'ticket-232 expired/valid retention and idempotent purge passed' as result;
