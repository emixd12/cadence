import { describe, expect, it } from 'vitest';
import { runKeyCustody, publicFingerprint, CUSTODY } from '../scripts/mcp-signing-key-custody.mjs';

const OLD = [
  { id: '78be1780-9785-44e5-947a-c839fc20a991', algorithm: 'HS256', status: 'previously_used' },
  { id: CUSTODY.currentKey, algorithm: 'ES256', status: 'in_use' },
];

function world(overrides = {}) {
  const calls = { op: [], supabase: [], vercel: [], saves: [], logs: [] };
  const docs = new Map();
  let keys = OLD.map((k) => ({ ...k }));
  let envs = [{ key: 'CADENCE_MCP_ENABLED', target: ['production'], type: 'sensitive' }];
  let mcp = 503;
  const o = { ...overrides };
  const op = async (args, input) => {
    calls.op.push({ args, input });
    if (args[0] === 'vault') return { status: 0, stdout: JSON.stringify(o.vaults ?? [{ id: CUSTODY.vault, name: 'Cadence' }, { id: 'other', name: 'Private' }]) };
    if (args[0] === 'item' && args[1] === 'list') return { status: 0, stdout: JSON.stringify(o.items ?? []) };
    if (args[0] === 'document' && args[1] === 'create') {
      if (o.createFails) return { status: 1, stdout: '' };
      docs.set('doc-1', o.tamperStored ? JSON.stringify({ ...JSON.parse(input), d: 'tampered' }) : input);
      return { status: 0, stdout: JSON.stringify({ uuid: 'doc-1', vaultUuid: CUSTODY.vault }) };
    }
    if (args[0] === 'item' && args[1] === 'get') return { status: 0, stdout: JSON.stringify({ id: args[2], title: CUSTODY.title, category: 'DOCUMENT', vault: { id: o.wrongItemVault ? 'other' : CUSTODY.vault } }) };
    if (args[0] === 'document' && args[1] === 'get') return { status: 0, stdout: docs.get(args[2]) ?? '' };
    return { status: 1, stdout: '' };
  };
  const supabase = async (path, init = {}) => {
    calls.supabase.push({ path, method: init.method ?? 'GET', body: init.body });
    if (init.method === 'POST') {
      const { private_jwk: p, status, algorithm } = JSON.parse(init.body);
      const { d: _d, ...pub } = p;
      keys.push({ id: o.importKid ?? p.kid, algorithm, status, public_jwk: o.importKid ? { ...pub, kid: o.importKid } : pub });
      if (o.flipOld) keys[0].status = 'revoked';
      return { status: 201, body: {} };
    }
    return { status: 200, body: { keys: o.keysBefore && keys.length === 2 ? o.keysBefore : keys } };
  };
  const vercel = async (args, input) => {
    calls.vercel.push({ args, input });
    if (args[0] === 'api') return { status: 0, stdout: JSON.stringify({ envs: o.signerPresent ? [...envs, { key: CUSTODY.signerVariable, target: ['production'] }] : envs }) };
    if (args[0] === 'env' && args[1] === 'add') {
      envs = [...envs, { key: args[2], target: o.wrongTarget ? ['production', 'preview'] : [args[4]], type: 'sensitive' }];
      if (o.enableMcpAfterAdd) mcp = 200;
      return { status: 0, stdout: '' };
    }
    return { status: 1, stdout: '' };
  };
  const deps = {
    op, supabase, vercel,
    mcpStatus: async () => (o.mcpEnabled ? 200 : mcp),
    save: (r) => calls.saves.push(JSON.stringify(r)),
    receiptExists: () => Boolean(o.receiptExists),
    log: (l) => calls.logs.push(l),
  };
  return { calls, deps, keys: () => keys, envs: () => envs };
}

const privateOf = (w) => JSON.parse(w.calls.op.find((c) => c.args[1] === 'create').input);
const generated = (w) => w.calls.saves.some((s) => s.includes('"generated"'));

describe('Ticket 232 signing-key custody', () => {
  it('stores, imports as standby and sets the Production secret with the private key only in stdin and the request body', async () => {
    const w = world();
    const result = await runKeyCustody(w.deps);
    expect(result.result).toBe('complete');
    const jwk = privateOf(w);
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: result.kid });
    expect(typeof jwk.d).toBe('string');
    expect(w.calls.op.find((c) => c.args[1] === 'create').args).toEqual(['document', 'create', '-', '--vault', CUSTODY.vault, '--title', CUSTODY.title, '--file-name', 'integration-jwk.json', '--format=json']);
    const post = w.calls.supabase.find((c) => c.method === 'POST');
    expect(JSON.parse(post.body)).toMatchObject({ algorithm: 'ES256', status: 'standby', private_jwk: { kid: result.kid, d: jwk.d } });
    const add = w.calls.vercel.find((c) => c.args[0] === 'env');
    expect(add.args).toEqual(['env', 'add', CUSTODY.signerVariable, '--environment', 'production', '--project', CUSTODY.web, '--sensitive', '--yes']);
    expect(JSON.parse(add.input).d).toBe(jwk.d);
    const everywhereButStdin = JSON.stringify([w.calls.op.map((c) => c.args), w.calls.vercel.map((c) => c.args), w.calls.saves, w.calls.logs, w.calls.supabase.filter((c) => c.method !== 'POST'), result]);
    expect(everywhereButStdin).not.toContain(jwk.d);
    expect(w.calls.op.filter((c) => c.input !== undefined && c.input.includes(jwk.d)).map((c) => c.args[1])).toEqual(['create']);
    const keys = w.keys();
    expect(keys.find((k) => k.id === result.kid)).toMatchObject({ status: 'standby' });
    for (const old of OLD) expect(keys.find((k) => k.id === old.id).status).toBe(old.status);
    expect(result.publicFingerprint).toBe(publicFingerprint(jwk));
    const last = JSON.parse(w.calls.saves.at(-1));
    expect(last.steps.map((s) => s.name)).toEqual(['vault-bound', 'preflight', 'generated', 'custody-verified', 'standby-imported', 'signer-variable-set']);
    expect(w.calls.supabase.some((c) => c.method === 'PATCH')).toBe(false);
  });

  const refusals = [
    ['an existing receipt', { receiptExists: true }, 'receipt-exists-reconcile-first'],
    ['MCP not disabled', { mcpEnabled: true }, 'mcp-not-disabled'],
    ['a different Cadence vault ID', { vaults: [{ id: 'wrong', name: 'Cadence' }] }, 'vault-mismatch'],
    ['two Cadence vaults', { vaults: [{ id: CUSTODY.vault, name: 'Cadence' }, { id: 'x', name: 'Cadence' }] }, 'vault-mismatch'],
    ['an existing custody title', { items: [{ title: CUSTODY.title }] }, 'custody-title-exists-reconcile'],
    ['signing-key drift', { keysBefore: [...OLD, { id: 'z', algorithm: 'ES256', status: 'standby' }] }, 'signing-keys-drift'],
    ['an existing standby key', { keysBefore: [{ ...OLD[0], status: 'standby' }, OLD[1]] }, 'signing-keys-drift'],
    ['an existing signer variable', { signerPresent: true }, 'signer-variable-exists'],
  ];
  for (const [label, overrides, reason] of refusals) {
    it(`refuses before generating a key on ${label}`, async () => {
      const w = world(overrides);
      expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason });
      expect(generated(w)).toBe(false);
      expect(w.calls.op.some((c) => c.args[1] === 'create')).toBe(false);
      expect(w.calls.supabase.some((c) => c.method === 'POST')).toBe(false);
    });
  }

  it('stops without importing when custody creation is ambiguous, metadata is wrong, or the stored key differs', async () => {
    for (const [overrides, reason] of [[{ createFails: true }, 'custody-create-ambiguous-reconcile-metadata'], [{ wrongItemVault: true }, 'custody-metadata-mismatch'], [{ tamperStored: true }, 'custody-mismatch']]) {
      const w = world(overrides);
      expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason });
      expect(w.calls.op.filter((c) => c.args[1] === 'create')).toHaveLength(1);
      expect(w.calls.supabase.some((c) => c.method === 'POST')).toBe(false);
      expect(w.calls.vercel.some((c) => c.args[0] === 'env')).toBe(false);
    }
  });

  it('stops before setting the secret when the imported kid differs or an old key changed', async () => {
    for (const [overrides, reason] of [[{ importKid: 'supabase-assigned' }, 'standby-readback-mismatch'], [{ flipOld: true }, 'old-key-changed']]) {
      const w = world(overrides);
      expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason });
      expect(w.calls.vercel.some((c) => c.args[0] === 'env')).toBe(false);
    }
  });

  it('stops when the secret is not Production-only or MCP became enabled', async () => {
    for (const [overrides, reason] of [[{ wrongTarget: true }, 'signer-variable-readback-mismatch'], [{ enableMcpAfterAdd: true }, 'mcp-not-disabled-after']]) {
      const w = world(overrides);
      expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason });
    }
  });
});
