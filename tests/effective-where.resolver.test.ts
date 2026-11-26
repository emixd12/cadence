import { describe, expect, it } from "vitest";
import {
  EFFECTIVE_WHERE_EVIDENCE_MAJORITY_PERCENT,
  EFFECTIVE_WHERE_EVIDENCE_MINIMUM_LABELS,
  EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS,
  isWhereGuess,
  resolveEffectiveWhere,
  type EffectiveWhereInput,
} from "@cadence/core/resolvers/effective-where.resolver";
import { WHERE_SUGGESTION_RULES_V1 } from "@cadence/core/resolvers/place-label.resolver";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import * as compatibility from "@/lib/resolvers/effective-where.resolver";

// Ticket 357 (D33): the person's Where, then counted completion place labels, then the
// cached model guess, then unknown, always with the source.

const DAY = "2026-11-25";
const GYM = travelPlaceKey("1 Gym Street");
const OFFICE = travelPlaceKey("9 Office Road");

function where(overrides: Partial<EffectiveWhereInput>) {
  return resolveEffectiveWhere({ whereKind: null, labels: [], guess: null, localDate: DAY, ...overrides });
}

/** `count` labels of one value, on consecutive days ending at DAY. */
function labels(label: string, count: number, endDay = 25) {
  return Array.from({ length: count }, (_, index) => ({ label, localDate: `2026-11-${String(endDay - index).padStart(2, "0")}` }));
}

describe("resolveEffectiveWhere", () => {
  it("uses the person's Where first", () => {
    expect(where({ whereKind: "home", labels: labels("elsewhere", 10), guess: "anywhere" })).toEqual({ kind: "home", source: "person" });
    expect(where({ whereKind: "anywhere", guess: "home" })).toEqual({ kind: "anywhere", source: "person" });
    expect(where({ whereKind: "place", locationText: "1 Gym Street" })).toEqual({ kind: "place", placeKey: GYM, source: "person" });
    // Equal normalized text names the same place.
    expect(where({ whereKind: "place", locationText: "  1 gym street " }).placeKey).toBe(GYM);
    expect(where({ whereKind: "place", locationText: null })).toEqual({ kind: "place", source: "person" });
  });

  it("then a clear majority of completion place labels", () => {
    expect(where({ labels: labels("home", 6) })).toEqual({ kind: "home", source: "evidence" });
    expect(where({ labels: labels("elsewhere", 6) })).toEqual({ kind: "elsewhere", source: "evidence" });
    expect(where({ labels: labels(`saved_place:${GYM}`, 6) })).toEqual({ kind: "place", placeKey: GYM, source: "evidence" });
    // 5 of 6 (83%) is a clear majority; 4 of 6 (67%) is not.
    expect(where({ labels: [...labels("home", 5), ...labels("elsewhere", 1, 10)] })).toEqual({ kind: "home", source: "evidence" });
    expect(where({ labels: [...labels("home", 4), ...labels(`saved_place:${OFFICE}`, 2, 10)], guess: "elsewhere" }))
      .toEqual({ kind: "elsewhere", source: "guess" });
  });

  it("needs the minimum count inside the period", () => {
    expect(where({ labels: labels("home", 5) })).toEqual({ kind: "unknown", source: "none" });
    // The period is 60 days ending on the planned day: 2026-09-27 through 2026-11-25.
    const atEdge = [...labels("home", 5), { label: "home", localDate: "2026-09-27" }];
    expect(where({ labels: atEdge })).toEqual({ kind: "home", source: "evidence" });
    const tooOld = [...labels("home", 5), { label: "home", localDate: "2026-09-26" }];
    expect(where({ labels: tooOld })).toEqual({ kind: "unknown", source: "none" });
    const future = [...labels("home", 5), { label: "home", localDate: "2026-11-26" }];
    expect(where({ labels: future })).toEqual({ kind: "unknown", source: "none" });
  });

  it("ignores labels that are not place label values", () => {
    expect(where({ labels: [...labels("home", 5), ...labels("saved_place:not-a-key", 3, 10)] })).toEqual({ kind: "unknown", source: "none" });
  });

  it("then the cached guess, and unknown without one", () => {
    expect(where({ guess: "home" })).toEqual({ kind: "home", source: "guess" });
    expect(where({ guess: "anywhere" })).toEqual({ kind: "anywhere", source: "guess" });
    expect(where({ guess: "elsewhere" })).toEqual({ kind: "elsewhere", source: "guess" });
    expect(where({ guess: "unknown" })).toEqual({ kind: "unknown", source: "none" });
    expect(where({ guess: "the gym" })).toEqual({ kind: "unknown", source: "none" });
    expect(where({})).toEqual({ kind: "unknown", source: "none" });
  });

  it("knows the four guess values and nothing else", () => {
    for (const value of ["home", "anywhere", "elsewhere", "unknown"]) expect(isWhereGuess(value)).toBe(true);
    for (const value of ["place", "", null, GYM, "saved_place:x"]) expect(isWhereGuess(value)).toBe(false);
  });
});

describe("evidence thresholds", () => {
  it("match the Where suggestion rules, so planning assumes what the suggestion would offer", () => {
    expect(EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS).toBe(WHERE_SUGGESTION_RULES_V1.periodDays);
    expect(EFFECTIVE_WHERE_EVIDENCE_MINIMUM_LABELS).toBe(WHERE_SUGGESTION_RULES_V1.minimumLabels);
    expect(EFFECTIVE_WHERE_EVIDENCE_MAJORITY_PERCENT).toBe(WHERE_SUGGESTION_RULES_V1.dominantPercent);
    expect([EFFECTIVE_WHERE_EVIDENCE_PERIOD_DAYS, EFFECTIVE_WHERE_EVIDENCE_MINIMUM_LABELS, EFFECTIVE_WHERE_EVIDENCE_MAJORITY_PERCENT]).toEqual([60, 6, 80]);
  });
});

describe("compatibility export", () => {
  it("re-exports the core resolver", () => {
    expect(compatibility.resolveEffectiveWhere).toBe(resolveEffectiveWhere);
  });
});
