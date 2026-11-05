import { Temporal } from "@js-temporal/polyfill";

import type { BehaviorDurationEstimate, NormalizedExternalEvent } from "../types/day-progress";
import type { DepartureStop } from "../types/departure";

/** The schedule facts a Behavior's end needs. Both the hosted route refresh and the Timeline pass them. */
export type BehaviorEndInput = Readonly<{
  localDate: string;
  scheduledFor: string;
  scheduleKind?: string | null;
  /** Local wall time, "HH:MM" or "HH:MM:SS", for a range schedule. */
  scheduleEndTime?: string | null;
}>;

/**
 * When a Behavior Occurrence ends: the range's end time on its local date, or for an exact
 * time the start plus a known duration estimate. Null when neither is known.
 */
export function behaviorEndAt(occurrence: BehaviorEndInput, estimate: BehaviorDurationEstimate | undefined, timezone: string): string | null {
  try {
    if (occurrence.scheduleKind === "range" && occurrence.scheduleEndTime) {
      return Temporal.PlainDate.from(occurrence.localDate).toZonedDateTime({ timeZone: timezone,
        plainTime: Temporal.PlainTime.from(occurrence.scheduleEndTime) }).toInstant().toString();
    }
    if (occurrence.scheduleKind !== "range" && estimate?.kind === "known") {
      return Temporal.Instant.from(occurrence.scheduledFor).add({ seconds: estimate.seconds }).toString();
    }
  } catch { return null; }
  return null;
}

export type DepartureStopOccurrence = BehaviorEndInput & Readonly<{ id: string; behaviorId: string; title: string }>;

/**
 * Ticket 261: the departure model's stops for one day, from Calendar events and Behavior
 * Occurrences, on web and Mac. Titles stay on the device.
 */
export function departureStops(input: Readonly<{
  events: readonly NormalizedExternalEvent[];
  occurrences: readonly DepartureStopOccurrence[];
  durationEstimates?: Readonly<Record<string, BehaviorDurationEstimate>>;
  timezone: string;
}>): DepartureStop[] {
  const events = input.events.flatMap((event): DepartureStop[] => event.kind === "timed"
    ? [{ ref: event.id, label: event.title || "Untitled event", startAt: event.startAt, endAt: event.endUnspecified ? null : event.endAt }]
    : []);
  const occurrences = input.occurrences.map((occurrence): DepartureStop => ({ ref: occurrence.id, label: occurrence.title,
    startAt: occurrence.scheduledFor,
    endAt: behaviorEndAt(occurrence, input.durationEstimates?.[occurrence.behaviorId], input.timezone) }));
  return [...events, ...occurrences];
}

export type LocatedStopOccurrence = Readonly<{ id: string; title: string; scheduledFor: string; status: string; placeText?: string }>;

/**
 * Ticket 273: the first stop with a place that is still ahead, for the line offering Travel
 * estimates while they are off. A Calendar event counts when it has a location and the user has
 * not declined or cancelled it; a Behavior counts when it is Unresolved and set to a place. Pure:
 * `now` is injected. Titles stay on the device.
 */
export function firstLocatedStopAhead(input: Readonly<{
  events: readonly NormalizedExternalEvent[];
  occurrences: readonly LocatedStopOccurrence[];
  now: string;
}>): Readonly<{ ref: string; label: string }> | null {
  const now = Temporal.Instant.from(input.now);
  const ahead = (startAt: string) => Temporal.Instant.compare(Temporal.Instant.from(startAt), now) > 0;
  const candidates = [
    ...input.events.flatMap((event) => event.kind === "timed" && event.location.trim() && event.state !== "cancelled" &&
      event.currentUserResponse !== "declined" && ahead(event.startAt)
      ? [{ ref: event.id, label: event.title || "Untitled event", startAt: event.startAt }] : []),
    ...input.occurrences.flatMap((occurrence) => occurrence.status === "unresolved" && occurrence.placeText?.trim() && ahead(occurrence.scheduledFor)
      ? [{ ref: occurrence.id, label: occurrence.title, startAt: occurrence.scheduledFor }] : []),
  ].sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.startAt), Temporal.Instant.from(right.startAt)));
  const first = candidates[0];
  return first ? { ref: first.ref, label: first.label } : null;
}
