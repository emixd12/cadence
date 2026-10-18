import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { revalidatePath } from "next/cache";
import {
  checkOperationScope, createIntegrationError, validateOperationInput, validateOperationOutput,
  type IntegrationError, type IntegrationOperationInput, type IntegrationOperationOutput,
} from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { beginIdempotentWrite, releaseIdempotentWrite, recordIntegrationActivity } from "@/lib/db/integration.repo";
import { createIntegrationWriteClient, readIntegrationWriteSnapshot, type IntegrationWriteSnapshot } from "@/lib/db/integration-write.repo";
import { getBehaviorById, listBehaviorCategories } from "@/lib/db/behaviors.repo";
import { getOccurrenceById } from "@/lib/db/occurrences.repo";
import { createBehaviorForUser, updateBehaviorForUser, setBehaviorActiveForUser, syncBehaviorGraphForUser } from "@/lib/services/behavior.service";
import { applyOccurrenceStatusTransition, updateOccurrenceNote, repairClearedDecisionReminderCoverage } from "@/lib/services/occurrence.service";
import { BehaviorValidationError } from "@/lib/services/behavior-form";
import { integrationInstant, serializeIntegrationBehavior, serializeIntegrationOccurrence } from "@/lib/services/integration-read-serialization";
import { invalidateBehaviorData } from "@/lib/cache/stable-user-data.cache";
import type { Occurrence } from "@/lib/types/database";
import { integrationBehaviorInput } from "./integration-behavior-input";

export type WriteOperationName = "set_occurrence_status" | "update_occurrence_note" | "create_behavior" |
  "update_behavior" | "archive_behavior" | "restore_behavior";
export type WriteOperationResult<N extends WriteOperationName> =
  | { ok: true; value: IntegrationOperationOutput<N> }
  | { ok: false; error: IntegrationError };

class WriteError extends Error {
  constructor(readonly contractError: IntegrationError) { super(contractError.code); }
}
const fail = (code: IntegrationError["code"], message: string): never => { throw new WriteError(createIntegrationError(code, message)); };

export function integrationWriteHash(name: WriteOperationName, value: unknown): string {
  return createHash("sha256").update(canonical({ name, input: value })).digest("hex");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .filter(([key, item]) => key !== "idempotency_key" && item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function outputFromSnapshot(name: WriteOperationName, snapshot: IntegrationWriteSnapshot) {
  if (name === "set_occurrence_status" || name === "update_occurrence_note") {
    if (!snapshot.occurrence) throw new Error("Missing occurrence receipt.");
    const occurrence = serializeIntegrationOccurrence(snapshot.occurrence, snapshot.behavior,
      Temporal.Instant.from(snapshot.as_of), snapshot.timezone);
    return name === "set_occurrence_status"
      ? { occurrence, previous_status: snapshot.previous_status, changed: snapshot.changed }
      : { occurrence, changed: snapshot.changed };
  }
  const behavior = serializeIntegrationBehavior(snapshot.behavior, snapshot.external_ref);
  return name === "create_behavior" ? { behavior } : { behavior, changed: snapshot.changed };
}

async function performWrite<N extends WriteOperationName>(
  name: N, context: IntegrationContext, input: IntegrationOperationInput<N>,
  writer: ReturnType<typeof createIntegrationWriteClient>,
) {
  const supabase = writer.client;
  const { userId } = context;
  const recordedAt = context.now.toISOString();
  if (name === "set_occurrence_status") {
    const value = input as IntegrationOperationInput<"set_occurrence_status">;
    await applyOccurrenceStatusTransition(supabase, userId, {
      occurrenceId: value.occurrence_id, nextStatus: value.status, expectedStatus: value.expected_status,
      now: Temporal.Instant.from(recordedAt), sourceCaptureMethod: "manual_text",
    });
  } else if (name === "update_occurrence_note") {
    const value = input as IntegrationOperationInput<"update_occurrence_note">;
    const current = await getOccurrenceById(supabase, userId, value.occurrence_id);
    if (!current) return fail("not_found", "This Occurrence does not exist in your account.");
    checkRevision(value.expected_revision, current.updated_at);
    await updateOccurrenceNote(supabase, userId, {
      occurrenceId: current.id, expectedNote: current.note ?? "", note: value.note,
      persistNote: async plan => await writer.execute("update_occurrence_note", {
        ...plan, expectedUpdatedAt: current.updated_at,
      }) as unknown as Occurrence,
    });
  } else if (name === "create_behavior") {
    const value = input as IntegrationOperationInput<"create_behavior">;
    const values = integrationBehaviorInput(value);
    await checkCategory(context, values.categoryId);
    await createBehaviorForUser(supabase, userId, values, recordedAt);
  } else {
    const value = input as IntegrationOperationInput<"update_behavior"> | IntegrationOperationInput<"archive_behavior"> | IntegrationOperationInput<"restore_behavior">;
    const current = await getBehaviorById(supabase, userId, value.behavior_id);
    if (!current) return fail("not_found", "This Behavior does not exist in your account.");
    checkRevision(value.expected_revision, current.updated_at);
    if (name === "update_behavior") {
      const values = integrationBehaviorInput(value as IntegrationOperationInput<"update_behavior">,
        serializeIntegrationBehavior(current, null));
      await checkCategory(context, values.categoryId);
      await updateBehaviorForUser(supabase, userId, {
        behaviorId: current.id, values, expectedUpdatedAt: current.updated_at,
      }, recordedAt);
    } else {
      await setBehaviorActiveForUser(supabase, userId, {
        behaviorId: current.id, active: name === "restore_behavior", expectedUpdatedAt: current.updated_at,
        archiveNote: "archive_note" in value ? value.archive_note : undefined,
      }, recordedAt);
    }
  }
}

function checkRevision(expected: string | undefined, actual: string) {
  if (expected !== undefined && expected !== integrationInstant(actual)) {
    fail("conflict", "This record changed. Read it again before saving.");
  }
}
async function checkCategory(context: IntegrationContext, categoryId: string | null) {
  if (categoryId && !(await listBehaviorCategories(context.supabase, context.userId)).some(category => category.id === categoryId)) {
    fail("not_found", "Choose a category from this account.");
  }
}

function mapError(error: unknown): IntegrationError {
  if (error instanceof WriteError) return error.contractError;
  if (error instanceof BehaviorValidationError) return createIntegrationError("invalid_input", "Check the Behavior fields.", {
    fieldErrors: Object.entries(error.fieldErrors).map(([path, message]) => ({ path: `$.${path}`, message })),
  });
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message === "integration_idempotency_key_reused") return createIntegrationError("idempotency_key_reused", "Use a new key for different input.");
  if (message === "integration_insufficient_scope") return createIntegrationError("insufficient_scope", "Reconnect Cadence and allow this write permission.");
  if (message === "integration_external_ref_conflict") return createIntegrationError("invalid_input", "This external reference already belongs to another Behavior.");
  if (message === "integration_not_found" || message === "Occurrence not found." || message === "Behavior not found.") {
    return createIntegrationError("not_found", "This record does not exist in your account.");
  }
  if (message === "integration_conflict" || message === "Behavior schedule graph changed after it was read." ||
      message === "Occurrence status changed. Review the latest status and try again." ||
      message === "This note changed elsewhere. Review the latest note before saving again.") {
    return createIntegrationError("conflict", "This record changed. Read it again before saving.");
  }
  return createIntegrationError("internal_error", "Cadence could not finish this request. Retry with the same idempotency key.");
}

export async function executeIntegrationWrite<N extends WriteOperationName>(
  name: N, context: IntegrationContext, raw: unknown,
  scopeError = checkOperationScope(name, context.actor.grantedScopes),
): Promise<WriteOperationResult<N>> {
  let claim: { idempotencyKey: string; requestHash: string } | undefined;
  let committed = false;
  let recover = false;
  try {
    if (scopeError) throw new WriteError(scopeError);
    const validated = validateOperationInput(name, raw);
    if (!validated.ok) throw new WriteError(validated.error);
    const input = validated.value;
    const requestHash = integrationWriteHash(name, input);
    let snapshot: IntegrationWriteSnapshot | undefined;
    if (input.idempotency_key) {
      const key = { idempotencyKey: input.idempotency_key, requestHash };
      const result = await beginIdempotentWrite(context.supabase, { ...key, operation: name });
      if (result.state === "mismatch") fail("idempotency_key_reused", "Use a new key for different input.");
      if (result.state === "in_progress") fail("service_unavailable", "This write is still running. Retry with the same key shortly.");
      if (result.state === "replay") {
        snapshot = readIntegrationWriteSnapshot(result.result);
        committed = true;
        recover = true;
        await recordIntegrationActivity(context.supabase, { operation: name,
          targetIds: [snapshot.occurrence?.id ?? snapshot.behavior.id], outcome: "success", errorCode: null });
      } else claim = key;
    }
    if (!snapshot) {
      const writer = createIntegrationWriteClient(context.supabase, {
        operation: name, key: input.idempotency_key, hash: requestHash, asOf: context.now.toISOString(),
        externalRef: "external_ref" in input ? input.external_ref : undefined,
      });
      try { await performWrite(name, context, input, writer); }
      catch (error) { if (!writer.getSnapshot()) throw error; recover = true; }
      snapshot = writer.getSnapshot();
      if (!snapshot) throw new Error("No committed integration receipt.");
      committed = true;
    }
    if (recover) {
      if (name.includes("behavior")) {
        await syncBehaviorGraphForUser(context.supabase, context.userId,
          name === "create_behavior" ? "create" : name === "update_behavior" ? "update" : name === "archive_behavior" ? "archive" : "restore");
      } else if (name === "set_occurrence_status" && snapshot.occurrence?.status === "unresolved") {
        const current = await getOccurrenceById(context.supabase, context.userId, snapshot.occurrence.id);
        if (current?.status === "unresolved") await repairClearedDecisionReminderCoverage(context.supabase, context.userId, {
          occurrence: current, timezone: snapshot.behavior.timezone, now: Temporal.Instant.from(context.now.toISOString()),
        });
      }
    }
    invalidateBehaviorData(context.userId);
    revalidatePath("/timeline");
    if (name.includes("behavior") && name !== "create_behavior") revalidatePath("/behaviors");
    const output = validateOperationOutput(name, outputFromSnapshot(name, snapshot));
    if (!output.ok) throw new WriteError(output.error);
    return { ok: true, value: output.value };
  } catch (error) {
    const mapped = mapError(error);
    try {
      if (claim && !committed) await releaseIdempotentWrite(context.supabase, claim);
      await recordIntegrationActivity(context.supabase, {
        operation: name, targetIds: [], errorCode: mapped.code,
        outcome: mapped.code === "insufficient_scope" ? "denied" : mapped.code === "invalid_input" ? "invalid"
          : mapped.code === "conflict" || mapped.code === "idempotency_key_reused" ? "conflict" : "error",
      });
    } catch {
      return { ok: false, error: createIntegrationError("internal_error", "Cadence could not record this attempt. Retry with the same idempotency key.") };
    }
    return { ok: false, error: mapped };
  }
}
