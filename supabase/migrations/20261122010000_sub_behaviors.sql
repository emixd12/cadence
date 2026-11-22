-- Sub-behaviors (one level deep).
--
-- A Behavior can sit under one parent Behavior. A parent cannot itself have a parent,
-- and a Behavior with sub-behaviors cannot become one (depth 1). Archived children still
-- count as children, so restoring one never makes a grandchild. A new link cannot point
-- at an archived parent.
--
-- A sub-behavior either inherits its parent's schedule (inherit_parent_schedule) or keeps
-- its own. Inheriting children store a copy of the parent's schedule; the service mirrors
-- every parent schedule, end and pause change onto them in one transaction.
--
-- While a parent has active sub-behaviors, they own the generated Occurrences. Marking a
-- parent slot marks every child Occurrence in it at once
-- (apply_parent_slot_status_transition), one status event per child. No fourth status.
--
-- The link and inheritance join the configuration snapshot ('parent_behavior_id' and
-- 'inherit_parent_schedule'). Sibling order (sub_behavior_sort_order) is display order
-- and stays out of configuration history.
--
-- Account sync contract 9 carries the three fields. Contract-8 writers keep syncing: the
-- projection hides the fields from them and restores the stored values on their writes.
begin;

-- ------------------------------------------------------------------ columns

alter table public.behaviors
  add column parent_behavior_id uuid,
  add column sub_behavior_sort_order integer not null default 0,
  add column inherit_parent_schedule boolean not null default false;

-- Deferred, so a sync plan or a restore may write a child before its parent.
alter table public.behaviors
  add constraint behaviors_parent_behavior_id_fkey
    foreign key (parent_behavior_id) references public.behaviors(id)
    on delete set null deferrable initially deferred,
  add constraint behaviors_parent_owner_fkey
    foreign key (user_id, parent_behavior_id) references public.behaviors(user_id, id)
    on delete set null (parent_behavior_id) deferrable initially deferred,
  add constraint behaviors_parent_not_self check (parent_behavior_id is distinct from id),
  add constraint behaviors_sub_behavior_sort_order_check check (sub_behavior_sort_order >= 0),
  add constraint behaviors_inherit_requires_parent check (parent_behavior_id is not null or not inherit_parent_schedule);

create index behaviors_parent_behavior_idx
  on public.behaviors (user_id, parent_behavior_id, sub_behavior_sort_order)
  where parent_behavior_id is not null;

comment on column public.behaviors.parent_behavior_id is
  'Parent Behavior of a sub-behavior (depth 1). Null on standalone and parent Behaviors.';
comment on column public.behaviors.sub_behavior_sort_order is
  'Display order among siblings under one parent. Not part of configuration history.';
comment on column public.behaviors.inherit_parent_schedule is
  'True while a sub-behavior stores a mirror of its parent''s schedule, end and pause. Always false without a parent.';

-- An ungroup, or a parent removed by account deletion, leaves a standalone Behavior.
create function cadence_private.normalize_behavior_parent_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_behavior_id is null and old.parent_behavior_id is not null then
    new.inherit_parent_schedule := false;
    new.sub_behavior_sort_order := 0;
  end if;
  return new;
end;
$$;

create trigger normalize_behavior_parent_link
  before update on public.behaviors
  for each row execute function cadence_private.normalize_behavior_parent_link();

-- Depth 1, checked on the committed state so write order inside a transaction is free.
-- The composite foreign key already keeps the parent in the same account.
create function cadence_private.enforce_behavior_sub_behavior_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored public.behaviors;
  parent public.behaviors;
begin
  select * into stored from public.behaviors where id = new.id;
  if not found or stored.parent_behavior_id is null then
    return null;
  end if;

  select * into parent from public.behaviors
  where id = stored.parent_behavior_id and user_id = stored.user_id;
  if not found then
    return null;
  end if;

  if parent.parent_behavior_id is not null then
    raise exception 'A sub-behavior can''t have sub-behaviors.' using errcode = '23514';
  end if;
  if exists (select 1 from public.behaviors child
    where child.user_id = stored.user_id and child.parent_behavior_id = stored.id) then
    raise exception 'A Behavior with sub-behaviors can''t become a sub-behavior.' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or old.parent_behavior_id is distinct from new.parent_behavior_id)
    and (parent.archived_at is not null or not parent.active) then
    raise exception 'An archived Behavior can''t take sub-behaviors.' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function cadence_private.normalize_behavior_parent_link() from public, anon, authenticated, service_role;
revoke all on function cadence_private.enforce_behavior_sub_behavior_depth() from public, anon, authenticated, service_role;

create constraint trigger enforce_behavior_sub_behavior_depth
  after insert or update of parent_behavior_id on public.behaviors
  deferrable initially deferred
  for each row execute function cadence_private.enforce_behavior_sub_behavior_depth();

-- Link, inheritance and sibling order are revisions: integration conflict checks read updated_at.
drop trigger set_behaviors_updated_at on public.behaviors;
create trigger set_behaviors_updated_at
  before update of category_id, title, description, recurrence_rule, scheduled_time, timezone,
    browser_reminder_enabled, email_reminder_enabled, reminder_offset_minutes, active, archived_at,
    end_on, end_time, pause_from_on, pause_from_time, pause_back_on, is_opportunity,
    parent_behavior_id, sub_behavior_sort_order, inherit_parent_schedule
  on public.behaviors
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ configuration history

alter table public.behavior_configuration_events
  drop constraint behavior_configuration_events_changed_fields_check;

alter table public.behavior_configuration_events
  add constraint behavior_configuration_events_changed_fields_check
  check (
    cardinality(changed_fields) > 0
    and changed_fields <@ array[
      'category_id', 'location_text', 'where_kind', 'schedule_graph',
      'browser_reminder_enabled', 'email_reminder_enabled',
      'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity',
      'parent_behavior_id', 'inherit_parent_schedule'
    ]::text[]
  );

-- Existing history is not rewritten. A snapshot without the link was standalone.
-- Kept in the order of BEHAVIOR_CONFIGURATION_CHANGED_FIELDS in TypeScript.
create or replace function cadence_private.behavior_configuration_changed_fields(
  previous_configuration jsonb,
  next_configuration jsonb
)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when previous_configuration is null then array[
    'category_id', 'location_text', 'where_kind', 'schedule_graph',
    'browser_reminder_enabled', 'email_reminder_enabled',
    'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity',
    'parent_behavior_id', 'inherit_parent_schedule'
  ]::text[] else array_remove(array[
    case when previous_configuration -> 'category_id' is distinct from next_configuration -> 'category_id' then 'category_id' end,
    case when previous_configuration -> 'location_text' is distinct from next_configuration -> 'location_text' then 'location_text' end,
    case when coalesce(previous_configuration -> 'where_kind', case when previous_configuration ->> 'location_text' is null then 'null'::jsonb else '"place"'::jsonb end)
      is distinct from next_configuration -> 'where_kind' then 'where_kind' end,
    case when previous_configuration -> 'schedule_graph' is distinct from next_configuration -> 'schedule_graph' then 'schedule_graph' end,
    case when previous_configuration -> 'browser_reminder_enabled' is distinct from next_configuration -> 'browser_reminder_enabled' then 'browser_reminder_enabled' end,
    case when previous_configuration -> 'email_reminder_enabled' is distinct from next_configuration -> 'email_reminder_enabled' then 'email_reminder_enabled' end,
    case when previous_configuration -> 'reminder_offset_minutes' is distinct from next_configuration -> 'reminder_offset_minutes' then 'reminder_offset_minutes' end,
    case when previous_configuration -> 'active' is distinct from next_configuration -> 'active' then 'active' end,
    case when previous_configuration -> 'timezone' is distinct from next_configuration -> 'timezone' then 'timezone' end,
    case when coalesce(previous_configuration -> 'end', 'null'::jsonb) is distinct from coalesce(next_configuration -> 'end', 'null'::jsonb) then 'end' end,
    case when coalesce(previous_configuration -> 'pause', 'null'::jsonb) is distinct from coalesce(next_configuration -> 'pause', 'null'::jsonb) then 'pause' end,
    case when coalesce(previous_configuration -> 'is_opportunity', 'false'::jsonb) is distinct from coalesce(next_configuration -> 'is_opportunity', 'false'::jsonb) then 'is_opportunity' end,
    case when coalesce(previous_configuration -> 'parent_behavior_id', 'null'::jsonb)
      is distinct from coalesce(next_configuration -> 'parent_behavior_id', 'null'::jsonb) then 'parent_behavior_id' end,
    case when coalesce(previous_configuration -> 'inherit_parent_schedule', 'false'::jsonb)
      is distinct from coalesce(next_configuration -> 'inherit_parent_schedule', 'false'::jsonb) then 'inherit_parent_schedule' end
  ]::text[], null) end;
$$;

-- A configuration plan written before sub-behaviors existed has no link keys. It reads
-- as keeping the stored link, as a plan without 'end' or 'is_opportunity' already does.
create or replace function cadence_private.behavior_configuration_with_run(planned jsonb, stored jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when planned is null or jsonb_typeof(planned) <> 'object' then planned
    else planned
      || case when planned ? 'end' then '{}'::jsonb
        else jsonb_build_object('end', coalesce(stored -> 'end', 'null'::jsonb)) end
      || case when planned ? 'pause' then '{}'::jsonb
        else jsonb_build_object('pause', coalesce(stored -> 'pause', 'null'::jsonb)) end
      || case when planned ? 'is_opportunity' then '{}'::jsonb
        else jsonb_build_object('is_opportunity', coalesce(stored -> 'is_opportunity', 'false'::jsonb)) end
      || case when planned ? 'parent_behavior_id' then '{}'::jsonb
        else jsonb_build_object(
          'parent_behavior_id', coalesce(stored -> 'parent_behavior_id', 'null'::jsonb),
          'inherit_parent_schedule', coalesce(stored -> 'inherit_parent_schedule', 'false'::jsonb)) end
  end;
$$;

revoke all on function cadence_private.behavior_configuration_with_run(jsonb, jsonb) from public, anon, authenticated;

-- The changed fields a plan must list: a plan without the link keys names no link field.
create or replace function cadence_private.behavior_configuration_planned_fields(expected text[], planned_next jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array(
    select field
    from unnest(expected) with ordinality as listed(field, position)
    where not (field = 'where_kind' and not coalesce(planned_next ? 'where_kind', false))
      and not (field in ('end', 'pause') and not coalesce(planned_next ? 'end', false))
      and not (field = 'is_opportunity' and not coalesce(planned_next ? 'is_opportunity', false))
      and not (field in ('parent_behavior_id', 'inherit_parent_schedule')
        and not coalesce(planned_next ? 'parent_behavior_id', false))
    order by position
  );
$$;

-- A small text patcher for the function rewrites below: each anchor must occur once.
create or replace function pg_temp.patch_definition(definition text, anchor text, replacement text, label text)
returns text
language plpgsql
as $$
begin
  if position(anchor in definition) = 0 then
    raise exception '% changed unexpectedly.', label;
  end if;
  if position(anchor in substr(definition, position(anchor in definition) + length(anchor))) > 0 then
    raise exception '% anchor is not unique.', label;
  end if;
  return replace(definition, anchor, replacement);
end;
$$;

do $migration$
declare
  definition text;
begin
  -- Snapshot: the link and inheritance, always present.
  select pg_get_functiondef('cadence_private.current_behavior_configuration_snapshot(uuid,uuid)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$      'back_on', behavior.pause_back_on::text
    ) end
  )$a$, $p$      'back_on', behavior.pause_back_on::text
    ) end,
    'parent_behavior_id', behavior.parent_behavior_id,
    'inherit_parent_schedule', behavior.inherit_parent_schedule
  )$p$, 'Behavior configuration snapshot');
  execute definition;

  -- Create: the caller may choose the id, so a parent and its sub-behaviors can be
  -- planned together (create_behavior_group_with_schedule_graphs).
  select pg_get_functiondef('public.create_behavior_with_schedule_graph(jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    pause_back_on,
    auto_archived_at,
    is_opportunity,
    created_at,$a$, $p$    pause_back_on,
    auto_archived_at,
    is_opportunity,
    parent_behavior_id,
    sub_behavior_sort_order,
    inherit_parent_schedule,
    id,
    created_at,$p$, 'Behavior create columns');
  definition := pg_temp.patch_definition(definition, $a$    nullif(behavior_payload ->> 'auto_archived_at', '')::timestamptz,
    coalesce((behavior_payload ->> 'is_opportunity')::boolean, false),
    behavior_created_at,$a$, $p$    nullif(behavior_payload ->> 'auto_archived_at', '')::timestamptz,
    coalesce((behavior_payload ->> 'is_opportunity')::boolean, false),
    nullif(behavior_payload ->> 'parent_behavior_id', '')::uuid,
    coalesce(nullif(behavior_payload ->> 'sub_behavior_sort_order', '')::integer, 0),
    coalesce(nullif(behavior_payload ->> 'inherit_parent_schedule', '')::boolean, false),
    coalesce(nullif(behavior_payload ->> 'id', '')::uuid, gen_random_uuid()),
    behavior_created_at,$p$, 'Behavior create values');
  execute definition;

  -- Update: each link field changes only when the payload carries it.
  select pg_get_functiondef('public.update_behavior_with_schedule_graph(uuid,jsonb,jsonb,jsonb,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$      else current_behavior.pause_back_on end,
    auto_archived_at = case$a$, $p$      else current_behavior.pause_back_on end,
    parent_behavior_id = case when behavior_payload ? 'parent_behavior_id'
      then nullif(behavior_payload ->> 'parent_behavior_id', '')::uuid
      else current_behavior.parent_behavior_id end,
    sub_behavior_sort_order = case when behavior_payload ? 'sub_behavior_sort_order'
      then coalesce(nullif(behavior_payload ->> 'sub_behavior_sort_order', '')::integer, 0)
      else current_behavior.sub_behavior_sort_order end,
    inherit_parent_schedule = case when behavior_payload ? 'inherit_parent_schedule'
      then coalesce(nullif(behavior_payload ->> 'inherit_parent_schedule', '')::boolean, false)
      else current_behavior.inherit_parent_schedule end,
    auto_archived_at = case$p$, 'Behavior update fields');
  execute definition;

  -- Account sync: a contract-9 Behavior write must carry the link fields.
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    if write_kind = 'occurrence' and not ((write -> 'value') ?& array['origin', 'added_by']) then
      raise exception 'Update Cadence before synchronizing Occurrence changes.' using errcode = '22023';
    end if;$a$, $p$    if write_kind = 'occurrence' and not ((write -> 'value') ?& array['origin', 'added_by']) then
      raise exception 'Update Cadence before synchronizing Occurrence changes.' using errcode = '22023';
    end if;
    if write_kind = 'behavior' and v_contract >= 9 and not ((write -> 'value') ?& array[
      'parent_behavior_id', 'sub_behavior_sort_order', 'inherit_parent_schedule'
    ]) then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;$p$, 'Account sync Behavior compatibility guard');
  execute definition;

  -- BehaviorLog restore: link fields change only when the restored record carries them.
  select pg_get_functiondef('public.apply_behaviorlog_restore_product_writes(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    pause_back_on,
    auto_archived_at,
    archived_at,$a$, $p$    pause_back_on,
    parent_behavior_id,
    sub_behavior_sort_order,
    inherit_parent_schedule,
    auto_archived_at,
    archived_at,$p$, 'BehaviorLog restore columns');
  definition := pg_temp.patch_definition(definition, $a$    nullif(row ->> 'pause_back_on', '')::date,
    nullif(row ->> 'auto_archived_at', '')::timestamptz,$a$, $p$    nullif(row ->> 'pause_back_on', '')::date,
    nullif(row ->> 'parent_behavior_id', '')::uuid,
    coalesce(nullif(row ->> 'sub_behavior_sort_order', '')::integer, 0),
    coalesce(nullif(row ->> 'inherit_parent_schedule', '')::boolean, false),
    nullif(row ->> 'auto_archived_at', '')::timestamptz,$p$, 'BehaviorLog restore values');
  definition := pg_temp.patch_definition(definition, $a$    archived_at = excluded.archived_at,
    is_opportunity = case when exists ($a$, $p$    parent_behavior_id = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'parent_behavior_id'
    ) then excluded.parent_behavior_id else public.behaviors.parent_behavior_id end,
    sub_behavior_sort_order = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'parent_behavior_id'
    ) then excluded.sub_behavior_sort_order else public.behaviors.sub_behavior_sort_order end,
    inherit_parent_schedule = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'parent_behavior_id'
    ) then excluded.inherit_parent_schedule else public.behaviors.inherit_parent_schedule end,
    archived_at = excluded.archived_at,
    is_opportunity = case when exists ($p$, 'BehaviorLog restore link');
  execute definition;

  -- Export page bundle.
  select pg_get_functiondef('public.get_export_page_read_bundle(date,date)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$            'pause_back_on', b.pause_back_on,$a$, $p$            'pause_back_on', b.pause_back_on,
            'parent_behavior_id', b.parent_behavior_id,
            'sub_behavior_sort_order', b.sub_behavior_sort_order,
            'inherit_parent_schedule', b.inherit_parent_schedule,$p$, 'Export page Behavior fields');
  execute definition;

  -- Advisor snapshot.
  select pg_get_functiondef('cadence_private.advisor_cadence_snapshot_payload(uuid,date,date,uuid[],integer,integer)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$        'pauseBackOn', behavior.pause_back_on,
        'timezone', behavior.timezone$a$, $p$        'pauseBackOn', behavior.pause_back_on,
        'timezone', behavior.timezone,
        'parentBehaviorId', behavior.parent_behavior_id,
        'subBehaviorSortOrder', behavior.sub_behavior_sort_order,
        'inheritParentSchedule', behavior.inherit_parent_schedule$p$, 'Advisor snapshot Behavior fields');
  execute definition;

  -- MCP: the receipt source carries the link fields.
  select pg_get_functiondef('cadence_private.integration_write_source(jsonb,text)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$'pause_back_on','default_duration_minutes',$a$,
    $p$'pause_back_on','parent_behavior_id','sub_behavior_sort_order','inherit_parent_schedule','default_duration_minutes',$p$,
    'Integration write source fields');
  execute definition;
end
$migration$;

drop function pg_temp.patch_definition(text, text, text, text);

-- ------------------------------------------------------------------ group create

-- A parent and its sub-behaviors in one transaction. The first item is the parent; every
-- other item names it in parent_behavior_id. Ids are chosen by the caller so each plan's
-- snapshot already carries the link.
create function public.create_behavior_group_with_schedule_graphs(items jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  parent_id uuid;
  item jsonb;
  created jsonb := '[]'::jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if items is null or jsonb_typeof(items) <> 'array'
    or jsonb_array_length(items) < 2 or jsonb_array_length(items) > 51 then
    raise exception 'A Behavior group needs a parent and 1 to 50 sub-behaviors.' using errcode = '22023';
  end if;

  parent_id := nullif(items -> 0 -> 'behavior_payload' ->> 'id', '')::uuid;
  if parent_id is null
    or nullif(items -> 0 -> 'behavior_payload' ->> 'parent_behavior_id', '') is not null
    or exists (
      select 1 from jsonb_array_elements(items) with ordinality as entry(value, position)
      where entry.position > 1
        and (nullif(entry.value -> 'behavior_payload' ->> 'parent_behavior_id', '')::uuid is distinct from parent_id
          or nullif(entry.value -> 'behavior_payload' ->> 'id', '') is null)
    ) then
    raise exception 'Every sub-behavior must name the group''s parent.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(items) loop
    created := created || jsonb_build_array(public.create_behavior_with_schedule_graph(
      item -> 'behavior_payload',
      item -> 'definition_event_plan',
      item -> 'configuration_event_plan',
      item -> 'schedule_graph'
    ));
  end loop;
  return created;
end;
$$;

revoke all on function public.create_behavior_group_with_schedule_graphs(jsonb) from public, anon, service_role;
grant execute on function public.create_behavior_group_with_schedule_graphs(jsonb) to authenticated;

-- Several Behavior updates in one transaction: a parent edit with the schedule mirrors of
-- its inheriting sub-behaviors, or a parent archived or restored with its group. Each item
-- carries the arguments of update_behavior_with_schedule_graph and keeps its own checks.
create function public.update_behavior_group_with_schedule_graphs(items jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  updated jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if items is null or jsonb_typeof(items) <> 'array'
    or jsonb_array_length(items) < 1 or jsonb_array_length(items) > 51 then
    raise exception 'A Behavior group update needs 1 to 51 Behaviors.' using errcode = '22023';
  end if;
  if (select count(distinct value ->> 'target_behavior_id') from jsonb_array_elements(items)) <> jsonb_array_length(items) then
    raise exception 'Each Behavior may appear once in a group update.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(items) loop
    updated := updated || jsonb_build_array(public.update_behavior_with_schedule_graph(
      (item ->> 'target_behavior_id')::uuid,
      item -> 'behavior_payload',
      item -> 'expected_definition',
      item -> 'expected_schedule_graph',
      (item ->> 'expected_updated_at')::timestamptz,
      nullif(item -> 'definition_event_plan', 'null'::jsonb),
      nullif(item -> 'configuration_event_plan', 'null'::jsonb),
      item -> 'schedule_graph'
    ));
  end loop;
  return updated;
end;
$$;

revoke all on function public.update_behavior_group_with_schedule_graphs(jsonb) from public, anon, service_role;
grant execute on function public.update_behavior_group_with_schedule_graphs(jsonb) to authenticated;

-- ------------------------------------------------------------------ sibling order

-- Dense order for one parent's live sub-behaviors. The list must name each of them once.
-- Returns the number of rows whose order changed.
create function public.reorder_sub_behaviors(target_parent_behavior_id uuid, ordered_behavior_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text, 0));

  if ordered_behavior_ids is null
    or cardinality(ordered_behavior_ids) <> (select count(distinct value) from unnest(ordered_behavior_ids) value)
    or (select array_agg(value order by value) from unnest(ordered_behavior_ids) value)
      is distinct from (
        select array_agg(child.id order by child.id) from public.behaviors child
        where child.user_id = current_user_id
          and child.parent_behavior_id = target_parent_behavior_id
          and child.archived_at is null)
  then
    raise exception 'Sub-behavior order must list each sub-behavior once.' using errcode = '22023';
  end if;

  update public.behaviors child
  set sub_behavior_sort_order = (ordered.position - 1)::integer
  from unnest(ordered_behavior_ids) with ordinality as ordered(id, position)
  where child.user_id = current_user_id
    and child.id = ordered.id
    and child.sub_behavior_sort_order is distinct from (ordered.position - 1)::integer;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.reorder_sub_behaviors(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.reorder_sub_behaviors(uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------------ parent slot marking

-- Marks every sub-behavior Occurrence in one parent slot at once. Each transition has the
-- arguments of apply_occurrence_status_transition, which writes the row, its status event
-- and the reminder cancellation; one failure rolls back the whole slot. Runs as the user
-- (RLS). Returns one result per transition, in input order.
create function public.apply_parent_slot_status_transition(target_parent_behavior_id uuid, transitions jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  item jsonb;
  results jsonb := '[]'::jsonb;
begin
  if current_user_id is null then
    raise exception 'Occurrence status changes require an authenticated user.' using errcode = '42501';
  end if;
  if transitions is null or jsonb_typeof(transitions) <> 'array' or jsonb_array_length(transitions) = 0 then
    raise exception 'A parent slot change needs at least one sub-behavior Occurrence.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.behaviors parent
    where parent.user_id = current_user_id and parent.id = target_parent_behavior_id
      and parent.parent_behavior_id is null
  ) then
    raise exception 'Parent Behavior not found.' using errcode = 'P0002';
  end if;
  if (select count(distinct value ->> 'occurrence_id') from jsonb_array_elements(transitions)) <> jsonb_array_length(transitions) then
    raise exception 'Each sub-behavior Occurrence may appear once.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(transitions) entry
    left join public.occurrences occurrence
      on occurrence.user_id = current_user_id and occurrence.id = nullif(entry.value ->> 'occurrence_id', '')::uuid
    left join public.behaviors child
      on child.user_id = current_user_id and child.id = occurrence.behavior_id
    where child.parent_behavior_id is distinct from target_parent_behavior_id
  ) then
    raise exception 'Every Occurrence must belong to a sub-behavior of this parent.' using errcode = '22023';
  end if;
  if (
    select count(distinct occurrence.local_date)
    from jsonb_array_elements(transitions) entry
    join public.occurrences occurrence
      on occurrence.user_id = current_user_id and occurrence.id = (entry.value ->> 'occurrence_id')::uuid
  ) <> 1 then
    raise exception 'A parent slot covers one local day.' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(transitions) loop
    results := results || jsonb_build_array(public.apply_occurrence_status_transition(
      (item ->> 'occurrence_id')::uuid,
      item ->> 'expected_status',
      nullif(item ->> 'expected_latest_event_id', '')::uuid,
      item ->> 'planned_status',
      nullif(item ->> 'planned_completed_at', '')::timestamptz,
      nullif(item ->> 'planned_status_marked_at', '')::timestamptz,
      nullif(item ->> 'planned_event_semantics', ''),
      nullif(item ->> 'planned_event_recorded_at', '')::timestamptz,
      nullif(item ->> 'planned_event_effective_at', '')::timestamptz,
      nullif(item ->> 'planned_event_source_capture_method', ''),
      nullif(item ->> 'planned_event_source_confidence', ''),
      (item ->> 'planned_cancel_pending_reminders')::boolean
    ));
  end loop;
  return jsonb_build_object('parent_behavior_id', target_parent_behavior_id, 'results', results);
end;
$$;

revoke all on function public.apply_parent_slot_status_transition(uuid, jsonb) from public, anon, service_role;
grant execute on function public.apply_parent_slot_status_transition(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------ account sync contract 9

insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values
  (9, 'behavior', 'parent_behavior_id', 'null'::jsonb),
  (9, 'behavior', 'sub_behavior_sort_order', '0'::jsonb),
  (9, 'behavior', 'inherit_parent_schedule', 'false'::jsonb);

commit;
