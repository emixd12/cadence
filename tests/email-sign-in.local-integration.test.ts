import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Ticket 332 (D31.2, D31.3): email sign-in end to end, against a running Cadence
// web server with CADENCE_SIGN_IN_EMAIL=on, loopback Supabase and its Mailpit
// inbox. Plain HTTP with a cookie jar per browser: the forms are plain posts.
//
// What can go wrong:
// 1. The code or the link does not sign in, or lands somewhere other than `next`.
// 2. A link only works in the browser that asked for it.
// 3. A used, wrong or expired link or code signs in, or shows no way forward.
// 4. Email sign-in for an address that has a Google account makes a second account.
// 5. A password sign-up for someone else's address reaches a session or keeps a
//    password; a signed-in person adds a password.
// 6. The test login's password stops working.
// 7. A resend inside the 60 s interval sends a second email or loses the code step.
//
// Run: docs/qa/2026-11-13-ticket-332-email-sign-in.md.

const appUrl = process.env.CADENCE_EMAIL_SIGN_IN_E2E_URL;
const supabaseUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const mailpitUrl = process.env.CADENCE_LOCAL_MAILPIT_URL ?? "http://127.0.0.1:55324";
const dbContainer =
  process.env.CADENCE_LOCAL_SUPABASE_DB_CONTAINER ?? "supabase_db_habit-tracking-app";
const evidencePath = process.env.CADENCE_EMAIL_SIGN_IN_EVIDENCE;
// Cloudflare's dummy token: passes with the test secret when Turnstile is on, and is
// ignored when it is off (Ticket 338 runs this file with Cadence's own check on).
const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const run = appUrl && supabaseUrl && serviceKey && publishableKey ? describe : describe.skip;

const evidence: Array<{ case: string; result: string }> = [];
const record = (name: string, result: string) => evidence.push({ case: name, result });

class Browser {
  private jar = new Map<string, string>();

  async request(path: string, init: { method?: string; form?: Record<string, string> } = {}) {
    const headers: Record<string, string> = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: string | undefined;
    if (init.form) {
      // What a browser sends with a form post from Cadence's own page.
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers.origin = new URL(appUrl!).origin;
      headers["sec-fetch-site"] = "same-origin";
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(new URL(path, appUrl), {
      method: init.method ?? (init.form ? "POST" : "GET"),
      headers,
      body,
      redirect: "manual",
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      const expired = attributes.some((a) => /max-age=0\b/i.test(a.trim())) || value === "";
      if (expired) this.jar.delete(name.trim());
      else this.jar.set(name.trim(), value);
    }
    return response;
  }

  location(response: Response) {
    const value = response.headers.get("location");
    if (!value) return null;
    const url = new URL(value, appUrl);
    return `${url.pathname}${url.search}`;
  }

  cookie(name: string) {
    return this.jar.get(name);
  }

  setCookie(name: string, value: string) {
    this.jar.set(name, value);
  }

  signedInUserId(): string | null {
    const parts = [...this.jar]
      .filter(([name]) => /^sb-.*-auth-token(\.\d+)?$/.test(name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => decodeURIComponent(value));
    if (!parts.length) return null;
    const raw = parts.join("");
    const json = raw.startsWith("base64-")
      ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")
      : raw;
    return (JSON.parse(json) as { user?: { id?: string } }).user?.id ?? null;
  }
}

type Mail = { link: string; tokenHash: string; code: string; at: number };

async function waitForMail(email: string, after: number): Promise<Mail> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const search = await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    ).then((r) => r.json() as Promise<{ messages?: Array<{ ID: string; Created: string }> }>);
    const message = (search.messages ?? []).find((m) => Date.parse(m.Created) >= after);
    if (message) {
      const full = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`).then(
        (r) => r.json() as Promise<{ HTML: string; Subject: string }>,
      );
      expect(full.Subject).toBe("Sign in to Cadence");
      const link = full.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&") ?? "";
      const tokenHash = new URL(link).searchParams.get("token_hash") ?? "";
      const code = full.HTML.match(/letter-spacing:4px[^>]*>\s*(\d+)\s*</)?.[1] ?? "";
      return { link, tokenHash, code, at: Date.parse(message.Created) };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in email arrived for the test address.`);
}

async function countMail(email: string, after: number) {
  const search = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  ).then((r) => r.json() as Promise<{ messages?: Array<{ Created: string }> }>);
  return (search.messages ?? []).filter((m) => Date.parse(m.Created) >= after).length;
}

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", dbContainer, "psql", "-U", "postgres", "-tAc", statement],
    { encoding: "utf8" },
  ).trim();
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

function storedPasswordLength(email: string) {
  return Number(
    sql(`select length(coalesce(encrypted_password, '')) from auth.users where email = ${literal(email)}`),
  );
}

async function requestEmail(browser: Browser, email: string, next = "/timeline") {
  const after = Date.now() - 1000;
  const response = await browser.request("/auth/sign-in/email", {
    form: { email, next, "cf-turnstile-response": TURNSTILE_TEST_TOKEN },
  });
  return { response, after };
}

run("Email sign-in end to end (Ticket 332)", () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  const address = (label: string) => `e2e-${label}-${randomUUID().slice(0, 8)}@cadence-e2e.dev`;

  beforeAll(() => {
    const host = new URL(supabaseUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error("The email sign-in check runs only against loopback Supabase.");
    }
    admin = createClient(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    for (const email of created) {
      const id = sql(`select id from auth.users where email = ${literal(email)}`);
      if (id) await admin.auth.admin.deleteUser(id);
    }
    if (evidencePath) {
      mkdirSync(evidencePath.replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify({ ranAt: new Date().toISOString(), evidence }, null, 2)}\n`);
    }
  });

  it("the login action opens the email form and keeps next", async () => {
    const browser = new Browser();
    const response = await browser.request("/auth/sign-in/email?next=%2Fsettings");
    expect(browser.location(response)).toBe("/login/email?next=%2Fsettings");
    const page = await browser.request("/login/email?next=%2Fsettings");
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('action="/auth/sign-in/email"');
    expect(html).toContain('name="next" value="/settings"');
    record("login action opens the email form", "passed");
  });

  it("a new address gets one email; a wrong code fails; the right code signs in and returns to next", async () => {
    const email = address("code");
    created.push(email);
    const browser = new Browser();
    const { response, after } = await requestEmail(browser, email, "/settings");
    expect(response.status).toBe(303);
    expect(browser.location(response)).toBe("/login/email?next=%2Fsettings&sent=1");
    expect(browser.cookie("cadence_email_sign_in")).toBeTruthy();

    const step = await (await browser.request("/login/email?next=%2Fsettings&sent=1")).text();
    expect(step).toContain(email);
    expect(step).toContain('action="/auth/email/verify"');

    const mail = await waitForMail(email, after);
    expect(mail.code).toMatch(/^\d{6}$/);
    expect(mail.link).toContain("/login/confirm?token_hash=");

    const wrong = await browser.request("/auth/email/verify", {
      form: { code: mail.code === "000000" ? "111111" : "000000" },
    });
    expect(browser.location(wrong)).toBe("/login/email?next=%2Fsettings&error=code_rejected&sent=1");
    expect(browser.signedInUserId()).toBeNull();

    const pending = browser.cookie("cadence_email_sign_in")!;
    const right = await browser.request("/auth/email/verify", {
      form: { code: `${mail.code.slice(0, 3)} ${mail.code.slice(3)}` },
    });
    expect(browser.location(right)).toBe("/settings");
    const userId = browser.signedInUserId();
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(browser.cookie("cadence_email_sign_in")).toBeUndefined();
    expect(storedPasswordLength(email)).toBe(0);
    expect(sql(`select count(*) from public.profiles where id = ${literal(userId!)}`)).toBe("1");

    const timeline = await browser.request("/timeline");
    expect(timeline.status).toBe(200);

    const reuse = new Browser();
    reuse.setCookie("cadence_email_sign_in", pending);
    const reused = await reuse.request("/auth/email/verify", { form: { code: mail.code } });
    expect(reuse.location(reused)).toBe("/login/email?next=%2Fsettings&error=code_rejected&sent=1");
    expect(reuse.signedInUserId()).toBeNull();
    record("code signs in a new address; wrong and reused codes refused", "passed");
  });

  it("the link signs in from another browser through a button, and works once", async () => {
    const email = address("link");
    created.push(email);
    const asking = new Browser();
    const { after } = await requestEmail(asking, email);
    const mail = await waitForMail(email, after);

    const other = new Browser();
    const page = await other.request(mail.link.replace(/^https?:\/\/[^/]+/, ""));
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('action="/auth/confirm"');
    expect(html).toContain(`value="${mail.tokenHash}"`);
    expect(other.signedInUserId()).toBeNull();

    const confirmed = await other.request("/auth/confirm", { form: { token_hash: mail.tokenHash } });
    expect(other.location(confirmed)).toBe("/timeline");
    expect(other.signedInUserId()).toMatch(/^[0-9a-f-]{36}$/);

    const third = new Browser();
    const again = await third.request("/auth/confirm", { form: { token_hash: mail.tokenHash } });
    expect(third.location(again)).toBe("/login/email?next=%2Ftimeline&error=link_rejected");
    expect(third.signedInUserId()).toBeNull();
    const message = await (await third.request("/login/email?next=%2Ftimeline&error=link_rejected")).text();
    expect(message).toContain("already used or is more than an hour old");
    expect(message).toContain("Send sign-in email");
    record("link signs in from another browser; second use refused", "passed");
  });

  it("an expired link and code are refused with a way to send another", async () => {
    const email = address("expired");
    created.push(email);
    const browser = new Browser();
    const { after } = await requestEmail(browser, email);
    const mail = await waitForMail(email, after);

    sql(
      `update auth.users set confirmation_sent_at = now() - interval '2 hours', recovery_sent_at = now() - interval '2 hours' where email = ${literal(email)}`,
    );

    const code = await browser.request("/auth/email/verify", { form: { code: mail.code } });
    expect(browser.location(code)).toBe("/login/email?next=%2Ftimeline&error=code_rejected&sent=1");
    const step = await (await browser.request("/login/email?next=%2Ftimeline&error=code_rejected&sent=1")).text();
    expect(step).toContain("more than an hour old");
    expect(step).toContain("Send a new email");

    const other = new Browser();
    const link = await other.request("/auth/confirm", { form: { token_hash: mail.tokenHash } });
    expect(other.location(link)).toBe("/login/email?next=%2Ftimeline&error=link_rejected");
    expect(browser.signedInUserId()).toBeNull();
    expect(other.signedInUserId()).toBeNull();
    record("expired link and code refused", "passed");
  });

  it("a resend inside 60 seconds sends nothing and keeps the code step", async () => {
    const email = address("resend");
    created.push(email);
    const browser = new Browser();
    const { after } = await requestEmail(browser, email);
    await waitForMail(email, after);
    const resend = await browser.request("/auth/sign-in/email", {
      form: { resend: "1", next: "/timeline", "cf-turnstile-response": TURNSTILE_TEST_TOKEN },
    });
    expect(browser.location(resend)).toBe(
      "/login/email?next=%2Ftimeline&error=email_rate_limited&sent=1",
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await countMail(email, after)).toBe(1);
    record("resend inside 60 s refused with a plain message", "passed");
  });

  it("an address with a Google account signs in to that same account", async () => {
    const email = address("google");
    created.push(email);
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(error).toBeNull();
    const userId = data.user!.id;
    sql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (${literal(`google-${userId}`)}, ${literal(userId)}, jsonb_build_object('sub', ${literal(`google-${userId}`)}, 'email', ${literal(email)}, 'email_verified', true), 'google', now(), now(), now())`,
    );

    const browser = new Browser();
    const { after } = await requestEmail(browser, email);
    const mail = await waitForMail(email, after);
    await browser.request("/auth/email/verify", { form: { code: mail.code } });
    expect(browser.signedInUserId()).toBe(userId);
    expect(sql(`select count(*) from auth.users where email = ${literal(email)}`)).toBe("1");
    record("Google account address reaches the same account", "passed");
  });

  it("a password sign-up for someone else's address gets no session and no password", async () => {
    const victim = address("victim");
    created.push(victim);
    const { data } = await admin.auth.admin.createUser({ email: victim, email_confirm: true });
    const victimId = data.user!.id;
    const fresh = address("unconfirmed");
    created.push(fresh);
    const attacker = createClient(supabaseUrl!, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const password = `Attack-${randomUUID()}-aA1!`;

    for (const email of [victim, fresh]) {
      const signUp = await attacker.auth.signUp({ email, password });
      expect(signUp.data.session).toBeNull();
      const signIn = await attacker.auth.signInWithPassword({ email, password });
      expect(signIn.data.session).toBeNull();
      expect(storedPasswordLength(email)).toBe(0);
    }
    expect(sql(`select count(*) from auth.users where email = ${literal(victim)}`)).toBe("1");

    const owner = new Browser();
    const after = Date.now() - 1000;
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    await owner.request("/auth/sign-in/email", {
      form: { email: victim, next: "/timeline", "cf-turnstile-response": TURNSTILE_TEST_TOKEN },
    });
    const mail = await waitForMail(victim, after + 60_000);
    await owner.request("/auth/email/verify", { form: { code: mail.code } });
    expect(owner.signedInUserId()).toBe(victimId);
    record("password sign-up for another address: no session, no password", "passed");
  }, 90_000);

  it("a signed-in person cannot add a password", async () => {
    const email = address("update");
    created.push(email);
    const client = createClient(supabaseUrl!, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const after = Date.now() - 1000;
    await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    const mail = await waitForMail(email, after);
    const verified = await client.auth.verifyOtp({ email, token: mail.code, type: "email" });
    expect(verified.error).toBeNull();
    const password = `Added-${randomUUID()}-aA1!`;
    await client.auth.updateUser({ password });
    expect(storedPasswordLength(email)).toBe(0);
    const signIn = await createClient(supabaseUrl!, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({ email, password });
    expect(signIn.data.session).toBeNull();
    record("updateUser password dropped", "passed");
  });

  it("the test login's password sign-in still works", async () => {
    const email = `cadence-test-${randomUUID()}@example.invalid`;
    created.push(email);
    const password = `CadenceTestLogin-${randomUUID()}-aA1!`;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(error).toBeNull();
    const signIn = await createClient(supabaseUrl!, publishableKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({ email, password });
    expect(signIn.error).toBeNull();
    expect(signIn.data.session).not.toBeNull();
    record("test login password kept for reserved test domains", "passed");
  });
});
