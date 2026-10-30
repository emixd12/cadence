// Ticket 250: server-side acceptance watcher. Read-only polling of Cadence's own
// OAuth and integration records for test accounts A and B, printed as a
// timeline and appended to the run ledger. `--expect <scenario>` waits for an
// ordered list of events and exits 0, or exits 1 with a diff on timeout.
//
// Sources:
// - rpc (production and local): each test account's own Supabase session plus
//   the publishable key calls oauth_list_grants and oauth_list_activity, the
//   same read path as scripts/mcp-acceptance-cleanup.mjs. RLS and auth.uid()
//   apply; no service role.
// - db (local only): one read-only transaction against a loopback local stack,
//   which also sees client registrations, token families, refresh rotation and
//   revocation reasons.
//
// Events hold identifiers, client names, scopes, operation names, outcomes,
// error codes and timestamps only. Never tokens, codes, cookies, response
// bodies or note text. Source errors are reported by fixed labels only.
import { execFile } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isCliEntry } from './cli-entry.mjs';
import { SCENARIOS } from './scenarios/index.mjs';

export { SCENARIOS };

export const PRODUCTION_SUPABASE_ORIGIN = 'https://qjodzutjxtmtzczbloxa.supabase.co';
export const TEST_ACCOUNTS = Object.freeze({
  A: Object.freeze({ userId: 'caefd1b8-ea46-485f-8869-119a715fb092', email: 'cadence.testing.is@gmail.com' }),
  B: Object.freeze({ userId: 'c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b', email: 'brittlebeliefs@gmail.com' }),
});

// Mirrors packages/core/src/integration/operations.ts; a test keeps them equal.
export const OPERATION_ACCESS = Object.freeze({
  get_account_context: 'read', list_behaviors: 'read', get_behavior: 'read', list_categories: 'read',
  get_timeline: 'read', list_occurrences: 'read', get_occurrence: 'read', get_adherence_summary: 'read',
  search: 'read', fetch: 'read',
  set_occurrence_status: 'write', update_occurrence_note: 'write', create_behavior: 'write',
  update_behavior: 'write', archive_behavior: 'write', restore_behavior: 'write',
});

export const KINDS = Object.freeze([
  'client.registered', 'grant.created', 'grant.reconsented', 'grant.used', 'grant.revoked',
  'token.issued', 'token.refreshed', 'token.family_revoked', 'tool.call',
]);
const KIND_ORDER = Object.fromEntries(KINDS.map((kind, index) => [kind, index]));
// Kinds each source can see. Steps that need a missing kind are reported as unverifiable.
export const SOURCE_KINDS = Object.freeze({
  rpc: Object.freeze(['grant.created', 'grant.reconsented', 'grant.used', 'grant.revoked', 'tool.call']),
  db: KINDS,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = new Set(['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write']);
const SLUG = /^[a-z][a-z0-9_]{0,63}$/;
const OUTCOMES = new Set(['success', 'denied', 'invalid', 'conflict', 'rate_limited', 'error']);
const VERIFIED = new Set(['claude', 'claude_code', 'chatgpt']);
const RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class WatchError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new WatchError(code); };

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const stepMatches = (step, event, bound) => {
  if (event.kind !== step.kind) return false;
  if (step.sameGrant && bound.grant && event.grantId !== bound.grant) return false;
  if (step.sameClient && bound.client && event.clientId !== bound.client) return false;
  if (step.bindsGrant && bound.presetGrant && event.grantId !== bound.presetGrant) return false;
  if (step.access && OPERATION_ACCESS[event.operation] !== step.access) return false;
  return Object.entries(step.where ?? {}).every(([key, value]) => (event[key] ?? null) === value);
};

/**
 * Ordered match of a scenario against events sorted by time. Steps whose kind
 * the source cannot see are `unverifiable` and do not block. `grantId` (from
 * --grant) restricts the grant step to that grant.
 *
 * Binding steps (bindsClient, bindsGrant) backtrack: each matching candidate
 * is tried in order, and the first one under which every later step matches
 * wins. A window can hold other clients, and one client can hold several
 * grants (a read-only link, then a full one). Other steps take their earliest
 * match, which leaves the most room for the steps after them. With no full
 * match, the deepest partial match is reported.
 */
export function matchScenario(scenario, events, { kinds = KINDS, grantId = null } = {}) {
  const sorted = sortEvents(events);
  const all = scenario.steps;
  let best = { index: -1, path: [], bound: null };
  const solve = (index, cursor, bound, path) => {
    if (index === all.length) return { path, bound };
    const step = all[index];
    if (!kinds.includes(step.kind)) return solve(index + 1, cursor, bound, [...path, { id: step.id, status: 'unverifiable', step }]);
    const binds = step.bindsGrant || step.bindsClient;
    for (let i = cursor; i < sorted.length; i++) {
      const event = sorted[i];
      if (!stepMatches(step, event, bound)) continue;
      const next = { ...bound, ...(step.bindsGrant ? { grant: event.grantId } : {}), ...(step.bindsClient ? { client: event.clientId } : {}) };
      const done = solve(index + 1, i + 1, next, [...path, { id: step.id, status: 'matched', step, event }]);
      if (done) return done;
      if (!binds) break;
    }
    if (index > best.index) best = { index, path, bound };
    return null;
  };
  const start = { grant: null, client: null, presetGrant: grantId };
  const done = solve(0, 0, start, []);
  if (done) return { scenario: scenario.name, satisfied: true, grantId: done.bound.grant, steps: done.path };
  const { index, path, bound } = best;
  const step = all[index];
  // Nearest same-kind evidence shows why, for example a denied write.
  const near = sorted.filter((e) => e.kind === step.kind && (!step.sameGrant || !bound.grant || e.grantId === bound.grant)
    && (!step.access || OPERATION_ACCESS[e.operation] === step.access)).slice(-3);
  const steps = [...path, { id: step.id, status: 'missing', step, near }];
  // Order matters, so every later step is missing too.
  for (const rest of all.slice(index + 1)) {
    steps.push({ id: rest.id, status: kinds.includes(rest.kind) ? 'missing' : 'unverifiable', step: rest, near: [] });
  }
  return { scenario: scenario.name, satisfied: false, grantId: bound.grant, steps };
}

const describeStep = (step) => {
  const parts = [step.kind];
  if (step.access) parts.push(`access=${step.access}`);
  for (const [key, value] of Object.entries(step.where ?? {})) parts.push(`${key}=${value === null ? 'none' : value}`);
  if (step.sameClient) parts.push('same client');
  if (step.sameGrant) parts.push('same grant');
  return parts.join(' ');
};

export function formatDiff(result, { source }) {
  const lines = [`scenario ${result.scenario}: ${result.satisfied ? 'satisfied' : 'NOT satisfied'}${result.grantId ? ` (grant ${short(result.grantId)})` : ''}`];
  for (const s of result.steps) {
    if (s.status === 'matched') lines.push(`  ok    ${s.id.padEnd(17)} ${s.event.at}  ${summarize(s.event)}`);
    else if (s.status === 'unverifiable') lines.push(`  skip  ${s.id.padEnd(17)} ${s.step.kind} is not visible to the ${source} source`);
    else {
      lines.push(`  MISS  ${s.id.padEnd(17)} expected ${describeStep(s.step)}`);
      for (const n of s.near ?? []) lines.push(`        nearest  ${n.at}  ${summarize(n)}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Normalizing source rows. Only whitelisted fields leave these functions.
// ---------------------------------------------------------------------------

const iso = (value) => {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fail('invalid-timestamp');
};
const uuid = (value) => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail('invalid-id'));
// Client names are client-supplied: strip control characters and cap the length.
const clientName = (value) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : fail('invalid-client-name'));
// Client IDs are UUIDs (DCR) or https metadata URLs (CIMD). Keep only origin and path.
const clientId = (value) => {
  if (typeof value !== 'string' || !value) fail('invalid-client-id');
  if (UUID.test(value)) return value.toLowerCase();
  try { const u = new URL(value); return u.protocol === 'https:' ? `${u.origin}${u.pathname}`.slice(0, 200) : fail('invalid-client-id'); }
  catch (error) { if (error instanceof WatchError) throw error; return fail('invalid-client-id'); }
};
const scopes = (value) => {
  if (!Array.isArray(value) || !value.every((s) => SCOPES.has(s))) fail('invalid-scopes');
  return [...new Set(value)].sort();
};
const slug = (value, nullable = false) => {
  if (nullable && (value === null || value === undefined)) return null;
  return typeof value === 'string' && SLUG.test(value) ? value : fail('invalid-code');
};
const verified = (value) => (value === null || value === undefined ? null : VERIFIED.has(value) ? value : fail('invalid-verified-client'));

export function normalizeGrant(row, account) {
  if (!isObject(row)) fail('invalid-grant');
  return {
    account, grantId: uuid(row.grant_id), clientId: clientId(row.client_id), clientName: clientName(row.client_name),
    verifiedClient: verified(row.verified_client), scopes: scopes(row.scopes), createdAt: iso(row.created_at),
    lastUsedAt: iso(row.last_used_at), updatedAt: iso(row.updated_at ?? null),
    revokedAt: iso(row.revoked_at ?? null), revokedReason: row.revoked_reason === undefined || row.revoked_reason === null ? null : slug(row.revoked_reason),
    registrationType: row.registration_type === 'dcr' || row.registration_type === 'cimd' ? row.registration_type : null,
  };
}

export function normalizeActivity(row, account) {
  if (!isObject(row)) fail('invalid-activity');
  const id = typeof row.activity_id === 'number' || (typeof row.activity_id === 'string' && /^\d{1,19}$/.test(row.activity_id)) ? String(row.activity_id) : fail('invalid-activity-id');
  if (!OUTCOMES.has(row.outcome)) fail('invalid-outcome');
  return {
    account, activityId: id, grantId: uuid(row.grant_id), clientName: clientName(row.client_name),
    operation: slug(row.operation), outcome: row.outcome, errorCode: slug(row.error_code, true),
    occurredAt: iso(row.occurred_at),
    targetCount: Number.isInteger(row.target_count) ? row.target_count : null,
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * rpc source: `rest(slot, method, path, body)` is createRest from
 * scripts/mcp-acceptance-cleanup.mjs (or a test fake) bound to the account's
 * own session. Returns a snapshot; never returns or logs response bodies.
 */
export function createRpcSource({ rest, accounts, sinceIso, activityPages = 5 }) {
  const read = async (slot, path, body, label) => {
    const r = await rest(slot, 'POST', path, body);
    if (!r || r.status !== 200 || !Array.isArray(r.json)) fail(`${label}-unreadable`);
    return r.json;
  };
  return {
    name: 'rpc',
    kinds: SOURCE_KINDS.rpc,
    async snapshot() {
      const grants = [];
      const activity = [];
      for (const slot of accounts) {
        for (const row of await read(slot, '/rest/v1/rpc/oauth_list_grants', {}, `grants-${slot}`)) grants.push(normalizeGrant(row, slot));
        let before = null;
        for (let page = 0; page < activityPages; page++) {
          const rows = await read(slot, '/rest/v1/rpc/oauth_list_activity', before ? { p_limit: 100, p_before: before } : { p_limit: 100 }, `activity-${slot}`);
          const normalized = rows.map((row) => normalizeActivity(row, slot));
          activity.push(...normalized.filter((a) => a.occurredAt >= sinceIso));
          const oldest = normalized.at(-1);
          if (rows.length < 100 || !oldest || oldest.occurredAt < sinceIso) break;
          before = oldest.occurredAt;
        }
      }
      return { grants, activity, complete: { revocations: false } };
    },
  };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
// The owner's default local project keeps real local data. Never read it.
const OWNER_LOCAL_DB_PORTS = new Set(['55322']);

export function assertLocalDbUrl(dbUrl) {
  let url;
  try { url = new URL(dbUrl); } catch { return fail('db-url-invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('db-url-invalid');
  if (!LOOPBACK.has(url.hostname)) fail('db-url-not-loopback');
  if (OWNER_LOCAL_DB_PORTS.has(url.port)) fail('db-url-owner-stack');
  return url.toString();
}

const SNAPSHOT_SQL = `
begin transaction read only;
with users as (select unnest(:'users'::uuid[]) as id),
since as (select :'since'::timestamptz as at)
select json_build_object(
  'grants', coalesce((select json_agg(json_build_object(
      'user_id', g.user_id, 'grant_id', g.id, 'client_id', c.client_id, 'client_name', c.client_name,
      'verified_client', c.verified_client, 'registration_type', c.registration_type, 'scopes', g.scopes,
      'created_at', g.created_at, 'updated_at', g.updated_at, 'last_used_at', g.last_used_at,
      'revoked_at', g.revoked_at, 'revoked_reason', g.revoked_reason) order by g.created_at, g.id)
    from cadence_oauth_private.grants g join cadence_oauth_private.clients c on c.id = g.client_ref
    where g.user_id in (select id from users)
      and (g.revoked_at is null or g.revoked_at >= (select at from since))), '[]'::json),
  'clients', coalesce((select json_agg(json_build_object(
      'client_ref', c.id, 'client_id', c.client_id, 'client_name', c.client_name, 'verified_client', c.verified_client,
      'registration_type', c.registration_type, 'application_type', c.application_type, 'created_at', c.created_at,
      'user_ids', (select coalesce(array_agg(distinct g.user_id), '{}') from cadence_oauth_private.grants g where g.client_ref = c.id))
      order by c.created_at, c.id)
    from cadence_oauth_private.clients c
    where c.created_at >= (select at from since)
      and (not exists (select 1 from cadence_oauth_private.grants g where g.client_ref = c.id)
        or exists (select 1 from cadence_oauth_private.grants g where g.client_ref = c.id and g.user_id in (select id from users)))), '[]'::json),
  'families', coalesce((select json_agg(json_build_object(
      'user_id', f.user_id, 'family_id', f.id, 'grant_id', f.grant_id, 'created_at', f.created_at,
      'revoked_at', f.revoked_at, 'revoked_reason', f.revoked_reason, 'offline_access', f.offline_access) order by f.created_at, f.id)
    from cadence_oauth_private.token_families f
    where f.user_id in (select id from users)
      and (f.created_at >= (select at from since) or f.revoked_at >= (select at from since))), '[]'::json),
  'refreshes', coalesce((select json_agg(json_build_object(
      'user_id', t.user_id, 'family_id', t.family_id, 'grant_id', t.grant_id, 'rotated_at', t.rotated_at,
      'token_ref', md5(t.token_hash)) order by t.rotated_at)
    from cadence_oauth_private.tokens t
    where t.user_id in (select id from users) and t.token_type = 'refresh'
      and t.rotated_at >= (select at from since)), '[]'::json),
  'activity', coalesce((select json_agg(row_data order by occurred_at, activity_id) from (
      select json_build_object('user_id', a.user_id, 'activity_id', a.id, 'grant_id', a.grant_id, 'client_name', c.client_name,
        'operation', a.operation, 'outcome', a.outcome, 'error_code', a.error_code, 'occurred_at', a.occurred_at,
        'target_count', cardinality(a.target_ids)) as row_data, a.occurred_at, a.id as activity_id
      from cadence_oauth_private.activity a join cadence_oauth_private.clients c on c.id = a.client_ref
      where a.user_id in (select id from users) and a.occurred_at >= (select at from since)
      order by a.occurred_at, a.id limit 2000) as recent), '[]'::json)
);
rollback;
`;

/** Runs SNAPSHOT_SQL through psql in a read-only transaction. Output is parsed, never printed. */
export function psqlQuery({ dbUrl, users, sinceIso, execFileImpl = execFile, timeoutMs = 10_000 }) {
  const url = assertLocalDbUrl(dbUrl);
  if (!users.every((u) => UUID.test(u))) fail('invalid-user-id');
  iso(sinceIso);
  return new Promise((resolve, reject) => {
    const child = execFileImpl('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', `users={${users.join(',')}}`, '-v', `since=${sinceIso}`, url], {
      encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '5' },
    }, (error, stdout) => {
      // psql stderr can echo SQL or values; it is never read.
      if (error) return reject(new WatchError('db-unreadable'));
      try {
        const line = String(stdout).split('\n').map((l) => l.trim()).filter(Boolean).find((l) => l.startsWith('{'));
        const parsed = JSON.parse(line);
        return isObject(parsed) ? resolve(parsed) : reject(new WatchError('db-unreadable'));
      } catch { return reject(new WatchError('db-unreadable')); }
    });
    child.stdin?.end(SNAPSHOT_SQL);
  });
}

/** db source for a local stack. `query({ users, sinceIso })` returns the SNAPSHOT_SQL object. */
export function createDbSource({ query, userIds, sinceIso }) {
  const slotOf = new Map(Object.entries(userIds).map(([slot, id]) => [id.toLowerCase(), slot]));
  const accountOf = (userId) => slotOf.get(uuid(userId)) ?? fail('unexpected-user');
  return {
    name: 'db',
    kinds: SOURCE_KINDS.db,
    async snapshot() {
      const raw = await query({ users: [...slotOf.keys()], sinceIso });
      for (const key of ['grants', 'clients', 'families', 'refreshes', 'activity']) if (!Array.isArray(raw[key])) fail('db-shape');
      const grants = raw.grants.map((row) => normalizeGrant(row, accountOf(row.user_id)));
      const activity = raw.activity.map((row) => normalizeActivity(row, accountOf(row.user_id)));
      const clients = raw.clients.map((row) => {
        if (!isObject(row) || !Array.isArray(row.user_ids)) fail('db-shape');
        const owners = [...new Set(row.user_ids.map((id) => slotOf.get(uuid(id))).filter(Boolean))];
        return {
          clientRef: uuid(row.client_ref), clientId: clientId(row.client_id), clientName: clientName(row.client_name),
          verifiedClient: verified(row.verified_client), registrationType: row.registration_type === 'cimd' ? 'cimd' : row.registration_type === 'dcr' ? 'dcr' : fail('db-shape'),
          applicationType: row.application_type === 'native' ? 'native' : 'web', createdAt: iso(row.created_at),
          account: owners.length === 1 ? owners[0] : null,
        };
      });
      const families = raw.families.map((row) => ({
        account: accountOf(row.user_id), familyId: uuid(row.family_id), grantId: uuid(row.grant_id), createdAt: iso(row.created_at),
        revokedAt: iso(row.revoked_at), revokedReason: row.revoked_reason === null ? null : slug(row.revoked_reason), offlineAccess: row.offline_access === true,
      }));
      const refreshes = raw.refreshes.map((row) => ({
        account: accountOf(row.user_id), familyId: uuid(row.family_id), grantId: uuid(row.grant_id), rotatedAt: iso(row.rotated_at),
        // md5 of the stored SHA-256 hash: a stable row key, not a token or its hash.
        tokenRef: typeof row.token_ref === 'string' && /^[a-f0-9]{32}$/.test(row.token_ref) ? row.token_ref.slice(0, 12) : fail('db-shape'),
      }));
      return { grants, activity, clients, families, refreshes, complete: { revocations: true } };
    },
  };
}

// ---------------------------------------------------------------------------
// Snapshot diffing
// ---------------------------------------------------------------------------

export function sortEvents(events) {
  return [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
}

/**
 * Stateful differ. Turns successive snapshots into new events, once each.
 * Grants created before `since` are a silent baseline; their later
 * re-consents and revocations still count. grant.created carries the scopes
 * seen at first observation.
 */
export function createDiffer({ sinceIso, sourceName }) {
  const seen = new Set();
  const grants = new Map();
  return (snapshot, observedAt) => {
    const out = [];
    const emit = (event) => {
      if (seen.has(event.key)) return;
      seen.add(event.key);
      out.push({ source: sourceName, ...event });
    };
    for (const c of snapshot.clients ?? []) {
      emit({ key: `client.registered:${c.clientRef}`, kind: 'client.registered', at: c.createdAt, account: c.account,
        clientId: c.clientId, clientName: c.clientName, verifiedClient: c.verifiedClient, registrationType: c.registrationType, applicationType: c.applicationType });
    }
    const current = new Map();
    for (const g of snapshot.grants) {
      const revoked = g.revokedAt !== null;
      if (!revoked) current.set(g.grantId, g);
      const prev = grants.get(g.grantId);
      const base = { account: g.account, grantId: g.grantId, clientId: g.clientId, clientName: g.clientName, verifiedClient: g.verifiedClient };
      if (!prev && g.createdAt >= sinceIso) {
        emit({ key: `grant.created:${g.grantId}`, kind: 'grant.created', at: g.createdAt, ...base, scopes: g.scopes, registrationType: g.registrationType });
      }
      // Re-consent (including step-up) rewrites the grant's scopes and updated_at.
      // The db source sees updated_at; the rpc source sees only a scope change.
      const scopesChanged = prev ? prev.scopes.join(' ') !== g.scopes.join(' ') : null;
      if (g.updatedAt !== null) {
        if (!revoked && g.updatedAt > g.createdAt && g.updatedAt >= sinceIso && (!prev || prev.updatedAt !== g.updatedAt)) {
          emit({ key: `grant.reconsented:${g.grantId}:${g.updatedAt}`, kind: 'grant.reconsented', at: g.updatedAt, ...base,
            scopes: g.scopes, previousScopes: prev?.scopes ?? null, scopesChanged });
        }
      } else if (scopesChanged) {
        emit({ key: `grant.reconsented:${g.grantId}:${g.scopes.join(' ')}:${observedAt}`, kind: 'grant.reconsented', at: observedAt, observed: true, ...base,
          scopes: g.scopes, previousScopes: prev.scopes, scopesChanged });
      }
      if (g.lastUsedAt && g.lastUsedAt >= sinceIso && (!prev || prev.lastUsedAt !== g.lastUsedAt)) {
        emit({ key: `grant.used:${g.grantId}:${g.lastUsedAt}`, kind: 'grant.used', at: g.lastUsedAt, ...base });
      }
      if (revoked && g.revokedAt >= sinceIso) {
        emit({ key: `grant.revoked:${g.grantId}`, kind: 'grant.revoked', at: g.revokedAt, ...base, reason: g.revokedReason });
      }
      grants.set(g.grantId, { ...g, active: !revoked });
    }
    // The rpc source lists active grants only: a grant that disappears was revoked.
    if (!snapshot.complete?.revocations) {
      for (const [id, g] of grants) {
        if (g.active && !current.has(id)) {
          emit({ key: `grant.revoked:${id}`, kind: 'grant.revoked', at: observedAt, observed: true, account: g.account,
            grantId: id, clientId: g.clientId, clientName: g.clientName, verifiedClient: g.verifiedClient, reason: null });
          grants.set(id, { ...g, active: false });
        }
      }
    }
    for (const f of snapshot.families ?? []) {
      if (f.createdAt >= sinceIso) emit({ key: `token.issued:${f.familyId}`, kind: 'token.issued', at: f.createdAt, account: f.account, grantId: f.grantId, familyId: f.familyId, offlineAccess: f.offlineAccess });
      if (f.revokedAt && f.revokedAt >= sinceIso) emit({ key: `token.family_revoked:${f.familyId}`, kind: 'token.family_revoked', at: f.revokedAt, account: f.account, grantId: f.grantId, familyId: f.familyId, reason: f.revokedReason });
    }
    for (const r of snapshot.refreshes ?? []) {
      emit({ key: `token.refreshed:${r.tokenRef}`, kind: 'token.refreshed', at: r.rotatedAt, account: r.account, grantId: r.grantId, familyId: r.familyId });
    }
    for (const a of snapshot.activity) {
      emit({ key: `tool.call:${a.activityId}`, kind: 'tool.call', at: a.occurredAt, account: a.account, grantId: a.grantId, clientName: a.clientName,
        operation: a.operation, access: OPERATION_ACCESS[a.operation] ?? 'unknown', outcome: a.outcome, errorCode: a.errorCode,
        ...(a.targetCount === null ? {} : { targetCount: a.targetCount }) });
    }
    return sortEvents(out);
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const short = (id) => (typeof id === 'string' ? id.slice(0, 8) : '-');

export function summarize(e) {
  switch (e.kind) {
    case 'client.registered': return `${e.registrationType} client "${e.clientName}"${e.verifiedClient ? ` verified=${e.verifiedClient}` : ''}`;
    case 'grant.created': return `grant ${short(e.grantId)} "${e.clientName}"${e.verifiedClient ? ` verified=${e.verifiedClient}` : ''} scopes=${e.scopes.join(',')}`;
    case 'grant.reconsented': return `grant ${short(e.grantId)} re-consented scopes ${e.previousScopes ? e.previousScopes.join(',') : '?'} -> ${e.scopes.join(',')}${e.observed ? ' (observed)' : ''}`;
    case 'grant.used': return `grant ${short(e.grantId)} last used`;
    case 'grant.revoked': return `grant ${short(e.grantId)} revoked${e.reason ? ` reason=${e.reason}` : ''}${e.observed ? ' (observed)' : ''}`;
    case 'token.issued': return `grant ${short(e.grantId)} token family ${short(e.familyId)} issued${e.offlineAccess ? ' with refresh' : ''}`;
    case 'token.refreshed': return `grant ${short(e.grantId)} family ${short(e.familyId)} refreshed`;
    case 'token.family_revoked': return `grant ${short(e.grantId)} family ${short(e.familyId)} revoked reason=${e.reason}`;
    case 'tool.call': return `${e.operation} ${e.outcome}${e.errorCode ? ` ${e.errorCode}` : ''} grant ${short(e.grantId)} "${e.clientName}"`;
    default: return e.kind;
  }
}

export const formatTimelineLine = (e) => `${e.at}  ${e.account ?? '?'}  ${e.kind.padEnd(20)} ${summarize(e)}`;

/** Ledger record: the event without its internal dedupe key. */
export const ledgerRecord = (event, runId) => {
  const rest = Object.fromEntries(Object.entries(event).filter(([name]) => name !== 'key'));
  return { type: 'watcher.event', run: runId, ...rest };
};

/** Append-only JSONL sink in the Ticket 247 run folder layout. */
export function createLedgerSink({ root = '.intent/acceptance', runId }) {
  if (!RUN_ID.test(runId ?? '')) fail('invalid-run-id');
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'events.jsonl');
  const created = !existsSync(file);
  return {
    file,
    append(records) {
      if (!records.length) return;
      appendFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(''), { mode: 0o600 });
      if (created) chmodSync(file, 0o600);
    },
  };
}

// ---------------------------------------------------------------------------
// Watch loop
// ---------------------------------------------------------------------------

export function parseDuration(value, name) {
  if (typeof value !== 'string') fail(`${name}-invalid`);
  const m = /^(\d{1,6})(ms|s|m|h)$/.exec(value);
  if (!m) fail(`${name}-invalid`);
  return Number(m[1]) * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[m[2]];
}

export function parseSince(value, nowMs) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) fail('since-invalid');
    return new Date(ms).toISOString();
  }
  return new Date(nowMs - parseDuration(value, 'since')).toISOString();
}

export function parseWatchArgs(args) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    target: { type: 'string' }, account: { type: 'string', default: 'A' }, since: { type: 'string', default: '10m' },
    expect: { type: 'string' }, run: { type: 'string' }, grant: { type: 'string' }, source: { type: 'string' },
    timeout: { type: 'string', default: '10m' }, interval: { type: 'string', default: '3s' }, once: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false }, 'confirm-production': { type: 'boolean', default: false },
    'db-url': { type: 'string' }, 'supabase-workdir': { type: 'string' },
    'user-a': { type: 'string' }, 'user-b': { type: 'string' }, 'list-scenarios': { type: 'boolean', default: false },
  } });
  if (values['list-scenarios']) return { listScenarios: true };
  if (!['local', 'production'].includes(values.target)) fail('target-required');
  const accounts = values.account === 'both' ? ['A', 'B'] : ['A', 'B'].includes(values.account) ? [values.account] : fail('account-invalid');
  if (values.expect !== undefined && !SCENARIOS[values.expect]) fail('unknown-scenario');
  if (values.run !== undefined && !RUN_ID.test(values.run)) fail('invalid-run-id');
  if (values.grant !== undefined && !UUID.test(values.grant)) fail('invalid-grant-id');
  const source = values.source ?? (values.target === 'local' ? 'db' : 'rpc');
  if (!['db', 'rpc'].includes(source)) fail('source-invalid');
  if (values.target === 'production') {
    if (source !== 'rpc') fail('production-rpc-only');
    if (!values['confirm-production']) fail('confirm-production-required');
    if (values['user-a'] || values['user-b'] || values['db-url'] || values['supabase-workdir']) fail('production-fixed-accounts');
  }
  for (const flag of ['user-a', 'user-b']) if (values[flag] !== undefined && !UUID.test(values[flag])) fail(`${flag}-invalid`);
  return {
    target: values.target, accounts, sinceArg: values.since, expect: values.expect ?? null, runId: values.run ?? null,
    grantId: values.grant?.toLowerCase() ?? null, source, timeoutMs: parseDuration(values.timeout, 'timeout'),
    intervalMs: Math.max(parseDuration(values.interval, 'interval'), 500), once: values.once, json: values.json,
    dbUrl: values['db-url'] ?? null, supabaseWorkdir: values['supabase-workdir'] ?? null,
    userIds: { A: values['user-a']?.toLowerCase() ?? null, B: values['user-b']?.toLowerCase() ?? null },
  };
}

/**
 * Polls `source` until the expectation is met, the timeout passes, or (without
 * --expect) the timeout or signal ends the watch. Returns an exit code.
 * Three consecutive source failures stop the watch (exit 3).
 */
export async function watch({ options, source, sinceIso, print, sink = null, now = () => Date.now(), sleep, signal }) {
  const differ = createDiffer({ sinceIso, sourceName: source.name });
  const events = [];
  const scenario = options.expect ? SCENARIOS[options.expect] : null;
  const deadline = now() + options.timeoutMs;
  let failures = 0;
  let result = null;
  print(`watching ${options.target} accounts ${options.accounts.join(',')} since ${sinceIso} via ${source.name}${scenario ? `, expecting ${scenario.name}` : ''}`);
  while (true) {
    const observedAt = new Date(now()).toISOString();
    try {
      const snapshot = await source.snapshot();
      failures = 0;
      const fresh = differ(snapshot, observedAt).filter((e) => options.accounts.includes(e.account) || e.account === null);
      events.push(...fresh);
      for (const e of fresh) print(options.json ? JSON.stringify(ledgerRecord(e, options.runId)) : formatTimelineLine(e));
      sink?.append(fresh.map((e) => ledgerRecord(e, options.runId)));
    } catch (error) {
      failures += 1;
      print(`source-error ${error instanceof WatchError ? error.code : 'unreadable'} (${failures}/3)`);
      if (failures >= 3) {
        sink?.append([{ type: 'watcher.result', run: options.runId, at: observedAt, result: 'source-error', scenario: scenario?.name ?? null }]);
        return 3;
      }
    }
    if (scenario) {
      result = matchScenario(scenario, events, { kinds: source.kinds, grantId: options.grantId });
      if (result.satisfied) break;
    }
    if (options.once || signal?.aborted || now() >= deadline) break;
    await sleep(Math.min(options.intervalMs, Math.max(0, deadline - now())));
    if (signal?.aborted) break;
  }
  if (!scenario) return 0;
  print(formatDiff(result, { source: source.name }));
  sink?.append([{ type: 'watcher.result', run: options.runId, at: new Date(now()).toISOString(), scenario: scenario.name,
    result: result.satisfied ? 'satisfied' : 'timeout', grantId: result.grantId,
    steps: result.steps.map((s) => ({ id: s.id, status: s.status, ...(s.event ? { at: s.event.at, kind: s.event.kind } : {}) })) }]);
  return result.satisfied ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI wiring (not exercised by fixture tests)
// ---------------------------------------------------------------------------

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(new WatchError(`${file.split('/').at(-1)}-failed`)) : resolve(stdout)));
  });
}

async function localDbUrl(options) {
  if (options.dbUrl) return assertLocalDbUrl(options.dbUrl);
  if (!options.supabaseWorkdir) fail('db-url-or-workdir-required');
  const cli = process.env.CADENCE_SUPABASE_CLI ?? '/opt/homebrew/bin/supabase';
  let status;
  try { status = JSON.parse(await run(cli, ['status', '--workdir', options.supabaseWorkdir, '-o', 'json'])); } catch { fail('supabase-status-unreadable'); }
  return assertLocalDbUrl(status?.DB_URL ?? '');
}

async function resolveLocalUsers(dbUrl, options) {
  const ids = { ...options.userIds };
  const missing = ['A', 'B'].filter((slot) => !ids[slot]);
  if (missing.length) {
    // Same emails as the production test accounts; read-only lookup on the local stack.
    const out = await run('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
      `begin transaction read only; select email || ' ' || id from auth.users where email in ('${TEST_ACCOUNTS.A.email}', '${TEST_ACCOUNTS.B.email}'); rollback;`, dbUrl]);
    for (const line of out.split('\n')) {
      const [email, id] = line.trim().split(' ');
      for (const slot of missing) if (email === TEST_ACCOUNTS[slot].email && UUID.test(id ?? '')) ids[slot] = id.toLowerCase();
    }
  }
  const resolved = Object.fromEntries(options.accounts.map((slot) => [slot, ids[slot] ?? fail(`local-user-${slot}-unresolved`)]));
  return resolved;
}

/**
 * Production publishable key from CADENCE_QA_SUPABASE_PUBLISHABLE_KEY, the same
 * variable Ticket 248 reads. Public, but the watcher never reaches for an owner
 * credential to look it up.
 */
export function publishableKeyFrom(env) {
  const key = env?.CADENCE_QA_SUPABASE_PUBLISHABLE_KEY;
  return /^sb_publishable_[A-Za-z0-9_-]+$/.test(key ?? '') ? key : fail('qa-publishable-key-missing');
}

/**
 * Production sessions come from Ticket 248's kept test-account sessions
 * (scripts/acceptance/test-account-sessions.mjs). current() verifies the user
 * with Auth and refreshes near expiry, so each account's token is reused for
 * `cacheMs` between polls. Failures return null, which the rest adapter turns
 * into a fixed unreadable label. The live Ticket 232 broker socket is never used.
 */
export function createSessionTokenFor(sessionsModule, { publishableKey, now = () => Date.now(), cacheMs = 60_000 }) {
  const { createSessionManager, createKeychainSessionStore, PRODUCTION } = sessionsModule ?? {};
  if (typeof createSessionManager !== 'function' || typeof createKeychainSessionStore !== 'function' || PRODUCTION?.supabaseUrl !== PRODUCTION_SUPABASE_ORIGIN) {
    fail('session-provider-unavailable');
  }
  const manager = createSessionManager({ target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey, store: createKeychainSessionStore() });
  const cache = new Map();
  return async (slot) => {
    const hit = cache.get(slot);
    if (hit && now() - hit.at < cacheMs) return hit.token;
    cache.delete(slot);
    try {
      const token = (await manager.current(slot, { expectUserId: TEST_ACCOUNTS[slot].userId }))?.accessToken;
      if (typeof token !== 'string' || !token) return null;
      cache.set(slot, { token, at: now() });
      return token;
    } catch { return null; }
  };
}

async function productionTokenFor(publishableKey) {
  let mod;
  try { mod = await import('./test-account-sessions.mjs'); } catch { fail('session-provider-unavailable'); }
  return createSessionTokenFor(mod, { publishableKey });
}

export async function main(args = process.argv.slice(2), print = (line) => process.stdout.write(`${line}\n`), env = process.env) {
  let options;
  try {
    options = parseWatchArgs(args);
    if (options.listScenarios) {
      for (const s of Object.values(SCENARIOS)) print(`${s.name}: ${s.description}\n  ${s.steps.map((step) => step.id).join(' -> ')}`);
      return 0;
    }
    const sinceIso = parseSince(options.sinceArg, Date.now());
    let source;
    if (options.target === 'production') {
      const { createRest, USERS } = await import('../mcp-acceptance-cleanup.mjs');
      if (USERS.A !== TEST_ACCOUNTS.A.userId || USERS.B !== TEST_ACCOUNTS.B.userId) fail('test-account-mismatch');
      const key = publishableKeyFrom(env);
      const rest = createRest({ origin: PRODUCTION_SUPABASE_ORIGIN, publishableKey: key, tokenFor: await productionTokenFor(key) });
      source = createRpcSource({ rest, accounts: options.accounts, sinceIso });
    } else if (options.source === 'db') {
      const dbUrl = await localDbUrl(options);
      const userIds = await resolveLocalUsers(dbUrl, options);
      source = createDbSource({ query: ({ users, sinceIso: since }) => psqlQuery({ dbUrl, users, sinceIso: since }), userIds, sinceIso });
    } else {
      // Local rpc needs Ticket 248's local sessions; the integration step wires it.
      fail('local-rpc-needs-session-provider');
    }
    const sink = options.runId ? createLedgerSink({ runId: options.runId }) : null;
    const abort = new AbortController();
    process.once('SIGINT', () => abort.abort());
    process.once('SIGTERM', () => abort.abort());
    return await watch({ options, source, sinceIso, print, sink, signal: abort.signal,
      sleep: (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); abort.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); }) });
  } catch (error) {
    print(`watch-stopped ${error instanceof WatchError ? error.code : 'internal-error'}`);
    return 2;
  }
}

if (isCliEntry(import.meta)) process.exitCode = await main();
