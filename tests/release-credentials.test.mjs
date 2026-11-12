// Ticket 325: release:credentials. Pure checks, plus the Cadence Release vault wrapper driven
// with a fake command runner. The tests prove that secret reads need the owner's approval and
// that no secret value reaches the ledger, stdout or a command's arguments.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  escapeOpFieldName,
  COMPLETE_MARKER, CredentialError, EXIT, PUBLIC_FIELDS, ReleaseVault, loadInventory, main, missingEntitlements, parseIdentities,
  rateExpiry, updaterFingerprint, verifyBackups, worst,
} from '../apps/desktop/scripts/release-credentials.mjs';

const inv = loadInventory();
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-11T12:00:00Z');

function minisignPublicKey(key = randomBytes(32)) {
  const line = Buffer.concat([Buffer.from('Ed'), randomBytes(8), key]).toString('base64');
  return { file: Buffer.from(`untrusted comment: minisign public key\n${line}\n`).toString('base64'), fingerprint: createHash('sha256').update(key).digest('hex') };
}

describe('inventory', () => {
  it('holds no secret values or email addresses', () => {
    const text = readFileSync(join(process.cwd(), 'apps/desktop/release-credentials.json'), 'utf8');
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(text).not.toMatch(/ops_|BEGIN PRIVATE KEY|[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}/);
    expect(inv.vault).toBe('Cadence Release');
    expect(inv.vault).not.toBe('Cadence Agents');
  });
});

describe('pure checks', () => {
  it('parses valid identities from security find-identity', () => {
    const text = '  1) E5C3E4FED17E892F690E47332429DD4F1B7E6046 "Developer ID Application: Example (HK26VT477G)"\n     1 valid identities found\n';
    expect(parseIdentities(text)).toEqual([{ sha1: 'E5C3E4FED17E892F690E47332429DD4F1B7E6046', name: 'Developer ID Application: Example (HK26VT477G)' }]);
  });

  it('computes the updater fingerprint of the 32-byte key', () => {
    const { file, fingerprint } = minisignPublicKey();
    expect(updaterFingerprint(file)).toBe(fingerprint);
    expect(() => updaterFingerprint(Buffer.from('nope').toString('base64'))).toThrow(CredentialError);
  });

  it('accepts wildcard grants and runtime resource entitlements, and names what a profile misses', () => {
    const granted = { 'com.apple.application-identifier': 'T.app', 'keychain-access-groups': ['T.*'] };
    const requested = { 'com.apple.application-identifier': 'T.app', 'keychain-access-groups': ['T.app'], 'com.apple.security.personal-information.location': true };
    expect(missingEntitlements(granted, requested, ['com.apple.security.personal-information.location'])).toEqual([]);
    expect(missingEntitlements({ 'keychain-access-groups': ['X.*'] }, { 'keychain-access-groups': ['T.app'] })).toEqual(['keychain-access-groups']);
    expect(missingEntitlements({}, { 'com.apple.security.personal-information.location': true })).toEqual(['com.apple.security.personal-information.location']);
  });

  it('warns 60 days before expiry and keeps the worst state', () => {
    expect(rateExpiry(new Date(NOW + 61 * DAY).toISOString(), NOW, 60)).toBe('ok');
    expect(rateExpiry(new Date(NOW + 59 * DAY).toISOString(), NOW, 60)).toBe('expiring');
    expect(rateExpiry(new Date(NOW - DAY).toISOString(), NOW, 60)).toBe('expired');
    expect(worst(['ok', 'expiring', 'ok'])).toBe('expiring');
    expect(worst(['expired', 'missing'])).toBe('missing');
  });
});

describe('Cadence Release vault', () => {
  let dir, runDir, calls, items, vaults, secret, failAttach;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-credentials-test-'));
    runDir = join(dir, 'run');
    mkdirSync(runDir);
    calls = [];
    secret = `secret-${randomBytes(12).toString('hex')}`;
    vaults = ['Cadence Release'];
    failAttach = null;
    items = {
      [inv.developerId.item]: { password: secret, fingerprint: 'ABC', complete: COMPLETE_MARKER },
      [inv.updater.item]: { password: secret, fingerprint: inv.updater.fingerprint, complete: COMPLETE_MARKER },
      [inv.notarization.passwordItem]: { password: secret, account: secret, complete: COMPLETE_MARKER },
      [inv.notarization.apiKeyItem]: { 'key id': 'KEYID00001', 'issuer id': secret, complete: COMPLETE_MARKER },
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const token = `ops_${'x'.repeat(300)}`;
  const run = (command, args, options = {}) => {
    const templateAt = args.indexOf('--template');
    const template = templateAt >= 0 && existsSync(args[templateAt + 1]) ? readFileSync(args[templateAt + 1], 'utf8') : undefined;
    calls.push({ command, args, input: options.input === undefined ? undefined : String(options.input), template });
    const ok = (text) => ({ status: 0, stdout: Buffer.from(text), stderr: '' });
    if (command === '/usr/bin/security' && args[0] === 'find-generic-password') return args.includes('-w') ? ok(`${token}\n`) : ok('');
    if (command !== 'op') return { status: 1, stdout: Buffer.alloc(0), stderr: '' };
    if (args[0] === 'vault') return ok(JSON.stringify(vaults.map((name) => ({ name }))));
    if (args[0] === 'item' && args[1] === 'list') return ok(JSON.stringify(Object.keys(items).map((title) => ({ title }))));
    if (args[0] === 'item' && args[1] === 'create') {
      // Like the real CLI under Node: a socket on stdin is ignored, so only --template works.
      if (template === undefined) return ok(JSON.stringify({ id: 'untitled', title: 'Untitled SecureNote' }));
      const parsed = JSON.parse(template);
      items[parsed.title] = Object.fromEntries(parsed.fields.map((field) => [field.label, field.value]));
      return ok(JSON.stringify({ id: parsed.title, title: parsed.title }));
    }
    if (args[0] === 'item' && args[1] === 'edit') {
      const [escaped, value] = args.at(-1).split(/\[\w+\]=/);
      // op treats an unescaped period as a section separator.
      if (escaped.split(/(?<!\\)\./).length > 2) return { status: 1, stdout: Buffer.alloc(0), stderr: '[ERROR] more than 1 unescaped period' };
      const name = escaped.replace(/\\\./g, '.');
      if (name === failAttach) return { status: 1, stdout: Buffer.alloc(0), stderr: '[ERROR] upload failed' };
      if (items[args[2]]) items[args[2]][name] = value;
      return ok('{}');
    }
    if (args[0] === 'read') {
      const [, , item, field] = /^op:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(args.at(-1));
      const value = items[item]?.[field];
      return value === undefined ? { status: 1, stdout: Buffer.alloc(0), stderr: "[ERROR] could not find item" } : ok(value);
    }
    return { status: 1, stdout: Buffer.alloc(0), stderr: '' };
  };
  const approve = () => writeFileSync(join(runDir, 'owner-approvals.json'), JSON.stringify({ 'release-secrets': { recorded_at: new Date(NOW - 1000).toISOString(), source: 'test' } }));
  const vault = () => new ReleaseVault(inv, { run, runDir, now: NOW, env: { PATH: process.env.PATH } });
  const ledger = () => readFileSync(join(runDir, 'events.jsonl'), 'utf8');

  it('reads public fields without approval and refuses secret fields without it', () => {
    expect(PUBLIC_FIELDS).toContain('fingerprint');
    const v = vault();
    expect(v.readField(inv.developerId.item, 'fingerprint')).toBe('ABC');
    expect(() => v.readField(inv.developerId.item, 'password')).toThrow(/owner's approval "release-secrets"/);
    expect(calls.some((call) => call.command === 'op' && call.args.at(-1).endsWith('/password'))).toBe(false);
    expect(ledger()).toContain('"outcome":"refused"');
    expect(ledger()).not.toContain(secret);
  });

  it('reads secret fields with approval and logs the access without the value', () => {
    approve();
    expect(vault().readField(inv.developerId.item, 'password')).toBe(secret);
    expect(ledger()).toMatch(/"field":"password","vault":"Cadence Release","env":null,"outcome":"ok"/);
    expect(ledger()).not.toContain(secret);
    expect(ledger()).not.toContain(token);
  });

  it('refuses a token that reaches any other vault', () => {
    vaults = ['Cadence Release', 'Cadence'];
    expect(() => vault().titles()).toThrow(/must reach only "Cadence Release"/);
  });

  it('creates backups from a private template file and never replaces an item', () => {
    approve();
    expect(() => vault().createItem(inv.developerId.item, [{ label: 'password', value: secret, secret: true }])).toThrow(/already exists/);
    vault().createItem('Cadence new item', [{ label: 'password', value: secret, secret: true }, { label: 'fingerprint', value: 'F' }], { 'identity.p12': '/tmp/identity.p12' });
    const create = calls.find((call) => call.args[0] === 'item' && call.args[1] === 'create');
    expect(create.template).toContain(secret);
    expect(existsSync(create.args[create.args.indexOf('--template') + 1])).toBe(false);
    for (const call of calls) expect(call.args.join(' ')).not.toContain(secret);
    expect(calls.find((call) => call.args[1] === 'edit').args).toContain('identity\\.p12[file]=/tmp/identity.p12');
    expect(ledger()).not.toContain(secret);
  });

  it('reports an item whose attachment failed as incomplete', () => {
    approve();
    failAttach = 'identity.p12';
    const title = inv.developerId.item;
    delete items[title];
    expect(() => vault().createItem(title, [{ label: 'password', value: secret, secret: true }, { label: 'fingerprint', value: 'ABC' }], { 'identity.p12': '/tmp/identity.p12' })).toThrow(/attaching identity.p12 failed/);
    expect(items[title].complete).toBeUndefined();
    expect(verifyBackups(inv, vault(), 'ABC')[0]).toMatchObject({ state: 'missing', detail: expect.stringMatching(/^incomplete/) });
  });

  it('marks an item complete only after every attachment is stored', () => {
    approve();
    vault().createItem('Cadence new item', [{ label: 'fingerprint', value: 'F' }], { 'identity.p12': '/tmp/identity.p12' });
    expect(items['Cadence new item'].complete).toBe(COMPLETE_MARKER);
    const edits = calls.filter((call) => call.args[1] === 'edit').map((call) => call.args.at(-1));
    expect(edits).toEqual(['identity\\.p12[file]=/tmp/identity.p12', `complete[text]=${COMPLETE_MARKER}`]);
  });

  it('verifies backups by fingerprint without reading a secret', () => {
    const rows = verifyBackups(inv, vault(), 'ABC');
    expect(rows.map((row) => row.state)).toEqual(['ok', 'ok', 'ok']);
    expect(verifyBackups(inv, vault(), 'DEF')[0]).toMatchObject({ state: 'missing', detail: 'fingerprint differs from what is installed' });
    expect(calls.filter((call) => call.args[0] === 'read').every((call) => /\/(fingerprint|complete)$/.test(call.args.at(-1)))).toBe(true);
  });

  it('requires the API-key backup even when the previous password backup exists', () => {
    delete items[inv.notarization.apiKeyItem];
    expect(verifyBackups(inv, vault(), 'ABC').at(-1)).toMatchObject({
      item: inv.notarization.apiKeyItem, state: 'missing', detail: 'item missing',
    });
  });

  it('restore and backup stop at the approval gate', async () => {
    const err = [];
    const code = await main(['restore', '--run', runDir], { out: () => {}, err: (line) => err.push(line), deps: { run, now: NOW } });
    expect(code).toBe(EXIT.REFUSED);
    expect(err.join('\n')).toMatch(/owner's approval/);
  });

  it('reports a missing vault token to the preflight as missing, not as an error', async () => {
    const out = [];
    const noToken = (command, args, options) => (command === '/usr/bin/security' ? { status: 44, stdout: Buffer.alloc(0), stderr: '' } : run(command, args, options));
    const code = await main(['probe', 'vault'], { out: (line) => out.push(line), err: () => {}, deps: { run: noToken } });
    expect(code).toBe(21);
    expect(JSON.parse(out.at(-1)).detail).toMatch(/no Cadence Release service-account token/);
  });
});

describe('escapeOpFieldName', () => {
  it('escapes periods, equals signs and backslashes for op assignments', () => {
    expect(escapeOpFieldName('identity.p12')).toBe('identity\\.p12');
    expect(escapeOpFieldName('a=b\\c')).toBe('a\\=b\\\\c');
    expect(escapeOpFieldName('AuthKey')).toBe('AuthKey');
  });
});
