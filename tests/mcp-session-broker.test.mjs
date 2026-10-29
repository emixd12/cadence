import { describe, expect, it, afterEach } from 'vitest';
import { request } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createSessionBroker, brokerRequest, choosePort, googleSignIn, ACCOUNTS } from '../scripts/mcp-session-broker.mjs';

const SUPABASE = 'https://project.example.test';
const KEY = 'sb_publishable_testkey';
const OTHER = '11111111-2222-4333-8444-555555555555';
let nextPort = 56121;
const cleanups = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()(); });

function fakeAuth() {
  const codes = new Map(), access = new Map(), refresh = new Map();
  const logouts = [], requests = [];
  let kid = 'kid-old', refreshFails = false;
  const jwt = (userId) => `${Buffer.from(JSON.stringify({ alg: 'ES256', kid })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, n: randomBytes(6).toString('hex') })).toString('base64url')}.sig`;
  const issue = (userId) => {
    const token = jwt(userId), rt = randomBytes(12).toString('hex');
    access.set(token, userId); refresh.set(rt, userId);
    return { access_token: token, refresh_token: rt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: userId, aud: 'authenticated' } };
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push(url.pathname);
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const entry = codes.get(body.auth_code);
      codes.delete(body.auth_code);
      const challenge = createHash('sha256').update(body.code_verifier ?? '').digest('base64url');
      if (!entry || entry.challenge !== challenge) return json(400, { code: 'bad_code', message: 'invalid flow state' });
      return json(200, issue(entry.userId));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const userId = refresh.get(body.refresh_token);
      refresh.delete(body.refresh_token);
      if (!userId || refreshFails) return json(400, { code: 'refresh_token_not_found', message: 'invalid' });
      return json(200, issue(userId));
    }
    if (url.pathname === '/auth/v1/user') {
      const userId = access.get((headers.get('authorization') ?? '').replace('Bearer ', ''));
      return userId ? json(200, { id: userId, aud: 'authenticated' }) : json(401, { code: 'bad_jwt', message: 'invalid' });
    }
    if (url.pathname === '/auth/v1/logout') {
      logouts.push({ scope: url.searchParams.get('scope'), userId: access.get((headers.get('authorization') ?? '').replace('Bearer ', '')) });
      return new Response(null, { status: 204 });
    }
    return json(404, { message: 'not found' });
  };
  return {
    fetchImpl, logouts, requests, codes, access,
    authorize: (location, userId) => {
      const challenge = new URL(location).searchParams.get('code_challenge');
      const code = randomBytes(10).toString('hex');
      codes.set(code, { challenge, userId });
      return code;
    },
    rotate: () => { kid = 'kid-new'; },
    failRefresh: () => { refreshFails = true; },
  };
}

function get(port, path, { host = `127.0.0.1:${port}`, cookie, method = 'GET', address = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: address, port, path, method, headers: { host, ...(cookie ? { cookie } : {}) } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function setup(overrides = {}) {
  const port = nextPort++;
  const dir = mkdtempSync(join(tmpdir(), 'qa232-'));
  const socketPath = join(dir, 'b.sock');
  const receiptPath = join(dir, 'receipt.jsonl');
  const auth = fakeAuth();
  const lines = [];
  let clock = Date.now();
  const broker = createSessionBroker({
    supabaseUrl: SUPABASE, publishableKey: KEY, port, socketPath, receiptPath, fetchImpl: auth.fetchImpl,
    now: () => clock, log: (line) => lines.push(line), refreshIntervalMs: 3_600_000, ...overrides,
  });
  await broker.start();
  cleanups.push(async () => { await broker.teardown('test'); rmSync(dir, { recursive: true, force: true }); });
  const signIn = async (slot, userId) => {
    const start = await get(port, `/start/${slot}`);
    const cookie = start.headers['set-cookie'][0].split(';')[0];
    const code = auth.authorize(start.headers.location, userId);
    const cb = await get(port, `/auth/callback?code=${code}`, { cookie });
    return { start, cookie, code, cb };
  };
  return { port, dir, socketPath, receiptPath, auth, lines, broker, signIn, advance: (ms) => { clock += ms; } };
}

describe('Ticket 232 QA session broker', () => {
  it('binds loopback only and rejects wrong hosts and methods', async () => {
    const t = await setup();
    expect((await get(t.port, '/')).status).toBe(200);
    expect((await get(t.port, '/', { host: `localhost:${t.port}` })).status).toBe(421);
    expect((await get(t.port, '/', { host: 'attacker.example' })).status).toBe(421);
    expect((await get(t.port, '/', { method: 'POST' })).status).toBe(405);
    await expect(get(t.port, '/', { address: '::1', host: `127.0.0.1:${t.port}` })).rejects.toThrow();
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) await expect(get(t.port, '/', { address: lan.address, host: `127.0.0.1:${t.port}` })).rejects.toThrow();
    const home = await get(t.port, '/');
    expect(home.headers['cache-control']).toBe('no-store');
    expect(home.headers['referrer-policy']).toBe('no-referrer');
    expect(home.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('starts ordinary Google PKCE with the exact allowlisted callback', async () => {
    const t = await setup();
    const start = await get(t.port, '/start/A');
    expect(start.status).toBe(303);
    const location = new URL(start.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(`${SUPABASE}/auth/v1/authorize`);
    expect(location.searchParams.get('provider')).toBe('google');
    expect(location.searchParams.get('redirect_to')).toBe(`http://127.0.0.1:${t.port}/auth/callback`);
    expect(location.searchParams.get('code_challenge_method')).toBe('s256');
    expect(location.searchParams.get('prompt')).toBe('select_account');
    expect(location.searchParams.has('skip_http_redirect')).toBe(false);
    expect(start.headers['set-cookie'][0]).toMatch(/HttpOnly; SameSite=Lax; Max-Age=300$/);
  });

  it('accepts the matching account and hands sessions only over the private socket', async () => {
    const t = await setup();
    const a = await t.signIn('A', ACCOUNTS.A);
    expect(a.cb.status).toBe(303);
    expect(a.cb.headers.location).toBe('/done/A-match');
    expect((await get(t.port, '/done/A-match')).body).toContain('signed in as A: match');
    expect(await brokerRequest(t.socketPath, { command: 'sessions' })).toMatchObject({ ok: false, error: 'session-unavailable' });
    await t.signIn('B', ACCOUNTS.B);
    const handoff = await brokerRequest(t.socketPath, { command: 'sessions' });
    expect(handoff.ok).toBe(true);
    expect(handoff.sessions.A.userId).toBe(ACCOUNTS.A);
    expect(handoff.sessions.B.userId).toBe(ACCOUNTS.B);
    expect(t.auth.access.get(handoff.sessions.A.accessToken)).toBe(ACCOUNTS.A);
    expect(handoff.sessions.A.kid).toBe('kid-old');
    expect(statSync(t.socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(t.dir).mode & 0o777).toBe(0o700);
  });

  it('discards and locally signs out any other account, including the other test account', async () => {
    const t = await setup();
    const wrong = await t.signIn('A', OTHER);
    expect(wrong.cb.headers.location).toBe('/done/discarded');
    expect((await get(t.port, '/done/discarded')).body).toContain('wrong account: discarded');
    const swapped = await t.signIn('A', ACCOUNTS.B);
    expect(swapped.cb.headers.location).toBe('/done/discarded');
    expect(t.auth.logouts).toEqual([{ scope: 'local', userId: OTHER }, { scope: 'local', userId: ACCOUNTS.B }]);
    expect((await brokerRequest(t.socketPath, { command: 'status' })).slots).toEqual({ A: null, B: null });
  });

  it('requires a live single-use attempt bound to its own cookie and verifier', async () => {
    const t = await setup();
    expect((await get(t.port, '/auth/callback?code=x')).headers.location).toBe('/done/failed');
    expect((await get(t.port, '/auth/callback?code=x', { cookie: 'cadence_qa_attempt=forged' })).headers.location).toBe('/done/failed');
    const first = await get(t.port, '/start/A');
    const second = await get(t.port, '/start/A');
    const crossCode = t.auth.authorize(first.headers.location, ACCOUNTS.A);
    const crossed = await get(t.port, `/auth/callback?code=${crossCode}`, { cookie: second.headers['set-cookie'][0].split(';')[0] });
    expect(crossed.headers.location).toBe('/done/failed');
    const consumed = await get(t.port, `/auth/callback?code=${t.auth.authorize(second.headers.location, ACCOUNTS.A)}`, { cookie: second.headers['set-cookie'][0].split(';')[0] });
    expect(consumed.headers.location).toBe('/done/failed');
    const ok = await t.signIn('A', ACCOUNTS.A);
    expect(ok.cb.headers.location).toBe('/done/A-match');
    const replay = await get(t.port, `/auth/callback?code=${ok.code}`, { cookie: ok.cookie });
    expect(replay.headers.location).toBe('/done/failed');
    const late = await get(t.port, '/start/B');
    t.advance(5 * 60_000 + 1);
    const lateCode = t.auth.authorize(late.headers.location, ACCOUNTS.B);
    expect((await get(t.port, `/auth/callback?code=${lateCode}`, { cookie: late.headers['set-cookie'][0].split(';')[0] })).headers.location).toBe('/done/failed');
    expect((await get(t.port, '/auth/callback?error=access_denied', { cookie: (await get(t.port, '/start/B')).headers['set-cookie'][0].split(';')[0] })).headers.location).toBe('/done/failed');
  });

  it('caps pending attempts', async () => {
    const t = await setup();
    for (let i = 0; i < 4; i += 1) expect((await get(t.port, '/start/A')).status).toBe(303);
    expect((await get(t.port, '/start/A')).status).toBe(429);
  });

  it('releases each attempt after its one callback', async () => {
    const t = await setup();
    for (let i = 0; i < 6; i += 1) {
      const start = await get(t.port, '/start/A');
      expect(start.status).toBe(303);
      const cookie = start.headers['set-cookie'][0].split(';')[0];
      expect((await get(t.port, '/auth/callback?error=access_denied', { cookie })).headers.location).toBe('/done/failed');
    }
  });

  it('never logs or records URLs, codes, cookies or tokens', async () => {
    const t = await setup();
    const a = await t.signIn('A', ACCOUNTS.A);
    await t.signIn('B', ACCOUNTS.B);
    await t.signIn('A', OTHER);
    const handoff = await brokerRequest(t.socketPath, { command: 'sessions' });
    await brokerRequest(t.socketPath, { command: 'refresh' });
    const recorded = `${t.lines.join('\n')}\n${readFileSync(t.receiptPath, 'utf8')}`;
    for (const secret of [a.code, a.cookie.split('=')[1], handoff.sessions.A.accessToken, handoff.sessions.B.accessToken, 'code=', 'code_challenge', 'redirect_to', 'refresh_token', SUPABASE]) {
      expect(recorded).not.toContain(secret);
    }
    for (const line of t.lines) expect(line).toMatch(/^(listening \d+|attempt-started [AB]|match [AB]|discarded [AB]|refreshed [AB])$/);
    expect(statSync(t.receiptPath).mode & 0o777).toBe(0o600);
  });

  it('refreshes before expiry and records only expiry and kid', async () => {
    const t = await setup();
    await t.signIn('A', ACCOUNTS.A);
    await t.signIn('B', ACCOUNTS.B);
    const before = (await brokerRequest(t.socketPath, { command: 'sessions' })).sessions;
    await t.broker.tick();
    expect((await brokerRequest(t.socketPath, { command: 'sessions' })).sessions.A.accessToken).toBe(before.A.accessToken);
    t.advance(46 * 60_000);
    t.auth.rotate();
    await t.broker.tick();
    const after = (await brokerRequest(t.socketPath, { command: 'sessions' })).sessions;
    expect(after.A.accessToken).not.toBe(before.A.accessToken);
    expect(after.A.kid).toBe('kid-new');
    const events = readFileSync(t.receiptPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const refreshed = events.filter((e) => e.event === 'refreshed');
    expect(refreshed.map((e) => e.slot).sort()).toEqual(['A', 'B']);
    for (const e of refreshed) expect(Object.keys(e).sort()).toEqual(['at', 'event', 'expiresAt', 'kid', 'slot', 'state', 'userId']);
    t.auth.failRefresh();
    expect((await brokerRequest(t.socketPath, { command: 'refresh', slot: 'A' })).ok).toBe(false);
    expect((await brokerRequest(t.socketPath, { command: 'status' })).slots.A.state).toBe('refresh-failed');
  });

  it('keeps a pinned pre-rotation token unchanged while live sessions move to the new kid', async () => {
    const t = await setup();
    await t.signIn('A', ACCOUNTS.A);
    await t.signIn('B', ACCOUNTS.B);
    expect((await brokerRequest(t.socketPath, { command: 'pinned' })).ok).toBe(false);
    expect((await brokerRequest(t.socketPath, { command: 'pin' })).ok).toBe(true);
    const pinned = (await brokerRequest(t.socketPath, { command: 'pinned' })).sessions;
    expect(pinned.A.kid).toBe('kid-old');
    t.auth.rotate();
    await brokerRequest(t.socketPath, { command: 'refresh' });
    const live = (await brokerRequest(t.socketPath, { command: 'sessions' })).sessions;
    const again = (await brokerRequest(t.socketPath, { command: 'pinned' })).sessions;
    expect(live.A.kid).toBe('kid-new');
    expect(again.A.accessToken).toBe(pinned.A.accessToken);
    expect(again.A.kid).toBe('kid-old');
    expect(t.auth.access.get(again.A.accessToken)).toBe(ACCOUNTS.A);
  });

  it('tears down with local sign-out of both sessions and removes the socket', async () => {
    const t = await setup();
    await t.signIn('A', ACCOUNTS.A);
    await t.signIn('B', ACCOUNTS.B);
    await t.broker.teardown('test');
    expect(t.auth.logouts.map((l) => l.scope)).toEqual(['local', 'local']);
    expect(t.auth.logouts.map((l) => l.userId).sort()).toEqual([ACCOUNTS.A, ACCOUNTS.B].sort());
    expect(existsSync(t.socketPath)).toBe(false);
    expect(t.broker.status().slots).toEqual({ A: null, B: null });
    await expect(brokerRequest(t.socketPath, { command: 'status' })).rejects.toThrow('broker-unavailable');
    await expect(get(t.port, '/')).rejects.toThrow();
  });

  it('refuses a shared socket directory and non-publishable keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa232-'));
    const shared = join(dir, 'shared');
    mkdirSync(shared); chmodSync(shared, 0o755);
    const broker = createSessionBroker({ supabaseUrl: SUPABASE, publishableKey: KEY, port: nextPort++, socketPath: join(shared, 'b.sock') });
    await expect(broker.start()).rejects.toThrow('socket-directory-not-private');
    expect(() => createSessionBroker({ supabaseUrl: SUPABASE, publishableKey: 'sb_secret_x', port: 1, socketPath: join(dir, 's') })).toThrow('publishable-key-required');
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a provider start URL outside the project authorize endpoint', async () => {
    const stub = (url) => ({ auth: { signInWithOAuth: async () => ({ data: { url }, error: null }) } });
    const opts = { redirectTo: 'http://127.0.0.1:4327/auth/callback', supabaseUrl: SUPABASE };
    expect(await googleSignIn(stub('https://attacker.example/auth/v1/authorize?x=1'), opts)).toBeNull();
    expect(await googleSignIn(stub(`${SUPABASE}/auth/v1/authorize?x=1`), opts)).toBe(`${SUPABASE}/auth/v1/authorize?x=1`);
  });

  it('chooses only an exactly allowlisted free loopback port', async () => {
    const allow = ['http://127.0.0.1:4327/auth/callback', 'http://127.0.0.1:4328/auth/callback?next=**', 'http://127.0.0.1:4329/auth/callback'];
    expect(await choosePort(allow, async (p) => p !== 4327)).toBe(4329);
    await expect(choosePort(allow, async () => false)).rejects.toThrow('no-allowed-free-port');
  });
});

