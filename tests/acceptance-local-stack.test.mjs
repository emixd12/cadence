// Ticket 252: the mcp-acceptance skill's local stack helper. Pure parts only;
// no Docker, Supabase or app is started.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertSafe } from '../scripts/acceptance/ledger.mjs';
import {
  CHECK_SQL, defaultRunId, loopbackOnly, parseRunnerEnv, portsFor, protocolSummary, rewriteConfig, watcherVerdict,
} from '../.claude/skills/mcp-acceptance/local-stack.mjs';

const CONFIG = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

describe('local stack helper', () => {
  it('moves the project ID and every port off the owner stack', () => {
    const ports = portsFor(56150);
    const out = rewriteConfig(CONFIG, { name: 'cadence-accept-test', ports });
    expect(out).toMatch(/^project_id = "cadence-accept-test"$/m);
    expect(out).not.toMatch(/habit-tracking-app/);
    expect(out).not.toMatch(/^\s*(port|shadow_port) = 553\d\d$/m);
    expect(out).not.toMatch(/^inspector_port = 8083$/m);
    for (const port of [56150, 56151, 56152, 56153, 56154, 56157, 56158, 56159]) expect(out).toMatch(new RegExp(`= ${port}$`, 'm'));
    expect(out).toMatch(/^signing_keys_path = "\.\/signing_keys\.json"$/m);
  });

  it('refuses a config whose shape changed instead of guessing', () => {
    expect(() => rewriteConfig(CONFIG.replace('port = 55322', 'port = 55399'), { name: 'cadence-accept-test', ports: portsFor(56150) })).toThrow(/changed shape/);
  });

  it('accepts only loopback published ports', () => {
    expect(loopbackOnly(['127.0.0.1:56151->8000/tcp', '3000/tcp', '127.0.0.1:56152->5432/tcp'])).toBe(true);
    expect(loopbackOnly(['0.0.0.0:56151->8000/tcp, [::]:56151->8000/tcp'])).toBe(false);
    expect(loopbackOnly(['127.0.0.1:56154->8025/tcp, [::]:56154->8025/tcp'])).toBe(false);
  });

  it('names local runs by stack, tier and time, within the ledger and runner rules', () => {
    const at = new Date('2026-10-30T11:56:07.123Z');
    expect(defaultRunId('cadence-accept-252dry', 't0', at)).toBe('local-252dry-t0-1030t115607');
    // Tags up to the 40 characters --name allows: every default ID stays under the
    // ledger's 32-character opaque-run limit and passes assertSafe as a run ID.
    for (const tag of ['252', 'verify3', 'reverify', 'verifier', 'x'.repeat(40), `a${'1'.repeat(39)}`, 'a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t']) {
      for (const tier of ['t0', 't1']) {
        const id = defaultRunId(`cadence-accept-${tag}`, tier, at);
        expect(id.length).toBeLessThan(32);
        expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
        expect(() => assertSafe({ type: 'run', runId: id, run: id })).not.toThrow();
      }
    }
    expect(defaultRunId('cadence-accept-reverify', 't1', at)).toBe('local-reverify-t1-1030t115607');
  });

  it('reads runner.env without a shell', () => {
    const env = parseRunnerEnv('CADENCE_ACCEPT_ISSUER="https://127.0.0.1:4450"\nCADENCE_ACCEPT_DB_URL="postgresql://u:p@127.0.0.1:56152/postgres"\nnot a line\n');
    expect(env).toEqual({ CADENCE_ACCEPT_ISSUER: 'https://127.0.0.1:4450', CADENCE_ACCEPT_DB_URL: 'postgresql://u:p@127.0.0.1:56152/postgres' });
  });

  it('prints the protocol count and only the watcher verdict', () => {
    expect(protocolSummary('# Report\n\nTarget: local · 96/96 checks passed · PASS\n| a | b |')).toBe('96/96 checks passed · PASS');
    expect(protocolSummary('nothing')).toBeNull();
    const lines = ['watching local', '2026-10-30T11:41:16Z  A  client.registered x', 'scenario inspector: satisfied (grant 503bbfde)', '  ok    client-registered …'];
    expect(watcherVerdict(lines)).toEqual(lines.slice(2));
    expect(watcherVerdict(['watch-stopped db-unreadable'])).toEqual(['watch-stopped db-unreadable']);
  });

  it('checks revocation with a read-only query', () => {
    expect(CHECK_SQL.startsWith('begin transaction read only;')).toBe(true);
    expect(CHECK_SQL.trim().endsWith('rollback;')).toBe(true);
    expect(CHECK_SQL).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|grant)\b/i);
    expect(CHECK_SQL).not.toMatch(/token_hash|refresh_token|code_hash/);
  });
});
