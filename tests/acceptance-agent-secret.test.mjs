// Ticket 254: the agent-secret wrapper, driven end to end with a fake `op` and a
// fake macOS Keychain (`security`). The tests prove that item values and the
// service-account token never reach stdout, stderr, files or the ledger.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_VAULT, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, classifyOpError, parseCli, parseSecretRef } from '../scripts/acceptance/agent-secret.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/acceptance/agent-secret.mjs', import.meta.url));
const sha = (text) => createHash('sha256').update(text).digest('hex');

let root, fakebin, work, home, config, secrets;

function writeExecutable(path, body) {
  writeFileSync(path, `#!${process.execPath}\n${body}`);
  chmodSync(path, 0o755);
}

function setup(overrides = {}) {
  secrets = {
    token: `ops_FAKE_TOKEN_${randomBytes(12).toString('hex')}`,
    anthropic: `sk-ant-FAKE-${randomBytes(12).toString('hex')}`,
    openai: `sk-proj-FAKE-${randomBytes(12).toString('hex')}`,
  };
  config = {
    token: secrets.token,
    keychainMissing: false,
    vaults: [{ id: 'v1', name: AGENT_VAULT }],
    items: { 'anthropic-api-key/credential': secrets.anthropic, 'openai-api-key/credential': secrets.openai },
    ...overrides,
  };
  writeFileSync(join(fakebin, 'config.json'), JSON.stringify(config));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-secret-'));
  fakebin = join(root, 'fakebin');
  work = join(root, 'work');
  home = join(root, 'home');
  for (const dir of [fakebin, work, home]) mkdirSync(dir);
  // Fake Keychain: only answers the exact service/account lookup with -w.
  writeExecutable(join(fakebin, 'security'), `
const { readFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
appendFileSync(join(process.env.HOME, 'security-calls.log'), JSON.stringify(args) + '\\n');
const ok = args[0] === 'find-generic-password' && args.includes('-w')
  && args[args.indexOf('-s') + 1] === ${JSON.stringify(KEYCHAIN_SERVICE)}
  && args[args.indexOf('-a') + 1] === ${JSON.stringify(KEYCHAIN_ACCOUNT)};
if (!ok || config.keychainMissing) { process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\\n'); process.exit(44); }
process.stdout.write(config.token + '\\n');
`);
  // Fake 1Password CLI: requires the service-account token, never the desktop app.
  writeExecutable(join(fakebin, 'op'), `
const { readFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
const opVars = Object.keys(process.env).filter((k) => k.startsWith('OP_')).sort();
appendFileSync(join(process.env.HOME, 'op-calls.log'), JSON.stringify({ args, opVars, tokenMatches: process.env.OP_SERVICE_ACCOUNT_TOKEN === config.token }) + '\\n');
if (process.env.OP_SERVICE_ACCOUNT_TOKEN !== config.token) { process.stderr.write('[ERROR] authentication required\\n'); process.exit(1); }
if (args[0] === 'vault' && args[1] === 'list') { process.stdout.write(JSON.stringify(config.vaults)); process.exit(0); }
if (args[0] === 'item' && args[1] === 'list') {
  process.stdout.write(JSON.stringify(Object.keys(config.items).map((k) => ({ id: k, title: k.split('/')[0], vault: { name: ${JSON.stringify(AGENT_VAULT)} } }))));
  process.exit(0);
}
if (args[0] === 'read') {
  const ref = args[args.length - 1];
  const prefix = 'op://' + ${JSON.stringify(AGENT_VAULT)} + '/';
  if (!ref.startsWith(prefix)) { process.stderr.write('[ERROR] vault not found\\n'); process.exit(1); }
  const key = ref.slice(prefix.length);
  if (config.leakOnError === key) { process.stderr.write('[ERROR] boom token=' + config.token + ' value=' + Object.values(config.items)[0] + '\\n'); process.exit(1); }
  if (!(key in config.items)) { process.stderr.write('[ERROR] "' + key.split('/')[0] + '" isn\\'t an item in the vault\\n'); process.exit(1); }
  process.stdout.write(config.items[key]);
  process.exit(0);
}
process.stderr.write('[ERROR] unsupported\\n'); process.exit(2);
`);
  // Child: proves the values arrived, reports only hashes and OP_* names.
  writeFileSync(join(fakebin, 'child.mjs'), `
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const h = (v) => (v === undefined ? null : createHash('sha256').update(v).digest('hex'));
writeFileSync(process.argv[2], JSON.stringify({
  anthropic: h(process.env.ANTHROPIC_API_KEY),
  openai: h(process.env.OPENAI_API_KEY),
  opVars: Object.keys(process.env).filter((k) => k.startsWith('OP_')),
  args: process.argv.slice(3),
}));
process.stdout.write('child ran\\n');
process.stderr.write('child stderr line\\n');
process.exit(Number(process.env.CHILD_EXIT ?? 0));
`);
  setup();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args, extraEnv = {}) {
  const env = { PATH: `${fakebin}:${process.env.PATH}`, HOME: home, OP_ACCOUNT: 'should-not-pass', OP_SERVICE_ACCOUNT_TOKEN: 'parent-token-should-not-pass', ...extraEnv };
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: work, env, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

/** Scans stdout, stderr and every file outside the fake binaries' config. */
function expectNoLeak(result) {
  const forbidden = [secrets.token, secrets.anthropic, secrets.openai];
  const haystacks = [['stdout', result.stdout], ['stderr', result.stderr]];
  for (const file of [...filesUnder(work), ...filesUnder(home)]) haystacks.push([file, readFileSync(file, 'utf8')]);
  for (const [where, text] of haystacks) {
    for (const value of forbidden) expect(text.includes(value), `secret found in ${where}`).toBe(false);
  }
}

function ledgerLines(path) {
  return readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

function opCalls() {
  const path = join(home, 'op-calls.log');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

describe('agent-secret wrapper', () => {
  it('passes values to the child through the environment and never prints or writes them', () => {
    const out = join(work, 'child.json');
    const result = run(['--run', 'runs/r1', '--caller', 'ticket-251-runner', '--env', 'ANTHROPIC_API_KEY=anthropic-api-key', '--env', 'OPENAI_API_KEY=op://Cadence Agents/openai-api-key/credential', '--', process.execPath, join(fakebin, 'child.mjs'), out, 'extra']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('child ran');
    expect(result.stderr).toContain('child stderr line');
    const child = JSON.parse(readFileSync(out, 'utf8'));
    expect(child.anthropic).toBe(sha(secrets.anthropic));
    expect(child.openai).toBe(sha(secrets.openai));
    expect(child.opVars).toEqual([]);
    expect(child.args).toEqual(['extra']);

    const ledgerPath = join(work, 'runs/r1/events.jsonl');
    expect(statSync(ledgerPath).mode & 0o777).toBe(0o600);
    const lines = ledgerLines(ledgerPath);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({ type: 'secret_access', caller: 'ticket-251-runner', vault: AGENT_VAULT, field: 'credential', outcome: 'ok' });
      expect(Number.isNaN(Date.parse(line.at))).toBe(false);
      expect(Object.keys(line).sort()).toEqual(['at', 'caller', 'env', 'field', 'item', 'outcome', 'type', 'vault']);
    }
    expect(lines.map((l) => [l.env, l.item])).toEqual([['ANTHROPIC_API_KEY', 'anthropic-api-key'], ['OPENAI_API_KEY', 'openai-api-key']]);

    const calls = opCalls();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.tokenMatches).toBe(true);
      expect(call.opVars).toEqual(['OP_BIOMETRIC_UNLOCK_ENABLED', 'OP_SERVICE_ACCOUNT_TOKEN']);
      expect(call.args.slice(0, 2)).toEqual(['read', '--no-newline']);
    }
    expectNoLeak(result);
  });

  it('refuses items outside the agent vault before calling op or the Keychain', () => {
    for (const ref of ['op://Cadence/mcp-signing-key/private key', 'op://Personal/anthropic/credential', 'op://Private/x/y', 'a/b/c', 'item?attribute=otp']) {
      const result = run(['--env', `ANTHROPIC_API_KEY=${ref}`, '--', process.execPath, '-e', 'process.exit(0)']);
      expect(result.code, ref).toBe(3);
      expect(result.stderr).toContain('refused ANTHROPIC_API_KEY');
      expectNoLeak(result);
    }
    expect(opCalls()).toEqual([]);
    expect(existsSync(join(home, 'security-calls.log'))).toBe(false);
    const lines = ledgerLines(join(work, '.intent/acceptance/secret-access.jsonl'));
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.outcome === 'refused' && l.caller === 'node')).toBe(true);
    // A rejected reference is never logged or echoed.
    expect(lines.every((l) => l.item === null && l.field === null)).toBe(true);
    for (const line of lines) expect(JSON.stringify(line)).not.toMatch(/mcp-signing-key|Personal|Private|otp/);
  });

  it('refuses a raw key passed as the item reference and never logs or echoes it', () => {
    const longKey = `sk-ant-api03-${randomBytes(48).toString('base64url')}`;
    const secretPart = (ref) => ref.replace(/^op:\/\//, '').split('/').find((p) => p.length > 20);
    const refs = [secrets.anthropic, `${secrets.openai}/credential`, longKey, `op://${secrets.anthropic}/x/y`, `op://${AGENT_VAULT}/${secrets.openai}`, `ghp_${randomBytes(18).toString('hex')}`];
    for (const ref of refs) {
      const result = run(['--run', 'runs/raw', '--env', `ANTHROPIC_API_KEY=${ref}`, '--', process.execPath, '-e', 'process.exit(0)']);
      expect(result.code, ref).toBe(3);
      expect(result.stderr).toContain('refused ANTHROPIC_API_KEY');
      expect(result.stderr).not.toContain(secretPart(ref));
      expectNoLeak(result);
    }
    const ledger = readFileSync(join(work, 'runs/raw/events.jsonl'), 'utf8');
    for (const ref of refs) expect(ledger).not.toContain(secretPart(ref));
    expect(ledgerLines(join(work, 'runs/raw/events.jsonl')).every((l) => l.outcome === 'refused' && l.item === null)).toBe(true);
    expect(opCalls()).toEqual([]);
    expect(existsSync(join(home, 'security-calls.log'))).toBe(false);
  });

  it('refuses reserved environment names', () => {
    for (const name of ['PATH', 'NODE_OPTIONS', 'OP_SERVICE_ACCOUNT_TOKEN', 'DYLD_INSERT_LIBRARIES']) {
      const result = run(['--env', `${name}=anthropic-api-key`, '--', process.execPath, '-e', '0']);
      expect(result.code, name).toBe(3);
    }
    expect(opCalls()).toEqual([]);
  });

  it('stops without calling op when the Keychain has no token', () => {
    setup({ keychainMissing: true });
    const result = run(['--env', 'ANTHROPIC_API_KEY=anthropic-api-key', '--', process.execPath, join(fakebin, 'child.mjs'), join(work, 'child.json')]);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain('docs/qa/agent-secrets.md');
    expect(result.stderr).not.toContain('SecKeychain');
    expect(opCalls()).toEqual([]);
    expect(existsSync(join(work, 'child.json'))).toBe(false);
    const [line] = ledgerLines(join(work, '.intent/acceptance/secret-access.jsonl'));
    expect(line).toMatchObject({ outcome: 'failed', reason: 'token_missing', item: 'anthropic-api-key' });
    expectNoLeak(result);
  });

  it('does not relay op errors, even if op prints the token or a value', () => {
    setup({ leakOnError: 'openai-api-key/credential' });
    const result = run(['--env', 'ANTHROPIC_API_KEY=anthropic-api-key', '--env', 'OPENAI_API_KEY=openai-api-key', '--', process.execPath, join(fakebin, 'child.mjs'), join(work, 'child.json')]);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain('could not read "openai-api-key/credential"');
    expect(existsSync(join(work, 'child.json'))).toBe(false);
    expectNoLeak(result);
  });

  it('reports a missing item by name and does not start the child', () => {
    const result = run(['--env', 'ANTHROPIC_API_KEY=missing-item', '--', process.execPath, join(fakebin, 'child.mjs'), join(work, 'child.json')]);
    expect(result.code).toBe(5);
    expect(result.stderr).toContain('(item_not_found)');
    const [line] = ledgerLines(join(work, '.intent/acceptance/secret-access.jsonl'));
    expect(line).toMatchObject({ outcome: 'failed', reason: 'item_not_found', item: 'missing-item' });
    expectNoLeak(result);
  });

  it('defaults the caller to the command name and propagates the child exit code', () => {
    const result = run(['--run', 'runs/r2', '--env', 'ANTHROPIC_API_KEY=anthropic-api-key', '--', process.execPath, join(fakebin, 'child.mjs'), join(work, 'child.json')], { CHILD_EXIT: '7' });
    expect(result.code).toBe(7);
    expect(ledgerLines(join(work, 'runs/r2/events.jsonl'))[0]).toMatchObject({ outcome: 'ok', caller: 'node' });
    expectNoLeak(result);
  });

  it('--check prints vault and item names only and needs no item value', () => {
    const result = run(['--check', '--env', 'ANTHROPIC_API_KEY=anthropic-api-key']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`service account vaults: ${AGENT_VAULT}`);
    expect(result.stdout).toContain('ANTHROPIC_API_KEY=anthropic-api-key/credential: item present');
    expect(opCalls().some((call) => call.args[0] === 'read')).toBe(false);
    expectNoLeak(result);
  });

  it('--check fails when the service account can reach an owner vault', () => {
    setup({ vaults: [{ id: 'v1', name: AGENT_VAULT }, { id: 'v2', name: 'Cadence' }] });
    const result = run(['--check']);
    expect(result.code).toBe(6);
    expect(result.stderr).toContain('can reach other vaults (Cadence)');
    expectNoLeak(result);
  });

  it('rejects malformed command lines with usage errors', () => {
    expect(run(['--env', 'ANTHROPIC_API_KEY=anthropic-api-key']).code).toBe(2);
    expect(run(['--', 'node']).code).toBe(2);
    expect(run(['--env', 'A=x', '--env', 'A=y', '--', 'node']).code).toBe(2);
    expect(run(['--bogus', '--', 'node']).code).toBe(2);
    expect(opCalls()).toEqual([]);
  });
});

describe('agent-secret parsing', () => {
  it('parses references inside the agent vault', () => {
    expect(parseSecretRef('anthropic-api-key')).toEqual({ vault: AGENT_VAULT, item: 'anthropic-api-key', field: 'credential' });
    expect(parseSecretRef('openai-api-key/password')).toEqual({ vault: AGENT_VAULT, item: 'openai-api-key', field: 'password' });
    expect(parseSecretRef(`op://${AGENT_VAULT}/x/y`)).toEqual({ vault: AGENT_VAULT, item: 'x', field: 'y' });
  });

  it('refuses other vaults and malformed references', () => {
    for (const ref of ['op://Cadence/x/y', 'op://cadence agents/x/y', '', 'a/b/c', '../x', 'x?attribute=otp', 'op://Cadence Agents/x/y/z']) {
      expect(() => parseSecretRef(ref), ref).toThrow();
    }
  });

  it('refuses references shaped like a secret, and its message never contains the reference', () => {
    for (const ref of ['sk-ant-FAKE-0123456789abcdef01234567', 'sk-proj-FAKE-abcdef/credential', 'anthropic-api-key/sk-FAKE-0123456789', 'ops_FAKEFAKEFAKE1234', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123', `op://sb_secret_FAKE123456/x/y`]) {
      let error;
      try { parseSecretRef(ref); } catch (caught) { error = caught; }
      expect(error, ref).toMatchObject({ code: 'refused' });
      for (const part of ref.replace(/^op:\/\//, '').split('/')) if (part.length > 6) expect(error.message).not.toContain(part);
    }
    expect(parseSecretRef('anthropic-api-key')).toMatchObject({ item: 'anthropic-api-key' });
  });

  it('collects refusals instead of throwing so they reach the ledger', () => {
    const parsed = parseCli(['--env', 'A=op://Cadence/k/v', '--', 'node']);
    expect(parsed.refusals).toHaveLength(1);
    expect(parsed.specs).toHaveLength(0);
  });

  it('classifies op errors into fixed reasons', () => {
    expect(classifyOpError('"x" isn\'t an item in the "Cadence Agents" vault', 1)).toBe('item_not_found');
    expect(classifyOpError('"Cadence Agents" isn\'t a vault in this account', 1)).toBe('vault_not_accessible');
    expect(classifyOpError('invalid token', 1)).toBe('token_rejected');
    expect(classifyOpError('', 127)).toBe('op_not_found');
    expect(classifyOpError('something else', 1)).toBe('op_failed');
  });
});
