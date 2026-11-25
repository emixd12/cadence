-- Alongside setting (migration 20261125140000, Ticket 356). Local-only rollback fixture.
-- Covers: create with and without the answer, update with, without and clearing it, the
-- answer as a revision, RLS isolation, and account sync contract 9 keeping the column
-- hosted-only (no field in the snapshot, a synced Behavior write keeps the answer).
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

-- Updates that change only the answer: the configuration stays as it is, so no plan.
create function pg_temp.update_behavior(target uuid, extra jsonb)
returns jsonb
language plpgsql
as $$
declare
  behavior public.behaviors;
begin
  select * into behavior from public.behaviors where id = target;
  return public.update_behavior_with_schedule_graph(target,
    (pg_temp.behavior_payload(behavior.title, 0) - 'created_at') || extra,
    jsonb_build_object('stored_title', behavior.title, 'stored_description', null),
    '[]'::jsonb, behavior.updated_at, null, null, '[]'::jsonb);
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
  if (select count(*) from public.behavior_configuration_events where behavior_id = helmet) <> events then
    raise exception 'Changing the answer wrote configuration history before Ticket 363.';
  end if;

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

-- ------------------------------------------------------------------ account sync contract 9

create function pg_temp.sync_payload(snapshot jsonb, writes jsonb, merged_entities jsonb, key text)
returns jsonb language sql immutable as $$
  with plan as (
    select jsonb_build_object('writes', writes, 'mergedFingerprint',
      cadence_private.account_sync_fingerprint(merged_entities), 'conflicts', '[]'::jsonb) value
  )
  select jsonb_build_object(
    'schemaVersion', 1, 'idempotencyKey', key, 'contract', cadence_private.account_sync_current_contract(),
    'baselineFingerprint', snapshot ->> 'fingerprint', 'localFingerprint', snapshot ->> 'fingerprint',
    'hostedFingerprint', snapshot ->> 'fingerprint',
    'planFingerprint', encode(extensions.digest(convert_to(cadence_private.canonical_account_sync_json(plan.value), 'UTF8'), 'sha256'), 'hex'),
    'plan', plan.value, 'attemptedAt', '2026-11-25T12:00:00.000000Z'
  )
  from plan
$$;

do $$
declare
  snapshot jsonb := public.read_account_sync_snapshot(cadence_private.account_sync_current_contract());
  helmet_id text := (select id::text from public.behaviors where title = 'Red light helmet');
  stored jsonb;
  changed jsonb;
  merged jsonb;
begin
  if exists (
    select 1 from jsonb_array_elements(snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and (entity -> 'value') ? 'alongside'
  ) then
    raise exception 'The account sync snapshot carries alongside before Ticket 363.';
  end if;

  -- A Mac write (no alongside field) to the Behavior keeps the stored answer.
  select entity -> 'value' into stored from jsonb_array_elements(snapshot -> 'entities') entity
    where entity ->> 'kind' = 'behavior' and entity ->> 'id' = helmet_id;
  -- Sibling order needs no configuration event, which keeps the plan to one write.
  changed := stored || '{"sub_behavior_sort_order": 3}'::jsonb;
  select jsonb_agg(case when entity ->> 'kind' = 'behavior' and entity ->> 'id' = helmet_id
    then jsonb_set(entity, '{value}', changed) else entity end) into merged
    from jsonb_array_elements(snapshot -> 'entities') entity;
  perform public.apply_account_sync_plan(pg_temp.sync_payload(snapshot, jsonb_build_array(jsonb_build_object(
    'kind', 'behavior', 'id', helmet_id, 'operation', 'upsert', 'expected', stored, 'value', changed
  )), merged, repeat('c', 64)));
  if (select sub_behavior_sort_order <> 3 or alongside is distinct from true from public.behaviors where id = helmet_id::uuid) then
    raise exception 'A synced Behavior write did not apply or erased the answer.';
  end if;
end;
$$;

reset role;
rollback;
