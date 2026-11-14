import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Session } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Ticket 340: the sign-in callback's code exchange (`/token?grant_type=pkce`) and the
// cookie client's refreshes outside the proxy share Supabase Auth's per-address
// `/token` bucket. Cadence makes them from its server, so without forwarding every
// person shares one count. This test runs people at different addresses through
// Cadence against `scripts/auth-rate-limit-local.mjs` (a loopback copy of hosted Auth's
// per-address limits and gateway key rules).
//
// What can go wrong:
// 1. One person's made-up codes use up the limit and the next person's real Google or
//    Apple sign-in fails (sent back to /login).
// 2. With forwarding, the person who sends made-up codes is no longer limited.
// 3. The exchange stops writing the session cookie or stops using the code verifier.
// 4. A refresh outside the proxy (an /api route with an expired session) is not
//    forwarded, or the secret key reaches any call other than /token.
//
// CADENCE_CALLBACK_E2E_EXPECT=shared   Cadence without forwarding: the victim's sign-in
//                                      fails after the attack (case 1 holds).
// CADENCE_CALLBACK_E2E_EXPECT=separate Cadence with forwarding (both Ticket 338
//                                      variables and VERCEL=1): the victim signs in.
//                                      On the code before Ticket 340 this mode fails.
// Restart Auth before each run: `node scripts/auth-rate-limit-local.mjs reset`.
// Run: docs/qa/2026-11-13-ticket-340-auth-call-limits.md, section D.

const appUrl = process.env.CADENCE_CALLBACK_E2E_URL;
const gatewayUrl = process.env.CADENCE_RATE_LIMIT_GATEWAY_URL ?? "http://127.0.0.1:55397";
const stackUrl = process.env.CADENCE_LOCAL_SUPABASE_URL ?? "http://127.0.0.1:55341";
const mailpitUrl = process.env.CADENCE_LOCAL_MAILPIT_URL ?? "http://127.0.0.1:55324";
const expectMode = process.env.CADENCE_CALLBACK_E2E_EXPECT;
const evidencePath = process.env.CADENCE_CALLBACK_EVIDENCE;
const run = appUrl && (expectMode === "shared" || expectMode === "separate") ? describe : describe.skip;

const COOKIE = `sb-${new URL(gatewayUrl).hostname.split(".")[0]}-auth-token`;
const VERIFIER_COOKIE = `${COOKIE}-code-verifier`;
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const evidence: Array<Record<string, unknown>> = [];

type GatewayEntry = { at: number; path: string; status: number; code: string | null; forwardedFor: string | null; admin: boolean };

async function gatewayLog(since: number): Promise<GatewayEntry[]> {
  const all = (await fetch(`${gatewayUrl}/__t338/log`).then((r) => r.json())) as GatewayEntry[];
  return all.filter((entry) => entry.at >= since);
}

const encode = (value: unknown) => `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Answer = { status: number; location: string | null; error: string | null; setsSession: boolean; clearsVerifier: boolean };

async function get(address: string, path: string, cookies: Record<string, string>): Promise<Answer> {
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
  const lines = response.headers.getSetCookie();
  const removes = (line: string) => /max-age=0\b/i.test(line) || /^[^=]+=;/.test(line);
  const raw = response.headers.get("location");
  const location = raw ? new URL(raw, appUrl) : null;
  return {
    status: response.status,
    location: location?.pathname ?? null,
    error: location?.searchParams.get("error") ?? null,
    setsSession: lines.some((line) => line.startsWith(COOKIE) && !line.startsWith(VERIFIER_COOKIE) && !removes(line)),
    clearsVerifier: lines.some((line) => line.startsWith(`${VERIFIER_COOKIE}=`) && removes(line)),
  };
}

run(`sign-in callback limits per person (expect ${expectMode})`, () => {
  const separate = expectMode === "separate";
  let keys: { publishable: string; secret: string };
  const userIds: string[] = [];
  const admin = () => createClient(stackUrl, keys.secret, { auth: { persistSession: false } });

  async function newUser(label: string) {
    const email = `t340-${label}-${randomUUID().slice(0, 8)}@example.test`;
    const created = await admin().auth.admin.createUser({ email, email_confirm: true });
    userIds.push(created.data.user!.id);
    return email;
  }

  // A real PKCE code, as Google or Apple returns one to /auth/callback. The email and
  // /verify calls go from this test's own address, outside the /token bucket.
  async function realCode(email: string): Promise<{ code: string; verifier: string }> {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const sent = Date.now();
    const otp = await fetch(`${gatewayUrl}/auth/v1/otp`, {
      method: "POST",
      headers: { apikey: keys.publishable, "content-type": "application/json" },
      body: JSON.stringify({
        email,
        create_user: false,
        code_challenge: challenge,
        code_challenge_method: "s256",
        gotrue_meta_security: { captcha_token: TURNSTILE_TOKEN },
      }),
    });
    expect(otp.status).toBe(200);
    let hash: string | undefined;
    for (let attempt = 0; attempt < 60 && !hash; attempt += 1) {
      const search = (await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then((r) => r.json())) as {
        messages?: Array<{ ID: string; Created: string }>;
      };
      const message = (search.messages ?? []).find((m) => Date.parse(m.Created) >= sent - 1000);
      if (message) {
        const full = (await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`).then((r) => r.json())) as { HTML: string };
        hash = /token_hash=([^&"]+)/.exec(full.HTML)?.[1];
      }
      if (!hash) await sleep(250);
    }
    expect(hash).toMatch(/^pkce_/);
    const callback = new URL("/auth/callback?next=/timeline", appUrl);
    const verify = await fetch(
      `${gatewayUrl}/auth/v1/verify?token=${hash}&type=magiclink&redirect_to=${encodeURIComponent(callback.toString())}`,
      { headers: { apikey: keys.publishable }, redirect: "manual" },
    );
    const code = new URL(verify.headers.get("location") ?? "about:blank").searchParams.get("code");
    expect(code).toBeTruthy();
    return { code: code!, verifier };
  }

  async function session(email: string): Promise<Session> {
    const link = await admin().auth.admin.generateLink({ type: "magiclink", email });
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

  it("signs a person in through the callback with a real code", async () => {
    const email = await newUser("cy");
    const { code, verifier } = await realCode(email);
    const since = Date.now();
    const answer = await get("198.51.100.30", `/auth/callback?code=${code}&next=/timeline`, { [VERIFIER_COOKIE]: encode(verifier) });
    const calls = (await gatewayLog(since)).filter((e) => e.path === "/token");

    expect(answer).toMatchObject({ status: 307, location: "/timeline", setsSession: true, clearsVerifier: true });
    expect(calls.map((c) => c.status)).toEqual([200]);
    expect(calls[0].admin).toBe(separate);
    expect(calls[0].forwardedFor).toBe(separate ? "198.51.100.30" : null);
    evidence.push({ case: "real code", answer, tokenCalls: calls });
  });

  it("forwards a refresh made outside the proxy, and the secret key reaches only /token", async () => {
    const email = await newUser("dee");
    const current = await session(email);
    const expired = { ...current, expires_at: Math.floor(Date.now() / 1000) - 10 };
    const since = Date.now();
    const answer = await get("198.51.100.31", "/api/google-calendar/connection", { [COOKIE]: encode(expired) });
    const log = await gatewayLog(since);
    const refresh = log.filter((e) => e.path === "/token");

    expect(answer.status).not.toBe(401);
    expect(refresh.map((c) => c.status)).toEqual([200]);
    expect(refresh[0].admin).toBe(separate);
    expect(refresh[0].forwardedFor).toBe(separate ? "198.51.100.31" : null);
    expect(log.filter((e) => e.path !== "/token" && (e.admin || e.forwardedFor))).toEqual([]);
    evidence.push({ case: "refresh outside the proxy", answer, auth: log });
  });

  it("one person's made-up codes do not block another person's sign-in", async () => {
    const beaEmail = await newUser("bea");
    const bea = await realCode(beaEmail);
    const mallory = "198.51.100.10";
    const since = Date.now();

    let tries = 0;
    let limited = false;
    while (!limited && tries < 40) {
      tries += 1;
      const answer = await get(mallory, `/auth/callback?code=${randomUUID()}&next=/timeline`, {
        [VERIFIER_COOKIE]: encode(randomBytes(32).toString("base64url")),
      });
      expect(answer).toMatchObject({ status: 307, location: "/login", error: "auth_callback_failed", setsSession: false });
      limited = (await gatewayLog(since)).some((e) => e.path === "/token" && e.status === 429);
    }
    expect(limited).toBe(true);
    // The burst is 30; earlier cases used a few calls of the server's own count.
    expect(tries).toBeGreaterThan(separate ? 30 : 20);

    const beaSince = Date.now();
    const answer = await get("198.51.100.20", `/auth/callback?code=${bea.code}&next=/timeline`, { [VERIFIER_COOKIE]: encode(bea.verifier) });
    const calls = (await gatewayLog(beaSince)).filter((e) => e.path === "/token");
    evidence.push({ case: "attack", malloryTries: tries, bea: answer, beaTokenCalls: calls });

    if (separate) {
      expect(answer).toMatchObject({ status: 307, location: "/timeline", setsSession: true });
      expect(calls).toMatchObject([{ status: 200, admin: true, forwardedFor: "198.51.100.20" }]);
    } else {
      expect(answer).toMatchObject({ status: 307, location: "/login", error: "auth_callback_failed", setsSession: false });
      expect(calls).toMatchObject([{ status: 429, code: "over_request_rate_limit" }]);
    }
  });
});
