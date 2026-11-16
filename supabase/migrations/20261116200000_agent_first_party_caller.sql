-- Advisor plan Phase 1A: the first-party caller.
--
-- Cadence's own agents (Daily Brief, coach, chat) call the integration
-- operation layer as the signed-in person, like an MCP client, but without an
-- OAuth grant from the person. Each agent has its own token channel
-- (cadence_channel = 'daily_brief' | 'coach' | 'chat'), following the leave
-- reminder (Ticket 276) and connector completion (Ticket 321) precedent: the
-- token carries no cadence_grant_id claim.
--
-- Each agent is a first-party client row. Each person gets one first-party
-- grant per agent, created on first use by agent_ensure_grant(). The grant row
-- gives the agent everything an MCP client already has, without new tables:
--   - scopes: agent defaults kept in cadence_oauth_private.agent_channels;
--   - idempotency namespace: idempotency records are keyed by client_ref;
--   - activity label: activity rows join the client's client_name;
--   - rate limits: counters are keyed by grant id.
-- First-party clients never take part in OAuth: active_client() skips them,
-- they have no redirect URIs, and MCP tokens cannot resolve their grants.
-- Settings never lists them, and a person or an incident revoke-all does not
-- revoke them.
begin;

-- Clients: a third registration type with no redirect URIs or metadata expiry.
alter table cadence_oauth_private.clients
  drop constraint clients_registration_type_check,
  add constraint clients_registration_type_check
    check (registration_type in ('dcr', 'cimd', 'first_party')),
  drop constraint clients_redirect_uris_check,
  add constraint clients_redirect_uris_check check (
    (registration_type = 'first_party' and redirect_uris = '{}'::text[] and metadata_expires_at is null
      and registration_expires_at is null and client_id ~ '^cadence:agent:[a-z_]{1,32}$')
    or (registration_type <> 'first_party' and cadence_oauth_private.redirect_uris_valid(redirect_uris))
  );

-- Grants: first-party grants use one fixed resource marker instead of a URL.
alter table cadence_oauth_private.grants
  drop constraint grants_resource_check,
  add constraint grants_resource_check check (
    length(resource) <= 2048 and (resource ~ '^https?://' or resource = 'urn:cadence:first-party')
  );

-- One row per agent channel. default_scopes is what the agent may do today.
-- Chat's scopes become the person's choice in Phase 5; until then it gets the
-- MCP set. Phase 2 adds move and propose scopes for the brief and the coach.
create table cadence_oauth_private.agent_channels (
  channel text primary key check (channel in ('daily_brief', 'coach', 'chat')),
  client_ref uuid not null unique references cadence_oauth_private.clients(id) on delete restrict,
  default_scopes text[] not null check (cadence_oauth_private.scopes_valid(default_scopes)),
  updated_at timestamptz not null default now()
);
alter table cadence_oauth_private.agent_channels enable row level security;
revoke all on table cadence_oauth_private.agent_channels from public, anon, authenticated, service_role;

with inserted as (
  insert into cadence_oauth_private.clients (client_id, registration_type, client_name, redirect_uris, application_type)
  values
    ('cadence:agent:daily_brief', 'first_party', 'Cadence Daily Brief', '{}'::text[], 'web'),
    ('cadence:agent:coach', 'first_party', 'Cadence advisor', '{}'::text[], 'web'),
    ('cadence:agent:chat', 'first_party', 'Cadence chat', '{}'::text[], 'web')
  returning id, client_id
)
insert into cadence_oauth_private.agent_channels (channel, client_ref, default_scopes)
select substring(inserted.client_id from '^cadence:agent:(.*)$'), inserted.id,
  case inserted.client_id
    when 'cadence:agent:chat' then array['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write']
    else array['cadence.read']
  end
from inserted;

-- The agent named by the token's channel, or null for any other token.
create function cadence_oauth_private.current_agent_channel()
returns text
language sql
stable
set search_path = ''
as $$
  select case when auth.jwt() ->> 'cadence_channel' in ('daily_brief', 'coach', 'chat')
    then auth.jwt() ->> 'cadence_channel' end
$$;

-- OAuth flows never see a first-party client.
create or replace function cadence_oauth_private.active_client(p_client_id text)
returns cadence_oauth_private.clients
language sql
stable
set search_path = ''
as $$
  select client.*
  from cadence_oauth_private.clients as client
  where client.client_id = p_client_id
    and client.registration_type <> 'first_party'
    and client.disabled_at is null
    and (client.registration_expires_at is null or client.registration_expires_at > now())
$$;

-- An agent token resolves its first-party grant from the channel. An MCP
-- token keeps resolving its grant from the cadence_grant_id claim, and can
-- never resolve a first-party grant.
create or replace function cadence_oauth_private.current_integration_grant(p_require_active boolean)
returns cadence_oauth_private.grants
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_claim text := auth.jwt() ->> 'cadence_grant_id';
  v_agent text := cadence_oauth_private.current_agent_channel();
  v_grant cadence_oauth_private.grants;
begin
  if v_user_id is null then
    raise exception 'integration_auth_required' using errcode = '42501';
  end if;
  if v_agent is not null then
    if v_claim is not null then
      raise exception 'integration_grant_required' using errcode = '42501';
    end if;
    select grant_row.* into v_grant
    from cadence_oauth_private.grants as grant_row
    join cadence_oauth_private.agent_channels as agent on agent.client_ref = grant_row.client_ref
    where agent.channel = v_agent
      and grant_row.user_id = v_user_id
      and grant_row.resource = 'urn:cadence:first-party'
      and grant_row.revoked_at is null;
    if v_grant.id is null then
      raise exception 'integration_agent_grant_missing' using errcode = '42501';
    end if;
    return v_grant;
  end if;
  if v_claim is null or v_claim !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'integration_grant_required' using errcode = '42501';
  end if;
  select grant_row.* into v_grant
  from cadence_oauth_private.grants as grant_row
  join cadence_oauth_private.clients as client on client.id = grant_row.client_ref
  where grant_row.id = v_claim::uuid
    and grant_row.user_id = v_user_id
    and client.registration_type <> 'first_party';
  if v_grant.id is null or (p_require_active and v_grant.revoked_at is not null) then
    raise exception 'integration_grant_inactive' using errcode = '42501';
  end if;
  return v_grant;
end;
$$;
revoke all on function cadence_oauth_private.current_agent_channel() from public, anon, authenticated, service_role;
revoke all on function cadence_oauth_private.current_integration_grant(boolean) from public, anon, authenticated, service_role;

-- Creates or refreshes the person's grant for the token's agent and returns
-- what the server needs to build the operation context. Scopes always follow
-- agent_channels, so changing an agent's scopes needs no deploy.
create function public.agent_ensure_grant()
returns table (grant_id uuid, client_id text, client_label text, scopes text[])
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_agent text := cadence_oauth_private.current_agent_channel();
  v_channel cadence_oauth_private.agent_channels;
  v_client cadence_oauth_private.clients;
  v_grant cadence_oauth_private.grants;
begin
  if v_user_id is null then
    raise exception 'integration_auth_required' using errcode = '42501';
  end if;
  if v_agent is null or auth.jwt() ->> 'cadence_grant_id' is not null then
    raise exception 'integration_agent_channel_required' using errcode = '42501';
  end if;
  select * into v_channel from cadence_oauth_private.agent_channels as agent where agent.channel = v_agent;
  select * into v_client from cadence_oauth_private.clients as client where client.id = v_channel.client_ref;

  insert into cadence_oauth_private.grants (user_id, client_ref, resource, scopes)
  values (v_user_id, v_client.id, 'urn:cadence:first-party', v_channel.default_scopes)
  on conflict (user_id, client_ref, resource) where revoked_at is null do nothing;

  update cadence_oauth_private.grants as grant_row
  set scopes = v_channel.default_scopes, updated_at = now(), last_used_at = now()
  where grant_row.user_id = v_user_id and grant_row.client_ref = v_client.id
    and grant_row.resource = 'urn:cadence:first-party' and grant_row.revoked_at is null
  returning grant_row.* into v_grant;

  return query select v_grant.id, v_client.client_id, v_client.client_name, v_grant.scopes;
end;
$$;
revoke all on function public.agent_ensure_grant() from public, anon, service_role;
grant execute on function public.agent_ensure_grant() to authenticated;

-- Settings shows connected AI apps only.
create or replace function public.oauth_list_grants()
returns table (
  grant_id uuid,
  client_id text,
  client_name text,
  client_uri text,
  logo_uri text,
  verified_client text,
  scopes text[],
  created_at timestamptz,
  last_used_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select grant_row.id, client.client_id, client.client_name, client.client_uri, client.logo_uri,
    client.verified_client, grant_row.scopes, grant_row.created_at, grant_row.last_used_at
  from cadence_oauth_private.grants as grant_row
  join cadence_oauth_private.clients as client on client.id = grant_row.client_ref
  where grant_row.user_id = auth.uid()
    and grant_row.revoked_at is null
    and client.registration_type <> 'first_party'
  order by grant_row.created_at desc, grant_row.id
$$;

create or replace function public.oauth_list_activity(p_limit integer default 50, p_before timestamptz default null)
returns table (
  activity_id bigint,
  grant_id uuid,
  client_name text,
  operation text,
  outcome text,
  error_code text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select activity.id, activity.grant_id, client.client_name, activity.operation,
    activity.outcome, activity.error_code, activity.occurred_at
  from cadence_oauth_private.activity as activity
  join cadence_oauth_private.clients as client on client.id = activity.client_ref
  where activity.user_id = auth.uid()
    and client.registration_type <> 'first_party'
    and activity.occurred_at >= now() - interval '90 days'
    and (p_before is null or activity.occurred_at < p_before)
  order by activity.occurred_at desc, activity.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

create or replace function public.oauth_revoke_grant(p_grant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'oauth_auth_required' using errcode = '42501';
  end if;
  perform 1 from cadence_oauth_private.grants as grant_row
  join cadence_oauth_private.clients as client on client.id = grant_row.client_ref
  where grant_row.id = p_grant_id and grant_row.user_id = v_user_id
    and client.registration_type <> 'first_party'
  for update of grant_row;
  if not found then
    return false;
  end if;
  return cadence_oauth_private.revoke_grant_internal(p_grant_id, 'user');
end;
$$;

-- Incident response targets outside clients. Agents are stopped in code.
create or replace function public.oauth_revoke_all_grants()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  v_count integer := 0;
begin
  for v_grant_id in
    select grant_row.id from cadence_oauth_private.grants as grant_row
    join cadence_oauth_private.clients as client on client.id = grant_row.client_ref
    where grant_row.revoked_at is null and client.registration_type <> 'first_party'
    for update of grant_row
  loop
    if cadence_oauth_private.revoke_grant_internal(v_grant_id, 'incident') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

commit;
