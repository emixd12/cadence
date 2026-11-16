import { Temporal } from "@js-temporal/polyfill";
import { revalidatePath } from "next/cache";
import {
  checkOperationScope, createIntegrationError, validateOperationInput, validateOperationOutput,
  type IntegrationError, type IntegrationOperationOutput,
} from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { recordIntegrationActivity } from "@/lib/db/integration.repo";
import { getProfileSettings } from "@/lib/db/profiles.repo";
import { invalidateBehaviorData } from "@/lib/cache/stable-user-data.cache";
import { integrationInstant, serializeIntegrationOccurrence } from "@/lib/services/integration-read-serialization";
import { integrationWriteHash } from "@/lib/services/integration-write.service";
import {
  OccurrenceMoveKeyReusedError, moveOccurrenceForDay, revertOccurrenceMove,
  type OccurrenceMoveRecord, type OccurrenceMoveResult,
} from "@/lib/services/occurrence-move.service";

/**
 * MCP and agent path for per-day moves (contract 1.3.0). The database functions own
 * idempotency and activity for applied, replayed and database-refused moves; this
 * handler records the refusals it decides itself (the free-slot check) and failures.
 */
export type MoveOperationName = "move_occurrence_for_day" | "revert_occurrence_move";
export type MoveOperationResult<N extends MoveOperationName> =
  | { ok: true; value: IntegrationOperationOutput<N> }
  | { ok: false; error: IntegrationError };

export async function executeOccurrenceMoveWrite<N extends MoveOperationName>(
  name: N, context: IntegrationContext, raw: unknown,
  scopeError = checkOperationScope(name, context.actor.grantedScopes),
): Promise<MoveOperationResult<N>> {
  let recorded = false;
  try {
    if (scopeError) return await failWith(context, name, scopeError);
    const validated = validateOperationInput(name, raw);
    if (!validated.ok) return await failWith(context, name, validated.error);
    const input = validated.value as {
      occurrence_id: string; expected_revision: string; start_time?: string; idempotency_key?: string;
    };
    const caller = { supabase: context.supabase, userId: context.userId, now: Temporal.Instant.from(context.now.toISOString()) };
    const requestHash = integrationWriteHash(name, input);
    const result: OccurrenceMoveResult = name === "move_occurrence_for_day"
      ? await moveOccurrenceForDay(caller, {
        occurrenceId: input.occurrence_id, expectedRevision: input.expected_revision, startTime: input.start_time,
        idempotencyKey: input.idempotency_key ?? null, requestHash,
      })
      : await revertOccurrenceMove(caller, {
        occurrenceId: input.occurrence_id, expectedRevision: input.expected_revision,
        idempotencyKey: input.idempotency_key ?? null, requestHash,
      });
    if (result.outcome === "refused" && (!result.occurrence || !result.behavior)) {
      return await failWith(context, name, createIntegrationError("not_found", "This Occurrence does not exist in your account."));
    }
    if (result.outcome === "refused" && (result.reason === "slot_taken" || result.reason === "calendar_busy")) {
      // The database recorded every other outcome itself.
      recorded = true;
      await recordIntegrationActivity(context.supabase, {
        operation: name, targetIds: [input.occurrence_id], outcome: "conflict", errorCode: result.reason,
      });
    }
    const profile = await getProfileSettings(context.supabase, context.userId);
    const timezone = profile?.timezone ?? result.behavior!.timezone;
    const occurrence = serializeIntegrationOccurrence(result.occurrence!, result.behavior!, caller.now, timezone);
    const projected = result.outcome === "refused"
      ? {
        outcome: "refused", occurrence, move: null,
        refusal: {
          reason: result.reason, message: result.message,
          alternatives: result.alternatives.map((start) => ({
            start_at: integrationInstant(start.toString()),
            start_time: start.toZonedDateTimeISO(result.behavior!.timezone).toPlainTime().toString({ smallestUnit: "minute" }),
          })),
        },
      }
      : { outcome: result.outcome, occurrence, move: serializeMoveRecord(result.move), refusal: null };
    if (result.outcome !== "refused") {
      invalidateBehaviorData(context.userId);
      revalidatePath("/timeline");
    }
    const output = validateOperationOutput(name, projected);
    if (!output.ok) throw new Error(output.error.message);
    return { ok: true, value: output.value as IntegrationOperationOutput<N> };
  } catch (error) {
    const mapped = error instanceof OccurrenceMoveKeyReusedError
      ? createIntegrationError("idempotency_key_reused", "Use a new key for different input.")
      : error instanceof Error && error.message === "integration_insufficient_scope"
        ? createIntegrationError("insufficient_scope", "Reconnect Cadence and allow this write permission.")
        : createIntegrationError("internal_error", "Cadence could not finish this request. Retry with the same idempotency key.");
    if (recorded) return { ok: false, error: mapped };
    return await failWith(context, name, mapped);
  }
}

export function serializeMoveRecord(move: OccurrenceMoveRecord) {
  return {
    id: move.id,
    kind: move.kind as "move" | "revert",
    from_start_at: integrationInstant(move.from_start_at),
    to_start_at: integrationInstant(move.to_start_at),
    to_end_at: integrationInstant(move.to_end_at),
    to_planned: move.to_planned,
    chain_position: move.chain_position,
    source: move.source as "daily_brief" | "coach" | "chat" | "mcp" | "person",
    created_at: integrationInstant(move.created_at),
  };
}

async function failWith<N extends MoveOperationName>(
  context: IntegrationContext, name: N, error: IntegrationError,
): Promise<MoveOperationResult<N>> {
  try {
    await recordIntegrationActivity(context.supabase, {
      operation: name, targetIds: [], errorCode: error.code,
      outcome: error.code === "insufficient_scope" ? "denied" : error.code === "invalid_input" ? "invalid"
        : error.code === "idempotency_key_reused" ? "conflict" : "error",
    });
  } catch {
    return { ok: false, error: createIntegrationError("internal_error", "Cadence could not record this attempt. Retry with the same idempotency key.") };
  }
  return { ok: false, error };
}
