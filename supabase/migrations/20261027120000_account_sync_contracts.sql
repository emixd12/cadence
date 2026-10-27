-- Account sync contracts: each client declares the shape it understands. The server
-- reads and verifies in that shape and preserves fields the client cannot see, so
-- additive schema changes no longer force a desktop update.
-- Plan: docs/plans/2026-10-27-sync-compatibility.md

begin;

create table cadence_private.account_sync_contract_additions (
  contract integer not null check (contract > 1),
  kind text not null,
  field text,
  default_value jsonb,
  constraint account_sync_contract_additions_kind_check check (kind ~ '^[a-z_]+$'),
  constraint account_sync_contract_additions_default_check check (field is not null or default_value is null)
);
create unique index account_sync_contract_additions_entry
  on cadence_private.account_sync_contract_additions (kind, coalesce(field, ''));
revoke all on table cadence_private.account_sync_contract_additions from public, anon, authenticated, service_role;
grant select on table cadence_private.account_sync_contract_additions to authenticated;

-- Contract 1 is the shape of desktop 0.1.5 (SQLite schema 18). Contract 2 adds
-- Ticket 217 travel habits and the Ticket 216 place-label kinds.
insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value) values
  (2, 'profile', 'travel_preparation_minutes', 'null'),
  (2, 'profile', 'travel_arrival_buffer_minutes', 'null'),
  (2, 'profile', 'travel_place_modes', '[]'),
  (2, 'profile', 'travel_leave_feedback', '[]'),
  (2, 'profile', 'travel_habits_updated_at', 'null'),
  (2, 'place_label_settings', null, null),
  (2, 'place_marker', null, null),
  (2, 'completion_place_label', null, null),
  (2, 'where_suggestion_dismissal', null, null);

create function cadence_private.account_sync_current_contract()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(1, coalesce(max(contract), 1)) from cadence_private.account_sync_contract_additions
$$;

-- Raise only for a breaking change: a rename, removal or change in meaning.
create function cadence_private.account_sync_min_writer_contract()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 1 $$;

create function cadence_private.account_sync_fingerprint(entities jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(cadence_private.canonical_account_sync_json(coalesce((
    select jsonb_agg(jsonb_set(entity, '{value}', (entity -> 'value') - 'updated_at') order by entity ->> 'kind' collate "C", entity ->> 'id' collate "C")
    from jsonb_array_elements(entities) entity
  ), '[]'::jsonb)), 'UTF8'), 'sha256'), 'hex')
$$;

create function cadence_private.account_sync_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '25s'
AS $function$
declare
  current_user_id uuid := (select auth.uid());
  entities jsonb;
  snapshot jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  with owned_entities(kind, id, value) as (
    select 'profile', 'profile', cadence_private.normalize_account_sync_row(jsonb_build_object(
      'timezone', p.timezone,
      'travel_enabled', settings.enabled,
      'base_location_text', settings.base_location_text,
      'travel_mode', settings.mode,
      'navigation_preference', settings.navigation_preference,
      'routing_consent_at', settings.routing_consent_at,
      'onboarding_completed_at', settings.onboarding_completed_at,
      'updated_at', settings.updated_at,
      'travel_preparation_minutes', settings.preparation_minutes,
      'travel_arrival_buffer_minutes', settings.arrival_buffer_minutes,
      'travel_place_modes', settings.place_modes,
      'travel_leave_feedback', settings.leave_feedback,
      'travel_habits_updated_at', settings.habits_updated_at
    ))
    from public.profiles p
    join public.travel_settings settings on settings.user_id = p.id
    where p.id = current_user_id
    union all select 'category', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.categories r where r.user_id = current_user_id
    union all select 'behavior', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behaviors r where r.user_id = current_user_id
    union all select 'schedule', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behavior_schedules r where r.user_id = current_user_id
    union all select 'schedule_slot', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behavior_schedule_slots r where r.user_id = current_user_id
    union all select 'definition_event', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behavior_definition_events r where r.user_id = current_user_id
    union all select 'configuration_event', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behavior_configuration_events r where r.user_id = current_user_id
    union all select 'occurrence', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.occurrences r where r.user_id = current_user_id
    union all select 'status_event', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.occurrence_status_events r where r.user_id = current_user_id
    union all select 'time_session', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.occurrence_time_sessions r where r.user_id = current_user_id
    union all select 'import_run', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behaviorlog_import_runs r where r.user_id = current_user_id
    union all select 'mapping', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.behaviorlog_import_record_mappings r where r.user_id = current_user_id
    union all select 'imported_note', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.imported_notes r where r.user_id = current_user_id
    union all select 'imported_intervention', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.imported_interventions r where r.user_id = current_user_id
    union all select 'reminder_delivery', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.reminder_deliveries r where r.user_id = current_user_id
    union all select 'note_shortcut_state', r.id, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.note_shortcut_states r where r.user_id = current_user_id
    union all select 'place_label_settings', r.id, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.place_label_settings r where r.user_id = current_user_id
    union all select 'place_marker', r.id, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.place_markers r where r.user_id = current_user_id
    union all select 'completion_place_label', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.completion_place_labels r where r.user_id = current_user_id
    union all select 'where_suggestion_dismissal', r.id::text, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.where_suggestion_dismissals r where r.user_id = current_user_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('kind', kind, 'id', id, 'value', value)
      order by kind collate "C", id collate "C"
    ),
    '[]'::jsonb
  )
  into entities
  from owned_entities;

  if exists (
    select 1
    from jsonb_array_elements(entities) entity
    group by entity ->> 'kind'
    having count(*) > 100000
  ) then
    raise exception 'An account synchronization collection exceeds 100,000 rows.'
      using errcode = '54000';
  end if;

  snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'userId', current_user_id,
    'fingerprint', encode(extensions.digest(convert_to(cadence_private.canonical_account_sync_json(coalesce((
      select jsonb_agg(jsonb_set(entity, '{value}', (entity -> 'value') - 'updated_at') order by entity ->> 'kind' collate "C", entity ->> 'id' collate "C")
      from jsonb_array_elements(entities) entity
    ), '[]'::jsonb)), 'UTF8'), 'sha256'), 'hex'),
    'entities', entities
  );

  if octet_length(snapshot::text) > 67108864 then
    raise exception 'The account synchronization snapshot exceeds 64 MiB.'
      using errcode = '54000';
  end if;

  return snapshot;
end;
$function$;

create function cadence_private.project_account_sync_snapshot(snapshot jsonb, target_contract integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  projected jsonb;
begin
  if target_contract < 1 or target_contract > cadence_private.account_sync_current_contract() then
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
  );
  return snapshot || jsonb_build_object(
    'entities', projected,
    'fingerprint', cadence_private.account_sync_fingerprint(projected)
  );
end;
$$;

revoke all on function cadence_private.account_sync_current_contract() from public, anon, service_role;
revoke all on function cadence_private.account_sync_min_writer_contract() from public, anon, service_role;
revoke all on function cadence_private.account_sync_fingerprint(jsonb) from public, anon, service_role;
revoke all on function cadence_private.account_sync_snapshot() from public, anon, service_role;
revoke all on function cadence_private.project_account_sync_snapshot(jsonb, integer) from public, anon, service_role;
grant execute on function cadence_private.account_sync_current_contract() to authenticated;
grant execute on function cadence_private.account_sync_min_writer_contract() to authenticated;
grant execute on function cadence_private.account_sync_fingerprint(jsonb) to authenticated;
grant execute on function cadence_private.account_sync_snapshot() to authenticated;
grant execute on function cadence_private.project_account_sync_snapshot(jsonb, integer) to authenticated;

-- Builds without a contract (0.1.5 and earlier) call this form and receive contract 1.
create or replace function public.read_account_sync_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '25s'
as $$
  select cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), 1)
$$;

create function public.read_account_sync_snapshot(contract integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '25s'
as $$
  select cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), contract)
$$;

revoke all on function public.read_account_sync_snapshot(integer) from public, anon, service_role;
grant execute on function public.read_account_sync_snapshot(integer) to authenticated;

CREATE OR REPLACE FUNCTION cadence_private.apply_account_sync_plan(sync_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := (select auth.uid());
  v_idempotency_key text := sync_payload ->> 'idempotencyKey';
  request_fingerprint text;
  expected_plan_fingerprint text := sync_payload ->> 'planFingerprint';
  current_snapshot jsonb;
  result jsonb;
  stored_receipt public.account_sync_apply_receipts%rowtype;
  write jsonb;
  stored_value jsonb;
  row_id uuid;
  target_behavior_id uuid;
  table_name text;
  update_list text;
  write_value jsonb;
  write_kind text;
  other_owner boolean;
  v_contract integer;
  full_snapshot jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if jsonb_typeof(sync_payload) is distinct from 'object'
    or octet_length(sync_payload::text) > 67108864
    or coalesce(sync_payload ->> 'schemaVersion', '') <> '1'
    or coalesce(v_idempotency_key, '') !~ '^[a-f0-9]{64}$'
    or coalesce(sync_payload ->> 'baselineFingerprint', '') !~ '^[a-f0-9]{64}$'
    or coalesce(sync_payload ->> 'localFingerprint', '') !~ '^[a-f0-9]{64}$'
    or coalesce(sync_payload ->> 'hostedFingerprint', '') !~ '^[a-f0-9]{64}$'
    or coalesce(expected_plan_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(sync_payload -> 'plan') is distinct from 'object'
    or jsonb_typeof(sync_payload #> '{plan,writes}') is distinct from 'array'
    or coalesce(sync_payload #>> '{plan,mergedFingerprint}', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(coalesce(sync_payload #> '{plan,conflicts}', '[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(sync_payload #> '{plan,conflicts}', '[]'::jsonb)) <> 0
  then
    raise exception 'The account synchronization payload is invalid.' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_object_keys(sync_payload -> 'plan')) <> 3
    or not ((sync_payload -> 'plan') ?& array['writes', 'mergedFingerprint', 'conflicts'])
  then
    raise exception 'The account synchronization plan has unsupported fields.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') item
    group by item ->> 'kind' having count(*) > 100000
  ) then
    raise exception 'An account synchronization write collection exceeds 100,000 rows.' using errcode = '54000';
  end if;

  if (select count(*) from jsonb_object_keys(sync_payload) as key) <> (case when sync_payload ? 'contract' then 9 else 8 end)
    or not (sync_payload ?& array[
      'schemaVersion', 'idempotencyKey', 'baselineFingerprint', 'localFingerprint',
      'hostedFingerprint', 'planFingerprint', 'plan', 'attemptedAt'
    ])
  then
    raise exception 'The account synchronization payload has unsupported fields.' using errcode = '22023';
  end if;

  -- A payload without a contract comes from a build that predates contracts (0.1.5 and earlier).
  if sync_payload ? 'contract' and (
    jsonb_typeof(sync_payload -> 'contract') is distinct from 'number'
    or (sync_payload ->> 'contract') !~ '^[0-9]{1,4}$'
  ) then
    raise exception 'The account synchronization contract is invalid.' using errcode = '22023';
  end if;
  v_contract := coalesce((sync_payload ->> 'contract')::integer, 1);
  if v_contract > cadence_private.account_sync_current_contract() then
    raise exception 'The account synchronization contract is not supported.' using errcode = '22023';
  end if;
  if v_contract < cadence_private.account_sync_min_writer_contract() then
    raise exception 'Update Cadence before synchronizing account data.' using errcode = '22023';
  end if;

  request_fingerprint := encode(
    extensions.digest(convert_to(cadence_private.canonical_account_sync_json(sync_payload - 'attemptedAt'), 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  select * into stored_receipt
  from public.account_sync_apply_receipts receipt
  where receipt.user_id = current_user_id
    and receipt.idempotency_key = v_idempotency_key;

  if found then
    if stored_receipt.request_fingerprint <> request_fingerprint then
      raise exception 'The account synchronization idempotency key was reused with another request.'
        using errcode = 'P0001';
    end if;
    current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);
    if current_snapshot ->> 'fingerprint' <> stored_receipt.result_fingerprint then
      raise exception 'The account changed after this synchronization receipt. Replan against the current snapshot.' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'status', 'applied',
      'fingerprint', stored_receipt.result_fingerprint,
      'snapshot', current_snapshot
    );
  end if;

  if expected_plan_fingerprint <> encode(
    extensions.digest(convert_to(cadence_private.canonical_account_sync_json(sync_payload -> 'plan'), 'UTF8'), 'sha256'),
    'hex'
  ) then
    raise exception 'The account synchronization plan fingerprint is invalid.' using errcode = '22023';
  end if;

  current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);
  if current_snapshot ->> 'fingerprint' <> sync_payload ->> 'hostedFingerprint' then
    raise exception 'The hosted account changed during synchronization.' using errcode = 'P0001';
  end if;

  -- An older contract cannot see later fields or kinds. Reject any attempt to write them,
  -- then restore their stored values (or registry defaults) so this write cannot erase them.
  if v_contract < cadence_private.account_sync_current_contract() then
    if exists (
      select 1
      from jsonb_array_elements(sync_payload #> '{plan,writes}') item(w)
      join cadence_private.account_sync_contract_additions addition
        on addition.kind = item.w ->> 'kind' and addition.contract > v_contract
      where addition.field is null
        or (item.w -> 'value') ? addition.field
        or (jsonb_typeof(item.w -> 'expected') = 'object' and (item.w -> 'expected') ? addition.field)
    ) then
      raise exception 'The account synchronization hosted write is invalid.' using errcode = '22023';
    end if;
    full_snapshot := cadence_private.account_sync_snapshot();
    sync_payload := jsonb_set(sync_payload, '{plan,writes}', coalesce((
      select jsonb_agg(case
        when hidden.restore is null or item.w ->> 'operation' <> 'upsert' then item.w
        else item.w
          || jsonb_build_object('value', hidden.restore || (item.w -> 'value'))
          || case when jsonb_typeof(item.w -> 'expected') = 'object'
            then jsonb_build_object('expected', hidden.restore || (item.w -> 'expected'))
            else '{}'::jsonb end
      end order by item.ordinality)
      from jsonb_array_elements(sync_payload #> '{plan,writes}') with ordinality item(w, ordinality)
      left join lateral (
        select jsonb_object_agg(addition.field, coalesce(stored.value -> addition.field, addition.default_value)) as restore
        from cadence_private.account_sync_contract_additions addition
        left join lateral (
          select entity -> 'value' as value
          from jsonb_array_elements(full_snapshot -> 'entities') entity
          where entity ->> 'kind' = item.w ->> 'kind' and entity ->> 'id' = item.w ->> 'id'
        ) stored on true
        where addition.kind = item.w ->> 'kind' and addition.field is not null and addition.contract > v_contract
      ) hidden on true
    ), '[]'::jsonb));
  end if;

  -- Validate and lock every compare-and-set before the first product write.
  for write in
    select value
    from jsonb_array_elements(sync_payload #> '{plan,writes}')
    order by value ->> 'kind', value ->> 'id'
  loop
    write_kind := write ->> 'kind';
    if write_kind not in (
      'profile', 'category', 'behavior', 'schedule', 'schedule_slot',
      'definition_event', 'configuration_event', 'occurrence', 'status_event',
      'time_session', 'import_run', 'mapping', 'imported_note',
      'imported_intervention', 'reminder_delivery', 'note_shortcut_state',
      'place_label_settings', 'place_marker', 'completion_place_label', 'where_suggestion_dismissal'
    )
      or write ->> 'operation' not in ('upsert', 'delete')
      or not (write ? 'expected')
      or (write ->> 'operation' = 'upsert' and (
        jsonb_typeof(write -> 'value') is distinct from 'object'
        or (write -> 'value') ? 'user_id'
        or (select count(*) from jsonb_object_keys(write)) <> 5
        or not (write ?& array['kind', 'id', 'operation', 'expected', 'value'])
      ))
      or (write ->> 'operation' = 'delete' and (
        write ? 'value'
        or (select count(*) from jsonb_object_keys(write)) <> 4
        or not (write ?& array['kind', 'id', 'operation', 'expected'])
      ))
    then
      raise exception 'The account synchronization hosted write is invalid.' using errcode = '22023';
    end if;

    if write_kind in (
      'definition_event', 'configuration_event', 'status_event',
      'mapping'
    ) and (
      write ->> 'operation' <> 'upsert' or write -> 'expected' <> 'null'::jsonb
    ) then
      raise exception 'Synchronized history and provenance are append-only.' using errcode = 'P0001';
    end if;

    if write_kind = 'profile' then
      if write ->> 'id' <> 'profile'
        or write ->> 'operation' <> 'upsert'
        or jsonb_typeof(write -> 'value') is distinct from 'object'
        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 13
        or not ((write -> 'value') ?& array[
          'timezone', 'travel_enabled', 'base_location_text', 'travel_mode',
          'navigation_preference', 'routing_consent_at',
          'onboarding_completed_at', 'updated_at',
          'travel_preparation_minutes', 'travel_arrival_buffer_minutes',
          'travel_place_modes', 'travel_leave_feedback', 'travel_habits_updated_at'
        ])
        or jsonb_typeof(write #> '{value,travel_preparation_minutes}') not in ('null', 'number')
        or (jsonb_typeof(write #> '{value,travel_preparation_minutes}') = 'number' and (
          (write #>> '{value,travel_preparation_minutes}')::numeric <> trunc((write #>> '{value,travel_preparation_minutes}')::numeric)
          or (write #>> '{value,travel_preparation_minutes}')::numeric not between 0 and 60
        ))
        or jsonb_typeof(write #> '{value,travel_arrival_buffer_minutes}') not in ('null', 'number')
        or (jsonb_typeof(write #> '{value,travel_arrival_buffer_minutes}') = 'number' and (
          (write #>> '{value,travel_arrival_buffer_minutes}')::numeric <> trunc((write #>> '{value,travel_arrival_buffer_minutes}')::numeric)
          or (write #>> '{value,travel_arrival_buffer_minutes}')::numeric not between 0 and 30
        ))
        or not cadence_private.travel_place_modes_valid(write #> '{value,travel_place_modes}')
        or not cadence_private.travel_leave_feedback_valid(write #> '{value,travel_leave_feedback}')
        or jsonb_typeof(write #> '{value,travel_habits_updated_at}') not in ('null', 'string')
        or jsonb_typeof(write #> '{value,travel_enabled}') is distinct from 'boolean'
        or (write #>> '{value,travel_mode}' is not null and write #>> '{value,travel_mode}' not in ('walking','cycling','transit','driving'))
        or (write #>> '{value,navigation_preference}' is not null and write #>> '{value,navigation_preference}' not in ('google_maps','apple_maps'))
        or (coalesce((write #>> '{value,travel_enabled}')::boolean, false) and (
          write #>> '{value,travel_mode}' is null or write #>> '{value,routing_consent_at}' is null
        ))
      then
        raise exception 'The account synchronization profile write is invalid.' using errcode = '22023';
      end if;
      select cadence_private.normalize_account_sync_row(jsonb_build_object(
        'timezone', profile.timezone,
        'travel_enabled', settings.enabled,
        'base_location_text', settings.base_location_text,
        'travel_mode', settings.mode,
        'navigation_preference', settings.navigation_preference,
        'routing_consent_at', settings.routing_consent_at,
        'onboarding_completed_at', settings.onboarding_completed_at,
        'updated_at', settings.updated_at,
        'travel_preparation_minutes', settings.preparation_minutes,
        'travel_arrival_buffer_minutes', settings.arrival_buffer_minutes,
        'travel_place_modes', settings.place_modes,
        'travel_leave_feedback', settings.leave_feedback,
        'travel_habits_updated_at', settings.habits_updated_at
      )) into stored_value
      from public.profiles profile
      join public.travel_settings settings on settings.user_id = profile.id
      where profile.id = current_user_id
      for update of profile, settings;
      if stored_value -> 'timezone' is distinct from write #> '{value,timezone}'
        and exists (
          select 1 from public.behaviors behavior
          where behavior.user_id = current_user_id
            and not exists (
              select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') behavior_write
              where behavior_write ->> 'kind' = 'behavior'
                and behavior_write ->> 'id' = behavior.id::text
                and behavior_write ->> 'operation' = 'upsert'
                and behavior_write #> '{value,timezone}' = write #> '{value,timezone}'
            )
        )
      then
        raise exception 'A profile timezone change requires every Behavior timezone write.' using errcode = 'P0001';
      end if;
    elsif write_kind = 'note_shortcut_state' then
      if write ->> 'id' <> 'global' then
        begin target_behavior_id := (write ->> 'id')::uuid;
        exception when invalid_text_representation then
          raise exception 'The Note shortcut state ID is invalid.' using errcode = '22023';
        end;
      else
        target_behavior_id := null;
      end if;
      if write ->> 'operation' = 'upsert' and (
        write #>> '{value,id}' is distinct from write ->> 'id'
        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 7
        or not ((write -> 'value') ?& array['id', 'behavior_id', 'enabled', 'entries', 'excluded_occurrence_ids', 'revision', 'updated_at'])
        or (target_behavior_id is null and jsonb_typeof(write #> '{value,behavior_id}') <> 'null')
        or (target_behavior_id is not null and write #>> '{value,behavior_id}' is distinct from target_behavior_id::text)
      ) then
        raise exception 'The Note shortcut state write is invalid.' using errcode = '22023';
      end if;
      if target_behavior_id is not null and not exists (
        select 1 from public.behaviors behavior
        where behavior.user_id = current_user_id and behavior.id = target_behavior_id
      ) then
        raise exception 'The Note shortcut Behavior does not belong to this account.' using errcode = '42501';
      end if;
      select cadence_private.normalize_account_sync_row(to_jsonb(state) - 'user_id') into stored_value
      from public.note_shortcut_states state
      where state.user_id = current_user_id and state.id = write ->> 'id'
      for update;
    elsif write_kind = 'place_label_settings' then
      if write ->> 'id' <> 'place_labels' or (write ->> 'operation' = 'upsert' and (
        write #>> '{value,id}' is distinct from write ->> 'id'
        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 6
        or not ((write -> 'value') ?& array['id', 'enabled', 'retention', 'enabled_at', 'marker_prompt_dismissed_at', 'updated_at'])
      )) then
        raise exception 'The place label settings write is invalid.' using errcode = '22023';
      end if;
      select cadence_private.normalize_account_sync_row(to_jsonb(settings) - 'user_id') into stored_value
      from public.place_label_settings settings
      where settings.user_id = current_user_id
      for update;
    elsif write_kind = 'place_marker' then
      if coalesce(write ->> 'id', '') !~ '^(home|saved_place:[A-Za-z0-9_-]{43})$' or (write ->> 'operation' = 'upsert' and (
        write #>> '{value,id}' is distinct from write ->> 'id'
        or (select count(*) from jsonb_object_keys(write -> 'value')) <> 7
        or not ((write -> 'value') ?& array['id', 'place_key', 'latitude_e6', 'longitude_e6', 'accuracy_meters', 'rule_version', 'recorded_at'])
      )) then
        raise exception 'The place marker write is invalid.' using errcode = '22023';
      end if;
      select cadence_private.normalize_account_sync_row(to_jsonb(marker) - 'user_id') into stored_value
      from public.place_markers marker
      where marker.user_id = current_user_id and marker.id = write ->> 'id'
      for update;
    else
      begin row_id := (write ->> 'id')::uuid;
      exception when invalid_text_representation then
        raise exception 'The account synchronization row ID is invalid.' using errcode = '22023';
      end;

      if write ->> 'operation' = 'upsert'
        and write #>> '{value,id}' is distinct from row_id::text
      then
        raise exception 'The account synchronization row identity is invalid.' using errcode = '22023';
      end if;

      table_name := case write_kind
        when 'category' then 'public.categories'
        when 'behavior' then 'public.behaviors'
        when 'schedule' then 'public.behavior_schedules'
        when 'schedule_slot' then 'public.behavior_schedule_slots'
        when 'definition_event' then 'public.behavior_definition_events'
        when 'configuration_event' then 'public.behavior_configuration_events'
        when 'occurrence' then 'public.occurrences'
        when 'status_event' then 'public.occurrence_status_events'
        when 'time_session' then 'public.occurrence_time_sessions'
        when 'import_run' then 'public.behaviorlog_import_runs'
        when 'mapping' then 'public.behaviorlog_import_record_mappings'
        when 'imported_note' then 'public.imported_notes'
        when 'imported_intervention' then 'public.imported_interventions'
        when 'reminder_delivery' then 'public.reminder_deliveries'
        when 'completion_place_label' then 'public.completion_place_labels'
        when 'where_suggestion_dismissal' then 'public.where_suggestion_dismissals'
      end;
      perform pg_advisory_xact_lock(hashtextextended(table_name || ':' || row_id::text, 0));
      execute format(
        'select exists(select 1 from %s owned_row where id = $1 and user_id <> $2)',
        table_name
      ) into other_owner using row_id, current_user_id;
      if other_owner then
        raise exception 'The account synchronization row belongs to another account.' using errcode = '42501';
      end if;
      execute format(
        'select cadence_private.normalize_account_sync_row(to_jsonb(owned_row) - ''user_id'') from %s owned_row where user_id = $1 and id = $2 for update',
        table_name
      ) into stored_value using current_user_id, row_id;

      if write_kind = 'occurrence' and write ->> 'operation' = 'delete' then
        if stored_value ->> 'status' <> 'unresolved'
          or coalesce(btrim(stored_value ->> 'note'), '') <> ''
          or exists (
            select 1 from public.occurrence_status_events status_event
            where status_event.user_id = current_user_id and status_event.occurrence_id = row_id
          )
          or exists (
            select 1 from public.occurrence_time_sessions time_session
            where time_session.user_id = current_user_id and time_session.occurrence_id = row_id
          )
        then
          raise exception 'An Occurrence with a Note, status history, tracked time, or resolved status is protected from synchronization deletion.' using errcode = 'P0001';
        end if;
        if exists (
          select 1
          from public.reminder_deliveries delivery
          where delivery.user_id = current_user_id
            and delivery.occurrence_id = row_id
            and not exists (
              select 1
              from jsonb_array_elements(sync_payload #> '{plan,writes}') reminder_write
              where reminder_write ->> 'kind' = 'reminder_delivery'
                and reminder_write ->> 'id' = delivery.id::text
                and reminder_write ->> 'operation' = 'delete'
                and reminder_write #>> '{expected,occurrence_id}' = row_id::text
            )
        ) then
          raise exception 'Every attached reminder must be deleted with its Occurrence.' using errcode = 'P0001';
        end if;
      end if;

      if write_kind = 'reminder_delivery' then
        if write ->> 'operation' = 'delete' and not exists (
            select 1
            from jsonb_array_elements(sync_payload #> '{plan,writes}') occurrence_write
            where occurrence_write ->> 'kind' = 'occurrence'
              and occurrence_write ->> 'id' = write #>> '{expected,occurrence_id}'
              and occurrence_write ->> 'operation' = 'delete'
          )
        then
          raise exception 'A reminder can be deleted only with its Occurrence.' using errcode = 'P0001';
        elsif write ->> 'operation' = 'upsert' and exists (
            select 1
            from jsonb_array_elements(sync_payload #> '{plan,writes}') occurrence_write
            where occurrence_write ->> 'kind' = 'occurrence'
              and occurrence_write ->> 'id' = write #>> '{value,occurrence_id}'
              and occurrence_write ->> 'operation' = 'delete'
          )
        then
          raise exception 'A retained reminder must reference a retained Occurrence.' using errcode = 'P0001';
        end if;
      end if;

      if write_kind = 'occurrence' and write ->> 'operation' = 'upsert'
        and ((stored_value is not null and stored_value -> 'status' is distinct from write #> '{value,status}') or (stored_value is null and write #>> '{value,status}' <> 'unresolved'))
        and not exists (
          select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') event_write
          where event_write ->> 'kind' = 'status_event'
            and event_write ->> 'operation' = 'upsert'
            and event_write #>> '{value,occurrence_id}' = write ->> 'id'
            and event_write #> '{value,status}' = write #> '{value,status}'
        )
      then
        raise exception 'An Occurrence status change requires append-only status history.' using errcode = 'P0001';
      end if;

      if write_kind = 'behavior' and write ->> 'operation' = 'upsert' and stored_value is not null then
        if (stored_value -> 'title' is distinct from write #> '{value,title}'
          or stored_value -> 'description' is distinct from write #> '{value,description}')
          and not exists (
            select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') event_write
            where event_write ->> 'kind' = 'definition_event'
              and event_write ->> 'operation' = 'upsert'
              and event_write #>> '{value,behavior_id}' = write ->> 'id'
          )
        then
          raise exception 'A Behavior definition change requires append-only definition history.' using errcode = 'P0001';
        end if;
        if (stored_value - array['title','description','updated_at'])
            is distinct from ((write -> 'value') - array['title','description','updated_at'])
          and not exists (
            select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') event_write
            where event_write ->> 'kind' = 'configuration_event'
              and event_write ->> 'operation' = 'upsert'
              and event_write #>> '{value,behavior_id}' = write ->> 'id'
          )
        then
          raise exception 'A Behavior configuration change requires append-only configuration history.' using errcode = 'P0001';
        end if;
      end if;

      if write_kind = 'behavior' and write ->> 'operation' = 'upsert' and stored_value is null
        and (
          not exists (
            select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') event_write
            where event_write ->> 'kind' = 'definition_event'
              and event_write ->> 'operation' = 'upsert'
              and event_write #>> '{value,behavior_id}' = write ->> 'id'
          )
          or not exists (
            select 1 from jsonb_array_elements(sync_payload #> '{plan,writes}') event_write
            where event_write ->> 'kind' = 'configuration_event'
              and event_write ->> 'operation' = 'upsert'
              and event_write #>> '{value,behavior_id}' = write ->> 'id'
              and event_write #>> '{value,event_kind}' = 'baseline'
          )
        )
      then
        raise exception 'A new Behavior requires definition and configuration baselines.' using errcode = 'P0001';
      end if;

      if write_kind = 'category' and write ->> 'operation' = 'delete'
        and exists (
          select 1
          from public.behaviors behavior
          where behavior.user_id = current_user_id
            and behavior.category_id = row_id
            and not exists (
              select 1
              from jsonb_array_elements(sync_payload #> '{plan,writes}') behavior_write
              where behavior_write ->> 'kind' = 'behavior'
                and behavior_write ->> 'id' = behavior.id::text
                and behavior_write ->> 'operation' = 'upsert'
                and behavior_write -> 'expected' = cadence_private.normalize_account_sync_row(to_jsonb(behavior) - 'user_id')
                and behavior_write #>> '{value,category_id}' is distinct from row_id::text
            )
        )
      then
        raise exception 'A referenced Category requires guarded Behavior rewrites before deletion.' using errcode = 'P0001';
      end if;

      if write_kind in (
        'behavior', 'import_run', 'imported_note', 'imported_intervention',
        'time_session'
      ) and write ->> 'operation' = 'delete' then
        raise exception 'Synchronization preserves protected product and provenance rows.' using errcode = 'P0001';
      end if;
    end if;

    if coalesce(stored_value, 'null'::jsonb) is distinct from write -> 'expected' then
      raise exception 'The hosted row changed during synchronization.' using errcode = 'P0001';
    end if;
  end loop;

  -- Apply inserts and updates in parent-before-child order.
  for write in
    select value
    from jsonb_array_elements(sync_payload #> '{plan,writes}')
    where value ->> 'operation' = 'upsert'
    order by case value ->> 'kind'
      when 'profile' then 0 when 'category' then 1 when 'import_run' then 2
      when 'behavior' then 3 when 'schedule' then 4 when 'schedule_slot' then 5
      when 'definition_event' then 6 when 'configuration_event' then 7
      when 'occurrence' then 8 when 'status_event' then 9 when 'time_session' then 10
      when 'mapping' then 11 when 'imported_note' then 12
      when 'imported_intervention' then 13 when 'reminder_delivery' then 14
      when 'note_shortcut_state' then 15 when 'place_label_settings' then 16
      when 'place_marker' then 17 when 'completion_place_label' then 18
      when 'where_suggestion_dismissal' then 19 end,
      value ->> 'id'
  loop
    write_kind := write ->> 'kind';
    if write_kind = 'profile' then
      update public.profiles set timezone = write #>> '{value,timezone}' where id = current_user_id;
      update public.travel_settings set
        enabled = (write #>> '{value,travel_enabled}')::boolean,
        base_location_text = write #>> '{value,base_location_text}',
        mode = write #>> '{value,travel_mode}',
        navigation_preference = write #>> '{value,navigation_preference}',
        routing_consent_at = nullif(write #>> '{value,routing_consent_at}', '')::timestamptz,
        onboarding_completed_at = nullif(write #>> '{value,onboarding_completed_at}', '')::timestamptz,
        updated_at = (write #>> '{value,updated_at}')::timestamptz,
        preparation_minutes = (write #>> '{value,travel_preparation_minutes}')::integer,
        arrival_buffer_minutes = (write #>> '{value,travel_arrival_buffer_minutes}')::integer,
        place_modes = write #> '{value,travel_place_modes}',
        leave_feedback = write #> '{value,travel_leave_feedback}',
        habits_updated_at = nullif(write #>> '{value,travel_habits_updated_at}', '')::timestamptz
      where user_id = current_user_id;
      continue;
    elsif write_kind = 'place_label_settings' then
      write_value := (write -> 'value') || jsonb_build_object('user_id', current_user_id);
      insert into public.place_label_settings as settings
      select (jsonb_populate_record(null::public.place_label_settings, write_value)).*
      on conflict (user_id) do update set
        enabled = excluded.enabled, retention = excluded.retention, enabled_at = excluded.enabled_at,
        marker_prompt_dismissed_at = excluded.marker_prompt_dismissed_at, updated_at = excluded.updated_at;
      continue;
    elsif write_kind = 'place_marker' then
      write_value := (write -> 'value') || jsonb_build_object('user_id', current_user_id);
      insert into public.place_markers as marker
      select (jsonb_populate_record(null::public.place_markers, write_value)).*
      on conflict (user_id, id) do update set
        place_key = excluded.place_key, latitude_e6 = excluded.latitude_e6, longitude_e6 = excluded.longitude_e6,
        accuracy_meters = excluded.accuracy_meters, rule_version = excluded.rule_version, recorded_at = excluded.recorded_at;
      continue;
    elsif write_kind = 'note_shortcut_state' then
      if write_kind = 'behavior' and not ((write -> 'value') ?& array[
      'default_duration_minutes', 'end_date', 'auto_archived_at', 'location_text', 'where_kind'
    ]) then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;
    write_value := (write -> 'value') || jsonb_build_object('user_id', current_user_id);
      insert into public.note_shortcut_states as state
      select (jsonb_populate_record(null::public.note_shortcut_states, write_value)).*
      on conflict (user_id, id) do update set
        behavior_id = excluded.behavior_id, enabled = excluded.enabled,
        entries = excluded.entries, excluded_occurrence_ids = excluded.excluded_occurrence_ids,
        revision = excluded.revision, updated_at = excluded.updated_at;
      continue;
    end if;
    row_id := (write ->> 'id')::uuid;
    table_name := case write_kind
      when 'category' then 'public.categories' when 'behavior' then 'public.behaviors'
      when 'schedule' then 'public.behavior_schedules' when 'schedule_slot' then 'public.behavior_schedule_slots'
      when 'definition_event' then 'public.behavior_definition_events' when 'configuration_event' then 'public.behavior_configuration_events'
      when 'occurrence' then 'public.occurrences' when 'status_event' then 'public.occurrence_status_events'
      when 'time_session' then 'public.occurrence_time_sessions' when 'import_run' then 'public.behaviorlog_import_runs'
      when 'mapping' then 'public.behaviorlog_import_record_mappings' when 'imported_note' then 'public.imported_notes'
      when 'imported_intervention' then 'public.imported_interventions' when 'reminder_delivery' then 'public.reminder_deliveries'
      when 'completion_place_label' then 'public.completion_place_labels'
      when 'where_suggestion_dismissal' then 'public.where_suggestion_dismissals' end;

    if write_kind = 'category' and not ((write -> 'value') ? 'description') then
      raise exception 'Update Cadence before synchronizing category changes.' using errcode = '22023';
    end if;

    if write_kind = 'behavior' and not ((write -> 'value') ? 'archive_notes') then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;
    if write_kind = 'behavior' and not ((write -> 'value') ?& array[
      'default_duration_minutes', 'end_date', 'auto_archived_at', 'location_text', 'where_kind'
    ]) then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;
    write_value := (write -> 'value') || jsonb_build_object('user_id', current_user_id);
    select string_agg(format('%1$I = excluded.%1$I', attribute.attname), ',' order by attribute.attnum)
    into update_list
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = table_name::regclass and attribute.attnum > 0
      and not attribute.attisdropped and attribute.attgenerated = '' and attribute.attname <> 'id'
      and (write_kind <> 'occurrence'
        or attribute.attname not in ('behavior_id', 'behavior_schedule_slot_id', 'scheduled_for', 'local_date', 'schedule_kind', 'schedule_preset', 'schedule_start_time', 'schedule_end_time')
        or write -> 'expected' -> attribute.attname is distinct from write -> 'value' -> attribute.attname);
    write_kind := update_list;
    select string_agg(format('%I', attribute.attname), ',' order by attribute.attnum)
    into update_list
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = table_name::regclass and attribute.attnum > 0
      and not attribute.attisdropped and attribute.attgenerated = '';
    execute format(
      'insert into %1$s (%3$s) select %3$s from jsonb_populate_record(null::%1$s, $1) '
      'on conflict (id) do update set %2$s', table_name, write_kind, update_list
    ) using write_value;
  end loop;

  -- Delete children before parents. Append-only rows were rejected above.
  for write in
    select value
    from jsonb_array_elements(sync_payload #> '{plan,writes}')
    where value ->> 'operation' = 'delete'
    order by case value ->> 'kind'
      when 'completion_place_label' then -2 when 'where_suggestion_dismissal' then -2
      when 'place_marker' then -2 when 'place_label_settings' then -2
      when 'note_shortcut_state' then -1
      when 'reminder_delivery' then 0 when 'time_session' then 1 when 'occurrence' then 2
      when 'schedule_slot' then 3 when 'schedule' then 4 when 'behavior' then 5
      when 'category' then 6 when 'import_run' then 7 else 8 end,
      value ->> 'id'
  loop
    write_kind := write ->> 'kind';
    if write_kind = 'note_shortcut_state' then
      delete from public.note_shortcut_states
      where user_id = current_user_id and id = write ->> 'id';
      continue;
    elsif write_kind = 'place_label_settings' then
      delete from public.place_label_settings where user_id = current_user_id;
      continue;
    elsif write_kind = 'place_marker' then
      delete from public.place_markers where user_id = current_user_id and id = write ->> 'id';
      continue;
    end if;
    row_id := (write ->> 'id')::uuid;
    table_name := case write_kind
      when 'category' then 'public.categories' when 'behavior' then 'public.behaviors'
      when 'schedule' then 'public.behavior_schedules' when 'schedule_slot' then 'public.behavior_schedule_slots'
      when 'occurrence' then 'public.occurrences' when 'time_session' then 'public.occurrence_time_sessions'
      when 'import_run' then 'public.behaviorlog_import_runs' when 'reminder_delivery' then 'public.reminder_deliveries'
      when 'completion_place_label' then 'public.completion_place_labels'
      when 'where_suggestion_dismissal' then 'public.where_suggestion_dismissals' end;
    if table_name is null then
      raise exception 'The account synchronization delete is unsupported.' using errcode = '22023';
    end if;
    execute format('delete from %s where user_id = $1 and id = $2', table_name)
      using current_user_id, row_id;
  end loop;

  current_snapshot := cadence_private.project_account_sync_snapshot(cadence_private.account_sync_snapshot(), v_contract);
  if current_snapshot ->> 'fingerprint' <> sync_payload #>> '{plan,mergedFingerprint}' then
    raise exception 'The hosted synchronization result differs from the accepted merge.' using errcode = 'P0001';
  end if;
  result := jsonb_build_object(
    'status', 'applied',
    'fingerprint', current_snapshot ->> 'fingerprint',
    'snapshot', current_snapshot
  );

  insert into public.account_sync_apply_receipts (
    user_id, idempotency_key, request_fingerprint, baseline_fingerprint,
    local_fingerprint, hosted_fingerprint, result_fingerprint, result_json
  ) values (
    current_user_id, v_idempotency_key, request_fingerprint,
    sync_payload ->> 'baselineFingerprint', sync_payload ->> 'localFingerprint',
    sync_payload ->> 'hostedFingerprint', current_snapshot ->> 'fingerprint', jsonb_build_object('status', 'applied')
  );

  return result;
end;
$function$;

commit;
