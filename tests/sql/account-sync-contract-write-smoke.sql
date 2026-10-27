-- Local-only rollback fixture. Exercise old clients through the real RPC boundary,
-- including a synthetic later column so preserving writes are not profile-only.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
select ('15300000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'sync-contract-' || i || '@example.test',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from generate_series(1, 2) i;

create function pg_temp.contract_payload(snapshot jsonb, writes jsonb, merged_entities jsonb, key text, contract integer default null)
returns jsonb language sql immutable as $$
  with plan as (
    select jsonb_build_object('writes', writes, 'mergedFingerprint',
      cadence_private.account_sync_fingerprint(merged_entities), 'conflicts', '[]'::jsonb) value
  )
  select jsonb_build_object(
    'schemaVersion', 1, 'idempotencyKey', key,
    'baselineFingerprint', snapshot ->> 'fingerprint', 'localFingerprint', snapshot ->> 'fingerprint',
    'hostedFingerprint', snapshot ->> 'fingerprint',
    'planFingerprint', encode(extensions.digest(convert_to(cadence_private.canonical_account_sync_json(plan.value), 'UTF8'), 'sha256'), 'hex'),
    'plan', plan.value, 'attemptedAt', '2026-10-27T12:00:00.000000Z'
  ) || case when contract is null then '{}'::jsonb else jsonb_build_object('contract', contract) end
  from plan
$$;

set local role authenticated;
do $$
declare
  legacy jsonb;
  profile jsonb;
  changed_profile jsonb;
  merged_entities jsonb;
  request jsonb;
  applied jsonb;
  hidden_entities jsonb;
  retained_entities jsonb;
  invalid_contract integer;
begin
  perform set_config('request.jwt.claim.sub', '15300000-0000-4000-8000-000000000001', true);
  update public.travel_settings set preparation_minutes = 15, arrival_buffer_minutes = 10,
    habits_updated_at = '2026-10-27T11:00:00.000000Z';
  perform public.save_place_label_settings(true, '90_days', false, null, null);
  insert into public.place_markers (user_id, id, place_key, latitude_e6, longitude_e6,
    accuracy_meters, rule_version, recorded_at)
  values ('15300000-0000-4000-8000-000000000001', 'home', repeat('a', 43),
    41878100, -87629800, 20, 'place-label-rules@1', '2026-10-27T11:00:00.000000Z');
  select jsonb_agg(entity order by entity ->> 'kind', entity ->> 'id') into hidden_entities
    from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
    where entity ->> 'kind' in ('place_label_settings', 'place_marker');
  if jsonb_array_length(hidden_entities) <> 2 then
    raise exception 'The hidden-kind fixture is empty';
  end if;
  legacy := public.read_account_sync_snapshot();
  if legacy <> public.read_account_sync_snapshot(1) then
    raise exception 'The legacy RPC and explicit contract 1 disagree';
  end if;
  select entity -> 'value' into profile from jsonb_array_elements(legacy -> 'entities') entity
    where entity ->> 'kind' = 'profile';
  if (select array_agg(key order by key) from jsonb_object_keys(profile) key) <>
      array['base_location_text', 'navigation_preference', 'onboarding_completed_at', 'routing_consent_at',
        'timezone', 'travel_enabled', 'travel_mode', 'updated_at'] then
    raise exception 'The legacy profile differs from the published 0.1.5 shape';
  end if;
  if exists (select 1 from jsonb_array_elements(legacy -> 'entities') entity
      where entity ->> 'kind' in ('place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal')) then
    raise exception 'The legacy projection contains a newer entity kind';
  end if;
  foreach invalid_contract in array array[null::integer, 0, 3] loop
    begin
      perform public.read_account_sync_snapshot(invalid_contract);
      raise exception 'An invalid read contract was accepted: %', invalid_contract;
    exception when invalid_parameter_value then null;
    end;
  end loop;

  changed_profile := profile || '{"base_location_text":"Legacy client base"}'::jsonb;
  select jsonb_agg(case when entity ->> 'kind' = 'profile'
    then jsonb_set(entity, '{value}', changed_profile) else entity end) into merged_entities
    from jsonb_array_elements(legacy -> 'entities') entity;
  request := pg_temp.contract_payload(legacy, jsonb_build_array(jsonb_build_object(
    'kind', 'profile', 'id', 'profile', 'operation', 'upsert', 'expected', profile, 'value', changed_profile
  )), merged_entities, repeat('a', 64));

  begin
    perform public.apply_account_sync_plan(pg_temp.contract_payload(legacy, jsonb_build_array(jsonb_build_object(
      'kind', 'profile', 'id', 'profile', 'operation', 'upsert', 'expected', profile,
      'value', changed_profile || '{"travel_preparation_minutes":0}'::jsonb
    )), merged_entities, repeat('b', 64)));
    raise exception 'An old client wrote a field outside its contract';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_account_sync_plan(pg_temp.contract_payload(legacy, jsonb_build_array(jsonb_build_object(
      'kind', 'place_label_settings', 'id', 'place_labels', 'operation', 'delete', 'expected', null
    )), legacy -> 'entities', repeat('b', 64)));
    raise exception 'An old client deleted a kind outside its contract';
  exception when invalid_parameter_value then null;
  end;

  applied := public.apply_account_sync_plan(request);
  if applied #>> '{snapshot,fingerprint}' <> cadence_private.account_sync_fingerprint(merged_entities) then
    raise exception 'A legacy write returned the wrong projected fingerprint';
  end if;
  if (select preparation_minutes <> 15 or arrival_buffer_minutes <> 10
      from public.travel_settings) then
    raise exception 'A legacy write erased hidden habits';
  end if;

  -- A newer client may change only hidden fields between an old apply and retry.
  update public.travel_settings set preparation_minutes = 20,
    habits_updated_at = '2026-10-27T11:30:00.000000Z';
  if public.apply_account_sync_plan(request) ->> 'fingerprint' <> applied ->> 'fingerprint' then
    raise exception 'Hidden-only changes invalidated a projected receipt';
  end if;
  if (select preparation_minutes from public.travel_settings) <> 20 then
    raise exception 'A legacy receipt replay restored stale hidden data';
  end if;
  select jsonb_agg(entity order by entity ->> 'kind', entity ->> 'id') into retained_entities
    from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
    where entity ->> 'kind' in ('place_label_settings', 'place_marker');
  if retained_entities is distinct from hidden_entities then
    raise exception 'A legacy write or receipt replay changed hidden place-label data';
  end if;

  perform set_config('request.jwt.claim.sub', '15300000-0000-4000-8000-000000000002', true);
  if exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(2) -> 'entities') entity
      where entity #>> '{value,travel_preparation_minutes}' = '20') then
    raise exception 'Contract projection exposed another account';
  end if;
end;
$$;
reset role;

-- Contract 3 exists only inside this rolled-back test transaction. A prior build
-- must be able to insert, edit and delete a Category without seeing its new field.
alter table public.categories add column contract_probe text not null default 'new-row default';
insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values (3, 'category', 'contract_probe', '"new-row default"');

set local role authenticated;
do $$
declare
  before_snapshot jsonb;
  category jsonb;
  updated_category jsonb;
  merged_entities jsonb;
  inserted_category jsonb := '{"id":"15300000-0000-4000-8000-000000000003","name":"Legacy inserted category","description":null,"sort_order":99,"created_at":"2026-10-27T12:00:00.000000Z","updated_at":"2026-10-27T12:00:00.000000Z"}';
  inserted_entity jsonb;
  request jsonb;
begin
  perform set_config('request.jwt.claim.sub', '15300000-0000-4000-8000-000000000001', true);
  before_snapshot := public.read_account_sync_snapshot(2);
  inserted_entity := jsonb_build_object('kind', 'category', 'id', inserted_category ->> 'id', 'value', inserted_category);
  merged_entities := (before_snapshot -> 'entities') || jsonb_build_array(inserted_entity);
  perform public.apply_account_sync_plan(pg_temp.contract_payload(before_snapshot, jsonb_build_array(jsonb_build_object(
    'kind', 'category', 'id', inserted_category ->> 'id', 'operation', 'upsert', 'expected', null, 'value', inserted_category
  )), merged_entities, repeat('c', 64), 2));
  if (select contract_probe from public.categories where id = (inserted_category ->> 'id')::uuid) <> 'new-row default' then
    raise exception 'An old insert omitted the registered default';
  end if;

  before_snapshot := public.read_account_sync_snapshot(2);
  -- A hidden-only edit can still advance updated_at. Keep the existing row CAS:
  -- reject the stale revision, then retain the hidden value after replanning.
  update public.categories set contract_probe = 'newer-client value' where id = (inserted_category ->> 'id')::uuid;
  select entity into category from jsonb_array_elements(before_snapshot -> 'entities') entity
    where entity ->> 'id' = inserted_category ->> 'id';
  updated_category := jsonb_set(category, '{value,name}', '"Legacy renamed category"');
  select jsonb_agg(case when entity ->> 'id' = category ->> 'id' then updated_category else entity end)
    into merged_entities from jsonb_array_elements(before_snapshot -> 'entities') entity;
  request := pg_temp.contract_payload(before_snapshot, jsonb_build_array(jsonb_build_object(
    'kind', 'category', 'id', category ->> 'id', 'operation', 'upsert', 'expected', category -> 'value', 'value', updated_category -> 'value'
  )), merged_entities, repeat('d', 64), 2);
  begin
    perform public.apply_account_sync_plan(request);
    raise exception 'An old update ignored a concurrent row revision';
  exception when raise_exception then
    if sqlerrm <> 'The hosted row changed during synchronization.' then raise; end if;
  end;
  before_snapshot := public.read_account_sync_snapshot(2);
  select entity into category from jsonb_array_elements(before_snapshot -> 'entities') entity
    where entity ->> 'id' = inserted_category ->> 'id';
  updated_category := jsonb_set(category, '{value,name}', '"Legacy renamed category"');
  select jsonb_agg(case when entity ->> 'id' = category ->> 'id' then updated_category else entity end)
    into merged_entities from jsonb_array_elements(before_snapshot -> 'entities') entity;
  perform public.apply_account_sync_plan(pg_temp.contract_payload(before_snapshot, jsonb_build_array(jsonb_build_object(
    'kind', 'category', 'id', category ->> 'id', 'operation', 'upsert', 'expected', category -> 'value', 'value', updated_category -> 'value'
  )), merged_entities, repeat('d', 64), 2));
  if (select contract_probe from public.categories where id = (category ->> 'id')::uuid) <> 'newer-client value' then
    raise exception 'An old update erased a concurrent hidden-only change';
  end if;

  before_snapshot := public.read_account_sync_snapshot(2);
  select entity into category from jsonb_array_elements(before_snapshot -> 'entities') entity
    where entity ->> 'id' = inserted_category ->> 'id';
  select jsonb_agg(entity) into merged_entities from jsonb_array_elements(before_snapshot -> 'entities') entity
    where entity ->> 'id' <> category ->> 'id';
  perform public.apply_account_sync_plan(pg_temp.contract_payload(before_snapshot, jsonb_build_array(jsonb_build_object(
    'kind', 'category', 'id', category ->> 'id', 'operation', 'delete', 'expected', category -> 'value'
  )), merged_entities, repeat('e', 64), 2));
  if exists (select 1 from public.categories where id = (category ->> 'id')::uuid) then
    raise exception 'An old client could not delete a row with a newer hidden column';
  end if;
end;
$$;
reset role;

rollback;
