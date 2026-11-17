\set ON_ERROR_STOP on

-- Advisor Phase 2A: per-day move schema (migrations 20261117100000 and 20261117105000).
--   1. Only the move functions write effective time; people, account sync and other
--      writers keep it.
--   2. Account sync contract 6 carries occurrence_move read-only with only the Mac
--      fields; the occurrence row never shows effective time, so a status mark from a
--      Mac merges with a web move.
--   3. A Behavior timezone change supersedes moves on unresolved Occurrences with a
--      'supersede' record and keeps a resolved Occurrence's moved time as history.
-- Synthetic local fixtures only; all changes roll back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data) values
  ('2a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'moves-schema@example.invalid', '{}', '{}');
insert into public.profiles (id, email, timezone) values
  ('2a000000-0000-4000-8000-000000000001', 'moves-schema@example.invalid', 'America/New_York')
on conflict (id) do update set timezone = excluded.timezone;
insert into public.behaviors (id, user_id, title, recurrence_rule, scheduled_time, timezone) values
  ('2a010000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', 'Gym', '{"type":"daily"}', '09:00', 'America/New_York');
insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status) values
  ('2a020000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', '2a010000-0000-4000-8000-000000000001',
   '2026-11-16T14:00:00Z', '2026-11-16', 'exact', '09:00', 'unresolved');

-- What a move function does: append the record and set effective time under the flag.
insert into public.occurrence_moves (id, user_id, occurrence_id, behavior_id, local_date, weekday, timezone, kind,
  from_start_at, from_end_at, from_planned, to_start_at, to_end_at, duration_source, chain_root_id, chain_position,
  source, client_ref, idempotency_key, proposal_id) values
  ('2a030000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-000000000001', '2a020000-0000-4000-8000-000000000001',
   '2a010000-0000-4000-8000-000000000001', '2026-11-16', 1, 'America/New_York', 'move',
   '2026-11-16T14:00:00Z', '2026-11-16T15:00:00Z', true, '2026-11-16T16:00:00Z', '2026-11-16T17:00:00Z', 'planned_length',
   '2a030000-0000-4000-8000-000000000001', 1, 'person', null, 'schema-key', null);

do $$ begin
  -- Without the move flag, effective time stays null on insert and unchanged on update.
  update public.occurrences set effective_start_at = '2026-11-16T16:00:00Z', effective_end_at = '2026-11-16T17:00:00Z'
    where id = '2a020000-0000-4000-8000-000000000001';
  if (select effective_start_at from public.occurrences where id = '2a020000-0000-4000-8000-000000000001') is not null then
    raise exception 'Effective time changed without the move flag';
  end if;
  perform set_config('cadence.occurrence_move_write', 'on', true);
  update public.occurrences set effective_start_at = '2026-11-16T16:00:00Z', effective_end_at = '2026-11-16T17:00:00Z'
    where id = '2a020000-0000-4000-8000-000000000001';
  perform set_config('cadence.occurrence_move_write', '', true);
  if (select effective_start_at from public.occurrences where id = '2a020000-0000-4000-8000-000000000001') <> '2026-11-16T16:00:00Z' then
    raise exception 'The move flag did not write effective time';
  end if;
end $$;

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
    'plan', plan.value, 'attemptedAt', '2026-11-16T15:00:00.000000Z'
  )
  from plan
$$;

set local role authenticated;
select pg_temp.act_as('2a000000-0000-4000-8000-000000000001');

do $$
declare
  snapshot_value jsonb;
  occurrence_value jsonb;
  move_value jsonb;
  marked jsonb;
  merged jsonb;
begin
  if cadence_private.account_sync_current_contract() < 6 then
    raise exception 'Expected account sync contract 6 or later';
  end if;

  -- People cannot write effective time or move records directly.
  begin
    update public.occurrences set effective_start_at = null, effective_end_at = null
      where id = '2a020000-0000-4000-8000-000000000001';
    raise exception 'A person wrote effective time directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.occurrence_moves (user_id, occurrence_id, behavior_id, local_date, weekday, timezone, kind,
      from_start_at, from_end_at, from_planned, to_start_at, to_end_at, duration_source, chain_root_id, chain_position, source)
    values ('2a000000-0000-4000-8000-000000000001', '2a020000-0000-4000-8000-000000000001', '2a010000-0000-4000-8000-000000000001',
      '2026-11-16', 1, 'America/New_York', 'move', now(), now(), true, now(), now(), 'explicit', gen_random_uuid(), 1, 'person');
    raise exception 'A person inserted a move record directly';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.occurrence_moves) <> 1 then raise exception 'The person cannot read their move'; end if;

  -- Contracts 1-5 never see moves; contract 6 sees only the Mac fields.
  if exists (select 1 from jsonb_array_elements(public.read_account_sync_snapshot(5) -> 'entities') entity
      where entity ->> 'kind' = 'occurrence_move') then
    raise exception 'Contract 5 carries moves';
  end if;
  snapshot_value := public.read_account_sync_snapshot(6);
  select entity -> 'value' into occurrence_value from jsonb_array_elements(snapshot_value -> 'entities') entity
    where entity ->> 'kind' = 'occurrence';
  select entity -> 'value' into move_value from jsonb_array_elements(snapshot_value -> 'entities') entity
    where entity ->> 'kind' = 'occurrence_move';
  if occurrence_value ? 'effective_start_at' or occurrence_value ? 'effective_end_at' then
    raise exception 'The synced occurrence carries effective time: %', occurrence_value;
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(move_value) key) <> array[
      'behavior_id', 'chain_position', 'chain_root_id', 'created_at', 'duration_source', 'from_end_at', 'from_planned',
      'from_start_at', 'id', 'kind', 'local_date', 'occurrence_id', 'reason', 'revises_move_id', 'source', 'timezone',
      'to_end_at', 'to_planned', 'to_start_at', 'weekday'] then
    raise exception 'Synced move fields are wrong: %', move_value;
  end if;

  -- No contract writes moves through account sync.
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value,
      jsonb_build_array(jsonb_build_object('kind', 'occurrence_move', 'id', '2a030000-0000-4000-8000-000000000001',
        'operation', 'delete', 'expected', null)),
      snapshot_value -> 'entities', repeat('a', 64), 6));
    raise exception 'Account sync wrote a move';
  exception when sqlstate '22023' then null;
  end;

  -- A Mac edits the moved Occurrence's row: the row write keeps the move's effective time.
  -- (A status mark also writes a status event; the merge itself is covered in
  -- tests/account-sync.resolver.test.ts.)
  marked := occurrence_value || jsonb_build_object('note', 'Went after lunch');
  select jsonb_agg(case when entity ->> 'kind' = 'occurrence' then jsonb_set(entity, '{value}', marked) else entity end)
    into merged from jsonb_array_elements(snapshot_value -> 'entities') entity;
  perform public.apply_account_sync_plan(pg_temp.sync_payload(snapshot_value,
    jsonb_build_array(jsonb_build_object('kind', 'occurrence', 'id', occurrence_value ->> 'id', 'operation', 'upsert',
      'expected', occurrence_value, 'value', marked)),
    merged, repeat('b', 64), 6));
  if (select note is distinct from 'Went after lunch' or effective_start_at <> '2026-11-16T16:00:00Z'
      from public.occurrences where id = '2a020000-0000-4000-8000-000000000001') then
    raise exception 'A synced row write lost the move or the edit';
  end if;
end $$;

-- A timezone change supersedes the Behavior's moves; the records stay.
reset role;
-- A resolved moved Occurrence of the same Behavior keeps its effective time.
insert into public.occurrences (id, user_id, behavior_id, scheduled_for, local_date, schedule_kind, schedule_start_time, status) values
  ('2a020000-0000-4000-8000-000000000002', '2a000000-0000-4000-8000-000000000001', '2a010000-0000-4000-8000-000000000001',
   '2026-11-15T14:00:00Z', '2026-11-15', 'exact', '09:00', 'completed');
insert into public.occurrence_moves (id, user_id, occurrence_id, behavior_id, local_date, weekday, timezone, kind,
  from_start_at, from_end_at, from_planned, to_start_at, to_end_at, duration_source, chain_root_id, chain_position, source) values
  ('2a030000-0000-4000-8000-000000000002', '2a000000-0000-4000-8000-000000000001', '2a020000-0000-4000-8000-000000000002',
   '2a010000-0000-4000-8000-000000000001', '2026-11-15', 7, 'America/New_York', 'move',
   '2026-11-15T14:00:00Z', '2026-11-15T15:00:00Z', true, '2026-11-15T18:00:00Z', '2026-11-15T19:00:00Z', 'planned_length',
   '2a030000-0000-4000-8000-000000000002', 1, 'person');
do $$ begin
  perform set_config('cadence.occurrence_move_write', 'on', true);
  update public.occurrences set effective_start_at = '2026-11-15T18:00:00Z', effective_end_at = '2026-11-15T19:00:00Z'
    where id = '2a020000-0000-4000-8000-000000000002';
  perform set_config('cadence.occurrence_move_write', '', true);
end $$;
update public.behaviors set timezone = 'Europe/London' where id = '2a010000-0000-4000-8000-000000000001';
do $$
declare superseding public.occurrence_moves;
begin
  if (select effective_start_at from public.occurrences where id = '2a020000-0000-4000-8000-000000000001') is not null then
    raise exception 'A timezone change kept the move';
  end if;
  if (select effective_start_at from public.occurrences where id = '2a020000-0000-4000-8000-000000000002') <> '2026-11-15T18:00:00Z' then
    raise exception 'A timezone change cleared a resolved Occurrence''s moved time';
  end if;
  select * into superseding from public.occurrence_moves where occurrence_id = '2a020000-0000-4000-8000-000000000001' and chain_position = 2;
  if superseding.kind is distinct from 'supersede' or not superseding.to_planned or superseding.source <> 'system'
    or superseding.revises_move_id <> '2a030000-0000-4000-8000-000000000001' or superseding.timezone <> 'Europe/London' then
    raise exception 'A timezone change did not record the supersede';
  end if;
  if (select count(*) from public.occurrence_moves) <> 3 then raise exception 'A timezone change wrote the wrong records'; end if;
end $$;

-- Changing back does not revive the move: the latest record is the supersede.
update public.behaviors set timezone = 'America/New_York' where id = '2a010000-0000-4000-8000-000000000001';
do $$ begin
  if (select effective_start_at from public.occurrences where id = '2a020000-0000-4000-8000-000000000001') is not null
    or (select count(*) from public.occurrence_moves) <> 3 then
    raise exception 'A timezone round trip revived or re-recorded the move';
  end if;
end $$;

-- Deleting the Occurrence keeps its move history.
delete from public.occurrences where id = '2a020000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from public.occurrence_moves) <> 3 then raise exception 'Deleting the Occurrence removed its moves'; end if;
end $$;

-- Agent scopes: the Daily Brief and chat may move; the coach stays read-only.
do $$ begin
  if not (select 'cadence.occurrences.move' = any(default_scopes) from cadence_oauth_private.agent_channels where channel = 'daily_brief')
    or not (select 'cadence.occurrences.move' = any(default_scopes) from cadence_oauth_private.agent_channels where channel = 'chat')
    or (select default_scopes from cadence_oauth_private.agent_channels where channel = 'coach') <> array['cadence.read'] then
    raise exception 'Agent move scopes are wrong';
  end if;
end $$;

rollback;
