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

/**
 * Advisor plan Phase 4, workstream 4G (Emi, D8): two optional details a person adds
 * after a mark, each appended as its own status event that keeps the status. History
 * stays append-only, so the details sync like any mark, web and Mac.
 *
 * - "Done at": the mark was tapped well after the set time; the person says when it
 *   was really done. The event's `effective_at` and the Occurrence's `completed_at`
 *   become that time. `status_marked_at` keeps the tap time.
 * - "Why not done": an optional one-tap reason on Not Completed, stored as the
 *   event's `reason_code` ("not_done:<reason>"). The Occurrence does not change.
 */
export const DONE_AT_REASON_CODE = "done_at";
export const NOT_DONE_REASON_PREFIX = "not_done:";
export const NOT_DONE_REASONS = ["no_time", "forgot", "low_energy", "away", "chose_not_to"] as const;
export type NotDoneReason = (typeof NOT_DONE_REASONS)[number];
/**
 * How often the two mark-detail lines appear (Emi, Nov 19: keep it tunable). Change the
 * numbers here; web and Mac both read them.
 *
 * - `lateAfterMinutes`: a Completed mark this long after the set time (or after a time
 *   range ends) offers "Done at". Raise it to ask less often.
 * - `share`: the part of eligible marks that show the line, from 0 (never) to 1 (every
 *   time). The pick is fixed per item and day, so the same mark never flickers between
 *   showing and not.
 */
export type MarkDetailPromptSettings = Readonly<{
  doneAt: Readonly<{ lateAfterMinutes: number; share: number }>;
  notDoneReason: Readonly<{ share: number }>;
}>;

export const MARK_DETAIL_PROMPTS: MarkDetailPromptSettings = Object.freeze({
  doneAt: Object.freeze({ lateAfterMinutes: 120, share: 1 }),
  notDoneReason: Object.freeze({ share: 1 }),
});

/** Kept for callers that read the late threshold directly. */
export const LATE_MARK_THRESHOLD_MINUTES = MARK_DETAIL_PROMPTS.doneAt.lateAfterMinutes;

/**
 * Whether this item's line is in the shown share: a stable number in [0, 1) from the
 * line kind, Occurrence id and local date, compared with `share`.
 */
export function markDetailPromptPicked(kind: "done_at" | "not_done_reason", occurrenceId: string, localDate: string, share: number): boolean {
  if (share >= 1) return true;
  if (share <= 0) return false;
  let hash = 2166136261;
  for (const char of `${kind}:${occurrenceId}:${localDate}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296 < share;
}

export type MarkDetailEventPlan = Readonly<{
  previousStatus: "completed" | "not_completed";
  status: "completed" | "not_completed";
  statusSemantics: "explicit_user_correction";
  recordedAt: string;
  effectiveAt: string | null;
  sourceCaptureMethod: "manual_tap";
  sourceConfidence: "high";
  reasonCode: string;
}>;

export type MarkDetailPlan = Readonly<{
  /** The Occurrence's new `completed_at`; equal to the current value for a reason. */
  completedAt: string | null;
  event: MarkDetailEventPlan;
}>;

export class MarkDetailRefusal extends Error {
  constructor(readonly code: "not_completed" | "not_not_completed" | "done_at_after_mark" | "done_at_before_day" | "invalid_reason") {
    super(MARK_DETAIL_MESSAGES[code]);
    this.name = "MarkDetailRefusal";
  }
}

const MARK_DETAIL_MESSAGES: Readonly<Record<MarkDetailRefusal["code"], string>> = {
  not_completed: "This item is no longer Completed.",
  not_not_completed: "This item is no longer Not Completed.",
  done_at_after_mark: "That time is after you marked it.",
  done_at_before_day: "That time is before the item's day.",
  invalid_reason: "Choose one of the listed reasons.",
};

export function isNotDoneReason(value: unknown): value is NotDoneReason {
  return typeof value === "string" && (NOT_DONE_REASONS as readonly string[]).includes(value);
}

/** The reason stored on a status event, or null. */
export function notDoneReasonOf(reasonCode: string | null | undefined): NotDoneReason | null {
  if (!reasonCode?.startsWith(NOT_DONE_REASON_PREFIX)) return null;
  const reason = reasonCode.slice(NOT_DONE_REASON_PREFIX.length);
  return isNotDoneReason(reason) ? reason : null;
}

/**
 * Plans a "Done at" detail. `doneAt` must fall from the start of the Occurrence's local
 * day up to the tap time (`status_marked_at`).
 */
export function resolveDoneAtDetail(input: Readonly<{
  occurrence: Readonly<{ status: string; statusMarkedAt: string | null; localDate: string }>;
  timezone: string;
  doneAt: Temporal.Instant;
  now: Temporal.Instant;
}>): MarkDetailPlan {
  if (input.occurrence.status !== "completed" || !input.occurrence.statusMarkedAt) throw new MarkDetailRefusal("not_completed");
  const doneAt = input.doneAt.round({ smallestUnit: "second", roundingMode: "floor" });
  if (Temporal.Instant.compare(doneAt, Temporal.Instant.from(input.occurrence.statusMarkedAt)) > 0) throw new MarkDetailRefusal("done_at_after_mark");
  const dayStart = Temporal.PlainDate.from(input.occurrence.localDate).toZonedDateTime({ timeZone: input.timezone }).toInstant();
  if (Temporal.Instant.compare(doneAt, dayStart) < 0) throw new MarkDetailRefusal("done_at_before_day");
  return {
    completedAt: doneAt.toString(),
    event: {
      previousStatus: "completed", status: "completed", statusSemantics: "explicit_user_correction",
      recordedAt: input.now.toString(), effectiveAt: doneAt.toString(),
      sourceCaptureMethod: "manual_tap", sourceConfidence: "high", reasonCode: DONE_AT_REASON_CODE,
    },
  };
}

/** Plans a "Why not done" detail. The latest event's effective time is kept. */
export function resolveNotDoneReasonDetail(input: Readonly<{
  occurrence: Readonly<{ status: string; statusMarkedAt: string | null }>;
  reason: unknown;
  now: Temporal.Instant;
}>): MarkDetailPlan {
  if (input.occurrence.status !== "not_completed" || !input.occurrence.statusMarkedAt) throw new MarkDetailRefusal("not_not_completed");
  if (!isNotDoneReason(input.reason)) throw new MarkDetailRefusal("invalid_reason");
  return {
    completedAt: null,
    event: {
      previousStatus: "not_completed", status: "not_completed", statusSemantics: "explicit_user_correction",
      recordedAt: input.now.toString(), effectiveAt: input.occurrence.statusMarkedAt,
      sourceCaptureMethod: "manual_tap", sourceConfidence: "high", reasonCode: `${NOT_DONE_REASON_PREFIX}${input.reason}`,
    },
  };
}

/** True when a status event is a mark detail (a same-status event from 4G). */
export function isMarkDetailEvent(event: Readonly<{ previousStatus?: string | null; status?: string | null; reasonCode?: string | null }>): boolean {
  return event.previousStatus === event.status
    && (event.reasonCode === DONE_AT_REASON_CODE || notDoneReasonOf(event.reasonCode) !== null);
}
