#!/usr/bin/env node
// Test-access adapter for a test account's Google sign-in in the Cadence QA Chrome
// profile (Ticket 293; decision 2026-11-06, item 1).
//
//   node scripts/acceptance/access/google.mjs session --slot A|B   probe: signed in? (one new tab, closed after)
//   node scripts/acceptance/access/google.mjs signin --slot A|B    renew: google-signin.mjs through agent-secret
//
// The probe attaches to the open QA profile, opens one tab on the account page for
// that address, reads whether Google served it, and closes only that tab. It never
// reads or prints another signed-in address.
import { fileURLToPath } from 'node:url';
import { PRODUCTION } from '../test-account-sessions.mjs';
import { DEFAULT_DEBUG_PORT, DEFAULT_PROFILE_DIR, attachProfile } from '../web-client.mjs';
import { PROBE, RENEW, SLOT_IDS, USAGE, cliMain, finish, googleSecretArgs, lastJsonLine, parseFlags, runProcess, signInStop } from './lib.mjs';

const AGENT_SECRET = fileURLToPath(new URL('../agent-secret.mjs', import.meta.url));
const SIGNIN = fileURLToPath(new URL('../google-signin.mjs', import.meta.url));

/** One tab: true when Google serves the account page for `email` in the QA profile. */
export async function googleSignedIn({ email, attach = attachProfile, profileDir = DEFAULT_PROFILE_DIR, port = DEFAULT_DEBUG_PORT }) {
  const { context, detach } = await attach({ profileDir, port });
  let page = null;
  try {
    page = await context.newPage();
    await page.goto(`https://myaccount.google.com/?authuser=${encodeURIComponent(email)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1_500);
    if (new URL(page.url()).host !== 'myaccount.google.com') return false;
    return (await page.content()).toLowerCase().includes(email.toLowerCase());
  } finally {
    if (page) await page.close().catch(() => {});
    await detach();
  }
}

export function classifySignIn({ status, stdout, error }) {
  if (error) return { code: RENEW.ERROR, detail: `sign-in did not run (${error})` };
  if (status === 0) return { code: RENEW.RENEWED, detail: 'signed in' };
  const reason = lastJsonLine(stdout)?.reason;
  if (status === 3 && typeof reason === 'string') {
    const stop = signInStop(reason);
    if (stop) return { code: RENEW.NEEDS_OWNER, detail: `sign-in stopped: ${stop}`, stop };
    return { code: RENEW.ERROR, detail: `sign-in stopped (${reason})` };
  }
  if (status === 4 || status === 5) return { code: RENEW.ERROR, detail: `vault read failed (agent-secret exit ${status})` };
  return { code: RENEW.ERROR, detail: `sign-in exited ${status}` };
}

export async function main(argv, { run = runProcess, out = (line) => process.stdout.write(`${line}\n`), env = process.env, attach = attachProfile } = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['slot'] }); } catch { flags = null; }
  if (!flags || !['session', 'signin'].includes(command ?? '') || !SLOT_IDS.includes(flags.slot ?? '')) {
    return finish(out, USAGE, { detail: 'usage: session|signin --slot A|B' });
  }
  if (command === 'session') {
    try {
      const signedIn = await googleSignedIn({ email: PRODUCTION.accounts[flags.slot].email, attach });
      return signedIn ? finish(out, PROBE.PRESENT, { detail: 'signed in' }) : finish(out, PROBE.MISSING, { detail: 'not signed in' });
    } catch (error) {
      return finish(out, PROBE.ERROR, { detail: `probe failed (${error?.reason ?? error?.name ?? 'error'})` });
    }
  }
  const args = [AGENT_SECRET, '--caller', 'test-access-google', ...googleSecretArgs(flags.slot), '--', process.execPath, SIGNIN, '--slot', flags.slot];
  const { code, detail, stop } = classifySignIn(run(process.execPath, args, { env, timeoutMs: 590_000 }));
  return finish(out, code, { detail, stop });
}

cliMain(import.meta, main);
