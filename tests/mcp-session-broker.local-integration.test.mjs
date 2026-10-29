import { it, expect } from 'vitest';
import { request } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createSessionBroker, brokerRequest, ACCOUNTS } from '../scripts/mcp-session-broker.mjs';

// Opt-in rehearsal of the real PKCE code exchange against a disposable local
// Auth stack. Local Google is unavailable, so the injected starter uses a PKCE
// magic link; every later step is the production broker path.
const enabled = process.env.CADENCE_QA_BROKER_LOCAL === '1';
const ORIGIN = 'http://127.0.0.1:56120';
const MAILPIT = 'http://127.0.0.1:56125';
const PORT = 56127;
const DB = 'supabase_db_cadence-qa232-broker';
const OTHER = '11111111-2222-4333-8444-555555555555';
const EMAILS = { [ACCOUNTS.A]: 'qa232-a@example.test', [ACCOUNTS.B]: 'qa232-b@example.test', [OTHER]: 'qa232-other@example.test' };

const get = (path, cookie) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: PORT, path, headers: { host: `127.0.0.1:${PORT}`, ...(cookie ? { cookie } : {}) } }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject); req.end();
});
const sessionCount = (userId) => Number(execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-tAc', `select count(*) from auth.sessions where user_id = '${userId}'`], { encoding: 'utf8' }).trim());
const latestLink = async (email, after) => {
  for (let i = 0; i < 40; i += 1) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const message = (list.messages ?? []).find((m) => Date.parse(m.Created) >= after);
    if (message) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
      const link = String(full.Text).match(/https?:\/\/127\.0\.0\.1:56120\/auth\/v1\/verify\?[^\s)\]]+/);
      if (link) return link[0].replaceAll('&amp;', '&');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no-mail');
};

it.skipIf(!enabled)('exchanges real PKCE codes, discards a wrong account, refreshes, pins and tears down', async () => {
  const admin = createClient(ORIGIN, process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
  for (const [id, email] of Object.entries(EMAILS)) {
    const { error } = await admin.createUser({ id, email, email_confirm: true });
    if (error) expect(error.code).toBe('email_exists');
  }
  const dir = mkdtempSync(join(tmpdir(), 'qa232-'));
  const socketPath = join(dir, 'b.sock'), receiptPath = join(dir, 'receipt.jsonl');
  const lines = [];
  let nextUser = null;
  const beginErrors = [];
  const broker = createSessionBroker({
    supabaseUrl: ORIGIN, publishableKey: process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY, port: PORT, socketPath, receiptPath, log: (l) => lines.push(l),
    refreshIntervalMs: 3_600_000,
    beginSignIn: async (client, { redirectTo }) => {
      const after = Date.now() - 1000;
      const { error } = await client.auth.signInWithOtp({ email: EMAILS[nextUser], options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
      if (error) { beginErrors.push(error.code ?? error.message); return null; }
      try { return await latestLink(EMAILS[nextUser], after); } catch (e) { beginErrors.push(e.message); return null; }
    },
  });
  await broker.start();
  const verifyClient = createClient(ORIGIN, process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const userOf = async (token) => (await verifyClient.auth.getUser(token)).data?.user?.id ?? null;
  try {
    const signIn = async (slot, userId) => {
      nextUser = userId;
      const start = await get(`/start/${slot}`);
      expect(beginErrors).toEqual([]);
      expect(start.status).toBe(303);
      const cookie = start.headers['set-cookie'][0].split(';')[0];
      const verify = await fetch(start.headers.location, { redirect: 'manual' });
      const back = new URL(verify.headers.get('location'));
      expect(`${back.origin}${back.pathname}`).toBe(`http://127.0.0.1:${PORT}/auth/callback`);
      expect(back.searchParams.has('code')).toBe(true);
      const cb = await get(`${back.pathname}${back.search}`, cookie);
      const replay = await get(`${back.pathname}${back.search}`, cookie);
      expect(replay.headers.location).toBe('/done/failed');
      return cb.headers.location;
    };
    expect(await signIn('A', OTHER)).toBe('/done/discarded');
    expect(sessionCount(OTHER)).toBe(0);
    expect(await signIn('A', ACCOUNTS.B)).toBe('/done/discarded');
    expect(sessionCount(ACCOUNTS.B)).toBe(0);
    expect(await signIn('A', ACCOUNTS.A)).toBe('/done/A-match');
    await new Promise((r) => setTimeout(r, 61_000));
    expect(await signIn('B', ACCOUNTS.B)).toBe('/done/B-match');
    expect([sessionCount(ACCOUNTS.A), sessionCount(ACCOUNTS.B)]).toEqual([1, 1]);

    const first = (await brokerRequest(socketPath, { command: 'sessions' })).sessions;
    expect(await userOf(first.A.accessToken)).toBe(ACCOUNTS.A);
    expect(await userOf(first.B.accessToken)).toBe(ACCOUNTS.B);

    expect((await brokerRequest(socketPath, { command: 'pin' })).ok).toBe(true);
    const pinned = (await brokerRequest(socketPath, { command: 'pinned' })).sessions;
    expect((await brokerRequest(socketPath, { command: 'refresh' })).ok).toBe(true);
    const live = (await brokerRequest(socketPath, { command: 'sessions' })).sessions;
    expect(live.A.accessToken).not.toBe(pinned.A.accessToken);
    expect((await brokerRequest(socketPath, { command: 'pinned' })).sessions.A.accessToken).toBe(pinned.A.accessToken);
    expect(await userOf(pinned.A.accessToken)).toBe(ACCOUNTS.A);
    expect(await userOf(live.A.accessToken)).toBe(ACCOUNTS.A);
    expect(await userOf(live.B.accessToken)).toBe(ACCOUNTS.B);
    expect([sessionCount(ACCOUNTS.A), sessionCount(ACCOUNTS.B)]).toEqual([1, 1]);

    await broker.teardown('rehearsal');
    expect([sessionCount(ACCOUNTS.A), sessionCount(ACCOUNTS.B)]).toEqual([0, 0]);
    expect(await userOf(live.A.accessToken)).toBeNull();
    const recorded = `${lines.join('\n')}\n${readFileSync(receiptPath, 'utf8')}`;
    for (const token of [first.A.accessToken, first.B.accessToken, live.A.accessToken, pinned.A.accessToken]) expect(recorded).not.toContain(token);
    expect(recorded).not.toContain('code=');
  } finally {
    await broker.teardown('cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
}, 180_000);
