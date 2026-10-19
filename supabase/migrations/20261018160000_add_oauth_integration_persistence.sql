begin;

-- Ticket 222: OAuth authorization-server and integration bookkeeping.
-- Every table lives in a schema that the Data API does not expose. Clients
-- reach it only through the exact functions below. Token-endpoint functions
-- are executable by service_role only; user-session functions check
-- auth.uid(); integration-session functions also require the
-- cadence_grant_id claim from the server-minted internal token.
create schema if not exists cadence_oauth_private;
revoke all on schema cadence_oauth_private from public, anon, authenticated, service_role;

-- Pure validation helpers used by check constraints and functions.
create function cadence_oauth_private.scopes_valid(p_scopes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_scopes is not null
    and cardinality(p_scopes) between 1 and 3
    and 'cadence.read' = any(p_scopes)
    and p_scopes <@ array['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write']::text[]
    and cardinality(p_scopes) = (select count(distinct scope) from unnest(p_scopes) as scope)
$$;

create function cadence_oauth_private.normalize_scopes(p_scopes text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct scope order by scope), '{}'::text[])
  from unnest(p_scopes) as scope
$$;

create function cadence_oauth_private.intersect_scopes(p_left text[], p_right text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(scope order by scope), '{}'::text[])
  from (select unnest(p_left) intersect select unnest(p_right)) as shared(scope)
$$;

create function cadence_oauth_private.redirect_uri_valid(p_uri text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_uri is not null
    and length(p_uri) <= 2048
    and p_uri !~ '[[:space:]#]'
    and (
      p_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/|\?|$)'
      or p_uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/|\?|$)'
    )
$$;

create function cadence_oauth_private.redirect_uris_valid(p_uris text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_uris is not null
    and cardinality(p_uris) between 1 and 10
    and not exists (
      select 1 from unnest(p_uris) as uri
      where not coalesce(cadence_oauth_private.redirect_uri_valid(uri), false)
    )
$$;

create function cadence_oauth_private.loopback_without_port(p_uri text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/|\?|$)'
      then regexp_replace(p_uri, '^(http://(localhost|127\.0\.0\.1))(:[0-9]{1,5})?', '\1')
  end
$$;

-- Exact match, or a port-agnostic match for loopback redirect URIs (RFC 8252).
create function cadence_oauth_private.redirect_uri_allowed(p_registered text[], p_candidate text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cadence_oauth_private.redirect_uri_valid(p_candidate), false)
    and (
      p_candidate = any(p_registered)
      or (
        cadence_oauth_private.loopback_without_port(p_candidate) is not null
        and exists (
          select 1 from unnest(p_registered) as registered
          where cadence_oauth_private.loopback_without_port(registered)
            = cadence_oauth_private.loopback_without_port(p_candidate)
        )
      )
    )
$$;

-- The verified label is only accepted for the exact known client identities.
create function cadence_oauth_private.verified_client_matches(
  p_verified_client text,
  p_registration_type text,
  p_client_id text,
  p_redirect_uris text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_verified_client
    when 'claude_code' then
      p_registration_type = 'cimd'
      and p_client_id = 'https://claude.ai/oauth/claude-code-client-metadata'
    when 'chatgpt' then
      (p_registration_type = 'cimd' and p_client_id = 'https://chatgpt.com/oauth/client.json')
      or (
        p_registration_type = 'dcr'
        and not exists (
          select 1 from unnest(p_redirect_uris) as uri
          where uri !~ '^https://chatgpt\.com/(connector_platform_oauth_redirect|connector/oauth/[A-Za-z0-9_-]{1,128})$'
        )
      )
    when 'claude' then
      p_registration_type = 'dcr'
      and not exists (
        select 1 from unnest(p_redirect_uris) as uri
        where uri not in (
          'https://claude.ai/api/mcp/auth_callback',
          'https://claude.com/api/mcp/auth_callback'
        )
      )
    else false
  end
$$;

create function cadence_oauth_private.pkce_s256(p_verifier text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    rtrim(encode(sha256(convert_to(p_verifier, 'UTF8')), 'base64'), '='),
    '+/',
    '-_'
  )
$$;

-- OAuth clients: DCR registrations and cached CIMD metadata. Not user data.
create table cadence_oauth_private.clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique check (length(client_id) between 1 and 2048),
  registration_type text not null check (registration_type in ('dcr', 'cimd')),
  client_name text not null check (length(client_name) between 1 and 200),
  client_uri text check (client_uri is null or (length(client_uri) <= 2048 and client_uri ~ '^https://')),
  logo_uri text check (logo_uri is null or (length(logo_uri) <= 2048 and logo_uri ~ '^https://')),
  redirect_uris text[] not null check (cadence_oauth_private.redirect_uris_valid(redirect_uris)),
  application_type text not null default 'web' check (application_type in ('web', 'native')),
  verified_client text check (verified_client in ('claude', 'claude_code', 'chatgpt')),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384
  ),
  created_at timestamptz not null default now(),
  metadata_refreshed_at timestamptz not null default now(),
  metadata_expires_at timestamptz,
  registration_expires_at timestamptz,
  disabled_at timestamptz,
  check (registration_type <> 'cimd' or (client_id ~ '^https://' and metadata_expires_at is not null)),
  check (registration_type <> 'dcr' or metadata_expires_at is null),
  check (
    verified_client is null
    or cadence_oauth_private.verified_client_matches(verified_client, registration_type, client_id, redirect_uris)
  )
);
create index clients_registration_expiry_idx
  on cadence_oauth_private.clients (registration_expires_at)
  where registration_expires_at is not null;

-- One active grant per account, client, and resource.
create table cadence_oauth_private.grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_ref uuid not null references cadence_oauth_private.clients(id) on delete cascade,
  resource text not null check (length(resource) <= 2048 and resource ~ '^https?://'),
  scopes text[] not null check (cadence_oauth_private.scopes_valid(scopes)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in ('user', 'incident')),
  check ((revoked_at is null) = (revoked_reason is null))
);
create unique index grants_one_active_per_client_idx
  on cadence_oauth_private.grants (user_id, client_ref, resource)
  where revoked_at is null;
create index grants_client_ref_idx on cadence_oauth_private.grants (client_ref);

-- Authorization codes: hash only, single use, at most ten minutes.
create table cadence_oauth_private.authorization_codes (
  code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid not null references cadence_oauth_private.grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_ref uuid not null references cadence_oauth_private.clients(id) on delete cascade,
  redirect_uri text not null check (cadence_oauth_private.redirect_uri_valid(redirect_uri)),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  resource text not null check (length(resource) <= 2048 and resource ~ '^https?://'),
  scopes text[] not null check (cadence_oauth_private.scopes_valid(scopes)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  family_id uuid,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create index authorization_codes_grant_idx on cadence_oauth_private.authorization_codes (grant_id);
create index authorization_codes_expiry_idx on cadence_oauth_private.authorization_codes (expires_at);

-- A rotation family groups one code exchange and all refreshes after it.
create table cadence_oauth_private.token_families (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references cadence_oauth_private.grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (
    revoked_reason in ('user', 'incident', 'refresh_reuse', 'code_reuse', 'token_revocation')
  ),
  check ((revoked_at is null) = (revoked_reason is null)),
  check (absolute_expires_at > created_at)
);
create index token_families_grant_idx on cadence_oauth_private.token_families (grant_id);
create index token_families_expiry_idx on cadence_oauth_private.token_families (absolute_expires_at);

-- Access and refresh tokens: SHA-256 hashes only.
create table cadence_oauth_private.tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  token_type text not null check (token_type in ('access', 'refresh')),
  family_id uuid not null references cadence_oauth_private.token_families(id) on delete cascade,
  grant_id uuid not null references cadence_oauth_private.grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scopes text[] not null check (cadence_oauth_private.scopes_valid(scopes)),
  resource text not null check (length(resource) <= 2048 and resource ~ '^https?://'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (token_type = 'refresh' or rotated_at is null)
);
create index tokens_family_idx on cadence_oauth_private.tokens (family_id);
create index tokens_grant_idx on cadence_oauth_private.tokens (grant_id);
create index tokens_expiry_idx on cadence_oauth_private.tokens (expires_at);

-- Integration activity: identifiers and codes only, no free-text payloads.
create table cadence_oauth_private.activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid not null references cadence_oauth_private.grants(id) on delete cascade,
  client_ref uuid not null references cadence_oauth_private.clients(id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z0-9_]{0,63}$'),
  target_ids uuid[] not null default '{}'::uuid[] check (cardinality(target_ids) <= 25),
  outcome text not null check (
    outcome in ('success', 'denied', 'invalid', 'conflict', 'rate_limited', 'error')
  ),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  occurred_at timestamptz not null default now(),
  check (outcome <> 'success' or error_code is null)
);
create index activity_user_recent_idx on cadence_oauth_private.activity (user_id, occurred_at desc, id desc);
create index activity_grant_idx on cadence_oauth_private.activity (grant_id);
create index activity_retention_idx on cadence_oauth_private.activity (occurred_at);

-- Idempotency records: user + client + key, kept for 24 hours.
create table cadence_oauth_private.idempotency_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_ref uuid not null references cadence_oauth_private.clients(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[!-~]{1,255}$'),
  grant_id uuid not null references cadence_oauth_private.grants(id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z0-9_]{0,63}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('pending', 'completed')),
  result jsonb check (result is null or octet_length(result::text) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, client_ref, idempotency_key),
  check ((state = 'completed') = (result is not null)),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create index idempotency_records_grant_idx on cadence_oauth_private.idempotency_records (grant_id);
create index idempotency_records_expiry_idx on cadence_oauth_private.idempotency_records (expires_at);

-- External references (Facets foundations). Hosted only; never synced.
create table cadence_oauth_private.external_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_ref uuid not null references cadence_oauth_private.clients(id) on delete cascade,
  entity_type text not null check (entity_type in ('behavior')),
  entity_id uuid not null references public.behaviors(id) on delete cascade,
  external_id text not null check (
    length(external_id) between 1 and 255 and external_id !~ '[[:cntrl:]]'
  ),
  created_at timestamptz not null default now(),
  unique (user_id, client_ref, entity_type, external_id),
  unique (user_id, client_ref, entity_type, entity_id)
);
create index external_references_entity_idx on cadence_oauth_private.external_references (entity_id);
create index external_references_client_idx on cadence_oauth_private.external_references (client_ref);

-- Fixed-window counters for MCP reads and writes (per grant) and client
-- registration (per hashed source). launch_rate_limits does not fit: it is
-- keyed by account and requires a user, while registration happens before
-- sign-in and MCP limits apply per grant.
create table cadence_oauth_private.rate_limit_counters (
  action text not null check (action in ('mcp_read', 'mcp_write', 'client_registration')),
  bucket_key text not null,
  grant_id uuid references cadence_oauth_private.grants(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  primary key (action, bucket_key),
  check (
    (action in ('mcp_read', 'mcp_write') and grant_id is not null and bucket_key = grant_id::text)
    or (action = 'client_registration' and grant_id is null and bucket_key ~ '^[a-f0-9]{64}$')
  )
);
create index rate_limit_counters_grant_idx on cadence_oauth_private.rate_limit_counters (grant_id);
create index rate_limit_counters_updated_idx on cadence_oauth_private.rate_limit_counters (updated_at);

alter table cadence_oauth_private.clients enable row level security;
alter table cadence_oauth_private.grants enable row level security;
alter table cadence_oauth_private.authorization_codes enable row level security;
alter table cadence_oauth_private.token_families enable row level security;
alter table cadence_oauth_private.tokens enable row level security;
alter table cadence_oauth_private.activity enable row level security;
alter table cadence_oauth_private.idempotency_records enable row level security;
alter table cadence_oauth_private.external_references enable row level security;
alter table cadence_oauth_private.rate_limit_counters enable row level security;
revoke all on all tables in schema cadence_oauth_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema cadence_oauth_private from public, anon, authenticated, service_role;

-- Internal helpers. Only the SECURITY DEFINER functions below call them.
create function cadence_oauth_private.client_json(p_client cadence_oauth_private.clients)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'client_id', p_client.client_id,
    'registration_type', p_client.registration_type,
    'client_name', p_client.client_name,
    'client_uri', p_client.client_uri,
    'logo_uri', p_client.logo_uri,
    'redirect_uris', to_jsonb(p_client.redirect_uris),
    'application_type', p_client.application_type,
    'verified_client', p_client.verified_client,
    'metadata_expires_at', p_client.metadata_expires_at,
    'metadata_stale', coalesce(p_client.metadata_expires_at <= now(), false)
  )
$$;

create function cadence_oauth_private.active_client(p_client_id text)
returns cadence_oauth_private.clients
language sql
stable
set search_path = ''
as $$
  select client.*
  from cadence_oauth_private.clients as client
  where client.client_id = p_client_id
    and client.disabled_at is null
    and (client.registration_expires_at is null or client.registration_expires_at > now())
$$;

create function cadence_oauth_private.revoke_family(p_family_id uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$
  update cadence_oauth_private.token_families
  set revoked_at = now(), revoked_reason = p_reason
  where id = p_family_id and revoked_at is null;
  update cadence_oauth_private.tokens
  set revoked_at = now()
  where family_id = p_family_id and revoked_at is null;
$$;

create function cadence_oauth_private.revoke_grant_internal(p_grant_id uuid, p_reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update cadence_oauth_private.grants
  set revoked_at = now(), revoked_reason = p_reason, updated_at = now()
  where id = p_grant_id and revoked_at is null;
  if not found then
    return false;
  end if;
  update cadence_oauth_private.token_families
  set revoked_at = now(), revoked_reason = p_reason
  where grant_id = p_grant_id and revoked_at is null;
  update cadence_oauth_private.tokens
  set revoked_at = now()
  where grant_id = p_grant_id and revoked_at is null;
  update cadence_oauth_private.authorization_codes
  set consumed_at = now()
  where grant_id = p_grant_id and consumed_at is null;
  return true;
end;
$$;

-- Resolves the grant named by the internal token's cadence_grant_id claim.
create function cadence_oauth_private.current_integration_grant(p_require_active boolean)
returns cadence_oauth_private.grants
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_claim text := auth.jwt() ->> 'cadence_grant_id';
  v_grant cadence_oauth_private.grants;
begin
  if v_user_id is null then
    raise exception 'integration_auth_required' using errcode = '42501';
  end if;
  if v_claim is null or v_claim !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'integration_grant_required' using errcode = '42501';
  end if;
  select grant_row.* into v_grant
  from cadence_oauth_private.grants as grant_row
  where grant_row.id = v_claim::uuid and grant_row.user_id = v_user_id;
  if v_grant.id is null or (p_require_active and v_grant.revoked_at is not null) then
    raise exception 'integration_grant_inactive' using errcode = '42501';
  end if;
  return v_grant;
end;
$$;

revoke all on all functions in schema cadence_oauth_private from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Token-endpoint functions: service_role only.
-- ---------------------------------------------------------------------------

create function public.oauth_register_client(
  p_client_id text,
  p_registration_type text,
  p_client_name text,
  p_client_uri text,
  p_logo_uri text,
  p_redirect_uris text[],
  p_application_type text,
  p_metadata jsonb,
  p_verified_client text,
  p_metadata_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client cadence_oauth_private.clients;
begin
  if p_registration_type = 'dcr' then
    insert into cadence_oauth_private.clients (
      client_id, registration_type, client_name, client_uri, logo_uri, redirect_uris,
      application_type, verified_client, metadata, registration_expires_at
    )
    values (
      p_client_id, 'dcr', p_client_name, p_client_uri, p_logo_uri, p_redirect_uris,
      coalesce(p_application_type, 'web'), p_verified_client, coalesce(p_metadata, '{}'::jsonb),
      now() + interval '24 hours'
    )
    on conflict (client_id) do nothing
    returning * into v_client;
    if v_client.id is null then
      raise exception 'oauth_client_id_conflict' using errcode = '23505';
    end if;
  elsif p_registration_type = 'cimd' then
    if p_metadata_expires_at is null
      or p_metadata_expires_at <= now()
      or p_metadata_expires_at > now() + interval '24 hours' then
      raise exception 'oauth_invalid_metadata_expiry' using errcode = '22023';
    end if;
    insert into cadence_oauth_private.clients as existing (
      client_id, registration_type, client_name, client_uri, logo_uri, redirect_uris,
      application_type, verified_client, metadata, metadata_expires_at
    )
    values (
      p_client_id, 'cimd', p_client_name, p_client_uri, p_logo_uri, p_redirect_uris,
      coalesce(p_application_type, 'web'), p_verified_client, coalesce(p_metadata, '{}'::jsonb),
      p_metadata_expires_at
    )
    on conflict (client_id) do update
    set client_name = excluded.client_name,
      client_uri = excluded.client_uri,
      logo_uri = excluded.logo_uri,
      redirect_uris = excluded.redirect_uris,
      application_type = excluded.application_type,
      verified_client = excluded.verified_client,
      metadata = excluded.metadata,
      metadata_refreshed_at = now(),
      metadata_expires_at = excluded.metadata_expires_at
    where existing.registration_type = 'cimd'
    returning * into v_client;
    if v_client.id is null then
      raise exception 'oauth_client_id_conflict' using errcode = '23505';
    end if;
  else
    raise exception 'oauth_invalid_registration_type' using errcode = '22023';
  end if;
  return cadence_oauth_private.client_json(v_client);
end;
$$;

create function public.oauth_get_client(p_client_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when client.id is null then null else cadence_oauth_private.client_json(client) end
  from cadence_oauth_private.active_client(p_client_id) as client
$$;

create function public.oauth_exchange_authorization_code(
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
    or cadence_oauth_private.pkce_s256(p_code_verifier) <> v_code.code_challenge
    or v_grant.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  insert into cadence_oauth_private.token_families (grant_id, user_id, absolute_expires_at)
  values (v_grant.id, v_grant.user_id, v_absolute_expires_at)
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

create function public.oauth_rotate_refresh_token(
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

create function public.oauth_verify_access_token(p_access_token_hash text, p_resource text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token cadence_oauth_private.tokens;
  v_grant cadence_oauth_private.grants;
  v_client cadence_oauth_private.clients;
  v_family cadence_oauth_private.token_families;
  v_scopes text[];
begin
  select token.* into v_token
  from cadence_oauth_private.tokens as token
  where token.token_hash = p_access_token_hash and token.token_type = 'access';
  if v_token.token_hash is null then
    return jsonb_build_object('active', false);
  end if;
  select family.* into v_family
  from cadence_oauth_private.token_families as family
  where family.id = v_token.family_id;
  select grant_row.* into v_grant
  from cadence_oauth_private.grants as grant_row
  where grant_row.id = v_token.grant_id;
  select client.* into v_client
  from cadence_oauth_private.clients as client
  where client.id = v_grant.client_ref;

  v_scopes := cadence_oauth_private.intersect_scopes(v_token.scopes, v_grant.scopes);
  if v_token.revoked_at is not null
    or v_token.expires_at <= now()
    or v_family.revoked_at is not null
    or v_grant.revoked_at is not null
    or v_client.disabled_at is not null
    or v_token.resource is distinct from p_resource
    or not cadence_oauth_private.scopes_valid(v_scopes) then
    return jsonb_build_object('active', false);
  end if;

  -- Throttled last-used write: at most once per minute per grant.
  update cadence_oauth_private.grants
  set last_used_at = now()
  where id = v_grant.id
    and (last_used_at is null or last_used_at < now() - interval '60 seconds');

  return jsonb_build_object(
    'active', true,
    'user_id', v_grant.user_id,
    'grant_id', v_grant.id,
    'client_id', v_client.client_id,
    'client_name', v_client.client_name,
    'verified_client', v_client.verified_client,
    'scopes', to_jsonb(v_scopes),
    'resource', v_token.resource,
    'expires_at', v_token.expires_at
  );
end;
$$;

-- RFC 7009: revoking a refresh token revokes its family; an access token
-- revokes only itself. Returns whether anything changed.
create function public.oauth_revoke_token(p_token_hash text, p_client_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token cadence_oauth_private.tokens;
  v_client_id text;
begin
  select token.* into v_token
  from cadence_oauth_private.tokens as token
  where token.token_hash = p_token_hash
  for update;
  if v_token.token_hash is null then
    return false;
  end if;
  select client.client_id into v_client_id
  from cadence_oauth_private.grants as grant_row
  join cadence_oauth_private.clients as client on client.id = grant_row.client_ref
  where grant_row.id = v_token.grant_id;
  if v_client_id is distinct from p_client_id then
    return false;
  end if;
  if v_token.token_type = 'refresh' then
    perform cadence_oauth_private.revoke_family(v_token.family_id, 'token_revocation');
    return true;
  end if;
  update cadence_oauth_private.tokens
  set revoked_at = now()
  where token_hash = v_token.token_hash and revoked_at is null;
  return found;
end;
$$;

create function public.oauth_consume_rate_limit(p_action text, p_grant_id uuid, p_source_hash text)
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

-- Retention: codes after expiry, access tokens after expiry, families (and
-- their refresh tokens) after absolute expiry, unused DCR clients, 24-hour
-- idempotency records, 90-day activity, and idle rate-limit counters.
create function public.oauth_purge_expired()
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

-- Incident response: revoke every active grant and all of its tokens.
create function public.oauth_revoke_all_grants()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  v_count integer := 0;
begin
  for v_grant_id in
    select id from cadence_oauth_private.grants where revoked_at is null for update
  loop
    if cadence_oauth_private.revoke_grant_internal(v_grant_id, 'incident') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- User-session functions: authenticated, owner-checked with auth.uid().
-- ---------------------------------------------------------------------------

create function public.oauth_approve_consent(
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text,
  p_scopes text[],
  p_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_client cadence_oauth_private.clients;
  v_scopes text[];
  v_grant_id uuid;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  if v_user_id is null then
    raise exception 'oauth_auth_required' using errcode = '42501';
  end if;
  select client.* into v_client from cadence_oauth_private.active_client(p_client_id) as client;
  if v_client.id is null then
    raise exception 'oauth_invalid_client' using errcode = '22023';
  end if;
  if v_client.metadata_expires_at is not null and v_client.metadata_expires_at <= now() then
    raise exception 'oauth_client_metadata_stale' using errcode = '22023';
  end if;
  if not cadence_oauth_private.redirect_uri_allowed(v_client.redirect_uris, p_redirect_uri) then
    raise exception 'oauth_invalid_redirect_uri' using errcode = '22023';
  end if;
  if not coalesce(cadence_oauth_private.scopes_valid(p_scopes), false) then
    raise exception 'oauth_invalid_scope' using errcode = '22023';
  end if;
  if p_resource is null or length(p_resource) > 2048 or p_resource !~ '^https?://' then
    raise exception 'oauth_invalid_target' using errcode = '22023';
  end if;
  v_scopes := cadence_oauth_private.normalize_scopes(p_scopes);

  -- Re-consent replaces the active grant's scopes; token scopes are always
  -- intersected with the grant, so narrowing applies immediately.
  update cadence_oauth_private.grants
  set scopes = v_scopes, updated_at = now()
  where user_id = v_user_id
    and client_ref = v_client.id
    and resource = p_resource
    and revoked_at is null
  returning id into v_grant_id;
  if v_grant_id is null then
    insert into cadence_oauth_private.grants (user_id, client_ref, resource, scopes)
    values (v_user_id, v_client.id, p_resource, v_scopes)
    returning id into v_grant_id;
  end if;

  update cadence_oauth_private.clients
  set registration_expires_at = null
  where id = v_client.id and registration_expires_at is not null;

  insert into cadence_oauth_private.authorization_codes (
    code_hash, grant_id, user_id, client_ref, redirect_uri, code_challenge,
    resource, scopes, expires_at
  )
  values (
    p_code_hash, v_grant_id, v_user_id, v_client.id, p_redirect_uri, p_code_challenge,
    p_resource, v_scopes, v_expires_at
  );

  return jsonb_build_object(
    'grant_id', v_grant_id,
    'scopes', to_jsonb(v_scopes),
    'code_expires_at', v_expires_at
  );
end;
$$;

create function public.oauth_list_grants()
returns table (
  grant_id uuid,
  client_id text,
  client_name text,
  client_uri text,
  logo_uri text,
  verified_client text,
  scopes text[],
  created_at timestamptz,
  last_used_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select grant_row.id, client.client_id, client.client_name, client.client_uri, client.logo_uri,
    client.verified_client, grant_row.scopes, grant_row.created_at, grant_row.last_used_at
  from cadence_oauth_private.grants as grant_row
  join cadence_oauth_private.clients as client on client.id = grant_row.client_ref
  where grant_row.user_id = auth.uid()
    and grant_row.revoked_at is null
  order by grant_row.created_at desc, grant_row.id
$$;

create function public.oauth_revoke_grant(p_grant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'oauth_auth_required' using errcode = '42501';
  end if;
  perform 1 from cadence_oauth_private.grants
  where id = p_grant_id and user_id = v_user_id
  for update;
  if not found then
    return false;
  end if;
  return cadence_oauth_private.revoke_grant_internal(p_grant_id, 'user');
end;
$$;

create function public.oauth_list_activity(p_limit integer default 50, p_before timestamptz default null)
returns table (
  activity_id bigint,
  grant_id uuid,
  client_name text,
  operation text,
  outcome text,
  error_code text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select activity.id, activity.grant_id, client.client_name, activity.operation,
    activity.outcome, activity.error_code, activity.occurred_at
  from cadence_oauth_private.activity as activity
  join cadence_oauth_private.clients as client on client.id = activity.client_ref
  where activity.user_id = auth.uid()
    and activity.occurred_at >= now() - interval '90 days'
    and (p_before is null or activity.occurred_at < p_before)
  order by activity.occurred_at desc, activity.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- ---------------------------------------------------------------------------
-- Integration-session functions: authenticated with the cadence_grant_id
-- claim; client attribution comes from the grant, never from arguments.
-- ---------------------------------------------------------------------------

create function public.integration_record_activity(
  p_operation text,
  p_target_ids uuid[],
  p_outcome text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant cadence_oauth_private.grants := cadence_oauth_private.current_integration_grant(false);
begin
  insert into cadence_oauth_private.activity (
    user_id, grant_id, client_ref, operation, target_ids, outcome, error_code
  )
  values (
    v_grant.user_id, v_grant.id, v_grant.client_ref, p_operation,
    coalesce(p_target_ids, '{}'::uuid[]), p_outcome, p_error_code
  );
  delete from cadence_oauth_private.activity
  where user_id = v_grant.user_id and occurred_at < now() - interval '90 days';
end;
$$;

-- Claims an idempotency key. Returns 'started' (caller runs the write),
-- 'replay' (stored result), 'mismatch' (same key, different request), or
-- 'in_progress' (another attempt holds a fresh claim).
create function public.integration_idempotency_begin(
  p_idempotency_key text,
  p_operation text,
  p_request_hash text
)
returns table (state text, result jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_grant cadence_oauth_private.grants := cadence_oauth_private.current_integration_grant(true);
  v_record cadence_oauth_private.idempotency_records;
begin
  delete from cadence_oauth_private.idempotency_records as existing_record
  where existing_record.user_id = v_grant.user_id
    and existing_record.client_ref = v_grant.client_ref
    and existing_record.idempotency_key = p_idempotency_key
    and (
      existing_record.expires_at <= now()
      or (existing_record.state = 'pending' and existing_record.updated_at < now() - interval '2 minutes')
    );

  insert into cadence_oauth_private.idempotency_records (
    user_id, client_ref, idempotency_key, grant_id, operation, request_hash, state, expires_at
  )
  values (
    v_grant.user_id, v_grant.client_ref, p_idempotency_key, v_grant.id, p_operation,
    p_request_hash, 'pending', now() + interval '24 hours'
  )
  on conflict (user_id, client_ref, idempotency_key) do nothing
  returning * into v_record;
  if v_record.idempotency_key is not null then
    return query select 'started'::text, null::jsonb;
    return;
  end if;

  select existing_record.* into v_record
  from cadence_oauth_private.idempotency_records as existing_record
  where existing_record.user_id = v_grant.user_id
    and existing_record.client_ref = v_grant.client_ref
    and existing_record.idempotency_key = p_idempotency_key;
  if v_record.operation <> p_operation or v_record.request_hash <> p_request_hash then
    return query select 'mismatch'::text, null::jsonb;
  elsif v_record.state = 'completed' then
    return query select 'replay'::text, v_record.result;
  else
    return query select 'in_progress'::text, null::jsonb;
  end if;
end;
$$;

create function public.integration_idempotency_complete(
  p_idempotency_key text,
  p_request_hash text,
  p_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant cadence_oauth_private.grants := cadence_oauth_private.current_integration_grant(false);
begin
  if p_result is null then
    raise exception 'integration_idempotency_result_required' using errcode = '22023';
  end if;
  update cadence_oauth_private.idempotency_records
  set state = 'completed', result = p_result, updated_at = now()
  where user_id = v_grant.user_id
    and client_ref = v_grant.client_ref
    and idempotency_key = p_idempotency_key
    and request_hash = p_request_hash
    and state = 'pending';
  return found;
end;
$$;

create function public.integration_idempotency_release(p_idempotency_key text, p_request_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant cadence_oauth_private.grants := cadence_oauth_private.current_integration_grant(false);
begin
  delete from cadence_oauth_private.idempotency_records
  where user_id = v_grant.user_id
    and client_ref = v_grant.client_ref
    and idempotency_key = p_idempotency_key
    and request_hash = p_request_hash
    and state = 'pending';
  return found;
end;
$$;

-- Links a caller-owned entity to the client's external id. Returns 'linked',
-- 'existing' (same link already present), or 'conflict' (either side is
-- already linked to something else for this client).
create function public.integration_link_external_reference(
  p_entity_type text,
  p_entity_id uuid,
  p_external_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant cadence_oauth_private.grants := cadence_oauth_private.current_integration_grant(true);
  v_inserted uuid;
begin
  if p_entity_type is distinct from 'behavior' then
    raise exception 'integration_unsupported_entity_type' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.behaviors as behavior
    where behavior.id = p_entity_id and behavior.user_id = v_grant.user_id
  ) then
    raise exception 'integration_entity_not_found' using errcode = '22023';
  end if;

  insert into cadence_oauth_private.external_references (
    user_id, client_ref, entity_type, entity_id, external_id
  )
  values (v_grant.user_id, v_grant.client_ref, p_entity_type, p_entity_id, p_external_id)
  on conflict do nothing
  returning id into v_inserted;
  if v_inserted is not null then
    return 'linked';
  end if;
  if exists (
    select 1 from cadence_oauth_private.external_references as reference
    where reference.user_id = v_grant.user_id
      and reference.client_ref = v_grant.client_ref
      and reference.entity_type = p_entity_type
      and reference.entity_id = p_entity_id
      and reference.external_id = p_external_id
  ) then
    return 'existing';
  end if;
  return 'conflict';
end;
$$;

create function public.integration_find_external_reference(p_entity_type text, p_external_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select reference.entity_id
  from cadence_oauth_private.external_references as reference,
    cadence_oauth_private.current_integration_grant(true) as grant_row
  where reference.user_id = grant_row.user_id
    and reference.client_ref = grant_row.client_ref
    and reference.entity_type = p_entity_type
    and reference.external_id = p_external_id
$$;

create function public.integration_list_external_references(p_entity_type text, p_entity_ids uuid[])
returns table (entity_id uuid, external_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select reference.entity_id, reference.external_id
  from cadence_oauth_private.external_references as reference,
    cadence_oauth_private.current_integration_grant(true) as grant_row
  where reference.user_id = grant_row.user_id
    and reference.client_ref = grant_row.client_ref
    and reference.entity_type = p_entity_type
    and reference.entity_id = any(p_entity_ids)
    and cardinality(p_entity_ids) <= 200
  order by reference.entity_id
$$;

-- Privileges. Token-endpoint functions: service_role only.
revoke all on function public.oauth_register_client(text, text, text, text, text, text[], text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.oauth_get_client(text) from public, anon, authenticated;
revoke all on function public.oauth_exchange_authorization_code(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.oauth_rotate_refresh_token(text, text, text, text[], text, text) from public, anon, authenticated;
revoke all on function public.oauth_verify_access_token(text, text) from public, anon, authenticated;
revoke all on function public.oauth_revoke_token(text, text) from public, anon, authenticated;
revoke all on function public.oauth_consume_rate_limit(text, uuid, text) from public, anon, authenticated;
revoke all on function public.oauth_purge_expired() from public, anon, authenticated;
revoke all on function public.oauth_revoke_all_grants() from public, anon, authenticated;
grant execute on function public.oauth_register_client(text, text, text, text, text, text[], text, jsonb, text, timestamptz) to service_role;
grant execute on function public.oauth_get_client(text) to service_role;
grant execute on function public.oauth_exchange_authorization_code(text, text, text, text, text, text, text) to service_role;
grant execute on function public.oauth_rotate_refresh_token(text, text, text, text[], text, text) to service_role;
grant execute on function public.oauth_verify_access_token(text, text) to service_role;
grant execute on function public.oauth_revoke_token(text, text) to service_role;
grant execute on function public.oauth_consume_rate_limit(text, uuid, text) to service_role;
grant execute on function public.oauth_purge_expired() to service_role;
grant execute on function public.oauth_revoke_all_grants() to service_role;

-- User-session and integration-session functions: authenticated only.
revoke all on function public.oauth_approve_consent(text, text, text, text, text[], text) from public, anon, service_role;
revoke all on function public.oauth_list_grants() from public, anon, service_role;
revoke all on function public.oauth_revoke_grant(uuid) from public, anon, service_role;
revoke all on function public.oauth_list_activity(integer, timestamptz) from public, anon, service_role;
revoke all on function public.integration_record_activity(text, uuid[], text, text) from public, anon, service_role;
revoke all on function public.integration_idempotency_begin(text, text, text) from public, anon, service_role;
revoke all on function public.integration_idempotency_complete(text, text, jsonb) from public, anon, service_role;
revoke all on function public.integration_idempotency_release(text, text) from public, anon, service_role;
revoke all on function public.integration_link_external_reference(text, uuid, text) from public, anon, service_role;
revoke all on function public.integration_find_external_reference(text, text) from public, anon, service_role;
revoke all on function public.integration_list_external_references(text, uuid[]) from public, anon, service_role;
grant execute on function public.oauth_approve_consent(text, text, text, text, text[], text) to authenticated;
grant execute on function public.oauth_list_grants() to authenticated;
grant execute on function public.oauth_revoke_grant(uuid) to authenticated;
grant execute on function public.oauth_list_activity(integer, timestamptz) to authenticated;
grant execute on function public.integration_record_activity(text, uuid[], text, text) to authenticated;
grant execute on function public.integration_idempotency_begin(text, text, text) to authenticated;
grant execute on function public.integration_idempotency_complete(text, text, jsonb) to authenticated;
grant execute on function public.integration_idempotency_release(text, text) to authenticated;
grant execute on function public.integration_link_external_reference(text, uuid, text) to authenticated;
grant execute on function public.integration_find_external_reference(text, text) to authenticated;
grant execute on function public.integration_list_external_references(text, uuid[]) to authenticated;

commit;
