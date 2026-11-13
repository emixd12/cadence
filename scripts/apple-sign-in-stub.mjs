#!/usr/bin/env node
// Ticket 333: a stand-in for Apple in front of loopback Supabase, for
// tests/apple-sign-in.local-integration.test.ts.
//
// Supabase Auth's Apple provider always calls appleid.apple.com (its URL
// setting is ignored), so Apple cannot be swapped out behind Auth. This server
// sits where the web app expects Supabase and forwards every request, except:
//   GET  /auth/v1/authorize?provider=...  plays Apple and Auth: back to
//        redirect_to with a stub code, or with Auth's error for a missing email.
//   POST /auth/v1/token?grant_type=pkce   for a stub code: makes or reuses the
//        scenario's user with an Apple (or Google) identity, signs it in with a
//        real local session and adds provider_token and provider_refresh_token,
//        as Auth does after Apple's token exchange.
//   POST /auth/revoke                     plays Apple's revoke endpoint.
//   POST /__stub/next, GET /__stub/revocations, POST /__stub/revoke-status
//        test controls.
// Loopback only. Never point it at a hosted project.
//
// Env: APPLE_STUB_PORT (default 55390), CADENCE_LOCAL_SUPABASE_URL,
// CADENCE_LOCAL_SUPABASE_SERVICE_KEY, CADENCE_LOCAL_SUPABASE_DB_CONTAINER.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.APPLE_STUB_PORT ?? 55390);
const upstream = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const dbContainer =
  process.env.CADENCE_LOCAL_SUPABASE_DB_CONTAINER ?? "supabase_db_habit-tracking-app";

if (!upstream || !serviceKey) {
  console.error("Set CADENCE_LOCAL_SUPABASE_URL and CADENCE_LOCAL_SUPABASE_SERVICE_KEY.");
  process.exit(2);
}
if (!["127.0.0.1", "localhost"].includes(new URL(upstream).hostname)) {
  console.error("The Apple stub runs only in front of loopback Supabase.");
  process.exit(2);
}
// Requests forward to this fixed origin; only the path and query come from the request.
const upstreamPort = Number(new URL(upstream).port || 80);
const FORWARD_PREFIXES = ["/auth/v1/", "/rest/v1/", "/storage/v1/", "/functions/v1/"];

/** @type {null | Record<string, any>} */
let nextScenario = null;
const codes = new Map();
const revocations = [];
let revokeStatus = 200;

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(statement) {
  return execFileSync("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-tAc", statement], {
    encoding: "utf8",
  }).trim();
}

async function admin(path, init = {}) {
  const response = await fetch(`${upstream}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Auth ${path} returned ${response.status}`);
  return body;
}

async function sessionFor(scenario) {
  let userId = sql(`select id from auth.users where lower(email) = lower(${literal(scenario.email)})`);
  if (!userId) {
    const created = await admin("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: scenario.email,
        email_confirm: true,
        user_metadata: scenario.name ? { full_name: scenario.name } : {},
      }),
    });
    userId = created.id;
  }

  const provider = scenario.provider ?? "apple";
  const identityData = {
    sub: scenario.subject,
    email: scenario.email,
    email_verified: true,
    ...(scenario.name ? { full_name: scenario.name } : {}),
  };
  sql(`insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (${literal(scenario.subject)}, ${literal(userId)}, ${literal(JSON.stringify(identityData))}::jsonb,
               ${literal(provider)}, now(), now(), now())
       on conflict (provider_id, provider) do update set last_sign_in_at = now(), updated_at = now()`);

  const link = await admin("/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email: scenario.email }),
  });
  const verified = await fetch(`${upstream}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: serviceKey, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token ?? link.properties?.hashed_token }),
  });
  if (!verified.ok) throw new Error(`verify returned ${verified.status}`);
  const session = await verified.json();

  // A real Apple account has no email identity; this sign-in's identity is the newest.
  if (!scenario.keepEmailIdentity) {
    sql(`delete from auth.identities where user_id = ${literal(userId)} and provider = 'email'`);
  }
  sql(`update auth.identities set last_sign_in_at = now() + interval '1 second'
       where user_id = ${literal(userId)} and provider = ${literal(provider)}`);

  const user = await admin(`/admin/users/${userId}`);
  return {
    ...session,
    user,
    provider_token: `stub-apple-access-${randomUUID()}`,
    provider_refresh_token: scenario.refreshToken,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function send(response, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(text);
}

async function forward(request, response, body) {
  // Forwards only to loopback Supabase, and only under a fixed list of API prefixes.
  const incoming = new URL(request.url, "http://stub.invalid");
  const prefix = FORWARD_PREFIXES.find((item) => incoming.pathname.startsWith(item));
  if (!prefix) return send(response, 404, { error: "not_forwarded" });
  const url = new URL(`http://127.0.0.1:${upstreamPort}${prefix}`);
  url.pathname += incoming.pathname.slice(prefix.length);
  url.search = incoming.search;
  const headers = { ...request.headers };
  delete headers.host;
  delete headers.connection;
  const result = await fetch(url, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : body,
    redirect: "manual",
  });
  const outHeaders = {};
  result.headers.forEach((value, key) => {
    if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)) {
      outHeaders[key] = value;
    }
  });
  response.writeHead(result.status, outHeaders);
  response.end(Buffer.from(await result.arrayBuffer()));
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const body = await readBody(request);

    if (url.pathname === "/__stub/next" && request.method === "POST") {
      nextScenario = JSON.parse(body.toString("utf8"));
      return send(response, 200, { ok: true });
    }
    if (url.pathname === "/__stub/revocations") {
      return send(response, 200, revocations);
    }
    if (url.pathname === "/__stub/revoke-status" && request.method === "POST") {
      revokeStatus = JSON.parse(body.toString("utf8")).status;
      return send(response, 200, { ok: true });
    }
    if (url.pathname === "/auth/revoke" && request.method === "POST") {
      revocations.push(Object.fromEntries(new URLSearchParams(body.toString("utf8"))));
      return revokeStatus === 200
        ? send(response, 200, "")
        : send(response, revokeStatus, { error: "invalid_client" });
    }

    if (url.pathname === "/auth/v1/authorize" && request.method === "GET") {
      const redirectTo = new URL(url.searchParams.get("redirect_to"));
      const scenario = nextScenario;
      nextScenario = null;
      if (!scenario) return send(response, 409, { error: "no stub scenario" });
      if (scenario.kind === "error") {
        redirectTo.searchParams.set("error", "server_error");
        redirectTo.searchParams.set("error_code", "unexpected_failure");
        redirectTo.searchParams.set("error_description", scenario.errorDescription);
      } else {
        const code = `stub-${randomUUID()}`;
        codes.set(code, scenario);
        redirectTo.searchParams.set("code", code);
      }
      response.writeHead(302, { location: redirectTo.toString() });
      return response.end();
    }

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      const { auth_code: code } = JSON.parse(body.toString("utf8"));
      const scenario = codes.get(code);
      if (scenario) {
        codes.delete(code);
        return send(response, 200, await sessionFor(scenario));
      }
    }

    return await forward(request, response, body);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "stub failure");
    return send(response, 500, { error: "stub_failure" });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Apple stub on http://127.0.0.1:${port} -> ${upstream}`);
});
