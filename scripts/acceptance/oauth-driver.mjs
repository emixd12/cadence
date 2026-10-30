// Ticket 248. OAuth and consent driver for Cadence QA test accounts A and B.
// Discovery → client registration (DCR or client metadata document) → PKCE
// authorize → consent in headless Chrome with the account's kept session →
// code exchange → refresh → revocation. Tokens stay in this process's memory
// as Secret values. Output is token-free JSON lines only.
//
// Local (isolated stack; Next dev with CADENCE_MCP_ENABLED=true,
// CADENCE_ENABLE_TEST_LOGIN=1 and an HTTPS loopback issuer such as
// https://127.0.0.1:4410, because the app accepts plain-HTTP issuers only on
// ports 4321–4330). CADENCE_LOCAL_SUPABASE_URL and
// CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY must point at the same loopback stack:
//   npm run mcp:oauth -- --target local --issuer https://127.0.0.1:4410 --ca-file <ca.pem> \
//     [--client-metadata-url https://claude.ai/oauth/claude-code-client-metadata]
// Each local run creates two test-login users; the app allows ten per process.
//
// Production (Ticket 256 onward only; needs CADENCE_QA_SUPABASE_PUBLISHABLE_KEY):
//   npm run mcp:oauth -- enroll --target production --allow-production --slot A --port <4321-4330>
//   npm run mcp:oauth -- status --target production --allow-production
//   npm run mcp:oauth -- --target production --allow-production
// Enrollment stores each account's Supabase session in the login Keychain
// (service cadence-qa-oauth-session, accounts production:A / production:B).
// Other runners import createOAuthDriver() and keep tokens in their own memory.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { isCliEntry } from './cli-entry.mjs';
import {
  AcceptanceError, PRODUCTION, Secret, createKeychainSessionStore, createMemorySessionStore, createSessionManager, enrollProduction,
} from './test-account-sessions.mjs';
import { GRANTS, captureRedirect, checkConsentView, launchChrome, readConsentView, submitConsent } from './consent-page.mjs';

export const ALL_SCOPES = Object.freeze([...GRANTS.full, 'offline_access']);
export const DEFAULT_CLIENT_NAME = 'Cadence acceptance driver';
export const DEFAULT_CALLBACK_PORT = 4419;
// A raw single request uses the stateless legacy revision; the 2026 revision needs an SDK-built _meta envelope.
const MCP_PROTOCOL_VERSION = '2025-06-18';

const base64url = (bytes) => Buffer.from(bytes).toString('base64url');
export function createPkce() {
  const verifier = base64url(randomBytes(32));
  return { verifier: new Secret(verifier), challenge: base64url(createHash('sha256').update(verifier).digest()) };
}
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const isLoopbackOrigin = (value) => {
  try { const url = new URL(value); return ['127.0.0.1', 'localhost'].includes(url.hostname) && url.origin === value; } catch { return false; }
};

async function readJson(response, code) {
  try { return await response.json(); } catch { throw new AcceptanceError(code, { status: response.status }); }
}

/** Parse a JSON or single-event SSE MCP response body. */
export function parseMcpBody(text, contentType = '') {
  if (/text\/event-stream/.test(contentType)) {
    const data = text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
    for (const entry of data.reverse()) { try { const parsed = JSON.parse(entry); if (parsed.id !== undefined) return parsed; } catch { /* next */ } }
    return null;
  }
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * @param {object} options
 * @param {'local'|'production'} options.target
 * @param {string} options.issuer exact Cadence origin
 * @param {ReturnType<typeof createSessionManager>} options.sessions
 * @param {import('playwright-core').Browser} options.browser
 */
export function createOAuthDriver({
  target, issuer, sessions, browser, fetchImpl = fetch, callbackPort = DEFAULT_CALLBACK_PORT, clientName = DEFAULT_CLIENT_NAME,
  ignoreLocalCertificate = false, consentTimeoutMs = 60_000,
}) {
  if (target === 'production' && issuer !== PRODUCTION.issuer) throw new AcceptanceError('production-issuer-mismatch');
  if (target === 'local' && !isLoopbackOrigin(issuer)) throw new AcceptanceError('local-issuer-not-loopback');
  if (sessions?.target !== target) throw new AcceptanceError('session-target-mismatch');
  if (!Number.isInteger(callbackPort) || callbackPort < 1024 || callbackPort > 65535) throw new AcceptanceError('callback-port-invalid');
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;
  const http = (url, init = {}) => fetchImpl(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(20_000) }).catch(() => {
    throw new AcceptanceError('network-failed');
  });
  let metadata = null;

  const discover = async () => {
    if (metadata) return metadata;
    const resourceResponse = await http(`${issuer}/.well-known/oauth-protected-resource/mcp`);
    if (resourceResponse.status !== 200) throw new AcceptanceError('discovery-failed', { status: resourceResponse.status });
    const resource = await readJson(resourceResponse, 'discovery-failed');
    if (resource.resource !== `${issuer}/mcp` || !resource.authorization_servers?.includes(issuer)) throw new AcceptanceError('discovery-mismatch');
    const serverResponse = await http(`${issuer}/.well-known/oauth-authorization-server`);
    if (serverResponse.status !== 200) throw new AcceptanceError('discovery-failed', { status: serverResponse.status });
    const server = await readJson(serverResponse, 'discovery-failed');
    if (server.issuer !== issuer || !server.code_challenge_methods_supported?.includes('S256') ||
        !server.authorization_response_iss_parameter_supported) throw new AcceptanceError('discovery-mismatch');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) {
      if (typeof server[key] !== 'string' || !server[key].startsWith(`${issuer}/`)) throw new AcceptanceError('discovery-mismatch');
    }
    metadata = { resource: resource.resource, scopes: resource.scopes_supported, server };
    return metadata;
  };

  /** Dynamic client registration: a fresh public native client per call. */
  const registerDynamic = async ({ name = clientName } = {}) => {
    const { server } = await discover();
    const response = await http(server.registration_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: name, application_type: 'native', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
    });
    if (response.status !== 201) throw new AcceptanceError('registration-failed', { status: response.status });
    const body = await readJson(response, 'registration-failed');
    if (typeof body.client_id !== 'string' || !body.redirect_uris?.includes(redirectUri)) throw new AcceptanceError('registration-mismatch');
    return { type: 'dcr', clientId: body.client_id, clientName: body.client_name };
  };

  /** Client metadata document: the client_id is a public HTTPS URL that must allow this loopback redirect. */
  const useMetadataDocument = async (metadataUrl) => {
    const { server } = await discover();
    if (!server.client_id_metadata_document_supported) throw new AcceptanceError('cimd-unsupported');
    let url;
    try { url = new URL(metadataUrl); } catch { throw new AcceptanceError('cimd-url-invalid'); }
    if (url.protocol !== 'https:' || url.href !== metadataUrl) throw new AcceptanceError('cimd-url-invalid');
    const response = await http(metadataUrl, { headers: { Accept: 'application/json' } });
    if (response.status !== 200) throw new AcceptanceError('cimd-fetch-failed', { status: response.status });
    const doc = await readJson(response, 'cimd-fetch-failed');
    const loopback = redirectUri.replace(/:\d+\//, '/');
    if (doc.client_id !== metadataUrl || !Array.isArray(doc.redirect_uris) ||
        !doc.redirect_uris.some((uri) => uri === redirectUri || uri === loopback)) throw new AcceptanceError('cimd-redirect-not-allowed');
    return { type: 'cimd', clientId: metadataUrl, clientName: doc.client_name };
  };

  const tokenRequest = async (body) => {
    const { server } = await discover();
    const response = await http(server.token_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
    });
    const json = await readJson(response, 'token-failed');
    if (response.status !== 200) throw new AcceptanceError('token-rejected', { status: response.status, error: typeof json.error === 'string' ? json.error : null });
    if (json.token_type !== 'Bearer' || typeof json.access_token !== 'string' || typeof json.scope !== 'string') throw new AcceptanceError('token-invalid');
    return json;
  };

  const tokenSet = (client, slot, userId, json, requestedOffline) => {
    let access = new Secret(json.access_token);
    let refresh = typeof json.refresh_token === 'string' ? new Secret(json.refresh_token) : null;
    let scopes = json.scope.split(' ').filter(Boolean);
    let expiresAt = new Date(Date.now() + Math.max(0, Number(json.expires_in) || 0) * 1000).toISOString();
    if (requestedOffline && !refresh) throw new AcceptanceError('refresh-token-missing');
    const set = {
      slot, userId, clientId: client.clientId, clientType: client.type,
      get scopes() { return [...scopes]; },
      get expiresAt() { return expiresAt; },
      get accessToken() { return access; },
      get refreshToken() { return refresh; },
      authorization: () => `Bearer ${access.reveal()}`,
      /** Rotate the refresh token. The old one must stop working. */
      refresh: async () => {
        if (!refresh) throw new AcceptanceError('refresh-token-missing');
        const next = await tokenRequest({ grant_type: 'refresh_token', client_id: client.clientId, refresh_token: refresh.reveal(), resource: `${issuer}/mcp` });
        if (typeof next.refresh_token !== 'string' || next.refresh_token === refresh.reveal()) throw new AcceptanceError('refresh-not-rotated');
        const previous = refresh;
        access = new Secret(next.access_token); refresh = new Secret(next.refresh_token);
        scopes = next.scope.split(' ').filter(Boolean);
        expiresAt = new Date(Date.now() + Math.max(0, Number(next.expires_in) || 0) * 1000).toISOString();
        return { rotated: true, previous };
      },
      /** RFC 7009 revocation of the refresh token (revokes its token family). */
      revoke: async () => {
        const { server } = await discover();
        const token = (refresh ?? access).reveal();
        const response = await http(server.revocation_endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.clientId, token }),
        });
        if (response.status !== 200) throw new AcceptanceError('revoke-failed', { status: response.status });
        return { revoked: true };
      },
      toJSON: () => ({ slot, userId, clientId: client.clientId, clientType: client.type, scopes: [...scopes], expiresAt }),
    };
    return set;
  };

  /**
   * Authorize one grant for a test account and return in-memory tokens, or
   * `{ denied: true }` for a Deny. Refuses before consent when the kept session
   * belongs to another account, or when the page shows anything unexpected.
   */
  const authorize = async ({ slot, client, grant = 'full', decision = 'allow', requestScopes = ALL_SCOPES, expectUserId = undefined }) => {
    const grantScopes = GRANTS[grant];
    if (!grantScopes) throw new AcceptanceError('grant-invalid');
    if (decision === 'allow' && !grantScopes.every((scope) => requestScopes.includes(scope))) throw new AcceptanceError('grant-not-requested');
    const account = sessions.account(slot);
    const userId = expectUserId ?? account?.userId;
    if (!userId) throw new AcceptanceError('account-unknown');
    const { server, resource } = await discover();
    const record = await sessions.current(slot, { expectUserId: userId });
    const cookies = await sessions.browserCookies(slot, issuer, { expectUserId: userId });
    const pkce = createPkce();
    const state = base64url(randomBytes(24));
    const params = new URLSearchParams({
      response_type: 'code', client_id: client.clientId, redirect_uri: redirectUri, code_challenge: pkce.challenge,
      code_challenge_method: 'S256', resource, scope: requestScopes.join(' '), state,
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: target === 'local' && ignoreLocalCertificate });
    let code = null;
    try {
      await context.addCookies(cookies);
      const capture = await captureRedirect(context, redirectUri, consentTimeoutMs);
      const page = await context.newPage();
      try { await page.goto(`${server.authorization_endpoint}?${params}`, { waitUntil: 'domcontentloaded', timeout: consentTimeoutMs }); } catch {
        if (!(await capture.peek())) throw new AcceptanceError('authorize-navigation-failed');
      }
      const early = await capture.peek();
      if (early) throw new AcceptanceError('authorize-error', { error: early.searchParams.get('error') });
      const landed = new URL(page.url());
      if (landed.origin !== issuer || landed.pathname !== '/oauth/consent') throw new AcceptanceError(landed.pathname === '/login' ? 'session-not-accepted' : 'consent-not-reached');
      const view = await readConsentView(page);
      const problems = checkConsentView(view, {
        userId, email: target === 'production' ? account?.email ?? null : record.email ?? null,
        clientName: client.clientName, requestedScopes: requestScopes,
      });
      if (problems.includes('account')) throw new AcceptanceError('wrong-account', { at: 'consent-page' });
      if (problems.length) throw new AcceptanceError('consent-mismatch', { problems });
      await submitConsent(page, { decision, grantScopes });
      const returned = await capture.wait();
      if (returned.searchParams.get('iss') !== issuer) throw new AcceptanceError('authorization-response-issuer-mismatch');
      if (returned.searchParams.get('state') !== state) throw new AcceptanceError('authorization-response-state-mismatch');
      if (decision === 'deny') {
        if (returned.searchParams.get('error') !== 'access_denied' || returned.searchParams.has('code')) throw new AcceptanceError('deny-not-honored');
      } else {
        const value = returned.searchParams.get('code');
        if (!value || returned.searchParams.has('error')) throw new AcceptanceError('authorization-failed', { error: returned.searchParams.get('error') });
        code = new Secret(value);
      }
      await capture.dispose();
      await sessions.absorbBrowserCookies(slot, await context.cookies(issuer));
    } finally {
      await context.close().catch(() => {});
    }
    if (decision === 'deny') return { denied: true, slot, userId, clientId: client.clientId };
    const json = await tokenRequest({
      grant_type: 'authorization_code', client_id: client.clientId, code: code.reveal(), code_verifier: pkce.verifier.reveal(),
      redirect_uri: redirectUri, resource,
    });
    const expected = [...grantScopes, ...(requestScopes.includes('offline_access') ? ['offline_access'] : [])];
    if (!sameSet(json.scope.split(' '), expected)) throw new AcceptanceError('granted-scope-mismatch');
    return tokenSet(client, slot, userId, json, requestScopes.includes('offline_access'));
  };

  /** One MCP tools/call with the access token; returns only token-free facts. */
  const probe = async (tokens, { name = 'get_account_context', args = {} } = {}) => {
    const response = await http(`${issuer}/mcp`, {
      method: 'POST',
      headers: { Authorization: tokens.authorization(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = parseMcpBody(await response.text(), response.headers.get('content-type') ?? '');
    const result = body?.result;
    return {
      status: response.status,
      ok: response.status === 200 && Boolean(result) && result.isError !== true,
      errorCode: result?.structuredContent?.error?.code ?? body?.error?.data?.error?.code ?? body?.error?.data?.code ?? null,
      grantedScopes: Array.isArray(result?.structuredContent?.granted_scopes) ? result.structuredContent.granted_scopes : null,
    };
  };

  /** Active grants for the account, read as that account under RLS. */
  const grantsFor = async (slot, clientId) => {
    const rows = await sessions.userRpc(slot, 'oauth_list_grants');
    return (rows ?? []).filter((row) => row.client_id === clientId).map((row) => ({ grantId: row.grant_id, scopes: row.scopes }));
  };
  /** Cleanup: revoke this driver's grants for a client as the account itself. */
  const revokeGrants = async (slot, clientId) => {
    let revoked = 0;
    for (const grant of await grantsFor(slot, clientId)) {
      if (await sessions.userRpc(slot, 'oauth_revoke_grant', { p_grant_id: grant.grantId }) === true) revoked += 1;
    }
    return revoked;
  };

  return { redirectUri, discover, registerDynamic, useMetadataDocument, authorize, probe, grantsFor, revokeGrants };
}

/** Sanitized JSON line. Only fixed fields are ever written. */
export function summaryLine(entry) {
  const allowed = ['step', 'target', 'slot', 'userId', 'clientType', 'grant', 'decision', 'ok', 'scopes', 'probe', 'error', 'problems', 'rotated', 'revoked', 'grants', 'oldRefreshRejected', 'revokedAccessRejected'];
  return JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([key, value]) => allowed.includes(key) && value !== undefined)));
}

/**
 * The standard plan on one DCR client (registration is rate limited): read-only,
 * Behaviors-only and full grants, step-up denial, refresh rotation and reuse
 * rejection, revocation, a Deny that creates no grant, and a wrong-account
 * refusal before consent. Optionally one grant through a client metadata
 * document. Each grant is revoked as the account before the next step.
 */
export async function runStandardPlan({ driver, sessions, target, slots = ['A', 'B'], metadataUrl = null, emit = (entry) => process.stdout.write(`${summaryLine(entry)}\n`) }) {
  const [main, other] = slots;
  const results = [];
  const record = (entry) => { const line = { target, ...entry }; results.push(line); emit(line); return line; };
  const cleanup = new Map();
  const remember = (slot, clientId) => cleanup.set(`${slot} ${clientId}`, [slot, clientId]);
  const grantStep = async (client, grant) => {
    remember(main, client.clientId);
    const tokens = await driver.authorize({ slot: main, client, grant });
    const probe = await driver.probe(tokens);
    const grants = await driver.grantsFor(main, client.clientId);
    const scopesOk = probe.ok && sameSet(probe.grantedScopes ?? [], GRANTS[grant]) && grants.length === 1 && sameSet(grants[0].scopes, GRANTS[grant]);
    record({ step: 'allow', slot: main, userId: tokens.userId, clientType: client.type, grant, decision: 'allow', ok: scopesOk, scopes: tokens.scopes, probe: probe.ok ? 'ok' : `failed-${probe.status}` });
    return tokens;
  };
  const revokeStep = async (client, grant, tokens) => {
    await tokens.revoke();
    const revokedProbe = await driver.probe(tokens);
    const revokedGrants = await driver.revokeGrants(main, client.clientId);
    record({ step: 'revoke', slot: main, clientType: client.type, grant, ok: revokedProbe.status === 401 && revokedGrants === 1, revoked: true, revokedAccessRejected: revokedProbe.status === 401 });
  };
  try {
    const discovered = await driver.discover();
    record({ step: 'discovery', ok: Boolean(discovered.server) });
    const client = await driver.registerDynamic();
    remember(main, client.clientId);
    for (const grant of ['read', 'behaviors', 'full']) {
      const tokens = await grantStep(client, grant);
      if (grant === 'read') {
        const write = await driver.probe(tokens, { name: 'create_behavior', args: {} });
        record({ step: 'step-up-denied', slot: main, grant, ok: write.status === 403 && write.errorCode === 'insufficient_scope', probe: `status-${write.status}` });
      }
      if (grant === 'full') {
        const { previous } = await tokens.refresh();
        const after = await driver.probe(tokens);
        const reuse = await refreshRejected(driver, tokens, previous);
        record({ step: 'refresh', slot: main, grant, ok: after.ok && reuse, rotated: true, oldRefreshRejected: reuse });
      }
      await revokeStep(client, grant, tokens);
    }
    if (metadataUrl) {
      const cimd = await driver.useMetadataDocument(metadataUrl);
      await revokeStep(cimd, 'read', await grantStep(cimd, 'read'));
    }
    const denied = await driver.authorize({ slot: main, client, grant: 'full', decision: 'deny' });
    const afterDeny = await driver.grantsFor(main, client.clientId);
    record({ step: 'deny', slot: main, decision: 'deny', ok: denied.denied === true && afterDeny.length === 0, grants: afterDeny.length });
    if (other) {
      remember(other, client.clientId);
      let refusal = null;
      try {
        await driver.authorize({ slot: other, client, grant: 'read', expectUserId: sessions.account(main)?.userId });
      } catch (error) { refusal = error instanceof AcceptanceError ? error.code : 'unexpected'; }
      const afterWrong = await driver.grantsFor(other, client.clientId);
      record({ step: 'wrong-account', slot: other, ok: refusal === 'wrong-account' && afterWrong.length === 0, error: refusal ?? 'not-refused', grants: afterWrong.length });
    }
  } catch (error) {
    record({ step: 'failed', ok: false, error: error instanceof AcceptanceError ? error.code : 'unexpected', problems: error?.details?.problems });
  } finally {
    for (const [slot, clientId] of cleanup.values()) {
      try { await driver.revokeGrants(slot, clientId); } catch { record({ step: 'cleanup', slot, ok: false, error: 'grant-revoke-failed' }); }
    }
  }
  return { ok: results.length > 0 && results.every((entry) => entry.ok), results };
}

/** True when the token endpoint rejects a rotated-out refresh token. */
async function refreshRejected(driver, tokens, previous) {
  const { server, resource } = await driver.discover();
  const response = await fetch(server.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: tokens.clientId, refresh_token: previous.reveal(), resource }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response) return false;
  const body = await response.json().catch(() => ({}));
  return response.status === 400 && body.error === 'invalid_grant';
}

function parseArgs(argv) {
  const options = { command: 'run', target: null, plan: 'standard', allowProduction: false, issuer: null, caFile: null, metadataUrl: null, slot: null, port: null, callbackPort: DEFAULT_CALLBACK_PORT };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('--')) options.command = args.shift();
  while (args.length) {
    const flag = args.shift();
    const value = () => { const next = args.shift(); if (next === undefined || next.startsWith('--')) throw new AcceptanceError('argument-missing', { flag }); return next; };
    switch (flag) {
      case '--target': options.target = value(); break;
      case '--plan': options.plan = value(); break;
      case '--issuer': options.issuer = value(); break;
      case '--ca-file': options.caFile = value(); break;
      case '--client-metadata-url': options.metadataUrl = value(); break;
      case '--slot': options.slot = value(); break;
      case '--port': options.port = Number(value()); break;
      case '--callback-port': options.callbackPort = Number(value()); break;
      case '--allow-production': options.allowProduction = true; break;
      default: throw new AcceptanceError('argument-unknown', { flag: String(flag).slice(0, 40) });
    }
  }
  if (!['local', 'production'].includes(options.target)) throw new AcceptanceError('target-required');
  if (options.target === 'production' && !options.allowProduction) throw new AcceptanceError('production-requires-allow-production');
  if (!['run', 'enroll', 'status'].includes(options.command)) throw new AcceptanceError('command-unknown');
  if (options.plan !== 'standard') throw new AcceptanceError('plan-unknown');
  return options;
}

/** Trust one extra local CA (the isolated dev server's self-signed certificate). */
function trustLocalCertificate(caFile) {
  let pem;
  try { pem = readFileSync(caFile, 'utf8'); } catch { throw new AcceptanceError('ca-file-unreadable'); }
  if (!/-----BEGIN CERTIFICATE-----/.test(pem)) throw new AcceptanceError('ca-file-invalid');
  setDefaultCACertificates([...getCACertificates('default'), pem]);
}

export async function main(argv = process.argv.slice(2), env = process.env, out = (line) => process.stdout.write(`${line}\n`)) {
  const options = parseArgs(argv);
  const local = options.target === 'local';
  const publishableKey = local ? env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY : env.CADENCE_QA_SUPABASE_PUBLISHABLE_KEY;
  if (options.command === 'enroll') {
    if (local) throw new AcceptanceError('enroll-production-only');
    await enrollProduction({ slot: options.slot, port: options.port, publishableKey, out });
    return 0;
  }
  const issuer = local ? options.issuer : PRODUCTION.issuer;
  if (local) {
    if (!isLoopbackOrigin(issuer ?? '')) throw new AcceptanceError('local-issuer-not-loopback');
    if (options.caFile) trustLocalCertificate(options.caFile);
  }
  const sessions = createSessionManager({
    target: options.target, publishableKey,
    supabaseUrl: local ? env.CADENCE_LOCAL_SUPABASE_URL : PRODUCTION.supabaseUrl,
    store: local ? createMemorySessionStore() : createKeychainSessionStore(),
  });
  if (options.command === 'status') {
    for (const slot of ['A', 'B']) {
      try { const record = await sessions.current(slot); out(summaryLine({ step: 'session', target: options.target, slot, userId: record.userId, ok: true })); } catch (error) {
        out(summaryLine({ step: 'session', target: options.target, slot, ok: false, error: error instanceof AcceptanceError ? error.code : 'unexpected' }));
      }
    }
    return 0;
  }
  const browser = await launchChrome();
  try {
    if (local) {
      for (const slot of ['A', 'B']) {
        const enrolled = await sessions.enrollLocalTestLogin(slot, { browser, issuer, contextOptions: { ignoreHTTPSErrors: true } });
        out(summaryLine({ step: 'test-login', target: 'local', slot, userId: enrolled.userId, ok: true }));
      }
    }
    const driver = createOAuthDriver({ target: options.target, issuer, sessions, browser, callbackPort: options.callbackPort, ignoreLocalCertificate: local });
    const { ok } = await runStandardPlan({ driver, sessions, target: options.target, metadataUrl: options.metadataUrl, emit: (entry) => out(summaryLine(entry)) });
    return ok ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
  }
}

if (isCliEntry(import.meta)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stdout.write(`${summaryLine({ step: 'stopped', ok: false, error: error instanceof AcceptanceError ? error.code : 'unexpected' })}\n`);
    process.exitCode = 1;
  });
}
