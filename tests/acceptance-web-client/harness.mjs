// Ticket 255: browser-driven ChatGPT web and Claude web runs, against stub
// chat sites and a stub Cadence consent page (DOM copied from the real one).
// The real Ticket 232 cleanup helpers and the Ticket 247 ledger run against an
// in-memory rest adapter. Uses installed Chrome, headless, and three ephemeral
// loopback ports, so parallel runs never collide.
//
// This module is the shared harness. Each test file in this folder that drives
// a browser calls startWebClientHarness() once; Vitest runs the files in parallel,
// and each file gets its own stub servers, Chrome and stub state.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import * as cleanupModule from '../../scripts/mcp-acceptance-cleanup.mjs';
import { createRun, resumeRun } from '../../scripts/acceptance/ledger.mjs';
import { launchChrome } from '../../scripts/acceptance/consent-page.mjs';
import { runWebScenario } from '../../scripts/acceptance/web-client.mjs';
import { SITES, withOrigin } from '../../scripts/acceptance/web-sites.mjs';

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
// Title of Emi's other chats in the stub sidebar. Printed only when reporting a
// chat the run must tell her about; never written to the run folder.
const OTHER_TITLE = 'Emi private chat';

// ---- Shared stub state --------------------------------------------------------

let state;
function resetState(overrides = {}) {
  state = {
    flavor: null, loginWall: false, botCheck: false, missingCreate: false,
    connectors: [{ name: 'Cadence QA', url: `${ISSUER}/mcp`, connected: false }], grants: [], behaviors: [], activity: [], consentAccountId: USER_A, consentEmail: EMAIL_A,
    requestScopes: ['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'],
    approvalsPerTool: 1, stepUp: false, neverReply: false, endlessAfterApproval: false,
    consentCount: 0, pending: null, messages: [], chats: [], archiveInlineBroken: false, openedPaths: [],
    // Emi's own chats in the sidebar, each with a same-named options button that
    // comes before the conversation in DOM order. They must never change.
    otherChats: [{ id: randomUUID(), archived: false }, { id: randomUUID(), archived: false }],
    duplicateOptions: false, redirectOnOpen: false, archiveAlsoOther: false, historyInMain: false, noHeaderControl: false, stayAfterArchive: false, otherLinkInMain: false,
    // The live ChatGPT layout seen in Ticket 256 (account menu, plugin mention, turn state, "Chat actions").
    layout2026: false,
    ...overrides,
  };
}

const iso = () => new Date().toISOString();
const activeGrants = () => state.grants.filter((g) => !g.revokedAt);
const grantFor = (client) => activeGrants().find((g) => g.client_name === client);

function toolCall(op, outcome) {
  const client = state.flavor === 'chatgpt' ? 'ChatGPT' : 'Claude';
  const grant = grantFor(client) ?? (state.ignoreRevocation ? state.grants.filter((g) => g.client_name === client).at(-1) : undefined);
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
  if (method === 'GET' && path.startsWith('/rest/v1/behaviors?id=eq.')) {
    const id = /id=eq\.([0-9a-f-]{36})/.exec(path)[1];
    return { status: 200, json: state.behaviors.filter((b) => b.id === id) };
  }
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
const OTHER_TITLE = ${JSON.stringify(OTHER_TITLE)};
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
      if (S.layout2026) {
        const confirmConnect = () => document.body.append(el('div', { role: 'dialog' }, el('p', {}, 'ChatGPT may share relevant chats with this app.'),
          el('button', { onclick: () => { location.href = authorizeUrl(S.requestScopes); } }, 'Connect ' + c.name), el('button', {}, 'Cancel')));
        if (c.connected) {
          main.append(el('button', { 'aria-label': "Actions for Emiliano's " + c.name + ' account', 'aria-describedby': 'acct-kind', onclick: () => {
            const menu = el('div', { role: 'menu' }, el('div', { role: 'menuitem' }, 'Rename account'),
              el('div', { role: 'menuitem', onclick: () => { menu.remove(); confirmConnect(); } }, 'Reconnect'), el('div', { role: 'menuitem' }, 'Disconnect'));
            document.body.append(menu);
          } }, '...'), el('span', { id: 'acct-kind' }, 'Primary'));
        } else main.append(el('button', { onclick: confirmConnect }, 'Connect'));
        main.append(el('button', {}, 'Connect another account'));
        return;
      }
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
    // Live layout (Ticket 256): a connector whose grant was revoked needs attention and shows
    // Disconnect and Reconnect directly; its More options menu holds only Remove.
    else if (S.needsAttention) main.append(el('button', {}, 'Disconnect'), el('button', { onclick: () => window.open(authorizeUrl(S.requestScopes), 'oauth', 'popup') }, 'Reconnect'));
    // A connected connector in the live layout: Disconnect in the page, Connect after it.
    else if (S.directDisconnect) main.append(el('button', { onclick: async () => { await post('/api/disconnect'); location.reload(); } }, 'Disconnect'));
    return;
  }
  main.append(el('div', { role: 'tablist' }, el('button', { role: 'tab', 'aria-selected': 'true' }, 'Connectors')));
  const yours = el('button', { role: 'radio', 'aria-checked': 'false' }, 'Yours', ...(S.needsAttention ? [el('span', {}, ', 1 needs attention')] : []));
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
  // Real chats move to /c/<id> (ChatGPT) or /chat/<id> (Claude) after the first
  // prompt. A sidebar lists other chats, each with a menu button that has the same
  // name as the conversation's own; the conversation header sits inside <main>.
  const chatPrefix = flavor === 'chatgpt' ? '/c/' : '/chat/';
  const currentChat = () => (location.pathname.startsWith(chatPrefix) ? location.pathname.slice(chatPrefix.length) : null);
  const optionsName = flavor === 'chatgpt' ? (S.layout2026 ? 'Chat actions' : 'Open conversation options') : (S.layout2026 ? 'More options for Cadence QA test chat' : 'Open chat options');
  const itemName = flavor === 'chatgpt' ? 'Archive' : 'Delete';
  const optionsButton = (chatId, leave) => el('button', { 'aria-label': optionsName, onclick: () => {
    const menu = el('div', { role: 'menu' }, el('div', { role: 'menuitem', onclick: () => {
      menu.remove();
      const confirm = el('div', { role: 'alertdialog' }, el('button', { onclick: async () => {
        confirm.remove();
        await post('/api/archive', { chatId });
        if (leave && !S.stayAfterArchive) location.href = flavor === 'chatgpt' ? '/' : '/new';
        else location.reload();
      } }, itemName));
      document.body.append(confirm);
    } }, itemName));
    document.body.append(menu);
  } }, '...');
  const main = el('main');
  // History rows in <nav> (default) or, in the reviewer's layout, as plain divs inside <main>.
  const historyList = S.historyInMain ? el('div', { class: 'history' }) : el('nav', { 'aria-label': 'Chat history' });
  // The reviewer's layout has exactly one history row (another chat), so its button is the only match.
  const rows = S.historyInMain ? S.otherChats.slice(0, 1) : [...S.otherChats, ...S.chats];
  for (const c of rows.filter((x) => !x.archived)) {
    const title = S.otherChats.some((o) => o.id === c.id) ? OTHER_TITLE + ' ' + c.id.slice(0, 4) : 'Chat ' + c.id.slice(0, 4);
    historyList.append(el('div', {}, el('a', { href: chatPrefix + c.id }, title), optionsButton(c.id, false)));
  }
  if (S.historyInMain) main.append(historyList); else root.prepend(historyList);
  root.append(main);
  // The header appears once the chat exists (at load for a reopened chat, after
  // the first prompt for a new one). archiveInlineBroken hides it on the first visit.
  const renderHeader = () => {
    if (!currentChat() || main.querySelector('header')) return;
    if (S.archiveInlineBroken && !location.search.includes('reopened')) return;
    if (S.noHeaderControl) { main.append(el('header', {}, el('h2', {}, 'Conversation'))); return; }
    main.append(el('header', {}, optionsButton(currentChat(), true)));
    if (S.duplicateOptions) main.append(optionsButton(currentChat(), true));
  };
  renderHeader();
  // A link to another chat elsewhere in the conversation root (not near the control).
  if (S.otherLinkInMain && S.otherChats.length) main.append(el('div', { class: 'related' }, el('a', { href: chatPrefix + S.otherChats[S.otherChats.length - 1].id }, 'Related')));
  if (flavor === 'chatgpt' && S.layout2026) {
    // Plugins are buttons named "<name> <description>"; search reveals the rest and
    // picking one replaces the typed search text with an inline app mention.
    const plus = el('button', { 'aria-label': 'Add files and more', onclick: () => {
      const pop = el('div', {});
      pop.append(el('button', {}, 'Add photos & files Upload from computer'), el('button', {}, 'Gmail Read and manage Gmail'));
      pop.append(el('button', { onclick: () => {
        composer.focus();
        pop.append(el('button', { onclick: () => {
          composer.textContent = '';
          composer.append(el('span', { 'app-mention-name': 'cadence-qa', 'app-mention-display-name': 'Cadence QA', contenteditable: 'false' }, 'Cadence QA'), ' ');
          pop.remove();
          post('/api/enable');
        } }, 'Cadence QA', el('span', {}, 'Cadence QA')));
      } }, 'Type to search plugins'));
      document.body.append(pop);
    } }, '+');
    root.append(plus);
  } else if (flavor === 'chatgpt') {
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
    const r = await post('/api/prompt', { text: composer.innerText, chatId: currentChat() });
    if (r.chatId && !currentChat()) { history.replaceState(null, '', chatPrefix + r.chatId); renderHeader(); }
    show(r);
  } }));
  function assistant(text, streaming) {
    const attrs = flavor === 'chatgpt'
      ? (S.layout2026 ? { 'data-talvt-turn-state': streaming ? 'streaming' : 'complete' } : { 'data-message-author-role': 'assistant' })
      : { 'data-is-streaming': String(streaming) };
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
      // Live Claude web (Ticket 256) renders the reconnect card outside the reply element.
      (S.reauthOutsideReply ? main : m).append(el('button', { onclick: () => window.open(authorizeUrl(['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write']), 'oauth', 'popup') }, 'Connect'));
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
    if (url.pathname === '/api/archive') {
      const chat = [...state.chats, ...state.otherChats].find((c) => c.id === input.chatId);
      if (chat) chat.archived = true;
      if (state.archiveAlsoOther) state.otherChats[0].archived = true;
      return json({});
    }
    if (url.pathname === '/api/prompt') {
      state.messages.push(input.text);
      let chatId = input.chatId;
      if (!chatId) { chatId = randomUUID(); state.chats.push({ id: chatId, archived: false }); }
      if (state.neverReply) return json({ kind: 'none', chatId });
      const write = /create a new daily behavior/.test(input.text);
      const update = /turn off its browser and email reminders/.test(input.text);
      state.pending = { op: write ? 'create_behavior' : update ? 'update_behavior' : 'list_behaviors', write, update, title: /"([^"]+)"/.exec(input.text)?.[1] ?? null,
        remindersOff: /with browser and email reminders off/.test(input.text), approvals: 0 };
      return json({ ...(write || update || state.approvalsPerTool > 1 ? { kind: 'approve', op: state.pending.op } : finish()), chatId });
    }
    if (url.pathname === '/api/approve') {
      state.pending.approvals += 1;
      if (state.endlessAfterApproval) return json({ kind: 'streaming' });
      if (state.pending.approvals < state.approvalsPerTool) return json({ kind: 'approve', op: state.pending.op });
      return json(finish());
    }
    if (url.pathname === '/api/resume') return json(finish());
    if (!url.pathname.startsWith('/api/')) state.openedPaths.push(url.pathname);
    const reopened = /^\/(c|chat)\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (reopened && state.chats.some((c) => c.id === reopened[2])) {
      if (state.redirectOnOpen) { res.writeHead(302, { location: `/${reopened[1]}/${state.otherChats[0].id}` }); return res.end(); }
      if (!url.search.includes('reopened')) { res.writeHead(302, { location: `${url.pathname}?reopened=1` }); return res.end(); }
    }
    if (url.pathname === '/' || url.pathname === '/new' || /^\/(c|chat)\/[0-9a-f-]{36}$/.test(url.pathname) || url.pathname.startsWith('/settings/plugins-settings') || url.pathname.startsWith('/customize/connectors')) {
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
    // A model may drop the prompt's reminders-off instruction (ignoreRemindersOff).
    const off = p.remindersOff && !state.ignoreRemindersOff;
    state.behaviors.push({ id: randomUUID(), user_id: USER_A, title: p.title, created_at: iso(), browser_reminder_enabled: !off, email_reminder_enabled: false });
    toolCall('create_behavior', 'success');
    return { kind: 'reply', text: `DONE ${REPLY_SECRET}` };
  }
  if (p.update) {
    const b = state.behaviors.find((x) => x.title === p.title);
    if (!b || !grant?.scopes.includes('cadence.behaviors.write') || state.ignoreReminderUpdate) {
      toolCall('update_behavior', 'denied');
      return { kind: 'reply', text: `FAILED ${REPLY_SECRET}` };
    }
    Object.assign(b, { browser_reminder_enabled: false, email_reminder_enabled: false });
    toolCall('update_behavior', 'success');
    return { kind: 'reply', text: `DONE ${REPLY_SECRET}` };
  }
  toolCall('list_behaviors', 'success');
  return { kind: 'reply', text: `3 ${REPLY_SECRET}` };
}

// ---- Stub Cadence issuer (consent page DOM follows app/oauth/consent) -------------

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const consentPage = (rid, client, scopes) => html('Cadence consent', `
<form method="post" action="/oauth/decide">
  <h1>Connect ${escapeHtml(client)}</h1>
  <p>Verified client</p>
  <input type="hidden" name="request_id" value="${escapeHtml(rid)}">
  <input type="hidden" name="account_id" value="${escapeHtml(state.consentAccountId)}">
  <dl><dt>Cadence account</dt><dd>${escapeHtml(state.consentEmail)}</dd></dl>
  <input type="hidden" name="scope" value="cadence.read">
  ${scopes.filter((s) => s !== 'cadence.read').map((s) => `<label><input type="checkbox" name="scope" value="${escapeHtml(s)}"${state.writesStartOff ? '' : ' checked'}> ${escapeHtml(s)}</label>`).join('')}
  <button name="decision" value="allow">Allow</button>
  <button name="decision" value="deny">Deny</button>
</form>`, state.consentNotHydrated ? '' : `
for (const b of document.querySelectorAll('button[name="decision"]')) {
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
      requests.set(rid, { rid, client: url.searchParams.get('client'), ret: url.searchParams.get('return'), scopes: url.searchParams.get('scope').split(' ') });
      res.writeHead(302, { location: `/oauth/consent?request_id=${rid}` });
      return res.end();
    }
    if (url.pathname === '/oauth/consent') {
      const r = requests.get(url.searchParams.get('request_id'));
      if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown request'); }
      res.writeHead(200, { 'content-type': 'text/html' });
      // Ticket 259 (PR #175): the screen offers every advertised scope, writes on.
      const shown = state.offerAllScopes ? ['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'] : r.scopes;
      return res.end(consentPage(r.rid, r.client, shown));
    }
    if (url.pathname === '/oauth/decide') {
      // Ticket 379: a page that has not hydrated sends the plain form post instead.
      const native = (req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
      const fields = native ? new URLSearchParams(body) : null;
      const input = native ? { rid: fields.get('request_id'), decision: fields.get('decision'), scopes: fields.getAll('scope') } : JSON.parse(body);
      const r = requests.get(input.rid);
      // A faulty server that ignores the switches the user cleared.
      if (state.grantAllOnDecide) input.scopes = ['cadence.read', 'cadence.occurrences.write', 'cadence.behaviors.write'];
      state.consentCount += 1;
      let redirect = `${r.ret}?error=access_denied`;
      if (input.decision === 'allow') {
        const existing = grantFor(r.client);
        if (existing) { existing.scopes = input.scopes; state.stepUpDone = true; } else {
          state.grants.push({ grant_id: randomUUID(), client_id: `client-${r.client.toLowerCase()}`, client_name: r.client, scopes: input.scopes, created_at: iso() });
        }
        redirect = `${r.ret}?connected=1`;
      }
      if (native) {
        // The stub chat sites listen on loopback; redirect nowhere else.
        if (new URL(redirect).hostname !== '127.0.0.1') { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('bad return'); }
        res.writeHead(303, { location: redirect }); return res.end();
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
/** Starts the stub servers and Chrome for the calling test file, and resets the stub state before each test. */
function startWebClientHarness() {
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
}

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
const nextLabel = () => `web-test-${(counter += 1)}`;
async function scenario(client, name, { watcher = fakeWatcher(), runId, timeouts, label, deleteClaudeChats = false, screenshots = 'full' } = {}) {
  state.flavor = client;
  const context = await browser.newContext();
  const run = runId ? resumeRun({ runId, root }) : createRun({ target: 'local', accounts: ['A'], scenarios: [`${client}:${name}`], root });
  const lines = [];
  try {
    const result = await runWebScenario({
      site: stubSite(client), context, issuer: ISSUER, mcpUrl: `${ISSUER}/mcp`, slot: 'A', scenario: name,
      account: { userId: USER_A, email: EMAIL_A }, sessions, rest, cleanup: cleanupModule, watcher, run,
      label: label ?? nextLabel(), out: (line) => lines.push(line), deleteClaudeChats, screenshots,
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
  for (const f of runFiles(run).filter((x) => !x.endsWith('.png'))) expect(readFileSync(f, 'utf8')).not.toContain(OTHER_TITLE);
}

// `state`, `ISSUER`, `browser` and `root` are reassigned above; importers read the current value.
export {
  EMAIL_A, FAKE_COOKIE, ISSUER, OTHER_TITLE, USER_A, activeGrants, assertNoLeaks, browser, fakeWatcher, iso, nextLabel,
  parsed, resetState, rest, root, runFiles, scenario, sessions, state, stubSite, startWebClientHarness,
};
