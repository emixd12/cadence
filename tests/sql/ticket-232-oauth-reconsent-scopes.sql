\set ON_ERROR_STOP on

-- Ticket 232 follow-up: step-up re-consent keeps already granted scopes;
-- an explicit narrowing still narrows. Synthetic local fixtures only; all
-- changes roll back.
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('23200000-0000-4000-8000-0000000002a1', 'authenticated', 'authenticated',
    'oauth-reconsent-a@example.invalid', '{"provider":"email","providers":["email"]}', '{}'),
  ('23200000-0000-4000-8000-0000000002b2', 'authenticated', 'authenticated',
    'oauth-reconsent-b@example.invalid', '{"provider":"email","providers":["email"]}', '{}');

select public.oauth_register_client(
  'reconsent-fixture', 'dcr', 'Re-consent fixture', null, null,
  array['https://client.example/callback'], 'web', '{}'::jsonb, null, null
) is not null as registered;

-- The browser-facing functions stay authenticated-only.
select has_function_privilege('authenticated', 'public.oauth_read_pending(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.oauth_finish_pending(uuid, text, text[], text)', 'execute')
  and not has_function_privilege('anon', 'public.oauth_read_pending(uuid, text)', 'execute')
  and not has_function_privilege('service_role', 'public.oauth_finish_pending(uuid, text, text[], text)', 'execute')
  as grants_unchanged;

do $$
declare
  user_a constant text := '{"sub":"23200000-0000-4000-8000-0000000002a1","role":"authenticated"}';
  user_b constant text := '{"sub":"23200000-0000-4000-8000-0000000002b2","role":"authenticated"}';
  v_id uuid;
  v_read jsonb;
  v_scopes text[];
begin
  -- First consent: no prior grant, so nothing is shown as already granted.
  v_id := public.oauth_create_pending(repeat('d', 64), 'reconsent-fixture', 'https://client.example/callback',
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'https://app.cadence-me.com/mcp',
    array['cadence.read', 'cadence.occurrences.write'], true, 'first');
  perform set_config('request.jwt.claims', user_a, true);
  v_read := public.oauth_read_pending(v_id, repeat('d', 64));
  if v_read -> 'granted_scopes' <> '[]'::jsonb then
    raise exception 'First consent showed granted scopes: %', v_read -> 'granted_scopes';
  end if;
  perform public.oauth_finish_pending(v_id, repeat('d', 64),
    array['cadence.read', 'cadence.occurrences.write'], repeat('1', 64));

  -- Step-up: the client asks only for Behavior writes. The consent screen reads
  -- the active grant's scopes and submits them with the new one.
  v_id := public.oauth_create_pending(repeat('d', 64), 'reconsent-fixture', 'https://client.example/callback',
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'https://app.cadence-me.com/mcp',
    array['cadence.read', 'cadence.behaviors.write'], true, 'step-up');
  v_read := public.oauth_read_pending(v_id, repeat('d', 64));
  select array_agg(value order by value) into v_scopes from jsonb_array_elements_text(v_read -> 'granted_scopes');
  if v_scopes is distinct from array['cadence.occurrences.write', 'cadence.read'] then
    raise exception 'Step-up did not read the active grant scopes: %', v_scopes;
  end if;
  perform public.oauth_finish_pending(v_id, repeat('d', 64),
    array['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'], repeat('2', 64));
  select grant_row.scopes into v_scopes from cadence_oauth_private.grants grant_row
  where grant_row.user_id = '23200000-0000-4000-8000-0000000002a1' and grant_row.revoked_at is null;
  if v_scopes is distinct from array['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read'] then
    raise exception 'Step-up lost earlier scopes: %', v_scopes;
  end if;
  select code.scopes into v_scopes from cadence_oauth_private.authorization_codes code where code.code_hash = repeat('2', 64);
  if cardinality(v_scopes) <> 3 then
    raise exception 'Step-up code did not carry the combined scopes: %', v_scopes;
  end if;
  if (select count(*) from cadence_oauth_private.grants where user_id = '23200000-0000-4000-8000-0000000002a1') <> 1 then
    raise exception 'Step-up created a second grant';
  end if;

  -- Explicit narrowing: the user clears an already granted scope.
  v_id := public.oauth_create_pending(repeat('d', 64), 'reconsent-fixture', 'https://client.example/callback',
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'https://app.cadence-me.com/mcp',
    array['cadence.read'], true, 'narrow');
  perform public.oauth_finish_pending(v_id, repeat('d', 64),
    array['cadence.read', 'cadence.behaviors.write'], repeat('3', 64));
  select grant_row.scopes into v_scopes from cadence_oauth_private.grants grant_row
  where grant_row.user_id = '23200000-0000-4000-8000-0000000002a1' and grant_row.revoked_at is null;
  if v_scopes is distinct from array['cadence.behaviors.write', 'cadence.read'] then
    raise exception 'Explicit narrowing did not narrow: %', v_scopes;
  end if;

  -- Ticket 259: consent offers every advertised scope, so the user may grant
  -- a scope that was neither requested nor already granted.
  v_id := public.oauth_create_pending(repeat('d', 64), 'reconsent-fixture', 'https://client.example/callback',
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'https://app.cadence-me.com/mcp',
    array['cadence.read'], true, 'widen');
  perform public.oauth_finish_pending(v_id, repeat('d', 64),
    array['cadence.read', 'cadence.occurrences.write'], repeat('4', 64));
  select grant_row.scopes into v_scopes from cadence_oauth_private.grants grant_row
  where grant_row.user_id = '23200000-0000-4000-8000-0000000002a1' and grant_row.revoked_at is null;
  if v_scopes is distinct from array['cadence.occurrences.write', 'cadence.read'] then
    raise exception 'The user''s consent choice was not stored exactly: %', v_scopes;
  end if;

  -- Another user sees none of user A's grant and cannot borrow its scopes.
  v_id := public.oauth_create_pending(repeat('d', 64), 'reconsent-fixture', 'https://client.example/callback',
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'https://app.cadence-me.com/mcp',
    array['cadence.read'], true, 'other-user');
  perform set_config('request.jwt.claims', user_b, true);
  v_read := public.oauth_read_pending(v_id, repeat('d', 64));
  if v_read -> 'granted_scopes' <> '[]'::jsonb then
    raise exception 'Another user saw granted scopes: %', v_read -> 'granted_scopes';
  end if;
  -- User B's own approval creates B's own grant and leaves user A's untouched.
  perform public.oauth_finish_pending(v_id, repeat('d', 64),
    array['cadence.read', 'cadence.behaviors.write'], repeat('5', 64));
  select grant_row.scopes into v_scopes from cadence_oauth_private.grants grant_row
  where grant_row.user_id = '23200000-0000-4000-8000-0000000002a1' and grant_row.revoked_at is null;
  if v_scopes is distinct from array['cadence.occurrences.write', 'cadence.read'] then
    raise exception 'Another user''s consent changed this grant: %', v_scopes;
  end if;

  -- A revoked grant no longer counts as already granted.
  perform set_config('request.jwt.claims', user_a, true);
  update cadence_oauth_private.grants set revoked_at = now(), revoked_reason = 'user'
  where user_id = '23200000-0000-4000-8000-0000000002a1';
  v_id := public.oauth_create_pending(repeat('d', 64), 'reconsent-fixture', 'https://client.example/callback',
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'https://app.cadence-me.com/mcp',
    array['cadence.read'], true, 'revoked');
  v_read := public.oauth_read_pending(v_id, repeat('d', 64));
  if v_read -> 'granted_scopes' <> '[]'::jsonb then
    raise exception 'A revoked grant was shown as granted: %', v_read -> 'granted_scopes';
  end if;
end;
$$;

select 'ticket-232 oauth re-consent scopes: ok' as result;
rollback;
