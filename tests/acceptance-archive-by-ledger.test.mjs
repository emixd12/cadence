import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRun, resumeRun } from '../scripts/acceptance/ledger.mjs';
import { AcceptanceError } from '../scripts/acceptance/test-account-sessions.mjs';
import { archiveByLedger, collectCreations, parseArgs, runsHoldingClients } from '../scripts/acceptance/archive-by-ledger.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = 'cleanup-access-token-must-never-appear';
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const tempRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'archive-ledger-')); roots.push(dir); return dir; };

/** A source run with creation checkpoints, as the runners record them. */
function sourceRun(root, runId, creations, target = 'production') {
  const run = createRun({ target, accounts: ['A', 'B'], scenarios: ['x'], runId, root, gitSha: null });
  for (const c of creations) run.recordCheckpoint('creation', { label: c.label, slot: c.slot, behaviorId: c.behaviorId, grantId: null, activityIds: [] });
  run.close();
}

/** Fake Cadence: Behaviors per account, a DCR client, one grant, MCP archive. */
function fakeWorld(behaviors, faults = {}) {
  const rows = new Map(behaviors.map((b) => [b.id, { archived_at: null, ...b }]));
  const grants = [];
  const calls = [];
  const driver = {
    registerDynamic: async ({ name }) => ({ clientId: `client-${grants.length + 1}`, clientName: name, type: 'dcr' }),
    authorize: async ({ slot, client, grant, requestScopes }) => {
      calls.push({ op: 'authorize', slot, grant, requestScopes });
      grants.push({ slot, clientId: client.clientId, clientName: client.clientName, grantId: id(900 + grants.length), scopes: ['cadence.read', 'cadence.behaviors.write'], active: true });
      // Consent can create a grant even when the token exchange then fails.
      if (faults.tokenExchangeFails) { faults.tokenExchangeFails = false; throw new AcceptanceError('token-exchange-failed'); }
      return { slot, scopes: ['cadence.read', 'cadence.behaviors.write'], authorization: () => `Bearer ${TOKEN}` };
    },
    probe: async (tokens, { name, args }) => {
      calls.push({ op: name, slot: tokens.slot, behaviorId: args.behavior_id, keyed: typeof args.idempotency_key === 'string' });
      const row = rows.get(args.behavior_id);
      if (faults.archiveFails) { faults.archiveFails = false; return { status: 503, ok: false, errorCode: null }; }
      if (name !== 'archive_behavior' || !row || row.user !== tokens.slot) return { status: 200, ok: false, errorCode: 'not_found' };
      row.archived_at = '2026-10-31T23:30:00Z';
      return { status: 200, ok: true, errorCode: null };
    },
    grantsFor: async (slot, clientId) => { if (faults.grantListInvalid) throw new AcceptanceError('grant-list-invalid'); return grants.filter((g) => g.slot === slot && g.clientId === clientId && g.active).map((g) => ({ grantId: g.grantId, scopes: g.scopes })); },
    revokeGrants: async (slot, clientId) => {
      if (faults.revokeFails) throw new AcceptanceError('revoke-failed');
      let n = 0;
      for (const g of grants) if (g.slot === slot && g.clientId === clientId && g.active) { g.active = false; n += 1; }
      return n;
    },
  };
  const rest = async (slot, method, path) => {
    const match = /^\/rest\/v1\/behaviors\?id=eq\.([0-9a-f-]{36})&select=id,title,archived_at$/.exec(path);
    if (method !== 'GET' || !match) return { status: 404, json: null };
    const row = rows.get(match[1]);
    return { status: 200, json: row && row.user === slot ? [{ id: row.id, title: row.title, archived_at: row.archived_at }] : [] };
  };
  const listGrants = async (slot) => {
    if (faults.listNotArray) return null;
    return grants.filter((g) => g.slot === slot && g.active).map((g) => ({ grant_id: g.grantId, client_id: g.clientId, client_name: g.clientName, scopes: g.scopes }));
  };
  return { rows, grants, calls, driver, rest, listGrants, faults };
}

describe('collectCreations', () => {
  it('reads creation checkpoints from several runs read-only and drops duplicates', () => {
    const root = tempRoot();
    sourceRun(root, 'run-one', [{ label: 'one-create', slot: 'A', behaviorId: id(1) }, { label: 'two-create', slot: 'B', behaviorId: id(2) }]);
    sourceRun(root, 'run-two', [{ label: 'one-create', slot: 'A', behaviorId: id(1) }]);
    expect(collectCreations({ runIds: ['run-one', 'run-two'], root })).toEqual([
      { slot: 'A', behaviorId: id(1), fromRun: 'run-one' },
      { slot: 'B', behaviorId: id(2), fromRun: 'run-one' },
    ]);
  });
});

describe('collectCreations target', () => {
  it('refuses a local run, whose accounts no longer exist', () => {
    const root = tempRoot();
    sourceRun(root, 'run-local', [{ label: 'one-create', slot: 'A', behaviorId: id(1) }], 'local');
    expect(() => collectCreations({ runIds: ['run-local'], root })).toThrow('run-target-mismatch');
  });
});

describe('archiveByLedger recovery (same rules as a4239af)', () => {
  const start = (root, runId = 'cleanup-r') => createRun({ target: 'production', accounts: ['A', 'B'], scenarios: ['archive-by-ledger'], runId, root, gitSha: null });
  const reopen = (root, runId = 'cleanup-r') => resumeRun({ runId, root });
  const go = (world, run, creations) => archiveByLedger({ creations, driver: world.driver, rest: world.rest, listGrants: world.listGrants, run, emit: () => {} });
  const steps = (run) => run.checkpoints.filter((r) => r.kind === 'step' && r.state === 'done').map((r) => r.name);

  it('saves the registration before consent and captures a grant whose token exchange failed', async () => {
    const root = tempRoot();
    const world = fakeWorld([{ id: id(1), user: 'A', title: 'Review practice x' }], { tokenExchangeFails: true });
    const run = start(root);
    await expect(go(world, run, [{ slot: 'A', behaviorId: id(1) }])).rejects.toMatchObject({ code: 'token-exchange-failed' });
    expect(steps(run)).toEqual(['registration:a-1']);
    expect(run.cleanupInputs().grants.map((g) => g.grantId)).toEqual([world.grants[0].grantId]);
    expect(world.grants.every((g) => !g.active)).toBe(true);
    run.close();
  });

  it('stops before the next account when revocation cannot be confirmed, then reconciles on resume before registering again', async () => {
    const root = tempRoot();
    const world = fakeWorld([{ id: id(1), user: 'A', title: 'Review practice x' }, { id: id(2), user: 'B', title: 'Review practice y' }], { revokeFails: true });
    const creations = [{ slot: 'A', behaviorId: id(1) }, { slot: 'B', behaviorId: id(2) }];
    const first = start(root);
    await expect(go(world, first, creations)).rejects.toMatchObject({ code: 'grant-revocation-unconfirmed' });
    expect(world.calls.filter((c) => c.op === 'authorize').map((c) => c.slot)).toEqual(['A']);
    first.close();

    // Still unresolved: the retry stops before creating any new client or grant.
    const second = reopen(root);
    await expect(go(world, second, creations)).rejects.toMatchObject({ code: 'grant-revocation-unconfirmed' });
    expect(world.calls.filter((c) => c.op === 'authorize')).toHaveLength(1);
    second.close();

    world.faults.revokeFails = false;
    const third = reopen(root);
    const result = await go(world, third, creations);
    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      { slot: 'A', behaviorId: id(1), outcome: 'already-archived' },
      { slot: 'B', behaviorId: id(2), outcome: 'archived' },
    ]);
    expect(world.grants.every((g) => !g.active)).toBe(true);
    // A's Behavior is already archived, so the retry opens no new consent for A.
    expect(steps(third)).toEqual(['registration:a-1', 'registration:b-1']);
    third.close();
  });

  it('treats a malformed grant list as unconfirmed, not as no grants', async () => {
    const root = tempRoot();
    const world = fakeWorld([{ id: id(1), user: 'A', title: 'Review practice x' }]);
    const realAuthorize = world.driver.authorize;
    world.driver.authorize = async (args) => { const tokens = await realAuthorize(args); world.faults.grantListInvalid = true; return tokens; };
    const run = start(root);
    await expect(go(world, run, [{ slot: 'A', behaviorId: id(1) }])).rejects.toMatchObject({ code: 'grant-revocation-unconfirmed' });
    run.close();
  });

  it('keeps a failed archive retryable in the same run', async () => {
    const root = tempRoot();
    const world = fakeWorld([{ id: id(1), user: 'A', title: 'Review practice x' }], { archiveFails: true });
    const first = start(root);
    const failed = await go(world, first, [{ slot: 'A', behaviorId: id(1) }]);
    expect(failed).toMatchObject({ ok: false, results: [{ slot: 'A', behaviorId: id(1), outcome: 'archive-failed' }] });
    first.close();
    const second = reopen(root);
    const retried = await go(world, second, [{ slot: 'A', behaviorId: id(1) }]);
    expect(retried).toMatchObject({ ok: true, results: [{ slot: 'A', behaviorId: id(1), outcome: 'archived' }] });
    const events = readFileSync(join(root, 'cleanup-r', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === 'archive.result').map((e) => e.outcome)).toEqual(['archive-failed', 'archived']);
    second.close();
  });
});

describe('active cleanup grants (reviewer repro on PR #188)', () => {
  const start = (root, runId) => createRun({ target: 'production', accounts: ['A', 'B'], scenarios: ['archive-by-ledger'], runId, root, gitSha: null });
  const go = (world, run, creations) => archiveByLedger({ creations, driver: world.driver, rest: world.rest, listGrants: world.listGrants, run, emit: () => {} });
  const behaviors = [{ id: id(1), user: 'A', title: 'Review practice x' }];
  const creations = [{ slot: 'A', behaviorId: id(1) }];

  it('a new run stops before doing anything while an earlier cleanup grant is still active', async () => {
    const root = tempRoot();
    const world = fakeWorld(behaviors, { revokeFails: true });
    const first = start(root, 'cleanup-first');
    await expect(go(world, first, creations)).rejects.toMatchObject({ code: 'grant-revocation-unconfirmed' });
    first.close();
    expect(world.rows.get(id(1)).archived_at).not.toBeNull();
    expect(world.grants.filter((g) => g.active)).toHaveLength(1);

    const callsBefore = world.calls.length;
    const reads = [];
    const rest = async (...args) => { reads.push(args); return world.rest(...args); };
    const second = start(root, 'cleanup-second');
    await expect(archiveByLedger({ creations, driver: world.driver, rest, listGrants: world.listGrants, run: second, emit: () => {} })).rejects.toMatchObject({
      code: 'cleanup-grant-active', details: { slot: 'A', clientIds: [world.grants[0].clientId] },
    });
    expect(reads).toEqual([]);
    expect(world.calls).toHaveLength(callsBefore);
    second.close();
    // The stop can name the run whose --resume reconciles it.
    expect(runsHoldingClients({ clientIds: [world.grants[0].clientId], root, exclude: 'cleanup-second' })).toEqual(['cleanup-first']);

    // --resume on the run that saved the registration still reconciles and passes.
    world.faults.revokeFails = false;
    const resumed = resumeRun({ runId: 'cleanup-first', root });
    await expect(go(world, resumed, creations)).resolves.toMatchObject({ ok: true, activeCleanupGrants: [] });
    resumed.close();
    expect(world.grants.every((g) => !g.active)).toBe(true);
  });

  it('checks every account before touching the first one', async () => {
    const root = tempRoot();
    const world = fakeWorld(behaviors);
    world.grants.push({ slot: 'B', clientId: 'client-stale', clientName: 'Cadence acceptance cleanup', grantId: id(950), scopes: ['cadence.read'], active: true });
    const run = start(root, 'cleanup-b');
    await expect(go(world, run, creations)).rejects.toMatchObject({ code: 'cleanup-grant-active', details: { slot: 'B', clientIds: ['client-stale'] } });
    expect(world.rows.get(id(1)).archived_at).toBeNull();
    expect(world.calls).toEqual([]);
    run.close();
  });

  it('does not stop for another client active on the account', async () => {
    const root = tempRoot();
    const world = fakeWorld(behaviors);
    world.grants.push({ slot: 'A', clientId: 'https://chatgpt.com/oauth/client.json', clientName: 'ChatGPT', grantId: id(951), scopes: ['cadence.read'], active: true });
    const run = start(root, 'cleanup-other');
    await expect(go(world, run, creations)).resolves.toMatchObject({ ok: true, activeCleanupGrants: [] });
    run.close();
  });

  it('fails the final result if a cleanup grant is active after the work', async () => {
    const root = tempRoot();
    const world = fakeWorld(behaviors);
    const realProbe = world.driver.probe;
    // Appears during the run, on a client this run did not register, so per-client readback misses it.
    world.driver.probe = async (...args) => {
      world.grants.push({ slot: 'B', clientId: 'client-late', clientName: 'Cadence acceptance cleanup', grantId: id(952), scopes: ['cadence.read'], active: true });
      return realProbe(...args);
    };
    const run = start(root, 'cleanup-late');
    const result = await go(world, run, creations);
    expect(result.results).toEqual([{ slot: 'A', behaviorId: id(1), outcome: 'archived' }]);
    expect(result).toMatchObject({ ok: false, activeCleanupGrants: [{ slot: 'B', clientId: 'client-late', grantId: id(952) }] });
    run.close();
  });

  it('treats an unreadable grant list as a stop, not as no grants', async () => {
    const root = tempRoot();
    const world = fakeWorld(behaviors, { listNotArray: true });
    const run = start(root, 'cleanup-unreadable');
    await expect(go(world, run, creations)).rejects.toMatchObject({ code: 'grant-list-invalid' });
    expect(world.calls).toEqual([]);
    run.close();
  });
});

describe('archiveByLedger', () => {
  it('archives active test Behaviors per account through one cleanup grant, skips archived ones, then revokes', async () => {
    const root = tempRoot();
    const world = fakeWorld([
      { id: id(1), user: 'A', title: 'Review practice web-1' },
      { id: id(2), user: 'A', title: 'Review practice web-2 edited', archived_at: '2026-10-31T20:00:00Z' },
      { id: id(3), user: 'B', title: 'Review practice t0' },
    ]);
    const run = createRun({ target: 'production', accounts: ['A', 'B'], scenarios: ['archive'], runId: 'cleanup-1', root, gitSha: null });
    const lines = [];
    const result = await archiveByLedger({
      creations: [{ slot: 'A', behaviorId: id(1) }, { slot: 'A', behaviorId: id(2) }, { slot: 'B', behaviorId: id(3) }],
      driver: world.driver, rest: world.rest, listGrants: world.listGrants, run, emit: (e) => lines.push(JSON.stringify(e)),
    });
    run.close();
    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      { slot: 'A', behaviorId: id(2), outcome: 'already-archived' },
      { slot: 'A', behaviorId: id(1), outcome: 'archived' },
      { slot: 'B', behaviorId: id(3), outcome: 'archived' },
    ]);
    expect(world.rows.get(id(1)).archived_at).not.toBeNull();
    expect(world.calls.filter((c) => c.op === 'authorize')).toEqual([
      { op: 'authorize', slot: 'A', grant: 'behaviors', requestScopes: ['cadence.read', 'cadence.behaviors.write'] },
      { op: 'authorize', slot: 'B', grant: 'behaviors', requestScopes: ['cadence.read', 'cadence.behaviors.write'] },
    ]);
    expect(world.calls.filter((c) => c.op === 'archive_behavior').every((c) => c.keyed)).toBe(true);
    expect(world.grants.every((g) => !g.active)).toBe(true);
    expect(lines.map((l) => JSON.parse(l)).filter((e) => e.step === 'revoke')).toEqual([
      { step: 'revoke', slot: 'A', revoked: 1, remaining: 0, activeGrantCount: 0 },
      { step: 'revoke', slot: 'B', revoked: 1, remaining: 0, activeGrantCount: 0 },
    ]);
    // The cleanup grants are checkpointed, so a later revoke can find them.
    expect(result.grants).toHaveLength(2);
    const ledger = readFileSync(join(root, 'cleanup-1', 'checkpoints.jsonl'), 'utf8');
    expect(ledger).toContain('"kind":"grant"');
    for (const text of [ledger, lines.join('\n')]) expect(text).not.toContain(TOKEN);
  });

  it('refuses a Behavior that is not a runner test Behavior and still revokes its grant', async () => {
    const root = tempRoot();
    const world = fakeWorld([{ id: id(4), user: 'A', title: 'Morning walk' }]);
    const run = createRun({ target: 'production', accounts: ['A'], scenarios: ['archive'], runId: 'cleanup-2', root, gitSha: null });
    const result = await archiveByLedger({ creations: [{ slot: 'A', behaviorId: id(4) }], driver: world.driver, rest: world.rest, listGrants: world.listGrants, run, emit: () => {} });
    run.close();
    expect(result.ok).toBe(false);
    expect(result.results).toEqual([{ slot: 'A', behaviorId: id(4), outcome: 'refused-title' }]);
    expect(world.rows.get(id(4)).archived_at).toBeNull();
    expect(world.calls.some((c) => c.op === 'archive_behavior')).toBe(false);
    expect(world.grants.every((g) => !g.active)).toBe(true);
  });

  it('reports a Behavior the account cannot read as missing', async () => {
    const root = tempRoot();
    const world = fakeWorld([{ id: id(5), user: 'B', title: 'Review practice x' }]);
    const run = createRun({ target: 'production', accounts: ['A'], scenarios: ['archive'], runId: 'cleanup-3', root, gitSha: null });
    const result = await archiveByLedger({ creations: [{ slot: 'A', behaviorId: id(5) }], driver: world.driver, rest: world.rest, listGrants: world.listGrants, run, emit: () => {} });
    run.close();
    expect(result).toMatchObject({ ok: false, results: [{ slot: 'A', behaviorId: id(5), outcome: 'missing' }] });
  });
});

describe('parseArgs', () => {
  it('needs source runs and an explicit production confirmation', () => {
    expect(() => parseArgs([])).toThrow('from-required');
    expect(() => parseArgs(['--from', 'run-one'])).toThrow('production-requires-confirm-production');
    expect(() => parseArgs(['--from', '../x', '--confirm-production'])).toThrow('from-invalid');
    expect(parseArgs(['--from', 'run-one,run-two', '--confirm-production'])).toMatchObject({ from: ['run-one', 'run-two'], runId: null, resume: false });
    expect(() => parseArgs(['--from', 'run-one', '--confirm-production', '--resume'])).toThrow('resume-needs-run');
    expect(parseArgs(['--from', 'run-one', '--confirm-production', '--run', 'cleanup-1', '--resume'])).toMatchObject({ runId: 'cleanup-1', resume: true });
  });
});
