#!/usr/bin/env node
// Ticket 325: status, backup and restore of the credentials that sign and notarize
// Cadence for Mac. The inventory is apps/desktop/release-credentials.json. The runbook is
// docs/DESKTOP_RELEASE.md, "Signing credentials".
//
//   npm run release:credentials -- status [--json]
//   npm run release:credentials -- probe identity|profile|updater|notarization|vault|backups
//   npm run release:credentials -- verify-backups
//   npm run release:credentials -- restore --run <run-dir> [--only identity,notarization,api-key,updater]
//   npm run release:credentials -- backup --run <run-dir> --only identity|notarization|updater
//   npm run release:credentials -- backup --run <run-dir> --only api-key --file <AuthKey.p8> --key-id <id> --issuer <id>
//
// status, probe and verify-backups read no secret value. verify-backups reads only the
// fields in PUBLIC_FIELDS from the "Cadence Release" vault. restore and backup read or
// write secret values. They need the owner's approval "release-secrets" in the run folder:
//   node scripts/acceptance/access/record.mjs record --scope run --run-dir <run-dir> \
//     --id release-secrets --source "owner approved in chat"
//
// Secret values stay in memory or in a mode 0700 temporary folder that is removed on exit.
// They never reach stdout, stderr or the ledger. Two macOS commands only take a passphrase
// as an argument: `security export -P` and `security import -P`. The passphrase protects the
// .p12 file at rest; it is visible to local processes for the length of that command.
//
// Every vault access appends one line to <run-dir>/events.jsonl, or to
// .intent/acceptance/secret-access.jsonl without --run: item, field, outcome. Never a value.
//
// Exit codes: 0 ok; 2 usage; 3 refused (no approval, wrong vault scope, item exists);
// 4 vault token missing; 5 vault or command failure; 20 something expired; 21 missing or
// mismatched.
import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyOpError, opEnv, recordAccess } from '../../../scripts/acceptance/agent-secret.mjs';
import { APPROVALS_FILE, entryState } from '../../../scripts/acceptance/access/record.mjs';
import { PROBE, finish, parseFlags } from '../../../scripts/acceptance/access/lib.mjs';
import { isCliEntry } from '../../../scripts/acceptance/cli-entry.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const INVENTORY_PATH = join(REPO, 'apps/desktop/release-credentials.json');
export const PUBLIC_FIELDS = Object.freeze(['fingerprint', 'expires', 'key id', 'issuer id', 'complete']);
// Set on an item only after every field and attachment is stored; verify-backups requires it.
export const COMPLETE_MARKER = 'yes';
const P8_HEADER = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
export const EXIT = Object.freeze({ OK: 0, USAGE: 2, REFUSED: 3, TOKEN: 4, FAILED: 5, EXPIRED: 20, MISSING: 21 });
const LOGIN_KEYCHAIN = '~/Library/Keychains/login.keychain-db';
const DAY_MS = 86_400_000;
const DEFAULT_LEDGER = join('.intent', 'acceptance', 'secret-access.jsonl');
const RESTORE_PARTS = ['identity', 'notarization', 'api-key', 'updater'];
const KEYCHAIN_VALUE = /^[\x21-\x7e]{1,512}$/;

export class CredentialError extends Error {
  constructor(exit, message) { super(message); this.exit = exit; }
}

export function loadInventory(path = INVENTORY_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export const expandHome = (path, home = homedir()) => (path.startsWith('~/') ? join(home, path.slice(2)) : path);

/** Runs a command. Output stays in memory as Buffers. */
export function runCommand(command, args, { env = process.env, input, timeoutMs = 120_000 } = {}) {
  const result = spawnSync(command, args, { env, input, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 << 20, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  return { status: result.status ?? (result.error ? 127 : 1), stdout: result.stdout ?? Buffer.alloc(0), stderr: String(result.stderr ?? ''), error: result.error?.code ?? null };
}

// ---------- pure helpers ----------

/** `security find-identity -v -p codesigning` lines → [{ sha1, name }]. */
export function parseIdentities(text) {
  return [...String(text).matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/gm)].map((m) => ({ sha1: m[1], name: m[2] }));
}

/** PEM blocks from `security find-certificate -a -p` → [{ sha1, notAfter, der }]. */
export function parseCertificates(text) {
  return [...String(text).matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((m) => {
    const cert = new X509Certificate(m[0]);
    return { sha1: cert.fingerprint.replace(/:/g, ''), notAfter: new Date(cert.validTo).toISOString(), serial: cert.serialNumber };
  });
}

export const derSha1 = (der) => createHash('sha1').update(der).digest('hex').toUpperCase();

/** SHA-256 of the 32-byte Ed25519 key inside a Tauri (minisign) public-key file. */
export function updaterFingerprint(fileText) {
  const lines = Buffer.from(String(fileText).trim(), 'base64').toString('utf8').split(/\r?\n/);
  const key = Buffer.from((lines[1] ?? '').trim(), 'base64');
  if (key.length !== 42) throw new CredentialError(EXIT.MISSING, 'the updater public key file is not a minisign public key');
  return createHash('sha256').update(key.subarray(10)).digest('hex');
}

const allows = (pattern, value) => typeof pattern === 'string' && (pattern === value || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))));

/** Same rule as verify-entitlements.py: the profile grants exact values or a trailing wildcard. */
export function missingEntitlements(granted, requested, runtimeResource = []) {
  return Object.entries(requested).filter(([key, value]) => {
    if (runtimeResource.includes(key)) return value !== true;
    if (!(key in granted)) return true;
    const pattern = granted[key];
    if (Array.isArray(value)) {
      const patterns = Array.isArray(pattern) ? pattern : [pattern];
      return !value.every((item) => typeof item === 'string' && patterns.some((p) => allows(p, item)));
    }
    return typeof value === 'string' ? !allows(pattern, value) : pattern !== value;
  }).map(([key]) => key);
}

/** 'ok', 'expiring' (within warnDays) or 'expired'. */
export function rateExpiry(expiresAt, now, warnDays) {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at) || at <= now) return 'expired';
  return at - now <= warnDays * DAY_MS ? 'expiring' : 'ok';
}

const daysLeft = (expiresAt, now) => Math.floor((Date.parse(expiresAt) - now) / DAY_MS);

/** Combines check states: the worst state wins. */
export function worst(states) {
  const order = ['ok', 'expiring', 'expired', 'missing'];
  return states.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), 'ok');
}

const stateExit = (state) => ({ ok: EXIT.OK, expiring: EXIT.OK, expired: EXIT.EXPIRED, missing: EXIT.MISSING }[state]);
const stateProbe = (state) => ({ ok: PROBE.PRESENT, expiring: PROBE.PRESENT, expired: PROBE.EXPIRED, missing: PROBE.MISSING }[state]);

// ---------- local checks (no secret values) ----------

export function checkIdentity(inv, { run = runCommand, now = Date.now() } = {}) {
  const valid = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
  if (valid.status !== 0) return { id: 'identity', state: 'missing', detail: 'security find-identity failed' };
  const matches = parseIdentities(valid.stdout).filter((entry) => entry.name === inv.developerId.identity);
  if (matches.length === 0) return { id: 'identity', state: 'missing', detail: 'no valid Developer ID identity with the expected name in the keychain search list' };
  const certs = parseCertificates(run('/usr/bin/security', ['find-certificate', '-a', '-c', inv.developerId.identity, '-p']).stdout);
  const current = certs.filter((cert) => matches.some((m) => m.sha1 === cert.sha1)).sort((a, b) => b.notAfter.localeCompare(a.notAfter))[0];
  if (!current) return { id: 'identity', state: 'missing', detail: 'identity found but its certificate could not be read' };
  const state = rateExpiry(current.notAfter, now, inv.warnDays);
  const extra = matches.length > 1 ? `; ${matches.length} valid identities share the name` : '';
  return { id: 'identity', state, sha1: current.sha1, expiresAt: current.notAfter, detail: `SHA-1 ${current.sha1}, ${daysLeft(current.notAfter, now)} days left${extra}` };
}

function readProfile(file, run) {
  const decoded = run('/usr/bin/security', ['cms', '-D', '-i', file]);
  if (decoded.status !== 0) return null;
  const extract = (key, format) => {
    const result = run('/usr/bin/plutil', ['-extract', key, format, '-o', '-', '-'], { input: decoded.stdout });
    return result.status === 0 ? result.stdout.toString('utf8').trim() : null;
  };
  const count = Number(extract('DeveloperCertificates', 'raw'));
  const certSha1s = [];
  for (let i = 0; i < (Number.isInteger(count) ? count : 0); i += 1) {
    const b64 = extract(`DeveloperCertificates.${i}`, 'raw');
    if (b64) certSha1s.push(derSha1(Buffer.from(b64, 'base64')));
  }
  let entitlements = null;
  try { entitlements = JSON.parse(extract('Entitlements', 'json') ?? 'null'); } catch { entitlements = null; }
  return { name: extract('Name', 'raw'), team: extract('TeamIdentifier.0', 'raw'), expiresAt: extract('ExpirationDate', 'raw'), certSha1s, entitlements };
}

export function checkProfile(inv, identitySha1, { run = runCommand, now = Date.now(), home = homedir(), exists = existsSync } = {}) {
  const file = expandHome(inv.profile.path, home);
  if (!exists(file)) return { id: 'profile', state: 'missing', detail: 'profile file missing' };
  const profile = readProfile(file, run);
  if (!profile?.entitlements) return { id: 'profile', state: 'missing', detail: 'profile unreadable' };
  const problems = [];
  if (profile.team !== inv.developerId.team) problems.push('wrong team');
  if (profile.entitlements['com.apple.application-identifier'] !== inv.profile.applicationIdentifier) problems.push('wrong app identifier');
  if (identitySha1 && !profile.certSha1s.includes(identitySha1)) problems.push('does not list the installed identity');
  const plist = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(REPO, inv.profile.entitlements)]);
  let requested = null;
  try { requested = JSON.parse(plist.stdout.toString('utf8')); } catch { requested = null; }
  if (!requested) problems.push('Entitlements.plist unreadable');
  else {
    const missing = missingEntitlements(profile.entitlements, requested, inv.profile.runtimeResourceEntitlements);
    if (missing.length) problems.push(`does not authorize ${missing.join(', ')}`);
  }
  if (problems.length) return { id: 'profile', state: 'missing', detail: `"${profile.name}" ${problems.join('; ')}` };
  const state = rateExpiry(profile.expiresAt, now, inv.warnDays);
  return { id: 'profile', state, expiresAt: profile.expiresAt, detail: `"${profile.name}" lists the identity, expires ${profile.expiresAt.slice(0, 10)}` };
}

const keychainItemPresent = (run, service, account) =>
  run('/usr/bin/security', ['find-generic-password', '-s', service, ...(account ? ['-a', account] : [])]).status === 0;

export function checkUpdater(inv, { run = runCommand, home = homedir(), exists = existsSync, readFile = (p) => readFileSync(p, 'utf8'), mode = (p) => statSync(p).mode & 0o777 } = {}) {
  const pub = expandHome(inv.updater.publicKey, home);
  const key = expandHome(inv.updater.privateKey, home);
  const problems = [];
  if (!exists(pub)) problems.push('public key missing');
  else {
    try { if (updaterFingerprint(readFile(pub)) !== inv.updater.fingerprint) problems.push('public key fingerprint differs from the inventory'); } catch { problems.push('public key unreadable'); }
  }
  if (!exists(key)) problems.push('private key missing');
  else if (mode(key) & 0o077) problems.push('private key readable by others (expected mode 0600)');
  if (!keychainItemPresent(run, inv.updater.keychain.service, inv.updater.keychain.account)) problems.push('password missing from the login keychain');
  return problems.length
    ? { id: 'updater', state: 'missing', detail: problems.join('; ') }
    : { id: 'updater', state: 'ok', detail: `key ${inv.updater.fingerprint.slice(0, 8)}…, password in the keychain` };
}

export function checkNotarization(inv, { run = runCommand, home = homedir(), exists = existsSync } = {}) {
  const n = inv.notarization;
  if (n.method === 'api-key') {
    const file = expandHome(n.apiKeyPath, home);
    const ids = join(dirname(file), 'api-key.json');
    if (!exists(file)) return { id: 'notarization', state: 'missing', detail: 'App Store Connect API key file missing' };
    if (!exists(ids)) return { id: 'notarization', state: 'missing', detail: 'api-key.json (key id and issuer id) missing next to the key' };
    return { id: 'notarization', state: 'ok', detail: 'App Store Connect API key present' };
  }
  return keychainItemPresent(run, n.passwordKeychainService)
    ? { id: 'notarization', state: 'ok', detail: 'app-specific password in the keychain' }
    : { id: 'notarization', state: 'missing', detail: 'app-specific password missing from the login keychain' };
}

export function localChecks(inv, deps = {}) {
  const identity = checkIdentity(inv, deps);
  return [identity, checkProfile(inv, identity.sha1, deps), checkNotarization(inv, deps), checkUpdater(inv, deps)];
}

// ---------- the Cadence Release vault ----------

export class ReleaseVault {
  constructor(inv, { run = runCommand, env = process.env, cwd = process.cwd(), runDir = null, caller = 'release-credentials', now = Date.now(), readText = (p) => readFileSync(p, 'utf8') } = {}) {
    Object.assign(this, { inv, run, env, cwd, runDir, caller, now, readText });
    this.ledger = runDir ? join(runDir, 'events.jsonl') : resolve(cwd, DEFAULT_LEDGER);
    this.token = null;
    this.approved = null;
  }

  log(item, field, outcome, reason) {
    recordAccess(this.ledger, { caller: this.caller, vault: this.inv.vault, item, field, env: null, outcome, ...(reason ? { reason } : {}) });
  }

  isApproved() {
    if (this.approved !== null) return this.approved;
    if (!this.runDir) return (this.approved = false);
    let data = {};
    try { data = JSON.parse(this.readText(join(this.runDir, APPROVALS_FILE))); } catch { data = {}; }
    return (this.approved = entryState(data?.[this.inv.approvalId], { now: this.now }) === 'present');
  }

  requireApproval(what) {
    if (!this.isApproved()) {
      this.log(null, null, 'refused', 'no_owner_approval');
      throw new CredentialError(EXIT.REFUSED, `${what} needs the owner's approval "${this.inv.approvalId}" recorded in the run folder (--run)`);
    }
  }

  op(args, { input } = {}) {
    if (!this.token) {
      const { service, account } = this.inv.tokenKeychain;
      const result = this.run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w']);
      const token = result.status === 0 ? result.stdout.toString('utf8').replace(/\r?\n$/, '') : '';
      if (!token) throw new CredentialError(EXIT.TOKEN, `no Cadence Release service-account token in the keychain (service "${service}"). See docs/qa/agent-secrets.md, "Cadence Release vault".`);
      this.token = token;
      this.checkScope();
    }
    return this.run('op', args, { env: opEnv(this.env, this.token), input });
  }

  checkScope() {
    const result = this.run('op', ['vault', 'list', '--format', 'json'], { env: opEnv(this.env, this.token) });
    if (result.status !== 0) throw new CredentialError(EXIT.FAILED, `op vault list failed (${classifyOpError(result.stderr, result.status)})`);
    let names = null;
    try { names = JSON.parse(result.stdout.toString('utf8')).map((v) => v.name); } catch { names = null; }
    if (!names) throw new CredentialError(EXIT.FAILED, 'op vault list returned unreadable output');
    if (names.length !== 1 || names[0] !== this.inv.vault) {
      throw new CredentialError(EXIT.REFUSED, `the service account must reach only "${this.inv.vault}" (it reaches ${names.length} vaults)`);
    }
  }

  titles() {
    const result = this.op(['item', 'list', '--vault', this.inv.vault, '--format', 'json']);
    if (result.status !== 0) throw new CredentialError(EXIT.FAILED, `op item list failed (${classifyOpError(result.stderr, result.status)})`);
    return JSON.parse(result.stdout.toString('utf8')).map((item) => item.title);
  }

  ref(item, field) {
    return `op://${this.inv.vault}/${item}/${field}`;
  }

  /** Reads one field into memory. Fields outside PUBLIC_FIELDS need the owner's approval. */
  readField(item, field) {
    if (!PUBLIC_FIELDS.includes(field)) this.requireApproval(`reading "${item}/${field}"`);
    const result = this.op(['read', '--no-newline', this.ref(item, field)]);
    const value = result.status === 0 ? result.stdout.toString('utf8') : '';
    if (!value) {
      const reason = result.status === 0 ? 'empty_value' : classifyOpError(result.stderr, result.status);
      this.log(item, field, 'failed', reason);
      throw new CredentialError(reason === 'item_not_found' || reason === 'field_not_found' ? EXIT.MISSING : EXIT.FAILED, `could not read "${item}/${field}" (${reason})`);
    }
    this.log(item, field, 'ok');
    return value;
  }

  /** Writes one attached file to `path` (mode 0600). Always needs approval. */
  readFile(item, file, path) {
    this.requireApproval(`reading "${item}/${file}"`);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const result = this.op(['read', '--force', '--out-file', path, this.ref(item, file)]);
    if (result.status !== 0 || !existsSync(path)) {
      const reason = classifyOpError(result.stderr, result.status);
      this.log(item, file, 'failed', reason);
      throw new CredentialError(EXIT.FAILED, `could not read "${item}/${file}" (${reason})`);
    }
    chmodSync(path, 0o600);
    this.log(item, file, 'ok');
  }

  /** Creates a Secure Note item from fields, then attaches files. Refuses to replace an item. */
  createItem(title, fields, files = {}) {
    this.requireApproval(`creating "${title}"`);
    if (this.titles().includes(title)) {
      this.log(title, null, 'refused', 'item_exists');
      throw new CredentialError(EXIT.REFUSED, `"${title}" already exists in "${this.inv.vault}"; backups are never overwritten. Rename the old item first.`);
    }
    const template = { title, category: 'SECURE_NOTE', fields: fields.map(({ label, value, secret }) => ({ id: label.replace(/\W+/g, '_'), label, type: secret ? 'CONCEALED' : 'STRING', value })) };
    const created = this.op(['item', 'create', '--vault', this.inv.vault, '--format', 'json', '-'], { input: JSON.stringify(template) });
    if (created.status !== 0) {
      this.log(title, null, 'failed', classifyOpError(created.stderr, created.status));
      throw new CredentialError(EXIT.FAILED, `op item create failed (${classifyOpError(created.stderr, created.status)})`);
    }
    for (const field of fields) this.log(title, field.label, 'written');
    const id = JSON.parse(created.stdout.toString('utf8')).id;
    for (const [name, path] of Object.entries(files)) {
      const edited = this.op(['item', 'edit', id, '--vault', this.inv.vault, `${name}[file]=${path}`]);
      if (edited.status !== 0) {
        this.log(title, name, 'failed', classifyOpError(edited.stderr, edited.status));
        throw new CredentialError(EXIT.FAILED, `attaching ${name} failed (${classifyOpError(edited.stderr, edited.status)}); the item exists without it`);
      }
      this.log(title, name, 'written');
    }
    const marked = this.op(['item', 'edit', id, '--vault', this.inv.vault, `complete[text]=${COMPLETE_MARKER}`]);
    if (marked.status !== 0) {
      this.log(title, 'complete', 'failed', classifyOpError(marked.stderr, marked.status));
      throw new CredentialError(EXIT.FAILED, `marking "${title}" complete failed; verify-backups will report it as incomplete`);
    }
    this.log(title, 'complete', 'written');
  }
}

// ---------- verify-backups ----------

export function verifyBackups(inv, vault, identitySha1) {
  const titles = vault.titles();
  const rows = [];
  const expect = (item, fingerprint) => {
    if (!titles.includes(item)) return rows.push({ item, state: 'missing', detail: 'item missing' });
    let complete = '';
    try { complete = vault.readField(item, 'complete').trim(); } catch { complete = ''; }
    if (complete !== COMPLETE_MARKER) return rows.push({ item, state: 'missing', detail: 'incomplete: no "complete" marker, so an attachment or field may be missing' });
    if (!fingerprint) return rows.push({ item, state: 'ok', detail: 'item complete' });
    let stored = '';
    try { stored = vault.readField(item, 'fingerprint').trim(); } catch { stored = ''; }
    if (!stored) return rows.push({ item, state: 'missing', detail: 'no fingerprint field' });
    return rows.push(stored.toUpperCase() === fingerprint.toUpperCase()
      ? { item, state: 'ok', detail: 'fingerprint matches' }
      : { item, state: 'missing', detail: 'fingerprint differs from what is installed' });
  };
  expect(inv.developerId.item, identitySha1 ?? null);
  expect(inv.updater.item, inv.updater.fingerprint);
  expect(inv.notarization.method === 'api-key' ? inv.notarization.apiKeyItem : inv.notarization.passwordItem, null);
  return rows;
}

// ---------- restore and backup ----------

function privateTemp() {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-release-credentials-'));
  chmodSync(dir, 0o700);
  process.once('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  return dir;
}

/** Adds a generic password through `security -i` on stdin, never argv. Refuses to replace one. */
function addKeychainPassword(run, service, account, value) {
  if (!KEYCHAIN_VALUE.test(value) || value.includes('"')) throw new CredentialError(EXIT.FAILED, `the value for "${service}" has characters the keychain command line cannot carry`);
  if (keychainItemPresent(run, service, account)) return 'already present';
  const quote = (text) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const line = `add-generic-password -s ${quote(service)} -a ${quote(account)} -T /usr/bin/security -w ${quote(value)}\n`;
  const result = run('/usr/bin/security', ['-i'], { input: line });
  if (result.status !== 0 || !keychainItemPresent(run, service, account)) throw new CredentialError(EXIT.FAILED, `could not add "${service}" to the login keychain`);
  return 'added';
}

function restoreFile(vault, item, file, target, run) {
  if (existsSync(target)) return 'already present';
  vault.readFile(item, file, target);
  return 'restored';
}

export function restore(inv, vault, parts, { run = runCommand, home = homedir(), say }) {
  vault.requireApproval('restore');
  const temp = privateTemp();
  if (parts.includes('identity')) {
    if (checkIdentity(inv, { run }).state !== 'missing') say('identity: already present');
    else {
      const p12 = join(temp, inv.developerId.file);
      vault.readFile(inv.developerId.item, inv.developerId.file, p12);
      const passphrase = vault.readField(inv.developerId.item, 'password');
      const result = run('/usr/bin/security', ['import', p12, '-k', expandHome(LOGIN_KEYCHAIN, home), '-f', 'pkcs12', '-P', passphrase, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
      rmSync(p12, { force: true });
      if (result.status !== 0) throw new CredentialError(EXIT.FAILED, 'security import of the Developer ID identity failed');
      const after = checkIdentity(inv, { run });
      if (after.state === 'missing') throw new CredentialError(EXIT.FAILED, 'the identity was imported but is not valid; check the Developer ID G2 intermediate');
      say(`identity: restored (${after.detail})`);
    }
  }
  if (parts.includes('notarization') && inv.notarization.method !== 'api-key') {
    const item = inv.notarization.passwordItem;
    const account = vault.readField(item, 'account');
    say(`notarization: ${addKeychainPassword(run, inv.notarization.passwordKeychainService, account, vault.readField(item, 'password'))}`);
  }
  if (parts.includes('api-key') && inv.notarization.method === 'api-key') {
    const target = expandHome(inv.notarization.apiKeyPath, home);
    const state = restoreFile(vault, inv.notarization.apiKeyItem, inv.notarization.apiKeyFile, target, run);
    const ids = join(dirname(target), 'api-key.json');
    if (!existsSync(ids)) {
      const content = { keyId: vault.readField(inv.notarization.apiKeyItem, 'key id').trim(), issuerId: vault.readField(inv.notarization.apiKeyItem, 'issuer id').trim() };
      writePrivate(ids, `${JSON.stringify(content, null, 2)}\n`);
    }
    say(`api-key: ${state}`);
  }
  if (parts.includes('updater')) {
    const [keyFile, pubFile] = inv.updater.files;
    const keyState = restoreFile(vault, inv.updater.item, keyFile, expandHome(inv.updater.privateKey, home), run);
    restoreFile(vault, inv.updater.item, pubFile, expandHome(inv.updater.publicKey, home), run);
    if (updaterFingerprint(readFileSync(expandHome(inv.updater.publicKey, home), 'utf8')) !== inv.updater.fingerprint) {
      throw new CredentialError(EXIT.MISSING, 'the restored updater public key does not match the inventory fingerprint');
    }
    const { service, account } = inv.updater.keychain;
    say(`updater: key ${keyState}; password ${addKeychainPassword(run, service, account, vault.readField(inv.updater.item, 'password'))}`);
  }
}

function writePrivate(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  spawnSync('/bin/sh', ['-c', 'umask 077 && cat > "$1"', 'sh', temp], { input: text });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

function keychainPassword(run, service, account) {
  const result = run('/usr/bin/security', ['find-generic-password', '-s', service, ...(account ? ['-a', account] : []), '-w']);
  const value = result.status === 0 ? result.stdout.toString('utf8').replace(/\r?\n$/, '') : '';
  if (!value) throw new CredentialError(EXIT.MISSING, `"${service}" is not in the login keychain`);
  return value;
}

function keychainAccount(run, service) {
  const result = run('/usr/bin/security', ['find-generic-password', '-s', service]);
  const match = /"acct"<blob>="([^"]*)"/.exec(result.stdout.toString('utf8'));
  if (!match) throw new CredentialError(EXIT.MISSING, `"${service}" is not in the login keychain`);
  return match[1];
}

export function backup(inv, vault, part, { run = runCommand, home = homedir(), flags = {}, say }) {
  vault.requireApproval('backup');
  if (part === 'identity') {
    const identity = checkIdentity(inv, { run });
    if (identity.state === 'missing') throw new CredentialError(EXIT.MISSING, `identity: ${identity.detail}`);
    // `security export -t identities` exports every identity in the keychain, so there must be exactly one.
    const all = parseIdentities(run('/usr/bin/security', ['find-identity', '-p', 'codesigning', expandHome(LOGIN_KEYCHAIN, home)]).stdout);
    const distinct = new Set(all.map((entry) => entry.sha1));
    if (distinct.size !== 1) throw new CredentialError(EXIT.REFUSED, `the login keychain holds ${distinct.size} code-signing identities; export the Developer ID one from Keychain Access instead`);
    const temp = privateTemp();
    const p12 = join(temp, inv.developerId.file);
    const passphrase = randomBytes(24).toString('base64url');
    say('identity: macOS may ask for the login keychain password to allow the export (owner step)');
    const result = run('/usr/bin/security', ['export', '-k', expandHome(LOGIN_KEYCHAIN, home), '-t', 'identities', '-f', 'pkcs12', '-P', passphrase, '-o', p12], { timeoutMs: 300_000 });
    if (result.status !== 0 || !existsSync(p12)) throw new CredentialError(EXIT.FAILED, 'security export failed or was not allowed');
    vault.createItem(inv.developerId.item, [
      { label: 'password', value: passphrase, secret: true },
      { label: 'fingerprint', value: identity.sha1 },
      { label: 'expires', value: identity.expiresAt.slice(0, 10) },
    ], { [inv.developerId.file]: p12 });
    rmSync(p12, { force: true });
    say(`identity: stored as "${inv.developerId.item}"`);
    return;
  }
  if (part === 'notarization') {
    const service = inv.notarization.passwordKeychainService;
    vault.createItem(inv.notarization.passwordItem, [
      { label: 'password', value: keychainPassword(run, service), secret: true },
      { label: 'account', value: keychainAccount(run, service), secret: true },
    ]);
    say(`notarization: stored as "${inv.notarization.passwordItem}"`);
    return;
  }
  if (part === 'updater') {
    const { service, account } = inv.updater.keychain;
    const pub = expandHome(inv.updater.publicKey, home);
    if (updaterFingerprint(readFileSync(pub, 'utf8')) !== inv.updater.fingerprint) throw new CredentialError(EXIT.MISSING, 'the updater public key does not match the inventory fingerprint');
    vault.createItem(inv.updater.item, [
      { label: 'password', value: keychainPassword(run, service, account), secret: true },
      { label: 'fingerprint', value: inv.updater.fingerprint },
    ], { [inv.updater.files[0]]: expandHome(inv.updater.privateKey, home), [inv.updater.files[1]]: pub });
    say(`updater: stored as "${inv.updater.item}"`);
    return;
  }
  if (part === 'api-key') {
    if (!flags.file || !/^[A-Z0-9]{10}$/.test(flags['key-id'] ?? '') || !/^[0-9a-f-]{36}$/.test(flags.issuer ?? '')) {
      throw new CredentialError(EXIT.USAGE, 'api-key needs --file <AuthKey.p8> --key-id <10 characters> --issuer <issuer UUID>');
    }
    const source = resolve(flags.file);
    if (!readFileSync(source, 'utf8').includes(P8_HEADER)) throw new CredentialError(EXIT.USAGE, 'the file is not an App Store Connect .p8 key');
    vault.createItem(inv.notarization.apiKeyItem, [
      { label: 'key id', value: flags['key-id'] },
      { label: 'issuer id', value: flags.issuer },
    ], { [inv.notarization.apiKeyFile]: source });
    const target = expandHome(inv.notarization.apiKeyPath, home);
    writePrivate(target, readFileSync(source, 'utf8'));
    writePrivate(join(dirname(target), 'api-key.json'), `${JSON.stringify({ keyId: flags['key-id'], issuerId: flags.issuer }, null, 2)}\n`);
    say(`api-key: stored as "${inv.notarization.apiKeyItem}" and installed at ${inv.notarization.apiKeyPath}; delete the downloaded copy`);
    return;
  }
  throw new CredentialError(EXIT.USAGE, 'backup --only must be identity, notarization, updater or api-key');
}


function probe(inv, name, { out, deps, vaultFor, usage }) {
  try {
    if (name === 'vault') { vaultFor().titles(); return finish(out, PROBE.PRESENT, { detail: `token present; reaches only "${inv.vault}"` }); }
    if (name === 'backups') {
      const rows = verifyBackups(inv, vaultFor(), checkIdentity(inv, deps).sha1);
      const bad = rows.filter((row) => row.state !== 'ok');
      return finish(out, bad.length ? PROBE.MISSING : PROBE.PRESENT, { detail: bad.length ? bad.map((row) => `${row.item}: ${row.detail}`).join('; ') : 'all backups match' });
    }
    const check = Object.fromEntries(localChecks(inv, deps).map((entry) => [entry.id, entry]))[name];
    if (!check) return usage();
    return finish(out, stateProbe(check.state), { detail: `${check.state}: ${check.detail}`, expires_at: check.expiresAt });
  } catch (error) {
    if (!(error instanceof CredentialError)) throw error;
    const code = error.exit === EXIT.TOKEN || error.exit === EXIT.MISSING ? PROBE.MISSING : error.exit === EXIT.REFUSED ? PROBE.EXPIRED : PROBE.ERROR;
    return finish(out, code, { detail: error.message });
  }
}

// ---------- CLI ----------

export async function main(argv, { out = (line) => process.stdout.write(`${line}\n`), err = (line) => process.stderr.write(`release-credentials: ${line}\n`), deps = {}, inventory = null } = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['run', 'only', 'file', 'key-id', 'issuer'], flags: ['json'] }); } catch { flags = null; }
  const usage = () => { err('usage: status [--json] | probe <check> | verify-backups | restore --run <dir> [--only …] | backup --run <dir> --only <part> (see the file header)'); return EXIT.USAGE; };
  if (!flags || !command) return usage();
  const inv = inventory ?? loadInventory();
  const vaultFor = () => new ReleaseVault(inv, { ...deps, runDir: flags.run ? resolve(flags.run) : null });
  try {
    if (command === 'status') {
      const checks = localChecks(inv, deps);
      if (flags.json) out(JSON.stringify(checks.map(({ id, state, detail, expiresAt }) => ({ id, state, detail, expiresAt }))));
      else for (const check of checks) out(`${check.id}: ${check.state} — ${check.detail}`);
      return stateExit(worst(checks.map((check) => check.state)));
    }
    if (command === 'probe') return probe(inv, flags._[0], { out, deps, vaultFor, usage });
    if (command === 'verify-backups') {
      const rows = verifyBackups(inv, vaultFor(), checkIdentity(inv, deps).sha1);
      for (const row of rows) out(`${row.item}: ${row.state} — ${row.detail}`);
      return rows.every((row) => row.state === 'ok') ? EXIT.OK : EXIT.MISSING;
    }
    if (command === 'restore') {
      if (!flags.run) return usage();
      const parts = flags.only ? flags.only.split(',') : RESTORE_PARTS;
      if (!parts.every((part) => RESTORE_PARTS.includes(part))) return usage();
      restore(inv, vaultFor(), parts, { ...deps, say: out });
      return EXIT.OK;
    }
    if (command === 'backup') {
      if (!flags.run || !flags.only) return usage();
      backup(inv, vaultFor(), flags.only, { ...deps, flags, say: out });
      return EXIT.OK;
    }
    return usage();
  } catch (error) {
    if (error instanceof CredentialError) { err(error.message); return error.exit; }
    err(`unexpected error (${error?.name ?? 'unknown'})`);
    return EXIT.FAILED;
  }
}

if (isCliEntry(import.meta)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
