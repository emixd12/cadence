#!/usr/bin/env node
// Test-access probe for hosted Supabase Auth settings (Ticket 337).
//
//   node scripts/acceptance/access/auth-config.mjs --setting <id>
//
// Settings: email-provider, smtp-host, captcha, apple, manual-linking, secure-email-change.
// The probe runs itself again through agent-secret.mjs with the vault item
// supabase-access-token in one child's environment. The child reads
// GET /v1/projects/<ref>/config/auth once and prints booleans only; no value of any
// setting (SMTP host, client IDs, secrets) leaves the child.
import { fileURLToPath } from 'node:url';
import { PROBE, USAGE, cliMain, finish, lastJsonLine, parseFlags, runProcess } from './lib.mjs';

const AGENT_SECRET = fileURLToPath(new URL('../agent-secret.mjs', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
export const PROJECT_REF = 'qjodzutjxtmtzczbloxa';

const isSet = (value) => typeof value === 'string' && value.trim() !== '';

/** Each setting reads true when it is on in hosted Auth. */
export const SETTINGS = Object.freeze({
  'email-provider': (config) => config.external_email_enabled === true,
  'smtp-host': (config) => isSet(config.smtp_host),
  captcha: (config) => config.security_captcha_enabled === true,
  apple: (config) => config.external_apple_enabled === true,
  'manual-linking': (config) => config.security_manual_linking_enabled === true,
  'secure-email-change': (config) => config.mailer_secure_email_change_enabled === true,
});

/** Booleans for every setting, from a config/auth response body. */
export function readSettings(config) {
  return Object.fromEntries(Object.entries(SETTINGS).map(([id, on]) => [id, on(config ?? {})]));
}

export function classifyRead({ status, stdout, error }, setting) {
  if (error) return { code: PROBE.ERROR, detail: `read did not run (${error})` };
  if (status === 4 || status === 5) return { code: PROBE.ERROR, detail: `vault read failed (agent-secret exit ${status})` };
  const result = lastJsonLine(stdout);
  if (status !== 0 || !result?.settings) {
    const state = typeof result?.state === 'string' ? result.state.replace(/[^a-z0-9_-]/g, '').slice(0, 40) : `exit-${status}`;
    return { code: PROBE.ERROR, detail: `auth config read failed (${state})` };
  }
  if (result.settings[setting] === true) return { code: PROBE.PRESENT, detail: `${setting} on` };
  return { code: PROBE.MISSING, detail: `${setting} off`, stop: 'setting-off' };
}

export async function main(argv, { run = runProcess, out = (line) => process.stdout.write(`${line}\n`), env = process.env, fetchImpl = fetch } = {}) {
  let flags;
  try { flags = parseFlags(argv, { values: ['setting'], flags: ['from-env'] }); } catch { flags = null; }
  if (flags && flags['from-env'] && !flags.setting) {
    // Child of agent-secret: one read, booleans only.
    const token = env.SUPABASE_ACCESS_TOKEN ?? '';
    if (!token) { out(JSON.stringify({ state: 'token-missing' })); return 3; }
    try {
      const response = await fetchImpl(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });
      if (!response.ok) { out(JSON.stringify({ state: `http-${response.status}` })); return 3; }
      out(JSON.stringify({ settings: readSettings(await response.json()) }));
      return 0;
    } catch (error) {
      out(JSON.stringify({ state: error?.name ?? 'fetch-error' }));
      return 3;
    }
  }
  if (!flags || flags['from-env'] || !SETTINGS[flags.setting ?? '']) {
    return finish(out, USAGE, { detail: `usage: --setting ${Object.keys(SETTINGS).join('|')}` });
  }
  const args = [AGENT_SECRET, '--caller', 'test-access-auth-config', '--env', 'SUPABASE_ACCESS_TOKEN=supabase-access-token',
    '--', process.execPath, SELF, '--from-env'];
  const { code, detail, stop } = classifyRead(run(process.execPath, args, { env, timeoutMs: 90_000 }), flags.setting);
  return finish(out, code, { detail, stop });
}

cliMain(import.meta, main);
