begin;

-- Ticket 226: separate, default-off Daily Brief disclosure for Outlook Calendar,
-- iCloud Calendar, and Hevy workout timing. `include_calendar` keeps its meaning:
-- Google Calendar only. Connecting or displaying a source never grants one of
-- these. Each disclosure binds the connector generation, and calendar sources
-- also bind the selection revision, current when it was granted. Begin and
-- finish refuse a run once any bound source changes, as they do for Google.
-- Existing rows read every new disclosure as off.
alter table cadence_advisor_private.daily_brief_preferences
  add column include_outlook_calendar boolean not null default false,
  add column outlook_connection_generation bigint,
  add column outlook_selection_revision bigint,
  add column include_icloud_calendar boolean not null default false,
  add column icloud_connection_generation bigint,
  add column icloud_selection_revision bigint,
  add column include_hevy boolean not null default false,
  add column hevy_connection_generation bigint,
  add constraint daily_brief_preferences_connector_sources_need_enablement
    check (enabled or (not include_outlook_calendar and not include_icloud_calendar and not include_hevy)),
  add constraint daily_brief_preferences_outlook_fence check (
    (include_outlook_calendar and outlook_connection_generation is not null and outlook_selection_revision is not null)
    or (not include_outlook_calendar and outlook_connection_generation is null and outlook_selection_revision is null)
  ),
  add constraint daily_brief_preferences_icloud_fence check (
    (include_icloud_calendar and icloud_connection_generation is not null and icloud_selection_revision is not null)
    or (not include_icloud_calendar and icloud_connection_generation is null and icloud_selection_revision is null)
  ),
  add constraint daily_brief_preferences_hevy_fence check (
    (include_hevy and hevy_connection_generation is not null)
    or (not include_hevy and hevy_connection_generation is null)
  );

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
    'calendar_selection_revision', preference.calendar_selection_revision,
    'include_outlook_calendar', coalesce(preference.include_outlook_calendar, false),
    'outlook_connection_generation', preference.outlook_connection_generation,
    'outlook_selection_revision', preference.outlook_selection_revision,
    'include_icloud_calendar', coalesce(preference.include_icloud_calendar, false),
    'icloud_connection_generation', preference.icloud_connection_generation,
    'icloud_selection_revision', preference.icloud_selection_revision,
    'include_hevy', coalesce(preference.include_hevy, false),
    'hevy_connection_generation', preference.hevy_connection_generation
  );
end;
$$;

-- True when every disclosed new source still has the bound connected
-- generation (and calendar selection revision). Undisclosed sources pass.
-- Callable only from the security-definer Daily Brief functions.
create function cadence_advisor_private.daily_brief_connector_fence_is_current(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (not preference.include_outlook_calendar or exists (
        select 1
        from public.connector_connections as connection
        join public.connector_preferences as selection
          on selection.user_id = connection.user_id and selection.provider = connection.provider
        where connection.user_id = p_user_id
          and connection.provider = 'outlook_calendar'
          and connection.status = 'connected'
          and connection.generation = preference.outlook_connection_generation
          and selection.selection_revision = preference.outlook_selection_revision
      ))
      and (not preference.include_icloud_calendar or exists (
        select 1
        from public.connector_connections as connection
        join public.connector_preferences as selection
          on selection.user_id = connection.user_id and selection.provider = connection.provider
        where connection.user_id = p_user_id
          and connection.provider = 'icloud_calendar'
          and connection.status = 'connected'
          and connection.generation = preference.icloud_connection_generation
          and selection.selection_revision = preference.icloud_selection_revision
      ))
      and (not preference.include_hevy or exists (
        select 1
        from public.connector_connections as connection
        where connection.user_id = p_user_id
          and connection.provider = 'hevy'
          and connection.status = 'connected'
          and connection.generation = preference.hevy_connection_generation
      ))
    from cadence_advisor_private.daily_brief_preferences as preference
    where preference.user_id = p_user_id
  ), true);
$$;

-- Same signature, so the installed begin and finish functions now also fence
-- the new sources without being rewritten.
create or replace function cadence_advisor_private.daily_brief_calendar_fence_is_current(
  p_user_id uuid,
  p_include_calendar boolean,
  p_connection_generation bigint,
  p_selection_revision bigint
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select p_user_id = cadence_advisor_private.current_daily_brief_user()
    and (not p_include_calendar or exists (
    select 1
    from public.google_calendar_connections as connection
    join public.google_calendar_preferences as preference
      on preference.user_id = connection.user_id
    where connection.user_id = p_user_id
      and connection.status = 'connected'
      and connection.generation = p_connection_generation
      and preference.selection_revision = p_selection_revision
  ))
    and cadence_advisor_private.daily_brief_connector_fence_is_current(p_user_id);
$$;

create function cadence_advisor_private.save_daily_brief_preferences_v3(
  p_enabled boolean,
  p_include_calendar boolean,
  p_include_reminder_history boolean,
  p_include_notes boolean,
  p_include_outlook_calendar boolean,
  p_include_icloud_calendar boolean,
  p_include_hevy boolean,
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
  outlook_generation bigint;
  outlook_selection bigint;
  icloud_generation bigint;
  icloud_selection bigint;
  hevy_generation bigint;
begin
  if p_enabled is null or p_include_calendar is null
    or p_include_reminder_history is null or p_include_notes is null
    or p_include_outlook_calendar is null or p_include_icloud_calendar is null or p_include_hevy is null
    or (not p_enabled and (p_include_calendar or p_include_reminder_history or p_include_notes
      or p_include_outlook_calendar or p_include_icloud_calendar or p_include_hevy))
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
    raise exception 'Daily Brief preferences changed.' using errcode = '55000';
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

  if p_include_outlook_calendar then
    select connection.generation, selection.selection_revision
      into outlook_generation, outlook_selection
    from public.connector_connections as connection
    join public.connector_preferences as selection
      on selection.user_id = connection.user_id and selection.provider = connection.provider
    where connection.user_id = actor_id
      and connection.provider = 'outlook_calendar'
      and connection.status = 'connected'
      and cardinality(selection.selected_source_ids) > 0;

    if outlook_generation is null or outlook_selection is null then
      raise exception 'A connected Outlook Calendar selection is required.' using errcode = '55000';
    end if;
  end if;

  if p_include_icloud_calendar then
    select connection.generation, selection.selection_revision
      into icloud_generation, icloud_selection
    from public.connector_connections as connection
    join public.connector_preferences as selection
      on selection.user_id = connection.user_id and selection.provider = connection.provider
    where connection.user_id = actor_id
      and connection.provider = 'icloud_calendar'
      and connection.status = 'connected'
      and cardinality(selection.selected_source_ids) > 0;

    if icloud_generation is null or icloud_selection is null then
      raise exception 'A connected iCloud Calendar selection is required.' using errcode = '55000';
    end if;
  end if;

  if p_include_hevy then
    select connection.generation into hevy_generation
    from public.connector_connections as connection
    where connection.user_id = actor_id
      and connection.provider = 'hevy'
      and connection.status = 'connected';

    if hevy_generation is null then
      raise exception 'A connected Hevy account is required.' using errcode = '55000';
    end if;
  end if;

  next_revision := current_revision + 1;
  insert into cadence_advisor_private.daily_brief_preferences as preference (
    user_id, enabled, include_calendar, include_reminder_history, include_notes, revision,
    calendar_connection_generation, calendar_selection_revision,
    include_outlook_calendar, outlook_connection_generation, outlook_selection_revision,
    include_icloud_calendar, icloud_connection_generation, icloud_selection_revision,
    include_hevy, hevy_connection_generation, updated_at
  ) values (
    actor_id, p_enabled, p_include_calendar, p_include_reminder_history, p_include_notes, next_revision,
    connection_generation, selection_revision,
    p_include_outlook_calendar, outlook_generation, outlook_selection,
    p_include_icloud_calendar, icloud_generation, icloud_selection,
    p_include_hevy, hevy_generation, statement_timestamp()
  )
  on conflict (user_id) do update set
    enabled = excluded.enabled,
    include_calendar = excluded.include_calendar,
    include_reminder_history = excluded.include_reminder_history,
    include_notes = excluded.include_notes,
    revision = excluded.revision,
    calendar_connection_generation = excluded.calendar_connection_generation,
    calendar_selection_revision = excluded.calendar_selection_revision,
    include_outlook_calendar = excluded.include_outlook_calendar,
    outlook_connection_generation = excluded.outlook_connection_generation,
    outlook_selection_revision = excluded.outlook_selection_revision,
    include_icloud_calendar = excluded.include_icloud_calendar,
    icloud_connection_generation = excluded.icloud_connection_generation,
    icloud_selection_revision = excluded.icloud_selection_revision,
    include_hevy = excluded.include_hevy,
    hevy_connection_generation = excluded.hevy_connection_generation,
    updated_at = excluded.updated_at;

  -- Any preference change drops pending and completed attempts, so no output
  -- prepared under an earlier disclosure can still be delivered.
  delete from cadence_advisor_private.daily_brief_runs
  where user_id = actor_id;
  if not p_enabled then
    delete from cadence_advisor_private.daily_brief_tip_deliveries
    where user_id = actor_id;
  end if;

  return cadence_advisor_private.read_daily_brief_preferences();
end;
$$;

-- Older clients send two or four controls. Their saves revoke the new sources.
create or replace function cadence_advisor_private.save_daily_brief_preferences_v2(
  p_enabled boolean,
  p_include_calendar boolean,
  p_include_reminder_history boolean,
  p_include_notes boolean,
  p_expected_revision bigint
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief_preferences_v3(
    p_enabled, p_include_calendar, p_include_reminder_history, p_include_notes,
    false, false, false, p_expected_revision
  );
$$;

create function public.save_daily_brief_preferences_v3(
  p_enabled boolean,
  p_include_calendar boolean,
  p_include_reminder_history boolean,
  p_include_notes boolean,
  p_include_outlook_calendar boolean,
  p_include_icloud_calendar boolean,
  p_include_hevy boolean,
  p_expected_revision bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief_preferences_v3(
    p_enabled, p_include_calendar, p_include_reminder_history, p_include_notes,
    p_include_outlook_calendar, p_include_icloud_calendar, p_include_hevy, p_expected_revision
  );
$$;

revoke all on function cadence_advisor_private.daily_brief_connector_fence_is_current(uuid) from public, anon, authenticated, service_role;
revoke all on function cadence_advisor_private.save_daily_brief_preferences_v3(boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
revoke all on function public.save_daily_brief_preferences_v3(boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function cadence_advisor_private.save_daily_brief_preferences_v3(boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) to authenticated;
grant execute on function public.save_daily_brief_preferences_v3(boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) to authenticated;

commit;
