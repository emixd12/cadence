// Ticket 249: protocol acceptance suite. Runs the whole suite against an
// in-memory fake of Cadence's MCP and OAuth surface (no network, no Chrome),
// checks registry drift, CLI guards, resume, the report, and that no token,
// session JWT or note text reaches stdout or the run folder.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INTEGRATION_OPERATION_NAMES, INTEGRATION_OPERATIONS } from '@cadence/core/integration';
import { assertSafe, createRun, resumeRun } from '../scripts/acceptance/ledger.mjs';
import { GRANTS } from '../scripts/acceptance/consent-page.mjs';
import { Secret } from '../scripts/acceptance/test-account-sessions.mjs';
import {
  READ_LIMIT, READ_TOOLS, REGISTRY_TOOLS, SAMPLE_NOTE, WRITE_LIMIT, WRITE_SCOPE, main, parseArgs, renderReport, runProtocolSuite, writeReport,
} from '../scripts/acceptance/protocol.mjs';

const ISSUER = 'https://127.0.0.1:4440';
const RESOURCE = `${ISSUER}/mcp`;
const TODAY = '2026-10-30';
const opaque = () => randomBytes(32).toString('base64url');
const sha = (v) => createHash('sha256').update(v).digest('hex');
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

/** In-memory Cadence: grants, token families, two accounts' data, per-grant rate limits. */
function createFakeCadence({ readOnlyCanWrite = false, leakIntoNotFound = false } = {}) {
  const grants = [];
  const access = new Map();
  const refresh = new Map();
  const data = { behaviors: [], occurrences: [], idempotent: new Map() };
  const secrets = [];
  const counts = { authorize: 0 };
  const issue = (grant) => {
    const a = opaque(); const r = opaque();
    secrets.push(a, r);
    const family = { revoked: false };
    access.set(a, { grant, family }); refresh.set(r, { grant, family, rotated: false });
    return { a, r };
  };
  const live = (token) => {
    const entry = access.get(token);
    return entry && !entry.family.revoked && !entry.grant.revoked ? entry.grant : null;
  };

  const driver = {
    discover: async () => ({ server: { token_endpoint: `${ISSUER}/oauth/token` }, resource: RESOURCE }),
    registerDynamic: async ({ name }) => ({ type: 'dcr', clientId: randomUUID(), clientName: name }),
    authorize: async ({ slot, client, grant }) => {
      counts.authorize += 1;
      const row = { grantId: randomUUID(), slot, clientId: client.clientId, clientName: client.clientName, scopes: [...GRANTS[grant]], revoked: false, counters: { read: 0, write: 0 } };
      grants.push(row);
      let { a, r } = issue(row);
      return {
        slot, clientId: client.clientId,
        get scopes() { return [...row.scopes, 'offline_access']; },
        get accessToken() { return new Secret(a); },
        get refreshToken() { return new Secret(r); },
        authorization: () => `Bearer ${a}`,
        refresh: async () => {
          const previous = new Secret(r);
          const entry = refresh.get(r); entry.rotated = true;
          const next = opaque(); const nextAccess = opaque(); secrets.push(next, nextAccess);
          access.set(nextAccess, { grant: row, family: entry.family }); refresh.set(next, { grant: row, family: entry.family, rotated: false });
          a = nextAccess; r = next;
          return { rotated: true, previous };
        },
        revoke: async () => { refresh.get(r).family.revoked = true; return { revoked: true }; },
      };
    },
    grantsFor: async (slot, clientId) => grants.filter((g) => g.slot === slot && g.clientId === clientId && !g.revoked).map((g) => ({ grantId: g.grantId, scopes: g.scopes })),
    revokeGrants: async (slot, clientId) => {
      let n = 0;
      for (const g of grants) if (g.slot === slot && g.clientId === clientId && !g.revoked) { g.revoked = true; n += 1; }
      return n;
    },
  };

  const own = (list, slot, id) => list.find((x) => x.id === id && x.slot === slot) ?? null;
  const notFound = () => ({ isError: true, errorCode: 'not_found', structured: { error: { code: 'not_found' } } });
  const okResult = (structured) => ({ isError: false, errorCode: null, structured });
  const view = (b) => ({ id: b.id, title: b.title, state: b.state, revision: b.revision, created_at: b.created_at });
  const occView = (o) => ({ id: o.id, behavior_id: o.behavior_id, status: o.status, note: o.note, local_date: o.local_date, status_history: [...o.history] });
  const execute = (grant, name, args) => {
    const slot = grant.slot;
    switch (name) {
      case 'get_account_context': return okResult({ account_ref: sha(`${slot}${grant.clientId}`).slice(0, 24), today_local_date: TODAY, granted_scopes: grant.scopes });
      case 'list_behaviors': return okResult({ behaviors: data.behaviors.filter((b) => b.slot === slot).map(view), next_cursor: null });
      case 'get_behavior': { const b = own(data.behaviors, slot, args.behavior_id); return b ? okResult({ behavior: view(b) }) : notFound(); }
      case 'list_categories': return okResult({ categories: [], next_cursor: null });
      case 'get_timeline': return okResult({ days: [{ local_date: TODAY, occurrences: data.occurrences.filter((o) => o.slot === slot).map(occView) }] });
      case 'list_occurrences': return okResult({ occurrences: data.occurrences.filter((o) => o.slot === slot && (!args.behavior_ids || args.behavior_ids.includes(o.behavior_id))).map(occView) });
      case 'get_occurrence': { const o = own(data.occurrences, slot, args.occurrence_id); return o ? okResult({ occurrence: occView(o) }) : notFound(); }
      case 'get_adherence_summary': return okResult({ overall: {}, behaviors: [] });
      case 'search': return okResult({ results: data.behaviors.filter((b) => b.slot === slot && b.title.startsWith(args.query)).map((b) => ({ id: `behavior:${b.id}`, title: b.title, url: 'https://x' })) });
      case 'fetch': { const b = own(data.behaviors, slot, args.id.split(':')[1]); return b ? okResult({ id: args.id }) : notFound(); }
      case 'create_behavior': {
        const k = `${slot}:${args.idempotency_key}`;
        if (args.idempotency_key && data.idempotent.has(k)) return okResult(structuredClone(data.idempotent.get(k)));
        const b = { id: randomUUID(), slot, title: args.title, state: 'active', revision: 1, created_at: new Date().toISOString() };
        data.behaviors.push(b);
        data.occurrences.push({ id: randomUUID(), slot, behavior_id: b.id, status: 'unresolved', note: null, local_date: TODAY, history: [] });
        const out = { behavior: view(b) };
        if (args.idempotency_key) data.idempotent.set(k, structuredClone(out));
        return okResult(out);
      }
      case 'update_behavior': { const b = own(data.behaviors, slot, args.behavior_id); if (!b) return notFound(); b.title = args.title; b.revision += 1; return okResult({ behavior: view(b), changed: true }); }
      case 'archive_behavior': { const b = own(data.behaviors, slot, args.behavior_id); if (!b) return notFound(); b.state = 'archived'; return okResult({ behavior: view(b), changed: true }); }
      case 'restore_behavior': { const b = own(data.behaviors, slot, args.behavior_id); if (!b) return notFound(); b.state = 'active'; return okResult({ behavior: view(b), changed: true }); }
      case 'set_occurrence_status': {
        const o = own(data.occurrences, slot, args.occurrence_id); if (!o) return notFound();
        const previous = o.status; o.status = args.status; o.history.push({ status: args.status });
        return okResult({ occurrence: occView(o), previous_status: previous, changed: previous !== args.status });
      }
      case 'update_occurrence_note': { const o = own(data.occurrences, slot, args.occurrence_id); if (!o) return notFound(); o.note = args.note; return okResult({ occurrence: occView(o), changed: true }); }
      default: return { isError: true, errorCode: 'unknown_tool', structured: null };
    }
  };
  const handle = (authorization, name, args) => {
    if (!authorization) return { status: 401, wwwAuthenticate: `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"` };
    const grant = live(authorization.replace(/^Bearer /, ''));
    if (!grant) return { status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' };
    const kind = WRITE_SCOPE[name] ? 'write' : 'read';
    grant.counters[kind] += 1;
    if (grant.counters[kind] > (kind === 'read' ? READ_LIMIT : WRITE_LIMIT)) return { status: 429, isError: true, errorCode: 'rate_limited', retryAfter: 42 };
    if (WRITE_SCOPE[name] && !grant.scopes.includes(WRITE_SCOPE[name]) && !readOnlyCanWrite) {
      return { status: 403, isError: true, errorCode: 'insufficient_scope', stepUpMeta: true, wwwAuthenticate: `Bearer error="insufficient_scope", scope="${WRITE_SCOPE[name]}"` };
    }
    const result = execute(grant, name, args);
    if (leakIntoNotFound && result.errorCode === 'not_found') return { status: 200, isError: false, errorCode: null, structured: result.structured };
    return { status: 200, ...result };
  };
  const protocol = {
    metadata: async () => ({
      resourceStatus: 200, resource: { resource: RESOURCE, authorization_servers: [ISSUER], scopes_supported: [...GRANTS.full] },
      serverStatus: 200, server: { issuer: ISSUER, code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true,
        authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token`, registration_endpoint: `${ISSUER}/oauth/register`, revocation_endpoint: `${ISSUER}/oauth/revoke` },
    }),
    raw: async (authorization, name, args = {}) => {
      const r = handle(authorization, name, args);
      return { status: r.status, isError: Boolean(r.isError), errorCode: r.errorCode ?? null, wwwAuthenticate: r.wwwAuthenticate ?? '', retryAfter: r.retryAfter ?? NaN, stepUpMeta: Boolean(r.stepUpMeta) };
    },
    connect: async (tokens) => ({
      listTools: async () => [...REGISTRY_TOOLS],
      call: async (name, args = {}) => {
        const r = handle(tokens.authorization(), name, args);
        return { ok: r.status === 200 && !r.isError, structured: r.structured ?? null, errorCode: r.errorCode ?? (r.status === 200 ? null : `sdk-${r.status}`) };
      },
      close: async () => {},
    }),
    postToken: async (_endpoint, params) => {
      if (params.resource !== RESOURCE) return { status: 400, error: 'invalid_grant' };
      const entry = refresh.get(params.refresh_token);
      if (!entry || entry.rotated || entry.family.revoked) { if (entry?.rotated) entry.family.revoked = true; return { status: 400, error: 'invalid_grant' }; }
      return { status: 200, error: null };
    },
  };
  const sessionJwt = `eyJhbGciOiJFUzI1NiJ9.${Buffer.from('{"sub":"fake"}').toString('base64url')}.${opaque()}`;
  const sessions = { current: async () => ({ accessToken: sessionJwt }) };
  const rest = async (slot, method, path, body) => {
    if (path === '/rest/v1/rpc/oauth_list_grants') {
      return { status: 200, json: grants.filter((g) => g.slot === slot && !g.revoked).map((g) => ({ grant_id: g.grantId, client_id: g.clientId, client_name: g.clientName, scopes: g.scopes, created_at: new Date().toISOString() })) };
    }
    if (path === '/rest/v1/rpc/oauth_revoke_grant') { const g = grants.find((x) => x.grantId === body.p_grant_id); if (g) g.revoked = true; return { status: 200, json: true }; }
    return { status: 404, json: null };
  };
  return { driver, protocol, sessions, rest, grants, data, secrets: () => [...secrets, sessionJwt, SAMPLE_NOTE], counts };
}

const tempRoot = () => { const dir = mkdtempSync(join(tmpdir(), 'accept-249-')); roots.push(dir); return dir; };
async function runFake({ target = 'local', fake = createFakeCadence(), root = tempRoot(), runId = 'fake-run', resume = false } = {}) {
  const run = resume ? resumeRun({ runId, root }) : createRun({ target, accounts: ['A', 'B'], scenarios: ['protocol'], steps: ['preflight'], runId, root, gitSha: null });
  const lines = [];
  try {
    const result = await runProtocolSuite({ run, target, issuer: ISSUER, ...fake, runTag: 'abcd1234', emit: (row) => lines.push(JSON.stringify(row)) });
    const report = writeReport(run, { target, ...result });
    return { ...result, report, lines, dir: run.dir, fake, root };
  } finally { run.close(); }
}
const failed = (checks) => checks.filter((c) => !c.ok && !c.skipped).map((c) => `${c.scenario}/${c.check}`);

describe('Ticket 249 protocol acceptance suite', () => {
  it('keeps the tool list and write scopes equal to the integration registry', () => {
    expect(REGISTRY_TOOLS).toEqual([...INTEGRATION_OPERATION_NAMES]);
    for (const name of INTEGRATION_OPERATION_NAMES) {
      const scope = INTEGRATION_OPERATIONS[name].scope;
      if (scope === 'cadence.read') expect(READ_TOOLS).toContain(name);
      else expect(WRITE_SCOPE[name]).toBe(scope);
    }
    expect(READ_TOOLS).toHaveLength(10);
  });

  it('passes every check against a correct server and leaves no grant active', async () => {
    const { ok, checks, report, fake } = await runFake();
    expect(failed(checks)).toEqual([]);
    expect(ok).toBe(true);
    expect(fake.grants).toHaveLength(6);
    expect(fake.grants.every((g) => g.revoked)).toBe(true);
    expect(fake.data.behaviors.filter((b) => b.slot === 'A')).toHaveLength(1);
    expect(fake.data.behaviors.every((b) => b.state === 'archived')).toBe(true);
    expect(fake.data.behaviors.filter((b) => b.slot === 'B')).toHaveLength(0);
    for (const tool of REGISTRY_TOOLS) expect(checks.some((c) => c.check.startsWith(tool))).toBe(true);
    expect(report).toMatch(/\| ratelimit-a \| read-limit \| pass \| first-429=121 \|/);
    expect(report).toMatch(/PASS/);
  });

  it('fails, with named checks, when a read-only grant can write or B can read A', async () => {
    const writes = await runFake({ fake: createFakeCadence({ readOnlyCanWrite: true }) });
    expect(writes.ok).toBe(false);
    expect(failed(writes.checks)).toEqual(expect.arrayContaining(['read-a/create_behavior-step-up', 'behaviors-a/set_occurrence_status-denied']));
    expect(writes.report).toMatch(/FAIL/);
    const leaks = await runFake({ fake: createFakeCadence({ leakIntoNotFound: true }) });
    expect(leaks.ok).toBe(false);
    expect(failed(leaks.checks)).toEqual(expect.arrayContaining(['isolation-b/get_behavior-not-found', 'isolation-b/archive_behavior-not-found']));
  });

  it('skips rate-limit exhaustion in production and reports it as SKIPPED, not as a pass', async () => {
    const { ok, checks, fake, report, dir } = await runFake({ target: 'production' });
    expect(ok).toBe(true);
    expect(checks.filter((c) => c.scenario === 'ratelimit-a')).toEqual([
      { scenario: 'ratelimit-a', check: 'rate-limits', ok: null, skipped: true, detail: 'production-skips-rate-limit-exhaustion' },
    ]);
    expect(fake.grants).toHaveLength(5);
    const counted = checks.length - 1;
    expect(report).toContain('| ratelimit-a | rate-limits | SKIPPED | production-skips-rate-limit-exhaustion |');
    expect(report).toContain(`Target: production · ${counted}/${counted} checks passed · 1 skipped · PASS`);
    const evidence = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'));
    expect(evidence).toMatchObject({ ok: true, total: counted, passed: counted, skipped: 1 });
  });

  it('writes no token, session JWT or note text to stdout or the run folder', async () => {
    const { lines, dir, fake } = await runFake();
    const files = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8'));
    const haystack = [...lines, ...files].join('\n');
    for (const secret of fake.secrets()) expect(haystack.includes(secret)).toBe(false);
    expect(haystack).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\./);
    for (const name of ['checkpoints.jsonl']) for (const line of readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean)) assertSafe(JSON.parse(line));
    assertSafe(JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')));
  });

  it('resumes from the ledger without repeating finished scenarios', async () => {
    const root = tempRoot();
    const fake = createFakeCadence();
    const first = await runFake({ root, fake, runId: 'resume-run' });
    const authorized = fake.counts.authorize;
    const again = await runFake({ root, fake, runId: 'resume-run', resume: true });
    expect(fake.counts.authorize).toBe(authorized);
    expect(again.checks).toEqual(first.checks);
  });

  it('renders a pass/fail table', () => {
    const text = renderReport({ runId: 'r', target: 'local', checks: [{ scenario: 's', check: 'c', ok: false, detail: 'status=500' }] });
    expect(text).toContain('| s | c | FAIL | status=500 |');
    expect(text).toContain('0/1 checks passed · FAIL');
  });

  it('counts a skipped row as neither passed nor failed', () => {
    const checks = [{ scenario: 's', check: 'a', ok: true }, { scenario: 's', check: 'b', ok: null, skipped: true, detail: 'why' }];
    const text = renderReport({ runId: 'r', target: 'production', checks });
    expect(text).toContain('| s | a | pass |  |');
    expect(text).toContain('| s | b | SKIPPED | why |');
    expect(text).toContain('1/1 checks passed · 1 skipped · PASS');
    const onlySkipped = renderReport({ runId: 'r', target: 'production', checks: checks.slice(1) });
    expect(onlySkipped).toContain('0/0 checks passed · 1 skipped · FAIL');
  });

  it('guards production and local targets', () => {
    expect(() => parseArgs([])).toThrow('target-required');
    expect(() => parseArgs(['--target', 'production'])).toThrow('production-requires-confirm-production');
    expect(() => parseArgs(['--target', 'production', '--confirm-production', '--issuer', ISSUER])).toThrow('production-issuer-fixed');
    expect(() => parseArgs(['--target', 'local', '--issuer', 'https://app.cadence-me.com'])).toThrow('local-issuer-not-loopback');
    expect(() => parseArgs(['--target', 'local', '--resume'])).toThrow('resume-needs-run');
    expect(parseArgs(['--target', 'local'])).toMatchObject({ issuer: ISSUER, callbackPort: 4449, grantHoldMs: 0 });
    expect(parseArgs(['--target', 'production', '--confirm-production'])).toMatchObject({ grantHoldMs: 8000 });
  });

  it('runs its CLI through a symlinked path instead of exiting 0 silently', () => {
    const dir = tempRoot();
    const link = join(dir, 'protocol.mjs');
    symlinkSync(resolve('scripts/acceptance/protocol.mjs'), link);
    const result = spawnSync(process.execPath, [link, '--target', 'bogus'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout.trim())).toEqual({ result: 'usage', error: 'target-required' });
  });
});

const LOCAL_ENV = { CADENCE_LOCAL_SUPABASE_URL: 'http://127.0.0.1:9', CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local-test' };
describe('Ticket 249 local resume', () => {
  // Local test-login creates a new Auth user per sign-in, so a resumed local run
  // cannot get its A and B accounts back. Recorded IDs belong to those accounts.
  it('refuses to resume a local run that recorded work, before any sign-in', async () => {
    const root = tempRoot();
    const first = createRun({ target: 'local', accounts: ['A', 'B'], scenarios: ['protocol'], steps: ['preflight', 'behaviors-a'], runId: 'local-resume', root, gitSha: null });
    await first.step('preflight', async () => ({ ok: true }));
    await first.step('behaviors-a', async () => ({ behaviorId: randomUUID() }));
    first.close();
    const lines = [];
    const code = await main(['--target', 'local', '--run', 'local-resume', '--resume', '--root', root], LOCAL_ENV, (line) => lines.push(JSON.parse(line)));
    expect(code).toBe(1);
    expect(lines).toEqual([
      { result: 'run', runId: 'local-resume', target: 'local' },
      { result: 'stopped', runId: 'local-resume', error: 'local-resume-needs-new-run' },
    ]);
    // The lock is released, so a read-only cleanup view still works.
    const again = resumeRun({ runId: 'local-resume', root });
    expect(again.cleanupInputs()).toEqual({ grants: [], creations: [] });
    again.close();
  }, 90_000);
});
