begin;

-- Ticket 226: browser-bound authorization requests contain protocol data only.
create table cadence_oauth_private.pending_authorizations (
  id uuid primary key default gen_random_uuid(),
  browser_hash text not null check (browser_hash ~ '^[a-f0-9]{64}$'),
  client_id text not null references cadence_oauth_private.clients(client_id) on delete cascade,
  redirect_uri text not null check (cadence_oauth_private.redirect_uri_valid(redirect_uri)),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource text not null check (length(resource) <= 2048 and resource ~ '^https?://'),
  scopes text[] not null check (cadence_oauth_private.scopes_valid(scopes)),
  offline_access boolean not null,
  state text check (length(state) <= 1024),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table cadence_oauth_private.pending_authorizations enable row level security;
revoke all on cadence_oauth_private.pending_authorizations from public, anon, authenticated, service_role;
create index pending_authorizations_expiry_idx on cadence_oauth_private.pending_authorizations(expires_at);

alter table cadence_oauth_private.authorization_codes add column offline_access boolean not null default false;
alter table cadence_oauth_private.token_families add column offline_access boolean not null default false;

-- Compare fixed-size digests without a data-dependent early exit.
create function cadence_oauth_private.secret_equal(a text, b text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  x bytea := sha256(convert_to(coalesce(a, ''), 'UTF8'));
  y bytea := sha256(convert_to(coalesce(b, ''), 'UTF8'));
  difference integer := 0;
begin
  for i in 0..31 loop
    difference := difference | (get_byte(x, i) # get_byte(y, i));
  end loop;
  return difference = 0 and a is not null and b is not null;
end;
$$;

create function public.oauth_create_pending(
  p_browser_hash text, p_client_id text, p_redirect_uri text, p_code_challenge text,
  p_resource text, p_scopes text[], p_offline_access boolean, p_state text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_client cadence_oauth_private.clients;
begin
  select * into v_client from cadence_oauth_private.active_client(p_client_id);
  if v_client.id is null or not cadence_oauth_private.redirect_uri_allowed(v_client.redirect_uris, p_redirect_uri) then
    raise exception 'oauth_invalid_client' using errcode = '22023';
  end if;
  delete from cadence_oauth_private.pending_authorizations where expires_at <= now();
  insert into cadence_oauth_private.pending_authorizations(browser_hash, client_id, redirect_uri, code_challenge, resource, scopes, offline_access, state)
  values(p_browser_hash, p_client_id, p_redirect_uri, p_code_challenge, p_resource, p_scopes, p_offline_access, p_state)
  returning id into v_id;
  return v_id;
end;
$$;

-- Reading never consumes the request; approval/denial consumes it atomically.
create function public.oauth_read_pending(p_id uuid, p_browser_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pending cadence_oauth_private.pending_authorizations; v_client cadence_oauth_private.clients;
begin
  if auth.uid() is null then raise exception 'oauth_auth_required' using errcode = '42501'; end if;
  select * into v_pending from cadence_oauth_private.pending_authorizations
  where id = p_id and expires_at > now();
  if v_pending.id is null or not cadence_oauth_private.secret_equal(v_pending.browser_hash, p_browser_hash) then return null; end if;
  select * into v_client from cadence_oauth_private.active_client(v_pending.client_id);
  if v_client.id is null then return null; end if;
  return (to_jsonb(v_pending) - 'browser_hash') || jsonb_build_object(
    'client_name', v_client.client_name, 'verified_client', v_client.verified_client
  );
end;
$$;

create function public.oauth_finish_pending(p_id uuid, p_browser_hash text, p_scopes text[], p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pending cadence_oauth_private.pending_authorizations; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'oauth_auth_required' using errcode = '42501'; end if;
  select * into v_pending from cadence_oauth_private.pending_authorizations
  where id = p_id and expires_at > now() for update;
  if v_pending.id is null or not cadence_oauth_private.secret_equal(v_pending.browser_hash, p_browser_hash) then return null; end if;
  if p_scopes is not null then
    if not cadence_oauth_private.scopes_valid(p_scopes) or not (p_scopes <@ v_pending.scopes) then
      raise exception 'oauth_invalid_scope' using errcode = '22023';
    end if;
    v_result := public.oauth_approve_consent(v_pending.client_id, v_pending.redirect_uri,
      v_pending.code_challenge, v_pending.resource, p_scopes, p_code_hash);
    update cadence_oauth_private.authorization_codes set offline_access = v_pending.offline_access where code_hash = p_code_hash;
  end if;
  delete from cadence_oauth_private.pending_authorizations where id = p_id;
  return jsonb_build_object('redirect_uri', v_pending.redirect_uri, 'state', v_pending.state, 'approved', p_scopes is not null);
end;
$$;

revoke all on function public.oauth_create_pending(text, text, text, text, text, text[], boolean, text) from public, anon, authenticated;
grant execute on function public.oauth_create_pending(text, text, text, text, text, text[], boolean, text) to service_role;
revoke all on function public.oauth_read_pending(uuid, text) from public, anon, service_role;
grant execute on function public.oauth_read_pending(uuid, text) to authenticated;
revoke all on function public.oauth_finish_pending(uuid, text, text[], text) from public, anon, service_role;
grant execute on function public.oauth_finish_pending(uuid, text, text[], text) to authenticated;

alter table cadence_oauth_private.rate_limit_counters drop constraint rate_limit_counters_action_check;
alter table cadence_oauth_private.rate_limit_counters drop constraint rate_limit_counters_check;
alter table cadence_oauth_private.rate_limit_counters add check (action in ('mcp_read', 'mcp_write', 'client_registration', 'oauth_request', 'oauth_global'));
alter table cadence_oauth_private.rate_limit_counters add check (
  (action in ('mcp_read', 'mcp_write') and grant_id is not null and bucket_key = grant_id::text)
  or (action in ('client_registration', 'oauth_request', 'oauth_global') and grant_id is null and bucket_key ~ '^[a-f0-9]{64}$')
);

create or replace function public.oauth_exchange_authorization_code(
  p_code_hash text,
  p_client_id text,
  p_redirect_uri text,
  p_resource text,
  p_code_verifier text,
  p_access_token_hash text,
  p_refresh_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code cadence_oauth_private.authorization_codes;
  v_client cadence_oauth_private.clients;
  v_grant cadence_oauth_private.grants;
  v_family_id uuid;
  v_access_expires_at timestamptz := now() + interval '1 hour';
  v_refresh_expires_at timestamptz := now() + interval '30 days';
  v_absolute_expires_at timestamptz := now() + interval '90 days';
begin
  select code.* into v_code
  from cadence_oauth_private.authorization_codes as code
  where code.code_hash = p_code_hash
  for update;
  if v_code.code_hash is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  -- A replayed code revokes the tokens issued from it.
  if v_code.consumed_at is not null then
    if v_code.family_id is not null then
      perform cadence_oauth_private.revoke_family(v_code.family_id, 'code_reuse');
    end if;
    return jsonb_build_object('ok', false, 'error', 'invalid_grant', 'reuse_detected', true);
  end if;

  -- Any failed validation burns the code.
  update cadence_oauth_private.authorization_codes
  set consumed_at = now()
  where code_hash = v_code.code_hash;

  select client.* into v_client
  from cadence_oauth_private.clients as client
  where client.id = v_code.client_ref;
  select grant_row.* into v_grant
  from cadence_oauth_private.grants as grant_row
  where grant_row.id = v_code.grant_id;

  if v_code.expires_at <= now()
    or v_client.client_id is distinct from p_client_id
    or v_client.disabled_at is not null
    or v_code.redirect_uri is distinct from p_redirect_uri
    or v_code.resource is distinct from p_resource
    or p_code_verifier is null
    or p_code_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'
    or not cadence_oauth_private.secret_equal(cadence_oauth_private.pkce_s256(p_code_verifier), v_code.code_challenge)
    or v_grant.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  insert into cadence_oauth_private.token_families (grant_id, user_id, absolute_expires_at, offline_access)
  values (v_grant.id, v_grant.user_id, v_absolute_expires_at, v_code.offline_access)
  returning id into v_family_id;

  insert into cadence_oauth_private.tokens (
    token_hash, token_type, family_id, grant_id, user_id, scopes, resource, expires_at
  )
  values
    (p_access_token_hash, 'access', v_family_id, v_grant.id, v_grant.user_id, v_code.scopes, v_code.resource, v_access_expires_at),
    (p_refresh_token_hash, 'refresh', v_family_id, v_grant.id, v_grant.user_id, v_code.scopes, v_code.resource, v_refresh_expires_at);

  update cadence_oauth_private.authorization_codes
  set family_id = v_family_id
  where code_hash = v_code.code_hash;
  update cadence_oauth_private.grants
  set last_used_at = now()
  where id = v_grant.id;

  return jsonb_build_object(
    'ok', true,
    'offline_access', v_code.offline_access,
    'grant_id', v_grant.id,
    'user_id', v_grant.user_id,
    'client_id', v_client.client_id,
    'scopes', to_jsonb(v_code.scopes),
    'resource', v_code.resource,
    'access_token_expires_at', v_access_expires_at,
    'refresh_token_expires_at', v_refresh_expires_at
  );
end;
$$;

create or replace function public.oauth_rotate_refresh_token(
  p_refresh_token_hash text,
  p_client_id text,
  p_resource text,
  p_scopes text[],
  p_access_token_hash text,
  p_next_refresh_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token cadence_oauth_private.tokens;
  v_family cadence_oauth_private.token_families;
  v_grant cadence_oauth_private.grants;
  v_client cadence_oauth_private.clients;
  v_scopes text[];
  v_access_expires_at timestamptz := now() + interval '1 hour';
  v_refresh_expires_at timestamptz;
begin
  select token.* into v_token
  from cadence_oauth_private.tokens as token
  where token.token_hash = p_refresh_token_hash and token.token_type = 'refresh'
  for update;
  if v_token.token_hash is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  select family.* into v_family
  from cadence_oauth_private.token_families as family
  where family.id = v_token.family_id
  for update;
  select grant_row.* into v_grant
  from cadence_oauth_private.grants as grant_row
  where grant_row.id = v_token.grant_id;
  select client.* into v_client
  from cadence_oauth_private.clients as client
  where client.id = v_grant.client_ref;

  if v_client.client_id is distinct from p_client_id then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  -- Reuse of an already-rotated refresh token revokes the whole family.
  if v_token.rotated_at is not null then
    perform cadence_oauth_private.revoke_family(v_family.id, 'refresh_reuse');
    return jsonb_build_object('ok', false, 'error', 'invalid_grant', 'reuse_detected', true);
  end if;

  if v_token.revoked_at is not null
    or v_family.revoked_at is not null
    or v_grant.revoked_at is not null
    or v_client.disabled_at is not null
    or v_token.expires_at <= now()
    or v_family.absolute_expires_at <= now()
    or (p_resource is not null and p_resource is distinct from v_token.resource) then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  v_scopes := cadence_oauth_private.intersect_scopes(v_token.scopes, v_grant.scopes);
  if p_scopes is not null then
    if not cadence_oauth_private.scopes_valid(p_scopes) or not (p_scopes <@ v_scopes) then
      return jsonb_build_object('ok', false, 'error', 'invalid_scope');
    end if;
    v_scopes := cadence_oauth_private.normalize_scopes(p_scopes);
  end if;
  if not cadence_oauth_private.scopes_valid(v_scopes) then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  v_refresh_expires_at := least(now() + interval '30 days', v_family.absolute_expires_at);

  update cadence_oauth_private.tokens
  set rotated_at = now()
  where token_hash = v_token.token_hash;

  insert into cadence_oauth_private.tokens (
    token_hash, token_type, family_id, grant_id, user_id, scopes, resource, expires_at
  )
  values
    (p_access_token_hash, 'access', v_family.id, v_grant.id, v_grant.user_id, v_scopes, v_token.resource, v_access_expires_at),
    (p_next_refresh_token_hash, 'refresh', v_family.id, v_grant.id, v_grant.user_id, v_scopes, v_token.resource, v_refresh_expires_at);

  update cadence_oauth_private.grants
  set last_used_at = now()
  where id = v_grant.id;

  return jsonb_build_object(
    'ok', true,
    'offline_access', v_family.offline_access,
    'grant_id', v_grant.id,
    'user_id', v_grant.user_id,
    'client_id', v_client.client_id,
    'scopes', to_jsonb(v_scopes),
    'resource', v_token.resource,
    'access_token_expires_at', v_access_expires_at,
    'refresh_token_expires_at', v_refresh_expires_at
  );
end;
$$;

create or replace function public.oauth_consume_rate_limit(p_action text, p_grant_id uuid, p_source_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observed_at timestamptz := now();
  v_limit integer;
  v_window_seconds integer;
  v_bucket text;
  v_counter cadence_oauth_private.rate_limit_counters;
  v_reset_at timestamptz;
begin
  if p_action = 'mcp_read' then
    v_limit := 120; v_window_seconds := 60;
  elsif p_action = 'mcp_write' then
    v_limit := 30; v_window_seconds := 60;
  elsif p_action = 'oauth_request' then
    v_limit := 60; v_window_seconds := 60;
  elsif p_action = 'oauth_global' then
    v_limit := 600; v_window_seconds := 60;
  elsif p_action = 'client_registration' then
    v_limit := 10; v_window_seconds := 3600;
  else
    raise exception 'oauth_unsupported_rate_limit_action' using errcode = '22023';
  end if;

  if p_action in ('mcp_read', 'mcp_write') then
    if p_grant_id is null or p_source_hash is not null then
      raise exception 'oauth_invalid_rate_limit_bucket' using errcode = '22023';
    end if;
    v_bucket := p_grant_id::text;
  else
    if p_grant_id is not null or p_source_hash is null or p_source_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'oauth_invalid_rate_limit_bucket' using errcode = '22023';
    end if;
    v_bucket := p_source_hash;
  end if;

  insert into cadence_oauth_private.rate_limit_counters as counter (
    action, bucket_key, grant_id, window_started_at, attempt_count, updated_at
  )
  values (p_action, v_bucket, p_grant_id, v_observed_at, 1, v_observed_at)
  on conflict (action, bucket_key) do update
  set window_started_at = case
      when counter.window_started_at + make_interval(secs => v_window_seconds) <= v_observed_at
        then v_observed_at
      else counter.window_started_at
    end,
    attempt_count = case
      when counter.window_started_at + make_interval(secs => v_window_seconds) <= v_observed_at
        then 1
      else counter.attempt_count + 1
    end,
    updated_at = v_observed_at
  returning counter.* into v_counter;

  v_reset_at := v_counter.window_started_at + make_interval(secs => v_window_seconds);
  return jsonb_build_object(
    'allowed', v_counter.attempt_count <= v_limit,
    'limit_count', v_limit,
    'remaining', greatest(0, v_limit - v_counter.attempt_count),
    'reset_at', v_reset_at,
    'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_reset_at - v_observed_at)))::integer)
  );
end;
$$;

create or replace function public.oauth_purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes integer;
  v_access integer;
  v_families integer;
  v_clients integer;
  v_idempotency integer;
  v_activity integer;
  v_counters integer;
begin
  delete from cadence_oauth_private.authorization_codes where expires_at <= now();
  get diagnostics v_codes = row_count;
  delete from cadence_oauth_private.tokens where token_type = 'access' and expires_at <= now();
  get diagnostics v_access = row_count;
  delete from cadence_oauth_private.token_families where absolute_expires_at <= now();
  get diagnostics v_families = row_count;
  delete from cadence_oauth_private.clients as client
  where client.registration_expires_at <= now()
    and not exists (select 1 from cadence_oauth_private.grants as grant_row where grant_row.client_ref = client.id);
  get diagnostics v_clients = row_count;
  delete from cadence_oauth_private.idempotency_records where expires_at <= now();
  get diagnostics v_idempotency = row_count;
  delete from cadence_oauth_private.pending_authorizations where expires_at <= now();
  delete from cadence_oauth_private.activity where occurred_at < now() - interval '90 days';
  get diagnostics v_activity = row_count;
  delete from cadence_oauth_private.rate_limit_counters where updated_at < now() - interval '2 hours';
  get diagnostics v_counters = row_count;
  return jsonb_build_object(
    'authorization_codes', v_codes,
    'access_tokens', v_access,
    'token_families', v_families,
    'clients', v_clients,
    'idempotency_records', v_idempotency,
    'activity', v_activity,
    'rate_limit_counters', v_counters
  );
end;
$$;

revoke all on all functions in schema cadence_oauth_private from public, anon, authenticated, service_role;
commit;
