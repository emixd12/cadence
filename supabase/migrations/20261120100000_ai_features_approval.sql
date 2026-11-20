-- Advisor plan Phase 4, workstream 4F (owner decision D2, 2026-11-19): one AI-features
-- approval covers every AI feature (Daily Brief, Advisor tips, Chat) and every data
-- source they may use. Approving turns everything on. Opt-outs live in Settings.
--
-- The Daily Brief preference row keeps the source choices, which become shared by all
-- three features: Notes, reminder history, and the connected-sources choice with its
-- per-source exclusions. Because Chat and tips may use a source while Daily Brief is
-- off, the rules that tied every source choice to Daily Brief being on are dropped.
--
-- Advisor tips, Chat and the approval itself live in a new private row. Changing only
-- tips or Chat does not touch the Daily Brief row, so today's saved brief stays.
-- A person with no row has not approved: tips and Chat read as off.
--
-- Additive except for the two dropped CHECK constraints. Rollback: drop the two new
-- functions and their wrappers and the table, then restore the constraints once every
-- row with Daily Brief off has its source choices off.
begin;

alter table cadence_advisor_private.daily_brief_preferences
  drop constraint daily_brief_preferences_optional_sources_need_enablement,
  drop constraint daily_brief_preferences_source_choice_needs_enablement;

create table cadence_advisor_private.ai_feature_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approved_at timestamptz not null,
  tips_enabled boolean not null,
  chat_enabled boolean not null,
  revision bigint not null default 1 check (revision between 1 and 2147483647),
  updated_at timestamptz not null default statement_timestamp()
);

alter table cadence_advisor_private.ai_feature_settings enable row level security;
alter table cadence_advisor_private.ai_feature_settings force row level security;

-- Reads and writes go through the functions below only.
create policy ai_feature_settings_owner_only
  on cadence_advisor_private.ai_feature_settings
  as restrictive for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table cadence_advisor_private.ai_feature_settings from public, anon, authenticated, service_role;

-- Every feature and source choice for the caller, from the person's own session or
-- from one of Cadence's agent tokens (both carry the person as auth.uid()). Source
-- choices are derived the same way read_daily_brief_preferences derives them.
create function cadence_advisor_private.read_ai_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  preference cadence_advisor_private.daily_brief_preferences%rowtype;
  feature cadence_advisor_private.ai_feature_settings%rowtype;
  allowed_any boolean;
begin
  if actor_id is null then
    raise exception 'An authenticated caller is required.' using errcode = '42501';
  end if;

  select * into preference
  from cadence_advisor_private.daily_brief_preferences
  where user_id = actor_id;

  select * into feature
  from cadence_advisor_private.ai_feature_settings
  where user_id = actor_id;

  allowed_any := coalesce(preference.enabled, false) and (
    coalesce(preference.include_calendar, false) or coalesce(preference.include_outlook_calendar, false)
    or coalesce(preference.include_icloud_calendar, false) or coalesce(preference.include_hevy, false));

  return jsonb_build_object(
    'approved_at', feature.approved_at,
    'revision', coalesce(feature.revision, 0),
    'daily_brief_enabled', coalesce(preference.enabled, false),
    'tips_enabled', coalesce(feature.tips_enabled, false),
    'chat_enabled', coalesce(feature.chat_enabled, false),
    'include_notes', coalesce(preference.include_notes, false),
    'include_reminder_history', coalesce(preference.include_reminder_history, false),
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

-- Saves every AI choice at once and records the approval. Only the person's own
-- session may save. The Daily Brief row is written only when one of its fields
-- changes; then it behaves as save_daily_brief_preferences_v4 does (new revision,
-- attempts dropped, the saved brief cleared by trigger, tip deliveries dropped
-- when Daily Brief turns off).
create function cadence_advisor_private.save_ai_settings(
  p_daily_brief_enabled boolean,
  p_tips_enabled boolean,
  p_chat_enabled boolean,
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
  current_row cadence_advisor_private.daily_brief_preferences%rowtype;
  current_revision bigint;
begin
  if p_daily_brief_enabled is null or p_tips_enabled is null or p_chat_enabled is null
    or p_use_connected_sources is null
    or p_exclude_google_calendar is null or p_exclude_outlook_calendar is null
    or p_exclude_icloud_calendar is null or p_exclude_hevy is null
    or p_include_reminder_history is null or p_include_notes is null
    or p_expected_revision is null or p_expected_revision not between 0 and 2147483647
  then
    raise exception 'AI settings are invalid.' using errcode = '22023';
  end if;

  -- Same lock as the Daily Brief save, so the two never interleave.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':daily-brief', 0)
  );

  select * into current_row
  from cadence_advisor_private.daily_brief_preferences as preference
  where preference.user_id = actor_id
  for update;
  current_revision := coalesce(current_row.revision, 0);

  if current_revision <> p_expected_revision or current_revision = 2147483647 then
    raise exception 'Daily Brief preferences changed.' using errcode = '55000';
  end if;

  if current_row.user_id is null
    or current_row.enabled is distinct from p_daily_brief_enabled
    or current_row.use_connected_sources is distinct from p_use_connected_sources
    or current_row.exclude_google_calendar is distinct from p_exclude_google_calendar
    or current_row.exclude_outlook_calendar is distinct from p_exclude_outlook_calendar
    or current_row.exclude_icloud_calendar is distinct from p_exclude_icloud_calendar
    or current_row.exclude_hevy is distinct from p_exclude_hevy
    or current_row.include_reminder_history is distinct from p_include_reminder_history
    or current_row.include_notes is distinct from p_include_notes
  then
    insert into cadence_advisor_private.daily_brief_preferences as preference (
      user_id, enabled, include_calendar, include_reminder_history, include_notes, revision,
      calendar_connection_generation, calendar_selection_revision,
      include_outlook_calendar, outlook_connection_generation, outlook_selection_revision,
      include_icloud_calendar, icloud_connection_generation, icloud_selection_revision,
      include_hevy, hevy_connection_generation,
      use_connected_sources, exclude_google_calendar, exclude_outlook_calendar, exclude_icloud_calendar, exclude_hevy,
      updated_at
    ) values (
      actor_id, p_daily_brief_enabled, false, p_include_reminder_history, p_include_notes, current_revision + 1,
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

    delete from cadence_advisor_private.daily_brief_runs
    where user_id = actor_id;
    if not p_daily_brief_enabled then
      delete from cadence_advisor_private.daily_brief_tip_deliveries
      where user_id = actor_id;
    end if;
  end if;

  insert into cadence_advisor_private.ai_feature_settings as setting (
    user_id, approved_at, tips_enabled, chat_enabled, revision, updated_at
  ) values (
    actor_id, statement_timestamp(), p_tips_enabled, p_chat_enabled, 1, statement_timestamp()
  )
  on conflict (user_id) do update set
    tips_enabled = excluded.tips_enabled,
    chat_enabled = excluded.chat_enabled,
    revision = least(setting.revision + 1, 2147483647),
    updated_at = excluded.updated_at
  where setting.tips_enabled is distinct from excluded.tips_enabled
    or setting.chat_enabled is distinct from excluded.chat_enabled;

  return cadence_advisor_private.read_ai_settings();
end;
$$;

create function public.read_ai_settings()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.read_ai_settings();
$$;

create function public.save_ai_settings(
  p_daily_brief_enabled boolean,
  p_tips_enabled boolean,
  p_chat_enabled boolean,
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
  select cadence_advisor_private.save_ai_settings(
    p_daily_brief_enabled, p_tips_enabled, p_chat_enabled, p_use_connected_sources,
    p_exclude_google_calendar, p_exclude_outlook_calendar, p_exclude_icloud_calendar, p_exclude_hevy,
    p_include_reminder_history, p_include_notes, p_expected_revision
  );
$$;

revoke all on function cadence_advisor_private.read_ai_settings() from public, anon, authenticated, service_role;
revoke all on function public.read_ai_settings() from public, anon, authenticated, service_role;
grant execute on function cadence_advisor_private.read_ai_settings() to authenticated;
grant execute on function public.read_ai_settings() to authenticated;

revoke all on function cadence_advisor_private.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
revoke all on function public.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function cadence_advisor_private.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) to authenticated;
grant execute on function public.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint) to authenticated;

commit;
