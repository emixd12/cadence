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

const chatgpt = Object.freeze({
  id: 'chatgpt',
  label: 'ChatGPT',
  origin: 'https://chatgpt.com',
  consentClient: 'ChatGPT',
  watcherScenario: 'chatgpt',
  connectorsPath: '/#settings/Connectors',
  chatPath: '/',
  loginPath: /^\/(auth|log-?in)\b/i,
  loginButton: exact('Log in', 'Sign up', 'Sign up for free'),
  settingsReady: exact('Apps', 'Apps & Connectors', 'Apps and Connectors', 'Connectors'),
  // Developer mode lives under the settings' advanced section.
  advanced: exact('Advanced settings', 'Advanced'),
  developerMode: exact('Developer mode'),
  create: exact('Create', 'Create app', 'Create connector', 'Add connector'),
  nameField: exact('Name'),
  urlField: /^\s*(MCP server URL|Server URL|MCP Server URL|URL)\s*$/i,
  authField: /^\s*Authentication\s*$/i,
  authOAuth: exact('OAuth'),
  trust: /I (understand|trust)/i,
  submitCreate: exact('Create'),
  connect: exact('Connect', 'Reconnect', 'Sign in'),
  disconnect: exact('Disconnect'),
  confirmDisconnect: exact('Disconnect', 'Confirm'),
  composer: '#prompt-textarea, [contenteditable="true"][role="textbox"], textarea[name="prompt-textarea"]',
  send: exact('Send prompt', 'Send message', 'Send'),
  composerTools: exact('Add files and more', 'Add photos & files', 'Add photos and files', 'Tools'),
  composerDeveloper: exact('Developer mode', 'More'),
  approve: exact('Allow once', 'Confirm', 'Allow', 'Approve'),
  reauthorize: exact('Connect', 'Reconnect', 'Sign in', 'Authorize'),
  stop: /^\s*Stop( generating| streaming| response)?\s*$/i,
  assistant: '[data-message-author-role="assistant"]',
  /** Turn developer mode on (the dry run only reads it). */
  async developerModeState(page) {
    const toggle = await waitVisible(page.getByRole('switch', { name: this.developerMode }).or(page.getByRole('checkbox', { name: this.developerMode })), 3_000);
    if (!toggle) return 'unknown';
    const checked = await toggle.getAttribute('aria-checked').catch(() => null);
    return checked === 'true' ? 'on' : checked === 'false' ? 'off' : 'unknown';
  },
  async addConnector(page, { name, url }) {
    if (await this.developerModeState(page) === 'off') {
      await clickNamed(page, this.developerMode, 'developer-mode');
    }
    await clickNamed(page, this.create, 'connector-create');
    await fillNamed(page, this.nameField, name, 'connector-name');
    await fillNamed(page, this.urlField, url, 'connector-url');
    const auth = await waitVisible(page.getByRole('combobox', { name: this.authField }).or(page.getByLabel(this.authField)), 3_000);
    if (auth) {
      const tag = await auth.evaluate((node) => node.tagName).catch(() => '');
      if (tag === 'SELECT') await auth.selectOption({ label: 'OAuth' });
      else { await auth.click(); await clickNamed(page, this.authOAuth, 'connector-auth'); }
    }
    const trust = await waitVisible(page.getByRole('checkbox', { name: this.trust }).or(page.getByLabel(this.trust)), 3_000);
    if (trust && !(await trust.isChecked().catch(() => false))) await trust.check();
    await clickNamed(page, this.submitCreate, 'connector-submit', { scope: page.getByRole('dialog').last() });
    // ChatGPT starts its OAuth flow as soon as the connector is created.
  },
  async reconnect(page, row) {
    await row.click();
    const disconnect = await waitVisible(clickable(page, this.disconnect), 3_000);
    if (disconnect) {
      await disconnect.click();
      const confirm = await waitVisible(clickable(page.getByRole('alertdialog').or(page.getByRole('dialog')).last(), this.confirmDisconnect), 3_000);
      if (confirm) await confirm.click();
    }
    await clickNamed(page, this.connect, 'connector-connect');
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
  connectorsPath: '/settings/connectors',
  chatPath: '/new',
  loginPath: /^\/(login|logout|magic-link)\b/i,
  loginButton: exact('Continue with Google', 'Continue with email', 'Log in', 'Sign in'),
  settingsReady: exact('Connectors', 'Add custom connector'),
  create: exact('Add custom connector', 'Add connector'),
  nameField: exact('Name'),
  urlField: /^\s*(Remote MCP server URL|MCP server URL|Server URL|URL)\s*$/i,
  submitCreate: exact('Add'),
  connect: exact('Connect', 'Reconnect'),
  disconnect: exact('Disconnect'),
  confirmDisconnect: exact('Disconnect', 'Confirm'),
  composer: 'div[contenteditable="true"].ProseMirror, [contenteditable="true"][role="textbox"], div[contenteditable="true"]',
  send: exact('Send message', 'Send'),
  approve: exact('Allow once', 'Allow', 'Approve', 'Confirm'),
  reauthorize: exact('Connect', 'Reconnect', 'Authorize'),
  stop: /^\s*Stop( response| generating)?\s*$/i,
  assistant: '[data-is-streaming], [data-testid="assistant-message"]',
  async developerModeState() { return 'not-applicable'; },
  async addConnector(page, { name, url }) {
    await clickNamed(page, this.create, 'connector-create');
    await fillNamed(page, this.nameField, name, 'connector-name');
    await fillNamed(page, this.urlField, url, 'connector-url');
    await clickNamed(page, this.submitCreate, 'connector-submit', { scope: page.getByRole('dialog').last() });
    // Claude lists the connector first; Connect starts OAuth in a new window.
    const row = await waitVisible(page.getByRole('listitem').filter({ hasText: name }).or(page.locator('[data-connector-name]').filter({ hasText: name })), 15_000);
    await clickNamed(page, this.connect, 'connector-connect', { scope: row ?? page });
  },
  async reconnect(page, row) {
    const disconnect = await waitVisible(clickable(row, this.disconnect), 2_000);
    if (disconnect) {
      await disconnect.click();
      const confirm = await waitVisible(clickable(page.getByRole('alertdialog').or(page.getByRole('dialog')).last(), this.confirmDisconnect), 3_000);
      if (confirm) await confirm.click();
    }
    await clickNamed(page, this.connect, 'connector-connect', { scope: row });
  },
  // A connected custom connector is on for new chats.
  async enableInChat() {},
});

export const SITES = Object.freeze({ chatgpt, 'claude-web': claudeWeb });

/** A copy of a site whose pages live elsewhere (the stub pages in tests). */
export function withOrigin(site, origin) {
  return Object.freeze(Object.assign(Object.create(Object.getPrototypeOf(site)), site, { origin }));
}

/** The connector row on the settings page, or null. */
export async function findConnectorRow(page, name, timeoutMs = 5_000) {
  const byName = exact(name);
  const row = page.getByRole('listitem').filter({ has: page.getByText(byName) })
    .or(page.locator('[data-connector-name]').filter({ has: page.getByText(byName) }));
  return waitVisible(row, timeoutMs);
}
