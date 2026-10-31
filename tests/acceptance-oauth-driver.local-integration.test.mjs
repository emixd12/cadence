import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { createMemorySessionStore, createSessionManager } from '../scripts/acceptance/test-account-sessions.mjs';
import { launchChrome } from '../scripts/acceptance/consent-page.mjs';
import { createOAuthDriver } from '../scripts/acceptance/oauth-driver.mjs';

// Opt-in. Needs an isolated local stack and a Next dev server with
// CADENCE_MCP_ENABLED=true, CADENCE_ENABLE_TEST_LOGIN=1 and an HTTPS loopback
// issuer (usage in scripts/acceptance/oauth-driver.mjs). Never point it at production.
const enabled = process.env.CADENCE_ACCEPT_248_LOCAL === '1';
const env = {
  issuer: process.env.CADENCE_ACCEPT_248_ISSUER ?? 'https://127.0.0.1:4410',
  caFile: process.env.CADENCE_ACCEPT_248_CA_FILE,
  dbUrl: process.env.CADENCE_ACCEPT_248_DB_URL,
  appLog: process.env.CADENCE_ACCEPT_248_APP_LOG,
  cimdUrl: process.env.CADENCE_ACCEPT_248_CIMD_URL,
  supabaseUrl: process.env.CADENCE_LOCAL_SUPABASE_URL,
  publishableKey: process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY,
};
const loopback = (value) => { try { return ['127.0.0.1', 'localhost'].includes(new URL(value).hostname); } catch { return false; } };
const SECRET_PATTERNS = [/eyJ[A-Za-z0-9_-]{10,}/, /sb-[a-z0-9]+-auth-token/, /[?&]code=/, /access_token|refresh_token/i, /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, /sb_publishable_|sb_secret_/];
const createdUsers = new Set();
const sql = (text) => execFileSync('psql', [env.dbUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', text], { encoding: 'utf8' }).trim();
const uuid = (value) => { if (!/^[0-9a-f-]{36}$/.test(value)) throw new Error('bad-uuid'); return value; };

describe.skipIf(!enabled)('Ticket 248 OAuth driver against the isolated local stack', () => {
  if (enabled) {
    if (!loopback(env.issuer) || !loopback(env.supabaseUrl ?? '') || !loopback((env.dbUrl ?? '').replace(/^postgres(ql)?:/, 'http:'))) throw new Error('loopback-only');
    setDefaultCACertificates([...getCACertificates('default'), readFileSync(env.caFile, 'utf8')]);
    // This ticket's isolated stack owns its admission buckets.
    sql("delete from cadence_oauth_private.rate_limit_counters where action in ('oauth_request','oauth_global','client_registration')");
  }

  afterAll(() => {
    if (!enabled) return;
    for (const id of createdUsers) sql(`delete from auth.users where id = '${uuid(id)}' and email like 'cadence-test-%@example.invalid'`);
  });

  it('one command: read-only, Behaviors-only and full grants, Deny with no grant, wrong account refused, nothing secret printed', async () => {
    const args = ['scripts/acceptance/oauth-driver.mjs', '--target', 'local', '--issuer', env.issuer, '--ca-file', env.caFile,
      ...(env.cimdUrl ? ['--client-metadata-url', env.cimdUrl] : [])];
    const child = spawn(process.execPath, args, { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    for (const pattern of SECRET_PATTERNS) {
      expect(stdout, String(pattern)).not.toMatch(pattern);
      expect(stderr, String(pattern)).not.toMatch(pattern);
    }
    const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(code, JSON.stringify(lines.filter((line) => !line.ok))).toBe(0);
    const logins = lines.filter((line) => line.step === 'test-login');
    for (const line of logins) createdUsers.add(line.userId);
    const [a, b] = logins.map((line) => line.userId);
    const step = (name, extra = {}) => lines.filter((line) => line.step === name && Object.entries(extra).every(([k, v]) => line[k] === v));
    for (const grant of ['read', 'behaviors', 'full']) {
      expect(step('allow', { grant, clientType: 'dcr' })).toHaveLength(1);
      expect(step('allow', { grant, clientType: 'dcr' })[0]).toMatchObject({ ok: true, probe: 'ok', slot: 'A', userId: a });
    }
    expect(step('step-up-denied')[0]).toMatchObject({ ok: true, probe: 'status-403' });
    expect(step('refresh')[0]).toMatchObject({ ok: true, oldRefreshRejected: true });
    expect(step('revoke').every((line) => line.ok && line.revokedAccessRejected)).toBe(true);
    expect(step('deny')[0]).toMatchObject({ ok: true, grants: 0 });
    expect(step('wrong-account')[0]).toMatchObject({ ok: true, error: 'wrong-account', grants: 0 });
    if (env.cimdUrl) expect(step('allow', { clientType: 'cimd' })[0]).toMatchObject({ ok: true, probe: 'ok' });

    // Server records: one grant per Allow (the Deny added none), all revoked by cleanup; B never got one.
    const grants = sql(`select coalesce(string_agg(c.registration_type || ':' || array_to_string(g.scopes, '+') || ':' || (g.revoked_at is not null), ',' order by g.created_at), '') from cadence_oauth_private.grants g join cadence_oauth_private.clients c on c.id = g.client_ref where g.user_id = '${uuid(a)}'`);
    expect(grants.split(',')).toEqual([
      'dcr:cadence.read:true', 'dcr:cadence.behaviors.write+cadence.read:true',
      'dcr:cadence.behaviors.write+cadence.occurrences.write+cadence.read:true',
      ...(env.cimdUrl ? ['cimd:cadence.read:true'] : []),
    ]);
    expect(sql(`select count(*) from cadence_oauth_private.grants where user_id = '${uuid(b)}'`)).toBe('0');
    expect(sql(`select count(*) from cadence_oauth_private.token_families where user_id = '${uuid(a)}' and revoked_at is null`)).toBe('0');
    if (env.appLog) expect(readFileSync(env.appLog, 'utf8')).not.toMatch(/[?&]code=|refresh_token=|access_token=/);
  }, 240_000);

  it('refuses at the consent page when the browser session is another account, and keeps tokens out of serialization', async () => {
    const sessions = createSessionManager({ target: 'local', supabaseUrl: env.supabaseUrl, publishableKey: env.publishableKey, store: createMemorySessionStore() });
    const browser = await launchChrome();
    try {
      for (const slot of ['A', 'B']) createdUsers.add((await sessions.enrollLocalTestLogin(slot, { browser, issuer: env.issuer, contextOptions: { ignoreHTTPSErrors: true } })).userId);
      const driver = createOAuthDriver({ target: 'local', issuer: env.issuer, sessions, browser, ignoreLocalCertificate: true });
      const client = await driver.registerDynamic();

      // The stored session passes its own check, but the browser carries B while A is expected.
      const lying = { ...sessions, current: () => sessions.current('B'), browserCookies: (_slot, origin) => sessions.browserCookies('B', origin), absorbBrowserCookies: async () => ({ rotated: false }) };
      const swapped = createOAuthDriver({ target: 'local', issuer: env.issuer, sessions: lying, browser, ignoreLocalCertificate: true });
      await expect(swapped.authorize({ slot: 'A', client, grant: 'read' })).rejects.toMatchObject({ code: 'wrong-account', details: { at: 'consent-page' } });
      expect(await driver.grantsFor('A', client.clientId)).toHaveLength(0);
      expect(await driver.grantsFor('B', client.clientId)).toHaveLength(0);

      const tokens = await driver.authorize({ slot: 'A', client, grant: 'behaviors' });
      const access = tokens.accessToken.reveal();
      const refresh = tokens.refreshToken.reveal();
      for (const text of [JSON.stringify(tokens), inspect(tokens, { depth: 5 }), String(tokens.accessToken)]) {
        expect(text).not.toContain(access);
        expect(text).not.toContain(refresh);
      }
      expect((await driver.probe(tokens)).grantedScopes?.sort()).toEqual(['cadence.behaviors.write', 'cadence.read']);
      await tokens.revoke();
      expect(await driver.revokeGrants('A', client.clientId)).toBe(1);
    } finally {
      await browser.close();
    }
  }, 240_000);
});
