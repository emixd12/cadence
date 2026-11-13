import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readCalendarOAuthConfig, sealCalendarSecret } from "../lib/services/google-calendar-oauth";

// Ticket 335 (D31.5): Google Calendar for accounts that do not sign in with Google,
// against a running Cadence web server over HTTPS (`next dev --experimental-https`, so
// the Calendar callback origin matches) with CADENCE_SIGN_IN_LINKING=on and a synthetic
// Calendar client, and loopback Supabase with manual linking on. Google itself is never
// reached for consent: the checks stop at the provider URL Cadence sends the browser to.
//
// What can go wrong:
// 1. An account with no Google sign-in gets `same_account_required` instead of adding Google.
// 2. Adding Google returns somewhere that does not continue into Calendar consent, or the
//    Calendar consent asks for a different Google account than the one just added.
// 3. A Google account that belongs to another Cadence account is attached, or the refusal
//    names that account.
// 4. A one-Google-sign-in account changes behaviour.
// 5. An account gets a second Google sign-in, so Calendar and the leave reminder job
//    cannot tell which Google account to use.
// 6. Google is removed while Calendar reads through it, leaving Calendar broken.
// 7. A credential sealed before this change stops opening and asks for reconnection.
// 8. The leave reminder job cannot read the Google subject of an account that added Google.
// 9. The Mac is offered a flow it cannot finish.
//
// Run: docs/qa/2026-11-13-ticket-335-calendar-google-sign-in.md.

const appUrl = process.env.CADENCE_CALENDAR_SIGN_IN_E2E_URL;
const supabaseUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const dbContainer =
  process.env.CADENCE_LOCAL_SUPABASE_DB_CONTAINER ?? "supabase_db_habit-tracking-app";
const evidencePath = process.env.CADENCE_CALENDAR_SIGN_IN_EVIDENCE;
const run = appUrl && supabaseUrl && serviceKey && publishableKey ? describe : describe.skip;

const evidence: Array<{ case: string; result: string }> = [];
const record = (name: string, result: string) => evidence.push({ case: name, result });

class Browser {
  private jar = new Map<string, string>();

  async request(path: string, init: { form?: Record<string, string>; json?: unknown; method?: string; bearer?: string } = {}) {
    const headers: Record<string, string> = {};
    if (this.jar.size && !init.bearer) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
    let body: string | undefined;
    const method = init.method ?? (init.form || init.json !== undefined ? "POST" : "GET");
    if (method !== "GET" && !init.bearer) {
      headers.origin = new URL(appUrl!).origin;
      headers["sec-fetch-site"] = "same-origin";
    }
    if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(init.form).toString();
    }
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const url = /^https?:/.test(path) ? path : new URL(path, appUrl).toString();
    const response = await fetch(url, { method, headers, body, redirect: "manual" });
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

  cookies() {
    return [...this.jar].map(([name, value]) => ({ name, value }));
  }
}

function sql(statement: string): string {
  return execFileSync("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-tAc", statement], {
    encoding: "utf8",
  }).trim();
}

/** Runs statements in one held transaction in its own psql session; resolves when it ends. */
function heldTransaction(statements: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", statements]);
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(output))));
  });
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

function providers(userId: string): string[] {
  const rows = sql(`select provider from auth.identities where user_id = ${literal(userId)} order by provider`);
  return rows ? rows.split("\n") : [];
}

/** Supabase Auth keeps the return address of a linking flow in `auth.flow_state`. */
function linkReturnAddress(userId: string): URL {
  return new URL(sql(`select referrer from auth.flow_state where linking_target_id = ${literal(userId)} order by created_at desc limit 1`));
}

run("Google Calendar for accounts that do not sign in with Google (Ticket 335)", () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  const address = (label: string) => `e2e-335-${label}-${randomUUID().slice(0, 8)}@cadence-e2e.dev`;

  async function createUser(email: string) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("No user.");
    created.push(data.user.id);
    return data.user.id;
  }

  function addGoogle(userId: string, email?: string) {
    const sub = `google-${randomUUID()}`;
    sql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (${literal(sub)}, ${literal(userId)}, jsonb_build_object('sub', ${literal(sub)}${email ? `, 'email', ${literal(email)}` : ""}), 'google', now(), now(), now())`,
    );
    return sub;
  }

  /** A user whose only identity is Google, as a Google sign-up leaves it. */
  async function createGoogleUser(email: string) {
    const userId = await createUser(email);
    const sub = addGoogle(userId, email);
    sql(`delete from auth.identities where user_id = ${literal(userId)} and provider = 'email'`);
    return { userId, sub };
  }

  function connectCalendarRow(userId: string, sub: string, status: string, generation = 1) {
    sql(`insert into public.google_calendar_connections (user_id, google_subject, generation, status)
         values (${literal(userId)}, ${literal(sub)}, ${generation}, ${literal(status)})
         on conflict (user_id) do update set google_subject = excluded.google_subject, generation = excluded.generation, status = excluded.status`);
    sql(`insert into public.google_calendar_preferences (user_id) values (${literal(userId)}) on conflict do nothing`);
  }

  async function signIn(browser: Browser, email: string) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    const response = await browser.request("/auth/confirm", { form: { token_hash: data.properties.hashed_token } });
    expect(browser.location(response)).toBe("/timeline");
  }

  async function accessToken(email: string) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    const client = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
    if (verified.error || !verified.data.session) throw verified.error ?? new Error("No session.");
    return verified.data.session.access_token;
  }

  const connection = async (browser: Browser, bearer?: string) =>
    (await (await browser.request("/api/google-calendar/connection", { bearer })).json()) as Record<string, unknown>;
  const connect = async (browser: Browser) =>
    browser.request("/api/google-calendar/connection", { json: { target: "web" } });

  beforeAll(() => {
    const host = new URL(supabaseUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error("The Calendar sign-in check runs only against loopback Supabase.");
    }
    admin = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    if (evidencePath) {
      mkdirSync(evidencePath.replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify({ ranAt: new Date().toISOString(), evidence }, null, 2)}\n`);
    }
  });

  it("an email account adds Google first, then continues into Calendar consent for that Google account", async () => {
    const email = address("email");
    const userId = await createUser(email);
    const browser = new Browser();
    await signIn(browser, email);

    const before = await connection(browser);
    expect(before).toMatchObject({ status: "disconnected", googleSignIn: "add" });

    const start = await connect(browser);
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    expect(new URL(url).hostname).toBe("accounts.google.com");
    const back = linkReturnAddress(userId);
    expect(back.pathname).toBe("/auth/callback");
    expect(back.searchParams.get("link")).toBe("google");
    expect(back.searchParams.get("next")).toBe("/settings?calendar=link#connector-google_calendar");
    expect(providers(userId)).toEqual(["email"]);

    // Supabase links the Google account and returns; /auth/callback adds the result.
    const returned = await browser.request(
      `/auth/callback?${new URLSearchParams({ link: "google", next: back.searchParams.get("next")! })}`,
    );
    expect(browser.location(returned)).toBe(
      "/settings?calendar=link&sign_in_method=add_failed&method=google#connector-google_calendar",
    );

    const sub = addGoogle(userId, email);
    const after = await connection(browser);
    expect(after.status).toBe("disconnected");
    expect(after).not.toHaveProperty("googleSignIn");
    const consent = await connect(browser);
    const consentUrl = new URL(((await consent.json()) as { url: string }).url);
    expect(consentUrl.origin + consentUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(consentUrl.searchParams.get("login_hint")).toBe(sub);
    expect(consentUrl.searchParams.get("client_id")).toBe(process.env.GOOGLE_CALENDAR_CLIENT_ID);
    expect(sql(`select google_subject from public.google_calendar_connections where user_id = ${literal(userId)}`)).toBe(sub);
    record("email account: Connect adds Google through linking, returns to Settings, Calendar consent hints the added Google account", "passed");
  });

  it("a Google account that already signs in to another Cadence account is refused without naming it", async () => {
    const email = address("taken");
    await createUser(email);
    const other = address("other");
    await createGoogleUser(other);
    const browser = new Browser();
    await signIn(browser, email);

    const next = "/settings?calendar=link#connector-google_calendar";
    const callback = await browser.request(
      `/auth/callback?${new URLSearchParams({ link: "google", next, error: "server_error", error_code: "identity_already_exists", error_description: "Identity is already linked to another user" })}`,
    );
    const location = browser.location(callback)!;
    expect(location).toBe("/settings?calendar=link&sign_in_method=taken&method=google#connector-google_calendar");
    const html = await (await browser.request(location.replace(/#.*$/, ""))).text();
    expect(html).not.toContain("so it cannot be added here");
    expect(html).not.toContain(other);
    expect(html).not.toContain("Identity is already linked");
    expect(await connection(browser)).toMatchObject({ status: "disconnected", googleSignIn: "add" });
    record("taken Google account: Calendar return refused, Sign-in methods row stays quiet, no other account named", "passed");
  });

  it("a one-Google-sign-in account connects as before, and a second Google sign-in is never added", async () => {
    const email = address("google");
    const { userId, sub } = await createGoogleUser(email);
    const browser = new Browser();
    await signIn(browser, email);

    const view = await connection(browser);
    expect(view.status).toBe("disconnected");
    expect(view).not.toHaveProperty("googleSignIn");
    const consent = new URL(((await (await connect(browser)).json()) as { url: string }).url);
    expect(consent.hostname).toBe("accounts.google.com");
    expect(consent.searchParams.get("login_hint")).toBe(sub);

    const added = await browser.request("/auth/sign-in-methods/add", { form: { method: "google" } });
    expect(browser.location(added)).toBe("/settings?sign_in_method=already_added&method=google#sign-in-methods");
    expect(providers(userId)).toEqual(["google"]);

    // Two Google sign-ins (only through a race or a direct database write): Calendar does not guess.
    addGoogle(userId);
    expect(await connection(browser)).toMatchObject({ googleSignIn: "multiple" });
    const refused = await connect(browser);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "same_account_required" });
    record("Google account unchanged; Add Google refused as already_added; two Google sign-ins read as multiple", "passed");
  });

  it("Google cannot be removed while Calendar is connected through it; afterwards Calendar rebinds to a new Google account", async () => {
    const email = address("remove");
    const userId = await createUser(email);
    const first = addGoogle(userId, email);
    connectCalendarRow(userId, first, "connected");
    const browser = new Browser();
    await signIn(browser, email);

    const googleId = sql(`select id from auth.identities where user_id = ${literal(userId)} and provider = 'google'`);
    const refused = await browser.request("/auth/sign-in-methods/remove", { form: { identity_id: googleId } });
    expect(browser.location(refused)).toBe("/settings?sign_in_method=calendar_connected&method=google#sign-in-methods");
    expect(providers(userId)).toEqual(["email", "google"]);
    const html = await (await browser.request("/settings?sign_in_method=calendar_connected&method=google")).text();
    expect(html).toContain("Disconnect Google Calendar first, then remove Google.");

    sql(`update public.google_calendar_connections set status = 'disconnected', generation = 2 where user_id = ${literal(userId)}`);
    const removed = await browser.request("/auth/sign-in-methods/remove", { form: { identity_id: googleId } });
    expect(browser.location(removed)).toBe("/settings?sign_in_method=removed&method=google#sign-in-methods");
    expect(await connection(browser)).toMatchObject({ status: "disconnected", googleSignIn: "add", generation: 2 });

    const second = addGoogle(userId, email);
    const consent = new URL(((await (await connect(browser)).json()) as { url: string }).url);
    expect(consent.searchParams.get("login_hint")).toBe(second);
    expect(sql(`select google_subject || ' ' || generation from public.google_calendar_connections where user_id = ${literal(userId)}`)).toBe(`${second} 2`);
    record("Remove Google refused while Calendar connected; after disconnect it is removed; a later Google account rebinds the idle row", "passed");
  });

  it("removing Google and a Calendar connect at the same moment never leave Calendar connected without Google", async () => {
    // The database refuses deleting a Google identity a connected Calendar uses.
    const direct = await createUser(address("race-direct"));
    const directSub = addGoogle(direct);
    connectCalendarRow(direct, directSub, "connected");
    expect(() => sql(`delete from auth.identities where user_id = ${literal(direct)} and provider = 'google'`)).toThrow(/cadence_calendar_connected/);
    expect(providers(direct)).toEqual(["email", "google"]);

    // Unlink holds the account's row while the Calendar install arrives: the install waits,
    // then finds the identity gone and installs nothing.
    const first = await createUser(address("race-unlink-first"));
    const firstSub = addGoogle(first);
    connectCalendarRow(first, firstSub, "disconnected", 0);
    const hash = "c".repeat(64);
    sql(`update public.google_calendar_connections set attempt_hash = ${literal(hash)} where user_id = ${literal(first)}`);
    const unlink = heldTransaction(`begin; delete from auth.identities where user_id = ${literal(first)} and provider = 'google'; select pg_sleep(2); commit;`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const install = await admin.rpc("calendar_install_credential", {
      owner_id: first, expected_subject: firstSub, expected_generation: 0, expected_state_hash: hash, token_ciphertext: "sealed",
    });
    await unlink;
    expect(install.error).toBeNull();
    expect(install.data).toBe(false);
    expect(providers(first)).toEqual(["email"]);
    expect(sql(`select status from public.google_calendar_connections where user_id = ${literal(first)}`)).toBe("disconnected");
    expect(sql(`select count(*) from cadence_calendar_private.credentials where user_id = ${literal(first)}`)).toBe("0");

    // A Calendar install holds the account's row while Remove Google arrives through Cadence:
    // Cadence's own check sees no connection yet, the database refuses after the install
    // commits, and the person sees calendar_connected.
    const email = address("race-install-first");
    const second = await createUser(email);
    const secondSub = addGoogle(second, email);
    connectCalendarRow(second, secondSub, "disconnected", 0);
    const browser = new Browser();
    await signIn(browser, email);
    const googleId = sql(`select id from auth.identities where user_id = ${literal(second)} and provider = 'google'`);
    const installHeld = heldTransaction(
      `begin; select 1 from auth.users where id = ${literal(second)} for update; select pg_sleep(1.5);
       update public.google_calendar_connections set status = 'connected', generation = 1 where user_id = ${literal(second)}; commit;`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const removed = await browser.request("/auth/sign-in-methods/remove", { form: { identity_id: googleId } });
    await installHeld;
    expect(browser.location(removed)).toBe("/settings?sign_in_method=calendar_connected&method=google#sign-in-methods");
    expect(providers(second)).toEqual(["email", "google"]);
    record("race: database refuses removing Calendar's Google; held unlink makes install refuse; held install makes Remove answer calendar_connected", "passed");
  });

  it("Disconnect works with two Google sign-ins, and a crafted return link starts nothing", async () => {
    const email = address("two");
    const userId = await createUser(email);
    const sub = addGoogle(userId, email);
    connectCalendarRow(userId, sub, "connected", 4);
    addGoogle(userId);
    const browser = new Browser();
    await signIn(browser, email);
    expect(await connection(browser)).toMatchObject({ status: "connected", googleSignIn: "multiple" });
    const disconnected = await browser.request("/api/google-calendar/connection", { method: "DELETE" });
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toMatchObject({ status: "disconnected" });
    expect(sql(`select status from public.google_calendar_connections where user_id = ${literal(userId)}`)).toBe("disconnected");

    const flowsBefore = sql(`select count(*) from auth.flow_state where linking_target_id = ${literal(userId)}`);
    const crafted = await browser.request("/settings?calendar=link&sign_in_method=added&method=google");
    expect(crafted.status).toBe(200);
    expect(sql(`select count(*) from auth.flow_state where linking_target_id = ${literal(userId)}`)).toBe(flowsBefore);
    record("two Google sign-ins: view loads and Disconnect works; the crafted return page starts no linking", "passed");
  });

  it("a credential sealed before this change still opens, for a Google account and for an account that added Google", async () => {
    const config = readCalendarOAuthConfig(process.env);
    expect(config).not.toBeNull();
    for (const kind of ["google", "added"] as const) {
      const email = address(`sealed-${kind}`);
      let userId: string;
      let sub: string;
      if (kind === "google") ({ userId, sub } = await createGoogleUser(email));
      else { userId = await createUser(email); sub = addGoogle(userId, email); }
      connectCalendarRow(userId, sub, "connected", 3);
      const sealed = sealCalendarSecret(config!, "synthetic-refresh-token", { purpose: "refresh", userId, googleSubject: sub, generation: 3 });
      sql(`insert into cadence_calendar_private.credentials values (${literal(userId)}, ${literal(sub)}, 3, ${literal(sealed)})`);
      const browser = new Browser();
      await signIn(browser, email);

      expect(await connection(browser)).toMatchObject({ status: "connected", generation: 3 });
      // The credential opens and Cadence asks Google for an access token; the synthetic
      // client is refused there. A credential that did not open would read as reconnect_required.
      const calendars = await browser.request("/api/google-calendar/calendars");
      expect(await calendars.json()).toEqual({ error: "provider_unavailable" });
      expect(sql(`select count(*) from cadence_calendar_private.credentials where user_id = ${literal(userId)}`)).toBe("1");
      expect(await connection(browser)).toMatchObject({ status: "connected" });
    }
    record("credentials sealed with user id and Google subject keep opening for both kinds of account", "passed");
  });

  it("the leave reminder job reads the Google subject of an account that added Google", async () => {
    const email = address("leave");
    const userId = await createUser(email);
    const subject = (id: string) => sql(
      `begin; set local role authenticated;
       select set_config('request.jwt.claims', json_build_object('sub', ${literal(id)}, 'role', 'authenticated', 'cadence_channel', 'leave_reminder')::text, true);
       select coalesce(public.leave_reminder_google_subject(), 'null'); commit;`,
    ).split("\n").filter((line) => line && line !== "BEGIN" && line !== "SET" && line !== "COMMIT").at(-1);
    expect(subject(userId)).toBe("null");
    const sub = addGoogle(userId, email);
    expect(subject(userId)).toBe(sub);
    addGoogle(userId);
    expect(subject(userId)).toBe("null");
    record("leave_reminder_google_subject: none → null, added Google → its subject, two → null", "passed");
  });

  it("the Mac is told to add Google on the web and is not offered linking", async () => {
    const email = address("mac");
    await createUser(email);
    const token = await accessToken(email);
    const mac = new Browser();
    expect(await connection(mac, token)).toMatchObject({ status: "disconnected", googleSignIn: "add_on_web" });
    const start = await mac.request("/api/google-calendar/connection", {
      bearer: token,
      json: { target: "desktop", clientState: "a".repeat(43) },
    });
    expect(start.status).toBe(409);
    expect(await start.json()).toEqual({ error: "same_account_required" });
    record("Mac (bearer): googleSignIn add_on_web; desktop connect still refused before any provider step", "passed");
  });
});
