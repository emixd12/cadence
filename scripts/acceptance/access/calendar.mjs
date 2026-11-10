#!/usr/bin/env node
// Test-access adapter for QA Google Calendar fixtures (Ticket 293).
//
//   node scripts/acceptance/access/calendar.mjs client               probe: QA OAuth client JSON in the Keychain
//   node scripts/acceptance/access/calendar.mjs grant --slot A|B     probe: stored refresh token still refreshes
//   node scripts/acceptance/access/calendar.mjs consent --slot A|B   renew: Google sign-in and consent, as the agent
//
// `consent` runs google-calendar-fixtures.mjs consent through agent-secret.mjs, which
// reads the account's Google password and authenticator seed from "Cadence Agents"
// into that one process. This adapter reads only the tool's final JSON line.
import { fileURLToPath } from 'node:url';
import { FixtureStop, checkGrant, readClient } from '../google-calendar-fixtures.mjs';
import { PROBE, RENEW, SLOT_IDS, USAGE, cliMain, finish, googleSecretArgs, lastJsonLine, parseFlags, runProcess, signInStop } from './lib.mjs';

const AGENT_SECRET = fileURLToPath(new URL('../agent-secret.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../google-calendar-fixtures.mjs', import.meta.url));

const reasonOf = (error) => (error instanceof FixtureStop ? error.reason : null);

export function classifyClient(error) {
  if (!error) return { code: PROBE.PRESENT, detail: 'client present' };
  const reason = reasonOf(error);
  if (reason === 'client-missing') return { code: PROBE.MISSING, detail: reason };
  if (reason === 'client-invalid') return { code: PROBE.EXPIRED, detail: reason };
  return { code: PROBE.ERROR, detail: `client check failed (${reason ?? error?.name ?? 'error'})` };
}

export function classifyGrant(error) {
  if (!error) return { code: PROBE.PRESENT, detail: 'grant refreshes' };
  const reason = reasonOf(error);
  if (reason === 'consent-required') return { code: PROBE.MISSING, detail: 'no stored grant' };
  if (reason === 'token-invalid_grant') return { code: PROBE.EXPIRED, detail: 'grant expired or revoked' };
  // The client is its own requirement; report the grant as missing so it waits for it.
  if (reason === 'client-missing' || reason === 'client-invalid') return { code: PROBE.MISSING, detail: reason };
  return { code: PROBE.ERROR, detail: `grant check failed (${reason ?? error?.name ?? 'error'})` };
}

/** Maps the consent run's exit code and final line to a renewal result. */
export function classifyConsent({ status, stdout, error }) {
  if (error) return { code: RENEW.ERROR, detail: `consent did not run (${error})` };
  if (status === 0) return { code: RENEW.RENEWED, detail: 'consented' };
  const reason = typeof lastJsonLine(stdout)?.reason === 'string' ? lastJsonLine(stdout).reason : null;
  if (status === 3 && reason) {
    const stop = signInStop(reason);
    if (stop) return { code: RENEW.NEEDS_OWNER, detail: `sign-in stopped: ${stop}`, stop };
    if (reason === 'access-denied-not-a-test-user') return { code: RENEW.NEEDS_OWNER, detail: 'not a test user', stop: 'not-a-test-user' };
    return { code: RENEW.ERROR, detail: `consent stopped (${reason})` };
  }
  if (status === 4 || status === 5) return { code: RENEW.ERROR, detail: `vault read failed (agent-secret exit ${status})` };
  return { code: RENEW.ERROR, detail: `consent exited ${status}` };
}

export async function main(argv, { run = runProcess, out = (line) => process.stdout.write(`${line}\n`), env = process.env, deps = {} } = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['slot'] }); } catch { flags = null; }
  const needsSlot = command === 'grant' || command === 'consent';
  if (!flags || !['client', 'grant', 'consent'].includes(command ?? '') || (needsSlot && !SLOT_IDS.includes(flags.slot ?? ''))) {
    return finish(out, USAGE, { detail: 'usage: client | grant --slot A|B | consent --slot A|B' });
  }
  if (command === 'client') {
    let error = null;
    try { await readClient(deps.read); } catch (caught) { error = caught; }
    const { code, detail } = classifyClient(error);
    return finish(out, code, { detail });
  }
  if (command === 'grant') {
    let error = null;
    try { await checkGrant({ slot: flags.slot }, deps); } catch (caught) { error = caught; }
    const { code, detail } = classifyGrant(error);
    return finish(out, code, { detail });
  }
  const args = [AGENT_SECRET, '--caller', 'test-access-calendar', ...googleSecretArgs(flags.slot), '--',
    process.execPath, FIXTURES, 'consent', '--slot', flags.slot];
  const { code, detail, stop } = classifyConsent(run(process.execPath, args, { env, timeoutMs: 590_000 }));
  return finish(out, code, { detail, stop });
}

cliMain(import.meta, main);
