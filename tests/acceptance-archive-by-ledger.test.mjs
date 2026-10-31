import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRun } from '../scripts/acceptance/ledger.mjs';
import { archiveByLedger, collectCreations, parseArgs } from '../scripts/acceptance/archive-by-ledger.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TOKEN = 'cleanup-access-token-must-never-appear';
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const tempRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'archive-ledger-')); roots.push(dir); return dir; };

/** A source run with creation checkpoints, as the runners record them. */
function sourceRun(root, runId, creations) {
  const run = createRun({ target: 'production', accounts: ['A', 'B'], scenarios: ['x'], runId, root, gitSha: null });
  for (const c of creations) run.recordCheckpoint('creation', { label: c.label, slot: c.slot, behaviorId: c.behaviorId, grantId: null, activityIds: [] });
  run.close();
}

/** Fake Cadence: Behaviors per account, a DCR client, one grant, MCP archive. */
function fakeWorld(behaviors) {
  const rows = new Map(behaviors.map((b) => [b.id, { archived_at: null, ...b }]));
  const grants = [];
  const calls = [];
  const driver = {
    registerDynamic: async ({ name }) => ({ clientId: `client-${grants.length + 1}`, clientName: name, type: 'dcr' }),
    authorize: async ({ slot, client, grant, requestScopes }) => {
      calls.push({ op: 'authorize', slot, grant, requestScopes });
      grants.push({ slot, clientId: client.clientId, grantId: id(900 + grants.length), scopes: ['cadence.read', 'cadence.behaviors.write'], active: true });
      return { slot, scopes: ['cadence.read', 'cadence.behaviors.write'], authorization: () => `Bearer ${TOKEN}` };
    },
    probe: async (tokens, { name, args }) => {
      calls.push({ op: name, slot: tokens.slot, behaviorId: args.behavior_id, keyed: typeof args.idempotency_key === 'string' });
      const row = rows.get(args.behavior_id);
      if (name !== 'archive_behavior' || !row || row.user !== tokens.slot) return { status: 200, ok: false, errorCode: 'not_found' };
      row.archived_at = '2026-10-31T23:30:00Z';
      return { status: 200, ok: true, errorCode: null };
    },
    grantsFor: async (slot, clientId) => grants.filter((g) => g.slot === slot && g.clientId === clientId && g.active).map((g) => ({ grantId: g.grantId, scopes: g.scopes })),
    revokeGrants: async (slot, clientId) => {
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
  const listGrants = async (slot) => grants.filter((g) => g.slot === slot && g.active).length;
  return { rows, grants, calls, driver, rest, listGrants };
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
      { slot: 'A', behaviorId: id(1), outcome: 'archived' },
      { slot: 'A', behaviorId: id(2), outcome: 'already-archived' },
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
    expect(parseArgs(['--from', 'run-one,run-two', '--confirm-production'])).toMatchObject({ from: ['run-one', 'run-two'], runId: null });
  });
});
