#!/usr/bin/env node
// Ticket 338: a loopback copy of hosted Supabase Auth's per-address limits, for
// tests/email-sign-in-rate-limit.local-integration.test.ts.
//
// The local stack's Auth applies no per-address limit (no GOTRUE_RATE_LIMIT_HEADER),
// so this starts a second Auth container on the same database with:
//   - per-address limits keyed by X-Forwarded-For, which the gateway below always
//     overwrites with the caller's socket address, as the hosted gateway does;
//   - Sb-Forwarded-For on (security_sb_forwarded_for_enabled);
//   - Turnstile with Cloudflare's always-pass test secret.
// The gateway on GATEWAY_PORT applies Supabase's key rules: a new-format key sent as
// the bearer becomes the matching role's JWT (a secret key is an admin call, so Auth
// skips CAPTCHA, as measured on hosted on November 13, 2026), and Sb-Forwarded-For
// passes only with a secret key. Other paths go to the local stack unchanged.
//
//   node scripts/auth-rate-limit-local.mjs up      # starts Auth, runs the gateway
//   node scripts/auth-rate-limit-local.mjs reset   # restarts Auth: empties the limits
//   node scripts/auth-rate-limit-local.mjs down
//
// GET /__t338/log on the gateway returns the Auth answers it relayed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";

const SOURCE = "supabase_auth_habit-tracking-app";
const NAME = "cadence_t338_auth";
const AUTH_PORT = 55398;
const GATEWAY_PORT = 55397;
const STACK = process.env.CADENCE_LOCAL_SUPABASE_URL ?? "http://127.0.0.1:55341";
const TURNSTILE_ALWAYS_PASS_SECRET = "1x0000000000000000000000000000000AA";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

function stackKeys() {
  const out = execFileSync("npm", ["run", "-s", "supabase", "--", "status", "-o", "env"], {
    encoding: "utf8",
  });
  const read = (name) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(out)?.[1];
  return {
    anon: read("ANON_KEY"),
    service: read("SERVICE_ROLE_KEY"),
    publishable: read("PUBLISHABLE_KEY"),
    secret: read("SECRET_KEY"),
  };
}

function startAuth() {
  try {
    docker("rm", "-f", NAME);
  } catch {}
  const env = docker("inspect", SOURCE, "--format", "{{range .Config.Env}}{{println .}}{{end}}")
    .split("\n")
    .filter((line) => line && !/^GOTRUE_(MAILER_TEMPLATES_|RATE_LIMIT_HEADER|SECURITY_SB_FORWARDED_FOR_ENABLED|SECURITY_CAPTCHA_)/.test(line));
  env.push(
    // The CLI serves templates from its own process; the gateway serves them here.
    `GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://host.docker.internal:${GATEWAY_PORT}/__t338/sign-in.html`,
    `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://host.docker.internal:${GATEWAY_PORT}/__t338/sign-in.html`,
    "GOTRUE_RATE_LIMIT_HEADER=X-Forwarded-For",
    "GOTRUE_SECURITY_SB_FORWARDED_FOR_ENABLED=true",
    "GOTRUE_SECURITY_CAPTCHA_ENABLED=true",
    "GOTRUE_SECURITY_CAPTCHA_PROVIDER=turnstile",
    `GOTRUE_SECURITY_CAPTCHA_SECRET=${TURNSTILE_ALWAYS_PASS_SECRET}`,
  );
  const image = docker("inspect", SOURCE, "--format", "{{.Config.Image}}");
  const network = Object.keys(
    JSON.parse(docker("inspect", SOURCE, "--format", "{{json .NetworkSettings.Networks}}")),
  )[0];
  docker(
    "run", "-d", "--name", NAME, "--network", network, "-p", `127.0.0.1:${AUTH_PORT}:9999`,
    ...env.flatMap((line) => ["-e", line]), image,
  );
}

async function waitForAuth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${AUTH_PORT}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Auth container did not start");
}

function runGateway(keys) {
  const roleFor = new Map([
    [keys.publishable, keys.anon],
    [keys.secret, keys.service],
  ]);
  const log = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/__t338/sign-in.html") {
      res.end(readFileSync(new URL("../supabase/templates/sign-in.html", import.meta.url)));
      return;
    }
    if (req.url === "/__t338/log") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(log));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers["content-length"];

    const isAuth = req.url.startsWith("/auth/v1/");
    let target = new URL(req.url, STACK);
    if (isAuth) {
      const apikey = headers.apikey ?? "";
      const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? "")?.[1];
      if (roleFor.has(apikey) && (!bearer || bearer === apikey)) {
        headers.authorization = `Bearer ${roleFor.get(apikey)}`;
      }
      if (apikey !== keys.secret) delete headers["sb-forwarded-for"];
      headers["x-forwarded-for"] = req.socket.remoteAddress.replace(/^::ffff:/, "");
      target = new URL(req.url.slice("/auth/v1".length), `http://127.0.0.1:${AUTH_PORT}`);
    }

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
        redirect: "manual",
      });
      const text = Buffer.from(await upstream.arrayBuffer());
      if (isAuth) {
        let code = null;
        try {
          const parsed = JSON.parse(text.toString("utf8"));
          code = parsed.error_code ?? parsed.code ?? null;
        } catch {}
        log.push({
          at: Date.now(),
          path: target.pathname,
          status: upstream.status,
          code,
          forwardedFor: headers["sb-forwarded-for"] ?? null,
          admin: headers.authorization === `Bearer ${keys.service}`,
        });
      }
      const out = {};
      upstream.headers.forEach((value, key) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(key)) {
          out[key] = value;
        }
      });
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) out["set-cookie"] = cookies;
      res.writeHead(upstream.status, out);
      res.end(text);
    } catch (error) {
      res.writeHead(502);
      res.end(String(error));
    }
  });
  server.listen(GATEWAY_PORT, "127.0.0.1", () => {
    console.log(`gateway http://127.0.0.1:${GATEWAY_PORT} -> Auth ${AUTH_PORT}, rest ${STACK}`);
  });
}

const command = process.argv[2];
if (command === "up") {
  const keys = stackKeys();
  if (!keys.secret?.startsWith("sb_secret_") || !keys.publishable) {
    throw new Error("The local stack has no new-format keys.");
  }
  // The gateway first: Auth reads the email template from it as it starts.
  runGateway(keys);
  startAuth();
  await waitForAuth();
} else if (command === "reset") {
  docker("restart", NAME);
  await waitForAuth();
  console.log("Auth restarted; limits empty.");
} else if (command === "down") {
  docker("rm", "-f", NAME);
} else {
  console.error("usage: auth-rate-limit-local.mjs up | reset | down");
  process.exit(2);
}
