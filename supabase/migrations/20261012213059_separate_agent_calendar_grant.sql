begin;

-- Credentials and attempts never enter an exposed schema or account snapshots.
create schema if not exists cadence_calendar_agent_private;
revoke all on schema cadence_calendar_agent_private from public, anon, authenticated;
create table public.google_calendar_agent_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_subject text not null,
  oauth_client_id text,
  attempt_hash text,
  generation bigint not null default 0 check (generation >= 0),
  status text not null default 'disconnected' check (status in ('connected','disconnected','reconnect_required'))
);
alter table public.google_calendar_agent_connections enable row level security;
revoke all on public.google_calendar_agent_connections from public, anon, authenticated;
grant select on public.google_calendar_agent_connections to authenticated;
create policy calendar_connection_owner on public.google_calendar_agent_connections for select to authenticated using ((select auth.uid()) = user_id);
create table public.google_calendar_agent_preferences (
  user_id uuid primary key references public.google_calendar_agent_connections(user_id) on delete cascade,
  selection_revision bigint not null default 0 check (selection_revision >= 0),
  selected_calendar_ids text[] not null default '{}',
  hidden_calendar_ids text[] not null default '{}',
  visible boolean not null default true,
  show_all_day boolean not null default true,
  check (cardinality(selected_calendar_ids) <= 32 and cardinality(hidden_calendar_ids) <= 32)
);
alter table public.google_calendar_agent_preferences enable row level security;
revoke all on public.google_calendar_agent_preferences from public, anon, authenticated;
grant select, update(selected_calendar_ids, hidden_calendar_ids, visible, show_all_day) on public.google_calendar_agent_preferences to authenticated;
create policy calendar_preferences_read on public.google_calendar_agent_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy calendar_preferences_update on public.google_calendar_agent_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create function cadence_calendar_agent_private.advance_selection() returns trigger language plpgsql set search_path = '' as $$
begin new.selection_revision := old.selection_revision + 1; return new; end $$;
create trigger calendar_selection_revision before update on public.google_calendar_agent_preferences for each row execute function cadence_calendar_agent_private.advance_selection();

create table cadence_calendar_agent_private.credentials (
 user_id uuid primary key references auth.users(id) on delete cascade,
 google_subject text not null, generation bigint not null, sealed_token text not null check (length(sealed_token) <= 32768)
);
create table cadence_calendar_agent_private.attempts (
 state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 google_subject text not null, generation bigint not null,
 sealed_verifier text not null check (length(sealed_verifier) <= 8192),
 target text not null check (target in ('web','desktop')),
 client_state text not null check (length(client_state) <= 128),
 oauth_client_id text not null,
 expires_at timestamptz not null
);
alter table cadence_calendar_agent_private.credentials enable row level security;
alter table cadence_calendar_agent_private.attempts enable row level security;
revoke all on all tables in schema cadence_calendar_agent_private from public, anon, authenticated;

-- Exact server-only operations. No ordinary Cadence data uses these functions.
create function public.calendar_agent_begin_attempt(owner_id uuid, expected_subject text, state_digest text, verifier_ciphertext text, expected_generation bigint, return_target text, client_nonce text, expected_client_id text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_generation bigint;
begin
 if not exists (select 1 from auth.identities where user_id=owner_id and provider='google' and provider_id=expected_subject) then raise exception 'calendar_identity_mismatch'; end if;
 insert into public.google_calendar_agent_connections(user_id,google_subject) values(owner_id,expected_subject) on conflict(user_id) do nothing;
 select generation into current_generation from public.google_calendar_agent_connections where user_id=owner_id and google_subject=expected_subject for update;
 if current_generation is null then raise exception 'calendar_identity_mismatch'; end if;
 if current_generation <> expected_generation then raise exception 'calendar_connection_changed'; end if;
 if return_target='desktop' and client_nonce !~ '^[a-zA-Z0-9_-]{32,128}$' then raise exception 'invalid_calendar_state'; end if;
 update public.google_calendar_agent_connections set attempt_hash=state_digest where user_id=owner_id;
 insert into public.google_calendar_agent_preferences(user_id) values(owner_id) on conflict do nothing;
 delete from cadence_calendar_agent_private.attempts where user_id=owner_id or expires_at < clock_timestamp();
 insert into cadence_calendar_agent_private.attempts values(state_digest,owner_id,expected_subject,current_generation,verifier_ciphertext,return_target,client_nonce,expected_client_id,clock_timestamp()+interval '5 minutes');
 return current_generation;
end $$;
create function public.calendar_agent_consume_attempt(state_digest text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt cadence_calendar_agent_private.attempts;
begin
 delete from cadence_calendar_agent_private.attempts where state_hash=state_digest returning * into attempt;
 if attempt.state_hash is null or attempt.expires_at < clock_timestamp() then return null; end if;
 return to_jsonb(attempt);
end $$;
create function public.calendar_agent_install_credential(owner_id uuid, expected_subject text, expected_generation bigint, expected_state_hash text, token_ciphertext text, expected_client_id text) returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if not exists (select 1 from auth.identities where user_id=owner_id and provider='google' and provider_id=expected_subject) then return false; end if;
 update public.google_calendar_agent_connections set generation=generation+1,status='connected',attempt_hash=null,oauth_client_id=expected_client_id
 where user_id=owner_id and google_subject=expected_subject and generation=expected_generation and attempt_hash=expected_state_hash;
 if not found then return false; end if;
 insert into cadence_calendar_agent_private.credentials values(owner_id,expected_subject,expected_generation+1,token_ciphertext)
 on conflict(user_id) do update set google_subject=excluded.google_subject,generation=excluded.generation,sealed_token=excluded.sealed_token;
 return true;
end $$;
create function public.calendar_agent_read_credential(owner_id uuid, expected_subject text, expected_generation bigint) returns text language sql security definer set search_path = '' as $$
 select c.sealed_token from cadence_calendar_agent_private.credentials c join public.google_calendar_agent_connections s using(user_id)
 where c.user_id=owner_id and c.google_subject=expected_subject and c.generation=expected_generation and s.generation=c.generation and s.status='connected'
 and exists(select 1 from auth.identities where user_id=owner_id and provider='google' and provider_id=expected_subject)
$$;
create function public.calendar_agent_disconnect(owner_id uuid, expected_subject text, expected_generation bigint, next_status text) returns text language plpgsql security definer set search_path = '' as $$
declare old_token text;
begin
 if next_status not in ('disconnected','reconnect_required') then raise exception 'invalid_calendar_status'; end if;
 update public.google_calendar_agent_connections set generation=generation+1,status=next_status,attempt_hash=null
 where user_id=owner_id and google_subject=expected_subject and generation=expected_generation;
 if not found then raise exception 'calendar_connection_changed'; end if;
 delete from cadence_calendar_agent_private.attempts where user_id=owner_id;
 delete from cadence_calendar_agent_private.credentials where user_id=owner_id returning sealed_token into old_token;
 update public.google_calendar_agent_preferences set selected_calendar_ids='{}',hidden_calendar_ids='{}' where user_id=owner_id;
 return old_token;
end $$;
revoke all on function public.calendar_agent_begin_attempt(uuid,text,text,text,bigint,text,text,text) from public,anon,authenticated;
revoke all on function public.calendar_agent_consume_attempt(text) from public,anon,authenticated;
revoke all on function public.calendar_agent_install_credential(uuid,text,bigint,text,text,text) from public,anon,authenticated;
revoke all on function public.calendar_agent_read_credential(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.calendar_agent_disconnect(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.calendar_agent_begin_attempt(uuid,text,text,text,bigint,text,text,text) to service_role;
grant execute on function public.calendar_agent_consume_attempt(text) to service_role;
grant execute on function public.calendar_agent_install_credential(uuid,text,bigint,text,text,text) to service_role;
grant execute on function public.calendar_agent_read_credential(uuid,text,bigint) to service_role;
grant execute on function public.calendar_agent_disconnect(uuid,text,bigint,text) to service_role;
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
    from public.google_calendar_agent_connections as connection
    join public.google_calendar_agent_preferences as preference
      on preference.user_id = connection.user_id
    where connection.user_id = p_user_id
      and connection.status = 'connected'
      and connection.generation = p_connection_generation
      and preference.selection_revision = p_selection_revision
  ));
$$;

create or replace function cadence_advisor_private.save_daily_brief_preferences_v2(
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
    from public.google_calendar_agent_connections as connection
    join public.google_calendar_agent_preferences as preference
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

-- Prior Calendar disclosure names the standard grant. Require fresh agent consent and disclosure.
delete from cadence_advisor_private.daily_brief_runs where user_id in (
  select user_id from cadence_advisor_private.daily_brief_preferences where include_calendar
);
update cadence_advisor_private.daily_brief_preferences
set include_calendar=false, calendar_connection_generation=null, calendar_selection_revision=null,
    revision=revision+1, updated_at=statement_timestamp()
where include_calendar;
commit;
