#!/usr/bin/env node
// Test-access adapter for Cadence's connector connections for test account A
// (Ticket 293; decision 2026-11-07, item 2).
//
//   node scripts/acceptance/access/connection.mjs status  --slot A --connector <id>   probe: connected / reconnect_required / disconnected
//   node scripts/acceptance/access/connection.mjs connect --slot A --connector hevy|icloud-calendar
//                                                                                     renew: submit the vault item through Cadence's API
//
// Connectors: google-calendar, outlook-calendar, icloud-calendar, hevy. Both commands call
// Cadence's own /api/<connector>/connection as the account, with the kept Supabase
// session as a Bearer token (the same path the Mac app uses), so RLS applies. `connect`
// runs itself again through agent-secret.mjs, which puts the vault item's fields in that
// child's environment only; the child posts them once and prints the resulting state.
import { fileURLToPath } from 'node:url';
import { qaPublishableKey } from '../qa-config.mjs';
import { AcceptanceError, PRODUCTION, createKeychainSessionStore, createSessionManager } from '../test-account-sessions.mjs';
import { PROBE, RENEW, SLOT_IDS, USAGE, cliMain, finish, lastJsonLine, parseFlags, runProcess } from './lib.mjs';

const AGENT_SECRET = fileURLToPath(new URL('../agent-secret.mjs', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
export const CONNECTORS = Object.freeze(['google-calendar', 'outlook-calendar', 'icloud-calendar', 'hevy']);

/** Vault items and fields for direct-credential connectors (decision 2026-11-07, item 2). */
export const DIRECT_CREDENTIALS = Object.freeze({
  hevy: Object.freeze({
    item: 'hevy-owner', // decision 2026-11-11: the owner's own Hevy Pro account
    env: Object.freeze({ CONNECTOR_HEVY_API_KEY: 'credential' }),
    body: (env) => ({ apiKey: env.CONNECTOR_HEVY_API_KEY ?? '' }),
  }),
  'icloud-calendar': Object.freeze({
    item: 'icloud-test-account-a',
    env: Object.freeze({ CONNECTOR_ICLOUD_APPLE_ID: 'username', CONNECTOR_ICLOUD_APP_PASSWORD: 'app-specific password' }),
    body: (env) => ({ appleId: env.CONNECTOR_ICLOUD_APPLE_ID ?? '', appPassword: env.CONNECTOR_ICLOUD_APP_PASSWORD ?? '' }),
  }),
});

const STATUS = /^(connected|reconnect_required|disconnected|not_configured)$/;
const codeOf = (error) => (error instanceof AcceptanceError ? error.code : (error?.name ?? 'error'));

export function classifyStatus({ httpStatus, body }) {
  const status = typeof body?.status === 'string' && STATUS.test(body.status) ? body.status : null;
  if (httpStatus === 200 && status === 'connected') return { code: PROBE.PRESENT, detail: 'connected' };
  if (httpStatus === 200 && status === 'reconnect_required') return { code: PROBE.EXPIRED, detail: 'reconnect_required' };
  if (httpStatus === 200 && status === 'disconnected') return { code: PROBE.MISSING, detail: 'disconnected' };
  if (status === 'not_configured' || httpStatus === 503) return { code: PROBE.ERROR, detail: 'connector not configured on production' };
  if (httpStatus === 401) return { code: PROBE.ERROR, detail: 'session rejected' };
  const reason = typeof body?.error === 'string' ? body.error.replace(/[^a-z_]/g, '').slice(0, 40) : 'unknown';
  return { code: PROBE.ERROR, detail: `status read failed (${httpStatus} ${reason})` };
}

export function classifyConnect({ status, stdout, error }) {
  if (error) return { code: RENEW.ERROR, detail: `connect did not run (${error})` };
  const result = lastJsonLine(stdout);
  if (status === 0 && result?.state === 'connected') return { code: RENEW.RENEWED, detail: 'connected' };
  if (status === 4 || status === 5) return { code: RENEW.ERROR, detail: `vault read failed (agent-secret exit ${status})` };
  // Cadence rejected the credential: the owner must fix the vault item.
  if (result?.state === 'rejected') return { code: RENEW.NEEDS_OWNER, detail: 'credential rejected', stop: 'credential-rejected' };
  const state = typeof result?.state === 'string' ? result.state.replace(/[^a-z_-]/g, '').slice(0, 40) : `exit-${status}`;
  return { code: RENEW.ERROR, detail: `connect failed (${state})` };
}

function productionSessions(env) {
  return createSessionManager({
    target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey: qaPublishableKey(env), store: createKeychainSessionStore(),
  });
}

async function callConnection({ sessions, slot, connector, method = 'GET', body, fetchImpl }) {
  const record = await sessions.current(slot);
  const response = await fetchImpl(`${PRODUCTION.issuer}/api/${connector}/connection`, {
    method,
    headers: { Authorization: `Bearer ${record.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  return { httpStatus: response.status, body: await response.json().catch(() => null) };
}

export async function main(argv, { out = (line) => process.stdout.write(`${line}\n`), env = process.env, sessions = null, fetchImpl = fetch, run = runProcess } = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['slot', 'connector'], flags: ['from-env'] }); } catch { flags = null; }
  const valid = flags && ['status', 'connect'].includes(command ?? '') && SLOT_IDS.includes(flags.slot ?? '') && CONNECTORS.includes(flags.connector ?? '');
  if (!valid || (command === 'connect' && !DIRECT_CREDENTIALS[flags.connector])) {
    return finish(out, USAGE, { detail: 'usage: status --slot A --connector <id> | connect --slot A --connector hevy|icloud-calendar' });
  }
  if (command === 'connect' && !flags['from-env']) {
    const spec = DIRECT_CREDENTIALS[flags.connector];
    const envArgs = Object.entries(spec.env).flatMap(([name, field]) => ['--env', `${name}=${spec.item}/${field}`]);
    const args = [AGENT_SECRET, '--caller', `test-access-${flags.connector}`, ...envArgs, '--', process.execPath, SELF,
      'connect', '--slot', flags.slot, '--connector', flags.connector, '--from-env'];
    const { code, detail, stop } = classifyConnect(run(process.execPath, args, { env, timeoutMs: 120_000 }));
    return finish(out, code, { detail, stop });
  }
  let manager;
  try { manager = sessions ?? productionSessions(env); } catch (error) {
    return finish(out, PROBE.ERROR, { detail: `session setup failed (${codeOf(error)})` });
  }
  if (command === 'status') {
    try {
      const { code, detail } = classifyStatus(await callConnection({ sessions: manager, slot: flags.slot, connector: flags.connector, fetchImpl }));
      return finish(out, code, { detail });
    } catch (error) {
      return finish(out, PROBE.ERROR, { detail: `status read failed (${codeOf(error)})` });
    }
  }
  // Child of agent-secret: post once, print the state only. The values leave with the request.
  try {
    const body = DIRECT_CREDENTIALS[flags.connector].body(env);
    const result = await callConnection({ sessions: manager, slot: flags.slot, connector: flags.connector, method: 'POST', body, fetchImpl });
    if (result.httpStatus === 200 && result.body?.status === 'connected') { out(JSON.stringify({ state: 'connected' })); return 0; }
    // invalid_request: malformed item; reconnect_required: the provider refused it; permission_denied: Hevy without Pro.
    const rejected = result.httpStatus === 400 || ['invalid_request', 'reconnect_required', 'permission_denied', 'wrong_account'].includes(result.body?.error);
    out(JSON.stringify({ state: rejected ? 'rejected' : `http-${result.httpStatus}` }));
    return 3;
  } catch (error) {
    out(JSON.stringify({ state: codeOf(error) }));
    return 3;
  }
}

cliMain(import.meta, main);
