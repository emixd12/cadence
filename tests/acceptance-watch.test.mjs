import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_OPERATIONS } from '../packages/core/src/integration/operations.ts';
import {
  OPERATION_ACCESS, SCENARIOS, createSessionTokenFor, SOURCE_KINDS, TEST_ACCOUNTS, WatchError, assertLocalDbUrl, createDbSource, createDiffer,
  createLedgerSink, createRpcSource, main, matchScenario, parseSince, parseWatchArgs, psqlQuery, publishableKeyFrom, watch,
} from '../scripts/acceptance/watch.mjs';
import { USERS } from '../scripts/mcp-acceptance-cleanup.mjs';

const T0 = Date.parse('2026-10-30T02:00:00.000Z');
const SINCE = new Date(T0 - 60_000).toISOString();
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = TEST_ACCOUNTS.A.userId;
const B = TEST_ACCOUNTS.B.userId;
const FULL = ['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read'];
// Planted values that must never reach output or the ledger.
const SECRETS = ['SECRET-ACCESS-TOKEN-0001', 'AUTHCODE-SECRET-0002', 'PRIVATE NOTE TEXT 0003', 'cookie-secret-0004', 'refresh-secret-0005'];
const planted = { access_token: SECRETS[0], code: SECRETS[1], note: SECRETS[2], cookie: SECRETS[3], refresh_token: SECRETS[4] };

const CLIENTS = {
  'claude-web': { verified_client: 'claude', registration_type: 'cimd', client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', client_name: 'Claude' },
  'claude-code': { verified_client: 'claude_code', registration_type: 'dcr', client_id: id(21), client_name: 'Claude Code' },
  chatgpt: { verified_client: 'chatgpt', registration_type: 'dcr', client_id: id(22), client_name: 'ChatGPT' },
  inspector: { verified_client: null, registration_type: 'dcr', client_id: id(23), client_name: 'MCP Inspector' },
  'anthropic-api': { verified_client: null, registration_type: 'dcr', client_id: id(24), client_name: 'Cadence acceptance driver' },
  'openai-api': { verified_client: null, registration_type: 'dcr', client_id: id(25), client_name: 'Cadence acceptance driver' },
};

/**
 * One client run as server-side records, each visible from second `t`.
 * stepUp: the link starts read-only, a write is denied, then re-consent adds write scopes.
 * write: 'success' | 'denied' | null (no write at all).
 */
function makeWorld(name, { stepUp = false, write = 'success', user = A, extraGrant = false } = {}) {
  const c = CLIENTS[name] ?? CLIENTS[name.replace(/-(partial|read)$/, '')];
  const clients = [{ client_ref: id(1), ...c, application_type: 'web', t: 5 }];
  const grants = [{ grant_id: id(3), client_ref: id(1), user, scopes: stepUp ? ['cadence.read'] : FULL, t: 10,
    reconsent: stepUp ? { t: 40, scopes: FULL } : null, revokeT: null }];
  if (extraGrant) {
    clients.push({ client_ref: id(2), ...c, client_id: id(26), client_name: 'Other driver', application_type: 'web', t: 6 });
    grants.push({ grant_id: id(30), client_ref: id(2), user, scopes: FULL, t: 11, reconsent: null, revokeT: null });
  }
  const families = [{ family_id: id(4), grant_id: id(3), user, t: 12, offline_access: true, revokeT: null }];
  const refreshes = [];
  const activity = [{ id: 1, grant_id: id(3), client_ref: id(1), user, operation: 'list_behaviors', outcome: 'success', error_code: null, t: 20 }];
  if (extraGrant) activity.push({ id: 9, grant_id: id(30), client_ref: id(2), user, operation: 'create_behavior', outcome: 'success', error_code: null, t: 21 });
  if (stepUp) activity.push({ id: 2, grant_id: id(3), client_ref: id(1), user, operation: 'create_behavior', outcome: 'denied', error_code: 'insufficient_scope', t: 30 });
  if (write === 'success') activity.push({ id: 3, grant_id: id(3), client_ref: id(1), user, operation: 'create_behavior', outcome: 'success', error_code: null, t: 50 });
  if (write === 'both') activity.push({ id: 3, grant_id: id(3), client_ref: id(1), user, operation: 'create_behavior', outcome: 'success', error_code: null, t: 50 },
    { id: 4, grant_id: id(3), client_ref: id(1), user, operation: 'set_occurrence_status', outcome: 'denied', error_code: 'insufficient_scope', t: 60 });
  if (write === 'denied') activity.push({ id: 3, grant_id: id(3), client_ref: id(1), user, operation: 'set_occurrence_status', outcome: 'denied', error_code: 'insufficient_scope', t: 50 });
  return { clients, grants, families, refreshes, activity };
}

const nowSec = (nowMs) => (nowMs - T0) / 1000;
const clientOf = (world, ref) => world.clients.find((c) => c.client_ref === ref);
const grantState = (g, s) => {
  const consented = g.reconsent && g.reconsent.t <= s;
  return { scopes: consented ? g.reconsent.scopes : g.scopes, updated: consented ? g.reconsent.t : g.revokeT !== null && g.revokeT <= s ? g.revokeT : g.t };
};

/** Raw rows in the shape SNAPSHOT_SQL returns, as of nowMs, with planted secrets. */
function dbRows(world, nowMs) {
  const s = nowSec(nowMs);
  const grantRow = (g) => {
    const c = clientOf(world, g.client_ref);
    const st = grantState(g, s);
    const revoked = g.revokeT !== null && g.revokeT <= s;
    return { ...planted, user_id: g.user, grant_id: g.grant_id, client_id: c.client_id, client_name: c.client_name, verified_client: c.verified_client,
      registration_type: c.registration_type, scopes: st.scopes, created_at: at(g.t), updated_at: at(st.updated), last_used_at: null,
      revoked_at: revoked ? at(g.revokeT) : null, revoked_reason: revoked ? 'user' : null };
  };
  return {
    grants: world.grants.filter((g) => g.t <= s).map(grantRow),
    clients: world.clients.filter((c) => c.t <= s).map((c) => ({ ...planted, client_ref: c.client_ref, client_id: c.client_id, client_name: c.client_name,
      verified_client: c.verified_client, registration_type: c.registration_type, application_type: c.application_type, created_at: at(c.t),
      user_ids: world.grants.filter((g) => g.client_ref === c.client_ref && g.t <= s).map((g) => g.user) })),
    families: world.families.filter((f) => f.t <= s).map((f) => ({ ...planted, user_id: f.user, family_id: f.family_id, grant_id: f.grant_id, created_at: at(f.t),
      revoked_at: f.revokeT !== null && f.revokeT <= s ? at(f.revokeT) : null, revoked_reason: f.revokeT !== null && f.revokeT <= s ? 'token_revocation' : null, offline_access: f.offline_access })),
    refreshes: world.refreshes.filter((r) => r.t <= s).map((r) => ({ ...planted, user_id: r.user, family_id: r.family_id, grant_id: r.grant_id, rotated_at: at(r.t), token_ref: r.ref })),
    activity: world.activity.filter((a) => a.t <= s).map((a) => ({ ...planted, user_id: a.user, activity_id: a.id, grant_id: a.grant_id,
      client_name: clientOf(world, a.client_ref).client_name, operation: a.operation, outcome: a.outcome, error_code: a.error_code, occurred_at: at(a.t), target_count: 1 })),
  };
}

/** PostgREST fake for oauth_list_grants and oauth_list_activity, as one account sees them. */
function restFor(world, clock, calls = []) {
  return async (slot, method, path, body) => {
    calls.push({ slot, method, path, body });
    const user = slot === 'A' ? A : B;
    const rows = dbRows(world, clock.now());
    if (path === '/rest/v1/rpc/oauth_list_grants') {
      return { status: 200, json: rows.grants.filter((g) => g.user_id === user && g.revoked_at === null).map((g) => ({ ...planted, grant_id: g.grant_id, client_id: g.client_id,
        client_name: g.client_name, client_uri: null, logo_uri: null, verified_client: g.verified_client, scopes: g.scopes, created_at: g.created_at, last_used_at: g.last_used_at })) };
    }
    if (path === '/rest/v1/rpc/oauth_list_activity') {
      const list = rows.activity.filter((a) => a.user_id === user && (!body.p_before || a.occurred_at < body.p_before))
        .sort((x, y) => (x.occurred_at < y.occurred_at ? 1 : -1)).slice(0, body.p_limit)
        .map((a) => ({ ...planted, activity_id: a.activity_id, grant_id: a.grant_id, client_name: a.client_name, operation: a.operation, outcome: a.outcome, error_code: a.error_code, occurred_at: a.occurred_at }));
      return { status: 200, json: list };
    }
    return { status: 404, json: { message: SECRETS[2] } };
  };
}

function fakeClock(start = T0) {
  let now = start;
  return { now: () => now, sleep: async (ms) => { now += ms; } };
}

const options = (over = {}) => ({ target: 'local', accounts: ['A'], expect: null, runId: 'run-250', grantId: null, timeoutMs: 120_000, intervalMs: 5_000, once: false, json: false, ...over });

async function runWatch({ world, source = 'db', opts = {}, root, clock = fakeClock() }) {
  const lines = [];
  const src = source === 'db'
    ? createDbSource({ query: async () => dbRows(world, clock.now()), userIds: { A, B }, sinceIso: SINCE })
    : createRpcSource({ rest: restFor(world, clock), accounts: opts.accounts ?? ['A'], sinceIso: SINCE });
  const sink = root ? createLedgerSink({ root, runId: 'run-250' }) : null;
  const code = await watch({ options: options(opts), source: src, sinceIso: SINCE, print: (l) => lines.push(l), sink, now: clock.now, sleep: clock.sleep });
  return { code, out: lines.join('\n'), lines, ledger: sink ? readFileSync(sink.file, 'utf8') : '' };
}

const expectNoSecrets = (...texts) => { for (const t of texts) for (const s of SECRETS) expect(t).not.toContain(s); };

describe('registry parity', () => {
  it('mirrors every integration operation and its access', () => {
    const fromRegistry = Object.fromEntries(Object.entries(INTEGRATION_OPERATIONS).map(([name, op]) => [name, op.access]));
    expect(OPERATION_ACCESS).toEqual(fromRegistry);
    expect(Object.keys(OPERATION_ACCESS)).toHaveLength(16);
  });
  it('uses the same production test accounts as Ticket 232', () => {
    expect(TEST_ACCOUNTS.A.userId).toBe(USERS.A);
    expect(TEST_ACCOUNTS.B.userId).toBe(USERS.B);
  });
});

const WEB_VARIANT = /-(partial|read)$/;

describe('Ticket 256 web variants on the local db source', () => {
  it('claude-web-partial: needs the Behavior write and then a scope-refused Occurrence write', async () => {
    const ok = await runWatch({ world: makeWorld('claude-web-partial', { write: 'both' }), opts: { expect: 'claude-web-partial' }, root: mkdtempSync(join(tmpdir(), 'watch256-')) });
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/ok {4}occurrence-write-denied/);
    const miss = await runWatch({ world: makeWorld('claude-web-partial'), opts: { expect: 'claude-web-partial', timeoutMs: 60_000 }, root: mkdtempSync(join(tmpdir(), 'watch256-')) });
    expect(miss.code).toBe(1);
    expect(miss.out).toMatch(/MISS {2}occurrence-write-denied/);
  });
  it('claude-web-read: a consent and one read are enough', async () => {
    const r = await runWatch({ world: makeWorld('claude-web-read', { write: 'none' }), opts: { expect: 'claude-web-read' }, root: mkdtempSync(join(tmpdir(), 'watch256-')) });
    expect(r.code).toBe(0);
    expect(r.out).toContain('scenario claude-web-read: satisfied');
    expect(r.out).not.toContain('write-succeeded');
  });
});

describe('scenarios on the local db source', () => {
  for (const name of Object.keys(SCENARIOS).filter((n) => !WEB_VARIANT.test(n))) {
    const api = name.endsWith('-api');
    it(`${name}: passes on a full run`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'watch250-'));
      const r = await runWatch({ world: makeWorld(name, { stepUp: name === 'chatgpt' }), opts: { expect: name, ...(api ? { grantId: id(3) } : {}) }, root });
      expect(r.code).toBe(0);
      expect(r.out).toContain(`scenario ${name}: satisfied`);
      expect(r.out).not.toContain('MISS');
      expect(r.out).not.toContain('skip');
      const records = r.ledger.trim().split('\n').map((l) => JSON.parse(l));
      expect(records.at(-1)).toMatchObject({ type: 'watcher.result', scenario: name, result: 'satisfied', grantId: id(3) });
      expect(records.filter((x) => x.type === 'watcher.event').map((x) => x.kind)).toEqual(expect.arrayContaining(['client.registered', 'grant.created', 'token.issued', 'tool.call']));
      expectNoSecrets(r.out, r.ledger);
    });
    it(`${name}: times out with a diff when the write is denied`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'watch250-'));
      const r = await runWatch({ world: makeWorld(name, { write: 'denied' }), opts: { expect: name, timeoutMs: 60_000, ...(api ? { grantId: id(3) } : {}) }, root });
      expect(r.code).toBe(1);
      expect(r.out).toContain(`scenario ${name}: NOT satisfied`);
      expect(r.out).toMatch(/MISS {2}write-succeeded +expected tool\.call access=write outcome=success same grant/);
      expect(r.out).toMatch(/nearest .* set_occurrence_status denied insufficient_scope/);
      expect(r.out).toMatch(/ok {4}read-succeeded/);
      expect(r.out).not.toMatch(/nearest .* list_behaviors/);
      const result = JSON.parse(r.ledger.trim().split('\n').at(-1));
      expect(result).toMatchObject({ type: 'watcher.result', result: 'timeout' });
      expect(result.steps.find((s) => s.id === 'write-succeeded').status).toBe('missing');
      expectNoSecrets(r.out, r.ledger);
    });
  }

  it('waits until late events arrive, then exits as soon as the scenario is satisfied', async () => {
    const clock = fakeClock(T0 - 30_000);
    const r = await runWatch({ world: makeWorld('claude-code'), opts: { expect: 'claude-code' }, clock });
    expect(r.code).toBe(0);
    // Satisfied on the first poll at or after the write at T0+50s.
    expect(clock.now()).toBeGreaterThanOrEqual(T0 + 50_000);
    expect(clock.now()).toBeLessThan(T0 + 60_000);
  });

  it('reports the ChatGPT step-up as a re-consent between the denied and the successful write', async () => {
    const r = await runWatch({ world: makeWorld('chatgpt', { stepUp: true }), opts: { expect: 'chatgpt' }, clock: fakeClock(T0 + 25_000) });
    expect(r.code).toBe(0);
    const order = ['create_behavior denied insufficient_scope', 're-consented scopes cadence.read -> cadence.behaviors.write,cadence.occurrences.write,cadence.read', 'create_behavior success'];
    const idx = order.map((needle) => r.lines.findIndex((l) => l.includes(needle)));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  });

  it('a ChatGPT link that stays read-only never satisfies the scenario', async () => {
    const r = await runWatch({ world: makeWorld('chatgpt', { write: 'denied' }), opts: { expect: 'chatgpt', timeoutMs: 30_000 } });
    expect(r.code).toBe(1);
  });

  it('the wrong verified client does not satisfy a client scenario', async () => {
    const r = await runWatch({ world: makeWorld('claude-code'), opts: { expect: 'claude-web', timeoutMs: 20_000 } });
    expect(r.code).toBe(1);
    expect(r.out).toContain('MISS  client-registered');
  });

  it('--grant binds API scenarios to the driver grant and ignores other grants', async () => {
    const world = makeWorld('anthropic-api', { write: null, extraGrant: true });
    const bound = await runWatch({ world, opts: { expect: 'anthropic-api', grantId: id(3), timeoutMs: 20_000 } });
    expect(bound.code).toBe(1);
    const other = await runWatch({ world, opts: { expect: 'anthropic-api', grantId: id(30), timeoutMs: 20_000 } });
    expect(other.out).toContain('MISS  token-issued');
  });

  it('filters events to the chosen account', async () => {
    const r = await runWatch({ world: makeWorld('inspector', { user: B }), opts: { expect: 'inspector', accounts: ['A'], timeoutMs: 20_000 } });
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/ {2}B {2}/);
    const both = await runWatch({ world: makeWorld('inspector', { user: B }), opts: { expect: 'inspector', accounts: ['A', 'B'] } });
    expect(both.code).toBe(0);
  });

  it('emits revocation, refresh and family revocation with exact times', async () => {
    const world = makeWorld('inspector');
    world.grants[0].revokeT = 70;
    world.families[0].revokeT = 70;
    world.refreshes.push({ user: A, family_id: id(4), grant_id: id(3), t: 60, ref: 'a'.repeat(32) });
    const r = await runWatch({ world, opts: { timeoutMs: 80_000 } });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`${at(60)}  A  token.refreshed`);
    expect(r.out).toContain(`${at(70)}  A  grant.revoked        grant 00000000 revoked reason=user`);
    expect(r.out).toContain(`${at(70)}  A  token.family_revoked`);
    // Re-consent is not inferred from a revocation's updated_at.
    expect(r.out).not.toContain('re-consented');
  });

  it('backtracks past an earlier, unrelated DCR client in the window (wave 1 repro 1)', async () => {
    const world = makeWorld('inspector');
    // Another run's DCR client, registered earlier, with no grant for A or B: account is null.
    world.clients.unshift({ client_ref: id(40), ...CLIENTS.inspector, client_id: id(41), client_name: 'Other run', application_type: 'web', t: 2 });
    const r = await runWatch({ world, opts: { expect: 'inspector', timeoutMs: 120_000 } });
    expect(r.code).toBe(0);
    expect(r.out).toContain('scenario inspector: satisfied (grant 00000000)');
    const result = matchScenario(SCENARIOS.inspector, createDiffer({ sinceIso: SINCE, sourceName: 'db' })(
      await createDbSource({ query: async () => dbRows(world, T0 + 100_000), userIds: { A, B }, sinceIso: SINCE }).snapshot(), at(100)));
    expect(result.satisfied).toBe(true);
    expect(result.steps[0].event.clientId).toBe(CLIENTS.inspector.client_id);
  });

  it('backtracks from a read-only grant to a later full grant on the same client (wave 1 repro 2)', async () => {
    const world = makeWorld('inspector', { write: null });
    world.grants[0].scopes = ['cadence.read'];
    world.grants.push({ grant_id: id(31), client_ref: id(1), user: A, scopes: FULL, t: 30, reconsent: null, revokeT: null });
    world.families.push({ family_id: id(32), grant_id: id(31), user: A, t: 32, offline_access: true, revokeT: null });
    world.activity.push({ id: 4, grant_id: id(31), client_ref: id(1), user: A, operation: 'list_behaviors', outcome: 'success', error_code: null, t: 35 });
    world.activity.push({ id: 5, grant_id: id(31), client_ref: id(1), user: A, operation: 'create_behavior', outcome: 'success', error_code: null, t: 50 });
    const snapshot = await createDbSource({ query: async () => dbRows(world, T0 + 100_000), userIds: { A, B }, sinceIso: SINCE }).snapshot();
    const result = matchScenario(SCENARIOS.inspector, createDiffer({ sinceIso: SINCE, sourceName: 'db' })(snapshot, at(100)));
    expect(result.satisfied).toBe(true);
    expect(result.grantId).toBe(id(31));
    expect(result.steps.find((s) => s.id === 'write-succeeded').status).toBe('matched');
    // The same backtracking applies to API scenarios without --grant.
    expect(matchScenario(SCENARIOS['anthropic-api'], createDiffer({ sinceIso: SINCE, sourceName: 'db' })(snapshot, at(100))).grantId).toBe(id(31));
    const r = await runWatch({ world, opts: { expect: 'inspector' } });
    expect(r.code).toBe(0);
  });

  it('reports the deepest partial match when no binding satisfies the scenario', async () => {
    const world = makeWorld('inspector', { write: 'denied' });
    world.grants.push({ grant_id: id(31), client_ref: id(1), user: A, scopes: ['cadence.read'], t: 30, reconsent: null, revokeT: null });
    const snapshot = await createDbSource({ query: async () => dbRows(world, T0 + 100_000), userIds: { A, B }, sinceIso: SINCE }).snapshot();
    const result = matchScenario(SCENARIOS.inspector, createDiffer({ sinceIso: SINCE, sourceName: 'db' })(snapshot, at(100)));
    expect(result.satisfied).toBe(false);
    expect(result.steps.map((s) => s.status)).toEqual(['matched', 'matched', 'matched', 'matched', 'missing']);
    expect(result.grantId).toBe(id(3));
  });

  it('prints each event once across polls', async () => {
    const r = await runWatch({ world: makeWorld('claude-code'), opts: { timeoutMs: 120_000 } });
    const calls = r.lines.filter((l) => l.includes('tool.call'));
    expect(calls).toHaveLength(2);
  });
});

describe('scenarios on the rpc source (production read path)', () => {
  it('claude-web passes with registration and token steps unverifiable', async () => {
    const r = await runWatch({ world: makeWorld('claude-web'), source: 'rpc', opts: { expect: 'claude-web' } });
    expect(r.code).toBe(0);
    expect(r.out).toContain('skip  client-registered');
    expect(r.out).toContain('client.registered is not visible to the rpc source');
    expect(r.out).toContain('skip  token-issued');
  });

  it('times out with a diff when the write never succeeds', async () => {
    const r = await runWatch({ world: makeWorld('openai-api', { write: 'denied' }), source: 'rpc', opts: { expect: 'openai-api', timeoutMs: 60_000 } });
    expect(r.code).toBe(1);
    expect(r.out).toContain('MISS  write-succeeded');
  });

  it('sees a revocation as the grant disappearing, marked observed', async () => {
    const world = makeWorld('inspector');
    world.grants[0].revokeT = 70;
    const r = await runWatch({ world, source: 'rpc', opts: { timeoutMs: 90_000 } });
    expect(r.out).toMatch(/grant\.revoked +grant 00000000 revoked \(observed\)/);
  });

  it('sees a step-up only as an observed scope change', async () => {
    const r = await runWatch({ world: makeWorld('chatgpt', { stepUp: true }), source: 'rpc', opts: { expect: 'chatgpt' }, clock: fakeClock(T0 + 15_000) });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/grant\.reconsented .* \(observed\)/);
  });

  it('reads only the two owner RPCs as the account itself', async () => {
    const calls = [];
    const clock = fakeClock(T0 + 100_000);
    const src = createRpcSource({ rest: restFor(makeWorld('inspector'), clock, calls), accounts: ['A', 'B'], sinceIso: SINCE });
    await src.snapshot();
    expect(new Set(calls.map((c) => c.path))).toEqual(new Set(['/rest/v1/rpc/oauth_list_grants', '/rest/v1/rpc/oauth_list_activity']));
    expect(calls.every((c) => c.method === 'POST')).toBe(true);
    expect(new Set(calls.map((c) => c.slot))).toEqual(new Set(['A', 'B']));
  });

  it('pages activity back to the since time', async () => {
    const world = makeWorld('inspector', { write: null });
    world.activity = Array.from({ length: 230 }, (_, i) => ({ id: 100 + i, grant_id: id(3), client_ref: id(1), user: A, operation: 'get_timeline', outcome: 'success', error_code: null, t: (i % 50) + 1 }));
    const clock = fakeClock(T0 + 100_000);
    const calls = [];
    const src = createRpcSource({ rest: restFor(world, clock, calls), accounts: ['A'], sinceIso: SINCE });
    const snap = await src.snapshot();
    expect(snap.activity).toHaveLength(230);
    expect(calls.filter((c) => c.path.endsWith('oauth_list_activity')).length).toBe(3);
  });

  it('fails closed after three unreadable polls without printing response bodies', async () => {
    const lines = [];
    const clock = fakeClock();
    const rest = async () => ({ status: 401, json: { message: SECRETS[0], hint: SECRETS[2] } });
    const code = await watch({ options: options({ expect: 'inspector' }), source: createRpcSource({ rest, accounts: ['A'], sinceIso: SINCE }), sinceIso: SINCE,
      print: (l) => lines.push(l), now: clock.now, sleep: clock.sleep });
    expect(code).toBe(3);
    expect(lines.filter((l) => l.startsWith('source-error grants-A-unreadable'))).toHaveLength(3);
    expectNoSecrets(lines.join('\n'));
  });

  it('rejects rows with unexpected values instead of printing them', async () => {
    const lines = [];
    const clock = fakeClock();
    const rest = async (slot, method, path) => ({ status: 200, json: path.endsWith('grants') ? [{ grant_id: SECRETS[0], client_id: 'x', client_name: 'x', scopes: ['cadence.read'], created_at: at(1) }] : [] });
    const code = await watch({ options: options({ once: false, timeoutMs: 20_000 }), source: createRpcSource({ rest, accounts: ['A'], sinceIso: SINCE }), sinceIso: SINCE,
      print: (l) => lines.push(l), now: clock.now, sleep: clock.sleep });
    expect(code).toBe(3);
    expect(lines.join('\n')).toContain('source-error invalid-id');
    expectNoSecrets(lines.join('\n'));
  });
});

describe('local db guard and query', () => {
  it('accepts only loopback databases and refuses the owner stack', () => {
    expect(assertLocalDbUrl('postgresql://postgres:postgres@127.0.0.1:56582/postgres')).toContain('127.0.0.1:56582');
    for (const [url, code] of [['postgresql://postgres:postgres@db.qjodzutjxtmtzczbloxa.supabase.co:5432/postgres', 'db-url-not-loopback'],
      ['postgresql://postgres:postgres@127.0.0.1:55322/postgres', 'db-url-owner-stack'], ['https://127.0.0.1/', 'db-url-invalid'], ['nope', 'db-url-invalid']]) {
      expect(() => assertLocalDbUrl(url)).toThrow(code);
    }
  });

  it('runs one read-only transaction and never reads stderr', async () => {
    let seen;
    const execFileImpl = (file, args, opts, cb) => {
      seen = { file, args, opts, input: '' };
      setImmediate(() => cb(null, `{"grants":[],"clients":[],"families":[],"refreshes":[],"activity":[]}\n`, `ERROR ${SECRETS[2]}`));
      return { stdin: { end: (sql) => { seen.input = sql; } } };
    };
    const out = await psqlQuery({ dbUrl: 'postgresql://postgres:postgres@127.0.0.1:56582/postgres', users: [A, B], sinceIso: SINCE, execFileImpl });
    expect(out.grants).toEqual([]);
    expect(seen.file).toBe('psql');
    expect(seen.opts.env.PGOPTIONS).toBe('-c default_transaction_read_only=on');
    expect(seen.input).toMatch(/^\s*begin transaction read only;/);
    expect(seen.input.trim().endsWith('rollback;')).toBe(true);
    expect(seen.input).not.toMatch(/\b(insert|update|delete|truncate|grant|alter|drop|create)\b/i);
    expect(seen.input).not.toMatch(/token_hash[^)]/);
    expect(seen.args).toContain(`users={${A},${B}}`);
  });

  it('maps a psql failure to a fixed label', async () => {
    const execFileImpl = (file, args, opts, cb) => { setImmediate(() => cb(new Error(SECRETS[2]), '', SECRETS[2])); return { stdin: { end() {} } }; };
    await expect(psqlQuery({ dbUrl: 'postgresql://postgres:postgres@127.0.0.1:56582/postgres', users: [A], sinceIso: SINCE, execFileImpl })).rejects.toThrow('db-unreadable');
  });

  it('refuses rows for users outside A and B', async () => {
    const world = makeWorld('inspector', { user: id(99) });
    const src = createDbSource({ query: async () => dbRows(world, T0 + 100_000), userIds: { A, B }, sinceIso: SINCE });
    await expect(src.snapshot()).rejects.toThrow('unexpected-user');
  });
});

describe('arguments, ledger and CLI', () => {
  it('requires explicit confirmation and the rpc source for production', () => {
    expect(() => parseWatchArgs(['--target', 'production'])).toThrow('confirm-production-required');
    expect(() => parseWatchArgs(['--target', 'production', '--confirm-production', '--source', 'db'])).toThrow('production-rpc-only');
    expect(() => parseWatchArgs(['--target', 'production', '--confirm-production', '--user-a', A])).toThrow('production-fixed-accounts');
    expect(parseWatchArgs(['--target', 'production', '--confirm-production', '--account', 'B', '--expect', 'chatgpt'])).toMatchObject({ source: 'rpc', accounts: ['B'], expect: 'chatgpt' });
    expect(parseWatchArgs(['--target', 'local'])).toMatchObject({ source: 'db', accounts: ['A'], timeoutMs: 600_000, intervalMs: 3_000 });
    expect(() => parseWatchArgs(['--target', 'local', '--expect', 'nope'])).toThrow('unknown-scenario');
    expect(() => parseWatchArgs(['--target', 'local', '--run', '../x'])).toThrow('invalid-run-id');
    expect(() => parseWatchArgs(['--target', 'staging'])).toThrow('target-required');
  });

  it('parses --since as a duration or an ISO time', () => {
    expect(parseSince('10m', T0)).toBe(new Date(T0 - 600_000).toISOString());
    expect(parseSince('2026-10-30T01:00:00Z', T0)).toBe('2026-10-30T01:00:00.000Z');
    expect(() => parseSince('yesterday', T0)).toThrow(WatchError);
  });

  it('writes the ledger append-only with private permissions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'watch250-'));
    const first = await runWatch({ world: makeWorld('inspector'), opts: { expect: 'inspector' }, root });
    const second = await runWatch({ world: makeWorld('inspector'), opts: { expect: 'inspector' }, root });
    const file = join(root, 'run-250', 'events.jsonl');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'run-250')).mode & 0o777).toBe(0o700);
    expect(second.ledger.startsWith(first.ledger)).toBe(true);
    for (const line of second.ledger.trim().split('\n')) {
      const record = JSON.parse(line);
      expect(record.run).toBe('run-250');
      expect(record).not.toHaveProperty('key');
    }
  });

  it('lists scenarios and reports usage errors with fixed labels only', async () => {
    const lines = [];
    expect(await main(['--list-scenarios'], (l) => lines.push(l))).toBe(0);
    for (const name of ['claude-web', 'claude-code', 'chatgpt', 'inspector', 'anthropic-api', 'openai-api']) expect(lines.join('\n')).toContain(`${name}:`);
    const errors = [];
    expect(await main(['--target', 'production'], (l) => errors.push(l))).toBe(2);
    expect(errors).toEqual(['watch-stopped confirm-production-required']);
    expect(await main(['--target', 'local', '--db-url', 'postgresql://u:p@example.com/db'], (l) => errors.push(l))).toBe(2);
    expect(errors.at(-1)).toBe('watch-stopped db-url-not-loopback');
  });

  it('production reads the QA publishable key from the environment and never an owner credential', async () => {
    expect(publishableKeyFrom({ CADENCE_QA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc_123' })).toBe('sb_publishable_abc_123');
    for (const env of [{}, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' }, { CADENCE_QA_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }]) {
      expect(() => publishableKeyFrom(env)).toThrow('qa-publishable-key-missing');
    }
    const lines = [];
    expect(await main(['--target', 'production', '--confirm-production'], (l) => lines.push(l), {})).toBe(2);
    expect(lines).toEqual(['watch-stopped qa-publishable-key-missing']);
    const source = readFileSync(new URL('../scripts/acceptance/watch.mjs', import.meta.url), 'utf8');
    for (const banned of ['api.supabase.com', 'Supabase CLI', 'find-generic-password', '/usr/bin/security']) expect(source).not.toContain(banned);
  });

  it('declares which event kinds each source can see', () => {
    expect(SOURCE_KINDS.rpc).not.toContain('client.registered');
    expect(SOURCE_KINDS.rpc).not.toContain('token.issued');
    expect(SOURCE_KINDS.db).toContain('token.refreshed');
  });

  it('matches in order: a write before the grant does not count', async () => {
    const world = makeWorld('inspector');
    world.activity.at(-1).t = 8;
    const snapshot = await createDbSource({ query: async () => dbRows(world, T0 + 100_000), userIds: { A, B }, sinceIso: SINCE }).snapshot();
    const events = createDiffer({ sinceIso: SINCE, sourceName: 'db' })(snapshot, at(100));
    expect(matchScenario(SCENARIOS.inspector, events).satisfied).toBe(false);
  });
});

describe('production session adapter (Ticket 248 module shape)', () => {
  const fakeModule = (current) => {
    const made = [];
    return { made, PRODUCTION: { supabaseUrl: 'https://qjodzutjxtmtzczbloxa.supabase.co' },
      createKeychainSessionStore: () => ({ kind: 'keychain' }),
      createSessionManager: (config) => { made.push(config); return { current }; } };
  };
  it('builds a production manager and caches each token between polls', async () => {
    let clock = 0, calls = 0;
    const mod = fakeModule(async (slot, opts) => { calls++; expect(opts.expectUserId).toBe(TEST_ACCOUNTS[slot].userId); return { accessToken: `${slot}-${SECRETS[0]}` }; });
    const tokenFor = createSessionTokenFor(mod, { publishableKey: 'sb_publishable_x', now: () => clock });
    expect(mod.made[0]).toMatchObject({ target: 'production', supabaseUrl: 'https://qjodzutjxtmtzczbloxa.supabase.co', publishableKey: 'sb_publishable_x', store: { kind: 'keychain' } });
    expect(await tokenFor('A')).toBe(`A-${SECRETS[0]}`);
    clock = 59_000; await tokenFor('A');
    expect(calls).toBe(1);
    clock = 61_000; await tokenFor('A');
    expect(calls).toBe(2);
  });
  it('returns null on session errors and refuses an unknown module', async () => {
    const tokenFor = createSessionTokenFor(fakeModule(async () => { throw new Error('session-missing'); }), { publishableKey: 'sb_publishable_x' });
    expect(await tokenFor('B')).toBeNull();
    expect(() => createSessionTokenFor({ accessTokenFor() {} }, { publishableKey: 'sb_publishable_x' })).toThrow('session-provider-unavailable');
    expect(() => createSessionTokenFor({ ...fakeModule(async () => ({})), PRODUCTION: { supabaseUrl: 'https://evil.example' } }, { publishableKey: 'sb_publishable_x' })).toThrow('session-provider-unavailable');
  });
});
