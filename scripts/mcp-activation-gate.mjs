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
  ports: Object.freeze([4321, 4322, 4323, 4324, 4325, 4326, 4327, 4328, 4329, 4330]),
  // Every Behavior account A owns (read-only capture, October 29): the four
  // fixture Behaviors plus A's three pre-existing ones. Nothing else may appear.
  aOwned: Object.freeze([
    '083ddfb7-dc29-4456-8054-1f7fd25367e7', '72472a62-7c7b-41e3-bf56-2a58d21b6e32', '86f7de46-3eba-46ac-9735-41e1f5a489a6',
    '94e8cb9f-7f29-449a-88ed-9f60d1afca4f', 'b2c5b6b1-457a-4e58-a14f-e4270c3d341e', 'd096b1ac-0e63-4902-83aa-b6aa68184d4d',
  ]),
  aRequired: Object.freeze(['b2c5b6b1-457a-4e58-a14f-e4270c3d341e', '86f7de46-3eba-46ac-9735-41e1f5a489a6']),
  get aBehaviors() { return this.aRequired; },
  bBehaviors: Object.freeze(['1b16ebc8-8495-4a51-a0b2-9f4f4b4c7732', 'ffc64890-9afc-4bf2-9e1d-43d787cb18d4', '418a8c1c-7d9d-4588-af04-78307d453c5d']),
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const page = (text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cadence activation gate</title></head><body><p>${text}</p></body></html>`;

/** Pure check of a list_behaviors result: only A-owned ids, with both active fixture Behaviors present. */
export function judgeBehaviors(result, gate = GATE) {
  if (!isObject(result) || result.isError === true || !isObject(result.structuredContent) || !Array.isArray(result.structuredContent.behaviors)) return { pass: false, reason: 'unreadable-result' };
  const ids = result.structuredContent.behaviors.map((b) => (isObject(b) ? b.id : null));
  if (!ids.every((id) => typeof id === 'string')) return { pass: false, reason: 'unreadable-result' };
  if (ids.some((id) => gate.bBehaviors.includes(id))) return { pass: false, reason: 'cross-account-data' };
  if (ids.some((id) => !gate.aOwned.includes(id))) return { pass: false, reason: 'unknown-data' };
  if (new Set(ids).size !== ids.length) return { pass: false, reason: 'duplicate-data' };
  if (!gate.aRequired.every((id) => ids.includes(id))) return { pass: false, reason: 'own-data-missing' };
  return { pass: true, reason: 'a-owned-data', count: ids.length };
}

/** Listen on the first port in the pool that binds; bind errors are handled, never thrown. */
async function listenFirst(server, ports, isFree) {
  for (const port of ports) {
    if (!(await isFree(port))) continue;
    const bound = await new Promise((resolve) => {
      const onError = () => { server.off('listening', onListening); resolve(false); };
      const onListening = () => { server.off('error', onError); resolve(true); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    if (bound) return port;
  }
  return null;
}

/**
 * @param {object} deps
 * @param {(url: string, init?: object) => Promise<Response>} deps.fetchImpl single-attempt fetch
 * @param {(token: string, signal: AbortSignal) => Promise<object>} deps.callListBehaviors MCP tools/call with the bearer token
 * @param {(port: number) => Promise<boolean>} deps.isFree
 * @param {(line: string) => void} [deps.log] fixed event names only
 * @param {(origin: string) => void} deps.announce receives only the loopback start URL
 */
export async function runGate({ fetchImpl = fetch, callListBehaviors, isFree, log = () => {}, announce, gate = GATE, timeoutMs = 20 * 60_000 }) {
  // One deadline for everything: discovery, registration, the callback, the token exchange and MCP.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  let settled = false, port = null, clientId = null, verifier = null;
  let resolveResult;
  const done = new Promise((r) => { resolveResult = r; });
  const server = createServer();
  const finish = (value) => {
    if (settled) return;
    settled = true;
    verifier = null;
    clearTimeout(timer);
    deadline.abort();
    if (server.listening) { server.close(); server.closeAllConnections?.(); }
    resolveResult({ ...value, clientId, port });
  };
  deadline.signal.addEventListener('abort', () => { if (!settled) { log('gate-timeout'); finish({ result: 'failed', reason: 'timeout' }); } });
  const once = async (url, init) => {
    if (settled) return null;
    try { return await fetchImpl(url, { redirect: 'error', signal: AbortSignal.any([deadline.signal, AbortSignal.timeout(30_000)]), ...init }); } catch { return null; }
  };
  const json = async (r) => { if (!r || r.status < 200 || r.status >= 300) return null; try { const j = await r.json(); return isObject(j) ? j : null; } catch { return null; } };

  (async () => {
    const meta = await json(await once(`${gate.origin}/.well-known/oauth-authorization-server`));
    if (settled) return;
    const under = (u) => typeof u === 'string' && u.startsWith(`${gate.origin}/`);
    if (!meta || meta.issuer !== gate.origin || !under(meta.authorization_endpoint) || !under(meta.token_endpoint) || !under(meta.registration_endpoint)) return finish({ result: 'failed', reason: 'discovery' });

    // Bind before registering, so a busy port never leaves a registration behind an unhandled error.
    let authorizeUrl = null, state = null, used = false;
    const reply = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'", ...headers }); res.end(body); };
    server.headersTimeout = 5_000;
    server.requestTimeout = 120_000;
    server.on('clientError', (_, socket) => socket.destroy());
    server.on('request', async (req, res) => {
      if (req.headers.host !== `127.0.0.1:${port}`) return reply(res, 421, page('Wrong host.'));
      if (req.method !== 'GET') return reply(res, 405, page('Method not allowed.'));
      if (settled || !authorizeUrl) return reply(res, 503, page('gate: not ready'));
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/') return reply(res, 303, '', { location: authorizeUrl });
      if (url.pathname !== '/callback') return reply(res, 404, page('Not found.'));
      if (used) return reply(res, 409, page('Already used.'));
      used = true;
      if (url.searchParams.get('state') !== state || !url.searchParams.get('code') || url.searchParams.has('error')) {
        reply(res, 400, page('gate: failed'));
        log('callback-rejected');
        return finish({ result: 'failed', reason: 'callback' });
      }
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const tokenResponse = await once(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
        grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier ?? '', resource: gate.resource,
      }).toString() });
      const tokens = await json(tokenResponse);
      if (settled) { reply(res, 410, page('gate: failed')); return undefined; }
      let access = tokens && typeof tokens.access_token === 'string' ? tokens.access_token : null;
      if (!access) { reply(res, 502, page('gate: failed')); log('token-failed'); return finish({ result: 'failed', reason: 'token-exchange' }); }
      let verdict;
      try { verdict = judgeBehaviors(await callListBehaviors(access, deadline.signal)); } catch { verdict = { pass: false, reason: 'mcp-call-failed' }; }
      access = null;
      if (settled) { reply(res, 410, page('gate: failed')); return undefined; }
      reply(res, 200, page(verdict.pass ? 'gate: passed' : 'gate: failed'));
      log(verdict.pass ? 'gate-passed' : `gate-failed ${verdict.reason}`);
      return finish({ result: verdict.pass ? 'passed' : 'failed', reason: verdict.reason, behaviors: verdict.count ?? null, scope: typeof tokens.scope === 'string' ? tokens.scope : null });
    });
    port = await listenFirst(server, gate.ports, isFree);
    if (settled) return;
    if (!port) return finish({ result: 'failed', reason: 'no-free-port' });
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    log(`listening ${port}`);

    const client = await json(await once(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      client_name: 'Cadence Ticket 232 activation gate', redirect_uris: [redirectUri], application_type: 'native',
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], scope: gate.scope,
    }) }));
    if (settled) return;
    if (!client || typeof client.client_id !== 'string' || !client.client_id) return finish({ result: 'failed', reason: 'registration' });
    clientId = client.client_id;
    state = b64url(randomBytes(32));
    verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    authorizeUrl = `${meta.authorization_endpoint}?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: gate.scope, state, code_challenge: challenge, code_challenge_method: 'S256', resource: gate.resource })}`;
    announce(`http://127.0.0.1:${port}/`);
  })().catch(() => finish({ result: 'failed', reason: 'internal-error' }));

  return done;
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
  const callListBehaviors = async (token, signal) => {
    const client = new Client({ name: 'cadence-ticket-232-gate', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(GATE.resource), { requestInit: { headers: { Authorization: `Bearer ${token}` }, signal } }));
    try { return await client.callTool({ name: 'list_behaviors', arguments: {} }, undefined, { signal }); } finally { await client.close().catch(() => {}); }
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
