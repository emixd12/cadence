import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

// Server-only. Mints short-lived Supabase access tokens for verified
// integration grants so integration requests reach Postgres as that user
// under RLS. Tokens never leave the server and must never be logged.

export const INTEGRATION_SIGNING_KEY_ENV = "CADENCE_INTEGRATION_JWT_SIGNING_KEY";
export const INTEGRATION_TOKEN_MAX_TTL_SECONDS = 300;

export type IntegrationTokenChannel = "mcp";

export type IntegrationSigningKey = {
  kid: string;
  privateKey: KeyObject;
};

export type IntegrationTokenInput = {
  userId: string;
  channel: IntegrationTokenChannel;
  grantId: string;
  clientId: string;
  now: Date;
  ttlSeconds?: number;
};

export type IntegrationTokenClaims = {
  sub: string;
  role: "authenticated";
  aud: "authenticated";
  iat: number;
  exp: number;
  jti: string;
  cadence_channel: IntegrationTokenChannel;
  cadence_grant_id: string;
  cadence_client_id: string;
};

export type MintedIntegrationToken = {
  token: string;
  expiresAt: Date;
};

export class IntegrationSigningKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationSigningKeyError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readIntegrationSigningKey(
  env: Record<string, string | undefined> = process.env,
): IntegrationSigningKey | null {
  const raw = env[INTEGRATION_SIGNING_KEY_ENV]?.trim();

  if (!raw) {
    return null;
  }

  return parseIntegrationSigningKey(raw);
}

export function getIntegrationSigningKey(
  env: Record<string, string | undefined> = process.env,
): IntegrationSigningKey {
  const key = readIntegrationSigningKey(env);

  if (!key) {
    throw new IntegrationSigningKeyError(
      `Missing integration signing key. Set ${INTEGRATION_SIGNING_KEY_ENV} to the private ES256 JWK imported into Supabase.`,
    );
  }

  return key;
}

// Accepts one private JWK, a JSON array of JWKs (the `supabase gen
// signing-key` output shape), or a `{ "keys": [...] }` set. The first key is
// used. Error messages never include key material.
export function parseIntegrationSigningKey(raw: string): IntegrationSigningKey {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IntegrationSigningKeyError(
      `${INTEGRATION_SIGNING_KEY_ENV} is not valid JSON.`,
    );
  }

  const jwk = selectFirstJwk(parsed);

  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.d !== "string" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string"
  ) {
    throw new IntegrationSigningKeyError(
      `${INTEGRATION_SIGNING_KEY_ENV} must be a private EC P-256 JWK.`,
    );
  }

  if (jwk.alg !== undefined && jwk.alg !== "ES256") {
    throw new IntegrationSigningKeyError(
      `${INTEGRATION_SIGNING_KEY_ENV} must use alg ES256.`,
    );
  }

  if (typeof jwk.kid !== "string" || jwk.kid.trim().length === 0) {
    throw new IntegrationSigningKeyError(
      `${INTEGRATION_SIGNING_KEY_ENV} must include the kid of the imported Supabase signing key.`,
    );
  }

  let privateKey: KeyObject;

  try {
    privateKey = createPrivateKey({
      key: {
        kty: jwk.kty,
        crv: jwk.crv,
        d: jwk.d,
        x: jwk.x,
        y: jwk.y,
      } as JsonWebKey,
      format: "jwk",
    });
  } catch {
    throw new IntegrationSigningKeyError(
      `${INTEGRATION_SIGNING_KEY_ENV} could not be loaded as an EC private key.`,
    );
  }

  return { kid: jwk.kid, privateKey };
}

export function mintIntegrationAccessToken(
  key: IntegrationSigningKey,
  input: IntegrationTokenInput,
): MintedIntegrationToken {
  const ttlSeconds = input.ttlSeconds ?? INTEGRATION_TOKEN_MAX_TTL_SECONDS;

  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > INTEGRATION_TOKEN_MAX_TTL_SECONDS
  ) {
    throw new RangeError(
      `Integration token lifetime must be 1–${INTEGRATION_TOKEN_MAX_TTL_SECONDS} seconds.`,
    );
  }

  if (!UUID_PATTERN.test(input.userId)) {
    throw new TypeError("Integration token subject must be a user UUID.");
  }

  for (const [name, value] of [
    ["grantId", input.grantId],
    ["clientId", input.clientId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError(`Integration token ${name} is required.`);
    }
  }

  const nowMs = input.now.getTime();

  if (!Number.isFinite(nowMs)) {
    throw new TypeError("Integration token clock value is invalid.");
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSeconds;
  const claims: IntegrationTokenClaims = {
    sub: input.userId,
    role: "authenticated",
    aud: "authenticated",
    iat,
    exp,
    jti: randomUUID(),
    cadence_channel: input.channel,
    cadence_grant_id: input.grantId,
    cadence_client_id: input.clientId,
  };
  const header = { alg: "ES256", typ: "JWT", kid: key.kid };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: key.privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return {
    token: `${signingInput}.${signature.toString("base64url")}`,
    expiresAt: new Date(exp * 1000),
  };
}

// Returns the public JWK for verification tests and local key setup checks.
export function integrationSigningPublicJwk(
  key: IntegrationSigningKey,
): JsonWebKey & { kid: string; alg: "ES256"; use: "sig" } {
  const publicJwk = createPublicKey(key.privateKey).export({ format: "jwk" });
  return { ...publicJwk, kid: key.kid, alg: "ES256", use: "sig" };
}

type CandidateJwk = {
  kty?: unknown;
  crv?: unknown;
  d?: unknown;
  x?: unknown;
  y?: unknown;
  alg?: unknown;
  kid?: unknown;
};

function selectFirstJwk(parsed: unknown): CandidateJwk {
  const candidate = Array.isArray(parsed)
    ? parsed[0]
    : isRecord(parsed) && Array.isArray(parsed.keys)
      ? parsed.keys[0]
      : parsed;

  if (!isRecord(candidate)) {
    throw new IntegrationSigningKeyError(
      `${INTEGRATION_SIGNING_KEY_ENV} must contain a JWK object.`,
    );
  }

  return candidate as CandidateJwk;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
