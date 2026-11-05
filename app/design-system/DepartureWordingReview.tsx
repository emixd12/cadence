"use client";

import {
  DEPARTURE_PHRASE_REVIEW,
  OWNER_APPROVED_2026_11_05,
  RETURN_TIME_UNKNOWN,
  allDayRangeLabel,
  departureBriefFooterPhrase,
  departureCheckedPhrase,
  departureDetailPhrase,
  departureFreeAgainPhrase,
  departureLinePhrase,
  departureOverlapPhrase,
  departurePhraseContext,
  departureWeatherMarginPhrase,
  eventStateWord,
  type DeparturePhraseInput,
} from "@cadence/core/services/departure-phrases";
import { TRAVEL_CORRECTION_NOTE } from "@/components/timeline/ExternalEventDetails";
import { TRAVEL_CLEARANCE_MESSAGE, TRAVEL_UNAVAILABLE_MESSAGE } from "@/lib/ui/travel";

/**
 * Ticket 266: every reviewed travel phrase, rendered by the real phrase functions with sample
 * values. The list and its approval dates come from `departure-phrases.ts`, so it cannot drift.
 */

const TIMEZONE = "America/New_York";
const at = (time: string) => `2026-11-10T${time}:00-05:00`;
const CONTEXT = departurePhraseContext(at("09:00"), TIMEZONE);
const EVENT = "Dentist";

const BASE: DeparturePhraseInput = {
  state: "upcoming", lateBasis: null, role: "outbound", mode: "walking", fromHome: true, freshness: "current",
  checkedAt: at("13:00"), leaveAt: at("13:20"), arriveAt: at("13:55"), minutesUntilLeave: 45, appearsAt: null,
  timeUnknownCause: null, blockingLabel: null, destinationLabel: EVENT, appearsOverdue: false, resumesAt: null,
};
const HOME_TRIP: Partial<DeparturePhraseInput> = { role: "return", fromHome: false, leaveAt: at("15:00"), arriveAt: at("15:30"), destinationLabel: null };
const detail = (input: Partial<DeparturePhraseInput>) => departureDetailPhrase({ ...BASE, ...input }, CONTEXT);
const line = (input: Partial<DeparturePhraseInput>) => departureLinePhrase({ ...BASE, ...input }, CONTEXT);
const old: Partial<DeparturePhraseInput> = { freshness: "last_estimate", checkedAt: at("08:55") };

/** Sample renderings by phrase id. A test checks that every listed phrase has one and matches its template. */
export const DEPARTURE_WORDING_SAMPLES: Readonly<Record<string, () => string>> = {
  "last-estimate-leave-by": () => detail(old),
  "return-time-unknown": () => detail({ ...HOME_TRIP, state: "time_unknown", timeUnknownCause: "no_known_end", leaveAt: null, arriveAt: null }),
  "overlap-return-unknown": () => RETURN_TIME_UNKNOWN,
  "weather-margin": () => departureWeatherMarginPhrase(15, ["thunderstorm"]),
  "checked": () => departureCheckedPhrase("Google Maps", at("13:00"), CONTEXT),
  "brief-footer": () => departureBriefFooterPhrase("Google Maps", at("09:00"), CONTEXT),
  "overlap-trip-to": () => departureOverlapPhrase({ home: false, destinationLabel: EVENT, startAt: at("13:20"), endAt: at("13:55") }, CONTEXT),
  "overlap-trip-home": () => departureOverlapPhrase({ home: true, destinationLabel: null, startAt: at("15:00"), endAt: at("15:30") }, CONTEXT),
  "free-again": () => departureFreeAgainPhrase(at("15:30"), CONTEXT),
  "all-day-range": () => allDayRangeLabel("2026-11-10", "2026-11-12"),
  "event-tentative": () => eventStateWord("tentative") ?? "",
  "event-cancelled": () => eventStateWord("cancelled") ?? "",
  "soon": () => detail({ state: "soon", minutesUntilLeave: 20 }),
  "leave-now": () => detail({ state: "leave_now", minutesUntilLeave: null }),
  "late-before-leave": () => detail({ state: "late", lateBasis: "evidence", minutesUntilLeave: 10, arriveAt: at("14:05") }),
  "late-after-leave": () => detail({ state: "late", lateBasis: "evidence", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "past-leave-time": () => detail({ state: "late", lateBasis: "clock", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "past-leave-time-home": () => detail({ ...HOME_TRIP, state: "late", lateBasis: "clock", minutesUntilLeave: null, arriveAt: at("15:40") }),
  "head-home-soon": () => detail({ ...HOME_TRIP, state: "head_home", minutesUntilLeave: 20 }),
  "head-home-now": () => detail({ ...HOME_TRIP, state: "head_home", minutesUntilLeave: null }),
  "last-estimate-leave-now": () => detail({ ...old, state: "leave_now", minutesUntilLeave: null }),
  "last-estimate-late-before": () => detail({ ...old, state: "late", lateBasis: "evidence", minutesUntilLeave: 10, arriveAt: at("14:05") }),
  "last-estimate-late-after": () => detail({ ...old, state: "late", lateBasis: "evidence", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "last-estimate-past-leave": () => detail({ ...old, state: "late", lateBasis: "clock", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "last-estimate-head-home": () => detail({ ...old, ...HOME_TRIP, state: "head_home", minutesUntilLeave: 20 }),
  "appears-overdue": () => detail({ state: "appears_later", appearsAt: at("10:55"), appearsOverdue: true }),
  "needs-place": () => detail({ state: "needs_place" }),
  "needs-attendance": () => detail({ state: "needs_attendance" }),
  "needs-origin-blocked": () => detail({ state: "needs_origin", blockingLabel: "Gym" }),
  "needs-origin-home": () => detail({ state: "needs_origin" }),
  "time-unknown": () => detail({ state: "time_unknown", timeUnknownCause: "leg_limit" }),
  "time-unknown-late": () => detail({ state: "time_unknown", timeUnknownCause: "late_arrival", blockingLabel: "Gym" }),
  "line-leave-by": () => line({}),
  "line-soon": () => line({ state: "soon", minutesUntilLeave: 20 }),
  "line-leave-now": () => line({ state: "leave_now", minutesUntilLeave: null }),
  "line-late": () => line({ state: "late", lateBasis: "evidence", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "line-past-leave-time": () => line({ state: "late", lateBasis: "clock", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "line-last-estimate": () => line(old),
  "line-appears-by": () => line({ state: "appears_later", appearsAt: at("10:55") }),
  "line-appears-later": () => line({ state: "appears_later", appearsAt: null }),
  "line-ready": () => line({ state: "appears_later", appearsAt: at("10:55"), appearsOverdue: true }),
  "line-expired": () => line({ state: "estimate_expired" }),
  "line-no-route": () => line({ state: "no_route" }),
  "line-changed": () => line({ state: "trip_changed" }),
  "line-changed-unnamed": () => line({ state: "trip_changed", destinationLabel: null }),
  "line-time-unknown": () => line({ state: "time_unknown", timeUnknownCause: "leg_limit" }),
  "line-time-unknown-late": () => line({ state: "time_unknown", timeUnknownCause: "late_arrival", blockingLabel: "Gym" }),
  "home-appears-by": () => line({ ...HOME_TRIP, state: "appears_later", appearsAt: at("12:00") }),
  "home-expired": () => line({ ...HOME_TRIP, state: "estimate_expired" }),
  "home-changed": () => line({ ...HOME_TRIP, state: "trip_changed" }),
  "appears-later": () => detail({ state: "appears_later", appearsAt: null }),
  "last-estimate-past-leave-home": () => detail({ ...old, ...HOME_TRIP, state: "late", lateBasis: "clock", minutesUntilLeave: null, arriveAt: at("15:40") }),
  "line-late-before-leave": () => line({ state: "late", lateBasis: "evidence", minutesUntilLeave: 10, arriveAt: at("14:05") }),
  "line-last-estimate-leave-now": () => line({ ...old, state: "leave_now", minutesUntilLeave: null }),
  "line-last-estimate-late-before": () => line({ ...old, state: "late", lateBasis: "evidence", minutesUntilLeave: 10, arriveAt: at("14:05") }),
  "line-last-estimate-late-after": () => line({ ...old, state: "late", lateBasis: "evidence", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "line-last-estimate-past-leave": () => line({ ...old, state: "late", lateBasis: "clock", minutesUntilLeave: null, arriveAt: at("14:05") }),
  "home-appears-later": () => line({ ...HOME_TRIP, state: "appears_later", appearsAt: null }),
  "home-ready": () => line({ ...HOME_TRIP, state: "appears_later", appearsAt: at("12:00"), appearsOverdue: true }),
  "home-no-route": () => line({ ...HOME_TRIP, state: "no_route" }),
  "paused": () => detail({ state: "paused", resumesAt: null }),
};

export type DepartureWordingRow = Readonly<{ id: string; ticket: string; source: string; sample: string; template: string; situation: string; replaces: string | null;
  approvedOn: string | null; ownerChange: Readonly<{ id: string; before: string }> | null }>;

/** The rows the review shows: the module's list, then the two Ticket 261 phrases kept outside it. */
export function departureWordingRows(): DepartureWordingRow[] {
  return [
    ...DEPARTURE_PHRASE_REVIEW.map((entry) => ({ ...entry, source: "departure-phrases.ts",
      sample: DEPARTURE_WORDING_SAMPLES[entry.id]?.() ?? "" })),
    { id: "correction-note", ticket: "261", source: "ExternalEventDetails.tsx", sample: TRAVEL_CORRECTION_NOTE, template: TRAVEL_CORRECTION_NOTE,
      situation: "Calendar details, under the form that corrects attendance or the destination for one journey.",
      replaces: "Applies only to this event revision while the Timeline is open.", approvedOn: OWNER_APPROVED_2026_11_05, ownerChange: null },
    { id: "production-unavailable", ticket: "261", source: "lib/ui/travel.ts", sample: TRAVEL_UNAVAILABLE_MESSAGE, template: TRAVEL_UNAVAILABLE_MESSAGE,
      situation: "Travel status line in production builds while travel waits for the deployment's provider review.",
      replaces: TRAVEL_CLEARANCE_MESSAGE, approvedOn: OWNER_APPROVED_2026_11_05, ownerChange: null },
  ];
}

export function DepartureWordingReview() {
  const rows = departureWordingRows();
  const pending = rows.filter((row) => !row.approvedOn).length;
  return <section aria-labelledby="departure-wording-title" className="grid gap-4" data-departure-wording-review>
    <div className="grid gap-2">
      <h2 id="departure-wording-title" className="text-xl font-bold">Travel wording</h2>
      <p className="max-w-3xl text-sm leading-6 text-muted-readable" data-wording-approval>
        {pending ? `${pending} of ${rows.length} phrases await the owner's approval. ` : `All ${rows.length} phrases approved by the owner on ${approvalDate(OWNER_APPROVED_2026_11_05)}, with changes R1–R3. `}
        Each sentence is rendered by the product code with sample values: Dentist at 2 PM, leaving Home at 1:20 PM on foot,
        and Gym as the stop before it. Times on November 10 show without a date.
      </p>
    </div>
    <ol className="grid gap-3">
      {rows.map((row) => <li key={row.id} className="grid min-w-0 gap-2 border border-line bg-background p-4" data-wording-id={row.id}>
        <p className="break-words text-base font-bold [overflow-wrap:anywhere]" data-wording-sample>{row.sample}</p>
        <dl className="grid gap-x-4 gap-y-1 text-sm leading-6 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-readable">Status</dt><dd className="min-w-0 break-words" data-wording-status>{row.approvedOn ? `Approved ${approvalDate(row.approvedOn)}` : "Not yet approved"}{row.ownerChange ? ` with owner change ${row.ownerChange.id}. Proposed: “${row.ownerChange.before}”` : ""}</dd>
          <dt className="text-muted-readable">Shown when</dt><dd className="min-w-0 break-words">{row.situation}</dd>
          <dt className="text-muted-readable">Replaces</dt><dd className="min-w-0 break-words">{row.replaces ? `“${row.replaces}”` : "Nothing. This is a new line."}</dd>
          <dt className="text-muted-readable">Pattern</dt><dd className="min-w-0 break-words">{row.template}</dd>
          <dt className="text-muted-readable">From</dt><dd className="min-w-0 break-words">Ticket {row.ticket} · {row.source}</dd>
        </dl>
      </li>)}
    </ol>
  </section>;
}

function approvalDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month! - 1]} ${day}, ${year}`;
}
