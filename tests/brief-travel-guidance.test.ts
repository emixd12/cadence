import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";
import { resolveTravelEvidence, resolveTravelPlan } from "@cadence/core/resolvers/travel.resolver";
import { overlapsTravelSpans, projectBriefTravelGuidance, type BriefTravelEvidence } from "@cadence/core/services/brief-travel-guidance";
import type { DepartureStop } from "@cadence/core/types/departure";

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
const TZ = "America/New_York";
const DENTIST: DepartureStop = { ref: "event-dentist", label: "Dentist", startAt: "2026-09-21T15:00:00Z", endAt: "2026-09-21T16:00:00Z" };
/** Ticket 272: the guidance reads the departure model for the same evidence and clock, as the Timeline does. */
function departureFor(value: BriefTravelEvidence | null, now: string, stops: readonly DepartureStop[] = [DENTIST]) {
  return resolveDepartureModel({ evidence: value, stops, now, timezone: TZ, arrivalBufferSeconds: 0, preparationSeconds: 0, pausedUntil: null });
}
const input = (value: BriefTravelEvidence | null, now = "2026-09-21T13:10:00Z") => ({ evidence: value, departure: departureFor(value, now),
  localDate: "2026-09-21", now, timezone: TZ, labels, behaviorRefs: new Set(["occ-walk"]) });
const phrases = (value: ReturnType<typeof projectBriefTravelGuidance>) => value?.items.map((item) => item.phrase) ?? [];

describe("brief travel guidance", () => {
  it("projects travel-created Behavior overlaps, departures and the return from existing evidence", () => {
    const guidance = projectBriefTravelGuidance({ ...input(evidence()), options: [
      { id: "option-crowded", startAt: "2026-09-21T16:20:00Z", endAt: "2026-09-21T16:50:00Z" },
      { id: "option-clear", startAt: "2026-09-21T17:00:00Z", endAt: "2026-09-21T17:30:00Z" },
    ] });
    expect(guidance).toEqual({
      localDate: "2026-09-21", observedAt: "2026-09-21T13:00:00Z", expiresAt: "2026-09-21T15:30:00Z", attribution: "Google Maps",
      items: [
        { kind: "overlap", phrase: "Travel to Dentist overlaps Walk.", weather: null },
        { kind: "departure", phrase: "Leave by 10:30 AM for Dentist · driving, arrive 11:00 AM.", weather: null },
        { kind: "return", phrase: "Back around 12:40 PM.", weather: null },
      ],
      conflictingOptionIds: ["option-crowded"],
      occupiedSpans: [{ startAt: "2026-09-21T14:30:00Z", endAt: "2026-09-21T16:40:00Z" }],
      weather: null,
    });
  });

  it("withholds only the final return without a base and never treats unknown travel as free", () => {
    const withoutBase = evidence({ legs: [evidence().legs[0]!], completeTrip: false, finalAvailabilityAt: null });
    const guidance = projectBriefTravelGuidance(input(withoutBase))!;
    expect(phrases(guidance)).toEqual([
      "Travel to Dentist overlaps Walk.",
      "Leave by 10:30 AM for Dentist · driving, arrive 11:00 AM.",
      "Return time unknown.",
    ]);
    expect(overlapsTravelSpans({ startAt: "2026-09-21T16:00:00Z", endAt: "2026-09-21T16:30:00Z" }, guidance.occupiedSpans)).toBe(true);
  });

  it("marks an expired estimate as the last estimate instead of withdrawing it (Ticket 272, D1)", () => {
    // Expiry is 15:30Z; at 13:40Z with an estimate expiring at 13:05Z the leave time stays, marked.
    const expired = evidence({ legs: evidence().legs.map((item) => ({ ...item, estimate: { ...item.estimate!, expiresAt: "2026-09-21T13:05:00Z" } })) });
    const guidance = projectBriefTravelGuidance(input(expired, "2026-09-21T13:40:00Z"))!;
    expect(phrases(guidance)).toEqual([
      "Travel to Dentist overlaps Walk.",
      "Last estimate: leave by 10:30 AM for Dentist · checked 9:00 AM.",
      "Back around 12:40 PM.",
    ]);
    expect(guidance.observedAt).toBe("2026-09-21T13:00:00Z");
    // A stale leg keeps its last estimate too.
    const stale = evidence({ legs: evidence().legs.map((item) => ({ ...item, state: "stale" as const })) });
    expect(phrases(projectBriefTravelGuidance(input(stale)))).toContain("Last estimate: leave by 10:30 AM for Dentist · checked 9:00 AM.");
    expect(projectBriefTravelGuidance(input(null))).toBeNull();
  });

  it("shows a late trip as late instead of dropping it (Ticket 264 verification)", () => {
    // The route arrives after the planned arrival. At 14:32Z the leave time has just passed.
    const legs = evidence().legs.map((item) => item.leg.role === "outbound" ? { ...item, late: true,
      estimate: { ...item.estimate!, departureAt: "2026-09-21T14:30:00Z", arrivalAt: "2026-09-21T15:10:00Z" } } : item);
    expect(phrases(projectBriefTravelGuidance(input(evidence({ legs }), "2026-09-21T14:32:00Z")))).toContain("You may arrive late at Dentist: arrive 11:10 AM.");
    // On time, but the clock is 10 minutes past the leave time: still shown, as a rough arrival.
    expect(phrases(projectBriefTravelGuidance(input(evidence(), "2026-09-21T14:40:00Z")))).toContain("If you haven't left for Dentist yet, you'd arrive about 11:10 AM.");
    // Once the trip has arrived, the model drops it and so does the brief.
    expect(projectBriefTravelGuidance(input(evidence(), "2026-09-21T15:05:00Z"))!.items.some((item) => item.kind === "departure")).toBe(false);
  });

  it("shows the trip home from the model once it is the next trip", () => {
    const fresh = evidence({ legs: evidence().legs.map((item) => ({ ...item, estimate: { ...item.estimate!, expiresAt: "2026-09-21T17:00:00Z" } })) });
    expect(phrases(projectBriefTravelGuidance(input(fresh, "2026-09-21T15:45:00Z")))).toEqual(["Head home in 25 minutes, by 12:10 PM · driving, home by 12:40 PM."]);
    // After expiry the line stays, marked.
    expect(phrases(projectBriefTravelGuidance(input(evidence(), "2026-09-21T15:45:00Z")))).toEqual(["Last estimate: head home 12:10 PM · checked 9:00 AM."]);
    // After the trip home arrives nothing is left to say.
    expect(phrases(projectBriefTravelGuidance(input(evidence(), "2026-09-21T16:45:00Z")))).toEqual([]);
  });

  it("covers every existing travel mode", () => {
    for (const mode of ["walking", "cycling", "transit", "driving"] as const) {
      const legs = evidence().legs.map((item) => ({ ...item, leg: { ...item.leg, mode } }));
      expect(phrases(projectBriefTravelGuidance(input(evidence({ legs }))))).toContain(`Leave by 10:30 AM for Dentist · ${mode}, arrive 11:00 AM.`);
    }
  });
});

it("derives labels and only Unresolved Behavior candidates from Timeline rows", async () => {
  const { briefTravelSubjects } = await import("@cadence/core/services/brief-travel-guidance");
  const subjects = briefTravelSubjects([{ id: "occ-walk", title: "Walk", status: "unresolved" }, { id: "occ-read", title: "Read", status: "completed" }], [{ id: "event-dentist", title: "Dentist" }]);
  expect([...subjects.labels]).toEqual([["occ-walk", "Walk"], ["occ-read", "Read"], ["event-dentist", "Dentist"]]);
  expect([...subjects.behaviorRefs]).toEqual(["occ-walk"]);
});

it("drops overlaps from a leg that has no time or has arrived", () => {
  const legs = evidence().legs.map((item) => item.leg.id === "leg-out" ? { ...item, state: "rejected_revision" as const, estimate: null } : item);
  expect(projectBriefTravelGuidance(input(evidence({ legs })))!.items.some((item) => item.kind === "overlap")).toBe(false);
  expect(projectBriefTravelGuidance(input(evidence(), "2026-09-21T15:05:00Z"))!.items.some((item) => item.kind === "overlap")).toBe(false);
});

it("names the trip home in an overlap it creates", () => {
  const collisions = [{ candidateRef: "occ-walk", segmentIds: ["seg-home"], travelCreated: true }];
  const segments = [...evidence().segments, { id: "seg-home", kind: "route" as const, startAt: "2026-09-21T16:10:00Z", endAt: "2026-09-21T16:40:00Z", sourceRefs: [], legId: "leg-back" }];
  expect(phrases(projectBriefTravelGuidance(input(evidence({ collisions, segments })))))
    .toContain("Planned travel overlaps Walk.");
});

it("shows the weather-adjusted departure, its fixed margin and the weather credit (Ticket 218)", async () => {
  const { OPEN_METEO_ATTRIBUTION } = await import("@cadence/core/resolvers/weather-margin.resolver");
  const legs = evidence().legs.map((item) => item.leg.id === "leg-out" ? { ...item, leg: { ...item.leg, mode: "cycling" as const }, weather: {
    tableVersion: "weather-margin@1" as const, state: "margin" as const, conditions: ["rain" as const], marginSeconds: 600,
    suggestion: { instead: "cycling" as const, alternatives: ["transit" as const] }, departureAt: "2026-09-21T14:20:00Z", arrivalAt: "2026-09-21T15:00:00Z",
  } } : item);
  const weather = { tableVersion: "weather-margin@1" as const, state: "applied" as const, forecastAt: "2026-09-21T13:05:00Z", attribution: OPEN_METEO_ATTRIBUTION };
  const guidance = projectBriefTravelGuidance(input(evidence({ legs, weather })))!;
  expect(guidance.items.find((item) => item.kind === "departure")).toEqual({ kind: "departure", phrase: "Leave by 10:20 AM for Dentist · cycling, arrive 11:00 AM.",
    weather: { marginMinutes: 10, conditions: ["rain"], suggestion: { instead: "cycling", alternatives: ["transit"] } } });
  expect(guidance.weather).toEqual({ state: "applied", attribution: OPEN_METEO_ATTRIBUTION });
  const noPosition = projectBriefTravelGuidance(input(evidence({ weather: { ...weather, state: "no_position", forecastAt: null, attribution: null } })))!;
  expect(noPosition.weather).toEqual({ state: "no_position", attribution: null });
});

describe("Ticket 265: options inside a trip made unreliable by a late arrival", () => {
  const place = (ref: string, latitude: number) => ({ ref, source: "calendar" as const, sourceRevision: `${ref}-1`, point: { kind: "coordinates" as const, latitude, longitude: 0 } });
  const stop = (ref: string, startAt: string, endAt: string, latitude: number) => ({ ref, revision: `${ref}-1`, kind: "calendar" as const, startAt, endAt, attendance: "physical" as const, endpoint: place(ref, latitude), mode: "walking" as const });
  const buffers = { arrivalSeconds: 0, exitSeconds: 300, settlingSeconds: 0 };
  const now = "2026-09-16T12:00:00Z";
  // Every leg walks 20 minutes from its ready time.
  function chain(reviewEnd: string): BriefTravelEvidence {
    const plan = resolveTravelPlan({ journeyRef: "day", journeyRevision: "1", now, grantRevision: "g", defaultMode: "walking", device: null, predictedOrigin: null, corrections: [], buffers,
      base: { ref: "home", source: "saved_base", sourceRevision: "h1", point: { kind: "coordinates", latitude: 1, longitude: 0 } },
      commitments: [stop("standup", "2026-09-16T14:00:00Z", "2026-09-16T15:00:00Z", 2), stop("review", "2026-09-16T14:30:00Z", reviewEnd, 3)] });
    const results = plan.legs.map((leg) => ({ legId: leg.id, provenance: leg.provenance, estimate: { durationSeconds: 1200, departureAt: leg.readyAt,
      arrivalAt: Temporal.Instant.from(leg.readyAt).add({ seconds: 1200 }).toString(), warnings: [], fallback: false, attribution: "Google Maps", observedAt: now, expiresAt: "2026-09-16T23:00:00Z" } }));
    const { modelProjection: _projection, ...rest } = resolveTravelEvidence({ plan, results, collisionCandidates: [], buffers, now, expectedJourneyRevision: "1", expectedGrantRevision: "g", modelProjection: "disabled" });
    return rest;
  }
  const options = [
    { id: "stretch", startAt: "2026-09-16T15:36:00Z", endAt: "2026-09-16T15:40:00Z" },
    { id: "tea", startAt: "2026-09-16T15:42:00Z", endAt: "2026-09-16T15:50:00Z" },
    { id: "later", startAt: "2026-09-16T16:00:00Z", endAt: "2026-09-16T16:10:00Z" },
  ];
  const stops: DepartureStop[] = [{ ref: "standup", label: "Standup", startAt: "2026-09-16T14:00:00Z", endAt: "2026-09-16T15:00:00Z" },
    { ref: "review", label: "Review", startAt: "2026-09-16T14:30:00Z", endAt: "2026-09-16T15:10:00Z" }];
  const project = (value: BriefTravelEvidence) => projectBriefTravelGuidance({ evidence: value, departure: departureFor(value, now, stops),
    localDate: "2026-09-16", now, timezone: TZ, labels: new Map(), behaviorRefs: new Set(), options })!;

  it("marks options inside the span as conflicting and returns the span", () => {
    const value = chain("2026-09-16T15:10:00Z");
    // The trip home was estimated 15:15-15:35, but the onward trip arrives only at 15:25.
    expect(value.occupiedSpans.at(-1)?.endAt).toBe("2026-09-16T15:35:00Z");
    const guidance = project(value);
    expect(guidance.conflictingOptionIds).toEqual(["stretch", "tea"]);
    expect(guidance.occupiedSpans).toContainEqual({ startAt: "2026-09-16T15:15:00Z", endAt: "2026-09-16T15:45:00Z" });
  });

  it("shows the late trip and no time for the trip it makes unreliable (Ticket 272)", () => {
    // The trip to Review arrives late, so the trip home cannot be relied on: no "Back around".
    const value = chain("2026-09-16T15:10:00Z");
    const lines = phrases(project(value));
    expect(lines).toEqual([
      "Leave now for Standup from Home · walking, arrive 8:20 AM.",
      "You may arrive late at Review: leave by 11:05 AM · walking, arrive 11:25 AM.",
      "Return time unknown.",
    ]);
  });

  it("leaves an on-time chain unchanged", () => {
    const value = chain("2026-09-16T15:30:00Z");
    const guidance = project(value);
    expect(guidance.occupiedSpans).toEqual(value.occupiedSpans.map((span) => ({ startAt: span.startAt, endAt: span.endAt })));
    expect(guidance.conflictingOptionIds).toEqual(["stretch", "tea"].filter((id) => overlapsTravelSpans(options.find((option) => option.id === id)!, value.occupiedSpans)));
    expect(guidance.conflictingOptionIds).not.toContain("later");
  });
});

it("keeps the brief block out of model input (Ticket 272, L-001)", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const files = [
    ...(await readdir("packages/core/src/services")).filter((name) => name.startsWith("briefing-")).map((name) => `packages/core/src/services/${name}`),
    ...(await readdir("lib/services")).filter((name) => /^(briefing|daily-brief|advisor)/.test(name)).map((name) => `lib/services/${name}`),
  ];
  expect(files).toContain("packages/core/src/services/briefing-config.ts");
  expect(files).toContain("lib/services/daily-brief-openai.ts");
  for (const file of files) {
    // The block's leave times and places come from these modules; model input never imports them.
    expect(await readFile(file, "utf8"), file).not.toMatch(/brief-travel-guidance|departure-phrases|departure\.resolver/);
  }
});
