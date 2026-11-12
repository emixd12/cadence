\set ON_ERROR_STOP on

-- A first Mac link for a large account (migration 20261112120000). The owner's account
-- held about 2,500 Occurrences and 2,400 reminder deliveries, and the hydrate apply hit
-- the authenticated role's 8s statement timeout. This fixture builds an account of that
-- size and checks that:
-- 1. the RPC entry point carries the read's 25s statement timeout, which PostgREST
--    applies to the request;
-- 2. a hydrate (no hosted writes) returns the compared snapshot and its receipt, for the
--    current contract and an older one;
-- 3. a plan with a hosted write still returns the snapshot rebuilt after the write.
-- Synthetic local fixtures only; all changes roll back.
begin;

do $$
begin
  if not exists (
    select 1 from pg_proc
    where oid = 'public.apply_account_sync_plan(jsonb)'::regprocedure
      and 'statement_timeout=25s' = any(proconfig)
  ) then
    raise exception 'public.apply_account_sync_plan has no 25s statement timeout';
  end if;
end $$;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('33000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'large-sync@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('33000000-0000-4000-8000-000000000001', 'large-sync@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('33010000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 'Walk', '{"type":"daily"}', '07:00', 'America/New_York');
insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status, status_marked_at)
select
  ('33020000-0000-4000-8000-' || lpad(day::text, 12, '0'))::uuid,
  '33000000-0000-4000-8000-000000000001',
  '33010000-0000-4000-8000-000000000001',
  ('2020-01-01'::date + day)::timestamp + interval '12 hours',
  '2020-01-01'::date + day,
  'exact', '07:00', 'unresolved', null
from generate_series(1, 2500) day;
insert into public.reminder_deliveries (user_id, occurrence_id, channel, scheduled_send_at, status)
select user_id, id, 'browser_push', scheduled_for - interval '15 minutes', 'pending'
from public.occurrences
where user_id = '33000000-0000-4000-8000-000000000001';

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
    'plan', plan.value, 'attemptedAt', '2026-11-12T12:00:00.000000Z'
  )
  from plan
$$;

set local role authenticated;
select pg_temp.act_as('33000000-0000-4000-8000-000000000001');

do $$
declare
  contract_value integer;
  snapshot_value jsonb;
  applied jsonb;
  key_value text;
  category_value jsonb;
begin
  -- 2. Hydrate: no hosted writes, the merge equals the hosted snapshot.
  foreach contract_value in array array[cadence_private.account_sync_current_contract(), 4] loop
    snapshot_value := public.read_account_sync_snapshot(contract_value);
    if jsonb_array_length(snapshot_value -> 'entities') < 5000 then
      raise exception 'The large fixture snapshot holds only % entities', jsonb_array_length(snapshot_value -> 'entities');
    end if;
    key_value := repeat(contract_value::text, 64);
    applied := public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value, '[]'::jsonb,
      snapshot_value -> 'entities', key_value, contract_value));
    if applied ->> 'status' <> 'applied'
      or applied ->> 'fingerprint' <> snapshot_value ->> 'fingerprint'
      or applied -> 'snapshot' <> snapshot_value then
      raise exception 'Contract % hydrate returned a different snapshot', contract_value;
    end if;
    if not exists (select 1 from public.account_sync_apply_receipts
        where idempotency_key = key_value and result_fingerprint = snapshot_value ->> 'fingerprint') then
      raise exception 'Contract % hydrate stored no receipt', contract_value;
    end if;
  end loop;

  -- 3. A hosted write: the result is rebuilt and carries the new row.
  snapshot_value := public.read_account_sync_snapshot(cadence_private.account_sync_current_contract());
  category_value := jsonb_build_object('kind', 'category', 'id', '33030000-0000-4000-8000-000000000001', 'value',
    jsonb_build_object('id', '33030000-0000-4000-8000-000000000001', 'name', 'Outdoors', 'description', null, 'sort_order', 99,
      'created_at', '2026-11-12T12:00:00.000000Z', 'updated_at', '2026-11-12T12:00:00.000000Z'));
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value,
    jsonb_build_array(jsonb_build_object('kind', 'category', 'id', category_value ->> 'id', 'operation', 'upsert',
      'expected', null, 'value', category_value -> 'value')),
    (snapshot_value -> 'entities') || jsonb_build_array(category_value), repeat('e', 64),
    cadence_private.account_sync_current_contract()));
  if applied ->> 'fingerprint' = snapshot_value ->> 'fingerprint'
    or not exists (select 1 from jsonb_array_elements(applied #> '{snapshot,entities}') entity
      where entity ->> 'kind' = 'category' and entity ->> 'id' = category_value ->> 'id') then
    raise exception 'A write plan returned the pre-write snapshot';
  end if;
end $$;

rollback;
