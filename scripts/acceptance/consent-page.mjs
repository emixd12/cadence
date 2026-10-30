// Ticket 248. Cadence consent screen automation for test accounts A and B.
// Reads what the page shows, checks it against the expected account, client
// and scopes, and only then clicks Allow or Deny. Never logs page URLs.
import { AcceptanceError } from './test-account-sessions.mjs';

export const READ_SCOPE = 'cadence.read';
export const WRITE_SCOPES = Object.freeze(['cadence.occurrences.write', 'cadence.behaviors.write']);
export const GRANTS = Object.freeze({
  read: Object.freeze([READ_SCOPE]),
  behaviors: Object.freeze([READ_SCOPE, 'cadence.behaviors.write']),
  occurrences: Object.freeze([READ_SCOPE, 'cadence.occurrences.write']),
  full: Object.freeze([READ_SCOPE, 'cadence.occurrences.write', 'cadence.behaviors.write']),
});

/** Launch the installed Chrome headless through playwright-core. */
export async function launchChrome({ headless = true } = {}) {
  const { chromium } = await import('playwright-core');
  try {
    return await chromium.launch({ channel: 'chrome', headless });
  } catch {
    throw new AcceptanceError('chrome-launch-failed');
  }
}

/** What the consent form shows. Hidden account_id is the signed-in user's id. */
export async function readConsentView(page) {
  const form = page.locator('form:has(input[name="request_id"])');
  try { await form.waitFor({ state: 'attached', timeout: 30_000 }); } catch { throw new AcceptanceError('consent-form-missing'); }
  return form.evaluate((node) => {
    const value = (selector) => node.querySelector(selector)?.getAttribute('value') ?? null;
    const dd = [...node.querySelectorAll('dt')].find((dt) => dt.textContent?.trim() === 'Cadence account')?.nextElementSibling;
    const heading = node.querySelector('h1')?.textContent?.trim() ?? '';
    return {
      accountId: value('input[name="account_id"]'),
      email: dd?.textContent?.trim() ?? null,
      clientName: heading.startsWith('Connect ') ? heading.slice('Connect '.length) : null,
      verified: /Verified client/.test(node.textContent ?? '') && !/Unverified client/.test(node.textContent ?? ''),
      fixedScopes: [...node.querySelectorAll('input[type="hidden"][name="scope"]')].map((input) => input.getAttribute('value')),
      optionalScopes: [...node.querySelectorAll('input[type="checkbox"][name="scope"]')].map((input) => input.getAttribute('value')),
      hasAllow: Boolean(node.querySelector('button[name="decision"][value="allow"]')),
      hasDeny: Boolean(node.querySelector('button[name="decision"][value="deny"]')),
    };
  });
}

/**
 * Pure check. Returns mismatch codes; an empty list means the page shows the
 * expected account, client and requested scopes.
 */
export function checkConsentView(view, { userId, email = null, clientName, requestedScopes }) {
  const problems = [];
  if (!view || view.accountId !== userId) problems.push('account');
  if (email !== null && view?.email?.toLowerCase() !== email.toLowerCase()) problems.push('email');
  if (clientName !== undefined && view?.clientName !== clientName) problems.push('client');
  const shown = [...(view?.fixedScopes ?? []), ...(view?.optionalScopes ?? [])].sort();
  const wanted = [...new Set(requestedScopes.filter((scope) => scope !== 'offline_access'))].sort();
  if (JSON.stringify(view?.fixedScopes ?? []) !== JSON.stringify([READ_SCOPE]) || JSON.stringify(shown) !== JSON.stringify(wanted)) problems.push('scopes');
  if (!view?.hasAllow || !view?.hasDeny) problems.push('buttons');
  return problems;
}

/** Set the write-scope checkboxes for the grant, then click Allow or Deny. */
export async function submitConsent(page, { decision, grantScopes = [] }) {
  if (!['allow', 'deny'].includes(decision)) throw new AcceptanceError('decision-invalid');
  // A click before React hydrates sends a native form POST. The page's
  // no-referrer policy makes its Origin "null", which Next's Server Action
  // CSRF check rejects. Wait until React owns the button.
  try {
    await page.waitForFunction(() => {
      const button = document.querySelector('button[name="decision"][value="allow"]');
      return Boolean(button && Object.keys(button).some((key) => key.startsWith('__reactProps')));
    }, undefined, { timeout: 30_000 });
  } catch { throw new AcceptanceError('consent-not-interactive'); }
  for (const scope of WRITE_SCOPES) {
    const box = page.locator(`input[type="checkbox"][name="scope"][value="${scope}"]`);
    if (await box.count() === 0) {
      if (decision === 'allow' && grantScopes.includes(scope)) throw new AcceptanceError('scope-not-offered');
      continue;
    }
    await box.setChecked(decision === 'allow' && grantScopes.includes(scope));
  }
  await page.locator(`button[name="decision"][value="${decision}"]`).click();
}

/**
 * Intercept the client's loopback redirect inside the browser context so the
 * authorization response never reaches a network listener or a log.
 * Resolves with a URL object held only in memory.
 */
export async function captureRedirect(context, redirectUri, timeoutMs = 60_000) {
  const target = new URL(redirectUri);
  const matches = (url) => url.protocol === target.protocol && url.hostname === target.hostname &&
    url.port === target.port && url.pathname === target.pathname;
  let resolve;
  const captured = new Promise((r) => { resolve = r; });
  const handler = async (route) => {
    resolve(new URL(route.request().url()));
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Cadence acceptance: response captured.' }).catch(() => {});
  };
  await context.route(matches, handler);
  return {
    wait: () => {
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new AcceptanceError('redirect-timeout')), timeoutMs); });
      return Promise.race([captured, timeout]).finally(() => clearTimeout(timer));
    },
    peek: () => Promise.race([captured, Promise.resolve(null)]),
    dispose: () => context.unroute(matches, handler).catch(() => {}),
  };
}
