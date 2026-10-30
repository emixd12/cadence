// Ticket 255: browser-driven ChatGPT web and Claude web runs, against stub
// chat sites and a stub Cadence consent page (DOM copied from the real one).
// The real Ticket 232 cleanup helpers and the Ticket 247 ledger run against an
// in-memory rest adapter. Uses installed Chrome, headless, and three ephemeral
// loopback ports, so parallel runs never collide.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as cleanupModule from '../scripts/mcp-acceptance-cleanup.mjs';
import { createRun, resumeRun } from '../scripts/acceptance/ledger.mjs';
import { launchChrome } from '../scripts/acceptance/consent-page.mjs';
import {
  DEFAULT_PROFILE_DIR, SCENARIOS, assertProfileDir, attachProfile, dryRunSite, guidedFallback, main,
  openProfile, parseCli, profileOwnsPort, runWebScenario, signInStatus,
} from '../scripts/acceptance/web-client.mjs';
import { SITES, WebStop, withOrigin } from '../scripts/acceptance/web-sites.mjs';

const CHAT_PORTS = {};
let ISSUER = null;

/** Ephemeral loopback port, so parallel runs of this file never collide. */
async function listenEphemeral(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return server.address().port;
}
const USER_A = cleanupModule.USERS.A;
const EMAIL_A = 'cadence.testing.is@gmail.com';
const FAKE_COOKIE = 'FAKEcookieVALUEthatMustNeverAppear0123456789abcdef';
const REPLY_SECRET = 'NOTE-TEXT-must-not-leak-7731';

// ---- Shared stub state --------------------------------------------------------

let state;
function resetState(overrides = {}) {
  state = {
    flavor: null, loginWall: false, botCheck: false, missingCreate: false,
    connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: false }], grants: [], behaviors: [], activity: [], consentAccountId: USER_A, consentEmail: EMAIL_A,
    requestScopes: ['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'],
    approvalsPerTool: 1, stepUp: false, neverReply: false, endlessAfterApproval: false,
    consentCount: 0, pending: null, messages: [],
    ...overrides,
  };
}

const iso = () => new Date().toISOString();
const activeGrants = () => state.grants.filter((g) => !g.revokedAt);
const grantFor = (client) => activeGrants().find((g) => g.client_name === client);

function toolCall(op, outcome) {
  const grant = grantFor(state.flavor === 'chatgpt' ? 'ChatGPT' : 'Claude');
  state.activity.unshift({ activity_id: randomUUID(), grant_id: grant?.grant_id ?? null, operation: op, outcome, occurred_at: iso() });
}

/** The Supabase REST surface Ticket 232's cleanup helpers call, as test account A. */
const rest = async (slot, method, path, body) => {
  if (slot !== 'A') return { status: 403, json: null };
  if (path === '/rest/v1/rpc/oauth_list_grants') return { status: 200, json: activeGrants().map((g) => Object.fromEntries(Object.entries(g).filter(([k]) => k !== 'revokedAt'))) };
  if (path === '/rest/v1/rpc/oauth_revoke_grant') {
    const g = state.grants.find((x) => x.grant_id === body.p_grant_id);
    if (g) g.revokedAt = iso();
    return { status: 204, json: null };
  }
  if (path === '/rest/v1/rpc/oauth_list_activity') return { status: 200, json: state.activity.slice(0, body?.p_limit ?? 50) };
  if (method === 'GET' && path.startsWith('/rest/v1/behaviors?')) {
    const since = decodeURIComponent(/created_at=gte\.([^&]+)/.exec(path)[1]);
    return { status: 200, json: state.behaviors.filter((b) => b.created_at >= since) };
  }
  return { status: 404, json: null };
};

// ---- Stub chat pages ------------------------------------------------------------

const html = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}<script type="module">${script}</script></body></html>`;

// One client script for both flavors; the markup follows each adapter's roles.
const chatScript = (flavor) => `
const flavor = ${JSON.stringify(flavor)};
const issuer = ${JSON.stringify(ISSUER)};
const S = await (await fetch('/api/state')).json();
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const root = document.getElementById('root');
const authorizeUrl = (scope) => issuer + '/oauth/authorize?client=' + (flavor === 'chatgpt' ? 'ChatGPT' : 'Claude') + '&return=' + encodeURIComponent(location.origin + '/oauth-cb') + '&scope=' + encodeURIComponent(scope.join(' '));
// Settings pages mirror the real ones read on 2026-10-30 (see web-sites.mjs).
const path = location.pathname;
const settings = flavor === 'chatgpt' ? path.startsWith('/settings/plugins-settings') : path.startsWith('/customize/connectors');
function el(tag, attrs = {}, ...kids) { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); } for (const k of kids) n.append(k); return n; }
if (S.botCheck) { document.title = 'Just a moment...'; root.append(el('p', {}, 'Verify you are human')); }
else if (S.loginWall) { root.append(el('button', {}, 'Log in')); }
else if (settings) renderSettings();
else renderChat();

function renderSettings() {
  const main = el('main');
  root.append(main);
  const detail = path.endsWith('/plugin_x') || path.endsWith('/yours/id/1');
  const c = S.connectors[0];
  if (flavor === 'chatgpt') {
    if (detail) {
      main.append(el('h1', {}, c.name), el('a', { href: '#' }, 'View details'), el('button', {}, 'Uninstall'));
      if (!c.connected) main.append(el('button', { 'aria-label': "Reconnect Emiliano's " + c.name + ' account Primary', onclick: () => { location.href = authorizeUrl(S.requestScopes); } }, 'Reconnect'));
      main.append(el('button', {}, 'Connect another account'));
      return;
    }
    main.append(el('h1', {}, 'Plugins'), el('button', {}, 'Browse directory'), el('input', { type: 'search', 'aria-label': 'Search installed plugins' }));
    main.append(el('a', { href: '/settings/plugins-settings/plugin_a' }, 'Adobe Design, combine, and edit'));
    for (const x of S.connectors) main.append(el('a', { href: '/settings/plugins-settings/plugin_x' }, x.name + ' ' + x.name));
    return;
  }
  main.append(el('h1', {}, 'Customize'));
  if (detail) {
    main.append(el('a', { href: '/customize/connectors' }, 'Your connectors'));
    main.append(el('button', { 'aria-label': 'More options for ' + c.name, onclick: () => {
      const menu = el('div', { role: 'menu' }, el('div', { role: 'menuitem', onclick: async () => {
        menu.remove();
        const confirm = el('div', { role: 'alertdialog' }, el('button', { onclick: async () => { await post('/api/disconnect'); location.reload(); } }, 'Disconnect'));
        document.body.append(confirm);
      } }, 'Disconnect'));
      document.body.append(menu);
    } }, '...'));
    if (!c.connected) main.append(el('p', {}, 'You started connecting but did not finish.'), el('button', { onclick: () => window.open(authorizeUrl(S.requestScopes), 'oauth', 'popup') }, 'Connect'));
    return;
  }
  main.append(el('div', { role: 'tablist' }, el('button', { role: 'tab', 'aria-selected': 'true' }, 'Connectors')));
  const yours = el('button', { role: 'radio', 'aria-checked': 'false' }, 'Yours');
  main.append(el('div', { role: 'radiogroup', 'aria-label': 'Connectors' }, yours, el('button', { role: 'radio', 'aria-checked': 'true' }, 'Discover')));
  main.append(el('button', { 'aria-label': 'Add connector', onclick: () => {
    const menu = el('div', { role: 'menu', 'aria-label': 'Add connector' });
    if (!S.missingCreate) menu.append(el('div', { role: 'menuitem', onclick: () => { menu.remove(); openCreate(); } }, 'Add custom connector'));
    document.body.append(menu);
  } }, 'Add'));
  const panel = el('div');
  main.append(panel);
  yours.addEventListener('click', () => {
    yours.setAttribute('aria-checked', 'true');
    const table = el('table');
    for (const x of S.connectors) {
      const row = el('tr', { 'aria-label': 'View ' + x.name, onclick: () => { location.href = '/customize/connectors/yours/id/1'; } }, el('td', {}, x.name), el('td', {}, x.connected ? 'Connected' : 'Connect'));
      table.append(row);
    }
    panel.replaceChildren(table);
  });
}
function openCreate() {
  const d = el('div', { role: 'dialog' });
  const field = (label, id) => { d.append(el('label', { for: id }, label)); const i = el('input', { id }); d.append(i); return i; };
  const name = field('Name', 'f-name');
  const url = field('Remote MCP server URL', 'f-url');
  d.append(el('button', { onclick: async () => {
    await post('/api/connectors', { name: name.value, url: url.value });
    location.reload();
  } }, 'Add'));
  document.body.append(d);
}
function renderChat() {
  const log = el('div', { id: 'log' });
  root.append(log);
  if (flavor === 'chatgpt') {
    const plus = el('button', { 'aria-label': 'Add files and more', onclick: () => {
      const menu = el('div', { role: 'menu' });
      menu.append(el('div', { role: 'menuitem', onclick: () => {
        menu.append(el('div', { role: 'menuitemcheckbox', 'aria-checked': 'false', onclick: (e) => { e.target.setAttribute('aria-checked', 'true'); post('/api/enable'); } }, 'Cadence QA'));
      } }, 'Developer mode'));
      document.body.append(menu);
    } }, '+');
    root.append(plus);
  }
  const composer = el('div', { contenteditable: 'true', ...(flavor === 'chatgpt' ? { id: 'prompt-textarea', role: 'textbox' } : { class: 'ProseMirror' }) });
  root.append(composer);
  root.append(el('button', { 'aria-label': flavor === 'chatgpt' ? 'Send prompt' : 'Send message', onclick: async () => {
    const r = await post('/api/prompt', { text: composer.innerText });
    show(r);
  } }));
  function assistant(text, streaming) {
    const attrs = flavor === 'chatgpt' ? { 'data-message-author-role': 'assistant' } : { 'data-is-streaming': String(streaming) };
    const m = el('div', attrs, text);
    log.append(m);
    return m;
  }
  function show(r) {
    if (r.kind === 'approve') {
      const m = assistant('Wants to run ' + r.op, true);
      const stop = el('button', {}, 'Stop');
      root.append(stop);
      m.append(el('button', { onclick: async () => { m.remove(); stop.remove(); show(await post('/api/approve')); } }, flavor === 'chatgpt' ? 'Confirm' : 'Allow once'));
    } else if (r.kind === 'reauth') {
      const m = assistant('Cadence needs more access.', false);
      m.append(el('button', { onclick: () => window.open(authorizeUrl(['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write']), 'oauth', 'popup') }, 'Connect'));
      const poll = setInterval(async () => { const s = await (await fetch('/api/state')).json(); if (s.stepUpDone) { clearInterval(poll); show(await post('/api/resume')); } }, 200);
    } else if (r.kind === 'streaming') {
      assistant('Working', true);
      root.append(el('button', {}, 'Stop'));
    } else if (r.kind === 'reply') assistant(r.text, false);
  }
}
`;

function chatServer(flavor) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    const json = (value) => send(200, 'application/json', JSON.stringify(value));
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (url.pathname === '/api/state') return json({ ...state, stepUpDone: Boolean(state.stepUpDone) });
    if (url.pathname === '/api/connectors') { state.connectors.push({ name: input.name, url: input.url, connected: false }); return json({}); }
    if (url.pathname === '/api/disconnect') { for (const c of state.connectors) c.connected = false; return json({}); }
    if (url.pathname === '/api/enable') { state.enabled = true; return json({}); }
    if (url.pathname === '/oauth-cb') {
      const ok = url.searchParams.get('connected') === '1';
      if (ok) for (const c of state.connectors) c.connected = true;
      const next = flavor === 'chatgpt' ? '/settings/plugins-settings' : '/customize/connectors';
      return send(200, 'text/html', html('Connected', '<p>done</p>', `if (window.opener) window.close(); else location.href = ${JSON.stringify(next)};`));
    }
    if (url.pathname === '/api/prompt') {
      state.messages.push(input.text);
      if (state.neverReply) return json({ kind: 'none' });
      const write = /create a new daily behavior/.test(input.text);
      state.pending = { op: write ? 'create_behavior' : 'list_behaviors', write, title: /"([^"]+)"/.exec(input.text)?.[1] ?? null, approvals: 0 };
      return json(write || state.approvalsPerTool > 1 ? { kind: 'approve', op: state.pending.op } : finish());
    }
    if (url.pathname === '/api/approve') {
      state.pending.approvals += 1;
      if (state.endlessAfterApproval) return json({ kind: 'streaming' });
      if (state.pending.approvals < state.approvalsPerTool) return json({ kind: 'approve', op: state.pending.op });
      return json(finish());
    }
    if (url.pathname === '/api/resume') return json(finish());
    if (url.pathname === '/' || url.pathname === '/new' || url.pathname.startsWith('/settings/plugins-settings') || url.pathname.startsWith('/customize/connectors')) {
      return send(200, 'text/html', html(flavor === 'chatgpt' ? 'ChatGPT stub' : 'Claude stub', '<div id="root"></div>', chatScript(flavor)));
    }
    return send(404, 'text/plain', 'not found');
  });
}

function finish() {
  const p = state.pending;
  const grant = grantFor(state.flavor === 'chatgpt' ? 'ChatGPT' : 'Claude');
  if (p.write) {
    if (!grant?.scopes.includes('cadence.behaviors.write')) {
      toolCall('create_behavior', 'denied');
      if (state.stepUp) return { kind: 'reauth' };
      return { kind: 'reply', text: `I could not create it. ${REPLY_SECRET}` };
    }
    state.behaviors.push({ id: randomUUID(), user_id: USER_A, title: p.title, created_at: iso() });
    toolCall('create_behavior', 'success');
    return { kind: 'reply', text: `DONE ${REPLY_SECRET}` };
  }
  toolCall('list_behaviors', 'success');
  return { kind: 'reply', text: `3 ${REPLY_SECRET}` };
}

// ---- Stub Cadence issuer (consent page DOM follows app/oauth/consent) -------------

const consentPage = (rid, client, scopes) => html('Cadence consent', `
<form method="post" action="/oauth/decide">
  <h1>Connect ${client}</h1>
  <p>Verified client</p>
  <input type="hidden" name="request_id" value="${rid}">
  <input type="hidden" name="account_id" value="${state.consentAccountId}">
  <dl><dt>Cadence account</dt><dd>${state.consentEmail}</dd></dl>
  <input type="hidden" name="scope" value="cadence.read">
  ${scopes.filter((s) => s !== 'cadence.read').map((s) => `<label><input type="checkbox" name="scope" value="${s}" checked> ${s}</label>`).join('')}
  <button name="decision" value="allow">Allow</button>
  <button name="decision" value="deny">Deny</button>
</form>`, `
for (const b of document.querySelectorAll('button[name="decision"]')) {
  b.__reactProps$stub = {};
  b.addEventListener('click', async (e) => {
    e.preventDefault();
    const scopes = [...document.querySelectorAll('input[name="scope"]')].filter((i) => i.type === 'hidden' || i.checked).map((i) => i.value);
    const r = await fetch('/oauth/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rid: ${JSON.stringify(rid)}, decision: b.value, scopes }) }).then((x) => x.json());
    location.href = r.redirect;
  });
}`);

const requests = new Map();
function issuerServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    if (url.pathname === '/oauth/authorize') {
      if (!(req.headers.cookie ?? '').includes(`sb-stub-auth-token=${FAKE_COOKIE}`)) { res.writeHead(302, { location: '/login' }); return res.end(); }
      const rid = randomUUID();
      requests.set(rid, { client: url.searchParams.get('client'), ret: url.searchParams.get('return'), scopes: url.searchParams.get('scope').split(' ') });
      res.writeHead(302, { location: `/oauth/consent?request_id=${rid}` });
      return res.end();
    }
    if (url.pathname === '/oauth/consent') {
      const r = requests.get(url.searchParams.get('request_id'));
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(consentPage(url.searchParams.get('request_id'), r.client, r.scopes));
    }
    if (url.pathname === '/oauth/decide') {
      const input = JSON.parse(body);
      const r = requests.get(input.rid);
      state.consentCount += 1;
      let redirect = `${r.ret}?error=access_denied`;
      if (input.decision === 'allow') {
        const existing = grantFor(r.client);
        if (existing) { existing.scopes = input.scopes; state.stepUpDone = true; } else {
          state.grants.push({ grant_id: randomUUID(), client_id: `client-${r.client.toLowerCase()}`, client_name: r.client, scopes: input.scopes, created_at: iso() });
        }
        redirect = `${r.ret}?connected=1`;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ redirect }));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(html('Cadence', '<p>Sign in</p>'));
  });
}

// ---- Harness ------------------------------------------------------------------------

let browser;
const servers = [];
let root;
beforeAll(async () => {
  for (const client of ['chatgpt', 'claude-web']) {
    const server = chatServer(client);
    CHAT_PORTS[client] = await listenEphemeral(server);
    servers.push(server);
  }
  const issuer = issuerServer();
  ISSUER = `http://127.0.0.1:${await listenEphemeral(issuer)}`;
  servers.push(issuer);
  browser = await launchChrome({ headless: true });
  root = mkdtempSync(join(tmpdir(), 'accept-255-'));
}, 60_000);
afterAll(async () => {
  await browser?.close();
  for (const s of servers) { s.closeAllConnections(); await new Promise((resolve) => s.close(resolve)); }
  rmSync(root, { recursive: true, force: true });
});
beforeEach(() => resetState());

const sessions = {
  browserCookies: async (slot, origin) => [{ name: 'sb-stub-auth-token', value: FAKE_COOKIE, url: origin }],
  absorbBrowserCookies: async () => ({ rotated: false }),
};
const stubSite = (client) => withOrigin(SITES[client], `http://127.0.0.1:${CHAT_PORTS[client]}`);
const fakeWatcher = (decide = () => {
  const ok = (op) => state.activity.some((a) => a.operation === op && a.outcome === 'success');
  return ok('list_behaviors') && ok('create_behavior') ? 0 : 1;
}) => ({ started: 0, start() { this.started += 1; return { get result() { return new Promise((r) => setTimeout(() => r(decide()), 50)); }, stop() {} }; } });

let counter = 0;
async function scenario(client, name, { watcher = fakeWatcher(), runId, timeouts, label } = {}) {
  state.flavor = client;
  const context = await browser.newContext();
  const run = runId ? resumeRun({ runId, root }) : createRun({ target: 'local', accounts: ['A'], scenarios: [`${client}:${name}`], root });
  const lines = [];
  try {
    const result = await runWebScenario({
      site: stubSite(client), context, issuer: ISSUER, mcpUrl: `${ISSUER}/mcp`, slot: 'A', scenario: name,
      account: { userId: USER_A, email: EMAIL_A }, sessions, rest, cleanup: cleanupModule, watcher, run,
      label: label ?? `web-test-${(counter += 1)}`, out: (line) => lines.push(line),
      timeouts: timeouts ?? { consentMs: 15_000, turnMs: 15_000, quietMs: 300 },
    });
    const cookiesLeft = (await context.cookies(ISSUER)).length;
    return { result, lines, run, cookiesLeft };
  } finally {
    run.close();
    await context.close();
  }
}

const parsed = (lines) => lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const runFiles = (run) => readdirSync(run.dir).map((f) => join(run.dir, f));
function assertNoLeaks({ lines, run }) {
  const blobs = [lines.join('\n'), ...runFiles(run).filter((f) => !f.endsWith('.png')).map((f) => readFileSync(f, 'utf8'))];
  for (const blob of blobs) {
    expect(blob).not.toContain(FAKE_COOKIE);
    expect(blob).not.toContain(REPLY_SECRET);
    expect(blob).not.toContain('Use the Cadence QA connector');
    expect(blob).not.toContain(`${ISSUER}/oauth`);
  }
}

// ---- Runs against the stubs -------------------------------------------------------

describe('ChatGPT stub', () => {
  it('reconnects the existing app, consents, prompts, approves, captures the reply and cleans up', async () => {
    const out = await scenario('chatgpt', 'read-write');
    expect(out.result, out.lines.join('\n')).toMatchObject({ ok: true });
    const steps = parsed(out.lines).map((e) => e.step);
    expect(steps).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read', 'prompt-write', 'creation-checkpoint', 'watcher', 'revoke']);
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
    expect(parsed(again.lines).map((e) => e.step)).toEqual(['preflight', 'connect', 'grant-checkpoint', 'prompt-read', 'prompt-write', 'creation-checkpoint', 'watcher', 'revoke']);
    expect(state.messages).toHaveLength(2);
    expect(activeGrants()).toHaveLength(0);
  }, 120_000);
});

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
      expect(await dryRunSite({ context, site: stubSite('claude-web'), screenshotDir: dir })).toMatchObject({ ok: false, reason: 'login-wall', screenshot: 'failure-dry-run-claude-web.png' });
    } finally { await context.close(); }
  }, 60_000);
});

// ---- Profile, CLI and helpers --------------------------------------------------------

describe('profile guard', () => {
  const home = homedir();
  it('accepts the default dedicated profile outside the repo', () => {
    expect(assertProfileDir(DEFAULT_PROFILE_DIR)).toMatch(/Cadence QA Chrome$/);
  });
  it.each([
    ['relative', 'Cadence QA Chrome', 'profile-path'],
    ['home', home, 'profile-path'],
    ['repository', join(process.cwd(), 'tmp-profile'), 'profile-in-repo'],
    ['sibling worktree', join(process.cwd(), '..', 'cadence', 'x'), 'profile-in-repo'],
    ['everyday Chrome', join(home, 'Library', 'Application Support', 'Google', 'Chrome'), 'profile-everyday-chrome'],
    ['everyday Chrome profile', join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Profile 3'), 'profile-everyday-chrome'],
  ])('refuses %s', (_name, dir, step) => {
    expect(() => assertProfileDir(dir)).toThrow(WebStop);
    try { assertProfileDir(dir); } catch (e) { expect(e).toMatchObject({ reason: 'profile-unsafe', step }); }
  });
  it.each(['Identity Scaffolding', 'Emi Chrome'])('refuses a folder whose Local State names %s', (name) => {
    const dir = mkdtempSync(join(tmpdir(), 'accept-255-profile-'));
    try {
      writeFileSync(join(dir, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Cadence QA' }, 'Profile 1': { name } } } }));
      expect(() => assertProfileDir(dir)).toThrow(WebStop);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('attaches only when the profile owns the port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accept-255-profile-'));
    try {
      const ours = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${dir} --remote-debugging-port=4430 --no-first-run`;
      const owns = (commands, port = 4430) => profileOwnsPort({ profileDir: dir, port, listenerPids: () => Object.keys(commands).join('\n'), commandOf: (pid) => commands[pid] });
      expect(owns({ 101: ours })).toBe(true);
      expect(owns({ 101: ours.replace(dir, '/other') })).toBe(false);
      expect(owns({ 101: ours.replace(dir, `${dir}-copy`) })).toBe(false);
      expect(owns({ 101: ours }, 4431)).toBe(false);
      expect(owns({ 101: ours, 202: '/usr/bin/nc -l 4430' })).toBe(false);
      expect(owns({})).toBe(false);
      expect(owns({ 101: `/tmp/fake-chrome --user-data-dir=${dir} --remote-debugging-port=4430` })).toBe(false);
      let connected = false;
      await expect(attachProfile({ profileDir: dir, owns: () => false, connect: async () => { connected = true; } })).rejects.toMatchObject({ reason: 'profile-not-open' });
      expect(connected).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('opens the profile as a normal Chrome window with only the loopback DevTools port', async () => {
    const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'accept-255-profile-'))), 'QA Chrome');
    const calls = [];
    let up = false;
    const result = await openProfile({
      profileDir: dir, port: 4430, urls: ['https://chatgpt.com/'],
      spawnImpl: (bin, args, opts) => { calls.push({ bin, args, opts }); up = true; return { unref() {} }; },
      fetchImpl: async () => ({ ok: up }), owns: () => up, timeoutMs: 2_000,
    });
    expect(result.state).toBe('opened');
    expect(calls[0].bin).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(calls[0].args).toEqual([`--user-data-dir=${dir}`, '--remote-debugging-port=4430', '--no-first-run', '--no-default-browser-check', 'https://chatgpt.com/']);
    expect(calls[0].args.some((a) => /enable-automation|headless|mock-keychain/.test(a))).toBe(false);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    await expect(openProfile({ profileDir: dir, port: 4321 })).rejects.toMatchObject({ reason: 'port-not-allowed' });
  });
});

describe('CLI', () => {
  it('parses the task-note form without a subcommand and requires --allow-production', () => {
    expect(() => parseCli(['--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write'])).toThrow(/allow-production-required/);
    expect(parseCli(['--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write', '--allow-production'])).toMatchObject({ command: 'run', client: 'chatgpt', slot: 'A', scenario: 'read-write', port: 4430 });
    expect(parseCli(['dry-run'])).toMatchObject({ command: 'dry-run', clients: ['chatgpt', 'claude-web'] });
    expect(() => parseCli(['dry-run', '--port', '4321'])).toThrow(/port-not-allowed/);
    expect(() => parseCli(['--client', 'gemini', '--account', 'A', '--scenario', 'deny', '--allow-production'])).toThrow(/client-invalid/);
  });
  it('lists scenarios and refuses bad usage with exit 2', async () => {
    const lines = [];
    expect(await main(['--list-scenarios'], {}, (l) => lines.push(l))).toBe(0);
    expect(lines.map((l) => l.split(':')[0])).toEqual(Object.keys(SCENARIOS));
    expect(await main(['run', '--client', 'chatgpt'], {}, (l) => lines.push(l))).toBe(2);
  });
  it('runs through a symlinked script path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'accept-255-link-'));
    try {
      const link = join(dir, 'web-client.mjs');
      symlinkSync(join(process.cwd(), 'scripts', 'acceptance', 'web-client.mjs'), link);
      const r = spawnSync(process.execPath, [link, '--list-scenarios'], { encoding: 'utf8', timeout: 30_000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('read-write:');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('prints a guided fallback naming the client, account and reason', () => {
    const lines = guidedFallback({ client: 'claude-web', slot: 'B', scenario: 'read-write', reason: 'bot-check' });
    expect(lines[0]).toBe('guided-fallback claude-web reason=bot-check');
    expect(lines.join('\n')).toContain('test account B');
    expect(lines.join('\n')).toContain('--expect claude-web');
  });
});
