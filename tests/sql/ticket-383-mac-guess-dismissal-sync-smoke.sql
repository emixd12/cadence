-- Local-only: psql "postgresql://postgres:postgres@127.0.0.1:<db-port>/postgres" -X -v ON_ERROR_STOP=1 -f tests/sql/ticket-383-mac-guess-dismissal-sync-smoke.sql
-- Ticket 383 (D37), Cadence for Mac: migration 20261126250000 (account sync contract 11).
-- A guess dismissal stored while Completion places is off:
--   - contract 11 reads it and may write or delete it;
--   - contracts 8, 9 and 10 never see it, their unrelated writes keep it, and their plan
--     that turns labels on applies and reveals it on the next read;
--   - an older contract's own dismissal for the same Behavior replaces it;
--   - a guess dismissal while labels are on, and a saved-place dismissal, stay visible to
--     every contract.
-- Everything rolls back.
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('38310000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'guess-sync@example.invalid', '{}', '{}');

create function pg_temp.create_behavior(title text)
returns uuid
language plpgsql
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  graph jsonb := jsonb_build_array(jsonb_build_object(
    'id', null, 'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
    'time_entries', jsonb_build_array(jsonb_build_object('id', null, 'kind', 'exact', 'preset', null,
      'start_time', '09:00:00', 'end_time', null, 'sort_order', 0))));
  snapshot jsonb := jsonb_build_object('category_id', null, 'location_text', null, 'where_kind', null,
    'schedule_graph', graph #- '{0,id}' #- '{0,time_entries,0,id}', 'browser_reminder_enabled', true,
    'email_reminder_enabled', false, 'reminder_offset_minutes', 0, 'active', true, 'timezone', 'America/New_York');
begin
  return (public.create_behavior_with_schedule_graph(
    jsonb_build_object('category_id', null, 'title', title, 'description', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1),
      'scheduled_time', '09:00:00', 'timezone', 'America/New_York', 'browser_reminder_enabled', true,
      'email_reminder_enabled', false, 'reminder_offset_minutes', 0, 'active', true, 'archived_at', null,
      'archive_notes', '[]'::jsonb, 'default_duration_minutes', null, 'end_date', null,
      'auto_archived_at', null, 'location_text', null, 'where_kind', null, 'created_at', recorded_at),
    jsonb_build_object('previous_title', null, 'next_title', title, 'previous_description', null,
      'next_description', null, 'changed_fields', jsonb_build_array('title'),
      'recorded_at', recorded_at, 'source', 'manual', 'reason', null),
    jsonb_build_object('event_kind', 'baseline', 'previous_configuration', null, 'next_configuration', snapshot,
      'changed_fields', '["category_id","location_text","where_kind","schedule_graph","browser_reminder_enabled","email_reminder_enabled","reminder_offset_minutes","active","timezone"]'::jsonb,
      'recorded_at', recorded_at, 'effective_at', recorded_at,
      'effective_local_date', (recorded_at at time zone 'America/New_York')::date,
      'timezone', 'America/New_York', 'source', 'manual', 'reason_code', 'behavior_created'),
    graph) ->> 'id')::uuid;
end;
$$;

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
    'plan', plan.value, 'attemptedAt', '2026-11-26T12:00:00.000000Z'
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

create table pg_temp.ids (name text primary key, id uuid not null);
grant select, insert on pg_temp.ids to authenticated;
grant execute on function pg_temp.sync_payload(integer, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function pg_temp.merged(jsonb, jsonb) to authenticated;
grant execute on function pg_temp.entity(jsonb, text, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"38310000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into pg_temp.ids values
  ('vitamins', pg_temp.create_behavior('Take vitamins')),
  ('stretch', pg_temp.create_behavior('Stretch'));

-- Labels off (no settings row): the web dismisses the guessed Where of 'vitamins'.
insert into public.where_suggestion_dismissals (id, user_id, suggestion, rule_version, dismissed_at)
select id, '38310000-0000-4000-8000-000000000001', 'home', 'where-suggestion-rules@1', '2026-11-26T11:00:00Z'
from pg_temp.ids where name = 'vitamins';

do $$
declare
  vitamins text := (select id::text from pg_temp.ids where name = 'vitamins');
  stretch text := (select id::text from pg_temp.ids where name = 'stretch');
  legacy integer;
  snapshot jsonb;
  settings jsonb;
  dismissal jsonb;
  applied jsonb;
begin
  if cadence_private.account_sync_current_contract() < 11 then
    raise exception 'Expected account sync contract 11 or later, found %.', cadence_private.account_sync_current_contract();
  end if;

  -- Contract 11 sees the row; contracts 8 to 10 do not, and their fingerprints agree with
  -- what they see.
  if pg_temp.entity(public.read_account_sync_snapshot(11), 'where_suggestion_dismissal', vitamins) ->> 'suggestion' is distinct from 'home' then
    raise exception 'Contract 11 does not read a guess dismissal stored while labels are off.';
  end if;
  foreach legacy in array array[8, 9, 10] loop
    snapshot := public.read_account_sync_snapshot(legacy);
    if pg_temp.entity(snapshot, 'where_suggestion_dismissal', vitamins) is not null then
      raise exception 'Contract % reads a guess dismissal stored while labels are off.', legacy;
    end if;
    if snapshot ->> 'fingerprint' <> cadence_private.account_sync_fingerprint(snapshot -> 'entities') then
      raise exception 'Contract % fingerprint covers a hidden row.', legacy;
    end if;
  end loop;

  -- A contract-9 write that keeps labels off (Cadence for Mac 0.1.15 to 0.1.17 dismissing
  -- the marker prompt) applies and keeps the hidden row.
  snapshot := public.read_account_sync_snapshot(9);
  settings := cadence_private.normalize_account_sync_row(jsonb_build_object('id', 'place_labels', 'enabled', false,
    'retention', '90_days', 'enabled_at', null, 'marker_prompt_dismissed_at', '2026-11-26T11:30:00Z', 'updated_at', '2026-11-26T11:30:00Z'));
  perform public.apply_account_sync_plan(pg_temp.sync_payload(9, snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'place_label_settings', 'id', 'place_labels', 'operation', 'upsert', 'expected', null, 'value', settings)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'place_label_settings', 'id', 'place_labels', 'value', settings))),
    repeat('1', 64)));
  if not exists (select 1 from public.where_suggestion_dismissals where id = vitamins::uuid) then
    raise exception 'A contract-9 write deleted the hidden guess dismissal.';
  end if;

  -- A contract-10 empty plan (an ordinary sync with nothing to send) applies.
  snapshot := public.read_account_sync_snapshot(10);
  perform public.apply_account_sync_plan(pg_temp.sync_payload(10, snapshot, '[]'::jsonb, snapshot -> 'entities', repeat('2', 64)));

  -- A contract-8 plan that turns labels on applies; its result leaves the row out, and the
  -- next read shows it because labels are now on.
  snapshot := public.read_account_sync_snapshot(8);
  dismissal := pg_temp.entity(snapshot, 'place_label_settings', 'place_labels');
  settings := dismissal || cadence_private.normalize_account_sync_row(jsonb_build_object('enabled', true,
    'enabled_at', '2026-11-26T11:45:00Z', 'updated_at', '2026-11-26T11:45:00Z'));
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(8, snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'place_label_settings', 'id', 'place_labels', 'operation', 'upsert', 'expected', dismissal, 'value', settings)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'place_label_settings', 'id', 'place_labels', 'value', settings))),
    repeat('3', 64)));
  if pg_temp.entity(applied -> 'snapshot', 'where_suggestion_dismissal', vitamins) is not null then
    raise exception 'The contract-8 result shows a row its plan could not see.';
  end if;
  if pg_temp.entity(public.read_account_sync_snapshot(8), 'where_suggestion_dismissal', vitamins) ->> 'suggestion' is distinct from 'home' then
    raise exception 'With labels on, contract 8 does not read the guess dismissal.';
  end if;

  -- Turning labels off still deletes every dismissal (the web's Settings switch).
  perform public.save_place_label_settings(false, '90_days', true,
    (select updated_at from public.place_label_settings), null);
  if exists (select 1 from public.where_suggestion_dismissals) then
    raise exception 'Turning labels off kept a dismissal.';
  end if;

  -- Contract 11 writes a guess dismissal while labels are off, then deletes it.
  snapshot := public.read_account_sync_snapshot(11);
  dismissal := cadence_private.normalize_account_sync_row(jsonb_build_object('id', stretch, 'suggestion', 'anywhere',
    'rule_version', 'where-suggestion-rules@1', 'dismissed_at', '2026-11-26T12:00:00Z'));
  applied := public.apply_account_sync_plan(pg_temp.sync_payload(11, snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'where_suggestion_dismissal', 'id', stretch, 'operation', 'upsert', 'expected', null, 'value', dismissal)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'where_suggestion_dismissal', 'id', stretch, 'value', dismissal))),
    repeat('4', 64)));
  if (select suggestion from public.where_suggestion_dismissals where id = stretch::uuid) is distinct from 'anywhere' then
    raise exception 'A contract-11 guess dismissal while labels are off did not apply.';
  end if;
  if pg_temp.entity(public.read_account_sync_snapshot(10), 'where_suggestion_dismissal', stretch) is not null then
    raise exception 'Contract 10 reads the contract-11 guess dismissal.';
  end if;
  snapshot := public.read_account_sync_snapshot(11);
  dismissal := pg_temp.entity(snapshot, 'where_suggestion_dismissal', stretch);
  perform public.apply_account_sync_plan(pg_temp.sync_payload(11, snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'where_suggestion_dismissal', 'id', stretch, 'operation', 'delete', 'expected', dismissal)),
    pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'where_suggestion_dismissal', 'id', stretch, 'value', null))),
    repeat('5', 64)));
  if exists (select 1 from public.where_suggestion_dismissals where id = stretch::uuid) then
    raise exception 'A contract-11 delete of a guess dismissal did not apply.';
  end if;

  -- Contract 11 cannot store a saved-place dismissal while labels are off.
  snapshot := public.read_account_sync_snapshot(11);
  dismissal := cadence_private.normalize_account_sync_row(jsonb_build_object('id', stretch, 'suggestion', 'saved_place:' || repeat('a', 43),
    'rule_version', 'where-suggestion-rules@1', 'dismissed_at', '2026-11-26T12:05:00Z'));
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(11, snapshot, jsonb_build_array(jsonb_build_object(
        'kind', 'where_suggestion_dismissal', 'id', stretch, 'operation', 'upsert', 'expected', null, 'value', dismissal)),
      pg_temp.merged(snapshot, jsonb_build_array(jsonb_build_object('kind', 'where_suggestion_dismissal', 'id', stretch, 'value', dismissal))),
      repeat('6', 64)));
    raise exception 'A saved-place dismissal was synced while labels were off.';
  exception when raise_exception then
    if sqlerrm <> 'Completion place labels are off.' then raise; end if;
  end;

  -- An older Mac that turned labels on offline and dismissed a suggestion on the same
  -- Behavior: its dismissal replaces the hidden one instead of failing every sync.
  insert into public.where_suggestion_dismissals (id, user_id, suggestion, rule_version, dismissed_at)
  values (vitamins::uuid, '38310000-0000-4000-8000-000000000001', 'home', 'where-suggestion-rules@1', '2026-11-26T12:10:00Z');
  snapshot := public.read_account_sync_snapshot(9);
  if pg_temp.entity(snapshot, 'where_suggestion_dismissal', vitamins) is not null then
    raise exception 'Contract 9 reads the second hidden guess dismissal.';
  end if;
  dismissal := pg_temp.entity(snapshot, 'place_label_settings', 'place_labels');
  settings := dismissal || cadence_private.normalize_account_sync_row(jsonb_build_object('enabled', true,
    'enabled_at', '2026-11-26T12:15:00Z', 'updated_at', '2026-11-26T12:15:00Z'));
  applied := cadence_private.normalize_account_sync_row(jsonb_build_object('id', vitamins, 'suggestion', 'saved_place:' || repeat('b', 43),
    'rule_version', 'where-suggestion-rules@1', 'dismissed_at', '2026-11-26T12:16:00Z'));
  perform public.apply_account_sync_plan(pg_temp.sync_payload(9, snapshot, jsonb_build_array(
      jsonb_build_object('kind', 'place_label_settings', 'id', 'place_labels', 'operation', 'upsert', 'expected', dismissal, 'value', settings),
      jsonb_build_object('kind', 'where_suggestion_dismissal', 'id', vitamins, 'operation', 'upsert', 'expected', null, 'value', applied)),
    pg_temp.merged(snapshot, jsonb_build_array(
      jsonb_build_object('kind', 'place_label_settings', 'id', 'place_labels', 'value', settings),
      jsonb_build_object('kind', 'where_suggestion_dismissal', 'id', vitamins, 'value', applied))),
    repeat('7', 64)));
  if (select suggestion from public.where_suggestion_dismissals where id = vitamins::uuid) is distinct from 'saved_place:' || repeat('b', 43) then
    raise exception 'The contract-9 dismissal did not replace the hidden one.';
  end if;

  -- With labels on, every contract sees a guess dismissal.
  if pg_temp.entity(public.read_account_sync_snapshot(9), 'where_suggestion_dismissal', vitamins) is null then
    raise exception 'Contract 9 does not read a dismissal while labels are on.';
  end if;
end;
$$;

reset role;
rollback;
