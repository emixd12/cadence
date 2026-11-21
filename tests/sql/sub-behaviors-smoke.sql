\set ON_ERROR_STOP on
-- Sub-behaviors (migration 20261122010000). Run against a local database:
-- psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -f tests/sql/sub-behaviors-smoke.sql
-- Everything rolls back. Deferred link checks run at once with SET CONSTRAINTS.

begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('14100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'routine-a@example.invalid', '{}', '{}'),
  ('14100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'routine-b@example.invalid', '{}', '{}');

create function pg_temp.configuration(parent_id uuid, inherit boolean)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', null, 'location_text', null, 'where_kind', null,
    'schedule_graph', jsonb_build_array(jsonb_build_object(
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
      'time_entries', jsonb_build_array(jsonb_build_object(
        'kind', 'exact', 'preset', null, 'start_time', '21:00:00', 'end_time', null, 'sort_order', 0)))),
    'browser_reminder_enabled', true, 'email_reminder_enabled', false, 'reminder_offset_minutes', 0,
    'active', true, 'timezone', 'America/New_York', 'end', null, 'pause', null,
    'parent_behavior_id', parent_id, 'inherit_parent_schedule', inherit);
$$;

create function pg_temp.item(behavior_id uuid, title text, parent_id uuid, inherit boolean, sort_order integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'behavior_payload', jsonb_build_object('id', behavior_id, 'category_id', null, 'title', title, 'description', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'scheduled_time', '21:00:00',
      'timezone', 'America/New_York', 'browser_reminder_enabled', true, 'email_reminder_enabled', false,
      'reminder_offset_minutes', 0, 'active', true, 'archived_at', null, 'archive_notes', '[]'::jsonb,
      'parent_behavior_id', parent_id, 'inherit_parent_schedule', inherit, 'sub_behavior_sort_order', sort_order,
      'created_at', '2026-11-01T12:00:00Z'),
    'definition_event_plan', jsonb_build_object('previous_title', null, 'next_title', title,
      'previous_description', null, 'next_description', null, 'changed_fields', jsonb_build_array('title'),
      'recorded_at', '2026-11-01T12:00:00Z', 'source', 'manual', 'reason', null),
    'configuration_event_plan', jsonb_build_object('event_kind', 'baseline', 'previous_configuration', null,
      'next_configuration', pg_temp.configuration(parent_id, inherit),
      'changed_fields', to_jsonb(array['category_id', 'location_text', 'where_kind', 'schedule_graph',
        'browser_reminder_enabled', 'email_reminder_enabled', 'reminder_offset_minutes', 'active', 'timezone',
        'end', 'pause', 'parent_behavior_id', 'inherit_parent_schedule']),
      'recorded_at', '2026-11-01T12:00:00Z', 'effective_at', '2026-11-01T12:00:00Z',
      'effective_local_date', '2026-11-01', 'timezone', 'America/New_York', 'source', 'manual',
      'reason_code', 'behavior_created'),
    'schedule_graph', jsonb_build_array(jsonb_build_object('id', null,
      'recurrence_rule', jsonb_build_object('frequency', 'daily', 'interval', 1), 'sort_order', 0,
      'time_entries', jsonb_build_array(jsonb_build_object('id', null, 'kind', 'exact', 'preset', null,
        'start_time', '21:00:00', 'end_time', null, 'sort_order', 0)))));
$$;

-- Expects one statement to fail with a message; deferred checks run inside the statement.
create function pg_temp.expect_failure(statement text, expected text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
    execute 'set constraints all immediate';
  exception when others then
    execute 'set constraints all deferred';
    if position(expected in sqlerrm) = 0 then
      raise exception 'Expected "%", got "%" for: %', expected, sqlerrm, statement;
    end if;
    return;
  end;
  raise exception 'Expected "%" but the statement passed: %', expected, statement;
end;
$$;

grant execute on function pg_temp.configuration(uuid, boolean) to authenticated;
grant execute on function pg_temp.item(uuid, text, uuid, boolean, integer) to authenticated;
grant execute on function pg_temp.expect_failure(text, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- A parent and two inheriting sub-behaviors in one call.
select public.create_behavior_group_with_schedule_graphs(jsonb_build_array(
  pg_temp.item('14100000-0000-4000-8000-0000000000a0', 'Skin routine', null, false, 0),
  pg_temp.item('14100000-0000-4000-8000-0000000000a1', 'Cerave', '14100000-0000-4000-8000-0000000000a0', true, 0),
  pg_temp.item('14100000-0000-4000-8000-0000000000a2', 'Retinol', '14100000-0000-4000-8000-0000000000a0', true, 1)));
-- A standalone Behavior through the single create.
select public.create_behavior_with_schedule_graph(
  pg_temp.item('14100000-0000-4000-8000-0000000000b0', 'Stretch', null, false, 0) -> 'behavior_payload',
  pg_temp.item('14100000-0000-4000-8000-0000000000b0', 'Stretch', null, false, 0) -> 'definition_event_plan',
  pg_temp.item('14100000-0000-4000-8000-0000000000b0', 'Stretch', null, false, 0) -> 'configuration_event_plan',
  pg_temp.item('14100000-0000-4000-8000-0000000000b0', 'Stretch', null, false, 0) -> 'schedule_graph');
set constraints all immediate;
set constraints all deferred;

do $$
declare child public.behaviors; event public.behavior_configuration_events;
begin
  select * into child from public.behaviors where id = '14100000-0000-4000-8000-0000000000a2';
  if child.parent_behavior_id <> '14100000-0000-4000-8000-0000000000a0' or not child.inherit_parent_schedule
    or child.sub_behavior_sort_order <> 1 then
    raise exception 'Group create did not store the link.';
  end if;
  select * into event from public.behavior_configuration_events where id = child.current_configuration_event_id;
  if not event.changed_fields @> array['parent_behavior_id', 'inherit_parent_schedule']
    or event.next_configuration ->> 'parent_behavior_id' <> '14100000-0000-4000-8000-0000000000a0'
    or (event.next_configuration -> 'inherit_parent_schedule')::boolean is not true then
    raise exception 'The baseline does not carry the link: %', event.next_configuration;
  end if;
end;
$$;

-- A group whose child names another parent is refused before anything is written.
select pg_temp.expect_failure($s$select public.create_behavior_group_with_schedule_graphs(jsonb_build_array(
  pg_temp.item('14100000-0000-4000-8000-0000000000c0', 'Evening', null, false, 0),
  pg_temp.item('14100000-0000-4000-8000-0000000000c1', 'Floss', '14100000-0000-4000-8000-0000000000b0', true, 0)))$s$,
  'Every sub-behavior must name the group''s parent.');

-- Depth 1 and ownership. Signed-in users write Behaviors only through the RPCs, so the
-- direct writes below run as the database owner; the rules hold for every writer.
reset role;
select pg_temp.expect_failure($s$update public.behaviors set parent_behavior_id = id
  where id = '14100000-0000-4000-8000-0000000000b0'$s$, 'behaviors_parent_not_self');
select pg_temp.expect_failure($s$update public.behaviors set inherit_parent_schedule = true
  where id = '14100000-0000-4000-8000-0000000000b0'$s$, 'behaviors_inherit_requires_parent');
select pg_temp.expect_failure($s$update public.behaviors set parent_behavior_id = '14100000-0000-4000-8000-0000000000a1'
  where id = '14100000-0000-4000-8000-0000000000b0'$s$, 'A sub-behavior can''t have sub-behaviors.');
select pg_temp.expect_failure($s$update public.behaviors set parent_behavior_id = '14100000-0000-4000-8000-0000000000b0'
  where id = '14100000-0000-4000-8000-0000000000a0'$s$, 'A Behavior with sub-behaviors can''t become a sub-behavior.');
select pg_temp.expect_failure($s$update public.behaviors set sub_behavior_sort_order = -1
  where id = '14100000-0000-4000-8000-0000000000a1'$s$, 'behaviors_sub_behavior_sort_order_check');

-- An archived parent takes no new sub-behavior; existing links stay.
update public.behaviors set active = false, archived_at = now() where id = '14100000-0000-4000-8000-0000000000b0';
select pg_temp.expect_failure($s$update public.behaviors set parent_behavior_id = '14100000-0000-4000-8000-0000000000b0'
  where id = '14100000-0000-4000-8000-0000000000a2'$s$, 'An archived Behavior can''t take sub-behaviors.');
update public.behaviors set active = true, archived_at = null where id = '14100000-0000-4000-8000-0000000000b0';
set local role authenticated;

-- Another account cannot attach to this parent.
select set_config('request.jwt.claims', '{"sub":"14100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select pg_temp.expect_failure($s$select public.create_behavior_with_schedule_graph(
  pg_temp.item('14100000-0000-4000-8000-0000000000d0', 'Foreign', '14100000-0000-4000-8000-0000000000a0', true, 0) -> 'behavior_payload',
  pg_temp.item('14100000-0000-4000-8000-0000000000d0', 'Foreign', '14100000-0000-4000-8000-0000000000a0', true, 0) -> 'definition_event_plan',
  pg_temp.item('14100000-0000-4000-8000-0000000000d0', 'Foreign', '14100000-0000-4000-8000-0000000000a0', true, 0) -> 'configuration_event_plan',
  pg_temp.item('14100000-0000-4000-8000-0000000000d0', 'Foreign', '14100000-0000-4000-8000-0000000000a0', true, 0) -> 'schedule_graph')$s$,
  'behaviors_parent');
select set_config('request.jwt.claims', '{"sub":"14100000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Reordering names each live sibling once and moves the revision.
select pg_temp.expect_failure($s$select public.reorder_sub_behaviors('14100000-0000-4000-8000-0000000000a0',
  array['14100000-0000-4000-8000-0000000000a2']::uuid[])$s$, 'Sub-behavior order must list each sub-behavior once.');
do $$
declare before_revision timestamptz; changed integer;
begin
  select updated_at into before_revision from public.behaviors where id = '14100000-0000-4000-8000-0000000000a2';
  changed := public.reorder_sub_behaviors('14100000-0000-4000-8000-0000000000a0',
    array['14100000-0000-4000-8000-0000000000a2', '14100000-0000-4000-8000-0000000000a1']::uuid[]);
  if changed <> 2 or (select sub_behavior_sort_order from public.behaviors where id = '14100000-0000-4000-8000-0000000000a2') <> 0 then
    raise exception 'Reorder did not store the new order.';
  end if;
end;
$$;

-- Ungrouping clears inheritance and order.
reset role;
do $$
declare child public.behaviors;
begin
  update public.behaviors set parent_behavior_id = null where id = '14100000-0000-4000-8000-0000000000a2'
  returning * into child;
  if child.inherit_parent_schedule or child.sub_behavior_sort_order <> 0 then
    raise exception 'Ungroup kept inheritance or order.';
  end if;
  update public.behaviors set parent_behavior_id = '14100000-0000-4000-8000-0000000000a0', inherit_parent_schedule = true,
    sub_behavior_sort_order = 1 where id = '14100000-0000-4000-8000-0000000000a2';
end;
$$;
set constraints all immediate;
set constraints all deferred;
set local role authenticated;

-- An update that changes only the link writes a revision naming the link fields.
do $$
declare child public.behaviors; updated jsonb; event public.behavior_configuration_events;
begin
  select * into child from public.behaviors where id = '14100000-0000-4000-8000-0000000000a1';
  updated := public.update_behavior_with_schedule_graph(child.id,
    (pg_temp.item(child.id, child.title, null, false, 0) -> 'behavior_payload') - 'created_at' - 'id',
    jsonb_build_object('stored_title', child.title, 'stored_description', null),
    cadence_private.current_behavior_schedule_graph(child.user_id, child.id),
    child.updated_at, null,
    jsonb_build_object('event_kind', 'revision',
      'previous_configuration', pg_temp.configuration(child.parent_behavior_id, true),
      'next_configuration', pg_temp.configuration(null, false),
      'changed_fields', to_jsonb(array['parent_behavior_id', 'inherit_parent_schedule']),
      'recorded_at', clock_timestamp(), 'effective_at', clock_timestamp(),
      'effective_local_date', (clock_timestamp() at time zone 'America/New_York')::date,
      'timezone', 'America/New_York', 'source', 'manual', 'reason_code', 'behavior_edited'),
    cadence_private.current_behavior_schedule_graph(child.user_id, child.id));
  if updated ->> 'parent_behavior_id' is not null then
    raise exception 'Update did not ungroup the sub-behavior.';
  end if;
  select * into event from public.behavior_configuration_events
  where behavior_id = child.id order by recorded_at desc, id desc limit 1;
  if event.changed_fields <> array['parent_behavior_id', 'inherit_parent_schedule'] then
    raise exception 'The ungroup revision named %.', event.changed_fields;
  end if;
end;
$$;
-- Group it again so the slot below has two sub-behaviors.
reset role;
update public.behaviors set parent_behavior_id = '14100000-0000-4000-8000-0000000000a0', inherit_parent_schedule = true
where id = '14100000-0000-4000-8000-0000000000a1';
set constraints all immediate;
set constraints all deferred;
set local role authenticated;

-- Parent slot marking: both children's 9 PM Occurrences change together, one event each.
reset role;
insert into public.occurrences (id, user_id, behavior_id, behavior_configuration_event_id, scheduled_for, local_date,
  schedule_kind, schedule_start_time, status)
select ('14100000-0000-4000-8000-0000000000e' || right(b.id::text, 1))::uuid, b.user_id, b.id, b.current_configuration_event_id,
  '2026-11-02T02:00:00Z', '2026-11-01', 'exact', '21:00:00', 'unresolved'
from public.behaviors b where b.id in ('14100000-0000-4000-8000-0000000000a1', '14100000-0000-4000-8000-0000000000a2');
insert into public.occurrences (id, user_id, behavior_id, behavior_configuration_event_id, scheduled_for, local_date,
  schedule_kind, schedule_start_time, status)
select '14100000-0000-4000-8000-0000000000f0', b.user_id, b.id, b.current_configuration_event_id,
  '2026-11-02T02:00:00Z', '2026-11-01', 'exact', '21:00:00', 'unresolved'
from public.behaviors b where b.id = '14100000-0000-4000-8000-0000000000b0';
insert into public.reminder_deliveries (user_id, occurrence_id, channel, scheduled_send_at, status)
values ('14100000-0000-4000-8000-000000000001', '14100000-0000-4000-8000-0000000000e1', 'browser_push', '2026-11-02T02:00:00Z', 'pending');
set local role authenticated;

create function pg_temp.transition(occurrence_id uuid, planned text)
returns jsonb
language sql
as $$
  select jsonb_build_object('occurrence_id', occurrence_id, 'expected_status', 'unresolved',
    'expected_latest_event_id', null, 'planned_status', planned,
    'planned_completed_at', case when planned = 'completed' then '2026-11-02T02:05:00Z' end,
    'planned_status_marked_at', '2026-11-02T02:05:00Z', 'planned_event_semantics', 'explicit_user_mark',
    'planned_event_recorded_at', '2026-11-02T02:05:00Z',
    'planned_event_effective_at', case when planned = 'completed' then '2026-11-02T02:05:00Z' else '2026-11-02T02:05:00Z' end,
    'planned_event_source_capture_method', 'manual_tap', 'planned_event_source_confidence', 'high',
    'planned_cancel_pending_reminders', true);
$$;
grant execute on function pg_temp.transition(uuid, text) to authenticated;

-- A standalone Occurrence is not part of the parent slot.
select pg_temp.expect_failure($s$select public.apply_parent_slot_status_transition('14100000-0000-4000-8000-0000000000a0',
  jsonb_build_array(pg_temp.transition('14100000-0000-4000-8000-0000000000e1', 'completed'),
    pg_temp.transition('14100000-0000-4000-8000-0000000000f0', 'completed')))$s$,
  'Every Occurrence must belong to a sub-behavior of this parent.');
-- One stale child rolls back the whole slot.
select pg_temp.expect_failure($s$select public.apply_parent_slot_status_transition('14100000-0000-4000-8000-0000000000a0',
  jsonb_build_array(pg_temp.transition('14100000-0000-4000-8000-0000000000e1', 'completed'),
    pg_temp.transition('14100000-0000-4000-8000-0000000000e2', 'completed') || '{"expected_status":"completed"}'))$s$,
  'Occurrence status changed concurrently.');
do $$
begin
  if exists (select 1 from public.occurrences where id = '14100000-0000-4000-8000-0000000000e1' and status <> 'unresolved') then
    raise exception 'A failed slot change left one child marked.';
  end if;
end;
$$;

do $$
declare result jsonb;
begin
  result := public.apply_parent_slot_status_transition('14100000-0000-4000-8000-0000000000a0',
    jsonb_build_array(pg_temp.transition('14100000-0000-4000-8000-0000000000e1', 'completed'),
      pg_temp.transition('14100000-0000-4000-8000-0000000000e2', 'completed')));
  if jsonb_array_length(result -> 'results') <> 2 then
    raise exception 'Slot change returned %.', result;
  end if;
  if (select count(*) from public.occurrences where id in ('14100000-0000-4000-8000-0000000000e1',
      '14100000-0000-4000-8000-0000000000e2') and status = 'completed') <> 2 then
    raise exception 'Slot change did not mark every child.';
  end if;
  if (select count(*) from public.occurrence_status_events where occurrence_id in ('14100000-0000-4000-8000-0000000000e1',
      '14100000-0000-4000-8000-0000000000e2') and status = 'completed') <> 2 then
    raise exception 'Slot change did not record one status event per child.';
  end if;
  if exists (select 1 from public.reminder_deliveries where occurrence_id = '14100000-0000-4000-8000-0000000000e1'
      and status = 'pending') then
    raise exception 'Slot change left a pending routine reminder.';
  end if;
end;
$$;

-- Account sync: contract 8 does not see the link; contract 9 does.
do $$
declare entity jsonb;
begin
  select value into entity from jsonb_array_elements(public.read_account_sync_snapshot(7) -> 'entities') value
  where value ->> 'id' = '14100000-0000-4000-8000-0000000000a1';
  if entity -> 'value' ? 'parent_behavior_id' then
    raise exception 'Contract 7 saw the sub-behavior link.';
  end if;
  select value into entity from jsonb_array_elements(public.read_account_sync_snapshot(8) -> 'entities') value
  where value ->> 'id' = '14100000-0000-4000-8000-0000000000a1';
  if entity -> 'value' ->> 'parent_behavior_id' <> '14100000-0000-4000-8000-0000000000a0' then
    raise exception 'Contract 9 did not see the sub-behavior link.';
  end if;
  if cadence_private.account_sync_min_writer_contract() <> 7 then
    raise exception 'Contract-8 writers must keep syncing.';
  end if;
end;
$$;

-- A parent archived with its sub-behavior in one group update; links stay.
create function pg_temp.archive_item(target uuid, parent_id uuid, inherit boolean)
returns jsonb
language sql
as $$
  select jsonb_build_object('target_behavior_id', b.id,
    'behavior_payload', (pg_temp.item(b.id, b.title, parent_id, inherit, b.sub_behavior_sort_order) -> 'behavior_payload')
      - 'created_at' - 'id' || jsonb_build_object('active', false, 'archived_at', '2026-11-03T12:00:00Z'),
    'expected_definition', jsonb_build_object('stored_title', b.title, 'stored_description', null),
    'expected_schedule_graph', cadence_private.current_behavior_schedule_graph(b.user_id, b.id),
    'expected_updated_at', b.updated_at,
    'definition_event_plan', null,
    'configuration_event_plan', jsonb_build_object('event_kind', 'revision',
      'previous_configuration', pg_temp.configuration(parent_id, inherit),
      'next_configuration', pg_temp.configuration(parent_id, inherit) || '{"active": false}',
      'changed_fields', to_jsonb(array['active']),
      'recorded_at', '2026-11-03T12:00:00Z', 'effective_at', '2026-11-03T12:00:00Z',
      'effective_local_date', '2026-11-03', 'timezone', 'America/New_York', 'source', 'manual',
      'reason_code', 'behavior_archived'),
    'schedule_graph', cadence_private.current_behavior_schedule_graph(b.user_id, b.id))
  from public.behaviors b where b.id = target;
$$;
grant execute on function pg_temp.archive_item(uuid, uuid, boolean) to authenticated;

select pg_temp.expect_failure($s$select public.update_behavior_group_with_schedule_graphs(jsonb_build_array(
  pg_temp.archive_item('14100000-0000-4000-8000-0000000000a0', null, false),
  pg_temp.archive_item('14100000-0000-4000-8000-0000000000a0', null, false)))$s$,
  'Each Behavior may appear once in a group update.');
do $$
declare updated jsonb;
begin
  updated := public.update_behavior_group_with_schedule_graphs(jsonb_build_array(
    pg_temp.archive_item('14100000-0000-4000-8000-0000000000a0', null, false),
    pg_temp.archive_item('14100000-0000-4000-8000-0000000000a1', '14100000-0000-4000-8000-0000000000a0', true)));
  if jsonb_array_length(updated) <> 2 or (select count(*) from public.behaviors
      where id in ('14100000-0000-4000-8000-0000000000a0', '14100000-0000-4000-8000-0000000000a1')
        and not active and archived_at = '2026-11-03T12:00:00Z') <> 2 then
    raise exception 'Group archive did not archive the parent and its sub-behavior together.';
  end if;
  if (select parent_behavior_id from public.behaviors where id = '14100000-0000-4000-8000-0000000000a1')
      is distinct from '14100000-0000-4000-8000-0000000000a0' then
    raise exception 'Group archive dropped the link.';
  end if;
end;
$$;
set constraints all immediate;
set constraints all deferred;

-- Deleting a parent leaves standalone Behaviors.
reset role;
set constraints all immediate;
delete from public.behaviors where id = '14100000-0000-4000-8000-0000000000a0';
do $$
begin
  if exists (select 1 from public.behaviors where id in ('14100000-0000-4000-8000-0000000000a1',
      '14100000-0000-4000-8000-0000000000a2') and (parent_behavior_id is not null or inherit_parent_schedule)) then
    raise exception 'Deleting a parent left linked or inheriting children.';
  end if;
end;
$$;

rollback;
