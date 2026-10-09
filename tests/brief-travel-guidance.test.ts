import { describe, expect, it } from "vitest";
import { overlapsTravelSpans, projectBriefTravelGuidance, type BriefTravelEvidence } from "@cadence/core/services/brief-travel-guidance";

// Dentist 15:00–16:00Z. Outbound leg leaves 14:30Z; return leg leaves 16:10Z; walk occurrence 14:45Z collides with outbound travel.
const provenance = { originRef: "o", originSource: "device", originRevision: "1", destinationRef: "d", destinationSource: "calendar", destinationRevision: "1", grantRevision: "g" } as never;
const estimate = (departureAt: string, arrivalAt: string, expiresAt = "2026-09-21T15:30:00Z") => ({
  durationSeconds: 1800, departureAt, arrivalAt, warnings: [], fallback: false, attribution: "Google Maps", observedAt: "2026-09-21T13:00:00Z", expiresAt,
});
function evidence(overrides: Partial<BriefTravelEvidence> = {}): BriefTravelEvidence {
  return {
    version: "1.0" as never, journeyRef: "journey",
    legs: [
      { leg: { id: "leg-out", role: "outbound", journeyRef: "journey", originCommitmentRef: null, destinationCommitmentRef: "event-dentist", mode: "driving", readyAt: "2026-09-21T13:00:00Z", provenance }, state: "current", estimate: estimate("2026-09-21T14:30:00Z", "2026-09-21T15:00:00Z"), reason: null },
      { leg: { id: "leg-back", role: "return", journeyRef: "journey", originCommitmentRef: "event-dentist", destinationCommitmentRef: null, mode: "driving", readyAt: "2026-09-21T16:00:00Z", provenance }, state: "current", estimate: estimate("2026-09-21T16:10:00Z", "2026-09-21T16:40:00Z"), reason: null },
    ],
    segments: [
      { id: "seg-route", kind: "route", startAt: "2026-09-21T14:30:00Z", endAt: "2026-09-21T15:00:00Z", sourceRefs: ["event-dentist"], legId: "leg-out" },
      { id: "seg-event", kind: "commitment", startAt: "2026-09-21T15:00:00Z", endAt: "2026-09-21T16:00:00Z", sourceRefs: ["event-dentist"], legId: null },
    ],
    occupiedSpans: [{ startAt: "2026-09-21T14:30:00Z", endAt: "2026-09-21T16:40:00Z", segmentIds: ["seg-route", "seg-event"] }],
    collisions: [{ candidateRef: "occ-walk", segmentIds: ["seg-route"], travelCreated: true }, { candidateRef: "event-dentist", segmentIds: ["seg-event"], travelCreated: false }],
    completeTrip: true, finalAvailabilityAt: "2026-09-21T16:40:00Z",
    ...overrides,
  };
}
const labels = new Map([["event-dentist", "Dentist"], ["occ-walk", "Walk"]]);
const input = (value: BriefTravelEvidence | null, now = "2026-09-21T13:10:00Z") => ({ evidence: value, localDate: "2026-09-21", now, labels, behaviorRefs: new Set(["occ-walk"]) });

describe("brief travel guidance", () => {
  it("projects travel-created Behavior overlaps, departures and the return from existing evidence", () => {
    const guidance = projectBriefTravelGuidance({ ...input(evidence()), options: [
      { id: "option-crowded", startAt: "2026-09-21T16:20:00Z", endAt: "2026-09-21T16:50:00Z" },
      { id: "option-clear", startAt: "2026-09-21T17:00:00Z", endAt: "2026-09-21T17:30:00Z" },
    ] });
    expect(guidance).toEqual({
      localDate: "2026-09-21", observedAt: "2026-09-21T13:00:00Z", expiresAt: "2026-09-21T15:30:00Z", attribution: "Google Maps",
      items: [
        { kind: "overlap", behaviorLabel: "Walk", travelLabel: "Dentist" },
        { kind: "departure", at: "2026-09-21T14:30:00Z", label: "Dentist", mode: "driving" },
        { kind: "return", at: "2026-09-21T16:40:00Z" },
      ],
      conflictingOptionIds: ["option-crowded"],
      occupiedSpans: [{ startAt: "2026-09-21T14:30:00Z", endAt: "2026-09-21T16:40:00Z" }],
    });
  });

  it("withholds only the final return without a base and never treats unknown travel as free", () => {
    const withoutBase = evidence({ legs: [evidence().legs[0]!], completeTrip: false, finalAvailabilityAt: null });
    const guidance = projectBriefTravelGuidance(input(withoutBase))!;
    expect(guidance.items).toEqual([
      { kind: "overlap", behaviorLabel: "Walk", travelLabel: "Dentist" },
      { kind: "departure", at: "2026-09-21T14:30:00Z", label: "Dentist", mode: "driving" },
      { kind: "return_unknown" },
    ]);
    expect(overlapsTravelSpans({ startAt: "2026-09-21T16:00:00Z", endAt: "2026-09-21T16:30:00Z" }, guidance.occupiedSpans)).toBe(true);
  });

  it("withdraws expired or stale timing instead of presenting it as current", () => {
    expect(projectBriefTravelGuidance(input(evidence(), "2026-09-21T15:31:00Z"))).toBeNull();
    const stale = evidence({ legs: evidence().legs.map((item) => ({ ...item, state: "stale" as const })) });
    expect(projectBriefTravelGuidance(input(stale))).toBeNull();
    expect(projectBriefTravelGuidance(input(null))).toBeNull();
  });

  it("covers every existing travel mode and keeps departures after now", () => {
    for (const mode of ["walking", "cycling", "transit", "driving"] as const) {
      const legs = evidence().legs.map((item) => ({ ...item, leg: { ...item.leg, mode } }));
      expect(projectBriefTravelGuidance(input(evidence({ legs })))!.items.find((item) => item.kind === "departure")).toMatchObject({ mode });
    }
    expect(projectBriefTravelGuidance(input(evidence(), "2026-09-21T14:40:00Z"))!.items.some((item) => item.kind === "departure")).toBe(false);
  });
});

it("derives labels and only Unresolved Behavior candidates from Timeline rows", async () => {
  const { briefTravelSubjects } = await import("@cadence/core/services/brief-travel-guidance");
  const subjects = briefTravelSubjects([{ id: "occ-walk", title: "Walk", status: "unresolved" }, { id: "occ-read", title: "Read", status: "completed" }], [{ id: "event-dentist", title: "Dentist" }]);
  expect([...subjects.labels]).toEqual([["occ-walk", "Walk"], ["occ-read", "Read"], ["event-dentist", "Dentist"]]);
  expect([...subjects.behaviorRefs]).toEqual(["occ-walk"]);
});

it("drops overlaps from a leg that is no longer current", () => {
  const legs = evidence().legs.map((item) => item.leg.id === "leg-out" ? { ...item, state: "stale" as const } : item);
  const guidance = projectBriefTravelGuidance(input(evidence({ legs })))!;
  expect(guidance.items.some((item) => item.kind === "overlap")).toBe(false);
});
