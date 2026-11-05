// main() with its production dependencies faked and no network: the session store,
// browser, OAuth driver and REST client are replaced, and fetch throws.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun } from '../scripts/acceptance/ledger.mjs';
import { CLEANUP_CLIENT_NAME, main } from '../scripts/acceptance/archive-by-ledger.mjs';

const world = vi.hoisted(() => ({ grants: [], behaviors: new Map(), consents: 0, browsers: 0 }));

vi.mock('../scripts/acceptance/consent-page.mjs', () => ({
  launchChrome: async () => { world.browsers += 1; return { close: async () => {} }; },
}));
vi.mock('../scripts/acceptance/test-account-sessions.mjs', async (importActual) => ({
  ...(await importActual()),
  createKeychainSessionStore: () => ({}),
  createSessionManager: () => ({
    current: async () => ({ accessToken: 'fake-session' }),
    userRpc: async (slot, name) => {
      if (name !== 'oauth_list_grants') throw new Error(`unexpected rpc ${name}`);
      return world.grants.filter((g) => g.slot === slot).map((g) => ({ grant_id: g.grantId, client_id: g.clientId, client_name: g.clientName, scopes: ['cadence.read'] }));
    },
  }),
}));
vi.mock('../scripts/acceptance/oauth-driver.mjs', () => ({
  createOAuthDriver: () => ({
    registerDynamic: async () => ({ type: 'dcr', clientId: 'client-new', clientName: 'Cadence acceptance cleanup' }),
    authorize: async () => { world.consents += 1; throw new Error('unexpected consent'); },
    probe: async () => { throw new Error('unexpected MCP call'); },
    grantsFor: async (slot, clientId) => world.grants.filter((g) => g.slot === slot && g.clientId === clientId).map((g) => ({ grantId: g.grantId, scopes: ['cadence.read'] })),
    revokeGrants: async (slot, clientId) => {
      const before = world.grants.length;
      world.grants = world.grants.filter((g) => !(g.slot === slot && g.clientId === clientId));
      return before - world.grants.length;
    },
  }),
}));
vi.mock('../scripts/mcp-acceptance-cleanup.mjs', () => ({
  createRest: () => async (slot, method, path) => {
    const row = world.behaviors.get(/id=eq\.([0-9a-f-]{36})/.exec(path)?.[1]);
    return { status: 200, json: row ? [row] : [] };
  },
}));

const BEHAVIOR = '00000000-0000-4000-8000-000000000001';
const STALE_GRANT = '00000000-0000-4000-8000-000000000900';
const roots = [];
const realFetch = globalThis.fetch;
const fetchStub = vi.fn(async () => { throw new Error('no network in this test'); });

beforeEach(() => {
  Object.assign(world, { grants: [], behaviors: new Map(), consents: 0, browsers: 0 });
  fetchStub.mockClear();
  globalThis.fetch = fetchStub;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  expect(fetchStub).not.toHaveBeenCalled();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

const tempRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'archive-main-')); roots.push(dir); return dir; };
const sourceRun = (root, runId, creations = []) => {
  const run = createRun({ target: 'production', accounts: ['A', 'B'], scenarios: ['x'], runId, root, gitSha: null });
  for (const c of creations) run.recordCheckpoint('creation', { label: c.label, slot: c.slot, behaviorId: c.behaviorId, grantId: null, activityIds: [] });
  run.close();
};
/** A cleanup run that stopped after saving its registration, leaving its grant active. */
const stoppedCleanupRun = async (root, runId, clientId) => {
  const run = createRun({ target: 'production', accounts: ['A', 'B'], scenarios: ['archive-by-ledger'], runId, root, gitSha: null });
  await run.step('registration:a-1', async () => ({ type: 'dcr', clientId, clientName: CLEANUP_CLIENT_NAME, slot: 'A' }));
  run.close();
};
const staleGrant = (clientId) => world.grants.push({ slot: 'A', clientId, clientName: CLEANUP_CLIENT_NAME, grantId: STALE_GRANT });
const runMain = async (args) => {
  const lines = [];
  const code = await main(args, {}, (line) => lines.push(JSON.parse(line)));
  return { code, lines, last: lines.at(-1) };
};

describe('archive main() with no creations in the source runs', () => {
  it('does not report pass while a cleanup grant is active', async () => {
    const root = tempRoot();
    sourceRun(root, 'read-only-run');
    staleGrant('client-stale');
    const { code, last } = await runMain(['--from', 'read-only-run', '--confirm-production', '--root', root]);
    expect(last).toMatchObject({ result: 'stopped', error: 'cleanup-grant-active', slot: 'A', clientIds: ['client-stale'] });
    expect(code).toBe(1);
    expect(world.grants).toHaveLength(1);
  });

  it('passes with nothing to do only after checking both accounts, with no consent', async () => {
    const root = tempRoot();
    sourceRun(root, 'read-only-run');
    world.grants.push({ slot: 'B', clientId: 'https://chatgpt.com/oauth/client.json', clientName: 'ChatGPT', grantId: STALE_GRANT });
    const { code, last } = await runMain(['--from', 'read-only-run', '--confirm-production', '--root', root]);
    expect(last).toMatchObject({ result: 'pass', archived: 0, activeCleanupGrants: [] });
    expect(code).toBe(0);
    expect(world.consents).toBe(0);
  });
});

describe('archive main() resume hint', () => {
  it('prints a command that works when followed literally', async () => {
    const root = tempRoot();
    sourceRun(root, 'web-run', [{ label: 'web-create', slot: 'A', behaviorId: BEHAVIOR }]);
    world.behaviors.set(BEHAVIOR, { id: BEHAVIOR, title: 'Review practice web-1', archived_at: '2026-11-01T00:00:00Z' });
    await stoppedCleanupRun(root, 'cleanup-first', 'client-stale');
    staleGrant('client-stale');

    const stopped = await runMain(['--from', 'web-run', '--confirm-production', '--root', root]);
    expect(stopped.code).toBe(1);
    expect(stopped.last).toMatchObject({ error: 'cleanup-grant-active', resumeFrom: ['cleanup-first'] });
    expect(stopped.last.next).toContain('--confirm-production');
    expect(stopped.last.next).toContain('--run cleanup-first --resume');

    const args = /npm run mcp:accept:archive -- (.+?)(?:, which|$)/.exec(stopped.last.next)[1].split(' ');
    const resumed = await runMain(args);
    expect(resumed.last).toMatchObject({ result: 'pass', runId: 'cleanup-first', activeCleanupGrants: [] });
    expect(resumed.code).toBe(0);
    expect(world.grants).toEqual([]);
  });

  it('says to revoke in Settings when no ledger here holds the client', async () => {
    const root = tempRoot();
    sourceRun(root, 'read-only-run');
    staleGrant('client-elsewhere');
    const { code, last } = await runMain(['--from', 'read-only-run', '--confirm-production', '--root', root]);
    expect(code).toBe(1);
    expect(last).toMatchObject({ error: 'cleanup-grant-active', resumeFrom: [] });
    expect(last.next).toContain('Connected apps');
  });
});
