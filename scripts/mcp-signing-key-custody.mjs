// Ticket 232 step 2a: generate one ES256 signing key, store it in 1Password,
// import it to Supabase as a standby key, and set the Production web secret.
// The private key exists only in process memory. It reaches 1Password and the
// Vercel CLI through stdin, and Supabase through the HTTPS request body. It is
// never written to disk, argv, environment, logs or receipts. Any mismatch stops
// the run; nothing is retried automatically.
import { generateKeyPairSync, randomUUID, createHash } from 'node:crypto';

export const CUSTODY = Object.freeze({
  vault: 'fgyupy5i26isvkdqofojc5o66u',
  title: 'Cadence Ticket232 integration signing key 2026-10-29',
  project: 'qjodzutjxtmtzczbloxa',
  web: 'prj_9tZKRXZ6IdT56ZLKVSmoJH5AAYhs',
  currentKey: 'cb295840-0eb2-4b4a-a1ba-c28c5b975361',
  signerVariable: 'CADENCE_INTEGRATION_JWT_SIGNING_KEY',
  mcpUrl: 'https://app.cadence-me.com/mcp',
});

export const publicFingerprint = (jwk) => createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('hex');
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

export function generateSigningJwk() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), alg: 'ES256', use: 'sig' };
}

/**
 * @param {object} deps
 * @param {(args: string[], input?: string) => Promise<{status:number, stdout:string}>} deps.op 1Password CLI
 * @param {(path: string, init?: object) => Promise<{status:number, body:any}>} deps.supabase Management API under /v1/projects/<ref>
 * @param {(args: string[], input?: string) => Promise<{status:number, stdout:string}>} deps.vercel Vercel CLI
 * @param {() => Promise<number>} deps.mcpStatus HTTP status of the production MCP endpoint
 * @param {(receipt: object) => void} deps.save writes the token-free receipt
 * @param {() => boolean} deps.receiptExists
 * @param {(line: string) => void} [deps.log] fixed event names only
 */
export const KEY_BASELINE = Object.freeze([
  Object.freeze({ id: '78be1780-9785-44e5-947a-c839fc20a991', algorithm: 'HS256', status: 'previously_used' }),
  Object.freeze({ id: 'cb295840-0eb2-4b4a-a1ba-c28c5b975361', algorithm: 'ES256', status: 'in_use' }),
]);
const tuple = (k) => `${k.id}|${k.algorithm}|${k.status}`;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0;
// Row shapes: every field a check reads must be present with the right type.
const vaultRow = (v) => isObject(v) && text(v.id) && text(v.name);
const itemRow = (v) => isObject(v) && typeof v.title === 'string';
const envRow = (v) => isObject(v) && text(v.key);
const keyRow = (v) => isObject(v) && text(v.id) && text(v.algorithm) && text(v.status) && (v.public_jwk === undefined || v.public_jwk === null || isObject(v.public_jwk));

/**
 * Subprocess runner for op and the Vercel CLI. Any spawn, child, stdin or
 * timeout failure settles once with status 1 and empty stdout, stops the child,
 * and discards stderr and error text. A later exit 0 cannot override it.
 */
export function createRunner(spawn, timeoutMs = 180_000) {
  return (cmd, args, input) => new Promise((resolve) => {
    let settled = false, stdout = '', child = null, timer = null;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (status !== 0 && child) { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
      resolve(status === 0 ? { status: 0, stdout } : { status: 1, stdout: '' });
    };
    try { child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch { finish(1); return; }
    timer = setTimeout(() => finish(1), timeoutMs);
    child.on('error', () => finish(1));
    child.stdin.on('error', () => finish(1));
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', () => {});
    child.on('close', (status) => finish(status === 0 ? 0 : 1));
    try { child.stdin.end(input ?? ''); } catch { finish(1); }
  });
}

class Stop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

/**
 * @param {object} deps
 * @param {(args: string[], input?: string) => Promise<{status:number, stdout:string}>} deps.op 1Password CLI
 * @param {(path: string, init?: object) => Promise<{status:number, body:any}>} deps.supabase Management API under /v1/projects/<ref>
 * @param {(args: string[], input?: string) => Promise<{status:number, stdout:string}>} deps.vercel Vercel CLI
 * @param {() => Promise<number>} deps.mcpStatus HTTP status of the production MCP endpoint
 * @param {(receipt: object) => void} deps.save writes the token-free receipt
 * @param {() => boolean} deps.receiptExists
 * @param {(line: string) => void} [deps.log] fixed event names only
 */
export async function runKeyCustody({ op, supabase, vercel, mcpStatus, save, receiptExists, log = () => {}, generate = generateSigningJwk, config = CUSTODY, baseline = KEY_BASELINE }) {
  const receipt = { startedAt: new Date().toISOString(), steps: [] };
  let phase = 'start', writeAttempted = false;
  const step = (name, extra = {}) => { receipt.steps.push({ at: new Date().toISOString(), name, ...extra }); save(receipt); };
  // Adapter failures become a fixed phase code; no error message, body or cause is kept.
  const call = async (name, fn) => {
    phase = name;
    try { return await fn(); } catch { throw new Stop(`${name}-error`); }
  };
  // Fail closed: a nonzero status, unparseable output or unexpected shape is a stop.
  const cli = async (name, fn, shape) => {
    const r = await call(name, fn);
    const value = r?.status === 0 ? parse(r.stdout) : null;
    if (value === null || !shape(value)) throw new Stop(`${name}-unreadable`);
    return value;
  };
  const keysRead = async (name) => {
    const r = await call(name, () => supabase('/config/auth/signing-keys'));
    const list = r?.status === 200 ? (Array.isArray(r.body) ? r.body : isObject(r.body) && Array.isArray(r.body.keys) ? r.body.keys : null) : null;
    if (!list || !list.every(keyRow)) throw new Stop(`${name}-unreadable`);
    return list;
  };
  const envsRead = (name) => cli(name, () => vercel(['api', `/v10/projects/${config.web}/env`]), (v) => isObject(v) && Array.isArray(v.envs) && v.envs.every(envRow)).then((v) => v.envs);
  let jwk = null;
  try {
    if (receiptExists()) return { result: 'stopped', reason: 'receipt-exists-reconcile-first' };
    if (await call('mcp-check', mcpStatus) !== 503) throw new Stop('mcp-not-disabled');

    const vaults = await cli('op-vault-list', () => op(['vault', 'list', '--format=json']), (v) => Array.isArray(v) && v.every(vaultRow));
    const cadence = vaults.filter((v) => v.name === 'Cadence');
    if (cadence.length !== 1 || cadence[0].id !== config.vault) throw new Stop('vault-mismatch');
    const items = await cli('op-item-list', () => op(['item', 'list', '--vault', config.vault, '--categories', 'Document', '--format=json']), (v) => Array.isArray(v) && v.every(itemRow));
    if (items.some((i) => i.title === config.title)) throw new Stop('custody-title-exists-reconcile');
    step('vault-bound', { vault: config.vault });

    const before = await keysRead('keys-preflight');
    const beforeTuples = before.map(tuple).sort();
    if (JSON.stringify(beforeTuples) !== JSON.stringify(baseline.map(tuple).sort())) throw new Stop('signing-keys-drift');
    const envs = await envsRead('vercel-env-preflight');
    if (envs.some((e) => e.key === config.signerVariable)) throw new Stop('signer-variable-exists');
    step('preflight', { keys: baseline.map((k) => ({ ...k })), signerVariablePresent: false, mcpStatus: 503 });

    jwk = generate();
    const kid = jwk.kid, fingerprint = publicFingerprint(jwk);
    step('generated', { kid, publicFingerprint: fingerprint });

    log('op-document-create');
    writeAttempted = true;
    const created = await call('custody-create', () => op(['document', 'create', '-', '--vault', config.vault, '--title', config.title, '--file-name', 'integration-jwk.json', '--format=json'], JSON.stringify(jwk)));
    const createdBody = created?.status === 0 ? parse(created.stdout) : null;
    const documentId = isObject(createdBody) && typeof (createdBody.uuid ?? createdBody.id) === 'string' ? (createdBody.uuid ?? createdBody.id) : null;
    if (!documentId) throw new Stop('custody-create-ambiguous-reconcile-metadata');
    step('custody-created', { documentId });
    const item = await cli('custody-metadata', () => op(['item', 'get', documentId, '--vault', config.vault, '--format=json']), isObject);
    if (item.id !== documentId || item.title !== config.title || item.vault?.id !== config.vault || String(item.category).toUpperCase() !== 'DOCUMENT') throw new Stop('custody-metadata-mismatch');
    const storedJwk = await cli('custody-readback', () => op(['document', 'get', documentId, '--vault', config.vault]), isObject);
    if (storedJwk.d !== jwk.d || storedJwk.x !== jwk.x || storedJwk.y !== jwk.y || storedJwk.kid !== kid) throw new Stop('custody-mismatch');
    step('custody-verified', { documentId, kid, publicFingerprint: fingerprint });

    const body = JSON.stringify({ algorithm: 'ES256', status: 'standby', private_jwk: jwk });
    const imported = await call('standby-import', () => supabase('/config/auth/signing-keys', { method: 'POST', body }));
    if (imported?.status !== 201 && imported?.status !== 200) throw new Stop(`standby-import-${Number(imported?.status) || 'unknown'}`);
    const after = await keysRead('keys-readback');
    const mine = after.filter((k) => isObject(k.public_jwk) && publicFingerprint(k.public_jwk) === fingerprint);
    if (mine.length !== 1 || mine[0].status !== 'standby' || mine[0].algorithm !== 'ES256' || (mine[0].public_jwk.kid ?? mine[0].id) !== kid) throw new Stop('standby-readback-mismatch');
    const afterTuples = after.filter((k) => k !== mine[0]).map(tuple).sort();
    if (JSON.stringify(afterTuples) !== JSON.stringify(baseline.map(tuple).sort())) throw new Stop('old-key-changed');
    step('standby-imported', { keyId: mine[0].id, kid, status: 'standby', keys: after.map((k) => ({ id: k.id, algorithm: k.algorithm, status: k.status })) });

    const secret = JSON.stringify(jwk);
    jwk = null;
    const added = await call('vercel-env-add', () => vercel(['env', 'add', config.signerVariable, '--environment', 'production', '--project', config.web, '--sensitive', '--yes'], secret));
    if (added?.status !== 0) throw new Stop('vercel-env-add-failed');
    const signer = (await envsRead('vercel-env-readback')).filter((e) => e.key === config.signerVariable);
    if (signer.length !== 1 || JSON.stringify(signer[0].target) !== '["production"]' || signer[0].type !== 'sensitive') throw new Stop('signer-variable-readback-mismatch');
    if (await call('mcp-check-after', mcpStatus) !== 503) throw new Stop('mcp-not-disabled-after');
    step('signer-variable-set', { target: signer[0].target, type: signer[0].type, redeployed: false });
    log('complete');
    return { result: 'complete', kid, keyId: mine[0].id, documentId, publicFingerprint: fingerprint };
  } catch (error) {
    jwk = null;
    const reason = error instanceof Stop ? error.reason : `${phase}-internal-error`;
    try { step('stopped', { reason, phase, writeAttempted }); } catch { /* receipt write failed; still report the fixed reason */ }
    log(`stopped ${reason}`);
    return { result: 'stopped', reason };
  }
}

async function main() {
  const { execFileSync, spawn } = await import('node:child_process');
  const { writeFileSync, existsSync } = await import('node:fs');
  const out = '.intent/artifacts/trust232/extension-execution/step2-custody.json';
  const node = '/Users/emi/.npm/_npx/387698761821791d/node_modules/node/bin/node';
  const vc = '/Users/emi/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js';
  const run = createRunner(spawn);
  let token = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (token.startsWith('go-keyring-base64:')) token = Buffer.from(token.slice(18), 'base64').toString('utf8').trim();
  const result = await runKeyCustody({
    op: (args, input) => run('op', args, input),
    vercel: (args, input) => run(node, [vc, ...args], input),
    supabase: async (path, init = {}) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${CUSTODY.project}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000) });
      return { status: r.status, body: parse(await r.text()) };
    },
    mcpStatus: async () => (await fetch(CUSTODY.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20_000) })).status,
    save: (receipt) => writeFileSync(out, JSON.stringify(receipt, null, 2), { mode: 0o600 }),
    receiptExists: () => existsSync(out),
    log: (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`),
  });
  token = '';
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.result === 'complete' ? 0 : 1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stdout.write('{"result":"stopped","reason":"main-internal-error"}\n'); process.exit(1); });
}
