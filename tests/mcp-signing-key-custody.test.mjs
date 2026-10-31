import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { runKeyCustody, publicFingerprint, createRunner, createVercelWriter, CUSTODY } from '../scripts/mcp-signing-key-custody.mjs';

const OLD = [
  { id: '78be1780-9785-44e5-947a-c839fc20a991', algorithm: 'HS256', status: 'previously_used' },
  { id: CUSTODY.currentKey, algorithm: 'ES256', status: 'in_use' },
];

function world(overrides = {}) {
  const calls = { op: [], supabase: [], vercel: [], writes: [], saves: [], logs: [] };
  const docs = new Map();
  let keys = OLD.map((k) => ({ ...k }));
  let envs = [{ key: 'CADENCE_MCP_ENABLED', target: ['production'], type: 'sensitive' }];
  let mcp = 503;
  const o = { ...overrides };
  const op = async (args, input) => {
    calls.op.push({ args, input });
    if (args[0] === 'vault') return { status: 0, stdout: JSON.stringify(o.vaults ?? [{ id: CUSTODY.vault, name: 'Cadence' }, { id: 'other', name: 'Private' }]) };
    if (args[0] === 'item' && args[1] === 'list') return { status: 0, stdout: o.itemsRaw ?? JSON.stringify(o.items ?? []) };
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
      if (o.postThrows) throw new Error(`request failed: ${init.body}`, { cause: init.body });
      const { private_jwk: p, status, algorithm } = JSON.parse(init.body);
      const pub = { ...p };
      delete pub.d;
      keys.push({ id: o.importKid ?? p.kid, algorithm, status, public_jwk: o.importKid ? { ...pub, kid: o.importKid } : pub });
      if (o.flipOld) keys[0].status = 'revoked';
      if (o.flipAlg) keys[1].algorithm = 'RS256';
      return { status: 201, body: {} };
    }
    return { status: 200, body: { keys: o.keysBefore && keys.length === 2 ? o.keysBefore : keys } };
  };
  const vercel = async (args, input) => {
    calls.vercel.push({ args, input });
    if (args[0] === 'api') {
      const reads = calls.vercel.filter((c) => c.args[0] === 'api').length;
      if (o.envPreflightRaw !== undefined && reads === 1) return { status: 0, stdout: o.envPreflightRaw };
      if (o.envReadbackStatus !== undefined && reads === 2) return { status: o.envReadbackStatus, stdout: JSON.stringify({ envs }) };
      return { status: 0, stdout: JSON.stringify({ envs: o.signerPresent ? [...envs, { key: CUSTODY.signerVariable, target: ['production'] }] : envs }) };
    }
    return { status: 1, stdout: '' };
  };
  const vercelWrite = async (path, body, expected) => {
    calls.writes.push({ path, body, expected });
    const posted = JSON.parse(body);
    if (o.envPostOutcome !== 'rejected') envs = [...envs, { id: 'env-new', key: posted.key, target: o.wrongTarget ? ['production', 'preview'] : posted.target, type: posted.type }];
    if (o.enableMcpAfterAdd) mcp = 200;
    return o.envPostOutcome && o.envPostOutcome !== 'created' ? { outcome: o.envPostOutcome } : { outcome: 'created', id: o.createdId ?? 'env-new' };
  };
  const deps = {
    op, supabase, vercel, vercelWrite,
    vercelWriteReady: async () => !o.credentialNotReady,
    mcpStatus: async () => (o.mcpEnabled ? 200 : mcp),
    save: (r) => calls.saves.push(JSON.stringify(r)),
    receiptExists: () => Boolean(o.receiptExists),
    log: (l) => calls.logs.push(l),
  };
  return { calls, deps, keys: () => keys, envs: () => envs };
}

const privateOf = (w) => JSON.parse(w.calls.op.find((c) => c.args[1] === 'create').input);
const posts = (w) => w.calls.writes;
const generated = (w) => w.calls.saves.some((s) => s.includes('"generated"'));

describe('Ticket 232 signing-key custody', () => {
  it('stores, imports as standby and sets the Production secret with the private key only in stdin and the request body', async () => {
    const w = world();
    const result = await runKeyCustody(w.deps);
    expect(result.result).toBe('complete');
    const jwk = privateOf(w);
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: result.kid });
    expect(typeof jwk.d).toBe('string');
    expect(w.calls.op.find((c) => c.args[1] === 'create').args).toEqual(['document', 'create', '/dev/stdin', '--vault', CUSTODY.vault, '--title', CUSTODY.title, '--file-name', 'integration-jwk.json', '--format=json']);
    const post = w.calls.supabase.find((c) => c.method === 'POST');
    expect(JSON.parse(post.body)).toMatchObject({ algorithm: 'ES256', status: 'standby', private_jwk: { kid: result.kid, d: jwk.d } });
    expect(w.calls.op.flatMap((c) => c.args)).not.toContain('-');
    expect(posts(w)).toHaveLength(1);
    const add = posts(w)[0];
    expect(add.path).toBe(`/v10/projects/${CUSTODY.web}/env`);
    expect(add.expected).toEqual({ key: CUSTODY.signerVariable });
    expect(w.calls.vercel.map((c) => c.args)).toEqual([['api', `/v10/projects/${CUSTODY.web}/env?teamId=${CUSTODY.team}`], ['api', `/v10/projects/${CUSTODY.web}/env?teamId=${CUSTODY.team}`]]);
    expect(CUSTODY.team).toBe('team_BxWfRYU1gqrl6Ba6t7Vm3wp1');
    const envBody = JSON.parse(add.body);
    expect(envBody).toMatchObject({ key: CUSTODY.signerVariable, type: 'sensitive', target: ['production'] });
    expect(JSON.parse(envBody.value)).toEqual(jwk);
    expect(w.calls.vercel.some((c) => c.args[0] === 'env')).toBe(false);
    const everywhereButStdin = JSON.stringify([w.calls.op.map((c) => c.args), w.calls.vercel, w.calls.saves, w.calls.logs, w.calls.supabase.filter((c) => c.method !== 'POST'), result]);
    expect(everywhereButStdin).not.toContain(jwk.d);
    expect(w.calls.op.filter((c) => c.input !== undefined && c.input.includes(jwk.d)).map((c) => c.args[1])).toEqual(['create']);
    const keys = w.keys();
    expect(keys.find((k) => k.id === result.kid)).toMatchObject({ status: 'standby' });
    for (const old of OLD) expect(keys.find((k) => k.id === old.id).status).toBe(old.status);
    expect(result.publicFingerprint).toBe(publicFingerprint(jwk));
    const last = JSON.parse(w.calls.saves.at(-1));
    expect(last.steps.at(-1)).toMatchObject({ name: 'signer-variable-set', envId: 'env-new' });
    expect(JSON.stringify(last)).not.toContain('returned-value');
    expect(last.steps.map((s) => s.name)).toEqual(['vault-bound', 'preflight', 'generated', 'custody-created', 'custody-verified', 'standby-imported', 'signer-variable-set']);
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
    ['an expiring Vercel credential', { credentialNotReady: true }, 'vercel-credential-not-ready'],
    ['unparseable custody item list', { itemsRaw: 'not json' }, 'op-item-list-unreadable'],
    ['a custody item without a title', { itemsRaw: '[{}]' }, 'op-item-list-unreadable'],
    ['a custody item with a null title', { itemsRaw: '[{"title":null}]' }, 'op-item-list-unreadable'],
    ['a custody item with a numeric title', { itemsRaw: '[{"title":5}]' }, 'op-item-list-unreadable'],
    ['a vault row without a name', { vaults: [{ id: CUSTODY.vault }] }, 'op-vault-list-unreadable'],
    ['an env row without a key', { envPreflightRaw: '{"envs":[{}]}' }, 'vercel-env-preflight-unreadable'],
    ['an env row with an empty key', { envPreflightRaw: '{"envs":[{"key":""}]}' }, 'vercel-env-preflight-unreadable'],
    ['an env row with a null key', { envPreflightRaw: '{"envs":[{"key":null}]}' }, 'vercel-env-preflight-unreadable'],
    ['a signing-key row without an algorithm', { keysBefore: [{ id: OLD[0].id, status: OLD[0].status }, OLD[1]] }, 'keys-preflight-unreadable'],
    ['an empty Vercel env response', { envPreflightRaw: '{}' }, 'vercel-env-preflight-unreadable'],
    ['a replaced historical key ID', { keysBefore: [{ ...OLD[0], id: '00000000-0000-4000-8000-000000000000' }, OLD[1]] }, 'signing-keys-drift'],
    ['a changed current-key algorithm', { keysBefore: [OLD[0], { ...OLD[1], algorithm: 'RS256' }] }, 'signing-keys-drift'],
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
      expect(posts(w)).toHaveLength(0);
    }
  });

  it('stops before setting the secret when the imported kid differs or an old key changed', async () => {
    for (const [overrides, reason] of [[{ importKid: 'supabase-assigned' }, 'standby-readback-mismatch'], [{ flipOld: true }, 'old-key-changed'], [{ flipAlg: true }, 'old-key-changed']]) {
      const w = world(overrides);
      expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason });
      expect(posts(w)).toHaveLength(0);
    }
  });

  it('stops when the secret is not Production-only, cannot be read back, or MCP became enabled', async () => {
    for (const [overrides, reason] of [[{ wrongTarget: true }, 'signer-variable-readback-mismatch'], [{ envReadbackStatus: 1 }, 'vercel-env-readback-unreadable'], [{ enableMcpAfterAdd: true }, 'mcp-not-disabled-after'], [{ createdId: 'env-other' }, 'signer-variable-readback-mismatch']]) {
      const w = world(overrides);
      expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason });
    }
  });

  it('turns an adapter error carrying the private key into a fixed reason and records the partial write stage', async () => {
    const w = world({ postThrows: true });
    const result = await runKeyCustody(w.deps);
    expect(result).toEqual({ result: 'stopped', reason: 'standby-import-error' });
    const d = privateOf(w).d;
    expect(JSON.stringify([result, w.calls.saves, w.calls.logs])).not.toContain(d);
    const last = JSON.parse(w.calls.saves.at(-1)).steps.at(-1);
    expect(last).toMatchObject({ name: 'stopped', reason: 'standby-import-error', phase: 'standby-import', writeAttempted: true });
    expect(JSON.parse(w.calls.saves.at(-1)).steps.map((x) => x.name)).toContain('custody-verified');
    expect(w.calls.supabase.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(posts(w)).toHaveLength(0);
  });

  it('turns any thrown adapter error into a fixed phase reason without a retry', async () => {
    const w = world();
    w.deps.mcpStatus = async () => { throw new Error('boom secret'); };
    expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason: 'mcp-check-error' });
    expect(JSON.stringify(w.calls.saves)).not.toContain('boom');
  });

  it('reports an unexpected internal error by phase only', async () => {
    const w = world();
    w.deps.generate = () => { throw new Error('secret-material-in-message'); };
    const result = await runKeyCustody(w.deps);
    expect(result.result).toBe('stopped');
    expect(result.reason).toMatch(/-internal-error$/);
    expect(JSON.stringify([result, w.calls.saves, w.calls.logs])).not.toContain('secret-material');
    expect(w.calls.op.some((c) => c.args[1] === 'create')).toBe(false);
  });
});

describe('Ticket 232 custody subprocess runner', () => {
  const harness = (mode) => {
    const kills = [];
    const spawn = () => {
      if (mode === 'spawn-throw') throw new Error('synthetic-detail');
      const c = new EventEmitter();
      c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = new EventEmitter();
      c.kill = (signal) => kills.push(signal);
      c.stdin.end = () => {
        if (mode === 'stdin-throw') throw new Error('synthetic-detail');
        queueMicrotask(() => {
          if (mode === 'timeout') return;
          if (mode === 'child-error') { c.emit('error', new Error('synthetic-detail')); return; }
          if (mode === 'stdin-error') c.stdin.emit('error', Object.assign(new Error('synthetic-EPIPE'), { code: 'EPIPE' }));
          c.stderr.emit('data', 'synthetic-stderr');
          c.stdout.emit('data', '{"ok":true}');
          c.emit('close', mode === 'exit-nonzero' ? 2 : 0);
        });
      };
      return c;
    };
    return { run: createRunner(spawn, 20), kills };
  };
  for (const mode of ['spawn-throw', 'child-error', 'stdin-error', 'stdin-throw', 'exit-nonzero', 'timeout']) {
    it(`settles ${mode} as status 1 with empty stdout`, async () => {
      const h = harness(mode);
      const result = await h.run('fake', [], 'synthetic-input');
      expect(result).toEqual({ status: 1, stdout: '' });
      if (mode !== 'spawn-throw') expect(h.kills).toEqual(['SIGTERM']);
    });
  }
  it('returns stdout only on a clean exit', async () => {
    const h = harness('success');
    expect(await h.run('fake', [], 'x')).toEqual({ status: 0, stdout: '{"ok":true}' });
    expect(h.kills).toEqual([]);
  });
});

describe('Ticket 232 Vercel write outcomes', () => {
  for (const [outcome, reason, present] of [['ambiguous', 'vercel-env-add-ambiguous-reconcile', true], ['rejected', 'vercel-env-add-rejected', false]]) {
    it(`stops on a ${outcome} write, reconciles read-only and never re-posts`, async () => {
      const w = world({ envPostOutcome: outcome });
      expect(await runKeyCustody(w.deps)).toEqual({ result: 'stopped', reason });
      expect(w.calls.writes).toHaveLength(1);
      const steps = JSON.parse(w.calls.saves.at(-1)).steps;
      expect(steps.find((x) => x.name === 'vercel-env-reconcile')).toMatchObject({ outcome, signerPresent: present });
      expect(steps.at(-1)).toMatchObject({ name: 'stopped', reason, writeAttempted: true });
      expect(w.calls.vercel.at(-1).args).toEqual(['api', `/v10/projects/${CUSTODY.web}/env?teamId=${CUSTODY.team}`]);
    });
  }
});

describe('Ticket 232 one-attempt Vercel writer', () => {
  const good = { created: { id: 'env-1', key: 'K', type: 'sensitive', target: ['production'], value: 'returned-value-not-kept' } };
  const make = (behaviour, options = {}) => {
    const seen = [];
    const fetchImpl = (url, init) => {
      seen.push({ url, init });
      if (behaviour === 'reset') return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }));
      if (behaviour === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      if (behaviour === '5xx') return Promise.resolve(new Response('{}', { status: 502 }));
      if (behaviour === '4xx') return Promise.resolve(new Response('{"error":{}}', { status: 409 }));
      if (behaviour === '3xx') return Promise.resolve(new Response('', { status: 304 }));
      return Promise.resolve(new Response(options.body ?? JSON.stringify(good), { status: 201 }));
    };
    return { write: createVercelWriter({ fetchImpl, readToken: options.readToken ?? (() => 'cli-token'), teamId: 'team_x', timeoutMs: 30 }), seen };
  };
  const cases = [
    ['reset', 'ambiguous'], ['hang', 'ambiguous'], ['5xx', 'ambiguous'], ['3xx', 'ambiguous'], ['4xx', 'rejected'], ['ok', 'created'],
  ];
  for (const [behaviour, outcome] of cases) {
    it(`makes exactly one attempt on ${behaviour} and reports ${outcome}`, async () => {
      const w = make(behaviour);
      expect(await w.write('/v10/projects/p/env', '{"k":1}', { key: 'K' })).toEqual(outcome === 'created' ? { outcome, id: 'env-1' } : { outcome });
      expect(w.seen).toHaveLength(1);
      const [{ url, init }] = w.seen;
      expect(url).toBe('https://api.vercel.com/v10/projects/p/env?teamId=team_x');
      expect(init).toMatchObject({ method: 'POST', body: '{"k":1}', redirect: 'error' });
      expect(init.headers.Authorization).toBe('Bearer cli-token');
    });
  }
  const bodies = [
    ['an empty body', ''], ['an empty object', '{}'], ['non-JSON', 'not json'],
    ['no created record with failures', JSON.stringify({ created: [], failed: [{ error: { code: 'x' } }] })],
    ['a created record plus failures', JSON.stringify({ ...good, failed: [{ error: {} }] })],
    ['a different key', JSON.stringify({ created: { ...good.created, key: 'OTHER' } })],
    ['a non-sensitive type', JSON.stringify({ created: { ...good.created, type: 'encrypted' } })],
    ['a wider target', JSON.stringify({ created: { ...good.created, target: ['production', 'preview'] } })],
    ['two created records', JSON.stringify({ created: [good.created, good.created] })],
    ['a created record without an id', JSON.stringify({ created: { key: 'K', type: 'sensitive', target: ['production'] } })],
  ];
  for (const [label, body] of bodies) {
    it(`treats a 2xx with ${label} as ambiguous`, async () => {
      const w = make('ok', { body });
      expect(await w.write('/v10/projects/p/env', '{}', { key: 'K' })).toEqual({ outcome: 'ambiguous' });
      expect(w.seen).toHaveLength(1);
    });
  }
  it('accepts a single created record in array form', async () => {
    const w = make('ok', { body: JSON.stringify({ created: [good.created], failed: [] }) });
    expect(await w.write('/v10/projects/p/env', '{}', { key: 'K' })).toEqual({ outcome: 'created', id: 'env-1' });
  });
  it('does not call the API without a usable credential', async () => {
    for (const readToken of [() => null, () => '', () => { throw new Error('no file'); }]) {
      const w = make('ok', { readToken });
      expect(await w.write('/v10/projects/p/env', '{}', { key: 'K' })).toEqual({ outcome: 'rejected' });
      expect(w.seen).toHaveLength(0);
    }
  });
});
