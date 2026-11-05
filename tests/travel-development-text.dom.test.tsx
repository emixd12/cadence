// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DevelopmentBuildProvider, useDevelopmentBuild } from "@cadence/ui/runtime";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import { WebRuntimeProvider } from "@/components/layout/WebRuntimeProvider";
import { renderTravelTiming } from "@/components/timeline/ExternalEventDetails";
import { OPEN_METEO_ATTRIBUTION } from "@cadence/core/resolvers/weather-margin.resolver";
import type { BriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";
import type { TravelEvidenceResult } from "@cadence/core/types/travel";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const CADENCE_WARNING = "Estimated arrival is after the planned arrival time.";
const PROVIDER_WARNING = "This route has tolls.";
const ADVICE = "Consider transit or driving instead of cycling.";
const LATE_LINE = "You may arrive late: leave by 6:50 PM · cycling, arrive 7:40 PM.";
const MARGIN = "15 min added for thunderstorms.";
const NOW = "2026-11-01T13:00:00Z";

const provenance = { originRef: "device", originSource: "device", originRevision: "1", destinationRef: "event-1", destinationSource: "calendar",
  destinationRevision: "1", grantRevision: "g" } as const;

function evidence(options: Readonly<{ late: boolean; warnings: string[]; arrivalAt?: string }>): Omit<TravelEvidenceResult, "modelProjection"> {
  return { version: "1.0", journeyRef: "journey", segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null,
    legs: [{ leg: { id: "leg-1", role: "outbound", journeyRef: "journey", originCommitmentRef: null, destinationCommitmentRef: "event-1", mode: "cycling",
      readyAt: "2026-11-01T13:00:00Z", provenance }, state: "current", reason: null, ...(options.late ? { late: true } : {}),
    estimate: { durationSeconds: 3000, departureAt: "2026-11-01T18:50:00Z", arrivalAt: options.arrivalAt ?? "2026-11-01T19:40:00Z", warnings: options.warnings, fallback: false,
      attribution: "Google Maps", observedAt: "2026-11-01T13:00:00Z", expiresAt: "2026-11-01T13:05:00Z" },
    weather: { tableVersion: "weather-margin@1", state: "margin", conditions: ["thunderstorm"], marginSeconds: 900,
      suggestion: { instead: "cycling", alternatives: ["transit", "driving"] }, departureAt: "2026-11-01T18:50:00Z", arrivalAt: options.arrivalAt ?? "2026-11-01T19:40:00Z" } }],
    weather: { tableVersion: "weather-margin@1", state: "applied", forecastAt: "2026-11-01T13:00:00Z", attribution: OPEN_METEO_ATTRIBUTION } };
}
const lateTrip = evidence({ late: true, warnings: [CADENCE_WARNING, PROVIDER_WARNING] });

const guidance: BriefTravelGuidance = { localDate: "2026-11-01", observedAt: "2026-11-01T13:00:00Z", expiresAt: "2999-11-01T16:00:00Z", attribution: "Google Maps",
  items: [{ kind: "departure", at: "2026-11-01T18:05:00Z", label: "Dentist", mode: "cycling",
    weather: { marginMinutes: 15, conditions: ["thunderstorm"], suggestion: { instead: "cycling", alternatives: ["transit", "driving"] } } }],
  conflictingOptionIds: [], occupiedSpans: [], weather: { state: "applied", attribution: OPEN_METEO_ATTRIBUTION } };
const briefing = { text: "Dentist anchors the afternoon.", localDate: "2026-11-01", timezone: "UTC",
  generatedAt: "2026-11-01T12:00:00Z", expiresAt: "2999-11-01T16:00:00Z", coverage: "complete" as const, warnings: [] };

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
  vi.unstubAllEnvs();
});

async function renderIn(developmentBuild: boolean, node: ReactNode): Promise<string> {
  await act(() => root.render(<DevelopmentBuildProvider value={developmentBuild}>{node}</DevelopmentBuildProvider>));
  return container.textContent ?? "";
}

const departure = (travel: Omit<TravelEvidenceResult, "modelProjection">) => resolveDepartureModel({ evidence: travel, now: NOW, timezone: "UTC",
  stops: [{ ref: "event-1", label: "Dentist", startAt: "2026-11-01T19:30:00Z", endAt: "2026-11-01T20:30:00Z" }],
  arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null });

// The drawer and the dialog render the same lines from the same model (Ticket 261).
describe.each([{ surface: "dialog" }, { surface: "drawer" }])("travel timing in the $surface", () => {
  const timing = (travel = lateTrip) => renderTravelTiming({ eventId: "event-1", travel, departure: departure(travel), now: NOW, timezone: "UTC" });

  it("shows production only what a user can act on", async () => {
    const text = await renderIn(false, timing());
    expect(text).toContain(LATE_LINE);
    expect(text).toContain(MARGIN);
    // One late line: the model's phrase, not a second line from the same flag.
    expect(text.split("You may arrive late").length).toBe(2);
    for (const hidden of [CADENCE_WARNING, PROVIDER_WARNING, ADVICE, "Development"]) expect(text).not.toContain(hidden);
    expect(container.querySelector("[data-travel-development-warnings]")).toBeNull();
  });

  it("shows development every warning verbatim under a Development label, and the advice", async () => {
    const text = await renderIn(true, timing());
    expect(text).toContain(LATE_LINE);
    expect(text).toContain(`${MARGIN} ${ADVICE}`);
    const block = container.querySelector("[data-travel-development-warnings]");
    expect([...block!.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["Development", CADENCE_WARNING, PROVIDER_WARNING]);
  });

  it("takes the late line from the flag, not from the warning text", async () => {
    expect(await renderIn(false, timing(evidence({ late: true, warnings: [] })))).toContain(LATE_LINE);
    expect(await renderIn(false, timing(evidence({ late: false, warnings: [CADENCE_WARNING] })))).not.toContain("You may arrive late");
  });

  it("adds the date only when the late arrival falls on a later day than the leave time", async () => {
    const text = await renderIn(false, timing(evidence({ late: true, warnings: [], arrivalAt: "2026-11-02T00:20:00Z" })));
    expect(text).toContain("You may arrive late: leave by 6:50 PM · cycling, arrive Nov 2, 12:20 AM.");
  });
});

describe("Daily Brief travel line", () => {
  const bubble = <DailyBriefBubble state="ready" briefing={briefing} travel={guidance} onDismiss={() => undefined} />;

  it("keeps the margin in production and drops the advice", async () => {
    const text = await renderIn(false, bubble);
    expect(text).toContain(`Leave by 6:05 PM for Dentist (cycling). ${MARGIN}`);
    expect(text).not.toContain(ADVICE);
  });

  it("adds the advice in development", async () => {
    expect(await renderIn(true, bubble)).toContain(`${MARGIN} ${ADVICE}`);
  });
});

describe("development-build flag", () => {
  function Flag() {
    return <span>{useDevelopmentBuild() ? "on" : "off"}</span>;
  }

  it("is off with no provider", async () => {
    await act(() => root.render(<Flag />));
    expect(container.textContent).toBe("off");
  });

  it.each([["development", "on"], ["production", "off"], ["test", "off"]])("the web runtime with NODE_ENV %s gives %s", async (mode, expected) => {
    vi.stubEnv("NODE_ENV", mode);
    await act(() => root.render(<WebRuntimeProvider><Flag /></WebRuntimeProvider>));
    expect(container.textContent).toBe(expected);
  });

  it("comes from Vite's build mode on desktop", () => {
    expect(readFileSync("apps/desktop/src/product.tsx", "utf8")).toContain("<DevelopmentBuildProvider value={import.meta.env.DEV}>");
  });

  it("is read from no environment by shared components, and resolvers never see it", () => {
    for (const file of ["components/timeline/ExternalEventDetails.tsx", "components/timeline/TravelWeather.tsx", "components/briefing/DailyBriefBubble.tsx", "packages/ui/runtime.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/process\.env|import\.meta\.env/);
    }
    for (const file of ["packages/core/src/resolvers/travel.resolver.ts", "packages/core/src/resolvers/weather-margin.resolver.ts", "packages/core/src/services/brief-travel-guidance.ts", "packages/core/src/services/briefing-travel.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/developmentBuild|useDevelopmentBuild|import\.meta\.env/);
    }
  });
});
