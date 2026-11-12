/**
 * Ticket 295: local mock of OpenAI's sign-in, token, JWKS, revocation, models and
 * streaming Responses endpoints, for the spike's mock mode and its unit tests.
 * It follows the rules in OpenAI's public docs; it is not OpenAI's behavior.
 * All values are synthetic and generated per run.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SpikeEndpoints } from "./chatgpt-plan-spike";

export type MockOptions = Readonly<{
  /** Omit chatgpt.tokens.use.direct from the granted scopes. */
  withholdPlanScope?: boolean;
  /** Redirect with error=access_denied instead of a code. */
  denyConsent?: boolean;
  /** Corrupt the ID token in one way. */
  idTokenFault?: "signature" | "issuer" | "audience" | "expired" | "nonce";
  /** Return an invalid Daily Brief body on every Nth brief request. */
  invalidBriefEvery?: number;
  /** Fail brief requests after this many with subscription_sharing_usage_limit_exceeded. */
  usageLimitAfter?: number;
  /** Allow tauri://localhost in CORS preflights on /v1/responses. */
  corsAllowResponses?: boolean;
  /** Models that reject `reasoning`. */
  rejectReasoningFor?: readonly string[];
  /** Omit revocation_endpoint from discovery. */
  noRevocationEndpoint?: boolean;
}>;

export type MockState = {
  issuedClientId: string;
  revokedTokens: string[];
  liveRefreshTokens: Set<string>;
  liveAccessTokens: Set<string>;
  authorizeRequests: URLSearchParams[];
  tokenGrants: string[];
  responsesRequests: number;
  briefRequests: number;
  issuedSecrets: string[];
};

export type MockOpenAI = Readonly<{ baseUrl: string; endpoints: SpikeEndpoints; state: MockState; close: () => Promise<void> }>;

export const MOCK_MODELS = [
  { slug: "gpt-mock-fast", display_name: "Mock Fast", visibility: "list", context_window: 128000 },
  { slug: "gpt-mock-think", display_name: "Mock Think", visibility: "list", context_window: 128000 },
  { slug: "gpt-mock-hidden", display_name: "Mock Hidden", visibility: "hide", context_window: 128000 },
] as const;

// `max_output_tokens` is accepted: the live plan route took it on all four tested models (November 12, 2026).
const UNSUPPORTED_FIELDS = ["background", "conversation", "max_tool_calls", "metadata", "moderation", "multi_agent", "prompt",
  "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user", "previous_response_id"];

export async function startMockOpenAI(options: MockOptions = {}): Promise<MockOpenAI> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const kid = `mock-${randomBytes(4).toString("hex")}`;
  const state: MockState = { issuedClientId: `oaiapp_mock${randomBytes(6).toString("hex")}`, revokedTokens: [], liveRefreshTokens: new Set(), liveAccessTokens: new Set(),
    authorizeRequests: [], tokenGrants: [], responsesRequests: 0, briefRequests: 0, issuedSecrets: [] };
  const pending = new Map<string, { challenge: string; nonce: string; redirectUri: string; clientId: string; resource: string }>();
  let baseUrl = "";

  const secret = (prefix: string) => {
    const value = `${prefix}_${randomBytes(24).toString("base64url")}`;
    state.issuedSecrets.push(value);
    return value;
  };

  const idToken = (clientId: string, nonce: string) => {
    const now = Math.floor(Date.now() / 1000);
    const fault = options.idTokenFault;
    const header = { alg: "RS256", typ: "JWT", kid };
    const payload = { iss: fault === "issuer" ? "https://evil.invalid" : baseUrl, aud: fault === "audience" ? "oaiapp_someone_else" : clientId,
      sub: "user-synthetic-0001", email: "spike@example.invalid", iat: now - 5, exp: fault === "expired" ? now - 3600 : now + 3600,
      nonce: fault === "nonce" ? "wrong-nonce" : nonce };
    const encoded = `${b64(header)}.${b64(payload)}`;
    const signature = sign("RSA-SHA256", Buffer.from(encoded), fault === "signature" ? otherKey : privateKey).toString("base64url");
    const token = `${encoded}.${signature}`;
    state.issuedSecrets.push(token);
    return token;
  };

  const issueTokens = (clientId: string, nonce: string | null) => {
    const access = secret("mock_at"), refresh = secret("mock_rt");
    state.liveAccessTokens.add(access); state.liveRefreshTokens.add(refresh);
    const scope = options.withholdPlanScope ? "email offline_access openid profile resource.invoke" : "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke";
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope, ...(nonce !== null ? { id_token: idToken(clientId, nonce) } : {}) };
  };

  const server = createServer(async (request, response) => {
    try { await route(request, response); }
    catch { json(response, 500, { error: { code: "mock_internal", message: "mock failure" } }); }
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", baseUrl);
    response.setHeader("x-request-id", `req_mock_${randomBytes(4).toString("hex")}`);
    if (request.method === "OPTIONS") return preflight(url, request, response);
    if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return json(response, 200, { issuer: baseUrl, authorization_endpoint: `${baseUrl}/api/accounts/authorize`, token_endpoint: `${baseUrl}/api/accounts/oauth/token`,
        jwks_uri: `${baseUrl}/.well-known/jwks.json`, ...(options.noRevocationEndpoint ? {} : { revocation_endpoint: `${baseUrl}/oauth/revoke` }) });
    }
    if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      return json(response, 200, { keys: [{ ...(publicKey as KeyObject).export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] });
    }
    if (request.method === "GET" && url.pathname === "/api/accounts/authorize") return authorize(url, response);
    if (request.method === "POST" && url.pathname === "/api/accounts/oauth/token") return token(new URLSearchParams(await body(request)), response);
    if (request.method === "POST" && url.pathname === "/oauth/revoke") {
      const form = new URLSearchParams(await body(request));
      const value = form.get("token") ?? "";
      if (form.get("token_type_hint") !== "refresh_token" || form.get("client_id") !== state.issuedClientId) return json(response, 400, { error: "invalid_request" });
      state.revokedTokens.push(value);
      state.liveRefreshTokens.delete(value);
      response.writeHead(200).end();
      return;
    }
    const bearer = (request.headers.authorization ?? "").replace(/^Bearer /u, "");
    if (url.pathname.startsWith("/v1/") && !state.liveAccessTokens.has(bearer)) {
      return json(response, 401, { error: { code: "subscription_sharing_invalid_user", message: "Invalid token.", type: "invalid_request_error", param: null } });
    }
    if (request.method === "GET" && url.pathname === "/v1/models") return json(response, 200, { models: MOCK_MODELS });
    if (request.method === "POST" && url.pathname === "/v1/responses") return responses(await body(request), request, response);
    json(response, 404, { detail: "Not Found" });
  }

  function preflight(url: URL, request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin;
    if (url.pathname === "/v1/responses" && options.corsAllowResponses && origin) {
      response.writeHead(204, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type" }).end();
      return;
    }
    response.writeHead(204).end();
  }

  function authorize(url: URL, response: ServerResponse): void {
    state.authorizeRequests.push(url.searchParams);
    const get = (key: string) => url.searchParams.get(key) ?? "";
    const redirectUri = get("redirect_uri");
    const valid = /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/u.test(redirectUri) && get("response_type") === "code" && get("code_challenge_method") === "S256" &&
      get("code_challenge").length === 43 && get("state") && get("nonce") && get("ext_agent_host_id").startsWith("urn:uuid:") &&
      get("scope").split(" ").includes("chatgpt.tokens.use.direct") && get("resource") === "https://api.openai.com/v1" &&
      (get("client_id") === "dynamic_agent_client" ? get("agent_name_hint") === "Cadence" : get("client_id") === state.issuedClientId && !url.searchParams.has("agent_name_hint"));
    if (!valid) return json(response, 400, { error: "invalid_request" });
    const callback = new URL(redirectUri);
    callback.searchParams.set("state", get("state"));
    if (options.denyConsent) {
      callback.searchParams.set("error", "access_denied");
    } else {
      const code = secret("mock_code");
      pending.set(code, { challenge: get("code_challenge"), nonce: get("nonce"), redirectUri, clientId: state.issuedClientId, resource: get("resource") });
      callback.searchParams.set("code", code);
      callback.searchParams.set("scope", "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke");
      if (get("client_id") === "dynamic_agent_client") callback.searchParams.set("client_id", state.issuedClientId);
    }
    response.writeHead(302, { Location: callback.toString() }).end();
  }

  function token(form: URLSearchParams, response: ServerResponse): void {
    const grant = form.get("grant_type") ?? "";
    state.tokenGrants.push(grant);
    if (form.get("client_id") !== state.issuedClientId) return json(response, 401, { error: "invalid_client" });
    if (form.get("resource") !== "https://api.openai.com/v1") return json(response, 400, { error: "invalid_target" });
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const entry = pending.get(code);
      pending.delete(code);
      const verifier = form.get("code_verifier") ?? "";
      if (!entry || entry.redirectUri !== form.get("redirect_uri") || createHash("sha256").update(verifier).digest("base64url") !== entry.challenge) {
        return json(response, 400, { error: "invalid_grant" });
      }
      return json(response, 200, issueTokens(entry.clientId, entry.nonce));
    }
    if (grant === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      if (!state.liveRefreshTokens.has(refresh) || form.has("scope")) return json(response, 400, { error: "invalid_grant" });
      state.liveRefreshTokens.delete(refresh);
      return json(response, 200, issueTokens(state.issuedClientId, null));
    }
    json(response, 400, { error: "unsupported_grant_type" });
  }

  function responses(raw: string, request: IncomingMessage, response: ServerResponse): void {
    state.responsesRequests++;
    const origin = request.headers.origin;
    if (origin && options.corsAllowResponses) response.setHeader("Access-Control-Allow-Origin", origin);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return json(response, 400, { detail: "Invalid JSON" }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(response, 400, { detail: "Invalid body" });
    const req = parsed as Record<string, unknown>;
    const unsupported = (param: string) => json(response, 400, { error: { code: "subscription_sharing_unsupported_capability", param, type: "invalid_request_error",
      message: `Unsupported parameter: ${param}.` } });
    for (const field of UNSUPPORTED_FIELDS) if (field in req) return unsupported(field);
    if (req.stream !== true) return unsupported("stream");
    if (req.store !== false) return unsupported("store");
    if (!Array.isArray(req.input)) return unsupported("input");
    const model = typeof req.model === "string" ? req.model : "";
    if (!MOCK_MODELS.some((item) => item.slug === model)) return unsupported("model");
    if ("reasoning" in req && options.rejectReasoningFor?.includes(model)) return unsupported("reasoning");
    const first = req.input[0] as Record<string, unknown> | undefined;
    const content = typeof first?.content === "string" ? first.content : "";
    const brief = content.startsWith("{");
    if (brief) state.briefRequests++;
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const send = (event: Record<string, unknown>) => response.write(`event: ${event.type as string}\ndata: ${JSON.stringify(event)}\n\n`);
    const id = `resp_mock_${randomBytes(4).toString("hex")}`;
    send({ type: "response.created", response: { id, status: "in_progress" } });
    if (brief && options.usageLimitAfter !== undefined && state.briefRequests > options.usageLimitAfter) {
      send({ type: "response.failed", response: { id, status: "failed", error: { code: "subscription_sharing_usage_limit_exceeded", message: "Usage limit reached." } } });
      response.end();
      return;
    }
    const invalid = brief && options.invalidBriefEvery !== undefined && state.briefRequests % options.invalidBriefEvery === 0;
    const text = !brief ? JSON.stringify({ ok: true }) : invalid ? JSON.stringify({ text: "Missing fields." })
      : JSON.stringify({ text: "Synthetic mock brief for a quiet day.", occurrenceRefs: [], suggestions: [], tip: null });
    const half = Math.ceil(text.length / 2);
    send({ type: "response.output_text.delta", delta: text.slice(0, half) });
    // Split one event across two writes to exercise chunk boundaries.
    const tail = `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: text.slice(half) })}\n\n`;
    response.write(tail.slice(0, 17));
    response.write(tail.slice(17));
    send({ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: Math.ceil(raw.length / 4), output_tokens: Math.ceil(text.length / 4),
      output_tokens_details: { reasoning_tokens: "reasoning" in req ? 12 : 0 } }, output: [
      ...("reasoning" in req ? [{ type: "reasoning", id: "rs_mock", summary: [] }] : []),
      { type: "message", id: "msg_mock", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
    ] } });
    response.end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const endpoints: SpikeEndpoints = {
    issuer: baseUrl, discoveryUrl: `${baseUrl}/.well-known/openid-configuration`, authorizeUrl: `${baseUrl}/api/accounts/authorize`,
    tokenUrl: `${baseUrl}/api/accounts/oauth/token`, jwksUrl: `${baseUrl}/.well-known/jwks.json`, revocationUrl: options.noRevocationEndpoint ? null : `${baseUrl}/oauth/revoke`,
    apiBase: `${baseUrl}/v1`, resource: "https://api.openai.com/v1",
  };
  return { baseUrl, endpoints, state, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
