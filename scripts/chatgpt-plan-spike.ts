/**
 * Ticket 295: dev-only spike of the Daily Brief request on a ChatGPT plan.
 *
 * Written from OpenAI's public "Sign in with ChatGPT" docs for open-source apps
 * (developers.openai.com/siwc/token-sharing-open-source). No DevKit code. Never
 * shipped in the Mac app. Run it through scripts/run-chatgpt-plan-spike.mjs.
 *
 * Secrets rule: access, refresh and ID tokens, the authorization code and the PKCE
 * verifier live only in memory. Every log line and the report pass through a
 * secret scan before they leave the process. Prompt text and model output are
 * never logged or written.
 */
import { spawn } from "node:child_process";
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify as verifySignature, type JsonWebKey } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { BRIEFING_FIXTURE_IDS, briefingFixture, type BriefingFixtureId } from "@/lib/services/briefing-fixtures";
import { activeBriefingConfig } from "@/lib/services/briefing-pipeline";
import { DailyBriefError, generateDailyBrief, type DailyBriefGenerator } from "@/lib/services/daily-brief-consumer";
import { DAILY_BRIEF_MODEL, generateOpenAIDailyBrief } from "@/lib/services/daily-brief-openai";

export const SPIKE_VERSION = "2026-11-07.1";
export const AGENT_NAME_HINT = "Cadence";
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const SPIKE_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const TAURI_ORIGIN = "tauri://localhost";
/** Today's hosted model-call budget inside the Daily Brief attempt (lib/services/daily-brief.service.ts). */
export const HOSTED_MODEL_DEADLINE_MS = 30_000;
export const DEFAULT_FIXTURES: readonly BriefingFixtureId[] = ["sparse", "dense", "hostile", "overlap", "tight_transition", "supported_gap", "uneventful", "travel_day"];

export type SpikeEndpoints = Readonly<{
  issuer: string;
  discoveryUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  revocationUrl: string | null;
  apiBase: string;
  resource: string;
}>;

/** Values from the public docs. Live runs refresh issuer, JWKS and revocation from discovery. */
export const OPENAI_ENDPOINTS: SpikeEndpoints = {
  issuer: "https://auth.openai.com",
  discoveryUrl: "https://auth.openai.com/.well-known/openid-configuration",
  authorizeUrl: "https://auth.openai.com/api/accounts/authorize",
  tokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
  jwksUrl: "https://auth.openai.com/.well-known/jwks.json",
  revocationUrl: null,
  apiBase: "https://api.openai.com/v1",
  resource: "https://api.openai.com/v1",
};

// ---------------------------------------------------------------------------
// Secret handling

/** Holds every secret value seen in this run so output can be checked against them. */
export class SecretBag {
  private readonly values = new Set<string>();
  add(value: string | null | undefined): void {
    if (typeof value === "string" && value.length >= 8) this.values.add(value);
  }
  /** Replaces any secret in `text`; returns the text and whether anything was replaced. */
  scrub(text: string): { text: string; redacted: boolean } {
    let out = text;
    let redacted = false;
    for (const value of this.values) {
      if (out.includes(value)) { out = out.split(value).join("[redacted]"); redacted = true; }
    }
    return { text: out, redacted };
  }
  contains(text: string): boolean {
    for (const value of this.values) if (text.includes(value)) return true;
    return false;
  }
}

export class SpikeStop extends Error {
  constructor(public readonly stage: string, public readonly code: string) {
    super(`${stage}:${code}`);
  }
}

// ---------------------------------------------------------------------------
// PKCE, authorization URL and loopback callback

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export type AuthorizeAttempt = Readonly<{
  clientId: string;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  registering: boolean;
}>;

export function newAttempt(input: Readonly<{ clientId: string | null; hostId: string; redirectUri: string }>): AuthorizeAttempt {
  return { clientId: input.clientId ?? DYNAMIC_CLIENT_ID, hostId: input.hostId, redirectUri: input.redirectUri,
    state: randomToken(), nonce: randomToken(), verifier: randomToken(48), registering: !input.clientId };
}

/** Builds the authorize URL with each value percent-encoded (spaces as %20). */
export function buildAuthorizeUrl(authorizeUrl: string, attempt: AuthorizeAttempt, resource: string): string {
  const params: [string, string][] = [
    ["client_id", attempt.clientId],
    ...(attempt.registering ? [["agent_name_hint", AGENT_NAME_HINT] as [string, string]] : []),
    ["ext_agent_host_id", attempt.hostId],
    ["response_type", "code"],
    ["redirect_uri", attempt.redirectUri],
    ["scope", SPIKE_SCOPES],
    ["resource", resource],
    ["state", attempt.state],
    ["nonce", attempt.nonce],
    ["code_challenge_method", "S256"],
    ["code_challenge", pkceChallenge(attempt.verifier)],
  ];
  return `${authorizeUrl}?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

export type CallbackParams = Readonly<{
  code: string | null; state: string | null; clientId: string | null; scope: string | null; error: string | null;
}>;

export type Loopback = Readonly<{ redirectUri: string; callback: Promise<CallbackParams>; close: () => Promise<void> }>;

/** Listens on 127.0.0.1 with path /auth/callback. Port 0 picks a free port (tests). */
export async function startLoopback(port: number): Promise<Loopback> {
  let resolveCallback: (value: CallbackParams) => void = () => undefined;
  const callback = new Promise<CallbackParams>((resolve) => { resolveCallback = resolve; });
  let settled = false;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== "/auth/callback" || settled) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    settled = true;
    const error = url.searchParams.get("error");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
      .end(`<!doctype html><meta charset="utf-8"><title>Cadence spike</title><p>${error ? "Sign-in did not finish. You can close this tab." : "Signed in. You can close this tab and return to the terminal."}</p>`);
    resolveCallback({ code: url.searchParams.get("code"), state: url.searchParams.get("state"), clientId: url.searchParams.get("client_id"),
      scope: url.searchParams.get("scope"), error });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    redirectUri: `http://127.0.0.1:${actualPort}/auth/callback`,
    callback,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

function sameString(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Validates the callback against the pending attempt and returns the code and the client ID to use. */
export function acceptCallback(params: CallbackParams, attempt: AuthorizeAttempt): { code: string; clientId: string } {
  if (!params.state || !sameString(params.state, attempt.state)) throw new SpikeStop("callback", "state_mismatch");
  if (params.error) throw new SpikeStop("callback", params.error === "access_denied" ? "access_denied" : "oauth_error");
  if (!params.code) throw new SpikeStop("callback", "missing_code");
  if (attempt.registering) {
    if (!params.clientId || params.clientId === DYNAMIC_CLIENT_ID) throw new SpikeStop("callback", "registration_incomplete");
    return { code: params.code, clientId: params.clientId };
  }
  if (params.clientId && params.clientId !== attempt.clientId) throw new SpikeStop("callback", "client_id_mismatch");
  return { code: params.code, clientId: attempt.clientId };
}

// ---------------------------------------------------------------------------
// Token endpoint

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  scope: string | null;
  expiresAt: number;
};

export class OAuthHttpError extends Error {
  constructor(public readonly status: number, public readonly oauthError: string | null) {
    super(`oauth_http_${status}${oauthError ? `_${oauthError}` : ""}`);
  }
}

async function postForm(fetchImpl: typeof fetch, url: string, form: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  return fetchImpl(url, { method: "POST", redirect: "error", cache: "no-store", signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString() });
}

async function readTokenResponse(response: Response, bag: SecretBag, now: number): Promise<TokenSet> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = record(body) && typeof body.error === "string" ? body.error : null;
    throw new OAuthHttpError(response.status, code);
  }
  if (!record(body) || typeof body.access_token !== "string") throw new OAuthHttpError(response.status, "malformed_token_response");
  const set: TokenSet = {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    idToken: typeof body.id_token === "string" ? body.id_token : null,
    scope: typeof body.scope === "string" ? body.scope : null,
    expiresAt: now + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
  };
  bag.add(set.accessToken); bag.add(set.refreshToken); bag.add(set.idToken);
  return set;
}

export async function exchangeCode(fetchImpl: typeof fetch, endpoints: SpikeEndpoints, input: Readonly<{ clientId: string; code: string; verifier: string; redirectUri: string }>,
  bag: SecretBag, now: number): Promise<TokenSet> {
  const response = await postForm(fetchImpl, endpoints.tokenUrl, { grant_type: "authorization_code", client_id: input.clientId, code: input.code,
    code_verifier: input.verifier, redirect_uri: input.redirectUri, resource: endpoints.resource });
  return readTokenResponse(response, bag, now);
}

/** Refresh without `scope`, which keeps the grant. The caller replaces the whole set. */
export async function refreshTokens(fetchImpl: typeof fetch, endpoints: SpikeEndpoints, input: Readonly<{ clientId: string; refreshToken: string }>,
  bag: SecretBag, now: number): Promise<TokenSet> {
  const response = await postForm(fetchImpl, endpoints.tokenUrl, { grant_type: "refresh_token", client_id: input.clientId,
    refresh_token: input.refreshToken, resource: endpoints.resource });
  const set = await readTokenResponse(response, bag, now);
  // Without a replacement, the old refresh token stays valid and must still be revocable.
  return { ...set, refreshToken: set.refreshToken ?? input.refreshToken };
}

export type RevokeResult = { status: number | null; ok: boolean; attempts: number; error: string | null };

/** Empty 200 means revoked, including for an already-invalid token. Retries network errors and 5xx. */
export async function revokeRefreshToken(fetchImpl: typeof fetch, revocationUrl: string, input: Readonly<{ clientId: string; refreshToken: string }>,
  wait: (ms: number) => Promise<void> = sleep): Promise<RevokeResult> {
  let status: number | null = null;
  let error: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await postForm(fetchImpl, revocationUrl, { token: input.refreshToken, token_type_hint: "refresh_token", client_id: input.clientId });
      await response.body?.cancel();
      status = response.status;
      if (response.status === 200) return { status, ok: true, attempts: attempt, error: null };
      if (response.status < 500) return { status, ok: false, attempts: attempt, error: "rejected" };
      error = "server_error";
    } catch (cause) {
      error = cause instanceof Error ? cause.name : "network_error";
    }
    if (attempt < 3) await wait(500 * 2 ** attempt);
  }
  return { status, ok: false, attempts: 3, error };
}

// ---------------------------------------------------------------------------
// ID token validation (RS256 against the JWKS, node:crypto only)

export type Jwks = Readonly<{ keys: readonly (JsonWebKey & { kid?: string; alg?: string; use?: string })[] }>;

export type IdTokenCheck = Readonly<{ jwks: Jwks; issuer: string; clientId: string; nonce: string; nowSeconds: number; skewSeconds?: number }>;

export function verifyIdToken(idToken: string, check: IdTokenCheck): { sub: string } {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new SpikeStop("id_token", "malformed");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonPart(encodedHeader);
  const payload = parseJsonPart(encodedPayload);
  if (header.alg !== "RS256") throw new SpikeStop("id_token", "unexpected_alg");
  const jwk = check.jwks.keys.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
  if (!jwk) throw new SpikeStop("id_token", "unknown_kid");
  const publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
  const valid = verifySignature("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(encodedSignature, "base64url"));
  if (!valid) throw new SpikeStop("id_token", "bad_signature");
  const skew = check.skewSeconds ?? 60;
  if (payload.iss !== check.issuer) throw new SpikeStop("id_token", "wrong_issuer");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(check.clientId)) throw new SpikeStop("id_token", "wrong_audience");
  if (audiences.length > 1 && payload.azp !== check.clientId) throw new SpikeStop("id_token", "wrong_authorized_party");
  if (typeof payload.exp !== "number" || payload.exp <= check.nowSeconds - skew) throw new SpikeStop("id_token", "expired");
  if (typeof payload.iat === "number" && payload.iat > check.nowSeconds + skew) throw new SpikeStop("id_token", "issued_in_future");
  if (typeof payload.nonce !== "string" || !sameString(payload.nonce, check.nonce)) throw new SpikeStop("id_token", "nonce_mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new SpikeStop("id_token", "missing_subject");
  return { sub: payload.sub };
}

function parseJsonPart(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    if (record(value)) return value;
  } catch { /* fall through */ }
  throw new SpikeStop("id_token", "malformed");
}

export function grantedScopes(scope: string | null): string[] {
  return (scope ?? "").split(/\s+/u).filter(Boolean).sort();
}

// ---------------------------------------------------------------------------
// Model catalog

export type CatalogModel = { slug: string; displayName: string | null; visibility: string | null };
export type Catalog = { status: number; requestId: string | null; models: CatalogModel[]; modelKeys: string[]; error: string | null };

export async function listModels(fetchImpl: typeof fetch, endpoints: SpikeEndpoints, accessToken: string): Promise<Catalog> {
  const response = await fetchImpl(`${endpoints.apiBase}/models`, { method: "GET", redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const requestId = response.headers.get("x-request-id");
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { status: response.status, requestId, models: [], modelKeys: [], error: errorFields(body).code ?? "http_error" };
  const rows = record(body) && Array.isArray(body.models) ? body.models : record(body) && Array.isArray(body.data) ? body.data : [];
  const keys = new Set<string>();
  const models: CatalogModel[] = [];
  for (const row of rows) {
    if (!record(row)) continue;
    for (const key of Object.keys(row)) keys.add(key);
    const slug = typeof row.slug === "string" ? row.slug : typeof row.id === "string" ? row.id : null;
    if (!slug) continue;
    models.push({ slug, displayName: typeof row.display_name === "string" ? row.display_name : null,
      visibility: typeof row.visibility === "string" ? row.visibility : null });
  }
  return { status: response.status, requestId, models, modelKeys: [...keys].sort(), error: null };
}

/** Explicit picks win; otherwise listed models in server order, capped, plus today's Daily Brief model when listed. */
export function selectModels(catalog: Catalog, explicit: readonly string[] | null, maxModels: number): string[] {
  if (explicit?.length) return explicit.filter((slug) => catalog.models.some((model) => model.slug === slug));
  const listed = catalog.models.filter((model) => model.visibility === "list" || model.visibility === null).map((model) => model.slug);
  const picked = listed.slice(0, maxModels);
  return listed.includes(DAILY_BRIEF_MODEL) && !picked.includes(DAILY_BRIEF_MODEL) ? [...picked, DAILY_BRIEF_MODEL] : picked;
}

// ---------------------------------------------------------------------------
// Streaming Responses

export type SseEvent = { event: string | null; data: string };

/** Minimal text/event-stream parser that tolerates chunk boundaries anywhere. */
export function createSseParser(onEvent: (event: SseEvent) => void): { push: (chunk: string) => void; end: () => void } {
  let buffer = "";
  let eventName: string | null = null;
  let data: string[] = [];
  const dispatch = () => {
    if (data.length) onEvent({ event: eventName, data: data.join("\n") });
    eventName = null; data = [];
  };
  const line = (raw: string) => {
    if (raw === "") { dispatch(); return; }
    if (raw.startsWith(":")) return;
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    const value = colon === -1 ? "" : raw.slice(colon + 1).replace(/^ /u, "");
    if (field === "event") eventName = value;
    else if (field === "data") data.push(value);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.search(/\r\n|\n|\r/u)) !== -1) {
        // A lone CR at the end may be the first half of a CRLF split across chunks.
        if (buffer[index] === "\r" && index === buffer.length - 1) break;
        const match = buffer.slice(index).startsWith("\r\n") ? 2 : 1;
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + match);
      }
    },
    end() { if (buffer) line(buffer.replace(/\r$/u, "")); buffer = ""; dispatch(); },
  };
}

export type StreamOutcomeKind = "completed" | "failed" | "incomplete" | "error_event" | "http_error" | "stream_interrupted" | "timeout" | "network_error";

export type Usage = { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null };

export type StreamOutcome = {
  kind: StreamOutcomeKind;
  httpStatus: number | null;
  requestId: string | null;
  errorCode: string | null;
  errorParam: string | null;
  errorType: string | null;
  errorDetail: string | null;
  firstByteMs: number | null;
  firstDeltaMs: number | null;
  totalMs: number;
  eventTypes: string[];
  usage: Usage | null;
  allowOrigin: string | null;
  /** In memory only; never logged or written. */
  output: unknown[] | null;
};

export async function streamResponses(fetchImpl: typeof fetch, endpoints: SpikeEndpoints, accessToken: string, body: Record<string, unknown>,
  options: Readonly<{ signal: AbortSignal; origin?: string; clock?: () => number }>): Promise<StreamOutcome> {
  const clock = options.clock ?? (() => performance.now());
  const started = clock();
  const outcome: StreamOutcome = { kind: "stream_interrupted", httpStatus: null, requestId: null, errorCode: null, errorParam: null, errorType: null,
    errorDetail: null, firstByteMs: null, firstDeltaMs: null, totalMs: 0, eventTypes: [], usage: null, allowOrigin: null, output: null };
  const finish = (): StreamOutcome => { outcome.totalMs = Math.round(clock() - started); return outcome; };
  let response: Response;
  try {
    response = await fetchImpl(`${endpoints.apiBase}/responses`, { method: "POST", redirect: "error", cache: "no-store", signal: options.signal,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "text/event-stream",
        ...(options.origin ? { Origin: options.origin } : {}) },
      body: JSON.stringify(body) });
  } catch (cause) {
    outcome.kind = options.signal.aborted ? "timeout" : "network_error";
    outcome.errorDetail = cause instanceof Error ? cause.name : null;
    return finish();
  }
  outcome.httpStatus = response.status;
  outcome.requestId = response.headers.get("x-request-id");
  outcome.allowOrigin = response.headers.get("access-control-allow-origin");
  if (!response.ok) {
    const parsed: unknown = await response.json().catch(() => null);
    Object.assign(outcome, { kind: "http_error" as const, ...errorOutcome(parsed) });
    return finish();
  }
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    // A non-streaming reply means the server accepted the body as sent (for example stream: false).
    const parsed: unknown = await response.json().catch(() => null);
    outcome.firstByteMs = Math.round(clock() - started);
    outcome.eventTypes = ["non_stream_json"];
    if (record(parsed) && parsed.status === "completed") {
      outcome.kind = "completed";
      outcome.output = Array.isArray(parsed.output) ? parsed.output : null;
      outcome.usage = readUsage(parsed.usage);
    } else Object.assign(outcome, { kind: "stream_interrupted" as const, ...errorOutcome(parsed) });
    return finish();
  }
  const seen = new Set<string>();
  let terminal = false;
  const parser = createSseParser(({ data }) => {
    if (data === "[DONE]") return;
    let event: unknown;
    try { event = JSON.parse(data); } catch { return; }
    if (!record(event) || typeof event.type !== "string") return;
    seen.add(event.type);
    if (event.type === "response.output_text.delta" && outcome.firstDeltaMs === null) outcome.firstDeltaMs = Math.round(clock() - started);
    const responseBody = record(event.response) ? event.response : null;
    if (event.type === "response.completed" && responseBody) {
      terminal = true;
      outcome.kind = "completed";
      outcome.output = Array.isArray(responseBody.output) ? responseBody.output : null;
      outcome.usage = readUsage(responseBody.usage);
    } else if (event.type === "response.failed") {
      terminal = true;
      outcome.kind = "failed";
      Object.assign(outcome, errorOutcome(responseBody ? { error: responseBody.error } : null));
      outcome.usage = responseBody ? readUsage(responseBody.usage) : null;
    } else if (event.type === "response.incomplete") {
      terminal = true;
      outcome.kind = "incomplete";
      const details = responseBody && record(responseBody.incomplete_details) ? responseBody.incomplete_details : null;
      outcome.errorDetail = details && typeof details.reason === "string" ? details.reason : null;
    } else if (event.type === "error") {
      terminal = true;
      outcome.kind = "error_event";
      Object.assign(outcome, errorOutcome(record(event.error) ? event : { error: event }));
    }
  });
  const reader = response.body?.getReader();
  if (!reader) return finish();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (outcome.firstByteMs === null) outcome.firstByteMs = Math.round(clock() - started);
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } catch {
    if (!terminal) outcome.kind = options.signal.aborted ? "timeout" : "stream_interrupted";
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  outcome.eventTypes = [...seen].sort();
  if (!terminal && outcome.kind === "completed") outcome.kind = "stream_interrupted";
  return finish();
}

function readUsage(value: unknown): Usage | null {
  if (!record(value)) return null;
  const details = record(value.output_tokens_details) ? value.output_tokens_details : {};
  return { inputTokens: num(value.input_tokens), outputTokens: num(value.output_tokens), reasoningTokens: num(details.reasoning_tokens) };
}

function num(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function errorFields(body: unknown): { code: string | null; param: string | null; type: string | null; detail: string | null } {
  const error = record(body) && record(body.error) ? body.error : null;
  const detail = record(body) && typeof body.detail === "string" ? body.detail
    : error && typeof error.message === "string" ? error.message : null;
  return {
    code: error && typeof error.code === "string" ? error.code : record(body) && typeof body.code === "string" ? body.code : null,
    param: error && typeof error.param === "string" ? error.param : null,
    type: error && typeof error.type === "string" ? error.type : null,
    detail: detail ? detail.slice(0, 200) : null,
  };
}

function errorOutcome(body: unknown): Pick<StreamOutcome, "errorCode" | "errorParam" | "errorType" | "errorDetail"> {
  const fields = errorFields(body);
  return { errorCode: fields.code, errorParam: fields.param, errorType: fields.type, errorDetail: fields.detail };
}

// ---------------------------------------------------------------------------
// Field probes (tiny synthetic prompts)

export type ProbeId = "baseline" | "json_schema_strict" | "reasoning_low" | "tools_none" | "max_output_tokens" | "background_false" | "input_string" | "stream_false" | "cors_actual";

export type Probe = Readonly<{ id: ProbeId; expected: "accept" | "reject" | "observe"; build: (model: string) => Record<string, unknown>; origin?: string }>;

const PROBE_SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };

export function probeBase(model: string): Record<string, unknown> {
  return { model, instructions: "Reply with a JSON object whose ok field is true.", input: [{ role: "user", content: "Synthetic probe. Return {\"ok\": true}." }],
    store: false, stream: true };
}

export const FIELD_PROBES: readonly Probe[] = [
  { id: "baseline", expected: "accept", build: probeBase },
  { id: "json_schema_strict", expected: "observe", build: (model) => ({ ...probeBase(model), text: { format: { type: "json_schema", name: "spike_probe", strict: true, schema: PROBE_SCHEMA } } }) },
  { id: "reasoning_low", expected: "observe", build: (model) => ({ ...probeBase(model), reasoning: { effort: "low" } }) },
  { id: "tools_none", expected: "observe", build: (model) => ({ ...probeBase(model), tools: [], tool_choice: "none" }) },
  // Docs listed it as rejected; the live run on November 12, 2026 accepted it on every model.
  { id: "max_output_tokens", expected: "observe", build: (model) => ({ ...probeBase(model), max_output_tokens: 2_000 }) },
  { id: "background_false", expected: "reject", build: (model) => ({ ...probeBase(model), background: false }) },
  { id: "input_string", expected: "reject", build: (model) => ({ ...probeBase(model), input: "Synthetic probe. Return {\"ok\": true}." }) },
  { id: "stream_false", expected: "reject", build: (model) => ({ ...probeBase(model), stream: false }) },
  { id: "cors_actual", expected: "observe", build: probeBase, origin: TAURI_ORIGIN },
];

export type ProbeResult = {
  model: string; probe: ProbeId; expected: Probe["expected"]; accepted: boolean; kind: StreamOutcomeKind; httpStatus: number | null;
  errorCode: string | null; errorParam: string | null; errorDetail: string | null; totalMs: number; requestId: string | null; allowOrigin: string | null;
};

export type BriefContract = { jsonSchema: boolean; reasoning: boolean; tools: boolean };

export function contractFromProbes(results: readonly ProbeResult[]): BriefContract {
  const accepted = (id: ProbeId) => results.some((result) => result.probe === id && result.accepted);
  return { jsonSchema: accepted("json_schema_strict"), reasoning: accepted("reasoning_low"), tools: accepted("tools_none") };
}

/**
 * Turns today's hosted request body (built by generateOpenAIDailyBrief) into the
 * ChatGPT plan contract: stream, store false, input array, no max_output_tokens or
 * background, the catalog model, and only the optional fields the probes accepted.
 */
export function toPlanRequest(hosted: Record<string, unknown>, model: string, contract: BriefContract): Record<string, unknown> {
  const body: Record<string, unknown> = { ...hosted, model, store: false, stream: true };
  delete body.max_output_tokens;
  delete body.background;
  if (typeof body.input === "string") body.input = [{ role: "user", content: body.input }];
  if (!contract.jsonSchema) delete body.text;
  if (!contract.reasoning) delete body.reasoning;
  if (!contract.tools) { delete body.tools; delete body.tool_choice; }
  return body;
}

// ---------------------------------------------------------------------------
// Daily Brief runs through the existing pipeline with a swapped generator

export type BriefRunResult = {
  model: string; fixture: BriefingFixtureId; repeat: number; kind: StreamOutcomeKind | "not_sent"; httpStatus: number | null;
  errorCode: string | null; errorParam: string | null; validation: "pass" | "fail" | "not_reached"; validationCode: string | null;
  firstByteMs: number | null; firstDeltaMs: number | null; totalMs: number | null; usage: Usage | null; requestId: string | null;
};

/**
 * Wraps the hosted adapter. Its fetch is replaced so the request it builds is
 * rewritten to the plan contract and sent with the ChatGPT access token; the SSE
 * result is folded back into the JSON body the adapter already parses.
 */
export function chatgptPlanGenerator(input: Readonly<{
  fetchImpl: typeof fetch; endpoints: SpikeEndpoints; accessToken: () => Promise<string>; model: string; contract: BriefContract;
  onOutcome: (outcome: StreamOutcome) => void;
}>): DailyBriefGenerator {
  const adapterFetch = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const hosted: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (!record(hosted)) return new Response(null, { status: 500 });
    const body = toPlanRequest(hosted, input.model, input.contract);
    const outcome = await streamResponses(input.fetchImpl, input.endpoints, await input.accessToken(), body, { signal: init?.signal ?? new AbortController().signal });
    input.onOutcome(outcome);
    if (outcome.kind !== "completed") return new Response(null, { status: outcome.httpStatus && outcome.httpStatus >= 400 ? outcome.httpStatus : 502 });
    return new Response(JSON.stringify({ status: "completed", output: outcome.output ?? [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return (request) => generateOpenAIDailyBrief(request, { apiKey: "chatgpt-plan-spike", fetch: adapterFetch });
}

export async function runBriefFixture(fixture: BriefingFixtureId, repeat: number, model: string,
  makeGenerator: (onOutcome: (outcome: StreamOutcome) => void) => DailyBriefGenerator, signal: AbortSignal): Promise<BriefRunResult> {
  const config = activeBriefingConfig();
  const context = briefingFixture(fixture, config);
  let outcome: StreamOutcome | null = null;
  const generate = makeGenerator((value) => { outcome = value; });
  let validation: BriefRunResult["validation"] = "pass";
  let validationCode: string | null = null;
  try {
    await generateDailyBrief(context, { generate, config, signal, now: () => Temporal.Instant.from(context.capturedAt) });
  } catch (error) {
    // The pipeline reports any abort as its own "timeout"; the signal's reason says which it was.
    validationCode = signal.aborted ? (signal.reason instanceof Error && signal.reason.name === "TimeoutError" ? "timeout" : "interrupted")
      : error instanceof DailyBriefError ? error.code : "error";
    validation = (outcome as StreamOutcome | null)?.kind === "completed" ? "fail" : "not_reached";
  }
  const sent = outcome as StreamOutcome | null;
  return {
    model, fixture, repeat, kind: sent?.kind ?? "not_sent", httpStatus: sent?.httpStatus ?? null, errorCode: sent?.errorCode ?? null,
    errorParam: sent?.errorParam ?? null, validation, validationCode, firstByteMs: sent?.firstByteMs ?? null, firstDeltaMs: sent?.firstDeltaMs ?? null,
    totalMs: sent?.totalMs ?? null, usage: sent?.usage ?? null, requestId: sent?.requestId ?? null,
  };
}

export function latencyStats(values: readonly number[]): { count: number; medianMs: number | null; maxMs: number | null } {
  if (!values.length) return { count: 0, medianMs: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: sorted.length, medianMs: Math.round(median), maxMs: sorted[sorted.length - 1] };
}

/** Codes after which this account must not send more plan requests in this run. */
export const STOP_CODES = new Set(["subscription_sharing_usage_limit_exceeded", "subscription_sharing_user_not_eligible", "subscription_sharing_invalid_user",
  "subscription_sharing_route_not_supported", "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context"]);

// ---------------------------------------------------------------------------
// CORS preflight

export type CorsResult = { target: "token_endpoint" | "responses"; url: string; status: number | null; allowOrigin: string | null; allowMethods: string | null;
  allowHeaders: string | null; allowCredentials: string | null; error: string | null };

export async function corsPreflight(fetchImpl: typeof fetch, target: CorsResult["target"], url: string, requestHeaders: string): Promise<CorsResult> {
  try {
    const response = await fetchImpl(url, { method: "OPTIONS", redirect: "manual", cache: "no-store",
      headers: { Origin: TAURI_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": requestHeaders } });
    await response.body?.cancel();
    const header = (name: string) => response.headers.get(name);
    return { target, url, status: response.status, allowOrigin: header("access-control-allow-origin"), allowMethods: header("access-control-allow-methods"),
      allowHeaders: header("access-control-allow-headers"), allowCredentials: header("access-control-allow-credentials"), error: null };
  } catch (cause) {
    return { target, url, status: null, allowOrigin: null, allowMethods: null, allowHeaders: null, allowCredentials: null,
      error: cause instanceof Error ? cause.name : "network_error" };
  }
}

/** A webview request works only when the preflight allows the Tauri origin (or *) and the needed method and headers. */
export function corsAllowsWebview(result: CorsResult, headers: readonly string[]): boolean {
  if (!result.status || result.status >= 400) return false;
  if (result.allowOrigin !== "*" && result.allowOrigin !== TAURI_ORIGIN) return false;
  const methods = (result.allowMethods ?? "").toUpperCase();
  if (methods && methods !== "*" && !methods.split(/\s*,\s*/u).includes("POST")) return false;
  const allowed = (result.allowHeaders ?? "").toLowerCase().split(/\s*,\s*/u).filter(Boolean);
  return allowed.includes("*") || headers.every((name) => allowed.includes(name));
}

// ---------------------------------------------------------------------------
// Host record (outside the repository; contains no tokens)

export type HostRecord = { hostId: string; clientId: string | null };

export function defaultConfigDir(): string {
  return join(homedir(), ".config", "cadence-chatgpt-spike");
}

export async function loadHostRecord(dir: string): Promise<HostRecord & { created: boolean }> {
  try {
    const value: unknown = JSON.parse(await readFile(join(dir, "host.json"), "utf8"));
    if (record(value) && typeof value.hostId === "string" && value.hostId.startsWith("urn:uuid:")) {
      return { hostId: value.hostId, clientId: typeof value.clientId === "string" ? value.clientId : null, created: false };
    }
  } catch { /* create below */ }
  const created: HostRecord = { hostId: `urn:uuid:${randomUUID()}`, clientId: null };
  await saveHostRecord(dir, created);
  return { ...created, created: true };
}

export async function saveHostRecord(dir: string, value: HostRecord): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "host.json");
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

// ---------------------------------------------------------------------------
// Orchestration

export type SpikeOptions = Readonly<{
  mode: "live" | "mock";
  endpoints: SpikeEndpoints;
  useDiscovery: boolean;
  fetchImpl: typeof fetch;
  configDir: string;
  port: number;
  openBrowser: (url: string) => Promise<void>;
  models: readonly string[] | null;
  maxModels: number;
  fixtures: readonly BriefingFixtureId[];
  repeats: number;
  deadlineMs: number;
  callbackTimeoutMs: number;
  signal?: AbortSignal;
  log: (line: string) => void;
}>;

export type SpikeReport = {
  version: string;
  mode: "live" | "mock";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  options: { fixtures: string[]; repeats: number; deadlineMs: number; maxModels: number; explicitModels: string[] | null };
  discovery: { fetched: boolean; issuer: string | null; authorizationEndpoint: string | null; tokenEndpoint: string | null; jwksUri: string | null;
    revocationEndpoint: string | null; matchesDocs: { authorize: boolean | null; token: boolean | null } };
  hostRecord: { created: boolean; hasSavedClientId: boolean };
  signIn: { registration: "new" | "returning" | null; consentMs: number | null; clientIdIssued: boolean; clientIdLooksIssued: boolean | null;
    idToken: { valid: boolean; error: string | null }; tokenScopes: string[]; callbackScopes: string[]; planUsage: boolean;
    refreshTokenIssued: boolean; expiresInSeconds: number | null; error: string | null };
  cors: (CorsResult & { allowsWebview: boolean })[];
  catalog: { status: number | null; requestId: string | null; error: string | null; modelKeys: string[]; models: CatalogModel[];
    dailyBriefModelListed: boolean; selected: string[] };
  probes: ProbeResult[];
  contracts: Record<string, BriefContract>;
  briefs: BriefRunResult[];
  summary: { model: string; contract: BriefContract; runs: number; completed: number; valid: number; passRate: number | null;
    medianMs: number | null; maxMs: number | null; medianFirstDeltaMs: number | null; overHostedDeadline: number; medianInputTokens: number | null;
    medianOutputTokens: number | null }[];
  refresh: { attempted: boolean; ok: boolean; status: number | null; error: string | null; rotated: boolean | null; scopesKept: boolean | null };
  revoke: RevokeResult & { attempted: boolean };
  stoppedEarly: string | null;
  errors: { stage: string; code: string }[];
  redactionTriggered: boolean;
};

export async function runSpike(options: SpikeOptions): Promise<SpikeReport> {
  const bag = new SecretBag();
  const started = Date.now();
  const report: SpikeReport = {
    version: SPIKE_VERSION, mode: options.mode, startedAt: new Date(started).toISOString(), finishedAt: null, durationMs: null,
    options: { fixtures: [...options.fixtures], repeats: options.repeats, deadlineMs: options.deadlineMs, maxModels: options.maxModels, explicitModels: options.models ? [...options.models] : null },
    discovery: { fetched: false, issuer: null, authorizationEndpoint: null, tokenEndpoint: null, jwksUri: null, revocationEndpoint: null, matchesDocs: { authorize: null, token: null } },
    hostRecord: { created: false, hasSavedClientId: false },
    signIn: { registration: null, consentMs: null, clientIdIssued: false, clientIdLooksIssued: null, idToken: { valid: false, error: null }, tokenScopes: [], callbackScopes: [],
      planUsage: false, refreshTokenIssued: false, expiresInSeconds: null, error: null },
    cors: [], catalog: { status: null, requestId: null, error: null, modelKeys: [], models: [], dailyBriefModelListed: false, selected: [] },
    probes: [], contracts: {}, briefs: [], summary: [],
    refresh: { attempted: false, ok: false, status: null, error: null, rotated: null, scopesKept: null },
    revoke: { attempted: false, status: null, ok: false, attempts: 0, error: null },
    stoppedEarly: null, errors: [], redactionTriggered: false,
  };
  const log = (line: string) => {
    const scrubbed = bag.scrub(line);
    if (scrubbed.redacted) report.redactionTriggered = true;
    options.log(scrubbed.text);
  };
  const fail = (stage: string, error: unknown) => {
    const code = error instanceof SpikeStop ? error.code : error instanceof OAuthHttpError ? error.message : error instanceof Error ? error.name : "unknown";
    report.errors.push({ stage, code });
    log(`! ${stage}: ${code}`);
  };
  let endpoints = options.endpoints;
  let tokens: TokenSet | null = null;
  let clientId: string | null = null;

  try {
    log("1/8 CORS preflights with Origin tauri://localhost");
    for (const [target, url, headers] of [["token_endpoint", endpoints.tokenUrl, "content-type"], ["responses", `${endpoints.apiBase}/responses`, "authorization,content-type"]] as const) {
      const result = await corsPreflight(options.fetchImpl, target, url, headers);
      report.cors.push({ ...result, allowsWebview: corsAllowsWebview(result, headers.split(",")) });
    }

    if (options.useDiscovery) {
      log("2/8 OpenID discovery");
      try {
        const response = await options.fetchImpl(endpoints.discoveryUrl, { redirect: "error", cache: "no-store" });
        const doc: unknown = await response.json().catch(() => null);
        if (!response.ok || !record(doc)) report.errors.push({ stage: "discovery", code: `http_${response.status}` });
        else {
          const text = (key: string) => typeof doc[key] === "string" ? doc[key] as string : null;
          report.discovery = { fetched: true, issuer: text("issuer"), authorizationEndpoint: text("authorization_endpoint"), tokenEndpoint: text("token_endpoint"),
            jwksUri: text("jwks_uri"), revocationEndpoint: text("revocation_endpoint"), matchesDocs: {
              authorize: text("authorization_endpoint") ? text("authorization_endpoint") === endpoints.authorizeUrl : null,
              token: text("token_endpoint") ? text("token_endpoint") === endpoints.tokenUrl : null } };
          endpoints = { ...endpoints, jwksUrl: text("jwks_uri") ?? endpoints.jwksUrl,
            revocationUrl: text("revocation_endpoint") ?? endpoints.revocationUrl };
        }
      } catch (error) { fail("discovery", error); }
    }
    assertTrustedEndpoints(report.discovery, endpoints, options.useDiscovery);

    const host = await loadHostRecord(options.configDir);
    report.hostRecord = { created: host.created, hasSavedClientId: !!host.clientId };

    log("3/8 Sign in with ChatGPT (system browser)");
    const loopback = await startLoopback(options.port);
    const attempt = newAttempt({ clientId: host.clientId, hostId: host.hostId, redirectUri: loopback.redirectUri });
    bag.add(attempt.verifier);
    report.signIn.registration = attempt.registering ? "new" : "returning";
    let callback: CallbackParams;
    const consentStarted = Date.now();
    try {
      await options.openBrowser(buildAuthorizeUrl(endpoints.authorizeUrl, attempt, endpoints.resource));
      callback = await raceTimeout(loopback.callback, options.callbackTimeoutMs, options.signal, "callback_timeout");
    } finally {
      await loopback.close();
    }
    report.signIn.consentMs = Date.now() - consentStarted;
    bag.add(callback.code);
    report.signIn.callbackScopes = grantedScopes(callback.scope);
    const accepted = acceptCallback(callback, attempt);
    clientId = accepted.clientId;
    report.signIn.clientIdIssued = attempt.registering;
    report.signIn.clientIdLooksIssued = /^oaiapp_/u.test(clientId);
    tokens = await exchangeCode(options.fetchImpl, endpoints, { clientId, code: accepted.code, verifier: attempt.verifier, redirectUri: loopback.redirectUri }, bag, Date.now());
    report.signIn.refreshTokenIssued = !!tokens.refreshToken;
    report.signIn.expiresInSeconds = Math.round((tokens.expiresAt - Date.now()) / 1000);
    report.signIn.tokenScopes = grantedScopes(tokens.scope);
    if (attempt.registering) {
      await saveHostRecord(options.configDir, { hostId: host.hostId, clientId });
    }

    log("4/8 Validate the ID token against the JWKS");
    try {
      if (!tokens.idToken) throw new SpikeStop("id_token", "missing");
      const jwksResponse = await options.fetchImpl(endpoints.jwksUrl, { redirect: "error", cache: "no-store" });
      const jwks: unknown = await jwksResponse.json();
      if (!record(jwks) || !Array.isArray(jwks.keys)) throw new SpikeStop("id_token", "jwks_unavailable");
      verifyIdToken(tokens.idToken, { jwks: jwks as Jwks, issuer: endpoints.issuer, clientId, nonce: attempt.nonce, nowSeconds: Math.floor(Date.now() / 1000) });
      report.signIn.idToken = { valid: true, error: null };
    } catch (error) {
      report.signIn.idToken = { valid: false, error: error instanceof SpikeStop ? error.code : "error" };
      throw error;
    }
    report.signIn.planUsage = report.signIn.tokenScopes.includes(PLAN_SCOPE);
    if (!report.signIn.planUsage) throw new SpikeStop("scopes", "plan_scope_missing");

    let session: TokenSet = tokens;
    const accessToken = async (): Promise<string> => {
      if (session.refreshToken && Date.now() > session.expiresAt - 5 * 60_000) {
        session = await refreshTokens(options.fetchImpl, endpoints, { clientId: clientId as string, refreshToken: session.refreshToken }, bag, Date.now());
        tokens = session;
      }
      return session.accessToken;
    };

    log("5/8 Read the model catalog");
    const catalog = await listModels(options.fetchImpl, endpoints, await accessToken());
    const selected = selectModels(catalog, options.models, options.maxModels);
    report.catalog = { status: catalog.status, requestId: catalog.requestId, error: catalog.error, modelKeys: catalog.modelKeys, models: catalog.models,
      dailyBriefModelListed: catalog.models.some((model) => model.slug === DAILY_BRIEF_MODEL), selected };
    log(`  ${catalog.models.length} models listed; testing ${selected.length}`);

    log("6/8 Field probes and Daily Brief runs");
    modelLoop: for (const model of selected) {
      for (const probe of FIELD_PROBES) {
        options.signal?.throwIfAborted();
        const outcome = await streamResponses(options.fetchImpl, endpoints, await accessToken(), probe.build(model),
          { signal: anySignal(options.signal, AbortSignal.timeout(options.deadlineMs)), origin: probe.origin });
        report.probes.push({ model, probe: probe.id, expected: probe.expected, accepted: outcome.kind === "completed", kind: outcome.kind, httpStatus: outcome.httpStatus,
          errorCode: outcome.errorCode, errorParam: outcome.errorParam, errorDetail: outcome.errorDetail, totalMs: outcome.totalMs, requestId: outcome.requestId,
          allowOrigin: outcome.allowOrigin });
        log(`  ${model} probe ${probe.id}: ${outcome.kind}${outcome.errorCode ? ` ${outcome.errorCode}` : ""}${outcome.errorParam ? ` (${outcome.errorParam})` : ""}`);
        if (outcome.errorCode && STOP_CODES.has(outcome.errorCode)) { report.stoppedEarly = outcome.errorCode; break modelLoop; }
      }
      const contract = contractFromProbes(report.probes.filter((probe) => probe.model === model));
      report.contracts[model] = contract;
      if (!report.probes.some((probe) => probe.model === model && probe.probe === "baseline" && probe.accepted)) continue;
      for (let repeat = 1; repeat <= options.repeats; repeat++) {
        for (const fixture of options.fixtures) {
          options.signal?.throwIfAborted();
          const result = await runBriefFixture(fixture, repeat, model, (onOutcome) => chatgptPlanGenerator({ fetchImpl: options.fetchImpl, endpoints, accessToken, model, contract, onOutcome }),
            anySignal(options.signal, AbortSignal.timeout(options.deadlineMs)));
          report.briefs.push(result);
          log(`  ${model} ${fixture}#${repeat}: ${result.kind} ${result.validation}${result.validationCode ? ` ${result.validationCode}` : ""}${result.totalMs !== null ? ` ${result.totalMs} ms` : ""}`);
          if (result.errorCode && STOP_CODES.has(result.errorCode)) { report.stoppedEarly = result.errorCode; break modelLoop; }
        }
      }
    }
    report.summary = summarize(report);

    log("7/8 Refresh the token set once");
    if (session.refreshToken) {
      report.refresh.attempted = true;
      const before = session.refreshToken;
      try {
        session = await refreshTokens(options.fetchImpl, endpoints, { clientId, refreshToken: before }, bag, Date.now());
        tokens = session;
        report.refresh = { attempted: true, ok: true, status: 200, error: null, rotated: !!session.refreshToken && session.refreshToken !== before,
          scopesKept: grantedScopes(session.scope).includes(PLAN_SCOPE) || session.scope === null };
      } catch (error) {
        report.refresh = { attempted: true, ok: false, status: error instanceof OAuthHttpError ? error.status : null,
          error: error instanceof OAuthHttpError ? error.oauthError : error instanceof Error ? error.name : "error", rotated: null, scopesKept: null };
      }
    }
  } catch (error) {
    const stage = error instanceof SpikeStop ? error.stage : "run";
    fail(stage, error);
    if (error instanceof SpikeStop && stage === "callback") report.signIn.error = error.code;
    if (!report.summary.length && report.briefs.length) report.summary = summarize(report);
  } finally {
    log("8/8 Revoke the refresh token");
    const current = tokens as TokenSet | null;
    if (current?.refreshToken && clientId && endpoints.revocationUrl) {
      report.revoke = { attempted: true, ...await revokeRefreshToken(options.fetchImpl, endpoints.revocationUrl, { clientId, refreshToken: current.refreshToken }) };
    } else if (current?.refreshToken) {
      report.revoke = { attempted: false, status: null, ok: false, attempts: 0, error: "no_revocation_endpoint" };
    }
    tokens = null;
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - started;
  }
  const serialized = JSON.stringify(report);
  if (bag.contains(serialized)) throw new Error("secret_in_report");
  return report;
}

/**
 * Stops before sign-in unless discovery came from the expected issuer, the JWKS is on
 * that origin, and a revocation endpoint exists, so a token is never issued that the
 * run cannot revoke.
 */
export function assertTrustedEndpoints(discovery: SpikeReport["discovery"], endpoints: SpikeEndpoints, useDiscovery: boolean): void {
  if (useDiscovery) {
    if (!discovery.fetched) throw new SpikeStop("discovery", "not_fetched");
    if (discovery.issuer !== endpoints.issuer) throw new SpikeStop("discovery", "unexpected_issuer");
    const origin = new URL(endpoints.issuer).origin;
    if (!discovery.jwksUri || new URL(discovery.jwksUri).origin !== origin) throw new SpikeStop("discovery", "jwks_off_issuer_origin");
    if (discovery.revocationEndpoint && new URL(discovery.revocationEndpoint).origin !== origin) throw new SpikeStop("discovery", "revocation_off_issuer_origin");
  }
  if (!endpoints.revocationUrl) throw new SpikeStop("discovery", "no_revocation_endpoint");
}

export function summarize(report: Pick<SpikeReport, "briefs" | "contracts">): SpikeReport["summary"] {
  const models = [...new Set(report.briefs.map((brief) => brief.model))];
  return models.map((model) => {
    const runs = report.briefs.filter((brief) => brief.model === model);
    const completed = runs.filter((brief) => brief.kind === "completed");
    const latencies = completed.map((brief) => brief.totalMs ?? 0);
    const stats = latencyStats(latencies);
    const median = (values: (number | null)[]) => latencyStats(values.filter((value): value is number => value !== null)).medianMs;
    return {
      model, contract: report.contracts[model] ?? { jsonSchema: false, reasoning: false, tools: false }, runs: runs.length, completed: completed.length,
      valid: runs.filter((brief) => brief.validation === "pass").length,
      passRate: runs.length ? Math.round((runs.filter((brief) => brief.validation === "pass").length / runs.length) * 1000) / 1000 : null,
      medianMs: stats.medianMs, maxMs: stats.maxMs, medianFirstDeltaMs: median(completed.map((brief) => brief.firstDeltaMs)),
      overHostedDeadline: latencies.filter((value) => value > HOSTED_MODEL_DEADLINE_MS).length,
      medianInputTokens: median(completed.map((brief) => brief.usage?.inputTokens ?? null)),
      medianOutputTokens: median(completed.map((brief) => brief.usage?.outputTokens ?? null)),
    };
  });
}

/** Markdown tables for docs/qa/2026-11-07-chatgpt-plan-spike.md. Contains no secrets, prompts or output. */
export function renderMarkdown(report: SpikeReport): string {
  const cell = (value: unknown) => value === null || value === undefined ? "—" : String(value).replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
  const yes = (value: boolean | null) => value === null ? "—" : value ? "yes" : "no";
  const lines: string[] = [];
  lines.push(`Run: ${report.mode}, ${report.startedAt}, ${report.durationMs ?? "—"} ms, spike ${report.version}.`, "");
  lines.push("### Sign-in", "", "| Check | Result |", "| --- | --- |",
    `| Registration | ${cell(report.signIn.registration)} |`, `| Issued client ID returned (oaiapp_ form) | ${yes(report.signIn.clientIdIssued)} (${yes(report.signIn.clientIdLooksIssued)}) |`,
    `| ID token valid (signature, issuer, audience, nonce, expiry) | ${yes(report.signIn.idToken.valid)}${report.signIn.idToken.error ? ` (${report.signIn.idToken.error})` : ""} |`,
    `| Token scopes | ${cell(report.signIn.tokenScopes.join(" "))} |`, `| Callback scopes | ${cell(report.signIn.callbackScopes.join(" "))} |`,
    `| chatgpt.tokens.use.direct granted | ${yes(report.signIn.planUsage)} |`, `| Refresh token issued | ${yes(report.signIn.refreshTokenIssued)} |`,
    `| Access token lifetime (s) | ${cell(report.signIn.expiresInSeconds)} |`, `| Discovery authorize / token match docs | ${yes(report.discovery.matchesDocs.authorize)} / ${yes(report.discovery.matchesDocs.token)} |`,
    `| Revocation endpoint | ${cell(report.discovery.revocationEndpoint)} |`, "");
  lines.push("### CORS preflight (Origin tauri://localhost)", "", "| Target | Status | Allow-Origin | Allow-Methods | Allow-Headers | Webview can call |", "| --- | --- | --- | --- | --- | --- |",
    ...report.cors.map((row) => `| ${row.target} | ${cell(row.status ?? row.error)} | ${cell(row.allowOrigin)} | ${cell(row.allowMethods)} | ${cell(row.allowHeaders)} | ${yes(row.allowsWebview)} |`), "");
  lines.push("### Model catalog", "", `Status ${cell(report.catalog.status)}; model fields: ${cell(report.catalog.modelKeys.join(", "))}; ${DAILY_BRIEF_MODEL} listed: ${yes(report.catalog.dailyBriefModelListed)}.`, "",
    "| Slug | Display name | Visibility | Tested |", "| --- | --- | --- | --- |",
    ...report.catalog.models.map((model) => `| ${cell(model.slug)} | ${cell(model.displayName)} | ${cell(model.visibility)} | ${yes(report.catalog.selected.includes(model.slug))} |`), "");
  lines.push("### Request fields", "", "| Model | Probe | Expected | Accepted | HTTP | Error code | Param | ms |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.probes.map((row) => `| ${cell(row.model)} | ${row.probe} | ${row.expected} | ${yes(row.accepted)} | ${cell(row.httpStatus)} | ${cell(row.errorCode)} | ${cell(row.errorParam)} | ${row.totalMs} |`), "");
  lines.push("### Daily Brief per model", "", "| Model | json_schema | reasoning | tools | Runs | Completed | Valid | Pass rate | Median ms | Max ms | Median first text ms | Over 30 s | Median input tokens | Median output tokens |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.summary.map((row) => `| ${cell(row.model)} | ${yes(row.contract.jsonSchema)} | ${yes(row.contract.reasoning)} | ${yes(row.contract.tools)} | ${row.runs} | ${row.completed} | ${row.valid} | ${cell(row.passRate)} | ${cell(row.medianMs)} | ${cell(row.maxMs)} | ${cell(row.medianFirstDeltaMs)} | ${row.overHostedDeadline} | ${cell(row.medianInputTokens)} | ${cell(row.medianOutputTokens)} |`), "");
  const failures = report.briefs.filter((row) => row.validation !== "pass");
  lines.push("### Daily Brief failures", "", "| Model | Fixture | Run | Transport | HTTP | Error code | Validation code |", "| --- | --- | --- | --- | --- | --- | --- |",
    ...(failures.length ? failures.map((row) => `| ${cell(row.model)} | ${row.fixture} | ${row.repeat} | ${row.kind} | ${cell(row.httpStatus)} | ${cell(row.errorCode)} | ${cell(row.validationCode)} |`) : ["| — | — | — | — | — | — | — |"]), "");
  lines.push("### Refresh and revocation", "", "| Step | Attempted | OK | HTTP | Detail |", "| --- | --- | --- | --- | --- |",
    `| Refresh | ${yes(report.refresh.attempted)} | ${yes(report.refresh.ok)} | ${cell(report.refresh.status)} | rotated ${yes(report.refresh.rotated)}, plan scope kept ${yes(report.refresh.scopesKept)}${report.refresh.error ? `, ${report.refresh.error}` : ""} |`,
    `| Revoke refresh token | ${yes(report.revoke.attempted)} | ${yes(report.revoke.ok)} | ${cell(report.revoke.status)} | attempts ${report.revoke.attempts}${report.revoke.error ? `, ${report.revoke.error}` : ""} |`, "");
  if (report.stoppedEarly || report.errors.length) {
    lines.push("### Stops and errors", "", ...(report.stoppedEarly ? [`- Stopped early: ${report.stoppedEarly}`] : []), ...report.errors.map((error) => `- ${error.stage}: ${error.code}`), "");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI

export type CliArgs = { mode: "live" | "mock" | null; models: string[] | null; maxModels: number; fixtures: BriefingFixtureId[]; repeats: number; deadlineMs: number;
  port: number; out: string; configDir: string; noBrowser: boolean };

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { mode: null, models: null, maxModels: 3, fixtures: [...DEFAULT_FIXTURES], repeats: 1, deadlineMs: 120_000, port: 1455,
    out: join("/tmp", `cadence-chatgpt-plan-spike-${new Date().toISOString().replace(/[:.]/gu, "-")}`), configDir: defaultConfigDir(), noBrowser: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const next = () => { const value = argv[++index]; if (value === undefined) throw new Error(`missing value for ${flag}`); return value; };
    if (flag === "--live") args.mode = "live";
    else if (flag === "--mock") args.mode = "mock";
    else if (flag === "--models") args.models = next().split(",").map((value) => value.trim()).filter(Boolean);
    else if (flag === "--max-models") args.maxModels = positiveInt(next(), flag);
    else if (flag === "--fixtures") {
      const value = next();
      const ids = value === "all" ? [...BRIEFING_FIXTURE_IDS] : value.split(",").map((item) => item.trim());
      for (const id of ids) if (!(BRIEFING_FIXTURE_IDS as readonly string[]).includes(id)) throw new Error(`unknown fixture ${id}`);
      args.fixtures = ids as BriefingFixtureId[];
    } else if (flag === "--repeats") args.repeats = positiveInt(next(), flag);
    else if (flag === "--deadline-ms") args.deadlineMs = positiveInt(next(), flag);
    else if (flag === "--port") args.port = Number.parseInt(next(), 10);
    else if (flag === "--out") args.out = next();
    else if (flag === "--config-dir") args.configDir = next();
    else if (flag === "--no-browser") args.noBrowser = true;
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} needs a positive integer`);
  return parsed;
}

export const USAGE = `Usage: node scripts/run-chatgpt-plan-spike.mjs --mock | --live [options]
  --mock               Run against a local mock of OpenAI's endpoints (no network, no sign-in).
  --live               Sign in with a real ChatGPT account in the system browser.
  --models a,b         Test these catalog slugs (default: first listed models).
  --max-models N       Cap automatic model selection (default 3).
  --fixtures ids|all   Briefing fixtures (default: ${DEFAULT_FIXTURES.join(",")}).
  --repeats N          Runs per fixture and model (default 1).
  --deadline-ms N      Per-call measurement deadline (default 120000).
  --port N             Loopback callback port on 127.0.0.1 (default 1455).
  --out PATH           Report path prefix; writes PATH.json and PATH.md (default under /tmp).
  --config-dir PATH    Host record directory (default ~/.config/cadence-chatgpt-spike).
  --no-browser         Print the sign-in URL instead of opening the browser.`;

export function openSystemBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("open", [url], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`open exited ${code}`)));
  });
}

/** Mock mode: follow the mock authorize redirect as if the owner approved consent. */
export function mockBrowser(fetchImpl: typeof fetch): (url: string) => Promise<void> {
  return async (url: string) => {
    const authorize = await fetchImpl(url, { redirect: "manual" });
    await authorize.body?.cancel();
    const location = authorize.headers.get("location");
    if (!location) throw new SpikeStop("mock_browser", `authorize_${authorize.status}`);
    const callback = await fetchImpl(location, { redirect: "manual" });
    await callback.body?.cancel();
  };
}

export async function main(argv: readonly string[], deps: Readonly<{ startMock?: () => Promise<{ endpoints: SpikeEndpoints; close: () => Promise<void> }> }> = {}): Promise<number> {
  let args: CliArgs;
  try { args = parseArgs(argv); } catch (error) { console.error(`${error instanceof Error ? error.message : "bad arguments"}\n${USAGE}`); return 2; }
  if (!args.mode) { console.error(USAGE); return 2; }
  const controller = new AbortController();
  const onSigint = () => {
    if (controller.signal.aborted) { console.error("Still revoking the refresh token; please wait."); return; }
    console.error("Interrupted; revoking before exit.");
    controller.abort();
  };
  // Stays installed until revocation has finished, so a second Ctrl-C cannot skip it.
  process.on("SIGINT", onSigint);
  const mockConfigDir = join(tmpdir(), `cadence-chatgpt-spike-mock-${process.pid}`);
  const mock = args.mode === "mock" ? await (deps.startMock ?? (() => Promise.reject(new Error("mock_unavailable"))))() : null;
  try {
    const endpoints = mock?.endpoints ?? OPENAI_ENDPOINTS;
    const report = await runSpike({
      mode: args.mode, endpoints, useDiscovery: true, fetchImpl: fetch, configDir: args.mode === "mock" ? mockConfigDir : args.configDir,
      port: args.mode === "mock" ? 0 : args.port,
      openBrowser: args.mode === "mock" ? mockBrowser(fetch) : args.noBrowser ? async (url) => { console.log(`Open this URL to sign in:\n${url}`); } : async (url) => {
        console.log("Opening the system browser for ChatGPT sign-in. Waiting up to 10 minutes.");
        try { await openSystemBrowser(url); } catch { console.log(`Could not open the browser. Open this URL:\n${url}`); }
      },
      models: args.models, maxModels: args.maxModels, fixtures: args.fixtures, repeats: args.repeats, deadlineMs: args.deadlineMs,
      callbackTimeoutMs: 10 * 60_000, signal: controller.signal, log: (line) => console.log(line),
    });
    const markdown = renderMarkdown(report);
    await writeFile(`${args.out}.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await writeFile(`${args.out}.md`, `${markdown}\n`, { mode: 0o600 });
    console.log(`\n${markdown}\nReport written to ${args.out}.json and ${args.out}.md`);
    return report.errors.length || report.stoppedEarly ? 1 : 0;
  } finally {
    process.removeListener("SIGINT", onSigint);
    await mock?.close();
    if (mock) await rm(mockConfigDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function anySignal(...signals: (AbortSignal | undefined)[]): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => !!signal));
}

function raceTimeout<T>(work: Promise<T>, ms: number, signal: AbortSignal | undefined, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SpikeStop("callback", code)), ms);
    const abort = () => { clearTimeout(timer); reject(new SpikeStop("callback", "interrupted")); };
    signal?.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => { clearTimeout(timer); signal?.removeEventListener("abort", abort); });
  });
}
