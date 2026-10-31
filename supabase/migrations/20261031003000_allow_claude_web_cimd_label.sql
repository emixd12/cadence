begin;

-- Ticket 232 follow-up: Claude web connects with a client-ID metadata document
-- (https://claude.ai/oauth/mcp-oauth-client-metadata). The verified 'claude'
-- label previously applied only to dynamically registered clients, so storing
-- that CIMD client failed the clients check and /oauth/authorize returned 503.
-- Allow 'claude' for that exact CIMD client_id with exactly Claude web's
-- callback, mirroring the claude_code CIMD rule. Every other rule is unchanged.
-- The rule only widens, so existing rows still satisfy the check.
create or replace function cadence_oauth_private.verified_client_matches(
  p_verified_client text,
  p_registration_type text,
  p_client_id text,
  p_redirect_uris text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_verified_client
    when 'claude_code' then
      p_registration_type = 'cimd'
      and p_client_id = 'https://claude.ai/oauth/claude-code-client-metadata'
    when 'chatgpt' then
      (p_registration_type = 'cimd' and p_client_id = 'https://chatgpt.com/oauth/client.json')
      or (
        p_registration_type = 'dcr'
        and not exists (
          select 1 from unnest(p_redirect_uris) as uri
          where uri !~ '^https://chatgpt\.com/(connector_platform_oauth_redirect|connector/oauth/[A-Za-z0-9_-]{1,128})$'
        )
      )
    when 'claude' then
      (
        p_registration_type = 'cimd'
        and p_client_id = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
        and p_redirect_uris = array['https://claude.ai/api/mcp/auth_callback']::text[]
      )
      or (
        p_registration_type = 'dcr'
        and not exists (
          select 1 from unnest(p_redirect_uris) as uri
          where uri not in (
            'https://claude.ai/api/mcp/auth_callback',
            'https://claude.com/api/mcp/auth_callback'
          )
        )
      )
    else false
  end
$$;

commit;
