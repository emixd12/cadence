// Shared helpers for the test-access preflight adapters (Ticket 293).
//
// The engine (.agentic/scripts/test-access-preflight.mjs, from the
// service-connections-bootstrap skill) runs each adapter as a probe or a renewal and
// reads only its exit code and an optional last stdout line of JSON:
//   { "detail": "short words", "expires_at": "<RFC3339>", "stop": "<id>" }
// Probe exit codes: 0 present, 20 expired, 21 missing; anything else is an error.
// Renew exit codes: 0 renewed, 30 needs the owner; anything else is an error.
//
// Adapters never print a value. Their only stdout is the final JSON line, built from
// fixed words, item names and stop ids.
import { spawnSync } from 'node:child_process';
import { isCliEntry } from '../cli-entry.mjs';

export const PROBE = Object.freeze({ PRESENT: 0, EXPIRED: 20, MISSING: 21, ERROR: 1 });
export const RENEW = Object.freeze({ RENEWED: 0, NEEDS_OWNER: 30, ERROR: 1 });
export const USAGE = 2;

export const STOP_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SLOT_IDS = Object.freeze(['A', 'B']);

/** Prints the one JSON line the engine reads, then returns the exit code. */
export function finish(out, code, { detail, expires_at: expiresAt, stop } = {}) {
  const report = {};
  if (detail) report.detail = String(detail).slice(0, 150);
  if (expiresAt) report.expires_at = expiresAt;
  if (stop && STOP_ID.test(stop)) report.stop = stop;
  out(JSON.stringify(report));
  return code;
}

/** Synchronous child process with captured output. Output stays in memory. */
export function runProcess(command, args, { env = process.env, cwd = process.cwd(), timeoutMs = 60_000, input } = {}) {
  const result = spawnSync(command, args, {
    env, cwd, input, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 << 20,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error ? (result.error.code ?? 'spawn-error') : null,
  };
}

/** Parses --name value pairs and bare flags. Unknown flags are a usage error. */
export function parseFlags(argv, { values = [], flags = [], repeat = [] } = {}) {
  const out = { _: [] };
  for (const name of repeat) out[name] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const name = arg.slice(2);
    if (flags.includes(name)) { out[name] = true; continue; }
    if (values.includes(name) || repeat.includes(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      if (repeat.includes(name)) out[name].push(value); else out[name] = value;
      continue;
    }
    throw new Error('unknown option');
  }
  return out;
}

/** The last JSON object line on stdout, or null. Used to read fixed result lines from Cadence tools. */
export function lastJsonLine(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try { return JSON.parse(line); } catch { /* keep looking */ }
  }
  return null;
}

/** Item names and vault field names for the agent vault, per test identity. */
export const GOOGLE_ITEMS = Object.freeze({
  A: { item: 'google-test-account-a' },
  B: { item: 'google-test-account-b' },
});

/**
 * agent-secret.mjs arguments that put a test account's Google password and
 * authenticator seed into one child process's environment.
 */
export function googleSecretArgs(slot) {
  const { item } = GOOGLE_ITEMS[slot];
  return ['--env', `GOOGLE_TEST_PASSWORD=${item}/password`, '--env', `GOOGLE_TEST_OTP=${item}/one-time password`];
}

/** Maps a google-signin.mjs stop reason to an owner_stops id in the manifest. */
export function signInStop(reason) {
  const text = String(reason ?? '');
  const bare = text.startsWith('signin-') ? text.slice('signin-'.length) : text;
  if (['phone-prompt', 'captcha', 'verification-required', 'browser-not-secure', 'challenge-unsupported'].includes(bare)) return bare;
  if (['password-rejected', 'otp-rejected', 'identifier-rejected', 'otp-seed-invalid'].includes(bare)) return 'credentials-rejected';
  return null;
}

/** Guards CLI entry for adapters. */
export function cliMain(meta, main) {
  if (!isCliEntry(meta)) return;
  Promise.resolve(main(process.argv.slice(2))).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stdout.write(`${JSON.stringify({ detail: `adapter error ${error?.name ?? 'unknown'}` })}\n`);
      process.exitCode = 1;
    },
  );
}
