-- Behaviors of Opportunity (docs/RECURRENCE_RULES.md, "Behaviors of Opportunity").
--
-- behaviors.is_opportunity puts a Behavior in the opportunity pool. It is a capability,
-- not a run state: running, ended, paused and archived compose with it. An opportunity
-- Behavior may have no schedules, so its legacy recurrence_rule and scheduled_time may be
-- null. A Behavior that is not an opportunity still needs one to six schedules.
--
-- occurrences.origin tells a scheduled Occurrence (made by generation) from an
-- opportunity Occurrence (added by the person, the Daily Brief, Chat or an MCP client).
-- added_by names who added an opportunity Occurrence and is null for scheduled rows.
-- Generation never updates or deletes an opportunity row, and the schedule identity key
-- covers scheduled rows only, so an added row never blocks a planned one.
--
-- add_opportunity_occurrence and remove_opportunity_occurrence are the only writers of
-- opportunity rows on the web. Account sync contract 8 carries the new fields; older
-- writers must update first (no contract 7 fallback).
begin;

-- ------------------------------------------------------------------ columns

alter table public.behaviors
  add column is_opportunity boolean not null default false,
  alter column recurrence_rule drop not null,
  alter column scheduled_time drop not null,
  add constraint behaviors_schedule_or_opportunity check (
    is_opportunity or (recurrence_rule is not null and scheduled_time is not null)
  );

comment on column public.behaviors.is_opportunity is
  'True when the Behavior is available as an opportunity. It may then have no schedules, and recurrence_rule and scheduled_time may be null.';

alter table public.occurrences
  add column origin text not null default 'scheduled',
  add column added_by text,
  add constraint occurrences_origin_check check (origin in ('scheduled', 'opportunity')),
  add constraint occurrences_added_by_check check (
    added_by is null or added_by in ('user', 'daily_brief', 'chat', 'mcp')
  ),
  add constraint occurrences_origin_added_by_pair check ((origin = 'opportunity') = (added_by is not null));

comment on column public.occurrences.origin is
  'scheduled: made by occurrence generation. opportunity: added to a day from the opportunity pool; generation never changes or removes it.';
comment on column public.occurrences.added_by is
  'Who added an opportunity Occurrence: user, daily_brief, chat or mcp. Null for scheduled Occurrences.';

-- The schedule identity applies to scheduled rows only. Generation names this index in
-- its conflict target below.
alter table public.occurrences drop constraint occurrences_schedule_identity_key;
create unique index occurrences_schedule_identity_key
  on public.occurrences (behavior_id, local_date, schedule_start_time, schedule_range_identity)
  where origin = 'scheduled';

-- Turning the opportunity flag on or off is a revision.
drop trigger set_behaviors_updated_at on public.behaviors;
create trigger set_behaviors_updated_at
  before update of category_id, title, description, recurrence_rule, scheduled_time, timezone,
    browser_reminder_enabled, email_reminder_enabled, reminder_offset_minutes, active, archived_at,
    end_on, end_time, pause_from_on, pause_from_time, pause_back_on, is_opportunity
  on public.behaviors
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ configuration history

alter table public.behavior_configuration_events
  drop constraint behavior_configuration_events_changed_fields_check;

alter table public.behavior_configuration_events
  add constraint behavior_configuration_events_changed_fields_check
  check (
    cardinality(changed_fields) > 0
    and changed_fields <@ array[
      'category_id', 'location_text', 'where_kind', 'schedule_graph',
      'browser_reminder_enabled', 'email_reminder_enabled',
      'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity'
    ]::text[]
  );

-- A snapshot without 'is_opportunity' was not an opportunity. Kept in the order of
-- BEHAVIOR_CONFIGURATION_CHANGED_FIELDS in TypeScript.
create or replace function cadence_private.behavior_configuration_changed_fields(
  previous_configuration jsonb,
  next_configuration jsonb
)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when previous_configuration is null then array[
    'category_id', 'location_text', 'where_kind', 'schedule_graph',
    'browser_reminder_enabled', 'email_reminder_enabled',
    'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause', 'is_opportunity'
  ]::text[] else array_remove(array[
    case when previous_configuration -> 'category_id' is distinct from next_configuration -> 'category_id' then 'category_id' end,
    case when previous_configuration -> 'location_text' is distinct from next_configuration -> 'location_text' then 'location_text' end,
    case when coalesce(previous_configuration -> 'where_kind', case when previous_configuration ->> 'location_text' is null then 'null'::jsonb else '"place"'::jsonb end)
      is distinct from next_configuration -> 'where_kind' then 'where_kind' end,
    case when previous_configuration -> 'schedule_graph' is distinct from next_configuration -> 'schedule_graph' then 'schedule_graph' end,
    case when previous_configuration -> 'browser_reminder_enabled' is distinct from next_configuration -> 'browser_reminder_enabled' then 'browser_reminder_enabled' end,
    case when previous_configuration -> 'email_reminder_enabled' is distinct from next_configuration -> 'email_reminder_enabled' then 'email_reminder_enabled' end,
    case when previous_configuration -> 'reminder_offset_minutes' is distinct from next_configuration -> 'reminder_offset_minutes' then 'reminder_offset_minutes' end,
    case when previous_configuration -> 'active' is distinct from next_configuration -> 'active' then 'active' end,
    case when previous_configuration -> 'timezone' is distinct from next_configuration -> 'timezone' then 'timezone' end,
    case when coalesce(previous_configuration -> 'end', 'null'::jsonb) is distinct from coalesce(next_configuration -> 'end', 'null'::jsonb) then 'end' end,
    case when coalesce(previous_configuration -> 'pause', 'null'::jsonb) is distinct from coalesce(next_configuration -> 'pause', 'null'::jsonb) then 'pause' end,
    case when coalesce(previous_configuration -> 'is_opportunity', 'false'::jsonb) is distinct from coalesce(next_configuration -> 'is_opportunity', 'false'::jsonb) then 'is_opportunity' end
  ]::text[], null) end;
$$;

-- A configuration plan written before a field existed reads as keeping the stored value.
create or replace function cadence_private.behavior_configuration_with_run(planned jsonb, stored jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when planned is null or jsonb_typeof(planned) <> 'object' then planned
    else planned
      || case when planned ? 'end' then '{}'::jsonb
        else jsonb_build_object('end', coalesce(stored -> 'end', 'null'::jsonb)) end
      || case when planned ? 'pause' then '{}'::jsonb
        else jsonb_build_object('pause', coalesce(stored -> 'pause', 'null'::jsonb)) end
      || case when planned ? 'is_opportunity' then '{}'::jsonb
        else jsonb_build_object('is_opportunity', coalesce(stored -> 'is_opportunity', 'false'::jsonb)) end
  end;
$$;

revoke all on function cadence_private.behavior_configuration_with_run(jsonb, jsonb) from public, anon, authenticated;

-- The changed fields a plan must list: fields its next snapshot does not carry are left out.
create function cadence_private.behavior_configuration_planned_fields(expected text[], planned_next jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array(
    select field
    from unnest(expected) with ordinality as listed(field, position)
    where not (field = 'where_kind' and not coalesce(planned_next ? 'where_kind', false))
      and not (field in ('end', 'pause') and not coalesce(planned_next ? 'end', false))
      and not (field = 'is_opportunity' and not coalesce(planned_next ? 'is_opportunity', false))
    order by position
  );
$$;

revoke all on function cadence_private.behavior_configuration_planned_fields(text[], jsonb) from public, anon, service_role;
grant execute on function cadence_private.behavior_configuration_planned_fields(text[], jsonb) to authenticated;

-- ------------------------------------------------------------------ schedule count

-- One to six schedules, or none when the Behavior is an opportunity.
alter function cadence_private.validate_behavior_schedule_graph(jsonb)
  rename to validate_behavior_schedule_graph_v1;

-- A small text patcher for the function rewrites below: each anchor must occur once.
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
  select pg_get_functiondef('cadence_private.validate_behavior_schedule_graph_v1(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$cadence_private.validate_behavior_schedule_graph_v1(schedule_graph jsonb)$a$,
    $p$cadence_private.validate_behavior_schedule_graph(schedule_graph jsonb, allow_empty boolean DEFAULT false)$p$,
    'Schedule graph validator signature');
  definition := pg_temp.patch_definition(definition,
    $a$    or jsonb_array_length(schedule_graph) = 0
$a$,
    $p$    or (jsonb_array_length(schedule_graph) = 0 and not coalesce(allow_empty, false))
$p$,
    'Schedule graph validator count');
  execute definition;
end
$migration$;

drop function cadence_private.validate_behavior_schedule_graph_v1(jsonb);
revoke all on function cadence_private.validate_behavior_schedule_graph(jsonb, boolean) from public, anon, service_role;
grant execute on function cadence_private.validate_behavior_schedule_graph(jsonb, boolean) to authenticated;

do $migration$
declare
  definition text;
begin
  -- The saved graph is checked against the saved flag. Create and update write the
  -- Behavior row before the graph, so the flag is the one this write sets.
  select pg_get_functiondef('cadence_private.replace_behavior_schedule_graph(uuid,uuid,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$  perform cadence_private.validate_behavior_schedule_graph(schedule_graph);$a$,
    $p$  perform cadence_private.validate_behavior_schedule_graph(schedule_graph, coalesce((
    select behavior.is_opportunity
    from public.behaviors as behavior
    where behavior.user_id = target_user_id
      and behavior.id = target_behavior_id
  ), false));$p$, 'Schedule graph replace validation');
  execute definition;

  -- Snapshot: 'is_opportunity' joins the configuration.
  select pg_get_functiondef('cadence_private.current_behavior_configuration_snapshot(uuid,uuid)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    'timezone', behavior.timezone,
    'end', case$a$, $p$    'timezone', behavior.timezone,
    'is_opportunity', behavior.is_opportunity,
    'end', case$p$, 'Behavior configuration snapshot');
  execute definition;

  -- Plans without 'is_opportunity' keep the stored flag and need not list it.
  select pg_get_functiondef('cadence_private.insert_behavior_configuration_event(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    or planned_changed_fields is distinct from (case
      when (configuration_event_plan -> 'next_configuration') ? 'where_kind' then (case
        when (configuration_event_plan -> 'next_configuration') ? 'end' then expected_changed_fields
        else array_remove(array_remove(expected_changed_fields, 'end'), 'pause')
      end)
      else array_remove((case
        when (configuration_event_plan -> 'next_configuration') ? 'end' then expected_changed_fields
        else array_remove(array_remove(expected_changed_fields, 'end'), 'pause')
      end), 'where_kind')
    end)$a$, $p$    or planned_changed_fields is distinct from cadence_private.behavior_configuration_planned_fields(
      expected_changed_fields, configuration_event_plan -> 'next_configuration')$p$,
    'Configuration event plan changed fields');
  execute definition;

  -- Create: the payload may set is_opportunity, and then the graph may be empty and the
  -- legacy schedule columns null.
  select pg_get_functiondef('public.create_behavior_with_schedule_graph(jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$  perform cadence_private.validate_behavior_schedule_graph(schedule_graph);$a$,
    $p$  perform cadence_private.validate_behavior_schedule_graph(
    schedule_graph,
    coalesce((behavior_payload ->> 'is_opportunity')::boolean, false)
  );$p$, 'Behavior create validation');
  definition := pg_temp.patch_definition(definition, $a$    auto_archived_at,
    created_at,$a$, $p$    auto_archived_at,
    is_opportunity,
    created_at,$p$, 'Behavior create columns');
  definition := pg_temp.patch_definition(definition,
    $a$    nullif(behavior_payload ->> 'auto_archived_at', '')::timestamptz,
    behavior_created_at,$a$,
    $p$    nullif(behavior_payload ->> 'auto_archived_at', '')::timestamptz,
    coalesce((behavior_payload ->> 'is_opportunity')::boolean, false),
    behavior_created_at,$p$, 'Behavior create values');
  definition := pg_temp.patch_definition(definition, $a$    behavior_payload -> 'recurrence_rule',
    (behavior_payload ->> 'scheduled_time')::time,$a$, $p$    nullif(behavior_payload -> 'recurrence_rule', 'null'::jsonb),
    (behavior_payload ->> 'scheduled_time')::time,$p$, 'Behavior create schedule columns');
  execute definition;

  -- Update: is_opportunity changes only when the payload carries it. The graph is
  -- checked against the saved flag when it is replaced.
  select pg_get_functiondef('public.update_behavior_with_schedule_graph(uuid,jsonb,jsonb,jsonb,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition,
    $a$  perform cadence_private.validate_behavior_schedule_graph(schedule_graph);$a$,
    $p$  perform cadence_private.validate_behavior_schedule_graph(schedule_graph, true);$p$,
    'Behavior update validation');
  definition := pg_temp.patch_definition(definition, $a$    recurrence_rule = behavior_payload -> 'recurrence_rule',$a$,
    $p$    recurrence_rule = nullif(behavior_payload -> 'recurrence_rule', 'null'::jsonb),
    is_opportunity = case when behavior_payload ? 'is_opportunity'
      then coalesce((behavior_payload ->> 'is_opportunity')::boolean, false)
      else current_behavior.is_opportunity end,$p$, 'Behavior update fields');
  execute definition;

  -- BehaviorLog restore: the graph is checked against the restored flag when replaced.
  select pg_get_functiondef('public.apply_behaviorlog_restore_with_configuration_events(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$      perform cadence_private.validate_behavior_schedule_graph(
        derived_schedule_graph
      );$a$, $p$      perform cadence_private.validate_behavior_schedule_graph(
        derived_schedule_graph,
        true
      );$p$, 'BehaviorLog restore validation');
  execute definition;

  select pg_get_functiondef('public.apply_behaviorlog_restore_product_writes(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    auto_archived_at,
    archived_at,
    archive_notes,
    created_at,$a$, $p$    auto_archived_at,
    archived_at,
    archive_notes,
    is_opportunity,
    created_at,$p$, 'BehaviorLog restore Behavior columns');
  definition := pg_temp.patch_definition(definition, $a$    row -> 'recurrence_rule',
    (row ->> 'scheduled_time')::time,$a$, $p$    nullif(row -> 'recurrence_rule', 'null'::jsonb),
    (row ->> 'scheduled_time')::time,$p$, 'BehaviorLog restore schedule columns');
  definition := pg_temp.patch_definition(definition, $a$    coalesce(row -> 'archive_notes', '[]'::jsonb),
$a$, $p$    coalesce(row -> 'archive_notes', '[]'::jsonb),
    coalesce((row ->> 'is_opportunity')::boolean, false),
$p$, 'BehaviorLog restore Behavior values');
  definition := pg_temp.patch_definition(definition, $a$    archived_at = excluded.archived_at,
$a$, $p$    archived_at = excluded.archived_at,
    is_opportunity = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'is_opportunity'
    ) then excluded.is_opportunity else public.behaviors.is_opportunity end,
$p$, 'BehaviorLog restore Behavior flag');
  definition := pg_temp.patch_definition(definition, $a$    status_marked_at,
    note,
    created_at,
    updated_at
  )$a$, $p$    status_marked_at,
    note,
    origin,
    added_by,
    created_at,
    updated_at
  )$p$, 'BehaviorLog restore Occurrence columns');
  definition := pg_temp.patch_definition(definition, $a$    nullif(row ->> 'note', ''),
    coalesce(nullif(row ->> 'created_at', '')::timestamptz, now()),$a$, $p$    nullif(row ->> 'note', ''),
    coalesce(nullif(row ->> 'origin', ''), 'scheduled'),
    nullif(row ->> 'added_by', ''),
    coalesce(nullif(row ->> 'created_at', '')::timestamptz, now()),$p$, 'BehaviorLog restore Occurrence values');
  definition := pg_temp.patch_definition(definition, $a$    note = excluded.note,
    updated_at = now()
  where public.occurrences.user_id = current_user_id;$a$, $p$    note = excluded.note,
    origin = excluded.origin,
    added_by = excluded.added_by,
    updated_at = now()
  where public.occurrences.user_id = current_user_id;$p$, 'BehaviorLog restore Occurrence update');
  execute definition;

  -- Generation never updates or deletes an opportunity Occurrence. A plan that names one
  -- is refused, so a planner bug cannot remove a row the person added.
  select pg_get_functiondef('public.apply_occurrence_generation_plan(uuid,uuid,uuid,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$  insert into public.occurrences (
$a$, $p$  if exists (
    select 1
    from jsonb_to_recordset(occurrence_updates || occurrence_deletes) as planned(id uuid)
    join public.occurrences as occurrence
      on occurrence.user_id = target_user_id
      and occurrence.id = planned.id
    where occurrence.origin <> 'scheduled'
  ) then
    raise exception 'Occurrence generation cannot change an opportunity Occurrence.'
      using errcode = '22023';
  end if;

  insert into public.occurrences (
$p$, 'Occurrence generation opportunity guard');
  definition := pg_temp.patch_definition(definition, $a$  on conflict (
    behavior_id,
    local_date,
    schedule_start_time,
    schedule_range_identity
  ) do nothing;$a$, $p$  on conflict (
    behavior_id,
    local_date,
    schedule_start_time,
    schedule_range_identity
  ) where origin = 'scheduled' do nothing;$p$, 'Occurrence generation conflict target');
  definition := pg_temp.patch_definition(definition, $a$    and occurrence.scheduled_for = planned.previous_scheduled_for
$a$, $p$    and occurrence.scheduled_for = planned.previous_scheduled_for
    and occurrence.origin = 'scheduled'
$p$, 'Occurrence generation update scope');
  definition := pg_temp.patch_definition(definition, $a$    and occurrence.scheduled_for = planned.scheduled_for
    and occurrence.local_date = planned.local_date
$a$, $p$    and occurrence.scheduled_for = planned.scheduled_for
    and occurrence.local_date = planned.local_date
    and occurrence.origin = 'scheduled'
$p$, 'Occurrence generation delete scope');
  execute definition;

  -- Account sync contract 8: Behavior and Occurrence writes carry the new fields.
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$      'auto_archived_at', 'location_text', 'where_kind'
    ]) then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;$a$, $p$      'auto_archived_at', 'location_text', 'where_kind', 'is_opportunity'
    ]) then
      raise exception 'Update Cadence before synchronizing Behavior changes.' using errcode = '22023';
    end if;
    if write_kind = 'occurrence' and not ((write -> 'value') ?& array['origin', 'added_by']) then
      raise exception 'Update Cadence before synchronizing Occurrence changes.' using errcode = '22023';
    end if;$p$, 'Account sync compatibility guards');
  execute definition;
end
$migration$;

-- ------------------------------------------------------------------ add and remove

-- Adds one opportunity Occurrence for today, at an exact time (planned_end_time null) or
-- in a time range. With mark_completed it is stored Completed at the moment of the call,
-- with its status event, in the same transaction ("Done now"). A repeated call with the
-- same planned_occurrence_id returns the row it made.
create function public.add_opportunity_occurrence(
  target_behavior_id uuid,
  planned_local_date date,
  planned_start_time time,
  planned_end_time time default null,
  planned_preset text default null,
  planned_added_by text default 'user',
  mark_completed boolean default false,
  planned_occurrence_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  call_at timestamptz := now();
  target_behavior public.behaviors;
  planned_kind text;
  starts_at timestamptz;
  ends_at timestamptz;
  existing_occurrence public.occurrences;
  created_occurrence public.occurrences;
  created_event public.occurrence_status_events;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if target_behavior_id is null or planned_local_date is null or planned_start_time is null then
    raise exception 'A Behavior, a day and a start time are required.' using errcode = '22023';
  end if;
  if planned_added_by is null or planned_added_by not in ('user', 'daily_brief', 'chat', 'mcp') then
    raise exception 'Unsupported opportunity source: %.', planned_added_by using errcode = '22023';
  end if;
  mark_completed := coalesce(mark_completed, false);
  if mark_completed and planned_added_by = 'daily_brief' then
    raise exception 'A Daily Brief suggestion cannot mark an Occurrence Completed.' using errcode = '22023';
  end if;
  if date_trunc('minute', planned_start_time::interval) <> planned_start_time::interval
    or (planned_end_time is not null and date_trunc('minute', planned_end_time::interval) <> planned_end_time::interval)
  then
    raise exception 'Opportunity times must be whole minutes.' using errcode = '22023';
  end if;
  planned_kind := case when planned_end_time is null then 'exact' else 'range' end;
  if planned_kind = 'exact' and planned_preset is not null then
    raise exception 'An exact time cannot have a time-of-day preset.' using errcode = '22023';
  end if;
  if planned_kind = 'range' and planned_end_time = planned_start_time then
    raise exception 'A time range needs an end that differs from its start.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text, 0));

  select behavior.* into target_behavior
  from public.behaviors as behavior
  where behavior.user_id = current_user_id and behavior.id = target_behavior_id
  for share;

  if not found then
    raise exception 'Behavior not found.' using errcode = 'P0002';
  end if;

  starts_at := cadence_private.behavior_local_instant(planned_local_date, planned_start_time, target_behavior.timezone);
  ends_at := case when planned_kind = 'range' then cadence_private.behavior_planned_range_end(
    planned_local_date, planned_start_time, planned_end_time, target_behavior.timezone) end;

  if planned_occurrence_id is not null then
    select occurrence.* into existing_occurrence
    from public.occurrences as occurrence
    where occurrence.id = planned_occurrence_id;

    if found then
      if existing_occurrence.user_id = current_user_id
        and existing_occurrence.behavior_id = target_behavior_id
        and existing_occurrence.origin = 'opportunity'
        and existing_occurrence.added_by = planned_added_by
        and existing_occurrence.local_date = planned_local_date
        and existing_occurrence.schedule_start_time = planned_start_time
        and existing_occurrence.schedule_end_time is not distinct from planned_end_time
        and existing_occurrence.schedule_preset is not distinct from planned_preset
      then
        return jsonb_build_object(
          'created', false,
          'occurrence', to_jsonb(existing_occurrence),
          'status_event', null
        );
      end if;
      raise exception 'The Occurrence ID is already in use.' using errcode = 'P0001';
    end if;
  end if;

  if not target_behavior.is_opportunity then
    raise exception 'This Behavior is not available as an opportunity.' using errcode = 'P0001';
  end if;
  if not target_behavior.active or target_behavior.archived_at is not null then
    raise exception 'An archived Behavior cannot be added.' using errcode = 'P0001';
  end if;
  if planned_local_date <> (call_at at time zone target_behavior.timezone)::date then
    raise exception 'An opportunity can be added to today only.' using errcode = '22023';
  end if;
  if cadence_private.behavior_stops_occurrence(
      target_behavior.end_on, target_behavior.end_time, target_behavior.pause_from_on,
      target_behavior.pause_from_time, target_behavior.pause_back_on, target_behavior.timezone,
      call_at, null)
    or cadence_private.behavior_stops_occurrence(
      target_behavior.end_on, target_behavior.end_time, target_behavior.pause_from_on,
      target_behavior.pause_from_time, target_behavior.pause_back_on, target_behavior.timezone,
      starts_at, ends_at)
  then
    raise exception 'This Behavior is not running at that time.' using errcode = 'P0001';
  end if;

  insert into public.occurrences (
    id,
    user_id,
    behavior_id,
    behavior_schedule_slot_id,
    behavior_configuration_event_id,
    scheduled_for,
    local_date,
    schedule_kind,
    schedule_preset,
    schedule_start_time,
    schedule_end_time,
    status,
    completed_at,
    status_marked_at,
    origin,
    added_by
  )
  values (
    coalesce(planned_occurrence_id, gen_random_uuid()),
    current_user_id,
    target_behavior_id,
    null,
    target_behavior.current_configuration_event_id,
    starts_at,
    planned_local_date,
    planned_kind,
    planned_preset,
    planned_start_time,
    planned_end_time,
    case when mark_completed then 'completed' else 'unresolved' end,
    case when mark_completed then call_at end,
    case when mark_completed then call_at end,
    'opportunity',
    planned_added_by
  )
  returning * into created_occurrence;

  if mark_completed then
    insert into public.occurrence_status_events (
      user_id,
      occurrence_id,
      behavior_id,
      previous_status,
      status,
      status_semantics,
      recorded_at,
      effective_at,
      local_date,
      timezone,
      source_capture_method,
      source_confidence,
      revises_event_id,
      reason_code
    )
    values (
      current_user_id,
      created_occurrence.id,
      target_behavior_id,
      'unresolved',
      'completed',
      'explicit_user_mark',
      call_at,
      call_at,
      planned_local_date,
      target_behavior.timezone,
      case when planned_added_by = 'user' then 'manual_tap' else 'manual_text' end,
      'high',
      null,
      null
    )
    returning * into created_event;
  end if;

  return jsonb_build_object(
    'created', true,
    'occurrence', to_jsonb(created_occurrence),
    'status_event', case when created_event.id is null then null else to_jsonb(created_event) end
  );
end;
$$;

-- Removes an added opportunity Occurrence that holds nothing: Unresolved, no Note, no
-- tracked time, no status history and no active source match. Pending reminders are
-- cancelled first. Account sync sees the row gone from the next hosted snapshot.
create function public.remove_opportunity_occurrence(target_occurrence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_occurrence public.occurrences;
  cancelled_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if target_occurrence_id is null then
    raise exception 'An Occurrence is required.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text, 0));

  select occurrence.* into target_occurrence
  from public.occurrences as occurrence
  where occurrence.user_id = current_user_id and occurrence.id = target_occurrence_id
  for update;

  if not found then
    raise exception 'Occurrence not found.' using errcode = 'P0002';
  end if;
  if target_occurrence.origin <> 'opportunity' then
    raise exception 'Only an added opportunity can be removed.' using errcode = 'P0001';
  end if;
  if target_occurrence.status <> 'unresolved' then
    raise exception 'Only an Unresolved opportunity can be removed.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(target_occurrence.note, '')) <> '' then
    raise exception 'An opportunity with a Note cannot be removed.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.occurrence_time_sessions as session
    where session.user_id = current_user_id and session.occurrence_id = target_occurrence.id
  ) then
    raise exception 'An opportunity with tracked time cannot be removed.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.occurrence_status_events as status_event
    where status_event.user_id = current_user_id and status_event.occurrence_id = target_occurrence.id
  ) then
    raise exception 'An opportunity with status history cannot be removed.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.occurrence_source_matches as source_match
    where source_match.user_id = current_user_id
      and source_match.occurrence_id = target_occurrence.id
      and source_match.state = 'active'
  ) then
    raise exception 'An opportunity with a connected activity cannot be removed.' using errcode = 'P0001';
  end if;

  update public.reminder_deliveries as delivery
  set status = 'cancelled', error = null
  where delivery.user_id = current_user_id
    and delivery.occurrence_id = target_occurrence.id
    and delivery.status = 'pending';
  get diagnostics cancelled_count = row_count;

  delete from public.occurrences as occurrence
  where occurrence.user_id = current_user_id and occurrence.id = target_occurrence.id;

  return jsonb_build_object(
    'removed', true,
    'occurrence', to_jsonb(target_occurrence),
    'cancelled_reminder_count', cancelled_count
  );
end;
$$;

revoke all on function public.add_opportunity_occurrence(uuid, date, time, time, text, text, boolean, uuid) from public, anon, service_role;
revoke all on function public.remove_opportunity_occurrence(uuid) from public, anon, service_role;
grant execute on function public.add_opportunity_occurrence(uuid, date, time, time, text, text, boolean, uuid) to authenticated;
grant execute on function public.remove_opportunity_occurrence(uuid) to authenticated;

-- ------------------------------------------------------------------ account sync contract 8

insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values
  (8, 'behavior', 'is_opportunity', 'false'::jsonb),
  (8, 'occurrence', 'origin', '"scheduled"'::jsonb),
  (8, 'occurrence', 'added_by', 'null'::jsonb);

-- Contract 7 writers cannot carry opportunity fields or an unscheduled Behavior.
create or replace function cadence_private.account_sync_min_writer_contract()
returns integer
language sql
immutable
set search_path = ''
as $$ select 8 $$;

drop function pg_temp.patch_definition(text, text, text, text);

commit;
