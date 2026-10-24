// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { PlaceLabelState } from "@cadence/core/types/place-labels";
import {
  BehaviorPlaceAssist,
  CompletionPlacesSection,
  PlaceLabelProvider,
  PlaceMarkerControl,
  useCompletionPlaceCapture,
} from "@/components/travel/PlaceLabels";
import type { PlaceLabelClient } from "@/lib/ui/place-labels";

const OFF: PlaceLabelState = {
  settings: { enabled: false, retention: "90_days", enabledAt: null, markerPromptDismissedAt: null, updatedAt: null },
  homePlaceKey: travelPlaceKey("1 Home Lane"), homeMarker: null, placeMarkers: [], labelCount: 0, behaviors: [],
};
const ON: PlaceLabelState = {
  ...OFF,
  settings: { enabled: true, retention: "90_days", enabledAt: "2026-10-22T12:00:00Z", markerPromptDismissedAt: null, updatedAt: "2026-10-22T12:00:00Z" },
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function client(state: PlaceLabelState, overrides: Partial<PlaceLabelClient> = {}): PlaceLabelClient {
  return {
    load: vi.fn(async () => state),
    saveSettings: vi.fn(async () => ON),
    recordMarker: vi.fn(async () => ({ ...ON, homeMarker: { recordedAt: "2026-10-22T12:01:00Z", current: true } })),
    removeMarkers: vi.fn(async () => ON),
    deleteLabels: vi.fn(async () => ON),
    dismissSuggestion: vi.fn(async () => ON),
    capturePlan: vi.fn(async () => ({ ruleVersion: "place-label-rules@1", markers: [{ ref: "home" as const, latitudeE6: 41_878_100, longitudeE6: -87_629_800, accuracyMeters: 10 }] })),
    recordLabel: vi.fn(async () => undefined),
    locationAllowed: vi.fn(async () => true),
    readLocation: vi.fn(async () => ({ state: "available" as const, latitude: 41.8781, longitude: -87.6298, accuracyMeters: 15, sampledAt: Date.now() - 1_000 })),
    ...overrides,
  };
}

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
  await act(async () => { await Promise.resolve(); });
}
function button(name: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find((element) => element.textContent === name);
  if (!match) throw new Error(`No button ${name}: ${host.textContent}`);
  return match;
}

it("turns labels on only after a retention choice, defaulting to the shortest", async () => {
  const fake = client(OFF);
  await render(<PlaceLabelProvider client={fake}><CompletionPlacesSection /></PlaceLabelProvider>);
  expect(host.textContent).toContain("It never saves that position.");
  await act(async () => button("Set up completion places").click());
  const checked = host.querySelector<HTMLInputElement>('input[type="radio"]:checked')!;
  expect(checked.value).toBe("90_days");
  expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  await act(async () => button("Save where I complete Behaviors").click());
  expect(fake.saveSettings).toHaveBeenCalledWith({ enabled: true, retention: "90_days", markerPromptDismissed: false, expectedUpdatedAt: null });
});

it("says what the Daily Brief sees under each retention option (Ticket 219, October 23)", async () => {
  await render(<PlaceLabelProvider client={client(OFF)}><CompletionPlacesSection /></PlaceLabelProvider>);
  await act(async () => button("Set up completion places").click());
  const detail = (value: string) => host.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.closest("label")!.textContent!;
  expect(detail("90_days")).toContain("Suggestions use the last 60 days; the Daily Brief sees counts for up to 90 days.");
  expect(detail("1_year")).toContain("The Daily Brief also sees counts across the whole year.");
  expect(detail("until_deleted")).toContain("The Daily Brief sees counts across all of it");
  expect(host.textContent).toContain("While the Daily Brief is on, it receives label counts only, never places.");
  // No option promises insight the counts cannot give.
  expect(host.textContent).not.toMatch(/seasonal|best insights/);
});

it("asks before switching to a shorter retention or turning off", async () => {
  const fake = client({ ...ON, settings: { ...ON.settings, retention: "1_year" }, labelCount: 4 });
  await render(<PlaceLabelProvider client={fake}><CompletionPlacesSection /></PlaceLabelProvider>);
  await act(async () => host.querySelector<HTMLInputElement>('input[value="90_days"]')!.click());
  expect(fake.saveSettings).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Switching deletes labels older than 90 days.");
  await act(async () => button("Switch and delete").click());
  expect(fake.saveSettings).toHaveBeenCalledWith({ enabled: true, retention: "90_days", markerPromptDismissed: false, expectedUpdatedAt: "2026-10-22T12:00:00Z" });
  await act(async () => button("Turn off").click());
  expect(host.textContent).toContain("Turning this off deletes every label, place marker and dismissed suggestion.");
});

it("records a Home marker from an explicit tap, sending microdegrees", async () => {
  const fake = client(ON);
  await render(<PlaceLabelProvider client={fake}><PlaceMarkerControl place={{ kind: "home" }} /></PlaceLabelProvider>);
  expect(host.textContent).toContain("No marker yet.");
  await act(async () => button("I'm here").click());
  await act(async () => { await Promise.resolve(); });
  expect(fake.readLocation).toHaveBeenCalledWith(true);
  expect(fake.recordMarker).toHaveBeenCalledWith(expect.objectContaining({
    place: { kind: "home" }, position: { latitudeE6: 41_878_100, longitudeE6: -87_629_800, accuracyMeters: 15 },
  }));
  expect(host.textContent).toContain("Home marker saved.");
});

it("shows nothing while labels are off", async () => {
  await render(<PlaceLabelProvider client={client(OFF)}><PlaceMarkerControl place={{ kind: "home" }} /></PlaceLabelProvider>);
  expect(host.textContent).toBe("");
});

function Capture({ id }: Readonly<{ id: string }>) {
  const capture = useCompletionPlaceCapture();
  useEffect(() => { capture?.(id); }, [capture, id]);
  return null;
}

it("labels a completion silently without ever prompting", async () => {
  const fake = client(ON);
  await render(<PlaceLabelProvider client={fake}><Capture id="occurrence-1" /></PlaceLabelProvider>);
  await vi.waitFor(() => expect(fake.recordLabel).toHaveBeenCalledWith({ occurrenceId: "occurrence-1", label: "home", ruleVersion: "place-label-rules@1" }));
  expect(fake.readLocation).toHaveBeenCalledWith(false);
  expect(fake.readLocation).not.toHaveBeenCalledWith(true);
});

it("reads nothing and sends nothing at completion without an existing grant", async () => {
  const fake = client(ON, { locationAllowed: vi.fn(async () => false) });
  await render(<PlaceLabelProvider client={fake}><Capture id="occurrence-1" /></PlaceLabelProvider>);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(fake.capturePlan).not.toHaveBeenCalled();
  expect(fake.readLocation).not.toHaveBeenCalled();
  expect(fake.recordLabel).not.toHaveBeenCalled();
});

it("shows a suggestion with its rule version and never applies it by itself", async () => {
  const state: PlaceLabelState = { ...ON, behaviors: [{ behaviorId: "behavior-1", suggestedPlaceText: null, markerPrompt: null,
    suggestion: { ruleVersion: "where-suggestion-rules@1", kind: "home", key: "home", placeKey: null, labelCount: 6, supportingCount: 5 } }] };
  const fake = client(state);
  const onReview = vi.fn();
  await render(<PlaceLabelProvider client={fake}><BehaviorPlaceAssist behaviorId="behavior-1" placeText={null} onReview={onReview} /></PlaceLabelProvider>);
  expect(host.textContent).toContain("Usually completed at Home (5 of 6 recent completions).");
  expect(host.querySelector("[data-rule-version]")?.getAttribute("data-rule-version")).toBe("where-suggestion-rules@1");
  expect(onReview).not.toHaveBeenCalled();
  await act(async () => button("Review Where").click());
  expect(onReview).toHaveBeenCalledWith({ whereKind: "home", locationText: "" });
  await act(async () => button("Dismiss").click());
  expect(fake.dismissSuggestion).toHaveBeenCalledWith({ behaviorId: "behavior-1", suggestion: "home", ruleVersion: "where-suggestion-rules@1" });
});

it("turns marker prompts off with Not now", async () => {
  const state: PlaceLabelState = { ...ON, behaviors: [{ behaviorId: "behavior-1", suggestion: null, suggestedPlaceText: null, markerPrompt: "home" }] };
  const fake = client(state);
  await render(<PlaceLabelProvider client={fake}><BehaviorPlaceAssist behaviorId="behavior-1" placeText={null} onReview={vi.fn()} /></PlaceLabelProvider>);
  expect(host.textContent).toContain("Home has no marker yet.");
  await act(async () => button("Not now").click());
  expect(fake.saveSettings).toHaveBeenCalledWith({ enabled: true, retention: "90_days", markerPromptDismissed: true, expectedUpdatedAt: "2026-10-22T12:00:00Z" });
});

it("reloads place state when the Behavior's saved Where changes", async () => {
  const fake = client(ON);
  const view = (whereKind: "home" | "place", placeText: string | null) =>
    <PlaceLabelProvider client={fake}><BehaviorPlaceAssist behaviorId="behavior-1" whereKind={whereKind} placeText={placeText} onReview={vi.fn()} /></PlaceLabelProvider>;
  await render(view("home", null));
  const loads = vi.mocked(fake.load).mock.calls.length;
  await render(view("place", "2 Example Gym"));
  await vi.waitFor(() => expect(vi.mocked(fake.load).mock.calls.length).toBeGreaterThan(loads));
});

it("renders Completion places as the last Travel subsection, after How you travel (travel release train)", async () => {
  const { TravelSettingsPanel } = await import("@/components/settings/TravelSettingsPanel");
  const settings = { enabled: false, baseLocationText: "1 Home Lane", mode: "walking" as const, navigationPreference: null,
    routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const travel = { load: async () => settings, save: async () => settings, saveHabits: async () => settings };
  await render(<PlaceLabelProvider client={client(ON)}>
    <TravelSettingsPanel client={travel} readLocation={async () => ({ state: "prompt" as const })} />
  </PlaceLabelProvider>);
  await act(async () => { await Promise.resolve(); });
  const panel = host.querySelector("#travel")!;
  expect(panel).not.toBeNull();
  expect([...panel.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["How you travel", "Completion places"]);
  expect(panel.querySelectorAll("[data-completion-places]")).toHaveLength(1);
  // I'm here sits below Home while labels are on; Settings shows no second panel.
  expect(panel.querySelector('[data-place-marker="home"]')).not.toBeNull();
  expect([...host.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["Travel"]);
});
