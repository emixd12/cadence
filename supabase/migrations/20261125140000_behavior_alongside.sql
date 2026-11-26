-- Alongside Behaviors (Ticket 356, docs/DECISIONS.md, 2026-11-25, D33).
--
-- behaviors.alongside is the person's answer to "Can this be done alongside other
-- things?". Null means unanswered; then readers fall back to the cached model guess in
-- behavior_advisor_estimates, then false (alongside.resolver.ts). No default.
--
-- The definition RPCs store it: create takes it from the payload, update changes it only
-- when the payload carries the key. An RPC change is a revision (updated_at).
--
-- Hosted-only until Ticket 363. Account sync contract 9 does not carry the column: the
-- snapshot leaves it out, a device's expected row is compared without it, and a synced
-- Behavior write never inserts or updates it, so a Mac write keeps the stored answer.
-- Carrying it needs a contract bump with the Mac's SQLite column (Ticket 363). The
-- Behavior configuration snapshot is synced history, so the setting joins configuration
-- history in that same contract.
begin;

alter table public.behaviors
  add column alongside boolean;

comment on column public.behaviors.alongside is
  'The person''s answer to whether the Behavior can be done alongside other things. Null: unanswered. Hosted-only until account sync carries it (Ticket 363).';

-- The update RPC lists every trigger column in its SET list, so set_behaviors_updated_at
-- already fires when the RPC changes the answer. The trigger itself is left unchanged: no
-- writer updates alongside alone, and the migration stays additive (docs/DECISIONS.md,
-- 2026-11-10, "Standing approval for additive hosted migrations").

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
  -- Create: the payload may carry the answer; without it the Behavior is unanswered.
  select pg_get_functiondef('public.create_behavior_with_schedule_graph(jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    inherit_parent_schedule,
    id,
    created_at,$a$, $p$    inherit_parent_schedule,
    alongside,
    id,
    created_at,$p$, 'Behavior create columns');
  definition := pg_temp.patch_definition(definition, $a$    coalesce(nullif(behavior_payload ->> 'inherit_parent_schedule', '')::boolean, false),
    coalesce(nullif(behavior_payload ->> 'id', '')::uuid, gen_random_uuid()),$a$, $p$    coalesce(nullif(behavior_payload ->> 'inherit_parent_schedule', '')::boolean, false),
    nullif(behavior_payload ->> 'alongside', '')::boolean,
    coalesce(nullif(behavior_payload ->> 'id', '')::uuid, gen_random_uuid()),$p$, 'Behavior create values');
  execute definition;

  -- Update: the answer changes only when the payload carries the key; JSON null clears it.
  select pg_get_functiondef('public.update_behavior_with_schedule_graph(uuid,jsonb,jsonb,jsonb,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$      else current_behavior.inherit_parent_schedule end,
    auto_archived_at = case$a$, $p$      else current_behavior.inherit_parent_schedule end,
    alongside = case when behavior_payload ? 'alongside'
      then nullif(behavior_payload ->> 'alongside', '')::boolean
      else current_behavior.alongside end,
    auto_archived_at = case$p$, 'Behavior update fields');
  execute definition;

  -- Account sync snapshot: contract 9 has no alongside field.
  select pg_get_functiondef('cadence_private.account_sync_snapshot()'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$union all select 'behavior', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behaviors r$a$,
    $p$union all select 'behavior', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - array['user_id', 'alongside']) from public.behaviors r$p$,
    'Account snapshot Behavior row');
  execute definition;

  -- Account sync apply: the stored rows a device's expected value is compared with have
  -- the snapshot's shape, and a synced write never inserts or updates the answer.
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$'select cadence_private.normalize_account_sync_row(to_jsonb(owned_row) - array[''user_id'', ''effective_start_at'', ''effective_end_at'']) from %s owned_row where user_id = $1 and id = $2 for update'$a$,
    $p$'select cadence_private.normalize_account_sync_row(to_jsonb(owned_row) - array[''user_id'', ''effective_start_at'', ''effective_end_at'', ''alongside'']) from %s owned_row where user_id = $1 and id = $2 for update'$p$,
    'Account sync apply stored row');
  definition := pg_temp.patch_definition(definition,
    $a$and behavior_write -> 'expected' = cadence_private.normalize_account_sync_row(to_jsonb(behavior) - 'user_id')$a$,
    $p$and behavior_write -> 'expected' = cadence_private.normalize_account_sync_row(to_jsonb(behavior) - array['user_id', 'alongside'])$p$,
    'Account sync apply guarded Behavior rewrite');
  definition := pg_temp.patch_definition(definition,
    $a$and attribute.attname <> 'id' and attribute.attname not in ('effective_start_at', 'effective_end_at')$a$,
    $p$and attribute.attname <> 'id' and attribute.attname not in ('effective_start_at', 'effective_end_at', 'alongside')$p$,
    'Account sync apply update list');
  definition := pg_temp.patch_definition(definition,
    $a$and attribute.attgenerated = '' and attribute.attname not in ('effective_start_at', 'effective_end_at');$a$,
    $p$and attribute.attgenerated = '' and attribute.attname not in ('effective_start_at', 'effective_end_at', 'alongside');$p$,
    'Account sync apply insert list');
  execute definition;
end
$migration$;

drop function pg_temp.patch_definition(text, text, text, text);

commit;
