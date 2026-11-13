import { createHash } from "node:crypto";

import {
  readAppleSignInTokens,
  storeAppleSignInToken,
} from "@/lib/db/apple-sign-in.repo";
import {
  openServerSecret,
  readConnectorCredentialConfig,
  sealServerSecret,
  type ConnectorCredentialConfig,
} from "./connector-credentials";

// Ticket 333 (D31.2, L-025). Supabase Auth gives Apple's refresh token to the
// sign-in callback once and keeps none. Cadence seals it with the connector key so
// account deletion can revoke Cadence's Sign in with Apple authorization.

export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

/** The Services ID and the 6-month client secret, the same values the Supabase Apple provider holds. */
export type AppleRevocationConfig = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

type Env = Readonly<Record<string, string | undefined>>;

export function readAppleRevocationConfig(
  env: Env = process.env,
): AppleRevocationConfig | null {
  const clientId = env.APPLE_SIGN_IN_SERVICES_ID?.trim();
  const clientSecret = env.APPLE_SIGN_IN_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function appleSubjectDigest(subject: string): string {
  return createHash("sha256")
    .update(JSON.stringify(["cadence-apple-sign-in-v1", subject]))
    .digest("hex");
}

function associatedData(userId: string, subjectDigest: string): Buffer {
  return Buffer.from(
    JSON.stringify(["cadence-apple-sign-in-v1", "refresh", userId, subjectDigest]),
  );
}

function validToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 16_384 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export type KeepAppleTokenResult = "kept" | "not_configured" | "invalid";

export async function keepAppleRefreshToken(
  input: Readonly<{ userId: string; subject: string; refreshToken: string }>,
  env: Env = process.env,
): Promise<KeepAppleTokenResult> {
  const config = readConnectorCredentialConfig(env);
  if (!config) return "not_configured";
  if (!validToken(input.refreshToken) || !input.subject) return "invalid";

  const digest = appleSubjectDigest(input.subject);
  await storeAppleSignInToken(
    input.userId,
    digest,
    sealServerSecret(config, input.refreshToken, associatedData(input.userId, digest)),
  );
  return "kept";
}

export class AppleRevocationError extends Error {
  constructor(
    code: "not_configured" | "unreadable_token" | "provider_refused" | "provider_unavailable",
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = "AppleRevocationError";
  }
}

export type AppleRevocationDeps = Readonly<{
  env?: Env;
  fetch?: typeof fetch;
  revokeUrl?: string;
}>;

/**
 * Reads and opens every kept token before the Auth user is deleted (the rows
 * cascade with it) and returns the revocation to run after. Null: nothing kept.
 */
export async function prepareAppleRevocation(
  userId: string,
  deps: AppleRevocationDeps = {},
): Promise<(() => Promise<void>) | null> {
  const rows = await readAppleSignInTokens(userId);
  if (rows.length === 0) return null;

  const env = deps.env ?? process.env;
  const keyConfig = readConnectorCredentialConfig(env);
  const apple = readAppleRevocationConfig(env);
  if (!keyConfig || !apple) {
    return async () => {
      throw new AppleRevocationError("not_configured");
    };
  }

  const tokens = rows.map((row) =>
    openToken(keyConfig, userId, row.subjectDigest, row.sealedRefreshToken),
  );

  return async () => {
    const outcomes = await Promise.allSettled(
      tokens.map((token) =>
        token === null
          ? Promise.reject(new AppleRevocationError("unreadable_token"))
          : revokeAppleRefreshToken(apple, token, deps),
      ),
    );
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
  };
}

function openToken(
  config: ConnectorCredentialConfig,
  userId: string,
  subjectDigest: string,
  sealed: string,
): string | null {
  try {
    return openServerSecret(config, sealed, associatedData(userId, subjectDigest));
  } catch {
    return null;
  }
}

/** Apple returns 200 for a revoked token and for one that was already invalid. */
export async function revokeAppleRefreshToken(
  config: AppleRevocationConfig,
  refreshToken: string,
  deps: AppleRevocationDeps = {},
): Promise<void> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(deps.revokeUrl ?? APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppleRevocationError("provider_unavailable");
  }
  if (!response.ok) {
    throw new AppleRevocationError(
      response.status >= 500 ? "provider_unavailable" : "provider_refused",
      response.status,
    );
  }
}
