// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { travelStatusText } from "@/components/timeline/DayProgressTimeline";
import { renderTravelTiming } from "@/components/timeline/ExternalEventDetails";
import { TravelWeatherCredit, travelWeatherMarginText, travelWeatherStateText } from "@/components/timeline/TravelWeather";
import { OPEN_METEO_ATTRIBUTION } from "@cadence/core/resolvers/weather-margin.resolver";
import type { BriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";
import type { TravelEvidenceResult } from "@cadence/core/types/travel";
import type { TravelLegWeather, TravelWeatherSummary } from "@cadence/core/types/weather";
import type { TravelState } from "@/lib/ui/travel";

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
    expect(travelWeatherMarginText({ marginMinutes: 15, conditions: ["thunderstorm", "heavy_rain"], suggestion: { instead: "cycling", alternatives: ["transit", "driving"] } }))
      .toBe("Includes 15 min for thunderstorms. Consider transit or driving instead of cycling.");
    expect(travelWeatherMarginText({ marginMinutes: 10, conditions: ["rain"], suggestion: null })).toBe("Includes 10 min for rain.");
    expect(travelWeatherMarginText({ marginMinutes: 0, conditions: [], suggestion: null })).toBe("");
  });

  it("says plainly why no margin was added", () => {
    expect(travelWeatherStateText("no_position")).toBe("No weather margin: device location is unavailable.");
    expect(travelWeatherStateText("unavailable")).toBe("No weather margin: the forecast is unavailable.");
    expect(travelWeatherStateText("applied")).toBeNull();
    expect(travelWeatherStateText(undefined)).toBeNull();
  });

  it("adds the weather sentence to the travel status line only when no margin could be added", () => {
    const status = (summary: TravelWeatherSummary | undefined): TravelState => ({ view: { accountId: "a", mode: "cycling", navigationPreference: null,
      settingsRevision: "s", expiresAt: "2999-01-01T00:00:00Z", evidence: evidence(undefined, summary) }, message: null, stale: false, pending: false,
    observedAt: "2026-11-01T13:00:00Z", resumesAt: null, refresh: () => undefined });
    expect(travelStatusText(status(undefined), null, "UTC")).toBe("Travel as of 1:00 PM");
    expect(travelStatusText(status(applied), null, "UTC")).toBe("Travel as of 1:00 PM");
    expect(travelStatusText(status({ ...applied, state: "no_position", forecastAt: null, attribution: null }), null, "UTC"))
      .toBe("Travel as of 1:00 PM. No weather margin: device location is unavailable.");
  });
});

describe("travel timing with a weather margin", () => {
  it("shows the weather-adjusted leave time, the margin, the suggestion and the Open-Meteo credit", async () => {
    await act(() => root.render(<>{renderTravelTiming({ eventId: "event-1", travel: evidence(stormy, applied), timezone: "UTC" })}</>));
    expect(container.textContent).toContain("leave Nov 1, 6:15 PM, arrive Nov 1, 7:20 PM.");
    expect(container.textContent).toContain("Includes 15 min for thunderstorms. Consider transit or driving instead of cycling.");
    const links = [...container.querySelectorAll("[data-weather-credit] a")].map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("rel")]);
    expect(links).toEqual([["Weather data by Open-Meteo.com", "https://open-meteo.com/", "noreferrer"],
      ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "noreferrer"]]);
    expect(container.querySelector("[data-weather-credit]")?.textContent).toContain("Cadence derived travel margins from the forecast.");
  });

  it("shows no weather line or credit without a margin", async () => {
    await act(() => root.render(<>{renderTravelTiming({ eventId: "event-1", travel: evidence({ ...stormy, state: "clear", conditions: [], marginSeconds: 0, suggestion: null,
      departureAt: "2026-11-01T18:30:00Z" }, applied), timezone: "UTC" })}</>));
    expect(container.textContent).toContain("leave Nov 1, 6:30 PM");
    expect(container.textContent).not.toContain("Includes");
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
    expect(container.textContent).toContain("Leave by 2:05 PM for Dentist (cycling). Includes 10 min for rain. Consider transit instead of cycling.");
    expect(container.querySelector("[data-weather-credit]")?.textContent).toContain("Weather data by Open-Meteo.com (CC BY 4.0).");
  });

  it("says plainly when there is no device location and shows no credit", async () => {
    await act(() => root.render(<DailyBriefBubble state="ready" briefing={briefing} onDismiss={() => undefined}
      travel={guidance({ state: "no_position", attribution: null }, false)} />));
    expect(container.textContent).toContain("Leave by 2:05 PM for Dentist (cycling).");
    expect(container.textContent).toContain("No weather margin: device location is unavailable.");
    expect(container.querySelector("[data-weather-credit]")).toBeNull();
  });
});
