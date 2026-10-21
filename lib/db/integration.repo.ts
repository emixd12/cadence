import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";
import { OAuthPersistenceError } from "@/lib/db/oauth.repo";

// Ticket 222 integration bookkeeping. Callers pass the integration-session
// client (the server-minted internal token). The database derives the user
// from auth.uid() and the client from the token's cadence_grant_id claim,
// so attribution never comes from arguments.

export type IntegrationActivityOutcome =
  | "success"
  | "denied"
  | "invalid"
  | "conflict"
  | "rate_limited"
  | "error";

export type IdempotencyClaim =
  | { state: "started" }
  | { state: "replay"; result: Json }
  | { state: "mismatch" }
  | { state: "in_progress" };

export type ExternalReferenceEntityType = "behavior";
export type ExternalReferenceLinkState = "linked" | "existing" | "conflict";

function integrationError(error: { message?: string }): OAuthPersistenceError {
  const message = error.message ?? "";
  const code = /^integration_[a-z_]+$/.test(message) ? message : "database_error";
  return new OAuthPersistenceError("Integration persistence call failed.", code);
}

/** Records identifiers and codes only. Never pass user-entered text. */
export async function recordIntegrationActivity(
  integrationClient: AppSupabaseClient,
  input: {
    operation: string;
    targetIds: string[];
    outcome: IntegrationActivityOutcome;
    errorCode: string | null;
  },
): Promise<void> {
  const { error } = await integrationClient.rpc("integration_record_activity", {
    p_operation: input.operation,
    p_target_ids: input.targetIds,
    p_outcome: input.outcome,
    p_error_code: input.errorCode as string,
  });
  if (error) {
    throw integrationError(error);
  }
}

/** Claims a key for 24 hours. requestHash is the SHA-256 hex of the canonical input. */
export async function beginIdempotentWrite(
  integrationClient: AppSupabaseClient,
  input: { idempotencyKey: string; operation: string; requestHash: string },
): Promise<IdempotencyClaim> {
  const { data, error } = await integrationClient.rpc("integration_idempotency_begin", {
    p_idempotency_key: input.idempotencyKey,
    p_operation: input.operation,
    p_request_hash: input.requestHash,
  });
  if (error) {
    throw integrationError(error);
  }
  const row = data?.[0];
  switch (row?.state) {
    case "started":
    case "mismatch":
    case "in_progress":
      return { state: row.state };
    case "replay":
      return { state: "replay", result: row.result };
    default:
      throw new OAuthPersistenceError("Idempotency claim was malformed.", "malformed_result");
  }
}

export async function completeIdempotentWrite(
  integrationClient: AppSupabaseClient,
  input: { idempotencyKey: string; requestHash: string; result: Json },
): Promise<boolean> {
  const { data, error } = await integrationClient.rpc("integration_idempotency_complete", {
    p_idempotency_key: input.idempotencyKey,
    p_request_hash: input.requestHash,
    p_result: input.result,
  });
  if (error) {
    throw integrationError(error);
  }
  return data === true;
}

/** Drops a pending claim after a failed write so the client can retry. */
export async function releaseIdempotentWrite(
  integrationClient: AppSupabaseClient,
  input: { idempotencyKey: string; requestHash: string },
): Promise<boolean> {
  const { data, error } = await integrationClient.rpc("integration_idempotency_release", {
    p_idempotency_key: input.idempotencyKey,
    p_request_hash: input.requestHash,
  });
  if (error) {
    throw integrationError(error);
  }
  return data === true;
}

export async function linkExternalReference(
  integrationClient: AppSupabaseClient,
  input: {
    entityType: ExternalReferenceEntityType;
    entityId: string;
    externalId: string;
  },
): Promise<ExternalReferenceLinkState> {
  const { data, error } = await integrationClient.rpc("integration_link_external_reference", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_external_id: input.externalId,
  });
  if (error) {
    throw integrationError(error);
  }
  if (data !== "linked" && data !== "existing" && data !== "conflict") {
    throw new OAuthPersistenceError("External reference link was malformed.", "malformed_result");
  }
  return data;
}

export async function findExternalReference(
  integrationClient: AppSupabaseClient,
  input: { entityType: ExternalReferenceEntityType; externalId: string },
): Promise<string | null> {
  const { data, error } = await integrationClient.rpc("integration_find_external_reference", {
    p_entity_type: input.entityType,
    p_external_id: input.externalId,
  });
  if (error) {
    throw integrationError(error);
  }
  return typeof data === "string" ? data : null;
}

/** Returns entity id -> external id for up to 200 entities. */
export async function listExternalReferences(
  integrationClient: AppSupabaseClient,
  input: { entityType: ExternalReferenceEntityType; entityIds: string[] },
): Promise<Map<string, string>> {
  if (input.entityIds.length === 0) {
    return new Map();
  }
  if (input.entityIds.length > 200) {
    throw new OAuthPersistenceError("At most 200 external references per read.", "too_many_entities");
  }
  const { data, error } = await integrationClient.rpc("integration_list_external_references", {
    p_entity_type: input.entityType,
    p_entity_ids: input.entityIds,
  });
  if (error) {
    throw integrationError(error);
  }
  return new Map((data ?? []).map((row) => [row.entity_id, row.external_id]));
}
