\set ON_ERROR_STOP on

-- Ticket 320: account sync contract 5 carries the connector completion records to
-- linked Macs, read-only (migration 20261111160000). Contracts 1-4 do not see them,
-- contract 5 sees only the Mac fields, and no contract can write them through
-- account sync. Synthetic local fixtures only; all changes roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('32000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'connector-sync@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('32000000-0000-4000-8000-000000000001', 'connector-sync@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('32010000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'Gym', '{"type":"daily"}', '18:00', 'America/New_York');
insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status, status_marked_at) values
  ('32020000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '32010000-0000-4000-8000-000000000001',
   '2026-11-09T23:00:00Z', '2026-11-09', 'exact', '18:00', 'unresolved', null);
insert into public.connector_connections (user_id, provider, account_digest, generation, status) values
  ('32000000-0000-4000-8000-000000000001', 'hevy', repeat('d', 64), 1, 'connected');
insert into public.behavior_source_links (id, user_id, behavior_id, source, selector_kind, selector_keys, account_digest, enabled) values
  ('32030000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '32010000-0000-4000-8000-000000000001',
   'hevy', 'provider_keys', array[repeat('a', 64)], repeat('d', 64), true);
insert into public.occurrence_source_matches (id, user_id, occurrence_id, behavior_id, link_id, source, activity_ref,
  activity_start_at, activity_end_at, scheduled_start_at, role, state) values
  ('32040000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '32020000-0000-4000-8000-000000000001',
   '32010000-0000-4000-8000-000000000001', '32030000-0000-4000-8000-000000000001', 'hevy', 'hevy/' || repeat('b', 64),
   '2026-11-09T22:05:00Z', '2026-11-09T22:50:00Z', '2026-11-09T23:00:00Z', 'attached', 'active');

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

set local role authenticated;
select pg_temp.act_as('32000000-0000-4000-8000-000000000001');

do $$
declare
  snapshot_value jsonb;
  link_value jsonb;
  match_value jsonb;
  contract_value integer;
  kind_value text;
begin
  if cadence_private.account_sync_current_contract() <> 5 then
    raise exception 'Expected account sync contract 5, got %', cadence_private.account_sync_current_contract();
  end if;

  -- Contracts 1-4 never receive either kind.
  for contract_value in 1..4 loop
    if exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(contract_value) -> 'entities') entity
        where entity ->> 'kind' in ('behavior_source_link', 'occurrence_source_match')) then
      raise exception 'Contract % snapshot carries connector completion records', contract_value;
    end if;
  end loop;

  -- Contract 5 receives each row with only the Mac fields.
  snapshot_value := public.read_account_sync_snapshot(5);
  select entity -> 'value' into link_value from jsonb_array_elements(snapshot_value -> 'entities') entity
    where entity ->> 'kind' = 'behavior_source_link';
  select entity -> 'value' into match_value from jsonb_array_elements(snapshot_value -> 'entities') entity
    where entity ->> 'kind' = 'occurrence_source_match';
  if link_value is null or match_value is null then raise exception 'Contract 5 snapshot misses connector records'; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(link_value) key)
      <> array['behavior_id', 'created_at', 'enabled', 'id', 'selector_kind', 'source', 'updated_at'] then
    raise exception 'Synced link fields are wrong: %', link_value;
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(match_value) key)
      <> array['activity_end_at', 'activity_start_at', 'behavior_id', 'created_at', 'id', 'occurrence_id', 'role', 'source', 'state', 'updated_at'] then
    raise exception 'Synced match fields are wrong: %', match_value;
  end if;
  if snapshot_value::text like '%' || repeat('a', 64) || '%' or snapshot_value::text like '%' || repeat('b', 64) || '%'
    or snapshot_value::text like '%' || repeat('d', 64) || '%' then
    raise exception 'A digest reached the account snapshot';
  end if;

  -- No contract writes either kind through account sync.
  foreach kind_value in array array['behavior_source_link', 'occurrence_source_match'] loop
    for contract_value in 4..5 loop
      snapshot_value := public.read_account_sync_snapshot(contract_value);
      begin
        perform public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value,
          jsonb_build_array(jsonb_build_object('kind', kind_value, 'id', '32050000-0000-4000-8000-000000000001',
            'operation', 'delete', 'expected', null)),
          snapshot_value -> 'entities', 'ticket-320-' || kind_value || '-' || contract_value, contract_value));
        raise exception 'Contract % wrote %', contract_value, kind_value;
      exception when sqlstate '22023' then null;
      end;
    end loop;
  end loop;
end $$;

-- Deleting the Occurrence cascades its match out of the snapshot, as the client plan expects.
reset role;
delete from public.occurrences where id = '32020000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.act_as('32000000-0000-4000-8000-000000000001');
do $$
begin
  if exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(5) -> 'entities') entity
      where entity ->> 'kind' = 'occurrence_source_match') then
    raise exception 'A match outlived its Occurrence';
  end if;
end $$;

rollback;
