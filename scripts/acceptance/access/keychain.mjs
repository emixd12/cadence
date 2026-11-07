#!/usr/bin/env node
// Test-access probe for one macOS Keychain generic password (Ticket 286).
//
//   node scripts/acceptance/access/keychain.mjs --service <service> --account <account>
//
// Runs `security find-generic-password` without -w, so the value is never read.
import { PROBE, USAGE, cliMain, finish, parseFlags, runProcess } from './lib.mjs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:@-]{0,99}$/;
const SECURITY_ITEM_NOT_FOUND = 44;

export function classifyKeychain({ status, error }) {
  if (error) return { code: PROBE.ERROR, detail: `security did not run (${error})` };
  if (status === 0) return { code: PROBE.PRESENT, detail: 'item present' };
  if (status === SECURITY_ITEM_NOT_FOUND) return { code: PROBE.MISSING, detail: 'item missing' };
  return { code: PROBE.ERROR, detail: `security exited ${status}` };
}

export async function main(argv, { run = runProcess, out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  let flags;
  try { flags = parseFlags(argv, { values: ['service', 'account'] }); } catch { flags = {}; }
  if (!NAME.test(flags.service ?? '') || !NAME.test(flags.account ?? '')) {
    return finish(out, USAGE, { detail: 'usage: --service <service> --account <account>' });
  }
  const result = run('/usr/bin/security', ['find-generic-password', '-s', flags.service, '-a', flags.account], { timeoutMs: 30_000 });
  const { code, detail } = classifyKeychain(result);
  return finish(out, code, { detail });
}

cliMain(import.meta, main);
