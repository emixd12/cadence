import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { revalidatePath } from "next/cache";
import {
  checkOperationScope, createIntegrationError, INTEGRATION_LIMITS, validateOperationInput, validateOperationOutput,
  type BehaviorOutput, type IntegrationError, type IntegrationOperationInput, type IntegrationOperationOutput,
} from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import {
  beginIdempotentWrite, completeIdempotentWrite, findExternalReference, linkExternalReference, listExternalReferences,
  releaseIdempotentWrite, recordIntegrationActivity,
} from "@/lib/db/integration.repo";
import { createIntegrationWriteClient, readIntegrationWriteSnapshot, type IntegrationWriteSnapshot } from "@/lib/db/integration-write.repo";
import { getBehaviorById, getProfileTimezone, listBehaviorCategories, listUserBehaviors, type BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import { getOccurrenceById } from "@/lib/db/occurrences.repo";
import { readIntegrationOccurrences } from "@/lib/db/integration-read.repo";
import type { Json } from "@/lib/db/database.types";
import {
  applyBehaviorRunActionForUser, createBehaviorForUser, createBehaviorGroupForUser, reorderSubBehaviorsForUser,
  updateBehaviorForUser, setBehaviorActiveForUser, syncBehaviorGraphForUser,
} from "@/lib/services/behavior.service";
import {
  BehaviorRunStateError, SubBehaviorLinkError, toSubBehaviorLinkFacts, type BehaviorRunAction,
} from "@cadence/core/services/behavior.service";
import { validateSubBehaviorLink } from "@cadence/core/resolvers/sub-behavior.resolver";
import { effectiveStartAt } from "@cadence/core/resolvers/time.resolver";
import { resolvePersistedTimeline } from "@cadence/core/services/timeline.service";
import { DEFAULT_TIMEZONE } from "@cadence/core/types/recurrence";
import {
  applyOccurrenceStatusTransition, applyParentSlotStatusTransition, updateOccurrenceNote, repairClearedDecisionReminderCoverage,
} from "@/lib/services/occurrence.service";
import { BehaviorValidationError } from "@/lib/services/behavior-form";
import {
  integrationInstant, serializeIntegrationBehavior, serializeIntegrationOccurrence, serializeIntegrationParentGroup, subBehaviorsOf,
} from "@/lib/services/integration-read-serialization";
import { invalidateBehaviorData } from "@/lib/cache/stable-user-data.cache";
import type { Occurrence } from "@/lib/types/database";
import { integrationBehaviorInput } from "./integration-behavior-input";
import { resolveDayNoteUpdate } from "@cadence/core/resolvers/day-note.resolver";

export type WriteOperationName = "set_occurrence_status" | "set_parent_occurrence_status" | "update_occurrence_note" |
  "update_day_note" | "create_behavior" | "update_behavior" | "archive_behavior" | "restore_behavior" | RunOperationName;
type RunOperationName = "end_behavior" | "pause_behavior" | "resume_behavior";
export type WriteOperationResult<N extends WriteOperationName> =
  | { ok: true; value: IntegrationOperationOutput<N> }
  | { ok: false; error: IntegrationError };

class WriteError extends Error {
  constructor(readonly contractError: IntegrationError) { super(contractError.code); }
}
const fail = (code: IntegrationError["code"], message: string): never => { throw new WriteError(createIntegrationError(code, message)); };

export function integrationWriteHash(
  name: WriteOperationName | "move_occurrence_for_day" | "revert_occurrence_move"
    | "add_opportunity_occurrence" | "remove_opportunity_occurrence", value: unknown,
): string {
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
  // Behaviors with sub-behaviors take the direct path, so a snapshot's Behavior has none.
  if (name === "set_occurrence_status" || name === "update_occurrence_note") {
    if (!snapshot.occurrence) throw new Error("Missing occurrence receipt.");
    const occurrence = serializeIntegrationOccurrence(snapshot.occurrence, snapshot.behavior,
      Temporal.Instant.from(snapshot.as_of), snapshot.timezone);
    return name === "set_occurrence_status"
      ? { occurrence, previous_status: snapshot.previous_status, changed: snapshot.changed }
      : { occurrence, changed: snapshot.changed };
  }
  const behavior = serializeIntegrationBehavior(snapshot.behavior, snapshot.external_ref, Temporal.Instant.from(snapshot.as_of));
  return name === "create_behavior" ? { behavior } : { behavior, changed: snapshot.changed };
}

function readWriteOutput(name: WriteOperationName, receipt: unknown): IntegrationOperationOutput<WriteOperationName> {
  if (receipt && typeof receipt === "object" && "version" in receipt && receipt.version === 2 &&
      "output_json" in receipt && typeof receipt.output_json === "string") return JSON.parse(receipt.output_json);
  return outputFromSnapshot(name, readIntegrationWriteSnapshot(receipt));
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
    let fallback: BehaviorOutput["schedules"] = [];
    if (value.parent_behavior_id) {
      const behaviors = await listUserBehaviors(context.supabase, userId);
      checkLink(behaviors, "", value.parent_behavior_id);
      fallback = serializeIntegrationBehavior(behaviors.find((row) => row.id === value.parent_behavior_id)!, null).schedules;
    }
    const values = integrationBehaviorInput(value, undefined, fallback);
    await checkCategory(context, values.categoryId);
    await createBehaviorForUser(supabase, userId, values, recordedAt);
  } else if (name === "end_behavior" || name === "pause_behavior" || name === "resume_behavior") {
    const value = input as IntegrationOperationInput<RunOperationName>;
    const current = await getBehaviorById(supabase, userId, value.behavior_id);
    if (!current) return fail("not_found", "This Behavior does not exist in your account.");
    checkRevision(value.expected_revision, current.updated_at);
    await applyBehaviorRunActionForUser(supabase, userId, {
      behaviorId: current.id, action: runAction(name, value), expectedUpdatedAt: current.updated_at,
    }, recordedAt);
  } else {
    const value = input as IntegrationOperationInput<"update_behavior"> | IntegrationOperationInput<"archive_behavior"> | IntegrationOperationInput<"restore_behavior">;
    const current = await getBehaviorById(supabase, userId, value.behavior_id);
    if (!current) return fail("not_found", "This Behavior does not exist in your account.");
    checkRevision(value.expected_revision, current.updated_at);
    if (name === "update_behavior") {
      const update = value as IntegrationOperationInput<"update_behavior">;
      if (!hasDefinitionChange(update)) return;
      if (update.parent_behavior_id !== undefined && update.parent_behavior_id !== (current.parent_behavior_id ?? null)) {
        checkLink(await listUserBehaviors(context.supabase, userId), current.id, update.parent_behavior_id);
      }
      const values = integrationBehaviorInput(update, serializeIntegrationBehavior(current, null));
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

function runAction(name: RunOperationName, input: IntegrationOperationInput<RunOperationName>): BehaviorRunAction {
  if (name === "end_behavior") return { kind: "end_now" };
  if (name === "resume_behavior") return { kind: "resume" };
  const pause = input as IntegrationOperationInput<"pause_behavior">;
  return { kind: "pause", pause: { fromOn: pause.from_on, fromTime: pause.from_time ?? null, backOn: pause.back_on } };
}

function replayTargetIds(replay: IntegrationOperationOutput<WriteOperationName>): string[] {
  if ("occurrences" in replay) return replay.occurrences.map((occurrence) => occurrence.id);
  if ("occurrence" in replay) return [replay.occurrence.id];
  if ("behavior" in replay) return [replay.behavior.id];
  return replay.day_note ? [replay.day_note.id] : [];
}

// ------------------------------------------------------------- direct writes

/**
 * Sub-behavior writes (contract 1.7.0) that span several Behaviors or Occurrences run
 * outside `integration_apply_write`, which binds one record per call. They follow the
 * day-note pattern: the claim from `beginIdempotentWrite`, the product transaction as the
 * grant's user, then a version 2 receipt with the exact output.
 */
/** The activity log keeps at most 25 target ids per entry. */
const MAX_ACTIVITY_TARGETS = 25;
type DirectWriteResult = { output: unknown; targetIds: string[] };
type BehaviorTargetName = "update_behavior" | "archive_behavior" | "restore_behavior" | RunOperationName;
const BEHAVIOR_TARGET_NAMES: readonly WriteOperationName[] = [
  "update_behavior", "archive_behavior", "restore_behavior", "end_behavior", "pause_behavior", "resume_behavior",
];
const DEFINITION_FIELDS = [
  "title", "description", "location_text", "category_id", "schedules", "reminders", "default_duration_minutes",
  "end_on", "end_time", "end_date", "is_opportunity", "parent_behavior_id", "inherit_parent_schedule",
] as const;

function hasDefinitionChange(input: IntegrationOperationInput<"update_behavior">): boolean {
  return DEFINITION_FIELDS.some((field) => input[field] !== undefined);
}

async function usesDirectWrite(name: WriteOperationName, context: IntegrationContext, input: unknown): Promise<boolean> {
  if (name === "set_parent_occurrence_status") return true;
  if (name === "create_behavior") return (input as IntegrationOperationInput<"create_behavior">).sub_behaviors !== undefined;
  if (!BEHAVIOR_TARGET_NAMES.includes(name)) return false;
  if (name === "update_behavior" && (input as IntegrationOperationInput<"update_behavior">).sub_behavior_sort_order !== undefined) return true;
  // A parent's edits, archive, restore and run actions also write its sub-behaviors.
  const behaviorId = (input as { behavior_id: string }).behavior_id;
  return (await listUserBehaviors(context.supabase, context.userId)).some((row) => row.parent_behavior_id === behaviorId);
}

/** Maps a rejected link to the contract: a missing parent is not_found, the rest depend on account state. */
function checkLink(behaviors: readonly BehaviorWithCategory[], behaviorId: string, parentId: string | null) {
  const result = validateSubBehaviorLink({
    behaviorId, nextParentBehaviorId: parentId, behaviors: behaviors.map(toSubBehaviorLinkFacts),
  });
  if (result.ok) return;
  if (result.reason === "parent_not_found") fail("not_found", "The parent Behavior does not exist in your account.");
  if (result.reason === "self_parent") fail("invalid_input", "A Behavior can't be its own parent.");
  fail("invalid_state", result.message);
}

async function performDirectWrite(
  name: WriteOperationName, context: IntegrationContext, input: unknown, committed: () => void,
): Promise<DirectWriteResult> {
  if (name === "set_parent_occurrence_status") {
    return writeParentSlotStatus(context, input as IntegrationOperationInput<"set_parent_occurrence_status">, committed);
  }
  if (name === "create_behavior") {
    return createBehaviorGroup(context, input as IntegrationOperationInput<"create_behavior">, committed);
  }
  return writeBehaviorWithSubBehaviors(name as BehaviorTargetName, context, input as IntegrationOperationInput<BehaviorTargetName>, committed);
}

async function serializeBehaviors(context: IntegrationContext, ids: readonly string[]) {
  const behaviors = await listUserBehaviors(context.supabase, context.userId);
  const refs = await listExternalReferences(context.supabase, { entityType: "behavior", entityIds: [...ids] });
  const now = Temporal.Instant.from(context.now.toISOString());
  return ids.map((id) => {
    const row = behaviors.find((behavior) => behavior.id === id);
    if (!row) throw new Error("Behavior not found after write.");
    return serializeIntegrationBehavior(row, refs.get(id) ?? null, now, subBehaviorsOf(id, behaviors));
  });
}

async function createBehaviorGroup(
  context: IntegrationContext, input: IntegrationOperationInput<"create_behavior">, committed: () => void,
): Promise<DirectWriteResult> {
  const { sub_behaviors: items = [], ...parentInput } = input;
  const parent = integrationBehaviorInput(parentInput);
  await checkCategory(context, parent.categoryId);
  const refs = [input.external_ref, ...items.map((item) => item.external_ref)];
  for (const ref of refs) {
    if (ref && await findExternalReference(context.supabase, { entityType: "behavior", externalId: ref })) {
      fail("invalid_input", "This external reference already belongs to another Behavior.");
    }
  }
  const subBehaviors = items.map((item, index) => ({
    ...integrationBehaviorInput({
      title: item.title, description: item.description, category_id: input.category_id, schedules: item.schedules,
    }, undefined, input.schedules ?? []),
    inheritParentSchedule: item.inherit_parent_schedule ?? true,
    subBehaviorSortOrder: item.sub_behavior_sort_order ?? index,
  }));
  const created = await createBehaviorGroupForUser(context.supabase, context.userId, { parent, subBehaviors },
    context.now.toISOString());
  committed();
  const ids = [created.parent.id, ...created.subBehaviors.map((row) => row.id)];
  // A reference taken by a concurrent write stays unlinked; the Behavior shows external_ref null.
  await Promise.all(refs.map((ref, index) => ref
    ? linkExternalReference(context.supabase, { entityType: "behavior", entityId: ids[index]!, externalId: ref })
    : null));
  const [behavior, ...children] = await serializeBehaviors(context, ids);
  return { output: { behavior, sub_behaviors: children }, targetIds: ids };
}

async function writeBehaviorWithSubBehaviors(
  name: BehaviorTargetName, context: IntegrationContext, input: IntegrationOperationInput<BehaviorTargetName>,
  committed: () => void,
): Promise<DirectWriteResult> {
  const before = await getBehaviorById(context.supabase, context.userId, input.behavior_id);
  if (!before) return fail("not_found", "This Behavior does not exist in your account.");
  checkRevision(input.expected_revision, before.updated_at);
  const update = name === "update_behavior" ? input as IntegrationOperationInput<"update_behavior"> : null;
  const plannedOrder = update?.sub_behavior_sort_order;
  if (plannedOrder !== undefined) {
    const nextParent = update!.parent_behavior_id !== undefined ? update!.parent_behavior_id : before.parent_behavior_id ?? null;
    if (!nextParent) fail("invalid_state", "Only a sub-behavior has a position. Send parent_behavior_id to group it first.");
    if (!before.active) fail("invalid_state", "Restore this sub-behavior before moving it.");
  }
  const noOp = (name === "archive_behavior" && !before.active) || (name === "restore_behavior" && before.active);
  if (!noOp) {
    await performWrite(name, context, input, {
      client: context.supabase,
      execute: async () => { throw new Error("Direct writes do not run per-record integration RPCs."); },
      getReceipt: () => undefined,
    } as unknown as ReturnType<typeof createIntegrationWriteClient>);
    committed();
  }
  let reordered = 0;
  if (plannedOrder !== undefined) {
    const behaviors = await listUserBehaviors(context.supabase, context.userId);
    const target = behaviors.find((row) => row.id === before.id)!;
    const parentId = target.parent_behavior_id!;
    const siblings = subBehaviorsOf(parentId, behaviors).filter((row) => !row.archived_at && row.id !== target.id).map((row) => row.id);
    siblings.splice(Math.min(plannedOrder, siblings.length), 0, target.id);
    reordered = await reorderSubBehaviorsForUser(context.supabase, context.userId, { parentBehaviorId: parentId, orderedBehaviorIds: siblings });
    committed();
  }
  const after = await getBehaviorById(context.supabase, context.userId, before.id);
  if (!after) throw new Error("Behavior not found after write.");
  const [behavior] = await serializeBehaviors(context, [before.id]);
  return { output: { behavior, changed: reordered > 0 || after.updated_at !== before.updated_at }, targetIds: [before.id] };
}

async function writeParentSlotStatus(
  context: IntegrationContext, input: IntegrationOperationInput<"set_parent_occurrence_status">, committed: () => void,
): Promise<DirectWriteResult> {
  const { supabase, userId } = context;
  const now = Temporal.Instant.from(context.now.toISOString());
  const behaviors = await listUserBehaviors(supabase, userId);
  const parent = behaviors.find((row) => row.id === input.parent_behavior_id);
  if (!parent) return fail("not_found", "This Behavior does not exist in your account.");
  if (parent.parent_behavior_id) fail("invalid_state", "This Behavior is a sub-behavior. Name its parent, or use set_occurrence_status.");
  const children = subBehaviorsOf(parent.id, behaviors);
  if (children.length === 0) fail("invalid_state", "This Behavior has no sub-behaviors. Use set_occurrence_status.");
  const childOrder = new Map(children.map((row, index) => [row.id, index]));
  const slotOf = (row: Occurrence) => integrationInstant(effectiveStartAt(row));

  let targets: Occurrence[];
  if (input.occurrence_ids) {
    const rows = await Promise.all(input.occurrence_ids.map((id) => getOccurrenceById(supabase, userId, id)));
    if (rows.some((row) => !row)) fail("not_found", "This Occurrence does not exist in your account.");
    targets = rows as Occurrence[];
    if (targets.some((row) => !childOrder.has(row.behavior_id))) {
      fail("invalid_input", "Every Occurrence must belong to a sub-behavior of this parent.");
    }
    const dates = new Set(targets.map((row) => row.local_date));
    if (dates.size > 1 || (input.local_date && !dates.has(input.local_date))) {
      fail("invalid_input", "A parent slot covers one local day. Send Occurrences from local_date only.");
    }
    if (input.slot_key && targets.some((row) => slotOf(row) !== integrationInstant(input.slot_key!))) {
      fail("invalid_input", "Every Occurrence must sit in the slot named by slot_key.");
    }
  } else {
    const day = (await readIntegrationOccurrences(supabase, userId, { startLocalDate: input.local_date!, endLocalDate: input.local_date! }))
      .filter((row) => childOrder.has(row.behavior_id));
    targets = input.slot_key ? day.filter((row) => slotOf(row) === integrationInstant(input.slot_key!)) : day;
    if (!input.slot_key && new Set(targets.map(slotOf)).size > 1) {
      fail("invalid_input", "This parent has more than one time on that day. Send slot_key from get_timeline parent_groups, or occurrence_ids.");
    }
    if (targets.length === 0) fail("not_found", "This parent has no sub-behavior Occurrences in that slot.");
  }
  if (targets.length > INTEGRATION_LIMITS.maxParentSlotOccurrences) {
    fail("invalid_input", `A parent slot mark changes at most ${INTEGRATION_LIMITS.maxParentSlotOccurrences} Occurrences.`);
  }
  const targetIds = new Set(targets.map((row) => row.id));
  const expectedStatuses = input.expected_statuses
    ? Object.fromEntries(input.expected_statuses.map((entry) => {
      if (!targetIds.has(entry.occurrence_id)) fail("invalid_input", "expected_statuses names an Occurrence outside this slot.");
      return [entry.occurrence_id, entry.status];
    }))
    : undefined;

  const results = await applyParentSlotStatusTransition(supabase, userId, {
    parentBehaviorId: parent.id, occurrenceIds: [...targetIds], nextStatus: input.status, now, expectedStatuses,
    sourceCaptureMethod: "manual_text",
  });
  committed();

  const localDate = targets[0]!.local_date;
  const timezone = (await getProfileTimezone(supabase, userId)) ?? DEFAULT_TIMEZONE;
  const dayRows = (await readIntegrationOccurrences(supabase, userId, { startLocalDate: localDate, endLocalDate: localDate }))
    .filter((row) => childOrder.has(row.behavior_id));
  const byBehavior = new Map(behaviors.map((row) => [row.id, row]));
  const marked = dayRows.filter((row) => targetIds.has(row.id)).sort((left, right) =>
    childOrder.get(left.behavior_id)! - childOrder.get(right.behavior_id)! || slotOf(left).localeCompare(slotOf(right)));
  const timeline = resolvePersistedTimeline({
    behaviors, occurrences: dayRows, timeSessions: [], now, timezone, startLocalDate: localDate, futureDays: 0,
  });
  const groups = new Map<string, ReturnType<typeof serializeIntegrationParentGroup>>();
  for (const section of [...timeline.daySections, ...timeline.needsDecision.daySections]) {
    for (const group of section.parentGroups) {
      const output = serializeIntegrationParentGroup(group);
      const slot = `${output.local_date}/${output.slot_key}`;
      if (!groups.has(slot) && group.children.some((child) => targetIds.has(child.id))) groups.set(slot, output);
    }
  }
  const changedIds = results.filter((result) => result.statusChanged).map((result) => result.occurrence.id);
  return {
    output: {
      parent_behavior_id: parent.id,
      status: input.status,
      occurrences: marked.map((row) => serializeIntegrationOccurrence(row, byBehavior.get(row.behavior_id)!, now, timezone,
        { id: parent.id, title: parent.title })),
      changed_occurrence_ids: changedIds,
      parent_groups: [...groups.values()],
      changed: changedIds.length > 0,
    },
    targetIds: [parent.id, ...targetIds],
  };
}

/** Day notes have no Behavior or Occurrence graph; the transaction builds its own receipt. */
async function applyDayNoteWrite(
  context: IntegrationContext, input: IntegrationOperationInput<"update_day_note">, requestHash: string,
): Promise<unknown> {
  const plan = resolveDayNoteUpdate({ localDate: input.local_date, expectedNote: "", note: input.note });
  const { data, error } = await context.supabase.rpc("integration_apply_day_note_write", {
    p_key: (input.idempotency_key ?? null) as string, p_hash: requestHash, p_local_date: plan.localDate,
    p_note: plan.note as string, p_expected_revision: (input.expected_revision ?? null) as string,
  });
  if (error) throw Object.assign(new Error(error.message), error);
  if (!data || typeof data !== "object" || Array.isArray(data) || !("receipt" in data)) throw new Error("Invalid write result");
  return data.receipt;
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

const SUB_BEHAVIOR_STATE_MESSAGES = new Set([
  "A sub-behavior can't have sub-behaviors.", "A Behavior with sub-behaviors can't become a sub-behavior.",
  "An archived Behavior can't take sub-behaviors.", "Sub-behavior order must list each sub-behavior once.",
  "Every Occurrence must belong to a sub-behavior of this parent.", "A parent slot covers one local day.",
]);

function mapError(error: unknown): IntegrationError {
  if (error instanceof WriteError) return error.contractError;
  if (error instanceof BehaviorRunStateError) return createIntegrationError("invalid_state", error.message);
  if (error instanceof SubBehaviorLinkError) return createIntegrationError("invalid_state", error.message);
  if (error instanceof BehaviorValidationError) return createIntegrationError("invalid_input", "Check the Behavior fields.", {
    fieldErrors: Object.entries(error.fieldErrors).map(([path, message]) => ({ path: `$.${path}`, message })),
  });
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message === "integration_output_limit_exceeded") return createIntegrationError("limit_exceeded", "The result is larger than 100000 bytes. Narrow the request and try again.");
  if (message === "integration_idempotency_key_reused") return createIntegrationError("idempotency_key_reused", "Use a new key for different input.");
  if (message === "integration_insufficient_scope") return createIntegrationError("insufficient_scope", "Reconnect Cadence and allow this write permission.");
  if (message === "integration_external_ref_conflict") return createIntegrationError("invalid_input", "This external reference already belongs to another Behavior.");
  if (SUB_BEHAVIOR_STATE_MESSAGES.has(message)) return createIntegrationError("invalid_state", message);
  if (message === "integration_not_found" || message === "Occurrence not found." || message === "Behavior not found." ||
      message === "Parent Behavior not found.") {
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
    let receipt: unknown;
    if (input.idempotency_key) {
      const key = { idempotencyKey: input.idempotency_key, requestHash };
      const result = await beginIdempotentWrite(context.supabase, { ...key, operation: name });
      if (result.state === "mismatch") fail("idempotency_key_reused", "Use a new key for different input.");
      if (result.state === "in_progress") fail("service_unavailable", "This write is still running. Retry with the same key shortly.");
      if (result.state === "replay") {
        receipt = result.result;
        const replay = readWriteOutput(name, receipt);
        committed = true;
        recover = true;
        await recordIntegrationActivity(context.supabase, { operation: name,
          targetIds: replayTargetIds(replay).slice(0, MAX_ACTIVITY_TARGETS), outcome: "success", errorCode: null });
      } else claim = key;
    }
    if (!receipt && name === "update_day_note") {
      receipt = await applyDayNoteWrite(context, input as IntegrationOperationInput<"update_day_note">, requestHash);
      committed = true;
    }
    if (!receipt && await usesDirectWrite(name, context, input)) {
      const result = await performDirectWrite(name, context, input, () => { committed = true; });
      const checked = validateOperationOutput(name, result.output);
      if (!checked.ok) throw new WriteError(checked.error);
      receipt = { version: 2, output_json: JSON.stringify(result.output) };
      if (claim) await completeIdempotentWrite(context.supabase, { ...claim, result: receipt as Json });
      await recordIntegrationActivity(context.supabase, {
        operation: name, targetIds: result.targetIds.slice(0, MAX_ACTIVITY_TARGETS), outcome: "success", errorCode: null,
      });
    }
    if (!receipt) {
      const writer = createIntegrationWriteClient(context.supabase, {
        operation: name, key: input.idempotency_key, hash: requestHash, asOf: context.now.toISOString(),
        externalRef: "external_ref" in input ? input.external_ref : undefined,
      }, snapshot => {
        const projected = outputFromSnapshot(name, snapshot);
        const checked = validateOperationOutput(name, projected);
        // The transaction checks exact bytes after binding its generated UUIDs/revision clock.
        if (!checked.ok && checked.error.code !== "limit_exceeded") throw new WriteError(checked.error);
        return JSON.stringify(projected);
      });
      try { await performWrite(name, context, input, writer); }
      catch (error) { if (!writer.getReceipt()) throw error; recover = true; }
      receipt = writer.getReceipt();
      if (!receipt) throw new Error("No committed integration receipt.");
      committed = true;
    }
    const projected = readWriteOutput(name, receipt);
    if (recover) {
      if (name.includes("behavior")) {
        await syncBehaviorGraphForUser(context.supabase, context.userId,
          name === "create_behavior" ? "create" : name === "update_behavior" ? "update" : name === "archive_behavior" ? "archive"
            : name === "restore_behavior" ? "restore" : "run");
      } else if (name === "set_occurrence_status" && "occurrence" in projected && projected.occurrence.status === "unresolved") {
        const current = await getOccurrenceById(context.supabase, context.userId, projected.occurrence.id);
        if (current?.status === "unresolved") await repairClearedDecisionReminderCoverage(context.supabase, context.userId, {
          occurrence: current, timezone: projected.occurrence.timezone, now: Temporal.Instant.from(context.now.toISOString()),
        });
      }
    }
    invalidateBehaviorData(context.userId);
    revalidatePath("/timeline");
    if (name.includes("behavior") && name !== "create_behavior") revalidatePath("/behaviors");
    const output = validateOperationOutput(name, projected);
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
