// Tickets 255 and 256: full Claude web runs against the stub chat site. See harness.mjs.
import { describe, expect, it } from 'vitest';
import { ISSUER, activeGrants, assertNoLeaks, fakeWatcher, parsed, resetState, scenario, state, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('Claude web stub', () => {
  it('reconnects an existing connector through a popup and approves with Allow once', async () => {
    resetState({ connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }], approvalsPerTool: 2 });
    const out = await scenario('claude-web', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(state.connectors).toHaveLength(1);
    expect(state.consentCount).toBe(1);
    const turns = parsed(out.lines).filter((e) => e.step.startsWith('prompt-'));
    expect(turns.map((t) => t.approvalCount)).toEqual([2, 2]);
    assertNoLeaks(out);
  }, 120_000);

  it('adds a missing connector, then resumes after a watcher miss without reconnecting', async () => {
    resetState({ connectors: [] });
    const first = await scenario('claude-web', 'read-write', { watcher: fakeWatcher(() => 1) });
    expect(first.result).toMatchObject({ ok: false, reason: 'watcher-unsatisfied', step: 'watcher' });
    expect(activeGrants()).toHaveLength(1);
    const consents = state.consentCount;
    const again = await scenario('claude-web', 'read-write', { runId: first.result.runId });
    expect(again.result.ok).toBe(true);
    expect(state.consentCount).toBe(consents);
    expect(parsed(again.lines).map((e) => e.step)).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read', 'prompt-write', 'creation-checkpoint', 'creation-reminders', 'archive-chats', 'watcher', 'revoke']);
    // Claude test chats are kept by default (deletion cannot be undone); the
    // ledger records them as kept, and every prompt carries the [Cadence QA] marker.
    expect(state.chats).toHaveLength(2);
    expect([...state.chats, ...state.otherChats].some((c) => c.archived)).toBe(false);
    expect(parsed(again.lines).find((e) => e.step === 'archive-chats')).toMatchObject({ chatCount: 2, archivedCount: 0, keptCount: 2 });
    expect(state.messages.every((m) => m.startsWith('[Cadence QA] '))).toBe(true);
    expect(state.messages).toHaveLength(2);
    expect(activeGrants()).toHaveLength(0);
  }, 120_000);
});

describe('Ticket 256 Claude web scenarios', () => {
  it('partial-consent: grants read and Behavior writes only, runs every prompt and keeps the chats', async () => {
    // The live "Yours" filter reads "Yours, 1 needs attention" when any connector needs attention.
    resetState({ connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }], needsAttention: true });
    const out = await scenario('claude-web', 'partial-consent');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    const steps = parsed(out.lines).map((e) => e.step);
    expect(steps).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read-all', 'prompt-lifecycle', 'prompt-occurrence', 'creation-checkpoint', 'creation-reminders', 'archive-chats', 'watcher', 'revoke']);
    expect(parsed(out.lines).find((e) => e.step === 'connect').grantedScopes).toEqual(['cadence.behaviors.write', 'cadence.read']);
    expect(parsed(out.lines).find((e) => e.step === 'watcher').watcherScenario).toBe('claude-web-partial');
    expect(state.messages.map((m) => m.slice(0, 12))).toEqual(['[Cadence QA]', '[Cadence QA]', '[Cadence QA]']);
    expect(state.messages[0]).toContain('get_adherence_summary');
    expect(state.chats.every((c) => !c.archived)).toBe(true);
    expect(activeGrants()).toHaveLength(0);
    assertNoLeaks(out);
  }, 120_000);

  it('step-up: finds the reconnect card outside the reply element', async () => {
    resetState({ requestScopes: ['cadence.read'], stepUp: true, reauthOutsideReply: true, connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }] });
    const out = await scenario('claude-web', 'step-up');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(parsed(out.lines).find((e) => e.step === 'prompt-write').consentCount).toBe(1);
    assertNoLeaks(out);
  }, 120_000);

  it('full-disconnect: revokes as the user between prompts and proves nothing succeeds afterwards', async () => {
    resetState({ connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }], directDisconnect: true });
    const out = await scenario('claude-web', 'full-disconnect');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    const steps = parsed(out.lines).map((e) => e.step);
    expect(steps).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read-all', 'prompt-lifecycle', 'prompt-occurrence', 'revoke-as-user', 'prompt-read', 'post-revoke-check', 'creation-checkpoint', 'creation-reminders', 'archive-chats', 'watcher', 'revoke']);
    expect(parsed(out.lines).find((e) => e.step === 'revoke-as-user').outcome).toBe('revoked');
    expect(parsed(out.lines).find((e) => e.step === 'post-revoke-check')).toMatchObject({ grantActive: false, successAfterCount: 0 });
    expect(activeGrants()).toHaveLength(0);
    assertNoLeaks(out);
  }, 120_000);

  it('full-disconnect: stops when a call on the revoked grant still succeeds', async () => {
    resetState({ connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }] });
    // A server that ignores revocation: later calls are attributed to the revoked grant.
    state.ignoreRevocation = true;
    const out = await scenario('claude-web', 'full-disconnect');
    expect(out.result).toMatchObject({ ok: false, reason: 'revoked-grant-still-works', step: 'post-revoke-check' });
  }, 120_000);
});
