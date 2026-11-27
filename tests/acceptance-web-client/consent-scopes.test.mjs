// Ticket 259: the scopes the consent page offers, grants and records. See harness.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISSUER, parsed, resetState, scenario, state, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('Ticket 259 consent offers every advertised scope', () => {
  it('partial-consent: the screen offers all scopes for a read-only request; the grant holds what the run left on', async () => {
    resetState({ requestScopes: ['cadence.read'], offerAllScopes: true, connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }] });
    const out = await scenario('claude-web', 'partial-consent');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    const connect = parsed(out.lines).find((e) => e.step === 'connect');
    expect(connect.offeredScopes).toEqual(['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read']);
    expect(connect.grantedScopes).toEqual(['cadence.behaviors.write', 'cadence.read']);
    expect(parsed(out.lines).find((e) => e.step === 'grant-checkpoint').scopes.sort()).toEqual(['cadence.behaviors.write', 'cadence.read']);
  }, 120_000);
  it('read-write: one Allow grants writes the client did not request', async () => {
    resetState({ requestScopes: ['cadence.read'], offerAllScopes: true });
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(parsed(out.lines).find((e) => e.step === 'connect').grantedScopes).toEqual(['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read']);
  }, 120_000);
  it('stops when the grant holds more than the run left on', async () => {
    resetState({ requestScopes: ['cadence.read'], offerAllScopes: true, grantAllOnDecide: true, connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }] });
    const out = await scenario('claude-web', 'partial-consent');
    expect(out.result).toMatchObject({ ok: false, reason: 'grant-scope-mismatch', step: 'grant-checkpoint' });
    expect(state.behaviors).toHaveLength(0);
  }, 120_000);
});

describe('Ticket 379 consent page that has not hydrated', () => {
  it('partial-consent: the runner clicks without waiting for scripts, and the plain form post grants what the run left on', async () => {
    resetState({ requestScopes: ['cadence.read'], offerAllScopes: true, consentNotHydrated: true, connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }] });
    const out = await scenario('claude-web', 'partial-consent');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(state.consentCount).toBe(1);
    expect(parsed(out.lines).find((e) => e.step === 'connect').grantedScopes).toEqual(['cadence.behaviors.write', 'cadence.read']);
    expect(state.grants.map((grant) => [...grant.scopes].sort())).toEqual([['cadence.behaviors.write', 'cadence.read']]);
  }, 120_000);
});

describe('consent evidence recorded before Allow (Ticket 259 live check)', () => {
  const events = (out) => readFileSync(join(out.run.dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  it('records the requested scope parameter and each switch starting on, before the grant exists', async () => {
    resetState({ requestScopes: ['cadence.read'], offerAllScopes: true });
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    const view = events(out).find((e) => e.type === 'consent.view');
    expect(view).toMatchObject({
      decision: 'allow', requestedScopes: ['cadence.read'],
      offeredScopes: ['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read'],
      initialSwitches: [{ scope: 'cadence.behaviors.write', on: true }, { scope: 'cadence.occurrences.write', on: true }],
    });
    expect(Date.parse(view.at)).toBeLessThanOrEqual(Date.parse(state.grants[0].created_at));
    expect(parsed(out.lines).find((e) => e.step === 'connect')).toMatchObject({ requestedScopes: ['cadence.read'], initialSwitches: [{ scope: 'cadence.behaviors.write', on: true }, { scope: 'cadence.occurrences.write', on: true }] });
    // Only the scope parameter is kept from the authorize URL.
    const text = readFileSync(join(out.run.dir, 'events.jsonl'), 'utf8');
    for (const word of ['oauth-cb', 'return=', 'client=', 'request_id']) expect(text).not.toContain(word);
  }, 120_000);
  it('records switches that start off', async () => {
    resetState({ writesStartOff: true });
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(events(out).find((e) => e.type === 'consent.view')).toMatchObject({
      requestedScopes: ['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'],
      initialSwitches: [{ scope: 'cadence.behaviors.write', on: false }, { scope: 'cadence.occurrences.write', on: false }],
    });
  }, 120_000);
});
