begin;

-- Ticket 307: Daily Brief reads Google Calendar through the Timeline connection and
-- its selected calendars. The separate Daily Brief grant (Ticket 187,
-- 20261022180000) is retired. Not additive: it rewrites Daily Brief preference rows
-- and deletes every Daily Brief grant row. The owner authorized pushing it after the
-- pull request merges (docs/DECISIONS.md, 2026-11-10).
--
-- Order (docs/OPERATIONS.md, "Retiring the Daily Brief Calendar grant (Ticket 307)"):
-- deploy the Ticket 307 app, call POST /api/google-calendar/agent-grants/retire until
-- it reports `remaining: 0`, then push this migration. It refuses to run while any
-- Daily Brief credential remains, so no token is deleted before Google revoked it.
--
-- Rollback: this migration cannot restore grants. Revoked tokens are dead at Google,
-- so a restored grant needs new consent. To roll back the schema, restore the
-- 20261022180000 service-role grants on the five calendar_agent_* functions,
-- re-create read_daily_brief_preferences and save_daily_brief_preferences_v3 from
-- 20261110150000 and 20261022180000, and redeploy an app before Ticket 307. Mapped
-- preference rows keep their stored choice; per-source allowances are not restored.

do $$
begin
  if exists (select 1 from cadence_calendar_agent_private.credentials) then
    raise exception 'Daily Brief Calendar credentials remain. Revoke them first: POST /api/google-calendar/agent-grants/retire.'
      using errcode = '55000';
  end if;
end;
$$;

-- An account that had allowed Calendar timing keeps it allowed only if its Timeline
-- connection is connected; otherwise Google Calendar starts excluded. Rows from
-- before 20261110150000 get their one choice stored here, mapped as that migration
-- derives it. Every changed row bumps its revision and drops its attempts.
-- Kept (private, not granted) so the SQL fixture can exercise the mapping.
create function cadence_advisor_private.map_daily_brief_google_calendar_to_timeline()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  with mapping as (
    select
      preference.user_id,
      coalesce(preference.use_connected_sources, preference.enabled and (preference.include_calendar or preference.include_outlook_calendar
        or preference.include_icloud_calendar or preference.include_hevy)) as use_connected_sources,
      preference.use_connected_sources is null as derived,
      exists (
        select 1 from public.google_calendar_connections as connection
        where connection.user_id = preference.user_id and connection.status = 'connected'
      ) as timeline_connected
    from cadence_advisor_private.daily_brief_preferences as preference
  ), mapped as (
    update cadence_advisor_private.daily_brief_preferences as preference set
      use_connected_sources = mapping.use_connected_sources,
      exclude_google_calendar = case
        when mapping.derived then mapping.use_connected_sources and not (preference.include_calendar and mapping.timeline_connected)
        else preference.exclude_google_calendar or (mapping.use_connected_sources and not mapping.timeline_connected)
      end,
      exclude_outlook_calendar = case when mapping.derived then mapping.use_connected_sources and not preference.include_outlook_calendar else preference.exclude_outlook_calendar end,
      exclude_icloud_calendar = case when mapping.derived then mapping.use_connected_sources and not preference.include_icloud_calendar else preference.exclude_icloud_calendar end,
      exclude_hevy = case when mapping.derived then mapping.use_connected_sources and not preference.include_hevy else preference.exclude_hevy end,
      include_calendar = false, calendar_connection_generation = null, calendar_selection_revision = null,
      include_outlook_calendar = false, outlook_connection_generation = null, outlook_selection_revision = null,
      include_icloud_calendar = false, icloud_connection_generation = null, icloud_selection_revision = null,
      include_hevy = false, hevy_connection_generation = null,
      revision = preference.revision + 1,
      updated_at = statement_timestamp()
    from mapping
    where mapping.user_id = preference.user_id
      and (mapping.derived or (mapping.use_connected_sources and not preference.exclude_google_calendar and not mapping.timeline_connected))
    returning preference.user_id
  ), dropped as (
    delete from cadence_advisor_private.daily_brief_runs as run
    using mapped
    where run.user_id = mapped.user_id
  )
  select count(*) into changed from mapped;
  return changed;
end;
$$;
revoke all on function cadence_advisor_private.map_daily_brief_google_calendar_to_timeline() from public, anon, authenticated, service_role;

select cadence_advisor_private.map_daily_brief_google_calendar_to_timeline();

-- Delete every stored Daily Brief grant: attempts, selections and connections.
-- Credentials were removed by the retirement route; the guard above proved it.
delete from cadence_calendar_agent_private.attempts;
delete from public.google_calendar_agent_preferences;
delete from public.google_calendar_agent_connections;

-- No new Daily Brief grant can be started, installed or read.
revoke all on function public.calendar_agent_begin_attempt(uuid, text, text, text, bigint, text, text, text) from service_role;
revoke all on function public.calendar_agent_consume_attempt(text) from service_role;
revoke all on function public.calendar_agent_install_credential(uuid, text, bigint, text, text, text) from service_role;
revoke all on function public.calendar_agent_read_credential(uuid, text, bigint) from service_role;
revoke all on function public.calendar_agent_disconnect(uuid, text, bigint, text) from service_role;

-- Same keys as 20261110150000, plus the marker that Google Calendar now means the
-- Timeline connection. The app reads no Google Calendar for Daily Brief without it.
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
    ),
    'google_calendar_source', 'timeline'
  );
end;
$$;

-- 20261022180000's v3 read the retired grant. Same signature: clients built before
-- Ticket 306 now save the one choice, and every source they leave off is excluded.
-- v2 and the original save still delegate here.
create or replace function cadence_advisor_private.save_daily_brief_preferences_v3(
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
  use_sources boolean;
begin
  if p_enabled is null or p_include_calendar is null or p_include_outlook_calendar is null
    or p_include_icloud_calendar is null or p_include_hevy is null
  then
    raise exception 'Daily Brief preferences are invalid.' using errcode = '22023';
  end if;
  use_sources := p_enabled and (p_include_calendar or p_include_outlook_calendar or p_include_icloud_calendar or p_include_hevy);
  if not p_enabled and (p_include_calendar or p_include_outlook_calendar or p_include_icloud_calendar or p_include_hevy) then
    raise exception 'Daily Brief preferences are invalid.' using errcode = '22023';
  end if;
  return cadence_advisor_private.save_daily_brief_preferences_v4(
    p_enabled, use_sources,
    use_sources and not p_include_calendar, use_sources and not p_include_outlook_calendar,
    use_sources and not p_include_icloud_calendar, use_sources and not p_include_hevy,
    p_include_reminder_history, p_include_notes, p_expected_revision
  );
end;
$$;

commit;
