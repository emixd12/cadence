-- Alongside in the MCP contract and portable data (Ticket 364, docs/DECISIONS.md,
-- 2026-11-25, D33). Additive: every function keeps its signature, security and grants,
-- and no table changes. Needs 20261125140000_behavior_alongside.sql first.
--
-- 1. MCP Behavior write receipts keep `alongside`, so create_behavior and update_behavior
--    report the stored answer (the receipt source is an allowlist).
-- 2. BehaviorLog import stores the plan row's `cadenceAlongside` on a created Behavior.
--    A plan without it creates an unanswered Behavior, as before.
-- 3. BehaviorLog restore writes `alongside` from the restored record; an update changes it
--    only when the record carries the key, so older bundles keep the stored answer.
--
-- The web app sends `alongside` (and plans carry `cadenceAlongside`) only while
-- CADENCE_ALONGSIDE is on. With the flag off these paths receive the same payloads as
-- before and store the same rows. The cached model guess is never written here.
begin;

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
  -- 1. MCP receipt source.
  select pg_get_functiondef('cadence_private.integration_write_source(jsonb,text)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$'auto_archived_at','is_opportunity','end_on',$a$,
    $p$'auto_archived_at','is_opportunity','alongside','end_on',$p$, 'Integration write source alongside');
  execute definition;

  -- 2. BehaviorLog import (create-only and approved merge both insert here).
  select pg_get_functiondef('cadence_private.apply_behaviorlog_import(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$pause_back_on, auto_archived_at, archived_at, archive_notes,$a$,
    $p$pause_back_on, auto_archived_at, alongside, archived_at, archive_notes,$p$, 'BehaviorLog import columns');
  definition := pg_temp.patch_definition(definition, $a$        nullif(row_value ->> 'cadenceAutoArchivedAt', '')::timestamptz,$a$,
    $p$        nullif(row_value ->> 'cadenceAutoArchivedAt', '')::timestamptz,
        nullif(row_value ->> 'cadenceAlongside', '')::boolean,$p$, 'BehaviorLog import values');
  execute definition;

  -- 3. BehaviorLog restore.
  select pg_get_functiondef('public.apply_behaviorlog_restore_product_writes(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    archive_notes,
    is_opportunity,
    created_at,$a$, $p$    archive_notes,
    is_opportunity,
    alongside,
    created_at,$p$, 'BehaviorLog restore columns');
  definition := pg_temp.patch_definition(definition, $a$    coalesce((row ->> 'is_opportunity')::boolean, false),
$a$, $p$    coalesce((row ->> 'is_opportunity')::boolean, false),
    nullif(row ->> 'alongside', '')::boolean,
$p$, 'BehaviorLog restore values');
  definition := pg_temp.patch_definition(definition, $a$    ) then excluded.is_opportunity else public.behaviors.is_opportunity end,
$a$, $p$    ) then excluded.is_opportunity else public.behaviors.is_opportunity end,
    alongside = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'alongside'
    ) then excluded.alongside else public.behaviors.alongside end,
$p$, 'BehaviorLog restore alongside');
  execute definition;
end;
$migration$;

drop function pg_temp.patch_definition(text, text, text, text);

commit;
