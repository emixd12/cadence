import type { Temporal } from "@js-temporal/polyfill";
import type { BehaviorGraphRecord } from "@cadence/core/behavior-store";
import type { TimelineOccurrenceView } from "@cadence/core/types/timeline";
import { resolvePersistedTimelineOccurrence } from "@cadence/core/services/timeline.service";
import { macLeaveReminderDigest, macLeaveReminderDigestFromId } from "@cadence/core/services/mac-leave-reminder-plan";
import type { NativeEvent } from "./native-spike";
import { localCommand } from "./local-store";
import { toTimeSession } from "./local-occurrence.service";

export type NotificationTarget = { requestKey: number } & (
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "available"; occurrence: TimelineOccurrenceView }
);

export function notificationOccurrenceId(id: unknown): string | null {
  if (typeof id !== "string" || !id.startsWith("cadence.local.")) return null;
  const occurrenceId = id.slice("cadence.local.".length);
  return occurrenceId.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(occurrenceId)
    ? occurrenceId.toLowerCase() : null;
}

export function latestNotificationOccurrenceId(events: NativeEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind !== "notificationActivated") continue;
    const id = notificationOccurrenceId(event.id);
    if (id) return id;
  }
  return null;
}

/** Ticket 280: the latest activated reminder, a Behavior's Occurrence or a leave reminder's trip digest. */
export type NotificationActivation =
  | Readonly<{ kind: "occurrence"; occurrenceId: string }>
  | Readonly<{ kind: "leave"; digest: string }>;

export function latestNotificationActivation(events: NativeEvent[]): NotificationActivation | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind !== "notificationActivated") continue;
    const occurrenceId = notificationOccurrenceId(event.id);
    if (occurrenceId) return { kind: "occurrence", occurrenceId };
    const digest = macLeaveReminderDigestFromId(event.id);
    if (digest) return { kind: "leave", digest };
  }
  return null;
}

/**
 * Ticket 280: the Timeline item a leave reminder names, from today's Calendar events and
 * Occurrences. The digest is the destination and its start, so a moved event matches nothing.
 */
export function leaveReminderTarget(digest: string, input: Readonly<{
  events: readonly Readonly<{ id: string; kind: string; startAt?: string | null }>[];
  occurrences: readonly Readonly<{ id: string; scheduledFor: string }>[];
}>): Readonly<{ kind: "event"; eventId: string }> | Readonly<{ kind: "occurrence"; occurrenceId: string }> | null {
  for (const event of input.events) {
    if (event.kind === "timed" && event.startAt && macLeaveReminderDigest(event.id, event.startAt) === digest) return { kind: "event", eventId: event.id };
  }
  for (const occurrence of input.occurrences) {
    if (macLeaveReminderDigest(occurrence.id, occurrence.scheduledFor) === digest) return { kind: "occurrence", occurrenceId: occurrence.id };
  }
  return null;
}

export async function loadNotificationOccurrence(input: {
  occurrenceId: string;
  profile: { id: string; timezone: string };
  behaviors: BehaviorGraphRecord[];
  now: Temporal.Instant;
}): Promise<TimelineOccurrenceView | null> {
  // Do not constrain this direct lookup to the feed, reminder horizon, or active Behaviors.
  const occurrence = await localCommand("readOccurrence", {
    profileId: input.profile.id, occurrenceId: input.occurrenceId,
  });
  if (!occurrence) return null;
  const behavior = input.behaviors.find((row) => row.id === occurrence.behavior_id);
  if (!behavior) return null;
  const history = await localCommand("readOccurrenceHistory", {
    profileId: input.profile.id, occurrenceIds: [occurrence.id],
  });
  return resolvePersistedTimelineOccurrence({
    occurrence, behavior, timeSessions: history.timeSessions.map(toTimeSession),
    now: input.now, timezone: input.profile.timezone,
  });
}
