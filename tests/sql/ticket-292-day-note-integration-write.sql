\set ON_ERROR_STOP on

-- Ticket 292: MCP update_day_note. Scope, compare-and-set, revision conflicts,
-- idempotent replay, clear, and privileges. Synthetic local fixtures only; all
-- changes roll back.
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('25700000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated',
  'ticket-292-mcp@example.invalid', '{"provider":"email","providers":["email"]}', '{}');
set local role service_role;
select public.oauth_register_client('dcr-ticket-292', 'dcr', 'Day note fixture', null, null,
  array['https://client.example/callback'], 'web', '{}'::jsonb, null, null) is not null as registered;
set local role authenticated;
set local request.jwt.claims = '{"sub":"25700000-0000-4000-8000-0000000000aa","role":"authenticated"}';

-- A read-only grant cannot write day notes.
do $$ declare consent jsonb; begin
  consent := public.oauth_approve_consent('dcr-ticket-292', 'https://client.example/callback',
    repeat('a', 43), 'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('c', 64));
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '25700000-0000-4000-8000-0000000000aa', 'role', 'authenticated',
    'cadence_grant_id', consent->>'grant_id')::text, true);
  begin
    perform public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-10', 'Read only', null);
    raise exception 'Read-only grant wrote a day note';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ declare consent jsonb; r jsonb; o jsonb; v_revision text; begin
  consent := public.oauth_approve_consent('dcr-ticket-292', 'https://client.example/callback',
    repeat('b', 43), 'https://app.cadence-me.com/mcp',
    array['cadence.read','cadence.occurrences.write'], repeat('d', 64));
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '25700000-0000-4000-8000-0000000000aa', 'role', 'authenticated',
    'cadence_grant_id', consent->>'grant_id')::text, true);

  -- Create with an idempotency key.
  r := public.integration_apply_day_note_write('day-note-key-1', repeat('e', 64), '2026-11-10', 'Travel day', null);
  o := (r #>> '{receipt,output_json}')::jsonb;
  if o #>> '{day_note,note}' <> 'Travel day' or (o->>'changed')::boolean is not true or o->>'local_date' <> '2026-11-10' then
    raise exception 'Create output wrong: %', o;
  end if;
  v_revision := o #>> '{day_note,revision}';

  -- Replay with the same key returns the stored receipt and writes nothing.
  r := public.integration_apply_day_note_write('day-note-key-1', repeat('e', 64), '2026-11-10', 'Travel day', null);
  if (r #>> '{receipt,output_json}')::jsonb <> o then raise exception 'Replay differs'; end if;
  if (select revision from public.day_notes where local_date = '2026-11-10') <> 1 then raise exception 'Replay wrote again'; end if;

  -- Same key with different input is refused.
  begin
    perform public.integration_apply_day_note_write('day-note-key-1', repeat('f', 64), '2026-11-10', 'Other', null);
    raise exception 'Key reuse accepted';
  exception when sqlstate '22023' then null;
  end;

  -- A stale expected revision conflicts.
  begin
    perform public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-10', 'Edit', '2020-01-01T00:00:00Z');
    raise exception 'Stale revision accepted';
  exception when sqlstate 'P0001' then null;
  end;

  -- The current revision edits; the same text reports changed = false.
  o := (public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-10', 'Travel day, slept badly', v_revision) #>> '{receipt,output_json}')::jsonb;
  if o #>> '{day_note,note}' <> 'Travel day, slept badly' or (o->>'changed')::boolean is not true then raise exception 'Edit failed: %', o; end if;
  o := (public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-10', 'Travel day, slept badly', null) #>> '{receipt,output_json}')::jsonb;
  if (o->>'changed')::boolean is not false then raise exception 'Unchanged write reported a change'; end if;

  -- Clearing keeps the row; clearing an empty day returns a null day note.
  o := (public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-10', null, null) #>> '{receipt,output_json}')::jsonb;
  if o #> '{day_note,note}' <> 'null'::jsonb or (o->>'changed')::boolean is not true then raise exception 'Clear failed: %', o; end if;
  o := (public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-11', null, null) #>> '{receipt,output_json}')::jsonb;
  if o->'day_note' <> 'null'::jsonb or (o->>'changed')::boolean is not false then raise exception 'Empty clear wrong: %', o; end if;
  if exists (select 1 from public.day_notes where local_date = '2026-11-11') then raise exception 'Empty clear wrote a row'; end if;

  -- An expected revision on a day without a note conflicts.
  begin
    perform public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-12', 'x', '2026-11-12T00:00:00Z');
    raise exception 'Revision on a missing note accepted';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon', 'public.integration_apply_day_note_write(text,text,date,text,text)', 'execute')
    or has_function_privilege('service_role', 'public.integration_apply_day_note_write(text,text,date,text,text)', 'execute') then
    raise exception 'Day note write privileges widened';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.integration_apply_day_note_write(text,text,date,text,text)'::regprocedure) then
    raise exception 'Day note write must preserve caller RLS';
  end if;
  if (select count(*) from cadence_oauth_private.activity where user_id = '25700000-0000-4000-8000-0000000000aa' and operation = 'update_day_note') < 5 then
    raise exception 'Day note writes were not recorded as activity';
  end if;
end $$;

select 'ticket-292 day note integration write fixture passed' as result;
rollback;
