begin;

-- Workstream WS-1B (2026-11-25): Reactivate separate Google Calendar AI MCP grant,
-- add provenance columns & Nov 19 Chat backfill, embed atomic §2(d) disconnect purge,
-- add <=30-day derived-finding expiry sweep, add longitudinal review opt-in & table,
-- and enforce atomic writer generation fences + Ticket 335 identity-lock parity.

-- ---------------------------------------------------------------------------
-- 1. Provenance columns, daily_calendar_load cap & longitudinal_calendar_reviews
-- ---------------------------------------------------------------------------

alter table public.chat_conversations
  add column if not exists google_calendar_first_touched_at timestamptz,
  add column if not exists google_calendar_grant_generation bigint,
  add column if not exists summary_google_calendar_expires_at timestamptz;

create index if not exists chat_conversations_gcal_summary_expiry_idx
  on public.chat_conversations (summary_google_calendar_expires_at)
  where summary_google_calendar_expires_at is not null;

alter table public.chat_messages
  add column if not exists contains_google_calendar boolean not null default false;

alter table cadence_advisor_private.daily_brief_days
  add column if not exists included_google_calendar boolean not null default false,
  add column if not exists google_calendar_grant_generation bigint;

alter table public.move_proposals
  add column if not exists contains_google_calendar boolean not null default false;

alter table public.opportunity_proposals
  add column if not exists contains_google_calendar boolean not null default false;

alter table cadence_advisor_private.agent_run_contents
  add column if not exists google_calendar_derived boolean not null default false;

alter table public.daily_calendar_load
  add column if not exists grant_purpose text not null default 'standard'
    check (grant_purpose in ('standard', 'agent_mcp')),
  add column if not exists expires_at timestamptz;

alter table public.daily_calendar_load
  drop constraint if exists daily_calendar_load_google_mcp_expiry_check;

alter table public.daily_calendar_load
  add constraint daily_calendar_load_google_mcp_expiry_check check (
    source <> 'google_calendar'
    or grant_purpose <> 'agent_mcp'
    or (expires_at is not null and expires_at <= synced_at + interval '30 days')
  );

create index if not exists daily_calendar_load_expiry_idx
  on public.daily_calendar_load (expires_at)
  where expires_at is not null;

-- Remove any legacy REST-origin Google rows from daily_calendar_load.
delete from public.daily_calendar_load
where source = 'google_calendar'
  and grant_purpose = 'standard';

create table if not exists public.longitudinal_calendar_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cadence text not null check (cadence in ('weekly', 'monthly')),
  window_start date not null,
  window_end date not null check (window_end >= window_start),
  summary_json jsonb not null
    check (jsonb_typeof(summary_json) = 'object' and octet_length(summary_json::text) <= 65536),
  contains_google_calendar boolean not null default false,
  google_calendar_grant_generation bigint,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  constraint longitudinal_calendar_reviews_google_expiry_check check (
    not contains_google_calendar
    or (expires_at is not null and expires_at <= created_at + interval '30 days')
  )
);

create index if not exists longitudinal_calendar_reviews_user_created_idx
  on public.longitudinal_calendar_reviews (user_id, created_at desc);

create index if not exists longitudinal_calendar_reviews_expiry_idx
  on public.longitudinal_calendar_reviews (expires_at)
  where expires_at is not null;

alter table public.longitudinal_calendar_reviews enable row level security;

revoke all on table public.longitudinal_calendar_reviews from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.longitudinal_calendar_reviews to authenticated, service_role;

drop policy if exists longitudinal_calendar_reviews_select_own on public.longitudinal_calendar_reviews;
drop policy if exists longitudinal_calendar_reviews_insert_own on public.longitudinal_calendar_reviews;
drop policy if exists longitudinal_calendar_reviews_update_own on public.longitudinal_calendar_reviews;
drop policy if exists longitudinal_calendar_reviews_delete_own on public.longitudinal_calendar_reviews;

create policy longitudinal_calendar_reviews_select_own on public.longitudinal_calendar_reviews
  for select to authenticated
  using ((select auth.uid()) = user_id and (select auth.jwt() ->> 'cadence_grant_id') is null);
create policy longitudinal_calendar_reviews_insert_own on public.longitudinal_calendar_reviews
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select auth.jwt() ->> 'cadence_grant_id') is null);
create policy longitudinal_calendar_reviews_update_own on public.longitudinal_calendar_reviews
  for update to authenticated
  using ((select auth.uid()) = user_id and (select auth.jwt() ->> 'cadence_grant_id') is null)
  with check ((select auth.uid()) = user_id and (select auth.jwt() ->> 'cadence_grant_id') is null);
create policy longitudinal_calendar_reviews_delete_own on public.longitudinal_calendar_reviews
  for delete to authenticated
  using ((select auth.uid()) = user_id and (select auth.jwt() ->> 'cadence_grant_id') is null);

-- Historical backfill (Q4): tag Nov 19+ Chat messages & conversations whose stored JSON
-- contains a tool call with "subject":"calendar".
with tagged_messages as (
  update public.chat_messages as message
  set contains_google_calendar = true
  where message.created_at >= '2026-11-19T00:00:00Z'::timestamptz
    and not message.contains_google_calendar
    and (
      message.parts::text like '%"subject":"calendar"%'
      or message.parts::text like '%"subject": "calendar"%'
    )
  returning message.conversation_id, message.created_at
), touched_conversations as (
  select conversation_id, min(created_at) as first_touched_at
  from tagged_messages
  group by conversation_id
)
update public.chat_conversations as conversation
set
  google_calendar_first_touched_at = coalesce(conversation.google_calendar_first_touched_at, touched.first_touched_at),
  summary_google_calendar_expires_at = case
    when conversation.summary is not null then
      coalesce(
        conversation.summary_google_calendar_expires_at,
        least(conversation.updated_at + interval '30 days', statement_timestamp() + interval '30 days')
      )
    else conversation.summary_google_calendar_expires_at
  end
from touched_conversations as touched
where conversation.id = touched.conversation_id;

-- ---------------------------------------------------------------------------
-- 2. Opt-in longitudinal review preferences & read_ai_settings / read_daily_brief_preferences
-- ---------------------------------------------------------------------------

alter table cadence_advisor_private.ai_feature_settings
  add column if not exists longitudinal_calendar_review_enabled boolean not null default false,
  add column if not exists longitudinal_calendar_review_cadence text not null default 'weekly'
    check (longitudinal_calendar_review_cadence in ('weekly', 'monthly'));

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
    'google_calendar_source', 'agent_mcp'
  );
end;
$$;

create or replace function cadence_advisor_private.read_ai_settings()
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
    ),
    'google_calendar_source', 'agent_mcp',
    'longitudinal_calendar_review_enabled', coalesce(feature.longitudinal_calendar_review_enabled, false),
    'longitudinal_calendar_review_cadence', coalesce(feature.longitudinal_calendar_review_cadence, 'weekly')
  );
end;
$$;

create or replace function cadence_advisor_private.save_ai_settings(
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
  p_expected_revision bigint,
  p_longitudinal_calendar_review_enabled boolean,
  p_longitudinal_calendar_review_cadence text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  current_row cadence_advisor_private.daily_brief_preferences%rowtype;
  current_feature cadence_advisor_private.ai_feature_settings%rowtype;
  current_revision bigint;
  next_longitudinal_enabled boolean;
  next_longitudinal_cadence text;
begin
  if p_daily_brief_enabled is null or p_tips_enabled is null or p_chat_enabled is null
    or p_use_connected_sources is null
    or p_exclude_google_calendar is null or p_exclude_outlook_calendar is null
    or p_exclude_icloud_calendar is null or p_exclude_hevy is null
    or p_include_reminder_history is null or p_include_notes is null
    or p_expected_revision is null or p_expected_revision not between 0 and 2147483647
    or (p_longitudinal_calendar_review_cadence is not null
      and p_longitudinal_calendar_review_cadence not in ('weekly', 'monthly'))
  then
    raise exception 'AI settings are invalid.' using errcode = '22023';
  end if;

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

  select * into current_feature
  from cadence_advisor_private.ai_feature_settings as setting
  where setting.user_id = actor_id
  for update;

  next_longitudinal_enabled := coalesce(
    p_longitudinal_calendar_review_enabled,
    current_feature.longitudinal_calendar_review_enabled,
    false
  );
  next_longitudinal_cadence := coalesce(
    p_longitudinal_calendar_review_cadence,
    current_feature.longitudinal_calendar_review_cadence,
    'weekly'
  );

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
    user_id, approved_at, tips_enabled, chat_enabled,
    longitudinal_calendar_review_enabled, longitudinal_calendar_review_cadence,
    revision, updated_at
  ) values (
    actor_id, statement_timestamp(), p_tips_enabled, p_chat_enabled,
    next_longitudinal_enabled, next_longitudinal_cadence,
    1, statement_timestamp()
  )
  on conflict (user_id) do update set
    tips_enabled = excluded.tips_enabled,
    chat_enabled = excluded.chat_enabled,
    longitudinal_calendar_review_enabled = excluded.longitudinal_calendar_review_enabled,
    longitudinal_calendar_review_cadence = excluded.longitudinal_calendar_review_cadence,
    revision = least(setting.revision + 1, 2147483647),
    updated_at = excluded.updated_at
  where setting.tips_enabled is distinct from excluded.tips_enabled
    or setting.chat_enabled is distinct from excluded.chat_enabled
    or setting.longitudinal_calendar_review_enabled is distinct from excluded.longitudinal_calendar_review_enabled
    or setting.longitudinal_calendar_review_cadence is distinct from excluded.longitudinal_calendar_review_cadence;

  return cadence_advisor_private.read_ai_settings();
end;
$$;

create or replace function cadence_advisor_private.save_ai_settings(
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
security definer
set search_path = ''
as $$
  select cadence_advisor_private.save_ai_settings(
    p_daily_brief_enabled, p_tips_enabled, p_chat_enabled, p_use_connected_sources,
    p_exclude_google_calendar, p_exclude_outlook_calendar, p_exclude_icloud_calendar, p_exclude_hevy,
    p_include_reminder_history, p_include_notes, p_expected_revision, null, null
  );
$$;

create or replace function public.save_ai_settings(
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
  p_expected_revision bigint,
  p_longitudinal_calendar_review_enabled boolean,
  p_longitudinal_calendar_review_cadence text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.save_ai_settings(
    p_daily_brief_enabled, p_tips_enabled, p_chat_enabled, p_use_connected_sources,
    p_exclude_google_calendar, p_exclude_outlook_calendar, p_exclude_icloud_calendar, p_exclude_hevy,
    p_include_reminder_history, p_include_notes, p_expected_revision,
    p_longitudinal_calendar_review_enabled, p_longitudinal_calendar_review_cadence
  );
$$;

revoke all on function cadence_advisor_private.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint, boolean, text) from public, anon, authenticated, service_role;
grant execute on function cadence_advisor_private.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint, boolean, text) to authenticated;
grant execute on function public.save_ai_settings(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, bigint, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Atomic §2(d) disconnect purge & count helper
-- ---------------------------------------------------------------------------

create or replace function cadence_advisor_private.purge_google_calendar_ai_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invalidate active Daily Brief leases.
  delete from cadence_advisor_private.daily_brief_runs
  where user_id = p_user_id;

  -- Hard-delete Google-Calendar-touched Chat conversations (cascades messages, actions, confirms).
  delete from public.chat_conversations as conversation
  where conversation.user_id = p_user_id
    and (
      conversation.google_calendar_first_touched_at is not null
      or exists (
        select 1 from public.chat_messages as message
        where message.conversation_id = conversation.id
          and message.contains_google_calendar = true
      )
    );

  -- Hard-delete Google-Calendar-derived Daily Brief days, move proposals, opportunity proposals,
  -- agent run contents, Google daily_calendar_load rows, and longitudinal reviews.
  delete from cadence_advisor_private.daily_brief_days
  where user_id = p_user_id and included_google_calendar = true;

  delete from public.move_proposals
  where user_id = p_user_id and contains_google_calendar = true;

  delete from public.opportunity_proposals
  where user_id = p_user_id and contains_google_calendar = true;

  delete from cadence_advisor_private.agent_run_contents
  where user_id = p_user_id and google_calendar_derived = true;

  delete from public.daily_calendar_load
  where user_id = p_user_id and source = 'google_calendar';

  delete from public.longitudinal_calendar_reviews
  where user_id = p_user_id and contains_google_calendar = true;
end;
$$;

revoke all on function cadence_advisor_private.purge_google_calendar_ai_data(uuid) from public, anon, authenticated, service_role;

create or replace function public.count_google_calendar_ai_chats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  v_count integer;
begin
  if actor_id is null then
    raise exception 'An authenticated caller is required.' using errcode = '42501';
  end if;

  select count(*)::integer into v_count
  from public.chat_conversations as conversation
  where conversation.user_id = actor_id
    and (
      conversation.google_calendar_first_touched_at is not null
      or exists (
        select 1 from public.chat_messages as message
        where message.conversation_id = conversation.id
          and message.contains_google_calendar = true
      )
    );

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.count_google_calendar_ai_chats() from public, anon, authenticated, service_role;
grant execute on function public.count_google_calendar_ai_chats() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reactivate 5 calendar_agent_* RPCs & Ticket 335 identity-lock parity
-- ---------------------------------------------------------------------------

create or replace function cadence_private.keep_one_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from auth.users where id = old.user_id for update;
  -- Deleting the user: its identities cascade after the user row is gone.
  if not found then
    return old;
  end if;

  if not exists (
    select 1 from auth.identities
    where user_id = old.user_id and id <> old.id
  ) then
    raise exception 'cadence_last_identity'
      using errcode = 'P0001',
            detail = 'An account keeps at least one sign-in identity (D31.3).';
  end if;

  if old.provider = 'google' and (
    exists (
      select 1 from public.google_calendar_connections
      where user_id = old.user_id and google_subject = old.provider_id and status = 'connected'
    )
    or exists (
      select 1 from public.google_calendar_agent_connections
      where user_id = old.user_id and google_subject = old.provider_id and status = 'connected'
    )
  ) then
    raise exception 'cadence_calendar_connected'
      using errcode = 'P0001',
            detail = 'Google Calendar reads through this Google sign-in; disconnect it first (D31.5).';
  end if;

  return old;
end;
$$;

revoke all on function cadence_private.keep_one_auth_identity() from public, anon, authenticated;

create or replace function public.calendar_agent_begin_attempt(
  owner_id uuid,
  expected_subject text,
  state_digest text,
  verifier_ciphertext text,
  expected_generation bigint,
  return_target text,
  client_nonce text,
  expected_client_id text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare current_generation bigint;
begin
  if not exists (
    select 1 from auth.identities
    where user_id = owner_id and provider = 'google' and provider_id = expected_subject
  ) then
    raise exception 'calendar_identity_mismatch';
  end if;

  insert into public.google_calendar_agent_connections(user_id, google_subject)
  values (owner_id, expected_subject)
  on conflict (user_id) do update
    set google_subject = excluded.google_subject
    where public.google_calendar_agent_connections.status <> 'connected';

  select generation into current_generation
  from public.google_calendar_agent_connections
  where user_id = owner_id and google_subject = expected_subject
  for update;

  if current_generation is null then raise exception 'calendar_identity_mismatch'; end if;
  if current_generation <> expected_generation then raise exception 'calendar_connection_changed'; end if;
  if return_target = 'desktop' and client_nonce !~ '^[a-zA-Z0-9_-]{32,128}$' then
    raise exception 'invalid_calendar_state';
  end if;

  update public.google_calendar_agent_connections
  set attempt_hash = state_digest
  where user_id = owner_id;

  insert into public.google_calendar_agent_preferences(user_id)
  values (owner_id)
  on conflict do nothing;

  delete from cadence_calendar_agent_private.attempts
  where user_id = owner_id or expires_at < clock_timestamp();

  insert into cadence_calendar_agent_private.attempts values (
    state_digest, owner_id, expected_subject, current_generation,
    verifier_ciphertext, return_target, client_nonce, expected_client_id,
    clock_timestamp() + interval '5 minutes'
  );
  return current_generation;
end;
$$;

create or replace function public.calendar_agent_install_credential(
  owner_id uuid,
  expected_subject text,
  expected_generation bigint,
  expected_state_hash text,
  token_ciphertext text,
  expected_client_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from auth.users where id = owner_id for update;
  if not exists (
    select 1 from auth.identities
    where user_id = owner_id and provider = 'google' and provider_id = expected_subject
  ) then
    return false;
  end if;

  update public.google_calendar_agent_connections
  set generation = generation + 1,
      status = 'connected',
      attempt_hash = null,
      oauth_client_id = expected_client_id
  where user_id = owner_id
    and google_subject = expected_subject
    and generation = expected_generation
    and attempt_hash = expected_state_hash;

  if not found then return false; end if;

  insert into cadence_calendar_agent_private.credentials
  values (owner_id, expected_subject, expected_generation + 1, token_ciphertext)
  on conflict (user_id) do update
    set google_subject = excluded.google_subject,
        generation = excluded.generation,
        sealed_token = excluded.sealed_token;

  -- Clear auto-excluded Google Calendar preference on successful AI connect.
  update cadence_advisor_private.daily_brief_preferences
  set exclude_google_calendar = false,
      revision = least(revision + 1, 2147483647),
      updated_at = statement_timestamp()
  where user_id = owner_id
    and exclude_google_calendar = true;

  if found then
    delete from cadence_advisor_private.daily_brief_runs
    where user_id = owner_id;
  end if;

  return true;
end;
$$;

create or replace function public.calendar_agent_disconnect(
  owner_id uuid,
  expected_subject text,
  expected_generation bigint,
  next_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare old_token text;
begin
  if next_status not in ('disconnected', 'reconnect_required') then
    raise exception 'invalid_calendar_status';
  end if;

  update public.google_calendar_agent_connections
  set generation = generation + 1,
      status = next_status,
      attempt_hash = null
  where user_id = owner_id
    and google_subject = expected_subject
    and generation = expected_generation;

  if not found then raise exception 'calendar_connection_changed'; end if;

  delete from cadence_calendar_agent_private.attempts where user_id = owner_id;
  delete from cadence_calendar_agent_private.credentials
  where user_id = owner_id
  returning sealed_token into old_token;

  update public.google_calendar_agent_preferences
  set selected_calendar_ids = '{}',
      hidden_calendar_ids = '{}'
  where user_id = owner_id;

  -- Atomic §2(d) disconnect purge inside the same transaction.
  perform cadence_advisor_private.purge_google_calendar_ai_data(owner_id);

  return old_token;
end;
$$;

revoke all on function public.calendar_agent_begin_attempt(uuid, text, text, text, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.calendar_agent_consume_attempt(text) from public, anon, authenticated;
revoke all on function public.calendar_agent_install_credential(uuid, text, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.calendar_agent_read_credential(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.calendar_agent_disconnect(uuid, text, bigint, text) from public, anon, authenticated;

grant execute on function public.calendar_agent_begin_attempt(uuid, text, text, text, bigint, text, text, text) to service_role;
grant execute on function public.calendar_agent_consume_attempt(text) to service_role;
grant execute on function public.calendar_agent_install_credential(uuid, text, bigint, text, text, text) to service_role;
grant execute on function public.calendar_agent_read_credential(uuid, text, bigint) to service_role;
grant execute on function public.calendar_agent_disconnect(uuid, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. <=30-day derived-finding expiry RPC (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_google_calendar_ai_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_total integer := 0;
  v_count integer := 0;
begin
  -- Q4 Option 2: null expired Chat summaries while keeping the conversations intact.
  update public.chat_conversations
  set summary = null,
      summary_google_calendar_expires_at = null
  where summary_google_calendar_expires_at is not null
    and summary_google_calendar_expires_at <= v_now;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  -- Delete expired Google daily_calendar_load rows and any legacy REST-origin ('standard') Google rows.
  delete from public.daily_calendar_load
  where source = 'google_calendar'
    and (
      grant_purpose = 'standard'
      or (expires_at is not null and expires_at <= v_now)
    );
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  -- Delete expired longitudinal_calendar_reviews rows.
  delete from public.longitudinal_calendar_reviews
  where expires_at is not null
    and expires_at <= v_now;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  -- Delete Google-derived agent_run_contents older than 30 days.
  delete from cadence_advisor_private.agent_run_contents
  where google_calendar_derived = true
    and created_at <= v_now - interval '30 days';
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;

revoke all on function public.purge_expired_google_calendar_ai_data() from public, anon, authenticated;
grant execute on function public.purge_expired_google_calendar_ai_data() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Atomic writer generation fences
-- ---------------------------------------------------------------------------

create or replace function cadence_advisor_private.save_daily_brief(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_run_id uuid,
  p_refresh boolean,
  p_with_moves boolean,
  p_briefing jsonb,
  p_included_google_calendar boolean,
  p_google_calendar_grant_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := cadence_advisor_private.current_daily_brief_user();
  observed_at timestamptz;
  preference cadence_advisor_private.daily_brief_preferences%rowtype;
  attempt cadence_advisor_private.daily_brief_runs%rowtype;
  saved cadence_advisor_private.daily_brief_days%rowtype;
  v_included_google boolean := coalesce(p_included_google_calendar, false);
begin
  if p_installation_id is null or p_lease_token is null or p_refresh is null or p_with_moves is null
    or p_briefing is null or jsonb_typeof(p_briefing) <> 'object'
    or p_expected_revision is null or p_expected_revision not between 0 and 2147483647
  then
    raise exception 'Daily Brief save is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':daily-brief', 0)
  );
  observed_at := pg_catalog.clock_timestamp();

  -- Atomic generation fence for Google Calendar MCP-derived briefs.
  -- FOR SHARE serializes cleanly against calendar_agent_disconnect's UPDATE under READ COMMITTED.
  if v_included_google then
    if p_google_calendar_grant_generation is null then
      return false;
    end if;
    perform 1
    from public.google_calendar_agent_connections as connection
    where connection.user_id = actor_id
      and connection.status = 'connected'
      and connection.generation = p_google_calendar_grant_generation
    for share;
    if not found then
      return false;
    end if;
  end if;

  select * into preference
  from cadence_advisor_private.daily_brief_preferences
  where user_id = actor_id;
  if preference.user_id is null or not preference.enabled or preference.revision <> p_expected_revision then
    return false;
  end if;

  select * into attempt
  from cadence_advisor_private.daily_brief_runs as run
  where run.user_id = actor_id
    and run.installation_id = p_installation_id
    and run.lease_token = p_lease_token
    and run.status = 'pending'
    and run.lease_expires_at >= observed_at
    and run.preference_revision = p_expected_revision
  for update;
  if attempt.user_id is null
    or attempt.local_date <> (observed_at at time zone attempt.timezone)::date
  then
    return false;
  end if;

  if p_run_id is not null and not exists (
    select 1 from cadence_advisor_private.agent_runs as run
    where run.id = p_run_id and run.user_id = actor_id and run.agent = 'daily_brief'
  ) then
    raise exception 'Daily Brief run is unknown.' using errcode = '22023';
  end if;

  select * into saved
  from cadence_advisor_private.daily_brief_days as day
  where day.user_id = actor_id and day.local_date = attempt.local_date
  for update;

  if p_refresh then
    if saved.briefing is null or saved.timezone <> attempt.timezone or saved.refreshes_used >= 2 then
      return false;
    end if;
    update cadence_advisor_private.daily_brief_days as day
    set run_id = p_run_id,
      briefing = p_briefing,
      with_moves = p_with_moves,
      included_google_calendar = v_included_google,
      google_calendar_grant_generation = case when v_included_google then p_google_calendar_grant_generation else null end,
      refreshes_used = day.refreshes_used + 1,
      briefs_shown = least(day.briefs_shown + 1, 10),
      saved_at = observed_at
    where day.user_id = actor_id and day.local_date = attempt.local_date;
  else
    insert into cadence_advisor_private.daily_brief_days as day (
      user_id, local_date, timezone, run_id, briefing, with_moves,
      included_google_calendar, google_calendar_grant_generation,
      refreshes_used, briefs_shown, first_saved_at, saved_at
    ) values (
      actor_id, attempt.local_date, attempt.timezone, p_run_id, p_briefing, p_with_moves,
      v_included_google, case when v_included_google then p_google_calendar_grant_generation else null end,
      0, 1, observed_at, observed_at
    )
    on conflict (user_id, local_date) do update set
      timezone = excluded.timezone,
      run_id = excluded.run_id,
      briefing = excluded.briefing,
      with_moves = excluded.with_moves,
      included_google_calendar = excluded.included_google_calendar,
      google_calendar_grant_generation = excluded.google_calendar_grant_generation,
      refreshes_used = case when day.timezone = excluded.timezone then day.refreshes_used else 0 end,
      briefs_shown = least(day.briefs_shown + 1, 10),
      saved_at = excluded.saved_at;
  end if;

  update cadence_advisor_private.daily_brief_runs as run
  set status = 'completed', lease_expires_at = null, finished_at = observed_at
  where run.user_id = actor_id
    and run.installation_id = p_installation_id
    and run.lease_token = p_lease_token;

  return true;
end;
$$;

create or replace function cadence_advisor_private.save_daily_brief(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_run_id uuid,
  p_refresh boolean,
  p_with_moves boolean,
  p_briefing jsonb
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief(
    p_installation_id, p_lease_token, p_expected_revision, p_run_id,
    p_refresh, p_with_moves, p_briefing, false, null
  );
$$;

create or replace function public.save_daily_brief(
  p_installation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_run_id uuid,
  p_refresh boolean,
  p_with_moves boolean,
  p_briefing jsonb,
  p_included_google_calendar boolean,
  p_google_calendar_grant_generation bigint
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select cadence_advisor_private.save_daily_brief(
    p_installation_id, p_lease_token, p_expected_revision, p_run_id,
    p_refresh, p_with_moves, p_briefing,
    p_included_google_calendar, p_google_calendar_grant_generation
  );
$$;

revoke all on function cadence_advisor_private.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb, boolean, bigint) from public, anon, authenticated, service_role;
revoke all on function public.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function cadence_advisor_private.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb, boolean, bigint) to authenticated;
grant execute on function public.save_daily_brief(uuid, uuid, bigint, uuid, boolean, boolean, jsonb, boolean, bigint) to authenticated;

create or replace function public.record_brief_move_proposals(
  p_agent_run_id uuid,
  p_local_date date,
  p_proposals jsonb,
  p_supersede boolean default false
) returns setof public.move_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_item jsonb;
  v_occurrence public.occurrences;
  v_behavior public.behaviors;
  v_ids uuid[] := array[]::uuid[];
  v_row public.move_proposals;
  v_contains_google boolean;
  v_google_gen bigint;
begin
  if p_local_date is null or jsonb_typeof(p_proposals) is distinct from 'array' or jsonb_array_length(p_proposals) > 32 then
    raise exception 'move_proposal_invalid_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || p_local_date::text, 303));
  perform cadence_private.strip_brief_move_calendar_text(v_user_id);

  if p_supersede then
    update public.move_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.local_date = p_local_date and p.source = 'daily_brief' and p.status = 'proposed';
  end if;

  for v_item in select value from jsonb_array_elements(p_proposals) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'line') is distinct from 'object'
      or (v_item ->> 'proposed_end_at')::timestamptz < (v_item ->> 'proposed_start_at')::timestamptz then
      raise exception 'move_proposal_invalid_input' using errcode = '22023';
    end if;

    v_contains_google := coalesce((v_item ->> 'contains_google_calendar')::boolean, false);
    if v_contains_google then
      v_google_gen := nullif(v_item ->> 'google_calendar_grant_generation', '')::bigint;
      if v_google_gen is null then
        raise exception 'calendar_connection_changed' using errcode = '55000';
      end if;
      perform 1
      from public.google_calendar_agent_connections as connection
      where connection.user_id = v_user_id
        and connection.status = 'connected'
        and connection.generation = v_google_gen
      for share;
      if not found then
        raise exception 'calendar_connection_changed' using errcode = '55000';
      end if;
    end if;

    select * into v_occurrence from public.occurrences o
      where o.user_id = v_user_id and o.id = (v_item ->> 'occurrence_id')::uuid;
    if v_occurrence.id is null or v_occurrence.local_date <> p_local_date
      or v_occurrence.status <> 'unresolved' or v_occurrence.schedule_kind <> 'exact' then
      continue;
    end if;
    select * into v_behavior from public.behaviors b where b.user_id = v_user_id and b.id = v_occurrence.behavior_id;
    if (now() at time zone v_behavior.timezone)::date <> p_local_date then
      continue;
    end if;
    if exists (select 1 from public.move_proposals p
        where p.user_id = v_user_id and p.occurrence_id = v_occurrence.id and p.local_date = p_local_date
          and p.status in ('declined', 'undone'))
      or exists (select 1 from public.behavior_move_preferences pref
        where pref.user_id = v_user_id and pref.behavior_id = v_occurrence.behavior_id and pref.never_suggest_move) then
      continue;
    end if;
    update public.move_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.occurrence_id = v_occurrence.id and p.status = 'proposed';

    insert into public.move_proposals (
      user_id, occurrence_id, behavior_id, local_date, source, agent_run_id, status,
      proposed_start_at, proposed_end_at, reason, expected_revision, option_refs, line,
      replaces_proposal_id, contains_google_calendar
    ) values (
      v_user_id, v_occurrence.id, v_occurrence.behavior_id, p_local_date, 'daily_brief', p_agent_run_id, 'proposed',
      (v_item ->> 'proposed_start_at')::timestamptz, (v_item ->> 'proposed_end_at')::timestamptz,
      nullif(v_item ->> 'reason', ''), coalesce((v_item ->> 'expected_revision')::timestamptz, v_occurrence.updated_at),
      coalesce(v_item -> 'option_refs', '{}'::jsonb), v_item -> 'line',
      (select p.id from public.move_proposals p
        where p.user_id = v_user_id and p.id = nullif(v_item ->> 'replaces_proposal_id', '')::uuid),
      v_contains_google
    ) returning * into v_row;
    v_ids := v_ids || v_row.id;
  end loop;

  return query select * from public.move_proposals p where p.user_id = v_user_id and p.id = any(v_ids) order by p.proposed_start_at, p.id;
end;
$$;

create or replace function public.record_brief_opportunity_proposals(
  p_agent_run_id uuid,
  p_local_date date,
  p_proposals jsonb,
  p_supersede boolean default false
) returns setof public.opportunity_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := cadence_private.require_daily_brief_agent();
  v_item jsonb;
  v_behavior public.behaviors;
  v_ids uuid[] := array[]::uuid[];
  v_row public.opportunity_proposals;
  v_contains_google boolean;
  v_google_gen bigint;
begin
  if p_local_date is null or jsonb_typeof(p_proposals) is distinct from 'array' or jsonb_array_length(p_proposals) > 8 then
    raise exception 'opportunity_proposal_invalid_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || p_local_date::text, 304));

  delete from public.opportunity_proposals p
  where p.user_id = v_user_id and p.local_date < p_local_date - 30;

  if p_supersede then
    update public.opportunity_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.local_date = p_local_date and p.status = 'proposed';
  end if;

  for v_item in select value from jsonb_array_elements(p_proposals) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'line') is distinct from 'object'
      or (v_item ->> 'proposed_start_at') is null or (v_item ->> 'proposed_end_at') is null
      or (v_item ->> 'proposed_end_at')::timestamptz < (v_item ->> 'proposed_start_at')::timestamptz then
      raise exception 'opportunity_proposal_invalid_input' using errcode = '22023';
    end if;

    v_contains_google := coalesce((v_item ->> 'contains_google_calendar')::boolean, false);
    if v_contains_google then
      v_google_gen := nullif(v_item ->> 'google_calendar_grant_generation', '')::bigint;
      if v_google_gen is null then
        raise exception 'calendar_connection_changed' using errcode = '55000';
      end if;
      perform 1
      from public.google_calendar_agent_connections as connection
      where connection.user_id = v_user_id
        and connection.status = 'connected'
        and connection.generation = v_google_gen
      for share;
      if not found then
        raise exception 'calendar_connection_changed' using errcode = '55000';
      end if;
    end if;

    select * into v_behavior from public.behaviors b
      where b.user_id = v_user_id and b.id = (v_item ->> 'behavior_id')::uuid;
    if v_behavior.id is null or not v_behavior.is_opportunity or not v_behavior.active
      or v_behavior.archived_at is not null
      or (now() at time zone v_behavior.timezone)::date <> p_local_date then
      continue;
    end if;
    if exists (select 1 from public.opportunity_proposals p
        where p.user_id = v_user_id and p.behavior_id = v_behavior.id and p.local_date = p_local_date
          and p.status in ('declined', 'undone'))
      or exists (select 1 from public.behavior_move_preferences pref
        where pref.user_id = v_user_id and pref.behavior_id = v_behavior.id and pref.never_suggest_add) then
      continue;
    end if;
    update public.opportunity_proposals p
    set status = 'superseded', status_changed_at = now()
    where p.user_id = v_user_id and p.behavior_id = v_behavior.id and p.local_date = p_local_date and p.status = 'proposed';

    insert into public.opportunity_proposals (
      user_id, behavior_id, local_date, source, agent_run_id, status,
      proposed_start_at, proposed_end_at, reason, line, replaces_proposal_id,
      contains_google_calendar
    ) values (
      v_user_id, v_behavior.id, p_local_date, 'daily_brief', p_agent_run_id, 'proposed',
      (v_item ->> 'proposed_start_at')::timestamptz, (v_item ->> 'proposed_end_at')::timestamptz,
      nullif(v_item ->> 'reason', ''), v_item -> 'line',
      (select p.id from public.opportunity_proposals p
        where p.user_id = v_user_id and p.id = nullif(v_item ->> 'replaces_proposal_id', '')::uuid),
      v_contains_google
    ) returning * into v_row;
    v_ids := v_ids || v_row.id;
  end loop;

  return query select * from public.opportunity_proposals p
    where p.user_id = v_user_id and p.id = any(v_ids) order by p.proposed_start_at, p.id;
end;
$$;

create or replace function public.agent_run_store_content(
  p_run_id uuid,
  p_kind text,
  p_seq integer,
  p_body jsonb,
  p_calendar_derived boolean,
  p_google_calendar_derived boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text := cadence_advisor_private.current_agent();
  v_user_id uuid := (select auth.uid());
  v_run cadence_advisor_private.agent_runs;
  v_now timestamptz := statement_timestamp();
  v_expires_at timestamptz := statement_timestamp() + interval '30 days';
  v_google_derived boolean := coalesce(p_google_calendar_derived, false);
begin
  if p_calendar_derived is null or p_body is null then
    raise exception 'agent_invalid_input' using errcode = '22023';
  end if;
  select * into v_run from cadence_advisor_private.agent_runs as run
  where run.id = p_run_id and run.user_id = v_user_id and run.agent = v_agent;
  if v_run.id is null then
    raise exception 'agent_run_not_found' using errcode = 'P0002';
  end if;
  if p_calendar_derived or v_google_derived then
    v_expires_at := least(v_expires_at, ((v_run.local_date + 1)::timestamp at time zone v_run.timezone));
    if v_expires_at <= v_now then
      return false;
    end if;
  end if;
  if v_google_derived then
    perform 1
    from public.google_calendar_agent_connections as connection
    where connection.user_id = v_user_id
      and connection.status = 'connected'
    for share;
    if not found then
      return false;
    end if;
  end if;
  delete from cadence_advisor_private.agent_run_contents as content
  where content.user_id = v_user_id and content.expires_at <= v_now;
  insert into cadence_advisor_private.agent_run_contents (
    run_id, user_id, kind, seq, body, calendar_derived, google_calendar_derived, created_at, expires_at
  ) values (
    v_run.id, v_user_id, p_kind, coalesce(p_seq, 0), p_body, p_calendar_derived, v_google_derived, v_now, v_expires_at
  );
  return true;
end;
$$;

revoke all on function public.agent_run_store_content(uuid, text, integer, jsonb, boolean, boolean) from public, anon, service_role;
grant execute on function public.agent_run_store_content(uuid, text, integer, jsonb, boolean, boolean) to authenticated;

-- Private generation-fence helper and BEFORE INSERT OR UPDATE triggers to prevent
-- READ COMMITTED write-skew races against calendar_agent_disconnect.
create or replace function cadence_advisor_private.assert_google_calendar_agent_generation(
  p_user_id uuid,
  p_generation bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_generation is null then
    raise exception 'calendar_connection_changed' using errcode = '55000';
  end if;

  perform 1
  from public.google_calendar_agent_connections as connection
  where connection.user_id = p_user_id
    and connection.status = 'connected'
    and connection.generation = p_generation
  for share;

  if not found then
    raise exception 'calendar_connection_changed' using errcode = '55000';
  end if;
end;
$$;

revoke all on function cadence_advisor_private.assert_google_calendar_agent_generation(uuid, bigint)
  from public, anon, authenticated, service_role;

create or replace function cadence_advisor_private.fence_daily_calendar_load_google_mcp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'google_calendar' and new.grant_purpose = 'agent_mcp' then
    if new.connection_generation is null then
      raise exception 'calendar_connection_changed' using errcode = '55000';
    end if;
    perform cadence_advisor_private.assert_google_calendar_agent_generation(
      new.user_id,
      new.connection_generation
    );
  end if;
  return new;
end;
$$;

revoke all on function cadence_advisor_private.fence_daily_calendar_load_google_mcp()
  from public, anon, authenticated, service_role;

drop trigger if exists daily_calendar_load_google_mcp_generation_fence on public.daily_calendar_load;
create trigger daily_calendar_load_google_mcp_generation_fence
  before insert or update on public.daily_calendar_load
  for each row
  execute function cadence_advisor_private.fence_daily_calendar_load_google_mcp();

create or replace function cadence_advisor_private.fence_longitudinal_calendar_reviews_google_mcp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contains_google_calendar = true then
    if new.google_calendar_grant_generation is null then
      raise exception 'calendar_connection_changed' using errcode = '55000';
    end if;
    perform cadence_advisor_private.assert_google_calendar_agent_generation(
      new.user_id,
      new.google_calendar_grant_generation
    );
  end if;
  return new;
end;
$$;

revoke all on function cadence_advisor_private.fence_longitudinal_calendar_reviews_google_mcp()
  from public, anon, authenticated, service_role;

drop trigger if exists longitudinal_calendar_reviews_google_mcp_generation_fence on public.longitudinal_calendar_reviews;
create trigger longitudinal_calendar_reviews_google_mcp_generation_fence
  before insert or update on public.longitudinal_calendar_reviews
  for each row
  execute function cadence_advisor_private.fence_longitudinal_calendar_reviews_google_mcp();

create or replace function cadence_advisor_private.fence_chat_conversations_google_mcp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.google_calendar_grant_generation is not null then
    if tg_op = 'INSERT'
      or new.google_calendar_grant_generation is distinct from old.google_calendar_grant_generation
    then
      perform cadence_advisor_private.assert_google_calendar_agent_generation(
        new.user_id,
        new.google_calendar_grant_generation
      );
    elsif tg_op = 'UPDATE'
      and new.summary is distinct from old.summary
      and new.summary is not null
    then
      if new.summary_google_calendar_expires_at is not null then
        perform 1
        from public.google_calendar_agent_connections as connection
        where connection.user_id = new.user_id
          and connection.status = 'connected'
        for share;
        if not found then
          raise exception 'calendar_connection_changed' using errcode = '55000';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function cadence_advisor_private.fence_chat_conversations_google_mcp()
  from public, anon, authenticated, service_role;

drop trigger if exists chat_conversations_google_mcp_generation_fence on public.chat_conversations;
create trigger chat_conversations_google_mcp_generation_fence
  before insert or update on public.chat_conversations
  for each row
  execute function cadence_advisor_private.fence_chat_conversations_google_mcp();

-- ---------------------------------------------------------------------------
-- 7. Cross-day occurrence move RPC (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- A cross-day move keeps the Occurrence's recurrence identity: scheduled_for and the
-- schedule fields stay the plan. It changes local_date (the Timeline day) and the
-- effective time, and appends an occurrence_moves record, so linked Macs derive the
-- same effective time from the synced moves. Occurrence generation reads the planned
-- day from scheduled_for and never recreates it or rewrites the moved row
-- (packages/core occurrence.resolver, isCrossDayMove). A destination day that already
-- holds the same schedule slot is refused, since occurrences_schedule_identity_key
-- allows one row per slot and day. Undo is the same call back to the planned day and
-- time, which clears the effective time.

drop function if exists public.move_occurrence_to_date(uuid, date, timestamptz, timestamptz, timestamptz, timestamptz);

create or replace function public.move_occurrence_to_date(
  p_occurrence_id uuid,
  p_target_local_date date,
  p_target_start_at timestamptz,
  p_target_end_at timestamptz,
  p_expected_revision timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_caller record;
  v_occ public.occurrences;
  v_updated public.occurrences;
  v_behavior public.behaviors;
  v_latest public.occurrence_moves;
  v_timezone text;
  v_planned_date date;
  v_planned_length interval;
  v_to_end timestamptz;
  v_to_planned boolean;
  v_from_planned boolean;
  v_move_id uuid := gen_random_uuid();
begin
  select * into v_caller from cadence_private.occurrence_move_caller('move_occurrence_to_date');

  if v_user_id is null then
    raise exception 'Occurrence moves require an authenticated user.' using errcode = '42501';
  end if;

  if p_occurrence_id is null
    or p_target_local_date is null
    or p_target_start_at is null
    or p_expected_revision is null
    or (p_target_end_at is not null and p_target_end_at < p_target_start_at)
  then
    raise exception 'move_occurrence_to_date_invalid_input' using errcode = '22023';
  end if;

  select * into v_occ
  from public.occurrences
  where id = p_occurrence_id and user_id = v_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_occ.status <> 'unresolved' then
    return jsonb_build_object('ok', false, 'reason', 'already_resolved');
  end if;

  if v_occ.updated_at is distinct from p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'reason', 'revision_changed',
      'current_revision', v_occ.updated_at
    );
  end if;

  select * into v_behavior
  from public.behaviors b
  where b.user_id = v_user_id and b.id = v_occ.behavior_id;
  v_timezone := coalesce(nullif(v_behavior.timezone, ''), 'America/New_York');

  if (p_target_start_at at time zone v_timezone)::date <> p_target_local_date then
    return jsonb_build_object('ok', false, 'reason', 'start_not_on_day');
  end if;

  v_planned_date := (v_occ.scheduled_for at time zone v_timezone)::date;
  v_planned_length := case
    when v_occ.schedule_kind = 'exact' or v_occ.schedule_end_time is null then interval '0'
    when v_occ.schedule_end_time >= v_occ.schedule_start_time then v_occ.schedule_end_time - v_occ.schedule_start_time
    else v_occ.schedule_end_time - v_occ.schedule_start_time + interval '24 hours'
  end;
  v_to_end := coalesce(p_target_end_at, p_target_start_at + v_planned_length);

  select * into v_latest
  from public.occurrence_moves m
  where m.user_id = v_user_id and m.occurrence_id = v_occ.id
  order by m.chain_position desc
  limit 1;

  -- Back on the planned day at the planned time: the Occurrence follows its plan again.
  -- A revert needs a move to revise; a row with no move history stays explicit.
  v_to_planned := p_target_local_date = v_planned_date
    and p_target_start_at = v_occ.scheduled_for
    and v_to_end = v_occ.scheduled_for + v_planned_length
    and v_latest.id is not null;
  v_from_planned := v_occ.effective_start_at is null;

  if p_target_local_date = v_occ.local_date
    and ((v_to_planned and v_from_planned)
      or (not v_to_planned and v_occ.effective_start_at = p_target_start_at and v_occ.effective_end_at = v_to_end))
  then
    return jsonb_build_object('ok', false, 'reason', 'no_change');
  end if;

  -- One row per schedule slot and day (occurrences_schedule_identity_key).
  if v_occ.origin = 'scheduled'
    and p_target_local_date <> v_occ.local_date
    and exists (
      select 1
      from public.occurrences other
      where other.user_id = v_user_id
        and other.behavior_id = v_occ.behavior_id
        and other.origin = 'scheduled'
        and other.local_date = p_target_local_date
        and other.schedule_start_time = v_occ.schedule_start_time
        and other.schedule_range_identity = v_occ.schedule_range_identity
        and other.id <> v_occ.id
    )
  then
    return jsonb_build_object('ok', false, 'reason', 'destination_conflict');
  end if;

  insert into public.occurrence_moves (
    id, user_id, occurrence_id, behavior_id, local_date, weekday, timezone, kind,
    from_start_at, from_end_at, from_planned, to_start_at, to_end_at, to_planned, duration_source,
    revises_move_id, chain_root_id, chain_position, reason, source, client_ref
  ) values (
    v_move_id, v_user_id, v_occ.id, v_occ.behavior_id, p_target_local_date,
    extract(isodow from p_target_local_date)::smallint, v_timezone,
    case when v_to_planned then 'revert' else 'move' end,
    coalesce(v_occ.effective_start_at, v_occ.scheduled_for),
    coalesce(v_occ.effective_end_at, v_occ.scheduled_for + v_planned_length),
    v_from_planned,
    p_target_start_at, v_to_end, v_to_planned,
    case when v_to_planned then 'restored' when p_target_end_at is null then 'planned_length' else 'explicit' end,
    v_latest.id, coalesce(v_latest.chain_root_id, v_move_id), coalesce(v_latest.chain_position, 0) + 1,
    'cross_day_move', v_caller.source, v_caller.client_ref
  );

  perform set_config('cadence.occurrence_move_write', 'on', true);

  update public.occurrences
  set local_date = p_target_local_date,
      effective_start_at = case when v_to_planned then null else p_target_start_at end,
      effective_end_at = case when v_to_planned then null else v_to_end end
  where id = v_occ.id and user_id = v_user_id
  returning * into v_updated;

  perform set_config('cadence.occurrence_move_write', '', true);

  -- Open proposals for this Occurrence now describe a place it no longer sits.
  update public.move_proposals p
  set status = 'superseded', status_changed_at = now()
  where p.user_id = v_user_id and p.occurrence_id = v_occ.id and p.status = 'proposed';

  if v_caller.integration then
    perform public.integration_record_activity('move_occurrence_to_date', array[v_occ.id], 'success', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'occurrence', jsonb_build_object(
      'id', v_updated.id,
      'behavior_id', v_updated.behavior_id,
      'local_date', v_updated.local_date,
      'scheduled_for', v_updated.scheduled_for,
      'effective_start_at', v_updated.effective_start_at,
      'effective_end_at', v_updated.effective_end_at,
      'updated_at', v_updated.updated_at
    ),
    'previous', jsonb_build_object(
      'local_date', v_occ.local_date,
      'scheduled_for', v_occ.scheduled_for,
      'effective_start_at', v_occ.effective_start_at,
      'effective_end_at', v_occ.effective_end_at
    )
  );
end;
$$;

revoke all on function public.move_occurrence_to_date(uuid, date, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.move_occurrence_to_date(uuid, date, timestamptz, timestamptz, timestamptz)
  to authenticated;

-- A same-day Undo (revert_occurrence_move) restores the latest record's from time,
-- which for a cross-day move lies on another day while local_date stays. Refuse it;
-- the cross-day Undo above moves the row back with its day.
do $migration$
declare
  definition text;
  anchor text := $a$    elsif p_kind = 'revert' and p_revert_move_id is not null and p_revert_move_id <> v_latest.id then$a$;
begin
  select pg_get_functiondef('cadence_private.apply_occurrence_move(text, uuid, timestamptz, timestamptz, timestamptz, integer, text, text, uuid, uuid, text, text)'::regprocedure)
    into definition;
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'apply_occurrence_move changed unexpectedly (cross-day revert).';
  end if;
  execute replace(definition, anchor,
    $r$    elsif p_kind = 'revert' and v_latest.reason = 'cross_day_move' then
      v_reason := 'cross_day_move';
$r$ || anchor);
end
$migration$;

commit;
