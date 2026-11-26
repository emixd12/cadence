-- Ticket 370 (D35): MCP create_period, update_period and end_period.
--
-- Period writes reuse cadence.occurrences.write (owner decision, D35). There is no
-- remove operation: agents create, edit and end a Period, and removal stays in the app.
-- Each write runs as the grant's user through create_period and update_period, so the
-- ownership binding, the input rules, the compare-and-set on revision and the cap of
-- 500 Periods per account all apply. The output is built here because a Period has no
-- Behavior or Occurrence for the two-phase serializer to bind.
--
-- Additive: one function patched by text, one new function, one widened check.
begin;

-- integration_lock_write: allow the three Period writes under cadence.occurrences.write.
-- Every operation it allowed before keeps its scope. The patch raises when the scope
-- line is not the one this migration was written against.
do $migration$
declare
  definition text;
  anchor constant text := $a$    when p_operation in ('set_occurrence_status', 'update_occurrence_note', 'update_day_note') then 'cadence.occurrences.write'$a$;
  replacement constant text := $p$    when p_operation in ('set_occurrence_status', 'update_occurrence_note', 'update_day_note',
      'create_period', 'update_period', 'end_period') then 'cadence.occurrences.write'$p$;
begin
  select pg_get_functiondef('public.integration_lock_write(text,text,text)'::regprocedure) into definition;
  if position(anchor in definition) = 0 then
    raise exception 'Integration write scopes changed unexpectedly.';
  end if;
  if position(anchor in substr(definition, position(anchor in definition) + length(anchor))) > 0 then
    raise exception 'Integration write scopes anchor is not unique.';
  end if;
  execute replace(definition, anchor, replacement);
end;
$migration$;

-- One transaction per Period write: lock or replay by idempotency key, check the
-- revision the client read, write, store a version 2 receipt and record the activity.
--
-- p_expected_revision is the opaque revision the contract returns (the row's
-- updated_at as an instant, the form day notes use). The service sends the full
-- planned row; this function refuses it when the stored row is not the one the plan
-- was made from. end_period may only set the last day, and only to a day earlier
-- than the stored one: ending never extends a Period.
create function public.integration_apply_period_write(
  p_key text,
  p_hash text,
  p_operation text,
  p_period_id uuid,
  p_expected_revision text,
  p_label text,
  p_start_on date,
  p_end_on date,
  p_note text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  saved jsonb;
  before_row public.periods;
  result public.periods;
  changed boolean;
  period_output jsonb;
  receipt jsonb;
begin
  if p_operation is null or p_operation not in ('create_period', 'update_period', 'end_period') then
    raise exception 'integration_invalid_input' using errcode = '22023';
  end if;
  saved := public.integration_lock_write(p_key, p_operation, p_hash);
  if saved is not null then
    perform public.integration_record_activity(p_operation,
      array_remove(array[((saved->>'output_json')::jsonb #>> '{period,id}')::uuid], null), 'success', null);
    return jsonb_build_object('receipt', saved);
  end if;

  if p_operation = 'create_period' then
    if p_period_id is not null or p_expected_revision is not null then
      raise exception 'integration_invalid_input' using errcode = '22023';
    end if;
    select * into result from public.create_period(p_label, p_start_on, p_end_on, p_note);
    if result.id is null then
      raise exception 'integration_conflict' using errcode = 'P0001';
    end if;
    changed := true;
  else
    if p_period_id is null or p_expected_revision is null then
      raise exception 'integration_invalid_input' using errcode = '22023';
    end if;
    select * into before_row from public.periods period
      where period.user_id = (select auth.uid()) and period.id = p_period_id;
    if before_row.id is null then
      raise exception 'integration_not_found' using errcode = 'P0002';
    end if;
    if cadence_private.integration_instant(before_row.updated_at::text) <> p_expected_revision then
      raise exception 'integration_conflict' using errcode = 'P0001';
    end if;
    if p_operation = 'end_period' and (
      p_end_on is null
      or p_label is distinct from before_row.label
      or p_start_on is distinct from before_row.start_on
      or p_note is distinct from before_row.note
      or p_end_on < before_row.start_on
      or (before_row.end_on is not null and before_row.end_on <= p_end_on)
    ) then
      raise exception 'integration_period_end_refused' using errcode = 'P0001';
    end if;
    select * into result from public.update_period(
      p_period_id, before_row.revision, p_label, p_start_on, p_end_on, p_note);
    if result.id is null then
      raise exception 'integration_conflict' using errcode = 'P0001';
    end if;
    changed := result.revision <> before_row.revision;
  end if;

  period_output := jsonb_build_object(
    'id', result.id,
    'label', result.label,
    'start_local_date', result.start_on,
    'end_local_date', result.end_on,
    'ongoing', result.end_on is null,
    'note', result.note,
    'revision', cadence_private.integration_instant(result.updated_at::text),
    'updated_at', cadence_private.integration_instant(result.updated_at::text)
  );
  receipt := jsonb_build_object('version', 2, 'output_json', (
    case when p_operation = 'create_period' then jsonb_build_object('period', period_output)
      else jsonb_build_object('period', period_output, 'changed', changed) end)::text);
  if octet_length(receipt->>'output_json') > 100000 then
    raise exception 'integration_output_limit_exceeded' using errcode = '22023';
  end if;
  if p_key is not null and not public.integration_idempotency_complete(p_key, p_hash, receipt) then
    raise exception 'integration_receipt_failed';
  end if;
  perform public.integration_record_activity(p_operation, array[result.id], 'success', null);
  return jsonb_build_object('receipt', receipt);
end $$;

revoke all on function public.integration_apply_period_write(text, text, text, uuid, text, text, date, date, text)
  from public, anon, service_role;
grant execute on function public.integration_apply_period_write(text, text, text, uuid, text, text, date, date, text)
  to authenticated;

-- Chat records each write it makes. Period writes get their own kind.
alter table public.chat_actions drop constraint chat_actions_kind_check;
alter table public.chat_actions add constraint chat_actions_kind_check check (kind in (
  'status', 'occurrence_note', 'day_note', 'move', 'create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior',
  'opportunity', 'period'
));

commit;
