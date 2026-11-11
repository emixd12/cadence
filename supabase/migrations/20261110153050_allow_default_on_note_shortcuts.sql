-- Ticket 305: Note shortcuts are on by default (docs/DECISIONS.md, 2026-11-10).
-- Replaces only the enablement gate of the guarded commit RPC. Its signature, security
-- definer ownership binding, full-context compare-and-set, revision check and write are
-- unchanged. No table, column, or stored row changes here.
begin;

create or replace function public.commit_note_shortcut_state(
  expected_context jsonb,
  next_state jsonb,
  require_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  target_behavior_id uuid;
  target_id text;
  current_context jsonb;
  result public.note_shortcut_states;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if jsonb_typeof(expected_context) is distinct from 'object'
    or jsonb_typeof(next_state) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(expected_context)) <> 5
    or not (expected_context ?& array['state', 'globalState', 'behavior', 'notes', 'importedOccurrenceIds'])
    or (select count(*) from jsonb_object_keys(next_state)) <> 8
    or not (next_state ?& array['id', 'user_id', 'behavior_id', 'enabled', 'entries', 'excluded_occurrence_ids', 'revision', 'updated_at'])
    or next_state ->> 'user_id' is distinct from owner_id::text
    or jsonb_typeof(next_state -> 'revision') <> 'number'
    or (next_state ->> 'revision')::numeric <> trunc((next_state ->> 'revision')::numeric)
    or (next_state ->> 'revision')::numeric not between 1 and 2147483647
  then
    raise exception 'Invalid Note shortcut commit.' using errcode = '22023';
  end if;

  target_id := next_state ->> 'id';
  if target_id = 'global' then
    if jsonb_typeof(next_state -> 'behavior_id') <> 'null' then
      raise exception 'Invalid global Note shortcut state.' using errcode = '22023';
    end if;
  else
    begin target_behavior_id := target_id::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid Note shortcut Behavior.' using errcode = '22023';
    end;
    if next_state ->> 'behavior_id' is distinct from target_behavior_id::text then
      raise exception 'Invalid Note shortcut Behavior.' using errcode = '22023';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  perform 1 from public.note_shortcut_states
    where user_id = owner_id and id in ('global', target_id)
    order by id for update;
  if target_behavior_id is not null then
    perform 1 from public.behaviors
      where user_id = owner_id and id = target_behavior_id for update;
    perform 1 from public.occurrences
      where user_id = owner_id and behavior_id = target_behavior_id
      order by id for update;
    perform 1 from public.behaviorlog_import_record_mappings
      where user_id = owner_id and record_type = 'occurrence'
        and local_id in (
          select id from public.occurrences
          where user_id = owner_id and behavior_id = target_behavior_id
        )
      order by id for update;
  end if;

  current_context := cadence_private.read_note_shortcut_context_for_owner(owner_id, target_behavior_id);
  if target_behavior_id is not null and current_context -> 'behavior' = 'null'::jsonb then
    raise exception 'Behavior not found.' using errcode = '42501';
  end if;
  if current_context is distinct from expected_context then
    raise exception 'This shortcut changed elsewhere. Refresh and try again.' using errcode = 'P0001';
  end if;
  if (next_state ->> 'revision')::integer
      <> coalesce((current_context #>> '{state,revision}')::integer, 0) + 1
  then
    raise exception 'This shortcut changed elsewhere. Refresh and try again.' using errcode = 'P0001';
  end if;
  -- Ticket 305: an absent global state means on, and the per-Behavior flag no longer
  -- gates. A stored global off switch still rejects matching and acceptance.
  if require_enabled and (
    target_behavior_id is null
    or coalesce((current_context #>> '{behavior,active}')::boolean, false) is not true
  ) then
    raise exception 'Note shortcuts are available for active Behaviors only.' using errcode = 'P0001';
  end if;
  if require_enabled
    and coalesce((current_context #>> '{globalState,enabled}')::boolean, true) is not true
  then
    raise exception 'Note shortcuts are turned off for this account.' using errcode = 'P0001';
  end if;

  insert into public.note_shortcut_states as shortcut_state (
    user_id, id, behavior_id, enabled, entries,
    excluded_occurrence_ids, revision, updated_at
  ) values (
    owner_id,
    target_id,
    target_behavior_id,
    (next_state ->> 'enabled')::boolean,
    next_state -> 'entries',
    next_state -> 'excluded_occurrence_ids',
    (next_state ->> 'revision')::integer,
    (next_state ->> 'updated_at')::timestamptz
  ) on conflict (user_id, id) do update set
    behavior_id = excluded.behavior_id,
    enabled = excluded.enabled,
    entries = excluded.entries,
    excluded_occurrence_ids = excluded.excluded_occurrence_ids,
    revision = excluded.revision,
    updated_at = excluded.updated_at
  returning * into result;

  return to_jsonb(result);
end;
$$;

revoke all on function public.commit_note_shortcut_state(jsonb, jsonb, boolean)
  from public, anon, service_role;
grant execute on function public.commit_note_shortcut_state(jsonb, jsonb, boolean)
  to authenticated;

commit;
