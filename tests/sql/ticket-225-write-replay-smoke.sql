\set ON_ERROR_STOP on
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('22500000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated',
  'ticket-225-replay@example.invalid', '{"provider":"email","providers":["email"]}', '{}');
set local role service_role;
select public.oauth_register_client('dcr-ticket-225-replay', 'dcr', 'Write fixture', null, null,
  array['https://client.example/callback'], 'web', '{}'::jsonb, null, null) is not null as registered;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22500000-0000-4000-8000-0000000000aa","role":"authenticated"}';
do $$ declare consent jsonb; begin
  consent := public.oauth_approve_consent('dcr-ticket-225-replay', 'https://client.example/callback',
    repeat('a', 43), 'https://app.cadence-me.com/mcp',
    array['cadence.read','cadence.occurrences.write','cadence.behaviors.write'], repeat('c', 64));
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '22500000-0000-4000-8000-0000000000aa', 'role', 'authenticated',
    'cadence_grant_id', consent->>'grant_id')::text, true);
  if (select state from public.integration_idempotency_begin('abandoned-key', 'create_behavior', repeat('a',64))) <> 'started' then
    raise exception 'Expected new claim';
  end if;
end $$;
reset role;
update cadence_oauth_private.idempotency_records set updated_at = now() - interval '3 minutes'
  where user_id = '22500000-0000-4000-8000-0000000000aa';
set local role authenticated;
do $$ begin
  if (select state from public.integration_idempotency_begin('abandoned-key', 'create_behavior', repeat('b',64))) <> 'mismatch' then
    raise exception 'Abandoned mismatched payload must remain fenced';
  end if;
  if (select state from public.integration_idempotency_begin('abandoned-key', 'archive_behavior', repeat('a',64))) <> 'mismatch' then
    raise exception 'Abandoned mismatched operation must remain fenced';
  end if;
  if (select state from public.integration_idempotency_begin('abandoned-key', 'create_behavior', repeat('a',64))) <> 'started' then
    raise exception 'Matching abandoned claim should be recoverable';
  end if;
end $$;
reset role;
do $$ declare signature text; begin
  foreach signature in array array[
    'public.integration_lock_write(text,text,text)',
    'public.integration_apply_write(text,text,text,text,jsonb,timestamptz,text)'
  ] loop
    if has_function_privilege('anon', signature, 'execute') or has_function_privilege('service_role', signature, 'execute') then
      raise exception 'Write function privileges widened';
    end if;
  end loop;
  if (select prosecdef from pg_proc where oid = 'public.integration_apply_write(text,text,text,text,jsonb,timestamptz,text)'::regprocedure) then
    raise exception 'Product wrapper must preserve caller RLS';
  end if;
  if has_table_privilege('authenticated', 'public.behaviors', 'update') then
    raise exception 'Direct Behavior update privilege widened';
  end if;
end $$;
rollback;
