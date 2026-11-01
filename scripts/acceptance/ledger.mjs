// Ticket 247: resumable acceptance run ledger.
//
// Every acceptance run gets a folder that a new agent can resume from alone:
//
//   .intent/acceptance/<run-id>/
//     run.json           target, accounts, scenarios, planned steps, git SHA (written once)
//     checkpoints.jsonl  append-only: step results, granted and created IDs, human steps
//     events.jsonl       append-only: watcher output
//     STATE.md           generated, at most 60 lines: done, next, blocked, pending human steps
//     lock               pid of the process that owns the run; a dead pid is taken over
//
// API (the rest of this file is internal):
//   createRun({ target, accounts, scenarios, steps?, runId?, gitSha?, root?, now? }) -> Run
//   resumeRun({ runId, root?, now? }) -> Run       takes over the lock when its process died
//   readRun({ runId, root? }) -> Run               read-only view, no lock (cleanup, CLI)
//   listRuns({ root? }) -> [runId]
//   run.step(name, fn) -> result                   runs fn once; on resume a done step returns
//                                                  its recorded result without calling fn
//   run.recordCheckpoint(kind, data)               kind 'grant' | 'creation' | 'human'
//   run.appendEvent(event)                         one watcher event per line
//   run.cleanupInputs() -> { grants, creations }   inputs for revokeCaptured / captureCreations
//   run.renderState() -> string                    rewrites STATE.md (read-only runs only return it)
//   run.close()                                    releases the lock
//   assertSafe(value), LedgerStop
// CLI: node scripts/acceptance/ledger.mjs list | state <run-id> | ids <run-id>  [--root <dir>]
//
// Step rules. fn receives { attempt, interrupted, checkpoint }. `interrupted` is
// true when the previous attempt started and never recorded a result (the
// process died). A step that writes must read back first in that case, as the
// cleanup helpers do, and check cleanupInputs() before recording a checkpoint
// again (labels are unique); the ledger never guesses an outcome. A step that
// threw is recorded as stopped and runs again on the next call.
//
// Checkpoint rules follow scripts/mcp-acceptance-cleanup.mjs: records hold IDs,
// statuses, hashes, scopes and timestamps only; each record is persisted (and
// fsynced) before the next write; labels and IDs are unique within a run; slots
// are A or B; error details become a short stop reason. 'grant' takes the
// object checkpointGrant returns and 'creation' the one checkpointCreation
// returns, so cleanupInputs() feeds revokeCaptured({ captured: grants }) and
// captureCreations({ creations }) unchanged.
//
// Every value written passes assertSafe: no token-, code-, cookie-, key- or
// note-named fields, no JWTs, bearer strings, provider key prefixes, long
// opaque strings, newlines or strings over 200 characters.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, truncateSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';

export const DEFAULT_ROOT = '.intent/acceptance';
export const STATE_MAX_LINES = 60;

export class LedgerStop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STEP_NAME = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
const LABEL = /^[a-z0-9-]{1,40}$/;
const REASON = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SLOTS = ['A', 'B'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- Safety ----------------------------------------------------------------

const KEY_SHAPE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const KEY_SUFFIX_OK = /(Id|Ids|_id|_ids|Hash|_hash|Count|_count|At|_at)$/;
const KEY_FORBIDDEN = /token|secret|passw|cookie|authori[sz]|auth_?code|^code$|verifier|api_?key|private_?key|credential|session|^notes?$|note_?text|^text$|^content$|^body$|^prompt$|^messages?$|^input$|^arguments$|^args$|^output$|structured_?content|^headers?$/i;
const VALUE_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/, // JWT
  /\bbearer\s+\S/i,
  /\b(sk-|sk_|rk_|pk_live_|sb_secret_|sb_publishable_|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abprs]-|ops_|AKIA)[A-Za-z0-9_-]{6,}/,
  /[?&](code|access_token|refresh_token|id_token|state)=/i,
];
const HEX_DIGEST = /^[a-f0-9]{7,64}$/;
const DIGEST_KEY = /(Hash|_hash|Sha|_sha)$/;

function opaque(value, hashKey) {
  const stripped = value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ');
  if (hashKey && HEX_DIGEST.test(stripped)) return false;
  for (const run of stripped.match(/[A-Za-z0-9_+/=-]{32,}/g) ?? []) {
    if (/[A-Z]/.test(run)) return true; // base64 and base64url secrets
    if (/^[A-Za-z0-9]+$/.test(run)) return true; // hex or alphanumeric secrets without separators
  }
  return false;
}

function check(value, key, depth) {
  if (depth > 8) throw new LedgerStop('unsafe-depth');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new LedgerStop('unsafe-number'); return; }
  if (typeof value === 'string') {
    if (value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new LedgerStop('unsafe-string');
    if (VALUE_PATTERNS.some((p) => p.test(value)) || opaque(value, DIGEST_KEY.test(key))) throw new LedgerStop('unsafe-secret-value');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) throw new LedgerStop('unsafe-size');
    for (const v of value) check(v, key, depth + 1);
    return;
  }
  if (isObject(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value);
    if (keys.length > 100) throw new LedgerStop('unsafe-size');
    for (const k of keys) {
      if (!KEY_SHAPE.test(k) || opaque(k, false)) throw new LedgerStop('unsafe-key');
      if (KEY_FORBIDDEN.test(k) && !KEY_SUFFIX_OK.test(k)) throw new LedgerStop('unsafe-key');
      check(value[k], k, depth + 1);
    }
    return;
  }
  throw new LedgerStop('unsafe-type');
}

/** Throws LedgerStop('unsafe-…') unless `value` is plain JSON holding no secret or note text. */
export function assertSafe(value) {
  check(value, '', 0);
  return value;
}

/** Errors become a short stop reason (LedgerStop or the cleanup helpers' Stop); messages are never written. */
const reasonOf = (e) => (e && typeof e.reason === 'string' && REASON.test(e.reason) ? e.reason : 'internal-error');

// ---- Files -----------------------------------------------------------------

function appendLine(path, record) {
  const fd = openSync(path, 'a', 0o600);
  try { writeSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Read a JSONL file; a torn last line from a killed write is cut off (repair only when writable). */
function readLines(path, repair) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  let body = text;
  if (text.length && !text.endsWith('\n')) {
    body = text.slice(0, text.lastIndexOf('\n') + 1);
    if (repair) truncateSync(path, Buffer.byteLength(body));
  }
  return body.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { throw new LedgerStop('ledger-corrupt'); }
  });
}

function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

function takeLock(dir, now) {
  const path = join(dir, 'lock');
  const body = JSON.stringify({ pid: process.pid, host: hostname(), at: now().toISOString() });
  try { writeFileSync(path, body, { flag: 'wx', mode: 0o600 }); return; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  let held = null;
  try { held = JSON.parse(readFileSync(path, 'utf8')); } catch { held = null; }
  if (held && (held.host !== hostname() || pidAlive(held.pid))) throw new LedgerStop('run-locked');
  unlinkSync(path);
  writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
}

const defaultGitSha = () => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};

const runDir = (root, runId) => {
  if (!RUN_ID.test(runId ?? '')) throw new LedgerStop('run-id');
  return join(resolve(root), runId);
};

// ---- Run -------------------------------------------------------------------

class Run {
  #dir; #now; #writable; #closed = false; #meta; #records; #events;

  constructor({ dir, now, writable }) {
    this.#dir = dir;
    this.#now = now;
    this.#writable = writable;
    if (!existsSync(join(dir, 'run.json'))) throw new LedgerStop('run-missing');
    this.#meta = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    this.#records = readLines(join(dir, 'checkpoints.jsonl'), writable);
    const events = readLines(join(dir, 'events.jsonl'), writable);
    this.#events = { count: events.length, lastAt: events.at(-1)?.at ?? null };
  }

  get runId() { return this.#meta.runId; }
  get dir() { return this.#dir; }
  get meta() { return structuredClone(this.#meta); }
  get checkpoints() { return structuredClone(this.#records); }

  #assertWritable() {
    if (!this.#writable) throw new LedgerStop('read-only');
    if (this.#closed) throw new LedgerStop('run-closed');
  }

  #append(record) {
    this.#assertWritable();
    const full = { seq: this.#records.length + 1, at: this.#now().toISOString(), ...record };
    assertSafe(full);
    appendLine(join(this.#dir, 'checkpoints.jsonl'), full);
    this.#records.push(full);
    return full;
  }

  #latest(kind) {
    const map = new Map();
    for (const r of this.#records) if (r.kind === kind) map.set(r.name, r);
    return map;
  }

  async step(name, fn) {
    this.#assertWritable();
    if (!STEP_NAME.test(name ?? '')) throw new LedgerStop('step-name');
    const prev = this.#latest('step').get(name);
    if (prev?.state === 'done') return structuredClone(prev.result);
    const attempt = (prev?.attempt ?? 0) + 1;
    this.#append({ kind: 'step', name, state: 'started', attempt });
    this.renderState();
    let result;
    try {
      result = await fn({ attempt, interrupted: prev?.state === 'started', checkpoint: (kind, data) => this.recordCheckpoint(kind, data) });
      result = result === undefined ? null : result;
      assertSafe(result);
    } catch (e) {
      this.#append({ kind: 'step', name, state: 'stopped', attempt, reason: reasonOf(e) });
      this.renderState();
      throw e;
    }
    this.#append({ kind: 'step', name, state: 'done', attempt, result });
    this.renderState();
    return structuredClone(result);
  }

  recordCheckpoint(kind, data) {
    this.#assertWritable();
    if (!isObject(data)) throw new LedgerStop('checkpoint-shape');
    assertSafe(data);
    let record;
    if (kind === 'grant') {
      const { label, slot, grantId, clientId, clientName = null, scopes, createdAt = null } = data;
      if (!LABEL.test(label ?? '') || !SLOTS.includes(slot) || !UUID.test(grantId ?? '') || typeof clientId !== 'string' || !clientId
        || !Array.isArray(scopes) || !scopes.every((s) => typeof s === 'string')) throw new LedgerStop('grant-shape');
      const grants = this.#records.filter((r) => r.kind === 'grant');
      if (grants.some((g) => g.label === label)) throw new LedgerStop('label-used');
      if (grants.some((g) => g.grantId === grantId)) throw new LedgerStop('grant-already-checkpointed');
      record = { kind, label, slot, grantId, clientId, clientName, scopes, createdAt };
    } else if (kind === 'creation') {
      const { label, slot, behaviorId, grantId = null, activityIds = [], behaviorCreatedAt = null } = data;
      if (!LABEL.test(label ?? '') || !SLOTS.includes(slot) || !UUID.test(behaviorId ?? '') || (grantId !== null && !UUID.test(grantId))
        || !Array.isArray(activityIds)) throw new LedgerStop('creation-shape');
      const creations = this.#records.filter((r) => r.kind === 'creation');
      if (creations.some((c) => c.label === label)) throw new LedgerStop('label-used');
      if (creations.some((c) => c.behaviorId === behaviorId)) throw new LedgerStop('creation-already-checkpointed');
      record = { kind, label, slot, behaviorId, grantId, activityIds, behaviorCreatedAt };
    } else if (kind === 'human') {
      const { name, state, instruction = null } = data;
      if (!STEP_NAME.test(name ?? '') || !['pending', 'done'].includes(state) || (instruction !== null && typeof instruction !== 'string')) throw new LedgerStop('human-shape');
      record = { kind, name, state, instruction };
    } else throw new LedgerStop('checkpoint-kind');
    const full = this.#append(record);
    this.renderState();
    return structuredClone(full);
  }

  appendEvent(event) {
    this.#assertWritable();
    if (!isObject(event)) throw new LedgerStop('event-shape');
    const full = { at: this.#now().toISOString(), ...event };
    assertSafe(full);
    appendLine(join(this.#dir, 'events.jsonl'), full);
    this.#events = { count: this.#events.count + 1, lastAt: full.at };
    this.renderState();
  }

  cleanupInputs() {
    const grants = this.#records.filter((r) => r.kind === 'grant')
      .map(({ label, slot, grantId, clientId, clientName, scopes, createdAt }) => ({ label, slot, grantId, clientId, clientName, scopes, createdAt }));
    const creations = this.#records.filter((r) => r.kind === 'creation')
      .map(({ label, slot, behaviorId, grantId, activityIds, behaviorCreatedAt }) => ({ label, slot, behaviorId, grantId, activityIds, behaviorCreatedAt }));
    return structuredClone({ grants, creations });
  }

  renderState() {
    const text = renderState(this.#meta, this.#records, this.#events, this.#now());
    if (this.#writable && !this.#closed) writeAtomic(join(this.#dir, 'STATE.md'), text);
    return text;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    if (!this.#writable) return;
    const path = join(this.#dir, 'lock');
    try { if (JSON.parse(readFileSync(path, 'utf8')).pid === process.pid) unlinkSync(path); } catch { /* lock already gone */ }
  }
}

// ---- STATE.md --------------------------------------------------------------

const clip = (s, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function renderState(meta, records, events, now) {
  const steps = new Map();
  for (const r of records) if (r.kind === 'step') steps.set(r.name, r);
  const humans = new Map();
  for (const r of records) if (r.kind === 'human') humans.set(r.name, r);
  const done = [...steps.values()].filter((s) => s.state === 'done');
  const blocked = [...steps.values()].filter((s) => s.state !== 'done');
  const pendingHuman = [...humans.values()].filter((h) => h.state === 'pending');
  const next = (meta.steps ?? []).filter((n) => !steps.has(n));
  const ids = records.filter((r) => r.kind === 'grant' || r.kind === 'creation');
  const status = blocked.length ? 'blocked' : pendingHuman.length ? 'waiting for a human step' : next.length ? 'in progress' : 'all planned steps done';

  const header = [
    `# Acceptance run ${meta.runId}`,
    '',
    clip(`Target: ${meta.target} · Git: ${meta.gitSha ?? 'unknown'} · Created: ${meta.createdAt}`),
    clip(`Scenarios: ${(meta.scenarios ?? []).join(', ') || 'none'} · Accounts: ${(meta.accounts ?? []).map((a) => (isObject(a) ? a.slot ?? a.label ?? '?' : String(a))).join(', ') || 'none'}`),
    clip(`Status: ${status} · Done ${done.length} · Next ${next.length} · Blocked ${blocked.length} · Human ${pendingHuman.length} · IDs ${ids.length} · Events ${events.count}${events.lastAt ? ` (last ${events.lastAt})` : ''}`),
    `Updated: ${now.toISOString()}`,
    clip(`Resume: resumeRun({ runId: '${meta.runId}' }) from scripts/acceptance/ledger.mjs; run.step() skips done steps.`),
  ];
  const sections = [
    { title: 'Blocked', items: blocked.map((s) => (s.state === 'started' ? `${s.name}: interrupted during attempt ${s.attempt}; read back before rerunning` : `${s.name}: stopped (${s.reason}) on attempt ${s.attempt}`)) },
    { title: 'Pending human steps', items: pendingHuman.map((h) => (h.instruction ? `${h.name}: ${h.instruction}` : h.name)) },
    { title: 'Next', items: next, fair: true },
    { title: 'Granted and created IDs', items: ids.map((r) => (r.kind === 'grant' ? `grant ${r.label} (${r.slot}): ${r.grantId}` : `creation ${r.label} (${r.slot}): behavior ${r.behaviorId}`)), fair: true },
    { title: 'Done', items: done.map((s) => `${s.name} (attempt ${s.attempt})`), keepLatest: true, fair: true },
  ].filter((s) => s.items.length);

  const lines = [...header];
  sections.forEach((section, i) => {
    // Blocked and human steps come first in full; Next, IDs and Done share what is left.
    const available = STATE_MAX_LINES - lines.length;
    const reserve = sections.slice(i + 1).length * 2;
    const share = section.fair ? Math.max(3, Math.floor(available / (sections.length - i))) : available;
    const budget = Math.min(available - reserve, share);
    if (budget < 2) return;
    lines.push(`## ${section.title} (${section.items.length})`);
    let shown = section.items.map((t) => `- ${clip(t)}`);
    if (shown.length > budget - 1) {
      const keep = budget - 2;
      const hidden = shown.length - keep;
      shown = section.keepLatest
        ? [`- … ${hidden} earlier`, ...shown.slice(shown.length - keep)]
        : [...shown.slice(0, keep), `- … ${hidden} more`];
    }
    lines.push(...shown);
  });
  return `${lines.slice(0, STATE_MAX_LINES).join('\n')}\n`;
}

// ---- Entry points ----------------------------------------------------------

const randomId = (now) => `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;

/** Create a new run folder. Fails with 'run-exists' rather than reuse a folder. */
export function createRun({ target, accounts = [], scenarios = [], steps = [], runId, gitSha, root = DEFAULT_ROOT, now = () => new Date() }) {
  const at = now();
  const id = runId ?? randomId(at);
  const dir = runDir(root, id);
  if (typeof target !== 'string' || !target) throw new LedgerStop('target');
  if (!Array.isArray(accounts) || !Array.isArray(scenarios) || !scenarios.every((s) => typeof s === 'string')) throw new LedgerStop('run-shape');
  if (!Array.isArray(steps) || !steps.every((s) => STEP_NAME.test(s ?? '')) || new Set(steps).size !== steps.length) throw new LedgerStop('steps');
  const sha = gitSha === undefined ? defaultGitSha() : gitSha;
  if (sha !== null && !/^[0-9a-f]{7,40}$/.test(sha)) throw new LedgerStop('git-sha');
  const meta = assertSafe({ version: 1, runId: id, createdAt: at.toISOString(), target, accounts, scenarios, steps, gitSha: sha });
  mkdirSync(resolve(root), { recursive: true, mode: 0o700 });
  try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') throw new LedgerStop('run-exists'); throw e; }
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify(meta, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  takeLock(dir, now);
  const run = new Run({ dir, now, writable: true });
  run.renderState();
  return run;
}

/** Refuse cached evidence for another target, account or scenario. Values never enter diagnostics. */
export function assertRunContext(meta, expected) {
  const sameMembers = (actual, wanted, member = (value) => value) => {
    if (!Array.isArray(actual) || !Array.isArray(wanted)) return false;
    const left = actual.map(member);
    const right = wanted.map(member);
    return left.every((value) => typeof value === 'string') && right.every((value) => typeof value === 'string')
      && JSON.stringify(left.sort()) === JSON.stringify(right.sort());
  };
  if (expected.target !== undefined && meta?.target !== expected.target) throw new LedgerStop('run-target-mismatch');
  const slotOf = (account) => typeof account === 'string' ? account : account?.slot;
  if (expected.accounts !== undefined && !sameMembers(meta?.accounts, expected.accounts, slotOf)) throw new LedgerStop('run-account-mismatch');
  if (expected.scenarios !== undefined && !sameMembers(meta?.scenarios, expected.scenarios)) throw new LedgerStop('run-scenario-mismatch');
}

/** Reopen a matching run for writing. Context is checked before taking a lock or repairing files. */
export function resumeRun({ runId, root = DEFAULT_ROOT, now = () => new Date(), expected } = {}) {
  const dir = runDir(root, runId);
  if (!existsSync(join(dir, 'run.json'))) throw new LedgerStop('run-missing');
  if (expected !== undefined) assertRunContext(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), expected);
  takeLock(dir, now);
  const run = new Run({ dir, now, writable: true });
  run.renderState();
  return run;
}

/** Open a run read-only, without the lock. */
export function readRun({ runId, root = DEFAULT_ROOT, now = () => new Date() }) {
  return new Run({ dir: runDir(root, runId), now, writable: false });
}

/** Run IDs under `root`, oldest first. */
export function listRuns({ root = DEFAULT_ROOT } = {}) {
  if (!existsSync(resolve(root))) return [];
  return readdirSync(resolve(root)).filter((d) => RUN_ID.test(d) && existsSync(join(resolve(root), d, 'run.json'))).sort();
}

async function main() {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--root');
  const root = flag >= 0 ? args.splice(flag, 2)[1] : DEFAULT_ROOT;
  const [command, runId] = args;
  if (command === 'list') { process.stdout.write(`${JSON.stringify(listRuns({ root }))}\n`); return; }
  const run = readRun({ runId, root });
  if (command === 'state') process.stdout.write(run.renderState());
  else if (command === 'ids') process.stdout.write(`${JSON.stringify(run.cleanupInputs(), null, 2)}\n`);
  else throw new LedgerStop('command');
}

const { isCliEntry } = await import('./cli-entry.mjs');
if (isCliEntry(import.meta)) {
  main().catch((e) => { process.stdout.write(`${JSON.stringify({ result: 'stopped', reason: reasonOf(e) })}\n`); process.exit(1); });
}
