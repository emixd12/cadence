-- A first Mac link for a large account timed out in apply_account_sync_plan
-- (November 12, 2026: "canceling statement due to statement timeout", HTTP 500).
--
-- Cause: PostgREST applies a function's own statement_timeout to the transaction, and
-- read_account_sync_snapshot sets 25s, but public.apply_account_sync_plan set none, so
-- the apply ran under the authenticated role's 8s limit. The apply also built the full
-- account snapshot up to three times (about 2 s each for 2,500 Occurrences):
-- before the compare, again to restore fields an older contract cannot see, and
-- after the writes.
--
-- Fix, with the same signature and results for every caller:
-- 1. public.apply_account_sync_plan gets the read's 25s statement timeout.
-- 2. The apply builds the snapshot once before the compare and reuses it for the
--    older-contract restore. Nothing writes between the two reads.
-- 3. A plan with no hosted writes (a first-link hydrate) reuses the compared snapshot
--    as its result instead of building it again. No row changes in between.
begin;

create or replace function public.apply_account_sync_plan(sync_payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
set statement_timeout = '25s'
as $$
  select cadence_private.apply_account_sync_plan(sync_payload)
$$;

revoke all on function public.apply_account_sync_plan(jsonb) from public, anon, service_role;
grant execute on function public.apply_account_sync_plan(jsonb) to authenticated;

do $migration$
declare
  definition text;
  anchor text;
  replacement text;
begin
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;

  -- 2. One build before the compare, kept for the older-contract restore.
  anchor := E'\n  current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);\n  if current_snapshot ->> ''fingerprint'' <> sync_payload ->> ''hostedFingerprint'' then';
  replacement := E'\n  full_snapshot := cadence_private.account_sync_snapshot();\n  current_snapshot := cadence_private.project_account_sync_snapshot(full_snapshot, v_contract);\n  if current_snapshot ->> ''fingerprint'' <> sync_payload ->> ''hostedFingerprint'' then';
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync compare read changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, replacement);

  anchor := E'\n    full_snapshot := cadence_private.account_sync_snapshot();\n    sync_payload := jsonb_set(';
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync restore read changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, E'\n    sync_payload := jsonb_set(');

  -- 3. No hosted writes: the compared snapshot is the result.
  anchor := E'\n  current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);\n  if current_snapshot ->> ''fingerprint'' <> sync_payload #>> ''{plan,mergedFingerprint}'' then';
  replacement := E'\n  if jsonb_array_length(sync_payload #> ''{plan,writes}'') > 0 then\n    current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);\n  end if;\n  if current_snapshot ->> ''fingerprint'' <> sync_payload #>> ''{plan,mergedFingerprint}'' then';
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync result read changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, replacement);

  execute definition;
end
$migration$;

commit;
