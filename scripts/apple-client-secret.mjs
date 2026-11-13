#!/usr/bin/env node
// Ticket 333: builds the Sign in with Apple client secret (an ES256 JWT) that the
// Supabase Apple provider and APPLE_SIGN_IN_CLIENT_SECRET hold. Apple refuses one
// that lives longer than 15,777,000 seconds (about 6 months). Runbook:
// docs/OPERATIONS.md, "Sign in with Apple (Ticket 333)".
//
// Normal use reads the key from the Cadence Release vault in memory, with the owner's
// "release-secrets" approval:
//   node apps/desktop/scripts/release-credentials.mjs apple-sign-in-secret --run <run-dir>
//
// Direct use, with a key you already hold in memory:
//   APPLE_SIGN_IN_PRIVATE_KEY="$(<reader>)" \
//     node scripts/apple-client-secret.mjs --key-id XXXXXXXXXX \
//     --team-id HK26VT477G --client-id <Services ID> [--days 180] [--json]
//
// The key is read from the environment, never from an argument, and nothing but
// the secret (or, with --json, the secret and its dates) is printed.

import { createPrivateKey, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export const APPLE_CLIENT_SECRET_MAX_SECONDS = 15_777_000;

export class AppleClientSecretError extends Error {}

/**
 * Signs a client secret. `pem` stays in memory; the result holds the JWT and its dates.
 * Throws AppleClientSecretError for any input Apple would refuse.
 */
export function buildAppleClientSecret({ pem, keyId, teamId, clientId, days = 180, now = Date.now() }) {
  if (!keyId || !teamId || !clientId || !pem) {
    throw new AppleClientSecretError("Need a key ID, team ID, client ID and private key.");
  }
  if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new AppleClientSecretError("Key ID and team ID are 10 characters, A–Z and 0–9.");
  }
  if (clientId.includes(teamId)) {
    throw new AppleClientSecretError("Apple refuses a client ID that contains the team ID.");
  }
  const lifetime = Math.round(Number(days) * 86_400);
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > APPLE_CLIENT_SECRET_MAX_SECONDS) {
    throw new AppleClientSecretError(`Days must give at most ${APPLE_CLIENT_SECRET_MAX_SECONDS} seconds (about 182 days).`);
  }
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new AppleClientSecretError("The private key could not be parsed.");
  }
  if (key.asymmetricKeyType !== "ec") {
    throw new AppleClientSecretError("The private key is not an EC (ES256) key.");
  }

  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(now / 1000);
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
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return {
    secret: `${header}.${payload}.${signature}`,
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

function isEntry() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  try {
    const result = buildAppleClientSecret({
      pem: process.env.APPLE_SIGN_IN_PRIVATE_KEY,
      keyId: argument("key-id"),
      teamId: argument("team-id"),
      clientId: argument("client-id"),
      days: argument("days", "180"),
    });
    console.log(process.argv.includes("--json") ? JSON.stringify(result) : result.secret);
  } catch (error) {
    console.error(error instanceof AppleClientSecretError ? error.message : "Could not build the client secret.");
    process.exit(2);
  }
}
