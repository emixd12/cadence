\set ON_ERROR_STOP on

-- Ticket 232 follow-up: the verified 'claude' label applies to Claude web's
-- CIMD client only with its exact client_id and callback. Other label rules are
-- unchanged. Synthetic local fixtures only; all changes roll back.
begin;

do $$
declare
  v_expires constant timestamptz := now() + interval '5 minutes';
  v_case record;
  v_ok boolean;
begin
  -- Claude web's exact document registers with the verified label.
  perform public.oauth_register_client(
    'https://claude.ai/oauth/mcp-oauth-client-metadata', 'cimd', 'Claude', null, null,
    array['https://claude.ai/api/mcp/auth_callback'], 'web', '{}'::jsonb, 'claude', v_expires);
  if (select verified_client from cadence_oauth_private.clients
      where client_id = 'https://claude.ai/oauth/mcp-oauth-client-metadata') is distinct from 'claude' then
    raise exception 'Claude web CIMD did not keep the claude label';
  end if;

  -- Each case: label, type, client_id, redirects, expected acceptance.
  for v_case in select * from (values
    ('claude', 'cimd', 'https://example.com/claude-lookalike', array['https://claude.ai/api/mcp/auth_callback'], false),
    ('claude', 'cimd', 'https://claude.ai/oauth/mcp-oauth-client-metadata', array['https://claude.com/api/mcp/auth_callback'], false),
    ('claude', 'cimd', 'https://claude.ai/oauth/mcp-oauth-client-metadata', array['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'], false),
    ('claude', 'dcr', 'claude-dcr-fixture', array['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'], true),
    ('claude', 'dcr', 'claude-dcr-wrong', array['https://example.com/callback'], false),
    ('claude_code', 'cimd', 'https://claude.ai/oauth/claude-code-client-metadata', array['http://localhost/callback'], true),
    ('claude_code', 'dcr', 'claude-code-dcr', array['http://localhost/callback'], false),
    ('chatgpt', 'cimd', 'https://chatgpt.com/oauth/client.json', array['https://chatgpt.com/connector_platform_oauth_redirect'], true),
    ('chatgpt', 'dcr', 'chatgpt-dcr-fixture', array['https://chatgpt.com/connector/oauth/abc_123'], true),
    ('chatgpt', 'dcr', 'chatgpt-dcr-wrong', array['https://example.com/callback'], false)
  ) as t(label, kind, client_id, redirects, expected) loop
    v_ok := cadence_oauth_private.verified_client_matches(v_case.label, v_case.kind, v_case.client_id, v_case.redirects);
    if v_ok is distinct from v_case.expected then
      raise exception 'verified_client_matches(%, %, %) = %, expected %', v_case.label, v_case.kind, v_case.client_id, v_ok, v_case.expected;
    end if;
  end loop;

  -- A lookalike CIMD client cannot be stored with the claude label.
  begin
    perform public.oauth_register_client(
      'https://example.com/claude-lookalike', 'cimd', 'Claude', null, null,
      array['https://claude.ai/api/mcp/auth_callback'], 'web', '{}'::jsonb, 'claude', v_expires);
    raise exception 'A lookalike CIMD client was stored as verified claude';
  exception when check_violation then null;
  end;
  -- The same lookalike registers unverified.
  perform public.oauth_register_client(
    'https://example.com/claude-lookalike', 'cimd', 'Claude', null, null,
    array['https://claude.ai/api/mcp/auth_callback'], 'web', '{}'::jsonb, null, v_expires);
end;
$$;

select 'ticket-232 claude web cimd label: ok' as result;
rollback;
