-- Ticket 292: the day-note Note shortcuts pool.
--
-- One more note_shortcut_states row per user, id = 'day_notes' with a null
-- behavior_id. It learns only from repeated day notes. Its evidence and
-- exclusion IDs are day-note IDs; the JSON field names (occurrence_id,
-- excluded_occurrence_ids) stay so validators and account sync keep one shape.
-- RLS is unchanged: owner-only select, writes only through the guarded RPCs.
--
-- Account sync: shipped Mac builds (sync contracts 1-3) reject a Note shortcut
-- state whose ID is not 'global' or a Behavior UUID, so the account snapshot
-- leaves out the 'day_notes' row (patched at the end of this file). Hosted sync
-- writes of that ID already fail its UUID check. Ticket 292's desktop task adds
-- the Mac store and exposes the row under a new sync contract.
begin;

alter table public.note_shortcut_states
  drop constraint note_shortcut_states_identity_valid;
alter table public.note_shortcut_states
  add constraint note_shortcut_states_identity_valid check (
    (id = 'global' and behavior_id is null)
    or (id = 'day_notes' and behavior_id is null)
    or (behavior_id is not null and id = behavior_id::text)
  );

create function cadence_private.read_day_note_shortcut_context_for_owner(owner_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  owner_timezone text;
  state_value jsonb;
  global_state_value jsonb;
  note_values jsonb;
  source_count bigint;
  source_bytes bigint;
  context_value jsonb;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select profile.timezone into owner_timezone
  from public.profiles profile
  where profile.id = owner_id;
  if owner_timezone is null then
    raise exception 'Profile not found.' using errcode = '42501';
  end if;

  select to_jsonb(shortcut_state) into global_state_value
  from public.note_shortcut_states shortcut_state
  where shortcut_state.user_id = owner_id and shortcut_state.id = 'global';

  select to_jsonb(shortcut_state) into state_value
  from public.note_shortcut_states shortcut_state
  where shortcut_state.user_id = owner_id and shortcut_state.id = 'day_notes';

  select count(*), coalesce(sum(octet_length(day_note.note) + 512), 0)
  into source_count, source_bytes
  from public.day_notes day_note
  where day_note.user_id = owner_id
    and nullif(btrim(day_note.note), '') is not null;
  if source_count > 100000 then
    raise exception 'A Note shortcut source collection exceeds 100,000 rows.'
      using errcode = '54000';
  end if;
  if source_bytes > 67108864 then
    raise exception 'The Note shortcut context exceeds 64 MiB.' using errcode = '54000';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', day_note.id,
    'user_id', day_note.user_id,
    'behavior_id', null,
    'note', day_note.note,
    'local_date', day_note.local_date,
    'scheduled_for', null
  ) order by day_note.local_date desc, day_note.id), '[]'::jsonb)
  into note_values
  from public.day_notes day_note
  where day_note.user_id = owner_id
    and nullif(btrim(day_note.note), '') is not null;

  context_value := jsonb_build_object(
    'state', coalesce(state_value, 'null'::jsonb),
    'globalState', coalesce(global_state_value, 'null'::jsonb),
    'behavior', 'null'::jsonb,
    'notes', note_values,
    -- Day-note import writes no provenance rows; imported day notes count like typed ones.
    'importedOccurrenceIds', '[]'::jsonb,
    'dayPool', jsonb_build_object('user_id', owner_id, 'timezone', owner_timezone)
  );
  if octet_length(context_value::text) > 67108864 then
    raise exception 'The Note shortcut context exceeds 64 MiB.' using errcode = '54000';
  end if;
  return context_value;
end;
$$;

revoke all on function cadence_private.read_day_note_shortcut_context_for_owner(uuid)
  from public, anon, authenticated, service_role;
grant execute on function cadence_private.read_day_note_shortcut_context_for_owner(uuid)
  to authenticated;

create function public.read_day_note_shortcut_context()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select cadence_private.read_day_note_shortcut_context_for_owner((select auth.uid()))
$$;

revoke all on function public.read_day_note_shortcut_context()
  from public, anon, service_role;
grant execute on function public.read_day_note_shortcut_context() to authenticated;

-- Like the guarded occurrence-status write RPC, this mutation uses the table
-- owner's rights so authenticated clients cannot bypass its full-context CAS.
-- This replaces Ticket 305's definition (20261110153050) and keeps its default-on
-- gate; it adds only the 'day_notes' target.
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
    or (select count(*) from jsonb_object_keys(expected_context))
      <> (case when next_state ->> 'id' = 'day_notes' then 6 else 5 end)
    or not (expected_context ?& array['state', 'globalState', 'behavior', 'notes', 'importedOccurrenceIds'])
    or ((next_state ->> 'id' = 'day_notes') is distinct from (expected_context ? 'dayPool'))
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
  elsif target_id = 'day_notes' then
    if jsonb_typeof(next_state -> 'behavior_id') <> 'null' then
      raise exception 'Invalid day note shortcut state.' using errcode = '22023';
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
  elsif target_id = 'day_notes' then
    perform 1 from public.day_notes
      where user_id = owner_id
      order by id for update;
  end if;

  if target_id = 'day_notes' then
    current_context := cadence_private.read_day_note_shortcut_context_for_owner(owner_id);
  else
    current_context := cadence_private.read_note_shortcut_context_for_owner(owner_id, target_behavior_id);
  end if;
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
  -- Ticket 305 (20261110153050): an absent global state means on, and a pool's own
  -- flag no longer gates. A stored global off switch still rejects matching and
  -- acceptance. The day pool follows the same rule; it has no Behavior to be active.
  if require_enabled and target_id <> 'day_notes' and (
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

-- Saves a day note written with a shortcut chip and excludes that day note from
-- the day-note pool in one transaction, like update_occurrence_note_with_shortcut.
create function public.save_day_note_with_shortcut(
  target_local_date date,
  expected_note text,
  next_note text,
  used_shortcut boolean
)
returns setof public.day_notes
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  saved public.day_notes;
  shortcut_state public.note_shortcut_states;
begin
  if owner_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if used_shortcut is distinct from true or next_note is null then
    raise exception 'The shortcut day note update is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  select * into saved
  from public.save_day_note(target_local_date, expected_note, next_note);
  if not found then
    return;
  end if;

  select * into shortcut_state
  from public.note_shortcut_states state
  where state.user_id = owner_id and state.id = 'day_notes'
  for update;
  if not found then
    insert into public.note_shortcut_states (
      user_id, id, behavior_id, enabled, entries,
      excluded_occurrence_ids, revision, updated_at
    ) values (
      owner_id, 'day_notes', null,
      false, '[]'::jsonb, '[]'::jsonb, 0, statement_timestamp()
    ) returning * into shortcut_state;
  end if;
  if jsonb_array_length(shortcut_state.excluded_occurrence_ids) >= 100000
    and not (shortcut_state.excluded_occurrence_ids ? saved.id::text)
  then
    raise exception 'The Note shortcut exclusion history is full.' using errcode = '54000';
  end if;

  update public.note_shortcut_states state set
    excluded_occurrence_ids = case
      when state.excluded_occurrence_ids ? saved.id::text
        then state.excluded_occurrence_ids
      else state.excluded_occurrence_ids || to_jsonb(saved.id::text)
    end,
    revision = state.revision + 1,
    updated_at = statement_timestamp()
  where state.user_id = owner_id and state.id = 'day_notes';

  return next saved;
end;
$$;

revoke all on function public.save_day_note_with_shortcut(date, text, text, boolean)
  from public, anon, service_role;
grant execute on function public.save_day_note_with_shortcut(date, text, text, boolean)
  to authenticated;

-- Keep the day-note pool out of every account sync read. All snapshot reads,
-- apply checks and fingerprints go through cadence_private.account_sync_snapshot(),
-- so this one filter covers contracts 1-3. Ticket 292's desktop task removes it
-- when a new sync contract carries the 'day_notes' state.
do $migration$
declare
  definition text;
  anchor text;
begin
  select pg_get_functiondef('cadence_private.account_sync_snapshot()'::regprocedure) into definition;
  anchor := $a$    union all select 'note_shortcut_state', r.id, cadence_private.normalize_account_sync_row(to_jsonb(r) - 'user_id') from public.note_shortcut_states r where r.user_id = current_user_id$a$;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Account snapshot changed unexpectedly.';
  end if;
  execute replace(definition, anchor, anchor || $patch$ and r.id <> 'day_notes'$patch$);
end
$migration$;

commit;
