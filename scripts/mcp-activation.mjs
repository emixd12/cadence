// Ticket 232 step 3: enable (or roll back) MCP on the frozen production web
// deployment. Every write is a single direct Vercel REST attempt, pinned to the
// exact team and project, because the Vercel CLI client retries. Reads fail
// closed. A rejected or ambiguous write is reconciled read-only and never
// repeated. Tokens and response bodies are never logged or stored.

export const ACTIVATION = Object.freeze({
  team: 'team_BxWfRYU1gqrl6Ba6t7Vm3wp1',
  web: 'prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs',
  frozenWeb: 'dpl_AE8GhYkk265Ek9tYdYTEc4bD8EgL',
  frozenMarketing: 'dpl_FxBP12vZPRz3mrdytwCNWrjdXwhj',
  source: 'eb5afa5be5c49b43bbad3ffd5a25d6eddff30079',
  mcpEnv: Object.freeze({ id: 'iBPzBCetdvLWtmSN', key: 'CADENCE_MCP_ENABLED' }),
  bindingEnv: Object.freeze({ id: 'vGVn8afMCddubMpC', key: 'CADENCE_TRUST_MARKETING_DEPLOYMENT_ID' }),
  alias: 'app.cadence-me.com',
  origin: 'https://app.cadence-me.com',
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class Stop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

/**
 * One-attempt Vercel REST client. Every call adds the pinned teamId.
 * GET: { kind: 'ok', json } only for HTTP 200 with a JSON object; otherwise 'failed'.
 * Writes: 'ok' (2xx with a JSON object), 'rejected' (4xx), 'ambiguous' (anything else).
 */
export function createVercelApi({ fetchImpl = fetch, readToken, teamId, timeoutMs = 30_000 }) {
  return async (method, path, body) => {
    let token = null;
    try { token = readToken(); } catch { token = null; }
    if (typeof token !== 'string' || !token) return { kind: method === 'GET' ? 'failed' : 'rejected' };
    const url = `https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`;
    try {
      const response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let json = null;
      if (response.status >= 200 && response.status < 300) { try { json = await response.json(); } catch { json = null; } }
      else { try { await response.body?.cancel(); } catch { /* discard */ } }
      if (method === 'GET') return response.status === 200 && isObject(json) ? { kind: 'ok', json } : { kind: 'failed' };
      if (response.status >= 200 && response.status < 300) return isObject(json) ? { kind: 'ok', json } : { kind: 'ambiguous' };
      return { kind: response.status >= 400 && response.status < 500 ? 'rejected' : 'ambiguous' };
    } catch {
      return { kind: method === 'GET' ? 'failed' : 'ambiguous' };
    } finally {
      token = null;
    }
  };
}

/**
 * @param {object} deps
 * @param {'enable'|'rollback'} deps.mode
 * @param {Function} deps.api createVercelApi result
 * @param {(url: string, init?: object) => Promise<Response>} deps.publicFetch unauthenticated fetch for public endpoints
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @param {(receipt: object) => void} deps.save token-free receipt writer
 * @param {() => boolean} deps.receiptExists
 * @param {() => number} [deps.now]
 */
export async function runActivation({ mode, api, publicFetch, sleep, save, receiptExists, now = () => Date.now(), log = () => {}, config = ACTIVATION, readyDeadlineMs = 20 * 60_000, pollMs = 15_000 }) {
  const receipt = { mode, startedAt: new Date(now()).toISOString(), steps: [] };
  const step = (name, extra = {}) => { receipt.steps.push({ at: new Date(now()).toISOString(), name, ...extra }); save(receipt); };
  const value = mode === 'enable' ? 'true' : 'false';
  let phase = 'start', writeAttempted = false;
  const get = async (name, path) => {
    phase = name;
    const r = await api('GET', path);
    if (r?.kind !== 'ok') throw new Stop(`${name}-unreadable`);
    return r.json;
  };
  const readEnv = async (name, env) => {
    const row = await get(name, `/v1/projects/${config.web}/env/${env.id}?decrypt=true`);
    if (row.id !== env.id || row.key !== env.key || row.type !== 'encrypted' || JSON.stringify(row.target) !== '["production"]' || typeof row.value !== 'string') throw new Stop(`${name}-mismatch`);
    return row.value;
  };
  const deployment = async (name, id) => {
    const d = await get(name, `/v13/deployments/${id}`);
    if (d.id !== id || d.projectId !== config.web || d.target !== 'production' || d.gitSource?.sha !== config.source) throw new Stop(`${name}-mismatch`);
    return d;
  };
  const aliasTarget = async (name) => {
    const a = await get(name, `/v4/aliases/${config.alias}`);
    if (a.alias !== config.alias || a.projectId !== config.web || typeof a.deploymentId !== 'string') throw new Stop(`${name}-mismatch`);
    return a.deploymentId;
  };
  const productionSince = async (name, since) => {
    const list = await get(name, `/v6/deployments?projectId=${config.web}&target=production&since=${since}&limit=20`);
    if (!Array.isArray(list.deployments)) throw new Stop(`${name}-unreadable`);
    return list.deployments.map((d) => ({ id: d.uid, state: d.readyState ?? d.state, createdAt: d.created }));
  };
  const endpoint = async (path, init) => {
    try {
      const r = await publicFetch(`${config.origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init });
      let json = null;
      if (r.headers.get('content-type')?.includes('json')) { try { json = await r.json(); } catch { json = null; } } else { try { await r.body?.cancel(); } catch { /* discard */ } }
      return { status: r.status, challenge: r.headers.get('www-authenticate') ?? '', json };
    } catch { return { status: 0, challenge: '', json: null }; }
  };
  try {
    if (receiptExists()) return { result: 'stopped', reason: 'receipt-exists-reconcile-first' };
    const t0 = now();

    // 1. Preconditions.
    const binding = await readEnv('binding-read', config.bindingEnv);
    if (binding !== config.frozenMarketing) throw new Stop('marketing-binding-mismatch');
    const current = await readEnv('mcp-env-read', config.mcpEnv);
    if (current !== 'true' && current !== 'false') throw new Stop('mcp-env-value-unexpected');
    const base = await deployment('frozen-deployment-read', config.frozenWeb);
    if (base.readyState !== 'READY' || base.name !== 'cadence') throw new Stop('frozen-deployment-not-ready');
    const live = await aliasTarget('alias-read');
    if (mode === 'enable' && (current !== 'false' || live !== config.frozenWeb)) throw new Stop('enable-precondition');
    const mcpBefore = await endpoint('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (mode === 'enable' && mcpBefore.status !== 503) throw new Stop('mcp-not-disabled-before-enable');
    step('preconditions', { marketingBinding: binding, mcpEnv: current, liveAlias: live, frozenWeb: config.frozenWeb, mcpStatus: mcpBefore.status });

    // 2. Set the flag: one PATCH attempt, then an exact decrypted readback.
    if (current !== value) {
      writeAttempted = true;
      phase = 'mcp-env-patch';
      const patched = await api('PATCH', `/v9/projects/${config.web}/env/${config.mcpEnv.id}`, { value });
      if (patched?.kind !== 'ok' || patched.json.id !== config.mcpEnv.id || patched.json.key !== config.mcpEnv.key) {
        let observed = 'unknown';
        try { observed = await readEnv('mcp-env-reconcile', config.mcpEnv); } catch { observed = 'unknown'; }
        step('mcp-env-reconcile', { outcome: patched?.kind === 'rejected' ? 'rejected' : 'ambiguous', observedValue: observed === 'true' || observed === 'false' ? observed : 'unknown' });
        throw new Stop(patched?.kind === 'rejected' ? 'mcp-env-rejected' : 'mcp-env-ambiguous-reconcile');
      }
    }
    const after = await readEnv('mcp-env-readback', config.mcpEnv);
    if (after !== value) throw new Stop('mcp-env-readback-mismatch');
    step('mcp-env-set', { value: after, changed: current !== value });

    // 3. One same-source production redeploy of the frozen deployment.
    writeAttempted = true;
    phase = 'redeploy';
    const created = await api('POST', '/v13/deployments?forceNew=1', { deploymentId: config.frozenWeb, meta: { action: 'redeploy' }, name: base.name, target: 'production' });
    const newId = created?.kind === 'ok' && typeof created.json.id === 'string' && /^dpl_[A-Za-z0-9]+$/.test(created.json.id) && created.json.projectId === config.web ? created.json.id : null;
    if (!newId) {
      let seen = 'unknown';
      try { seen = await productionSince('redeploy-reconcile', t0 - 60_000); } catch { seen = 'unknown'; }
      step('redeploy-reconcile', { outcome: created?.kind === 'rejected' ? 'rejected' : 'ambiguous', productionDeploymentsSinceStart: seen });
      throw new Stop(created?.kind === 'rejected' ? 'redeploy-rejected' : 'redeploy-ambiguous-reconcile');
    }
    step('redeploy-created', { deploymentId: newId, from: config.frozenWeb });
    log(`redeploy ${newId}`);

    // 4. Bounded wait for READY.
    let state = null;
    const deadline = now() + readyDeadlineMs;
    for (;;) {
      const r = await api('GET', `/v13/deployments/${newId}`);
      state = r?.kind === 'ok' ? (r.json.readyState ?? r.json.status ?? null) : null;
      if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') break;
      if (now() >= deadline) break;
      await sleep(pollMs);
    }
    step('ready-wait', { deploymentId: newId, state });
    if (state !== 'READY') throw new Stop(state === 'ERROR' || state === 'CANCELED' ? 'deployment-failed' : 'deployment-not-ready-in-time');

    // 5. Readbacks.
    const d = await deployment('deployment-readback', newId);
    if (d.readyState !== 'READY') throw new Stop('deployment-readback-not-ready');
    const aliasNow = await aliasTarget('alias-readback');
    if (aliasNow !== newId) throw new Stop('alias-not-on-new-deployment');
    const others = await productionSince('production-list', t0 - 60_000);
    if (others.some((x) => x.id !== newId)) throw new Stop('other-production-deployment');
    const bindingAfter = await readEnv('binding-readback', config.bindingEnv);
    if (bindingAfter !== config.frozenMarketing) throw new Stop('marketing-binding-changed');
    const mcp = await endpoint('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const discovery = await endpoint('/.well-known/oauth-authorization-server');
    const resource = await endpoint('/.well-known/oauth-protected-resource/mcp');
    const enabledOk = mcp.status === 401
      && mcp.challenge.includes(`resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp"`)
      && discovery.status === 200 && discovery.json?.issuer === config.origin
      && resource.status === 200 && resource.json?.resource === `${config.origin}/mcp`;
    step('readbacks', { deploymentId: newId, source: d.gitSource.sha, alias: aliasNow, marketingBinding: bindingAfter, mcpStatus: mcp.status, challengeHasResourceMetadata: mcp.challenge.includes('resource_metadata='), discoveryStatus: discovery.status, issuer: discovery.json?.issuer ?? null, resourceStatus: resource.status, resource: resource.json?.resource ?? null });
    if (mode === 'enable' && !enabledOk) throw new Stop('enabled-endpoint-mismatch');
    if (mode === 'rollback' && mcp.status !== 503) throw new Stop('disabled-endpoint-mismatch');
    step('complete', { deploymentId: newId });
    log('complete');
    return { result: 'complete', mode, deploymentId: newId };
  } catch (error) {
    const reason = error instanceof Stop ? error.reason : `${phase}-internal-error`;
    try { step('stopped', { reason, phase, writeAttempted }); } catch { /* receipt write failed */ }
    log(`stopped ${reason}`);
    return { result: 'stopped', reason };
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'enable' && mode !== 'rollback') { process.stdout.write('{"result":"stopped","reason":"mode"}\n'); process.exit(1); }
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const out = `.intent/artifacts/trust232/extension-execution/step3-activation-${mode}.json`;
  const readToken = () => {
    const auth = JSON.parse(readFileSync(`${homedir()}/Library/Application Support/com.vercel.cli/auth.json`, 'utf8'));
    return typeof auth.expiresAt === 'number' && auth.expiresAt * 1000 > Date.now() + 30 * 60_000 ? auth.token : null;
  };
  const result = await runActivation({
    mode,
    api: createVercelApi({ readToken, teamId: ACTIVATION.team }),
    publicFetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    save: (receipt) => writeFileSync(out, JSON.stringify(receipt, null, 2), { mode: 0o600 }),
    receiptExists: () => existsSync(out),
    log: (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.result === 'complete' ? 0 : 1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stdout.write('{"result":"stopped","reason":"main-internal-error"}\n'); process.exit(1); });
}
