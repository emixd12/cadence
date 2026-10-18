import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";

// Ticket 222 OAuth persistence. Every table lives in the non-exposed
// cadence_oauth_private schema; these wrappers call its exact functions.
//
// Token-endpoint functions accept only a server-only service-role client.
// User-session functions (consent, Connected apps) accept the signed-in
// user's client and are owner-checked with auth.uid(). Callers pass SHA-256
// hex hashes, never raw tokens or codes.

export type OAuthScope =
  | "cadence.read"
  | "cadence.occurrences.write"
  | "cadence.behaviors.write";

export type OAuthRegistrationType = "dcr" | "cimd";
export type OAuthVerifiedClient = "claude" | "claude_code" | "chatgpt";
export type OAuthRateLimitAction =
  | "mcp_read"
  | "mcp_write"
  | "client_registration";

export type OAuthClientRecord = {
  clientId: string;
  registrationType: OAuthRegistrationType;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  applicationType: "web" | "native";
  verifiedClient: OAuthVerifiedClient | null;
  metadataExpiresAt: string | null;
  metadataStale: boolean;
};

export type OAuthClientRegistration = {
  clientId: string;
  registrationType: OAuthRegistrationType;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  applicationType: "web" | "native";
  metadata: Record<string, Json>;
  verifiedClient: OAuthVerifiedClient | null;
  /** Required for CIMD (at most 24 hours ahead); must be null for DCR. */
  metadataExpiresAt: string | null;
};

export type OAuthTokenIssue = {
  offlineAccess: boolean;
  grantId: string;
  userId: string;
  clientId: string;
  scopes: OAuthScope[];
  resource: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type OAuthTokenResult =
  | ({ ok: true } & OAuthTokenIssue)
  | {
      ok: false;
      error: "invalid_grant" | "invalid_scope";
      reuseDetected: boolean;
    };

export type OAuthVerifiedToken = {
  active: true;
  userId: string;
  grantId: string;
  clientId: string;
  clientName: string;
  verifiedClient: OAuthVerifiedClient | null;
  scopes: OAuthScope[];
  resource: string;
  expiresAt: string;
};

export type OAuthRateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
};

export type OAuthConsentResult = {
  grantId: string;
  scopes: OAuthScope[];
  codeExpiresAt: string;
};

export type OAuthGrantSummary = {
  grantId: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  verifiedClient: OAuthVerifiedClient | null;
  scopes: OAuthScope[];
  createdAt: string;
  lastUsedAt: string | null;
};

export type OAuthActivityEntry = {
  activityId: number;
  grantId: string;
  clientName: string;
  operation: string;
  outcome: string;
  errorCode: string | null;
  occurredAt: string;
};

const SCOPES: readonly OAuthScope[] = [
  "cadence.read",
  "cadence.occurrences.write",
  "cadence.behaviors.write",
];
const VERIFIED_CLIENTS: readonly OAuthVerifiedClient[] = [
  "claude",
  "claude_code",
  "chatgpt",
];

export class OAuthPersistenceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "OAuthPersistenceError";
  }
}

function nullable<T>(value: T | null): T {
  return value as T;
}

function asObject(value: Json | null | undefined): Record<string, Json> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asScopes(value: unknown): OAuthScope[] {
  if (!Array.isArray(value)) {
    throw new OAuthPersistenceError("OAuth scopes were malformed.", "malformed_result");
  }
  return value.map((scope) => {
    if (!SCOPES.includes(scope as OAuthScope)) {
      throw new OAuthPersistenceError("OAuth scopes were malformed.", "malformed_result");
    }
    return scope as OAuthScope;
  });
}

function asVerifiedClient(value: unknown): OAuthVerifiedClient | null {
  return VERIFIED_CLIENTS.includes(value as OAuthVerifiedClient)
    ? (value as OAuthVerifiedClient)
    : null;
}

function requireString(record: Record<string, Json>, key: string): string {
  const value = asString(record[key]);
  if (value === null) {
    throw new OAuthPersistenceError(`OAuth result is missing ${key}.`, "malformed_result");
  }
  return value;
}

function databaseError(error: { message?: string; code?: string }): OAuthPersistenceError {
  // Function errors carry stable codes such as oauth_invalid_redirect_uri.
  const message = error.message ?? "";
  const code = /^(oauth|integration)_[a-z_]+$/.test(message) ? message : "database_error";
  return new OAuthPersistenceError("OAuth persistence call failed.", code);
}

function parseClient(value: Json | null): OAuthClientRecord | null {
  const record = asObject(value);
  if (!record) {
    return null;
  }
  const registrationType = record.registration_type;
  const applicationType = record.application_type;
  if (
    (registrationType !== "dcr" && registrationType !== "cimd") ||
    (applicationType !== "web" && applicationType !== "native") ||
    !Array.isArray(record.redirect_uris)
  ) {
    throw new OAuthPersistenceError("OAuth client was malformed.", "malformed_result");
  }
  return {
    clientId: requireString(record, "client_id"),
    registrationType,
    clientName: requireString(record, "client_name"),
    clientUri: asString(record.client_uri),
    logoUri: asString(record.logo_uri),
    redirectUris: record.redirect_uris.filter(
      (uri): uri is string => typeof uri === "string",
    ),
    applicationType,
    verifiedClient: asVerifiedClient(record.verified_client),
    metadataExpiresAt: asString(record.metadata_expires_at),
    metadataStale: record.metadata_stale === true,
  };
}

function parseTokenResult(value: Json | null): OAuthTokenResult {
  const record = asObject(value);
  if (!record) {
    throw new OAuthPersistenceError("OAuth token result was empty.", "malformed_result");
  }
  if (record.ok !== true) {
    return {
      ok: false,
      error: record.error === "invalid_scope" ? "invalid_scope" : "invalid_grant",
      reuseDetected: record.reuse_detected === true,
    };
  }
  return {
    ok: true,
    offlineAccess: record.offline_access === true,
    grantId: requireString(record, "grant_id"),
    userId: requireString(record, "user_id"),
    clientId: requireString(record, "client_id"),
    scopes: asScopes(record.scopes),
    resource: requireString(record, "resource"),
    accessTokenExpiresAt: requireString(record, "access_token_expires_at"),
    refreshTokenExpiresAt: requireString(record, "refresh_token_expires_at"),
  };
}

// ---------------------------------------------------------------------------
// Token-endpoint functions (service-role client only).
// ---------------------------------------------------------------------------

export async function registerOAuthClient(
  serviceClient: AppSupabaseClient,
  registration: OAuthClientRegistration,
): Promise<OAuthClientRecord> {
  const { data, error } = await serviceClient.rpc("oauth_register_client", {
    p_client_id: registration.clientId,
    p_registration_type: registration.registrationType,
    p_client_name: registration.clientName,
    p_client_uri: nullable(registration.clientUri),
    p_logo_uri: nullable(registration.logoUri),
    p_redirect_uris: registration.redirectUris,
    p_application_type: registration.applicationType,
    p_metadata: registration.metadata,
    p_verified_client: nullable(registration.verifiedClient),
    p_metadata_expires_at: nullable(registration.metadataExpiresAt),
  });
  if (error) {
    throw databaseError(error);
  }
  const client = parseClient(data);
  if (!client) {
    throw new OAuthPersistenceError("OAuth client registration returned nothing.", "malformed_result");
  }
  return client;
}

/** Returns null for unknown, disabled, or expired-unused clients. */
export async function readOAuthClient(
  serviceClient: AppSupabaseClient,
  clientId: string,
): Promise<OAuthClientRecord | null> {
  const { data, error } = await serviceClient.rpc("oauth_get_client", {
    p_client_id: clientId,
  });
  if (error) {
    throw databaseError(error);
  }
  return parseClient(data);
}

export async function exchangeAuthorizationCode(
  serviceClient: AppSupabaseClient,
  input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    codeVerifier: string;
    accessTokenHash: string;
    refreshTokenHash: string;
  },
): Promise<OAuthTokenResult> {
  const { data, error } = await serviceClient.rpc("oauth_exchange_authorization_code", {
    p_code_hash: input.codeHash,
    p_client_id: input.clientId,
    p_redirect_uri: input.redirectUri,
    p_resource: input.resource,
    p_code_verifier: input.codeVerifier,
    p_access_token_hash: input.accessTokenHash,
    p_refresh_token_hash: input.refreshTokenHash,
  });
  if (error) {
    throw databaseError(error);
  }
  return parseTokenResult(data);
}

export async function rotateRefreshToken(
  serviceClient: AppSupabaseClient,
  input: {
    refreshTokenHash: string;
    clientId: string;
    resource: string | null;
    scopes: OAuthScope[] | null;
    accessTokenHash: string;
    nextRefreshTokenHash: string;
  },
): Promise<OAuthTokenResult> {
  const { data, error } = await serviceClient.rpc("oauth_rotate_refresh_token", {
    p_refresh_token_hash: input.refreshTokenHash,
    p_client_id: input.clientId,
    p_resource: nullable(input.resource),
    p_scopes: nullable(input.scopes),
    p_access_token_hash: input.accessTokenHash,
    p_next_refresh_token_hash: input.nextRefreshTokenHash,
  });
  if (error) {
    throw databaseError(error);
  }
  return parseTokenResult(data);
}

export async function verifyAccessToken(
  serviceClient: AppSupabaseClient,
  input: { accessTokenHash: string; resource: string },
): Promise<OAuthVerifiedToken | null> {
  const { data, error } = await serviceClient.rpc("oauth_verify_access_token", {
    p_access_token_hash: input.accessTokenHash,
    p_resource: input.resource,
  });
  if (error) {
    throw databaseError(error);
  }
  const record = asObject(data);
  if (!record || record.active !== true) {
    return null;
  }
  return {
    active: true,
    userId: requireString(record, "user_id"),
    grantId: requireString(record, "grant_id"),
    clientId: requireString(record, "client_id"),
    clientName: requireString(record, "client_name"),
    verifiedClient: asVerifiedClient(record.verified_client),
    scopes: asScopes(record.scopes),
    resource: requireString(record, "resource"),
    expiresAt: requireString(record, "expires_at"),
  };
}

/** RFC 7009. Returns whether a token belonging to the client was revoked. */
export async function revokeOAuthToken(
  serviceClient: AppSupabaseClient,
  input: { tokenHash: string; clientId: string },
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc("oauth_revoke_token", {
    p_token_hash: input.tokenHash,
    p_client_id: input.clientId,
  });
  if (error) {
    throw databaseError(error);
  }
  return data === true;
}

export async function consumeOAuthRateLimit(
  serviceClient: AppSupabaseClient,
  input:
    | { action: "mcp_read" | "mcp_write"; grantId: string }
    | { action: "client_registration" | "oauth_request" | "oauth_global"; sourceHash: string },
): Promise<OAuthRateLimitDecision> {
  const { data, error } = await serviceClient.rpc("oauth_consume_rate_limit", {
    p_action: input.action,
    p_grant_id: nullable("grantId" in input ? input.grantId : null),
    p_source_hash: nullable("sourceHash" in input ? input.sourceHash : null),
  });
  if (error) {
    throw databaseError(error);
  }
  const record = asObject(data);
  if (
    !record ||
    typeof record.allowed !== "boolean" ||
    typeof record.limit_count !== "number" ||
    typeof record.remaining !== "number" ||
    typeof record.reset_at !== "string" ||
    typeof record.retry_after_seconds !== "number"
  ) {
    throw new OAuthPersistenceError("OAuth rate limit did not return a decision.", "malformed_result");
  }
  return {
    allowed: record.allowed,
    limit: record.limit_count,
    remaining: record.remaining,
    resetAt: record.reset_at,
    retryAfterSeconds: Math.max(1, record.retry_after_seconds),
  };
}

export async function purgeExpiredOAuthRecords(
  serviceClient: AppSupabaseClient,
): Promise<Record<string, number>> {
  const { data, error } = await serviceClient.rpc("oauth_purge_expired");
  if (error) {
    throw databaseError(error);
  }
  const record = asObject(data) ?? {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

/** Incident response: revokes every active grant. Returns the count. */
export async function revokeAllOAuthGrants(
  serviceClient: AppSupabaseClient,
): Promise<number> {
  const { data, error } = await serviceClient.rpc("oauth_revoke_all_grants");
  if (error) {
    throw databaseError(error);
  }
  return typeof data === "number" ? data : 0;
}

// ---------------------------------------------------------------------------
// User-session functions (the signed-in user's client).
// ---------------------------------------------------------------------------

export async function approveOAuthConsent(
  userClient: AppSupabaseClient,
  input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
    scopes: OAuthScope[];
    codeHash: string;
  },
): Promise<OAuthConsentResult> {
  const { data, error } = await userClient.rpc("oauth_approve_consent", {
    p_client_id: input.clientId,
    p_redirect_uri: input.redirectUri,
    p_code_challenge: input.codeChallenge,
    p_resource: input.resource,
    p_scopes: input.scopes,
    p_code_hash: input.codeHash,
  });
  if (error) {
    throw databaseError(error);
  }
  const record = asObject(data);
  if (!record) {
    throw new OAuthPersistenceError("OAuth consent returned nothing.", "malformed_result");
  }
  return {
    grantId: requireString(record, "grant_id"),
    scopes: asScopes(record.scopes),
    codeExpiresAt: requireString(record, "code_expires_at"),
  };
}

export async function listOAuthGrants(
  userClient: AppSupabaseClient,
): Promise<OAuthGrantSummary[]> {
  const { data, error } = await userClient.rpc("oauth_list_grants");
  if (error) {
    throw databaseError(error);
  }
  return (data ?? []).map((row) => ({
    grantId: row.grant_id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientUri: row.client_uri ?? null,
    logoUri: row.logo_uri ?? null,
    verifiedClient: asVerifiedClient(row.verified_client),
    scopes: asScopes(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  }));
}

/** Revokes the caller's grant with all of its tokens and pending codes. */
export async function revokeOAuthGrant(
  userClient: AppSupabaseClient,
  grantId: string,
): Promise<boolean> {
  const { data, error } = await userClient.rpc("oauth_revoke_grant", {
    p_grant_id: grantId,
  });
  if (error) {
    throw databaseError(error);
  }
  return data === true;
}

export async function listOAuthActivity(
  userClient: AppSupabaseClient,
  input: { limit?: number; before?: string | null } = {},
): Promise<OAuthActivityEntry[]> {
  const { data, error } = await userClient.rpc("oauth_list_activity", {
    p_limit: input.limit ?? 50,
    p_before: nullable(input.before ?? null),
  });
  if (error) {
    throw databaseError(error);
  }
  return (data ?? []).map((row) => ({
    activityId: row.activity_id,
    grantId: row.grant_id,
    clientName: row.client_name,
    operation: row.operation,
    outcome: row.outcome,
    errorCode: row.error_code ?? null,
    occurredAt: row.occurred_at,
  }));
}

export type PendingAuthorization = {
  id: string;
  clientId: string;
  clientName: string;
  verifiedClient: OAuthVerifiedClient | null;
  redirectUri: string;
  resource: string;
  scopes: OAuthScope[];
  offlineAccess: boolean;
  state: string | null;
  expiresAt: string;
};

export async function createPendingAuthorization(client: AppSupabaseClient, input: {
  browserHash: string; clientId: string; redirectUri: string; codeChallenge: string;
  resource: string; scopes: OAuthScope[]; offlineAccess: boolean; state: string | null;
}): Promise<string> {
  const { data, error } = await client.rpc("oauth_create_pending", {
    p_browser_hash: input.browserHash, p_client_id: input.clientId, p_redirect_uri: input.redirectUri,
    p_code_challenge: input.codeChallenge, p_resource: input.resource, p_scopes: input.scopes,
    p_offline_access: input.offlineAccess, p_state: nullable(input.state),
  });
  if (error) throw databaseError(error);
  if (typeof data !== "string") throw new OAuthPersistenceError("Missing request ID.", "malformed_result");
  return data;
}

export async function readPendingAuthorization(client: AppSupabaseClient, id: string, browserHash: string): Promise<PendingAuthorization | null> {
  const { data, error } = await client.rpc("oauth_read_pending", { p_id: id, p_browser_hash: browserHash });
  if (error) throw databaseError(error);
  const row = asObject(data);
  if (!row) return null;
  return {
    id: requireString(row, "id"), clientId: requireString(row, "client_id"), clientName: requireString(row, "client_name"),
    verifiedClient: asVerifiedClient(row.verified_client), redirectUri: requireString(row, "redirect_uri"),
    resource: requireString(row, "resource"), scopes: asScopes(row.scopes), offlineAccess: row.offline_access === true,
    state: asString(row.state), expiresAt: requireString(row, "expires_at"),
  };
}

export async function finishPendingAuthorization(client: AppSupabaseClient, input: {
  id: string; browserHash: string; scopes: OAuthScope[] | null; codeHash: string | null;
}): Promise<{ redirectUri: string; state: string | null; approved: boolean } | null> {
  const { data, error } = await client.rpc("oauth_finish_pending", {
    p_id: input.id, p_browser_hash: input.browserHash, p_scopes: nullable(input.scopes), p_code_hash: nullable(input.codeHash),
  });
  if (error) throw databaseError(error);
  const row = asObject(data);
  return row ? { redirectUri: requireString(row, "redirect_uri"), state: asString(row.state), approved: row.approved === true } : null;
}
