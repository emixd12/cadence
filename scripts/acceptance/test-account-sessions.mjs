// Ticket 248. Supabase sign-in sessions for the two QA test accounts.
// Production keeps one session per account in the macOS Keychain so agents
// resume without a new Google sign-in. Local mode signs in through the existing
// CADENCE_ENABLE_TEST_LOGIN route and keeps sessions in memory only.
// Supabase rotates refresh tokens: every rotation is written back at once.
// Never log, print or write tokens, cookies or codes anywhere else.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { inspect } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { ACCOUNTS, googleSignIn } from '../mcp-session-broker.mjs';

export const SESSION_FORMAT = 'cadence-qa-session/1';
export const KEYCHAIN_SERVICE = 'cadence-qa-oauth-session';
export const PRODUCTION = Object.freeze({
  issuer: 'https://app.cadence-me.com',
  supabaseUrl: 'https://qjodzutjxtmtzczbloxa.supabase.co',
  accounts: Object.freeze({
    A: Object.freeze({ userId: ACCOUNTS.A, email: 'cadence.testing.is@gmail.com' }),
    B: Object.freeze({ userId: ACCOUNTS.B, email: 'brittlebeliefs@gmail.com' }),
  }),
});
const SLOTS = ['A', 'B'];
const REFRESH_MARGIN_MS = 15 * 60_000;

/** Fixed-code errors only. Messages never carry URLs, tokens or provider text. */
export class AcceptanceError extends Error {
  constructor(code, details = undefined) {
    super(code);
    this.name = 'AcceptanceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** A value that refuses to appear in logs, JSON or string interpolation. */
export class Secret {
  #value;
  constructor(value) {
    if (typeof value !== 'string' || !value) throw new AcceptanceError('secret-empty');
    this.#value = value;
  }
  reveal() { return this.#value; }
  equals(other) { return other instanceof Secret && other.reveal() === this.#value; }
  toString() { return '[redacted]'; }
  toJSON() { return '[redacted]'; }
  [inspect.custom]() { return '[redacted]'; }
}

const decodeKid = (jwt) => {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[0], 'base64url').toString('utf8')).kid ?? null; } catch { return null; }
};
const isLoopback = (value) => {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname); } catch { return false; }
};

/**
 * Session record. The first four fields are the session broker's handoff format
 * (`userId`, `accessToken`, `expiresAt`, `kid`); `refreshToken` lets the agent
 * resume after the access token expires. The Keychain keeps persistedRecord().
 */
export function recordFromSession(session, { target, slot, user }) {
  if (!session?.access_token || !session?.refresh_token || !user?.id || !Number.isFinite(session.expires_at)) {
    throw new AcceptanceError('session-invalid');
  }
  return {
    format: SESSION_FORMAT, target, slot, userId: user.id, email: user.email ?? null,
    accessToken: session.access_token, expiresAt: new Date(session.expires_at * 1000).toISOString(),
    kid: decodeKid(session.access_token), refreshToken: session.refresh_token,
  };
}

/**
 * What the Keychain keeps: only the fields needed to refresh. `security -i`
 * rejects command lines over 4,088 bytes, and a production access token alone
 * can exceed that once base64-encoded. The access token lives in memory only.
 */
export const persistedRecord = (record) => ({
  format: record.format, target: record.target, slot: record.slot, userId: record.userId, email: record.email ?? null, refreshToken: record.refreshToken,
});

/** The broker's token-free-at-rest handoff shape, for runners that already accept it. */
export const toBrokerSession = (record) => ({ userId: record.userId, accessToken: record.accessToken, expiresAt: record.expiresAt, kid: record.kid });

/** A full record, or a persisted one without the access token. */
export function validRecord(value, { target, slot }) {
  return Boolean(value && value.format === SESSION_FORMAT && value.target === target && value.slot === slot &&
    typeof value.userId === 'string' && typeof value.refreshToken === 'string' &&
    (value.accessToken === undefined || (typeof value.accessToken === 'string' && Number.isFinite(Date.parse(value.expiresAt)))));
}

export function createMemorySessionStore() {
  const items = new Map();
  return {
    kind: 'memory',
    async get(key) { return items.has(key) ? structuredClone(items.get(key)) : null; },
    async set(key, record) { items.set(key, structuredClone(record)); },
    async delete(key) { items.delete(key); },
  };
}

const runSecurity = (args, input, execImpl) => new Promise((resolve, reject) => {
  const child = execImpl('/usr/bin/security', args, { encoding: 'utf8', maxBuffer: 1 << 20, timeout: 20_000 }, (error, stdout) => {
    if (error) reject(new AcceptanceError(error.code === 44 ? 'keychain-item-missing' : 'keychain-failed', { exit: typeof error.code === 'number' ? error.code : null }));
    else resolve(stdout);
  });
  if (input !== undefined) child.stdin.end(input); else child.stdin?.end();
});

/**
 * macOS Keychain store. Writes go through `security -i` on stdin, so the value
 * never appears in a process argument list. Values are base64 JSON of
 * persistedRecord(): the access token is never stored.
 */
const SECURITY_LINE_LIMIT = 4088;
export function createKeychainSessionStore({ service = KEYCHAIN_SERVICE, execImpl = execFile } = {}) {
  if (!/^[a-z0-9-]+$/.test(service)) throw new AcceptanceError('keychain-service-invalid');
  const account = (key) => {
    if (!/^[a-z]+:[AB]$/.test(key)) throw new AcceptanceError('keychain-account-invalid');
    return key;
  };
  return {
    kind: 'keychain',
    async get(key) {
      let out;
      try { out = await runSecurity(['find-generic-password', '-s', service, '-a', account(key), '-w'], undefined, execImpl); } catch (error) {
        if (error.code === 'keychain-item-missing') return null;
        throw error;
      }
      try { return JSON.parse(Buffer.from(out.trim(), 'base64').toString('utf8')); } catch { throw new AcceptanceError('keychain-item-corrupt'); }
    },
    async set(key, record) {
      const value = Buffer.from(JSON.stringify(persistedRecord(record)), 'utf8').toString('base64');
      const line = `add-generic-password -U -s ${service} -a ${account(key)} -l "Cadence QA session ${account(key)}" -w ${value}`;
      if (Buffer.byteLength(line) > SECURITY_LINE_LIMIT) throw new AcceptanceError('keychain-record-too-large');
      await runSecurity(['-i'], `${line}\n`, execImpl);
    },
    async delete(key) {
      try { await runSecurity(['delete-generic-password', '-s', service, '-a', account(key)], undefined, execImpl); } catch (error) {
        if (error.code !== 'keychain-item-missing') throw error;
      }
    },
  };
}

/**
 * Session manager for one target. `accounts` maps slot → { userId, email }.
 * Local mode fills it at enrollment; production uses the fixed A/B identities.
 */
export function createSessionManager({ target, supabaseUrl, publishableKey, store, accounts, fetchImpl = fetch, now = () => Date.now(), refreshMarginMs = REFRESH_MARGIN_MS }) {
  if (!['local', 'production'].includes(target)) throw new AcceptanceError('target-invalid');
  if (target === 'production' && (supabaseUrl !== PRODUCTION.supabaseUrl || store?.kind !== 'keychain')) throw new AcceptanceError('production-config-invalid');
  if (target === 'local' && !isLoopback(supabaseUrl)) throw new AcceptanceError('local-supabase-not-loopback');
  if (!/^sb_publishable_/.test(publishableKey ?? '')) throw new AcceptanceError('publishable-key-required');
  const known = accounts ?? (target === 'production' ? PRODUCTION.accounts : {});
  const expected = { ...known };
  // Access tokens stay in this process: the store keeps only what refresh needs.
  const live = new Map();
  const keyFor = (slot) => {
    if (!SLOTS.includes(slot)) throw new AcceptanceError('slot-invalid');
    return `${target}:${slot}`;
  };
  const boundedFetch = (input, init = {}) => fetchImpl(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  const authClient = () => createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: boundedFetch },
  });
  /** Identity confirmed by the Auth server, never read from cookie or storage contents. */
  const verifiedUser = async (accessToken) => {
    const { data, error } = await authClient().auth.getUser(accessToken);
    if (error || !data?.user?.id) throw new AcceptanceError('session-verify-failed');
    return { id: data.user.id, email: data.user.email ?? null };
  };
  const save = async (slot, session, user) => {
    const record = recordFromSession(session, { target, slot, user });
    await store.set(keyFor(slot), record);
    live.set(slot, { accessToken: record.accessToken, expiresAt: record.expiresAt, kid: record.kid });
    return record;
  };
  const ssrClient = (jar) => createServerClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) { if (value) jar.set(name, value); else jar.delete(name); } },
    },
  });

  /** Fresh, verified record for the slot. Refuses the wrong account before any consent step. */
  const current = async (slot, { expectUserId } = {}) => {
    const want = expectUserId ?? expected[slot]?.userId;
    if (!want) throw new AcceptanceError('account-unknown');
    let record = await store.get(keyFor(slot));
    if (!record) throw new AcceptanceError('session-missing');
    if (!validRecord(record, { target, slot })) throw new AcceptanceError('session-invalid');
    if (record.userId !== want) throw new AcceptanceError('wrong-account');
    // The refresh token always comes from the store, which holds the latest rotation.
    const access = live.get(slot) ?? (record.accessToken ? { accessToken: record.accessToken, expiresAt: record.expiresAt, kid: record.kid } : null);
    if (!access || Date.parse(access.expiresAt) - now() < refreshMarginMs) {
      const { data, error } = await authClient().auth.refreshSession({ refresh_token: record.refreshToken });
      if (error || !data?.session) throw new AcceptanceError('session-refresh-failed');
      const user = await verifiedUser(data.session.access_token);
      record = await save(slot, data.session, user);
      if (user.id !== want) throw new AcceptanceError('wrong-account');
      return record;
    }
    if ((await verifiedUser(access.accessToken)).id !== want) throw new AcceptanceError('wrong-account');
    return { ...record, ...access };
  };

  /** Supabase SSR auth cookies for the app origin, in Playwright's cookie shape. */
  const browserCookies = async (slot, origin, options = {}) => {
    const record = await current(slot, options);
    const jar = new Map();
    const client = ssrClient(jar);
    const { error } = await client.auth.setSession({ access_token: record.accessToken, refresh_token: record.refreshToken });
    if (error) throw new AcceptanceError('session-cookie-failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!jar.size) throw new AcceptanceError('session-cookie-failed');
    const secure = new URL(origin).protocol === 'https:';
    return [...jar].map(([name, value]) => ({ name, value, url: origin, httpOnly: false, secure, sameSite: 'Lax' }));
  };

  /** Read the session back from browser cookies; write back a rotated refresh token. */
  const sessionFromCookies = async (cookies) => {
    const jar = new Map(cookies.filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name)).map((c) => [c.name, c.value]));
    if (!jar.size) return null;
    const { data, error } = await ssrClient(jar).auth.getSession();
    return error ? null : data?.session ?? null;
  };
  const absorbBrowserCookies = async (slot, cookies) => {
    const session = await sessionFromCookies(cookies);
    if (!session) return { rotated: false };
    const stored = await store.get(keyFor(slot));
    if (stored?.refreshToken === session.refresh_token) return { rotated: false };
    const user = await verifiedUser(session.access_token);
    if (user.id !== expected[slot]?.userId) throw new AcceptanceError('wrong-account');
    await save(slot, session, user);
    return { rotated: true };
  };

  /** Local only: sign in through /auth/test-login in a fresh browser context and keep the session in memory. */
  const enrollLocalTestLogin = async (slot, { browser, issuer, contextOptions = {} }) => {
    if (target !== 'local' || !isLoopback(issuer)) throw new AcceptanceError('test-login-local-only');
    keyFor(slot);
    const context = await browser.newContext(contextOptions);
    try {
      const page = await context.newPage();
      await page.goto(`${issuer}/auth/test-login?next=%2Fsettings`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const landed = new URL(page.url());
      const refused = landed.pathname === '/login' ? landed.searchParams.get('error') : null;
      if (refused && /^test_login_[a-z_]+$/.test(refused)) throw new AcceptanceError(refused.replaceAll('_', '-'));
      const session = await sessionFromCookies(await context.cookies(issuer));
      if (!session) throw new AcceptanceError('test-login-failed');
      const user = await verifiedUser(session.access_token);
      expected[slot] = { userId: user.id, email: user.email };
      await save(slot, session, user);
      return { slot, userId: user.id };
    } catch (error) {
      throw error instanceof AcceptanceError ? error : new AcceptanceError('test-login-failed');
    } finally {
      await context.close();
    }
  };

  /** Supabase RPC as the signed-in test account (RLS), never the service role. */
  const userRpc = async (slot, name, args = undefined) => {
    const record = await current(slot);
    const client = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: boundedFetch, headers: { Authorization: `Bearer ${record.accessToken}` } },
    });
    const { data, error } = await client.rpc(name, args);
    if (error) throw new AcceptanceError('user-rpc-failed', { rpc: name });
    return data;
  };

  return {
    target, current, browserCookies, absorbBrowserCookies, enrollLocalTestLogin, userRpc,
    account: (slot) => (expected[slot] ? { ...expected[slot] } : null),
    forget: (slot) => { live.delete(slot); return store.delete(keyFor(slot)); },
  };
}

/**
 * Production enrollment (not run before Ticket 256). Opens a loopback sign-in
 * page on a port in the hosted Auth allowlist, signs in with Google through the
 * broker's PKCE starter, refuses any account other than the slot's, and stores
 * the session in the Keychain. Prints only the local page URL and fixed results.
 */
export async function enrollProduction({ slot, port, publishableKey, store = createKeychainSessionStore(), out = (line) => process.stdout.write(`${line}\n`), timeoutMs = 10 * 60_000 }) {
  if (!SLOTS.includes(slot)) throw new AcceptanceError('slot-invalid');
  if (!Number.isInteger(port) || port < 4321 || port > 4330) throw new AcceptanceError('port-not-allowlisted');
  if (!/^sb_publishable_/.test(publishableKey ?? '')) throw new AcceptanceError('publishable-key-required');
  const origin = `http://127.0.0.1:${port}`;
  const redirectTo = `${origin}/auth/callback`;
  const memory = new Map();
  const client = createClient(PRODUCTION.supabaseUrl, publishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v); }, removeItem: (k) => { memory.delete(k); } } },
  });
  const want = PRODUCTION.accounts[slot].userId;
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });
  const server = createServer(async (req, res) => {
    const send = (status, text, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers }); res.end(text); };
    if (req.headers.host !== `127.0.0.1:${port}` || req.method !== 'GET') return send(400, 'Bad request.');
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === `/start/${slot}`) {
      const location = await googleSignIn(client, { redirectTo, supabaseUrl: PRODUCTION.supabaseUrl }).catch(() => null);
      return location ? send(303, '', { Location: location }) : send(502, 'Sign-in could not start.');
    }
    if (url.pathname !== '/auth/callback') return send(404, 'Not found.');
    const code = url.searchParams.get('code');
    let result = 'failed';
    try {
      if (!code) throw new Error('no-code');
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data?.session) throw new Error('exchange');
      const verified = await client.auth.getUser(data.session.access_token);
      const user = verified.data?.user;
      if (verified.error || !user?.id) throw new Error('verify');
      if (user.id !== want) {
        await client.auth.signOut({ scope: 'local' }).catch(() => {});
        result = 'wrong-account';
      } else {
        await store.set(`production:${slot}`, recordFromSession(data.session, { target: 'production', slot, user: { id: user.id, email: user.email ?? null } }));
        result = 'stored';
      }
    } catch { result = 'failed'; }
    send(200, result === 'stored' ? `Signed in as ${slot}: stored.` : `Sign-in ${result}.`);
    settle(result);
  });
  await new Promise((resolve, reject) => { server.once('error', () => reject(new AcceptanceError('port-unavailable'))); server.listen(port, '127.0.0.1', resolve); });
  out(`open ${origin}/start/${slot}`);
  const timer = setTimeout(() => settle('timeout'), timeoutMs);
  const result = await finished;
  clearTimeout(timer);
  await new Promise((resolve) => server.close(resolve));
  out(`enroll ${slot} ${result}`);
  if (result !== 'stored') throw new AcceptanceError(`enroll-${result}`);
  return { slot, userId: want };
}
