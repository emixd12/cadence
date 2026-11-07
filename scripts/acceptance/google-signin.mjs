#!/usr/bin/env node
// Signs a Cadence test account (A or B) in to Google in the Cadence QA Chrome
// profile, so agents can drive Google pages (Calendar fixtures, connector consent)
// without the owner. Decision 2026-11-06, "Agents act as the test accounts".
//
// Run through the agent-secret wrapper, which reads the credentials from the
// "Cadence Agents" vault into this process only:
//
//   npm run agent:secret -- --caller google-signin \
//     --env GOOGLE_TEST_PASSWORD=google-test-account-a/password \
//     --env "GOOGLE_TEST_OTP=google-test-account-a/one-time password" \
//     -- node scripts/acceptance/google-signin.mjs --slot A
//
// It attaches to the already-open QA profile (`npm run mcp:accept:web -- open`),
// never another Chrome. It prints fixed step names and stop reasons only: never the
// password, a code, a cookie, or any other signed-in account's address. When Google
// asks for a check a script cannot pass (a phone prompt, a CAPTCHA, a recovery
// address), it stops and names it. Exit codes: 0 signed in; 2 usage; 3 stopped.

import { createHmac } from 'node:crypto';
import { parseArgs } from 'node:util';
import { isCliEntry } from './cli-entry.mjs';
import { PRODUCTION } from './test-account-sessions.mjs';
import { DEFAULT_DEBUG_PORT, DEFAULT_PROFILE_DIR, attachProfile } from './web-client.mjs';

const ACCOUNTS_ORIGIN = 'https://accounts.google.com';
const STEP_LIMIT = 12;

export class SignInStop extends Error {
  constructor(reason) { super(reason); this.name = 'SignInStop'; this.reason = reason; }
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new SignInStop('otp-seed-invalid');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** The seed from an `otpauth://` URI or a bare base32 key, with its digits and period. */
export function parseOtpSeed(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new SignInStop('otp-seed-missing');
  if (!text.startsWith('otpauth://')) return { secret: base32Decode(text), digits: 6, period: 30, algorithm: 'sha1' };
  const url = new URL(text);
  const secret = url.searchParams.get('secret');
  if (!secret) throw new SignInStop('otp-seed-invalid');
  return {
    secret: base32Decode(secret),
    digits: Number(url.searchParams.get('digits') ?? 6),
    period: Number(url.searchParams.get('period') ?? 30),
    algorithm: (url.searchParams.get('algorithm') ?? 'SHA1').toLowerCase(),
  };
}

/** RFC 6238 time-based code. */
export function totp(seed, nowMs = Date.now()) {
  const counter = Math.floor(nowMs / 1000 / seed.period);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(seed.algorithm, seed.secret).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** seed.digits;
  return String(code).padStart(seed.digits, '0');
}

/**
 * True when Google serves the account page for `email` in this profile. A signed-out
 * address redirects to accounts.google.com instead. Other signed-in addresses are
 * never read or printed.
 */
async function accountSignedIn(context, email) {
  const probe = await context.newPage();
  try {
    await probe.goto(`https://myaccount.google.com/?authuser=${encodeURIComponent(email)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await probe.waitForTimeout(1_500);
    if (new URL(probe.url()).host !== 'myaccount.google.com') return false;
    return (await probe.content()).toLowerCase().includes(email);
  } finally {
    await probe.close().catch(() => {});
  }
}

async function visible(page, selector) {
  const locator = page.locator(selector).first();
  return (await locator.count()) > 0 && locator.isVisible().catch(() => false);
}

async function clickIfVisible(page, selectors) {
  for (const selector of [].concat(selectors)) {
    if (await visible(page, selector)) { await page.locator(selector).first().click(); return true; }
  }
  return false;
}

/** One step of Google's sign-in pages. Returns the step name it handled. */
async function signInStep(page, { email, password, seed, used }) {
  const url = new URL(page.url());
  if (url.host === 'myaccount.google.com') return 'done';
  const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  if (body.includes("this browser or app may not be secure")) throw new SignInStop('browser-not-secure');
  if (await visible(page, '#captchaimg, iframe[src*="recaptcha"]')) throw new SignInStop('captcha');
  const identifier = '#identifierId, input[name="identifier"], input[type="email"]';
  if (await visible(page, identifier)) {
    if (used.has('identifier')) throw new SignInStop('identifier-rejected');
    used.add('identifier');
    await page.locator(identifier).first().fill(email);
    await page.locator('#identifierNext, button:has-text("Next")').first().click();
    return 'identifier';
  }
  const passwordField = 'input[name="Passwd"], input[type="password"]:not([name="hiddenPassword"])';
  if (await visible(page, passwordField)) {
    if (used.has('password')) throw new SignInStop('password-rejected');
    used.add('password');
    await page.locator(passwordField).first().fill(password);
    await page.locator('#passwordNext, button:has-text("Next")').first().click();
    return 'password';
  }
  if (await visible(page, 'input[name="totpPin"], #totpPin')) {
    if (!seed) throw new SignInStop('otp-seed-missing');
    if (used.has('totp')) throw new SignInStop('otp-rejected');
    used.add('totp');
    // A code about to roll over can expire before Google reads it.
    const remaining = seed.period - Math.floor(Date.now() / 1000) % seed.period;
    if (remaining < 5) await page.waitForTimeout(remaining * 1000 + 500);
    await page.locator('input[name="totpPin"], #totpPin').first().fill(totp(seed));
    await page.locator('#totpNext, button:has-text("Next")').first().click();
    return 'totp';
  }
  // A method picker: the password first, then the authenticator app. Never a passkey or phone.
  if (!used.has('password') && await clickIfVisible(page, 'text="Enter your password"')) return 'choose-password';
  if (await clickIfVisible(page, ['[data-challengetype="6"]', 'text=/Google Authenticator/'])) return 'choose-authenticator';
  if (await clickIfVisible(page, 'text="Try another way"')) {
    if (used.has('another-way')) throw new SignInStop('challenge-unsupported');
    used.add('another-way');
    return 'try-another-way';
  }
  // Interstitials after a successful sign-in: passkey enrollment, recovery details, home address.
  if (await clickIfVisible(page, ['button:has-text("Not now")', 'button:has-text("Skip")', 'a:has-text("Not now")', 'button:has-text("Cancel")'])) return 'interstitial';
  if (body.includes('check your phone') || body.includes('tap yes')) throw new SignInStop('phone-prompt');
  if (body.includes('verify it') && body.includes('you')) throw new SignInStop('verification-required');
  return 'waiting';
}

export async function signIn({ slot, password, otpSeed, port = DEFAULT_DEBUG_PORT, profileDir = DEFAULT_PROFILE_DIR, log = () => {}, shotPath = null }) {
  const account = PRODUCTION.accounts[slot];
  if (!account) throw new SignInStop('slot-invalid');
  const email = account.email.toLowerCase();
  const { context, detach } = await attachProfile({ profileDir, port });
  const page = await context.newPage();
  try {
    if (await accountSignedIn(context, email)) return { slot, state: 'already-signed-in' };
    if (!password) throw new SignInStop('password-missing');
    const seed = otpSeed ? parseOtpSeed(otpSeed) : null;
    const target = `${ACCOUNTS_ORIGIN}/AddSession?hl=en&continue=${encodeURIComponent('https://myaccount.google.com/')}&Email=${encodeURIComponent(email)}`;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const used = new Set();
    let last = '';
    let repeats = 0;
    for (let step = 0; step < STEP_LIMIT * 3; step += 1) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1_500);
      const handled = await signInStep(page, { email, password, seed, used });
      if (handled !== 'waiting') log(`step ${handled}`);
      if (handled === 'done') break;
      repeats = handled === last ? repeats + 1 : 0;
      last = handled;
      if (repeats >= STEP_LIMIT) throw new SignInStop(`stuck-${handled}`);
    }
    if (!await accountSignedIn(context, email)) throw new SignInStop('not-signed-in-after-flow');
    return { slot, state: 'signed-in' };
  } catch (error) {
    // Optional evidence for a stop: a screenshot of Google's page only (no field values are typed into it at this point).
    if (shotPath) await page.screenshot({ path: shotPath }).catch(() => {});
    throw error;
  } finally {
    await page.close().catch(() => {});
    await detach();
  }
}

export async function main(argv = process.argv.slice(2), env = process.env, out = (line) => process.stdout.write(`${line}\n`)) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { slot: { type: 'string' }, port: { type: 'string' } } }));
  } catch { out('usage: google-signin.mjs --slot A|B [--port 4430]'); return 2; }
  if (!['A', 'B'].includes(values.slot ?? '')) { out('usage: google-signin.mjs --slot A|B [--port 4430]'); return 2; }
  try {
    const result = await signIn({
      slot: values.slot, port: values.port ? Number(values.port) : DEFAULT_DEBUG_PORT,
      password: env.GOOGLE_TEST_PASSWORD, otpSeed: env.GOOGLE_TEST_OTP, log: out, shotPath: env.GOOGLE_SIGNIN_STOP_SCREENSHOT || null,
    });
    out(JSON.stringify(result));
    return 0;
  } catch (error) {
    out(JSON.stringify({ slot: values.slot, state: 'stopped', reason: error instanceof SignInStop ? error.reason : (error?.reason ?? error?.name ?? 'error') }));
    return 3;
  }
}

if (isCliEntry(import.meta)) process.exitCode = await main();
