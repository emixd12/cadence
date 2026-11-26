-- Alongside setting (migrations 20261125140000, Ticket 356, and 20261126220000, Ticket 363).
-- Local-only rollback fixture. Covers: create with and without the answer, update with,
-- without and clearing it, the answer as a configuration revision with the changed field
-- 'alongside', a plan without the key keeping the stored answer, RLS isolation, and
-- account sync: contract 10 carries the answer, a contract-9 write keeps it, a contract-10
-- write changes it with its history and a contract-10 write without it is refused.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('35600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'alongside-a@example.invalid', '{}', '{}'),
  ('35600000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'alongside-b@example.invalid', '{}', '{}');

create function pg_temp.configuration(offset_minutes integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', null, 'location_text', null, 'where_kind', null, 'schedule_graph', '[]'::jsonb,
    'browser_reminder_enabled', true, 'email_reminder_enabled', false, 'reminder_offset_minutes', offset_minutes,
    'active', true, 'timezone', 'America/New_York', 'end', null, 'pause', null, 'is_opportunity', true);
$$;

create function pg_temp.plan(kind text, previous jsonb, next jsonb, fields text[], reason text)
returns jsonb
language sql
as $$
  select jsonb_build_object('event_kind', kind, 'previous_configuration', previous, 'next_configuration', next,
    'changed_fields', to_jsonb(fields), 'recorded_at', clock_timestamp(), 'effective_at', clock_timestamp(),
    'effective_local_date', (clock_timestamp() at time zone 'America/New_York')::date,
    'timezone', 'America/New_York', 'source', 'manual', 'reason_code', reason);
$$;

-- An unscheduled opportunity Behavior keeps the fixture free of schedule graphs.
create function pg_temp.behavior_payload(title text, offset_minutes integer)
returns jsonb
language sql
as $$
  select jsonb_build_object('category_id', null, 'title', title, 'description', null,
    'recurrence_rule', 'null'::jsonb, 'scheduled_time', null,
    'timezone', 'America/New_York', 'browser_reminder_enabled', true, 'email_reminder_enabled', false,
    'reminder_offset_minutes', offset_minutes, 'active', true, 'archived_at', null, 'archive_notes', '[]'::jsonb,
    'default_duration_minutes', null, 'auto_archived_at', null, 'is_opportunity', true,
    'created_at', '2026-11-01T12:00:00Z');
$$;

create function pg_temp.definition_plan(title text)
returns jsonb
language sql
as $$
  select jsonb_build_object('previous_title', null, 'next_title', title, 'previous_description', null,
    'next_description', null, 'changed_fields', jsonb_build_array('title'), 'recorded_at', '2026-11-01T12:00:00Z',
    'source', 'manual', 'reason', null);
$$;

create function pg_temp.create_behavior(title text, extra jsonb)
returns uuid
language sql
as $$
  select (public.create_behavior_with_schedule_graph(
    pg_temp.behavior_payload(title, 0) || extra,
    pg_temp.definition_plan(title),
    pg_temp.plan('baseline', null, pg_temp.configuration(0),
      array['category_id', 'location_text', 'where_kind', 'schedule_graph', 'browser_reminder_enabled',
        'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity'],
      'behavior_created'),
    '[]'::jsonb) ->> 'id')::uuid;
$$;

-- Updates that change only the answer. With an answer change the plan is a revision
-- naming 'alongside'; with none, no plan.
create function pg_temp.update_behavior(target uuid, extra jsonb)
returns jsonb
language plpgsql
as $$
declare
  behavior public.behaviors;
  next_answer jsonb;
  plan jsonb := null;
begin
  select * into behavior from public.behaviors where id = target;
  next_answer := case when extra ? 'alongside' then extra -> 'alongside' else to_jsonb(behavior.alongside) end;
  if coalesce(to_jsonb(behavior.alongside), 'null'::jsonb) is distinct from coalesce(next_answer, 'null'::jsonb) then
    plan := pg_temp.plan('revision',
      pg_temp.configuration(0) || jsonb_build_object('alongside', to_jsonb(behavior.alongside)),
      pg_temp.configuration(0) || jsonb_build_object('alongside', next_answer),
      array['alongside'], 'alongside_answered');
  end if;
  return public.update_behavior_with_schedule_graph(target,
    (pg_temp.behavior_payload(behavior.title, 0) - 'created_at') || extra,
    jsonb_build_object('stored_title', behavior.title, 'stored_description', null),
    '[]'::jsonb, behavior.updated_at, null, plan, '[]'::jsonb);
end;
$$;

grant execute on function pg_temp.configuration(integer) to authenticated;
grant execute on function pg_temp.plan(text, jsonb, jsonb, text[], text) to authenticated;
grant execute on function pg_temp.behavior_payload(text, integer) to authenticated;
grant execute on function pg_temp.definition_plan(text) to authenticated;
grant execute on function pg_temp.create_behavior(text, jsonb) to authenticated;
grant execute on function pg_temp.update_behavior(uuid, jsonb) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"35600000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '35600000-0000-4000-8000-000000000001', true);

-- ------------------------------------------------------------------ create and update

do $$
declare
  helmet uuid := pg_temp.create_behavior('Red light helmet', '{"alongside": true}');
  reading uuid := pg_temp.create_behavior('Reading', '{}');
  before public.behaviors;
  after public.behaviors;
  events integer;
begin
  if (select alongside from public.behaviors where id = helmet) is distinct from true then
    raise exception 'Create did not store the answer.';
  end if;
  if (select alongside from public.behaviors where id = reading) is not null then
    raise exception 'A Behavior created without an answer is not unanswered.';
  end if;
  if (select next_configuration -> 'alongside' from public.behavior_configuration_events where behavior_id = helmet and event_kind = 'baseline')
      is distinct from 'true'::jsonb
    or not (select next_configuration ? 'alongside' and next_configuration -> 'alongside' = 'null'::jsonb
      from public.behavior_configuration_events where behavior_id = reading and event_kind = 'baseline') then
    raise exception 'The configuration baseline does not carry the answer.';
  end if;

  select * into before from public.behaviors where id = helmet;
  select count(*) into events from public.behavior_configuration_events where behavior_id = helmet;
  perform pg_sleep(0.01);
  perform pg_temp.update_behavior(helmet, '{"alongside": false}');
  select * into after from public.behaviors where id = helmet;
  if after.alongside is distinct from false then
    raise exception 'Update did not store the answer.';
  end if;
  if after.updated_at <= before.updated_at then
    raise exception 'Changing the answer is not a revision.';
  end if;
  if (select count(*) from public.behavior_configuration_events where behavior_id = helmet) <> events + 1 then
    raise exception 'Changing the answer did not write one configuration revision.';
  end if;
  if not exists (
    select 1 from public.behavior_configuration_events
    where behavior_id = helmet and event_kind = 'revision' and changed_fields = array['alongside']
      and previous_configuration -> 'alongside' = 'true'::jsonb and next_configuration -> 'alongside' = 'false'::jsonb
      and reason_code = 'alongside_answered'
  ) then
    raise exception 'The configuration revision does not record the answer change.';
  end if;
  if (select current_configuration_event_id from public.behaviors where id = helmet) is distinct from
    (select id from public.behavior_configuration_events where behavior_id = helmet order by recorded_at desc, created_at desc limit 1) then
    raise exception 'The answer revision is not the current configuration.';
  end if;

  -- Changing the answer without a plan is refused: the answer is configuration now.
  begin
    perform public.update_behavior_with_schedule_graph(helmet,
      (pg_temp.behavior_payload('Red light helmet', 0) - 'created_at') || '{"alongside": true}'::jsonb,
      jsonb_build_object('stored_title', 'Red light helmet', 'stored_description', null),
      '[]'::jsonb, (select updated_at from public.behaviors where id = helmet), null, null, '[]'::jsonb);
    raise exception 'An answer change without configuration history was accepted.';
  exception when others then
    if sqlerrm not like '%requires an event plan%' then raise; end if;
  end;

  perform pg_temp.update_behavior(helmet, '{}');
  if (select alongside from public.behaviors where id = helmet) is distinct from false then
    raise exception 'An update without the key changed the answer.';
  end if;

  perform pg_temp.update_behavior(helmet, '{"alongside": null}');
  if (select alongside from public.behaviors where id = helmet) is not null then
    raise exception 'A JSON null did not clear the answer.';
  end if;
  perform pg_temp.update_behavior(helmet, '{"alongside": true}');
end;
$$;

-- ------------------------------------------------------------------ RLS isolation

select set_config('request.jwt.claims', '{"sub":"35600000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '35600000-0000-4000-8000-000000000002', true);
do $$
begin
  if exists (select 1 from public.behaviors) then
    raise exception 'Account B can read account A Behaviors.';
  end if;
end;
$$;
reset role;
create temporary table alongside_ids on commit drop as
select id from public.behaviors where title = 'Red light helmet';
grant select on alongside_ids to authenticated;
set local role authenticated;
do $$
begin
  -- The update function finds no Behavior of B's and returns null.
  if public.update_behavior_with_schedule_graph((select id from alongside_ids),
    (pg_temp.behavior_payload('Red light helmet', 0) - 'created_at') || '{"alongside": false}'::jsonb,
    jsonb_build_object('stored_title', 'Red light helmet', 'stored_description', null),
    '[]'::jsonb, now(), null, null, '[]'::jsonb) is not null then
    raise exception 'Account B updated account A''s Behavior.';
  end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"35600000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '35600000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select alongside from public.behaviors where title = 'Red light helmet') is distinct from true then
    raise exception 'Account B changed account A''s answer.';
  end if;
end;
$$;

-- ------------------------------------------------------------------ account sync contracts 9 and 10

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
    'plan', plan.value, 'attemptedAt', '2026-11-25T12:00:00.000000Z'
  )
  from plan
$$;

-- The snapshot with each listed entity replaced by its new value, or appended.
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
$$;

grant execute on function pg_temp.sync_payload(integer, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function pg_temp.merged(jsonb, jsonb) to authenticated;

do $$
declare
  helmet_id text := (select id::text from public.behaviors where title = 'Red light helmet');
  current_snapshot jsonb := public.read_account_sync_snapshot(10);
  legacy_snapshot jsonb := public.read_account_sync_snapshot(9);
  stored jsonb;
  changed jsonb;
  stored_configuration jsonb;
  event_id uuid := gen_random_uuid();
  event jsonb;
begin
  -- Contract 10 carries the answer; contract 9 never sees it.
  select entity -> 'value' into stored from jsonb_array_elements(current_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and entity ->> 'id' = helmet_id;
  if stored -> 'alongside' is distinct from 'true'::jsonb then
    raise exception 'Account sync contract 10 does not carry the answer.';
  end if;
  if exists (select 1 from jsonb_array_elements(legacy_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and (entity -> 'value') ? 'alongside') then
    raise exception 'Account sync contract 9 sees the alongside answer.';
  end if;
  if exists (select 1 from jsonb_array_elements(legacy_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'configuration_event' and entity -> 'value' -> 'changed_fields' ? 'alongside') is not true then
    -- Configuration history is synced as rows; older contracts receive the events unchanged.
    raise exception 'Account sync contract 9 lost the answer''s configuration events.';
  end if;

  -- A contract-9 write (an older Cadence for Mac, no alongside field) keeps the stored answer.
  select entity -> 'value' into stored from jsonb_array_elements(legacy_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and entity ->> 'id' = helmet_id;
  changed := stored || '{"sub_behavior_sort_order": 3}'::jsonb;
  perform public.apply_account_sync_plan(pg_temp.sync_payload(9, legacy_snapshot, jsonb_build_array(jsonb_build_object(
    'kind', 'behavior', 'id', helmet_id, 'operation', 'upsert', 'expected', stored, 'value', changed
  )), pg_temp.merged(legacy_snapshot, jsonb_build_array(jsonb_build_object('kind', 'behavior', 'id', helmet_id, 'value', changed))), repeat('c', 64)));
  if (select sub_behavior_sort_order <> 3 or alongside is distinct from true from public.behaviors where id = helmet_id::uuid) then
    raise exception 'A contract-9 Behavior write did not apply or erased the answer.';
  end if;

  -- A contract-9 write that names the answer is refused.
  current_snapshot := public.read_account_sync_snapshot(9);
  select entity -> 'value' into stored from jsonb_array_elements(current_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and entity ->> 'id' = helmet_id;
  changed := stored || '{"alongside": false}'::jsonb;
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(9, current_snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'behavior', 'id', helmet_id, 'operation', 'upsert', 'expected', stored, 'value', changed
    )), pg_temp.merged(current_snapshot, jsonb_build_array(jsonb_build_object('kind', 'behavior', 'id', helmet_id, 'value', changed))), repeat('d', 64)));
    raise exception 'A contract-9 write of the answer was accepted.';
  exception when invalid_parameter_value then null;
  end;

  -- A contract-10 Behavior write without the field is refused.
  current_snapshot := public.read_account_sync_snapshot(10);
  select entity -> 'value' into stored from jsonb_array_elements(current_snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and entity ->> 'id' = helmet_id;
  changed := (stored - 'alongside') || '{"sub_behavior_sort_order": 4}'::jsonb;
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(10, current_snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'behavior', 'id', helmet_id, 'operation', 'upsert', 'expected', stored, 'value', changed
    )), pg_temp.merged(current_snapshot, jsonb_build_array(jsonb_build_object('kind', 'behavior', 'id', helmet_id, 'value', changed))), repeat('e', 64)));
    raise exception 'A contract-10 Behavior write without the answer was accepted.';
  exception when others then
    -- Without the field the row differs from the stored one, so the history check or the
    -- contract-10 guard refuses it; either way the stored answer stays.
    if sqlerrm not like '%Update Cadence%' and sqlerrm not like '%append-only configuration history%' then raise; end if;
  end;

  -- A contract-10 answer change without configuration history is refused.
  changed := stored || '{"alongside": false}'::jsonb;
  begin
    perform public.apply_account_sync_plan(pg_temp.sync_payload(10, current_snapshot, jsonb_build_array(jsonb_build_object(
      'kind', 'behavior', 'id', helmet_id, 'operation', 'upsert', 'expected', stored, 'value', changed
    )), pg_temp.merged(current_snapshot, jsonb_build_array(jsonb_build_object('kind', 'behavior', 'id', helmet_id, 'value', changed))), repeat('f', 64)));
    raise exception 'A synced answer change without configuration history was accepted.';
  exception when others then
    if sqlerrm not like '%append-only configuration history%' then raise; end if;
  end;

  -- A contract-10 write changes the answer with its configuration revision (a Mac's answer).
  select event_row.next_configuration into stored_configuration
    from public.behaviors behavior join public.behavior_configuration_events event_row on event_row.id = behavior.current_configuration_event_id
    where behavior.id = helmet_id::uuid;
  event := cadence_private.normalize_account_sync_row(jsonb_build_object(
    'id', event_id, 'behavior_id', helmet_id, 'event_kind', 'revision',
    'previous_configuration', stored_configuration,
    'next_configuration', stored_configuration || '{"alongside": false}'::jsonb,
    'changed_fields', jsonb_build_array('alongside'),
    'recorded_at', '2026-11-25T12:00:00Z', 'effective_at', '2026-11-25T12:00:00Z',
    'effective_local_date', '2026-11-25', 'timezone', 'America/New_York', 'source', 'manual',
    'reason_code', 'alongside_answered', 'created_at', '2026-11-25T12:00:00Z'));
  changed := stored || jsonb_build_object('alongside', false, 'current_configuration_event_id', event_id);
  perform public.apply_account_sync_plan(pg_temp.sync_payload(10, current_snapshot, jsonb_build_array(
    jsonb_build_object('kind', 'configuration_event', 'id', event_id, 'operation', 'upsert', 'expected', null, 'value', event),
    jsonb_build_object('kind', 'behavior', 'id', helmet_id, 'operation', 'upsert', 'expected', stored, 'value', changed)
  ), pg_temp.merged(current_snapshot, jsonb_build_array(
    jsonb_build_object('kind', 'configuration_event', 'id', event_id::text, 'value', event),
    jsonb_build_object('kind', 'behavior', 'id', helmet_id, 'value', changed))), repeat('a', 64)));
  if (select alongside is distinct from false or current_configuration_event_id is distinct from event_id from public.behaviors where id = helmet_id::uuid) then
    raise exception 'A contract-10 answer change did not apply with its history.';
  end if;
end;
$$;

reset role;
rollback;
