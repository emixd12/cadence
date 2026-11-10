#!/usr/bin/env node
// Test-access adapter for the kept Cadence (Supabase) sessions of test accounts A and B
// (Tickets 248 and 293; decision 2026-11-07, item 1).
//
//   node scripts/acceptance/access/cadence-session.mjs status --slot A|B        probe: kept session refreshes and is the right account
//   node scripts/acceptance/access/cadence-session.mjs enroll --slot A|B        renew: mcp:oauth enroll, driven in one QA Chrome tab
//   node scripts/acceptance/access/cadence-session.mjs claude-grant --slot A    probe: exactly one active claude.ai connector grant
//   node scripts/acceptance/access/cadence-session.mjs travel --slot A          probe: Travel estimates on, routing consent, Home, leave reminders
//
// Every read goes through the account's own session and RLS. Output is fixed words only;
// tokens, Home text and grant ids are never printed.
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { qaPublishableKey } from '../qa-config.mjs';
import { AcceptanceError, PRODUCTION, createKeychainSessionStore, createSessionManager, enrollProduction } from '../test-account-sessions.mjs';
import { DEFAULT_DEBUG_PORT, DEFAULT_PROFILE_DIR, attachProfile } from '../web-client.mjs';
import { PROBE, RENEW, SLOT_IDS, USAGE, cliMain, finish, parseFlags } from './lib.mjs';

export const ENROLL_PORTS = Object.freeze([4321, 4322, 4323, 4324, 4325, 4326, 4327, 4328, 4329, 4330]);
const COMMANDS = ['status', 'enroll', 'claude-grant', 'travel'];

const codeOf = (error) => (error instanceof AcceptanceError ? error.code : (error?.name ?? 'error'));

export function classifySession(error) {
  if (!error) return { code: PROBE.PRESENT, detail: 'session ok' };
  const code = codeOf(error);
  if (code === 'session-missing') return { code: PROBE.MISSING, detail: code };
  if (['session-refresh-failed', 'session-invalid', 'keychain-item-corrupt'].includes(code)) return { code: PROBE.EXPIRED, detail: code };
  return { code: PROBE.ERROR, detail: `session check failed (${code})` };
}

export function classifyClaudeGrants(rows) {
  const count = (Array.isArray(rows) ? rows : []).filter((row) => row?.verified_client === 'claude').length;
  if (count === 1) return { code: PROBE.PRESENT, detail: 'one claude.ai grant' };
  if (count === 0) return { code: PROBE.MISSING, detail: 'claude-ai-grant-missing' };
  return { code: PROBE.ERROR, detail: 'claude-ai-grant-ambiguous' };
}

/** Travel estimates on with routing consent and a Home, and leave reminders on. Booleans only. */
export function classifyTravel({ settings, leave }) {
  const missing = [];
  if (settings?.enabled !== true) missing.push('travel-off');
  if (!settings?.routing_consent_at) missing.push('no-routing-consent');
  if (!(typeof settings?.base_location_text === 'string' && settings.base_location_text.trim())) missing.push('no-home');
  if (leave?.enabled !== true) missing.push('leave-reminders-off');
  return missing.length ? { code: PROBE.MISSING, detail: missing.join(' ') } : { code: PROBE.PRESENT, detail: 'travel settings ready' };
}

export function classifyEnroll(error) {
  if (!error) return { code: RENEW.RENEWED, detail: 'enrolled' };
  const code = codeOf(error);
  if (code === 'enroll-timeout' || code === 'chooser-timeout') return { code: RENEW.NEEDS_OWNER, detail: code, stop: 'enroll-timeout' };
  return { code: RENEW.ERROR, detail: `enroll failed (${code})` };
}

function productionSessions(env) {
  return createSessionManager({
    target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey: qaPublishableKey(env), store: createKeychainSessionStore(),
  });
}

async function readTravel(sessions, slot, env) {
  const record = await sessions.current(slot);
  const client = createClient(PRODUCTION.supabaseUrl, qaPublishableKey(env), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${record.accessToken}` } },
  });
  const settings = await client.from('travel_settings').select('enabled, routing_consent_at, base_location_text').maybeSingle();
  const leave = await client.from('travel_leave_reminder_settings').select('enabled').maybeSingle();
  if (settings.error || leave.error) throw new AcceptanceError('travel-read-failed');
  return { settings: settings.data, leave: leave.data };
}

const portFree = (port) => new Promise((resolve) => {
  const server = createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});

/**
 * Runs the production enrollment page on a free allowlisted port and drives Google's
 * account chooser in one new QA Chrome tab: it clicks only the slot's listed address and
 * Continue. google-signin.mjs has already signed the account in (a dependency).
 */
export async function enrollInProfile({ slot, env, enroll = enrollProduction, attach = attachProfile, isFree = portFree, chooserMs = 150_000 }) {
  const port = await (async () => { for (const candidate of ENROLL_PORTS) if (await isFree(candidate)) return candidate; return null; })();
  if (!port) throw new AcceptanceError('port-unavailable');
  const email = PRODUCTION.accounts[slot].email.toLowerCase();
  let ready;
  const opened = new Promise((resolve) => { ready = resolve; });
  const done = enroll({ slot, port, publishableKey: qaPublishableKey(env), out: (line) => { if (String(line).startsWith('open ')) ready(); }, timeoutMs: chooserMs + 30_000 })
    .then(() => null, (error) => error);
  const first = await Promise.race([opened.then(() => 'open'), done.then((error) => ({ error }))]);
  if (first !== 'open') throw first.error ?? new AcceptanceError('enroll-failed');
  const { context, detach } = await attach({ profileDir: DEFAULT_PROFILE_DIR, port: DEFAULT_DEBUG_PORT });
  let page = null;
  let finished = false;
  done.then(() => { finished = true; });
  try {
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/start/${slot}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const deadline = Date.now() + chooserMs;
    while (!finished && Date.now() < deadline) {
      await page.waitForTimeout(1_500);
      const host = (() => { try { return new URL(page.url()).host; } catch { return ''; } })();
      if (host !== 'accounts.google.com') continue;
      const account = page.locator(`[data-identifier="${email}"], [data-email="${email}"]`).first();
      if (await account.count() && await account.isVisible().catch(() => false)) { await account.click(); continue; }
      const proceed = page.getByRole('button', { name: /^Continue$/ }).first();
      if (await proceed.count() && await proceed.isVisible().catch(() => false)) await proceed.click();
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await detach();
  }
  const error = await Promise.race([done, new Promise((resolve) => setTimeout(() => resolve(new AcceptanceError('chooser-timeout')), finished ? 0 : 5_000))]);
  if (error) throw error;
}

export async function main(argv, { out = (line) => process.stdout.write(`${line}\n`), env = process.env, sessions = null, enrollImpl = enrollInProfile, travel = readTravel } = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['slot'] }); } catch { flags = null; }
  if (!flags || !COMMANDS.includes(command ?? '') || !SLOT_IDS.includes(flags.slot ?? '')) {
    return finish(out, USAGE, { detail: `usage: ${COMMANDS.join('|')} --slot A|B` });
  }
  if (command === 'enroll') {
    let error = null;
    try { await enrollImpl({ slot: flags.slot, env }); } catch (caught) { error = caught; }
    const { code, detail, stop } = classifyEnroll(error);
    return finish(out, code, { detail, stop });
  }
  let manager;
  try { manager = sessions ?? productionSessions(env); } catch (error) {
    return finish(out, PROBE.ERROR, { detail: `session setup failed (${codeOf(error)})` });
  }
  if (command === 'status') {
    let error = null;
    try { await manager.current(flags.slot); } catch (caught) { error = caught; }
    const { code, detail } = classifySession(error);
    return finish(out, code, { detail });
  }
  try {
    const { code, detail } = command === 'claude-grant'
      ? classifyClaudeGrants(await manager.userRpc(flags.slot, 'oauth_list_grants'))
      : classifyTravel(await travel(manager, flags.slot, env));
    return finish(out, code, { detail });
  } catch (error) {
    return finish(out, PROBE.ERROR, { detail: `${command} check failed (${codeOf(error)})` });
  }
}

cliMain(import.meta, main);
