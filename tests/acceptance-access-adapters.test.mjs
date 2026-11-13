// Ticket 293: exit-code mapping of the test-access adapters, with stubs only
// (no network, no Keychain, no browser, no SSH).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main as agentStep } from '../scripts/acceptance/access/agent-step.mjs';
import { classifyPermission, cookieUserId, main as browser } from '../scripts/acceptance/access/browser.mjs';
import { main as cadenceSession } from '../scripts/acceptance/access/cadence-session.mjs';
import { classifyConsent, main as calendar } from '../scripts/acceptance/access/calendar.mjs';
import { main as connection } from '../scripts/acceptance/access/connection.mjs';
import { linkQuery, main as device, notificationsAllowed } from '../scripts/acceptance/access/device.mjs';
import { classifySignIn, main as google } from '../scripts/acceptance/access/google.mjs';
import { dotenvCandidates, envFileSets, main as host, onPath, profileExpiry } from '../scripts/acceptance/access/host.mjs';
import { main as keychain } from '../scripts/acceptance/access/keychain.mjs';
import { signInStop } from '../scripts/acceptance/access/lib.mjs';
import { main as record } from '../scripts/acceptance/access/record.mjs';
import { main as vault } from '../scripts/acceptance/access/vault.mjs';
import { CLIENT_ACCOUNT, CLIENT_SERVICE, TOKEN_SERVICE } from '../scripts/acceptance/google-calendar-fixtures.mjs';
import { AcceptanceError, PRODUCTION } from '../scripts/acceptance/test-account-sessions.mjs';

const FAKE_VALUE = 'fake-secret-value-0001';

/** Captures adapter output; returns the parsed last line too. */
function capture() {
  const lines = [];
  const out = (line) => lines.push(line);
  return { out, lines, last: () => JSON.parse(lines.at(-1)) };
}

const proc = (status, stdout = '', stderr = '', error = null) => vi.fn(() => ({ status, stdout, stderr, error }));

function expectNoSecret(lines) {
  for (const line of lines) expect(line).not.toContain(FAKE_VALUE);
}

describe('signInStop', () => {
  it('maps Google stops a script cannot pass, and rejected credentials, to owner stop ids', () => {
    expect(signInStop('signin-phone-prompt')).toBe('phone-prompt');
    expect(signInStop('captcha')).toBe('captcha');
    expect(signInStop('signin-password-rejected')).toBe('credentials-rejected');
    expect(signInStop('stuck-waiting')).toBeNull();
  });
});

describe('vault.mjs', () => {
  it('maps agent-secret --check results for --item', async () => {
    const cases = [
      [proc(0, 'items: google-test-account-a'), 0],
      [proc(4), 21],
      [proc(6, 'TEST_ACCESS_ITEM=google-test-account-b/credential: missing'), 21],
      [proc(6, '', 'agent-secret: op vault list failed (token_rejected)'), 20],
      [proc(6, '', 'agent-secret: op vault list failed (op_timeout)'), 1],
      [proc(null, '', '', 'ENOENT'), 1],
    ];
    for (const [run, code] of cases) {
      const io = capture();
      expect(await vault(['--item', 'google-test-account-b'], { run, out: io.out })).toBe(code);
    }
  });

  it('passes the item through a fixed variable name and never an inline secret', async () => {
    const run = proc(0);
    await vault(['--item', 'anthropic-api-key'], { run, out: () => {} });
    expect(run.mock.calls[0][1]).toEqual([expect.stringMatching(/agent-secret\.mjs$/), '--check', '--env', 'TEST_ACCESS_ITEM=anthropic-api-key']);
  });

  it('checks the token and its vault scope with --token', async () => {
    expect(await vault(['--token'], { run: proc(0), out: () => {} })).toBe(0);
    expect(await vault(['--token'], { run: proc(6, '', 'agent-secret: the service account can reach other vaults (X)'), out: () => {} })).toBe(20);
  });

  it('rejects bad usage', async () => {
    expect(await vault([], { run: proc(0), out: () => {} })).toBe(2);
    expect(await vault(['--item', 'NAME=value'], { run: proc(0), out: () => {} })).toBe(2);
    expect(await vault(['--token', '--item', 'x'], { run: proc(0), out: () => {} })).toBe(2);
  });
});

describe('keychain.mjs', () => {
  it('maps security exit codes without reading the value', async () => {
    const run = proc(0);
    expect(await keychain(['--service', 'cadence-qa-oauth-session', '--account', 'production:A'], { run, out: () => {} })).toBe(0);
    expect(run.mock.calls[0][1]).not.toContain('-w');
    expect(await keychain(['--service', 's', '--account', 'a'], { run: proc(44), out: () => {} })).toBe(21);
    expect(await keychain(['--service', 's', '--account', 'a'], { run: proc(51), out: () => {} })).toBe(1);
    expect(await keychain(['--service', 's'], { run: proc(0), out: () => {} })).toBe(2);
  });
});

describe('calendar.mjs', () => {
  const clientJson = Buffer.from(JSON.stringify({ installed: { client_id: 'id', client_secret: FAKE_VALUE } })).toString('base64');
  const keychainWith = (items) => vi.fn(async (service, account) => items[`${service}|${account}`] ?? null);
  const tokenFetch = (status, body) => vi.fn(async () => ({ ok: status === 200, status, json: async () => body }));

  it('probes the client: present, missing, invalid', async () => {
    const io = capture();
    expect(await calendar(['client'], { out: io.out, deps: { read: keychainWith({ [`${CLIENT_SERVICE}|${CLIENT_ACCOUNT}`]: clientJson }) } })).toBe(0);
    expect(await calendar(['client'], { out: io.out, deps: { read: keychainWith({}) } })).toBe(21);
    expect(await calendar(['client'], { out: io.out, deps: { read: keychainWith({ [`${CLIENT_SERVICE}|${CLIENT_ACCOUNT}`]: 'bm90IGpzb24=' }) } })).toBe(20);
    expectNoSecret(io.lines);
  });

  it('probes the grant with one token refresh: ok, no grant, invalid_grant, server error', async () => {
    const read = keychainWith({ [`${CLIENT_SERVICE}|${CLIENT_ACCOUNT}`]: clientJson, [`${TOKEN_SERVICE}|production:A`]: FAKE_VALUE });
    const io = capture();
    expect(await calendar(['grant', '--slot', 'A'], { out: io.out, deps: { read, fetch: tokenFetch(200, { access_token: FAKE_VALUE }) } })).toBe(0);
    expect(await calendar(['grant', '--slot', 'B'], { out: io.out, deps: { read, fetch: tokenFetch(200, {}) } })).toBe(21);
    expect(await calendar(['grant', '--slot', 'A'], { out: io.out, deps: { read, fetch: tokenFetch(400, { error: 'invalid_grant' }) } })).toBe(20);
    expect(await calendar(['grant', '--slot', 'A'], { out: io.out, deps: { read, fetch: tokenFetch(500, {}) } })).toBe(1);
    expectNoSecret(io.lines);
  });

  it('renews through agent-secret and maps consent stops', async () => {
    const run = proc(0, '{"slot":"A","state":"consented"}');
    expect(await calendar(['consent', '--slot', 'A'], { run, out: () => {} })).toBe(0);
    const args = run.mock.calls[0][1];
    expect(args).toContain('GOOGLE_TEST_PASSWORD=google-test-account-a/password');
    expect(args.slice(args.indexOf('--') + 1).slice(1)).toEqual([expect.stringMatching(/google-calendar-fixtures\.mjs$/), 'consent', '--slot', 'A']);

    const io = capture();
    expect(await calendar(['consent', '--slot', 'A'], { run: proc(3, 'step x\n{"slot":"A","state":"stopped","reason":"signin-captcha"}'), out: io.out })).toBe(30);
    expect(io.last()).toEqual({ detail: 'sign-in stopped: captcha', stop: 'captcha' });
    expect(classifyConsent({ status: 3, stdout: '{"reason":"access-denied-not-a-test-user"}' })).toMatchObject({ code: 30, stop: 'not-a-test-user' });
    expect(classifyConsent({ status: 3, stdout: '{"reason":"consent-timeout"}' }).code).toBe(1);
    expect(classifyConsent({ status: 5, stdout: '' }).code).toBe(1);
  });

  it('rejects bad usage', async () => {
    expect(await calendar(['grant'], { out: () => {} })).toBe(2);
    expect(await calendar(['nope'], { out: () => {} })).toBe(2);
  });
});

/** A fake attached profile whose one tab reports `url` and `content`, and counts tabs. */
function authCookies(userId, { chunks = 1, prefix = true } = {}) {
  const json = JSON.stringify({ access_token: 'header.payload.signature', user: { id: userId } });
  const value = prefix ? `base64-${Buffer.from(json).toString('base64url')}` : json;
  if (chunks === 1) return [{ name: 'sb-abc-auth-token', value }];
  const size = Math.ceil(value.length / chunks);
  return Array.from({ length: chunks }, (_, index) => ({ name: `sb-abc-auth-token.${index}`, value: value.slice(index * size, (index + 1) * size) })).reverse();
}

function fakeProfile({ url = 'https://myaccount.google.com/', content = '', status = 200, permission = 'granted', cookies = [] } = {}) {
  const tabs = { opened: 0, closed: 0 };
  const page = {
    goto: vi.fn(async () => ({ status: () => status })),
    waitForTimeout: vi.fn(async () => {}),
    url: () => url,
    content: async () => content,
    evaluate: vi.fn(async () => permission),
    close: vi.fn(async () => { tabs.closed += 1; }),
  };
  const context = { newPage: vi.fn(async () => { tabs.opened += 1; return page; }), cookies: vi.fn(async () => cookies), clearCookies: vi.fn(async () => {}) };
  const detach = vi.fn(async () => {});
  const attach = vi.fn(async () => ({ context, detach }));
  return { attach, page, tabs, detach };
}

describe('google.mjs', () => {
  it('probes in one new tab and closes only that tab', async () => {
    const signedIn = fakeProfile({ content: '<html>cadence.testing.is@gmail.com</html>' });
    expect(await google(['session', '--slot', 'A'], { attach: signedIn.attach, out: () => {} })).toBe(0);
    expect(signedIn.tabs).toEqual({ opened: 1, closed: 1 });
    expect(signedIn.detach).toHaveBeenCalled();

    const signedOut = fakeProfile({ url: 'https://accounts.google.com/signin' });
    expect(await google(['session', '--slot', 'A'], { attach: signedOut.attach, out: () => {} })).toBe(21);
    expect(signedOut.tabs).toEqual({ opened: 1, closed: 1 });

    const closed = vi.fn(async () => { throw Object.assign(new Error('x'), { reason: 'profile-not-open' }); });
    const io = capture();
    expect(await google(['session', '--slot', 'B'], { attach: closed, out: io.out })).toBe(1);
    expect(io.last().detail).toContain('profile-not-open');
  });

  it('renews through agent-secret and maps sign-in stops', async () => {
    const run = proc(0, '{"slot":"B","state":"signed-in"}');
    expect(await google(['signin', '--slot', 'B'], { run, out: () => {} })).toBe(0);
    expect(run.mock.calls[0][1]).toContain('GOOGLE_TEST_OTP=google-test-account-b/one-time password');
    expect(classifySignIn({ status: 3, stdout: '{"reason":"phone-prompt"}' })).toMatchObject({ code: 30, stop: 'phone-prompt' });
    expect(classifySignIn({ status: 3, stdout: '{"reason":"password-rejected"}' })).toMatchObject({ code: 30, stop: 'credentials-rejected' });
    expect(classifySignIn({ status: 3, stdout: '{"reason":"stuck-waiting"}' }).code).toBe(1);
    expect(classifySignIn({ status: 4, stdout: '' }).code).toBe(1);
  });
});

/** A fake session manager. `current` either resolves or throws the given code. */
function fakeSessions({ currentError = null, grants = [] } = {}) {
  return {
    current: vi.fn(async () => { if (currentError) throw new AcceptanceError(currentError); return { accessToken: FAKE_VALUE }; }),
    userRpc: vi.fn(async () => grants),
  };
}

describe('cadence-session.mjs', () => {
  it('maps the kept session state', async () => {
    const cases = [[null, 0], ['session-missing', 21], ['session-refresh-failed', 20], ['session-invalid', 20], ['wrong-account', 1], ['session-verify-failed', 1]];
    for (const [currentError, code] of cases) {
      const io = capture();
      expect(await cadenceSession(['status', '--slot', 'A'], { sessions: fakeSessions({ currentError }), out: io.out })).toBe(code);
      expectNoSecret(io.lines);
    }
  });

  it('counts claude.ai grants', async () => {
    const run = (grants) => cadenceSession(['claude-grant', '--slot', 'A'], { sessions: fakeSessions({ grants }), out: () => {} });
    expect(await run([{ verified_client: 'claude' }, { verified_client: 'chatgpt' }])).toBe(0);
    expect(await run([])).toBe(21);
    expect(await run([{ verified_client: 'claude' }, { verified_client: 'claude' }])).toBe(1);
  });

  it('reads travel settings as booleans only', async () => {
    const ready = { settings: { enabled: true, routing_consent_at: '2026-11-06T22:16:00Z', base_location_text: 'Home text' }, leave: { enabled: true } };
    const io = capture();
    expect(await cadenceSession(['travel', '--slot', 'A'], { sessions: fakeSessions(), travel: async () => ready, out: io.out })).toBe(0);
    expect(await cadenceSession(['travel', '--slot', 'A'], { sessions: fakeSessions(), travel: async () => ({ ...ready, leave: { enabled: false } }), out: io.out })).toBe(21);
    expect(io.last().detail).toBe('leave-reminders-off');
    expect(io.lines.join('\n')).not.toContain('Home text');
  });

  it('maps enrollment results', async () => {
    expect(await cadenceSession(['enroll', '--slot', 'A'], { enrollImpl: async () => {}, out: () => {} })).toBe(0);
    const io = capture();
    expect(await cadenceSession(['enroll', '--slot', 'A'], { enrollImpl: async () => { throw new AcceptanceError('enroll-timeout'); }, out: io.out })).toBe(30);
    expect(io.last().stop).toBe('enroll-timeout');
    expect(await cadenceSession(['enroll', '--slot', 'B'], { enrollImpl: async () => { throw new AcceptanceError('enroll-wrong-account'); }, out: () => {} })).toBe(1);
    expect(await cadenceSession(['enroll'], { out: () => {} })).toBe(2);
  });
});

describe('connection.mjs', () => {
  const answer = (status, body) => vi.fn(async () => ({ status, json: async () => body }));

  it('maps connector status read with the kept session', async () => {
    const cases = [
      [answer(200, { status: 'connected' }), 0],
      [answer(200, { status: 'reconnect_required' }), 20],
      [answer(200, { status: 'disconnected' }), 21],
      [answer(200, { status: 'not_configured' }), 1],
      [answer(401, { error: 'unauthenticated' }), 1],
    ];
    for (const [fetchImpl, code] of cases) {
      expect(await connection(['status', '--slot', 'A', '--connector', 'hevy'], { sessions: fakeSessions(), fetchImpl, out: () => {} })).toBe(code);
    }
    const fetchImpl = answer(200, { status: 'connected' });
    await connection(['status', '--slot', 'A', '--connector', 'outlook-calendar'], { sessions: fakeSessions(), fetchImpl, out: () => {} });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://app.cadence-me.com/api/outlook-calendar/connection');
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
  });

  it('connects through agent-secret with the vault item fields', async () => {
    const run = proc(0, '{"state":"connected"}');
    expect(await connection(['connect', '--slot', 'A', '--connector', 'icloud-calendar'], { run, out: () => {} })).toBe(0);
    const args = run.mock.calls[0][1];
    expect(args).toContain('CONNECTOR_ICLOUD_APPLE_ID=icloud-test-account-a/username');
    expect(args).toContain('CONNECTOR_ICLOUD_APP_PASSWORD=icloud-test-account-a/password');
    expect(args.at(-1)).toBe('--from-env');
    const io = capture();
    expect(await connection(['connect', '--slot', 'A', '--connector', 'hevy'], { run: proc(3, '{"state":"rejected"}'), out: io.out })).toBe(30);
    expect(io.last().stop).toBe('credential-rejected');
    expect(await connection(['connect', '--slot', 'A', '--connector', 'hevy'], { run: proc(3, '{"state":"http-502"}'), out: () => {} })).toBe(1);
    expect(await connection(['connect', '--slot', 'A', '--connector', 'outlook-calendar'], { run, out: () => {} })).toBe(2);
  });

  it('the agent-secret child posts the credential once and prints only the state', async () => {
    const fetchImpl = answer(200, { status: 'connected' });
    const io = capture();
    const code = await connection(['connect', '--slot', 'A', '--connector', 'hevy', '--from-env'], {
      sessions: fakeSessions(), fetchImpl, out: io.out, env: { CONNECTOR_HEVY_API_KEY: FAKE_VALUE },
    });
    expect(code).toBe(0);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ apiKey: FAKE_VALUE });
    expect(io.lines).toEqual(['{"state":"connected"}']);
    const rejected = capture();
    expect(await connection(['connect', '--slot', 'A', '--connector', 'hevy', '--from-env'], {
      sessions: fakeSessions(), fetchImpl: answer(409, { error: 'reconnect_required' }), out: rejected.out, env: { CONNECTOR_HEVY_API_KEY: FAKE_VALUE },
    })).toBe(3);
    expect(rejected.lines).toEqual(['{"state":"rejected"}']);
  });
});

describe('browser.mjs', () => {
  it('probes the profile folder and its Chrome', async () => {
    expect(await browser(['profile'], { exists: () => true, owns: () => true, out: () => {} })).toBe(0);
    expect(await browser(['profile'], { exists: () => true, owns: () => false, out: () => {} })).toBe(21);
    expect(await browser(['profile'], { exists: () => false, owns: () => true, out: () => {} })).toBe(21);
  });

  it('reads the Cadence web session from a JSON route in one tab', async () => {
    const ok = fakeProfile({ status: 200, cookies: authCookies(PRODUCTION.accounts.A.userId) });
    expect(await browser(['cadence-web', '--slot', 'A'], { attach: ok.attach, out: () => {} })).toBe(0);
    expect(ok.tabs).toEqual({ opened: 1, closed: 1 });
    expect(ok.page.goto.mock.calls[0][0]).toBe('https://app.cadence-me.com/api/google-calendar/connection');
    expect(await browser(['cadence-web', '--slot', 'A'], { attach: fakeProfile({ status: 401 }).attach, out: () => {} })).toBe(21);
    expect(await browser(['cadence-web', '--slot', 'A'], { attach: fakeProfile({ status: 500 }).attach, out: () => {} })).toBe(1);
  });

  it('reports another account session as missing, never as the slot session', async () => {
    const asB = fakeProfile({ status: 200, cookies: authCookies(PRODUCTION.accounts.B.userId) });
    expect(await browser(['cadence-web', '--slot', 'A'], { attach: asB.attach, out: () => {} })).toBe(21);
    expect(await browser(['cadence-web', '--slot', 'A'], { attach: fakeProfile({ status: 200 }).attach, out: () => {} })).toBe(1);
    expect(await browser(['cadence-signin', '--slot', 'B'], { attach: asB.attach, out: () => {} })).toBe(0);
    expect(cookieUserId(authCookies('user-1', { chunks: 2 }))).toBe('user-1');
    expect(cookieUserId(authCookies('user-1', { prefix: false }))).toBe('user-1');
    expect(cookieUserId([{ name: 'sb-abc-auth-token', value: 'base64-not-json' }])).toBeNull();
  });

  it('reads permissions on robots.txt so no app code runs', async () => {
    const profile = fakeProfile({ permission: 'granted' });
    expect(await browser(['permission', '--name', 'notifications', '--expect', 'granted'], { attach: profile.attach, out: () => {} })).toBe(0);
    expect(profile.page.goto.mock.calls[0][0]).toBe('https://app.cadence-me.com/robots.txt');
    expect(profile.tabs).toEqual({ opened: 1, closed: 1 });
    expect(classifyPermission('prompt', 'denied').code).toBe(21);
    expect(classifyPermission(null, 'denied').code).toBe(1);
  });

  it('reads site sessions from cookie names without a tab', async () => {
    const profile = fakeProfile({ cookies: [] });
    expect(await browser(['site', '--site', 'chatgpt'], { attach: profile.attach, out: () => {} })).toBe(21);
    expect(profile.tabs.opened).toBe(0);
    expect(await browser(['site', '--site', 'other'], { attach: profile.attach, out: () => {} })).toBe(2);
  });
});

describe('device.mjs', () => {
  it('maps the inventory listing', async () => {
    expect(await device(['inventory', '--device', 'test-mac'], { run: proc(0, 'test-mac\tmacos\tTest Mac\n'), out: () => {} })).toBe(0);
    expect(await device(['inventory', '--device', 'test-mac'], { run: proc(0, 'other\tmacos\t\n'), out: () => {} })).toBe(21);
    expect(await device(['inventory', '--device', 'test-mac'], { run: proc(1, '', 'No device inventory at x'), out: () => {} })).toBe(21);
  });

  it('maps SSH reachability, Accessibility and Screen Recording', async () => {
    expect(await device(['reachable', '--device', 'test-mac'], { run: proc(0), out: () => {} })).toBe(0);
    expect(await device(['reachable', '--device', 'test-mac'], { run: proc(255, '', 'ssh: connect timed out'), out: () => {} })).toBe(21);
    expect(await device(['accessibility', '--device', 'test-mac'], { run: proc(1, '', 'execution error: (-1712)'), out: () => {} })).toBe(21);
    expect(await device(['accessibility', '--device', 'test-mac'], { run: proc(0), out: () => {} })).toBe(0);
    expect(await device(['screen-recording', '--device', 'test-mac'], { run: proc(1), out: () => {} })).toBe(21);
  });

  it('counts the account link without printing ids', async () => {
    const run = proc(0, '1\n');
    const io = capture();
    expect(await device(['cadence-link', '--device', 'test-mac', '--slot', 'A'], { run, out: io.out })).toBe(0);
    expect(run.mock.calls[0][1].at(-1)).toContain(linkQuery('A'));
    expect(io.lines.join('')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(await device(['cadence-link', '--device', 'test-mac', '--slot', 'A'], { run: proc(0, '0\n'), out: () => {} })).toBe(21);
    expect(await device(['cadence-link', '--local'], { run: proc(1, '', 'Error: unable to open database file'), out: () => {}, home: '/nowhere' })).toBe(21);
  });

  it('reads app permissions from Settings text', async () => {
    expect(await device(['app-permissions', '--device', 'test-mac'], { run: proc(0, 'AXStaticText: Notifications: Enabled on this device.\n'), out: () => {} })).toBe(0);
    expect(await device(['app-permissions', '--device', 'test-mac'], { run: proc(0, 'no match'), out: () => {} })).toBe(21);
  });

  it('reads the regrouped Settings and opens the Travel drawer for the location line', async () => {
    const calls = [];
    const run = (_cmd, args) => {
      calls.push(args.slice(3).join(' '));
      if (args[3] === 'read') return { status: 0, stdout: 'AXHeading: Notifications\nAXStaticText: macOS permission | macOS permission\nAXStaticText: Allowed | Allowed\n', stderr: '' };
      if (args[3] === 'press') return { status: 0, stdout: 'pressed\n', stderr: '' };
      const opened = calls.filter((call) => call.startsWith('press')).length === 1;
      return { status: 0, stdout: opened ? 'AXStaticText: Device location: allowed.\n' : 'no match\n', stderr: '' };
    };
    expect(await device(['app-permissions', '--device', 'test-mac'], { run, out: () => {} })).toBe(0);
    expect(calls.filter((call) => call.startsWith('press'))).toHaveLength(2);
    expect(notificationsAllowed({ status: 0, stdout: 'AXStaticText: macOS permission\nAXStaticText: Not allowed\n' }).stdout).toBe('no match\n');
  });

  it('reads allowed location while Travel is off and restores its setup drawer', async () => {
    const pressed = [];
    let open = false;
    const run = (_cmd, args) => {
      if (args[3] === 'read') return { status: 0, stdout: 'AXStaticText: macOS permission\nAXStaticText: Allowed\n', stderr: '' };
      if (args[3] === 'press') {
        pressed.push(args[5]);
        if (args[5] !== 'Set up Travel') return { status: 1, stdout: '', stderr: 'not found' };
        open = !open;
        return { status: 0, stdout: 'pressed\n', stderr: '' };
      }
      return { status: 0, stdout: open ? 'AXStaticText: Device location: allowed.\n' : 'no match\n', stderr: '' };
    };
    expect(await device(['app-permissions', '--device', 'test-mac'], { run, out: () => {} })).toBe(0);
    expect(pressed).toEqual(['Travel settings', 'Set up Travel', 'Set up Travel']);
    expect(open).toBe(false);
  });
});

describe('host.mjs', () => {
  it('checks paths, commands and signing identities', async () => {
    expect(await host(['--path', '~/x', '--path', '/y'], { exists: () => true, out: () => {} })).toBe(0);
    expect(await host(['--path', '~/x'], { exists: () => false, out: () => {} })).toBe(21);
    expect(await host(['--command', 'docker', '--command', 'psql'], { hasCommand: (name) => name !== 'psql', out: () => {} })).toBe(21);
    expect(onPath('node', dirname(process.execPath))).toBe(true);
    expect(onPath('cadence-no-such-command', dirname(process.execPath))).toBe(false);
    expect(await host(['--codesign', 'Developer ID Application: X (T)'], { run: proc(0, '  1) ABC "Developer ID Application: X (T)"\n'), out: () => {} })).toBe(0);
    expect(await host(['--codesign', 'Developer ID Application: X (T)'], { run: proc(0, '0 valid identities found'), out: () => {} })).toBe(21);
    expect(await host([], { out: () => {} })).toBe(2);
    expect(await host(['--path', 'a', '--command', 'b'], { out: () => {} })).toBe(2);
  });

  it('reports a provisioning profile expiry', async () => {
    const plist = '<key>ExpirationDate</key>\n\t<date>2027-03-01T00:00:00Z</date>';
    expect(profileExpiry(plist)).toBe('2027-03-01T00:00:00Z');
    const io = capture();
    expect(await host(['--profile-expiry', '/p'], { exists: () => true, run: proc(0, plist), out: io.out, now: () => Date.parse('2026-11-07T00:00:00Z') })).toBe(0);
    expect(io.last().expires_at).toBe('2027-03-01T00:00:00Z');
    expect(await host(['--profile-expiry', '/p'], { exists: () => true, run: proc(0, plist), out: () => {}, now: () => Date.parse('2027-04-01T00:00:00Z') })).toBe(20);
  });

  it('checks an env name without keeping or printing its value', async () => {
    expect(envFileSets(`A=1\nSEQUENZY_API_KEY="${FAKE_VALUE}"\n`, 'SEQUENZY_API_KEY')).toBe(true);
    expect(envFileSets('SEQUENZY_API_KEY=\n', 'SEQUENZY_API_KEY')).toBe(false);
    const io = capture();
    expect(await host(['--env-name', 'SEQUENZY_API_KEY', '--dotenv', '.env.local'], { exists: () => true, readFile: () => `SEQUENZY_API_KEY=${FAKE_VALUE}`, out: io.out })).toBe(0);
    expectNoSecret(io.lines);
    expect(await host(['--env-name', 'SEQUENZY_API_KEY', '--dotenv', '.env.local'], { exists: () => false, run: proc(128), out: () => {} })).toBe(21);
  });

  it('falls back from an agent worktree to the main checkout .env.local, and nowhere else', async () => {
    const base = mkdtempSync(join(tmpdir(), 'cadence-dotenv-'));
    try {
      const main = join(base, 'main');
      const worktree = join(base, 'worktrees', 'agent');
      mkdirSync(join(main, '.git'), { recursive: true });
      mkdirSync(worktree, { recursive: true });
      writeFileSync(join(main, '.env.local'), `SEQUENZY_API_KEY=${FAKE_VALUE}\nEMPTY_KEY=\n`);
      writeFileSync(join(base, '.env.local'), `OUTSIDE_KEY=${FAKE_VALUE}\n`);
      const git = vi.fn(() => ({ status: 0, stdout: `${join(main, '.git')}\n`, stderr: '', error: null }));
      const probe = async (name, path = '.env.local', run = git) => {
        const io = capture();
        const code = await host(['--env-name', name, '--dotenv', path], { run, cwd: worktree, out: io.out });
        expectNoSecret(io.lines);
        return { code, detail: io.last().detail };
      };

      expect(await probe('SEQUENZY_API_KEY')).toEqual({ code: 0, detail: 'name set in main checkout' });
      expect(git).toHaveBeenCalledWith('git', ['rev-parse', '--git-common-dir'], expect.objectContaining({ cwd: worktree }));
      expect(await probe('EMPTY_KEY')).toEqual({ code: 21, detail: 'name not set' });
      expect(await probe('OUTSIDE_KEY')).toEqual({ code: 21, detail: 'name not set' });
      expect(await probe('SEQUENZY_API_KEY', '.env.local', proc(128))).toEqual({ code: 21, detail: 'env file missing' });
      expect(await probe('OUTSIDE_KEY', '../.env.local')).toEqual({ code: 21, detail: 'env file missing' });

      writeFileSync(join(worktree, '.env.local'), `SEQUENZY_API_KEY=${FAKE_VALUE}\n`);
      expect(await probe('SEQUENZY_API_KEY')).toEqual({ code: 0, detail: 'name set' });

      expect(dotenvCandidates('.env.local', { run: git, cwd: worktree })).toEqual([join(worktree, '.env.local'), join(main, '.env.local')]);
      expect(dotenvCandidates(join(base, '.env.local'), { run: git, cwd: worktree })).toEqual([join(base, '.env.local')]);
      expect(dotenvCandidates('.env.local', { run: vi.fn(() => ({ status: 0, stdout: '.git\n' })), cwd: main })).toEqual([join(main, '.env.local')]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('checks a public URL status and local Accessibility', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 404 }));
    expect(await host(['--url', 'https://app.cadence-me.com/.well-known/oauth-protected-resource', '--expect-status', '200'], { fetchImpl, out: () => {} })).toBe(21);
    expect(await host(['--url', 'http://insecure', '--expect-status', '200'], { fetchImpl, out: () => {} })).toBe(2);
    expect(await host(['--ax'], { run: proc(1, '', 'Not authorized to send Apple events (-1743) assistive access not allowed'), out: () => {} })).toBe(21);
  });
});

describe('record.mjs', () => {
  const now = () => Date.parse('2026-11-07T12:00:00Z');

  it('finds a recorded decision', async () => {
    const read = () => 'An AgentMail test inbox is a standing approved recipient for automated Sequenzy test sends.';
    expect(await record(['decision', '--file', 'docs/DECISIONS.md', '--contains', 'AgentMail test inbox is a standing approved recipient'], { read, exists: () => true, out: () => {} })).toBe(0);
    expect(await record(['decision', '--file', 'docs/DECISIONS.md', '--contains', 'nothing like this'], { read, exists: () => true, out: () => {} })).toBe(21);
    expect(await record(['decision', '--file', '../x', '--contains', 'y'], { out: () => {} })).toBe(2);
  });

  it('reads per-run approvals from the run folder only', async () => {
    const read = () => JSON.stringify({ 'maps-spend-cap': { recorded_at: '2026-11-07T11:00:00Z', source: 'owner set US$1' } });
    expect(await record(['approval', '--id', 'maps-spend-cap'], { env: { TEST_ACCESS_RUN_DIR: '/runs/r1' }, read, exists: () => true, now, out: () => {} })).toBe(0);
    expect(await record(['approval', '--id', 'maps-spend-cap'], { env: {}, read, exists: () => true, now, out: () => {} })).toBe(21);
    expect(await record(['approval', '--id', 'notarization-go-ahead'], { env: { TEST_ACCESS_RUN_DIR: '/runs/r1' }, read, exists: () => true, now, out: () => {} })).toBe(21);
  });

  it('ages host confirmations', async () => {
    const read = () => JSON.stringify({ 'qa-consent-test-users': { recorded_at: '2026-08-01T00:00:00Z', source: 'owner' } });
    expect(await record(['confirmation', '--id', 'qa-consent-test-users', '--max-age-days', '120'], { read, exists: () => true, now, out: () => {} })).toBe(0);
    expect(await record(['confirmation', '--id', 'qa-consent-test-users', '--max-age-days', '30'], { read, exists: () => true, now, out: () => {} })).toBe(20);
    expect(await record(['confirmation', '--id', 'qa-consent-test-users', '--max-age-days', '30'], { exists: () => false, now, out: () => {} })).toBe(21);
  });

  it('records an entry with an id and a short source only', async () => {
    const write = vi.fn();
    expect(await record(['record', '--scope', 'host', '--id', 'qa-consent-test-users', '--source', 'owner confirmed in chat'], { write, now, out: () => {} })).toBe(0);
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/test-access-confirmations\.json$/), 'qa-consent-test-users', 'owner confirmed in chat', now());
    expect(await record(['record', '--scope', 'run', '--id', 'maps-spend-cap', '--source', 'x'], { write, env: {}, now, out: () => {} })).toBe(2);
    expect(await record(['record', '--scope', 'host', '--id', 'x', '--source', 'token=abc"'], { write, now, out: () => {} })).toBe(2);
  });
});

describe('agent-step.mjs', () => {
  it('exits 1 so the preflight reports agent work, never an owner step', async () => {
    const io = capture();
    expect(await agentStep(['--step', 'outlook-connect-a'], { out: io.out })).toBe(1);
    expect(io.last().detail).toMatch(/^agent step not scripted: connect Outlook/);
    expect(await agentStep(['--step', 'unknown'], { out: () => {} })).toBe(2);
  });
});
