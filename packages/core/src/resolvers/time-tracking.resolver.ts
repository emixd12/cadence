import { Temporal } from "@js-temporal/polyfill";

import type {
  OccurrenceTimeTracking,
  TimeSession,
} from "../types/time-tracking";

export type StartTimeTrackingPlan =
  | Readonly<{ kind: "start"; startedAt: string }>
  | Readonly<{ kind: "already_running"; session: TimeSession }>;

export type StopTimeTrackingPlan =
  | Readonly<{
      kind: "stop";
      sessionId: string;
      stoppedAt: string;
      durationSeconds: number;
    }>
  | Readonly<{ kind: "already_stopped"; session: TimeSession | null }>;

export type StatusTransitionTimeTrackingStopPlan =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "stop";
      sessionId: string;
      stoppedAt: string;
      durationSeconds: number;
    }>;

export type ResetTimeTrackingPlan = Readonly<{
  sessionIds: string[];
  hasSessions: boolean;
}>;

export function canStartOccurrenceTimeTracking(input: Readonly<{
  behaviorActive: boolean;
  occurrenceLocalDate: string;
  occurrenceStatus: "unresolved" | "completed" | "not_completed";
  statusMarkedAt: string | null;
  now: Temporal.Instant;
  timezone: string;
}>): boolean {
  if (!input.behaviorActive) {
    return false;
  }

  const today = input.now.toZonedDateTimeISO(input.timezone).toPlainDate();
  const occurrenceDate = Temporal.PlainDate.from(input.occurrenceLocalDate);
  const dateComparison = Temporal.PlainDate.compare(occurrenceDate, today);

  if (dateComparison > 0) {
    return false;
  }

  if (dateComparison === 0 || input.occurrenceStatus === "unresolved") {
    return true;
  }

  if (!input.statusMarkedAt) {
    return false;
  }

  return Temporal.Instant.from(input.statusMarkedAt)
    .toZonedDateTimeISO(input.timezone)
    .toPlainDate()
    .equals(today);
}

export function resolveStartTimeTracking(input: Readonly<{
  sessions: TimeSession[];
  now: Temporal.Instant;
}>): StartTimeTrackingPlan {
  const tracking = resolveOccurrenceTimeTracking(input.sessions);

  if (tracking.runningSession) {
    return { kind: "already_running", session: tracking.runningSession };
  }

  return { kind: "start", startedAt: input.now.toString() };
}

export function resolveStopTimeTracking(input: Readonly<{
  sessions: TimeSession[];
  now: Temporal.Instant;
}>): StopTimeTrackingPlan {
  const tracking = resolveOccurrenceTimeTracking(input.sessions);
  const runningSession = tracking.runningSession;

  if (!runningSession) {
    return {
      kind: "already_stopped",
      session: latestStoppedSession(tracking.sessions),
    };
  }

  const startedAt = parseInstant(runningSession.startedAt, "started_at");
  const durationSeconds = durationSecondsBetween(startedAt, input.now);

  return {
    kind: "stop",
    sessionId: runningSession.id,
    stoppedAt: input.now.toString(),
    durationSeconds,
  };
}

/**
 * Ticket 351 (owner decision 2026-11-23): transitioning an Occurrence to Completed
 * stops any running time-tracking session on that Occurrence at `statusMarkedAt`
 * (clamped to `startedAt` if clock skew puts `statusMarkedAt` earlier). Not Completed,
 * Unresolved, and unchanged Completed transitions leave running sessions untouched.
 */
export function resolveStopTimeTrackingOnStatusTransition(input: Readonly<{
  previousStatus: "unresolved" | "completed" | "not_completed";
  nextStatus: "unresolved" | "completed" | "not_completed";
  sessions: TimeSession[];
  statusMarkedAt: string | null;
}>): StatusTransitionTimeTrackingStopPlan {
  if (
    input.nextStatus !== "completed" ||
    input.previousStatus === "completed" ||
    !input.statusMarkedAt
  ) {
    return { kind: "none" };
  }

  const tracking = resolveOccurrenceTimeTracking(input.sessions);
  const runningSession = tracking.runningSession;

  if (!runningSession) {
    return { kind: "none" };
  }

  const startedAt = parseInstant(runningSession.startedAt, "started_at");
  const markedAt = parseInstant(input.statusMarkedAt, "stopped_at");
  const stoppedAt =
    Temporal.Instant.compare(markedAt, startedAt) < 0 ? startedAt : markedAt;

  return {
    kind: "stop",
    sessionId: runningSession.id,
    stoppedAt: stoppedAt.toString(),
    durationSeconds: durationSecondsBetween(startedAt, stoppedAt),
  };
}

export function resolveOccurrenceTimeTracking(
  sessions: TimeSession[],
): OccurrenceTimeTracking {
  let runningSession: TimeSession | null = null;
  let recordedSeconds = 0;

  for (const session of sessions) {
    const startedAt = parseInstant(session.startedAt, "started_at");

    if (!session.stoppedAt) {
      if (runningSession) {
        throw new Error("Occurrence has more than one running time session.");
      }

      runningSession = session;
      continue;
    }

    const stoppedAt = parseInstant(session.stoppedAt, "stopped_at");
    recordedSeconds += durationSecondsBetween(startedAt, stoppedAt);
  }

  return { sessions, runningSession, recordedSeconds };
}

export function resolveResetTimeTracking(
  sessions: TimeSession[],
): ResetTimeTrackingPlan {
  return {
    sessionIds: sessions.map((session) => session.id),
    hasSessions: sessions.length > 0,
  };
}

export function formatTrackedDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function formatRecordedDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${remainingSeconds}s`);

  return parts.join(" ");
}

function latestStoppedSession(sessions: TimeSession[]): TimeSession | null {
  return sessions
    .filter((session) => session.stoppedAt !== null)
    .sort((left, right) => {
      const leftStoppedAt = parseInstant(left.stoppedAt!, "stopped_at");
      const rightStoppedAt = parseInstant(right.stoppedAt!, "stopped_at");

      return Temporal.Instant.compare(rightStoppedAt, leftStoppedAt);
    })[0] ?? null;
}

function durationSecondsBetween(
  startedAt: Temporal.Instant,
  stoppedAt: Temporal.Instant,
): number {
  if (Temporal.Instant.compare(stoppedAt, startedAt) < 0) {
    throw new Error("Time session stopped_at cannot be before started_at.");
  }

  return startedAt.until(stoppedAt).total({ unit: "seconds" });
}

function parseInstant(value: string, field: "started_at" | "stopped_at"): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`Time session has invalid ${field}.`);
  }
}

/**
 * Ticket 366 (D34): a Behavior's tracked time decides its length once it has this
 * many tracked samples. Below it, the intended duration the person set decides.
 */
export const TRACKED_DURATION_WINS_MIN_SAMPLES = 3;
/** The tracked figure is the median of this many of the most recent samples. */
export const TRACKED_DURATION_RECENT_SAMPLES = 10;

export function trackedDurationWins(sampleCount: number): boolean {
  return sampleCount >= TRACKED_DURATION_WINS_MIN_SAMPLES;
}

/**
 * The median of the most recent samples, or null with none. `samples` must be
 * ordered newest first. An even count takes the mean of the two middle values.
 */
export function recentMedianSeconds(samplesNewestFirst: readonly number[]): Readonly<{ seconds: number; sampleCount: number }> | null {
  const recent = samplesNewestFirst.slice(0, TRACKED_DURATION_RECENT_SAMPLES).sort((left, right) => left - right);
  if (recent.length === 0) return null;
  const middle = Math.floor(recent.length / 2);
  const seconds = recent.length % 2 === 1 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2;
  return { seconds, sampleCount: recent.length };
}
