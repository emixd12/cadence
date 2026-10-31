\set ON_ERROR_STOP on

-- Ticket 259: the consent screen offers every advertised scope, even when the
-- client requested only some. The grant holds exactly what the user leaves on,
-- and the token exchange returns that granted set. Step-up re-consent still
-- keeps already granted scopes (tests/sql/ticket-232-oauth-reconsent-scopes.sql).
-- Synthetic local fixtures only; all changes roll back.
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('25900000-0000-4000-8000-0000000002a1', 'authenticated', 'authenticated',
    'oauth-advertised-a@example.invalid', '{"provider":"email","providers":["email"]}', '{}'),
  ('25900000-0000-4000-8000-0000000002b2', 'authenticated', 'authenticated',
    'oauth-advertised-b@example.invalid', '{"provider":"email","providers":["email"]}', '{}');

-- A ChatGPT-style client: dynamic registration with a ChatGPT connector redirect.
select public.oauth_register_client(
  'chatgpt-style-fixture', 'dcr', 'ChatGPT', null, null,
  array['https://chatgpt.com/connector_platform_oauth_redirect'], 'web', '{}'::jsonb, 'chatgpt', null
) ->> 'verified_client' = 'chatgpt' as registered_chatgpt_style;

-- The browser-facing functions stay authenticated-only.
select has_function_privilege('authenticated', 'public.oauth_finish_pending(uuid, text, text[], text)', 'execute')
  and not has_function_privilege('anon', 'public.oauth_finish_pending(uuid, text, text[], text)', 'execute')
  and not has_function_privilege('service_role', 'public.oauth_finish_pending(uuid, text, text[], text)', 'execute')
  as grants_unchanged;

do $$
declare
  user_a constant text := '{"sub":"25900000-0000-4000-8000-0000000002a1","role":"authenticated"}';
  user_b constant text := '{"sub":"25900000-0000-4000-8000-0000000002b2","role":"authenticated"}';
  redirect constant text := 'https://chatgpt.com/connector_platform_oauth_redirect';
  challenge constant text := 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  verifier constant text := 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  mcp constant text := 'https://app.cadence-me.com/mcp';
  v_id uuid;
  v_scopes text[];
  v_result jsonb;
  v_rejected boolean;
begin
  -- 1. Read-only request; the user leaves both write switches on and allows.
  v_id := public.oauth_create_pending(repeat('e', 64), 'chatgpt-style-fixture', redirect, challenge, mcp,
    array['cadence.read'], true, 'read-only-all-on');
  perform set_config('request.jwt.claims', user_a, true);
  perform public.oauth_finish_pending(v_id, repeat('e', 64),
    array['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'], repeat('6', 64));
  select grant_row.scopes into v_scopes from cadence_oauth_private.grants grant_row
  where grant_row.user_id = '25900000-0000-4000-8000-0000000002a1' and grant_row.revoked_at is null;
  if v_scopes is distinct from array['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read'] then
    raise exception 'A read-only request did not grant the writes the user left on: %', v_scopes;
  end if;
  v_result := public.oauth_exchange_authorization_code(repeat('6', 64), 'chatgpt-style-fixture', redirect, mcp,
    verifier, repeat('0', 63) || 'a', repeat('0', 63) || 'b');
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'Token exchange failed: %', v_result ->> 'error';
  end if;
  select array_agg(value order by value) into v_scopes from jsonb_array_elements_text(v_result -> 'scopes');
  if v_scopes is distinct from array['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read'] then
    raise exception 'The token exchange did not return the granted scopes: %', v_scopes;
  end if;

  -- 2. Read-only request; the user switches Occurrence writes off.
  v_id := public.oauth_create_pending(repeat('e', 64), 'chatgpt-style-fixture', redirect, challenge, mcp,
    array['cadence.read'], true, 'read-only-one-off');
  perform set_config('request.jwt.claims', user_b, true);
  perform public.oauth_finish_pending(v_id, repeat('e', 64),
    array['cadence.read', 'cadence.behaviors.write'], repeat('7', 64));
  select grant_row.scopes into v_scopes from cadence_oauth_private.grants grant_row
  where grant_row.user_id = '25900000-0000-4000-8000-0000000002b2' and grant_row.revoked_at is null;
  if v_scopes is distinct from array['cadence.behaviors.write', 'cadence.read'] then
    raise exception 'A switched-off write was granted: %', v_scopes;
  end if;
  v_result := public.oauth_exchange_authorization_code(repeat('7', 64), 'chatgpt-style-fixture', redirect, mcp,
    verifier, repeat('0', 63) || 'c', repeat('0', 63) || 'd');
  select array_agg(value order by value) into v_scopes from jsonb_array_elements_text(v_result -> 'scopes');
  if v_scopes is distinct from array['cadence.behaviors.write', 'cadence.read'] then
    raise exception 'The token exchange returned a switched-off write: %', v_scopes;
  end if;

  -- User B's choices did not change user A's grant.
  select grant_row.scopes into v_scopes from cadence_oauth_private.grants grant_row
  where grant_row.user_id = '25900000-0000-4000-8000-0000000002a1' and grant_row.revoked_at is null;
  if cardinality(v_scopes) <> 3 then
    raise exception 'Another user''s consent changed this grant: %', v_scopes;
  end if;

  -- 3. Scopes outside the advertised set, duplicates, or a missing read are rejected.
  foreach v_scopes slice 1 in array array[
    array['cadence.read', 'cadence.admin'],
    array['cadence.occurrences.write', 'cadence.behaviors.write'],
    array['cadence.read', 'cadence.read']
  ] loop
    v_id := public.oauth_create_pending(repeat('e', 64), 'chatgpt-style-fixture', redirect, challenge, mcp,
      array['cadence.read'], true, 'invalid');
    v_rejected := false;
    begin
      perform public.oauth_finish_pending(v_id, repeat('e', 64), v_scopes, repeat('8', 64));
    exception when sqlstate '22023' then
      v_rejected := sqlerrm = 'oauth_invalid_scope';
    end;
    if not v_rejected then
      raise exception 'An invalid scope set was accepted: %', v_scopes;
    end if;
  end loop;
end;
$$;

select 'ticket-259 consent offers advertised scopes: ok' as result;
rollback;
