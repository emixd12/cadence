#!/usr/bin/env node
// Ticket 333: builds the Sign in with Apple client secret (an ES256 JWT) that the
// Supabase Apple provider and APPLE_SIGN_IN_CLIENT_SECRET hold. Apple refuses one
// that lives longer than 15,777,000 seconds (about 6 months). Runbook:
// docs/OPERATIONS.md, "Sign in with Apple (Ticket 333)".
//
//   APPLE_SIGN_IN_PRIVATE_KEY="$(cat AuthKey_XXXXXXXXXX.p8)" \
//     node scripts/apple-client-secret.mjs --key-id XXXXXXXXXX \
//     --team-id HK26VT477G --client-id <Services ID> [--days 180] [--json]
//
// The key is read from the environment, never from an argument, and nothing but
// the secret (or, with --json, the secret and its dates) is printed.

import { createPrivateKey, sign } from "node:crypto";

const MAX_SECONDS = 15_777_000;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const keyId = argument("key-id");
const teamId = argument("team-id");
const clientId = argument("client-id");
const days = Number(argument("days", "180"));
const pem = process.env.APPLE_SIGN_IN_PRIVATE_KEY;

if (!keyId || !teamId || !clientId || !pem) {
  console.error("Need --key-id, --team-id, --client-id and APPLE_SIGN_IN_PRIVATE_KEY.");
  process.exit(2);
}
if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) {
  console.error("Key ID and team ID are 10 characters, A–Z and 0–9.");
  process.exit(2);
}
if (clientId.includes(teamId)) {
  console.error("Apple refuses a client ID that contains the team ID.");
  process.exit(2);
}
const lifetime = Math.round(days * 86_400);
if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > MAX_SECONDS) {
  console.error(`--days must give at most ${MAX_SECONDS} seconds (about 182 days).`);
  process.exit(2);
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + lifetime;
const header = encode({ alg: "ES256", kid: keyId });
const payload = encode({
  iss: teamId,
  iat: issuedAt,
  exp: expiresAt,
  aud: "https://appleid.apple.com",
  sub: clientId,
});
const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
  key: createPrivateKey(pem),
  dsaEncoding: "ieee-p1363",
}).toString("base64url");
const secret = `${header}.${payload}.${signature}`;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    secret,
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  }));
} else {
  console.log(secret);
}
