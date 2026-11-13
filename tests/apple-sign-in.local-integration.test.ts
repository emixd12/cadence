import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appleSubjectDigest,
  prepareAppleRevocation,
  prepareAppleTokenForget,
} from "@/lib/services/apple-sign-in.service";
import {
  openServerSecret,
  readConnectorCredentialConfig,
} from "@/lib/services/connector-credentials";

// Ticket 333 (D31.2, D31.3, L-025): Apple sign-in end to end on the web, against a
// running Cadence server with CADENCE_SIGN_IN_APPLE=on whose Supabase URL is
// scripts/apple-sign-in-stub.mjs in front of loopback Supabase. The stub plays
// Apple's part of the code exchange; everything else is the real local stack.
//
// What can go wrong:
// 1. Continue with Apple does not reach the provider, or loses `next`.
// 2. A new Apple user gets no account, or a returning one gets a second account.
// 3. The name, given only on the first sign-in, is lost on a later one.
// 4. Apple's refresh token is not kept, is kept in the clear, or is kept for a
//    Google sign-in that forged `via=apple`.
// 5. A Hide My Email address silently reaches another person's account.
// 6. A missing email shows no way forward.
// 7. Deletion sends the wrong values to Apple, or a refusal is lost.
// 8. The token functions are callable by a signed-in person or anonymously.
// 9. Removing Apple in Settings (Ticket 334) leaves its token kept, skips the
//    revocation, or is blocked when Apple does not answer.
//
// Run: docs/qa/2026-11-13-ticket-333-apple-sign-in.md.

const appUrl = process.env.CADENCE_APPLE_SIGN_IN_E2E_URL;
const stubUrl = process.env.CADENCE_APPLE_STUB_URL;
const supabaseUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const dbContainer =
  process.env.CADENCE_LOCAL_SUPABASE_DB_CONTAINER ?? "supabase_db_habit-tracking-app";
const evidencePath = process.env.CADENCE_APPLE_SIGN_IN_EVIDENCE;
const run =
  appUrl && stubUrl && supabaseUrl && serviceKey && publishableKey && readConnectorCredentialConfig()
    ? describe
    : describe.skip;

const evidence: Array<{ case: string; result: string }> = [];
const record = (name: string, result: string) => evidence.push({ case: name, result });

class Browser {
  private jar = new Map<string, string>();

  async request(target: string, form?: Record<string, string>) {
    const url = new URL(target, appUrl);
    const sameApp = url.origin === new URL(appUrl!).origin;
    const headers: Record<string, string> = {};
    if (sameApp && this.jar.size) {
      headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers.origin = new URL(appUrl!).origin;
      headers["sec-fetch-site"] = "same-origin";
    }
    const response = await fetch(url, {
      method: form ? "POST" : "GET",
      headers,
      body: form ? new URLSearchParams(form).toString() : undefined,
      redirect: "manual",
    });
    if (sameApp) {
      for (const line of response.headers.getSetCookie()) {
        const [pair, ...attributes] = line.split(";");
        const [name, ...rest] = pair.split("=");
        const value = rest.join("=");
        const expired = attributes.some((a) => /max-age=0\b/i.test(a.trim())) || value === "";
        if (expired) this.jar.delete(name.trim());
        else this.jar.set(name.trim(), value);
      }
    }
    return response;
  }

  /** Follows redirects through the stub and the app; returns the first app page that is not a redirect. */
  async follow(target: string) {
    let next: string | null = target;
    const hops: string[] = [];
    for (let i = 0; i < 8 && next; i += 1) {
      const response = await this.request(next);
      const location = response.headers.get("location");
      if (!location) return { response, hops };
      next = new URL(location, new URL(next, appUrl)).toString();
      hops.push(next);
    }
    throw new Error("Too many redirects.");
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
  return execFileSync(
    "docker",
    ["exec", dbContainer, "psql", "-U", "postgres", "-tAc", statement],
    { encoding: "utf8" },
  ).trim();
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const path = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

async function stub(pathname: string, body?: unknown) {
  const response = await fetch(`${stubUrl}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
}

type Scenario = {
  kind?: "user" | "error";
  provider?: "apple" | "google";
  email?: string;
  name?: string;
  subject?: string;
  refreshToken?: string;
  keepEmailIdentity?: boolean;
  errorDescription?: string;
};

async function signInWithApple(browser: Browser, scenario: Scenario, next = "/behaviors") {
  await stub("/__stub/next", { kind: "user", provider: "apple", ...scenario });
  return browser.follow(`/auth/sign-in/apple?next=${encodeURIComponent(next)}`);
}

function keptTokens(userId: string) {
  const rows = sql(
    `select subject_digest || '|' || sealed_refresh_token from cadence_calendar_private.apple_sign_in_tokens where user_id = ${literal(userId)}`,
  );
  return rows ? rows.split("\n").map((line) => {
    const [subjectDigest, sealed] = line.split("|");
    return { subjectDigest, sealed };
  }) : [];
}

function openKept(userId: string, subjectDigest: string, sealed: string) {
  return openServerSecret(
    readConnectorCredentialConfig()!,
    sealed,
    Buffer.from(JSON.stringify(["cadence-apple-sign-in-v1", "refresh", userId, subjectDigest])),
  );
}

run("Apple sign-in end to end with a stubbed provider (Ticket 333)", () => {
  let admin: SupabaseClient;
  const createdEmails: string[] = [];
  const address = (label: string) => `e2e-apple-${label}-${randomUUID().slice(0, 8)}@cadence-e2e.dev`;
  const relay = () => `${randomUUID().slice(0, 10)}@privaterelay.appleid.com`;
  const subject = () => `000${Math.floor(Math.random() * 1e6)}.${randomUUID().replaceAll("-", "")}.0${Math.floor(Math.random() * 1e3)}`;
  const userIdFor = (email: string) =>
    sql(`select id from auth.users where lower(email) = lower(${literal(email)})`);

  beforeAll(() => {
    for (const url of [supabaseUrl!, stubUrl!]) {
      if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
        throw new Error("The Apple sign-in check runs only against loopback Supabase.");
      }
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
    admin = createClient(supabaseUrl!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    for (const email of createdEmails) {
      const id = userIdFor(email);
      if (id) await admin.auth.admin.deleteUser(id);
    }
    if (evidencePath) {
      mkdirSync(evidencePath.replace(/\/[^/]+$/, ""), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify({ ranAt: new Date().toISOString(), evidence }, null, 2)}\n`);
    }
  });

  it("Login shows Continue with Apple, and its start goes to the provider with via=apple and next", async () => {
    const browser = new Browser();
    const login = await (await browser.request("/login?next=%2Fbehaviors")).text();
    expect(login).toContain("Continue with Apple");
    expect(login).toContain('href="/auth/sign-in/apple?next=%2Fbehaviors"');

    const start = await browser.request("/auth/sign-in/apple?next=%2Fbehaviors");
    const authorize = new URL(start.headers.get("location") ?? "");
    expect(authorize.origin).toBe(new URL(stubUrl!).origin);
    expect(authorize.pathname).toBe("/auth/v1/authorize");
    expect(authorize.searchParams.get("provider")).toBe("apple");
    expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
    const redirectTo = new URL(authorize.searchParams.get("redirect_to") ?? "");
    expect(path(redirectTo.toString())).toBe("/auth/callback?next=%2Fbehaviors&via=apple");
    record("Login offers Apple; start sends provider=apple, PKCE and via=apple", "passed");
  });

  it("a new Apple user gets an account with their name, and the refresh token is kept sealed", async () => {
    const email = address("new");
    createdEmails.push(email);
    const appleSub = subject();
    const browser = new Browser();
    const { response, hops } = await signInWithApple(browser, {
      email, name: "Ada Apple", subject: appleSub, refreshToken: "stub-refresh-first",
    });

    expect(hops.map(path)).toContain("/behaviors");
    expect(response.status).toBe(200);
    const userId = userIdFor(email);
    expect(browser.signedInUserId()).toBe(userId);
    expect(sql(`select display_name from public.profiles where id = ${literal(userId)}`)).toBe("Ada Apple");

    const kept = keptTokens(userId);
    expect(kept).toHaveLength(1);
    expect(kept[0].subjectDigest).toBe(appleSubjectDigest(appleSub));
    expect(kept[0].sealed).not.toContain("stub-refresh-first");
    expect(openKept(userId, kept[0].subjectDigest, kept[0].sealed)).toBe("stub-refresh-first");
    record("new Apple user: account, name in profile, token sealed", "passed");

    // Returning: Apple sends no name; the same account and name stay, the token is replaced.
    const again = new Browser();
    await signInWithApple(again, { email, subject: appleSub, refreshToken: "stub-refresh-second" });
    expect(again.signedInUserId()).toBe(userId);
    expect(Number(sql(`select count(*) from auth.users where lower(email) = lower(${literal(email)})`))).toBe(1);
    expect(sql(`select display_name from public.profiles where id = ${literal(userId)}`)).toBe("Ada Apple");
    const replaced = keptTokens(userId);
    expect(replaced).toHaveLength(1);
    expect(openKept(userId, replaced[0].subjectDigest, replaced[0].sealed)).toBe("stub-refresh-second");
    record("returning Apple user: same account, name kept, token replaced", "passed");
  });

  it("a Hide My Email address beside an existing Google account makes a separate, empty account", async () => {
    const googleEmail = address("google-owner");
    createdEmails.push(googleEmail);
    const google = await admin.auth.admin.createUser({ email: googleEmail, email_confirm: true });
    expect(google.error).toBeNull();

    const relayEmail = relay();
    createdEmails.push(relayEmail);
    const browser = new Browser();
    const { hops } = await signInWithApple(browser, {
      email: relayEmail, subject: subject(), refreshToken: "stub-refresh-relay",
    }, "/timeline");

    expect(hops.map(path)).toContain("/timeline");
    const relayUserId = userIdFor(relayEmail);
    expect(relayUserId).toBeTruthy();
    expect(relayUserId).not.toBe(google.data.user!.id);
    expect(browser.signedInUserId()).toBe(relayUserId);
    expect(sql(`select email from public.profiles where id = ${literal(relayUserId)}`)).toBe(relayEmail);
    expect(Number(sql(`select count(*) from public.behaviors where user_id = ${literal(relayUserId)}`))).toBe(0);
    expect(sql(`select display_name is null from public.profiles where id = ${literal(relayUserId)}`)).toBe("t");
    record("Hide My Email: separate empty account, relay address shown, no name", "passed");
  });

  it("a missing email returns to Login with the Apple message and keeps next", async () => {
    const browser = new Browser();
    await stub("/__stub/next", {
      kind: "error",
      errorDescription: "Error getting user email from external provider",
    });
    const { response, hops } = await browser.follow("/auth/sign-in/apple?next=%2Fsettings");
    expect(path(hops.at(-1)!)).toBe("/login?next=%2Fsettings&error=apple_email_missing");
    const html = await response.text();
    expect(html).toContain("Apple did not share an email address");
    expect(browser.signedInUserId()).toBeNull();
    record("missing email: Login with the Apple message, no session", "passed");

    await stub("/__stub/next", { kind: "error", errorDescription: "access_denied" });
    const other = await new Browser().follow("/auth/sign-in/apple?next=%2Fsettings");
    expect(path(other.hops.at(-1)!)).toBe("/login?next=%2Fsettings&error=auth_callback_failed");
    record("other provider error: generic message", "passed");
  });

  it("a Google sign-in with a forged via=apple keeps no token", async () => {
    const email = address("forged");
    createdEmails.push(email);
    const browser = new Browser();
    // The user has an older Apple identity; this sign-in uses Google.
    await stub("/__stub/next", { kind: "user", provider: "apple", email, subject: subject(), refreshToken: "stub-refresh-apple" });
    await browser.follow("/auth/sign-in/apple?next=%2Ftimeline");
    const userId = userIdFor(email);
    sql(`delete from cadence_calendar_private.apple_sign_in_tokens where user_id = ${literal(userId)}`);

    await stub("/__stub/next", { kind: "user", provider: "google", email, subject: `google-${randomUUID()}`, refreshToken: "google-refresh" });
    const start = await browser.request("/auth/google?next=%2Ftimeline");
    const authorize = start.headers.get("location")!;
    const back = await fetch(authorize, { redirect: "manual" });
    const callback = new URL(back.headers.get("location")!);
    callback.searchParams.set("via", "apple");
    await browser.follow(path(callback.toString()));

    expect(browser.signedInUserId()).toBe(userId);
    expect(keptTokens(userId)).toHaveLength(0);
    record("forged via=apple on a Google sign-in: nothing kept", "passed");
  });

  it("deletion revokes with the Services ID and client secret; a refusal is reported", async () => {
    const email = address("delete");
    createdEmails.push(email);
    await signInWithApple(new Browser(), { email, subject: subject(), refreshToken: "stub-refresh-delete" });
    const userId = userIdFor(email);
    const env = {
      ...process.env,
      APPLE_SIGN_IN_SERVICES_ID: "app.cadence.web.test",
      APPLE_SIGN_IN_CLIENT_SECRET: "stub-client-secret",
    };
    const deps = { env, revokeUrl: `${stubUrl}/auth/revoke` };

    const revoke = await prepareAppleRevocation(userId, deps);
    expect(revoke).not.toBeNull();
    const before = (await stub("/__stub/revocations")) as unknown[];
    await admin.auth.admin.deleteUser(userId);
    expect(keptTokens(userId)).toHaveLength(0);
    await revoke!();
    const after = (await stub("/__stub/revocations")) as Array<Record<string, string>>;
    expect(after.slice(before.length)).toEqual([{
      client_id: "app.cadence.web.test",
      client_secret: "stub-client-secret",
      token: "stub-refresh-delete",
      token_type_hint: "refresh_token",
    }]);
    record("deletion: token read before, row cascades, Apple revoke called with the right form", "passed");

    const refusedEmail = address("refused");
    createdEmails.push(refusedEmail);
    await signInWithApple(new Browser(), { email: refusedEmail, subject: subject(), refreshToken: "stub-refresh-refused" });
    const refusedId = userIdFor(refusedEmail);
    await stub("/__stub/revoke-status", { status: 400 });
    try {
      const refused = await prepareAppleRevocation(refusedId, deps);
      await expect(refused!()).rejects.toThrow("provider_refused");
    } finally {
      await stub("/__stub/revoke-status", { status: 200 });
    }
    const unconfigured = await prepareAppleRevocation(refusedId, {
      ...deps,
      env: { ...env, APPLE_SIGN_IN_CLIENT_SECRET: "" },
    });
    await expect(unconfigured!()).rejects.toThrow("not_configured");
    record("Apple refuses, or the secret is unset: the error reaches the caller", "passed");
  });

  it("removing Apple in Settings forgets its token, even when the revocation cannot run (Ticket 334)", async () => {
    const email = address("remove");
    createdEmails.push(email);
    const browser = new Browser();
    await signInWithApple(browser, { email, subject: subject(), refreshToken: "stub-refresh-remove" });
    const userId = userIdFor(email);
    expect(keptTokens(userId)).toHaveLength(1);
    const googleSub = `google-${randomUUID()}`;
    sql(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
       values (${literal(googleSub)}, ${literal(userId)}, jsonb_build_object('sub', ${literal(googleSub)}), 'google', now(), now())`,
    );
    const appleId = sql(`select id from auth.identities where user_id = ${literal(userId)} and provider = 'apple'`);

    // This server has no Apple Services ID or client secret, so the revocation fails;
    // the removal and the forget still happen.
    const removed = await browser.request("/auth/sign-in-methods/remove", { identity_id: appleId });
    expect(removed.headers.get("location")).toMatch(/\/settings\?sign_in_method=removed&method=apple#sign-in-methods$/);
    expect(sql(`select string_agg(provider, ',') from auth.identities where user_id = ${literal(userId)}`)).toBe("google");
    expect(keptTokens(userId)).toHaveLength(0);
    record("Settings removal of Apple: identity gone, kept token forgotten, failed revocation does not block", "passed");
  });

  it("forgetting a removed Apple identity's token revokes it at Apple first; a refusal still forgets it", async () => {
    const env = {
      ...process.env,
      APPLE_SIGN_IN_SERVICES_ID: "app.cadence.web.test",
      APPLE_SIGN_IN_CLIENT_SECRET: "stub-client-secret",
    };
    const deps = { env, revokeUrl: `${stubUrl}/auth/revoke` };

    const email = address("forget");
    createdEmails.push(email);
    const appleSub = subject();
    await signInWithApple(new Browser(), { email, subject: appleSub, refreshToken: "stub-refresh-forget" });
    const userId = userIdFor(email);
    expect(await prepareAppleTokenForget(userId, `${appleSub}-other`, deps)).toBeNull();
    const forget = await prepareAppleTokenForget(userId, appleSub, deps);
    const before = (await stub("/__stub/revocations")) as unknown[];
    await forget!();
    const after = (await stub("/__stub/revocations")) as Array<Record<string, string>>;
    expect(after.slice(before.length)).toEqual([{
      client_id: "app.cadence.web.test",
      client_secret: "stub-client-secret",
      token: "stub-refresh-forget",
      token_type_hint: "refresh_token",
    }]);
    expect(keptTokens(userId)).toHaveLength(0);

    const refusedEmail = address("forget-refused");
    createdEmails.push(refusedEmail);
    const refusedSub = subject();
    await signInWithApple(new Browser(), { email: refusedEmail, subject: refusedSub, refreshToken: "stub-refresh-forget-refused" });
    const refusedId = userIdFor(refusedEmail);
    await stub("/__stub/revoke-status", { status: 400 });
    try {
      const refused = await prepareAppleTokenForget(refusedId, refusedSub, deps);
      await expect(refused!()).rejects.toThrow("provider_refused");
    } finally {
      await stub("/__stub/revoke-status", { status: 200 });
    }
    expect(keptTokens(refusedId)).toHaveLength(0);

    const anon = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } });
    const forgetAnon = await anon.rpc("apple_sign_in_forget_token" as never, {
      owner_id: refusedId, apple_subject_digest: "0".repeat(64),
    } as never);
    expect(forgetAnon.error).not.toBeNull();
    record("forget: revoke sent first with the right form; a refusal still forgets; anon refused", "passed");
  });

  it("the token functions refuse anonymous and signed-in callers", async () => {
    const anon = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } });
    const read = await anon.rpc("apple_sign_in_read_tokens" as never, { owner_id: randomUUID() } as never);
    expect(read.error).not.toBeNull();
    const keep = await anon.rpc("apple_sign_in_keep_token" as never, {
      owner_id: randomUUID(), apple_subject_digest: "0".repeat(64), token_ciphertext: "x",
    } as never);
    expect(keep.error).not.toBeNull();

    const email = address("rls");
    createdEmails.push(email);
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const person = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } });
    await person.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties!.hashed_token });
    const own = await person.rpc("apple_sign_in_read_tokens" as never, { owner_id: created.data.user!.id } as never);
    expect(own.error).not.toBeNull();
    const table = await person.schema("cadence_calendar_private" as never).from("apple_sign_in_tokens").select("*");
    expect(table.error).not.toBeNull();

    const service = await admin.rpc("apple_sign_in_keep_token" as never, {
      owner_id: created.data.user!.id, apple_subject_digest: "0".repeat(64), token_ciphertext: "x",
    } as never);
    expect(service.error?.message).toContain("apple_identity_required");
    record("token functions: anon and signed-in refused; service role needs an Apple identity", "passed");
  });
});
