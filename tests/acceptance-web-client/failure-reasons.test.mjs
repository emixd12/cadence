// Ticket 255: each reason a web run stops, with its guided fallback. See harness.mjs.
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as cleanupModule from '../../scripts/mcp-acceptance-cleanup.mjs';
import { assertNoLeaks, fakeWatcher, iso, parsed, resetState, runFiles, scenario, state, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('failure reasons', () => {
  const expectStop = async (client, name, reason, step, overrides = {}, opts = {}) => {
    resetState(overrides);
    const out = await scenario(client, name, opts);
    expect(out.result).toMatchObject({ ok: false, reason, step });
    expect(out.lines.some((l) => l.startsWith(`guided-fallback ${client} reason=${reason}`))).toBe(true);
    expect(out.cookiesLeft).toBe(0);
    assertNoLeaks(out);
    return out;
  };

  it('login wall, with a screenshot kept in the run folder only', async () => {
    const out = await expectStop('chatgpt', 'read-write', 'login-wall', 'connector-settings', { loginWall: true });
    const shot = runFiles(out.run).find((f) => f.endsWith('.png'));
    expect(shot).toBeTruthy();
    expect(statSync(shot).mode & 0o777).toBe(0o600);
    expect(parsed(out.lines).at(-1).screenshot).toBe('failure-connector-settings.png');
  }, 60_000);
  it('bot check', () => expectStop('claude-web', 'read-write', 'bot-check', 'connector-settings', { botCheck: true }), 60_000);
  it('changed page', () => expectStop('claude-web', 'read-write', 'page-changed', 'connector-create', { missingCreate: true, connectors: [] }), 60_000);
  it('a missing ChatGPT app, which the runner does not create', () => expectStop('chatgpt', 'read-write', 'connector-missing', 'connector-create', { connectors: [] }), 60_000);
  it('wrong Cadence account on the consent page, before clicking', async () => {
    await expectStop('chatgpt', 'read-write', 'consent-wrong-account', 'consent', { consentAccountId: cleanupModule.USERS.B });
    expect(state.consentCount).toBe(0);
    expect(state.grants).toHaveLength(0);
  }, 60_000);
  it('reply timeout', () => expectStop('chatgpt', 'read-write', 'reply-timeout', 'chat-reply', { neverReply: true },
    { timeouts: { consentMs: 15_000, turnMs: 3_000, quietMs: 300 } }), 60_000);
  it('tool approval timeout', () => expectStop('claude-web', 'read-write', 'tool-approval-timeout', 'chat-reply', { endlessAfterApproval: true, approvalsPerTool: 2 },
    { timeouts: { consentMs: 15_000, turnMs: 3_000, quietMs: 300 } }), 60_000);
  it('watcher unsatisfied', () => expectStop('chatgpt', 'read-write', 'watcher-unsatisfied', 'watcher', {}, { watcher: fakeWatcher(() => 1) }), 120_000);
  it("an active Ticket 232 grant stops the run before any page opens", async () => {
    resetState({ grants: [{ grant_id: '5d764426-0000-4000-8000-000000000000', client_id: 'x', client_name: 'Claude', scopes: ['cadence.read'], created_at: iso() }] });
    const watcher = fakeWatcher();
    const out = await scenario('claude-web', 'read-write', { watcher });
    expect(out.result).toMatchObject({ ok: false, reason: 'ticket-232-grants-active', step: 'preflight' });
    expect(watcher.started).toBe(0);
    expect(state.consentCount).toBe(0);
    expect(state.connectors[0].connected).toBe(false);
    expect(out.lines.join('\n')).not.toContain('5d764426');
    expect(runFiles(out.run).map((f) => readFileSync(f, 'utf8')).join('\n')).not.toContain('5d764426');
  }, 60_000);
  it('an active grant for the same client stops the run', () => expectStop('chatgpt', 'read-write', 'client-grant-active', 'preflight',
    { grants: [{ grant_id: randomUUID(), client_id: 'c', client_name: 'ChatGPT', scopes: ['cadence.read'], created_at: iso() }] }), 60_000);
});
