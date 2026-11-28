-- Alongside answer history and released Cadence for Mac builds (Ticket 363, D33).
--
-- 20261126220000 makes the alongside answer part of configuration history: a revision
-- that changes the answer names 'alongside' in changed_fields and carries the answer in
-- both snapshots. Released Mac builds speak account sync contracts 8 and 9. They store
-- configuration events as untyped JSON, but their export rejects a changed field it does
-- not know ("Unsupported behavior configuration changed fields."), and their SQLite table
-- requires a non-empty changed_fields and a revision whose two snapshots differ. So no
-- event a contract below 10 reads may name the answer.
--
-- For contracts below 10 (the row rule 'alongside_history' in the registry 20261126250000
-- added), the projection:
--   - removes 'alongside' from every configuration event's changed_fields and from both
--     of its snapshots;
--   - hides each revision whose only changed field is 'alongside' (after the removal it
--     would change nothing), and
--   - presents a Behavior or an Occurrence that points at a hidden revision as pointing at
--     the closest earlier visible revision of the same Behavior (by recorded_at, then
--     created_at and id). A baseline always names other fields, so one always exists.
-- Hidden revisions change nothing such a client can see, so its chain stays consistent:
-- the next visible revision's previous snapshot, without the answer, equals that earlier
-- revision's next snapshot. An older contract's apply maps a pointer it read back to the
-- stored hidden revision when its write keeps the pointer, so its compare-and-set checks
-- and the result check see the stored rows; a write that moves the pointer (its own edit)
-- stores the new pointer. Contract 10 and later read every event unchanged.
--
-- An unanswered Behavior's history never names the answer (20261126220000), so with the
-- web flag CADENCE_ALONGSIDE off no such event exists and this projection changes nothing.
-- It is additive: the account sync contract stays 11 and the minimum writer contract 8.
--
-- Not on the standing-approval additive list (docs/DECISIONS.md, 2026-11-10): the registry
-- insert, and replacing project_account_sync_snapshot and apply_account_sync_plan with a
-- changed result for contracts below 10. No drop, no constraint or trigger replacement, no
-- write to a user table.
begin;

insert into cadence_private.account_sync_contract_row_rules (contract, kind, rule)
values (10, 'configuration_event', 'alongside_history');

-- For one snapshot and contract: each hidden alongside-only revision's ID, mapped to the
-- closest earlier visible revision of its Behavior. Empty when the contract reads the answer.
create function cadence_private.account_sync_hidden_configuration_events(snapshot jsonb, target_contract integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with events as (
    select entity ->> 'id' as id,
      entity #>> '{value,behavior_id}' as behavior_id,
      entity #>> '{value,recorded_at}' as recorded_at,
      entity #>> '{value,created_at}' as created_at,
      entity #>> '{value,event_kind}' = 'revision'
        and entity #> '{value,changed_fields}' = '["alongside"]'::jsonb as hidden
    from jsonb_array_elements(snapshot -> 'entities') entity
    where entity ->> 'kind' = 'configuration_event'
      and exists (
        select 1 from cadence_private.account_sync_contract_row_rules row_rule
        where row_rule.kind = 'configuration_event' and row_rule.rule = 'alongside_history'
          and row_rule.contract > target_contract
      )
  ), grouped as (
    select events.*,
      count(*) filter (where not hidden) over (
        partition by behavior_id
        order by recorded_at collate "C", created_at collate "C", id collate "C"
      ) as visible_count
    from events
  )
  select coalesce(jsonb_object_agg(hidden_event.id, visible_event.id), '{}'::jsonb)
  from grouped hidden_event
  join grouped visible_event
    on visible_event.behavior_id = hidden_event.behavior_id
    and visible_event.visible_count = hidden_event.visible_count
    and not visible_event.hidden
  where hidden_event.hidden and hidden_event.visible_count > 0
$$;

-- One entity's value as a contract below 10 reads it.
create function cadence_private.account_sync_value_without_alongside_history(kind text, value jsonb, hidden_events jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when kind = 'configuration_event' and jsonb_typeof(value) = 'object' then value || jsonb_build_object(
      'changed_fields', coalesce((
        select jsonb_agg(field order by position)
        from jsonb_array_elements(value -> 'changed_fields') with ordinality listed(field, position)
        where field <> '"alongside"'::jsonb
      ), '[]'::jsonb),
      'previous_configuration', case when jsonb_typeof(value -> 'previous_configuration') = 'object'
        then (value -> 'previous_configuration') - 'alongside' else value -> 'previous_configuration' end,
      'next_configuration', case when jsonb_typeof(value -> 'next_configuration') = 'object'
        then (value -> 'next_configuration') - 'alongside' else value -> 'next_configuration' end)
    when kind = 'behavior' and hidden_events ? (value ->> 'current_configuration_event_id')
      then jsonb_set(value, '{current_configuration_event_id}', hidden_events -> (value ->> 'current_configuration_event_id'))
    when kind = 'occurrence' and hidden_events ? (value ->> 'behavior_configuration_event_id')
      then jsonb_set(value, '{behavior_configuration_event_id}', hidden_events -> (value ->> 'behavior_configuration_event_id'))
    else value
  end
$$;

-- 20261126250000's projection, plus the alongside history rule for contracts below 10.
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
  hidden_events jsonb;
  without_alongside_history boolean;
begin
  if target_contract is null or target_contract < 1 or target_contract > cadence_private.account_sync_current_contract() then
    raise exception 'The account synchronization contract is not supported.' using errcode = '22023';
  end if;
  if target_contract = cadence_private.account_sync_current_contract() then
    return snapshot;
  end if;
  hidden_guesses := cadence_private.account_sync_hidden_guess_dismissals(snapshot, target_contract);
  without_alongside_history := exists (
    select 1 from cadence_private.account_sync_contract_row_rules row_rule
    where row_rule.kind = 'configuration_event' and row_rule.rule = 'alongside_history'
      and row_rule.contract > target_contract
  );
  hidden_events := cadence_private.account_sync_hidden_configuration_events(snapshot, target_contract);
  select coalesce(jsonb_agg(
    jsonb_build_object('kind', entity ->> 'kind', 'id', entity ->> 'id',
      'value', case when without_alongside_history
        then cadence_private.account_sync_value_without_alongside_history(
          entity ->> 'kind', (entity -> 'value') - coalesce(hidden.fields, array[]::text[]), hidden_events)
        else (entity -> 'value') - coalesce(hidden.fields, array[]::text[]) end)
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
  and not (entity ->> 'kind' = 'where_suggestion_dismissal' and entity ->> 'id' = any(hidden_guesses))
  and not (entity ->> 'kind' = 'configuration_event' and hidden_events ? (entity ->> 'id'));
  return snapshot || jsonb_build_object(
    'entities', projected,
    'fingerprint', cadence_private.account_sync_fingerprint(projected)
  );
end;
$$;

revoke all on function cadence_private.account_sync_hidden_configuration_events(jsonb, integer) from public, anon, service_role;
revoke all on function cadence_private.account_sync_value_without_alongside_history(text, jsonb, jsonb) from public, anon, service_role;
revoke all on function cadence_private.project_account_sync_snapshot(jsonb, integer) from public, anon, service_role;
grant execute on function cadence_private.account_sync_hidden_configuration_events(jsonb, integer) to authenticated;
grant execute on function cadence_private.account_sync_value_without_alongside_history(text, jsonb, jsonb) to authenticated;
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

  definition := pg_temp.patch_definition(definition, $a$  hidden_guesses text[] := array[]::text[];
  kept_entities jsonb;
begin$a$, $p$  hidden_guesses text[] := array[]::text[];
  kept_entities jsonb;
  hidden_events jsonb := '{}'::jsonb;
begin$p$, 'Account sync apply declarations');

  -- Before the compare-and-set loop: a pointer this contract read as an earlier revision
  -- is the stored hidden revision again when the write keeps it.
  definition := pg_temp.patch_definition(definition, $a$  -- Validate and lock every compare-and-set before the first product write.$a$,
    $p$  -- 20261126260000: an older contract reads a pointer at a hidden alongside-only revision
  -- as the closest earlier visible one. A write that keeps that pointer keeps the stored one.
  hidden_events := cadence_private.account_sync_hidden_configuration_events(full_snapshot, v_contract);
  if hidden_events <> '{}'::jsonb then
    sync_payload := jsonb_set(sync_payload, '{plan,writes}', coalesce((
      select jsonb_agg(case
        when stored.pointer is null then item.w
        else item.w
          || case when item.w ->> 'operation' = 'upsert'
              and item.w #>> array['value', pointer.field] = hidden_events ->> stored.pointer
            then jsonb_build_object('value', jsonb_set(item.w -> 'value', array[pointer.field], to_jsonb(stored.pointer)))
            else '{}'::jsonb end
          || case when jsonb_typeof(item.w -> 'expected') = 'object'
              and item.w #>> array['expected', pointer.field] = hidden_events ->> stored.pointer
            then jsonb_build_object('expected', jsonb_set(item.w -> 'expected', array[pointer.field], to_jsonb(stored.pointer)))
            else '{}'::jsonb end
      end order by item.ordinality)
      from jsonb_array_elements(sync_payload #> '{plan,writes}') with ordinality item(w, ordinality)
      cross join lateral (
        select case item.w ->> 'kind'
          when 'behavior' then 'current_configuration_event_id'
          when 'occurrence' then 'behavior_configuration_event_id'
        end as field
      ) pointer
      left join lateral (
        select entity #>> array['value', pointer.field] as pointer
        from jsonb_array_elements(full_snapshot -> 'entities') entity
        where pointer.field is not null
          and entity ->> 'kind' = item.w ->> 'kind' and entity ->> 'id' = item.w ->> 'id'
          and hidden_events ? (entity #>> array['value', pointer.field])
      ) stored on true
    ), '[]'::jsonb));
  end if;

  -- Validate and lock every compare-and-set before the first product write.$p$,
    'Account sync apply hidden configuration events');

  execute definition;
end
$migration$;

drop function pg_temp.patch_definition(text, text, text, text);

commit;
