import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Ticket 339: Cadence's proxy refreshes expired sessions from its server, so Supabase
// Auth's per-address /token limit was shared by everyone, and a refused refresh
// cleared the person's session. This test runs people at different addresses through
// Cadence's proxy against `scripts/auth-rate-limit-local.mjs` (a loopback copy of
// hosted Auth's per-address limits and gateway key rules).
//
// What can go wrong:
// 1. One person's made-up refreshes use up the limit and the next person is signed
//    out (cookie cleared, sent to /login). The attack from the Ticket 338 verifier.
// 2. With forwarding, the person who sends too much is no longer limited.
// 3. A refused refresh (429) clears a valid cookie or sends the person to /login.
// 4. A kept session stays stuck after the limit passes.
// 5. A truly ended session (signed out, revoked, account deleted, made-up or
//    malformed cookie) is kept instead of going to /login.
// 6. A valid session calls /token, or an expired one no longer refreshes.
// 7. Two requests with the same refresh token at once sign the person out.
// 8. The secret key is used for any call other than the refresh.
//
// CADENCE_REFRESH_E2E_EXPECT=shared   Cadence without forwarding: everyone shares the
//                                     limit, but a 429 keeps the session (Ticket 339
//                                     part 2). On the code before Ticket 339, case 1
//                                     fails: the victim is signed out.
// CADENCE_REFRESH_E2E_EXPECT=separate Cadence with forwarding (both Ticket 338
//                                     variables and VERCEL=1): the victim refreshes.
// Restart Auth before each run: `node scripts/auth-rate-limit-local.mjs reset`.
// Run: docs/qa/2026-11-13-ticket-339-session-refresh-rate-limit.md.

const appUrl = process.env.CADENCE_REFRESH_E2E_URL;
const gatewayUrl = process.env.CADENCE_RATE_LIMIT_GATEWAY_URL ?? "http://127.0.0.1:55397";
const stackUrl = process.env.CADENCE_LOCAL_SUPABASE_URL ?? "http://127.0.0.1:55341";
const expectMode = process.env.CADENCE_REFRESH_E2E_EXPECT;
const evidencePath = process.env.CADENCE_REFRESH_EVIDENCE;
const run = appUrl && (expectMode === "shared" || expectMode === "separate") ? describe : describe.skip;

const COOKIE = `sb-${new URL(gatewayUrl).hostname.split(".")[0]}-auth-token`;
const CHUNK = 3180;
const evidence: Array<Record<string, unknown>> = [];

type GatewayEntry = { at: number; path: string; status: number; code: string | null; forwardedFor: string | null; admin: boolean };

async function gatewayLog(since: number): Promise<GatewayEntry[]> {
  const all = (await fetch(`${gatewayUrl}/__t338/log`).then((r) => r.json())) as GatewayEntry[];
  return all.filter((entry) => entry.at >= since);
}

const tokenCalls = async (since: number) => (await gatewayLog(since)).filter((e) => e.path === "/token");

function sessionCookies(session: object): Record<string, string> {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  if (value.length <= CHUNK) return { [COOKIE]: value };
  const out: Record<string, string> = {};
  for (let i = 0; i * CHUNK < value.length; i += 1) out[`${COOKIE}.${i}`] = value.slice(i * CHUNK, (i + 1) * CHUNK);
  return out;
}

type Load = { status: number; location: string | null; cleared: boolean; setsSession: boolean; retryAfter: string | null };

async function load(address: string, cookies: Record<string, string>, path = "/timeline"): Promise<Load> {
  const response = await fetch(new URL(path, appUrl), {
    redirect: "manual",
    headers: {
      // What Vercel sets in front of Cadence.
      "x-forwarded-for": address,
      "x-real-ip": address,
      cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
    },
  });
  await response.arrayBuffer();
  const lines = response.headers.getSetCookie().filter((line) => line.startsWith(COOKIE));
  const removes = (line: string) => /max-age=0\b/i.test(line) || /^[^=]+=;/.test(line) || /expires=thu, 01 jan 1970/i.test(line);
  const raw = response.headers.get("location");
  return {
    status: response.status,
    location: raw ? new URL(raw, appUrl).pathname : null,
    cleared: lines.length > 0 && lines.every(removes),
    setsSession: lines.some((line) => !removes(line)),
    retryAfter: response.headers.get("retry-after"),
  };
}

const expired = (session: Session) => ({ ...session, expires_at: Math.floor(Date.now() / 1000) - 10 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

run(`session refresh limits per person (expect ${expectMode})`, () => {
  const separate = expectMode === "separate";
  let keys: { publishable: string; secret: string };
  const userIds: string[] = [];

  const admin = () => createClient(stackUrl, keys.secret, { auth: { persistSession: false } });

  async function newSession(label: string): Promise<Session> {
    const email = `t339-${label}-${randomUUID().slice(0, 8)}@example.test`;
    const created = await admin().auth.admin.createUser({ email, email_confirm: true });
    userIds.push(created.data.user!.id);
    const link = await admin().auth.admin.generateLink({ type: "magiclink", email });
    // Made directly on the stack, so it does not count against the copy's limits.
    const anon = createClient(stackUrl, keys.publishable, { auth: { persistSession: false } });
    const { data, error } = await anon.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
    if (error || !data.session) throw error ?? new Error("no session");
    return data.session;
  }

  beforeAll(() => {
    const out = execFileSync("npm", ["run", "-s", "supabase", "--", "status", "-o", "env"], { encoding: "utf8" });
    const read = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(out)?.[1] ?? "";
    keys = { publishable: read("PUBLISHABLE_KEY"), secret: read("SECRET_KEY") };
  });

  afterAll(async () => {
    for (const id of userIds) await admin().auth.admin.deleteUser(id).catch(() => {});
    if (!evidencePath) return;
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({ at: new Date().toISOString(), expect: expectMode, evidence }, null, 2)}\n`);
  });

  it("keeps a valid session without calling /token, and refreshes an expired one", async () => {
    const session = await newSession("valid");
    const since = Date.now();
    const fresh = await load("198.51.100.30", sessionCookies(session));
    expect(fresh).toMatchObject({ status: 200, cleared: false });
    expect(await tokenCalls(since)).toHaveLength(0);

    const refreshed = await load("198.51.100.30", sessionCookies(expired(session)));
    const calls = await tokenCalls(since);
    expect(refreshed).toMatchObject({ status: 200, cleared: false, setsSession: true });
    expect(calls.map((c) => c.status)).toEqual([200]);
    expect(calls[0].admin).toBe(separate);
    expect(calls[0].forwardedFor).toBe(separate ? "198.51.100.30" : null);
    // Case 8: no other Auth call carries the secret key.
    expect((await gatewayLog(since)).filter((e) => e.path !== "/token" && e.admin)).toEqual([]);
    evidence.push({ case: "valid", fresh, refreshed, tokenCalls: calls });
  });

  it("sends ended sessions to /login and clears them", async () => {
    const results: Record<string, Load> = {};

    const revoked = await newSession("revoked");
    await admin().auth.admin.signOut(revoked.access_token, "global");
    results.revoked = await load("198.51.100.31", sessionCookies(expired(revoked)));

    const deleted = await newSession("deleted");
    await admin().auth.admin.deleteUser(deleted.user.id);
    results.deleted = await load("198.51.100.31", sessionCookies(expired(deleted)));

    const signedOut = await newSession("signed-out");
    const signOut = await fetch(new URL("/auth/sign-out", appUrl), {
      method: "POST",
      redirect: "manual",
      headers: {
        "x-real-ip": "198.51.100.31",
        cookie: Object.entries(sessionCookies(signedOut)).map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    expect(signOut.status).toBe(303);
    results.signedOut = await load("198.51.100.31", sessionCookies(expired(signedOut)));

    const madeUp = { access_token: "x.y.z", token_type: "bearer", expires_in: 3600, expires_at: 1, refresh_token: "made-up-token", user: { id: randomUUID() } };
    results.madeUp = await load("198.51.100.31", sessionCookies(madeUp));
    results.malformed = await load("198.51.100.31", { [COOKIE]: "base64-%%%not-a-session" });
    results.notJson = await load("198.51.100.31", { [COOKIE]: "not-a-session" });

    for (const [name, result] of Object.entries(results)) {
      expect({ name, status: result.status, location: result.location }).toEqual({ name, status: 307, location: "/login" });
    }
    for (const name of ["revoked", "deleted", "signedOut", "madeUp"]) expect(results[name].cleared).toBe(true);
    evidence.push({ case: "ended", results });
  });

  it("two requests with the same refresh token at once both stay signed in", async () => {
    const session = sessionCookies(expired(await newSession("concurrent")));
    const since = Date.now();
    const both = await Promise.all([load("198.51.100.32", session), load("198.51.100.32", session)]);
    for (const result of both) expect(result).toMatchObject({ status: 200, cleared: false, setsSession: true });
    evidence.push({ case: "concurrent", both, tokenCalls: await tokenCalls(since) });
  });

  it("one person's made-up refreshes do not sign another person out", async () => {
    const victim = await newSession("victim");
    const fake = { access_token: "x.y.z", token_type: "bearer", expires_in: 3600, expires_at: 1, refresh_token: "bogusbogus", user: { id: randomUUID() } };

    // Mallory loads /timeline with a made-up expired session until Auth answers 429.
    const since = Date.now();
    let tries = 0;
    let mallory: Load | null = null;
    while (tries < 200) {
      tries += 1;
      mallory = await load("198.51.100.10", sessionCookies(fake));
      if ((await tokenCalls(since)).at(-1)?.status === 429) break;
    }
    expect((await tokenCalls(since)).at(-1)?.status).toBe(429);

    const at = Date.now();
    const bea = await load("198.51.100.20", sessionCookies(expired(victim)));
    const beaCalls = await tokenCalls(at);
    evidence.push({ case: "attack", malloryRequestsUntil429: tries, mallory, bea, beaCalls });

    expect(bea.cleared).toBe(false);
    expect(bea.location).toBeNull();
    // Rate limited is not signed out, for Mallory too: she gets "try again".
    expect(mallory).toMatchObject({ status: 503, cleared: false, location: null });
    if (separate) {
      expect(bea).toMatchObject({ status: 200, setsSession: true });
      expect(beaCalls.map((c) => [c.status, c.forwardedFor])).toEqual([[200, "198.51.100.20"]]);
      return;
    }

    // Shared limit: Bea is refused too, but keeps her session and is asked to retry.
    expect(beaCalls.map((c) => c.status)).toEqual([429]);
    expect(bea).toMatchObject({ status: 503, retryAfter: expect.stringMatching(/^\d+$/) });

    // Case 4: once the limit has room again, the same cookie refreshes.
    let later: Load | null = null;
    for (let i = 0; i < 20; i += 1) {
      await sleep(1_000);
      later = await load("198.51.100.20", sessionCookies(expired(victim)));
      if (later.status !== 503) break;
    }
    expect(later).toMatchObject({ status: 200, cleared: false, setsSession: true });
    evidence.push({ case: "attack-recovery", later });
  });
});
