-- Ticket 292: account sync contract 4 carries the day-note Note shortcuts pool.
--
-- The pool is the note_shortcut_states row with id 'day_notes' (migration
-- 20261111120000). Shipped Mac builds (contracts 1-3) reject a Note shortcut state
-- whose ID is not 'global' or a Behavior UUID, so they must never receive it.
-- The existing registry hides a whole kind or one field; this pool is one row of
-- an existing kind. A small row registry hides it instead:
--   - contracts below a row's contract do not receive it, in reads, apply checks
--     and fingerprints, and any write to it from them is rejected;
--   - account_sync_current_contract() is the highest contract in either registry.
-- This migration replaces 20261111120000's snapshot filter with that rule.
begin;

create table cadence_private.account_sync_contract_rows (
  contract integer not null check (contract > 1),
  kind text not null check (kind ~ '^[a-z_]+$'),
  id text not null check (id <> ''),
  primary key (kind, id)
);
revoke all on table cadence_private.account_sync_contract_rows from public, anon, authenticated, service_role;
grant select on table cadence_private.account_sync_contract_rows to authenticated;

insert into cadence_private.account_sync_contract_rows (contract, kind, id)
values (4, 'note_shortcut_state', 'day_notes');

create or replace function cadence_private.account_sync_current_contract()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(
    1,
    coalesce((select max(contract) from cadence_private.account_sync_contract_additions), 1),
    coalesce((select max(contract) from cadence_private.account_sync_contract_rows), 1)
  )
$$;

create or replace function cadence_private.project_account_sync_snapshot(snapshot jsonb, target_contract integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  projected jsonb;
begin
  if target_contract is null or target_contract < 1 or target_contract > cadence_private.account_sync_current_contract() then
    raise exception 'The account synchronization contract is not supported.' using errcode = '22023';
  end if;
  if target_contract = cadence_private.account_sync_current_contract() then
    return snapshot;
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object('kind', entity ->> 'kind', 'id', entity ->> 'id',
      'value', (entity -> 'value') - coalesce(hidden.fields, array[]::text[]))
    order by entity ->> 'kind' collate "C", entity ->> 'id' collate "C"
  ), '[]'::jsonb) into projected
  from jsonb_array_elements(snapshot -> 'entities') entity
  left join lateral (
    select array_agg(addition.field) as fields
    from cadence_private.account_sync_contract_additions addition
    where addition.kind = entity ->> 'kind' and addition.field is not null and addition.contract > target_contract
  ) hidden on true
  where not exists (
    select 1 from cadence_private.account_sync_contract_additions addition
    where addition.kind = entity ->> 'kind' and addition.field is null and addition.contract > target_contract
  )
  and not exists (
    select 1 from cadence_private.account_sync_contract_rows hidden_row
    where hidden_row.kind = entity ->> 'kind' and hidden_row.id = entity ->> 'id' and hidden_row.contract > target_contract
  );
  return snapshot || jsonb_build_object(
    'entities', projected,
    'fingerprint', cadence_private.account_sync_fingerprint(projected)
  );
end;
$$;

revoke all on function cadence_private.account_sync_current_contract() from public, anon, service_role;
revoke all on function cadence_private.project_account_sync_snapshot(jsonb, integer) from public, anon, service_role;
grant execute on function cadence_private.account_sync_current_contract() to authenticated;
grant execute on function cadence_private.project_account_sync_snapshot(jsonb, integer) to authenticated;

do $migration$
declare
  definition text;
  anchor text;
begin
  -- Lift 20261111120000's filter: the projection above now hides the row from contracts 1-3.
  select pg_get_functiondef('cadence_private.account_sync_snapshot()'::regprocedure) into definition;
  anchor := $a$ from public.note_shortcut_states r where r.user_id = current_user_id and r.id <> 'day_notes'$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account snapshot changed unexpectedly.';
  end if;
  execute replace(definition, anchor, $patch$ from public.note_shortcut_states r where r.user_id = current_user_id$patch$);

  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;

  -- Reject any write to a row the client's contract cannot see, before other checks.
  anchor := $a$  -- An older contract cannot see later fields or kinds.$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync contract check changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, $patch$  -- An older contract cannot see later rows of a known kind (Ticket 292's day-note pool).
  if exists (
    select 1
    from jsonb_array_elements(sync_payload #> '{plan,writes}') item(w)
    join cadence_private.account_sync_contract_rows hidden_row
      on hidden_row.kind = item.w ->> 'kind' and hidden_row.id = item.w ->> 'id'
    where hidden_row.contract > v_contract
  ) then
    raise exception 'The account synchronization hosted write is invalid.' using errcode = '22023';
  end if;

$patch$ || anchor);

  -- Accept the 'day_notes' Note shortcut state ID only from contract 4 and later.
  anchor := $a$      if write ->> 'id' <> 'global' then
        begin target_behavior_id := (write ->> 'id')::uuid;$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account sync Note shortcut ID check changed unexpectedly.';
  end if;
  definition := replace(definition, anchor, $patch$      if write ->> 'id' = 'day_notes' and v_contract >= 4 then
        target_behavior_id := null;
      elsif write ->> 'id' <> 'global' then
        begin target_behavior_id := (write ->> 'id')::uuid;$patch$);

  execute definition;
end
$migration$;

commit;
