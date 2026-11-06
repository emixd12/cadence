import { leaveReminderTripDigest } from "@cadence/core/services/leave-reminder-plan";

/**
 * Ticket 278: a web leave reminder opens `/timeline?leave=<trip digest>`. The link carries
 * the digest only, never a title or place. The Timeline finds today's Calendar event or
 * Occurrence with that digest, the same SHA-256 the hosted job records (Ticket 275).
 */
export const LEAVE_REMINDER_LINK_PARAM = "leave";

const TRIP_DIGEST = /^[0-9a-f]{64}$/;

/** The Timeline link for one trip, absolute when the site URL is known. */
export function leaveReminderTimelineUrl(tripDigest: string, siteUrl: string | undefined): string {
  if (!TRIP_DIGEST.test(tripDigest)) throw new Error("A leave reminder link needs a trip digest.");
  const path = `/timeline?${LEAVE_REMINDER_LINK_PARAM}=${tripDigest}`;
  const base = siteUrl?.trim();
  if (!base) return path;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/** The trip digest in a Timeline search parameter, or null for anything else. */
export function parseLeaveReminderDigest(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && TRIP_DIGEST.test(raw) ? raw : null;
}

export type LeaveReminderLinkTarget<Event> =
  | Readonly<{ kind: "event"; event: Event }>
  | Readonly<{ kind: "occurrence"; occurrenceId: string }>;

/**
 * The Calendar event or Occurrence a trip digest names. The digest covers the start, so a
 * moved or removed destination matches nothing.
 */
export function leaveReminderLinkTarget<Event extends Readonly<{ id: string; kind: string; startAt?: string | null }>>(
  tripDigest: string,
  input: Readonly<{
    events: readonly Event[];
    occurrences: readonly Readonly<{ id: string; scheduledFor: string }>[];
  }>,
): LeaveReminderLinkTarget<Event> | null {
  for (const event of input.events) {
    if (event.kind === "timed" && event.startAt && event.id.trim() && leaveReminderTripDigest("calendar", event.id, event.startAt) === tripDigest) {
      return { kind: "event", event };
    }
  }
  for (const occurrence of input.occurrences) {
    if (occurrence.id.trim() && leaveReminderTripDigest("behavior", occurrence.id, occurrence.scheduledFor) === tripDigest) {
      return { kind: "occurrence", occurrenceId: occurrence.id };
    }
  }
  return null;
}
