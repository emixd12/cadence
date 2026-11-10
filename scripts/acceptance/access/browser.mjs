#!/usr/bin/env node
// Test-access adapter for the Cadence QA Chrome profile (Ticket 293).
//
//   node scripts/acceptance/access/browser.mjs profile                                 probe: profile folder and its Chrome on port 4430
//   node scripts/acceptance/access/browser.mjs cadence-web --slot A                    probe: Cadence web session for the account
//   node scripts/acceptance/access/browser.mjs cadence-signin --slot A                 renew: Continue with Google, pick the listed account
//   node scripts/acceptance/access/browser.mjs site --site chatgpt|claude-web          probe: site session cookie present (names only)
//   node scripts/acceptance/access/browser.mjs permission --name notifications|geolocation --expect granted|denied
//                                                                                      probe: Cadence origin permission state
//
// Decision 2026-11-07 (item 5) lifts Ticket 284's restrictions; agents still touch only
// the test accounts. Each tab probe opens one new tab, reads, and closes that tab. The
// permission probe loads `/robots.txt` on the Cadence origin, so no app code runs and
// no push subscription changes. Output is fixed words only.
import { existsSync } from 'node:fs';
import { PRODUCTION } from '../test-account-sessions.mjs';
import { SITES } from '../web-sites.mjs';
import { DEFAULT_DEBUG_PORT, DEFAULT_PROFILE_DIR, attachProfile, profileOwnsPort, signInStatus } from '../web-client.mjs';
import { PROBE, RENEW, SLOT_IDS, USAGE, cliMain, finish, parseFlags } from './lib.mjs';

const ORIGIN = PRODUCTION.issuer;
const COMMANDS = ['profile', 'cadence-web', 'cadence-signin', 'site', 'permission'];
const PERMISSIONS = Object.freeze(['notifications', 'geolocation']);
const EXPECT = Object.freeze(['granted', 'denied']);

/** Opens one new tab, runs `fn(page)`, and always closes that tab and detaches. */
export async function withOneTab(attach, fn) {
  const { context, detach } = await attach({ profileDir: DEFAULT_PROFILE_DIR, port: DEFAULT_DEBUG_PORT });
  let page = null;
  try {
    page = await context.newPage();
    return await fn(page, context);
  } finally {
    if (page) await page.close().catch(() => {});
    await detach();
  }
}

/** A JSON route needs no app code: 200 means the cookie session is valid, 401 means signed out. */
export async function cadenceWebStatus(page) {
  const response = await page.goto(`${ORIGIN}/api/google-calendar/connection`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  return response?.status() ?? 0;
}

export function classifyCadenceWeb(status) {
  if (status === 200) return { code: PROBE.PRESENT, detail: 'signed in' };
  if (status === 401) return { code: PROBE.MISSING, detail: 'signed out' };
  return { code: PROBE.ERROR, detail: `status ${status}` };
}

export function classifyPermission(state, expect) {
  if (state === expect) return { code: PROBE.PRESENT, detail: `${state}` };
  if (['granted', 'denied', 'prompt'].includes(state)) return { code: PROBE.MISSING, detail: `${state}, expected ${expect}` };
  return { code: PROBE.ERROR, detail: 'permission state unreadable' };
}

/** Signs in on Cadence's login page with Google, picking only the slot's listed address. */
export async function cadenceSignIn(page, { email, timeoutMs = 120_000 }) {
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const deadline = Date.now() + timeoutMs;
  let clicked = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_500);
    const url = (() => { try { return new URL(page.url()); } catch { return null; } })();
    if (url?.origin === ORIGIN && !url.pathname.startsWith('/login') && !url.pathname.startsWith('/auth')) return 'signed-in';
    if (url?.origin === ORIGIN && url.pathname.startsWith('/login') && !clicked) {
      const button = page.getByRole('button', { name: /Continue with Google/ }).first();
      if (await button.count() && await button.isVisible().catch(() => false)) { await button.click(); clicked = true; }
      continue;
    }
    if (url?.host !== 'accounts.google.com') continue;
    const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    if (text.includes('check your phone') || text.includes('tap yes')) return 'phone-prompt';
    const account = page.locator(`[data-identifier="${email}"], [data-email="${email}"]`).first();
    if (await account.count() && await account.isVisible().catch(() => false)) { await account.click(); continue; }
    const proceed = page.getByRole('button', { name: /^Continue$/ }).first();
    if (await proceed.count() && await proceed.isVisible().catch(() => false)) await proceed.click();
  }
  return 'timeout';
}

export async function main(argv, { out = (line) => process.stdout.write(`${line}\n`), attach = attachProfile, owns = profileOwnsPort, exists = existsSync } = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['slot', 'site', 'name', 'expect'] }); } catch { flags = null; }
  const usage = () => finish(out, USAGE, { detail: `usage: ${COMMANDS.join('|')} (see the file header)` });
  if (!flags || !COMMANDS.includes(command ?? '')) return usage();
  if ((command === 'cadence-web' || command === 'cadence-signin') && !SLOT_IDS.includes(flags.slot ?? '')) return usage();
  if (command === 'site' && !['chatgpt', 'claude-web'].includes(flags.site ?? '')) return usage();
  if (command === 'permission' && (!PERMISSIONS.includes(flags.name ?? '') || !EXPECT.includes(flags.expect ?? ''))) return usage();

  if (command === 'profile') {
    if (!exists(DEFAULT_PROFILE_DIR)) return finish(out, PROBE.MISSING, { detail: 'profile folder missing' });
    return owns({ profileDir: DEFAULT_PROFILE_DIR, port: DEFAULT_DEBUG_PORT })
      ? finish(out, PROBE.PRESENT, { detail: 'profile open on 4430' })
      : finish(out, PROBE.MISSING, { detail: 'profile not open' });
  }
  try {
    if (command === 'site') {
      const { context, detach } = await attach({ profileDir: DEFAULT_PROFILE_DIR, port: DEFAULT_DEBUG_PORT });
      try {
        const signedIn = await signInStatus({ context, sites: [SITES[flags.site]] });
        return signedIn[flags.site] ? finish(out, PROBE.PRESENT, { detail: 'signed in' }) : finish(out, PROBE.MISSING, { detail: 'signed out' });
      } finally { await detach(); }
    }
    if (command === 'cadence-web') {
      const { code, detail } = classifyCadenceWeb(await withOneTab(attach, cadenceWebStatus));
      return finish(out, code, { detail });
    }
    if (command === 'permission') {
      const state = await withOneTab(attach, async (page) => {
        await page.goto(`${ORIGIN}/robots.txt`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        return page.evaluate((name) => navigator.permissions.query({ name }).then((status) => status.state, () => null), flags.name);
      });
      const { code, detail } = classifyPermission(state, flags.expect);
      return finish(out, code, { detail });
    }
    const email = PRODUCTION.accounts[flags.slot].email.toLowerCase();
    const result = await withOneTab(attach, (page) => cadenceSignIn(page, { email }));
    if (result === 'signed-in') return finish(out, RENEW.RENEWED, { detail: 'signed in' });
    if (result === 'phone-prompt') return finish(out, RENEW.NEEDS_OWNER, { detail: 'sign-in stopped: phone-prompt', stop: 'phone-prompt' });
    return finish(out, RENEW.ERROR, { detail: 'sign-in timed out' });
  } catch (error) {
    return finish(out, PROBE.ERROR, { detail: `${command} failed (${error?.reason ?? error?.name ?? 'error'})` });
  }
}

cliMain(import.meta, main);
