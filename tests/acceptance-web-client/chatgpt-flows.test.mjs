// Ticket 255: full ChatGPT web runs against the stub chat site. See harness.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISSUER, activeGrants, assertNoLeaks, parsed, resetState, runFiles, scenario, state, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('ChatGPT stub', () => {
  it('reconnects the existing app, consents, prompts, approves, captures the reply and cleans up', async () => {
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    const steps = parsed(out.lines).map((e) => e.step);
    expect(steps).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read', 'prompt-write', 'creation-checkpoint', 'creation-reminders', 'archive-chats', 'watcher', 'revoke']);
    // Privacy: each prompt opened a new chat, the run archived both right after
    // their replies, and it never opened any chat it did not create.
    expect(state.chats).toHaveLength(2);
    expect(state.chats.every((c) => c.archived)).toBe(true);
    expect(parsed(out.lines).filter((e) => e.step.startsWith('prompt-')).map((e) => e.archived)).toEqual([true, true]);
    expect(parsed(out.lines).find((e) => e.step === 'archive-chats')).toMatchObject({ chatCount: 2, archivedCount: 2, keptCount: 0, unknownCount: 0 });
    expect(state.openedPaths.filter((p) => /^\/c\//.test(p))).toEqual([]);
    expect(state.otherChats.every((c) => !c.archived)).toBe(true);
    const ledger = readFileSync(join(out.run.dir, 'checkpoints.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(ledger.find((r) => r.kind === 'step' && r.name === 'archive-chats' && r.state === 'done').result).toEqual({ chatCount: 2, archivedCount: 2, keptCount: 0, unknownCount: 0 });
    expect(ledger.filter((r) => r.kind === 'step' && r.name.startsWith('prompt-') && r.state === 'done').map((r) => [Boolean(r.result.chatId), r.result.archived])).toEqual([[true, true], [true, true]]);
    const connect = parsed(out.lines).find((e) => e.step === 'connect');
    expect(connect.grantedScopes).toEqual(['cadence.behaviors.write', 'cadence.occurrences.write', 'cadence.read']);
    expect(state.connectors).toEqual([{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }]);
    expect(state.enabled).toBe(true);
    const write = parsed(out.lines).find((e) => e.step === 'prompt-write');
    expect(write.approvalCount).toBe(1);
    expect(write.replyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.behaviors).toHaveLength(1);
    expect(state.behaviors[0].title).toMatch(/^Review practice web-test-\d+$/);
    expect(activeGrants()).toHaveLength(0);
    const inputs = out.run.cleanupInputs();
    expect(inputs.grants).toHaveLength(1);
    expect(inputs.creations[0].behaviorId).toBe(state.behaviors[0].id);
    expect(out.cookiesLeft).toBe(0);
    expect(runFiles(out.run).some((f) => f.endsWith('.png'))).toBe(false);
    assertNoLeaks(out);
  }, 120_000);

  it('follows the live layout seen in Ticket 256: account-menu reconnect, plugin mention, turn state, "Chat actions"', async () => {
    resetState({ layout2026: true, connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: true }] });
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(parsed(out.lines).map((e) => e.step)).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read', 'prompt-write', 'creation-checkpoint', 'creation-reminders', 'archive-chats', 'watcher', 'revoke']);
    expect(state.enabled).toBe(true);
    // The mention survived: every prompt starts with it and still carries the canned text.
    expect(state.messages).toHaveLength(2);
    expect(state.messages.every((m) => m.startsWith('Cadence QA') && m.includes('[Cadence QA]'))).toBe(true);
    expect(state.chats).toHaveLength(2);
    expect(state.chats.every((c) => c.archived)).toBe(true);
    expect(state.otherChats.every((c) => !c.archived)).toBe(true);
    expect(state.behaviors).toHaveLength(1);
    expect(activeGrants()).toHaveLength(0);
    assertNoLeaks(out);
  }, 120_000);

  it('steps up from a read-only grant when the write is denied', async () => {
    resetState({ requestScopes: ['cadence.read'], stepUp: true });
    const out = await scenario('chatgpt', 'step-up');
    expect(out.result.ok, out.lines.join('\n')).toBe(true);
    const write = parsed(out.lines).find((e) => e.step === 'prompt-write');
    expect(write.consentCount).toBe(1);
    expect(state.activity.map((a) => `${a.operation}:${a.outcome}`)).toEqual(['create_behavior:success', 'create_behavior:denied', 'list_behaviors:success']);
    assertNoLeaks(out);
  }, 120_000);

  it('stops with no-step-up when ChatGPT never asks again', async () => {
    resetState({ requestScopes: ['cadence.read'], stepUp: false });
    const out = await scenario('chatgpt', 'step-up');
    expect(out.result).toMatchObject({ ok: false, reason: 'no-step-up', step: 'prompt-write' });
    expect(out.lines.some((l) => l.startsWith('guided-fallback chatgpt reason=no-step-up'))).toBe(true);
    assertNoLeaks(out);
  }, 120_000);

  it('records Deny with no grant', async () => {
    const out = await scenario('chatgpt', 'deny');
    expect(out.result.ok, out.lines.join('\n')).toBe(true);
    expect(state.grants).toHaveLength(0);
    expect(parsed(out.lines).find((e) => e.step === 'deny-check').grantCount).toBe(0);
  }, 120_000);
});
