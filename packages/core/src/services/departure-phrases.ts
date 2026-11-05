import { Temporal } from "@js-temporal/polyfill";

import type { ExternalEventState } from "../types/day-progress";
import type { DepartureTrip } from "../types/departure";
import type { WeatherConditionId } from "../types/weather";

/**
 * Every departure phrase, so wording changes in one place (Ticket 265).
 *
 * `DEPARTURE_PHRASES_AWAITING_APPROVAL` below lists the words the owner has not yet approved.
 * The design-system bench renders each one with sample values (Ticket 266), so keep the list
 * in step with the builders here. Two phrases from Ticket 261 live outside this module: the
 * correction note in `ExternalEventDetails` and the production unavailable message in
 * `lib/ui/travel.ts`. The bench lists them too.
 *
 * Weather advice is not here. Development builds add it on their own path (Ticket 260).
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const NEXT_STOP_FALLBACK = "your next stop";
const PRIOR_STOP_FALLBACK = "your last stop";
const TRIP_HOME = "the trip home";

export const DEPARTURE_REFRESH_LABEL = "Refresh travel";
/** The overlap label when the trip home has no known time. */
export const RETURN_TIME_UNKNOWN = "Return time unknown.";

/** One phrase the owner has not yet approved (Ticket 266 lists them on the bench). */
export type DeparturePhraseApproval = Readonly<{
  id: string;
  ticket: "261" | "265";
  /** The words, with sample values named in braces. */
  template: string;
  /** When the user sees it. */
  situation: string;
  /** The text it replaces, or null for a new line. */
  replaces: string | null;
}>;

/** Not yet approved by the owner. Built by the functions below; the bench renders each with sample values. */
export const DEPARTURE_PHRASES_AWAITING_APPROVAL: readonly DeparturePhraseApproval[] = [
  { id: "last-estimate-leave-by", ticket: "261", template: "Last estimate: leave by {time} · checked {time}.",
    situation: "Event drawer, dialog or Behavior row, once the estimate is more than 5 minutes old and a leave time is known.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "return-time-unknown", ticket: "261", template: "Return time unknown.",
    situation: "Event drawer, dialog or Behavior row, when the trip home has no time, for example because the last stop has no end.",
    replaces: "Full-trip availability is unknown. Known travel spans still apply." },
  { id: "overlap-return-unknown", ticket: "261", template: "Return time unknown.",
    situation: "Expanded Behavior row overlap label, when the trip home has no known time.",
    replaces: "Travel timing incomplete" },
  { id: "weather-margin", ticket: "261", template: "{minutes} min added for {condition}.",
    situation: "Once per event, when the forecast adds time to a trip.",
    replaces: "Includes {minutes} min for {condition}." },
  { id: "checked", ticket: "261", template: "Google Maps · checked {time}.",
    situation: "Under the travel lines in the drawer, dialog and Behavior row.",
    replaces: "Google Maps · Checked Nov 1, 8:00 AM. Estimates depend on attendance and current conditions." },
  { id: "brief-footer", ticket: "261", template: "Calculated by Cadence · Google Maps · {time}.",
    situation: "Daily Brief travel block footer.",
    replaces: "Calculated by Cadence from travel estimates as of 9:00 AM, Google Maps. Not written by the model." },
  { id: "overlap-trip-to", ticket: "261", template: "Overlaps your trip to {event} ({start}–{end})",
    situation: "Expanded Behavior row, when a trip to an event crowds this Behavior.",
    replaces: "Possible travel overlap" },
  { id: "overlap-trip-home", ticket: "261", template: "Overlaps your trip home ({start}–{end})",
    situation: "Expanded Behavior row, when the trip home crowds this Behavior.",
    replaces: "Possible travel overlap" },
  { id: "free-again", ticket: "261", template: "Free again {time}.",
    situation: "Event drawer and dialog, when the whole day's trip is known.",
    replaces: "Available again Nov 1, 6:45 PM." },
  { id: "all-day-range", ticket: "261", template: "{date} – {date}",
    situation: "Calendar details time row for an all-day event over several days. One day shows only its date.",
    replaces: null },
  { id: "event-tentative", ticket: "261", template: "Tentative",
    situation: "Calendar details time row, for an event not yet confirmed.",
    replaces: null },
  { id: "event-cancelled", ticket: "261", template: "Cancelled",
    situation: "Calendar details time row, for a cancelled event.",
    replaces: null },
  { id: "soon", ticket: "265", template: "Leave in {minutes} minutes, by {time} from Home · {mode}, arrive {time}.",
    situation: "30 minutes or less before the leave time.",
    replaces: "Outbound · walking: leave Nov 1, 1:15 PM, arrive Nov 1, 2:20 PM." },
  { id: "leave-now", ticket: "265", template: "Leave now from Home · {mode}, arrive {time}.",
    situation: "From the leave time until 5 minutes after it.",
    replaces: "Outbound · walking: leave Nov 1, 1:15 PM, arrive Nov 1, 2:20 PM." },
  { id: "late-before-leave", ticket: "265", template: "You may arrive late: leave by {time} from Home · {mode}, arrive {time}.",
    situation: "The route arrives after the planned arrival time, before the leave time.",
    replaces: "Estimated arrival is after the planned arrival time." },
  { id: "late-after-leave", ticket: "265", template: "You may arrive late: arrive {time}.",
    situation: "The route arrives after the planned arrival time, once the leave time has passed.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "past-leave-time", ticket: "265", template: "If you haven't left yet, you'd arrive about {time}.",
    situation: "5 minutes or more after the leave time. Only the clock has passed it; the route was on time.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "past-leave-time-home", ticket: "265", template: "If you haven't left yet, you'd be home about {time}.",
    situation: "The trip home, 5 minutes or more after its leave time.",
    replaces: "Return home · walking: timing unavailable." },
  { id: "head-home-soon", ticket: "265", template: "Head home in {minutes} minutes, by {time} · {mode}, home by {time}.",
    situation: "The trip home, 30 minutes or less before its leave time.",
    replaces: "Return home · walking: leave Nov 1, 4:40 PM, arrive Nov 1, 6:35 PM." },
  { id: "head-home-now", ticket: "265", template: "Head home now · {mode}, home by {time}.",
    situation: "The trip home, from its leave time until 5 minutes after it.",
    replaces: "Return home · walking: leave Nov 1, 4:40 PM, arrive Nov 1, 6:35 PM." },
  { id: "last-estimate-leave-now", ticket: "265", template: "Last estimate: leave now · checked {time}.",
    situation: "Leave now, with an estimate more than 5 minutes old.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "last-estimate-late-before", ticket: "265", template: "Last estimate: you may arrive late, leave by {time}, arrive {time} · checked {time}.",
    situation: "Late from the route, before the leave time, with an old estimate.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "last-estimate-late-after", ticket: "265", template: "Last estimate: you may arrive late, arrive {time} · checked {time}.",
    situation: "Late from the route, after the leave time, with an old estimate.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "last-estimate-past-leave", ticket: "265", template: "Last estimate: if you haven't left yet, you'd arrive about {time} · checked {time}.",
    situation: "5 minutes or more after the leave time, with an old estimate.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "last-estimate-head-home", ticket: "265", template: "Last estimate: head home {time} · checked {time}.",
    situation: "The trip home, with an old estimate.",
    replaces: "Return home · walking: timing unavailable." },
  { id: "last-estimate-past-leave-home", ticket: "265", template: "Last estimate: if you haven't left yet, you'd be home about {time} · checked {time}.",
    situation: "The trip home, 5 minutes or more after its leave time, with an old estimate.",
    replaces: "Return home · walking: timing unavailable." },
  { id: "appears-overdue", ticket: "265", template: "The leave time is ready to check.",
    situation: "The time the estimate was due has passed, and nobody has refreshed.",
    replaces: "estimated within 3 hours of departure" },
  { id: "appears-later", ticket: "265", template: "Leave time appears later.",
    situation: "Event drawer, dialog or Behavior row, when the stop's start is unknown so the estimate time cannot be given.",
    replaces: "estimated within 3 hours of departure" },
  { id: "needs-place", ticket: "265", template: "Add a place for {event} to get a leave time.",
    situation: "The event or Behavior has no place.",
    replaces: null },
  { id: "needs-attendance", ticket: "265", template: "Is {event} in person or remote?",
    situation: "Cadence cannot tell whether the event is in person.",
    replaces: null },
  { id: "needs-origin-blocked", ticket: "265", template: "The leave time for {event} depends on {other event}.",
    situation: "The stop before this one has no place or attendance, so the trip has no start.",
    replaces: null },
  { id: "needs-origin-home", ticket: "265", template: "Add Home in Settings to get a leave time for {event}.",
    situation: "No Home is saved and the device location is unknown.",
    replaces: null },
  { id: "time-unknown", ticket: "265", template: "Leave time unknown.",
    situation: "No leave time can be given, for example past the trip limit.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "time-unknown-late", ticket: "265", template: "The leave time is unknown, because you may arrive late at {event}.",
    situation: "The trip before this one arrives late, so this trip's times cannot be relied on.",
    replaces: "Outbound · walking: timing unavailable." },
  { id: "line-leave-by", ticket: "265", template: "Leave by {time} for {event} from Home · {mode}, arrive {time}.",
    situation: "Line form that names the event, for the next-departure line and reminders.",
    replaces: null },
  { id: "line-soon", ticket: "265", template: "Leave in {minutes} minutes, by {time} for {event} from Home · {mode}, arrive {time}.",
    situation: "Line form, 30 minutes or less before the leave time.",
    replaces: null },
  { id: "line-leave-now", ticket: "265", template: "Leave now for {event} from Home · {mode}, arrive {time}.",
    situation: "Line form, from the leave time until 5 minutes after it.",
    replaces: null },
  { id: "line-late", ticket: "265", template: "You may arrive late at {event}: arrive {time}.",
    situation: "Line form, late from the route after the leave time.",
    replaces: null },
  { id: "line-late-before-leave", ticket: "265", template: "You may arrive late at {event}: leave by {time} from Home · {mode}, arrive {time}.",
    situation: "Line form, late from the route, before the leave time.",
    replaces: null },
  { id: "line-past-leave-time", ticket: "265", template: "If you haven't left for {event} yet, you'd arrive about {time}.",
    situation: "Line form, 5 minutes or more after the leave time.",
    replaces: null },
  { id: "line-last-estimate", ticket: "265", template: "Last estimate: leave by {time} for {event} · checked {time}.",
    situation: "Line form, with an old estimate.",
    replaces: null },
  { id: "line-last-estimate-leave-now", ticket: "265", template: "Last estimate: leave now for {event} · checked {time}.",
    situation: "Line form, leave now with an old estimate.",
    replaces: null },
  { id: "line-last-estimate-late-before", ticket: "265", template: "Last estimate: you may arrive late at {event}, leave by {time}, arrive {time} · checked {time}.",
    situation: "Line form, late from the route before the leave time, with an old estimate.",
    replaces: null },
  { id: "line-last-estimate-late-after", ticket: "265", template: "Last estimate: you may arrive late at {event}, arrive {time} · checked {time}.",
    situation: "Line form, late from the route after the leave time, with an old estimate.",
    replaces: null },
  { id: "line-last-estimate-past-leave", ticket: "265", template: "Last estimate: if you haven't left for {event} yet, you'd arrive about {time} · checked {time}.",
    situation: "Line form, 5 minutes or more after the leave time, with an old estimate.",
    replaces: null },
  { id: "line-appears-by", ticket: "265", template: "The leave time for {event} appears by {time}.",
    situation: "Line form, before the trip's estimate is due.",
    replaces: null },
  { id: "line-appears-later", ticket: "265", template: "The leave time for {event} appears later.",
    situation: "Line form, when the stop's start is unknown.",
    replaces: null },
  { id: "line-ready", ticket: "265", template: "The leave time for {event} is ready to check.",
    situation: "Line form, after the estimate was due.",
    replaces: null },
  { id: "line-expired", ticket: "265", template: "The estimate for {event} expired.",
    situation: "Line form, when the server says the estimate expired.",
    replaces: null },
  { id: "line-no-route", ticket: "265", template: "No route found for {event}.",
    situation: "Line form, when no route was found.",
    replaces: null },
  { id: "line-changed", ticket: "265", template: "The trip to {event} changed.",
    situation: "Line form, after a stop on the way was resolved or the plan changed.",
    replaces: null },
  { id: "line-time-unknown", ticket: "265", template: "The leave time for {event} is unknown.",
    situation: "Line form, when no leave time can be given.",
    replaces: null },
  { id: "line-time-unknown-late", ticket: "265", template: "The leave time for {event} is unknown, because you may arrive late at {other event}.",
    situation: "Line form, when the trip before arrives late.",
    replaces: null },
  { id: "home-appears-by", ticket: "265", template: "The leave time for the trip home appears by {time}.",
    situation: "Line form for the trip home, before its estimate is due.",
    replaces: null },
  { id: "home-appears-later", ticket: "265", template: "The leave time for the trip home appears later.",
    situation: "Line form for the trip home, when its start is unknown.",
    replaces: null },
  { id: "home-ready", ticket: "265", template: "The leave time for the trip home is ready to check.",
    situation: "Line form for the trip home, after its estimate was due.",
    replaces: null },
  { id: "home-no-route", ticket: "265", template: "No route found for the trip home.",
    situation: "Line form for the trip home, when no route was found.",
    replaces: null },
  { id: "home-expired", ticket: "265", template: "The estimate for the trip home expired.",
    situation: "Line form for the trip home, when its estimate expired.",
    replaces: null },
  { id: "home-changed", ticket: "265", template: "The trip home changed.",
    situation: "Line form for the trip home, after the plan changed.",
    replaces: null },
  { id: "paused", ticket: "265", template: "Travel estimates are paused.",
    situation: "The travel budget is used up and its renewal date is unknown.",
    replaces: null },
];

const WEATHER_CONDITIONS: Readonly<Record<WeatherConditionId, string>> = {
  thunderstorm: "thunderstorms",
  snow: "snow",
  freezing_precipitation: "freezing rain",
  heavy_rain: "heavy rain",
  rain: "rain",
  extreme_heat: "extreme heat",
  strong_wind: "strong wind",
};

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

/** "15 min added for thunderstorms." The leave time already includes it. Empty with no margin. */
export function departureWeatherMarginPhrase(marginMinutes: number, conditions: readonly WeatherConditionId[]): string {
  const condition = conditions[0];
  if (!condition || marginMinutes <= 0) return "";
  return `${marginMinutes} min added for ${WEATHER_CONDITIONS[condition]}.`;
}

/** The Daily Brief travel block's footer: who calculated it, from what, and when. */
export function departureBriefFooterPhrase(attribution: string | null, at: string, context: DeparturePhraseContext): string {
  return ["Calculated by Cadence", attribution, departureTimeLabel(at, context)].filter(Boolean).join(" · ") + ".";
}

/** A Behavior crowded by a trip: names the trip and its span. */
export function departureOverlapPhrase(input: Readonly<{ home: boolean; destinationLabel: string | null; startAt: string; endAt: string }>,
  context: DeparturePhraseContext): string {
  const trip = input.home ? "your trip home" : `your trip to ${input.destinationLabel ?? NEXT_STOP_FALLBACK}`;
  return `Overlaps ${trip} (${departureTimeLabel(input.startAt, context)}–${departureTimeLabel(input.endAt, context)})`;
}

/** An all-day event's days, the last one inclusive: "Nov 1 – Nov 2", or "Nov 1" for one day. */
export function allDayRangeLabel(startLocalDate: string, endLocalDateExclusive: string): string {
  const start = Temporal.PlainDate.from(startLocalDate);
  const lastDay = Temporal.PlainDate.from(endLocalDateExclusive).subtract({ days: 1 });
  const day = (date: Temporal.PlainDate) => `${MONTHS_SHORT[date.month - 1]} ${date.day}`;
  return Temporal.PlainDate.compare(lastDay, start) <= 0 ? day(start) : `${day(start)} – ${day(lastDay)}`;
}

/** The plain word for an event that is not confirmed. Confirmed says nothing. */
export function eventStateWord(state: ExternalEventState): string | null {
  if (state === "tentative") return "Tentative";
  if (state === "cancelled") return "Cancelled";
  return null;
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
    return input.timeUnknownCause === "home_missing" ? `${RETURN_TIME_UNKNOWN} Add Home in Settings to estimate it.` : RETURN_TIME_UNKNOWN;
  }
  if (input.timeUnknownCause === "late_arrival") {
    return `The leave time${named ? ` for ${destination}` : ""} is unknown, because you may arrive late at ${input.blockingLabel ?? PRIOR_STOP_FALLBACK}.`;
  }
  return named ? `The leave time for ${destination} is unknown.` : "Leave time unknown.";
}
