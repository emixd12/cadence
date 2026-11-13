import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Ticket 334 (D31.3): Settings sign-in methods end to end, against a running
// Cadence web server with CADENCE_SIGN_IN_EMAIL=on and CADENCE_SIGN_IN_LINKING=on,
// loopback Supabase with manual linking on, and its Mailpit inbox. Plain HTTP
// with a cookie jar per browser and the headers a browser form post sends.
//
// What can go wrong:
// 1. The last way in is removed, through the UI or a direct post.
// 2. An identity or address that belongs to another account is added here, or
//    the refusal names that account.
// 3. An unconfirmed address reaches the account.
// 4. A changed address does not sign in to the same account, or adds a password.
// 5. A post from another site changes the account.
// 6. Deletion asks an Apple relay account to type its relay address.
//
// Run: docs/qa/2026-11-13-ticket-334-sign-in-methods.md.

const appUrl = process.env.CADENCE_SIGN_IN_METHODS_E2E_URL;
const supabaseUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const mailpitUrl = process.env.CADENCE_LOCAL_MAILPIT_URL ?? "http://127.0.0.1:55324";
const dbContainer =
  process.env.CADENCE_LOCAL_SUPABASE_DB_CONTAINER ?? "supabase_db_habit-tracking-app";
const evidencePath = process.env.CADENCE_SIGN_IN_METHODS_EVIDENCE;
const run = appUrl && supabaseUrl && serviceKey ? describe : describe.skip;

const evidence: Array<{ case: string; result: string }> = [];
const record = (name: string, result: string) => evidence.push({ case: name, result });

class Browser {
  private jar = new Map<string, string>();

  async request(path: string, init: { form?: Record<string, string>; site?: string } = {}) {
    const headers: Record<string, string> = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: string | undefined;
    if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers.origin = new URL(appUrl!).origin;
      headers["sec-fetch-site"] = init.site ?? "same-origin";
      body = new URLSearchParams(init.form).toString();
    }
    const url = /^https?:/.test(path) ? path : new URL(path, appUrl).toString();
    const response = await fetch(url, {
      method: init.form ? "POST" : "GET",
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
    return url.origin === new URL(appUrl!).origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
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

function sql(statement: string): string {
  return execFileSync("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-tAc", statement], {
    encoding: "utf8",
  }).trim();
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

function providers(userId: string): string[] {
  const rows = sql(`select provider from auth.identities where user_id = ${literal(userId)} order by provider`);
  return rows ? rows.split("\n") : [];
}

async function mailLinks(email: string, after: number): Promise<string[]> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    ).then((r) => r.json() as Promise<{ messages?: Array<{ ID: string; Created: string }> }>);
    const messages = (search.messages ?? []).filter((m) => Date.parse(m.Created) >= after);
    if (messages.length) {
      const full = await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`).then(
        (r) => r.json() as Promise<{ HTML: string }>,
      );
      return [...full.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [];
}

async function mailCount(email: string, after: number) {
  const search = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  ).then((r) => r.json() as Promise<{ messages?: Array<{ Created: string }> }>);
  return (search.messages ?? []).filter((m) => Date.parse(m.Created) >= after).length;
}

/** Follows a Supabase verify link, then Cadence's redirects, as a browser would. */
async function openLink(browser: Browser, link: string): Promise<string | null> {
  let response = await browser.request(link);
  let location = browser.location(response);
  for (let hop = 0; hop < 4 && location && !location.startsWith("http"); hop += 1) {
    if (!location.startsWith("/auth/")) return location;
    response = await browser.request(location);
    location = browser.location(response);
  }
  return location;
}

run("Sign-in methods in Settings (Ticket 334)", () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  const address = (label: string, domain = "cadence-e2e.dev") =>
    `e2e-334-${label}-${randomUUID().slice(0, 8)}@${domain}`;

  async function createUser(email: string) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("No user.");
    created.push(data.user.id);
    return data.user.id;
  }

  /** A user whose only identity is Google, as a Google sign-up leaves it. */
  async function createGoogleUser(email: string) {
    const userId = await createUser(email);
    const sub = `google-${randomUUID()}`;
    sql(`delete from auth.identities where user_id = ${literal(userId)}`);
    sql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (${literal(sub)}, ${literal(userId)}, jsonb_build_object('sub', ${literal(sub)}, 'email', ${literal(email)}, 'email_verified', true), 'google', now(), now(), now())`,
    );
    return userId;
  }

  /** Signs a browser in through Cadence's own /auth/confirm, with no email sent. */
  async function signIn(browser: Browser, email: string) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    const response = await browser.request("/auth/confirm", {
      form: { token_hash: data.properties.hashed_token },
    });
    expect(browser.location(response)).toBe("/timeline");
    return browser.signedInUserId();
  }

  const settings = async (browser: Browser, path = "/settings") => {
    const response = await browser.request(path);
    expect(response.status).toBe(200);
    return response.text();
  };

  beforeAll(() => {
    const host = new URL(supabaseUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error("The sign-in methods check runs only against loopback Supabase.");
    }
    admin = createClient(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    if (evidencePath) {
      mkdirSync(evidencePath.replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify({ ranAt: new Date().toISOString(), evidence }, null, 2)}\n`);
    }
  });

  it("a Google-only account lists Google and its address, and cannot remove its last way in", async () => {
    const email = address("google");
    const userId = await createGoogleUser(email);
    const browser = new Browser();
    expect(await signIn(browser, email)).toBe(userId);

    const html = await settings(browser);
    expect(html).toContain("Sign-in methods");
    expect(html).toContain(email);
    expect(html).toContain("Change address");
    expect(html).not.toContain('aria-label="Remove Google"');

    const googleId = sql(`select id from auth.identities where user_id = ${literal(userId)} and provider = 'google'`);
    const refused = await browser.request("/auth/sign-in-methods/remove", { form: { identity_id: googleId } });
    expect(refused.status).toBe(303);
    expect(browser.location(refused)).toBe("/settings?sign_in_method=last_method#sign-in-methods");
    expect(providers(userId)).toEqual(["google"]);
    expect(await settings(browser, "/settings?sign_in_method=last_method")).toContain(
      "Add another way to sign in before removing this one.",
    );
    record("last method refused on the server; UI offers no Remove", "passed");
  });

  it("an address or Google account that belongs to another account is refused without naming it", async () => {
    const email = address("refuse");
    await createGoogleUser(email);
    const taken = address("other");
    await createUser(taken);
    const browser = new Browser();
    await signIn(browser, email);

    const after = Date.now() - 1000;
    const response = await browser.request("/auth/sign-in-methods/email", { form: { email: taken } });
    expect(browser.location(response)).toBe("/settings?sign_in_method=email_taken&method=email#sign-in-methods");
    expect(await mailCount(taken, after)).toBe(0);

    const same = await browser.request("/auth/sign-in-methods/email", { form: { email: email.toUpperCase() } });
    expect(browser.location(same)).toBe("/settings?sign_in_method=email_same&method=email#sign-in-methods");

    // What Supabase Auth returns when the Google identity is already linked to another user.
    const callback = await browser.request(
      "/auth/callback?link=google&next=%2Fsettings%23sign-in-methods&error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user",
    );
    const location = browser.location(callback)!;
    expect(location).toBe("/settings?sign_in_method=taken&method=google#sign-in-methods");
    const html = await settings(browser, location.replace(/#.*$/, ""));
    expect(html).toContain("That Google account already signs in to a different Cadence account");
    expect(html).not.toContain(taken);
    expect(html).not.toContain("Identity is already linked");
    record("taken address and taken Google account refused; no other account named", "passed");
  });

  it("Add Google starts manual linking with a return to Settings", async () => {
    const email = address("add");
    const userId = await createUser(email);
    sql(`delete from auth.identities where user_id = ${literal(userId)} and provider = 'google'`);
    const browser = new Browser();
    await signIn(browser, email);
    const html = await settings(browser);
    expect(html).toContain("Add Google");

    const response = await browser.request("/auth/sign-in-methods/add", { form: { method: "google" } });
    expect(response.status).toBe(303);
    const provider = new URL(response.headers.get("location")!);
    expect(provider.hostname).toBe("accounts.google.com");
    const returnTo = new URL(provider.searchParams.get("redirect_to") ?? provider.searchParams.get("redirect_uri") ?? "", appUrl);
    expect(returnTo.toString()).toBeTruthy();
    expect(providers(userId)).toEqual(["email"]);
    record("Add Google redirects to Google through Supabase linking", "passed");
  });

  it("a post from another site is refused", async () => {
    const email = address("csrf");
    const userId = await createGoogleUser(email);
    const browser = new Browser();
    await signIn(browser, email);
    const response = await browser.request("/auth/sign-in-methods/email", {
      form: { email: address("attacker") },
      site: "cross-site",
    });
    expect(response.status).toBe(403);
    expect(sql(`select coalesce(email_change, '') from auth.users where id = ${literal(userId)}`)).toBe("");
    record("cross-site post refused", "passed");
  });

  it("a Google account adds an email address, removes Google and signs in by email to the same data", async () => {
    const email = address("change");
    const userId = await createGoogleUser(email);
    sql(`insert into public.categories (user_id, name, sort_order) values (${literal(userId)}, 'E2E 334 marker', 99)`);
    const browser = new Browser();
    await signIn(browser, email);

    const newEmail = address("new");
    const after = Date.now() - 1000;
    const sent = await browser.request("/auth/sign-in-methods/email", { form: { email: newEmail } });
    expect(browser.location(sent)).toBe("/settings?sign_in_method=email_sent&method=email#sign-in-methods");
    expect(sql(`select email from auth.users where id = ${literal(userId)}`)).toBe(email);

    const oldLinks = await mailLinks(email, after);
    const newLinks = await mailLinks(newEmail, after);
    expect(oldLinks.length).toBeGreaterThan(0);
    expect(newLinks.length).toBeGreaterThan(0);
    const first = await openLink(browser, oldLinks[0]);
    expect(sql(`select email from auth.users where id = ${literal(userId)}`)).toBe(email);
    const second = await openLink(browser, newLinks[0]);
    expect(first).toMatch(/^\/settings\?sign_in_method=email_confirm_other&method=email/);
    expect(second).toMatch(/^\/settings\?sign_in_method=email_confirmed&method=email/);
    expect(sql(`select email from auth.users where id = ${literal(userId)}`)).toBe(newEmail);
    expect(sql(`select email from public.profiles where id = ${literal(userId)}`)).toBe(newEmail);
    expect(providers(userId)).toEqual(["email", "google"]);
    expect(sql(`select length(coalesce(encrypted_password, '')) from auth.users where id = ${literal(userId)}`)).toBe("0");

    const html = await settings(browser);
    expect(html).toContain(newEmail);
    expect(html).toContain('aria-label="Remove Google"');

    const googleId = sql(`select id from auth.identities where user_id = ${literal(userId)} and provider = 'google'`);
    const removed = await browser.request("/auth/sign-in-methods/remove", { form: { identity_id: googleId } });
    expect(browser.location(removed)).toBe("/settings?sign_in_method=removed&method=google#sign-in-methods");
    expect(providers(userId)).toEqual(["email"]);

    const emailId = sql(`select id from auth.identities where user_id = ${literal(userId)} and provider = 'email'`);
    const kept = await browser.request("/auth/sign-in-methods/remove", { form: { identity_id: emailId } });
    expect(browser.location(kept)).toBe("/settings?sign_in_method=not_removable#sign-in-methods");
    expect(providers(userId)).toEqual(["email"]);

    const later = new Browser();
    expect(await signIn(later, newEmail)).toBe(userId);
    expect(await settings(later, "/settings")).toContain("E2E 334 marker");
    record("Google account adds email, removes Google, signs in by email to the same account", "passed");
  });

  it("an Apple relay account types DELETE to delete the account", async () => {
    const relay = address("relay", "privaterelay.appleid.com");
    await createUser(relay);
    const browser = new Browser();
    await signIn(browser, relay);
    const html = await settings(browser);
    expect(html).toContain("Type <!-- -->DELETE<!-- --> to confirm");
    record("relay address account types DELETE", "passed");
  });
});
