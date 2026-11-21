import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { revalidatePath } from "next/cache";
import {
  checkOperationScope, createIntegrationError, validateOperationInput, validateOperationOutput,
  type IntegrationError, type IntegrationOperationInput, type IntegrationOperationOutput,
} from "@cadence/core/integration";
import { noticeText, type NoticeId } from "@cadence/core/notices";
import { zonedInstant } from "@cadence/core/resolvers/time.resolver";
import { MOVE_ALTERNATIVES_LIMIT, type MoveCalendarBusy } from "@cadence/core/resolvers/move.resolver";
import { briefMoveFreeStarts, briefMoveItemBlocks, checkBriefMoveSlot, type BriefMoveBlock } from "@cadence/core/resolvers/brief-move.resolver";
import { BRIEF_MOVE_FALLBACK_MINUTES } from "@cadence/core/types/brief-moves";
import type { OpportunityAddedBy } from "@cadence/core/types/database";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { getBehaviorById, type BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import { getOccurrenceById } from "@/lib/db/occurrences.repo";
import { getProfileSettings } from "@/lib/db/profiles.repo";
import { beginIdempotentWrite, completeIdempotentWrite, recordIntegrationActivity, releaseIdempotentWrite } from "@/lib/db/integration.repo";
import { invalidateBehaviorData } from "@/lib/cache/stable-user-data.cache";
import { readBriefMoveDay } from "@/lib/services/brief-move-day.service";
import { integrationInstant, serializeIntegrationOccurrence } from "@/lib/services/integration-read-serialization";
import { integrationWriteHash } from "@/lib/services/integration-write.service";
import {
  addOpportunityToToday, removeOpportunityFromToday, type OpportunityCaller, type OpportunityPlacement,
} from "@/lib/services/opportunity.service";
import type { Occurrence } from "@/lib/types/database";

/**
 * MCP and chat path for Behaviors of Opportunity (contract 1.6.0). Both tools go
 * through opportunity.service.ts, so the hosted functions keep every rule. This
 * handler adds idempotent replay, the caller's provenance (`mcp` or `chat`) and, for
 * first-party callers that pass today's calendar, the shared free-slot check.
 */

export type OpportunityOperationName = "add_opportunity_occurrence" | "remove_opportunity_occurrence";
export type OpportunityOperationResult<N extends OpportunityOperationName> =
  | { ok: true; value: IntegrationOperationOutput<N> }
  | { ok: false; error: IntegrationError };

export type OpportunityOperationOptions = Readonly<{
  /** First-party callers only (chat): today's busy calendar times. Turns on the free-slot check. */
  calendarBusy?: readonly MoveCalendarBusy[];
}>;

type AddOutput = IntegrationOperationOutput<"add_opportunity_occurrence">;
type RemoveOutput = IntegrationOperationOutput<"remove_opportunity_occurrence">;

class OpportunityWriteError extends Error {
  constructor(readonly contractError: IntegrationError) { super(contractError.code); }
}
const fail = (code: IntegrationError["code"], message: string): never => {
  throw new OpportunityWriteError(createIntegrationError(code, message));
};

export async function executeOpportunityWrite<N extends OpportunityOperationName>(
  name: N, context: IntegrationContext, raw: unknown,
  scopeError = checkOperationScope(name, context.actor.grantedScopes),
  options: OpportunityOperationOptions = {},
): Promise<OpportunityOperationResult<N>> {
  let claim: { idempotencyKey: string; requestHash: string } | undefined;
  let committed = false;
  try {
    if (scopeError) throw new OpportunityWriteError(scopeError);
    const validated = validateOperationInput(name, raw);
    if (!validated.ok) throw new OpportunityWriteError(validated.error);
    const input = validated.value as IntegrationOperationInput<OpportunityOperationName>;
    const requestHash = integrationWriteHash(name, input);
    if (input.idempotency_key) {
      const key = { idempotencyKey: input.idempotency_key, requestHash };
      const started = await beginIdempotentWrite(context.supabase, { ...key, operation: name });
      if (started.state === "mismatch") fail("idempotency_key_reused", "Use a new key for different input.");
      if (started.state === "in_progress") fail("service_unavailable", "This write is still running. Retry with the same key shortly.");
      if (started.state === "replay") {
        const replay = readReceipt(started.result) as IntegrationOperationOutput<N>;
        await recordIntegrationActivity(context.supabase, { operation: name, targetIds: targetIds(replay), outcome: "success", errorCode: null });
        return { ok: true, value: replay };
      }
      claim = key;
    }

    const caller: OpportunityCaller = { supabase: context.supabase, userId: context.userId, now: Temporal.Instant.from(context.now.toISOString()) };
    const projected = name === "add_opportunity_occurrence"
      ? await addOpportunity(context, caller, input as IntegrationOperationInput<"add_opportunity_occurrence">, options)
      : await removeOpportunity(context, caller, input as IntegrationOperationInput<"remove_opportunity_occurrence">);
    const output = validateOperationOutput(name, projected);
    if (!output.ok) throw new OpportunityWriteError(output.error);
    committed = projected.outcome !== "refused";
    if (claim) await completeIdempotentWrite(context.supabase, { ...claim, result: { version: 2, output_json: JSON.stringify(output.value) } });
    claim = undefined;
    const refusal = projected.refusal;
    await recordIntegrationActivity(context.supabase, {
      operation: name, targetIds: targetIds(projected),
      outcome: refusal ? "conflict" : "success", errorCode: refusal ? refusal.reason : null,
    });
    if (committed) {
      invalidateBehaviorData(context.userId);
      revalidatePath("/timeline");
    }
    return { ok: true, value: output.value as IntegrationOperationOutput<N> };
  } catch (error) {
    const mapped = error instanceof OpportunityWriteError ? error.contractError
      : createIntegrationError("internal_error", "Cadence could not finish this request. Retry with the same idempotency key.");
    try {
      if (claim && !committed) await releaseIdempotentWrite(context.supabase, claim);
      await recordIntegrationActivity(context.supabase, {
        operation: name, targetIds: [], errorCode: mapped.code,
        outcome: mapped.code === "insufficient_scope" ? "denied" : mapped.code === "invalid_input" ? "invalid"
          : mapped.code === "idempotency_key_reused" ? "conflict" : "error",
      });
    } catch {
      return { ok: false, error: createIntegrationError("internal_error", "Cadence could not record this attempt. Retry with the same idempotency key.") };
    }
    return { ok: false, error: mapped };
  }
}

async function addOpportunity(
  context: IntegrationContext, caller: OpportunityCaller,
  input: IntegrationOperationInput<"add_opportunity_occurrence">, options: OpportunityOperationOptions,
): Promise<AddOutput> {
  const placement = placementOf(input);
  if (options.calendarBusy && placement.kind === "exact") {
    const behavior = await getBehaviorById(caller.supabase, caller.userId, input.behavior_id);
    const taken = behavior ? await slotRefusal(caller, behavior, placement.startTime, options.calendarBusy) : null;
    if (taken) return { outcome: "refused", occurrence: null, refusal: taken };
  }
  const result = await addOpportunityToToday(caller, {
    behaviorId: input.behavior_id, placement, addedBy: addedByFor(context),
    occurrenceId: input.idempotency_key ? keyedOccurrenceId(context, input.idempotency_key) : null,
  });
  if (result.outcome === "refused") {
    const reason = result.reason === "not_running" || result.reason === "not_today" || result.reason === "invalid_time" ? result.reason : "not_available";
    return { outcome: "refused", occurrence: null, refusal: { reason, message: noticeText(result.notice.id, result.notice.params), alternatives: [] } };
  }
  return { outcome: result.outcome, occurrence: await serialize(context, caller, result.occurrence), refusal: null };
}

async function removeOpportunity(
  context: IntegrationContext, caller: OpportunityCaller,
  input: IntegrationOperationInput<"remove_opportunity_occurrence">,
): Promise<RemoveOutput> {
  const current = await getOccurrenceById(caller.supabase, caller.userId, input.occurrence_id);
  if (!current) return fail("not_found", "This Occurrence does not exist in your account.");
  const behavior = await getBehaviorById(caller.supabase, caller.userId, current.behavior_id);
  if (!behavior) return fail("not_found", "This Occurrence does not exist in your account.");
  const title = behavior.title;
  const refuse = async (reason: "scheduled" | "marked" | "kept" | "revision_changed", id: NoticeId): Promise<RemoveOutput> => ({
    outcome: "refused", occurrence: await serialize(context, caller, current, behavior),
    refusal: { reason, message: noticeText(id, { title }) },
  });
  if (current.origin !== "opportunity") return refuse("scheduled", "opportunity.remove-refused.scheduled");
  if (input.expected_revision !== undefined && input.expected_revision !== integrationInstant(current.updated_at)) {
    return refuse("revision_changed", "opportunity.remove-refused.changed");
  }
  const result = await removeOpportunityFromToday(caller, { occurrenceId: current.id, title });
  if (result.outcome === "refused") {
    if (result.reason === "not_found") return fail("not_found", "This Occurrence does not exist in your account.");
    return refuse(result.reason === "marked" ? "marked" : "kept", result.notice.id);
  }
  return { outcome: "removed", occurrence: await serialize(context, caller, result.occurrence, behavior), refusal: null };
}

function placementOf(input: IntegrationOperationInput<"add_opportunity_occurrence">): OpportunityPlacement {
  if (input.mark_completed) return { kind: "done_now" };
  if (input.preset) return { kind: "preset", preset: input.preset };
  if (input.end_time && input.start_time) return { kind: "range", startTime: input.start_time, endTime: input.end_time };
  return { kind: "exact", startTime: input.start_time ?? "" };
}

function addedByFor(context: IntegrationContext): OpportunityAddedBy {
  if (context.actor.channel === "mcp") return "mcp";
  return context.actor.channel === "daily_brief" ? "daily_brief" : "chat";
}

/** The same key always names the same new Occurrence, so a retry after a lost reply replays. */
function keyedOccurrenceId(context: IntegrationContext, key: string): string {
  const hex = createHash("sha256").update(`cadence-opportunity-v1\n${context.userId}\n${context.actor.clientId}\n${key}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The free-slot rule the brief and moves use: today's open items and busy calendar times, with the 10-minute gap. */
async function slotRefusal(
  caller: OpportunityCaller, behavior: BehaviorWithCategory, startTime: string, calendarBusy: readonly MoveCalendarBusy[],
): Promise<AddOutput["refusal"]> {
  const localDate = caller.now.toZonedDateTimeISO(behavior.timezone).toPlainDate().toString();
  let start: Temporal.Instant;
  try { start = zonedInstant(localDate, startTime, behavior.timezone); } catch { return null; }
  const day = await readBriefMoveDay(caller.supabase, caller.userId, localDate);
  const lengthSeconds = (behavior.default_duration_minutes ?? BRIEF_MOVE_FALLBACK_MINUTES) * 60;
  const blocks: BriefMoveBlock[] = [
    ...briefMoveItemBlocks(day.items, null),
    ...calendarBusy.map((event, index) => ({ kind: "calendar" as const, ref: event.ref ?? `calendar:${index}`, start: event.start, end: event.end })),
  ];
  const check = checkBriefMoveSlot({ interval: { start, end: start.add({ seconds: lengthSeconds }) }, blocks });
  if (check.ok) return null;
  const reason = check.reason === "calendar_busy" ? "calendar_busy" : "slot_taken";
  const message = noticeText(check.reason === "calendar_busy" ? "move.refused.calendar-busy"
    : check.reason === "too_close" ? "move.refused.too-close" : "move.refused.slot-taken");
  const alternatives = briefMoveFreeStarts({
    localDate, timezone: behavior.timezone, now: caller.now, near: start, lengthSeconds, blocks, limit: MOVE_ALTERNATIVES_LIMIT,
  }).map((at) => ({
    start_at: integrationInstant(at.toString()),
    start_time: at.toZonedDateTimeISO(behavior.timezone).toPlainTime().toString({ smallestUnit: "minute" }),
  }));
  return { reason, message, alternatives };
}

async function serialize(
  context: IntegrationContext, caller: OpportunityCaller, occurrence: Occurrence, known?: BehaviorWithCategory,
) {
  const behavior = known ?? await getBehaviorById(caller.supabase, caller.userId, occurrence.behavior_id);
  if (!behavior) throw new Error("Occurrence has no Behavior.");
  const profile = await getProfileSettings(context.supabase, context.userId);
  return serializeIntegrationOccurrence(occurrence, behavior, caller.now, profile?.timezone ?? behavior.timezone);
}

function readReceipt(receipt: unknown): unknown {
  if (receipt && typeof receipt === "object" && "output_json" in receipt && typeof receipt.output_json === "string") {
    return JSON.parse(receipt.output_json);
  }
  throw new Error("Invalid opportunity write receipt.");
}

function targetIds(output: Readonly<{ occurrence: Readonly<{ id: string }> | null }>): string[] {
  return output.occurrence ? [output.occurrence.id] : [];
}
