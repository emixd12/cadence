// Ticket 255: failure screenshots, sign-in status and the dry run. See harness.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dryRunSite, signInStatus } from '../../scripts/acceptance/web-client.mjs';
import { FAKE_COOKIE, ISSUER, browser, parsed, resetState, root, runFiles, scenario, state, stubSite, startWebClientHarness } from './harness.mjs';

startWebClientHarness();

describe('failure screenshots on real sites', () => {
  const pngHeight = (file) => readFileSync(file).readUInt32BE(20);
  it('takes none by default', async () => {
    resetState({ loginWall: true });
    const out = await scenario('chatgpt', 'read-write', { screenshots: 'off' });
    expect(out.result).toMatchObject({ ok: false, reason: 'login-wall' });
    expect(runFiles(out.run).some((f) => f.endsWith('.png'))).toBe(false);
    expect(parsed(out.lines).at(-1).screenshot).toBeNull();
  }, 120_000);

  it('with --screenshots, captures only the conversation area, never the sidebar', async () => {
    resetState({ neverReply: true });
    const out = await scenario('chatgpt', 'read-write', { screenshots: 'conversation', timeouts: { consentMs: 15_000, turnMs: 3_000, quietMs: 300 } });
    expect(out.result).toMatchObject({ ok: false, reason: 'reply-timeout' });
    const shot = runFiles(out.run).find((f) => f.endsWith('.png'));
    expect(shot).toBeTruthy();
    // An element shot of <main> (the conversation header), much shorter than the 720 px viewport with the sidebar.
    expect(pngHeight(shot)).toBeLessThan(200);
  }, 120_000);

  it('with --screenshots, skips the shot when the conversation area shows other chats', async () => {
    resetState({ neverReply: true, historyInMain: true });
    const out = await scenario('chatgpt', 'read-write', { screenshots: 'conversation', timeouts: { consentMs: 15_000, turnMs: 3_000, quietMs: 300 } });
    expect(out.result).toMatchObject({ ok: false, reason: 'reply-timeout' });
    expect(runFiles(out.run).some((f) => f.endsWith('.png'))).toBe(false);
  }, 120_000);
});

describe('sign-in status', () => {
  it('reads cookie names only and ignores expired cookies', async () => {
    const context = await browser.newContext();
    try {
      const future = Math.floor(Date.now() / 1000) + 3600;
      await context.addCookies([
        { name: '__Secure-next-auth.session-token.0', value: FAKE_COOKIE, url: 'https://chatgpt.com', expires: future, secure: true },
        { name: 'sessionKey', value: FAKE_COOKIE, url: 'https://claude.ai', expires: Math.floor(Date.now() / 1000) + 5, secure: true },
      ]);
      expect(await signInStatus({ context })).toEqual({ chatgpt: true, 'claude-web': true });
      expect(await signInStatus({ context, now: () => Date.now() + 60_000 })).toEqual({ chatgpt: true, 'claude-web': false });
      expect(JSON.stringify(await signInStatus({ context }))).not.toContain(FAKE_COOKIE);
    } finally { await context.close(); }
  });
});

describe('dry run', () => {
  it('reaches the connector settings and finds the connector without changing anything', async () => {
    const context = await browser.newContext();
    try {
      const gpt = await dryRunSite({ context, site: stubSite('chatgpt') });
      expect(gpt).toEqual({ client: 'chatgpt', ok: true, reached: 'connector-settings', connectorPresent: true });
      const claude = await dryRunSite({ context, site: stubSite('claude-web') });
      expect(claude).toEqual({ client: 'claude-web', ok: true, reached: 'connector-settings', connectorPresent: true });
      expect(state.consentCount).toBe(0);
      expect(state.connectors).toEqual([{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: false }]);
      resetState({ connectors: [] });
      expect(await dryRunSite({ context, site: stubSite('chatgpt') })).toMatchObject({ ok: true, connectorPresent: false });
      resetState({ loginWall: true });
      const dir = join(root, 'dry');
      expect(await dryRunSite({ context, site: stubSite('claude-web'), screenshotDir: dir, screenshots: 'full' })).toMatchObject({ ok: false, reason: 'login-wall', screenshot: 'failure-dry-run-claude-web.png' });
    } finally { await context.close(); }
  }, 60_000);
});
