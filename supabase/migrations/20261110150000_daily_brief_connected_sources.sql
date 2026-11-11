begin;

-- Ticket 306: one Daily Brief choice covers every connected source, including a
-- source connected after the choice (owner decision, 2026-11-10). Per-source
-- exclusions move under Advanced. Additive: existing rows keep null here and
-- read_daily_brief_preferences derives their choice from what they allowed, so
-- no row is rewritten. The choice is on when Daily Brief is on and at least one
-- source was allowed; then every source that was not allowed starts excluded.
-- The first save through save_daily_brief_preferences_v4 stores the choice and
-- clears the per-source allowances.
alter table cadence_advisor_private.daily_brief_preferences
  add column use_connected_sources boolean,
  add column exclude_google_calendar boolean,
  add column exclude_outlook_calendar boolean,
  add column exclude_icloud_calendar boolean,
  add column exclude_hevy boolean,
  add constraint daily_brief_preferences_source_choice_complete check (
    (use_connected_sources is null) = (exclude_google_calendar is null)
    and (use_connected_sources is null) = (exclude_outlook_calendar is null)
    and (use_connected_sources is null) = (exclude_icloud_calendar is null)
    and (use_connected_sources is null) = (exclude_hevy is null)
  ),
  -- Turning Daily Brief off withdraws every source choice.
  add constraint daily_brief_preferences_source_choice_needs_enablement check (
    enabled or coalesce(not (use_connected_sources or exclude_google_calendar or exclude_outlook_calendar
      or exclude_icloud_calendar or exclude_hevy), true)
  );

-- Same signature and the same keys as 20261019041000, plus the derived or stored choice.
create or replace function cadence_advisor_private.read_daily_brief_preferences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  preference cadence_advisor_private.daily_brief_preferences%rowtype;
  allowed_any boolean;
begin
  select * into preference
  from cadence_advisor_private.daily_brief_preferences
  where user_id = actor_id;

  allowed_any := coalesce(preference.enabled, false) and (
    coalesce(preference.include_calendar, false) or coalesce(preference.include_outlook_calendar, false)
    or coalesce(preference.include_icloud_calendar, false) or coalesce(preference.include_hevy, false));

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
    'hevy_connection_generation', preference.hevy_connection_generation,
    'use_connected_sources', coalesce(preference.use_connected_sources, allowed_any),
    'excluded_sources', jsonb_build_object(
      'google_calendar', coalesce(preference.exclude_google_calendar, allowed_any and not coalesce(preference.include_calendar, false)),
      'outlook_calendar', coalesce(preference.exclude_outlook_calendar, allowed_any and not coalesce(preference.include_outlook_calendar, false)),
      'icloud_calendar', coalesce(preference.exclude_icloud_calendar, allowed_any and not coalesce(preference.include_icloud_calendar, false)),
      'hevy', coalesce(preference.exclude_hevy, allowed_any and not coalesce(preference.include_hevy, false))
    )
  );
end;
$$;

-- Covered sources follow the current connection, so a reconnected or reselected
-- source no longer needs to be allowed again. The service fences each run on the
-- connection and selection it read at the start, and the stored revision still
-- fences every preference change. Same signature; no caller is rewritten.
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
  select p_user_id = cadence_advisor_private.current_daily_brief_user();
$$;

create function cadence_advisor_private.save_daily_brief_preferences_v4(
  p_enabled boolean,
  p_use_connected_sources boolean,
  p_exclude_google_calendar boolean,
  p_exclude_outlook_calendar boolean,
  p_exclude_icloud_calendar boolean,
  p_exclude_hevy boolean,
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
begin
  if p_enabled is null or p_use_connected_sources is null
    or p_exclude_google_calendar is null or p_exclude_outlook_calendar is null
    or p_exclude_icloud_calendar is null or p_exclude_hevy is null
    or p_include_reminder_history is null or p_include_notes is null
    or (not p_enabled and (p_use_connected_sources or p_exclude_google_calendar or p_exclude_outlook_calendar
      or p_exclude_icloud_calendar or p_exclude_hevy or p_include_reminder_history or p_include_notes))
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

  next_revision := current_revision + 1;
  -- The per-source allowances and their fences are cleared; the choice replaces them.
  insert into cadence_advisor_private.daily_brief_preferences as preference (
    user_id, enabled, include_calendar, include_reminder_history, include_notes, revision,
    calendar_connection_generation, calendar_selection_revision,
    include_outlook_calendar, outlook_connection_generation, outlook_selection_revision,
    include_icloud_calendar, icloud_connection_generation, icloud_selection_revision,
    include_hevy, hevy_connection_generation,
    use_connected_sources, exclude_google_calendar, exclude_outlook_calendar, exclude_icloud_calendar, exclude_hevy,
    updated_at
  ) values (
    actor_id, p_enabled, false, p_include_reminder_history, p_include_notes, next_revision,
    null, null,
    false, null, null,
    false, null, null,
    false, null,
    p_use_connected_sources, p_exclude_google_calendar, p_exclude_outlook_calendar, p_exclude_icloud_calendar, p_exclude_hevy,
    statement_timestamp()
  )
  on conflict (user_id) do update set
    enabled = excluded.enabled,
    include_calendar = false,
    include_reminder_history = excluded.include_reminder_history,
    include_notes = excluded.include_notes,
    revision = excluded.revision,
    calendar_connection_generation = null,
    calendar_selection_revision = null,
    include_outlook_calendar = false,
    outlook_connection_generation = null,
    outlook_selection_revision = null,
    include_icloud_calendar = false,
    icloud_connection_generation = null,
    icloud_selection_revision = null,
    include_hevy = false,
    hevy_connection_generation = null,
    use_connected_sources = excluded.use_connected_sources,
    exclude_google_calendar = excluded.exclude_google_calendar,
    exclude_outlook_calendar = excluded.exclude_outlook_calendar,
    exclude_icloud_calendar = excluded.exclude_icloud_calendar,
    exclude_hevy = excluded.exclude_hevy,
    updated_at = excluded.updated_at;

  -- Any preference change drops pending and completed attempts, so no output
  -- prepared under an earlier choice can still be delivered.
  delete from cadence_advisor_private.daily_brief_runs
  where user_id = actor_id;
  if not p_enabled then
    delete from cadence_advisor_private.daily_brief_tip_deliveries
    where user_id = actor_id;
  end if;

  return cadence_advisor_private.read_daily_brief_preferences();
end;
$$;

create function public.save_daily_brief_preferences_v4(
  p_enabled boolean,
  p_use_connected_sources boolean,
  p_exclude_google_calendar boolean,
  p_exclude_outlook_calendar boolean,
  p_exclude_icloud_calendar boolean,
  p_exclude_hevy boolean,
  p_include_reminder_history boolean,
  p_include_notes boolean,
  p_expected_revision bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief_preferences_v4(
    p_enabled, p_use_connected_sources,
    p_exclude_google_calendar, p_exclude_outlook_calendar, p_exclude_icloud_calendar, p_exclude_hevy,
    p_include_reminder_history, p_include_notes, p_expected_revision
  );
$$;

revoke all on function cadence_advisor_private.save_daily_brief_preferences_v4(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
revoke all on function public.save_daily_brief_preferences_v4(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function cadence_advisor_private.save_daily_brief_preferences_v4(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) to authenticated;
grant execute on function public.save_daily_brief_preferences_v4(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) to authenticated;

commit;
