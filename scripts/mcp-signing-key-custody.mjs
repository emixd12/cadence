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
const keysOf = (body) => (Array.isArray(body) ? body : body?.keys ?? []);
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
export async function runKeyCustody({ op, supabase, vercel, mcpStatus, save, receiptExists, log = () => {}, generate = generateSigningJwk, config = CUSTODY }) {
  const receipt = { startedAt: new Date().toISOString(), steps: [] };
  const step = (name, extra = {}) => { receipt.steps.push({ at: new Date().toISOString(), name, ...extra }); save(receipt); };
  const stop = (reason) => { step('stopped', { reason }); log(`stopped ${reason}`); return { result: 'stopped', reason }; };
  if (receiptExists()) return { result: 'stopped', reason: 'receipt-exists-reconcile-first' };

  if (await mcpStatus() !== 503) return stop('mcp-not-disabled');

  const vaults = await op(['vault', 'list', '--format=json']);
  if (vaults.status !== 0) return stop('op-vault-list-failed');
  const cadence = (parse(vaults.stdout) ?? []).filter((v) => v.name === 'Cadence');
  if (cadence.length !== 1 || cadence[0].id !== config.vault) return stop('vault-mismatch');
  const items = await op(['item', 'list', '--vault', config.vault, '--categories', 'Document', '--format=json']);
  if (items.status !== 0) return stop('op-item-list-failed');
  if ((parse(items.stdout) ?? []).some((i) => i.title === config.title)) return stop('custody-title-exists-reconcile');
  step('vault-bound', { vault: config.vault });

  const before = await supabase('/config/auth/signing-keys');
  const beforeKeys = keysOf(before.body).map((k) => ({ id: k.id, algorithm: k.algorithm, status: k.status }));
  if (before.status !== 200 || beforeKeys.length !== 2 || !beforeKeys.some((k) => k.id === config.currentKey && k.status === 'in_use') || beforeKeys.some((k) => k.status === 'standby')) return stop('signing-keys-drift');
  const envs = await vercel(['api', `/v10/projects/${config.web}/env`]);
  if (envs.status !== 0) return stop('vercel-env-list-failed');
  if ((parse(envs.stdout)?.envs ?? []).some((e) => e.key === config.signerVariable)) return stop('signer-variable-exists');
  step('preflight', { keys: beforeKeys, signerVariablePresent: false, mcpStatus: 503 });

  let jwk = generate();
  const kid = jwk.kid, fingerprint = publicFingerprint(jwk);
  step('generated', { kid, publicFingerprint: fingerprint });

  log('op-document-create');
  const created = await op(['document', 'create', '-', '--vault', config.vault, '--title', config.title, '--file-name', 'integration-jwk.json', '--format=json'], JSON.stringify(jwk));
  const documentId = created.status === 0 ? (parse(created.stdout)?.uuid ?? parse(created.stdout)?.id ?? null) : null;
  if (!documentId) { jwk = null; return stop('custody-create-ambiguous-reconcile-metadata'); }
  const meta = await op(['item', 'get', documentId, '--vault', config.vault, '--format=json']);
  const item = meta.status === 0 ? parse(meta.stdout) : null;
  if (!item || item.title !== config.title || item.vault?.id !== config.vault || String(item.category).toUpperCase() !== 'DOCUMENT') { jwk = null; return stop('custody-metadata-mismatch'); }
  const stored = await op(['document', 'get', documentId, '--vault', config.vault]);
  const storedJwk = stored.status === 0 ? parse(stored.stdout) : null;
  if (!storedJwk || storedJwk.d !== jwk.d || storedJwk.x !== jwk.x || storedJwk.y !== jwk.y || storedJwk.kid !== kid) { jwk = null; return stop('custody-mismatch'); }
  step('custody-verified', { documentId, kid, publicFingerprint: fingerprint });

  const imported = await supabase('/config/auth/signing-keys', { method: 'POST', body: JSON.stringify({ algorithm: 'ES256', status: 'standby', private_jwk: jwk }) });
  if (imported.status !== 201 && imported.status !== 200) { jwk = null; return stop(`standby-import-${imported.status}`); }
  const after = await supabase('/config/auth/signing-keys');
  const afterKeys = keysOf(after.body);
  const mine = afterKeys.filter((k) => k.public_jwk && publicFingerprint(k.public_jwk) === fingerprint);
  if (after.status !== 200 || mine.length !== 1 || mine[0].status !== 'standby' || mine[0].algorithm !== 'ES256' || (mine[0].public_jwk.kid ?? mine[0].id) !== kid) { jwk = null; return stop('standby-readback-mismatch'); }
  if (afterKeys.length !== beforeKeys.length + 1 || beforeKeys.some((old) => !afterKeys.some((k) => k.id === old.id && k.status === old.status))) { jwk = null; return stop('old-key-changed'); }
  step('standby-imported', { keyId: mine[0].id, kid, status: 'standby', keys: afterKeys.map((k) => ({ id: k.id, algorithm: k.algorithm, status: k.status })) });

  const added = await vercel(['env', 'add', config.signerVariable, '--environment', 'production', '--project', config.web, '--sensitive', '--yes'], JSON.stringify(jwk));
  jwk = null;
  if (added.status !== 0) return stop('vercel-env-add-failed');
  const envAfter = await vercel(['api', `/v10/projects/${config.web}/env`]);
  const signer = (parse(envAfter.stdout)?.envs ?? []).filter((e) => e.key === config.signerVariable);
  if (signer.length !== 1 || JSON.stringify(signer[0].target) !== '["production"]' || signer[0].type !== 'sensitive') return stop('signer-variable-readback-mismatch');
  if (await mcpStatus() !== 503) return stop('mcp-not-disabled-after');
  step('signer-variable-set', { target: signer[0].target, type: signer[0].type, redeployed: false });
  log('complete');
  return { result: 'complete', kid, keyId: mine[0].id, documentId, publicFingerprint: fingerprint };
}

async function main() {
  const { execFileSync, spawn } = await import('node:child_process');
  const { writeFileSync, existsSync } = await import('node:fs');
  const out = '.intent/artifacts/trust232/extension-execution/step2-custody.json';
  const node = '/Users/emi/.npm/_npx/387698761821791d/node_modules/node/bin/node';
  const vc = '/Users/emi/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js';
  const run = (cmd, args, input) => new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', () => {});
    child.on('close', (status) => { clearTimeout(timer); resolve({ status: status ?? 1, stdout }); });
    child.stdin.end(input ?? '');
  });
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
