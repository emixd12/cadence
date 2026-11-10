-- Ticket 292: MCP update_day_note.
--
-- Day note writes reuse cadence.occurrences.write (owner decision, 2026-11-10).
-- The write runs as the grant's user through save_day_note, so RLS and the
-- compare-and-set apply. The output is built here because a day note has no
-- Behavior or Occurrence for the two-phase serializer to bind.
begin;

create or replace function public.integration_lock_write(p_key text, p_operation text, p_hash text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  g cadence_oauth_private.grants := cadence_oauth_private.current_integration_grant(true);
  r cadence_oauth_private.idempotency_records;
  required_scope text;
begin
  required_scope := case
    when p_operation in ('set_occurrence_status', 'update_occurrence_note', 'update_day_note') then 'cadence.occurrences.write'
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

create function public.integration_apply_day_note_write(
  p_key text,
  p_hash text,
  p_local_date date,
  p_note text,
  p_expected_revision text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  saved jsonb;
  before_row public.day_notes;
  result public.day_notes;
  changed boolean;
  day_note_output jsonb;
  receipt jsonb;
begin
  saved := public.integration_lock_write(p_key, 'update_day_note', p_hash);
  if saved is not null then
    perform public.integration_record_activity('update_day_note',
      array_remove(array[((saved->>'output_json')::jsonb #>> '{day_note,id}')::uuid], null), 'success', null);
    return jsonb_build_object('receipt', saved);
  end if;
  if p_local_date is null then
    raise exception 'integration_invalid_input' using errcode = '22023';
  end if;

  select * into before_row from public.day_notes day_note
    where day_note.user_id = (select auth.uid()) and day_note.local_date = p_local_date;
  if p_expected_revision is not null and (before_row.id is null
      or cadence_private.integration_instant(before_row.updated_at::text) <> p_expected_revision) then
    raise exception 'integration_conflict' using errcode = 'P0001';
  end if;

  changed := before_row.note is distinct from p_note;
  if before_row.id is null and p_note is null then
    result := null;
  else
    select * into result from public.save_day_note(p_local_date, before_row.note, p_note);
    if result.id is null then
      raise exception 'integration_conflict' using errcode = 'P0001';
    end if;
  end if;

  day_note_output := case when result.id is null then 'null'::jsonb else jsonb_build_object(
    'id', result.id,
    'local_date', result.local_date,
    'note', result.note,
    'revision', cadence_private.integration_instant(result.updated_at::text),
    'updated_at', cadence_private.integration_instant(result.updated_at::text)
  ) end;
  receipt := jsonb_build_object('version', 2, 'output_json',
    jsonb_build_object('local_date', p_local_date, 'day_note', day_note_output, 'changed', changed)::text);
  if octet_length(receipt->>'output_json') > 100000 then
    raise exception 'integration_output_limit_exceeded' using errcode = '22023';
  end if;
  if p_key is not null and not public.integration_idempotency_complete(p_key, p_hash, receipt) then
    raise exception 'integration_receipt_failed';
  end if;
  perform public.integration_record_activity('update_day_note', array_remove(array[result.id], null), 'success', null);
  return jsonb_build_object('receipt', receipt);
end $$;

revoke all on function public.integration_apply_day_note_write(text, text, date, text, text)
  from public, anon, service_role;
grant execute on function public.integration_apply_day_note_write(text, text, date, text, text)
  to authenticated;

commit;
