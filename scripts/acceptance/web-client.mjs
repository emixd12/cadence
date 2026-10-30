// Ticket 255. Browser-driven ChatGPT web and Claude web acceptance runs.
//
// The agent drives the real sites in a dedicated Chrome profile that lives
// outside the repository (default ~/Library/Application Support/Cadence QA
// Chrome). `open` starts that profile as a normal Chrome window with a
// loopback DevTools port (4430) so Emi can sign in to ChatGPT and Claude once;
// every later command attaches to the same window through that port. Emi's
// everyday Chrome profiles are refused by path and by profile name.
//
// A run: preflight grants → start the Ticket 250 watcher → connect or
// reconnect the "Cadence QA" connector → Cadence consent with Ticket 248's
// helpers (account A or B, chosen scopes) → grant checkpoint → canned read and
// write prompts, approving tool calls in the chat → creation checkpoint →
// watcher result → revoke the run's grant. Each step is recorded in a Ticket
// 247 run folder and resumes from it.
//
// Output and the ledger hold step names, fixed reasons, IDs, scopes, counts
// and hashes only: never URLs, cookies, tokens, codes, prompts or reply text.
// Screenshots are taken only on failure and stay in the run folder (mode
// 0600, never committed). A login wall, bot check or changed page stops the
// run with a named reason and prints the guided fallback.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { isCliEntry } from './cli-entry.mjs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GRANTS, checkConsentView, readConsentView, submitConsent } from './consent-page.mjs';
import { createRun, resumeRun } from './ledger.mjs';
import { AcceptanceError, PRODUCTION } from './test-account-sessions.mjs';
import { SITES, WebStop, archiveChat, chatIdOf, classifyPage, clickable, waitVisible } from './web-sites.mjs';

export { SITES, WebStop };

export const DEFAULT_PROFILE_DIR = join(homedir(), 'Library', 'Application Support', 'Cadence QA Chrome');
export const DEFAULT_DEBUG_PORT = 4430;
export const PORT_RANGE = Object.freeze([4430, 4439]);
export const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const CONNECTOR_NAME = 'Cadence QA';
export const PRODUCTION_MCP_URL = `${PRODUCTION.issuer}/mcp`;
// Emi's everyday Chrome profiles. Never opened, attached to or written.
export const FORBIDDEN_PROFILE_NAMES = Object.freeze(['Identity Scaffolding', 'Emi Chrome']);
// Ticket 232's captured grants (owned by its cleanup until 2026-11-04T02:17Z).
// A run stops before any consent if one of them is still active for its slot,
// because a reconnect could re-consent it. IDs are compared, never recorded.
export const TICKET_232_GRANT_PREFIXES = Object.freeze(['5d764426', '9919ddc7', 'd3b99bcc', '59e3ae31']);

/**
 * Canned scenarios. `grant` is what the agent ticks on Cadence's consent
 * screen; `stepUpGrant` answers a second consent the client starts after a
 * denied write. Prompts name a unique "Review practice" Behavior so Ticket
 * 232's creation checkpoint and cleanup helpers recognise it.
 */
export const SCENARIOS = Object.freeze({
  'read-write': Object.freeze({
    description: 'Connect with read and both write scopes, then one read prompt and one create_behavior prompt.',
    decision: 'allow', grant: 'full', stepUpGrant: null, prompts: Object.freeze(['read', 'write']), watch: true,
  }),
  'step-up': Object.freeze({
    description: 'Connect read-only, then a write prompt. The client must ask again for write access; the agent allows the full grant.',
    decision: 'allow', grant: 'read', stepUpGrant: 'full', prompts: Object.freeze(['read', 'write']), watch: true,
  }),
  deny: Object.freeze({
    description: 'Click Deny on the consent screen. No grant may appear.',
    decision: 'deny', grant: 'read', stepUpGrant: null, prompts: Object.freeze([]), watch: false,
  }),
});

export const PROMPTS = Object.freeze({
  read: () => `Use the ${CONNECTOR_NAME} connector to list my Cadence behaviors. Reply with only the number of behaviors.`,
  write: (label) => `Use the ${CONNECTOR_NAME} connector to create a new daily behavior titled "Review practice ${label}". Do not change anything else. Reply with the word DONE when it is created.`,
});

const SLOTS = ['A', 'B'];
const LABEL = /^[a-z0-9-]{1,40}$/;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Profile ----------------------------------------------------------------

const inside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const realOrResolved = (path) => {
  let current = resolve(path);
  const rest = [];
  while (!existsSync(current) && dirname(current) !== current) { rest.unshift(current.slice(dirname(current).length + 1)); current = dirname(current); }
  try { return join(realpathSync(current), ...rest); } catch { return resolve(path); }
};

/**
 * Refuses any profile directory that is not a dedicated QA profile: relative
 * paths, the home folder, anything inside the repository or its sibling
 * worktrees, any Chrome or Chromium data folder, and any folder whose Local
 * State names one of Emi's everyday profiles.
 */
export function assertProfileDir(dir, { repoRoot = process.cwd(), home = homedir(), readFile = readFileSync } = {}) {
  if (typeof dir !== 'string' || !isAbsolute(dir)) throw new WebStop('profile-unsafe', 'profile-path');
  const real = realOrResolved(dir);
  const realHome = realOrResolved(home);
  if (real === realHome || real === sep || inside(realHome, real)) throw new WebStop('profile-unsafe', 'profile-path');
  const workspace = dirname(realOrResolved(repoRoot));
  if (inside(real, workspace)) throw new WebStop('profile-unsafe', 'profile-in-repo');
  const support = join(realHome, 'Library', 'Application Support');
  for (const vendor of ['Google', 'Chromium', 'BraveSoftware', 'Microsoft Edge', 'Arc']) {
    if (inside(real, join(support, vendor))) throw new WebStop('profile-unsafe', 'profile-everyday-chrome');
  }
  let state = null;
  try { state = JSON.parse(readFile(join(real, 'Local State'), 'utf8')); } catch { state = null; }
  const names = Object.values(state?.profile?.info_cache ?? {}).map((p) => p?.name).filter((n) => typeof n === 'string');
  if (names.some((n) => FORBIDDEN_PROFILE_NAMES.includes(n))) throw new WebStop('profile-unsafe', 'profile-everyday-chrome');
  return real;
}

export function assertPort(port) {
  if (!Number.isInteger(port) || port < PORT_RANGE[0] || port > PORT_RANGE[1]) throw new WebStop('port-not-allowed', 'profile-port');
  return port;
}

export function chromeArgs({ profileDir, port, urls = [] }) {
  return [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', ...urls];
}

const devtoolsUp = async (port, fetchImpl = fetch) => {
  try { return (await fetchImpl(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2_000) })).ok; } catch { return false; }
};

const execText = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 20, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * True when every process listening on the loopback port is a Chrome started
 * with exactly this profile and port, so an unrelated Chrome (or anything
 * else) on the same port is never attached to. Chrome does not write
 * DevToolsActivePort for a fixed port, so the listener's command line decides.
 */
export function profileOwnsPort({
  profileDir, port,
  listenerPids = () => execText('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']),
  commandOf = (pid) => execText('/bin/ps', ['-ww', '-p', pid, '-o', 'command=']),
}) {
  let pids;
  try { pids = [...new Set(listenerPids().split('\n').map((p) => p.trim()).filter((p) => /^\d+$/.test(p)))]; } catch { return false; }
  if (!pids.length) return false;
  return pids.every((pid) => {
    let command = '';
    try { command = commandOf(pid); } catch { return false; }
    return command.startsWith(`${CHROME_BIN} `) && command.includes(`--user-data-dir=${profileDir} `) && command.includes(`--remote-debugging-port=${port}`);
  });
}

/**
 * Opens the dedicated profile as a normal Chrome window (not an automation
 * launch), so Emi can sign in. Reuses it when it is already open.
 */
export async function openProfile({ profileDir, port = DEFAULT_DEBUG_PORT, urls = [], spawnImpl = spawn, fetchImpl = fetch, owns = profileOwnsPort, timeoutMs = 30_000, repoRoot } = {}) {
  const dir = assertProfileDir(profileDir, { repoRoot });
  assertPort(port);
  if (owns({ profileDir: dir, port }) && await devtoolsUp(port, fetchImpl)) return { state: 'already-open', profileDir: dir, port };
  if (await devtoolsUp(port, fetchImpl)) throw new WebStop('port-busy', 'profile-open');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const child = spawnImpl(CHROME_BIN, chromeArgs({ profileDir: dir, port, urls }), { detached: true, stdio: 'ignore' });
  child.unref?.();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await devtoolsUp(port, fetchImpl) && owns({ profileDir: dir, port })) return { state: 'opened', profileDir: dir, port };
    await sleep(500);
  }
  throw new WebStop('profile-open-timeout', 'profile-open');
}

/** Attach to the open profile. Never launches a browser itself. */
export async function attachProfile({ profileDir, port = DEFAULT_DEBUG_PORT, owns = profileOwnsPort, connect, repoRoot } = {}) {
  const dir = assertProfileDir(profileDir, { repoRoot });
  assertPort(port);
  if (!owns({ profileDir: dir, port })) throw new WebStop('profile-not-open', 'profile-attach');
  const connectImpl = connect ?? (async (endpoint) => (await import('playwright-core')).chromium.connectOverCDP(endpoint));
  let browser;
  try { browser = await connectImpl(`http://127.0.0.1:${port}`); } catch { throw new WebStop('profile-not-open', 'profile-attach'); }
  const context = browser.contexts()[0];
  if (!context) { await browser.close().catch(() => {}); throw new WebStop('profile-not-open', 'profile-attach'); }
  // For an attached browser, close() disconnects and leaves Chrome running.
  return { browser, context, detach: () => browser.close().catch(() => {}) };
}

// ---- Guided fallback ----------------------------------------------------------

export function guidedFallback({ client, slot = 'A', scenario = 'read-write', reason }) {
  const site = SITES[client];
  const s = SCENARIOS[scenario] ?? SCENARIOS['read-write'];
  const where = client === 'chatgpt'
    ? 'Settings → Plugins → Cadence QA → Reconnect (or create the developer app if it is missing)'
    : 'Customize → Connectors → Yours → Cadence QA → Connect (or Add connector → Add custom connector)';
  return [
    `guided-fallback ${client} reason=${reason}`,
    `  1. In the Cadence QA Chrome window, open ${site?.label ?? client}: ${where}.`,
    `  2. Name "${CONNECTOR_NAME}", URL ${PRODUCTION_MCP_URL}, then connect.`,
    `  3. On Cadence's consent screen, check the account is test account ${slot} and ${s.decision === 'deny' ? 'click Deny' : `allow the ${s.grant} grant`}.`,
    `  4. Start the watcher first: npm run mcp:watch -- --target production --confirm-production --account ${slot} --since 5m --expect ${site?.watcherScenario ?? client}`,
    '  5. In a new chat, send the canned prompts from scripts/acceptance/web-client.mjs and approve each tool call. Then archive (ChatGPT) or delete (Claude) that chat. Never open other chats.',
    '  Guided mode (Ticket 252) owns the full human checklist.',
  ];
}

// ---- One run ------------------------------------------------------------------

const summary = (entry) => JSON.stringify(entry);

/** Waits for Cadence's consent (or login) page in any tab of the context. */
export async function waitForCadencePage(context, issuer, timeoutMs) {
  const origin = new URL(issuer).origin;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const page of context.pages()) {
      let url;
      try { url = new URL(page.url()); } catch { continue; }
      if (url.origin !== origin) continue;
      if (url.pathname.startsWith('/oauth/consent')) return { page, kind: 'consent' };
      if (url.pathname === '/login' || url.pathname.startsWith('/auth/')) return { page, kind: 'login' };
    }
    if (Date.now() >= deadline) return null;
    await sleep(250);
  }
}

/** Complete Cadence's consent for the slot with Ticket 248's checks. */
export async function completeConsent({ context, issuer, account, site, decision, grant, timeoutMs, track }) {
  const found = await waitForCadencePage(context, issuer, timeoutMs);
  if (!found) throw new WebStop('consent-not-reached', 'consent');
  track(found.page);
  if (found.kind === 'login') throw new WebStop('cadence-login-wall', 'consent');
  let view;
  try { view = await readConsentView(found.page); } catch { throw new WebStop('page-changed', 'consent'); }
  const offered = [...(view.fixedScopes ?? []), ...(view.optionalScopes ?? [])];
  const problems = checkConsentView(view, { userId: account.userId, email: account.email ?? null, clientName: site.consentClient, requestedScopes: offered });
  if (problems.includes('account') || problems.includes('email')) throw new WebStop('consent-wrong-account', 'consent');
  if (problems.length) throw new WebStop(`consent-mismatch-${problems[0]}`, 'consent');
  const grantScopes = GRANTS[grant];
  try { await submitConsent(found.page, { decision, grantScopes }); } catch (error) {
    throw new WebStop(error instanceof AcceptanceError ? error.code : 'consent-submit-failed', 'consent');
  }
  // The consent tab navigates back to the client (or closes, for a popup).
  const leftBy = Date.now() + 20_000;
  for (;;) {
    let still = false;
    try { still = !found.page.isClosed() && new URL(found.page.url()).pathname.startsWith('/oauth/consent') && new URL(found.page.url()).origin === new URL(issuer).origin; } catch { still = false; }
    if (!still) break;
    if (Date.now() >= leftBy) throw new WebStop('consent-stuck', 'consent');
    await sleep(200);
  }
  return { offeredScopes: offered.sort(), grantedScopes: decision === 'allow' ? grantScopes.filter((s) => offered.includes(s)).sort() : [] };
}

/**
 * Drive one chat turn: approve tool calls, answer a step-up consent if the
 * scenario allows one, and wait until the reply has finished. Returns counts
 * and a hash of the reply; the text itself is never kept.
 */
export async function driveTurn({ page, site, context, issuer, onConsent = null, timeoutMs, quietMs = 2_500, track, before }) {
  const assistant = page.locator(site.assistant);
  const deadline = Date.now() + timeoutMs;
  let approvals = 0;
  let consents = 0;
  let quietSince = null;
  while (Date.now() < deadline) {
    if (onConsent) {
      const consent = await waitForCadencePage(context, issuer, 0);
      if (consent) { await onConsent(); consents += 1; track(page); quietSince = null; continue; }
      const reauth = await waitVisible(clickable(assistant.last(), site.reauthorize), 0);
      if (reauth && consents === 0) { await reauth.click(); quietSince = null; continue; }
    }
    const approve = await waitVisible(clickable(page, site.approve), 0);
    if (approve) {
      if (approvals >= 10) throw new WebStop('too-many-approvals', 'chat-approve');
      await approve.click();
      approvals += 1;
      quietSince = null;
      continue;
    }
    const count = await assistant.count().catch(() => 0);
    const streaming = await waitVisible(clickable(page, site.stop), 0)
      || (count > 0 && await assistant.last().getAttribute('data-is-streaming').catch(() => null) === 'true');
    if (count > before && !streaming) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) {
        const text = (await assistant.last().innerText().catch(() => '')).trim();
        if (!text) throw new WebStop('reply-empty', 'chat-reply');
        return { approvalCount: approvals, consentCount: consents, replyHash: sha256(text), replyLength: text.length, doneSeen: /\bDONE\b/.test(text) };
      }
    } else quietSince = null;
    await sleep(250);
  }
  throw new WebStop(approvals === 0 && (await assistant.count().catch(() => 0)) <= before ? 'reply-timeout' : 'tool-approval-timeout', 'chat-reply');
}

export async function sendPrompt(page, site, text) {
  const composer = await waitVisible(page.locator(site.composer), 20_000);
  if (!composer) throw new WebStop('page-changed', 'chat-composer');
  await composer.click();
  await composer.fill(text);
  const send = await waitVisible(clickable(page, site.send), 3_000);
  if (send) await send.click(); else await composer.press('Enter');
}

async function openConnectors(page, site, step) {
  await page.goto(`${site.origin}${site.connectorsPath}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { throw new WebStop('site-unreachable', step); });
  const state = await classifyPage(page, site);
  if (state !== 'ok') throw new WebStop(state, step);
  const ready = await waitVisible(site.settingsMarker(page), 20_000);
  if (!ready) {
    const again = await classifyPage(page, site);
    throw new WebStop(again === 'ok' ? 'page-changed' : again, step);
  }
}

/**
 * Sign-in state from cookie names only, with no page opened, so it can poll
 * while Emi signs in. Values never leave the browser's cookie store.
 */
export async function signInStatus({ context, sites = Object.values(SITES), now = () => Date.now() }) {
  const result = {};
  for (const site of sites) {
    const names = (await context.cookies(site.origin)).filter((c) => c.expires === -1 || c.expires * 1000 > now()).map((c) => c.name);
    result[site.id] = names.some((n) => site.sessionCookie.test(n));
  }
  return result;
}

/**
 * Dry run: reach the connector settings in the kept profile and look for the
 * Cadence QA connector. Clicks only Claude's "Yours" list filter; saves nothing.
 */
export async function dryRunSite({ context, site, screenshotDir = null }) {
  const page = await context.newPage();
  try {
    await openConnectors(page, site, 'dry-run');
    const existing = await site.findConnector(page, CONNECTOR_NAME);
    return { client: site.id, ok: true, reached: 'connector-settings', connectorPresent: Boolean(existing) };
  } catch (error) {
    if (!(error instanceof WebStop)) throw error;
    const shot = screenshotDir ? await failureShot(page, screenshotDir, `dry-run-${site.id}`) : null;
    return { client: site.id, ok: false, reason: error.reason, step: error.step, screenshot: shot };
  } finally {
    await page.close().catch(() => {});
  }
}

async function failureShot(page, dir, name) {
  if (!page || page.isClosed?.()) return null;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `failure-${name}.png`);
    await page.screenshot({ path: file, fullPage: false, timeout: 10_000 });
    chmodSync(file, 0o600);
    return `failure-${name}.png`;
  } catch { return null; }
}

/**
 * One scenario for one client and slot. Dependencies are injected so the stub
 * pages in tests exercise exactly this code:
 * - context: the attached profile's browser context
 * - sessions: Ticket 248 session manager (browserCookies, absorbBrowserCookies)
 * - rest: Ticket 232 createRest adapter as the test account (RLS)
 * - cleanup: { listGrants, checkpointGrant, checkpointCreation, revokeCaptured }
 * - watcher: { start({ scenario, slot, sinceIso, runId }) → { result: Promise<exitCode>, stop() } }
 */
export async function runWebScenario({
  site, context, issuer, mcpUrl, slot, scenario: scenarioName, account, sessions, rest, cleanup, watcher, run, label: labelArg,
  out = (line) => process.stdout.write(`${line}\n`), now = () => new Date(), keepGrant = false, archiveChats = true,
  timeouts = { consentMs: 90_000, turnMs: 180_000, quietMs: 2_500 },
}) {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) throw new WebStop('scenario-unknown', 'setup');
  if (!SLOTS.includes(slot)) throw new WebStop('slot-invalid', 'setup');
  if (!LABEL.test(labelArg ?? '') || labelArg.length > 32) throw new WebStop('label-invalid', 'setup');
  let label = labelArg;
  const emit = (entry) => out(summary({ client: site.id, slot, scenario: scenarioName, ...entry }));
  const runDir = run.dir;
  let current = null;
  const track = (page) => { current = page; };
  const issuerHost = new URL(issuer).hostname;
  const startedAt = now().toISOString();
  let watch = null;
  try {
    const pre = await run.step('preflight', async () => {
      const grants = await cleanup.listGrants({ rest, slot });
      if (grants.some((g) => TICKET_232_GRANT_PREFIXES.some((p) => g.grant_id.startsWith(p)))) throw new WebStop('ticket-232-grants-active', 'preflight');
      if (grants.some((g) => g.client_name === site.consentClient)) throw new WebStop('client-grant-active', 'preflight');
      return { knownGrantIds: grants.map((g) => g.grant_id), windowStartAt: startedAt, runLabel: label };
    });
    label = pre.runLabel;
    emit({ step: 'preflight', ok: true, knownCount: pre.knownGrantIds.length });

    if (scenario.watch) watch = watcher.start({ scenario: site.watcherScenario, slot, sinceIso: pre.windowStartAt, runId: run.runId });

    const consentAnswer = (decision, grant) => () => completeConsent({
      context, issuer, account, site, decision, grant, timeoutMs: timeouts.consentMs, track,
    });

    const connected = await run.step('connect', async ({ interrupted }) => {
      if (interrupted) {
        const grants = await cleanup.listGrants({ rest, slot });
        if (grants.some((g) => !pre.knownGrantIds.includes(g.grant_id))) throw new WebStop('interrupted-connect-needs-review', 'connect');
      }
      await context.addCookies(await sessions.browserCookies(slot, issuer));
      const page = await context.newPage();
      track(page);
      await openConnectors(page, site, 'connector-settings');
      const entry = await site.findConnector(page, CONNECTOR_NAME);
      if (entry) await site.reconnect(page, entry, CONNECTOR_NAME);
      else await site.addConnector(page, { name: CONNECTOR_NAME, url: mcpUrl });
      const consent = await consentAnswer(scenario.decision, scenario.grant)();
      await sessions.absorbBrowserCookies(slot, await context.cookies(issuer)).catch(() => ({ rotated: false }));
      return consent;
    });
    emit({ step: 'connect', ok: true, offeredScopes: connected.offeredScopes, grantedScopes: connected.grantedScopes });

    if (scenario.decision === 'deny') {
      const result = await run.step('deny-check', async () => {
        await sleep(2_000);
        const grants = await cleanup.listGrants({ rest, slot });
        const fresh = grants.filter((g) => !pre.knownGrantIds.includes(g.grant_id));
        if (fresh.length) throw new WebStop('grant-after-deny', 'deny-check');
        return { grantCount: 0 };
      });
      emit({ step: 'deny-check', ok: true, grantCount: result.grantCount });
      return { ok: true, runId: run.runId };
    }

    const grant = await run.step('grant-checkpoint', async ({ checkpoint }) => {
      const existing = run.cleanupInputs().grants.find((g) => g.label === `${label}-grant`);
      if (existing) return existing;
      const cp = await cleanup.checkpointGrant({ rest, slot, label: `${label}-grant`, known: pre.knownGrantIds, since: pre.windowStartAt });
      if (cp.clientName !== site.consentClient) throw new WebStop('grant-client-mismatch', 'grant-checkpoint');
      checkpoint('grant', cp);
      return cp;
    });
    emit({ step: 'grant-checkpoint', ok: true, grantId: grant.grantId, scopes: grant.scopes });

    // Privacy (Emi's ChatGPT and Claude accounts): each prompt opens a new chat,
    // the run reads only that chat's reply, and archives it right after.
    const chats = [];
    for (const kind of scenario.prompts) {
      const stepName = `prompt-${kind}`;
      const turn = await run.step(stepName, async ({ interrupted }) => {
        if (kind === 'write' && interrupted) {
          const prior = await cleanup.checkpointCreation({ rest, slot, label: `${label}-create`, grantId: grant.grantId, windowStart: pre.windowStartAt, recorded: [] }).catch(() => null);
          if (prior) return { approvalCount: 0, consentCount: 0, resumed: true };
        }
        const page = await context.newPage();
        track(page);
        await page.goto(`${site.origin}${site.chatPath}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { throw new WebStop('site-unreachable', stepName); });
        const state = await classifyPage(page, site);
        if (state !== 'ok') throw new WebStop(state, stepName);
        await site.enableInChat(page, CONNECTOR_NAME);
        // Count turns before sending, so a fast reply is not mistaken for an old one.
        const before = await page.locator(site.assistant).count().catch(() => 0);
        await sendPrompt(page, site, kind === 'write' ? PROMPTS.write(label) : PROMPTS.read());
        const stepUp = kind === 'write' && scenario.stepUpGrant
          ? async () => {
            await context.addCookies(await sessions.browserCookies(slot, issuer));
            await consentAnswer('allow', scenario.stepUpGrant)();
          }
          : null;
        const result = await driveTurn({ page, site, context, issuer, onConsent: stepUp, timeoutMs: timeouts.turnMs, quietMs: timeouts.quietMs, track, before });
        if (stepUp && result.consentCount === 0) throw new WebStop('no-step-up', stepName);
        const chatId = chatIdOf(site, page.url());
        // A failed archive here is retried in archive-chats; the reply is already captured.
        const archived = archiveChats && chatId ? await archiveChat(page, site).then(() => true, () => false) : false;
        await page.close().catch(() => {});
        return { ...result, chatId, archived };
      });
      chats.push({ chatId: turn.chatId ?? null, archived: Boolean(turn.archived) });
      emit({ step: stepName, ok: true, approvalCount: turn.approvalCount, consentCount: turn.consentCount, replyHash: turn.replyHash ?? null, archived: Boolean(turn.archived) });
    }

    if (scenario.prompts.includes('write')) {
      const creation = await run.step('creation-checkpoint', async ({ checkpoint }) => {
        const existing = run.cleanupInputs().creations.find((c) => c.label === `${label}-create`);
        if (existing) return existing;
        const cp = await cleanup.checkpointCreation({ rest, slot, label: `${label}-create`, grantId: grant.grantId, windowStart: pre.windowStartAt, recorded: [] });
        checkpoint('creation', cp);
        return cp;
      });
      emit({ step: 'creation-checkpoint', ok: true, behaviorId: creation.behaviorId });
    }

    if (archiveChats && chats.length) {
      // Before the watcher verdict, so a watcher miss still leaves no test chat behind.
      const done = await run.step('archive-chats', async () => {
        let archivedCount = 0;
        let unknownCount = 0;
        for (const chat of chats) {
          if (chat.archived) { archivedCount += 1; continue; }
          // An interrupted write attempt can leave a chat whose ID was never recorded.
          if (!chat.chatId) { unknownCount += 1; continue; }
          const page = await context.newPage();
          track(page);
          await page.goto(`${site.origin}${site.chatPathFor(chat.chatId)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { throw new WebStop('site-unreachable', 'chat-archive'); });
          const pageState = await classifyPage(page, site);
          if (pageState !== 'ok') throw new WebStop(pageState, 'chat-archive');
          await archiveChat(page, site);
          archivedCount += 1;
          await page.close().catch(() => {});
        }
        return { chatCount: chats.length, archivedCount, unknownCount };
      });
      emit({ step: 'archive-chats', ok: true, ...done });
    }

    if (watch) {
      const code = await watch.result;
      watch = null;
      if (code !== 0) throw new WebStop(code === 1 ? 'watcher-unsatisfied' : 'watcher-failed', 'watcher');
      emit({ step: 'watcher', ok: true, watcherScenario: site.watcherScenario });
    }

    if (!keepGrant) {
      const revoked = await run.step('revoke', async () => {
        const results = await cleanup.revokeCaptured({ rest, captured: run.cleanupInputs().grants.filter((g) => g.label === `${label}-grant`) });
        return { revokedCount: results.filter((r) => r.outcome !== 'revoke-failed').length };
      });
      emit({ step: 'revoke', ok: true, revokedCount: revoked.revokedCount });
    }
    return { ok: true, runId: run.runId };
  } catch (error) {
    const stop = error instanceof WebStop ? error
      : new WebStop(typeof error?.reason === 'string' ? error.reason : error instanceof AcceptanceError ? error.code : 'internal-error', 'unknown');
    const shot = await failureShot(current, runDir, `${stop.step ?? 'run'}`);
    emit({ step: stop.step ?? 'run', ok: false, reason: stop.reason, screenshot: shot });
    for (const line of guidedFallback({ client: site.id, slot, scenario: scenarioName, reason: stop.reason })) out(line);
    return { ok: false, runId: run.runId, reason: stop.reason, step: stop.step };
  } finally {
    watch?.stop?.();
    await context.clearCookies({ domain: issuerHost }).catch(() => {});
  }
}

// ---- Production wiring ----------------------------------------------------------

/** Ticket 250 watcher as a child process; it writes into the same run folder. */
export function spawnWatcher({ target = 'production', spawnImpl = spawn, timeout = '12m', node = process.execPath } = {}) {
  return {
    start({ scenario, slot, sinceIso, runId }) {
      const script = fileURLToPath(new URL('./watch.mjs', import.meta.url));
      const args = [script, '--target', target, ...(target === 'production' ? ['--confirm-production'] : []),
        '--account', slot, '--since', sinceIso, '--expect', scenario, '--run', runId, '--timeout', timeout];
      const child = spawnImpl(node, args, { stdio: ['ignore', 'inherit', 'inherit'] });
      const result = new Promise((resolveExit) => {
        child.once('exit', (code) => resolveExit(typeof code === 'number' ? code : 3));
        child.once('error', () => resolveExit(3));
      });
      return { result, stop: () => { if (child.exitCode === null) child.kill('SIGTERM'); } };
    },
  };
}

async function productionDeps(env) {
  const key = env.CADENCE_QA_SUPABASE_PUBLISHABLE_KEY;
  if (!/^sb_publishable_/.test(key ?? '')) throw new WebStop('publishable-key-required', 'setup');
  const sessionsModule = await import('./test-account-sessions.mjs');
  const cleanup = await import('../mcp-acceptance-cleanup.mjs');
  const sessions = sessionsModule.createSessionManager({
    target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey: key, store: sessionsModule.createKeychainSessionStore(),
  });
  const rest = cleanup.createRest({
    origin: PRODUCTION.supabaseUrl, publishableKey: key,
    tokenFor: async (slot) => { try { return (await sessions.current(slot)).accessToken; } catch { return null; } },
  });
  return { sessions, rest, cleanup };
}

// ---- CLI ------------------------------------------------------------------------

export function parseCli(argv) {
  const positionals = argv.filter((a) => !a.startsWith('-'));
  const command = ['open', 'status', 'dry-run', 'run', 'revoke'].includes(positionals[0]) ? positionals[0] : 'run';
  const args = command === positionals[0] ? argv.slice(argv.indexOf(command) + 1) : argv;
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    client: { type: 'string' }, account: { type: 'string' }, scenario: { type: 'string' }, profile: { type: 'string' },
    port: { type: 'string' }, run: { type: 'string' }, 'allow-production': { type: 'boolean', default: false },
    'keep-grant': { type: 'boolean', default: false }, 'keep-chats': { type: 'boolean', default: false }, 'list-scenarios': { type: 'boolean', default: false },
  } });
  const port = values.port === undefined ? DEFAULT_DEBUG_PORT : Number(values.port);
  const opts = { command, profile: values.profile ?? DEFAULT_PROFILE_DIR, port, runId: values.run ?? null, allowProduction: values['allow-production'], keepGrant: values['keep-grant'], keepChats: values['keep-chats'], listScenarios: values['list-scenarios'] };
  if (opts.listScenarios) return opts;
  assertPort(port);
  if (command === 'dry-run') {
    const client = values.client ?? 'both';
    if (client !== 'both' && !SITES[client]) throw new WebStop('client-invalid', 'usage');
    return { ...opts, clients: client === 'both' ? Object.keys(SITES) : [client] };
  }
  if (command === 'run') {
    if (!SITES[values.client]) throw new WebStop('client-invalid', 'usage');
    if (!SLOTS.includes(values.account)) throw new WebStop('account-invalid', 'usage');
    if (!SCENARIOS[values.scenario]) throw new WebStop('scenario-invalid', 'usage');
    if (!opts.allowProduction) throw new WebStop('allow-production-required', 'usage');
    return { ...opts, client: values.client, slot: values.account, scenario: values.scenario };
  }
  if (command === 'revoke') {
    if (!opts.runId) throw new WebStop('run-required', 'usage');
    if (!opts.allowProduction) throw new WebStop('allow-production-required', 'usage');
  }
  return opts;
}

export async function main(argv = process.argv.slice(2), env = process.env, out = (line) => process.stdout.write(`${line}\n`)) {
  let opts;
  try { opts = parseCli(argv); } catch (error) {
    out(summary({ step: 'usage', ok: false, reason: error instanceof WebStop ? error.reason : 'usage-invalid' }));
    return 2;
  }
  if (opts.listScenarios) {
    for (const [name, s] of Object.entries(SCENARIOS)) out(`${name}: ${s.description}`);
    return 0;
  }
  try {
    if (opts.command === 'open') {
      const result = await openProfile({ profileDir: opts.profile, port: opts.port, urls: [`${SITES.chatgpt.origin}/`, `${SITES['claude-web'].origin}/`] });
      out(summary({ step: 'open', ok: true, state: result.state, port: result.port }));
      out('Sign in to ChatGPT and Claude in this window, then leave it open. Later runs attach to it.');
      return 0;
    }
    if (opts.command === 'status') {
      const { context, detach } = await attachProfile({ profileDir: opts.profile, port: opts.port });
      try {
        const signedIn = await signInStatus({ context });
        out(summary({ step: 'status', ok: true, signedIn }));
        return Object.values(signedIn).every(Boolean) ? 0 : 1;
      } finally { await detach(); }
    }
    if (opts.command === 'dry-run') {
      const { context, detach } = await attachProfile({ profileDir: opts.profile, port: opts.port });
      let ok = true;
      try {
        const dir = join('.intent', 'acceptance', `dry-run-${randomBytes(3).toString('hex')}`);
        for (const client of opts.clients) {
          const result = await dryRunSite({ context, site: SITES[client], screenshotDir: dir });
          out(summary({ step: 'dry-run', ...result }));
          if (!result.ok) { ok = false; for (const line of guidedFallback({ client, reason: result.reason })) out(line); }
        }
      } finally { await detach(); }
      return ok ? 0 : 1;
    }
    const deps = await productionDeps(env);
    if (opts.command === 'revoke') {
      const run = resumeRun({ runId: opts.runId });
      try {
        const results = await deps.cleanup.revokeCaptured({ rest: deps.rest, captured: run.cleanupInputs().grants });
        out(summary({ step: 'revoke', ok: true, revokedCount: results.length }));
      } finally { run.close(); }
      return 0;
    }
    const site = SITES[opts.client];
    const label = `web-${opts.client === 'chatgpt' ? 'gpt' : 'claude'}-${opts.slot.toLowerCase()}-${randomBytes(3).toString('hex')}`;
    const run = opts.runId ? resumeRun({ runId: opts.runId }) : createRun({
      target: 'production', accounts: [opts.slot], scenarios: [`${opts.client}:${opts.scenario}`],
      steps: ['preflight', 'connect', 'grant-checkpoint', 'prompt-read', 'prompt-write', 'creation-checkpoint', ...(opts.keepChats ? [] : ['archive-chats']), 'revoke'],
    });
    const { context, detach } = await attachProfile({ profileDir: opts.profile, port: opts.port });
    try {
      const result = await runWebScenario({
        site, context, issuer: PRODUCTION.issuer, mcpUrl: PRODUCTION_MCP_URL, slot: opts.slot, scenario: opts.scenario,
        account: PRODUCTION.accounts[opts.slot], sessions: deps.sessions, rest: deps.rest, cleanup: deps.cleanup,
        watcher: spawnWatcher(), run, label,
        out, keepGrant: opts.keepGrant, archiveChats: !opts.keepChats,
      });
      out(summary({ step: 'done', ok: result.ok, runId: result.runId }));
      return result.ok ? 0 : 1;
    } finally {
      run.renderState?.();
      run.close();
      await detach();
    }
  } catch (error) {
    const reason = error instanceof WebStop ? error.reason : error instanceof AcceptanceError ? error.code : typeof error?.reason === 'string' ? error.reason : 'internal-error';
    out(summary({ step: error?.step ?? opts.command, ok: false, reason }));
    if (opts.client) for (const line of guidedFallback({ client: opts.client, slot: opts.slot, scenario: opts.scenario, reason })) out(line);
    return 1;
  }
}

if (isCliEntry(import.meta)) process.exitCode = await main();
