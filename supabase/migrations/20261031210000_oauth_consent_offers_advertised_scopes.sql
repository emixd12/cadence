begin;

-- Ticket 259: the consent screen offers every scope the server advertises,
-- even when the client requested only some (owner decision, October 31, 2026).
-- The user may therefore approve any valid advertised scope set: cadence.read
-- plus any of the write scopes. scopes_valid already limits the set to the
-- advertised scopes, requires cadence.read and rejects duplicates, so the
-- earlier "requested or already granted" subset check is removed.
-- oauth_approve_consent still stores exactly the submitted set, so the grant
-- holds what the user left on and an explicit narrowing still narrows. Step-up
-- re-consent keeps already granted scopes because oauth_read_pending still
-- returns them and the consent screen submits them pre-selected.

create or replace function public.oauth_finish_pending(p_id uuid, p_browser_hash text, p_scopes text[], p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pending cadence_oauth_private.pending_authorizations;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'oauth_auth_required' using errcode = '42501'; end if;
  select * into v_pending from cadence_oauth_private.pending_authorizations
  where id = p_id and expires_at > now() for update;
  if v_pending.id is null or not cadence_oauth_private.secret_equal(v_pending.browser_hash, p_browser_hash) then return null; end if;
  if p_scopes is not null then
    if not coalesce(cadence_oauth_private.scopes_valid(p_scopes), false) then
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
revoke all on function public.oauth_finish_pending(uuid, text, text[], text) from public, anon, service_role;
grant execute on function public.oauth_finish_pending(uuid, text, text[], text) to authenticated;

commit;
