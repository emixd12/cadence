begin;

-- Preserve JSON.stringify number/string lexemes while replacing database-generated scalars.
create function cadence_private.integration_json_replace(document json, path text[], replacement json)
returns json language plpgsql immutable security invoker set search_path = '' as $$
declare result text;
begin
  if cardinality(path) = 0 then return replacement; end if;
  if json_typeof(document) = 'object' then
    select '{' || string_agg(to_json(key)::text || ':' || case when key = path[1]
      then cadence_private.integration_json_replace(value, path[2:], replacement)::text
      else value::text end, ',' order by ord) || '}' into result
      from json_each(document) with ordinality as fields(key, value, ord);
  elsif json_typeof(document) = 'array' then
    select '[' || string_agg(case when (ord - 1)::text = path[1]
      then cadence_private.integration_json_replace(value, path[2:], replacement)::text
      else value::text end, ',' order by ord) || ']' into result
      from json_array_elements(document) with ordinality as items(value, ord);
  else raise exception 'integration_invalid_preparation';
  end if;
  return result::json;
end $$;

create function cadence_private.integration_instant(value text)
returns text language sql immutable security invoker set search_path = '' as $$
  select rtrim(rtrim(to_char(value::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '0'), '.') || 'Z';
$$;

-- These are serialization inputs, not new domain rules. Omit metadata/history unused by the response.
create function cadence_private.integration_write_source(snapshot jsonb, operation text)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare b jsonb := snapshot->'behavior'; schedules jsonb; source jsonb;
begin
  if operation in ('set_occurrence_status', 'update_occurrence_note') then
    select jsonb_object_agg(key, value) into b from jsonb_each(b)
      where key = any(array['id','title','description','category','timezone','recurrence_rule','active']);
  else
    select jsonb_object_agg(key, value) into b from jsonb_each(b)
      where key = any(array['id','title','description','location_text','category','active','archived_at',
        'auto_archived_at','end_date','default_duration_minutes','timezone','recurrence_rule','scheduled_time',
        'browser_reminder_enabled','email_reminder_enabled','reminder_offset_minutes','archive_notes','created_at','updated_at']);
    select coalesce(jsonb_agg(jsonb_build_object('id', s->'id', 'recurrence_rule', s->'recurrence_rule',
      'sort_order', s->'sort_order', 'schedule_slots', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t->'id', 'kind', t->'kind', 'preset', t->'preset', 'start_time', t->'start_time',
        'end_time', t->'end_time', 'sort_order', t->'sort_order') order by ti), '[]'::jsonb)
        from jsonb_array_elements(s->'schedule_slots') with ordinality as slots(t, ti))) order by si), '[]'::jsonb)
      into schedules from jsonb_array_elements(snapshot->'behavior'->'schedules') with ordinality as schedules(s, si);
    b := b || jsonb_build_object('schedules', schedules, 'schedule_slots', '[]'::jsonb);
  end if;
  source := (snapshot - 'rpc_result') || jsonb_build_object('behavior', b);
  return source;
end $$;

-- Only generated UUIDs and the server revision clock vary between rollback preparation and commit.
create function cadence_private.integration_write_bindings(source jsonb, operation text)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare bindings jsonb := '[]'; root text; s jsonb; t jsonb; si bigint; ti bigint; instant text;
begin
  root := case when operation in ('set_occurrence_status','update_occurrence_note') then 'occurrence' else 'behavior' end;
  instant := cadence_private.integration_instant(source->root->>'updated_at');
  bindings := jsonb_build_array(
    jsonb_build_object('source', array[root,'updated_at'], 'output', array[root,'updated_at'], 'value', instant),
    jsonb_build_object('source', array[root,'updated_at'], 'output', array[root,'revision'], 'value', instant));
  if root = 'behavior' then
    if operation = 'create_behavior' then
      bindings := bindings || jsonb_build_array(jsonb_build_object('source', array['behavior','id'],
        'output', array['behavior','id'], 'value', source->'behavior'->>'id'));
    end if;
    for s, si in select value, ordinality - 1 from jsonb_array_elements(source->'behavior'->'schedules') with ordinality loop
      bindings := bindings || jsonb_build_array(jsonb_build_object('source', array['behavior','schedules',si::text,'id'],
        'output', array['behavior','schedules',si::text,'id'], 'value', s->>'id'));
      for t, ti in select value, ordinality - 1 from jsonb_array_elements(s->'schedule_slots') with ordinality loop
        bindings := bindings || jsonb_build_array(jsonb_build_object('source', array['behavior','schedules',si::text,'schedule_slots',ti::text,'id'],
          'output', array['behavior','schedules',si::text,'time_entries',ti::text,'id'], 'value', t->>'id'));
      end loop;
    end loop;
  end if;
  return bindings;
end $$;

revoke all on function cadence_private.integration_json_replace(json,text[],json) from public, anon, service_role;
revoke all on function cadence_private.integration_instant(text) from public, anon, service_role;
revoke all on function cadence_private.integration_write_source(jsonb,text) from public, anon, service_role;
revoke all on function cadence_private.integration_write_bindings(jsonb,text) from public, anon, service_role;
grant execute on function cadence_private.integration_json_replace(json,text[],json), cadence_private.integration_instant(text),
  cadence_private.integration_write_source(jsonb,text), cadence_private.integration_write_bindings(jsonb,text) to authenticated;

create or replace function public.integration_apply_write(
  p_operation text, p_key text, p_hash text, p_rpc text, p_args jsonb,
  p_as_of timestamptz, p_external_ref text default null
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  saved jsonb;
  prepared jsonb := p_args->'_integration_prepared';
  source jsonb;
  normalized jsonb;
  bindings jsonb;
  binding jsonb;
  source_path text[];
  output_path text[];
  fingerprint text;
  output_document json;
  receipt jsonb;
  preview jsonb;
  result jsonb;
  snapshot jsonb;
  behavior_snapshot jsonb;
  occurrence_snapshot jsonb;
  before_row jsonb;
  entity_id uuid;
  behavior_id uuid;
  changed boolean;
  external_ref text;
  owner_id uuid := auth.uid();
begin
  saved := public.integration_lock_write(p_key, p_operation, p_hash);
  if saved is not null then
    perform public.integration_record_activity(p_operation, array[coalesce((saved->'occurrence'->>'id')::uuid, (saved->'behavior'->>'id')::uuid,
      ((saved->>'output_json')::jsonb->'occurrence'->>'id')::uuid, ((saved->>'output_json')::jsonb->'behavior'->>'id')::uuid)], 'success', null);
    return jsonb_build_object('receipt', saved);
  end if;
  if p_as_of is null or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'integration_invalid_input' using errcode = '22023';
  end if;

  begin
    if p_operation = 'create_behavior' and p_rpc = 'create_behavior_with_schedule_graph' then
      result := public.create_behavior_with_schedule_graph(p_args->'behavior_payload',
        p_args->'definition_event_plan', p_args->'configuration_event_plan', p_args->'schedule_graph');
      behavior_id := (result->>'id')::uuid;
      changed := true;
      if p_external_ref is not null then
        if public.integration_link_external_reference('behavior', behavior_id, p_external_ref) = 'conflict' then
          raise exception 'integration_external_ref_conflict' using errcode = '22023';
        end if;
      end if;
    elsif p_operation in ('update_behavior', 'archive_behavior', 'restore_behavior')
        and p_rpc = 'update_behavior_with_schedule_graph' then
      perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
      behavior_id := (p_args->>'target_behavior_id')::uuid;
      select to_jsonb(b) into before_row from public.behaviors b
        where b.id = behavior_id and b.user_id = owner_id;
      if before_row is null then raise exception 'integration_not_found' using errcode = 'P0002'; end if;
      if (p_args->>'expected_updated_at')::timestamptz is distinct from (before_row->>'updated_at')::timestamptz then
        raise exception 'integration_conflict' using errcode = 'P0001';
      end if;
      if (p_operation = 'archive_behavior' and not (before_row->>'active')::boolean)
        or (p_operation = 'restore_behavior' and (before_row->>'active')::boolean) then
        result := before_row;
      else
      result := public.update_behavior_with_schedule_graph(behavior_id, p_args->'behavior_payload',
        p_args->'expected_definition', p_args->'expected_schedule_graph',
        (p_args->>'expected_updated_at')::timestamptz, nullif(p_args->'definition_event_plan', 'null'::jsonb),
        nullif(p_args->'configuration_event_plan', 'null'::jsonb), p_args->'schedule_graph');
      end if;
      changed := (before_row - 'updated_at') is distinct from (result - 'updated_at')
        or nullif(p_args->'configuration_event_plan', 'null'::jsonb) is not null
        or nullif(p_args->'definition_event_plan', 'null'::jsonb) is not null;
    elsif p_operation = 'set_occurrence_status' and p_rpc = 'apply_occurrence_status_transition' then
      entity_id := (p_args->>'target_occurrence_id')::uuid;
      select to_jsonb(o) into before_row from public.occurrences o
        where o.id = entity_id and o.user_id = owner_id for update;
      if before_row is null then raise exception 'integration_not_found' using errcode = 'P0002'; end if;
      result := public.apply_occurrence_status_transition(entity_id, p_args->>'expected_status',
        (p_args->>'expected_latest_event_id')::uuid, p_args->>'planned_status',
        (p_args->>'planned_completed_at')::timestamptz, (p_args->>'planned_status_marked_at')::timestamptz,
        p_args->>'planned_event_semantics', (p_args->>'planned_event_recorded_at')::timestamptz,
        (p_args->>'planned_event_effective_at')::timestamptz, p_args->>'planned_event_source_capture_method',
        p_args->>'planned_event_source_confidence', (p_args->>'planned_cancel_pending_reminders')::boolean);
      occurrence_snapshot := result->'occurrence';
      behavior_id := (occurrence_snapshot->>'behavior_id')::uuid;
      changed := (result->>'status_changed')::boolean;
    elsif p_operation = 'update_occurrence_note' and p_rpc = 'update_occurrence_note' then
      entity_id := (p_args->>'occurrenceId')::uuid;
      select to_jsonb(o) into before_row from public.occurrences o
        where o.id = entity_id and o.user_id = owner_id for update;
      if before_row is null then raise exception 'integration_not_found' using errcode = 'P0002'; end if;
      if before_row->>'note' is distinct from p_args->>'expectedNote'
        or (p_args->>'expectedUpdatedAt' is not null and
          (before_row->>'updated_at')::timestamptz <> (p_args->>'expectedUpdatedAt')::timestamptz) then
        raise exception 'integration_conflict' using errcode = 'P0001';
      end if;
      changed := before_row->>'note' is distinct from p_args->>'note';
      if changed then
        update public.occurrences o set note = p_args->>'note'
          where o.id = entity_id and o.user_id = owner_id returning to_jsonb(o) into result;
      else result := before_row;
      end if;
      occurrence_snapshot := result;
      behavior_id := (result->>'behavior_id')::uuid;
    else
      raise exception 'integration_invalid_input' using errcode = '22023';
    end if;

    select to_jsonb(b) || jsonb_build_object(
      'category', (select jsonb_build_object('id', c.id, 'name', c.name) from public.categories c
        where c.id = b.category_id and c.user_id = owner_id),
      'schedules', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'schedule_slots', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id)
          from public.behavior_schedule_slots t where t.behavior_schedule_id = s.id and t.user_id = owner_id), '[]'::jsonb))
        order by s.sort_order, s.id) from public.behavior_schedules s
        where s.behavior_id = b.id and s.user_id = owner_id), '[]'::jsonb),
      'schedule_slots', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id)
        from public.behavior_schedule_slots t where t.behavior_id = b.id and t.user_id = owner_id), '[]'::jsonb)
    ) into behavior_snapshot from public.behaviors b where b.id = behavior_id and b.user_id = owner_id;
    select r.external_id into external_ref from public.integration_list_external_references('behavior', array[behavior_id]) r;
    snapshot := jsonb_build_object('version', 1, 'rpc_result', result, 'behavior', behavior_snapshot,
      'occurrence', occurrence_snapshot, 'previous_status', before_row->>'status',
      'changed', changed, 'as_of', p_as_of, 'external_ref', external_ref,
      'timezone', coalesce((select timezone from public.profiles where id = owner_id), 'America/New_York'));
    source := cadence_private.integration_write_source(snapshot, p_operation);
    normalized := source;
    bindings := cadence_private.integration_write_bindings(source, p_operation);
    for binding in select value from jsonb_array_elements(bindings) loop
      select array_agg(value) into source_path from jsonb_array_elements_text(binding->'source');
      normalized := jsonb_set(normalized, source_path, 'null'::jsonb);
    end loop;
    fingerprint := encode(extensions.digest(normalized::text, 'sha256'), 'hex');
    if prepared is null then
      preview := jsonb_build_object('source', source, 'fingerprint', fingerprint);
      -- PL/pgSQL retains local variables but rolls back every write in this subtransaction.
      raise exception 'integration_prepared' using errcode = 'P2250';
    end if;
    if prepared->>'fingerprint' is distinct from fingerprint then
      raise exception 'integration_conflict' using errcode = 'P0001';
    end if;
    output_document := (prepared->>'output_json')::json;
    if output_document is null then raise exception 'integration_invalid_preparation'; end if;
    for binding in select value from jsonb_array_elements(bindings) loop
      select array_agg(value) into output_path from jsonb_array_elements_text(binding->'output');
      output_document := cadence_private.integration_json_replace(output_document, output_path, to_json(binding->>'value'));
    end loop;
    -- The validated JSON text retains JS numeric/string encoding; only typed scalar bindings changed.
    if octet_length(output_document::text) > 100000 then
      raise exception 'integration_output_limit_exceeded' using errcode = '22023';
    end if;
    receipt := jsonb_build_object('version', 2, 'output_json', output_document::text);
    if p_key is not null and not public.integration_idempotency_complete(p_key, p_hash, receipt) then
      raise exception 'integration_receipt_failed';
    end if;
    perform public.integration_record_activity(p_operation, array[coalesce(entity_id, behavior_id)], 'success', null);
    return jsonb_build_object('receipt', receipt, 'rpc_result', result);
  exception when sqlstate 'P2250' then return preview;
  end;
end $$;

commit;
