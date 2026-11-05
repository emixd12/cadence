// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { travelStatusLines } from "@/components/timeline/DayProgressTimeline";
import type { DepartureModel, DepartureTrip } from "@cadence/core/types/departure";
import { renderTravelTiming } from "@/components/timeline/ExternalEventDetails";
import { TravelWeatherCredit, travelWeatherMarginText, travelWeatherStateText } from "@/components/timeline/TravelWeather";
import { OPEN_METEO_ATTRIBUTION } from "@cadence/core/resolvers/weather-margin.resolver";
import type { BriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";
import type { TravelEvidenceResult } from "@cadence/core/types/travel";
import type { TravelLegWeather, TravelWeatherSummary } from "@cadence/core/types/weather";
import type { TravelState } from "@/lib/ui/travel";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";

const NOW = "2026-11-01T13:00:00Z";
/** The drawer's lines come from the departure model (Ticket 261). */
function timing(travel: Omit<TravelEvidenceResult, "modelProjection">, timezone = "UTC") {
  const departure = resolveDepartureModel({ evidence: travel, now: NOW, timezone, arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null,
    stops: [{ ref: "event-1", label: "Dentist", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T20:30:00Z" }] });
  return renderTravelTiming({ eventId: "event-1", travel, departure, now: NOW, timezone });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

const provenance = { originRef: "device", originSource: "device", originRevision: "1", destinationRef: "event-1", destinationSource: "calendar",
  destinationRevision: "1", grantRevision: "g" } as const;
const stormy: TravelLegWeather = { tableVersion: "weather-margin@1", state: "margin", conditions: ["thunderstorm", "heavy_rain"], marginSeconds: 900,
  suggestion: { instead: "cycling", alternatives: ["transit", "driving"] }, departureAt: "2026-11-01T18:15:00Z", arrivalAt: "2026-11-01T19:20:00Z" };
const applied: TravelWeatherSummary = { tableVersion: "weather-margin@1", state: "applied", forecastAt: "2026-11-01T13:00:00Z", attribution: OPEN_METEO_ATTRIBUTION };

function evidence(weather: TravelLegWeather | undefined, summary: TravelWeatherSummary | undefined): Omit<TravelEvidenceResult, "modelProjection"> {
  return {
    version: "1.0", journeyRef: "journey", segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null,
    legs: [{ leg: { id: "leg-1", role: "outbound", journeyRef: "journey", originCommitmentRef: null, destinationCommitmentRef: "event-1", mode: "cycling",
      readyAt: "2026-11-01T13:00:00Z", provenance }, state: "current", reason: null,
      estimate: { durationSeconds: 3000, departureAt: "2026-11-01T18:30:00Z", arrivalAt: "2026-11-01T19:20:00Z", warnings: [], fallback: false,
        attribution: "Google Maps", observedAt: "2026-11-01T13:00:00Z", expiresAt: "2026-11-01T13:05:00Z" },
      ...(weather ? { weather } : {}) }],
    ...(summary ? { weather: summary } : {}),
  };
}

describe("travel weather copy", () => {
  it("names the condition that set the margin and the suggested modes", () => {
    const stormMargin = { marginMinutes: 15, conditions: ["thunderstorm", "heavy_rain"], suggestion: { instead: "cycling", alternatives: ["transit", "driving"] } } as const;
    expect(travelWeatherMarginText(stormMargin, { developmentBuild: true }))
      .toBe("15 min added for thunderstorms. Consider transit or driving instead of cycling.");
    expect(travelWeatherMarginText(stormMargin, { developmentBuild: false })).toBe("15 min added for thunderstorms.");
    expect(travelWeatherMarginText({ marginMinutes: 10, conditions: ["rain"], suggestion: null }, { developmentBuild: true })).toBe("10 min added for rain.");
    expect(travelWeatherMarginText({ marginMinutes: 0, conditions: [], suggestion: null }, { developmentBuild: true })).toBe("");
  });

  it("says plainly why no margin was added", () => {
    expect(travelWeatherStateText("no_position")).toBe("No weather margin: device location is unavailable.");
    expect(travelWeatherStateText("unavailable")).toBe("No weather margin: the forecast is unavailable.");
    expect(travelWeatherStateText("applied")).toBeNull();
    expect(travelWeatherStateText(undefined)).toBeNull();
  });

  it("adds the weather sentence under the next-departure line only when no margin could be added", () => {
    const status = (summary: TravelWeatherSummary | undefined): TravelState => ({ view: { accountId: "a", mode: "cycling", navigationPreference: null,
      settingsRevision: "s", expiresAt: "2999-01-01T00:00:00Z", evidence: evidence(undefined, summary) }, message: null, stale: false, pending: false,
    observedAt: "2026-11-01T13:00:00Z", resumesAt: null, refresh: () => undefined });
    const next = { key: "k", state: "upcoming", action: null, linePhrase: "Leave by 1:30 PM for Gym · cycling, arrive 1:50 PM." } as DepartureTrip;
    const departure: DepartureModel = { state: "upcoming", next, phrase: next.linePhrase, trips: [next], resumesAt: null, pausedPhrase: null };
    const none: DepartureModel = { state: "none", next: null, phrase: null, trips: [], resumesAt: null, pausedPhrase: null };
    const lines = (value: TravelState, model = departure) => travelStatusLines({ departure: model, status: value, hasEvidence: true, developmentBuild: false });
    expect(lines(status(undefined))).toMatchObject({ line: "Leave by 1:30 PM for Gym · cycling, arrive 1:50 PM.", note: null });
    expect(lines(status(applied)).note).toBeNull();
    expect(lines(status({ ...applied, state: "no_position", forecastAt: null, attribution: null })).note)
      .toBe("No weather margin: device location is unavailable.");
    // Ticket 261: a day with no trips gets no line, paused or not.
    expect(lines(status(applied), none)).toMatchObject({ line: null, note: null });
    expect(lines({ ...status(applied), resumesAt: "2026-12-01T05:00:00Z" }, none)).toMatchObject({ line: null, note: null });
  });
});

describe("travel timing with a weather margin", () => {
  it("shows the weather-adjusted leave time, the margin and the Open-Meteo credit", async () => {
    await act(() => root.render(<>{timing(evidence(stormy, applied))}</>));
    expect(container.textContent).toContain("Leave by 6:15 PM · cycling, arrive 7:20 PM.");
    // Once per event, as its own line. The leave time already includes it.
    expect(container.textContent?.split("15 min added for thunderstorms.").length).toBe(2);
    const links = [...container.querySelectorAll("[data-weather-credit] a")].map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("rel")]);
    expect(links).toEqual([["Weather data by Open-Meteo.com", "https://open-meteo.com/", "noreferrer"],
      ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "noreferrer"]]);
    expect(container.querySelector("[data-weather-credit]")?.textContent).toBe("Weather data by Open-Meteo.com (CC BY 4.0).");
  });

  it("shows no weather line or credit without a margin", async () => {
    await act(() => root.render(<>{timing(evidence({ ...stormy, state: "clear", conditions: [], marginSeconds: 0, suggestion: null,
      departureAt: "2026-11-01T18:30:00Z" }, applied))}</>));
    expect(container.textContent).toContain("Leave by 6:30 PM");
    expect(container.textContent).not.toContain("added for");
    expect(container.querySelector("[data-weather-credit]")).toBeNull();
  });

  it("opens credit links through the desktop opener when one is given", async () => {
    const open = vi.fn(async () => undefined);
    await act(() => root.render(<TravelWeatherCredit attribution={OPEN_METEO_ATTRIBUTION} onOpenExternal={open} />));
    const licence = [...container.querySelectorAll("a")].find((link) => link.textContent === "CC BY 4.0")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { licence.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://creativecommons.org/licenses/by/4.0/");
  });
});

describe("Daily Brief travel block with weather", () => {
  const guidance = (weather: BriefTravelGuidance["weather"], withMargin: boolean): BriefTravelGuidance => ({
    localDate: "2026-09-20", observedAt: "2026-09-20T13:00:00Z", expiresAt: "2999-09-20T16:00:00Z", attribution: "Google Maps",
    items: [{ kind: "departure", at: "2026-09-20T18:05:00Z", label: "Dentist", mode: "cycling",
      weather: withMargin ? { marginMinutes: 10, conditions: ["rain"], suggestion: { instead: "cycling", alternatives: ["transit"] } } : null }],
    conflictingOptionIds: [], occupiedSpans: [], weather,
  });
  const briefing = { text: "Dentist anchors the afternoon.", localDate: "2026-09-20", timezone: "America/New_York",
    generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete" as const, warnings: [] };

  it("shows the margin beside the departure with the credit", async () => {
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={() => undefined}
      travel={guidance({ state: "applied", attribution: OPEN_METEO_ATTRIBUTION }, true)} />));
    expect(container.textContent).toContain("Leave by 2:05 PM for Dentist (cycling). 10 min added for rain.");
    expect(container.querySelector("[data-weather-credit]")?.textContent).toContain("Weather data by Open-Meteo.com (CC BY 4.0).");
  });

  it("says plainly when there is no device location and shows no credit", async () => {
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={() => undefined}
      travel={guidance({ state: "no_position", attribution: null }, false)} />));
    expect(container.textContent).toContain("Leave by 2:05 PM for Dentist (cycling).");
    expect(container.textContent).toContain("No weather margin: device location is unavailable.");
    expect(container.querySelector("[data-weather-credit]")).toBeNull();
  });

  it("credits Open-Meteo once when the model used weather facts (Ticket 219 stage 2)", async () => {
    const used = { ...briefing, attributions: ["open_meteo"] as const };
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={used} onDismiss={() => undefined} />));
    expect(container.querySelector("[data-brief-weather-credit]")?.textContent).toContain("Weather data by Open-Meteo.com (CC BY 4.0).");
    // The travel block already credits Open-Meteo, so the brief adds no second credit.
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={used} onDismiss={() => undefined}
      travel={guidance({ state: "applied", attribution: OPEN_METEO_ATTRIBUTION }, true)} />));
    expect(container.querySelectorAll("[data-weather-credit]")).toHaveLength(1);
    expect(container.querySelector("[data-brief-weather-credit]")).toBeNull();
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={() => undefined} />));
    expect(container.querySelector("[data-weather-credit]")).toBeNull();
  });
});

describe("travel timing with the Ticket 264 fields", () => {
  it("renders a late leg as one late line, and the unknown trip home in plain words", async () => {
    const base = evidence(undefined, undefined);
    const late: Omit<TravelEvidenceResult, "modelProjection"> = { ...base,
      unknownLegs: [{ role: "return", originCommitmentRef: "event-1", destinationCommitmentRef: null, reason: "return_base_missing" }],
      legs: base.legs.map((entry) => ({ ...entry, late: true, estimate: { ...entry.estimate!, warnings: ["Estimated arrival is after the planned arrival time."] } })) };
    await act(() => root.render(timing(late, "America/New_York")));
    expect(container.textContent).toContain("You may arrive late: leave by 1:30 PM · cycling, arrive 2:20 PM.");
    expect(container.textContent).toContain("Return time unknown. Add Home in Settings to estimate it.");
    expect(container.textContent).not.toContain("timing unavailable");
    expect(container.textContent).not.toContain("return_base_missing");
  });

  it("shows nothing new for an event with only unknown legs", async () => {
    const only: Omit<TravelEvidenceResult, "modelProjection"> = { ...evidence(undefined, undefined), legs: [],
      unknownLegs: [{ role: "outbound", originCommitmentRef: null, destinationCommitmentRef: "event-1", reason: "origin_unknown" }] };
    expect(timing(only, "America/New_York")).toBeNull();
  });
});

describe("Ticket 261: lines that need a refresh, and finished trips", () => {
  const base = evidence(undefined, undefined);
  const render = (travel: Omit<TravelEvidenceResult, "modelProjection">, now: string, refresh?: { onRefresh: () => void; pending: boolean }) => {
    const departure = resolveDepartureModel({ evidence: travel, now, timezone: "UTC", arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null,
      stops: [{ ref: "event-1", label: "Dentist", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T20:30:00Z" }] });
    return renderTravelTiming({ eventId: "event-1", travel, departure, now, timezone: "UTC", refresh });
  };

  it("keeps the last estimate with its check time and offers Refresh travel in the line", async () => {
    const onRefresh = vi.fn();
    await act(() => root.render(<>{render(base, "2026-11-01T14:00:00Z", { onRefresh, pending: false })}</>));
    const line = container.querySelector('[data-departure-state="upcoming"]')!;
    expect(line.textContent).toBe("Last estimate: leave by 6:30 PM · checked 1:00 PM. Refresh travel");
    await act(() => line.querySelector("button")!.click());
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(() => root.render(<>{render(base, "2026-11-01T14:00:00Z", { onRefresh, pending: true })}</>));
    expect(container.querySelector("button")?.disabled).toBe(true);
  });

  it("words each missing estimate, with the action only where it helps", async () => {
    const without = (state: TravelEvidenceResult["legs"][number]["state"], reason: string) => ({ ...base,
      legs: base.legs.map((entry) => ({ ...entry, state, reason, estimate: null })) });
    const refresh = { onRefresh: () => undefined, pending: false };
    for (const [travel, text] of [
      [without("stale", "Route estimate expired."), "Estimate expired. Refresh travel"],
      [without("rejected_revision", "Journey or grant revision changed."), "Trip changed. Refresh travel"],
      [without("unavailable", "No route."), "No route found."],
      [without("unavailable", "outside_route_window"), "Leave time appears by 4:20 PM."],
    ] as const) {
      await act(() => root.render(<>{render(travel, "2026-11-01T13:00:00Z", refresh)}</>));
      expect(container.querySelector('[aria-label="Travel timing"] p')?.textContent).toBe(text);
    }
  });

  it("shows no line for a trip that has finished", async () => {
    expect(render(base, "2026-11-01T19:30:00Z")).toBeNull();
  });
});

describe("Ticket 261: a stop between two trips", () => {
  const leg = (id: string, role: "outbound" | "onward", origin: string | null, destination: string, leaveAt: string, arriveAt: string, expiresAt = "2026-11-01T23:00:00Z") => ({
    leg: { id, role, journeyRef: "journey", originCommitmentRef: origin, destinationCommitmentRef: destination, mode: "walking" as const, readyAt: "2026-11-01T08:00:00Z",
      provenance: { ...provenance, originSource: origin ? "planned_stop" as const : "saved_base" as const, destinationRef: destination } },
    state: "current" as const, reason: null,
    estimate: { durationSeconds: 1200, departureAt: leaveAt, arrivalAt: arriveAt, warnings: [], fallback: false, attribution: "Google Maps", observedAt: "2026-11-01T08:00:00Z", expiresAt } });
  const stops = [{ ref: "dentist", label: "Dentist", startAt: "2026-11-01T11:00:00Z", endAt: "2026-11-01T11:30:00Z" },
    { ref: "gym", label: "Gym", startAt: "2026-11-01T13:00:00Z", endAt: "2026-11-01T14:00:00Z" }];
  const two = (expiresAt?: string): Omit<TravelEvidenceResult, "modelProjection"> => ({ ...evidence(undefined, undefined),
    legs: [leg("to-dentist", "outbound", null, "dentist", "2026-11-01T10:30:00Z", "2026-11-01T10:50:00Z", expiresAt),
      leg("to-gym", "onward", "dentist", "gym", "2026-11-01T12:30:00Z", "2026-11-01T12:50:00Z", expiresAt)] });
  const render = (travel: Omit<TravelEvidenceResult, "modelProjection">, eventId: string, now = "2026-11-01T09:00:00Z") => {
    const departure = resolveDepartureModel({ evidence: travel, now, timezone: "UTC", arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null, stops });
    return renderTravelTiming({ eventId, travel, departure, now, timezone: "UTC", refresh: { onRefresh: () => undefined, pending: false } });
  };
  const lines = () => [...container.querySelectorAll('[aria-label="Travel timing"] > p[data-departure-state]')].map((line) => line.textContent);

  it("names where the trip leaving this stop goes", async () => {
    await act(() => root.render(<>{render(two(), "dentist")}</>));
    expect(lines()).toEqual(["Leave by 10:30 AM from Home · walking, arrive 10:50 AM.", "Leave by 12:30 PM for Gym · walking, arrive 12:50 PM."]);
    await act(() => root.render(<>{render(two(), "gym")}</>));
    expect(lines()).toEqual(["Leave by 12:30 PM · walking, arrive 12:50 PM."]);
  });

  it("gives each due trip's Refresh travel line its own button, all running the same refresh", async () => {
    const onRefresh = vi.fn();
    const due = { ...two(), legs: two().legs.map((entry) => ({ ...entry, state: "unavailable" as const, estimate: null, reason: "outside_route_window" })) };
    const departure = resolveDepartureModel({ evidence: due, now: "2026-11-01T10:00:00Z", timezone: "UTC", arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null, stops });
    await act(() => root.render(<>{renderTravelTiming({ eventId: "dentist", travel: due, departure, now: "2026-11-01T10:00:00Z", timezone: "UTC", refresh: { onRefresh, pending: false } })}</>));
    expect(lines()).toEqual(["Refresh travel to get the leave time.", "Refresh travel to get the leave time for Gym."]);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Refresh travel", "Refresh travel"]);
    for (const button of buttons) await act(() => button.click());
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("shows each expired trip once, with one Refresh travel", async () => {
    const expired = two("2026-11-01T08:05:00Z");
    const stale = { ...expired, legs: expired.legs.map((entry) => ({ ...entry, state: "stale" as const, estimate: null, reason: "Route estimate expired." })) };
    await act(() => root.render(<>{render(stale, "dentist")}</>));
    expect(lines()).toEqual(["Estimate expired. Refresh travel", "The estimate for Gym expired."]);
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});
