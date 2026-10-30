import { describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { EventEmitter } from 'node:events';
import {
  AcceptanceError, PRODUCTION, Secret, SESSION_FORMAT, createKeychainSessionStore, createMemorySessionStore,
  createSessionManager, enrollProduction, recordFromSession, toBrokerSession,
} from '../scripts/acceptance/test-account-sessions.mjs';
import { GRANTS, checkConsentView } from '../scripts/acceptance/consent-page.mjs';
import { createOAuthDriver, createPkce, main, parseMcpBody, summaryLine } from '../scripts/acceptance/oauth-driver.mjs';
import { ACCOUNTS } from '../scripts/mcp-session-broker.mjs';

const LOCAL_SUPABASE = 'http://127.0.0.1:56481';
const KEY = 'sb_publishable_test';
const TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImtpZC0xIn0.eyJzdWIiOiJ4In0.c2ln';
const fakeSession = (userId, refresh = 'refresh-one', access = TOKEN, expiresAt = Math.floor(Date.now() / 1000) + 3600) => ({
  access_token: access, refresh_token: refresh, expires_at: expiresAt, expires_in: 3600, token_type: 'bearer', user: { id: userId, email: 'a@example.test' },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Secret', () => {
  it('never appears in JSON, inspect or string interpolation', () => {
    const secret = new Secret('very-secret-value');
    expect(JSON.stringify({ secret })).not.toContain('very-secret-value');
    expect(inspect({ secret })).not.toContain('very-secret-value');
    expect(`${secret}`).toBe('[redacted]');
    expect(secret.reveal()).toBe('very-secret-value');
  });
  it('PKCE verifier is a Secret and the challenge is S256 base64url', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toBeInstanceOf(Secret);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('summaryLine', () => {
  it('keeps only allowlisted token-free fields', () => {
    const line = summaryLine({ step: 'allow', ok: true, accessToken: 'tok', refreshToken: 'ref', code: 'abc', url: 'https://x/?code=abc', cookies: ['c'], scopes: ['cadence.read'] });
    expect(JSON.parse(line)).toEqual({ step: 'allow', ok: true, scopes: ['cadence.read'] });
  });
});

describe('checkConsentView', () => {
  const view = {
    accountId: 'user-a', email: 'A@Example.test', clientName: 'Cadence acceptance driver', verified: false,
    fixedScopes: ['cadence.read'], optionalScopes: ['cadence.occurrences.write', 'cadence.behaviors.write'], hasAllow: true, hasDeny: true,
  };
  const expected = { userId: 'user-a', email: 'a@example.test', clientName: 'Cadence acceptance driver', requestedScopes: [...GRANTS.full, 'offline_access'] };
  it('accepts the expected account, client and scopes', () => {
    expect(checkConsentView(view, expected)).toEqual([]);
  });
  it('flags a different signed-in account', () => {
    expect(checkConsentView({ ...view, accountId: 'user-b' }, expected)).toContain('account');
    expect(checkConsentView({ ...view, email: 'b@example.test' }, expected)).toEqual(['email']);
  });
  it('flags a different client or scope list', () => {
    expect(checkConsentView({ ...view, clientName: 'Other' }, expected)).toEqual(['client']);
    expect(checkConsentView({ ...view, optionalScopes: ['cadence.occurrences.write'] }, expected)).toEqual(['scopes']);
    expect(checkConsentView(view, { ...expected, requestedScopes: GRANTS.read })).toEqual(['scopes']);
  });
  it('flags a page without both buttons', () => {
    expect(checkConsentView({ ...view, hasDeny: false }, expected)).toEqual(['buttons']);
  });
});

describe('session records', () => {
  it('extends the session broker handoff shape with a refresh token', () => {
    const record = recordFromSession(fakeSession('user-a'), { target: 'local', slot: 'A', user: { id: 'user-a', email: null } });
    expect(record.format).toBe(SESSION_FORMAT);
    expect(record.kid).toBe('kid-1');
    expect(Object.keys(toBrokerSession(record))).toEqual(['userId', 'accessToken', 'expiresAt', 'kid']);
  });
});

describe('Keychain store', () => {
  const fakeSecurity = (responses = []) => {
    const calls = [];
    const execImpl = (file, args, _options, callback) => {
      const call = { file, args, stdin: '' };
      calls.push(call);
      const child = new EventEmitter();
      child.stdin = { end: (input) => { call.stdin = input ?? ''; } };
      const next = responses.shift() ?? { stdout: '' };
      setImmediate(() => callback(next.error ?? null, next.stdout ?? ''));
      return child;
    };
    return { calls, execImpl };
  };
  it('writes through stdin, never through process arguments', async () => {
    const { calls, execImpl } = fakeSecurity();
    const store = createKeychainSessionStore({ execImpl });
    const record = recordFromSession(fakeSession(ACCOUNTS.A, 'refresh-secret'), { target: 'production', slot: 'A', user: { id: ACCOUNTS.A } });
    await store.set('production:A', record);
    expect(calls[0].file).toBe('/usr/bin/security');
    expect(calls[0].args).toEqual(['-i']);
    expect(calls[0].args.join(' ')).not.toContain(Buffer.from('refresh-secret').toString('base64').slice(0, 8));
    expect(calls[0].stdin).toMatch(/^add-generic-password -U -s cadence-qa-oauth-session -a production:A /);
    expect(calls[0].stdin).not.toContain('refresh-secret');
  });
  it('reads and decodes the stored record; a missing item is null', async () => {
    const record = { format: SESSION_FORMAT, slot: 'A' };
    const missing = Object.assign(new Error('missing'), { code: 44 });
    const { execImpl } = fakeSecurity([{ stdout: `${Buffer.from(JSON.stringify(record)).toString('base64')}\n` }, { error: missing }]);
    const store = createKeychainSessionStore({ execImpl });
    expect(await store.get('production:A')).toEqual(record);
    expect(await store.get('production:A')).toBeNull();
  });
  it('rejects unexpected account names', async () => {
    const store = createKeychainSessionStore({ execImpl: fakeSecurity().execImpl });
    await expect(store.get('production:C')).rejects.toMatchObject({ code: 'keychain-account-invalid' });
  });
});

describe('session manager', () => {
  const authFetch = (users) => vi.fn(async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      const auth = new Headers(init.headers).get('Authorization') ?? '';
      const user = users[auth.replace(/^Bearer /, '')];
      return user ? json(user) : json({ message: 'invalid' }, 401);
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      return json(fakeSession('user-a', 'refresh-two', `${TOKEN}2`));
    }
    return json({}, 404);
  });

  it('refuses a stored session for the wrong account before any network call', async () => {
    const store = createMemorySessionStore();
    const fetchImpl = vi.fn();
    const manager = createSessionManager({ target: 'local', supabaseUrl: LOCAL_SUPABASE, publishableKey: KEY, store, fetchImpl, accounts: { A: { userId: 'user-a' } } });
    await store.set('local:A', recordFromSession(fakeSession('user-b'), { target: 'local', slot: 'A', user: { id: 'user-b' } }));
    await expect(manager.current('A')).rejects.toMatchObject({ code: 'wrong-account' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses when the Auth server says the token belongs to someone else', async () => {
    const store = createMemorySessionStore();
    const manager = createSessionManager({ target: 'local', supabaseUrl: LOCAL_SUPABASE, publishableKey: KEY, store,
      fetchImpl: authFetch({ [TOKEN]: { id: 'user-b' } }), accounts: { A: { userId: 'user-a' } } });
    await store.set('local:A', recordFromSession(fakeSession('user-a'), { target: 'local', slot: 'A', user: { id: 'user-a' } }));
    await expect(manager.current('A')).rejects.toMatchObject({ code: 'wrong-account' });
  });

  it('refreshes a session near expiry and writes the rotated refresh token back', async () => {
    const store = createMemorySessionStore();
    const manager = createSessionManager({ target: 'local', supabaseUrl: LOCAL_SUPABASE, publishableKey: KEY, store,
      fetchImpl: authFetch({ [`${TOKEN}2`]: { id: 'user-a', email: 'a@example.test' } }), accounts: { A: { userId: 'user-a' } } });
    const soon = Math.floor(Date.now() / 1000) + 60;
    await store.set('local:A', recordFromSession(fakeSession('user-a', 'refresh-one', TOKEN, soon), { target: 'local', slot: 'A', user: { id: 'user-a' } }));
    const record = await manager.current('A');
    expect(record.refreshToken).toBe('refresh-two');
    expect((await store.get('local:A')).refreshToken).toBe('refresh-two');
  });

  it('requires a session before consent', async () => {
    const manager = createSessionManager({ target: 'local', supabaseUrl: LOCAL_SUPABASE, publishableKey: KEY, store: createMemorySessionStore(), accounts: { A: { userId: 'user-a' } } });
    await expect(manager.current('A')).rejects.toMatchObject({ code: 'session-missing' });
  });

  it('pins production to the Keychain, the hosted project and the fixed A/B identities', () => {
    const keychain = createKeychainSessionStore({ execImpl: () => ({ stdin: { end() {} } }) });
    expect(() => createSessionManager({ target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey: KEY, store: createMemorySessionStore() })).toThrow('production-config-invalid');
    expect(() => createSessionManager({ target: 'production', supabaseUrl: 'https://other.supabase.co', publishableKey: KEY, store: keychain })).toThrow('production-config-invalid');
    const manager = createSessionManager({ target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey: KEY, store: keychain });
    expect(manager.account('A')).toEqual({ userId: ACCOUNTS.A, email: 'cadence.testing.is@gmail.com' });
    expect(manager.account('B').userId).toBe(ACCOUNTS.B);
  });

  it('keeps local mode on loopback Supabase and test-login on loopback issuers', async () => {
    expect(() => createSessionManager({ target: 'local', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey: KEY, store: createMemorySessionStore() })).toThrow('local-supabase-not-loopback');
    const manager = createSessionManager({ target: 'local', supabaseUrl: LOCAL_SUPABASE, publishableKey: KEY, store: createMemorySessionStore() });
    await expect(manager.enrollLocalTestLogin('A', { browser: {}, issuer: PRODUCTION.issuer })).rejects.toMatchObject({ code: 'test-login-local-only' });
  });
});

describe('production guards', () => {
  it('enrollment only listens on an allowlisted loopback port', async () => {
    await expect(enrollProduction({ slot: 'A', port: 4410, publishableKey: KEY })).rejects.toMatchObject({ code: 'port-not-allowlisted' });
    await expect(enrollProduction({ slot: 'C', port: 4321, publishableKey: KEY })).rejects.toMatchObject({ code: 'slot-invalid' });
  });
  it('the CLI refuses production without --allow-production', async () => {
    await expect(main(['--target', 'production'], {}, () => {})).rejects.toMatchObject({ code: 'production-requires-allow-production' });
    await expect(main(['--target', 'local', '--issuer', 'https://app.cadence-me.com'], {}, () => {})).rejects.toMatchObject({ code: 'local-issuer-not-loopback' });
  });
  it('the driver pins the production issuer and keeps local issuers on loopback', () => {
    const sessions = { target: 'production' };
    expect(() => createOAuthDriver({ target: 'production', issuer: 'https://evil.example', sessions })).toThrow('production-issuer-mismatch');
    expect(() => createOAuthDriver({ target: 'local', issuer: 'https://example.com', sessions: { target: 'local' } })).toThrow('local-issuer-not-loopback');
    expect(() => createOAuthDriver({ target: 'local', issuer: 'https://127.0.0.1:4410', sessions })).toThrow('session-target-mismatch');
  });
});

describe('driver HTTP steps (fake server)', () => {
  const issuer = 'https://127.0.0.1:4410';
  const server = (overrides = {}) => vi.fn(async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/.well-known/oauth-protected-resource/mcp')) return json({ resource: `${issuer}/mcp`, authorization_servers: [issuer], scopes_supported: GRANTS.full });
    if (url.endsWith('/.well-known/oauth-authorization-server')) return json({
      issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`, code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true, ...overrides.server,
    });
    if (url.endsWith('/oauth/register')) {
      const body = JSON.parse(init.body);
      return json({ client_id: 'client-1', client_name: body.client_name, redirect_uris: body.redirect_uris }, 201);
    }
    if (url === 'https://client.example/metadata.json') return json(overrides.cimd ?? { client_id: url, client_name: 'Example', redirect_uris: ['http://127.0.0.1/callback'] });
    return json({}, 404);
  });
  const driver = (fetchImpl) => createOAuthDriver({ target: 'local', issuer, sessions: { target: 'local' }, browser: null, fetchImpl });

  it('discovers, then registers a native public client with the loopback redirect', async () => {
    const fetchImpl = server();
    const d = driver(fetchImpl);
    const client = await d.registerDynamic();
    expect(client).toEqual({ type: 'dcr', clientId: 'client-1', clientName: 'Cadence acceptance driver' });
    const registration = JSON.parse(fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/oauth/register'))[1].body);
    expect(registration).toMatchObject({ application_type: 'native', token_endpoint_auth_method: 'none', redirect_uris: ['http://127.0.0.1:4419/callback'] });
  });

  it('rejects discovery that names another issuer', async () => {
    await expect(driver(server({ server: { issuer: 'https://other.example' } })).discover()).rejects.toMatchObject({ code: 'discovery-mismatch' });
  });

  it('accepts a metadata document only when it allows the loopback redirect', async () => {
    await expect(driver(server()).useMetadataDocument('https://client.example/metadata.json')).resolves.toMatchObject({ type: 'cimd', clientName: 'Example' });
    const strict = server({ cimd: { client_id: 'https://client.example/metadata.json', client_name: 'Example', redirect_uris: ['https://client.example/cb'] } });
    await expect(driver(strict).useMetadataDocument('https://client.example/metadata.json')).rejects.toMatchObject({ code: 'cimd-redirect-not-allowed' });
    await expect(driver(server()).useMetadataDocument('http://client.example/metadata.json')).rejects.toMatchObject({ code: 'cimd-url-invalid' });
  });
});

describe('parseMcpBody', () => {
  it('reads JSON and single-event SSE responses', () => {
    expect(parseMcpBody('{"id":1,"result":{}}', 'application/json')).toEqual({ id: 1, result: {} });
    expect(parseMcpBody('event: message\ndata: {"id":1,"result":{"ok":true}}\n\n', 'text/event-stream')).toEqual({ id: 1, result: { ok: true } });
    expect(parseMcpBody('not json')).toBeNull();
  });
});

describe('AcceptanceError', () => {
  it('carries a fixed code as its message', () => {
    const error = new AcceptanceError('wrong-account', { at: 'consent-page' });
    expect(error.message).toBe('wrong-account');
    expect(error.details).toEqual({ at: 'consent-page' });
  });
});
