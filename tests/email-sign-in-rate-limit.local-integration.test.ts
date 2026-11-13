import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Ticket 338: Supabase Auth limits email requests and code checks per IP address.
// Cadence makes those calls from its server. This test runs two people at two
// addresses through Cadence's own routes, against `scripts/auth-rate-limit-local.mjs`
// (a loopback copy of hosted Auth's per-address limits and gateway key rules).
//
// What can go wrong:
// 1. One person's wrong codes block another person's right code (the shared limit).
// 2. One person's email requests block another person's request, on the web form or
//    the Mac's page.
// 3. With forwarding, the limit no longer applies to the person who sends too much.
// 4. The secret key skips the bot check: a request with no Turnstile token sends email.
// 5. A right code no longer signs in, or signs in without a session cookie.
//
// CADENCE_RATE_LIMIT_E2E_EXPECT=shared   Cadence without SUPABASE_SECRET_KEY: proves
//                                        the limit is shared (cases 1 and 2 fail).
// CADENCE_RATE_LIMIT_E2E_EXPECT=separate Cadence with forwarding: cases 1–5 hold.
// Restart Auth between runs: `node scripts/auth-rate-limit-local.mjs reset`.
// Run: docs/qa/2026-11-13-ticket-338-email-rate-limit.md.

const appUrl = process.env.CADENCE_RATE_LIMIT_E2E_URL;
const gatewayUrl = process.env.CADENCE_RATE_LIMIT_GATEWAY_URL ?? "http://127.0.0.1:55397";
const mailpitUrl = process.env.CADENCE_LOCAL_MAILPIT_URL ?? "http://127.0.0.1:55324";
const expectMode = process.env.CADENCE_RATE_LIMIT_E2E_EXPECT;
const evidencePath = process.env.CADENCE_RATE_LIMIT_EVIDENCE;
const run = appUrl && (expectMode === "shared" || expectMode === "separate") ? describe : describe.skip;

// Cloudflare's documented dummy token; the local Auth and Cadence use the always-pass
// test secret.
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const evidence: Array<Record<string, unknown>> = [];

type GatewayEntry = { at: number; path: string; status: number; code: string | null; forwardedFor: string | null; admin: boolean };

async function gatewayLog(since: number): Promise<GatewayEntry[]> {
  const all = (await fetch(`${gatewayUrl}/__t338/log`).then((r) => r.json())) as GatewayEntry[];
  return all.filter((entry) => entry.at >= since);
}

class Person {
  private jar = new Map<string, string>();
  constructor(readonly address: string) {}

  async post(path: string, form: Record<string, string>, json = false) {
    const headers: Record<string, string> = {
      origin: new URL(appUrl!).origin,
      "sec-fetch-site": "same-origin",
      // What Vercel sets in front of Cadence.
      "x-forwarded-for": this.address,
      "x-real-ip": this.address,
    };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    headers["content-type"] = json ? "application/json" : "application/x-www-form-urlencoded";
    const response = await fetch(new URL(path, appUrl), {
      method: "POST",
      headers,
      body: json ? JSON.stringify(form) : new URLSearchParams(form).toString(),
      redirect: "manual",
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (attributes.some((a) => /max-age=0\b/i.test(a.trim())) || value === "") this.jar.delete(name.trim());
      else this.jar.set(name.trim(), value);
    }
    return response;
  }

  requestCode(email: string, token: string | null = TURNSTILE_TOKEN) {
    const form: Record<string, string> = { email, next: "/timeline" };
    if (token) form["cf-turnstile-response"] = token;
    return this.post("/auth/sign-in/email", form);
  }

  enterCode(code: string) {
    return this.post("/auth/email/verify", { code });
  }

  signedIn() {
    return [...this.jar.keys()].some((name) => /^sb-.*-auth-token(\.\d+)?$/.test(name));
  }
}

function location(response: Response) {
  const value = response.headers.get("location");
  if (!value) return null;
  const url = new URL(value, appUrl);
  return `${url.pathname}${url.search}`;
}

async function codeFor(email: string, after: number): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const search = (await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    ).then((r) => r.json())) as { messages?: Array<{ ID: string; Created: string }> };
    const message = (search.messages ?? []).find((m) => Date.parse(m.Created) >= after - 1000);
    if (message) {
      const full = (await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`).then((r) => r.json())) as { HTML: string };
      const code = full.HTML.match(/letter-spacing:4px[^>]*>\s*(\d+)\s*</)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No sign-in email arrived for the test address.");
}

async function mailCount(email: string, after: number) {
  const search = (await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  ).then((r) => r.json())) as { messages?: Array<{ Created: string }> };
  return (search.messages ?? []).filter((m) => Date.parse(m.Created) >= after - 1000).length;
}

const address = (label: string) => `t338-${label}-${randomUUID().slice(0, 8)}@example.test`;
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

run(`email sign-in limits per person (expect ${expectMode})`, () => {
  const separate = expectMode === "separate";

  it("one person's wrong codes do not block another person's code", async () => {
    const mallory = new Person("198.51.100.10");
    const bea = new Person("198.51.100.20");
    const started = Date.now();

    const beaEmail = address("bea");
    expect(location(await bea.requestCode(beaEmail))).toMatch(/sent=1/);
    const beaCode = await codeFor(beaEmail, started);

    const malloryEmail = address("mallory");
    expect(location(await mallory.requestCode(malloryEmail))).toMatch(/sent=1/);
    const malloryCode = await codeFor(malloryEmail, started);

    // Wrong codes until Auth answers 429 for Mallory's checks.
    let tries = 0;
    let limited = false;
    const verifyStart = Date.now();
    while (!limited && tries < 60) {
      tries += 1;
      await mallory.enterCode(wrongCode(malloryCode));
      const last = (await gatewayLog(verifyStart)).filter((e) => e.path === "/verify").at(-1);
      limited = last?.status === 429;
    }
    expect(limited).toBe(true);

    const beaAt = Date.now();
    const beaResponse = await bea.enterCode(beaCode);
    const beaVerify = (await gatewayLog(beaAt)).filter((e) => e.path === "/verify").at(-1);
    const malloryRight = await mallory.enterCode(malloryCode);
    const verifyLog = (await gatewayLog(verifyStart)).filter((e) => e.path === "/verify");

    evidence.push({
      case: "verify",
      expect: expectMode,
      mallory: { wrongCodesUntil429: tries, rightCodeAfterLimit: location(malloryRight) },
      bea: { location: location(beaResponse), signedIn: bea.signedIn(), authStatus: beaVerify?.status, authCode: beaVerify?.code },
      forwardedFor: [...new Set(verifyLog.map((e) => e.forwardedFor))],
      adminCalls: verifyLog.filter((e) => e.admin).length,
    });

    if (separate) {
      expect(location(beaResponse)).toBe("/timeline");
      expect(bea.signedIn()).toBe(true);
      expect(beaVerify?.status).toBe(200);
      expect(beaVerify?.forwardedFor).toBe("198.51.100.20");
      // The limit still holds for the person who hit it.
      expect(location(malloryRight)).toMatch(/error=code_rejected/);
    } else {
      expect(location(beaResponse)).toMatch(/error=code_rejected/);
      expect(bea.signedIn()).toBe(false);
      expect(beaVerify?.status).toBe(429);
    }
  }, 180_000);

  it("one person's email requests do not block another person's request, web or Mac", async () => {
    const mallory = new Person("198.51.100.11");
    const cy = new Person("198.51.100.30");
    const dee = new Person("198.51.100.40");
    const started = Date.now();

    let tries = 0;
    let limited = false;
    while (!limited && tries < 60) {
      tries += 1;
      await mallory.requestCode(address(`flood${tries}`));
      const last = (await gatewayLog(started)).filter((e) => e.path === "/otp").at(-1);
      limited = last?.status === 429;
    }
    expect(limited).toBe(true);

    const cyEmail = address("cy");
    const cyResponse = await cy.requestCode(cyEmail);
    const deeEmail = address("dee");
    const deeResponse = await dee.post("/auth/email/mac", { email: deeEmail, captchaToken: TURNSTILE_TOKEN }, true);
    const deeBody = (await deeResponse.json()) as { ok: boolean; error?: string };

    evidence.push({
      case: "request",
      expect: expectMode,
      mallory: { requestsUntil429: tries },
      cyWeb: location(cyResponse),
      deeMac: { status: deeResponse.status, ...deeBody },
    });

    if (separate) {
      expect(location(cyResponse)).toMatch(/sent=1/);
      expect(location(cyResponse)).not.toMatch(/error=/);
      await codeFor(cyEmail, started);
      expect(deeBody.ok).toBe(true);
      await codeFor(deeEmail, started);
    } else {
      expect(location(cyResponse)).toMatch(/error=email_rate_limited/);
      expect(deeResponse.status).toBe(429);
    }
  }, 180_000);

  it.runIf(separate)("the bot check still runs: no Turnstile token, no email", async () => {
    const eve = new Person("198.51.100.50");
    const started = Date.now();
    const email = address("eve");
    const web = await eve.requestCode(email, null);
    const mac = await eve.post("/auth/email/mac", { email }, true);
    const macBody = (await mac.json()) as { ok: boolean; error?: string };
    const otpCalls = (await gatewayLog(started)).filter((e) => e.path === "/otp").length;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const mails = await mailCount(email, started);

    evidence.push({ case: "bot-check", web: location(web), mac: { status: mac.status, ...macBody }, otpCalls, mails });
    expect(location(web)).toMatch(/error=email_check_failed/);
    expect(macBody.error).toBe("email_check_failed");
    expect(otpCalls).toBe(0);
    expect(mails).toBe(0);
  }, 60_000);

  it("writes evidence", () => {
    if (!evidencePath) return;
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify({ at: new Date().toISOString(), expect: expectMode, evidence }, null, 2)}\n`);
  });
});
