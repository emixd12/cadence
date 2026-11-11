\set ON_ERROR_STOP on

-- Ticket 292: the day-note Note shortcuts pool. Owner-only reads, writes only
-- through the guarded RPCs, the full-context compare-and-set, the global and pool
-- switches, shortcut exclusions recorded with the save, no cross-account
-- access, and no 'day_notes' state in sync contracts 1-3 (contract 4 carries it). Synthetic local fixtures only; all changes roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('29200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'day-note-shortcuts-a@example.invalid', '{}', '{}'),
  ('29200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'day-note-shortcuts-b@example.invalid', '{}', '{}');

insert into public.day_notes (id, user_id, local_date, note) values
  ('29200000-0000-4000-8000-000000000101', '29200000-0000-4000-8000-000000000001', '2026-11-08', 'Travel day'),
  ('29200000-0000-4000-8000-000000000102', '29200000-0000-4000-8000-000000000001', '2026-11-09', 'Travel day'),
  ('29200000-0000-4000-8000-000000000103', '29200000-0000-4000-8000-000000000001', '2026-11-10', 'Travel day'),
  ('29200000-0000-4000-8000-000000000104', '29200000-0000-4000-8000-000000000001', '2026-11-07', null),
  ('29200000-0000-4000-8000-000000000201', '29200000-0000-4000-8000-000000000002', '2026-11-10', 'Private other day note');

create function pg_temp.act_as(owner uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
$$;

-- The table accepts the day pool identity and rejects a day pool tied to a Behavior.
do $$
begin
  begin
    insert into public.note_shortcut_states (user_id, id, behavior_id)
    values ('29200000-0000-4000-8000-000000000002', 'day_note', null);
    raise exception 'An unknown pool ID was accepted';
  exception when check_violation then null;
  end;
end
$$;

set local role authenticated;
select pg_temp.act_as('29200000-0000-4000-8000-000000000001');

do $$
declare
  context_value jsonb;
  global_context jsonb;
  kinds_before jsonb;
  count_before integer;
  snapshot_value jsonb;
  contract_value integer;
  next_value jsonb;
  result_value jsonb;
  saved public.day_notes;
  rows integer;
begin
  begin
    insert into public.note_shortcut_states (user_id, id) values (auth.uid(), 'day_notes');
    raise exception 'Direct day pool insert bypassed the guarded RPC';
  exception when insufficient_privilege then null;
  end;

  context_value := public.read_day_note_shortcut_context();
  assert context_value -> 'state' = 'null'::jsonb, 'Day pool state must start absent';
  assert context_value -> 'behavior' = 'null'::jsonb, 'Day pool context carries a Behavior';
  assert context_value #>> '{dayPool,timezone}' = 'America/New_York', 'Day pool timezone missing';
  assert context_value #>> '{dayPool,user_id}' = auth.uid()::text, 'Day pool owner missing';
  assert jsonb_array_length(context_value -> 'notes') = 3, 'Day pool must read only non-empty own day notes';
  assert not exists (
    select 1 from jsonb_array_elements(context_value -> 'notes') source
    where source ->> 'user_id' <> auth.uid()::text
      or jsonb_typeof(source -> 'behavior_id') <> 'null'
      or jsonb_typeof(source -> 'scheduled_for') <> 'null'
  ), 'Day pool source shape is wrong';
  assert context_value -> 'importedOccurrenceIds' = '[]'::jsonb,
    'Day pool must not exclude imported day notes';

  -- The Behavior context RPC never returns day notes.
  global_context := public.read_note_shortcut_context(null);
  assert jsonb_array_length(global_context -> 'notes') = 0, 'Global context returned sources';

  -- Enable the global switch, then the day pool.
  next_value := jsonb_build_object(
    'id', 'global', 'user_id', auth.uid(), 'behavior_id', null, 'enabled', true,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-10T12:00:00Z'
  );
  perform public.commit_note_shortcut_state(global_context, next_value, false);

  snapshot_value := cadence_private.account_sync_snapshot();
  select jsonb_agg(distinct entity ->> 'kind' order by entity ->> 'kind'), count(*)
  into kinds_before, count_before
  from jsonb_array_elements(snapshot_value -> 'entities') entity;

  context_value := public.read_day_note_shortcut_context();
  next_value := jsonb_build_object(
    'id', 'day_notes', 'user_id', auth.uid(), 'behavior_id', null, 'enabled', true,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-10T12:00:00Z'
  );
  result_value := public.commit_note_shortcut_state(context_value, next_value, false);
  assert result_value ->> 'id' = 'day_notes' and result_value ->> 'enabled' = 'true',
    'Day pool enable failed';

  -- The full snapshot gains only the day pool row. Sync contracts 1-3 never receive
  -- it (migration 20261111130000); contract 4 does.
  snapshot_value := cadence_private.account_sync_snapshot();
  assert (select jsonb_agg(distinct entity ->> 'kind' order by entity ->> 'kind')
    from jsonb_array_elements(snapshot_value -> 'entities') entity) = kinds_before,
    'Snapshot kinds changed';
  assert jsonb_array_length(snapshot_value -> 'entities') = count_before + 1,
    'Snapshot entity count changed';
  assert exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(4) -> 'entities') entity
    where entity ->> 'kind' = 'note_shortcut_state' and entity ->> 'id' = 'day_notes'),
    'Contract 4 snapshot lacks the day pool';
  assert jsonb_array_length(public.read_account_sync_snapshot(3) -> 'entities') = count_before,
    'Contract 3 snapshot entity count changed';
  assert exists (select 1 from jsonb_array_elements(snapshot_value -> 'entities') entity
    where entity ->> 'kind' = 'note_shortcut_state' and entity ->> 'id' = 'global'),
    'Snapshot lost the global Note shortcut state';
  assert not exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot() -> 'entities') entity
    where entity ->> 'kind' = 'note_shortcut_state' and entity ->> 'id' = 'day_notes'),
    'Default snapshot carries the day pool';
  for contract_value in 1..3 loop
    assert not exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(contract_value) -> 'entities') entity
      where entity ->> 'kind' = 'note_shortcut_state' and entity ->> 'id' = 'day_notes'),
      format('Contract %s snapshot carries the day pool', contract_value);
  end loop;

  -- The day pool commit rejects a context without its dayPool key.
  context_value := public.read_day_note_shortcut_context();
  next_value := jsonb_set(context_value -> 'state', '{revision}', '2'::jsonb);
  begin
    perform public.commit_note_shortcut_state(context_value - 'dayPool', next_value, true);
    raise exception 'A day pool commit without dayPool was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.commit_note_shortcut_state(context_value, jsonb_set(next_value, '{behavior_id}', to_jsonb('29200000-0000-4000-8000-000000000999'::text)), true);
    raise exception 'A day pool commit tied to a Behavior was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- Accept a shortcut while both switches are on.
  next_value := jsonb_set(next_value, '{entries}', jsonb_build_array(jsonb_build_object(
    'key', repeat('d', 64), 'text', 'Travel day', 'status', 'accepted',
    'source', 'repeated_text', 'evidence', '[]'::jsonb,
    'created_at', '2026-11-10T12:00:00Z', 'expires_at', null
  )));
  perform public.commit_note_shortcut_state(context_value, next_value, true);

  -- A day note edit after the read invalidates the expected context.
  context_value := public.read_day_note_shortcut_context();
  perform public.save_day_note('2026-11-09', 'Travel day', 'Travel day, long drive');
  begin
    perform public.commit_note_shortcut_state(context_value, jsonb_set(context_value -> 'state', '{revision}', '3'::jsonb), true);
    raise exception 'Stale day note context was committed';
  exception when sqlstate 'P0001' then null;
  end;

  -- Turning the global switch off blocks day pool analysis and acceptance.
  global_context := public.read_note_shortcut_context(null);
  perform public.commit_note_shortcut_state(global_context,
    jsonb_set(jsonb_set(global_context -> 'state', '{enabled}', 'false'::jsonb), '{revision}', '2'::jsonb), false);
  context_value := public.read_day_note_shortcut_context();
  begin
    perform public.commit_note_shortcut_state(context_value, jsonb_set(context_value -> 'state', '{revision}', '3'::jsonb), true);
    raise exception 'Global disable did not block the day pool';
  exception when sqlstate 'P0001' then null;
  end;

  -- A shortcut-written day note saves and records its exclusion in one step.
  select * into saved from public.save_day_note_with_shortcut('2026-11-11', null, 'Travel day', true);
  assert saved.note = 'Travel day', 'Shortcut day note did not save';
  assert (select excluded_occurrence_ids ? saved.id::text from public.note_shortcut_states
    where user_id = auth.uid() and id = 'day_notes'), 'Day note exclusion missing';
  assert (select count(*) from public.note_shortcut_states
    where user_id = auth.uid() and excluded_occurrence_ids ? saved.id::text) = 1,
    'Day note exclusion reached another pool';

  -- A stale shortcut save writes neither the note nor an exclusion.
  select count(*) into rows from public.save_day_note_with_shortcut('2026-11-10', 'Other', 'Travel day', true);
  assert rows = 0, 'Stale shortcut day note save was accepted';
  assert not (select excluded_occurrence_ids ? '29200000-0000-4000-8000-000000000103' from public.note_shortcut_states
    where user_id = auth.uid() and id = 'day_notes'), 'Stale save recorded an exclusion';

  begin
    perform public.save_day_note_with_shortcut('2026-11-12', null, 'Travel day', false);
    raise exception 'A save without the shortcut flag was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.save_day_note_with_shortcut('2026-11-11', 'Travel day', null, true);
    raise exception 'A shortcut clear was accepted';
  exception when sqlstate '22023' then null;
  end;
end
$$;

-- The other account sees none of this account's day pool and reads only its own sources.
select pg_temp.act_as('29200000-0000-4000-8000-000000000002');
do $$
declare
  context_value jsonb;
begin
  assert (select count(*) from public.note_shortcut_states) = 0, 'Another account read day pool state';
  context_value := public.read_day_note_shortcut_context();
  assert jsonb_array_length(context_value -> 'notes') = 1, 'Other account sources are wrong';
  assert context_value #>> '{notes,0,note}' = 'Private other day note', 'Other account read a foreign day note';

  -- Ticket 305 applies to the day pool: with no global row and the pool flag false,
  -- a matching commit (require_enabled) is accepted.
  assert context_value -> 'globalState' = 'null'::jsonb, 'The other account has a global state';
  perform public.commit_note_shortcut_state(context_value, jsonb_build_object(
    'id', 'day_notes', 'user_id', auth.uid(), 'behavior_id', null, 'enabled', false,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-11T12:00:00Z'), true);
end
$$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.read_day_note_shortcut_context()', 'execute') then
    raise exception 'anon can read the day pool context';
  end if;
  if has_function_privilege('anon', 'public.save_day_note_with_shortcut(date, text, text, boolean)', 'execute') then
    raise exception 'anon can save shortcut day notes';
  end if;
end
$$;

rollback;
\echo 'Ticket 292 day-note shortcut SQL passed; fixtures rolled back.'
