// Ticket 255: pages on which test chat cleanup refuses to act. See harness.mjs.
import { describe, expect, it } from 'vitest';
import { assertNoLeaks, resetState, scenario, state, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('test chat cleanup', () => {
  // Every case below has Emi's other chats in the sidebar with same-named buttons
  // first in DOM order. Claude cases opt in to deletion (deleteClaudeChats).
  const opt = (client) => ({ deleteClaudeChats: client === 'claude-web' });
  for (const client of ['chatgpt', 'claude-web']) {
    it(`${client}: stops with page-changed and touches nothing when the conversation has two matching menus`, async () => {
      resetState({ duplicateOptions: true });
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result).toMatchObject({ ok: false, reason: 'page-changed', step: 'chat-archive' });
      expect([...state.chats, ...state.otherChats].some((c) => c.archived)).toBe(false);
      assertNoLeaks(out);
    }, 120_000);

    it(`${client}: refuses a history row's control inside main when the header has none, before any click`, async () => {
      resetState({ historyInMain: true, noHeaderControl: true });
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result).toMatchObject({ ok: false, reason: 'page-changed', step: 'chat-archive' });
      expect([...state.chats, ...state.otherChats].some((c) => c.archived)).toBe(false);
      assertNoLeaks(out);
    }, 120_000);

    it(`${client}: refuses when the conversation root links to another chat anywhere, before any click`, async () => {
      resetState({ otherLinkInMain: true });
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result).toMatchObject({ ok: false, reason: 'page-changed', step: 'chat-archive' });
      expect([...state.chats, ...state.otherChats].some((c) => c.archived)).toBe(false);
    }, 120_000);

    it(`${client}: refuses when no other chats are listed, because damage could not be detected`, async () => {
      resetState({ otherChats: [] });
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result).toMatchObject({ ok: false, reason: 'no-other-chats-listed', step: 'chat-archive' });
      expect(state.chats.some((c) => c.archived)).toBe(false);
    }, 120_000);
  }
});
