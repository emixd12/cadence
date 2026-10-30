// Ticket 255. Page adapters for ChatGPT web and Claude web, driven by
// playwright-core in the dedicated QA Chrome profile.
//
// Every locator is an accessible role and name (or a short CSS list for the
// composer and assistant turns), kept as data so a stub page can mirror it.
// When a page no longer matches, the step stops with `page-changed` and the
// step's name; nothing guesses or clicks around it.
//
// Verified against the real sites: reaching the connector settings (dry run).
// The chat steps (composer, approvals, reply) are first exercised on the real
// sites in Ticket 256.

export class WebStop extends Error {
  constructor(reason, step = null) {
    super(reason);
    this.name = 'WebStop';
    this.reason = reason;
    this.step = step;
  }
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Case-insensitive whole-name match for any of the given accessible names. */
export const exact = (...names) => new RegExp(`^\\s*(?:${names.map(escape).join('|')})\\s*$`, 'i');

const ROLES = ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'switch', 'checkbox'];

/** Anything a user can click whose accessible name matches. */
export function clickable(scope, name) {
  let locator = scope.getByRole(ROLES[0], { name });
  for (const role of ROLES.slice(1)) locator = locator.or(scope.getByRole(role, { name }));
  return locator;
}

const visible = (locator) => locator.isVisible().catch(() => false);

/** First visible match, or null after `timeoutMs`. */
export async function waitVisible(locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (await visible(item)) return item;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function clickNamed(page, name, step, { scope = page, timeoutMs = 15_000 } = {}) {
  const target = await waitVisible(clickable(scope, name), timeoutMs);
  if (!target) throw new WebStop('page-changed', step);
  await target.click();
}

export async function fillNamed(page, name, value, step, { timeoutMs = 15_000 } = {}) {
  const field = await waitVisible(page.getByLabel(name).or(page.getByPlaceholder(name)).or(page.getByRole('textbox', { name })), timeoutMs);
  if (!field) throw new WebStop('page-changed', step);
  await field.fill(value);
}

/**
 * Click the confirmation in a separate confirm dialog, if one appears. A
 * dialog that holds the connector list is the settings panel itself, not a
 * confirmation, so it is skipped.
 */
export async function confirmIfAsked(page, name, timeoutMs = 3_000) {
  const dialogs = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasNot: page.getByRole('listitem') }));
  const confirm = await waitVisible(clickable(dialogs, name), timeoutMs);
  if (confirm) await confirm.click({ timeout: 5_000 }).catch(() => {});
}

/**
 * login-wall, bot-check or ok. A redirect to another host (an identity
 * provider) counts as a login wall.
 */
export async function classifyPage(page, site) {
  const title = await page.title().catch(() => '');
  if (/just a moment|attention required|verify you are human/i.test(title)) return 'bot-check';
  if (page.frames().some((frame) => /challenges\.cloudflare\.com|hcaptcha\.com|recaptcha/.test(frame.url()))) return 'bot-check';
  if (await visible(page.getByText(/verify you are human/i).first())) return 'bot-check';
  let url;
  try { url = new URL(page.url()); } catch { return 'ok'; }
  if (url.origin !== new URL(site.origin).origin) return 'login-wall';
  if (site.loginPath.test(url.pathname)) return 'login-wall';
  if (await visible(clickable(page, site.loginButton).first())) return 'login-wall';
  return 'ok';
}

// ---- Sites ------------------------------------------------------------------
//
// Page structure read from the real sites on 2026-10-30 (dry run, signed in):
// - ChatGPT: Settings → Integrations → Plugins at /settings/plugins-settings
//   (the old #settings/Connectors redirects there). Each plugin is a link named
//   "<name> <description>"; its detail page has "Reconnect <account>" and
//   "Connect another account". Developer apps show "Version dev mode".
// - Claude: Customize → Connectors at /customize/connectors (the old
//   /settings/connectors shows a "Connectors have moved" notice). "Add
//   connector" opens a menu with "Add custom connector"; the "Yours" filter
//   lists connectors as table rows named "View <name>"; a detail page has
//   "Connect" and "More options for <name>".
// Not yet seen on the real sites: ChatGPT's create-app form, Claude's custom
// connector form fields, the chat composer, tool approvals and replies.

const startsWithName = (name) => new RegExp(`^\\s*${escape(name)}(\\s|$)`);

const chatgpt = Object.freeze({
  id: 'chatgpt',
  label: 'ChatGPT',
  origin: 'https://chatgpt.com',
  consentClient: 'ChatGPT',
  watcherScenario: 'chatgpt',
  connectorsPath: '/settings/plugins-settings',
  // Names only; values are never read out of the browser.
  sessionCookie: /^__Secure-next-auth\.session-token(\.\d+)?$/,
  chatPath: '/',
  // Privacy: runs open new chats only and later reopen only a chat they created.
  chatIdPattern: /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  chatPathFor: (id) => `/c/${id}`,
  // Archive this chat from its header menu. Not yet seen on the real site (Ticket 256).
  archiveMenu: exact('Open conversation options', 'Conversation options'),
  archiveItem: exact('Archive'),
  archiveConfirm: exact('Archive', 'Confirm'),
  // Archiving can be undone, so runs archive ChatGPT test chats by default.
  chatCleanup: 'archive',
  loginPath: /^\/(auth|log-?in)\b/i,
  loginButton: exact('Log in', 'Sign up', 'Sign up for free'),
  composer: '#prompt-textarea, [contenteditable="true"][role="textbox"], textarea[name="prompt-textarea"]',
  send: exact('Send prompt', 'Send message', 'Send'),
  composerTools: exact('Add files and more', 'Add photos & files', 'Add photos and files', 'Tools'),
  composerDeveloper: exact('Developer mode', 'More'),
  approve: exact('Allow once', 'Confirm', 'Allow', 'Approve'),
  reauthorize: exact('Connect', 'Reconnect', 'Sign in', 'Authorize'),
  stop: /^\s*Stop( generating| streaming| response)?\s*$/i,
  assistant: '[data-message-author-role="assistant"]',
  settingsMarker(page) { return page.getByRole('searchbox', { name: 'Search installed plugins' }); },
  async findConnector(page, name, timeoutMs = 3_000) {
    return waitVisible(page.getByRole('main').getByRole('link', { name: startsWithName(name) }), timeoutMs);
  },
  // Creating a developer app has not been verified on the real site; the
  // existing "Cadence QA" app is reconnected instead.
  async addConnector() { throw new WebStop('connector-missing', 'connector-create'); },
  async reconnect(page, entry, name) {
    await entry.click();
    await waitVisible(page.getByRole('heading', { name: exact(name) }), 15_000);
    await clickNamed(page, new RegExp(`^\\s*Reconnect\\b.*${escape(name)}`), 'connector-reconnect');
  },
  async enableInChat(page, name) {
    await clickNamed(page, this.composerTools, 'chat-tools');
    const developer = await waitVisible(clickable(page, this.composerDeveloper), 5_000);
    if (developer) await developer.click();
    const item = await waitVisible(clickable(page, exact(name)), 5_000);
    if (!item) throw new WebStop('connector-not-in-chat', 'chat-enable');
    const checked = await item.getAttribute('aria-checked').catch(() => null);
    if (checked !== 'true') await item.click();
    await page.keyboard.press('Escape').catch(() => {});
  },
});

const claudeWeb = Object.freeze({
  id: 'claude-web',
  label: 'Claude',
  origin: 'https://claude.ai',
  consentClient: 'Claude',
  watcherScenario: 'claude-web',
  connectorsPath: '/customize/connectors',
  sessionCookie: /^sessionKey$/,
  chatPath: '/new',
  chatIdPattern: /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  chatPathFor: (id) => `/chat/${id}`,
  // Claude has no archive here; the test chat is deleted from its header menu.
  // Not yet seen on the real site (Ticket 256).
  archiveMenu: exact('Open chat options', 'Chat options', 'Chat menu'),
  archiveItem: exact('Delete'),
  archiveConfirm: exact('Delete', 'Confirm'),
  // Deleting cannot be undone, so runs keep Claude test chats unless asked
  // (--delete-claude-chats); the [Cadence QA] prompt marker makes them easy to find.
  chatCleanup: 'delete',
  loginPath: /^\/(login|logout|magic-link)\b/i,
  loginButton: exact('Continue with Google', 'Continue with email', 'Log in', 'Sign in'),
  nameField: exact('Name'),
  urlField: /^\s*(Remote MCP server URL|MCP server URL|Server URL|URL)\s*$/i,
  composer: 'div[contenteditable="true"].ProseMirror, [contenteditable="true"][role="textbox"], div[contenteditable="true"]',
  send: exact('Send message', 'Send'),
  approve: exact('Allow once', 'Allow', 'Approve', 'Confirm'),
  reauthorize: exact('Connect', 'Reconnect', 'Authorize'),
  stop: /^\s*Stop( response| generating)?\s*$/i,
  assistant: '[data-is-streaming], [data-testid="assistant-message"]',
  settingsMarker(page) { return page.getByRole('button', { name: exact('Add connector') }); },
  /** Switches the list to "Yours" (a view filter) and finds the row. */
  async findConnector(page, name, timeoutMs = 3_000) {
    // The list can re-render (for example after adding a connector), which
    // resets the filter, so the filter is checked again on every pass.
    const deadline = Date.now() + timeoutMs;
    const row = page.getByRole('row', { name: exact(`View ${name}`) });
    for (;;) {
      const yours = await waitVisible(page.getByRole('radio', { name: exact('Yours') }), Math.max(0, deadline - Date.now()));
      if (!yours) throw new WebStop('page-changed', 'connector-list');
      if (await yours.getAttribute('aria-checked').catch(() => null) !== 'true') await yours.click({ timeout: 5_000 }).catch(() => {});
      const found = await waitVisible(row, 1_000);
      if (found || Date.now() >= deadline) return found;
    }
  },
  async addConnector(page, { name, url }) {
    await clickNamed(page, exact('Add connector'), 'connector-create');
    await clickNamed(page, exact('Add custom connector'), 'connector-create');
    await fillNamed(page, this.nameField, name, 'connector-name');
    await fillNamed(page, this.urlField, url, 'connector-url');
    const dialog = page.getByRole('dialog').last();
    await clickNamed(page, exact('Add'), 'connector-submit', { scope: dialog });
    // Let the form close (and any re-render settle) before reading the list.
    await dialog.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => { throw new WebStop('page-changed', 'connector-submit'); });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const entry = await this.findConnector(page, name, 15_000);
    if (!entry) throw new WebStop('page-changed', 'connector-submit');
    await this.reconnect(page, entry, name);
  },
  async reconnect(page, entry, name) {
    await entry.click();
    const connect = await waitVisible(clickable(page.getByRole('main'), exact('Connect')), 10_000);
    if (connect) { await connect.click(); return; }
    await clickNamed(page, exact(`More options for ${name}`), 'connector-reconnect');
    await clickNamed(page, exact('Disconnect'), 'connector-reconnect');
    await confirmIfAsked(page, exact('Disconnect', 'Confirm'));
    await clickNamed(page, exact('Connect'), 'connector-reconnect', { scope: page.getByRole('main') });
  },
  // A connected custom connector is on for new chats.
  async enableInChat() {},
});

export const SITES = Object.freeze({ chatgpt, 'claude-web': claudeWeb });

/** The chat ID in a page URL on this site, or null (for example a new, unsent chat). */
export function chatIdOf(site, url) {
  try {
    const m = site.chatIdPattern.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : null;
  } catch { return null; }
}

// Where a conversation's own header and body live, and where other chats are
// listed. The options control is looked up only inside the first and never
// inside the second.
const CONVERSATION = 'main, [role="main"], #page-header';
const NOT_CONVERSATION = 'nav, aside, [role="navigation"], [role="complementary"]';

/**
 * Chats linked anywhere on the page (the history list): chat ID → link title.
 * Titles stay in memory; they are printed only to name a chat the run must
 * report to Emi, never written to the run folder.
 */
export async function listedChats(page, site) {
  const links = await page.locator('a[href]').evaluateAll((as) => as.map((a) => [a.getAttribute('href'), (a.textContent ?? '').trim()]));
  const chats = new Map();
  for (const [href, title] of links) {
    const id = chatIdOf(site, new URL(href, page.url()).href);
    if (id && !chats.has(id)) chats.set(id, title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80));
  }
  return chats;
}

export async function listedChatIds(page, site) {
  return new Set((await listedChats(page, site)).keys());
}

/**
 * Visible elements named like the chat options control inside the conversation
 * area, outside any navigation, each with the chat IDs its ancestors (below the
 * conversation root) link to. A history row's button sits next to that row's link.
 */
async function conversationOptions(page, site) {
  const all = page.getByRole('button', { name: site.archiveMenu });
  const found = [];
  const count = await all.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const item = all.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    const hrefs = await item.evaluate((el, [inner, outer]) => {
      const root = el.closest(inner);
      if (!root || el.closest(outer)) return null;
      const seen = [];
      for (let node = el; node && node !== root; node = node.parentElement) {
        if (node.matches('a[href]')) seen.push(node.getAttribute('href'));
        for (const a of node.querySelectorAll('a[href]')) seen.push(a.getAttribute('href'));
      }
      return seen;
    }, [CONVERSATION, NOT_CONVERSATION]).catch(() => null);
    if (hrefs === null) continue;
    const linked = new Set(hrefs.map((href) => chatIdOf(site, new URL(href, page.url()).href)).filter(Boolean));
    found.push({ item, linked });
  }
  return found;
}

/** Other chats listed before the click and missing now, with their titles. */
function missingChats(before, after) {
  return [...before].filter(([id]) => !after.has(id)).map(([chatId, title]) => ({ chatId, title }));
}

function touchedOther(affected) {
  const stop = new WebStop('archive-touched-other-chat', 'chat-archive');
  stop.affectedChats = affected;
  return stop;
}

/**
 * Archives (ChatGPT) or deletes (Claude) the run's own chat `chatId`, which
 * must be the chat open in `page`. Before any click it stops with page-changed
 * at chat-archive when the URL is not that chat, when the options control
 * inside the conversation area is missing or ambiguous, or when a matching
 * control's ancestors link to another chat (a history row); nothing is touched.
 * Afterwards every other chat listed before must still be listed
 * (archive-touched-other-chat, with the missing chats' titles, checked first,
 * also on timeout), and the run's chat must be gone (archive-unconfirmed).
 * It never searches or opens other chats.
 */
export async function archiveChat(page, site, chatId, { timeoutMs = 10_000 } = {}) {
  if (!chatId || chatIdOf(site, page.url()) !== chatId) throw new WebStop('page-changed', 'chat-archive');
  const deadline = Date.now() + timeoutMs;
  let options = await conversationOptions(page, site);
  while (options.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    options = await conversationOptions(page, site);
  }
  if (options.some((o) => [...o.linked].some((id) => id !== chatId))) throw new WebStop('page-changed', 'chat-archive');
  if (options.length !== 1) throw new WebStop('page-changed', 'chat-archive');
  if (chatIdOf(site, page.url()) !== chatId) throw new WebStop('page-changed', 'chat-archive');
  const before = await listedChats(page, site);
  before.delete(chatId);
  await options[0].item.click({ timeout: 5_000 });
  await clickNamed(page, site.archiveItem, 'chat-archive', { scope: page.getByRole('menu'), timeoutMs: 5_000 });
  await confirmIfAsked(page, site.archiveConfirm);
  // Wait until the page has left the chat and the chat is no longer listed.
  for (;;) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const listed = await listedChats(page, site).catch(() => null);
    if (listed) {
      const missing = missingChats(before, listed);
      if (missing.length) throw touchedOther(missing);
      if (chatIdOf(site, page.url()) !== chatId && !listed.has(chatId)) return;
    }
    if (Date.now() >= deadline + 5_000) {
      // Timed out: another chat vanishing outranks "still there".
      const last = await listedChats(page, site).catch(() => null);
      if (last) {
        const missing = missingChats(before, last);
        if (missing.length) throw touchedOther(missing);
      }
      throw new WebStop('archive-unconfirmed', 'chat-archive');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** A copy of a site whose pages live elsewhere (the stub pages in tests). */
export function withOrigin(site, origin) {
  return Object.freeze(Object.assign(Object.create(Object.getPrototypeOf(site)), site, { origin }));
}
