// Ticket 232 activation signer gate. Right after the activation redeploy,
// account A authorizes one public loopback OAuth client (PKCE, cadence.read).
// The gate then makes ONE list_behaviors call. It passes only when the result
// holds A's fixture Behaviors and none of B's, which proves that the deployed
// server minted a working integration token with the stored signing key.
// Tokens, codes and the PKCE verifier stay in memory and are never logged.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export const GATE = Object.freeze({
  origin: 'https://app.cadence-me.com',
  resource: 'https://app.cadence-me.com/mcp',
  scope: 'cadence.read',
  ports: Object.freeze([4323, 4324, 4325, 4326, 4327, 4328, 4329, 4330]),
  aBehaviors: Object.freeze(['b2c5b6b1-457a-4e58-a14f-e4270c3d341e', '86f7de46-3eba-46ac-9735-41e1f5a489a6']),
  bBehaviors: Object.freeze(['1b16ebc8-8495-4a51-a0b2-9f4f4b4c7732', 'ffc64890-9afc-4bf2-9e1d-43d787cb18d4', '418a8c1c-7d9d-4588-af04-78307d453c5d']),
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const page = (text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cadence activation gate</title></head><body><p>${text}</p></body></html>`;

/** Pure check of a list_behaviors result. */
export function judgeBehaviors(result, gate = GATE) {
  if (!isObject(result) || result.isError === true || !isObject(result.structuredContent) || !Array.isArray(result.structuredContent.behaviors)) return { pass: false, reason: 'unreadable-result' };
  const ids = result.structuredContent.behaviors.map((b) => (isObject(b) ? b.id : null));
  if (!ids.every((id) => typeof id === 'string')) return { pass: false, reason: 'unreadable-result' };
  if (gate.bBehaviors.some((id) => ids.includes(id))) return { pass: false, reason: 'cross-account-data' };
  if (!gate.aBehaviors.every((id) => ids.includes(id))) return { pass: false, reason: 'own-data-missing' };
  return { pass: true, reason: 'a-owned-data', count: ids.length };
}

/**
 * @param {object} deps
 * @param {(url: string, init?: object) => Promise<Response>} deps.fetchImpl single-attempt fetch
 * @param {(token: string) => Promise<object>} deps.callListBehaviors MCP tools/call with the bearer token
 * @param {(port: number) => Promise<boolean>} deps.isFree
 * @param {(line: string) => void} [deps.log] fixed event names only
 * @param {(origin: string) => void} deps.announce receives only the loopback start URL
 */
export async function runGate({ fetchImpl = fetch, callListBehaviors, isFree, log = () => {}, announce, gate = GATE, timeoutMs = 20 * 60_000 }) {
  const once = async (url, init) => {
    try { return await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), ...init }); } catch { return null; }
  };
  const json = async (r) => { if (!r || r.status < 200 || r.status >= 300) return null; try { const j = await r.json(); return isObject(j) ? j : null; } catch { return null; } };

  const meta = await json(await once(`${gate.origin}/.well-known/oauth-authorization-server`));
  const under = (u) => typeof u === 'string' && u.startsWith(`${gate.origin}/`);
  if (!meta || meta.issuer !== gate.origin || !under(meta.authorization_endpoint) || !under(meta.token_endpoint) || !under(meta.registration_endpoint)) return { result: 'failed', reason: 'discovery' };

  let port = null;
  for (const p of gate.ports) if (await isFree(p)) { port = p; break; }
  if (!port) return { result: 'failed', reason: 'no-free-port' };
  const host = `127.0.0.1:${port}`;
  const redirectUri = `http://${host}/callback`;

  const reg = await once(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    client_name: 'Cadence Ticket 232 activation gate', redirect_uris: [redirectUri], application_type: 'native',
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], scope: gate.scope,
  }) });
  const client = await json(reg);
  if (!client || typeof client.client_id !== 'string' || !client.client_id) return { result: 'failed', reason: 'registration' };
  const clientId = client.client_id;

  const state = b64url(randomBytes(32));
  let verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const authorizeUrl = `${meta.authorization_endpoint}?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: gate.scope, state, code_challenge: challenge, code_challenge_method: 'S256', resource: gate.resource })}`;

  return new Promise((resolve) => {
    let settled = false, used = false;
    const finish = (value) => { if (settled) return; settled = true; verifier = null; clearTimeout(timer); server.close(); server.closeAllConnections?.(); resolve({ ...value, clientId, port }); };
    const reply = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'", ...headers }); res.end(body); };
    const server = createServer(async (req, res) => {
      if (req.headers.host !== host) return reply(res, 421, page('Wrong host.'));
      if (req.method !== 'GET') return reply(res, 405, page('Method not allowed.'));
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname === '/') return reply(res, 303, '', { location: authorizeUrl });
      if (url.pathname !== '/callback') return reply(res, 404, page('Not found.'));
      if (used) return reply(res, 409, page('Already used.'));
      used = true;
      if (url.searchParams.get('state') !== state || !url.searchParams.get('code') || url.searchParams.has('error')) {
        reply(res, 400, page('gate: failed'));
        log('callback-rejected');
        return finish({ result: 'failed', reason: 'callback' });
      }
      const tokenResponse = await once(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
        grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: gate.resource,
      }).toString() });
      const tokens = await json(tokenResponse);
      let access = tokens && typeof tokens.access_token === 'string' ? tokens.access_token : null;
      if (!access) { reply(res, 502, page('gate: failed')); log('token-failed'); return finish({ result: 'failed', reason: 'token-exchange' }); }
      let verdict;
      try { verdict = judgeBehaviors(await callListBehaviors(access)); } catch { verdict = { pass: false, reason: 'mcp-call-failed' }; }
      access = null;
      reply(res, 200, page(verdict.pass ? 'gate: passed' : 'gate: failed'));
      log(verdict.pass ? 'gate-passed' : `gate-failed ${verdict.reason}`);
      return finish({ result: verdict.pass ? 'passed' : 'failed', reason: verdict.reason, behaviors: verdict.count ?? null, scope: typeof tokens.scope === 'string' ? tokens.scope : null });
    });
    server.headersTimeout = 5_000;
    server.requestTimeout = 120_000;
    const timer = setTimeout(() => { log('gate-timeout'); finish({ result: 'failed', reason: 'timeout' }); }, timeoutMs);
    server.listen(port, '127.0.0.1', () => { log(`listening ${port}`); announce(`http://${host}/`); });
  });
}

async function main() {
  const { writeFileSync, existsSync } = await import('node:fs');
  const { connect } = await import('node:net');
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const out = '.intent/artifacts/trust232/extension-execution/step3-activation-gate.json';
  if (existsSync(out)) { process.stdout.write('{"result":"failed","reason":"receipt-exists"}\n'); process.exit(1); }
  const isFree = (port) => Promise.all(['127.0.0.1', '::1'].map((h) => new Promise((resolve) => {
    const c = connect({ host: h, port }); c.setTimeout(1_000, () => { c.destroy(); resolve(true); });
    c.on('connect', () => { c.destroy(); resolve(false); }); c.on('error', () => resolve(true));
  }))).then((r) => r.every(Boolean));
  const callListBehaviors = async (token) => {
    const client = new Client({ name: 'cadence-ticket-232-gate', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(GATE.resource), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try { return await client.callTool({ name: 'list_behaviors', arguments: {} }); } finally { await client.close().catch(() => {}); }
  };
  const startedAt = new Date().toISOString();
  const result = await runGate({ callListBehaviors, isFree, log: (l) => process.stdout.write(`${new Date().toISOString()} ${l}\n`), announce: (u) => process.stdout.write(`open ${u}\n`) });
  writeFileSync(out, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), ...result }, null, 2), { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.result === 'passed' ? 0 : 1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stdout.write('{"result":"failed","reason":"main-internal-error"}\n'); process.exit(1); });
}
