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

/**
 * Turns CRLF line breaks into LF. A lone CR stays, as in the BehaviorLog import
 * normalizer, so text that was saved with one still round-trips unchanged.
 */
export function normalizeNoteLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

/**
 * Plans the compare-and-set value for a note save. No write path stores CRLF:
 * resolveNoteUpdate and the BehaviorLog import both replace it. So a CRLF in an
 * expected value can only come from a browser form encoding a saved LF, and turns
 * back into LF here. A lone CR is the saved text itself (desktop and MCP send the
 * text they read) and passes through. The value is not trimmed: it must equal the
 * saved text exactly. Empty text means the caller saw no note.
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

/**
 * Connector provenance (D28.7). Kept apart from `OccurrenceStatusEventPlan`, so the
 * manual plan type can never express a connector write.
 */
export type ConnectorStatusEventPlan = Readonly<{
  previousStatus: OccurrenceStatus;
  status: OccurrenceStatus;
  statusSemantics: "system_rule_declared";
  recordedAt: string;
  effectiveAt: string | null;
  sourceCaptureMethod: "derived";
  sourceConfidence: "high";
  reasonCode: `connector:${string}`;
}>;

export type ConnectorStatusPlan = Readonly<{
  update: OccurrenceStatusUpdatePlan;
  event: ConnectorStatusEventPlan;
}>;

const CONNECTOR_SOURCE = /^[a-z][a-z0-9_]{0,31}$/u;

/**
 * Plans a connector completion (Unresolved → Completed) or its revert
 * (Completed → Unresolved). `completed_at` and `effective_at` are the activity
 * end; `status_marked_at` and `recorded_at` are the injected current instant.
 */
export function resolveConnectorStatusEvent(input: Readonly<{
  source: string;
  transition: "complete" | "revert";
  now: Temporal.Instant;
  /** Required for `complete`: the completing activity's end instant. */
  activityEndAt?: string;
}>): ConnectorStatusPlan {
  if (!CONNECTOR_SOURCE.test(input.source)) {
    throw new Error("Connector source must be a lowercase identifier.");
  }
  const now = input.now.toString();
  const reasonCode = `connector:${input.source}` as const;
  if (input.transition === "revert") {
    return {
      update: { status: "unresolved", completedAt: null, statusMarkedAt: null },
      event: {
        previousStatus: "completed",
        status: "unresolved",
        statusSemantics: "system_rule_declared",
        recordedAt: now,
        effectiveAt: null,
        sourceCaptureMethod: "derived",
        sourceConfidence: "high",
        reasonCode,
      },
    };
  }
  if (!input.activityEndAt) {
    throw new Error("A connector completion requires the activity end instant.");
  }
  const end = Temporal.Instant.from(input.activityEndAt);
  if (Temporal.Instant.compare(end, input.now) > 0) {
    throw new Error("A connector completion cannot end after the current instant.");
  }
  const completedAt = end.toString();
  return {
    update: { status: "completed", completedAt, statusMarkedAt: now },
    event: {
      previousStatus: "unresolved",
      status: "completed",
      statusSemantics: "system_rule_declared",
      recordedAt: now,
      effectiveAt: completedAt,
      sourceCaptureMethod: "derived",
      sourceConfidence: "high",
      reasonCode,
    },
  };
}

/** True when a status event carries connector provenance (D28.7). */
export function isConnectorStatusEvent(event: Readonly<{
  statusSemantics?: string | null;
  sourceCaptureMethod?: string | null;
  reasonCode?: string | null;
}>): boolean {
  return event.statusSemantics === "system_rule_declared"
    && event.sourceCaptureMethod === "derived"
    && typeof event.reasonCode === "string"
    && event.reasonCode.startsWith("connector:");
}
