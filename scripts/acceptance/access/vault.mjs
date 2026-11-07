#!/usr/bin/env node
// Test-access probe for the "Cadence Agents" vault (Ticket 286).
//
//   node scripts/acceptance/access/vault.mjs --token          service-account token and its vault scope
//   node scripts/acceptance/access/vault.mjs --item <name>    one item's presence (title only)
//
// Calls `agent-secret.mjs --check`, which lists vault and item names only and never
// reads a value. The preflight manifest may not carry `--env NAME=item`, so the item
// name comes in through --item and the variable name is fixed here.
import { fileURLToPath } from 'node:url';
import { PROBE, USAGE, cliMain, finish, parseFlags, runProcess } from './lib.mjs';

const AGENT_SECRET = fileURLToPath(new URL('../agent-secret.mjs', import.meta.url));
const ITEM_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const CHECK_ENV = 'TEST_ACCESS_ITEM';

/**
 * Maps agent-secret --check results to probe codes. agent-secret exits 4 when the
 * token is missing and 6 when the check fails; its stderr carries fixed reasons.
 */
export function classifyCheck({ status, stdout, stderr, error }, { item = null } = {}) {
  if (error) return { code: PROBE.ERROR, detail: `agent-secret did not run (${error})` };
  if (status === 0) return { code: PROBE.PRESENT, detail: item ? 'item present' : 'token present, vault scope ok' };
  if (status === 4) return { code: PROBE.MISSING, detail: 'service-account token missing from the Keychain' };
  if (status === 6) {
    if (item && new RegExp(`^${CHECK_ENV}=\\S+: missing$`, 'm').test(stdout)) return { code: PROBE.MISSING, detail: 'item missing' };
    if (/token_rejected/.test(stderr)) return { code: PROBE.EXPIRED, detail: 'service-account token rejected' };
    if (/other vaults|cannot read/.test(stderr)) return { code: PROBE.EXPIRED, detail: 'service-account vault scope is wrong' };
    const reason = /\((op_[a-z_]+|rate_limited|vault_not_accessible)\)/.exec(stderr)?.[1] ?? 'check-failed';
    return { code: PROBE.ERROR, detail: `vault check failed (${reason})` };
  }
  return { code: PROBE.ERROR, detail: `agent-secret exited ${status}` };
}

export async function main(argv, { run = runProcess, out = (line) => process.stdout.write(`${line}\n`), env = process.env } = {}) {
  let flags;
  try { flags = parseFlags(argv, { values: ['item'], flags: ['token'] }); } catch { return finish(out, USAGE, { detail: 'usage: --token | --item <name>' }); }
  if (Boolean(flags.token) === Boolean(flags.item) || (flags.item && !ITEM_NAME.test(flags.item))) {
    return finish(out, USAGE, { detail: 'usage: --token | --item <name>' });
  }
  const args = [AGENT_SECRET, '--check', ...(flags.item ? ['--env', `${CHECK_ENV}=${flags.item}`] : [])];
  const result = run(process.execPath, args, { env, timeoutMs: 90_000 });
  const { code, detail } = classifyCheck(result, { item: flags.item ?? null });
  return finish(out, code, { detail });
}

cliMain(import.meta, main);
