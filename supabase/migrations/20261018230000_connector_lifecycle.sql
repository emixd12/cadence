begin;

-- Ticket 222: owner-bound lifecycle for Hevy, Outlook Calendar, and iCloud Calendar.
-- Google Calendar tables, functions, ciphertext, and same-subject rules are unchanged.
-- Sealed credentials and OAuth attempts live only in the existing non-exposed
-- cadence_calendar_private schema. Owners read metadata through RLS; every
-- credential operation is an exact service-role RPC keyed by owner and provider.

create table public.connector_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('hevy','outlook_calendar','icloud_calendar')),
  -- SHA-256 of the provider-namespaced account identity; never an email address.
  account_digest text check (account_digest ~ '^[a-f0-9]{64}$'),
  attempt_hash text check (attempt_hash ~ '^[a-f0-9]{64}$'),
  generation bigint not null default 0 check (generation >= 0),
  status text not null default 'disconnected' check (status in ('connected','disconnected','reconnect_required')),
  primary key (user_id, provider),
  check (status = 'disconnected' or account_digest is not null),
  check (provider = 'outlook_calendar' or attempt_hash is null)
);
alter table public.connector_connections enable row level security;
revoke all on public.connector_connections from public, anon, authenticated;
grant select (user_id, provider, account_digest, generation, status) on public.connector_connections to authenticated;
create policy connector_connection_owner on public.connector_connections
  for select to authenticated using ((select auth.uid()) = user_id);

create table public.connector_preferences (
  user_id uuid not null,
  provider text not null,
  selection_revision bigint not null default 0 check (selection_revision >= 0),
  selected_source_ids text[] not null default '{}',
  hidden_source_ids text[] not null default '{}',
  visible boolean not null default true,
  show_all_day boolean not null default true,
  primary key (user_id, provider),
  foreign key (user_id, provider) references public.connector_connections(user_id, provider) on delete cascade,
  check (cardinality(selected_source_ids) <= 32 and cardinality(hidden_source_ids) <= 32),
  check (hidden_source_ids <@ selected_source_ids),
  check (provider <> 'hevy' or (cardinality(selected_source_ids) = 0 and cardinality(hidden_source_ids) = 0))
);
alter table public.connector_preferences enable row level security;
revoke all on public.connector_preferences from public, anon, authenticated;
grant select (user_id, provider, selection_revision, selected_source_ids, hidden_source_ids, visible, show_all_day)
  on public.connector_preferences to authenticated;
grant update (selected_source_ids, hidden_source_ids, visible, show_all_day) on public.connector_preferences to authenticated;
create policy connector_preferences_read on public.connector_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy connector_preferences_update on public.connector_preferences
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Reuse the existing revision trigger function: every update advances the revision.
create trigger connector_selection_revision before update on public.connector_preferences
  for each row execute function cadence_calendar_private.advance_selection();

create table cadence_calendar_private.connector_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('hevy','outlook_calendar','icloud_calendar')),
  account_digest text not null check (account_digest ~ '^[a-f0-9]{64}$'),
  generation bigint not null check (generation > 0),
  sealed_credential text not null check (length(sealed_credential) <= 32768),
  primary key (user_id, provider),
  foreign key (user_id, provider) references public.connector_connections(user_id, provider) on delete cascade
);
create table cadence_calendar_private.connector_attempts (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'outlook_calendar'),
  generation bigint not null check (generation >= 0),
  sealed_verifier text not null check (length(sealed_verifier) <= 8192),
  target text not null check (target in ('web','desktop')),
  client_state text not null check (length(client_state) <= 128),
  expires_at timestamptz not null,
  unique (user_id, provider)
);
alter table cadence_calendar_private.connector_credentials enable row level security;
alter table cadence_calendar_private.connector_attempts enable row level security;
revoke all on cadence_calendar_private.connector_credentials from public, anon, authenticated;
revoke all on cadence_calendar_private.connector_attempts from public, anon, authenticated;

-- Outlook OAuth attempt: one pending attempt per owner, fenced by generation.
create function public.connector_begin_attempt(owner_id uuid, provider_key text, state_digest text, verifier_ciphertext text,
  expected_generation bigint, return_target text, client_nonce text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_generation bigint;
begin
  if provider_key is distinct from 'outlook_calendar' then raise exception 'connector_provider_unsupported'; end if;
  if not exists (select 1 from auth.users where id = owner_id) then raise exception 'connector_owner_missing'; end if;
  if return_target = 'desktop' and client_nonce !~ '^[a-zA-Z0-9_-]{32,128}$' then raise exception 'connector_invalid_state'; end if;
  insert into public.connector_connections(user_id, provider) values (owner_id, provider_key) on conflict do nothing;
  select generation into current_generation from public.connector_connections
    where user_id = owner_id and provider = provider_key for update;
  if current_generation is distinct from expected_generation then raise exception 'connector_connection_changed'; end if;
  update public.connector_connections set attempt_hash = state_digest where user_id = owner_id and provider = provider_key;
  insert into public.connector_preferences(user_id, provider) values (owner_id, provider_key) on conflict do nothing;
  delete from cadence_calendar_private.connector_attempts
    where (user_id = owner_id and provider = provider_key) or expires_at < clock_timestamp();
  insert into cadence_calendar_private.connector_attempts
    values (state_digest, owner_id, provider_key, current_generation, verifier_ciphertext, return_target, client_nonce,
      clock_timestamp() + interval '5 minutes');
  return current_generation;
end $$;

-- One-use consumption. A replayed or expired state returns null.
create function public.connector_consume_attempt(provider_key text, state_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare attempt cadence_calendar_private.connector_attempts;
begin
  delete from cadence_calendar_private.connector_attempts
    where state_hash = state_digest and provider = provider_key returning * into attempt;
  if attempt.state_hash is null or attempt.expires_at < clock_timestamp() then return null; end if;
  return to_jsonb(attempt);
end $$;

-- Installs a sealed credential and advances the generation. Hevy and iCloud use
-- direct intake (no attempt); Outlook must match its current attempt hash.
-- A bound identity must be disconnected before another identity can connect.
create function public.connector_install_credential(owner_id uuid, provider_key text, provider_account_digest text,
  expected_generation bigint, expected_state_hash text, credential_ciphertext text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current public.connector_connections;
begin
  if provider_key is null or provider_key not in ('hevy','outlook_calendar','icloud_calendar') then raise exception 'connector_provider_unsupported'; end if;
  if provider_account_digest is null or provider_account_digest !~ '^[a-f0-9]{64}$' then raise exception 'connector_invalid_identity'; end if;
  if credential_ciphertext is null or length(credential_ciphertext) = 0 then raise exception 'connector_invalid_credential'; end if;
  if not exists (select 1 from auth.users where id = owner_id) then raise exception 'connector_owner_missing'; end if;
  if provider_key <> 'outlook_calendar' then
    if expected_state_hash is not null then raise exception 'connector_connection_changed'; end if;
    insert into public.connector_connections(user_id, provider) values (owner_id, provider_key) on conflict do nothing;
  end if;
  select * into current from public.connector_connections where user_id = owner_id and provider = provider_key for update;
  if current.user_id is null or current.generation is distinct from expected_generation then raise exception 'connector_connection_changed'; end if;
  if provider_key = 'outlook_calendar' and (expected_state_hash is null or current.attempt_hash is distinct from expected_state_hash) then
    raise exception 'connector_connection_changed';
  end if;
  if current.account_digest is not null and current.account_digest <> provider_account_digest then raise exception 'connector_wrong_account'; end if;
  update public.connector_connections
    set generation = generation + 1, status = 'connected', account_digest = provider_account_digest, attempt_hash = null
    where user_id = owner_id and provider = provider_key;
  insert into cadence_calendar_private.connector_credentials
    values (owner_id, provider_key, provider_account_digest, expected_generation + 1, credential_ciphertext)
    on conflict (user_id, provider) do update set account_digest = excluded.account_digest,
      generation = excluded.generation, sealed_credential = excluded.sealed_credential;
  insert into public.connector_preferences(user_id, provider) values (owner_id, provider_key) on conflict do nothing;
  return expected_generation + 1;
end $$;

create function public.connector_read_credential(owner_id uuid, provider_key text, expected_account_digest text, expected_generation bigint)
returns text language sql stable security definer set search_path = '' as $$
  select c.sealed_credential from cadence_calendar_private.connector_credentials c
  join public.connector_connections s on s.user_id = c.user_id and s.provider = c.provider
  where c.user_id = owner_id and c.provider = provider_key and c.account_digest = expected_account_digest
    and c.generation = expected_generation and s.generation = c.generation and s.account_digest = c.account_digest
    and s.status = 'connected' and exists (select 1 from auth.users where id = owner_id)
$$;

-- Refresh-token rotation inside the current generation only. A disconnected or
-- newer generation cannot be overwritten by a late refresh.
create function public.connector_replace_credential(owner_id uuid, provider_key text, expected_account_digest text,
  expected_generation bigint, credential_ciphertext text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if credential_ciphertext is null or length(credential_ciphertext) = 0 then return false; end if;
  perform 1 from public.connector_connections where user_id = owner_id and provider = provider_key
    and generation = expected_generation and account_digest = expected_account_digest and status = 'connected' for update;
  if not found then return false; end if;
  update cadence_calendar_private.connector_credentials set sealed_credential = credential_ciphertext
    where user_id = owner_id and provider = provider_key and generation = expected_generation and account_digest = expected_account_digest;
  return found;
end $$;

-- Fences the selected provider only. Disconnect also releases the identity binding;
-- reconnect_required keeps it so only the same provider account can reconnect.
create function public.connector_disconnect(owner_id uuid, provider_key text, expected_generation bigint, next_status text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare next_generation bigint;
begin
  if next_status is null or next_status not in ('disconnected','reconnect_required') then raise exception 'connector_invalid_status'; end if;
  update public.connector_connections
    set generation = generation + 1, status = next_status, attempt_hash = null,
      account_digest = case when next_status = 'disconnected' then null else account_digest end
    where user_id = owner_id and provider = provider_key and generation = expected_generation
      and (next_status = 'disconnected' or status = 'connected')
    returning generation into next_generation;
  if next_generation is null then raise exception 'connector_connection_changed'; end if;
  delete from cadence_calendar_private.connector_attempts where user_id = owner_id and provider = provider_key;
  delete from cadence_calendar_private.connector_credentials where user_id = owner_id and provider = provider_key;
  update public.connector_preferences set selected_source_ids = '{}', hidden_source_ids = '{}'
    where user_id = owner_id and provider = provider_key;
  return next_generation;
end $$;

revoke all on function public.connector_begin_attempt(uuid,text,text,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.connector_consume_attempt(text,text) from public, anon, authenticated;
revoke all on function public.connector_install_credential(uuid,text,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.connector_read_credential(uuid,text,text,bigint) from public, anon, authenticated;
revoke all on function public.connector_replace_credential(uuid,text,text,bigint,text) from public, anon, authenticated;
revoke all on function public.connector_disconnect(uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.connector_begin_attempt(uuid,text,text,text,bigint,text,text) to service_role;
grant execute on function public.connector_consume_attempt(text,text) to service_role;
grant execute on function public.connector_install_credential(uuid,text,text,bigint,text,text) to service_role;
grant execute on function public.connector_read_credential(uuid,text,text,bigint) to service_role;
grant execute on function public.connector_replace_credential(uuid,text,text,bigint,text) to service_role;
grant execute on function public.connector_disconnect(uuid,text,bigint,text) to service_role;

commit;
