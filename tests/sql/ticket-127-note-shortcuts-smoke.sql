\set ON_ERROR_STOP on
begin;

-- The account sync writer floor is 7 since Ended and Paused (contracts 1-6 wrote
-- end_date). This file checks how older contracts behave, so it lowers the floor
-- inside its rolled-back transaction.
create or replace function cadence_private.account_sync_min_writer_contract()
returns integer language sql immutable set search_path = '' as $floor$ select 1 $floor$;

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('12700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ticket-127-owner@example.invalid', '{}', '{}'),
  ('12700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ticket-127-other@example.invalid', '{}', '{}');

insert into public.behaviors(id, user_id, title, recurrence_rule, scheduled_time, active)
values
  ('12700000-0000-4000-8000-000000000011', '12700000-0000-4000-8000-000000000001', 'Invisalign', '{"frequency":"daily","interval":1}', '22:00', true),
  ('12700000-0000-4000-8000-000000000012', '12700000-0000-4000-8000-000000000001', 'Floss', '{"frequency":"daily","interval":1}', '22:05', true),
  ('12700000-0000-4000-8000-000000000021', '12700000-0000-4000-8000-000000000002', 'Other account', '{"frequency":"daily","interval":1}', '09:00', true);

insert into public.occurrences(id, user_id, behavior_id, scheduled_for, local_date, schedule_start_time, status, note)
values
  ('12700000-0000-4000-8000-000000000101', '12700000-0000-4000-8000-000000000001', '12700000-0000-4000-8000-000000000011', '2026-09-07T02:00:00Z', '2026-09-06', '22:00', 'completed', 'Wore aligners overnight'),
  ('12700000-0000-4000-8000-000000000102', '12700000-0000-4000-8000-000000000001', '12700000-0000-4000-8000-000000000011', '2026-09-06T02:00:00Z', '2026-09-05', '22:00', 'not_completed', 'Wore aligners overnight'),
  ('12700000-0000-4000-8000-000000000103', '12700000-0000-4000-8000-000000000001', '12700000-0000-4000-8000-000000000011', '2026-09-05T02:00:00Z', '2026-09-04', '22:00', 'unresolved', 'Wore aligners overnight'),
  ('12700000-0000-4000-8000-000000000104', '12700000-0000-4000-8000-000000000001', '12700000-0000-4000-8000-000000000012', '2026-09-07T02:05:00Z', '2026-09-06', '22:05', 'unresolved', null),
  ('12700000-0000-4000-8000-000000000201', '12700000-0000-4000-8000-000000000002', '12700000-0000-4000-8000-000000000021', '2026-09-07T13:00:00Z', '2026-09-07', '09:00', 'completed', 'Private other Note');

insert into public.behaviorlog_import_runs(
  id, user_id, bundle_format, bundle_fingerprint, import_mode, status
) values (
  '12700000-0000-4000-8000-000000000301',
  '12700000-0000-4000-8000-000000000001',
  'behaviorlog-bundle', repeat('a', 64), 'preview_only', 'previewed'
);
insert into public.behaviorlog_import_record_mappings(
  id, user_id, import_run_id, record_type, external_id, local_id
) values (
  '12700000-0000-4000-8000-000000000302',
  '12700000-0000-4000-8000-000000000001',
  '12700000-0000-4000-8000-000000000301',
  'occurrence', 'source-occurrence', '12700000-0000-4000-8000-000000000103'
);

set local role authenticated;
set local request.jwt.claim.sub = '12700000-0000-4000-8000-000000000001';

do $$
declare
  context_value jsonb;
  next_value jsonb;
  result_value jsonb;
  snapshot_value jsonb;
  behavior_context jsonb;
  exclusions_before jsonb;
  expected_value jsonb;
  merged_entities jsonb;
  merged_fingerprint text;
  plan_value jsonb;
  payload_value jsonb;
begin
  begin
    insert into public.note_shortcut_states(user_id, id)
    values (auth.uid(), 'global');
    raise exception 'Direct state insert bypassed the guarded RPC';
  exception when insufficient_privilege then null;
  end;

  context_value := public.read_note_shortcut_context(null);
  assert context_value -> 'state' = 'null'::jsonb, 'Global state must start absent';
  next_value := jsonb_build_object(
    'id', 'global', 'user_id', auth.uid(), 'behavior_id', null,
    'enabled', true, 'entries', '[]'::jsonb,
    'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-09-07T12:00:00Z'
  );
  result_value := public.commit_note_shortcut_state(context_value, next_value, false);
  assert result_value ->> 'enabled' = 'true' and result_value ->> 'revision' = '1',
    'Global state commit failed';

  context_value := public.read_note_shortcut_context('12700000-0000-4000-8000-000000000011');
  assert jsonb_array_length(context_value -> 'notes') = 3, 'Eligible current Notes missing';
  assert context_value #>> '{importedOccurrenceIds,0}' = '12700000-0000-4000-8000-000000000103',
    'Imported Occurrence provenance missing';
  next_value := jsonb_build_object(
    'id', '12700000-0000-4000-8000-000000000011',
    'user_id', auth.uid(),
    'behavior_id', '12700000-0000-4000-8000-000000000011',
    'enabled', true,
    'entries', jsonb_build_array(jsonb_build_object(
      'key', repeat('b', 64), 'text', 'Wore aligners overnight',
      'status', 'accepted', 'source', 'repeated_text',
      'evidence', '[]'::jsonb,
      'created_at', '2026-09-07T12:00:00Z', 'expires_at', null
    )),
    'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-09-07T12:00:00Z'
  );
  perform public.commit_note_shortcut_state(context_value, next_value, false);

  snapshot_value := public.read_account_sync_snapshot();
  assert snapshot_value ->> 'schemaVersion' = '1', 'Account snapshot schema version changed';
  assert exists (
    select 1 from jsonb_array_elements(snapshot_value -> 'entities') entity
    where entity ->> 'kind' = 'note_shortcut_state'
      and entity ->> 'id' = '12700000-0000-4000-8000-000000000011'
      and not ((entity -> 'value') ? 'user_id')
  ), 'Account snapshot omitted the owner-free Note shortcut state';

  -- A Note edit after the read invalidates the full expected context.
  behavior_context := public.read_note_shortcut_context('12700000-0000-4000-8000-000000000011');
  update public.occurrences set note = 'Changed after read'
  where user_id = auth.uid() and id = '12700000-0000-4000-8000-000000000101';
  next_value := jsonb_set(behavior_context -> 'state', '{revision}', '2'::jsonb);
  begin
    perform public.commit_note_shortcut_state(behavior_context, next_value, true);
    raise exception 'Stale Note context was committed';
  exception when sqlstate 'P0001' then null;
  end;
  assert (select revision from public.note_shortcut_states
    where user_id = auth.uid() and id = '12700000-0000-4000-8000-000000000011') = 1,
    'Stale commit changed state';

  -- Turning the global state off invalidates a rendered Behavior context.
  behavior_context := public.read_note_shortcut_context('12700000-0000-4000-8000-000000000011');
  context_value := public.read_note_shortcut_context(null);
  next_value := jsonb_set(jsonb_set(context_value -> 'state', '{enabled}', 'false'::jsonb), '{revision}', '2'::jsonb);
  perform public.commit_note_shortcut_state(context_value, next_value, false);
  next_value := jsonb_set(behavior_context -> 'state', '{revision}', '2'::jsonb);
  begin
    perform public.commit_note_shortcut_state(behavior_context, next_value, true);
    raise exception 'Global disable did not invalidate the Behavior commit';
  exception when sqlstate 'P0001' then null;
  end;

  -- An existing draft still saves while shortcuts are disabled and records its exclusion.
  select to_jsonb(updated) into result_value
  from public.update_occurrence_note_with_shortcut(
    '12700000-0000-4000-8000-000000000101', 'Changed after read',
    'Wore aligners overnight', true
  ) updated;
  assert result_value ->> 'note' = 'Wore aligners overnight', 'Shortcut Note did not save';
  assert (select excluded_occurrence_ids ? '12700000-0000-4000-8000-000000000101'
    from public.note_shortcut_states where user_id = auth.uid()
      and id = '12700000-0000-4000-8000-000000000011'), 'Shortcut exclusion missing';

  perform public.update_occurrence_note_with_shortcut(
    '12700000-0000-4000-8000-000000000101', 'Wore aligners overnight',
    'Wore aligners overnight again', true
  );
  assert (select count(*)
    from public.note_shortcut_states state
    cross join lateral jsonb_array_elements_text(state.excluded_occurrence_ids) excluded(id)
    where state.user_id = auth.uid()
      and state.id = '12700000-0000-4000-8000-000000000011'
      and excluded.id = '12700000-0000-4000-8000-000000000101') = 1,
    'Repeated shortcut save duplicated its exclusion';

  select excluded_occurrence_ids into exclusions_before
  from public.note_shortcut_states where user_id = auth.uid()
    and id = '12700000-0000-4000-8000-000000000011';
  update public.occurrences set note = 'Ordinary typed Note'
  where user_id = auth.uid() and id = '12700000-0000-4000-8000-000000000101';
  assert (select excluded_occurrence_ids from public.note_shortcut_states
    where user_id = auth.uid() and id = '12700000-0000-4000-8000-000000000011') = exclusions_before,
    'Ordinary Note save changed exclusions';

  -- A used shortcut creates a disabled state when no state exists yet.
  perform public.update_occurrence_note_with_shortcut(
    '12700000-0000-4000-8000-000000000104', null, 'Flossed', true
  );
  assert (select not enabled and revision = 1
      and excluded_occurrence_ids ? '12700000-0000-4000-8000-000000000104'
    from public.note_shortcut_states where user_id = auth.uid()
      and id = '12700000-0000-4000-8000-000000000012'),
    'Missing Behavior state was not created safely';

  -- The schema-version-1 account transaction applies the new composite-key entity.
  snapshot_value := public.read_account_sync_snapshot();
  select entity -> 'value' into expected_value
  from jsonb_array_elements(snapshot_value -> 'entities') entity
  where entity ->> 'kind' = 'note_shortcut_state'
    and entity ->> 'id' = '12700000-0000-4000-8000-000000000011';
  next_value := jsonb_set(
    jsonb_set(expected_value, '{revision}', to_jsonb((expected_value ->> 'revision')::integer + 1)),
    '{updated_at}', to_jsonb('2026-09-07T13:00:00Z'::text)
  );
  select jsonb_agg(
    case when entity ->> 'kind' = 'note_shortcut_state'
      and entity ->> 'id' = '12700000-0000-4000-8000-000000000011'
      then jsonb_set(entity, '{value}', next_value) else entity end
    order by entity ->> 'kind' collate "C", entity ->> 'id' collate "C"
  ) into merged_entities
  from jsonb_array_elements(snapshot_value -> 'entities') entity;
  select encode(extensions.digest(convert_to(cadence_private.canonical_account_sync_json(
    (select jsonb_agg(jsonb_set(entity, '{value}', (entity -> 'value') - 'updated_at')
      order by entity ->> 'kind' collate "C", entity ->> 'id' collate "C")
      from jsonb_array_elements(merged_entities) entity)
  ), 'UTF8'), 'sha256'), 'hex') into merged_fingerprint;
  plan_value := jsonb_build_object(
    'writes', jsonb_build_array(jsonb_build_object(
      'kind', 'note_shortcut_state',
      'id', '12700000-0000-4000-8000-000000000011',
      'operation', 'upsert', 'expected', expected_value, 'value', next_value
    )),
    'mergedFingerprint', merged_fingerprint,
    'conflicts', '[]'::jsonb
  );
  payload_value := jsonb_build_object(
    'schemaVersion', 1,
    'idempotencyKey', repeat('c', 64),
    'baselineFingerprint', repeat('d', 64),
    'localFingerprint', repeat('e', 64),
    'hostedFingerprint', snapshot_value ->> 'fingerprint',
    'planFingerprint', encode(extensions.digest(convert_to(
      cadence_private.canonical_account_sync_json(plan_value), 'UTF8'
    ), 'sha256'), 'hex'),
    'plan', plan_value,
    'attemptedAt', '2026-09-07T13:00:00Z'
  );
  result_value := public.apply_account_sync_plan(payload_value);
  assert result_value ->> 'fingerprint' = merged_fingerprint,
    'Account synchronization did not apply Note shortcut state';
end;
$$;

reset role;

-- Force a state-side failure and prove the guarded Note stays unchanged.
update public.note_shortcut_states set revision = 2147483647
where user_id = '12700000-0000-4000-8000-000000000001'
  and id = '12700000-0000-4000-8000-000000000011';

set local role authenticated;
set local request.jwt.claim.sub = '12700000-0000-4000-8000-000000000001';
do $$
begin
  begin
    perform public.update_occurrence_note_with_shortcut(
      '12700000-0000-4000-8000-000000000101', 'Ordinary typed Note',
      'Must roll back', true
    );
    raise exception 'Overflowing atomic state write succeeded';
  exception when numeric_value_out_of_range then null;
  end;
  assert (select note from public.occurrences where user_id = auth.uid()
    and id = '12700000-0000-4000-8000-000000000101') = 'Ordinary typed Note',
    'Failed exclusion write still changed the Note';
end;
$$;

set local request.jwt.claim.sub = '12700000-0000-4000-8000-000000000002';
do $$
declare context_value jsonb; next_value jsonb;
begin
  assert (select count(*) from public.note_shortcut_states) = 0,
    'RLS exposed another account state';
  context_value := public.read_note_shortcut_context('12700000-0000-4000-8000-000000000011');
  assert context_value -> 'behavior' = 'null'::jsonb
    and jsonb_array_length(context_value -> 'notes') = 0,
    'Context read exposed another account';
  next_value := jsonb_build_object(
    'id', '12700000-0000-4000-8000-000000000011',
    'user_id', auth.uid(),
    'behavior_id', '12700000-0000-4000-8000-000000000011',
    'enabled', false, 'entries', '[]'::jsonb,
    'excluded_occurrence_ids', '[]'::jsonb,
    'revision', 1, 'updated_at', '2026-09-07T12:00:00Z'
  );
  begin
    perform public.commit_note_shortcut_state(context_value, next_value, false);
    raise exception 'Foreign Behavior state commit succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
declare
  accepted jsonb := jsonb_build_object('key', repeat('a',64), 'text', 'Edited shortcut', 'status', 'accepted', 'source', 'repeated_text', 'evidence', '[]'::jsonb, 'created_at', '2026-09-07T12:00:00Z', 'expires_at', null);
  dismissed jsonb;
begin
  select jsonb_agg(jsonb_build_object('key', lpad(to_hex(i),64,'0'), 'text', null, 'status', 'dismissed', 'source', 'repeated_text', 'evidence', '[]'::jsonb, 'created_at', '2026-09-07T12:00:00Z', 'expires_at', '2026-12-06T12:00:00Z')) into dismissed
    from generate_series(1,126) i;
  assert cadence_private.note_shortcut_entries_valid(dismissed || jsonb_build_array(accepted)),
    'Accepted shortcut must retain one reserved removal slot';
  assert not cadence_private.note_shortcut_entries_valid(dismissed || jsonb_build_array(accepted, jsonb_set(dismissed->0, '{key}', to_jsonb(repeat('b',64))))),
    'Accepted state used its reserved removal slot';
  assert cadence_private.note_shortcut_entries_valid(dismissed || jsonb_build_array(jsonb_set(dismissed->0, '{key}', to_jsonb(repeat('a',64))), jsonb_set(dismissed->0, '{key}', to_jsonb(repeat('b',64))))),
    'Removal must fit both suppression keys at the capacity boundary';
  assert not has_table_privilege('authenticated', 'public.note_shortcut_states', 'insert'),
    'Authenticated direct inserts must stay revoked';
  assert not has_table_privilege('authenticated', 'public.note_shortcut_states', 'update'),
    'Authenticated direct updates must stay revoked';
  assert not has_function_privilege('anon', 'public.read_note_shortcut_context(uuid)', 'execute'),
    'Anonymous context reads must be denied';
  assert not has_function_privilege('anon', 'public.commit_note_shortcut_state(jsonb,jsonb,boolean)', 'execute'),
    'Anonymous state commits must be denied';
  assert not has_function_privilege('anon', 'public.update_occurrence_note_with_shortcut(uuid,text,text,boolean)', 'execute'),
    'Anonymous shortcut Note saves must be denied';
end;
$$;

rollback;
\echo 'Ticket 127 Note shortcut SQL passed; fixtures rolled back.'
