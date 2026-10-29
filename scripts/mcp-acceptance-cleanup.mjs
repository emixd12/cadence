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
const after = (iso, since) => typeof iso === 'string' && Date.parse(iso) >= Date.parse(since);

/** Grants created by this run (on or after `since`) for A and B. */
export async function captureGrants({ rest, since }) {
  const out = [];
  for (const slot of ['A', 'B']) {
    const list = rows(await rest(slot, 'POST', '/rest/v1/rpc/oauth_list_grants', {}), `grants-${slot}`);
    for (const g of list) {
      if (!UUID.test(g.grant_id ?? '') || typeof g.created_at !== 'string') throw new Stop(`grants-${slot}-shape`);
      if (after(g.created_at, since)) out.push({ slot, grantId: g.grant_id, clientId: g.client_id, clientName: g.client_name, scopes: g.scopes, createdAt: g.created_at });
    }
  }
  return out;
}

/**
 * Revoke exactly the captured grants as their own user. A grant already absent
 * from the active list counts as revoked; the readback decides every outcome.
 */
export async function revokeCaptured({ rest, captured }) {
  const results = [];
  for (const g of captured) {
    if (!['A', 'B'].includes(g.slot) || !UUID.test(g.grantId ?? '')) throw new Stop('captured-grant-shape');
    const active = async () => rows(await rest(g.slot, 'POST', '/rest/v1/rpc/oauth_list_grants', {}), `grants-${g.slot}`).some((x) => x.grant_id === g.grantId);
    if (!(await active())) { results.push({ grantId: g.grantId, slot: g.slot, outcome: 'already-revoked', readback: 'absent' }); continue; }
    const r = await rest(g.slot, 'POST', '/rest/v1/rpc/oauth_revoke_grant', { p_grant_id: g.grantId });
    const stillActive = await active();
    results.push({ grantId: g.grantId, slot: g.slot, outcome: stillActive ? 'revoke-failed' : 'revoked', requestStatus: r?.status ?? 0, readback: stillActive ? 'present' : 'absent' });
    if (stillActive) throw Object.assign(new Stop('revoke-failed'), { results });
  }
  return results;
}

const DERIVED = ['behavior_schedules', 'behavior_schedule_slots', 'occurrences', 'occurrence_status_events', 'behavior_definition_events', 'behavior_configuration_events', 'occurrence_time_sessions'];

/**
 * Capture rows that clients created on or after `since`: new "Review practice"
 * Behaviors with all their derived rows, and new derived rows on the captured
 * fixture Behaviors. Any other new Behavior stops the run.
 */
export async function captureCreations({ rest, since, manifest, maxNewBehaviors = 4 }) {
  const known = new Set(manifest.rows.map((r) => `${r.table}/${r.id}`));
  const fixtureBehaviors = manifest.rows.filter((r) => r.table === 'behaviors');
  const added = [];
  const take = (table, row, userId) => {
    if (!UUID.test(row.id ?? '') || row.user_id !== userId || !after(row.created_at, since)) throw new Stop(`${table}-row-refused`);
    const key = `${table}/${row.id}`;
    if (known.has(key)) return;
    known.add(key);
    added.push({ table, id: row.id, user_id: row.user_id, created_at: row.created_at, run_id: manifest.runId });
  };
  const newBehaviors = [];
  for (const slot of ['A', 'B']) {
    const user = USERS[slot];
    const list = rows(await rest(slot, 'GET', `/rest/v1/behaviors?user_id=eq.${user}&created_at=gte.${encodeURIComponent(since)}&select=id,user_id,title,created_at`), `behaviors-${slot}`);
    for (const b of list) {
      if (known.has(`behaviors/${b.id}`)) continue;
      if (typeof b.title !== 'string' || !b.title.startsWith('Review practice')) throw new Stop('unexpected-new-behavior');
      take('behaviors', b, user);
      newBehaviors.push({ id: b.id, user });
    }
  }
  if (newBehaviors.length > maxNewBehaviors) throw new Stop('too-many-new-behaviors');
  for (const b of [...newBehaviors, ...fixtureBehaviors.map((r) => ({ id: r.id, user: r.user_id }))]) {
    for (const table of DERIVED) {
      const fresh = newBehaviors.some((n) => n.id === b.id);
      const filter = `behavior_id=eq.${b.id}&user_id=eq.${b.user}${fresh ? '' : `&created_at=gte.${encodeURIComponent(since)}`}`;
      const list = rows(await rest(b.user === USERS.A ? 'A' : 'B', 'GET', `/rest/v1/${table}?${filter}&select=id,user_id,created_at&limit=500`), `${table}-read`);
      for (const row of list) take(table, row, b.user);
    }
  }
  return { added, newBehaviors: newBehaviors.map((b) => b.id) };
}

/** Return a manifest extended by captured rows, validated by the reviewed cleanup generator. */
export function extendManifest(manifest, added, capturedAt) {
  const next = { ...manifest, capturedAt, rows: [...manifest.rows, ...added] };
  next.counts = Object.fromEntries(TABLES.map((t) => [t, next.rows.filter((r) => r.table === t).length]));
  buildCleanupSql(next);
  return next;
}

/** Baseline of the fixture Occurrences' status and note hash, before any client acceptance. */
export async function captureBaseline({ rest, manifest }) {
  const out = [];
  for (const [slot, user] of Object.entries(USERS)) {
    const ids = manifest.rows.filter((r) => r.table === 'occurrences' && r.user_id === user).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const list = rows(await rest(slot, 'GET', `/rest/v1/occurrences?id=in.(${chunk.join(',')})&user_id=eq.${user}&select=id,status,note`), `baseline-${slot}`);
      if (list.length !== chunk.length) throw new Stop('baseline-incomplete');
      for (const o of list) out.push({ slot, occurrenceId: o.id, status: o.status, noteHash: noteHash(o.note) });
    }
  }
  return out;
}

/**
 * Restore fixture Occurrences that clients changed. Notes go back to their
 * allowed baseline value with a compare-and-set PATCH; statuses go back to
 * Unresolved through the owner-checked transition RPC with the expected
 * current status and latest event. Other baseline statuses are reported, not
 * guessed.
 */
export async function restoreBaseline({ rest, baseline, now = () => new Date() }) {
  const results = [];
  for (const b of baseline) {
    const user = USERS[b.slot];
    const read = async () => {
      const list = rows(await rest(b.slot, 'GET', `/rest/v1/occurrences?id=eq.${b.occurrenceId}&user_id=eq.${user}&select=id,status,note`), 'restore-read');
      if (list.length !== 1) throw new Stop('restore-occurrence-missing');
      return list[0];
    };
    const current = await read();
    if (current.status === b.status && noteHash(current.note) === b.noteHash) continue;
    const result = { occurrenceId: b.occurrenceId, slot: b.slot };
    if (noteHash(current.note) !== b.noteHash) {
      const target = ALLOWED_NOTES.find((n) => noteHash(n) === b.noteHash);
      if (target === undefined) throw new Stop('restore-note-baseline-unknown');
      const guard = current.note === null ? 'note=is.null' : `note=eq.${encodeURIComponent(current.note)}`;
      const r = await rest(b.slot, 'PATCH', `/rest/v1/occurrences?id=eq.${b.occurrenceId}&user_id=eq.${user}&${guard}`, { note: target }, { Prefer: 'return=representation' });
      result.noteRequest = r?.status ?? 0;
    }
    const mid = await read();
    if (mid.status !== b.status) {
      if (b.status !== 'unresolved') { result.status = 'manual-restore-needed'; results.push(result); continue; }
      const events = rows(await rest(b.slot, 'GET', `/rest/v1/occurrence_status_events?occurrence_id=eq.${b.occurrenceId}&user_id=eq.${user}&select=id,recorded_at&order=recorded_at.desc,id.desc&limit=1`), 'restore-events');
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
    if (!result.restored && result.status !== 'manual-restore-needed') throw Object.assign(new Stop('restore-failed'), { results });
  }
  return results;
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
  const command = process.argv[2];
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const { brokerRequest } = await import('./mcp-session-broker.mjs');
  const DIR = '.intent/artifacts/trust232/extension-execution';
  const SINCE = '2026-10-29T20:43:30.000Z';
  let mgmt = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (mgmt.startsWith('go-keyring-base64:')) mgmt = Buffer.from(mgmt.slice(18), 'base64').toString('utf8').trim();
  const keys = await (await fetch('https://api.supabase.com/v1/projects/qjodzutjxtmtzczbloxa/api-keys?reveal=false', { headers: { Authorization: `Bearer ${mgmt}` }, signal: AbortSignal.timeout(20_000) })).json();
  mgmt = '';
  const pub = keys.filter((k) => k.type === 'publishable');
  if (pub.length !== 1) throw new Stop('publishable');
  const rest = createRest({ origin: 'https://qjodzutjxtmtzczbloxa.supabase.co', publishableKey: pub[0].api_key,
    tokenFor: async (slot) => { const r = await brokerRequest(`${homedir()}/.cadence-qa232/broker.sock`, { command: 'sessions' }); return r.ok && r.sessions[slot].userId === USERS[slot] ? r.sessions[slot].accessToken : null; } });
  const manifest = JSON.parse(readFileSync('.intent/artifacts/trust232/activation-execution/manifest-initial.json', 'utf8'));
  const save = (name, value) => { const p = `${DIR}/${name}.json`; if (existsSync(p)) throw new Stop(`${name}-exists`); writeFileSync(p, JSON.stringify(value, null, 2), { mode: 0o600 }); };
  const at = new Date().toISOString();
  let result;
  if (command === 'baseline') { const b = await captureBaseline({ rest, manifest }); save('acceptance-baseline', { capturedAt: at, occurrences: b }); result = { occurrences: b.length }; }
  else if (command === 'grants') { const g = await captureGrants({ rest, since: SINCE }); save('acceptance-grants', { capturedAt: at, since: SINCE, grants: g }); result = { grants: g.length }; }
  else if (command === 'revoke') { const captured = JSON.parse(readFileSync(`${DIR}/acceptance-grants.json`, 'utf8')).grants; const r = await revokeCaptured({ rest, captured }); save('acceptance-revocations', { at, results: r }); result = { revoked: r.length }; }
  else if (command === 'creations') { const c = await captureCreations({ rest, since: SINCE, manifest }); const next = extendManifest(manifest, c.added, at); save('manifest-acceptance', next); result = { added: c.added.length, newBehaviors: c.newBehaviors.length }; }
  else if (command === 'restore') { const baseline = JSON.parse(readFileSync(`${DIR}/acceptance-baseline.json`, 'utf8')).occurrences; const r = await restoreBaseline({ rest, baseline }); save('acceptance-restore', { at, results: r }); result = { changed: r.length }; }
  else throw new Stop('command');
  process.stdout.write(`${JSON.stringify({ result: 'complete', command, ...result })}\n`);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { process.stdout.write(`${JSON.stringify({ result: 'stopped', reason: e instanceof Stop ? e.reason : 'internal-error' })}\n`); process.exit(1); });
}
