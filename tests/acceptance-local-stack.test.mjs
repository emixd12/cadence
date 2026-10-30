// Ticket 252: the mcp-acceptance skill's local stack helper. Pure parts only;
// no Docker, Supabase or app is started.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loopbackOnly, portsFor, rewriteConfig } from '../.claude/skills/mcp-acceptance/local-stack.mjs';

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
});
