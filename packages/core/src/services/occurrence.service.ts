import type { Temporal } from "@js-temporal/polyfill";

import type { OccurrenceDataStore } from "../data-store";
import type { OccurrenceStatus } from "../types/database";
import { resolveReminderDeliveryCancellation } from "../resolvers/reminder.resolver";
import {
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
