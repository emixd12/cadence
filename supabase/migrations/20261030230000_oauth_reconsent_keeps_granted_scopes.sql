begin;

-- Ticket 232 follow-up: incremental re-consent (step-up) keeps permissions the
-- user already granted. The consent screen reads the caller's active grant
-- scopes for the same client and resource, shows them as already granted and
-- selected, and the finish function accepts any subset of requested plus
-- already-granted scopes. oauth_approve_consent still stores exactly the
-- submitted set, so an explicit user narrowing still narrows.

create or replace function public.oauth_read_pending(p_id uuid, p_browser_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pending cadence_oauth_private.pending_authorizations;
  v_client cadence_oauth_private.clients;
  v_granted text[];
begin
  if auth.uid() is null then raise exception 'oauth_auth_required' using errcode = '42501'; end if;
  select * into v_pending from cadence_oauth_private.pending_authorizations
  where id = p_id and expires_at > now();
  if v_pending.id is null or not cadence_oauth_private.secret_equal(v_pending.browser_hash, p_browser_hash) then return null; end if;
  select * into v_client from cadence_oauth_private.active_client(v_pending.client_id);
  if v_client.id is null then return null; end if;
  select grant_row.scopes into v_granted from cadence_oauth_private.grants as grant_row
  where grant_row.user_id = auth.uid() and grant_row.client_ref = v_client.id
    and grant_row.resource = v_pending.resource and grant_row.revoked_at is null;
  return (to_jsonb(v_pending) - 'browser_hash') || jsonb_build_object(
    'client_name', v_client.client_name, 'verified_client', v_client.verified_client,
    'granted_scopes', to_jsonb(cadence_oauth_private.normalize_scopes(coalesce(v_granted, '{}'::text[])))
  );
end;
$$;

create or replace function public.oauth_finish_pending(p_id uuid, p_browser_hash text, p_scopes text[], p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pending cadence_oauth_private.pending_authorizations;
  v_client cadence_oauth_private.clients;
  v_granted text[];
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'oauth_auth_required' using errcode = '42501'; end if;
  select * into v_pending from cadence_oauth_private.pending_authorizations
  where id = p_id and expires_at > now() for update;
  if v_pending.id is null or not cadence_oauth_private.secret_equal(v_pending.browser_hash, p_browser_hash) then return null; end if;
  if p_scopes is not null then
    select * into v_client from cadence_oauth_private.active_client(v_pending.client_id);
    if v_client.id is not null then
      select grant_row.scopes into v_granted from cadence_oauth_private.grants as grant_row
      where grant_row.user_id = auth.uid() and grant_row.client_ref = v_client.id
        and grant_row.resource = v_pending.resource and grant_row.revoked_at is null
      for update;
    end if;
    if not cadence_oauth_private.scopes_valid(p_scopes)
      or not (p_scopes <@ (v_pending.scopes || coalesce(v_granted, '{}'::text[]))) then
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

-- create or replace keeps the existing grants; restate them for review.
revoke all on function public.oauth_read_pending(uuid, text) from public, anon, service_role;
grant execute on function public.oauth_read_pending(uuid, text) to authenticated;
revoke all on function public.oauth_finish_pending(uuid, text, text[], text) from public, anon, service_role;
grant execute on function public.oauth_finish_pending(uuid, text, text[], text) to authenticated;

commit;
