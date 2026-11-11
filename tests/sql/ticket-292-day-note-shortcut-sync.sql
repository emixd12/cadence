\set ON_ERROR_STOP on

-- Ticket 292: account sync contract 4 carries the day-note Note shortcuts pool
-- (migration 20261111130000). Contracts 1-3 neither receive nor write the
-- 'day_notes' row, and their applies leave it intact. Contract 4 reads, updates,
-- deletes and recreates it through the real apply RPC. Synthetic local fixtures
-- only; all changes roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('29200000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'day-note-shortcut-sync@example.invalid', '{}', '{}');

create function pg_temp.act_as(owner uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.sync_payload(snapshot jsonb, writes jsonb, merged_entities jsonb, key text, contract integer)
returns jsonb language sql immutable as $$
  with plan as (
    select jsonb_build_object('writes', writes, 'mergedFingerprint',
      cadence_private.account_sync_fingerprint(merged_entities), 'conflicts', '[]'::jsonb) value
  )
  select jsonb_build_object(
    'schemaVersion', 1, 'idempotencyKey', key, 'contract', contract,
    'baselineFingerprint', snapshot ->> 'fingerprint', 'localFingerprint', snapshot ->> 'fingerprint',
    'hostedFingerprint', snapshot ->> 'fingerprint',
    'planFingerprint', encode(extensions.digest(convert_to(cadence_private.canonical_account_sync_json(plan.value), 'UTF8'), 'sha256'), 'hex'),
    'plan', plan.value, 'attemptedAt', '2026-11-11T12:00:00.000000Z'
  )
  from plan
$$;

-- Replaces (or, with a null value, removes) one entity in a snapshot's entity list.
create function pg_temp.with_entity(entities jsonb, entity_kind text, entity_id text, next_value jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(item), '[]'::jsonb) from (
    select case when entity ->> 'kind' = entity_kind and entity ->> 'id' = entity_id
      then jsonb_set(entity, '{value}', next_value) else entity end item
    from jsonb_array_elements(entities) entity
    where next_value is not null or not (entity ->> 'kind' = entity_kind and entity ->> 'id' = entity_id)
    union all
    select jsonb_build_object('kind', entity_kind, 'id', entity_id, 'value', next_value)
    where next_value is not null and not exists (
      select 1 from jsonb_array_elements(entities) entity
      where entity ->> 'kind' = entity_kind and entity ->> 'id' = entity_id)
  ) rows
$$;

set local role authenticated;
select pg_temp.act_as('29200000-0000-4000-8000-000000000011');

do $$
declare
  owner_id uuid := auth.uid();
  context_value jsonb;
  snapshot_value jsonb;
  legacy_snapshot jsonb;
  day_value jsonb;
  global_value jsonb;
  next_value jsonb;
  applied jsonb;
  contract_value integer;
begin
  context_value := public.read_note_shortcut_context(null);
  perform public.commit_note_shortcut_state(context_value, jsonb_build_object(
    'id', 'global', 'user_id', owner_id, 'behavior_id', null, 'enabled', true,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-11T12:00:00Z'), false);
  context_value := public.read_day_note_shortcut_context();
  perform public.commit_note_shortcut_state(context_value, jsonb_build_object(
    'id', 'day_notes', 'user_id', owner_id, 'behavior_id', null, 'enabled', true,
    'entries', '[]'::jsonb, 'excluded_occurrence_ids', '["29200000-0000-4000-8000-000000000111"]'::jsonb,
    'revision', 1, 'updated_at', '2026-11-11T12:00:00Z'), false);

  -- Reads: only contract 4 receives the pool.
  for contract_value in 1..3 loop
    assert not exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(contract_value) -> 'entities') entity
      where entity ->> 'kind' = 'note_shortcut_state' and entity ->> 'id' = 'day_notes'),
      format('Contract %s snapshot carries the day pool', contract_value);
  end loop;
  snapshot_value := public.read_account_sync_snapshot(4);
  select entity -> 'value' into day_value from jsonb_array_elements(snapshot_value -> 'entities') entity
    where entity ->> 'kind' = 'note_shortcut_state' and entity ->> 'id' = 'day_notes';
  assert day_value is not null, 'Contract 4 snapshot lacks the day pool';
  assert not (day_value ? 'user_id') and jsonb_typeof(day_value -> 'behavior_id') = 'null'
    and day_value -> 'excluded_occurrence_ids' = '["29200000-0000-4000-8000-000000000111"]'::jsonb,
    'Contract 4 day pool value is wrong';
  assert public.read_account_sync_snapshot(3) ->> 'fingerprint' <> snapshot_value ->> 'fingerprint',
    'Contract 3 fingerprint includes the day pool';

  -- Contract 3 cannot write or delete the pool.
  legacy_snapshot := public.read_account_sync_snapshot(3);
  next_value := day_value || '{"enabled": false, "revision": 2}'::jsonb;
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(legacy_snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'note_shortcut_state', 'id', 'day_notes', 'operation', 'upsert', 'expected', day_value, 'value', next_value
    )), pg_temp.with_entity(legacy_snapshot -> 'entities', 'note_shortcut_state', 'day_notes', next_value), repeat('1', 64), 3));
    raise exception 'Contract 3 wrote the day pool';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(legacy_snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'note_shortcut_state', 'id', 'day_notes', 'operation', 'delete', 'expected', day_value
    )), legacy_snapshot -> 'entities', repeat('2', 64), 3));
    raise exception 'Contract 3 deleted the day pool';
  exception when invalid_parameter_value then null;
  end;

  -- A contract 3 apply of another row leaves the pool intact.
  select entity -> 'value' into global_value from jsonb_array_elements(legacy_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'note_shortcut_state' and entity ->> 'id' = 'global';
  next_value := global_value || '{"enabled": false, "revision": 2}'::jsonb;
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(legacy_snapshot, jsonb_build_array(jsonb_build_object(
    'kind', 'note_shortcut_state', 'id', 'global', 'operation', 'upsert', 'expected', global_value, 'value', next_value
  )), pg_temp.with_entity(legacy_snapshot -> 'entities', 'note_shortcut_state', 'global', next_value), repeat('3', 64), 3));
  assert applied ->> 'status' = 'applied', 'Contract 3 global write failed';
  assert not exists (select 1 from jsonb_array_elements(applied #> '{snapshot,entities}') entity
    where entity ->> 'id' = 'day_notes'), 'Contract 3 apply result carries the day pool';
  assert (select enabled and revision = 1 and excluded_occurrence_ids = '["29200000-0000-4000-8000-000000000111"]'::jsonb
    from public.note_shortcut_states where user_id = owner_id and id = 'day_notes'),
    'A contract 3 apply changed the day pool';

  -- Contract 4 updates the pool.
  snapshot_value := public.read_account_sync_snapshot(4);
  next_value := day_value || jsonb_build_object('enabled', false, 'revision', 2,
    'excluded_occurrence_ids', '["29200000-0000-4000-8000-000000000111", "29200000-0000-4000-8000-000000000112"]'::jsonb);
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value, jsonb_build_array(jsonb_build_object(
    'kind', 'note_shortcut_state', 'id', 'day_notes', 'operation', 'upsert', 'expected', day_value, 'value', next_value
  )), pg_temp.with_entity(snapshot_value -> 'entities', 'note_shortcut_state', 'day_notes', next_value), repeat('4', 64), 4));
  assert applied ->> 'fingerprint' = public.read_account_sync_snapshot(4) ->> 'fingerprint', 'Contract 4 update fingerprint differs';
  assert (select not enabled and revision = 2 and jsonb_array_length(excluded_occurrence_ids) = 2 and behavior_id is null
    from public.note_shortcut_states where user_id = owner_id and id = 'day_notes'), 'Contract 4 update did not apply';

  -- A day pool upsert tied to a Behavior is rejected.
  snapshot_value := public.read_account_sync_snapshot(4);
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value, jsonb_build_array(jsonb_build_object(
      'kind', 'note_shortcut_state', 'id', 'day_notes', 'operation', 'upsert', 'expected', next_value,
      'value', next_value || jsonb_build_object('behavior_id', gen_random_uuid(), 'revision', 3)
    )), snapshot_value -> 'entities', repeat('5', 64), 4));
    raise exception 'A day pool write with a Behavior was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Contract 4 deletes, then recreates, the pool.
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value, jsonb_build_array(jsonb_build_object(
    'kind', 'note_shortcut_state', 'id', 'day_notes', 'operation', 'delete', 'expected', next_value
  )), pg_temp.with_entity(snapshot_value -> 'entities', 'note_shortcut_state', 'day_notes', null), repeat('6', 64), 4));
  assert not exists (select 1 from public.note_shortcut_states where user_id = owner_id and id = 'day_notes'),
    'Contract 4 delete did not apply';

  snapshot_value := public.read_account_sync_snapshot(4);
  next_value := next_value || '{"enabled": true, "revision": 3}'::jsonb;
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value, jsonb_build_array(jsonb_build_object(
    'kind', 'note_shortcut_state', 'id', 'day_notes', 'operation', 'upsert', 'expected', null, 'value', next_value
  )), pg_temp.with_entity(snapshot_value -> 'entities', 'note_shortcut_state', 'day_notes', next_value), repeat('7', 64), 4));
  assert (select enabled and revision = 3 from public.note_shortcut_states where user_id = owner_id and id = 'day_notes'),
    'Contract 4 insert did not apply';
  assert applied ->> 'fingerprint' = public.read_account_sync_snapshot(4) ->> 'fingerprint', 'Contract 4 insert fingerprint differs';

  -- The web day pool still reads the synced state.
  context_value := public.read_day_note_shortcut_context();
  assert (context_value #>> '{state,revision}')::integer = 3, 'The day pool context did not read the synced state';
end
$$;

reset role;
do $$
begin
  assert cadence_private.account_sync_current_contract() = 4, 'The current sync contract is not 4';
  if has_table_privilege('authenticated', 'cadence_private.account_sync_contract_rows', 'insert') then
    raise exception 'authenticated can register sync contract rows';
  end if;
end
$$;

rollback;
