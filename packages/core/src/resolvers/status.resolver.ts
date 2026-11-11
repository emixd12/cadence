import { Temporal } from "@js-temporal/polyfill";

import type { OccurrenceStatus } from "../types/database";

export type StatusResolverOccurrence = {
  status: OccurrenceStatus;
  completedAt: string | null;
  statusMarkedAt: string | null;
  note: string | null;
};

export type ResolveStatusTransitionInput = {
  occurrence: StatusResolverOccurrence;
  nextStatus: OccurrenceStatus;
  now: Temporal.Instant;
  hasPriorStatusEvent?: boolean;
};

export type OccurrenceStatusUpdatePlan = {
  status: OccurrenceStatus;
  completedAt: string | null;
  statusMarkedAt: string | null;
};

export type OccurrenceStatusEventPlan = {
  previousStatus: OccurrenceStatus;
  status: OccurrenceStatus;
  statusSemantics: "explicit_user_mark" | "explicit_user_correction";
  recordedAt: string;
  effectiveAt: string | null;
  sourceCaptureMethod: "manual_tap";
  sourceConfidence: "high";
};

export type ResolveNoteUpdateInput = {
  note: string;
};

export type OccurrenceNoteUpdatePlan = {
  note: string | null;
};

export function resolveStatusTransition(
  input: ResolveStatusTransitionInput,
): OccurrenceStatusUpdatePlan {
  if (input.nextStatus === "unresolved") {
    return {
      status: "unresolved",
      completedAt: null,
      statusMarkedAt: null,
    };
  }

  const now = input.now.toString();
  const statusChanged = input.occurrence.status !== input.nextStatus;
  const needsStatusMarkedAt =
    statusChanged || input.occurrence.statusMarkedAt === null;
  const needsCompletedAt =
    input.nextStatus === "completed" &&
    (statusChanged || input.occurrence.completedAt === null);

  return {
    status: input.nextStatus,
    completedAt:
      input.nextStatus === "completed"
        ? needsCompletedAt
          ? now
          : input.occurrence.completedAt
        : null,
    statusMarkedAt: needsStatusMarkedAt
      ? now
      : input.occurrence.statusMarkedAt,
  };
}

export function resolveStatusEvent(
  input: ResolveStatusTransitionInput & {
    update: OccurrenceStatusUpdatePlan;
  },
): OccurrenceStatusEventPlan | null {
  if (input.occurrence.status === input.update.status) {
    return null;
  }

  const recordedAt = input.update.statusMarkedAt ?? input.now.toString();
  const statusSemantics =
    input.occurrence.status === "unresolved" && !input.hasPriorStatusEvent
      ? "explicit_user_mark"
      : "explicit_user_correction";

  return {
    previousStatus: input.occurrence.status,
    status: input.update.status,
    statusSemantics,
    recordedAt,
    effectiveAt:
      input.update.status === "completed"
        ? input.update.completedAt
        : input.update.statusMarkedAt,
    sourceCaptureMethod: "manual_tap",
    sourceConfidence: "high",
  };
}

/** Turns CRLF and lone CR line breaks into LF. */
export function normalizeNoteLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/**
 * Plans the compare-and-set value for a note save. Browsers submit form text with
 * CRLF line breaks, while saved notes use LF, so only line endings change here.
 * The value is not trimmed: it must equal the saved text, which is already trimmed.
 * Empty text means the caller saw no note.
 */
export function resolveExpectedNote(value: string): string | null {
  const expected = normalizeNoteLineEndings(value);
  return expected.length > 0 ? expected : null;
}

export function resolveNoteUpdate(
  input: ResolveNoteUpdateInput,
): OccurrenceNoteUpdatePlan {
  const note = normalizeNoteLineEndings(input.note).trim();

  return {
    note: note.length > 0 ? note : null,
  };
}
