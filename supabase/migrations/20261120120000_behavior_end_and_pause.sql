-- Ended and Paused Behaviors (docs/RECURRENCE_RULES.md, "Behavior end and pause").
--
-- A Behavior's end becomes "Ends after": end_on is the last local day it runs, with an
-- optional end_time. Reaching the end no longer archives anything: the Behavior stays
-- active and shows under Not running. A pause runs from pause_from_on (at
-- pause_from_time, or the start of that day) until the start of pause_back_on.
--
-- Stops are stored as local days and times, never instants (rule T1), and join the
-- configuration snapshot as 'end' and 'pause' (rule T2), so every set, change or clear
-- writes a normal revision. Nothing is written when a moment arrives: the archive job
-- and its RPCs are removed (rule T3). Occurrence generation removes rows an end or a
-- pause stops when it saves, comparing the effective (moved) time (rule T4).
--
-- Backfill (rule T9): end_date was the first local day the Behavior no longer ran, so
-- end_on = end_date - 1 with no time. Behaviors the job already archived stay archived
-- and keep auto_archived_at.
--
-- Account sync contract 7 carries the new fields, and older writers must update
-- (rule R5): Mac 0.1.12 shows "Update Cadence".
begin;

-- ------------------------------------------------------------------ columns

alter table public.behaviors
  add column end_on date,
  add column end_time time,
  add column pause_from_on date,
  add column pause_from_time time,
  add column pause_back_on date;

-- The updated_at trigger does not watch end_on yet, so revisions stay unchanged.
update public.behaviors
set end_on = end_date - 1
where end_date is not null and end_date > date '0001-01-01';

alter table public.behaviors
  drop constraint behaviors_end_date_check,
  drop column end_date,
  add constraint behaviors_end_valid check (
    (end_on is null or (end_on >= date '0001-01-01' and end_on <= date '9999-12-30'))
    and (end_time is null or (end_on is not null and date_trunc('minute', end_time::interval) = end_time::interval))
  ),
  add constraint behaviors_pause_valid check (
    (pause_from_on is null) = (pause_back_on is null)
    and (pause_from_time is null or pause_from_on is not null)
    and (pause_from_time is null or date_trunc('minute', pause_from_time::interval) = pause_from_time::interval)
    and (pause_from_on is null or (pause_from_on >= date '0001-01-01' and pause_back_on > pause_from_on and pause_back_on <= date '9999-12-31'))
  );

comment on column public.behaviors.end_on is
  'Last local day the Behavior runs. With end_time it stops at that local time, otherwise at the end of the day. Reaching it never archives.';
comment on column public.behaviors.end_time is
  'Optional local stop time on end_on, in whole minutes.';
comment on column public.behaviors.pause_from_on is
  'First paused local day. One pause at a time; a new pause replaces the old one.';
comment on column public.behaviors.pause_from_time is
  'Optional local time on pause_from_on when the pause starts, in whole minutes.';
comment on column public.behaviors.pause_back_on is
  'Local day the Behavior runs again by itself, from the start of the day.';
comment on column public.behaviors.auto_archived_at is
  'Set on Behaviors the retired end-date archive job archived. Nothing sets it any more.';

-- An end or a pause change is a revision: integration conflict checks read updated_at.
drop trigger set_behaviors_updated_at on public.behaviors;
create trigger set_behaviors_updated_at
  before update of category_id, title, description, recurrence_rule, scheduled_time, timezone,
    browser_reminder_enabled, email_reminder_enabled, reminder_offset_minutes, active, archived_at,
    end_on, end_time, pause_from_on, pause_from_time, pause_back_on
  on public.behaviors
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ stop rules

-- A local day and time as an instant, by the "compatible" rule (docs/DATETIME_STRATEGY.md):
-- a time skipped by a spring-forward transition moves forward by the gap, and a repeated
-- time takes the earlier instant. Postgres alone picks the later instant for a repeated time.
create function cadence_private.behavior_local_instant(local_day date, local_time time, zone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with local_value as (
    select local_day + local_time as local_timestamp
  ), default_value as (
    select local_timestamp, local_timestamp at time zone zone as default_instant
    from local_value
  ), candidates as (
    select default_instant, local_timestamp,
      (local_timestamp - ((sample_instant at time zone zone) - (sample_instant at time zone 'UTC'))) at time zone 'UTC' as candidate_instant
    from default_value
    cross join lateral unnest(array[
      default_instant - interval '1 day', default_instant, default_instant + interval '1 day'
    ]) as sample(sample_instant)
  )
  select coalesce(
    min(candidate_instant) filter (where candidate_instant at time zone zone = local_timestamp),
    min(default_instant)
  )
  from candidates;
$$;

-- The instant a Behavior stops: end_time on end_on, or the start of the day after.
create function cadence_private.behavior_end_instant(end_on date, end_time time, zone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when end_on is null then null
    when end_time is null then cadence_private.behavior_local_instant(end_on + 1, time '00:00', zone)
    else cadence_private.behavior_local_instant(end_on, end_time, zone)
  end;
$$;

-- The window end of a time range planned on a local day. A range whose end is at or
-- before its start ends on the next day.
create function cadence_private.behavior_planned_range_end(local_day date, start_time time, end_time time, zone text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select cadence_private.behavior_local_instant(
    case when end_time <= start_time then local_day + 1 else local_day end, end_time, zone);
$$;

-- True when an end or a pause removes an Occurrence (rule T4). starts_at and ends_at are
-- the effective (moved) times; ends_at is null for an exact time. An exact time is
-- stopped when it starts at or after the end, or inside the pause. A time range is
-- stopped when it is still open at the end, or overlaps the pause. Kept equal to
-- isStoppedByRunFields in packages/core/src/resolvers/behavior-run.resolver.ts.
create function cadence_private.behavior_stops_occurrence(
  end_on date, end_time time, pause_from_on date, pause_from_time time, pause_back_on date,
  zone text, starts_at timestamptz, ends_at timestamptz
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  end_at timestamptz := cadence_private.behavior_end_instant(end_on, end_time, zone);
  pause_start timestamptz;
  pause_back timestamptz;
begin
  if starts_at is null then return false; end if;
  if end_at is not null and (case when ends_at is not null then ends_at > end_at else starts_at >= end_at end) then
    return true;
  end if;
  if pause_from_on is null or pause_back_on is null then return false; end if;
  pause_start := cadence_private.behavior_local_instant(pause_from_on, coalesce(pause_from_time, time '00:00'), zone);
  pause_back := cadence_private.behavior_local_instant(pause_back_on, time '00:00', zone);
  if starts_at >= pause_back then return false; end if;
  return case when ends_at is not null then ends_at > pause_start else starts_at >= pause_start end;
end;
$$;

revoke all on function cadence_private.behavior_local_instant(date, time, text) from public, anon, service_role;
revoke all on function cadence_private.behavior_end_instant(date, time, text) from public, anon, service_role;
revoke all on function cadence_private.behavior_planned_range_end(date, time, time, text) from public, anon, service_role;
revoke all on function cadence_private.behavior_stops_occurrence(date, time, date, time, date, text, timestamptz, timestamptz) from public, anon, service_role;
grant execute on function cadence_private.behavior_local_instant(date, time, text) to authenticated;
grant execute on function cadence_private.behavior_end_instant(date, time, text) to authenticated;
grant execute on function cadence_private.behavior_planned_range_end(date, time, time, text) to authenticated;
grant execute on function cadence_private.behavior_stops_occurrence(date, time, date, time, date, text, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------------------ archive job removed

drop function public.archive_due_behaviors(timestamptz, integer);
drop function public.archive_my_due_behaviors(integer);
drop function cadence_private.archive_due_behaviors_for_owner(uuid, timestamptz, integer);
drop function cadence_private.behavior_end_date_boundary(date, text);

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
      'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause'
    ]::text[]
  );

-- Existing history is not rewritten. A snapshot without 'end' or 'pause' had neither.
-- Kept in the order of BEHAVIOR_CONFIGURATION_CHANGED_FIELDS in TypeScript.
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
    'reminder_offset_minutes', 'active', 'timezone', 'end', 'pause'
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
    case when coalesce(previous_configuration -> 'pause', 'null'::jsonb) is distinct from coalesce(next_configuration -> 'pause', 'null'::jsonb) then 'pause' end
  ]::text[], null) end;
$$;

-- A configuration plan written before end and pause existed (an older client, a
-- saved fixture) has no 'end' or 'pause' keys. It reads as keeping the stored
-- values, as a plan without where_kind already does.
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
  end;
$$;

revoke all on function cadence_private.behavior_configuration_with_run(jsonb, jsonb) from public, anon, authenticated;

-- A small text patcher for the function rewrites below: each anchor must occur once.
create function pg_temp.patch_definition(definition text, anchor text, replacement text, label text)
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
  -- Snapshot: 'end' {on, time} and 'pause' {from_on, from_time, back_on}, null when unset.
  -- Times are text HH:MM:SS, as toBehaviorConfigurationSnapshotPayload writes them.
  select pg_get_functiondef('cadence_private.current_behavior_configuration_snapshot(uuid,uuid)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    'timezone', behavior.timezone
  )$a$, $p$    'timezone', behavior.timezone,
    'end', case when behavior.end_on is null then null else jsonb_build_object(
      'on', behavior.end_on::text,
      'time', case when behavior.end_time is null then null else to_jsonb(behavior.end_time::text) end
    ) end,
    'pause', case when behavior.pause_from_on is null then null else jsonb_build_object(
      'from_on', behavior.pause_from_on::text,
      'from_time', case when behavior.pause_from_time is null then null else to_jsonb(behavior.pause_from_time::text) end,
      'back_on', behavior.pause_back_on::text
    ) end
  )$p$, 'Behavior configuration snapshot');
  execute definition;

  -- Create: the run fields replace end_date.
  select pg_get_functiondef('public.create_behavior_with_schedule_graph(jsonb,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    end_date,
    auto_archived_at,$a$, $p$    end_on,
    end_time,
    pause_from_on,
    pause_from_time,
    pause_back_on,
    auto_archived_at,$p$, 'Behavior create columns');
  definition := pg_temp.patch_definition(definition, $a$    nullif(behavior_payload ->> 'end_date', '')::date,$a$, $p$    nullif(behavior_payload ->> 'end_on', '')::date,
    nullif(behavior_payload ->> 'end_time', '')::time,
    nullif(behavior_payload ->> 'pause_from_on', '')::date,
    nullif(behavior_payload ->> 'pause_from_time', '')::time,
    nullif(behavior_payload ->> 'pause_back_on', '')::date,$p$, 'Behavior create values');
  execute definition;

  -- Update: each run field changes only when the payload carries it.
  select pg_get_functiondef('public.update_behavior_with_schedule_graph(uuid,jsonb,jsonb,jsonb,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    end_date = case when behavior_payload ? 'end_date'
      then nullif(behavior_payload ->> 'end_date', '')::date
      else current_behavior.end_date end,$a$, $p$    end_on = case when behavior_payload ? 'end_on'
      then nullif(behavior_payload ->> 'end_on', '')::date
      else current_behavior.end_on end,
    end_time = case when behavior_payload ? 'end_time'
      then nullif(behavior_payload ->> 'end_time', '')::time
      else current_behavior.end_time end,
    pause_from_on = case when behavior_payload ? 'pause_from_on'
      then nullif(behavior_payload ->> 'pause_from_on', '')::date
      else current_behavior.pause_from_on end,
    pause_from_time = case when behavior_payload ? 'pause_from_time'
      then nullif(behavior_payload ->> 'pause_from_time', '')::time
      else current_behavior.pause_from_time end,
    pause_back_on = case when behavior_payload ? 'pause_back_on'
      then nullif(behavior_payload ->> 'pause_back_on', '')::date
      else current_behavior.pause_back_on end,$p$, 'Behavior update fields');
  execute definition;

  -- Timezone change (rule T1): the plan carries the re-expressed end and pause start of
  -- stops that already happened, so their moment stays. The next snapshot is read back.
  select pg_get_functiondef('public.update_profile_and_behavior_timezones_with_config_events(text,text,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    next_configuration := jsonb_set(
      previous_configuration,
      '{timezone}',
      to_jsonb(target_timezone),
      true
    );
    configuration_event_plan := nullif(
      behavior_change -> 'configuration_event_plan',
      'null'::jsonb
    );

    if previous_configuration is distinct from next_configuration then
      update public.behaviors
      set timezone = target_timezone
      where user_id = current_user_id
        and id = current_behavior.id;

      perform cadence_private.insert_behavior_configuration_event($a$, $p$    configuration_event_plan := nullif(
      behavior_change -> 'configuration_event_plan',
      'null'::jsonb
    );

    if current_behavior.timezone is distinct from target_timezone
      or (behavior_change ? 'run' and (
        current_behavior.end_on is distinct from nullif(behavior_change -> 'run' ->> 'end_on', '')::date
        or current_behavior.end_time is distinct from nullif(behavior_change -> 'run' ->> 'end_time', '')::time
        or current_behavior.pause_from_on is distinct from nullif(behavior_change -> 'run' ->> 'pause_from_on', '')::date
        or current_behavior.pause_from_time is distinct from nullif(behavior_change -> 'run' ->> 'pause_from_time', '')::time
      ))
    then
      update public.behaviors
      set timezone = target_timezone,
        end_on = case when behavior_change ? 'run' then nullif(behavior_change -> 'run' ->> 'end_on', '')::date else end_on end,
        end_time = case when behavior_change ? 'run' then nullif(behavior_change -> 'run' ->> 'end_time', '')::time else end_time end,
        pause_from_on = case when behavior_change ? 'run' then nullif(behavior_change -> 'run' ->> 'pause_from_on', '')::date else pause_from_on end,
        pause_from_time = case when behavior_change ? 'run' then nullif(behavior_change -> 'run' ->> 'pause_from_time', '')::time else pause_from_time end
      where user_id = current_user_id
        and id = current_behavior.id;
    end if;
    next_configuration :=
      cadence_private.current_behavior_configuration_snapshot(
        current_user_id,
        current_behavior.id
      );

    if previous_configuration is distinct from next_configuration then
      perform cadence_private.insert_behavior_configuration_event($p$, 'Timezone change configuration');
  execute definition;

  -- Generation: no planned row may be one an end or a pause stops, and a stopped row
  -- may be removed even when it is past or moved (rule T4).
  select pg_get_functiondef('public.apply_occurrence_generation_plan(uuid,uuid,uuid,timestamp with time zone,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$  if exists (
    select 1 from public.behaviors as behavior
    cross join jsonb_to_recordset(occurrence_inserts || occurrence_updates) as planned(local_date date)
    where behavior.user_id = target_user_id and behavior.id = target_behavior_id
      and behavior.end_date is not null and planned.local_date >= behavior.end_date
  ) then
    raise exception 'Behavior end date changed after occurrence planning.' using errcode = 'P0001';
  end if;$a$, $p$  if exists (
    select 1 from public.behaviors as behavior
    cross join jsonb_to_recordset(occurrence_inserts || occurrence_updates) as planned(
      scheduled_for timestamptz, local_date date, schedule_kind text, schedule_start_time time, schedule_end_time time
    )
    where behavior.user_id = target_user_id and behavior.id = target_behavior_id
      and (behavior.end_on is not null or behavior.pause_from_on is not null)
      and cadence_private.behavior_stops_occurrence(
        behavior.end_on, behavior.end_time, behavior.pause_from_on, behavior.pause_from_time, behavior.pause_back_on,
        behavior.timezone, planned.scheduled_for,
        case when planned.schedule_kind = 'range' and planned.schedule_end_time is not null
          then cadence_private.behavior_planned_range_end(planned.local_date, planned.schedule_start_time, planned.schedule_end_time, behavior.timezone)
        end)
  ) then
    raise exception 'Behavior end or pause changed after occurrence planning.' using errcode = 'P0001';
  end if;$p$, 'Occurrence generation insert guard');
  definition := pg_temp.patch_definition(definition, $a$      or exists (
        select 1 from public.behaviors as behavior
        where behavior.id = target_behavior_id and behavior.user_id = target_user_id
          and behavior.end_date is not null and occurrence.local_date >= behavior.end_date
      )$a$, $p$      or exists (
        select 1 from public.behaviors as behavior
        where behavior.id = target_behavior_id and behavior.user_id = target_user_id
          and (behavior.end_on is not null or behavior.pause_from_on is not null)
          and cadence_private.behavior_stops_occurrence(
            behavior.end_on, behavior.end_time, behavior.pause_from_on, behavior.pause_from_time, behavior.pause_back_on,
            behavior.timezone, coalesce(occurrence.effective_start_at, occurrence.scheduled_for),
            case when occurrence.schedule_kind <> 'range' then null
              when occurrence.effective_start_at is not null then occurrence.effective_end_at
              when occurrence.schedule_end_time is not null then cadence_private.behavior_planned_range_end(
                occurrence.local_date, occurrence.schedule_start_time, occurrence.schedule_end_time, behavior.timezone)
            end)
      )$p$, 'Occurrence generation delete guard');
  execute definition;

  -- Account sync: a Behavior write must carry the run fields (contract 7).
  select pg_get_functiondef('cadence_private.apply_account_sync_plan(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$      'default_duration_minutes', 'end_date', 'auto_archived_at', 'location_text', 'where_kind'$a$,
    $p$      'default_duration_minutes', 'end_on', 'end_time', 'pause_from_on', 'pause_from_time', 'pause_back_on',
      'auto_archived_at', 'location_text', 'where_kind'$p$, 'Account sync Behavior compatibility guard');
  execute definition;

  -- BehaviorLog import: the plan row's cadenceRun carries the end and pause.
  select pg_get_functiondef('cadence_private.apply_behaviorlog_import(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$default_duration_minutes, end_date, auto_archived_at, archived_at, archive_notes,$a$,
    $p$default_duration_minutes, end_on, end_time, pause_from_on, pause_from_time, pause_back_on, auto_archived_at, archived_at, archive_notes,$p$,
    'BehaviorLog import columns');
  definition := pg_temp.patch_definition(definition, $a$        nullif(row_value ->> 'cadenceEndDate', '')::date,$a$, $p$        nullif(row_value -> 'cadenceRun' ->> 'endOn', '')::date,
        nullif(row_value -> 'cadenceRun' ->> 'endTime', '')::time,
        nullif(row_value -> 'cadenceRun' ->> 'pauseFromOn', '')::date,
        nullif(row_value -> 'cadenceRun' ->> 'pauseFromTime', '')::time,
        nullif(row_value -> 'cadenceRun' ->> 'pauseBackOn', '')::date,$p$, 'BehaviorLog import values');
  execute definition;

  -- BehaviorLog restore: run fields change only when the restored record carries them.
  -- Restore no longer clears an end that has passed: the Behavior comes back as Ended.
  select pg_get_functiondef('public.apply_behaviorlog_restore_product_writes(jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    default_duration_minutes,
    end_date,
    auto_archived_at,$a$, $p$    default_duration_minutes,
    end_on,
    end_time,
    pause_from_on,
    pause_from_time,
    pause_back_on,
    auto_archived_at,$p$, 'BehaviorLog restore columns');
  definition := pg_temp.patch_definition(definition, $a$    nullif(row ->> 'end_date', '')::date,$a$, $p$    nullif(row ->> 'end_on', '')::date,
    nullif(row ->> 'end_time', '')::time,
    nullif(row ->> 'pause_from_on', '')::date,
    nullif(row ->> 'pause_from_time', '')::time,
    nullif(row ->> 'pause_back_on', '')::date,$p$, 'BehaviorLog restore values');
  definition := pg_temp.patch_definition(definition, $a$    end_date = case
      when excluded.active and not public.behaviors.active
        and coalesce(excluded.end_date, public.behaviors.end_date) <=
          (clock_timestamp() at time zone excluded.timezone)::date then null
      when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'end_date'
    ) then excluded.end_date else public.behaviors.end_date end,$a$, $p$    end_on = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'end_on'
    ) then excluded.end_on else public.behaviors.end_on end,
    end_time = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'end_on'
    ) then excluded.end_time else public.behaviors.end_time end,
    pause_from_on = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'pause_from_on'
    ) then excluded.pause_from_on else public.behaviors.pause_from_on end,
    pause_from_time = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'pause_from_on'
    ) then excluded.pause_from_time else public.behaviors.pause_from_time end,
    pause_back_on = case when exists (
      select 1 from jsonb_array_elements(restore_payload -> 'behaviors') source
      where source ->> 'id' = excluded.id::text and source ? 'pause_from_on'
    ) then excluded.pause_back_on else public.behaviors.pause_back_on end,$p$, 'BehaviorLog restore end');
  execute definition;

  -- Export page bundle: the run fields replace end_date.
  select pg_get_functiondef('public.get_export_page_read_bundle(date,date)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$            'end_date', b.end_date,$a$, $p$            'end_on', b.end_on,
            'end_time', case when b.end_time is null then null else to_jsonb(b.end_time::text) end,
            'pause_from_on', b.pause_from_on,
            'pause_from_time', case when b.pause_from_time is null then null else to_jsonb(b.pause_from_time::text) end,
            'pause_back_on', b.pause_back_on,$p$, 'Export page Behavior fields');
  execute definition;

  -- Advisor snapshot: the run fields replace endDate, and the archive count goes.
  select pg_get_functiondef('cadence_private.advisor_cadence_snapshot_payload(uuid,date,date,uuid[],integer,integer)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$        'endDate', behavior.end_date$a$, $p$        'endOn', behavior.end_on,
        'endTime', case when behavior.end_time is null then null else to_jsonb(behavior.end_time::text) end,
        'pauseFromOn', behavior.pause_from_on,
        'pauseFromTime', case when behavior.pause_from_time is null then null else to_jsonb(behavior.pause_from_time::text) end,
        'pauseBackOn', behavior.pause_back_on,
        'timezone', behavior.timezone$p$, 'Advisor snapshot Behavior fields');
  definition := pg_temp.patch_definition(definition, $a$    'dueArchiveCount', (
      select count(*)
      from public.behaviors as behavior
      where behavior.user_id = owner_id
        and behavior.id = any(selected_behavior_ids)
        and behavior.active
        and behavior.end_date is not null
        and target_local_date >= behavior.end_date
    ),
$a$, '', 'Advisor snapshot archive count');
  execute definition;

  -- MCP: the receipt source carries the run fields in place of end_date.
  select pg_get_functiondef('cadence_private.integration_write_source(jsonb,text)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$'auto_archived_at','end_date',$a$,
    $p$'auto_archived_at','end_on','end_time','pause_from_on','pause_from_time','pause_back_on',$p$, 'Integration write source fields');
  execute definition;

  -- MCP: end_behavior, pause_behavior and resume_behavior write through the update path.
  -- Repeating one that already holds sends no configuration plan and changes nothing.
  select pg_get_functiondef('public.integration_lock_write(text,text,text)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    when p_operation in ('create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior') then 'cadence.behaviors.write'$a$,
    $p$    when p_operation in ('create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior',
      'end_behavior', 'pause_behavior', 'resume_behavior') then 'cadence.behaviors.write'$p$, 'Integration write scopes');
  execute definition;

  select pg_get_functiondef('public.integration_apply_write(text,text,text,text,jsonb,timestamp with time zone,text)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    elsif p_operation in ('update_behavior', 'archive_behavior', 'restore_behavior')$a$,
    $p$    elsif p_operation in ('update_behavior', 'archive_behavior', 'restore_behavior',
        'end_behavior', 'pause_behavior', 'resume_behavior')$p$, 'Integration Behavior write operations');
  definition := pg_temp.patch_definition(definition, $a$        or (p_operation = 'restore_behavior' and (before_row->>'active')::boolean) then$a$,
    $p$        or (p_operation = 'restore_behavior' and (before_row->>'active')::boolean)
        or (p_operation in ('end_behavior', 'pause_behavior', 'resume_behavior')
          and nullif(p_args->'configuration_event_plan', 'null'::jsonb) is null) then$p$, 'Integration Behavior no-op writes');
  execute definition;

  -- Configuration plans without end and pause keys keep the stored values.
  select pg_get_functiondef('cadence_private.insert_behavior_configuration_event(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure) into definition;
  definition := pg_temp.patch_definition(definition, $a$    or cadence_private.behavior_configuration_with_where(configuration_event_plan -> 'previous_configuration')
      is distinct from coalesce(previous_configuration, 'null'::jsonb)
    or cadence_private.behavior_configuration_with_where(configuration_event_plan -> 'next_configuration')
      is distinct from next_configuration$a$, $p$    or cadence_private.behavior_configuration_with_run(
      cadence_private.behavior_configuration_with_where(configuration_event_plan -> 'previous_configuration'),
      previous_configuration)
      is distinct from coalesce(previous_configuration, 'null'::jsonb)
    or cadence_private.behavior_configuration_with_run(
      cadence_private.behavior_configuration_with_where(configuration_event_plan -> 'next_configuration'),
      next_configuration)
      is distinct from next_configuration$p$, 'Configuration event plan snapshots');
  definition := pg_temp.patch_definition(definition, $a$    or planned_changed_fields is distinct from (case
      when (configuration_event_plan -> 'next_configuration') ? 'where_kind' then expected_changed_fields
      else array_remove(expected_changed_fields, 'where_kind')
    end)$a$, $p$    or planned_changed_fields is distinct from (case
      when (configuration_event_plan -> 'next_configuration') ? 'where_kind' then (case
        when (configuration_event_plan -> 'next_configuration') ? 'end' then expected_changed_fields
        else array_remove(array_remove(expected_changed_fields, 'end'), 'pause')
      end)
      else array_remove((case
        when (configuration_event_plan -> 'next_configuration') ? 'end' then expected_changed_fields
        else array_remove(array_remove(expected_changed_fields, 'end'), 'pause')
      end), 'where_kind')
    end)$p$, 'Configuration event plan changed fields');
  execute definition;
end
$migration$;

-- ------------------------------------------------------------------ account sync contract 7

insert into cadence_private.account_sync_contract_additions (contract, kind, field, default_value)
values
  (7, 'behavior', 'end_on', 'null'::jsonb),
  (7, 'behavior', 'end_time', 'null'::jsonb),
  (7, 'behavior', 'pause_from_on', 'null'::jsonb),
  (7, 'behavior', 'pause_from_time', 'null'::jsonb),
  (7, 'behavior', 'pause_back_on', 'null'::jsonb);

-- Contracts 1-6 still write end_date, which no longer exists: they must update first.
create or replace function cadence_private.account_sync_min_writer_contract()
returns integer
language sql
immutable
set search_path = ''
as $$ select 7 $$;

commit;
