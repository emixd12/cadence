import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateOpenAIDailyBrief } from "@/lib/services/daily-brief-openai";
import {
  acceptCallback, buildAuthorizeUrl, contractFromProbes, corsAllowsWebview, createSseParser, latencyStats, main, mockBrowser, newAttempt, parseArgs,
  pkceChallenge, refreshTokens, renderMarkdown, revokeRefreshToken, runSpike, SecretBag, selectModels, SpikeStop, streamResponses, toPlanRequest, verifyIdToken,
  type CorsResult, type Jwks, type ProbeResult, type SpikeOptions, type SseEvent,
} from "@/scripts/chatgpt-plan-spike";
import { startMockOpenAI, type MockOpenAI, type MockOptions } from "@/scripts/chatgpt-plan-spike-mock";

let configDir = "";
let mocks: MockOpenAI[] = [];

beforeEach(async () => { configDir = await mkdtemp(join(tmpdir(), "cadence-spike-test-")); });
afterEach(async () => {
  await Promise.all(mocks.map((mock) => mock.close()));
  mocks = [];
  await rm(configDir, { recursive: true, force: true });
});

async function mock(options: MockOptions = {}): Promise<MockOpenAI> {
  const started = await startMockOpenAI(options);
  mocks.push(started);
  return started;
}

function options(target: MockOpenAI, logs: string[], overrides: Partial<SpikeOptions> = {}): SpikeOptions {
  return { mode: "mock", endpoints: target.endpoints, useDiscovery: true, fetchImpl: fetch, configDir, port: 0, openBrowser: mockBrowser(fetch), models: null,
    maxModels: 3, fixtures: ["sparse", "uneventful", "travel_day"], repeats: 1, deadlineMs: 10_000, callbackTimeoutMs: 5_000, log: (line) => logs.push(line), ...overrides };
}

function expectNoSecrets(target: MockOpenAI, ...texts: string[]): void {
  const joined = texts.join("\n");
  expect(target.state.issuedSecrets.length).toBeGreaterThan(0);
  for (const value of target.state.issuedSecrets) expect(joined.includes(value)).toBe(false);
}

describe("sign-in building blocks", () => {
  it("derives the S256 challenge as unpadded base64url SHA-256", () => {
    const verifier = "synthetic-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
    const expected = createHash("sha256").update(verifier, "ascii").digest("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
    expect(pkceChallenge(verifier)).toBe(expected);
    expect(pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("builds the registration URL with every documented parameter and the returning URL without the name hint", () => {
    const registering = newAttempt({ clientId: null, hostId: "urn:uuid:00000000-0000-4000-8000-000000000000", redirectUri: "http://127.0.0.1:1455/auth/callback" });
    const url = new URL(buildAuthorizeUrl("https://auth.openai.com/api/accounts/authorize", registering, "https://api.openai.com/v1"));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "dynamic_agent_client", agent_name_hint: "Cadence",
      ext_agent_host_id: "urn:uuid:00000000-0000-4000-8000-000000000000", response_type: "code", redirect_uri: "http://127.0.0.1:1455/auth/callback",
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", resource: "https://api.openai.com/v1", code_challenge_method: "S256",
      code_challenge: pkceChallenge(registering.verifier), state: registering.state, nonce: registering.nonce });
    expect(url.search).toContain("scope=openid%20profile");
    expect(url.search).not.toContain(registering.verifier);
    const returning = newAttempt({ clientId: "oaiapp_saved", hostId: registering.hostId, redirectUri: registering.redirectUri });
    const again = new URL(buildAuthorizeUrl("https://auth.openai.com/api/accounts/authorize", returning, "https://api.openai.com/v1"));
    expect(again.searchParams.get("client_id")).toBe("oaiapp_saved");
    expect(again.searchParams.has("agent_name_hint")).toBe(false);
    expect(returning.state).not.toBe(registering.state);
  });

  it("checks state before anything else and rejects incomplete or mismatched registrations", () => {
    const attempt = newAttempt({ clientId: null, hostId: "urn:uuid:x", redirectUri: "http://127.0.0.1:1/auth/callback" });
    const base = { code: "code-123456789", state: attempt.state, clientId: "oaiapp_new", scope: null, error: null };
    const code = (fn: () => unknown) => { try { fn(); } catch (error) { return error instanceof SpikeStop ? error.code : "other"; } return "none"; };
    expect(code(() => acceptCallback({ ...base, state: "other", error: "access_denied" }, attempt))).toBe("state_mismatch");
    expect(code(() => acceptCallback({ ...base, error: "access_denied" }, attempt))).toBe("access_denied");
    expect(code(() => acceptCallback({ ...base, clientId: null }, attempt))).toBe("registration_incomplete");
    expect(code(() => acceptCallback({ ...base, clientId: "dynamic_agent_client" }, attempt))).toBe("registration_incomplete");
    expect(acceptCallback(base, attempt)).toEqual({ code: "code-123456789", clientId: "oaiapp_new" });
    const returning = newAttempt({ clientId: "oaiapp_saved", hostId: "urn:uuid:x", redirectUri: "http://127.0.0.1:1/auth/callback" });
    expect(code(() => acceptCallback({ ...base, state: returning.state, clientId: "oaiapp_other" }, returning))).toBe("client_id_mismatch");
    expect(acceptCallback({ ...base, state: returning.state, clientId: null }, returning).clientId).toBe("oaiapp_saved");
  });
});

describe("ID token validation", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const jwks: Jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] };
  const now = 1_790_000_000;
  const claims = { iss: "https://auth.openai.com", aud: "oaiapp_a", sub: "user-1", iat: now - 5, exp: now + 3600, nonce: "nonce-1" };
  const token = (payload: Record<string, unknown> = claims, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }, key = privateKey) => {
    const encoded = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    return `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), key).toString("base64url")}`;
  };
  const check = { jwks, issuer: "https://auth.openai.com", clientId: "oaiapp_a", nonce: "nonce-1", nowSeconds: now };
  const failure = (value: string) => { try { verifyIdToken(value, check); return "valid"; } catch (error) { return error instanceof SpikeStop ? error.code : "other"; } };

  it("accepts a correctly signed token and returns its subject", () => {
    expect(verifyIdToken(token(), check)).toEqual({ sub: "user-1" });
    expect(verifyIdToken(token({ ...claims, aud: ["oaiapp_a", "x"], azp: "oaiapp_a" }), check)).toEqual({ sub: "user-1" });
  });

  it("rejects each documented failure", () => {
    expect(failure(token(claims, { alg: "RS256", kid: "k1" }, other))).toBe("bad_signature");
    expect(failure(token({ ...claims, iss: "https://evil.invalid" }))).toBe("wrong_issuer");
    expect(failure(token({ ...claims, aud: "oaiapp_b" }))).toBe("wrong_audience");
    expect(failure(token({ ...claims, aud: ["oaiapp_a", "x"] }))).toBe("wrong_authorized_party");
    expect(failure(token({ ...claims, exp: now - 120 }))).toBe("expired");
    expect(failure(token({ ...claims, nonce: "nonce-2" }))).toBe("nonce_mismatch");
    expect(failure(token(claims, { alg: "RS256", kid: "unknown" }))).toBe("unknown_kid");
    expect(failure(token(claims, { alg: "none", kid: "k1" }))).toBe("unexpected_alg");
    expect(failure("not-a-jwt")).toBe("malformed");
    const [header, payload] = token().split(".");
    expect(failure(`${header}.${payload}.`)).toBe("bad_signature");
  });
});

describe("streaming and request contract", () => {
  it("parses SSE events split at any byte and with CRLF line ends", () => {
    const events: SseEvent[] = [];
    const parser = createSseParser((event) => events.push(event));
    const text = ": comment\r\nevent: a\r\ndata: {\"x\":1}\r\n\r\nevent: b\ndata: line1\ndata: line2\n\n";
    for (const char of text) parser.push(char);
    parser.end();
    expect(events).toEqual([{ event: "a", data: "{\"x\":1}" }, { event: "b", data: "line1\nline2" }]);
  });

  it("rewrites today's hosted request into the plan contract", async () => {
    let hosted: Record<string, unknown> = {};
    await generateOpenAIDailyBrief({ instructions: "synthetic", facts: "{\"a\":1}", signal: new AbortController().signal }, { apiKey: "k", fetch: (async (_url: string, init: RequestInit) => {
      hosted = JSON.parse(init.body as string);
      return new Response(null, { status: 500 });
    }) as unknown as typeof fetch }).catch(() => undefined);
    expect(hosted).toMatchObject({ background: false, max_output_tokens: 2000, input: "{\"a\":1}" });
    const full = toPlanRequest(hosted, "gpt-plan", { jsonSchema: true, reasoning: true, tools: true });
    expect(full).toMatchObject({ model: "gpt-plan", store: false, stream: true, input: [{ role: "user", content: "{\"a\":1}" }], reasoning: { effort: "low" }, tools: [], tool_choice: "none",
      text: { format: { type: "json_schema", name: "cadence_daily_brief", strict: true } } });
    expect(full).not.toHaveProperty("max_output_tokens");
    expect(full).not.toHaveProperty("background");
    const bare = toPlanRequest(hosted, "gpt-plan", { jsonSchema: false, reasoning: false, tools: false });
    expect(Object.keys(bare).sort()).toEqual(["input", "instructions", "model", "store", "stream"]);
  });

  it("reports HTTP errors, failed streams and non-streaming replies", async () => {
    const endpoints = (await mock()).endpoints;
    const reply = (response: Response) => (async () => response) as unknown as typeof fetch;
    const signal = new AbortController().signal;
    const admission = await streamResponses(reply(new Response(JSON.stringify({ detail: "Direct routing disabled" }), { status: 503, headers: { "x-request-id": "req_1" } })), endpoints, "t", {}, { signal });
    expect(admission).toMatchObject({ kind: "http_error", httpStatus: 503, errorCode: null, errorDetail: "Direct routing disabled", requestId: "req_1" });
    const failed = await streamResponses(reply(new Response("event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } })), endpoints, "t", {}, { signal });
    expect(failed).toMatchObject({ kind: "failed", errorCode: "subscription_sharing_usage_limit_exceeded" });
    const cut = await streamResponses(reply(new Response("event: response.created\ndata: {\"type\":\"response.created\"}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } })), endpoints, "t", {}, { signal });
    expect(cut.kind).toBe("stream_interrupted");
    const plain = await streamResponses(reply(new Response(JSON.stringify({ status: "completed", output: [] }), { status: 200, headers: { "Content-Type": "application/json" } })), endpoints, "t", {}, { signal });
    expect(plain.kind).toBe("completed");
  });

  it("computes median and maximum latency", () => {
    expect(latencyStats([])).toEqual({ count: 0, medianMs: null, maxMs: null });
    expect(latencyStats([30, 10, 20])).toEqual({ count: 3, medianMs: 20, maxMs: 30 });
    expect(latencyStats([4, 1, 3, 2])).toEqual({ count: 4, medianMs: 3, maxMs: 4 });
  });

  it("selects listed models in server order and adds today's Daily Brief model when listed", () => {
    const catalog = { status: 200, requestId: null, modelKeys: [], error: null, models: [
      { slug: "a", displayName: null, visibility: "list" }, { slug: "hidden", displayName: null, visibility: "hide" },
      { slug: "b", displayName: null, visibility: "list" }, { slug: "gpt-5.6-luna", displayName: null, visibility: "list" },
    ] };
    expect(selectModels(catalog, null, 2)).toEqual(["a", "b", "gpt-5.6-luna"]);
    expect(selectModels(catalog, null, 5)).toEqual(["a", "b", "gpt-5.6-luna"]);
    expect(selectModels(catalog, ["b", "missing"], 1)).toEqual(["b"]);
  });

  it("keeps only probe-accepted optional fields in the contract", () => {
    const row = (probe: ProbeResult["probe"], accepted: boolean) => ({ model: "m", probe, expected: "observe", accepted } as ProbeResult);
    expect(contractFromProbes([row("json_schema_strict", true), row("reasoning_low", false), row("tools_none", true)])).toEqual({ jsonSchema: true, reasoning: false, tools: true });
  });

  it("decides webview CORS from the preflight headers", () => {
    const base: CorsResult = { target: "responses", url: "u", status: 204, allowOrigin: "tauri://localhost", allowMethods: "POST, OPTIONS", allowHeaders: "authorization, content-type", allowCredentials: null, error: null };
    expect(corsAllowsWebview(base, ["authorization", "content-type"])).toBe(true);
    expect(corsAllowsWebview({ ...base, allowOrigin: null }, ["authorization"])).toBe(false);
    expect(corsAllowsWebview({ ...base, allowHeaders: "content-type" }, ["authorization", "content-type"])).toBe(false);
    expect(corsAllowsWebview({ ...base, allowOrigin: "*", allowHeaders: "*" }, ["authorization"])).toBe(true);
    expect(corsAllowsWebview({ ...base, status: 403 }, ["authorization"])).toBe(false);
  });

  it("retries revocation on server errors and stops on a client error", async () => {
    const statuses = [503, 502, 200];
    let calls = 0;
    const flaky = (async () => new Response(null, { status: statuses[calls++] })) as unknown as typeof fetch;
    expect(await revokeRefreshToken(flaky, "http://x/revoke", { clientId: "c", refreshToken: "r" }, async () => undefined)).toEqual({ status: 200, ok: true, attempts: 3, error: null });
    const rejected = (async () => new Response(null, { status: 400 })) as unknown as typeof fetch;
    expect(await revokeRefreshToken(rejected, "http://x/revoke", { clientId: "c", refreshToken: "r" }, async () => undefined)).toMatchObject({ ok: false, attempts: 1, error: "rejected" });
  });

  it("parses CLI flags and refuses to run without a mode", () => {
    expect(parseArgs([])).toMatchObject({ mode: null, maxModels: 3, repeats: 1, port: 1455, deadlineMs: 120_000 });
    expect(parseArgs(["--live", "--fixtures", "all", "--models", "a,b"]).fixtures.length).toBe(16);
    expect(parseArgs(["--live", "--models", "a,b"]).models).toEqual(["a", "b"]);
    expect(() => parseArgs(["--fixtures", "nope"])).toThrow("unknown fixture");
    expect(() => parseArgs(["--token", "x"])).toThrow("unknown flag");
  });
});

describe("mock-mode spike runs", () => {
  it("signs in, probes, runs briefs through the real pipeline, refreshes and revokes without leaking secrets", async () => {
    const target = await mock();
    const logs: string[] = [];
    const report = await runSpike(options(target, logs));
    expect(report.errors).toEqual([]);
    expect(report.signIn).toMatchObject({ registration: "new", clientIdIssued: true, clientIdLooksIssued: true, idToken: { valid: true }, planUsage: true });
    expect(report.catalog.selected).toEqual(["gpt-mock-fast", "gpt-mock-think"]);
    expect(report.catalog.modelKeys).toContain("slug");
    const rejected = report.probes.filter((probe) => probe.expected === "reject");
    expect(rejected.every((probe) => !probe.accepted && probe.errorCode === "subscription_sharing_unsupported_capability")).toBe(true);
    expect(rejected.map((probe) => probe.errorParam)).toContain("background");
    expect(report.probes.filter((probe) => probe.probe === "max_output_tokens").every((probe) => probe.accepted)).toBe(true);
    expect(report.briefs).toHaveLength(6);
    expect(report.summary.map((row) => [row.model, row.passRate])).toEqual([["gpt-mock-fast", 1], ["gpt-mock-think", 1]]);
    expect(report.refresh).toMatchObject({ ok: true, rotated: true, scopesKept: true });
    expect(report.revoke).toMatchObject({ attempted: true, ok: true });
    expect(target.state.revokedTokens).toHaveLength(1);
    expect(target.state.liveRefreshTokens.size).toBe(0);
    expect(report.redactionTriggered).toBe(false);
    expectNoSecrets(target, JSON.stringify(report), renderMarkdown(report), ...logs);
    // A backslash before a pipe stays literal: escape backslashes first, then pipes.
    expect(renderMarkdown({ ...report, catalog: { ...report.catalog, modelKeys: ["a\\|b"] } })).toContain("model fields: a\\\\\\|b;");
    const host = await readFile(join(configDir, "host.json"), "utf8");
    expect(JSON.parse(host)).toEqual({ hostId: expect.stringMatching(/^urn:uuid:[0-9a-f-]{36}$/u), clientId: target.state.issuedClientId });
    expectNoSecrets(target, host);
    expect((await stat(join(configDir, "host.json"))).mode & 0o777).toBe(0o600);
  });

  it("reuses the host ID and issued client ID on a returning sign-in", async () => {
    const target = await mock();
    await runSpike(options(target, [], { fixtures: ["sparse"], maxModels: 1 }));
    const report = await runSpike(options(target, [], { fixtures: ["sparse"], maxModels: 1 }));
    expect(report.signIn.registration).toBe("returning");
    const [first, second] = target.state.authorizeRequests;
    expect(second.get("client_id")).toBe(target.state.issuedClientId);
    expect(second.has("agent_name_hint")).toBe(false);
    expect(second.get("ext_agent_host_id")).toBe(first.get("ext_agent_host_id"));
  });

  it("stops before inference when plan usage is not granted, and still revokes", async () => {
    const target = await mock({ withholdPlanScope: true });
    const report = await runSpike(options(target, []));
    expect(report.signIn.planUsage).toBe(false);
    expect(report.errors).toEqual([{ stage: "scopes", code: "plan_scope_missing" }]);
    expect(target.state.responsesRequests).toBe(0);
    expect(report.revoke.ok).toBe(true);
  });

  it("stops on declined consent without a token exchange", async () => {
    const target = await mock({ denyConsent: true });
    const report = await runSpike(options(target, []));
    expect(report.signIn.error).toBe("access_denied");
    expect(target.state.tokenGrants).toEqual([]);
    expect(report.revoke.attempted).toBe(false);
  });

  it("refuses an ID token with a bad signature before any model call", async () => {
    const target = await mock({ idTokenFault: "signature" });
    const report = await runSpike(options(target, []));
    expect(report.signIn.idToken).toEqual({ valid: false, error: "bad_signature" });
    expect(target.state.responsesRequests).toBe(0);
    expect(report.revoke.ok).toBe(true);
  });

  it("counts invalid brief output against the pass rate", async () => {
    const target = await mock({ invalidBriefEvery: 2 });
    const report = await runSpike(options(target, [], { fixtures: ["sparse", "uneventful"], maxModels: 1 }));
    expect(report.summary[0]).toMatchObject({ runs: 2, completed: 2, valid: 1, passRate: 0.5 });
    expect(report.briefs.find((brief) => brief.validation === "fail")?.validationCode).toBe("advisor_unavailable");
  });

  it("stops the run on a usage-limit failure instead of retrying", async () => {
    const target = await mock({ usageLimitAfter: 2 });
    const report = await runSpike(options(target, [], { fixtures: ["sparse", "uneventful", "travel_day", "dense"] }));
    expect(report.stoppedEarly).toBe("subscription_sharing_usage_limit_exceeded");
    expect(target.state.briefRequests).toBe(3);
    expect(report.briefs.at(-1)).toMatchObject({ kind: "failed", validation: "not_reached" });
    expect(report.revoke.ok).toBe(true);
  });

  it("drops reasoning for a model that rejects it and records webview CORS", async () => {
    const target = await mock({ rejectReasoningFor: ["gpt-mock-think"], corsAllowResponses: true });
    const report = await runSpike(options(target, [], { fixtures: ["sparse"] }));
    expect(report.contracts).toEqual({ "gpt-mock-fast": { jsonSchema: true, reasoning: true, tools: true }, "gpt-mock-think": { jsonSchema: true, reasoning: false, tools: true } });
    expect(report.summary.every((row) => row.passRate === 1)).toBe(true);
    expect(report.cors.find((row) => row.target === "responses")?.allowsWebview).toBe(true);
    expect(report.cors.find((row) => row.target === "token_endpoint")?.allowsWebview).toBe(false);
    expect(report.probes.find((probe) => probe.probe === "cors_actual")?.allowOrigin).toBe("tauri://localhost");
  });

  it("stops before sign-in when discovery has no revocation endpoint", async () => {
    const target = await mock({ noRevocationEndpoint: true });
    const report = await runSpike(options(target, [], { fixtures: ["sparse"], maxModels: 1 }));
    expect(report.errors).toEqual([{ stage: "discovery", code: "no_revocation_endpoint" }]);
    expect(target.state.authorizeRequests).toHaveLength(0);
    expect(target.state.tokenGrants).toEqual([]);
    expect(report.revoke.attempted).toBe(false);
  });

  it("stops before sign-in when the discovery request fails", async () => {
    const target = await mock();
    const failing = (async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/openid-configuration")
      ? new Response("unavailable", { status: 503 }) : fetch(url, init)) as typeof fetch;
    const report = await runSpike(options(target, [], { fetchImpl: failing, openBrowser: mockBrowser(failing) }));
    expect(report.errors).toEqual([{ stage: "discovery", code: "http_503" }, { stage: "discovery", code: "not_fetched" }]);
    expect(target.state.authorizeRequests).toHaveLength(0);
  });

  it("stops before sign-in when discovery names another issuer", async () => {
    const target = await mock();
    const report = await runSpike(options(target, [], { endpoints: { ...target.endpoints, issuer: "https://auth.openai.com" } }));
    expect(report.errors).toEqual([{ stage: "discovery", code: "unexpected_issuer" }]);
    expect(target.state.authorizeRequests).toHaveLength(0);
  });

  it("stops a brief promptly on interrupt and still revokes", async () => {
    const target = await mock();
    const controller = new AbortController();
    const interrupting = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/responses") && typeof init?.body === "string" && init.body.includes("cadence_daily_brief")) controller.abort();
      return fetch(url, init);
    }) as typeof fetch;
    const started = Date.now();
    const report = await runSpike(options(target, [], { fetchImpl: interrupting, signal: controller.signal, deadlineMs: 60_000 }));
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(report.briefs).toHaveLength(1);
    expect(report.briefs[0]).toMatchObject({ validation: "not_reached", validationCode: "interrupted" });
    expect(report.errors.at(-1)).toEqual({ stage: "run", code: "AbortError" });
    expect(report.revoke.ok).toBe(true);
    expect(target.state.liveRefreshTokens.size).toBe(0);
  });

  it("removes mock mode's temporary host folder when the run ends", async () => {
    const before = new Set(await readdir(tmpdir()));
    const out = join(configDir, "report");
    const code = await main(["--mock", "--fixtures", "sparse", "--max-models", "1", "--out", out], { startMock: () => startMockOpenAI() });
    expect(code).toBe(0);
    const left = (await readdir(tmpdir())).filter((name) => name.startsWith("cadence-chatgpt-spike-mock-") && !before.has(name));
    expect(left).toEqual([]);
    expect((await stat(`${out}.json`)).mode & 0o777).toBe(0o600);
  });
});

describe("refresh", () => {
  it("keeps the current refresh token when the response has no replacement", async () => {
    const endpoints = (await mock()).endpoints;
    const reply = (async () => new Response(JSON.stringify({ access_token: "access-token-synthetic", expires_in: 3600, scope: "openid" }), { status: 200 })) as unknown as typeof fetch;
    const set = await refreshTokens(reply, endpoints, { clientId: "oaiapp_x", refreshToken: "refresh-token-synthetic" }, new SecretBag(), 0);
    expect(set.refreshToken).toBe("refresh-token-synthetic");
    expect(set.accessToken).toBe("access-token-synthetic");
  });
});
