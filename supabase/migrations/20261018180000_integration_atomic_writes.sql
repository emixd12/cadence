begin;

-- Keep the existing status transaction, including all race/reminder checks.
do $$
declare
  body text := pg_get_functiondef('public.apply_occurrence_status_transition(uuid,text,uuid,text,timestamptz,timestamptz,text,timestamptz,timestamptz,text,text,boolean)'::regprocedure);
begin
  if position('planned_event_source_capture_method <> ''manual_tap''' in body) = 0 then
    raise exception 'Unexpected status transaction definition';
  end if;
  body := replace(body, 'planned_event_source_capture_method <> ''manual_tap''',
    'planned_event_source_capture_method not in (''manual_tap'', ''manual_text'')');
  body := replace(body, 'Manual status changes require manual-tap, high-confidence provenance.',
    'Manual status changes require manual-tap or manual-text, high-confidence provenance.');
  execute body;
end $$;

-- Reclaim an abandoned matching attempt, but keep mismatched keys fenced for 24 hours.
do $$
declare
  body text := pg_get_functiondef('public.integration_idempotency_begin(text,text,text)'::regprocedure);
begin
  if position('(existing_record.state = ''pending'' and existing_record.updated_at < now() - interval ''2 minutes'')' in body) = 0 then
    raise exception 'Unexpected idempotency claim definition';
  end if;
  body := replace(body,
    '(existing_record.state = ''pending'' and existing_record.updated_at < now() - interval ''2 minutes'')',
    '(existing_record.state = ''pending'' and existing_record.updated_at < now() - interval ''2 minutes'' and existing_record.operation = p_operation and existing_record.request_hash = p_request_hash)');
  execute body;
end $$;

-- Only this bookkeeping function is privileged. Product writes below run as
-- authenticated and call the same owner-checked transactions as the web app.
create function public.integration_lock_write(p_key text, p_operation text, p_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  g cadence_oauth_private.grants := cadence_oauth_private.current_integration_grant(true);
  r cadence_oauth_private.idempotency_records;
  required_scope text;
begin
  required_scope := case
    when p_operation in ('set_occurrence_status', 'update_occurrence_note') then 'cadence.occurrences.write'
    when p_operation in ('create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior') then 'cadence.behaviors.write'
    else null end;
  if required_scope is null or not (required_scope = any(g.scopes)) then
    raise exception 'integration_insufficient_scope' using errcode = '42501';
  end if;
  if p_key is null then return null; end if;
  -- Serialize attempts before the reclaim check, including claims older than two minutes.
  perform pg_advisory_xact_lock(hashtextextended(g.user_id::text || g.client_ref::text || p_key, 225));
  perform public.integration_idempotency_begin(p_key, p_operation, p_hash);
  select * into r from cadence_oauth_private.idempotency_records
    where user_id = g.user_id and client_ref = g.client_ref and idempotency_key = p_key for update;
  if r.operation <> p_operation or r.request_hash <> p_hash then
    raise exception 'integration_idempotency_key_reused' using errcode = '22023';
  end if;
  return case when r.state = 'completed' then r.result else null end;
end $$;

create function public.integration_apply_write(
  p_operation text, p_key text, p_hash text, p_rpc text, p_args jsonb,
  p_as_of timestamptz, p_external_ref text default null
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  saved jsonb;
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
    perform public.integration_record_activity(p_operation, array[coalesce((saved->'occurrence'->>'id')::uuid,
      (saved->'behavior'->>'id')::uuid)], 'success', null);
    return saved;
  end if;
  if p_as_of is null or p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'integration_invalid_input' using errcode = '22023';
  end if;

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
  if p_key is not null and not public.integration_idempotency_complete(p_key, p_hash, snapshot) then
    raise exception 'integration_receipt_failed';
  end if;
  perform public.integration_record_activity(p_operation, array[coalesce(entity_id, behavior_id)], 'success', null);
  return snapshot;
end $$;

revoke all on function public.integration_lock_write(text,text,text) from public, anon, service_role;
revoke all on function public.integration_apply_write(text,text,text,text,jsonb,timestamptz,text) from public, anon, service_role;
grant execute on function public.integration_lock_write(text,text,text) to authenticated;
grant execute on function public.integration_apply_write(text,text,text,text,jsonb,timestamptz,text) to authenticated;
commit;
