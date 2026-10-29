// Ticket 232 acceptance cleanup helpers. Every operation runs as test account A
// or B through the user's own Supabase session, so RLS and the owner-checked
// RPCs apply; no service role. Each write is one attempt and is followed by a
// readback; nothing is retried. Receipts hold ids, statuses, hashes and
// timestamps only, never tokens or note text.
import { createHash } from 'node:crypto';
import { buildCleanupSql, TABLES } from './mcp-fixture-cleanup.mjs';

export const USERS = Object.freeze({ A: 'caefd1b8-ea46-485f-8869-119a715fb092', B: 'c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b' });
export const ALLOWED_NOTES = Object.freeze([null, 'Review sample note']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const noteHash = (note) => (note === null ? null : createHash('sha256').update(note).digest('hex'));

class Stop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const ok = (r) => r && r.status >= 200 && r.status < 300;
const rows = (r, name) => { if (!ok(r) || !Array.isArray(r.json) || !r.json.every(isObject)) throw new Stop(`${name}-unreadable`); return r.json; };
const validDate = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const after = (iso, since) => validDate(iso) && Date.parse(iso) >= Date.parse(since);
const STATUSES = ['unresolved', 'completed', 'not_completed'];
const validGrant = (g) => isObject(g) && UUID.test(g.grant_id ?? '') && typeof g.client_id === 'string' && g.client_id.length > 0
  && typeof g.client_name === 'string' && Array.isArray(g.scopes) && g.scopes.every((x) => typeof x === 'string') && validDate(g.created_at);

/** Active grants for one slot; every row must be well formed or the read fails closed. */
export async function listGrants({ rest, slot }) {
  const list = rows(await rest(slot, 'POST', '/rest/v1/rpc/oauth_list_grants', {}), `grants-${slot}`);
  if (!list.every(validGrant)) throw new Stop(`grants-${slot}-shape`);
  if (new Set(list.map((g) => g.grant_id)).size !== list.length) throw new Stop(`grants-${slot}-duplicate`);
  return list;
}

/**
 * Grant checkpoint for one acceptance consent. `known` holds the grant IDs the
 * slot already had. Exactly one new grant must appear; when a client ID is
 * known in advance (the gate) it must match.
 */
export async function checkpointGrant({ rest, slot, label, known, expectClientId = null, since }) {
  const list = await listGrants({ rest, slot });
  const fresh = expectClientId !== null ? list.filter((g) => g.client_id === expectClientId) : list.filter((g) => !known.includes(g.grant_id));
  if (fresh.length !== 1) throw new Stop(`checkpoint-${label}-expected-one-new-grant`);
  const g = fresh[0];
  if (!after(g.created_at, since)) throw new Stop(`checkpoint-${label}-grant-too-old`);
  if (expectClientId !== null && g.client_id !== expectClientId) throw new Stop(`checkpoint-${label}-client-mismatch`);
  return { label, slot, grantId: g.grant_id, clientId: g.client_id, clientName: g.client_name, scopes: g.scopes, createdAt: g.created_at };
}

/**
 * Revoke exactly the checkpointed grants as their own user. A well-formed list
 * without the grant counts as already revoked; the readback decides every
 * outcome. `record` persists each result before the next write.
 */
export async function revokeCaptured({ rest, captured, record = () => {} }) {
  const results = [];
  for (const g of captured) {
    if (!['A', 'B'].includes(g.slot) || !UUID.test(g.grantId ?? '')) throw new Stop('captured-grant-shape');
    const active = async () => (await listGrants({ rest, slot: g.slot })).some((x) => x.grant_id === g.grantId);
    if (!(await active())) { const res = { grantId: g.grantId, slot: g.slot, outcome: 'already-revoked', readback: 'absent' }; results.push(res); record(res); continue; }
    record({ grantId: g.grantId, slot: g.slot, outcome: 'attempting' });
    const r = await rest(g.slot, 'POST', '/rest/v1/rpc/oauth_revoke_grant', { p_grant_id: g.grantId });
    const stillActive = await active();
    const res = { grantId: g.grantId, slot: g.slot, outcome: stillActive ? 'revoke-failed' : 'revoked', requestStatus: r?.status ?? 0, readback: stillActive ? 'present' : 'absent' };
    results.push(res);
    record(res);
    if (stillActive) throw new Stop('revoke-failed');
  }
  return results;
}

const DERIVED = ['behavior_schedules', 'behavior_schedule_slots', 'occurrences', 'occurrence_status_events', 'behavior_definition_events', 'behavior_configuration_events', 'occurrence_time_sessions'];

/**
 * Creation checkpoint for one client's create step. Exactly one new "Review
 * practice" Behavior must exist for the slot since the previous checkpoint, and
 * the slot's activity must show a successful create_behavior by that client's
 * checkpointed grant inside the window. Activity rows carry no target IDs, so
 * the Behavior ID comes from the Behavior read; the activity only corroborates.
 */
export async function checkpointCreation({ rest, slot, label, grantId, windowStart, now = () => new Date(), recorded }) {
  const user = USERS[slot];
  const list = rows(await rest(slot, 'GET', `/rest/v1/behaviors?user_id=eq.${user}&created_at=gte.${encodeURIComponent(windowStart)}&select=id,user_id,title,created_at`), `behaviors-${slot}`);
  const fresh = list.filter((b) => !recorded.includes(b.id));
  if (fresh.length !== 1) throw new Stop(`creation-${label}-expected-one-new-behavior`);
  const b = fresh[0];
  if (!UUID.test(b.id ?? '') || b.user_id !== user || typeof b.title !== 'string' || !b.title.startsWith('Review practice') || !after(b.created_at, windowStart)) throw new Stop(`creation-${label}-behavior-refused`);
  const activity = rows(await rest(slot, 'POST', '/rest/v1/rpc/oauth_list_activity', { p_limit: 50 }), `activity-${slot}`);
  const matches = activity.filter((a) => a.grant_id === grantId && a.operation === 'create_behavior' && a.outcome === 'success'
    && after(a.occurred_at, windowStart) && Date.parse(a.occurred_at) <= now().getTime());
  if (matches.length < 1) throw new Stop(`creation-${label}-no-activity`);
  return { label, slot, behaviorId: b.id, grantId, activityIds: matches.map((a) => a.activity_id), behaviorCreatedAt: b.created_at };
}

/**
 * Capture rows for cleanup: every checkpointed client Behavior with all its
 * derived rows, plus rows created on or after `since` on captured fixture
 * Behaviors. Any other new Behavior stops the run.
 */
export async function captureCreations({ rest, since, manifest, creations }) {
  const known = new Set(manifest.rows.map((r) => `${r.table}/${r.id}`));
  const approved = new Map(creations.map((c) => [c.behaviorId, USERS[c.slot]]));
  const fixtureBehaviors = manifest.rows.filter((r) => r.table === 'behaviors');
  const added = [];
  const take = (table, row, userId) => {
    if (!UUID.test(row.id ?? '') || row.user_id !== userId || !after(row.created_at, since)) throw new Stop(`${table}-row-refused`);
    const key = `${table}/${row.id}`;
    if (known.has(key)) return;
    known.add(key);
    added.push({ table, id: row.id, user_id: row.user_id, created_at: row.created_at, run_id: manifest.runId });
  };
  for (const slot of ['A', 'B']) {
    const user = USERS[slot];
    const list = rows(await rest(slot, 'GET', `/rest/v1/behaviors?user_id=eq.${user}&created_at=gte.${encodeURIComponent(since)}&select=id,user_id,title,created_at`), `behaviors-${slot}`);
    for (const b of list) {
      if (known.has(`behaviors/${b.id}`)) continue;
      if (approved.get(b.id) !== user) throw new Stop('unexpected-new-behavior');
      take('behaviors', b, user);
    }
  }
  for (const [id] of approved) if (!known.has(`behaviors/${id}`)) throw new Stop('checkpointed-behavior-missing');
  const targets = [...[...approved].map(([id, user]) => ({ id, user, fresh: true })), ...fixtureBehaviors.map((r) => ({ id: r.id, user: r.user_id, fresh: false }))];
  for (const b of targets) {
    for (const table of DERIVED) {
      const filter = `behavior_id=eq.${b.id}&user_id=eq.${b.user}${b.fresh ? '' : `&created_at=gte.${encodeURIComponent(since)}`}`;
      const list = rows(await rest(b.user === USERS.A ? 'A' : 'B', 'GET', `/rest/v1/${table}?${filter}&select=id,user_id,created_at&limit=500`), `${table}-read`);
      for (const row of list) take(table, row, b.user);
    }
  }
  return { added, newBehaviors: [...approved.keys()] };
}

/** Return a manifest extended by captured rows, validated by the reviewed cleanup generator. */
export function extendManifest(manifest, added, capturedAt) {
  const next = { ...manifest, capturedAt, rows: [...manifest.rows, ...added] };
  next.counts = Object.fromEntries(TABLES.map((t) => [t, next.rows.filter((r) => r.table === t).length]));
  buildCleanupSql(next);
  return next;
}

const occurrenceRow = (o) => isObject(o) && UUID.test(o.id ?? '') && STATUSES.includes(o.status) && (o.note === null || typeof o.note === 'string');

/** Baseline of the fixture Occurrences' status and note hash, before any client acceptance. */
export async function captureBaseline({ rest, manifest }) {
  const out = [];
  for (const [slot, user] of Object.entries(USERS)) {
    const ids = manifest.rows.filter((r) => r.table === 'occurrences' && r.user_id === user).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const list = rows(await rest(slot, 'GET', `/rest/v1/occurrences?id=in.(${chunk.join(',')})&user_id=eq.${user}&select=id,status,note`), `baseline-${slot}`);
      const got = list.map((o) => o.id);
      if (!list.every(occurrenceRow) || new Set(got).size !== got.length || got.length !== chunk.length || !chunk.every((x) => got.includes(x))) throw new Stop('baseline-identity');
      for (const o of list) out.push({ slot, occurrenceId: o.id, status: o.status, noteHash: noteHash(o.note) });
    }
  }
  return out;
}

/** The baseline must describe exactly the manifest's Occurrences for the right users. */
export function validateBaseline(baseline, manifest) {
  const expected = new Map(manifest.rows.filter((r) => r.table === 'occurrences').map((r) => [r.id, r.user_id]));
  const seen = new Set();
  for (const b of baseline) {
    if (!isObject(b) || !['A', 'B'].includes(b.slot) || !UUID.test(b.occurrenceId ?? '') || seen.has(b.occurrenceId)) throw new Stop('baseline-invalid');
    if (expected.get(b.occurrenceId) !== USERS[b.slot] || !STATUSES.includes(b.status) || !(b.noteHash === null || /^[a-f0-9]{64}$/.test(b.noteHash))) throw new Stop('baseline-invalid');
    seen.add(b.occurrenceId);
  }
  if (seen.size !== expected.size) throw new Stop('baseline-invalid');
}

/**
 * Restore fixture Occurrences that clients changed. Notes go back to their
 * allowed baseline value with a compare-and-set PATCH and are verified before
 * any status step. Statuses go back to Unresolved through the owner-checked
 * transition RPC with the expected current status and latest event. Other
 * baseline statuses are reported as manual, not guessed. `record` persists each
 * result before the next write.
 */
export async function restoreBaseline({ rest, baseline, manifest, now = () => new Date(), record = () => {} }) {
  validateBaseline(baseline, manifest);
  const results = [];
  for (const b of baseline) {
    const user = USERS[b.slot];
    const read = async () => {
      const list = rows(await rest(b.slot, 'GET', `/rest/v1/occurrences?id=eq.${b.occurrenceId}&user_id=eq.${user}&select=id,status,note`), 'restore-read');
      if (list.length !== 1 || list[0].id !== b.occurrenceId || !occurrenceRow(list[0])) throw new Stop('restore-read-identity');
      return list[0];
    };
    const current = await read();
    if (current.status === b.status && noteHash(current.note) === b.noteHash) continue;
    const result = { occurrenceId: b.occurrenceId, slot: b.slot };
    if (noteHash(current.note) !== b.noteHash) {
      const target = ALLOWED_NOTES.find((n) => noteHash(n) === b.noteHash);
      if (target === undefined) throw new Stop('restore-note-baseline-unknown');
      record({ ...result, step: 'note-attempting' });
      const guard = current.note === null ? 'note=is.null' : `note=eq.${encodeURIComponent(current.note)}`;
      const r = await rest(b.slot, 'PATCH', `/rest/v1/occurrences?id=eq.${b.occurrenceId}&user_id=eq.${user}&${guard}`, { note: target }, { Prefer: 'return=representation' });
      result.noteRequest = r?.status ?? 0;
    }
    const mid = await read();
    result.noteRestored = noteHash(mid.note) === b.noteHash;
    if (!result.noteRestored) { result.restored = false; results.push(result); record(result); throw new Stop('restore-failed'); }
    if (mid.status !== b.status) {
      if (b.status !== 'unresolved') { result.status = 'manual-restore-needed'; result.restored = false; results.push(result); record(result); continue; }
      const events = rows(await rest(b.slot, 'GET', `/rest/v1/occurrence_status_events?occurrence_id=eq.${b.occurrenceId}&user_id=eq.${user}&select=id,recorded_at&order=recorded_at.desc,id.desc&limit=1`), 'restore-events');
      if (events.length > 1 || (events[0] && !UUID.test(events[0].id ?? ''))) throw new Stop('restore-events-shape');
      record({ ...result, step: 'status-attempting' });
      const r = await rest(b.slot, 'POST', '/rest/v1/rpc/apply_occurrence_status_transition', {
        target_occurrence_id: b.occurrenceId, expected_status: mid.status, expected_latest_event_id: events[0]?.id ?? null,
        planned_status: 'unresolved', planned_completed_at: null, planned_status_marked_at: null,
        planned_event_semantics: 'explicit_user_correction', planned_event_recorded_at: now().toISOString(), planned_event_effective_at: null,
        planned_event_source_capture_method: 'manual_tap', planned_event_source_confidence: 'high', planned_cancel_pending_reminders: false,
      });
      result.statusRequest = r?.status ?? 0;
    }
    const final = await read();
    result.restored = final.status === b.status && noteHash(final.note) === b.noteHash;
    results.push(result);
    record(result);
    if (!result.restored) throw new Stop('restore-failed');
  }
  return results;
}

/**
 * Reserve the receipt (exclusive create) before any write, persist every
 * per-operation result as it happens, and keep earlier results when a later
 * item stops.
 */
export async function runRecorded({ reserve, update, at, operation }) {
  const log = { at, results: [] };
  reserve(log);
  try {
    await operation((r) => { log.results.push(r); update(log); });
  } catch (e) {
    log.stopped = e instanceof Stop ? e.reason : 'internal-error';
    update(log);
    throw e;
  }
  return log;
}

/** One-attempt PostgREST adapter bound to a slot's user session. Bodies never logged. */
export function createRest({ fetchImpl = fetch, origin, publishableKey, tokenFor, timeoutMs = 15_000 }) {
  return async (slot, method, path, body, headers = {}) => {
    const token = await tokenFor(slot);
    if (typeof token !== 'string' || !token) return { status: 0, json: null };
    try {
      const r = await fetchImpl(`${origin}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let json = null;
      try { json = await r.json(); } catch { json = null; }
      return { status: r.status, json };
    } catch { return { status: 0, json: null }; }
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const { brokerRequest } = await import('./mcp-session-broker.mjs');
  const DIR = '.intent/artifacts/trust232/extension-execution';
  const SINCE = '2026-10-29T20:43:30.000Z';
  const file = (name) => `${DIR}/${name}.json`;
  const load = (name, fallback) => (existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : fallback);
  // Reserve an output with exclusive creation BEFORE any hosted write; a rerun finds it and writes nothing.
  const reserve = (name, value) => writeFileSync(file(name), JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  const update = (name, value) => writeFileSync(file(name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const manifest = JSON.parse(readFileSync('.intent/artifacts/trust232/activation-execution/manifest-initial.json', 'utf8'));
  let mgmt = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (mgmt.startsWith('go-keyring-base64:')) mgmt = Buffer.from(mgmt.slice(18), 'base64').toString('utf8').trim();
  const keys = await (await fetch('https://api.supabase.com/v1/projects/qjodzutjxtmtzczbloxa/api-keys?reveal=false', { headers: { Authorization: `Bearer ${mgmt}` }, signal: AbortSignal.timeout(20_000) })).json();
  mgmt = '';
  const pub = Array.isArray(keys) ? keys.filter((k) => k.type === 'publishable') : [];
  if (pub.length !== 1) throw new Stop('publishable');
  const rest = createRest({ origin: 'https://qjodzutjxtmtzczbloxa.supabase.co', publishableKey: pub[0].api_key,
    tokenFor: async (slot) => { const r = await brokerRequest(`${homedir()}/.cadence-qa232/broker.sock`, { command: 'sessions' }); return r.ok && r.sessions[slot].userId === USERS[slot] ? r.sessions[slot].accessToken : null; } });
  const at = new Date().toISOString();
  const slotArg = (v) => { if (!['A', 'B'].includes(v)) throw new Stop('slot'); return v; };
  const labelArg = (v) => { if (!/^[a-z0-9-]{1,40}$/.test(v ?? '')) throw new Stop('label'); return v; };
  let result;
  if (command === 'baseline') {
    reserve('acceptance-baseline', { state: 'started', at });
    const b = await captureBaseline({ rest, manifest });
    update('acceptance-baseline', { capturedAt: at, occurrences: b });
    result = { occurrences: b.length };
  } else if (command === 'grants-init') {
    reserve('acceptance-grants-known', { state: 'started', at });
    const known = { A: (await listGrants({ rest, slot: 'A' })).map((g) => g.grant_id), B: (await listGrants({ rest, slot: 'B' })).map((g) => g.grant_id) };
    update('acceptance-grants-known', { capturedAt: at, known });
    result = { known: known.A.length + known.B.length };
  } else if (command === 'checkpoint') {
    const label = labelArg(args[0]), slot = slotArg(args[1]), expectClientId = args[2] ?? null;
    const known = load('acceptance-grants-known', null)?.known;
    if (!known) throw new Stop('grants-init-required');
    const checkpoints = load('acceptance-grant-checkpoints', []);
    if (checkpoints.some((c) => c.label === label)) throw new Stop('label-used');
    const cp = await checkpointGrant({ rest, slot, label, since: SINCE, expectClientId, known: [...known[slot], ...checkpoints.filter((c) => c.slot === slot).map((c) => c.grantId)] });
    if (checkpoints.some((c) => c.grantId === cp.grantId)) throw new Stop('grant-already-checkpointed');
    update('acceptance-grant-checkpoints', [...checkpoints, { ...cp, at }]);
    result = { label, grantId: cp.grantId, clientName: cp.clientName, scopes: cp.scopes };
  } else if (command === 'creation') {
    const label = labelArg(args[0]), slot = slotArg(args[1]), grantLabel = labelArg(args[2]), windowStart = args[3];
    if (!validDate(windowStart) || Date.parse(windowStart) < Date.parse(SINCE)) throw new Stop('window');
    const grant = load('acceptance-grant-checkpoints', []).find((c) => c.label === grantLabel && c.slot === slot);
    if (!grant) throw new Stop('grant-checkpoint-required');
    const creations = load('acceptance-creations', []);
    if (creations.some((c) => c.label === label)) throw new Stop('label-used');
    const cp = await checkpointCreation({ rest, slot, label, grantId: grant.grantId, windowStart, recorded: creations.map((c) => c.behaviorId) });
    update('acceptance-creations', [...creations, { ...cp, at }]);
    result = { label, behaviorId: cp.behaviorId };
  } else if (command === 'revoke') {
    const captured = load('acceptance-grant-checkpoints', []);
    if (!captured.length) throw new Stop('no-checkpointed-grants');
    const log = await runRecorded({ at, reserve: (v) => reserve('acceptance-revocations', v), update: (v) => update('acceptance-revocations', v),
      operation: (record) => revokeCaptured({ rest, captured, record }) });
    result = { revoked: log.results.filter((r) => r.outcome !== 'attempting').length };
  } else if (command === 'creations') {
    reserve('manifest-acceptance', { state: 'started', at });
    const c = await captureCreations({ rest, since: SINCE, manifest, creations: load('acceptance-creations', []) });
    const next = extendManifest(manifest, c.added, at);
    update('manifest-acceptance', next);
    result = { added: c.added.length, newBehaviors: c.newBehaviors.length };
  } else if (command === 'restore') {
    const baseline = load('acceptance-baseline', null)?.occurrences;
    if (!Array.isArray(baseline)) throw new Stop('baseline-required');
    const log = await runRecorded({ at, reserve: (v) => reserve('acceptance-restore', v), update: (v) => update('acceptance-restore', v),
      operation: (record) => restoreBaseline({ rest, baseline, manifest, record }) });
    const final = log.results.filter((r) => r.step === undefined);
    result = { changed: final.length, manual: final.filter((r) => r.status === 'manual-restore-needed').length };
    if (result.manual) { process.stdout.write(`${JSON.stringify({ result: 'incomplete', command, ...result })}\n`); process.exit(2); }
  } else throw new Stop('command');
  process.stdout.write(`${JSON.stringify({ result: 'complete', command, ...result })}\n`);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { process.stdout.write(`${JSON.stringify({ result: 'stopped', reason: e instanceof Stop ? e.reason : 'internal-error' })}\n`); process.exit(1); });
}
