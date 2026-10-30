import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSafe, createRun, LedgerStop, listRuns, readRun, resumeRun, STATE_MAX_LINES } from '../scripts/acceptance/ledger.mjs';
import { revokeCaptured } from '../scripts/mcp-acceptance-cleanup.mjs';

const LEDGER = fileURLToPath(new URL('../scripts/acceptance/ledger.mjs', import.meta.url));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roots = [];
const tmpRoot = () => { const r = mkdtempSync(join(tmpdir(), 'cadence-ledger-')); roots.push(r); return r; };
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

const base = (root, extra = {}) => ({ root, target: 'local', accounts: [{ slot: 'A', email: 'cadence.testing.is@gmail.com' }, { slot: 'B' }], scenarios: ['protocol'], gitSha: '52ec0af', ...extra });
const grantCheckpoint = (label, grantId, slot = 'A') => ({ label, slot, grantId, clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata', clientName: 'Claude', scopes: ['cadence.read', 'cadence.occurrences.write'], createdAt: '2026-10-30T01:00:00.000Z' });
const stops = (fn, reason) => {
  let caught;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(LedgerStop);
  expect(caught.reason).toBe(reason);
};
const readAll = (dir) => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

function runChild(code) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((res) => child.on('exit', (codeValue, signal) => res({ code: codeValue, signal })));
  const ready = new Promise((res, rej) => {
    child.stdout.on('data', () => { if (out.includes('ready')) res(); });
    child.on('exit', () => rej(new Error(`child exited before ready: ${err}`)));
  });
  return { child, ready, exited };
}

describe('acceptance run ledger', () => {
  it('resumes a run killed midway: finished steps are skipped and the run completes', async () => {
    const root = tmpRoot();
    const runId = 'kill-test';
    const { child, ready, exited } = runChild(`
      import { createRun } from ${JSON.stringify(pathToFileURL(LEDGER).href)};
      import { appendFileSync } from 'node:fs';
      const run = createRun({ root: ${JSON.stringify(root)}, runId: '${runId}', target: 'local', scenarios: ['protocol'], steps: ['discover', 'consent-a', 'tools-a'], gitSha: '52ec0af' });
      await run.step('discover', async () => { appendFileSync(${JSON.stringify(join(root, 'calls'))}, 'discover\\n'); return { tools: 16 }; });
      await run.step('consent-a', async ({ checkpoint }) => {
        appendFileSync(${JSON.stringify(join(root, 'calls'))}, 'consent-a\\n');
        checkpoint('grant', ${JSON.stringify(grantCheckpoint('consent-a', id(901)))});
        process.stdout.write('ready\\n');
        await new Promise(() => {});
      });
    `);
    await ready;
    child.kill('SIGKILL');
    expect((await exited).signal).toBe('SIGKILL');

    const dir = join(root, runId);
    // A write cut off by the kill leaves a torn last line; resume repairs it.
    appendFileSync(join(dir, 'checkpoints.jsonl'), '{"seq":99,"kind":"st');
    const before = readFileSync(join(dir, 'STATE.md'), 'utf8');
    expect(before).toContain('consent-a: interrupted during attempt 1');
    expect(before).toContain('## Next (1)');

    const run = resumeRun({ root, runId });
    const calls = [];
    const discover = await run.step('discover', async () => { calls.push('discover'); return { tools: 0 }; });
    expect(discover).toEqual({ tools: 16 });
    const consent = await run.step('consent-a', async ({ attempt, interrupted }) => {
      calls.push('consent-a');
      expect({ attempt, interrupted }).toEqual({ attempt: 2, interrupted: true });
      const recorded = run.cleanupInputs().grants.find((g) => g.label === 'consent-a');
      return { grantId: recorded.grantId, readback: 'present' };
    });
    await run.step('tools-a', async () => { calls.push('tools-a'); return { passed: 16 }; });
    expect(calls).toEqual(['consent-a', 'tools-a']);
    expect(consent.grantId).toBe(id(901));
    expect(readFileSync(join(root, 'calls'), 'utf8')).toBe('discover\nconsent-a\n');

    const state = readFileSync(join(dir, 'STATE.md'), 'utf8');
    expect(state).toContain('Status: all planned steps done');
    expect(state).not.toContain('## Blocked');
    expect(state).toContain(`grant consent-a (A): ${id(901)}`);
    expect(readFileSync(join(dir, 'checkpoints.jsonl'), 'utf8').endsWith('\n')).toBe(true);
    run.close();
    expect(readdirSync(dir)).not.toContain('lock');
  }, 20_000);

  it('refuses a second writer while the owning process is alive', () => {
    const root = tmpRoot();
    const run = createRun(base(root, { runId: 'locked' }));
    stops(() => resumeRun({ root, runId: 'locked' }), 'run-locked');
    run.close();
    const again = resumeRun({ root, runId: 'locked' });
    again.close();
    stops(() => createRun(base(root, { runId: 'locked' })), 'run-exists');
    stops(() => createRun(base(root, { runId: '../escape' })), 'run-id');
    stops(() => resumeRun({ root, runId: 'missing' }), 'run-missing');
  });

  it('records a failed step as stopped with a reason only, and runs it again', async () => {
    const root = tmpRoot();
    const token = randomBytes(32).toString('base64url');
    const run = createRun(base(root, { runId: 'stopped', steps: ['revoke'] }));
    await expect(run.step('revoke', async () => { throw new Error(`refresh failed for ${token}`); })).rejects.toThrow();
    await expect(run.step('revoke', async () => { throw Object.assign(new Error('x'), { reason: 'revoke-failed' }); })).rejects.toThrow();
    expect(readFileSync(join(run.dir, 'STATE.md'), 'utf8')).toContain('revoke: stopped (revoke-failed) on attempt 2');
    const result = await run.step('revoke', async ({ attempt, interrupted }) => ({ attempt, interrupted }));
    expect(result).toEqual({ attempt: 3, interrupted: false });
    const steps = run.checkpoints.filter((c) => c.kind === 'step').map((c) => [c.state, c.reason ?? null]);
    expect(steps).toEqual([['started', null], ['stopped', 'internal-error'], ['started', null], ['stopped', 'revoke-failed'], ['started', null], ['done', null]]);
    expect(readAll(run.dir)).not.toContain(token);
    run.close();
  });

  it('never writes tokens, codes, cookies, keys or note text', async () => {
    const root = tmpRoot();
    const accessToken = randomBytes(32).toString('base64url');
    const authCode = randomBytes(32).toString('base64url');
    const jwt = `eyJhbGciOiJFUzI1NiJ9.${Buffer.from('{"sub":"user"}').toString('base64url')}.${randomBytes(48).toString('base64url')}`;
    const apiKey = `sk-ant-api03-${randomBytes(24).toString('hex')}`;
    const cookie = `sb-auth-token=${randomBytes(20).toString('base64url')}`;
    const hexSecret = randomBytes(32).toString('hex');
    const note = 'Felt dizzy after the morning walk';
    const planted = [accessToken, authCode, jwt, apiKey, cookie, hexSecret, note];

    stops(() => createRun(base(root, { runId: 'bad-meta', accounts: [{ slot: 'A', accessToken }] })), 'unsafe-key');
    const run = createRun(base(root, { runId: 'secrets', steps: ['consent'] }));

    const attempts = [
      () => run.step('a1', async () => ({ accessToken })),
      () => run.step('a2', async () => ({ value: jwt })),
      () => run.step('a3', async () => ({ note })),
      () => run.step('a4', async () => ({ grants: [{ code: authCode }] })),
      () => run.step('a5', async () => ({ header: `Bearer ${accessToken}` })),
      () => run.step('a6', async () => ({ redirect: `http://127.0.0.1:4410/callback?code=${authCode}&state=x` })),
      () => run.step('a7', async () => ({ key: apiKey })),
      () => run.step('a8', async () => ({ digest: hexSecret })),
      () => run.step('a9', async () => ({ list: [authCode] })),
      () => run.step('a10', async () => { throw Object.assign(new Error(accessToken), { reason: accessToken }); }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow();

    const sync = [
      () => run.appendEvent({ tool: 'set_occurrence_note', arguments: { note } }),
      () => run.appendEvent({ tool: 'list_behaviors', structuredContent: { items: [] } }),
      () => run.appendEvent({ message: note }),
      () => run.appendEvent({ cookie }),
      () => run.appendEvent({ detail: `line one\n${note}` }),
      () => run.appendEvent({ [accessToken]: true }),
      () => run.recordCheckpoint('grant', { ...grantCheckpoint('g1', id(1)), refreshToken: accessToken }),
      () => run.recordCheckpoint('grant', { ...grantCheckpoint('g2', id(2)), clientName: jwt }),
      () => run.recordCheckpoint('human', { name: 'sign-in-a', state: 'pending', instruction: `Paste ${authCode}` }),
      () => run.recordCheckpoint('creation', { label: 'c1', slot: 'A', behaviorId: id(3), title: note.repeat(10) }),
    ];
    for (const attempt of sync) expect(attempt).toThrow(LedgerStop);

    // Legitimate shapes pass.
    run.appendEvent({ source: 'watcher', table: 'activity', operation: 'set_occurrence_note', outcome: 'success', grantId: id(4), occurredAt: '2026-10-30T01:02:03.000Z', scopes: ['cadence.read'], errorCode: null, noteHash: hexSecret.replace(/./g, 'a') });
    run.recordCheckpoint('human', { name: 'sign-in-a', state: 'pending', instruction: 'Sign in to Google as test account A in the QA Chrome profile' });
    await run.step('consent', async ({ checkpoint }) => { checkpoint('grant', grantCheckpoint('consent', id(5))); return { grantId: id(5), outcome: 'granted' }; });
    run.close();

    const files = readAll(join(root, 'secrets'));
    for (const secret of planted) expect(files).not.toContain(secret);
    expect(files).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(files).not.toMatch(/bearer\s/i);
    expect(files).not.toMatch(/sk-ant-/);
    expect(files).not.toMatch(/[?&]code=/);
    // No base64url run as long as an opaque Cadence token or code.
    expect(files.replace(/[0-9a-f-]{36}/g, '')).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(files).toContain('sign-in-a: Sign in to Google as test account A');
  });

  it('accepts the cleanup checkpoint shapes and validates them like the cleanup script', () => {
    expect(() => assertSafe({ label: 'consent', slot: 'A', behaviorId: id(1), grantId: id(2), activityIds: [7, 8], behaviorCreatedAt: '2026-10-29T20:55:00Z' })).not.toThrow();
    expect(() => assertSafe({ gitSha: 'f07ebca0d4b1d3f9a3c1e2b4a5d6e7f8091a2b3c', noteHash: 'a'.repeat(64), clientId: id(9) })).not.toThrow();
    const root = tmpRoot();
    const run = createRun(base(root, { runId: 'shapes' }));
    run.recordCheckpoint('grant', grantCheckpoint('claude-web', id(901)));
    stops(() => run.recordCheckpoint('grant', grantCheckpoint('claude-web', id(902))), 'label-used');
    stops(() => run.recordCheckpoint('grant', grantCheckpoint('other', id(901))), 'grant-already-checkpointed');
    stops(() => run.recordCheckpoint('grant', grantCheckpoint('bad-slot', id(903), 'C')), 'grant-shape');
    stops(() => run.recordCheckpoint('grant', grantCheckpoint('Bad Label', id(904))), 'grant-shape');
    stops(() => run.recordCheckpoint('creation', { label: 'c', slot: 'A', behaviorId: 'not-a-uuid' }), 'creation-shape');
    stops(() => run.recordCheckpoint('created', { label: 'c' }), 'checkpoint-kind');
    run.close();
  });

  it('gives cleanup the granted and created IDs, including from a read-only view', async () => {
    const root = tmpRoot();
    const run = createRun(base(root, { runId: 'cleanup' }));
    run.recordCheckpoint('grant', grantCheckpoint('claude-web', id(901), 'A'));
    run.recordCheckpoint('grant', { ...grantCheckpoint('inspector', id(902), 'B'), clientId: id(77), clientName: 'Inspector' });
    run.recordCheckpoint('creation', { label: 'claude-web-create', slot: 'A', behaviorId: id(10), grantId: id(901), activityIds: [7], behaviorCreatedAt: '2026-10-30T01:05:00Z' });
    const live = run.cleanupInputs();
    run.close();

    const view = readRun({ root, runId: 'cleanup' });
    expect(view.cleanupInputs()).toEqual(live);
    expect(() => view.appendEvent({ source: 'watcher' })).toThrow(LedgerStop);
    expect(live.creations).toEqual([{ label: 'claude-web-create', slot: 'A', behaviorId: id(10), grantId: id(901), activityIds: [7], behaviorCreatedAt: '2026-10-30T01:05:00Z' }]);

    const cli = JSON.parse(execFileSync(process.execPath, [LEDGER, 'ids', 'cleanup', '--root', root], { encoding: 'utf8' }));
    expect(cli).toEqual(live);
    expect(JSON.parse(execFileSync(process.execPath, [LEDGER, 'list', '--root', root], { encoding: 'utf8' }))).toEqual(['cleanup']);
    expect(listRuns({ root })).toEqual(['cleanup']);

    // The grants feed revokeCaptured from Ticket 232's cleanup script unchanged.
    const grants = { A: [{ grant_id: id(901), client_id: 'x', client_name: 'Claude', scopes: [], created_at: '2026-10-30T01:00:00Z' }], B: [{ grant_id: id(902), client_id: 'y', client_name: 'Inspector', scopes: [], created_at: '2026-10-30T01:00:00Z' }] };
    const rest = async (slot, method, path, body) => {
      if (path === '/rest/v1/rpc/oauth_list_grants') return { status: 200, json: grants[slot] };
      if (path === '/rest/v1/rpc/oauth_revoke_grant') { grants[slot] = grants[slot].filter((g) => g.grant_id !== body.p_grant_id); return { status: 200, json: true }; }
      return { status: 404, json: null };
    };
    const results = await revokeCaptured({ rest, captured: live.grants });
    expect(results.map((r) => [r.slot, r.grantId, r.outcome])).toEqual([['A', id(901), 'revoked'], ['B', id(902), 'revoked']]);
  });

  it('keeps STATE.md within 60 lines and shows blocked, human and next first', async () => {
    const root = tmpRoot();
    const planned = Array.from({ length: 120 }, (_, i) => `step-${String(i).padStart(3, '0')}`);
    const run = createRun(base(root, { runId: 'big', steps: planned }));
    for (const name of planned.slice(0, 90)) await run.step(name, async () => ({ ok: true }));
    for (const name of planned.slice(90, 95)) await expect(run.step(name, async () => { throw new LedgerStop('server-500'); })).rejects.toThrow();
    for (let i = 0; i < 12; i += 1) run.recordCheckpoint('human', { name: `human-${i}`, state: 'pending', instruction: 'Create the OpenAI API key in the Cadence QA project' });
    run.recordCheckpoint('human', { name: 'human-0', state: 'done' });
    for (let i = 0; i < 40; i += 1) run.recordCheckpoint('grant', grantCheckpoint(`g-${i}`, id(1000 + i)));
    const state = run.renderState();
    run.close();
    const lines = state.trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(STATE_MAX_LINES);
    expect(state).toBe(readFileSync(join(root, 'big', 'STATE.md'), 'utf8'));
    expect(state).toContain('Status: blocked · Done 90 · Next 25 · Blocked 5 · Human 11 · IDs 40');
    expect(state).toContain('## Blocked (5)');
    expect(state).toContain('step-090: stopped (server-500) on attempt 1');
    expect(state).toContain('## Pending human steps (11)');
    expect(state).not.toContain('- human-0:');
    expect(state).toContain('## Next (25)');
    expect(state).toContain('## Done (90)');
    expect(state).toMatch(/- … \d+ earlier/);
    expect(state).toContain('step-089 (attempt 1)');
    expect(state.indexOf('## Blocked')).toBeLessThan(state.indexOf('## Pending human steps'));
    expect(state.indexOf('## Next')).toBeLessThan(state.indexOf('## Done'));
  });

  it('writes private files and a run.json a new agent can read', () => {
    const root = tmpRoot();
    const run = createRun({ root, runId: 'meta', target: 'production', accounts: ['A', 'B'], scenarios: ['protocol', 'clients'], steps: ['discover'] });
    run.appendEvent({ source: 'watcher', operation: 'list_behaviors', outcome: 'success' });
    run.close();
    const meta = JSON.parse(readFileSync(join(root, 'meta', 'run.json'), 'utf8'));
    expect(meta).toMatchObject({ version: 1, runId: 'meta', target: 'production', accounts: ['A', 'B'], scenarios: ['protocol', 'clients'], steps: ['discover'] });
    expect(meta.gitSha).toMatch(/^[0-9a-f]{40}$/);
    for (const f of ['run.json', 'events.jsonl', 'STATE.md']) expect(statSync(join(root, 'meta', f)).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'meta')).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(root, 'meta', 'STATE.md'), 'utf8')).toContain('Events 1');
  });
});
