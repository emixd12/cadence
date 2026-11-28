-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:<db-port>/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-374-period-sync-smoke.sql
-- Ticket 374 (D35), Cadence for Mac: migration 20261128120000 (account sync contract 12).
-- Periods in account sync:
--   - contract 12 reads Periods and may insert, edit and delete them;
--   - contracts 8 to 11 never see them, cannot write the kind, and their other writes
--     keep hosted Periods;
--   - at the cap of 500, contract 12 still edits a Period it holds, cannot add one, and
--     can remove one and add another in the same plan;
--   - a Period id owned by another account is refused.
-- Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('37410000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'period-sync@example.invalid', '{}', '{}'),
  ('37410000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'period-sync-other@example.invalid', '{}', '{}');

create function pg_temp.sync_payload(contract integer, snapshot jsonb, writes jsonb, merged_entities jsonb, key text)
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
    'plan', plan.value, 'attemptedAt', '2026-11-28T12:00:00.000000Z'
  )
  from plan
$$;

-- The snapshot's entities with each listed change applied: a value replaces or appends, a
-- null value removes.
create function pg_temp.merged(snapshot jsonb, changes jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(entity order by entity ->> 'kind' collate "C", entity ->> 'id' collate "C"), '[]'::jsonb) from (
    select coalesce((select change from jsonb_array_elements(changes) change
      where change ->> 'kind' = original ->> 'kind' and change ->> 'id' = original ->> 'id'), original) entity
    from jsonb_array_elements(snapshot -> 'entities') original
    union all
    select change from jsonb_array_elements(changes) change
    where not exists (select 1 from jsonb_array_elements(snapshot -> 'entities') original
      where change ->> 'kind' = original ->> 'kind' and change ->> 'id' = original ->> 'id')
  ) rows
  where entity -> 'value' <> 'null'::jsonb
$$;

-- One entity's value in a snapshot, or null.
create function pg_temp.entity(snapshot jsonb, kind text, id text)
returns jsonb language sql immutable as $$
  select entity -> 'value' from jsonb_array_elements(snapshot -> 'entities') entity
  where entity ->> 'kind' = kind and entity ->> 'id' = id
$$;

create function pg_temp.period_value(id text, label text, revision integer)
returns jsonb language sql immutable as $$
  select cadence_private.normalize_account_sync_row(jsonb_build_object('id', id, 'label', label,
    'start_on', '2026-11-03', 'end_on', '2026-11-09', 'note', null, 'revision', revision,
    'created_at', '2026-11-28T11:00:00Z', 'updated_at', '2026-11-28T11:00:00Z'))
$$;

create table pg_temp.ids (name text primary key, id uuid not null);
grant select, insert on pg_temp.ids to authenticated;
grant execute on function pg_temp.sync_payload(integer, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function pg_temp.merged(jsonb, jsonb) to authenticated;
grant execute on function pg_temp.entity(jsonb, text, text) to authenticated;
grant execute on function pg_temp.period_value(text, text, integer) to authenticated;

-- Another account's Period, for the ownership check.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"37410000-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into pg_temp.ids select 'other', (public.create_period('Away', '2026-11-01', null, null)).id;

select set_config('request.jwt.claims', '{"sub":"37410000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into pg_temp.ids select 'web', (public.create_period('Sick', '2026-11-03', '2026-11-09', 'Flu')).id;

do $$
declare
  web text := (select id::text from pg_temp.ids where name = 'web');
  other text := (select id::text from pg_temp.ids where name = 'other');
  mac text := '37410000-0000-4000-8000-0000000000aa';
  category text := '37410000-0000-4000-8000-0000000000cc';
  legacy integer;
  snapshot jsonb;
  stored jsonb;
  value jsonb;
  applied jsonb;
begin
  if cadence_private.account_sync_current_contract() <> 12 then
    raise exception 'Expected account sync contract 12, found %.', cadence_private.account_sync_current_contract();
  end if;
  if cadence_private.account_sync_min_writer_contract() <> 8 then
    raise exception 'The minimum writer contract moved.';
  end if;

  -- Contract 12 reads the Period without its owner column; older contracts do not see it,
  -- and their fingerprints agree with what they see.
  snapshot := public.read_account_sync_snapshot(12);
  stored := pg_temp.entity(snapshot, 'period', web);
  if stored ->> 'label' is distinct from 'Sick' or stored ->> 'note' is distinct from 'Flu'
    or stored ->> 'start_on' is distinct from '2026-11-03' or stored ->> 'end_on' is distinct from '2026-11-09'
    or (stored ->> 'revision')::integer <> 1 or stored ? 'user_id'
    or (select count(*) from jsonb_object_keys(stored)) <> 8
  then
    raise exception 'Contract 12 does not read the Period row as expected.';
  end if;
  if pg_temp.entity(snapshot, 'period', other) is not null then
    raise exception 'Contract 12 reads another account''s Period.';
  end if;
  foreach legacy in array array[8, 9, 10, 11] loop
    snapshot := public.read_account_sync_snapshot(legacy);
    if exists (select 1 from jsonb_array_elements(snapshot -> 'entities') entity where entity ->> 'kind' = 'period') then
      raise exception 'Contract % reads a Period.', legacy;
    end if;
    if snapshot ->> 'fingerprint' <> cadence_private.account_sync_fingerprint(snapshot -> 'entities') then
      raise exception 'Contract % fingerprint covers a hidden kind.', legacy;
    end if;
  end loop;

  -- An older contract cannot write the kind.
  snapshot := public.read_account_sync_snapshot(11);
  value := pg_temp.period_value(mac, 'Trip', 1);
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(11, snapshot,
      jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'operation', 'upsert', 'expected', null, 'value', value)),
      pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'value', value))),
      repeat('a', 64)));
    raise exception 'Contract 11 wrote a Period.';
  exception when sqlstate '22023' then null;
  end;

  -- An older contract's unrelated write applies and keeps the hosted Period.
  value := cadence_private.normalize_account_sync_row(jsonb_build_object('id', category, 'name', 'Health',
    'description', null, 'sort_order', 0, 'created_at', '2026-11-28T11:00:00Z', 'updated_at', '2026-11-28T11:00:00Z'));
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(11, snapshot,
    jsonb_build_array(jsonb_build_object('kind', 'category', 'id', category, 'operation', 'upsert', 'expected', null, 'value', value)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'category', 'id', category, 'value', value))),
    repeat('b', 64)));
  if exists (select 1 from jsonb_array_elements(applied #> '{snapshot,entities}') entity where entity ->> 'kind' = 'period') then
    raise exception 'A contract-11 apply result shows a Period.';
  end if;
  if (select count(*) from public.periods) <> 1 then
    raise exception 'A contract-11 write changed the hosted Periods.';
  end if;

  -- Contract 12 inserts a Period made on the Mac, with the Mac's id.
  snapshot := public.read_account_sync_snapshot(12);
  value := pg_temp.period_value(mac, 'Trip', 1);
  perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
    jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'operation', 'upsert', 'expected', null, 'value', value)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'value', value))),
    repeat('c', 64)));
  if (select label from public.periods where id = mac::uuid) is distinct from 'Trip' then
    raise exception 'Contract 12 did not insert the Period.';
  end if;

  -- It edits that Period with a compare-and-set on the whole row, and a stale expected row fails.
  snapshot := public.read_account_sync_snapshot(12);
  stored := pg_temp.entity(snapshot, 'period', mac);
  value := stored || jsonb_build_object('label', 'Travel', 'revision', 2);
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
      jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'operation', 'upsert',
        'expected', stored || jsonb_build_object('label', 'Other'), 'value', value)),
      pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'value', value))),
      repeat('d', 64)));
    raise exception 'A stale Period write applied.';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
    jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'operation', 'upsert', 'expected', stored, 'value', value)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'value', value))),
    repeat('e', 64)));
  if (select label || ':' || revision from public.periods where id = mac::uuid) is distinct from 'Travel:2' then
    raise exception 'Contract 12 did not edit the Period.';
  end if;

  -- A row that breaks a table rule is refused by the table.
  snapshot := public.read_account_sync_snapshot(12);
  stored := pg_temp.entity(snapshot, 'period', mac);
  value := stored || jsonb_build_object('end_on', '2026-11-01', 'revision', 3);
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
      jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'operation', 'upsert', 'expected', stored, 'value', value)),
      pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'value', value))),
      repeat('f', 64)));
    raise exception 'An invalid Period range applied.';
  exception when check_violation then null;
  end;

  -- Another account's Period id is refused.
  value := pg_temp.period_value(other, 'Mine now', 1);
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
      jsonb_build_array(jsonb_build_object('kind', 'period', 'id', other, 'operation', 'upsert', 'expected', null, 'value', value)),
      pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', other, 'value', value))),
      repeat('1', 64)));
    raise exception 'Another account''s Period id was accepted.';
  exception when sqlstate '42501' then null;
  end;

  -- Contract 12 deletes the web Period.
  stored := pg_temp.entity(snapshot, 'period', web);
  perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
    jsonb_build_array(jsonb_build_object('kind', 'period', 'id', web, 'operation', 'delete', 'expected', stored)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', web, 'value', null))),
    repeat('2', 64)));
  if exists (select 1 from public.periods where id = web::uuid) then
    raise exception 'Contract 12 did not delete the Period.';
  end if;
end
$$;

-- The cap. Fill the account to 500 Periods as the table owner; the trigger still counts.
reset role;
insert into public.periods (user_id, label, start_on)
select '37410000-0000-4000-8000-000000000001', 'P' || n, '2026-01-01' from generate_series(1, 499) n;
do $$
begin
  if (select count(*) from public.periods where user_id = '37410000-0000-4000-8000-000000000001') <> 500 then
    raise exception 'The account does not hold 500 Periods.';
  end if;
  begin
    insert into public.periods (user_id, label, start_on) values ('37410000-0000-4000-8000-000000000001', 'One more', '2026-01-01');
    raise exception 'A direct insert passed the cap.';
  exception when sqlstate '54000' then null;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"37410000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  mac text := '37410000-0000-4000-8000-0000000000aa';
  extra text := '37410000-0000-4000-8000-0000000000bb';
  snapshot jsonb := public.read_account_sync_snapshot(12);
  stored jsonb;
  value jsonb;
begin
  -- An edit of a Period the account holds applies at the cap.
  stored := pg_temp.entity(snapshot, 'period', mac);
  value := stored || jsonb_build_object('note', 'Back on the 9th', 'revision', 3);
  perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
    jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'operation', 'upsert', 'expected', stored, 'value', value)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', mac, 'value', value))),
    repeat('3', 64)));
  if (select revision from public.periods where id = mac::uuid) <> 3 then
    raise exception 'An edit at the cap did not apply.';
  end if;

  -- A new Period does not fit, and the user function still refuses one too.
  snapshot := public.read_account_sync_snapshot(12);
  value := pg_temp.period_value(extra, 'Extra', 1);
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
      jsonb_build_array(jsonb_build_object('kind', 'period', 'id', extra, 'operation', 'upsert', 'expected', null, 'value', value)),
      pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'period', 'id', extra, 'value', value))),
      repeat('4', 64)));
    raise exception 'Account sync passed the cap of 500 Periods.';
  exception when sqlstate '54000' then null;
  end;
  -- A plan that removes one Period and adds another applies at the cap.
  stored := pg_temp.entity(snapshot, 'period', mac);
  perform public.apply_account_sync_plan(pg_temp.sync_payload(12, snapshot,
    jsonb_build_array(
      jsonb_build_object('kind', 'period', 'id', mac, 'operation', 'delete', 'expected', stored),
      jsonb_build_object('kind', 'period', 'id', extra, 'operation', 'upsert', 'expected', null, 'value', value)),
    pg_temp.merged(snapshot, jsonb_build_array(
      jsonb_build_object('kind', 'period', 'id', mac, 'value', null),
      jsonb_build_object('kind', 'period', 'id', extra, 'value', value))),
    repeat('5', 64)));
  if exists (select 1 from public.periods where id = mac::uuid)
    or not exists (select 1 from public.periods where id = extra::uuid)
    or (select count(*) from public.periods where user_id = '37410000-0000-4000-8000-000000000001') <> 500
  then
    raise exception 'A removal and an addition in one plan did not apply at the cap.';
  end if;
  begin
    perform public.create_period('Extra', '2026-11-03', null, null);
    raise exception 'create_period passed the cap of 500 Periods.';
  exception when sqlstate '54000' then null;
  end;
end
$$;

rollback;
