import type { Temporal } from "@js-temporal/polyfill";

import type { OccurrenceDataStore, StatusTransitionCommit } from "../data-store";
import { planParentSlotStatusChange } from "../resolvers/sub-behavior.resolver";
import type { OccurrenceStatus } from "../types/database";
import { resolveReminderDeliveryCancellation } from "../resolvers/reminder.resolver";
import {
  MarkDetailRefusal,
  resolveDoneAtDetail,
  resolveNotDoneReasonDetail,
  resolveExpectedNote,
  resolveNoteUpdate,
  resolveStatusEvent,
  resolveStatusTransition,
} from "../resolvers/status.resolver";

export async function applyOccurrenceStatusTransition(
  store: Pick<OccurrenceDataStore, "readStatusContext" | "applyStatusTransition">,
  input: {
    occurrenceId: string;
    expectedStatus?: OccurrenceStatus;
    nextStatus: OccurrenceStatus;
    now: Temporal.Instant;
  },
) {
  const context = await store.readStatusContext(input.occurrenceId);
  if (!context) throw new Error("Occurrence not found.");
  const occurrence = {
    status: normalizeOccurrenceStatus(context.occurrence.status),
    completedAt: context.occurrence.completed_at,
    statusMarkedAt: context.occurrence.status_marked_at,
    note: context.occurrence.note,
  };
  if (input.expectedStatus !== undefined && input.expectedStatus !== occurrence.status) {
    throw new Error("Occurrence status changed. Review the latest status and try again.");
  }
  const update = resolveStatusTransition({ occurrence, nextStatus: input.nextStatus, now: input.now });
  const event = resolveStatusEvent({
    occurrence,
    nextStatus: input.nextStatus,
    now: input.now,
    hasPriorStatusEvent: context.latestStatusEventId !== null,
    update,
  });
  const result = await store.applyStatusTransition({
    occurrenceId: context.occurrence.id,
    expectedStatus: occurrence.status,
    expectedLatestEventId: context.latestStatusEventId,
    ...update,
    cancelPendingReminders: resolveReminderDeliveryCancellation({ occurrence: update }).cancelPending,
    event,
  });
  return { result, timezone: context.timezone };
}

/**
 * Sub-behaviors: marks every sub-behavior Occurrence in one parent slot with one status, in
 * one transaction, one status event each. Rows already at the status are left alone.
 * Returns the committed results; an empty list when nothing changed.
 */
export async function applyParentSlotStatusTransition(
  store: Pick<OccurrenceDataStore, "readStatusContext" | "applyParentSlotStatusTransition">,
  input: {
    parentBehaviorId: string;
    occurrenceIds: readonly string[];
    nextStatus: OccurrenceStatus;
    now: Temporal.Instant;
    /** Optional per-Occurrence status the caller last saw. */
    expectedStatuses?: Readonly<Record<string, OccurrenceStatus>>;
  },
) {
  if (!store.applyParentSlotStatusTransition) throw new Error("Parent slot marking is not available here.");
  const ids = [...new Set(input.occurrenceIds)];
  if (ids.length === 0) throw new Error("Choose the sub-behaviors to mark.");
  const contexts = await Promise.all(ids.map(async (occurrenceId) => {
    const context = await store.readStatusContext(occurrenceId);
    if (!context) throw new Error("Occurrence not found.");
    return context;
  }));
  const rows = contexts.map((context) => ({
    id: context.occurrence.id,
    status: normalizeOccurrenceStatus(context.occurrence.status),
    context,
  }));
  for (const row of rows) {
    const expected = input.expectedStatuses?.[row.id];
    if (expected !== undefined && expected !== row.status) {
      throw new Error("Occurrence status changed. Review the latest status and try again.");
    }
  }
  const changing = planParentSlotStatusChange({ occurrences: rows, nextStatus: input.nextStatus });
  if (changing.length === 0) return { results: [], timezone: contexts[0]!.timezone };
  const commits: StatusTransitionCommit[] = changing.map(({ context, status }) => {
    const occurrence = {
      status,
      completedAt: context.occurrence.completed_at,
      statusMarkedAt: context.occurrence.status_marked_at,
      note: context.occurrence.note,
    };
    const update = resolveStatusTransition({ occurrence, nextStatus: input.nextStatus, now: input.now });
    return {
      occurrenceId: context.occurrence.id,
      expectedStatus: status,
      expectedLatestEventId: context.latestStatusEventId,
      ...update,
      cancelPendingReminders: resolveReminderDeliveryCancellation({ occurrence: update }).cancelPending,
      event: resolveStatusEvent({
        occurrence, nextStatus: input.nextStatus, now: input.now,
        hasPriorStatusEvent: context.latestStatusEventId !== null, update,
      }),
    };
  });
  const results = await store.applyParentSlotStatusTransition({ parentBehaviorId: input.parentBehaviorId, commits });
  return { results, timezone: contexts[0]!.timezone };
}

/**
 * Advisor plan 4G: "Done at" after a late Completed mark. `doneAt` is an instant from
 * the start of the item's local day up to the tap time.
 */
export async function recordOccurrenceDoneAt(
  store: Pick<OccurrenceDataStore, "readStatusContext" | "applyMarkDetail">,
  input: { occurrenceId: string; doneAt: Temporal.Instant; now: Temporal.Instant },
) {
  const context = await store.readStatusContext(input.occurrenceId);
  if (!context) throw new Error("Occurrence not found.");
  if (!context.latestStatusEventId) throw new MarkDetailRefusal("not_completed");
  const plan = resolveDoneAtDetail({
    occurrence: { status: context.occurrence.status, statusMarkedAt: context.occurrence.status_marked_at, localDate: context.occurrence.local_date },
    timezone: context.timezone,
    doneAt: input.doneAt,
    now: input.now,
  });
  return store.applyMarkDetail({ occurrenceId: context.occurrence.id, expectedLatestEventId: context.latestStatusEventId, ...plan });
}

/** Advisor plan 4G: an optional one-tap reason on Not Completed. */
export async function recordOccurrenceNotDoneReason(
  store: Pick<OccurrenceDataStore, "readStatusContext" | "applyMarkDetail">,
  input: { occurrenceId: string; reason: unknown; now: Temporal.Instant },
) {
  const context = await store.readStatusContext(input.occurrenceId);
  if (!context) throw new Error("Occurrence not found.");
  if (!context.latestStatusEventId) throw new MarkDetailRefusal("not_not_completed");
  const plan = resolveNotDoneReasonDetail({
    occurrence: { status: context.occurrence.status, statusMarkedAt: context.occurrence.status_marked_at },
    reason: input.reason,
    now: input.now,
  });
  return store.applyMarkDetail({
    occurrenceId: context.occurrence.id,
    expectedLatestEventId: context.latestStatusEventId,
    completedAt: plan.completedAt,
    event: plan.event,
  });
}

export async function updateOccurrenceNote(
  store: Pick<OccurrenceDataStore, "updateOccurrenceNote">,
  input: { occurrenceId: string; expectedNote: string; note: string; usedShortcut?: boolean },
) {
  const update = resolveNoteUpdate({ note: input.note });
  const occurrence = await store.updateOccurrenceNote({
    occurrenceId: input.occurrenceId,
    expectedNote: resolveExpectedNote(input.expectedNote),
    note: update.note,
    ...(input.usedShortcut ? { usedShortcut: true } : {}),
  });
  if (!occurrence) {
    throw new Error("This note changed elsewhere. Review the latest note before saving again.");
  }
  return occurrence;
}

export function normalizeOccurrenceStatus(value: string): OccurrenceStatus {
  if (value === "unresolved" || value === "completed" || value === "not_completed") return value;
  throw new Error(`Unsupported occurrence status: ${value}.`);
}

export function parseOccurrenceId(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Choose an occurrence to update.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Choose a valid occurrence to update.");
  }
  return value;
}

export function parseOccurrenceStatus(value: unknown, expected = false): OccurrenceStatus {
  if (value === "unresolved" || value === "completed" || value === "not_completed") return value;
  throw new Error(expected ? "Refresh this occurrence and try again." : "Choose a valid occurrence status.");
}

export function parseOccurrenceNote(value: unknown, expected = false): string {
  if (typeof value === "string") return value;
  throw new Error(expected ? "Refresh this occurrence before saving its note." : "Enter a note before saving.");
}
