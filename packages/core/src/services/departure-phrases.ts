import { Temporal } from "@js-temporal/polyfill";

import type { DepartureTrip } from "../types/departure";

/**
 * Every departure phrase, so wording changes in one place (Ticket 265).
 *
 * Not yet approved by the owner:
 * - From Ticket 261: "Last estimate: leave by {time} · checked {time}" and
 *   "Return time unknown." where it replaces "Travel timing incomplete".
 * - New in Ticket 265: the countdown, "leave now" and late forms, the other "Last estimate"
 *   forms, the overdue "appears" line, the needs-place, needs-attendance and
 *   needs-origin sentences, the "for {event}" line forms, and the past-the-leave-time forms:
 *   "If you haven't left yet, you'd arrive about {time}." and "you'd be home about {time}",
 *   the time-unknown forms ("Leave time unknown.", "The leave time for {event} is unknown.",
 *   "... because you may arrive late at {event}."), the "the trip home" line forms, and
 *   "Travel estimates are paused."
 *
 * Weather advice is not here. Development builds add it on their own path (Ticket 260).
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const NEXT_STOP_FALLBACK = "your next stop";
const PRIOR_STOP_FALLBACK = "your last stop";
const TRIP_HOME = "the trip home";

export const DEPARTURE_REFRESH_LABEL = "Refresh travel";

export type DeparturePhraseContext = Readonly<{
  timezone: string;
  /** Today's local date. A date is shown only for a time on another local date. */
  currentDate: Temporal.PlainDate;
}>;

export type DeparturePhraseInput = Pick<DepartureTrip, "state" | "lateBasis" | "role" | "mode" | "fromHome" | "freshness" |
  "checkedAt" | "leaveAt" | "arriveAt" | "minutesUntilLeave" | "appearsAt" | "timeUnknownCause" | "blockingLabel"> & Readonly<{
  /** The trip's destination title, when known. */
  destinationLabel: string | null;
  /** The appearance time has passed. */
  appearsOverdue: boolean;
  resumesAt: string | null;
}>;

export function departurePhraseContext(now: string, timezone: string): DeparturePhraseContext {
  return { timezone, currentDate: Temporal.Instant.from(now).toZonedDateTimeISO(timezone).toPlainDate() };
}

/** "1:15 PM", or "Nov 2, 1:15 PM" on another local date. Built by hand so no ICU version changes it. */
export function departureTimeLabel(at: string, context: DeparturePhraseContext): string {
  const zoned = Temporal.Instant.from(at).toZonedDateTimeISO(context.timezone);
  const hour = zoned.hour % 12 === 0 ? 12 : zoned.hour % 12;
  const time = `${hour}:${String(zoned.minute).padStart(2, "0")} ${zoned.hour < 12 ? "AM" : "PM"}`;
  return zoned.toPlainDate().equals(context.currentDate) ? time : `${MONTHS_SHORT[zoned.month - 1]} ${zoned.day}, ${time}`;
}

export function departurePausedPhrase(resumesAt: string, timezone: string): string {
  const zoned = Temporal.Instant.from(resumesAt).toZonedDateTimeISO(timezone);
  return `Travel estimates resume on ${MONTHS_LONG[zoned.month - 1]} ${zoned.day}.`;
}

export function departureFreeAgainPhrase(at: string, context: DeparturePhraseContext): string {
  return `Free again ${departureTimeLabel(at, context)}.`;
}

export function departureCheckedPhrase(attribution: string, at: string, context: DeparturePhraseContext): string {
  return `${attribution} · checked ${departureTimeLabel(at, context)}.`;
}

/** The form for a place that already names the event. */
export function departureDetailPhrase(input: DeparturePhraseInput, context: DeparturePhraseContext): string {
  return build(input, context, false);
}

/** The form that names the event, for the next-departure line and reminders. */
export function departureLinePhrase(input: DeparturePhraseInput, context: DeparturePhraseContext): string {
  return build(input, context, true);
}

function build(input: DeparturePhraseInput, context: DeparturePhraseContext, named: boolean): string {
  const destination = input.role === "return" ? TRIP_HOME : input.destinationLabel ?? NEXT_STOP_FALLBACK;
  const time = (at: string) => departureTimeLabel(at, context);
  const forStop = named ? ` for ${destination}` : "";
  switch (input.state) {
    case "upcoming":
    case "soon":
    case "leave_now":
    case "late":
    case "head_home":
      return input.freshness === "last_estimate"
        ? lastEstimate(input, time, forStop, named ? ` at ${destination}` : "", named ? destination : null)
        : current(input, time, forStop, named ? ` at ${destination}` : "", named ? destination : null);
    case "appears_later":
      if (input.appearsOverdue) return named ? `The leave time for ${destination} is ready to check.` : "The leave time is ready to check.";
      if (!input.appearsAt) return named ? `The leave time for ${destination} appears later.` : "Leave time appears later.";
      return named ? `The leave time for ${destination} appears by ${time(input.appearsAt)}.` : `Leave time appears by ${time(input.appearsAt)}.`;
    case "needs_place":
      return `Add a place for ${destination} to get a leave time.`;
    case "needs_attendance":
      return `Is ${destination} in person or remote?`;
    case "needs_origin":
      return input.blockingLabel
        ? `The leave time for ${destination} depends on ${input.blockingLabel}.`
        : `Add Home in Settings to get a leave time for ${destination}.`;
    case "time_unknown":
      return timeUnknown(input, destination, named);
    case "no_route":
      return named ? `No route found for ${destination}.` : "No route found.";
    case "trip_changed":
      if (!named) return "Trip changed.";
      return input.role === "return" ? "The trip home changed." : `The trip to ${destination} changed.`;
    case "estimate_expired":
      return named ? `The estimate for ${destination} expired.` : "Estimate expired.";
    case "paused":
      return input.resumesAt ? departurePausedPhrase(input.resumesAt, context.timezone) : "Travel estimates are paused.";
  }
}

/** True whether or not the user has left: Cadence cannot tell, and the time is a rough figure. */
function pastLeaveTime(input: DeparturePhraseInput, time: (at: string) => string, stop: string | null): string {
  if (input.role === "return") return `If you haven't left yet, you'd be home about ${time(input.arriveAt!)}`;
  return `If you haven't left${stop ? ` for ${stop}` : ""} yet, you'd arrive about ${time(input.arriveAt!)}`;
}

function current(input: DeparturePhraseInput, time: (at: string) => string, forStop: string, atStop: string, stop: string | null): string {
  if (input.lateBasis === "clock") return `${pastLeaveTime(input, time, stop)}.`;
  const leaveAt = input.leaveAt!;
  const arriveAt = input.arriveAt!;
  const start = input.fromHome ? " from Home" : "";
  const mode = input.mode ? ` · ${input.mode}` : "";
  const countdown = input.minutesUntilLeave !== null && input.minutesUntilLeave <= 30
    ? `in ${input.minutesUntilLeave} ${input.minutesUntilLeave === 1 ? "minute" : "minutes"}, by ${time(leaveAt)}`
    : null;
  if (input.role === "return") {
    const when = input.minutesUntilLeave === null ? "now" : countdown ?? time(leaveAt);
    return `Head home ${when}${mode}, home by ${time(arriveAt)}.`;
  }
  switch (input.state) {
    case "soon": return `Leave ${countdown}${forStop}${start}${mode}, arrive ${time(arriveAt)}.`;
    case "leave_now": return `Leave now${forStop}${start}${mode}, arrive ${time(arriveAt)}.`;
    case "late": return input.minutesUntilLeave === null
      ? `You may arrive late${atStop}: arrive ${time(arriveAt)}.`
      : `You may arrive late${atStop}: leave by ${time(leaveAt)}${start}${mode}, arrive ${time(arriveAt)}.`;
    default: return `Leave by ${time(leaveAt)}${forStop}${start}${mode}, arrive ${time(arriveAt)}.`;
  }
}

function lastEstimate(input: DeparturePhraseInput, time: (at: string) => string, forStop: string, atStop: string, stop: string | null): string {
  const checked = ` · checked ${time(input.checkedAt!)}.`;
  if (input.lateBasis === "clock") return `Last estimate: ${lowerFirst(pastLeaveTime(input, time, stop))}${checked}`;
  const leaveAt = input.leaveAt!;
  const arrived = input.minutesUntilLeave === null;
  if (input.role === "return") return `Last estimate: head home ${arrived ? "now" : time(leaveAt)}${checked}`;
  if (input.state === "late") {
    return arrived
      ? `Last estimate: you may arrive late${atStop}, arrive ${time(input.arriveAt!)}${checked}`
      : `Last estimate: you may arrive late${atStop}, leave by ${time(leaveAt)}, arrive ${time(input.arriveAt!)}${checked}`;
  }
  return input.state === "leave_now"
    ? `Last estimate: leave now${forStop}${checked}`
    : `Last estimate: leave by ${time(leaveAt)}${forStop}${checked}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function timeUnknown(input: DeparturePhraseInput, destination: string, named: boolean): string {
  if (input.role === "return") {
    return input.timeUnknownCause === "home_missing" ? "Return time unknown. Add Home in Settings to estimate it." : "Return time unknown.";
  }
  if (input.timeUnknownCause === "late_arrival") {
    return `The leave time${named ? ` for ${destination}` : ""} is unknown, because you may arrive late at ${input.blockingLabel ?? PRIOR_STOP_FALLBACK}.`;
  }
  return named ? `The leave time for ${destination} is unknown.` : "Leave time unknown.";
}
