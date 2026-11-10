#!/usr/bin/env node
// Test Calendar fixtures for test accounts A and B through the Google Calendar API
// (decision 2026-11-06, "Agents act as the test accounts, end to end").
//
// The OAuth client is a Desktop client in the Cloud project `cadence-qa-498717`, kept
// apart from Cadence's production sign-in and Calendar projects. Its client JSON sits in
// the macOS Keychain (service `cadence-qa-google-oauth-client`, account
// `cadence-qa-498717`, base64). Each account's refresh token sits in the Keychain
// (service `cadence-qa-google-calendar`, account `production:<slot>`). Nothing is
// printed except fixed step names, event ids, titles, times and locations.
//
//   npm run agent:secret -- --caller google-calendar-fixtures \
//     --env GOOGLE_TEST_PASSWORD=google-test-account-a/password \
//     --env "GOOGLE_TEST_OTP=google-test-account-a/one-time password" \
//     -- node scripts/acceptance/google-calendar-fixtures.mjs consent --slot A
//   node scripts/acceptance/google-calendar-fixtures.mjs list   --slot A --calendar <id> --from <iso> --to <iso>
//   node scripts/acceptance/google-calendar-fixtures.mjs create --slot A --calendar <id> --title "QA …" \
//        --start <iso> --end <iso> [--timezone America/New_York] [--location "…"]
//   node scripts/acceptance/google-calendar-fixtures.mjs delete --slot A --calendar <id> --event <id>
//
// `consent` signs the account in to Google first (google-signin.mjs; an account that is
// already signed in needs no vault variables), then clicks through Google's consent in
// the Cadence QA Chrome profile. While the client's app stays in Testing, Google expires
// the refresh token after 7 days; run `consent` again then.
//
// Writes are limited to titles that start with a test prefix (`W6 `, `QA `, `Test `), so
// the tool cannot change or delete anything else in the account's Calendars.
//
// Exit codes: 0 done; 2 usage; 3 stopped (a fixed reason is printed).

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { isCliEntry } from './cli-entry.mjs';
import { SignInStop, signIn } from './google-signin.mjs';
import { PRODUCTION } from './test-account-sessions.mjs';
import { DEFAULT_DEBUG_PORT, DEFAULT_PROFILE_DIR, attachProfile } from './web-client.mjs';

export const CLIENT_SERVICE = 'cadence-qa-google-oauth-client';
export const CLIENT_ACCOUNT = 'cadence-qa-498717';
export const TOKEN_SERVICE = 'cadence-qa-google-calendar';
export const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const TEST_TITLE = /^(W6|QA|Test) \S/;
export const DEFAULT_TIMEZONE = 'America/New_York';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USAGE = 'usage: google-calendar-fixtures.mjs consent|list|create|delete --slot A|B …';

/** Options each command needs, beyond --slot. */
const REQUIRED = Object.freeze({
  consent: [],
  list: ['calendar', 'from', 'to'],
  create: ['calendar', 'title', 'start', 'end'],
  delete: ['calendar', 'event'],
});

export class FixtureStop extends Error {
  constructor(reason) { super(reason); this.name = 'FixtureStop'; this.reason = reason; }
}

export const isTestTitle = (title) => typeof title === 'string' && TEST_TITLE.test(title);

const tokenAccount = (slot) => `production:${slot}`;

function run(bin, args, input) {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { timeout: 15_000, maxBuffer: 1 << 20 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? '') }));
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function keychainRead(service, account) {
  const { ok, stdout } = await run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w']);
  return ok ? stdout.trim() : null;
}

/** Writes through `security -i` on stdin, so the value never appears in a process argument list. */
export async function keychainWrite(service, account, value, read = keychainRead) {
  if (!/^[A-Za-z0-9+/=._-]+$/.test(value) || value.length > 3800) throw new FixtureStop('keychain-value-invalid');
  const { ok } = await run('/usr/bin/security', ['-i'], `add-generic-password -U -s ${service} -a ${account} -T /usr/bin/security -w ${value}\n`);
  if (!ok || (await read(service, account)) !== value) throw new FixtureStop('keychain-write-failed');
}

/** Real Keychain, network and browser; tests replace any of these. */
function withDefaults(deps = {}) {
  const read = deps.read ?? keychainRead;
  return {
    read,
    write: deps.write ?? ((service, account, value) => keychainWrite(service, account, value, read)),
    fetch: deps.fetch ?? globalThis.fetch,
    signIn: deps.signIn ?? signIn,
    attach: deps.attach ?? attachProfile,
  };
}

/** The QA OAuth client's id and secret from the Keychain's base64 client JSON. */
export async function readClient(read = keychainRead) {
  const encoded = await read(CLIENT_SERVICE, CLIENT_ACCOUNT);
  if (!encoded) throw new FixtureStop('client-missing');
  let client;
  try {
    client = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))?.installed;
  } catch {
    throw new FixtureStop('client-invalid');
  }
  if (typeof client?.client_id !== 'string' || typeof client?.client_secret !== 'string' || !client.client_id || !client.client_secret) {
    throw new FixtureStop('client-invalid');
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

async function tokenRequest(fetchImpl, body) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new FixtureStop(`token-${typeof json.error === 'string' ? json.error : response.status}`);
  return json;
}

async function accessToken(slot, d) {
  const refresh = await d.read(TOKEN_SERVICE, tokenAccount(slot));
  if (!refresh) throw new FixtureStop('consent-required');
  const { clientId, clientSecret } = await readClient(d.read);
  const json = await tokenRequest(d.fetch, { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, client_secret: clientSecret });
  if (!json.access_token) throw new FixtureStop('token-missing');
  return json.access_token;
}

/**
 * Test-access probe (Ticket 293): one token refresh for the slot's stored grant. Returns
 * `{ slot, state: 'ok' }` or throws FixtureStop (`consent-required`, `token-invalid_grant`, …).
 * The access token is discarded.
 */
export async function checkGrant({ slot }, deps) {
  await accessToken(slot, withDefaults(deps));
  return { slot, state: 'ok' };
}

async function api(slot, method, path, body, d) {
  const token = await accessToken(slot, d);
  const response = await d.fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new FixtureStop(`calendar-${response.status}-${json.error?.status ?? 'error'}`);
  return json;
}

const eventPath = (calendar, event) => `/calendars/${encodeURIComponent(calendar)}/events${event ? `/${encodeURIComponent(event)}` : ''}`;

const summary = (event) => ({ id: event.id, title: event.summary ?? null, start: event.start?.dateTime ?? event.start?.date ?? null,
  end: event.end?.dateTime ?? event.end?.date ?? null, location: event.location ?? null });

export async function listEvents({ slot, calendar, from, to }, deps) {
  const query = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const json = await api(slot, 'GET', `${eventPath(calendar)}?${query}`, undefined, withDefaults(deps));
  return (json?.items ?? []).map(summary);
}

export async function createEvent({ slot, calendar, title, start, end, timezone = DEFAULT_TIMEZONE, location }, deps) {
  if (!isTestTitle(title)) throw new FixtureStop('title-not-test');
  const body = { summary: title, start: { dateTime: start, timeZone: timezone }, end: { dateTime: end, timeZone: timezone } };
  if (location) body.location = location;
  return summary(await api(slot, 'POST', eventPath(calendar), body, withDefaults(deps)));
}

/** Re-reads the event and deletes it only when its current title is a test title. */
export async function deleteEvent({ slot, calendar, event }, deps) {
  const d = withDefaults(deps);
  const current = await api(slot, 'GET', eventPath(calendar, event), undefined, d);
  if (!isTestTitle(current?.summary)) throw new FixtureStop('title-not-test');
  await api(slot, 'DELETE', eventPath(calendar, event), undefined, d);
  return { deleted: event, title: current.summary };
}

/**
 * Signs the slot's account in to Google (google-signin.mjs), clicks through Google's
 * consent for the QA client in the QA profile, and stores the refresh token.
 */
export async function consent({ slot, password, otpSeed, shotPath = null, port = DEFAULT_DEBUG_PORT, profileDir = DEFAULT_PROFILE_DIR, log = () => {} }, deps) {
  const d = withDefaults(deps);
  const email = PRODUCTION.accounts[slot]?.email;
  if (!email) throw new FixtureStop('slot-invalid');
  const { clientId, clientSecret } = await readClient(d.read);
  try {
    const signedIn = await d.signIn({ slot, password, otpSeed, port, profileDir, log, shotPath });
    log(`step signin-${signedIn?.state ?? 'done'}`);
  } catch (error) {
    throw new FixtureStop(`signin-${error instanceof SignInStop ? error.reason : (error?.reason ?? error?.name ?? 'error')}`);
  }
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  let resolveCode;
  const codePromise = new Promise((resolve) => { resolveCode = resolve; });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.end('Cadence QA: consent received. You can close this tab.');
    if (url.searchParams.get('state') === state) resolveCode({ code: url.searchParams.get('code'), error: url.searchParams.get('error') });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
    login_hint: email, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  let detach = async () => {};
  let page = null;
  try {
    const attached = await d.attach({ profileDir, port });
    detach = attached.detach;
    page = await attached.context.newPage();
    await page.goto(authorize.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const deadline = Date.now() + 120_000;
    let result = null;
    let picked = false;
    codePromise.then((value) => { result = value; });
    while (!result && Date.now() < deadline) {
      await page.waitForTimeout(1_500);
      if (result) break;
      const host = (() => { try { return new URL(page.url()).host; } catch { return ''; } })();
      if (host !== 'accounts.google.com') continue;
      const text = await page.locator('body').innerText().catch(() => '');
      if (/Error 403: access_denied/.test(text)) throw new FixtureStop('access-denied-not-a-test-user');
      const account = page.locator(`[data-identifier="${email}"], [data-email="${email}"]`).first();
      if (!picked && await account.count() && await account.isVisible().catch(() => false)) { picked = true; await account.click(); log('step choose-account'); continue; }
      // Testing-mode apps show "Google hasn't verified this app" to test users.
      const proceed = page.getByRole('button', { name: /^Continue$/ }).first();
      const boxes = page.locator('input[type="checkbox"]:not(:checked)');
      if (await boxes.count()) { for (let i = 0; i < await boxes.count(); i += 1) await boxes.nth(i).check().catch(() => {}); log('step select-scopes'); }
      if (await proceed.count() && await proceed.isVisible().catch(() => false)) { await proceed.click(); log('step continue'); continue; }
      const allow = page.getByRole('button', { name: /^(Allow|Select all)$/ }).first();
      if (await allow.count() && await allow.isVisible().catch(() => false)) { await allow.click(); log('step allow'); }
    }
    if (!result) {
      // Optional evidence for a stop: Google's page and its button labels only.
      if (shotPath) await page.screenshot({ path: shotPath }).catch(() => {});
      log(`buttons ${JSON.stringify(await page.locator('button, [role="button"]').allInnerTexts().catch(() => []))}`);
      throw new FixtureStop('consent-timeout');
    }
    if (result.error || !result.code) throw new FixtureStop(`consent-${result.error ?? 'no-code'}`);
    const json = await tokenRequest(d.fetch, { grant_type: 'authorization_code', code: result.code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, code_verifier: verifier });
    if (!json.refresh_token) throw new FixtureStop('no-refresh-token');
    if (!String(json.scope ?? '').split(' ').includes(SCOPE)) throw new FixtureStop('scope-not-granted');
    await d.write(TOKEN_SERVICE, tokenAccount(slot), json.refresh_token);
    return { slot, state: 'consented', scope: SCOPE };
  } finally {
    server.close();
    if (page) await page.close().catch(() => {});
    await detach();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, out = (line) => process.stdout.write(`${line}\n`), deps = {}) {
  const [command, ...rest] = argv;
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: {
      slot: { type: 'string' }, calendar: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, title: { type: 'string' },
      start: { type: 'string' }, end: { type: 'string' }, timezone: { type: 'string' }, location: { type: 'string' }, event: { type: 'string' },
      port: { type: 'string' },
    } }));
  } catch { out(USAGE); return 2; }
  if (!Object.hasOwn(REQUIRED, command ?? '')) { out(USAGE); return 2; }
  if (!['A', 'B'].includes(values.slot ?? '')) { out('usage: --slot A|B is required'); return 2; }
  const missing = REQUIRED[command].filter((name) => !values[name]?.trim());
  if (missing.length) { out(`usage: ${command} needs ${missing.map((name) => `--${name}`).join(' ')}`); return 2; }
  const port = values.port ? Number(values.port) : DEFAULT_DEBUG_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { out('usage: --port must be a port number'); return 2; }
  try {
    let result;
    if (command === 'consent') {
      result = await consent({ slot: values.slot, port, password: env.GOOGLE_TEST_PASSWORD, otpSeed: env.GOOGLE_TEST_OTP,
        shotPath: env.GOOGLE_SIGNIN_STOP_SCREENSHOT || null, log: out }, deps);
    } else if (command === 'list') result = await listEvents(values, deps);
    else if (command === 'create') result = await createEvent(values, deps);
    else result = await deleteEvent(values, deps);
    out(JSON.stringify(result));
    return 0;
  } catch (error) {
    out(JSON.stringify({ slot: values.slot, state: 'stopped', reason: error instanceof FixtureStop ? error.reason : (error?.name ?? 'error') }));
    return 3;
  }
}

if (isCliEntry(import.meta)) process.exitCode = await main();
