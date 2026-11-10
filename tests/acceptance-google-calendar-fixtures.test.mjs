import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ACCOUNT, CLIENT_SERVICE, FixtureStop, TOKEN_SERVICE, consent, createEvent, deleteEvent, isTestTitle, main, readClient,
} from '../scripts/acceptance/google-calendar-fixtures.mjs';
import { SignInStop } from '../scripts/acceptance/google-signin.mjs';

const FAKE_SECRET = 'fake-client-secret-0001';
const FAKE_REFRESH = '1//fake-refresh-token-0002';
const FAKE_ACCESS = 'fake-access-token-0003';
const clientJson = (installed) => Buffer.from(JSON.stringify({ installed })).toString('base64');
const GOOD_CLIENT = clientJson({ client_id: 'fake-id.apps.googleusercontent.com', client_secret: FAKE_SECRET });

/** A fake Keychain holding the QA client and slot A's refresh token. */
function fakeKeychain(items = {}) {
  const store = new Map(Object.entries({ [`${CLIENT_SERVICE}|${CLIENT_ACCOUNT}`]: GOOD_CLIENT, [`${TOKEN_SERVICE}|production:A`]: FAKE_REFRESH, ...items }));
  return vi.fn(async (service, account) => store.get(`${service}|${account}`) ?? null);
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake fetch for Google's token and Calendar endpoints. `events` maps id → event. */
function fakeGoogle(events = {}) {
  return vi.fn(async (url, init = {}) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: FAKE_ACCESS });
    const path = new URL(url).pathname;
    const id = decodeURIComponent(path.split('/events/')[1] ?? '');
    if (init.method === 'POST') return json(200, { id: 'evt-new', ...JSON.parse(init.body) });
    if (init.method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) };
    if (id) return events[id] ? json(200, events[id]) : json(404, { error: { status: 'NOT_FOUND' } });
    return json(200, { items: Object.values(events) });
  });
}

describe('google-calendar-fixtures title guard', () => {
  it('accepts the test prefixes followed by a space and text', () => {
    for (const title of ['QA x', 'Test x', 'W6 x', 'QA Leave reminder fixture']) expect(isTestTitle(title)).toBe(true);
  });

  it('rejects other titles', () => {
    for (const title of ['QAx', 'qa x', '', 'QA ', 'Dentist', ' QA x', 'test x', 'W6x', undefined, null]) expect(isTestTitle(title)).toBe(false);
  });

  it('createEvent stops with title-not-test before any Keychain read or network call', async () => {
    const read = fakeKeychain();
    const fetch = vi.fn();
    await expect(createEvent({ slot: 'A', calendar: 'cal', title: 'Dentist', start: 's', end: 'e' }, { read, fetch }))
      .rejects.toMatchObject({ reason: 'title-not-test' });
    expect(read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deleteEvent re-reads the event and refuses a non-test title without deleting', async () => {
    const fetch = fakeGoogle({ 'evt-1': { id: 'evt-1', summary: 'Dentist' } });
    await expect(deleteEvent({ slot: 'A', calendar: 'cal', event: 'evt-1' }, { read: fakeKeychain(), fetch }))
      .rejects.toMatchObject({ reason: 'title-not-test' });
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('deleteEvent deletes an event whose current title is a test title', async () => {
    const fetch = fakeGoogle({ 'evt-2': { id: 'evt-2', summary: 'QA Fixture' } });
    await expect(deleteEvent({ slot: 'A', calendar: 'cal', event: 'evt-2' }, { read: fakeKeychain(), fetch }))
      .resolves.toEqual({ deleted: 'evt-2', title: 'QA Fixture' });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  });
});

describe('google-calendar-fixtures readClient', () => {
  it('parses the base64 client JSON', async () => {
    await expect(readClient(fakeKeychain())).resolves.toEqual({ clientId: 'fake-id.apps.googleusercontent.com', clientSecret: FAKE_SECRET });
  });

  it('stops client-missing when the Keychain item is absent', async () => {
    await expect(readClient(fakeKeychain({ [`${CLIENT_SERVICE}|${CLIENT_ACCOUNT}`]: undefined }))).rejects.toMatchObject({ reason: 'client-missing' });
  });

  it('stops client-invalid on bad JSON or missing fields', async () => {
    for (const value of [Buffer.from('{not json').toString('base64'), clientJson({ client_id: 'x' }), clientJson({ client_secret: 'y' }),
      Buffer.from(JSON.stringify({ web: { client_id: 'x', client_secret: 'y' } })).toString('base64')]) {
      await expect(readClient(fakeKeychain({ [`${CLIENT_SERVICE}|${CLIENT_ACCOUNT}`]: value }))).rejects.toMatchObject({ reason: 'client-invalid' });
    }
  });
});

describe('google-calendar-fixtures consent', () => {
  it('stops client-missing before signing in', async () => {
    const signIn = vi.fn();
    await expect(consent({ slot: 'A' }, { read: fakeKeychain({ [`${CLIENT_SERVICE}|${CLIENT_ACCOUNT}`]: undefined }), signIn }))
      .rejects.toMatchObject({ reason: 'client-missing' });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs the slot in first and stops with the sign-in reason before opening Google consent', async () => {
    const signIn = vi.fn(async () => { throw new SignInStop('password-missing'); });
    const attach = vi.fn();
    await expect(consent({ slot: 'B' }, { read: fakeKeychain(), signIn, attach })).rejects.toMatchObject({ reason: 'signin-password-missing' });
    expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ slot: 'B' }));
    expect(attach).not.toHaveBeenCalled();
  });
});

describe('google-calendar-fixtures main', () => {
  const runMain = async (argv, deps = {}) => {
    const lines = [];
    const code = await main(argv, {}, (line) => lines.push(line), deps);
    return { code, lines };
  };

  it('returns 2 for usage errors without touching the Keychain or network', async () => {
    const read = fakeKeychain();
    const fetch = vi.fn();
    for (const argv of [
      [], ['remove', '--slot', 'A'], ['list'], ['list', '--slot', 'C'], ['list', '--slot', 'A', '--bogus'],
      ['list', '--slot', 'A', '--calendar', 'cal', '--from', '2026-11-08T00:00:00Z'],
      ['create', '--slot', 'A', '--calendar', 'cal', '--title', 'QA x', '--start', '2026-11-08T10:00:00-05:00'],
      ['create', '--slot', 'A', '--calendar', 'cal', '--start', 's', '--end', 'e'],
      ['delete', '--slot', 'A', '--calendar', 'cal'], ['delete', '--slot', 'A', '--event', 'evt-1'],
      ['consent', '--slot', 'A', '--port', 'abc'],
    ]) {
      const { code, lines } = await runMain(argv, { read, fetch });
      expect(code, argv.join(' ')).toBe(2);
      expect(lines.join('\n')).toMatch(/^usage:/);
    }
    expect(read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('prints a fixed stop reason and returns 3 for a non-test title', async () => {
    const { code, lines } = await runMain(['create', '--slot', 'A', '--calendar', 'cal', '--title', 'Dentist', '--start', 's', '--end', 'e'],
      { read: fakeKeychain(), fetch: vi.fn() });
    expect(code).toBe(3);
    expect(JSON.parse(lines.at(-1))).toEqual({ slot: 'A', state: 'stopped', reason: 'title-not-test' });
  });

  it('stops consent-required when the slot has no refresh token', async () => {
    const fetch = vi.fn();
    const { code, lines } = await runMain(['list', '--slot', 'B', '--calendar', 'cal', '--from', 'f', '--to', 't'], { read: fakeKeychain(), fetch });
    expect(code).toBe(3);
    expect(JSON.parse(lines.at(-1)).reason).toBe('consent-required');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates and lists with the default time zone and never prints the secret or tokens', async () => {
    const fetch = fakeGoogle({ 'evt-3': { id: 'evt-3', summary: 'QA Listed', start: { dateTime: '2026-11-08T10:00:00-05:00' }, end: { dateTime: '2026-11-08T11:00:00-05:00' } } });
    const deps = { read: fakeKeychain(), fetch };
    const created = await runMain(['create', '--slot', 'A', '--calendar', 'primary', '--title', 'QA Fixture', '--start', '2026-11-08T10:00:00-05:00',
      '--end', '2026-11-08T11:00:00-05:00', '--location', 'Evanston, IL'], deps);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.lines.at(-1))).toEqual({ id: 'evt-new', title: 'QA Fixture', start: '2026-11-08T10:00:00-05:00',
      end: '2026-11-08T11:00:00-05:00', location: 'Evanston, IL' });
    const post = fetch.mock.calls.find(([url, init]) => init?.method === 'POST' && String(url).includes('/calendar/v3/'));
    expect(JSON.parse(post[1].body).start.timeZone).toBe('America/New_York');
    expect(post[1].headers.Authorization).toBe(`Bearer ${FAKE_ACCESS}`);

    const listed = await runMain(['list', '--slot', 'A', '--calendar', 'primary', '--from', '2026-11-08T00:00:00Z', '--to', '2026-11-09T00:00:00Z'], deps);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.lines.at(-1))).toEqual([{ id: 'evt-3', title: 'QA Listed', start: '2026-11-08T10:00:00-05:00',
      end: '2026-11-08T11:00:00-05:00', location: null }]);

    const tokenBody = String(fetch.mock.calls.find(([url]) => String(url).includes('oauth2'))[1].body);
    expect(tokenBody).toContain('client_secret=');
    const printed = [...created.lines, ...listed.lines].join('\n');
    for (const secret of [FAKE_SECRET, FAKE_REFRESH, FAKE_ACCESS]) expect(printed).not.toContain(secret);
  });

  it('reports a token endpoint refusal by its error code only', async () => {
    const fetch = vi.fn(async () => json(400, { error: 'invalid_grant', error_description: `token ${FAKE_REFRESH} expired` }));
    const { code, lines } = await runMain(['list', '--slot', 'A', '--calendar', 'cal', '--from', 'f', '--to', 't'], { read: fakeKeychain(), fetch });
    expect(code).toBe(3);
    expect(JSON.parse(lines.at(-1)).reason).toBe('token-invalid_grant');
    expect(lines.join('\n')).not.toContain(FAKE_REFRESH);
  });
});

it('FixtureStop carries its reason', () => {
  expect(new FixtureStop('x')).toMatchObject({ name: 'FixtureStop', reason: 'x' });
});
