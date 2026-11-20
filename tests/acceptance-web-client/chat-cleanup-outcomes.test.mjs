// Ticket 255: what test chat cleanup archives, deletes, keeps and reports. See harness.mjs.
import { describe, expect, it } from 'vitest';
import * as cleanupModule from '../../scripts/mcp-acceptance-cleanup.mjs';
import { createRun } from '../../scripts/acceptance/ledger.mjs';
import { runWebScenario } from '../../scripts/acceptance/web-client.mjs';
import {
  EMAIL_A, ISSUER, OTHER_TITLE, USER_A, assertNoLeaks, browser, fakeWatcher, nextLabel, parsed, resetState, rest, root,
  scenario, sessions, state, stubSite, startWebClientHarness,
} from './harness.mjs';

startWebClientHarness();

describe('test chat cleanup', () => {
  // Every case below has Emi's other chats in the sidebar with same-named buttons
  // first in DOM order. Claude cases opt in to deletion (deleteClaudeChats).
  const opt = (client) => ({ deleteClaudeChats: client === 'claude-web' });
  const untouched = () => expect(state.otherChats.every((c) => !c.archived)).toBe(true);
  for (const client of ['chatgpt', 'claude-web']) {
    it(`${client}: archives only the run's own chat when sidebar buttons share the name and come first`, async () => {
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
      expect(state.chats.every((c) => c.archived)).toBe(true);
      untouched();
    }, 120_000);

    it(`${client}: reports another chat that disappeared, with its title, and never the wrong reason`, async () => {
      resetState({ archiveAlsoOther: true });
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result).toMatchObject({ ok: false, reason: 'archive-touched-other-chat', step: 'chat-archive' });
      const stopLine = parsed(out.lines).find((e) => e.reason === 'archive-touched-other-chat');
      expect(stopLine.affectedChats).toEqual([{ chatId: state.otherChats[0].id, title: `${OTHER_TITLE} ${state.otherChats[0].id.slice(0, 4)}` }]);
      assertNoLeaks(out);
    }, 120_000);

    it(`${client}: a timeout after the click still reports another chat that disappeared`, async () => {
      resetState({ archiveAlsoOther: true, stayAfterArchive: true });
      const out = await scenario(client, 'read-write', opt(client));
      expect(out.result).toMatchObject({ ok: false, reason: 'archive-touched-other-chat', step: 'chat-archive' });
    }, 120_000);
  }

  it('claude-web: keeps test chats by default and deletes them only with deleteClaudeChats', async () => {
    const kept = await scenario('claude-web', 'read-write');
    expect(kept.result, kept.lines.join('\n')).toMatchObject({ ok: true });
    expect(parsed(kept.lines).filter((e) => e.step.startsWith('prompt-')).map((e) => e.archived)).toEqual([false, false]);
    expect(parsed(kept.lines).find((e) => e.step === 'archive-chats')).toMatchObject({ chatCount: 2, archivedCount: 0, keptCount: 2, unknownCount: 0 });
    expect(state.chats.some((c) => c.archived)).toBe(false);
    expect(state.messages.every((m) => m.startsWith('[Cadence QA] '))).toBe(true);
    resetState();
    const deleted = await scenario('claude-web', 'read-write', { deleteClaudeChats: true });
    expect(deleted.result.ok).toBe(true);
    expect(parsed(deleted.lines).find((e) => e.step === 'archive-chats')).toMatchObject({ chatCount: 2, archivedCount: 2, keptCount: 0 });
    expect(state.chats.every((c) => c.archived)).toBe(true);
  }, 240_000);

  it('claude-web live layout: deletes only the run\'s chats through "More options for <title>"', async () => {
    // Sidebar rows carry the same name; only the conversation header's control may match.
    resetState({ layout2026: true });
    const out = await scenario('claude-web', 'read-write', { deleteClaudeChats: true });
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    expect(parsed(out.lines).find((e) => e.step === 'archive-chats')).toMatchObject({ chatCount: 2, archivedCount: 2, keptCount: 0 });
    expect(state.chats.every((c) => c.archived)).toBe(true);
    expect(state.otherChats.every((c) => !c.archived)).toBe(true);
  }, 120_000);

  it('keeps the chats only when asked (archiveChats: false)', async () => {
    state.flavor = 'chatgpt';
    const context = await browser.newContext();
    const run = createRun({ target: 'local', accounts: ['A'], scenarios: ['chatgpt:read-write'], root });
    const lines = [];
    try {
      const result = await runWebScenario({
        site: stubSite('chatgpt'), context, issuer: ISSUER, mcpUrl: `${ISSUER}/mcp`, slot: 'A', scenario: 'read-write',
        account: { userId: USER_A, email: EMAIL_A }, sessions, rest, cleanup: cleanupModule, watcher: fakeWatcher(), run,
        label: nextLabel(), out: (line) => lines.push(line), archiveChats: false,
        timeouts: { consentMs: 15_000, turnMs: 15_000, quietMs: 300 },
      });
      expect(result.ok, lines.join('\n')).toBe(true);
    } finally { run.close(); await context.close(); }
    expect(parsed(lines).map((e) => e.step)).not.toContain('archive-chats');
    expect(state.chats.some((c) => c.archived)).toBe(false);
  }, 120_000);
});
