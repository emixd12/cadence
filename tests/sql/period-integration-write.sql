\set ON_ERROR_STOP on

-- Ticket 370: MCP create_period, update_period and end_period. Scope, the day-note
-- revision form, compare-and-set conflicts, idempotent replay, the end rule, the cap
-- of 500 Periods, cross-account isolation and privileges. It also re-checks one
-- operation integration_lock_write allowed before this ticket. Synthetic local
-- fixtures only; all changes roll back.
--
-- Each step is its own statement: a Period's revision is its updated_at, which is
-- statement_timestamp(), so two writes inside one statement would share a revision.
-- State passes between steps through transaction-local settings.
begin;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('37000000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated',
    'ticket-370-mcp-a@example.invalid', '{"provider":"email","providers":["email"]}', '{}'),
  ('37000000-0000-4000-8000-0000000000bb', 'authenticated', 'authenticated',
    'ticket-370-mcp-b@example.invalid', '{"provider":"email","providers":["email"]}', '{}');
-- Another account's Period, which no call below may read or change.
insert into public.periods (id, user_id, label, start_on)
values ('37000000-0000-4000-8000-00000000b001', '37000000-0000-4000-8000-0000000000bb', 'Other account', '2026-11-01');

set local role service_role;
select public.oauth_register_client('dcr-ticket-370', 'dcr', 'Period fixture', null, null,
  array['https://client.example/callback'], 'web', '{}'::jsonb, null, null) is not null as registered;
set local role authenticated;
set local request.jwt.claims = '{"sub":"37000000-0000-4000-8000-0000000000aa","role":"authenticated"}';

-- A read-only grant cannot write a Period.
do $$ declare consent jsonb; begin
  consent := public.oauth_approve_consent('dcr-ticket-370', 'https://client.example/callback',
    repeat('a', 43), 'https://app.cadence-me.com/mcp', array['cadence.read'], repeat('c', 64));
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '37000000-0000-4000-8000-0000000000aa', 'role', 'authenticated',
    'cadence_grant_id', consent->>'grant_id')::text, true);
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'create_period', null, null, 'Read only', '2026-11-03', null, null);
    raise exception 'Read-only grant created a Period';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A grant with cadence.behaviors.write alone cannot either: Periods use cadence.occurrences.write.
do $$ declare consent jsonb; begin
  consent := public.oauth_approve_consent('dcr-ticket-370', 'https://client.example/callback',
    repeat('e', 43), 'https://app.cadence-me.com/mcp', array['cadence.read','cadence.behaviors.write'], repeat('f', 64));
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '37000000-0000-4000-8000-0000000000aa', 'role', 'authenticated',
    'cadence_grant_id', consent->>'grant_id')::text, true);
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'create_period', null, null, 'Wrong scope', '2026-11-03', null, null);
    raise exception 'A Behavior-write grant created a Period';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The grant the rest of the file uses: read plus cadence.occurrences.write.
do $$ declare consent jsonb; begin
  consent := public.oauth_approve_consent('dcr-ticket-370', 'https://client.example/callback',
    repeat('b', 43), 'https://app.cadence-me.com/mcp',
    array['cadence.read','cadence.occurrences.write'], repeat('d', 64));
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '37000000-0000-4000-8000-0000000000aa', 'role', 'authenticated',
    'cadence_grant_id', consent->>'grant_id')::text, true);
end $$;

-- integration_lock_write: an operation it allowed before still passes, a scope the
-- grant lacks is still refused, and an operation it never knew is still refused.
do $$ declare o jsonb; begin
  if public.integration_lock_write(null, 'update_day_note', repeat('a', 64)) is not null then
    raise exception 'A keyless lock returned a stored result';
  end if;
  o := (public.integration_apply_day_note_write(null, repeat('a', 64), '2026-11-10', 'Travel day', null) #>> '{receipt,output_json}')::jsonb;
  if o #>> '{day_note,note}' <> 'Travel day' then raise exception 'Day note write broke: %', o; end if;
  begin
    perform public.integration_lock_write(null, 'create_behavior', repeat('a', 64));
    raise exception 'Behavior write allowed without its scope';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.integration_lock_write(null, 'delete_period', repeat('a', 64));
    raise exception 'An unknown operation was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'delete_period', null, null, 'x', '2026-11-03', null, null);
    raise exception 'A remove operation exists';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Create with an idempotency key: an ongoing Period with a note.
do $$ declare r jsonb; o jsonb; begin
  r := public.integration_apply_period_write('period-key-1', repeat('e', 64), 'create_period', null, null, 'Sick', '2026-11-03', null, 'Flu');
  o := (r #>> '{receipt,output_json}')::jsonb;
  if (r #>> '{receipt,version}')::integer <> 2 or o ? 'changed'
    or o #>> '{period,label}' <> 'Sick' or o #>> '{period,start_local_date}' <> '2026-11-03'
    or o #> '{period,end_local_date}' <> 'null'::jsonb or (o #>> '{period,ongoing}')::boolean is not true
    or o #>> '{period,note}' <> 'Flu' or o #>> '{period,revision}' <> o #>> '{period,updated_at}'
    or o #>> '{period,revision}' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
    raise exception 'Create output wrong: %', r;
  end if;
  perform set_config('t370.created', o::text, true);
  perform set_config('t370.id', o #>> '{period,id}', true);
  perform set_config('t370.revision', o #>> '{period,revision}', true);
end $$;

-- Replay with the same key returns the stored receipt and adds nothing.
do $$ declare r jsonb; begin
  r := public.integration_apply_period_write('period-key-1', repeat('e', 64), 'create_period', null, null, 'Sick', '2026-11-03', null, 'Flu');
  if (r #>> '{receipt,output_json}')::jsonb <> current_setting('t370.created')::jsonb then raise exception 'Replay differs'; end if;
  if (select count(*) from public.periods) <> 1 then raise exception 'Replay created a second Period'; end if;
  -- The same key with different input is refused.
  begin
    perform public.integration_apply_period_write('period-key-1', repeat('f', 64), 'create_period', null, null, 'Other', '2026-11-03', null, null);
    raise exception 'Key reuse accepted';
  exception when sqlstate '22023' then null;
  end;
  -- create_period takes no id and no revision; an edit needs both.
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'create_period', current_setting('t370.id')::uuid, null, 'Sick', '2026-11-03', null, null);
    raise exception 'Create accepted an id';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'update_period', current_setting('t370.id')::uuid, null, 'Sick', '2026-11-03', null, null);
    raise exception 'Edit accepted without a revision';
  exception when sqlstate '22023' then null;
  end;
  -- Invalid fields fail with the Period functions' own check.
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'create_period', null, null, 'Sick', '2026-11-03', '2026-11-02', null);
    raise exception 'A last day before the first was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- A stale revision conflicts and changes nothing. A missing Period, and another
-- account's Period, are not found.
do $$ begin
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'update_period', current_setting('t370.id')::uuid,
      '2020-01-01T00:00:00Z', 'Edited', '2026-11-03', null, 'Flu');
    raise exception 'Stale revision accepted';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'update_period', '37000000-0000-4000-8000-00000000ffff',
      current_setting('t370.revision'), 'Edited', '2026-11-03', null, null);
    raise exception 'A missing Period was edited';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'end_period', '37000000-0000-4000-8000-00000000b001',
      current_setting('t370.revision'), 'Other account', '2026-11-01', '2026-11-05', null);
    raise exception 'Another account''s Period was reached';
  exception when sqlstate 'P0002' then null;
  end;
  if (select label from public.periods where id = current_setting('t370.id')::uuid) <> 'Sick' then raise exception 'A refused write changed the Period'; end if;
end $$;

-- The current revision edits: new label, a last day, the note cleared.
do $$ declare o jsonb; begin
  o := (public.integration_apply_period_write('period-key-2', repeat('1', 64), 'update_period', current_setting('t370.id')::uuid,
    current_setting('t370.revision'), 'Flu week', '2026-11-03', '2026-11-20', null) #>> '{receipt,output_json}')::jsonb;
  if (o->>'changed')::boolean is not true or o #>> '{period,label}' <> 'Flu week' or o #>> '{period,end_local_date}' <> '2026-11-20'
    or (o #>> '{period,ongoing}')::boolean is not false or o #> '{period,note}' <> 'null'::jsonb
    or o #>> '{period,revision}' = current_setting('t370.revision') then
    raise exception 'Edit output wrong: %', o;
  end if;
  if (select revision from public.periods where id = current_setting('t370.id')::uuid) <> 2 then raise exception 'Edit did not raise the revision'; end if;
  perform set_config('t370.old_revision', current_setting('t370.revision'), true);
  perform set_config('t370.revision', o #>> '{period,revision}', true);
end $$;

-- The same values report changed = false and keep the revision. The revision read
-- before the edit is now stale.
do $$ declare o jsonb; begin
  o := (public.integration_apply_period_write(null, repeat('a', 64), 'update_period', current_setting('t370.id')::uuid,
    current_setting('t370.revision'), 'Flu week', '2026-11-03', '2026-11-20', null) #>> '{receipt,output_json}')::jsonb;
  if (o->>'changed')::boolean is not false or o #>> '{period,revision}' <> current_setting('t370.revision') then
    raise exception 'Unchanged edit wrong: %', o;
  end if;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'update_period', current_setting('t370.id')::uuid,
      current_setting('t370.old_revision'), 'Again', '2026-11-03', '2026-11-20', null);
    raise exception 'The revision from before the edit was accepted';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- end_period only sets the last day, and only to an earlier day than the stored one.
do $$ begin
  -- It never extends: the stored last day is 2026-11-20.
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'end_period', current_setting('t370.id')::uuid,
      current_setting('t370.revision'), 'Flu week', '2026-11-03', '2026-11-25', null);
    raise exception 'end_period extended a Period';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'integration_period_end_refused' then raise; end if;
  end;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'end_period', current_setting('t370.id')::uuid,
      current_setting('t370.revision'), 'Flu week', '2026-11-03', '2026-11-20', null);
    raise exception 'end_period ended a Period on its own last day';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'integration_period_end_refused' then raise; end if;
  end;
  -- It changes no other field, and it cannot make a Period ongoing or end it before it starts.
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'end_period', current_setting('t370.id')::uuid,
      current_setting('t370.revision'), 'Renamed', '2026-11-03', '2026-11-10', null);
    raise exception 'end_period changed the label';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'integration_period_end_refused' then raise; end if;
  end;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'end_period', current_setting('t370.id')::uuid,
      current_setting('t370.revision'), 'Flu week', '2026-11-03', null, null);
    raise exception 'end_period made a Period ongoing';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'integration_period_end_refused' then raise; end if;
  end;
  begin
    perform public.integration_apply_period_write(null, repeat('a', 64), 'end_period', current_setting('t370.id')::uuid,
      current_setting('t370.revision'), 'Flu week', '2026-11-03', '2026-11-01', null);
    raise exception 'end_period ended a Period before its first day';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'integration_period_end_refused' then raise; end if;
  end;
end $$;

do $$ declare o jsonb; begin
  o := (public.integration_apply_period_write('period-key-3', repeat('2', 64), 'end_period', current_setting('t370.id')::uuid,
    current_setting('t370.revision'), 'Flu week', '2026-11-03', '2026-11-09', null) #>> '{receipt,output_json}')::jsonb;
  if (o->>'changed')::boolean is not true or o #>> '{period,end_local_date}' <> '2026-11-09' or (o #>> '{period,ongoing}')::boolean is not false
    or o #>> '{period,label}' <> 'Flu week' then
    raise exception 'End output wrong: %', o;
  end if;
  perform set_config('t370.ended', o::text, true);
end $$;

-- A repeated end with the same key replays; the Period keeps its revision.
do $$ declare r jsonb; begin
  r := public.integration_apply_period_write('period-key-3', repeat('2', 64), 'end_period', current_setting('t370.id')::uuid,
    current_setting('t370.revision'), 'Flu week', '2026-11-03', '2026-11-09', null);
  if (r #>> '{receipt,output_json}')::jsonb <> current_setting('t370.ended')::jsonb then raise exception 'End replay differs'; end if;
  if (select revision from public.periods where id = current_setting('t370.id')::uuid) <> 3 then raise exception 'End replay wrote again'; end if;
  if (select label from public.periods where id = '37000000-0000-4000-8000-00000000b001') <> 'Other account' then
    raise exception 'Another account''s Period changed';
  end if;
end $$;

-- The cap holds for the integration writer: at 500 Periods a create fails with
-- SQLSTATE 54000 and adds nothing.
reset role;
insert into public.periods (user_id, label, start_on)
select '37000000-0000-4000-8000-0000000000aa', 'Filler ' || n, '2025-01-01'
from generate_series(1, 499) as n;
set local role authenticated;
do $$ begin
  if (select count(*) from public.periods) <> 500 then raise exception 'Cap fixture is not at 500'; end if;
  begin
    perform public.integration_apply_period_write('period-key-cap', repeat('3', 64), 'create_period', null, null, 'One too many', '2026-11-03', null, null);
    raise exception 'A 501st Period was created';
  exception when sqlstate '54000' then null;
  end;
  if (select count(*) from public.periods) <> 500 then raise exception 'A refused create added a Period'; end if;
end $$;

reset role;
do $$ declare signature constant text := 'public.integration_apply_period_write(text,text,text,uuid,text,text,date,date,text)'; begin
  if has_function_privilege('anon', signature, 'execute') or has_function_privilege('service_role', signature, 'execute')
    or not has_function_privilege('authenticated', signature, 'execute') then
    raise exception 'Period write privileges are wrong';
  end if;
  if (select prosecdef from pg_proc where oid = signature::regprocedure) then
    raise exception 'Period write must preserve caller RLS';
  end if;
  if has_function_privilege('anon', 'public.integration_lock_write(text,text,text)', 'execute') then
    raise exception 'integration_lock_write privileges widened';
  end if;
  -- Six successful Period writes: one create, its replay, two edits, one end, its replay.
  if (select count(*) from cadence_oauth_private.activity
      where user_id = '37000000-0000-4000-8000-0000000000aa' and outcome = 'success'
        and operation in ('create_period', 'update_period', 'end_period')
        and target_ids = array[(select id from public.periods where label = 'Flu week')]) <> 6 then
    raise exception 'Period writes were not recorded as activity with their target';
  end if;
  if exists (select 1 from cadence_oauth_private.activity where operation = 'delete_period') then
    raise exception 'A remove operation was recorded';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'chat_actions_kind_check') !~ '''period''' then
    raise exception 'Chat actions do not accept the period kind';
  end if;
end $$;

select 'ticket-370 period integration write fixture passed' as result;
rollback;
