import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Ticket 336 (D31.2): the Mac's email sign-in end to end, with the real Mac auth class,
// a real Chrome for the page the Mac opens, a running Cadence web server
// (CADENCE_SIGN_IN_EMAIL=on, CADENCE_TURNSTILE_SITE_KEY set to Cloudflare's always-pass
// test key), loopback Supabase and its Mailpit inbox. Only Tauri's IPC is replaced: the
// Keychain becomes a map, and the system browser becomes Chrome.
//
// What can go wrong:
// 1. The Mac offers a method the server has off, or the list cannot be read by the app.
// 2. The page does not pass Turnstile, does not send, or leaves the address in the URL.
// 3. A wrong code signs in; a right code does not; a used code signs in again.
// 4. A second account signs in on a Mac linked to the first.
// 5. Provider tokens or the address reach a log or the server's view of the URL.
//
// Run: docs/qa/2026-11-13-ticket-336-mac-sign-in.md.

const appUrl = process.env.CADENCE_DESKTOP_SIGN_IN_E2E_URL;
const supabaseUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const mailpitUrl = process.env.CADENCE_LOCAL_MAILPIT_URL ?? "http://127.0.0.1:55324";
const evidenceDir = process.env.CADENCE_DESKTOP_SIGN_IN_EVIDENCE;
const chromePath = process.env.CADENCE_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const run = appUrl && supabaseUrl && publishableKey && serviceKey ? describe : describe.skip;

const native = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  metadata: null as { hostedUserId: string } | null,
  opened: [] as string[],
  callback: null as ((urls: string[]) => void) | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, args?: Record<string, string>) => {
    if (command === "auth_secret_get") return native.secrets.get(args!.name!) ?? null;
    if (command === "auth_secret_set") { native.secrets.set(args!.name!, args!.value!); return; }
    if (command === "auth_secret_remove") { native.secrets.delete(args!.name!); return; }
    if (command === "auth_open_url") { native.opened.push(args!.url!); return; }
    if (command === "auth_account_metadata") return native.metadata;
    if (command === "auth_record_account_metadata") {
      if (native.metadata && native.metadata.hostedUserId !== args!.hostedUserId) throw new Error("Account mismatch");
      native.metadata = { hostedUserId: args!.hostedUserId! };
      return;
    }
    if (command === "calendar_cache_clear" || command === "connector_cache_clear") return;
    throw new Error(`Unexpected native command: ${command}`);
  },
}));
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: async (callback: (urls: string[]) => void) => { native.callback = callback; return () => { native.callback = null; }; },
  getCurrent: async () => [],
}));

import { DesktopAuth, fetchDesktopSignInMethods, type DesktopAccountState } from "../apps/desktop/src/account/auth";

const evidence: Array<{ case: string; result: string }> = [];
const record = (name: string, result: string) => evidence.push({ case: name, result });
const createdUsers: string[] = [];
let browser: Browser;

async function waitForCode(email: string, after: number): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
      .then((r) => r.json() as Promise<{ messages?: Array<{ ID: string; Created: string }> }>);
    const message = (search.messages ?? []).find((m) => Date.parse(m.Created) >= after);
    if (message) {
      const full = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`).then((r) => r.json() as Promise<{ HTML: string }>);
      return full.HTML.match(/letter-spacing:4px[^>]*>\s*(\d+)\s*</)?.[1] ?? "";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No sign-in email arrived for the test address.");
}

function startMac() {
  const states: DesktopAccountState[] = [];
  const auth = new DesktopAuth({ url: supabaseUrl!, key: publishableKey! }, (state) => states.push(state),
    async () => undefined, appUrl!.replace(/\/$/, ""));
  return { auth, states };
}

/** Plays the system browser: opens the URL the Mac asked for and waits for the page's result. */
async function openInBrowser(url: string, screenshot: string) {
  const page = await browser.newPage();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(url);
  await page.getByText(/Check your email\.|did not|not available/).waitFor({ timeout: 45_000 });
  const text = await page.locator("main").innerText();
  const location = page.url();
  if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/${screenshot}.png`, fullPage: true });
  await page.close();
  return { text, location, requests };
}

run("Cadence for Mac email sign-in (local)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
    browser = await chromium.launch({ executablePath: chromePath, headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    const admin = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
    if (evidenceDir) writeFileSync(`${evidenceDir}/evidence.json`, `${JSON.stringify({ ranAt: new Date().toISOString(), evidence }, null, 2)}\n`);
  });

  it("offers exactly the methods the server has on, and the app can read the list", async () => {
    const methods = await fetchDesktopSignInMethods(appUrl!.replace(/\/$/, ""));
    expect(methods.methods.map((method) => method.id)).toEqual(["google", "email"]);
    const preflight = await fetch(new URL("/api/auth/sign-in-methods", appUrl), { method: "OPTIONS", headers: { origin: "tauri://localhost" } });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    record("method list", "google and email offered; Apple off; CORS allows tauri://localhost");
  });

  it("links by a typed code, refuses a wrong and a used code, and keeps the address out of the server's view", async () => {
    native.secrets.clear(); native.metadata = null; native.opened = [];
    const email = `mac-${randomUUID().slice(0, 8)}@example.test`;
    const { auth, states } = startMac();
    const stop = await auth.initialize();
    const before = Date.now() - 1000;
    await auth.beginEmail(email);
    expect(states.at(-1)).toEqual({ status: "code", email });
    const page = await openInBrowser(native.opened[0]!, "mac-email-page-sent");
    expect(page.text).toContain(`Cadence sent a 6-digit code to ${email}`);
    expect(new URL(page.location).hash).toBe("");
    expect(page.requests.some((url) => url.includes("challenges.cloudflare.com"))).toBe(true);
    expect(page.requests.filter((url) => url.startsWith(appUrl!)).some((url) => url.includes(encodeURIComponent(email)) || url.includes(email))).toBe(false);
    record("page", "Turnstile test widget passed; code sent; fragment removed; address in no request URL");

    const code = await waitForCode(email, before);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    await auth.verifyEmailCode(wrong);
    expect(states.at(-1)).toMatchObject({ status: "code", error: expect.stringContaining("did not work") });
    record("wrong code", "refused; request kept");

    await auth.verifyEmailCode(code);
    const linked = states.at(-1);
    expect(linked).toMatchObject({ status: "linked", email });
    const userId = (linked as { userId: string }).userId;
    createdUsers.push(userId);
    expect(native.metadata).toEqual({ hostedUserId: userId });
    const stored = native.secrets.get("supabase-session")!;
    expect(stored).toContain("refresh_token");
    expect(stored).not.toContain("provider_refresh_token");
    record("right code", "linked; session in the Keychain slot; metadata recorded");

    // The account client works: an RLS read as the new user.
    const { data: profile, error } = await auth.accountClient().from("profiles").select("id").single();
    expect(error).toBeNull();
    expect(profile?.id).toBe(userId);
    record("account client", "RLS read of the user's own profile");

    await auth.verifyEmailCode(code);
    expect(states.at(-1)).toMatchObject({ status: "error", message: expect.stringContaining("already used") });
    const replay = await createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } })
      .auth.verifyOtp({ email, token: code, type: "email" });
    expect(replay.error).not.toBeNull();
    record("used code", "refused by the Mac and by Supabase Auth");
    stop(); await auth.dispose();
  });

  it("refuses a second account on a Mac linked to the first and removes only the new session", async () => {
    native.secrets.clear(); native.opened = [];
    const linkedTo = createdUsers[0]!;
    native.metadata = { hostedUserId: linkedTo };
    const email = `mac-other-${randomUUID().slice(0, 8)}@example.test`;
    const { auth, states } = startMac();
    const stop = await auth.initialize();
    const before = Date.now() - 1000;
    await auth.beginEmail(email);
    await openInBrowser(native.opened[0]!, "mac-email-page-second-account");
    const code = await waitForCode(email, before);
    await auth.verifyEmailCode(code);
    expect(states.at(-1)).toEqual({ status: "error", message: expect.stringContaining("different account") });
    expect(native.secrets.has("supabase-session")).toBe(false);
    expect(native.metadata).toEqual({ hostedUserId: linkedTo });
    const admin = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
    const { data } = await admin.auth.admin.listUsers();
    const other = data.users.find((user) => user.email === email);
    if (other) createdUsers.push(other.id);
    record("different account", "refused; new session removed; link metadata unchanged");
    stop(); await auth.dispose();
  });

  it("shows the page's refusal for an invalid fragment and sends nothing", async () => {
    const page = await browser.newPage();
    await page.goto(new URL("/login/email/mac#state=x&email=not-an-address", appUrl).toString());
    await page.getByText("This page opens from Cadence for Mac.").waitFor({ timeout: 15_000 });
    if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/mac-email-page-missing.png`, fullPage: true });
    await page.close();
    record("invalid fragment", "page asks to start again from the Mac");
  });
});
