#!/usr/bin/env node
// Ticket 254: agent-scoped secrets through a 1Password service account.
//
// Agents read the keys meant for them (for example Anthropic and OpenAI API keys)
// without a Touch ID prompt. Owner secrets stay behind Emi's approval: the
// service account can read only the "Cadence Agents" vault, and this wrapper
// refuses any reference outside that vault before it calls `op`.
//
// Usage:
//   npm run agent:secret -- [--run <run-dir>] [--caller <name>] \
//     --env ANTHROPIC_API_KEY=anthropic-api-key \
//     --env OPENAI_API_KEY=openai-api-key/credential \
//     -- <command> [args...]
//   npm run agent:secret -- --check [--env NAME=item ...]
//   pbpaste | npm run agent:secret -- --store-token
//
// How it works:
// 1. Reads the service-account token from the macOS Keychain (generic password,
//    service "cadence-agent-1password", account "service-account-token").
// 2. Runs `op read` once per item with only that token in op's environment,
//    so op never falls back to the desktop app or Emi's owner vaults.
// 3. Starts <command> with each value in the named environment variable. The
//    token and every other OP_* variable are removed from the child's environment.
// 4. Appends one line per access to `<run-dir>/events.jsonl` (with --run) or
//    `.intent/acceptance/secret-access.jsonl`: item, field, variable name, time,
//    caller and outcome. Never a value.
//    When <run-dir> does not exist yet, the wrapper does not create it: the runner
//    it starts creates its own run folder and stops with run-exists if one is
//    there. The lines go to `<run-dir>.secret-access.jsonl` first and move into
//    `<run-dir>/events.jsonl` once the child exits (Ticket 257). If the wrapper
//    itself is killed, they stay in that file and the next call with the same
//    --run moves them.
//
// The wrapper never prints, logs or writes a value or the token. Its own
// messages are fixed templates that name items only. op's stderr is classified,
// never relayed. What the child does with a value is the child's responsibility.
//
// --store-token (setup step 5) reads the service-account token from stdin,
// checks its shape, writes it through `security -i` on stdin (never argv, and
// not the password prompt, which keeps only 128 bytes), then reads it back and
// compares lengths. It prints lengths only. `--check` verifies it with op.
//
// Exit codes: the child's code when it runs; 2 usage; 3 refused reference;
// 4 token missing from the Keychain; 5 op could not read an item; 6 --check failed;
// 7 --store-token input is not a plausible token; 8 --store-token write or
// read-back failed; 127 command not found.
//
// Setup (Emi, once): docs/qa/agent-secrets.md.
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { isCliEntry } from './cli-entry.mjs';
import { assertSafe } from './ledger.mjs';

export const AGENT_VAULT = 'Cadence Agents';
export const KEYCHAIN_SERVICE = 'cadence-agent-1password';
export const KEYCHAIN_ACCOUNT = 'service-account-token';
export const DEFAULT_FIELD = 'credential';
export const DEFAULT_LEDGER = join('.intent', 'acceptance', 'secret-access.jsonl');

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const ENV_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENV_DENY = new Set(['PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR', 'PWD', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS']);
const ENV_DENY_PREFIXES = ['OP_', 'DYLD_', 'LD_', 'NPM_'];
const CALLER_PATTERN = /[^A-Za-z0-9 ._:/@-]/g;
const OP_TIMEOUT_MS = 60_000;
// ops_ plus base64 or base64url. Real tokens are several hundred characters. The
// lower bound rejects the 128-character prefix the old `-w` prompt kept; the upper
// bound keeps the `security -i` line under its 4,088-byte limit.
const TOKEN_PATTERN = /^ops_[A-Za-z0-9+/=._-]{246,3796}$/;
const SERVICE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SECURITY_LINE_LIMIT = 4088;

export class AgentSecretError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AgentSecretError';
    this.code = code;
  }
}

/**
 * Parses an item reference into { vault, item, field }. Accepts `item`,
 * `item/field` or `op://Cadence Agents/item/field`. Throws AgentSecretError
 * with code 'refused' for anything outside the agent vault or malformed.
 */
export function parseSecretRef(ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 300) throw new AgentSecretError('refused', 'invalid item reference');
  let vault = AGENT_VAULT;
  let rest = ref;
  if (ref.startsWith('op://')) {
    const parts = ref.slice(5).split('/');
    if (parts.length < 2 || parts.length > 3) throw new AgentSecretError('refused', 'invalid item reference');
    vault = parts[0];
    rest = parts.slice(1).join('/');
    if (vault !== AGENT_VAULT) throw new AgentSecretError('refused', `the vault is outside the agent vault "${AGENT_VAULT}"`);
  }
  const parts = rest.split('/');
  if (parts.length > 2) throw new AgentSecretError('refused', 'invalid item reference');
  const [item, field = DEFAULT_FIELD] = parts;
  if (!NAME_PATTERN.test(item) || !NAME_PATTERN.test(field)) throw new AgentSecretError('refused', 'invalid item reference');
  // A raw key passed by mistake must never reach the ledger or stderr.
  if (looksLikeSecret(item) || looksLikeSecret(field)) throw new AgentSecretError('refused', 'the reference looks like a secret value, not an item name');
  return { vault, item, field };
}

/** Item and field names are short labels. Uses Ticket 247's ledger safety rules. */
function looksLikeSecret(name) {
  try { assertSafe({ name }); return false; } catch { return true; }
}

/**
 * Validates an environment variable name for a secret value. Usage errors never
 * echo the argument: a reversed mapping puts a raw key where the name goes.
 */
export function checkEnvName(name) {
  if (!ENV_PATTERN.test(name)) throw new AgentSecretError('usage', 'invalid environment variable name in --env (expected uppercase letters, digits and _)');
  if (ENV_DENY.has(name) || ENV_DENY_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    throw new AgentSecretError('refused', `environment variable "${name}" is reserved`);
  }
  return name;
}

/**
 * Parses CLI arguments. Returns { check, run, caller, specs, command, args,
 * refusals }. Refused specs are collected (not thrown) so they reach the ledger.
 */
export function parseCli(argv) {
  const out = { check: false, storeToken: false, keychainService: null, run: null, caller: null, specs: [], refusals: [], command: null, args: [] };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      out.command = argv[i + 1] ?? null;
      out.args = argv.slice(i + 2);
      break;
    }
    if (arg === '--check') { out.check = true; continue; }
    if (arg === '--store-token') { out.storeToken = true; continue; }
    if (arg === '--keychain-service') {
      const value = argv[i + 1];
      i += 1;
      if (!SERVICE_PATTERN.test(value ?? '')) throw new AgentSecretError('usage', '--keychain-service expects a lowercase name');
      out.keychainService = value;
      continue;
    }
    if (arg === '--run' || arg === '--caller' || arg === '--env') {
      const value = argv[i + 1];
      if (value === undefined || value === '--') throw new AgentSecretError('usage', `${arg} needs a value`);
      i += 1;
      if (arg === '--run') out.run = value;
      else if (arg === '--caller') out.caller = value;
      else {
        const eq = value.indexOf('=');
        if (eq <= 0) throw new AgentSecretError('usage', '--env expects NAME=item[/field]');
        const env = value.slice(0, eq);
        const ref = value.slice(eq + 1);
        try {
          checkEnvName(env);
          if (seen.has(env)) throw new AgentSecretError('usage', `--env at position ${i + 1} maps an environment variable that is already mapped`);
          seen.add(env);
          out.specs.push({ env, ...parseSecretRef(ref) });
        } catch (error) {
          // A rejected reference is never kept, logged or echoed.
          if (error instanceof AgentSecretError && error.code === 'refused') out.refusals.push({ env: safeLabel(env), reason: error.message });
          else throw error;
        }
      }
      continue;
    }
    // Never echo the argument: a stray positional may be a raw key.
    throw new AgentSecretError('usage', `unknown argument at position ${i + 1}`);
  }
  if (out.keychainService && !out.storeToken) throw new AgentSecretError('usage', '--keychain-service is only for --store-token');
  if (out.storeToken) {
    if (out.check || out.command || out.run || out.caller || out.specs.length || out.refusals.length) throw new AgentSecretError('usage', '--store-token takes no other options');
    return out;
  }
  if (!out.check && !out.command) throw new AgentSecretError('usage', 'missing "-- <command>"');
  if (!out.check && out.specs.length === 0 && out.refusals.length === 0) throw new AgentSecretError('usage', 'at least one --env NAME=item is required');
  return out;
}

function safeLabel(value) {
  const text = String(value ?? '');
  return text.length <= 120 && /^[A-Za-z0-9 ._:/=@-]*$/.test(text) ? text : '(unprintable)';
}

function safeCaller(value) {
  const text = String(value ?? '').replace(CALLER_PATTERN, '').slice(0, 100);
  return text || 'unknown';
}

/** Appends one access record to the ledger. Never receives a value. */
export function recordAccess(ledgerPath, entry) {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const line = { type: 'secret_access', at: new Date().toISOString(), caller: entry.caller, item: entry.item, field: entry.field, vault: entry.vault, env: entry.env, outcome: entry.outcome };
  if (entry.reason) line.reason = entry.reason;
  // Last guard: a line that looks like it holds a secret is not written.
  try { assertSafe(line); } catch { throw new AgentSecretError('ledger-unsafe', 'refused to write an unsafe ledger line'); }
  appendFileSync(ledgerPath, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  try { chmodSync(ledgerPath, 0o600); } catch { /* best effort on existing files */ }
}

export function ledgerPathFor({ run, cwd = process.cwd() }) {
  return run ? resolve(cwd, run, 'events.jsonl') : resolve(cwd, DEFAULT_LEDGER);
}

/** Where lines wait while the child creates a new run folder: next to it, never inside. */
export function pendingLedgerPathFor({ run, cwd = process.cwd() }) {
  return `${resolve(cwd, run)}.secret-access.jsonl`;
}

/** Moves waiting lines into the run folder's events.jsonl, creating the folder if the child did not. */
function fileWaitingLines(pending, ledger) {
  if (!existsSync(pending)) return;
  const text = readFileSync(pending, 'utf8');
  mkdirSync(dirname(ledger), { recursive: true, mode: 0o700 });
  if (text) appendFileSync(ledger, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600 });
  try { chmodSync(ledger, 0o600); } catch { /* best effort on existing files */ }
  unlinkSync(pending);
}

/** Runs a helper process and captures its output in memory only. */
function capture(command, args, { env, timeoutMs = OP_TIMEOUT_MS, input = undefined }) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(command, args, { env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    } catch {
      resolvePromise({ code: 127, stdout: Buffer.alloc(0), stderr: '' });
      return;
    }
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', () => { clearTimeout(timer); resolvePromise({ code: 127, stdout: Buffer.alloc(0), stderr: '' }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? (signal ? 124 : 1), stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
}

/** Maps op's stderr to a fixed reason. op's text is never relayed. */
export function classifyOpError(stderr, code) {
  if (code === 127) return 'op_not_found';
  if (code === 124) return 'op_timeout';
  const text = String(stderr ?? '').toLowerCase();
  if (/(isn't a vault|vault[^\n]*not found|no vault)/.test(text)) return 'vault_not_accessible';
  if (/(isn't an item|could not find item|no item found|item[^\n]*not found)/.test(text)) return 'item_not_found';
  if (/(isn't a field|could not find field|does not have a field|field[^\n]*not found)/.test(text)) return 'field_not_found';
  if (/(unauthorized|invalid token|token is invalid|authentication|expired)/.test(text)) return 'token_rejected';
  if (/(rate limit|too many requests)/.test(text)) return 'rate_limited';
  return 'op_failed';
}

function pick(env, keys) {
  const out = {};
  for (const key of keys) if (env[key] !== undefined) out[key] = env[key];
  return out;
}

function opEnv(env, token) {
  return { ...pick(env, ['PATH', 'HOME', 'TMPDIR', 'XDG_CONFIG_HOME']), OP_SERVICE_ACCOUNT_TOKEN: token, OP_BIOMETRIC_UNLOCK_ENABLED: 'false' };
}

async function readToken(env) {
  const result = await capture('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'], { env: pick(env, ['PATH', 'HOME']), timeoutMs: 120_000 });
  const token = result.code === 0 ? result.stdout.toString('utf8').replace(/\r?\n$/, '') : '';
  return token.length > 0 ? token : null;
}

async function readStdin(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Setup step 5. The token arrives on stdin and leaves only through stdin of
 * `security -i`. Output names lengths, the service and the account, never the token.
 */
async function storeToken({ service, env, io, stdin }) {
  if (stdin.isTTY) {
    writeLine(io.stderr, 'pipe the token in, for example: pbpaste | npm run agent:secret -- --store-token');
    return 2;
  }
  let token = (await readStdin(stdin)).trim();
  if (!TOKEN_PATTERN.test(token)) {
    token = '';
    writeLine(io.stderr, 'the input is not a plausible 1Password service-account token (ops_ and base64, 250 to 3,800 characters, no spaces or line breaks); nothing was stored');
    return 7;
  }
  const line = `add-generic-password -U -s ${service} -a ${KEYCHAIN_ACCOUNT} -T /usr/bin/security -w ${token}`;
  if (Buffer.byteLength(line) > SECURITY_LINE_LIMIT) {
    writeLine(io.stderr, 'the token is too long for the Keychain command line; nothing was stored');
    return 7;
  }
  const keychainEnv = pick(env, ['PATH', 'HOME']);
  const write = await capture('security', ['-i'], { env: keychainEnv, input: `${line}\n`, timeoutMs: 120_000 });
  if (write.code !== 0) {
    writeLine(io.stderr, `could not write the Keychain item (service "${service}", account "${KEYCHAIN_ACCOUNT}")`);
    return 8;
  }
  const read = await capture('security', ['find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w'], { env: keychainEnv, timeoutMs: 120_000 });
  const back = read.code === 0 ? read.stdout.toString('utf8').replace(/\r?\n$/, '') : '';
  const expected = token.length;
  const matches = back === token;
  token = '';
  if (back.length !== expected) {
    writeLine(io.stderr, `read back ${back.length} characters, expected ${expected} (service "${service}", account "${KEYCHAIN_ACCOUNT}")`);
    return 8;
  }
  if (!matches) {
    writeLine(io.stderr, `read back ${back.length} characters, but they differ from the input`);
    return 8;
  }
  writeLine(io.stdout, `stored ${expected} characters; read back ${back.length} (service "${service}", account "${KEYCHAIN_ACCOUNT}"). Verify with: npm run agent:secret -- --check`);
  return 0;
}

function childEnv(env, values) {
  const out = {};
  for (const [key, value] of Object.entries(env)) if (!key.startsWith('OP_')) out[key] = value;
  return Object.assign(out, values);
}

function writeLine(stream, text) {
  stream.write(`agent-secret: ${text}\n`);
}

/**
 * Main entry. Returns the exit code. `io` lets tests capture stdout/stderr;
 * `env` and `cwd` default to the current process.
 */
export async function runAgentSecret(argv, { env = process.env, cwd = process.cwd(), io = { stdout: process.stdout, stderr: process.stderr }, stdin = process.stdin } = {}) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    writeLine(io.stderr, error instanceof AgentSecretError ? error.message : 'invalid arguments');
    return 2;
  }
  if (parsed.storeToken) return storeToken({ service: parsed.keychainService ?? KEYCHAIN_SERVICE, env, io, stdin });
  const ledger = ledgerPathFor({ run: parsed.run, cwd });
  if (!parsed.run || existsSync(resolve(cwd, parsed.run))) {
    if (parsed.run) fileWaitingLines(pendingLedgerPathFor({ run: parsed.run, cwd }), ledger);
    return accessAndRun(parsed, { ledger, env, cwd, io });
  }
  const pending = pendingLedgerPathFor({ run: parsed.run, cwd });
  try {
    return await accessAndRun(parsed, { ledger: pending, env, cwd, io });
  } finally {
    fileWaitingLines(pending, ledger);
  }
}

async function accessAndRun(parsed, { ledger, env, cwd, io }) {
  const caller = safeCaller(parsed.caller ?? (parsed.command ? basename(parsed.command) : 'check'));
  const log = (entry) => recordAccess(ledger, { caller, vault: AGENT_VAULT, ...entry });

  if (parsed.refusals.length > 0) {
    for (const refusal of parsed.refusals) {
      log({ item: null, field: null, vault: null, env: refusal.env, outcome: 'refused', reason: 'outside_agent_vault_or_invalid' });
      writeLine(io.stderr, `refused ${refusal.env}: ${refusal.reason}`);
    }
    return 3;
  }

  const token = await readToken(env);
  if (!token) {
    for (const spec of parsed.specs) log({ item: spec.item, field: spec.field, env: spec.env, outcome: 'failed', reason: 'token_missing' });
    writeLine(io.stderr, `no service-account token in the Keychain (service "${KEYCHAIN_SERVICE}", account "${KEYCHAIN_ACCOUNT}"). See docs/qa/agent-secrets.md.`);
    return 4;
  }

  if (parsed.check) return runCheck(parsed, token, env, io);

  const values = {};
  for (const spec of parsed.specs) {
    const ref = `op://${spec.vault}/${spec.item}/${spec.field}`;
    const result = await capture('op', ['read', '--no-newline', ref], { env: opEnv(env, token) });
    const value = result.code === 0 ? result.stdout.toString('utf8') : '';
    if (!value) {
      const reason = result.code === 0 ? 'empty_value' : classifyOpError(result.stderr, result.code);
      log({ item: spec.item, field: spec.field, env: spec.env, outcome: 'failed', reason });
      writeLine(io.stderr, `could not read "${spec.item}/${spec.field}" from "${AGENT_VAULT}" (${reason})`);
      return 5;
    }
    values[spec.env] = value;
    log({ item: spec.item, field: spec.field, env: spec.env, outcome: 'ok' });
  }

  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(parsed.command, parsed.args, { env: childEnv(env, values), cwd, stdio: 'inherit' });
    } catch {
      writeLine(io.stderr, `could not start "${safeLabel(parsed.command)}"`);
      resolvePromise(127);
      return;
    }
    const forward = (signal) => { try { child.kill(signal); } catch { /* already gone */ } };
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    const done = (code) => {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      resolvePromise(code);
    };
    child.on('error', () => { writeLine(io.stderr, `could not start "${safeLabel(parsed.command)}"`); done(127); });
    child.on('close', (code, signal) => done(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 15) : 1)));
  });
}

/** Verifies setup without reading any item value. Prints names only. */
async function runCheck(parsed, token, env, io) {
  const say = (text) => io.stdout.write(`${text}\n`);
  say('token: present in the Keychain');
  const vaults = await capture('op', ['vault', 'list', '--format', 'json'], { env: opEnv(env, token) });
  if (vaults.code !== 0) {
    writeLine(io.stderr, `op vault list failed (${classifyOpError(vaults.stderr, vaults.code)})`);
    return 6;
  }
  let names;
  try { names = JSON.parse(vaults.stdout.toString('utf8')).map((v) => safeLabel(v.name)); } catch { names = null; }
  if (!names) { writeLine(io.stderr, 'op vault list returned unreadable output'); return 6; }
  say(`service account vaults: ${names.join(', ') || '(none)'}`);
  const extra = names.filter((name) => name !== AGENT_VAULT);
  if (!names.includes(AGENT_VAULT)) { writeLine(io.stderr, `the service account cannot read "${AGENT_VAULT}"`); return 6; }
  if (extra.length > 0) { writeLine(io.stderr, `the service account can reach other vaults (${extra.join(', ')}); recreate it with "${AGENT_VAULT}" only`); return 6; }
  const items = await capture('op', ['item', 'list', '--vault', AGENT_VAULT, '--format', 'json'], { env: opEnv(env, token) });
  if (items.code !== 0) { writeLine(io.stderr, `op item list failed (${classifyOpError(items.stderr, items.code)})`); return 6; }
  let titles;
  try { titles = JSON.parse(items.stdout.toString('utf8')).map((item) => safeLabel(item.title)); } catch { titles = null; }
  if (!titles) { writeLine(io.stderr, 'op item list returned unreadable output'); return 6; }
  say(`items: ${titles.join(', ') || '(none)'}`);
  const missing = parsed.specs.filter((spec) => !titles.includes(spec.item));
  for (const spec of parsed.specs) say(`${spec.env}=${spec.item}/${spec.field}: ${missing.includes(spec) ? 'missing' : 'item present'}`);
  return missing.length > 0 ? 6 : 0;
}

if (isCliEntry(import.meta)) {
  runAgentSecret(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`agent-secret: unexpected error (${error instanceof AgentSecretError ? error.code : error?.name ?? 'unknown'})\n`);
      process.exitCode = 1;
    },
  );
}
