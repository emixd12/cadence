// Ticket 252: guided ChatGPT web and Claude web acceptance. Fixture tests only:
// the watcher is a fake child or a fake starter, production reads are fakes,
// and no Cadence server, site or provider is contacted.
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completedSteps, doneHumanSteps, formatSteps, guidedSteps, main, parseGuidedArgs, runGuided, spawnWatcher, watcherArgs,
} from '../scripts/acceptance/guided.mjs';
import { assertSafe, createRun, resumeRun } from '../scripts/acceptance/ledger.mjs';
import { SCENARIOS, SOURCE_KINDS, matchScenario } from '../scripts/acceptance/watch.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SECRET = 'tok_Zq9fakeSECRETvalueThatMustNeverAppear0123456789';
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'cadence-252-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const readTree = (dir) => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

const at = (s) => `2026-10-30T12:00:${String(s).padStart(2, '0')}.000Z`;
const GRANT = id(2);
/** Watcher event lines for one ChatGPT run (ledgerRecord shape, db source). */
const chatgptEvents = (runId, grantId = GRANT) => [
  { type: 'watcher.event', run: runId, source: 'db', kind: 'client.registered', at: at(1), account: 'A', clientId: id(1), clientName: 'ChatGPT', verifiedClient: 'chatgpt', registrationType: 'dcr' },
  { type: 'watcher.event', run: runId, source: 'db', kind: 'grant.created', at: at(2), account: 'A', grantId, clientId: id(1), clientName: 'ChatGPT', verifiedClient: 'chatgpt', scopes: ['cadence.read'] },
  { type: 'watcher.event', run: runId, source: 'db', kind: 'token.issued', at: at(3), account: 'A', grantId, familyId: id(9) },
  { type: 'watcher.event', run: runId, source: 'db', kind: 'tool.call', at: at(4), account: 'A', grantId, clientName: 'ChatGPT', operation: 'list_behaviors', access: 'read', outcome: 'success', errorCode: null },
  { type: 'watcher.event', run: runId, source: 'db', kind: 'tool.call', at: at(5), account: 'A', grantId, clientName: 'ChatGPT', operation: 'create_behavior', access: 'write', outcome: 'success', errorCode: null },
];

/**
 * Fake watcher starter. `script` is a list of { event } or { exit } items
 * played on demand with `next()`, so a test controls when each record appears.
 */
function fakeWatcher(script) {
  const calls = [];
  let handlers = null;
  let resolveExit;
  let i = 0;
  const watcher = {
    start({ args, onEvent, onText }) {
      calls.push(args);
      handlers = { onEvent, onText };
      onText('watching local accounts A since … via db, expecting chatgpt');
      return { result: new Promise((r) => { resolveExit = r; }), stop: () => resolveExit?.(143) };
    },
  };
  const next = async (n = 1) => {
    while (!handlers) await new Promise((r) => setTimeout(r, 2));
    for (let k = 0; k < n && i < script.length; k += 1, i += 1) {
      const item = script[i];
      if (item.exit !== undefined) resolveExit(item.exit);
      else handlers.onEvent(item.event);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const drain = async () => { while (i < script.length) await next(); };
  return { watcher, calls, next, drain };
}

const LOCAL = { client: 'chatgpt', scenario: 'read-write', slot: 'A', target: 'local', timeout: '30m', keepGrant: false, dbUrl: 'postgresql://postgres:postgres@127.0.0.1:56152/postgres', userIds: { A: id(7), B: null } };

describe('guided steps', () => {
  it('give Emi three numbered steps per client and scenario, each tied to watcher steps', () => {
    for (const client of ['chatgpt', 'claude-web']) {
      for (const scenario of ['read-write', 'step-up']) {
        const steps = guidedSteps({ client, scenario, slot: 'B', label: 'guided-x-b-abc123' });
        expect(steps.map((s) => s.id)).toEqual(['connect', 'read', 'write']);
        const watchIds = SCENARIOS[client === 'chatgpt' ? 'chatgpt' : 'claude-web'].steps.map((s) => s.id);
        for (const s of steps) for (const w of s.waitFor) expect(watchIds).toContain(w);
        expect(steps[0].text).toContain('brittlebeliefs@gmail.com');
        expect(steps[2].text).toContain('Review practice guided-x-b-abc123');
        expect(steps[2].text).toMatch(/needs more access/);
        // Privacy rule for Emi's own ChatGPT and Claude accounts.
        expect(steps[1].text).toMatch(/new .* chat/);
        expect(steps[2].text).toMatch(client === 'chatgpt' ? /archive this test chat/ : /delete this test chat/);
        for (const s of steps) expect(s.text).toMatch(/do not open, read or search any other chat/i);
        if (scenario === 'step-up') expect(steps[0].text).toMatch(/untick both write boxes/);
        else expect(steps[0].text).toMatch(/leave any write boxes ticked/);
        // Ledger form: one short safe line.
        for (const s of steps) { expect(s.instruction.length).toBeLessThan(150); expect(() => assertSafe({ instruction: s.instruction })).not.toThrow(); }
      }
    }
  });

  it('never ask Emi to report, paste or remember anything', () => {
    const lines = formatSteps(guidedSteps({ client: 'chatgpt', label: 'guided-gpt-a-000000' }), { client: 'chatgpt' }).join('\n');
    expect(lines).toMatch(/no need to report anything/);
    expect(lines).not.toMatch(/\b(paste|copy|tell me|report back|send me|screenshot|remember)\b/i);
    expect(lines.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(3);
  });

  it('complete in order as the watcher matches records (db and rpc sources)', () => {
    const steps = guidedSteps({ client: 'chatgpt', label: 'guided-gpt-a-000000' });
    const events = chatgptEvents('r1');
    const progress = (kinds, n) => [...completedSteps(steps, matchScenario(SCENARIOS.chatgpt, events.slice(0, n), { kinds }))];
    expect(progress(SOURCE_KINDS.db, 0)).toEqual([]);
    expect(progress(SOURCE_KINDS.db, 2)).toEqual([]); // token not issued yet
    expect(progress(SOURCE_KINDS.db, 3)).toEqual(['connect']);
    expect(progress(SOURCE_KINDS.db, 4)).toEqual(['connect', 'read']);
    expect(progress(SOURCE_KINDS.db, 5)).toEqual(['connect', 'read', 'write']);
    // rpc cannot see registrations or tokens: the grant alone completes step 1.
    const rpc = events.filter((e) => SOURCE_KINDS.rpc.includes(e.kind));
    expect([...completedSteps(steps, matchScenario(SCENARIOS.chatgpt, rpc.slice(0, 1), { kinds: SOURCE_KINDS.rpc }))]).toEqual(['connect']);
    // A write before any read does not complete step 3.
    const writeOnly = [events[0], events[1], events[2], events[4]];
    expect([...completedSteps(steps, matchScenario(SCENARIOS.chatgpt, writeOnly, { kinds: SOURCE_KINDS.db }))]).toEqual(['connect']);
  });
});

describe('arguments', () => {
  it('require a target, confirm production, and a loopback database for local', () => {
    const stopOf = (args) => { try { parseGuidedArgs(args); return 'ok'; } catch (e) { return e.reason; } };
    expect(stopOf(['--client', 'gemini', '--target', 'local'])).toBe('client-invalid');
    expect(stopOf(['--client', 'chatgpt'])).toBe('target-required');
    expect(stopOf(['--client', 'chatgpt', '--target', 'production'])).toBe('confirm-production-required');
    expect(stopOf(['--client', 'chatgpt', '--target', 'production', '--confirm-production', '--db-url', 'postgresql://x@127.0.0.1:1/p'])).toBe('production-fixed-accounts');
    expect(stopOf(['--client', 'chatgpt', '--target', 'local'])).toBe('db-url-required');
    expect(stopOf(['--client', 'chatgpt', '--target', 'local', '--db-url', 'x', '--resume'])).toBe('resume-needs-run');
    expect(stopOf(['--client', 'chatgpt', '--target', 'local', '--db-url', 'x', '--timeout', '10s'])).toBe('timeout-invalid');
    expect(stopOf(['--client', 'chatgpt', '--print-only'])).toBe('ok');
    expect(stopOf(['--client', 'claude-web', '--scenario', 'step-up', '--account', 'B', '--target', 'production', '--confirm-production'])).toBe('ok');
  });

  it('start the watcher with --expect into the same run folder', () => {
    const local = watcherArgs({ options: LOCAL, scenario: 'chatgpt', sinceIso: at(0), runId: 'r1' });
    expect(local).toEqual(expect.arrayContaining(['--target', 'local', '--expect', 'chatgpt', '--run', 'r1', '--json', '--db-url', LOCAL.dbUrl, '--user-a', id(7)]));
    expect(local).not.toContain('--confirm-production');
    const prod = watcherArgs({ options: { ...LOCAL, target: 'production', dbUrl: null, userIds: { A: null, B: null } }, scenario: 'claude-web', sinceIso: at(0), runId: 'r2' });
    expect(prod).toEqual(expect.arrayContaining(['--target', 'production', '--confirm-production', '--expect', 'claude-web']));
    expect(prod).not.toContain('--db-url');
  });
});

describe('local guided run', () => {
  it('starts the watcher before printing the steps and marks each step from the records', async () => {
    const root = tmp();
    const run = createRun({ target: 'local', accounts: ['A'], scenarios: ['guided:chatgpt:read-write'], steps: ['preflight', 'human-connect', 'human-read', 'human-write'], runId: 'g1', root });
    const fake = fakeWatcher([...chatgptEvents('g1').map((event) => ({ event })), { exit: 0 }]);
    const out = [];
    const order = [];
    const watcher = { start: (o) => { order.push('watcher'); return fake.watcher.start(o); } };
    const pending = runGuided({ options: LOCAL, run, watcher, out: (l) => { if (l.startsWith('---')) order.push('list'); out.push(l); }, label: 'guided-gpt-a-111111' });
    await new Promise((r) => setTimeout(r, 20));
    expect(order.slice(0, 2)).toEqual(['watcher', 'list']);
    expect(out.some((l) => l.startsWith('seen:'))).toBe(false);
    // Step 1 is pending in STATE.md while Emi works.
    expect(readFileSync(join(run.dir, 'STATE.md'), 'utf8')).toMatch(/Pending human steps \(1\)\n- human-connect: Step 1: Connect ChatGPT/);
    await fake.next(3);
    expect(out.filter((l) => l.startsWith('seen:'))).toEqual(['seen: step 1 (connect) · waiting for step 2']);
    await fake.drain();
    const result = await pending;
    run.close();
    expect(result.ok).toBe(true);
    expect(out.filter((l) => l.startsWith('seen:'))).toHaveLength(3);
    expect(out.at(-1)).toBe('done: all 3 steps seen in Cadence\'s records');
    expect(fake.calls[0]).toEqual(expect.arrayContaining(['--expect', 'chatgpt', '--run', 'g1']));
    const records = readFileSync(join(run.dir, 'checkpoints.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const human = records.filter((r) => r.kind === 'human').map((r) => `${r.name}:${r.state}`);
    expect(human).toEqual(['human-connect:pending', 'human-connect:done', 'human-read:pending', 'human-read:done', 'human-write:pending', 'human-write:done']);
    expect(readFileSync(join(run.dir, 'STATE.md'), 'utf8')).toMatch(/Status: all planned steps done/);
    for (const r of records) expect(() => assertSafe(r)).not.toThrow();
    expect(statSync(join(run.dir, 'checkpoints.jsonl')).mode & 0o777).toBe(0o600);
  });

  it('stops with a named reason when a step is not seen, and a resume skips the steps already seen', async () => {
    const root = tmp();
    const run = createRun({ target: 'local', accounts: ['A'], scenarios: ['guided:chatgpt:read-write'], steps: ['preflight', 'human-connect', 'human-read', 'human-write'], runId: 'g2', root });
    const events = chatgptEvents('g2');
    const first = fakeWatcher([...events.slice(0, 4).map((event) => ({ event })), { exit: 1 }]);
    const out = [];
    const pending = runGuided({ options: LOCAL, run, watcher: first.watcher, out: (l) => out.push(l), label: 'guided-gpt-a-222222' });
    await first.drain();
    const stopped = await pending;
    run.close();
    expect(stopped).toMatchObject({ ok: false, reason: 'step-not-seen' });
    expect(out.at(-1)).toMatch(/^stopped: step-not-seen at human-write\. Resume: .* --run g2 --resume$/);
    expect(readFileSync(join(run.dir, 'STATE.md'), 'utf8')).toMatch(/human-write: stopped \(step-not-seen\)/);

    const again = resumeRun({ runId: 'g2', root });
    expect([...doneHumanSteps(again)]).toEqual(['human-connect', 'human-read']);
    const second = fakeWatcher([...events.map((event) => ({ event })), { exit: 0 }]);
    const out2 = [];
    const resumed = runGuided({ options: LOCAL, run: again, watcher: second.watcher, out: (l) => out2.push(l), label: 'ignored-on-resume' });
    await new Promise((r) => setTimeout(r, 20));
    expect(out2.filter((l) => /^\d\. \(done\)/.test(l))).toHaveLength(2);
    // The label comes from the recorded preflight, not the new argument.
    expect(out2.find((l) => l.startsWith('3. '))).toContain('Review practice guided-gpt-a-222222');
    await second.drain();
    expect((await resumed).ok).toBe(true);
    again.close();
    const records = readFileSync(join(again.dir, 'checkpoints.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    // Steps 1 and 2 ran once; only step 3 ran again.
    expect(records.filter((r) => r.kind === 'step' && r.name === 'human-connect' && r.state === 'started')).toHaveLength(1);
    expect(records.filter((r) => r.kind === 'step' && r.name === 'human-write' && r.state === 'started')).toHaveLength(2);
  });
});

describe('production guided run (fakes; nothing is called)', () => {
  const grantRow = (grantId, clientName, createdAt = at(2)) => ({ grant_id: grantId, client_id: id(1), client_name: clientName, scopes: ['cadence.read', 'cadence.behaviors.write', 'cadence.occurrences.write'], created_at: createdAt });
  const fakeCleanup = (before) => {
    const calls = [];
    let active = [...before];
    return {
      calls,
      add: (g) => { active.push(g); },
      cleanup: {
        listGrants: async ({ slot }) => { calls.push(`list:${slot}`); return active; },
        checkpointGrant: async ({ slot, label, known }) => {
          calls.push(`checkpoint:${label}`);
          const g = active.find((x) => !known.includes(x.grant_id));
          return { label, slot, grantId: g.grant_id, clientId: g.client_id, clientName: g.client_name, scopes: g.scopes, createdAt: g.created_at };
        },
        checkpointCreation: async ({ slot, label, grantId }) => { calls.push(`creation:${label}`); return { label, slot, behaviorId: id(5), grantId, activityIds: [], behaviorCreatedAt: at(5) }; },
        revokeCaptured: async ({ captured }) => { calls.push(`revoke:${captured.map((g) => g.grantId).join(',')}`); active = active.filter((x) => !captured.some((g) => g.grantId === x.grant_id)); return captured.map((g) => ({ grantId: g.grantId, slot: g.slot, outcome: 'revoked' })); },
      },
    };
  };
  const PROD = { ...LOCAL, target: 'production', dbUrl: null, userIds: { A: null, B: null } };

  it('refuses to start while a Ticket 232 grant or an earlier grant of the same client is active', async () => {
    for (const [row, reason] of [[grantRow('5d764426-0000-4000-8000-000000000001', 'Other'), 'ticket-232-grants-active'], [grantRow(id(3), 'ChatGPT'), 'client-grant-active']]) {
      const root = tmp();
      const run = createRun({ target: 'production', accounts: ['A'], scenarios: ['guided:chatgpt:read-write'], runId: 'p0', root });
      const f = fakeCleanup([row]);
      const w = fakeWatcher([]);
      const out = [];
      const result = await runGuided({ options: PROD, run, watcher: w.watcher, rest: {}, cleanup: f.cleanup, out: (l) => out.push(l) });
      run.close();
      expect(result).toMatchObject({ ok: false, reason });
      expect(w.calls).toHaveLength(0);
      expect(out.some((l) => l.startsWith('---'))).toBe(false);
    }
  });

  it('checkpoints the grant when it appears, records the creation, and revokes only that grant', async () => {
    const root = tmp();
    const run = createRun({ target: 'production', accounts: ['A'], scenarios: ['guided:chatgpt:read-write'], runId: 'p1', root });
    const unrelated = grantRow(id(4), 'Claude Code', at(0));
    const f = fakeCleanup([unrelated]);
    const events = chatgptEvents('p1').filter((e) => SOURCE_KINDS.rpc.includes(e.kind)).map((e) => ({ ...e, source: 'rpc' }));
    const w = fakeWatcher([{ event: events[0] }, ...events.slice(1).map((event) => ({ event })), { exit: 0 }]);
    const out = [];
    const pending = runGuided({ options: PROD, run, watcher: w.watcher, rest: { token: SECRET }, cleanup: f.cleanup, out: (l) => out.push(l), label: 'guided-gpt-a-333333' });
    await new Promise((r) => setTimeout(r, 10));
    f.add(grantRow(GRANT, 'ChatGPT'));
    await w.drain();
    const result = await pending;
    run.close();
    expect(result.ok).toBe(true);
    expect(f.calls).toEqual(['list:A', 'checkpoint:guided-gpt-a-333333-grant', 'creation:guided-gpt-a-333333-create', `revoke:${GRANT}`]);
    expect(w.calls[0]).toEqual(expect.arrayContaining(['--confirm-production', '--expect', 'chatgpt']));
    expect(out).toEqual(expect.arrayContaining([`grant: ${GRANT.slice(0, 8)} scopes=cadence.read,cadence.behaviors.write,cadence.occurrences.write`, 'revoked: 1 grant(s)']));
    expect(readTree(run.dir)).not.toContain(SECRET);
    expect(out.join('\n')).not.toContain(SECRET);
  });
});

describe('watcher child', () => {
  it('parses event lines, passes text through, and resolves after stdout closes', async () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.exitCode = null;
    child.kill = () => {};
    let spawned = null;
    const starter = spawnWatcher({ spawnImpl: (node, args, opts) => { spawned = { args, opts }; return child; }, node: '/usr/bin/node' });
    const events = [];
    const text = [];
    const handle = starter.start({ args: ['--expect', 'chatgpt'], onEvent: (e) => events.push(e), onText: (l) => text.push(l) });
    expect(spawned.args[0]).toMatch(/scripts\/acceptance\/watch\.mjs$/);
    expect(spawned.args).toContain('--expect');
    expect(spawned.opts.stdio).toEqual(['ignore', 'pipe', 'inherit']);
    child.stdout.write('watching local accounts A\n');
    child.stdout.write(`${JSON.stringify(chatgptEvents('w')[0])}\n`);
    child.stdout.write('{not json\n');
    child.emit('exit', 0);
    child.stdout.end(`${JSON.stringify(chatgptEvents('w')[1])}\n`);
    await new Promise((r) => setTimeout(r, 10));
    child.emit('close', 0);
    expect(await handle.result).toBe(0);
    expect(events.map((e) => e.kind)).toEqual(['client.registered', 'grant.created']);
    expect(text).toEqual(['watching local accounts A', '{not json']);
  });
});

describe('CLI', () => {
  it('prints a preview without starting anything, and refuses bad usage with exit 2', async () => {
    const out = [];
    expect(await main(['--client', 'claude-web', '--print-only'], {}, (l) => out.push(l))).toBe(0);
    expect(out[0]).toMatch(/^--- Steps for Emi \(Claude;/);
    const bad = [];
    expect(await main(['--client', 'chatgpt', '--target', 'production'], {}, (l) => bad.push(l))).toBe(2);
    expect(bad).toEqual(['guided-stopped confirm-production-required']);
    const nokey = [];
    expect(await main(['--client', 'chatgpt', '--target', 'production', '--confirm-production'], {}, (l) => nokey.push(l))).toBe(2);
    expect(nokey).toEqual(['guided-stopped publishable-key-required']);
  });

  it('runs a local rehearsal end to end through main with an injected watcher', async () => {
    const root = tmp();
    const fake = fakeWatcher([...chatgptEvents('cli-1').map((event) => ({ event })), { exit: 0 }]);
    const out = [];
    const pending = main(['--client', 'chatgpt', '--target', 'local', '--db-url', LOCAL.dbUrl, '--run', 'cli-1'], {}, (l) => out.push(l), { root, watcher: fake.watcher, label: 'guided-gpt-a-444444' });
    await new Promise((r) => setTimeout(r, 20));
    await fake.drain();
    expect(await pending).toBe(0);
    expect(out[0]).toBe('run: cli-1');
    expect(out).toContain('local rehearsal: no grant checkpoint or revoke; whoever made the local grant revokes it');
    expect(readdirSync(join(root, 'cli-1'))).not.toContain('lock');
  });
});
