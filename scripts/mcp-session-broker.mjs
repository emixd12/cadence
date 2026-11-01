// Ticket 232 QA session broker. A loopback sign-in page for the two dedicated
// test accounts. It uses Cadence's ordinary Supabase Google OAuth with PKCE and
// the publishable key only. Sessions stay in this process. A private 0600 Unix
// socket hands access tokens to local runner processes owned by the same user.
// Never log URLs, query strings, codes or tokens.
import { createServer } from 'node:http';
import { createServer as createNetServer, connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, linkSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

export const ACCOUNTS = Object.freeze({ A: 'caefd1b8-ea46-485f-8869-119a715fb092', B: 'c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b' });
export const PORT_PREFERENCE = Object.freeze([4321, 4322, 4323, 4324, 4325, 4326, 4327, 4328, 4329, 4330]);
const COOKIE = 'cadence_qa_attempt';
const RESULTS = Object.freeze({
  'A-match': 'signed in as A: match',
  'B-match': 'signed in as B: match',
  discarded: 'wrong account: discarded',
  'cleanup-failed': 'wrong account: sign-out pending, tell the operator',
  failed: 'sign-in failed: try again',
});

/** Production start: ordinary Google OAuth with PKCE. Returns the provider URL or null. */
export async function googleSignIn(client, { redirectTo, supabaseUrl }) {
  const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
  return !error && data?.url && String(data.url).startsWith(`${supabaseUrl}/auth/v1/authorize?`) ? data.url : null;
}

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cadence QA sign-in</title></head><body>${body}</body></html>`;
const decodeKid = (jwt) => {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[0], 'base64url').toString('utf8')).kid ?? null; } catch { return null; }
};
const memoryStorage = () => {
  const items = new Map();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => { items.set(k, v); }, removeItem: (k) => { items.delete(k); }, clear: () => items.clear() };
};

/**
 * @param {object} options
 * @param {string} options.supabaseUrl hosted project origin
 * @param {string} options.publishableKey publishable key only
 * @param {number} options.port loopback port already present in the hosted allowlist
 * @param {string} options.socketPath private handoff socket path
 * @param {string} [options.receiptPath] token-free JSON-lines receipt
 */
export function createSessionBroker({
  supabaseUrl, publishableKey, port, socketPath, receiptPath,
  accounts = ACCOUNTS, fetchImpl = fetch, now = () => Date.now(), log = () => {},
  attemptTtlMs = 5 * 60_000, refreshMarginMs = 15 * 60_000, minHandoffMs = 10 * 60_000,
  pinMinMs = 30 * 60_000, requestTimeoutMs = 15_000, maxPendingAttempts = 4,
  maxLifetimeMs = 5 * 60 * 60_000, refreshIntervalMs = 30_000, beginSignIn = googleSignIn,
  maxPendingCleanup = 8, teardownRetries = 3, retryDelayMs = 1_000,
}) {
  if (!/^sb_publishable_/.test(publishableKey ?? '')) throw new Error('publishable-key-required');
  if (!Number.isInteger(port)) throw new Error('port-required');
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const redirectTo = `${origin}/auth/callback`;
  const attempts = new Map();
  const slots = new Map();
  const pinned = new Map();
  const inflight = new Set();
  const cleanup = new Set();
  const clientState = new WeakMap();
  let reserved = 0;
  let httpServer = null, socketServer = null, timer = null, lifetime = null, closed = false, pinState = 'none', ownSocket = null;
  const track = (promise) => { inflight.add(promise); promise.finally(() => inflight.delete(promise)).catch(() => {}); return promise; };

  const receipt = (event, extra = {}) => {
    if (!receiptPath) return;
    appendFileSync(receiptPath, `${JSON.stringify({ at: new Date(now()).toISOString(), event, ...extra })}\n`, { mode: 0o600 });
  };
  const boundedFetch = (input, init = {}) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
  const newClient = () => {
    const storage = memoryStorage();
    const client = createClient(supabaseUrl, publishableKey, {
      auth: { flowType: 'pkce', storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: boundedFetch },
    });
    clientState.set(client, { storage, signedOut: false });
    return client;
  };
  const describe = (slot) => {
    const s = slots.get(slot);
    return s ? { userId: s.userId, expiresAt: new Date(s.expiresAt).toISOString(), kid: s.kid, state: s.state } : null;
  };
  const status = () => ({
    slots: { A: describe('A'), B: describe('B') },
    pinState,
    cleanupPending: cleanup.size,
    pinned: Object.fromEntries(['A', 'B'].map((slot) => [slot, pinned.has(slot) ? { expiresAt: new Date(pinned.get(slot).expiresAt).toISOString(), kid: pinned.get(slot).kid } : null])),
  });
  const store = (slot, client, session, userId) => {
    slots.set(slot, { client, userId, accessToken: session.access_token, expiresAt: session.expires_at * 1000, kid: decodeKid(session.access_token), state: 'ok' });
  };
  // Returns true only when the provider confirmed the local-scope sign-out.
  // auth.signOut removes local state even when logout fails. Revoke by token so
  // failed calls remain retryable, then erase our in-memory storage on success.
  const signOutLocal = async (client) => {
    try {
      const state = clientState.get(client);
      if (state.signedOut) return true;
      const loaded = await client.auth.getSession();
      if (loaded.error || !loaded.data?.session) return false;
      const { error } = await client.auth.admin.signOut(loaded.data.session.access_token, 'local');
      if (error) return false;
      state.storage.clear();
      state.signedOut = true;
      return true;
    } catch { return false; }
  };
  const discard = async (client) => {
    if (await signOutLocal(client)) return true;
    cleanup.add(client);
    log('cleanup-failed');
    receipt('cleanup-failed', { cleanupPending: cleanup.size });
    return false;
  };
  const retryCleanup = async () => {
    for (const client of [...cleanup]) {
      if (await signOutLocal(client) && cleanup.delete(client)) { log('cleanup-retried'); receipt('cleanup-retried', { cleanupPending: cleanup.size }); }
    }
  };

  const reply = (res, code, body, headers = {}) => {
    res.writeHead(code, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'", ...headers,
    });
    res.end(body);
  };
  const done = (res, result, clearCookie = true) => reply(res, 303, '', {
    Location: `/done/${result}`, ...(clearCookie ? { 'Set-Cookie': `${COOKIE}=; Path=/auth/callback; HttpOnly; SameSite=Lax; Max-Age=0` } : {}),
  });
  const purgeExpired = () => { for (const [nonce, a] of attempts) if (now() - a.createdAt > attemptTtlMs) attempts.delete(nonce); };

  const startAttempt = async (slot, res) => {
    purgeExpired();
    if (cleanup.size >= maxPendingCleanup) return reply(res, 503, page('<p>Sign-out cleanup pending. Tell the operator.</p>'));
    if (attempts.size + reserved >= maxPendingAttempts) return reply(res, 429, page('<p>Too many pending sign-ins. Wait five minutes.</p>'));
    reserved += 1;
    const nonce = randomBytes(32).toString('base64url');
    const client = newClient();
    let location = null;
    try { location = await beginSignIn(client, { redirectTo, supabaseUrl, slot }); } catch { location = null; } finally { reserved -= 1; }
    if (closed) return reply(res, 503, page('<p>Closing.</p>'));
    if (!location) {
      log(`attempt-failed ${slot}`);
      return reply(res, 502, page('<p>Sign-in could not start.</p>'));
    }
    attempts.set(nonce, { slot, client, createdAt: now() });
    log(`attempt-started ${slot}`);
    reply(res, 303, '', { Location: location, 'Set-Cookie': `${COOKIE}=${nonce}; Path=/auth/callback; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(attemptTtlMs / 1000)}` });
  };

  const callback = async (req, url, res) => {
    const nonce = (String(req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`)) ?? '').slice(COOKIE.length + 1);
    const attempt = nonce ? attempts.get(nonce) : undefined;
    if (nonce) attempts.delete(nonce);
    if (!attempt || now() - attempt.createdAt > attemptTtlMs) { log('callback-rejected'); return done(res, 'failed'); }
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) { log(`callback-failed ${attempt.slot}`); return done(res, 'failed'); }
    let session = null, userId = null;
    try {
      const exchanged = await attempt.client.auth.exchangeCodeForSession(code);
      session = exchanged.data?.session ?? null;
      if (exchanged.error || !session) throw new Error('exchange');
      const verified = await attempt.client.auth.getUser(session.access_token);
      userId = verified.data?.user?.id ?? null;
      if (verified.error || !userId) throw new Error('verify');
    } catch {
      if (session) await discard(attempt.client);
      log(`exchange-failed ${attempt.slot}`);
      return done(res, 'failed');
    }
    if (userId !== accounts[attempt.slot]) {
      if (!(await discard(attempt.client))) return done(res, 'cleanup-failed');
      log(`discarded ${attempt.slot}`);
      receipt('discarded', { slot: attempt.slot });
      return done(res, 'discarded');
    }
    if (closed) { await discard(attempt.client); log(`closing-discarded ${attempt.slot}`); return done(res, 'failed'); }
    // Publish the replacement before awaiting cleanup, so another callback
    // retires this session instead of overwriting it after the same old one.
    const previous = slots.get(attempt.slot);
    if (pinState === 'pinned') { pinned.clear(); pinState = 'invalidated'; receipt('pin-invalidated', { slot: attempt.slot }); }
    store(attempt.slot, attempt.client, session, userId);
    if (previous) await discard(previous.client);
    if (closed) return done(res, 'failed');
    log(`match ${attempt.slot}`);
    receipt('signed-in', { slot: attempt.slot, ...describe(attempt.slot) });
    return done(res, `${attempt.slot}-match`);
  };

  const handle = async (req, res) => {
    if (closed) return reply(res, 503, page('<p>Closing.</p>'));
    if (req.headers.host !== host) return reply(res, 421, page('<p>Wrong host.</p>'));
    if (req.method !== 'GET') return reply(res, 405, page('<p>Method not allowed.</p>'), { Allow: 'GET' });
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === '/') return reply(res, 200, page('<h1>Cadence QA sign-in</h1><p><a href="/start/A">Sign in test account A</a></p><p><a href="/start/B">Sign in test account B</a></p>'));
    if (url.pathname === '/start/A' || url.pathname === '/start/B') return startAttempt(url.pathname.slice(-1), res);
    if (url.pathname === '/auth/callback') return callback(req, url, res);
    const result = url.pathname.startsWith('/done/') ? RESULTS[url.pathname.slice(6)] : undefined;
    if (result) return reply(res, 200, page(`<p>${result}</p>`));
    return reply(res, 404, page('<p>Not found.</p>'));
  };

  const refresh = async (slot, force = false) => {
    const s = slots.get(slot);
    if (!s) return false;
    if (!force && s.expiresAt - now() > refreshMarginMs) return true;
    try {
      const { data, error } = await s.client.auth.refreshSession();
      if (error || !data?.session) throw new Error('refresh');
      if (slots.get(slot) !== s) return false;
      store(slot, s.client, data.session, s.userId);
      log(`refreshed ${slot}`);
      receipt('refreshed', { slot, ...describe(slot) });
      return true;
    } catch {
      s.state = 'refresh-failed';
      log(`refresh-failed ${slot}`);
      receipt('refresh-failed', { slot, expiresAt: new Date(s.expiresAt).toISOString(), kid: s.kid });
      return false;
    }
  };
  const tick = async () => { for (const slot of ['A', 'B']) await refresh(slot); await retryCleanup(); purgeExpired(); };

  const tokensFor = (source, minMs) => {
    const out = {};
    for (const slot of ['A', 'B']) {
      const s = source.get(slot);
      if (!s || s.expiresAt - now() < minMs) return null;
      out[slot] = { userId: s.userId ?? accounts[slot], accessToken: s.accessToken, expiresAt: new Date(s.expiresAt).toISOString(), kid: s.kid };
    }
    return out;
  };
  const command = async (request) => {
    if (closed) return { ok: false, error: 'closing' };
    switch (request?.command) {
      case 'status': return { ok: true, ...status() };
      case 'sessions': { const sessions = tokensFor(slots, minHandoffMs); return sessions ? { ok: true, sessions } : { ok: false, error: 'session-unavailable', ...status() }; }
      case 'refresh': {
        const which = request.slot === 'A' || request.slot === 'B' ? [request.slot] : ['A', 'B'];
        const results = [];
        for (const slot of which) results.push(await refresh(slot, true));
        return { ok: results.every(Boolean), ...status() };
      }
      case 'pin': {
        if (pinState !== 'none') return { ok: false, error: `pin-${pinState}`, ...status() };
        pinState = 'pinning';
        const refreshed = [await refresh('A', true), await refresh('B', true)];
        const current = refreshed.every(Boolean) && !closed ? tokensFor(slots, pinMinMs) : null;
        if (!current) { pinState = 'none'; return { ok: false, error: refreshed.every(Boolean) ? 'pin-validity' : 'pin-refresh-failed', ...status() }; }
        for (const slot of ['A', 'B']) pinned.set(slot, { userId: current[slot].userId, accessToken: current[slot].accessToken, expiresAt: Date.parse(current[slot].expiresAt), kid: current[slot].kid });
        pinState = 'pinned';
        receipt('pinned', status().pinned);
        return { ok: true, ...status() };
      }
      case 'pinned': { const sessions = pinState === 'pinned' ? tokensFor(pinned, 0) : null; return sessions ? { ok: true, sessions } : { ok: false, error: 'pin-unavailable', ...status() }; }
      case 'teardown': { setImmediate(() => { teardown('requested'); }); return { ok: true }; }
      default: return { ok: false, error: 'unknown-command' };
    }
  };

  const listenSocket = () => new Promise((resolve, reject) => {
    const dir = dirname(socketPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const info = lstatSync(dir);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) return reject(new Error('socket-directory-not-private'));
    const listen = () => {
    socketServer = createNetServer((conn) => {
      let buffer = '';
      conn.setTimeout(5_000, () => conn.destroy());
      conn.on('data', async (chunk) => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 1024) return conn.destroy();
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        let response;
        try { response = await track(command(JSON.parse(buffer.slice(0, end)))); } catch { response = { ok: false, error: 'bad-request' }; }
        conn.end(`${JSON.stringify(response)}\n`);
      });
      conn.on('error', () => {});
    });
    socketServer.once('error', reject);
    // Bind a private name, then hard-link it into place: link() never replaces an
    // existing path, and Node's close-time unlink only removes the private name.
    const bound = `${dirname(socketPath)}/.bind-${randomBytes(8).toString('hex')}.sock`;
    socketServer.listen(bound, () => {
      try {
        chmodSync(bound, 0o600);
        linkSync(bound, socketPath);
        unlinkSync(bound);
      } catch {
        try { unlinkSync(bound); } catch { /* already gone */ }
        socketServer.close();
        return reject(new Error('socket-in-use'));
      }
      const mine = lstatSync(socketPath);
      ownSocket = { dev: mine.dev, ino: mine.ino };
      resolve();
    });
    };
    if (!existsSync(socketPath)) return listen();
    const existing = lstatSync(socketPath);
    if (!existing.isSocket() || existing.uid !== process.getuid()) return reject(new Error('socket-path-occupied'));
    const probe = connect(socketPath);
    probe.setTimeout(1_000, () => { probe.destroy(); reject(new Error('socket-in-use')); });
    probe.on('connect', () => { probe.destroy(); reject(new Error('socket-in-use')); });
    probe.on('error', (error) => {
      if (error.code !== 'ECONNREFUSED') return reject(new Error('socket-in-use'));
      const again = lstatSync(socketPath);
      if (again.dev !== existing.dev || again.ino !== existing.ino) return reject(new Error('socket-in-use'));
      unlinkSync(socketPath);
      listen();
    });
  });

  const start = async () => {
    await listenSocket();
    httpServer = createServer((req, res) => { track(handle(req, res)).catch(() => { if (!res.headersSent) reply(res, 500, page('<p>Error.</p>')); }); });
    httpServer.headersTimeout = 5_000;
    httpServer.requestTimeout = 10_000;
    httpServer.keepAliveTimeout = 1_000;
    httpServer.on('clientError', (_, socket) => socket.destroy());
    await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(port, '127.0.0.1', resolve); });
    timer = setInterval(() => { if (!closed) track(tick()).catch(() => {}); }, refreshIntervalMs);
    lifetime = setTimeout(() => { teardown('lifetime'); }, maxLifetimeMs);
    timer.unref?.(); lifetime.unref?.();
    receipt('started', { port });
    log(`listening ${port}`);
    return { origin };
  };

  // Every caller receives the same teardown promise and result.
  let teardownPromise = null;
  const teardown = (reason = 'requested') => {
    teardownPromise ??= runTeardown(reason);
    return teardownPromise;
  };
  const runTeardown = async (reason) => {
    closed = true;
    clearInterval(timer); clearTimeout(lifetime);
    const closing = Promise.all([
      new Promise((resolve) => (httpServer?.listening ? httpServer.close(() => resolve()) : resolve())),
      new Promise((resolve) => (socketServer?.listening ? socketServer.close(() => resolve()) : resolve())),
    ]);
    httpServer?.closeIdleConnections?.();
    while (inflight.size) await Promise.allSettled([...inflight]);
    for (const slot of ['A', 'B']) { const s = slots.get(slot); if (s) await discard(s.client); }
    attempts.clear();
    for (let i = 0; i < teardownRetries && cleanup.size; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      await retryCleanup();
    }
    const unconfirmed = cleanup.size;
    slots.clear(); pinned.clear(); cleanup.clear(); pinState = 'closed';
    httpServer?.closeAllConnections?.();
    await closing;
    if (ownSocket && existsSync(socketPath)) {
      const current = lstatSync(socketPath);
      if (current.dev === ownSocket.dev && current.ino === ownSocket.ino) unlinkSync(socketPath);
    }
    receipt('teardown', { reason, unconfirmedSignOuts: unconfirmed });
    log(unconfirmed ? `teardown ${reason} unconfirmed-sign-outs ${unconfirmed}` : `teardown ${reason}`);
    return { unconfirmedSignOuts: unconfirmed };
  };

  return { start, teardown, command, tick, status, origin, redirectTo };
}

/** Request one command from the broker over its private socket. */
export function brokerRequest(socketPath, request, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const conn = connect(socketPath);
    let buffer = '';
    conn.setTimeout(timeoutMs, () => { conn.destroy(); reject(new Error('broker-timeout')); });
    conn.on('connect', () => conn.write(`${JSON.stringify(request)}\n`));
    conn.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
    conn.on('end', () => { try { resolve(JSON.parse(buffer)); } catch { reject(new Error('broker-bad-response')); } });
    conn.on('error', () => reject(new Error('broker-unavailable')));
  });
}

/** Pick the first preferred port that the allowlist permits exactly and nothing uses. */
export async function choosePort(allowList, isFree, preference = PORT_PREFERENCE) {
  for (const port of preference) {
    if (allowList.includes(`http://127.0.0.1:${port}/auth/callback`) && await isFree(port)) return port;
  }
  throw new Error('no-allowed-free-port');
}

export function portIsFree(port) {
  const probe = (address) => new Promise((resolve) => {
    const conn = connect({ host: address, port });
    conn.setTimeout(1_000, () => { conn.destroy(); resolve(false); });
    conn.on('connect', () => { conn.destroy(); resolve(true); });
    conn.on('error', () => resolve(false));
  });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then(([v4, v6]) => !v4 && !v6);
}

const PROJECT_REF = 'qjodzutjxtmtzczbloxa';

async function managementRead(path) {
  const { execFileSync } = await import('node:child_process');
  let token = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (token.startsWith('go-keyring-base64:')) token = Buffer.from(token.slice(18), 'base64').toString('utf8').trim();
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  token = '';
  if (response.status !== 200) throw new Error(`management-read-${response.status}`);
  return response.json();
}

async function main() {
  const { homedir } = await import('node:os');
  const socketPath = `${homedir()}/.cadence-qa232/broker.sock`;
  const receiptPath = '.intent/artifacts/trust232/extension-execution/session-broker.jsonl';
  const auth = await managementRead('/config/auth');
  const allowList = String(auth.uri_allow_list ?? '').split(',').map((entry) => entry.trim());
  if (auth.site_url !== 'https://app.cadence-me.com' || auth.external_google_enabled !== true) throw new Error('auth-config-mismatch');
  const keys = await managementRead('/api-keys?reveal=false');
  const publishable = keys.filter((key) => key.type === 'publishable');
  if (publishable.length !== 1) throw new Error('publishable-key-ambiguous');
  const port = await choosePort(allowList, portIsFree);
  const broker = createSessionBroker({
    supabaseUrl: `https://${PROJECT_REF}.supabase.co`, publishableKey: publishable[0].api_key, port, socketPath, receiptPath,
    log: (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`),
  });
  const stop = (signal) => { broker.teardown(signal).finally(() => process.exit(0)); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  const { origin } = await broker.start();
  process.stdout.write(`open ${origin}/\n`);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stdout.write(`broker-stopped ${/^[a-z0-9-]+$/.test(error?.message ?? '') ? error.message : 'error'}\n`); process.exit(1); });
}
