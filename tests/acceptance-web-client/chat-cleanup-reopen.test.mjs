// Ticket 255: test chat cleanup when the run has to reopen its own chat. See harness.mjs.
import { describe, expect, it } from 'vitest';
import { assertNoLeaks, parsed, resetState, scenario, state, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('test chat cleanup', () => {
  it('retries an archive that failed after the reply by opening only that chat', async () => {
    resetState({ archiveInlineBroken: true });
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(parsed(out.lines).filter((e) => e.step.startsWith('prompt-')).map((e) => e.archived)).toEqual([false, false]);
    expect(parsed(out.lines).find((e) => e.step === 'archive-chats')).toMatchObject({ chatCount: 2, archivedCount: 2 });
    expect(state.chats.every((c) => c.archived)).toBe(true);
    // The only chat pages opened by URL are the run's own two chats.
    expect(state.openedPaths.filter((p) => p.startsWith('/c/')).sort()).toEqual(state.chats.flatMap((c) => [`/c/${c.id}`, `/c/${c.id}`]).sort());
    expect(state.otherChats.every((c) => !c.archived)).toBe(true);
    assertNoLeaks(out);
  }, 120_000);

  // Every case below has Emi's other chats in the sidebar with same-named buttons
  // first in DOM order. Claude cases opt in to deletion (deleteClaudeChats).
  const opt = (client) => ({ deleteClaudeChats: client === 'claude-web' });
  for (const client of ['chatgpt', 'claude-web']) {
    it(`${client}: stops with page-changed and touches nothing when the reopened URL is not the run's chat`, async () => {
      resetState({ archiveInlineBroken: true, redirectOnOpen: true });
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result).toMatchObject({ ok: false, reason: 'page-changed', step: 'chat-archive' });
      expect([...state.chats, ...state.otherChats].some((c) => c.archived)).toBe(false);
    }, 120_000);
  }
});
