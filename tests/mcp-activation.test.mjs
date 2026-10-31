import { describe, expect, it } from 'vitest';
import { request, createServer } from 'node:http';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { runActivation, createVercelApi, ACTIVATION } from '../scripts/mcp-activation.mjs';
import { runGate, judgeBehaviors, createListBehaviors, GATE } from '../scripts/mcp-activation-gate.mjs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const NEW = 'dpl_NewActivation123';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function world(o = {}) {
  const calls = [], saves = [], logs = [];
  let mcpValue = o.mcpValue ?? 'false', binding = o.binding ?? ACTIVATION.frozenMarketing, alias = o.alias ?? ACTIVATION.frozenWeb;
  let created = false, polls = 0, clock = 1_800_000_000_000;
  const env = (id, key, value) => ({ id, key, type: 'encrypted', target: ['production'], value });
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith(`/v1/projects/${ACTIVATION.web}/env/${ACTIVATION.bindingEnv.id}`)) return { kind: 'ok', json: env(ACTIVATION.bindingEnv.id, ACTIVATION.bindingEnv.key, binding) };
    if (method === 'GET' && path.startsWith(`/v1/projects/${ACTIVATION.web}/env/${ACTIVATION.mcpEnv.id}`)) return { kind: 'ok', json: env(ACTIVATION.mcpEnv.id, ACTIVATION.mcpEnv.key, o.readbackValue && calls.filter((c) => c.method === 'PATCH').length ? o.readbackValue : mcpValue) };
    if (method === 'GET' && path === `/v13/deployments/${ACTIVATION.frozenWeb}`) return { kind: 'ok', json: { id: ACTIVATION.frozenWeb, name: 'cadence', projectId: ACTIVATION.web, target: 'production', readyState: 'READY', gitSource: { sha: ACTIVATION.source } } };
    if (method === 'GET' && path === `/v13/deployments/${NEW}`) {
      polls += 1;
      const state = o.finalState && polls >= 2 ? o.finalState : polls >= 2 ? 'READY' : 'BUILDING';
      return { kind: 'ok', json: { id: NEW, name: 'cadence', projectId: ACTIVATION.web, target: 'production', readyState: o.neverReady ? 'BUILDING' : state, gitSource: { sha: o.newSha ?? ACTIVATION.source } } };
    }
    if (method === 'GET' && path === `/v4/aliases/${ACTIVATION.alias}`) return { kind: 'ok', json: { alias: ACTIVATION.alias, projectId: ACTIVATION.web, deploymentId: created && !o.aliasStuck ? NEW : alias } };
    if (method === 'GET' && path.startsWith('/v6/deployments')) return { kind: 'ok', json: { deployments: [...(created ? [{ uid: NEW, readyState: 'READY', created: clock }] : []), ...(o.otherDeploy ? [{ uid: 'dpl_Other', readyState: 'READY', created: clock }] : [])] } };
    if (method === 'PATCH') {
      if (o.patchKind && o.patchKind !== 'ok') return { kind: o.patchKind };
      mcpValue = body.value;
      return { kind: 'ok', json: { id: ACTIVATION.mcpEnv.id, key: ACTIVATION.mcpEnv.key } };
    }
    if (method === 'POST') {
      if (o.postKind && o.postKind !== 'ok') return { kind: o.postKind };
      created = true;
      if (o.bindingChangesOnDeploy) binding = 'dpl_Changed';
      return { kind: 'ok', json: { id: NEW, projectId: o.postProject ?? ACTIVATION.web } };
    }
    return { kind: 'failed' };
  };
  const publicFetch = async (url, init = {}) => {
    calls.push({ method: init.method ?? 'GET', public: url });
    const enabled = (created && mcpValue === 'true' && !o.endpointStillDisabled) || (created && o.endpointStillEnabled);
    if (url.endsWith('/.well-known/oauth-protected-resource/mcp')) return enabled ? json(200, { resource: `${ACTIVATION.origin}/mcp` }) : json(503, {});
    if (url.endsWith('/mcp')) return enabled ? new Response('{}', { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${ACTIVATION.origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"` } }) : new Response('{}', { status: o.mcpBefore ?? 503, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/.well-known/oauth-authorization-server')) return enabled ? json(200, { issuer: ACTIVATION.origin }) : json(503, {});
    return json(404, {});
  };
  const deps = {
    mode: o.mode ?? 'enable', api, publicFetch, save: (r) => saves.push(JSON.stringify(r)), receiptExists: () => Boolean(o.receiptExists),
    sleep: async (ms) => { clock += ms; }, now: () => clock, log: (l) => logs.push(l), pollMs: 15_000, readyDeadlineMs: o.deadline ?? 600_000,
  };
  return { calls, saves, logs, deps, writes: () => calls.filter((c) => c.method === 'PATCH' || (c.method === 'POST' && !c.public)) };
}

describe('Ticket 232 activation', () => {
  it('enables with one PATCH and one redeploy, then reads everything back', async () => {
    const w = world();
    expect(await runActivation(w.deps)).toEqual({ result: 'complete', mode: 'enable', deploymentId: NEW });
    const writes = w.writes();
    expect(writes.map((c) => [c.method, c.path])).toEqual([['PATCH', `/v9/projects/${ACTIVATION.web}/env/${ACTIVATION.mcpEnv.id}`], ['POST', '/v13/deployments?forceNew=1']]);
    expect(writes[0].body).toEqual({ value: 'true' });
    expect(writes[1].body).toEqual({ deploymentId: ACTIVATION.frozenWeb, meta: { action: 'redeploy' }, name: 'cadence', target: 'production' });
    const steps = JSON.parse(w.saves.at(-1)).steps.map((s) => s.name);
    expect(steps).toEqual(['preconditions', 'mcp-env-set', 'redeploy-created', 'ready-wait', 'readbacks', 'complete']);
    expect(JSON.parse(w.saves.at(-1)).steps.find((s) => s.name === 'readbacks')).toMatchObject({ mcpStatus: 401, challengeHasResourceMetadata: true, issuer: ACTIVATION.origin, alias: NEW, marketingBinding: ACTIVATION.frozenMarketing });
  });

  it('rolls back with value false and requires a disabled endpoint', async () => {
    const w = world({ mode: 'rollback', mcpValue: 'true', alias: NEW });
    expect(await runActivation(w.deps)).toEqual({ result: 'complete', mode: 'rollback', deploymentId: NEW });
    expect(w.writes()[0].body).toEqual({ value: 'false' });
  });

  it('still rolls back when binding, alias or other deployments drifted, and records them', async () => {
    const w = world({ mode: 'rollback', mcpValue: 'true', alias: 'dpl_Elsewhere', binding: 'dpl_Wrong', otherDeploy: true });
    expect(await runActivation(w.deps)).toEqual({ result: 'complete', mode: 'rollback', deploymentId: NEW });
    expect(w.writes().map((c) => [c.method, c.body?.value ?? null])).toEqual([['PATCH', 'false'], ['POST', null]]);
    const steps = JSON.parse(w.saves.at(-1)).steps;
    expect(steps.find((x) => x.name === 'preconditions')).toMatchObject({ marketingBinding: 'dpl_Wrong', liveAlias: 'dpl_Elsewhere' });
    expect(steps.find((x) => x.name === 'readbacks')).toMatchObject({ marketingBinding: 'dpl_Wrong', otherProductionDeployments: ['dpl_Other'], mcpStatus: 503 });
  });

  it('fails a rollback whose endpoint still answers as enabled', async () => {
    const w = world({ mode: 'rollback', mcpValue: 'true', alias: NEW, endpointStillEnabled: true });
    expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason: 'disabled-endpoint-mismatch' });
  });

  it('rolls back even when the alias cannot be read before the redeploy', async () => {
    const w = world({ mode: 'rollback', mcpValue: 'true', alias: NEW });
    const base = w.deps.api;
    let posted = false;
    w.deps.api = async (method, path, body) => {
      if (method === 'POST') posted = true;
      return path === `/v4/aliases/${ACTIVATION.alias}` && !posted ? { kind: 'failed' } : base(method, path, body);
    };
    expect(await runActivation(w.deps)).toMatchObject({ result: 'complete', mode: 'rollback' });
    expect(JSON.parse(w.saves.at(-1)).steps.find((x) => x.name === 'preconditions')).toMatchObject({ liveAlias: 'unknown' });
  });

  it('rolls back even when the binding cannot be read', async () => {
    const w = world({ mode: 'rollback', mcpValue: 'true', alias: NEW });
    const base = w.deps.api;
    w.deps.api = async (method, path, body) => (path.includes(ACTIVATION.bindingEnv.id) ? { kind: 'failed' } : base(method, path, body));
    expect(await runActivation(w.deps)).toMatchObject({ result: 'complete', mode: 'rollback' });
  });

  it('never skips the exact flag record guard in rollback', async () => {
    const w = world({ mode: 'rollback', mcpValue: 'true' });
    const base = w.deps.api;
    w.deps.api = async (method, path, body) => (path.includes(ACTIVATION.mcpEnv.id) && method === 'GET' ? { kind: 'ok', json: { id: ACTIVATION.mcpEnv.id, key: ACTIVATION.mcpEnv.key, type: 'encrypted', target: ['production', 'preview'], value: 'true' } } : base(method, path, body));
    expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason: 'mcp-env-read-mismatch' });
    expect(w.writes()).toHaveLength(0);
  });

  const preStops = [
    ['an existing receipt', { receiptExists: true }, 'receipt-exists-reconcile-first'],
    ['a different marketing binding', { binding: 'dpl_Wrong' }, 'marketing-binding-mismatch'],
    ['MCP already enabled', { mcpValue: 'true' }, 'enable-precondition'],
    ['an unexpected flag value', { mcpValue: 'yes' }, 'mcp-env-value-unexpected'],
    ['the live alias off the frozen deployment', { alias: 'dpl_Elsewhere' }, 'enable-precondition'],
    ['MCP answering before enable', { mcpBefore: 401 }, 'mcp-not-disabled-before-enable'],
  ];
  for (const [label, o, reason] of preStops) {
    it(`stops before any write on ${label}`, async () => {
      const w = world(o);
      expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason });
      expect(w.writes()).toHaveLength(0);
    });
  }

  it('reconciles a rejected or ambiguous flag write read-only and never redeploys or repeats it', async () => {
    for (const [patchKind, reason] of [['rejected', 'mcp-env-rejected'], ['ambiguous', 'mcp-env-ambiguous-reconcile']]) {
      const w = world({ patchKind });
      expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason });
      expect(w.writes().map((c) => c.method)).toEqual(['PATCH']);
      expect(JSON.parse(w.saves.at(-1)).steps.find((s) => s.name === 'mcp-env-reconcile')).toMatchObject({ outcome: patchKind, observedValue: 'false' });
    }
  });

  it('stops without redeploying when the flag readback differs', async () => {
    const w = world({ readbackValue: 'false' });
    expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason: 'mcp-env-readback-mismatch' });
    expect(w.writes().map((c) => c.method)).toEqual(['PATCH']);
  });

  it('reconciles a rejected, ambiguous or unproven redeploy by listing and never re-posts', async () => {
    for (const [o, reason] of [[{ postKind: 'rejected' }, 'redeploy-rejected'], [{ postKind: 'ambiguous' }, 'redeploy-ambiguous-reconcile'], [{ postProject: 'prj_other' }, 'redeploy-ambiguous-reconcile']]) {
      const w = world(o);
      expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason });
      expect(w.writes().map((c) => c.method)).toEqual(['PATCH', 'POST']);
      expect(JSON.parse(w.saves.at(-1)).steps.some((s) => s.name === 'redeploy-reconcile')).toBe(true);
    }
  });

  it('stops on a failed or slow build', async () => {
    for (const [o, reason] of [[{ finalState: 'ERROR' }, 'deployment-failed'], [{ neverReady: true, deadline: 60_000 }, 'deployment-not-ready-in-time']]) {
      const w = world(o);
      expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason });
    }
  });

  it('stops when readbacks disagree', async () => {
    for (const [o, reason] of [
      [{ aliasStuck: true }, 'alias-not-on-new-deployment'], [{ otherDeploy: true }, 'other-production-deployment'],
      [{ bindingChangesOnDeploy: true }, 'marketing-binding-changed'], [{ endpointStillDisabled: true }, 'enabled-endpoint-mismatch'],
      [{ newSha: 'f'.repeat(40) }, 'deployment-readback-mismatch'],
    ]) {
      const w = world(o);
      expect(await runActivation(w.deps)).toEqual({ result: 'stopped', reason });
      expect(w.writes().map((c) => c.method)).toEqual(['PATCH', 'POST']);
    }
  });

  it('maps adapter exceptions to a phase code', async () => {
    const w = world();
    w.deps.api = async () => { throw new Error('secret-detail'); };
    const r = await runActivation(w.deps);
    expect(r.result).toBe('stopped');
    expect(r.reason).toMatch(/internal-error$/);
    expect(JSON.stringify(w.saves)).not.toContain('secret-detail');
  });
});

describe('Ticket 232 one-attempt Vercel API client', () => {
  const make = (behaviour, token = 'tok') => {
    const seen = [];
    const fetchImpl = (url, init) => {
      seen.push({ url, init });
      if (behaviour === 'reset') return Promise.reject(new TypeError('fetch failed'));
      if (behaviour === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      if (behaviour === '5xx') return Promise.resolve(json(502, {}));
      if (behaviour === '4xx') return Promise.resolve(json(409, {}));
      if (behaviour === 'array') return Promise.resolve(json(200, []));
      if (behaviour === '201') return Promise.resolve(json(201, { id: 'x' }));
      if (behaviour === 'text') return Promise.resolve(new Response('ok', { status: 200 }));
      return Promise.resolve(json(200, { id: 'x' }));
    };
    return { api: createVercelApi({ fetchImpl, readToken: () => token, teamId: 'team_x', timeoutMs: 30 }), seen };
  };
  for (const [behaviour, method, kind] of [
    ['reset', 'PATCH', 'ambiguous'], ['hang', 'POST', 'ambiguous'], ['5xx', 'POST', 'ambiguous'], ['4xx', 'PATCH', 'rejected'], ['text', 'POST', 'ambiguous'], ['ok', 'PATCH', 'ok'],
    ['reset', 'GET', 'failed'], ['5xx', 'GET', 'failed'], ['201', 'GET', 'failed'], ['201', 'POST', 'ok'], ['array', 'GET', 'failed'], ['text', 'GET', 'failed'], ['ok', 'GET', 'ok'],
  ]) {
    it(`${method} ${behaviour} is one attempt and ${kind}`, async () => {
      const m = make(behaviour);
      expect((await m.api(method, '/v9/x?y=1', method === 'GET' ? undefined : { v: 1 })).kind).toBe(kind);
      expect(m.seen).toHaveLength(1);
      expect(m.seen[0].url).toBe('https://api.vercel.com/v9/x?y=1&teamId=team_x');
      expect(m.seen[0].init).toMatchObject({ method, redirect: 'error' });
      expect(m.seen[0].init.headers.Authorization).toBe('Bearer tok');
    });
  }
  it('makes no call without a credential', async () => {
    const m = make('ok', '');
    expect((await m.api('PATCH', '/v9/x', {})).kind).toBe('rejected');
    expect((await m.api('GET', '/v9/x')).kind).toBe('failed');
    expect(m.seen).toHaveLength(0);
  });
});

describe('Ticket 232 activation gate', () => {
  const A = { structuredContent: { behaviors: GATE.aOwned.map((id) => ({ id })) } };
  it('judges list_behaviors results', () => {
    expect(judgeBehaviors(A)).toMatchObject({ pass: true });
    expect(judgeBehaviors({ structuredContent: { behaviors: [...A.structuredContent.behaviors, { id: GATE.bBehaviors[0] }] } })).toMatchObject({ pass: false, reason: 'cross-account-data' });
    expect(judgeBehaviors({ structuredContent: { behaviors: [{ id: GATE.aRequired[0] }] } })).toMatchObject({ pass: false, reason: 'own-data-missing' });
    expect(judgeBehaviors({ structuredContent: { behaviors: GATE.aRequired.map((id) => ({ id })) } })).toMatchObject({ pass: true });
    expect(judgeBehaviors({ isError: true, structuredContent: { behaviors: GATE.aOwned.map((id) => ({ id })) } })).toMatchObject({ pass: false, reason: 'unreadable-result' });
    expect(judgeBehaviors({ structuredContent: { behaviors: [...A.structuredContent.behaviors, { id: '00000000-0000-4000-8000-000000000000' }] } })).toMatchObject({ pass: false, reason: 'unknown-data' });
    expect(judgeBehaviors({ structuredContent: { behaviors: [...GATE.aRequired, GATE.aRequired[0]].map((id) => ({ id })) } })).toMatchObject({ pass: false, reason: 'duplicate-data' });
    expect(GATE.ports).toEqual([4321, 4322, 4323, 4324, 4325, 4326, 4327, 4328, 4329, 4330]);
    expect(judgeBehaviors({ structuredContent: {} })).toMatchObject({ pass: false, reason: 'unreadable-result' });
    expect(judgeBehaviors(null)).toMatchObject({ pass: false });
  });

  const realFree = (p) => Promise.all(['127.0.0.1', '::1'].map((h) => new Promise((resolve) => {
    const c = connect({ host: h, port: p }); c.setTimeout(500, () => { c.destroy(); resolve(true); });
    c.on('connect', () => { c.destroy(); resolve(false); }); c.on('error', () => resolve(true));
  }))).then((r) => r.every(Boolean));
  const harness = (o = {}) => {
    const seen = [], logs = [];
    let announced;
    const ready = new Promise((r) => { announced = r; });
    let tokenGate = null;
    if (o.holdToken) { let release; const held = new Promise((r) => { release = r; }); tokenGate = { held, release }; }
    const fetchImpl = async (url, init = {}) => {
      seen.push({ url, init });
      if (url.endsWith('/.well-known/oauth-authorization-server')) return json(200, { issuer: o.issuer ?? GATE.origin, authorization_endpoint: `${GATE.origin}/oauth/authorize`, token_endpoint: `${GATE.origin}/oauth/token`, registration_endpoint: `${GATE.origin}/oauth/register` });
      if (url.endsWith('/oauth/register')) return o.regFail ? json(400, {}) : json(201, { client_id: 'client-gate' });
      if (url.endsWith('/oauth/token')) {
        if (tokenGate) { tokenGate.signal = init.signal; await tokenGate.held; }
        return o.tokenFail ? json(400, { error: 'invalid_grant' }) : json(200, { access_token: 'access-secret', token_type: 'Bearer', scope: 'cadence.read' });
      }
      return json(404, {});
    };
    const gate = { ...GATE, ports: o.ports ?? GATE.ports };
    const tokensSeen = [];
    const promise = runGate({ fetchImpl, gate, isFree: o.isFree ?? realFree, log: (l) => logs.push(l), announce: (u) => announced(u), timeoutMs: o.timeoutMs ?? 5_000,
      callListBehaviors: async (t) => { tokensSeen.push(t); if (o.mcpThrows) throw new Error('boom'); return o.result ?? A; } });
    return { promise, ready, seen, logs, tokensSeen, gate, tokenGate };
  };
  const get = (p, path, host) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: p, path, headers: { host: host ?? `127.0.0.1:${p}` } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    req.on('error', reject); req.end();
  });
  const authorize = async (h) => {
    const start = await h.ready;
    const p = Number(new URL(start).port);
    const redirect = await get(p, '/');
    return { p, url: new URL(redirect.headers.location) };
  };

  it('passes on A-owned data with PKCE, one registration and one token exchange', async () => {
    const h = harness();
    const { p, url } = await authorize(h);
    expect(`${url.origin}${url.pathname}`).toBe(`${GATE.origin}/oauth/authorize`);
    expect(GATE.ports).toContain(p);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: 'client-gate', redirect_uri: `http://127.0.0.1:${p}/callback`, scope: 'cadence.read', code_challenge_method: 'S256', resource: GATE.resource });
    expect((await get(p, '/', 'evil.example')).status).toBe(421);
    const cb = await get(p, `/callback?code=c1&state=${url.searchParams.get('state')}`);
    expect(cb.body).toContain('gate: passed');
    expect(await h.promise).toMatchObject({ result: 'passed', reason: 'a-owned-data', clientId: 'client-gate', scope: 'cadence.read' });
    const reg = h.seen.filter((s) => s.url.endsWith('/oauth/register'));
    expect(reg).toHaveLength(1);
    expect(JSON.parse(reg[0].init.body)).toMatchObject({ application_type: 'native', token_endpoint_auth_method: 'none', redirect_uris: [`http://127.0.0.1:${p}/callback`], scope: 'cadence.read' });
    const tok = h.seen.filter((s) => s.url.endsWith('/oauth/token'));
    expect(tok).toHaveLength(1);
    const form = new URLSearchParams(tok[0].init.body);
    expect(createHash('sha256').update(form.get('code_verifier')).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    expect(form.get('resource')).toBe(GATE.resource);
    expect(h.tokensSeen).toEqual(['access-secret']);
    expect(JSON.stringify(h.logs)).not.toContain('access-secret');
    expect(JSON.stringify(await h.promise)).not.toContain('access-secret');
  });

  it('fails closed on state mismatch, token failure, cross-account data or an MCP error', async () => {
    for (const [o, badState, reason] of [[{}, true, 'callback'], [{ tokenFail: true }, false, 'token-exchange'], [{ result: { structuredContent: { behaviors: [...A.structuredContent.behaviors, { id: GATE.bBehaviors[1] }] } } }, false, 'cross-account-data'], [{ result: { structuredContent: { behaviors: [...A.structuredContent.behaviors, { id: '00000000-0000-4000-8000-000000000000' }] } } }, false, 'unknown-data'], [{ mcpThrows: true }, false, 'mcp-call-failed']]) {
      const h = harness(o);
      const { p, url } = await authorize(h);
      const cb = await get(p, `/callback?code=c1&state=${badState ? 'forged' : url.searchParams.get('state')}`);
      expect(cb.body).toContain('gate: failed');
      expect(await h.promise).toMatchObject({ result: 'failed', reason });
    }
  });

  it('stops before registering on a discovery mismatch, and on registration failure', async () => {
    const h1 = harness({ issuer: 'https://evil.example' });
    expect(await h1.promise).toMatchObject({ result: 'failed', reason: 'discovery' });
    expect(h1.seen.some((s) => s.url.endsWith('/oauth/register'))).toBe(false);
    const h2 = harness({ regFail: true });
    expect(await h2.promise).toMatchObject({ result: 'failed', reason: 'registration' });
  });

  it('times out without a callback', async () => {
    const h = harness({ timeoutMs: 50 });
    expect(await h.promise).toMatchObject({ result: 'failed', reason: 'timeout' });
  });

  it('stops all work at the deadline, even with a token exchange in flight', async () => {
    const h = harness({ holdToken: true, timeoutMs: 400 });
    const { p, url } = await authorize(h);
    const pending = get(p, `/callback?code=c1&state=${url.searchParams.get('state')}`).catch(() => null);
    const result = await h.promise;
    expect(result).toMatchObject({ result: 'failed', reason: 'timeout', clientId: 'client-gate' });
    h.tokenGate.release();
    await pending;
    await new Promise((r) => setTimeout(r, 50));
    expect(h.tokenGate.signal.aborted).toBe(true);
    expect(h.tokensSeen).toEqual([]);
    expect(h.logs).not.toContain('gate-passed');
    expect(h.logs).toContain('gate-timeout');
  });

  it('binds before registering and skips a port that is taken', async () => {
    const blocker = createServer();
    const taken = await new Promise((resolve, reject) => {
      const tryPort = (i) => {
        const onListening = () => { blocker.off('error', onError); resolve(GATE.ports[i]); };
        const onError = (error) => {
          blocker.off('listening', onListening);
          if (error.code === 'EADDRINUSE' && i > 0) tryPort(i - 1);
          else reject(error);
        };
        blocker.once('error', onError);
        blocker.once('listening', onListening);
        blocker.listen(GATE.ports[i], '127.0.0.1');
      };
      tryPort(GATE.ports.length - 1);
    });
    try {
      const only = harness({ ports: [taken], isFree: async () => true });
      expect(await only.promise).toMatchObject({ result: 'failed', reason: 'no-free-port', clientId: null });
      expect(only.seen.some((x) => x.url.endsWith('/oauth/register'))).toBe(false);
      const free = GATE.ports.slice(0, 9).reverse();
      let next = null;
      for (const candidate of free) if (await realFree(candidate)) { next = candidate; break; }
      const skip = harness({ ports: [taken, next], isFree: async () => true, regFail: true });
      expect(await skip.promise).toMatchObject({ result: 'failed', reason: 'registration', port: next });
      expect(skip.seen.filter((x) => x.url.endsWith('/oauth/register'))).toHaveLength(1);
    } finally { blocker.close(); }
  });

  const listening = (p) => new Promise((resolve) => { const c = connect({ host: '127.0.0.1', port: p }); c.on('connect', () => { c.destroy(); resolve(true); }); c.on('error', () => resolve(false)); });
  const freePort = async (from = GATE.ports.length - 1) => { for (let i = from; i >= 0; i -= 1) if (await realFree(GATE.ports[i])) return GATE.ports[i]; return null; };

  it('never binds after the deadline when the port check is still pending', async () => {
    const p = await freePort();
    let release, entered;
    const held = new Promise((r) => { release = r; });
    const started = new Promise((r) => { entered = r; });
    const h = harness({ ports: [p], timeoutMs: 60, isFree: async () => { entered(); await held; return true; } });
    await started;
    expect(await h.promise).toMatchObject({ result: 'failed', reason: 'timeout' });
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(await listening(p)).toBe(false);
    expect(h.seen.filter((x) => x.url.endsWith('/oauth/register'))).toHaveLength(0);
  });

  it('routes external termination through the same cleanup', async () => {
    const terminate = new AbortController();
    const seen = [];
    let announced;
    const ready = new Promise((r) => { announced = r; });
    const promise = runGate({ signal: terminate.signal, isFree: realFree, announce: (u) => announced(u), timeoutMs: 5_000, callListBehaviors: async () => A,
      fetchImpl: async (url) => { seen.push(url); return url.endsWith('/oauth/register') ? json(201, { client_id: 'client-gate' }) : json(200, { issuer: GATE.origin, authorization_endpoint: `${GATE.origin}/oauth/authorize`, token_endpoint: `${GATE.origin}/oauth/token`, registration_endpoint: `${GATE.origin}/oauth/register` }); } });
    const start = await ready;
    const p = Number(new URL(start).port);
    terminate.abort();
    expect(await promise).toMatchObject({ result: 'failed', reason: 'interrupted', clientId: 'client-gate', port: p });
    await new Promise((r) => setTimeout(r, 30));
    expect(await listening(p)).toBe(false);
    const before = await runGate({ signal: AbortSignal.abort(), isFree: realFree, announce: () => {}, callListBehaviors: async () => A, fetchImpl: async (url) => { seen.push(url); return json(500, {}); } });
    expect(before).toMatchObject({ result: 'failed', reason: 'interrupted', clientId: null });
  });

  it('cancels the real MCP SDK request when the deadline fires', async () => {
    const p = await freePort();
    let requestAborted = false, gotRequest;
    const received = new Promise((r) => { gotRequest = r; });
    const server = createServer((req, res) => { gotRequest(); req.on('close', () => { if (!res.writableEnded) requestAborted = true; }); });
    await new Promise((r) => server.listen(p, '127.0.0.1', r));
    try {
      const call = createListBehaviors(Client, StreamableHTTPClientTransport, { ...GATE, resource: `http://127.0.0.1:${p}/mcp` });
      const deadline = new AbortController();
      let settled = false;
      const pending = call('synthetic-token', deadline.signal).then(() => 'resolved', () => 'rejected').finally(() => { settled = true; });
      await received;
      deadline.abort();
      expect(await pending).toBe('rejected');
      expect(settled).toBe(true);
      await new Promise((r) => setTimeout(r, 100));
      expect(requestAborted).toBe(true);
    } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  });

  it('passes the signal through callTool options and closes the client on abort', async () => {
    const events = [];
    let release;
    class FakeClient {
      constructor() { events.push('new'); }
      async connect() { events.push('connect'); }
      callTool(params, options) { events.push(['callTool', params.name, options?.signal instanceof AbortSignal]); return new Promise((r) => { release = r; }); }
      async close() { events.push('close'); }
    }
    class FakeTransport { constructor(url, opts) { events.push(['transport', String(url), Boolean(opts.requestInit.headers.Authorization)]); } }
    const deadline = new AbortController();
    const pending = createListBehaviors(FakeClient, FakeTransport)('t', deadline.signal).then(() => 'resolved', () => 'rejected');
    await new Promise((r) => setTimeout(r, 10));
    deadline.abort();
    expect(await pending).toBe('rejected');
    expect(events).toContainEqual(['callTool', 'list_behaviors', true]);
    expect(events.filter((e) => e === 'close').length).toBeGreaterThanOrEqual(1);
    release?.({});
    const constructed = events.filter((e) => e === 'new').length;
    await expect(createListBehaviors(FakeClient, FakeTransport)('t', AbortSignal.abort())).rejects.toThrow('aborted');
    expect(events.filter((e) => e === 'new').length).toBe(constructed);
  });
});
