\set ON_ERROR_STOP on

-- Synthetic local fixtures only. All changes roll back.
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('23200000-0000-4000-8000-000000000232', 'authenticated', 'authenticated',
  'oauth-deadline@example.invalid', '{"provider":"email","providers":["email"]}', '{}');

select public.oauth_register_client(
  'deadline-fixture', 'dcr', 'Deadline fixture', null, null,
  array['https://client.example/callback'], 'web', '{}'::jsonb, null, null
) is not null as registered;

set local role authenticated;
set local request.jwt.claims = '{"sub":"23200000-0000-4000-8000-000000000232","role":"authenticated"}';
select public.oauth_approve_consent(
  'deadline-fixture', 'https://client.example/callback',
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('c', 64)
) is not null as consented;
reset role;

do $$
declare
  result jsonb;
  verified jsonb;
  family_id uuid;
  deadline timestamptz;
  offset_interval interval;
  failures text[] := '{}';
  token_count bigint;
begin
  -- A new code exchange creates a fresh 90-day family, with ordinary lifetimes.
  result := public.oauth_exchange_authorization_code(
    repeat('c', 64), 'deadline-fixture', 'https://client.example/callback',
    'https://app.cadence-me.com/mcp', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    repeat('a', 64), repeat('b', 64)
  );
  select token.family_id into family_id from cadence_oauth_private.tokens token where token_hash = repeat('a', 64);
  if result ->> 'ok' <> 'true'
    or (result ->> 'access_token_expires_at')::timestamptz <> now() + interval '1 hour'
    or (result ->> 'refresh_token_expires_at')::timestamptz <> now() + interval '30 days'
    or (select absolute_expires_at from cadence_oauth_private.token_families where id = family_id) <> now() + interval '90 days' then
    raise exception 'Ordinary code exchange lifetimes changed';
  end if;

  -- now() is fixed in this transaction: no sleeping or timing-sensitive boundary tests.
  foreach offset_interval in array array[interval '-1 second', interval '0 seconds',
      interval '1 microsecond', interval '30 minutes', interval '1 hour', interval '2 hours'] loop
    deadline := now() + offset_interval;
    update cadence_oauth_private.token_families
      set created_at = now() - interval '90 days', absolute_expires_at = deadline
      where id = family_id;
    -- Model an existing overlong access token and an unrotated refresh token.
    update cadence_oauth_private.tokens set expires_at = now() + interval '1 day', rotated_at = null
      where token_hash in (repeat('a', 64), repeat('b', 64));
    delete from cadence_oauth_private.tokens where token_hash in (repeat('d', 64), repeat('e', 64));
    verified := public.oauth_verify_access_token(repeat('a', 64), 'https://app.cadence-me.com/mcp');
    if (verified ->> 'active')::boolean is distinct from (offset_interval > interval '0 seconds') then
      failures := array_append(failures, 'existing access active at ' || offset_interval);
    elsif offset_interval > interval '0 seconds' and (verified ->> 'expires_at')::timestamptz <> deadline then
      failures := array_append(failures, 'existing access effective expiry at ' || offset_interval);
    end if;
    select count(*) into token_count from cadence_oauth_private.tokens;
    result := public.oauth_rotate_refresh_token(repeat('b', 64), 'deadline-fixture',
      'https://app.cadence-me.com/mcp', null, repeat('d', 64), repeat('e', 64));
    if offset_interval <= interval '0 seconds' then
      if result ->> 'error' is distinct from 'invalid_grant'
        or (select count(*) from cadence_oauth_private.tokens) <> token_count
        or (select rotated_at from cadence_oauth_private.tokens where token_hash = repeat('b', 64)) is not null then
        failures := array_append(failures, 'expired refresh mutated or succeeded at ' || offset_interval);
      end if;
    else
      if result ->> 'ok' is distinct from 'true'
        or (result ->> 'access_token_expires_at')::timestamptz is distinct from least(now() + interval '1 hour', deadline)
        or (result ->> 'refresh_token_expires_at')::timestamptz is distinct from deadline
        or (select expires_at from cadence_oauth_private.tokens where token_hash = repeat('d', 64)) is distinct from least(now() + interval '1 hour', deadline)
        or (select expires_at from cadence_oauth_private.tokens where token_hash = repeat('e', 64)) is distinct from deadline then
        failures := array_append(failures, 'refresh expiry exceeds family at ' || offset_interval);
      end if;
      verified := public.oauth_verify_access_token(repeat('d', 64), 'https://app.cadence-me.com/mcp');
      if verified ->> 'active' is distinct from 'true' then
        failures := array_append(failures, 'valid refreshed access rejected at ' || offset_interval);
      end if;
    end if;
  end loop;
  -- Token expiry remains independently enforced even while its family is valid.
  update cadence_oauth_private.tokens set created_at = now() - interval '1 hour', expires_at = now()
    where token_hash = repeat('a', 64);
  if public.oauth_verify_access_token(repeat('a', 64), 'https://app.cadence-me.com/mcp') ->> 'active' <> 'false' then
    raise exception 'Exact token expiry must be rejected';
  end if;
  if cardinality(failures) > 0 then raise exception 'Family deadline failures: %', failures; end if;
end;
$$;
rollback;
