-- Enforce the family deadline without relying on scheduled cleanup.
begin;

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
  v_access_expires_at timestamptz;
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

  v_access_expires_at := least(now() + interval '1 hour', v_family.absolute_expires_at);
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

create or replace function public.oauth_verify_access_token(p_access_token_hash text, p_resource text)
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
    or v_family.absolute_expires_at <= now()
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
    'expires_at', least(v_token.expires_at, v_family.absolute_expires_at)
  );
end;
$$;

commit;
