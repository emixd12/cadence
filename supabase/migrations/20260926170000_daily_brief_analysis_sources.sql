begin;

-- Tickets 169, 172 and 173: bounded analysis sources, optional-source disclosure
-- and content-free tip repetition metadata for the Daily Brief. No prompt,
-- generated text or finding text is stored.

-- Optional sources need their own revocable disclosure. Existing enablement
-- grants neither; both default to false and require the feature to be enabled.
alter table cadence_advisor_private.daily_brief_preferences
  add column include_reminder_history boolean not null default false,
  add column include_notes boolean not null default false,
  add constraint daily_brief_preferences_optional_sources_need_enablement
    check (enabled or (not include_reminder_history and not include_notes));

create or replace function cadence_advisor_private.read_daily_brief_preferences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  preference cadence_advisor_private.daily_brief_preferences%rowtype;
begin
  select * into preference
  from cadence_advisor_private.daily_brief_preferences
  where user_id = actor_id;

  return jsonb_build_object(
    'enabled', coalesce(preference.enabled, false),
    'include_calendar', coalesce(preference.include_calendar, false),
    'include_reminder_history', coalesce(preference.include_reminder_history, false),
    'include_notes', coalesce(preference.include_notes, false),
    'revision', coalesce(preference.revision, 0),
    'calendar_connection_generation', preference.calendar_connection_generation,
    'calendar_selection_revision', preference.calendar_selection_revision
  );
end;
$$;

create table cadence_advisor_private.daily_brief_tip_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Server-computed SHA-256 of lane, Behavior, subject and evidence band. Not reversible to text.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  last_shown_local_date date not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, fingerprint)
);

alter table cadence_advisor_private.daily_brief_tip_deliveries enable row level security;
alter table cadence_advisor_private.daily_brief_tip_deliveries force row level security;
create policy daily_brief_tip_deliveries_owner_only
  on cadence_advisor_private.daily_brief_tip_deliveries
  as restrictive for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on cadence_advisor_private.daily_brief_tip_deliveries from public, anon, authenticated, service_role;

create function cadence_advisor_private.save_daily_brief_preferences_v2(
  p_enabled boolean,
  p_include_calendar boolean,
  p_include_reminder_history boolean,
  p_include_notes boolean,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  current_revision bigint;
  next_revision bigint;
  connection_generation bigint;
  selection_revision bigint;
begin
  if p_enabled is null or p_include_calendar is null
    or p_include_reminder_history is null or p_include_notes is null
    or (not p_enabled and (p_include_calendar or p_include_reminder_history or p_include_notes))
    or p_expected_revision is null or p_expected_revision not between 0 and 2147483647
  then
    raise exception 'Daily Brief preferences are invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':daily-brief', 0)
  );

  select preference.revision into current_revision
  from cadence_advisor_private.daily_brief_preferences as preference
  where preference.user_id = actor_id
  for update;
  current_revision := coalesce(current_revision, 0);

  if current_revision <> p_expected_revision or current_revision = 2147483647 then
    raise exception 'Daily Brief preferences changed.' using errcode = '40001';
  end if;

  if p_include_calendar then
    select connection.generation, preference.selection_revision
      into connection_generation, selection_revision
    from public.google_calendar_connections as connection
    join public.google_calendar_preferences as preference
      on preference.user_id = connection.user_id
    where connection.user_id = actor_id
      and connection.status = 'connected';

    if connection_generation is null or selection_revision is null then
      raise exception 'A connected Calendar selection is required.' using errcode = '55000';
    end if;
  end if;

  next_revision := current_revision + 1;
  insert into cadence_advisor_private.daily_brief_preferences as preference (
    user_id, enabled, include_calendar, include_reminder_history, include_notes, revision,
    calendar_connection_generation, calendar_selection_revision, updated_at
  ) values (
    actor_id, p_enabled, p_include_calendar, p_include_reminder_history, p_include_notes, next_revision,
    connection_generation, selection_revision, statement_timestamp()
  )
  on conflict (user_id) do update set
    enabled = excluded.enabled,
    include_calendar = excluded.include_calendar,
    include_reminder_history = excluded.include_reminder_history,
    include_notes = excluded.include_notes,
    revision = excluded.revision,
    calendar_connection_generation = excluded.calendar_connection_generation,
    calendar_selection_revision = excluded.calendar_selection_revision,
    updated_at = excluded.updated_at;

  delete from cadence_advisor_private.daily_brief_runs
  where user_id = actor_id;
  -- Disabling the feature removes tip repetition metadata.
  if not p_enabled then
    delete from cadence_advisor_private.daily_brief_tip_deliveries
    where user_id = actor_id;
  end if;

  return cadence_advisor_private.read_daily_brief_preferences();
end;
$$;

-- Older clients send only the original controls. Their saves revoke optional sources.
create or replace function cadence_advisor_private.save_daily_brief_preferences(
  p_enabled boolean,
  p_include_calendar boolean,
  p_expected_revision bigint
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief_preferences_v2(
    p_enabled, p_include_calendar, false, false, p_expected_revision
  );
$$;

create function cadence_advisor_private.advisor_analysis_payload(
  actor_id uuid,
  target_local_date date,
  history_start_local_date date,
  selected_behavior_ids uuid[],
  include_reminders boolean,
  include_notes boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with preference as (
    select coalesce(bool_or(p.enabled and p.include_reminder_history), false) as reminders,
      coalesce(bool_or(p.enabled and p.include_notes), false) as notes
    from cadence_advisor_private.daily_brief_preferences as p
    where p.user_id = actor_id
  ), selected_behaviors as (
    select behavior.id
    from public.behaviors as behavior
    where behavior.user_id = actor_id
      and behavior.id = any(selected_behavior_ids)
      and behavior.active
  ), history as (
    select occurrence.*
    from public.occurrences as occurrence
    join selected_behaviors as behavior on behavior.id = occurrence.behavior_id
    where occurrence.user_id = actor_id
      and occurrence.local_date >= history_start_local_date
      and occurrence.local_date < target_local_date
    order by occurrence.local_date desc, occurrence.id
    limit 10001
  ), status_events as (
    select event.*
    from public.occurrence_status_events as event
    join history as occurrence on occurrence.id = event.occurrence_id
    where event.user_id = actor_id
    order by event.recorded_at, event.id
    limit 20001
  ), configuration_events as (
    select event.*
    from public.behavior_configuration_events as event
    join selected_behaviors as behavior on behavior.id = event.behavior_id
    where event.user_id = actor_id
      and event.effective_local_date <= target_local_date
    order by event.effective_at, event.id
    limit 2001
  ), reminders as (
    select delivery.*
    from public.reminder_deliveries as delivery
    join history as occurrence on occurrence.id = delivery.occurrence_id
    where delivery.user_id = actor_id
    order by delivery.scheduled_send_at, delivery.id
    limit 10001
  ), notes as (
    select occurrence.id, occurrence.behavior_id, occurrence.local_date,
      left(btrim(occurrence.note), 280) as text
    from history as occurrence
    where occurrence.status = 'not_completed'
      and occurrence.note is not null
      and btrim(occurrence.note) <> ''
    order by occurrence.local_date desc, occurrence.id
    limit 201
  )
  select jsonb_build_object(
    'timezone', (select profile.timezone from public.profiles as profile where profile.id = actor_id),
    'occurrences', coalesce((select jsonb_agg(jsonb_build_object(
      'id', occurrence.id,
      'behaviorId', occurrence.behavior_id,
      'localDate', occurrence.local_date,
      'scheduledFor', occurrence.scheduled_for,
      'scheduleKind', occurrence.schedule_kind,
      'scheduleStartTime', occurrence.schedule_start_time,
      'scheduleEndTime', occurrence.schedule_end_time,
      'status', occurrence.status,
      'statusMarkedAt', occurrence.status_marked_at,
      'configurationEventId', occurrence.behavior_configuration_event_id
    ) order by occurrence.local_date desc, occurrence.id) from history as occurrence), '[]'::jsonb),
    'statusEvents', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id,
      'occurrenceId', event.occurrence_id,
      'previousStatus', event.previous_status,
      'status', event.status,
      'semantics', event.status_semantics,
      'recordedAt', event.recorded_at,
      'revisesEventId', event.revises_event_id
    ) order by event.recorded_at, event.id) from status_events as event), '[]'::jsonb),
    'configurationEvents', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id,
      'behaviorId', event.behavior_id,
      'eventKind', event.event_kind,
      'effectiveAt', event.effective_at,
      'effectiveLocalDate', event.effective_local_date,
      'changedFields', to_jsonb(event.changed_fields),
      'source', event.source,
      'reasonCode', event.reason_code,
      'browserReminderEnabled', coalesce((event.next_configuration ->> 'browser_reminder_enabled')::boolean, false),
      'emailReminderEnabled', coalesce((event.next_configuration ->> 'email_reminder_enabled')::boolean, false)
    ) order by event.effective_at, event.id) from configuration_events as event), '[]'::jsonb),
    'reminders', case
      when not include_reminders then to_jsonb('not_requested'::text)
      when not (select reminders from preference) then to_jsonb('not_permitted'::text)
      else coalesce((select jsonb_agg(jsonb_build_object(
        'occurrenceId', delivery.occurrence_id,
        'channel', delivery.channel,
        'status', delivery.status,
        'scheduledSendAt', delivery.scheduled_send_at
      ) order by delivery.scheduled_send_at, delivery.id) from reminders as delivery), '[]'::jsonb)
    end,
    'notes', case
      when not include_notes then to_jsonb('not_requested'::text)
      when not (select notes from preference) then to_jsonb('not_permitted'::text)
      else coalesce((select jsonb_agg(jsonb_build_object(
        'occurrenceId', note.id,
        'behaviorId', note.behavior_id,
        'localDate', note.local_date,
        'text', note.text
      ) order by note.local_date desc, note.id) from notes as note), '[]'::jsonb)
    end
  );
$$;

create function cadence_advisor_private.read_advisor_analysis_snapshot(
  target_local_date date,
  history_start_local_date date,
  selected_behavior_ids uuid[],
  include_reminders boolean,
  include_notes boolean,
  revision_only boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  owner_timezone text;
  payload jsonb;
  revision text;
begin
  select profile.timezone into owner_timezone
  from public.profiles as profile
  where profile.id = actor_id;
  if owner_timezone is null then
    raise exception 'Advisor profile is unavailable.' using errcode = 'P0002';
  end if;
  if target_local_date is null or history_start_local_date is null
    or target_local_date is distinct from (statement_timestamp() at time zone owner_timezone)::date
    or history_start_local_date is distinct from target_local_date - 90
    or include_reminders is null or include_notes is null or revision_only is null
  then
    raise exception 'A valid advisor analysis request is required.' using errcode = '22023';
  end if;
  if selected_behavior_ids is null or cardinality(selected_behavior_ids) > 100
    or cardinality(selected_behavior_ids) <> cardinality(array(select distinct unnest(selected_behavior_ids))) then
    raise exception 'Advisor Behavior selection is invalid.' using errcode = '22023';
  end if;

  payload := cadence_advisor_private.advisor_analysis_payload(
    actor_id, target_local_date, history_start_local_date,
    selected_behavior_ids, include_reminders, include_notes
  );
  revision := encode(extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex');
  if revision_only then
    return jsonb_build_object('revision', revision);
  end if;
  return payload || jsonb_build_object('observedAt', clock_timestamp(), 'revision', revision);
end;
$$;

create function public.read_advisor_analysis_snapshot(
  target_local_date date,
  history_start_local_date date,
  selected_behavior_ids uuid[],
  include_reminders boolean,
  include_notes boolean,
  revision_only boolean
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.read_advisor_analysis_snapshot(
    target_local_date, history_start_local_date, selected_behavior_ids,
    include_reminders, include_notes, revision_only
  );
$$;

create function public.save_daily_brief_preferences_v2(
  p_enabled boolean,
  p_include_calendar boolean,
  p_include_reminder_history boolean,
  p_include_notes boolean,
  p_expected_revision bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief_preferences_v2(
    p_enabled, p_include_calendar, p_include_reminder_history, p_include_notes, p_expected_revision
  );
$$;

-- Tip repetition: fingerprints shown in the last 30 local days. Rows older than
-- 30 days are pruned on read and write; at most 64 rows per owner remain.
create function cadence_advisor_private.read_daily_brief_tip_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  owner_timezone text;
  owner_local_date date;
begin
  select coalesce(profile.timezone, 'America/New_York') into owner_timezone
  from public.profiles as profile where profile.id = actor_id;
  owner_local_date := (pg_catalog.clock_timestamp() at time zone coalesce(owner_timezone, 'America/New_York'))::date;
  return coalesce((
    select jsonb_agg(jsonb_build_object('fingerprint', tip.fingerprint, 'lastShownLocalDate', tip.last_shown_local_date)
      order by tip.last_shown_local_date desc, tip.fingerprint)
    from cadence_advisor_private.daily_brief_tip_deliveries as tip
    where tip.user_id = actor_id
      and tip.last_shown_local_date > owner_local_date - 30
  ), '[]'::jsonb);
end;
$$;

-- Records a tip only for this installation's completed attempt and lease, so
-- failed, cancelled or workbench generations never consume a tip.
create function cadence_advisor_private.record_daily_brief_tip(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  run cadence_advisor_private.daily_brief_runs%rowtype;
begin
  if p_installation_id is null or p_lease_token is null or p_expected_revision is null
    or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Daily Brief tip record is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':daily-brief', 0)
  );

  select * into run
  from cadence_advisor_private.daily_brief_runs as candidate
  where candidate.user_id = actor_id
    and candidate.installation_id = p_installation_id
    and candidate.lease_token = p_lease_token
    and candidate.status = 'completed'
    and candidate.preference_revision = p_expected_revision
    and candidate.finished_at > pg_catalog.clock_timestamp() - interval '2 minutes';
  if run.user_id is null then
    return false;
  end if;

  insert into cadence_advisor_private.daily_brief_tip_deliveries as tip (user_id, fingerprint, last_shown_local_date, updated_at)
  values (actor_id, p_fingerprint, run.local_date, statement_timestamp())
  on conflict (user_id, fingerprint) do update set
    last_shown_local_date = greatest(tip.last_shown_local_date, excluded.last_shown_local_date),
    updated_at = excluded.updated_at;

  delete from cadence_advisor_private.daily_brief_tip_deliveries as tip
  where tip.user_id = actor_id
    and (tip.last_shown_local_date <= run.local_date - 30
      or tip.fingerprint in (
        select stale.fingerprint
        from cadence_advisor_private.daily_brief_tip_deliveries as stale
        where stale.user_id = actor_id
        order by stale.last_shown_local_date desc, stale.fingerprint
        offset 64
      ));
  return true;
end;
$$;

create function public.read_daily_brief_tip_history()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.read_daily_brief_tip_history();
$$;

create function public.record_daily_brief_tip(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_fingerprint text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.record_daily_brief_tip(
    p_installation_id, p_lease_token, p_expected_revision, p_fingerprint
  );
$$;

revoke all on function cadence_advisor_private.save_daily_brief_preferences_v2(boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
revoke all on function cadence_advisor_private.advisor_analysis_payload(uuid, date, date, uuid[], boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function cadence_advisor_private.read_advisor_analysis_snapshot(date, date, uuid[], boolean, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function cadence_advisor_private.read_daily_brief_tip_history() from public, anon, authenticated, service_role;
revoke all on function cadence_advisor_private.record_daily_brief_tip(uuid, uuid, bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.read_advisor_analysis_snapshot(date, date, uuid[], boolean, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.save_daily_brief_preferences_v2(boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
revoke all on function public.read_daily_brief_tip_history() from public, anon, authenticated, service_role;
revoke all on function public.record_daily_brief_tip(uuid, uuid, bigint, text) from public, anon, authenticated, service_role;

-- The payload helper stays callable only from its definer wrapper.
grant execute on function cadence_advisor_private.save_daily_brief_preferences_v2(boolean, boolean, boolean, boolean, bigint) to authenticated;
grant execute on function cadence_advisor_private.read_advisor_analysis_snapshot(date, date, uuid[], boolean, boolean, boolean) to authenticated;
grant execute on function cadence_advisor_private.read_daily_brief_tip_history() to authenticated;
grant execute on function cadence_advisor_private.record_daily_brief_tip(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.read_advisor_analysis_snapshot(date, date, uuid[], boolean, boolean, boolean) to authenticated;
grant execute on function public.save_daily_brief_preferences_v2(boolean, boolean, boolean, boolean, bigint) to authenticated;
grant execute on function public.read_daily_brief_tip_history() to authenticated;
grant execute on function public.record_daily_brief_tip(uuid, uuid, bigint, text) to authenticated;

comment on table cadence_advisor_private.daily_brief_tip_deliveries is
  'Daily Brief tip repetition metadata: a one-way fingerprint and last-shown local date per owner. At most 64 rows within 30 days. Deleted when the feature is disabled or the account is deleted. No prompt, finding or generated text is stored.';
comment on column cadence_advisor_private.daily_brief_preferences.include_reminder_history is
  'Separate disclosure: reminder delivery status and send times for bounded history may inform Daily Brief findings.';
comment on column cadence_advisor_private.daily_brief_preferences.include_notes is
  'Separate disclosure: up to 280 characters of each nonempty Note on a Not Completed occurrence in the lookback may reach the model.';

commit;
