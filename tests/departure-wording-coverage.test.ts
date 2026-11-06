import { describe, expect, it } from "vitest";
import {
  departureDetailPhrase,
  departureLinePhrase,
  departurePhraseContext,
  type DeparturePhraseInput,
} from "@cadence/core/services/departure-phrases";
import type { DepartureState, DepartureTimeUnknownCause } from "@cadence/core/types/departure";
import { departureWordingRows } from "@/app/design-system/DepartureWordingReview";

/**
 * Ticket 266: every sentence the two phrase builders can produce must appear on the bench's
 * wording review, or be a Ticket 261 form the owner approved. Otherwise the list can drift.
 */
const APPROVED_TICKET_261 = [
  "Leave by {time} from Home · {mode}, arrive {time}.",
  "Head home {time} · {mode}, home by {time}.",
  "Leave time appears by {time}.",
  "Estimate expired.",
  "Trip changed.",
  "No route found.",
  "Travel estimates resume on {date}.",
];

/** " from Home" shows only for a trip that starts at Home. */
function pattern(template: string): RegExp {
  const escaped = template.split(/\{[^}]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?");
  return new RegExp(`^${escaped.replaceAll(" from Home", "(?: from Home)?")}$`);
}

const TZ = "America/New_York";
const at = (time: string) => `2026-11-10T${time}:00-05:00`;
const context = departurePhraseContext(at("09:00"), TZ);
const STATES: Exclude<DepartureState, "none">[] = ["upcoming", "soon", "leave_now", "late", "head_home", "appears_later", "needs_place",
  "needs_origin", "time_unknown", "no_route", "trip_changed", "estimate_expired", "paused"];
const CAUSES: (DepartureTimeUnknownCause | null)[] = [null, "home_missing", "late_arrival", "no_known_end", "leg_limit"];

/** Countdowns each state can carry in the model: soon always has one, leave now never. */
function minutes(state: DepartureState): (number | null)[] {
  if (state === "soon") return [20];
  if (state === "leave_now") return [null];
  if (state === "upcoming") return [45];
  return [null, 20, 45];
}

function inputs(): DeparturePhraseInput[] {
  const all: DeparturePhraseInput[] = [];
  for (const state of STATES) for (const role of ["outbound", "onward", "return"] as const)
    for (const freshness of ["current", "last_estimate"] as const) for (const lateBasis of state === "late" ? ["evidence", "clock"] as const : [null])
      for (const minutesUntilLeave of minutes(state)) for (const fromHome of [true, false]) for (const destinationLabel of ["Dentist", null])
        for (const appears of [null, "due", "overdue"] as const) for (const timeUnknownCause of state === "time_unknown" ? CAUSES : [null])
          for (const blockingLabel of ["Gym", null]) for (const resumesAt of state === "paused" ? [null, "2026-12-01T05:00:00Z"] : [null])
            all.push({ state, role, freshness, lateBasis, minutesUntilLeave, fromHome, mode: "walking", destinationLabel,
              checkedAt: at("08:55"), leaveAt: at("13:20"), arriveAt: at("13:55"),
              appearsAt: appears ? at("10:55") : null, appearsOverdue: appears === "overdue", timeUnknownCause, blockingLabel, resumesAt });
  return all;
}

describe("departure wording review coverage", () => {
  it("lists every sentence the phrase builders produce", () => {
    const patterns = [...departureWordingRows().map((row) => row.template), ...APPROVED_TICKET_261].map(pattern);
    const missing = new Set<string>();
    for (const input of inputs()) for (const sentence of [departureDetailPhrase(input, context), departureLinePhrase(input, context)]) {
      if (!patterns.some((candidate) => candidate.test(sentence))) missing.add(sentence);
    }
    expect([...missing].sort()).toEqual([]);
  });
});
