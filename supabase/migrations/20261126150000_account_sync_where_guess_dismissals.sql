-- Ticket 383 (D37), Cadence for Mac: account sync contract 11 carries a guess dismissal
-- stored while Completion places is off.
--
-- 20261126130000 lets the web store a dismissal of a model guess (suggestion 'home',
-- 'anywhere' or 'add_place') while place_label_settings.enabled is off. Mac builds on
-- contracts 8 to 10 cannot hold such a row: their shared planner drops every dismissal
-- while labels are off, so an ordinary sync would delete it from the hosted account, and
-- their SQLite trigger (desktop migration 0020) refuses it, so a first-link replacement
-- would fail. Contract 11 builds keep it (desktop migration 0030 and the planner rule in
-- packages/core/src/resolvers/account-sync.resolver.ts).
--
-- The existing registries hide a whole kind, one field, or one fixed row ID. This row is
-- one of an existing kind, chosen by its values and by the account's settings, so a third
-- registry names a rule instead:
--   - account_sync_contract_row_rules holds (contract, kind, rule); the one rule,
--     'guess_dismissal_without_labels', hides from contracts below 11 every
--     where_suggestion_dismissal with a guess suggestion while labels are not on;
--   - the projection applies it to reads, apply checks and fingerprints;
--   - an older contract's apply keeps rows hidden when it read the snapshot out of its
--     result, even when its own plan turns labels on (the next read shows them), and an
--     older contract's dismissal upsert for a hidden row replaces it, since that build
--     could not see it;
--   - account_sync_current_contract() is the highest contract in any registry.
-- It is additive: the minimum writer contract stays 8.
--
-- Not on the standing-approval additive list (docs/DECISIONS.md, 2026-11-10): the
-- registry insert, and replacing project_account_sync_snapshot and
-- apply_account_sync_plan with a changed result for contracts below 11. No drop, no
-- constraint or trigger replacement, no write to a user table.
begin;

create table cadence_private.account_sync_contract_row_rules (
  contract integer not null check (contract > 1),
  kind text not null check (kind ~ '^[a-z_]+$'),
  rule text not null check (rule ~ '^[a-z_]+$'),
  primary key (kind, rule)
);
revoke all on table cadence_private.account_sync_contract_row_rules from public, anon, authenticated, service_role;
grant select on table cadence_private.account_sync_contract_row_rules to authenticated;

insert into cadence_private.account_sync_contract_row_rules (contract, kind, rule)
values (11, 'where_suggestion_dismissal', 'guess_dismissal_without_labels');

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
    coalesce((select max(contract) from cadence_private.account_sync_contract_rows), 1),
    coalesce((select max(contract) from cadence_private.account_sync_contract_row_rules), 1)
  )
$$;

-- The IDs of the guess dismissals a contract cannot see in this snapshot. The keys match
-- WHERE_GUESS_DISMISSAL_KEYS and cadence_private.require_place_labels_enabled().
create function cadence_private.account_sync_hidden_guess_dismissals(snapshot jsonb, target_contract integer)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(entity ->> 'id' order by entity ->> 'id' collate "C"), array[]::text[])
  from jsonb_array_elements(snapshot -> 'entities') entity
  where exists (
      select 1 from cadence_private.account_sync_contract_row_rules row_rule
      where row_rule.kind = 'where_suggestion_dismissal' and row_rule.rule = 'guess_dismissal_without_labels'
        and row_rule.contract > target_contract
    )
    and entity ->> 'kind' = 'where_suggestion_dismissal'
    and entity #>> '{value,suggestion}' in ('home', 'anywhere', 'add_place')
    and not exists (
      select 1 from jsonb_array_elements(snapshot -> 'entities') settings
      where settings ->> 'kind' = 'place_label_settings' and settings #> '{value,enabled}' = 'true'::jsonb
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
  hidden_guesses text[];
begin
  if target_contract is null or target_contract < 1 or target_contract > cadence_private.account_sync_current_contract() then
    raise exception 'The account synchronization contract is not supported.' using errcode = '22023';
  end if;
  if target_contract = cadence_private.account_sync_current_contract() then
    return snapshot;
  end if;
  hidden_guesses := cadence_private.account_sync_hidden_guess_dismissals(snapshot, target_contract);
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
  )
  and not (entity ->> 'kind' = 'where_suggestion_dismissal' and entity ->> 'id' = any(hidden_guesses));
  return snapshot || jsonb_build_object(
    'entities', projected,
    'fingerprint', cadence_private.account_sync_fingerprint(projected)
  );
end;
$$;

revoke all on function cadence_private.account_sync_current_contract() from public, anon, service_role;
revoke all on function cadence_private.account_sync_hidden_guess_dismissals(jsonb, integer) from public, anon, service_role;
revoke all on function cadence_private.project_account_sync_snapshot(jsonb, integer) from public, anon, service_role;
grant execute on function cadence_private.account_sync_current_contract() to authenticated;
grant execute on function cadence_private.account_sync_hidden_guess_dismissals(jsonb, integer) to authenticated;
grant execute on function cadence_private.project_account_sync_snapshot(jsonb, integer) to authenticated;

-- A small text patcher for the apply rewrite below: each anchor must occur once.
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
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;

  definition := pg_temp.patch_definition(definition, $a$  full_snapshot jsonb;
begin$a$, $p$  full_snapshot jsonb;
  hidden_guesses text[] := array[]::text[];
  kept_entities jsonb;
begin$p$, 'Account sync apply declarations');

  -- Before the compare-and-set loop: remember what this contract could not see, and let
  -- its dismissal upsert replace a hidden row (it planned against no row).
  definition := pg_temp.patch_definition(definition, $a$  -- An older contract cannot see later rows of a known kind (Ticket 292's day-note pool).$a$,
    $p$  -- Ticket 383: an older contract cannot see a guess dismissal stored while labels are off.
  hidden_guesses := cadence_private.account_sync_hidden_guess_dismissals(full_snapshot, v_contract);
  if cardinality(hidden_guesses) > 0 then
    sync_payload := jsonb_set(sync_payload, '{plan,writes}', coalesce((
      select jsonb_agg(case
        when item.w ->> 'kind' = 'where_suggestion_dismissal' and item.w ->> 'id' = any(hidden_guesses)
          and item.w ->> 'operation' = 'upsert' and item.w -> 'expected' = 'null'::jsonb
        then jsonb_set(item.w, '{expected}', stored.value)
        else item.w
      end order by item.ordinality)
      from jsonb_array_elements(sync_payload #> '{plan,writes}') with ordinality item(w, ordinality)
      left join lateral (
        select entity -> 'value' as value
        from jsonb_array_elements(full_snapshot -> 'entities') entity
        where entity ->> 'kind' = 'where_suggestion_dismissal' and entity ->> 'id' = item.w ->> 'id'
      ) stored on true
    ), '[]'::jsonb));
  end if;

  -- An older contract cannot see later rows of a known kind (Ticket 292's day-note pool).$p$,
    'Account sync apply hidden guess dismissals');

  -- After the writes: a row hidden when the plan was read stays out of its result, unless
  -- the plan wrote it. A plan that turns labels on otherwise reveals it to its own check.
  definition := pg_temp.patch_definition(definition, $a$  if jsonb_array_length(sync_payload #> '{plan,writes}') > 0 then
    current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);
  end if;$a$, $p$  if jsonb_array_length(sync_payload #> '{plan,writes}') > 0 then
    current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);
  end if;
  if cardinality(hidden_guesses) > 0 then
    select coalesce(jsonb_agg(entity order by position), '[]'::jsonb) into kept_entities
    from jsonb_array_elements(current_snapshot -> 'entities') with ordinality listed(entity, position)
    where not (entity ->> 'kind' = 'where_suggestion_dismissal' and entity ->> 'id' = any(hidden_guesses)
      and not exists (
        select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') written
        where written ->> 'kind' = 'where_suggestion_dismissal' and written ->> 'id' = entity ->> 'id'
      ));
    current_snapshot := current_snapshot || jsonb_build_object(
      'entities', kept_entities, 'fingerprint', cadence_private.account_sync_fingerprint(kept_entities));
  end if;$p$, 'Account sync apply result check');

  execute definition;
end
$migration$;

drop function pg_temp.patch_definition(text, text, text, text);

commit;
