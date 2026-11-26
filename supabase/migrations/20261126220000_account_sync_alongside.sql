-- Alongside on Cadence for Mac (Ticket 363, docs/DECISIONS.md, 2026-11-25, D33).
--
-- 20261125140000 added behaviors.alongside and kept it hosted-only: account sync contract
-- 9 left it out, and configuration history did not record it. This migration carries it.
--
-- Configuration history: the Behavior configuration snapshot gains 'alongside' (true,
-- false or null), and changing the answer is a configuration revision with the changed
-- field 'alongside'. Existing history is not rewritten; a snapshot without the key was
-- unanswered. A configuration plan without the key (a caller written before this
-- migration, or a plan with no answer on either side) reads as keeping the stored answer,
-- as a plan without 'is_opportunity' already does.
--
-- Account sync contract 10 carries behavior.alongside. It is additive: contract-8 and
-- contract-9 writers keep syncing. Their projection hides the field, and the stored answer
-- is restored on their Behavior writes, so an older Cadence for Mac never clears it. A
-- contract-10 Behavior write must carry the field. The minimum writer contract stays 8.
--
-- Precedent: 20261122010000_sub_behaviors (contract 9). Like it, this migration replaces
-- the changed_fields check constraint (drop and add, so history may name 'alongside') and
-- inserts one row into the private contract registry. Everything else is create or
-- replace of functions with unchanged signatures.
begin;

comment on column public.behaviors.alongside is
  'The person''s answer to whether the Behavior can be done alongside other things. Null: unanswered. Part of configuration history and account sync contract 10 (Ticket 363).';

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
      'parent_behavior_id', 'inherit_parent_schedule', 'alongside'
    ]::text[]
  );

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
    'parent_behavior_id', 'inherit_parent_schedule', 'alongside'
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
      is distinct from coalesce(next_configuration -> 'inherit_parent_schedule', 'false'::jsonb) then 'inherit_parent_schedule' end,
    case when coalesce(previous_configuration -> 'alongside', 'null'::jsonb)
      is distinct from coalesce(next_configuration -> 'alongside', 'null'::jsonb) then 'alongside' end
  ]::text[], null) end;
$$;

-- A plan without the 'alongside' key keeps the stored answer.
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
      || case when planned ? 'alongside' or not (coalesce(stored, '{}'::jsonb) ? 'alongside') then '{}'::jsonb
        else jsonb_build_object('alongside', stored -> 'alongside') end
  end;
$$;

revoke all on function cadence_private.behavior_configuration_with_run(jsonb, jsonb) from public, anon, authenticated;

-- The changed fields a plan must list: a plan without the 'alongside' key names no answer change.
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
      and not (field = 'alongside' and not coalesce(planned_next ? 'alongside', false))
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
  -- Snapshot: the answer, always present.
  select pg_get_functiondef('cadence_private.current_behavior_configuration_snapshot(uuid,uuid)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    'inherit_parent_schedule', behavior.inherit_parent_schedule
  )$a$, $p$    'inherit_parent_schedule', behavior.inherit_parent_schedule,
    'alongside', behavior.alongside
  )$p$, 'Behavior configuration snapshot');
  execute definition;

  -- Account sync snapshot: contract 10 carries the answer; older contracts' projection hides it.
  select pg_get_functiondef('cadence_private.account_sync_snapshot()'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$union all select 'behavior', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - array['user_id', 'alongside']) from public.behaviors r$a$,
    $p$union all select 'behavior', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behaviors r$p$,
    'Account snapshot Behavior row');
  execute definition;

  -- Account sync apply: the stored rows compare in the snapshot's shape again, synced
  -- writes insert and update the answer (an older contract's write carries the stored
  -- one, restored above in the function), and a contract-10 Behavior write must carry it.
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$'select cadence_private.normalize_account_sync_row(to_jsonb(owned_row) - array[''user_id'', ''effective_start_at'', ''effective_end_at'', ''alongside'']) from %s owned_row where user_id = $1 and id = $2 for update'$a$,
    $p$'select cadence_private.normalize_account_sync_row(to_jsonb(owned_row) - array[''user_id'', ''effective_start_at'', ''effective_end_at'']) from %s owned_row where user_id = $1 and id = $2 for update'$p$,
    'Account sync apply stored row');
  definition := pg_temp.patch_definition(definition,
    $a$and behavior_write -> 'expected' = cadence_private.normalize_account_sync_row(to_jsonb(behavior) - array['user_id', 'alongside'])$a$,
    $p$and behavior_write -> 'expected' = cadence_private.normalize_account_sync_row(to_jsonb(behavior) - 'user_id')$p$,
    'Account sync apply guarded Behavior rewrite');
  definition := pg_temp.patch_definition(definition,
    $a$and attribute.attname <> 'id' and attribute.attname not in ('effective_start_at', 'effective_end_at', 'alongside')$a$,
    $p$and attribute.attname <> 'id' and attribute.attname not in ('effective_start_at', 'effective_end_at')$p$,
    'Account sync apply update list');
  definition := pg_temp.patch_definition(definition,
    $a$and attribute.attgenerated = '' and attribute.attname not in ('effective_start_at', 'effective_end_at', 'alongside');$a$,
    $p$and attribute.attgenerated = '' and attribute.attname not in ('effective_start_at', 'effective_end_at');$p$,
    'Account sync apply insert list');
  definition := pg_temp.patch_definition(definition, $a$    if write_kind = 'behavior' and v_contract >= 9 and not ((write -> 'value') ?& array[
      'parent_behavior_id', 'sub_behavior_sort_order', 'inherit_parent_schedule'
    ]) then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;$a$, $p$    if write_kind = 'behavior' and v_contract >= 9 and not ((write -> 'value') ?& array[
      'parent_behavior_id', 'sub_behavior_sort_order', 'inherit_parent_schedule'
    ]) then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;
    if write_kind = 'behavior' and v_contract >= 10 and not ((write -> 'value') ? 'alongside') then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;$p$, 'Account sync Behavior alongside guard');
  execute definition;
end
$migration$;

drop function pg_temp.patch_definition(text, text, text, text);

-- ------------------------------------------------------------------ account sync contract 10

insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values (10, 'behavior', 'alongside', 'null'::jsonb);

commit;
