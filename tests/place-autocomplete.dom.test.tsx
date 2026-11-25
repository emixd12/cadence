// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GEOAPIFY_ATTRIBUTION } from "@cadence/core/services/place-search";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import type { PlaceLabelState } from "@cadence/core/types/place-labels";
import type { TravelSettings } from "@cadence/core/types/travel";
import { BehaviorForm } from "@/components/behaviors/BehaviorForm";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { PlaceLabelProvider } from "@/components/travel/PlaceLabels";
import type { BehaviorActionState, BehaviorFormAction } from "@/lib/types/behavior";
import type { PlaceLabelClient } from "@/lib/ui/place-labels";
import type { PlaceSearchClient } from "@/lib/ui/place-search";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const YMCA_SUGGESTION = {
  id: "geoapify:ymca",
  source: "geoapify" as const,
  title: "Greenpoint YMCA",
  subtitle: "99 Meserole Ave, Brooklyn, NY 11222",
  formatted: "Greenpoint YMCA, 99 Meserole Ave, Brooklyn, NY 11222",
  position: { latitude: 40.7271, longitude: -73.9542 },
};

const HOME_SUGGESTION = {
  id: "geoapify:home-1",
  source: "geoapify" as const,
  title: "123 Bedford Ave",
  subtitle: "Brooklyn, NY 11211",
  formatted: "123 Bedford Ave, Brooklyn, NY 11211",
  position: { latitude: 40.7178, longitude: -73.9577 },
};

const ON_STATE: PlaceLabelState = {
  settings: {
    enabled: true,
    retention: "90_days",
    enabledAt: "2026-10-22T12:00:00Z",
    markerPromptDismissedAt: null,
    updatedAt: "2026-10-22T12:00:00Z",
  },
  homePlaceKey: travelPlaceKey("1 Old Home St"),
  homeMarker: null,
  placeMarkers: [],
  labelCount: 0,
  behaviors: [],
};

const OFF_STATE: PlaceLabelState = {
  ...ON_STATE,
  settings: { ...ON_STATE.settings, enabled: false, enabledAt: null, updatedAt: null },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createPlaceLabelClient(state: PlaceLabelState): PlaceLabelClient {
  return {
    load: vi.fn(async () => state),
    saveSettings: vi.fn(async () => state),
    recordMarker: vi.fn(async () => ({
      ...state,
      homeMarker: { recordedAt: "2026-11-25T12:00:00Z", current: true },
    })),
    removeMarkers: vi.fn(async () => state),
    deleteLabels: vi.fn(async () => state),
    dismissSuggestion: vi.fn(async () => state),
    capturePlan: vi.fn(async () => null),
    recordLabel: vi.fn(async () => undefined),
    locationAllowed: vi.fn(async () => false),
    readLocation: vi.fn(async () => ({ state: "unavailable" as const })),
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!;
  descriptor.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

describe("BehaviorForm place autocomplete & safe marker handling", () => {
  const successAction: BehaviorFormAction = async () =>
    ({ status: "success", message: "Saved." }) as BehaviorActionState;

  it("defers marker save until Behavior save, allows instant Undo, and never saves stale coordinates after edit", async () => {
    const placeLabels = createPlaceLabelClient(ON_STATE);
    const searchClient: PlaceSearchClient = {
      search: vi.fn(async () => ({
        kind: "ok" as const,
        suggestions: [YMCA_SUGGESTION],
        attribution: GEOAPIFY_ATTRIBUTION,
      })),
    };

    await act(async () => {
      root.render(
        <PlaceLabelProvider client={placeLabels}>
          <BehaviorForm
            mode="create"
            action={successAction}
            categories={[{ id: "cat-1", name: "Fitness" }]}
            savedPlaces={["Local Climbing Gym, Brooklyn"]}
            placeSearchClient={searchClient}
          />
        </PlaceLabelProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    const where = host.querySelector<HTMLSelectElement>('select[name="where_kind"]')!;
    await act(async () => {
      where.value = "place";
      where.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const placeInput = host.querySelector<HTMLInputElement>('input[name="location_text"]')!;
    await act(async () => {
      placeInput.focus();
      setInputValue(placeInput, "YMCA");
    });

    // Debounce waits 350ms before calling Geoapify.
    expect(searchClient.search).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });
    expect(searchClient.search).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Greenpoint YMCA");
    expect(host.textContent).toContain(GEOAPIFY_ATTRIBUTION);

    // Select the Geoapify suggestion: text updates, Undo appears, marker NOT written yet!
    const option = host.querySelector<HTMLElement>('[role="option"]')!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(placeInput.value).toBe(YMCA_SUGGESTION.formatted);
    expect(host.textContent).toContain("Its marker will save when you save this behavior.");
    expect(placeLabels.recordMarker).not.toHaveBeenCalled();

    // Clicking Undo restores the typed text right before selection with zero marker writes.
    await act(async () => { findButton("Undo").click(); });
    expect(placeInput.value).toBe("YMCA");
    expect(placeLabels.recordMarker).not.toHaveBeenCalled();

    // Select again, then manually edit the text: pending coordinates MUST be discarded!
    await act(async () => {
      placeInput.focus();
      setInputValue(placeInput, "YMCA Greenpoint");
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLElement>('[role="option"]')!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      setInputValue(placeInput, "Different Gym Across Town");
    });
    expect(host.querySelector("[data-place-selection]")).toBeNull();

    // Submit with edited text -> must NOT record YMCA coordinates.
    const titleInput = host.querySelector<HTMLInputElement>('input[name="title"]')!;
    await act(async () => { setInputValue(titleInput, "Workout"); });
    const form = host.querySelector("form")!;
    await act(async () => { form.requestSubmit(); await Promise.resolve(); });
    expect(placeLabels.recordMarker).not.toHaveBeenCalled();
  });

  it("records the completion marker when saving an unedited Geoapify selection with Completion places on", async () => {
    const placeLabels = createPlaceLabelClient(ON_STATE);
    const searchClient: PlaceSearchClient = {
      search: vi.fn(async () => ({
        kind: "ok" as const,
        suggestions: [YMCA_SUGGESTION],
        attribution: GEOAPIFY_ATTRIBUTION,
      })),
    };

    await act(async () => {
      root.render(
        <PlaceLabelProvider client={placeLabels}>
          <BehaviorForm
            mode="create"
            action={successAction}
            categories={[{ id: "cat-1", name: "Fitness" }]}
            placeSearchClient={searchClient}
          />
        </PlaceLabelProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    const where = host.querySelector<HTMLSelectElement>('select[name="where_kind"]')!;
    await act(async () => {
      where.value = "place";
      where.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const placeInput = host.querySelector<HTMLInputElement>('input[name="location_text"]')!;
    await act(async () => {
      placeInput.focus();
      setInputValue(placeInput, "YMCA");
    });
    await act(async () => {
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLElement>('[role="option"]')!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    const titleInput = host.querySelector<HTMLInputElement>('input[name="title"]')!;
    await act(async () => { setInputValue(titleInput, "Workout"); });
    await act(async () => { host.querySelector("form")!.requestSubmit(); await Promise.resolve(); });
    expect(placeLabels.recordMarker).toHaveBeenCalledWith({
      place: { kind: "saved_place", text: YMCA_SUGGESTION.formatted },
      position: { latitudeE6: 40_727_100, longitudeE6: -73_954_200, accuracyMeters: 25 },
      sampleAgeSeconds: 0,
    });
  });

  it("does not record a marker when Completion places is off", async () => {
    const placeLabels = createPlaceLabelClient(OFF_STATE);
    const searchClient: PlaceSearchClient = {
      search: vi.fn(async () => ({
        kind: "ok" as const,
        suggestions: [YMCA_SUGGESTION],
        attribution: GEOAPIFY_ATTRIBUTION,
      })),
    };

    await act(async () => {
      root.render(
        <PlaceLabelProvider client={placeLabels}>
          <BehaviorForm
            mode="create"
            action={successAction}
            categories={[{ id: "cat-1", name: "Fitness" }]}
            placeSearchClient={searchClient}
          />
        </PlaceLabelProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    const where = host.querySelector<HTMLSelectElement>('select[name="where_kind"]')!;
    await act(async () => {
      where.value = "place";
      where.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const placeInput = host.querySelector<HTMLInputElement>('input[name="location_text"]')!;
    await act(async () => {
      placeInput.focus();
      setInputValue(placeInput, "YMCA");
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLElement>('[role="option"]')!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    const titleInput = host.querySelector<HTMLInputElement>('input[name="title"]')!;
    await act(async () => { setInputValue(titleInput, "Workout"); });
    await act(async () => { host.querySelector("form")!.requestSubmit(); await Promise.resolve(); });
    expect(placeLabels.recordMarker).not.toHaveBeenCalled();
  });
});

describe("TravelSettingsPanel Home autocomplete & Undo", () => {
  it("supports Undo before save (zero writes) and Undo after save (reverts Home and removes marker)", async () => {
    const placeLabels = createPlaceLabelClient(ON_STATE);
    const searchClient: PlaceSearchClient = {
      search: vi.fn(async () => ({
        kind: "ok" as const,
        suggestions: [HOME_SUGGESTION],
        attribution: GEOAPIFY_ATTRIBUTION,
      })),
    };
    let currentSettings: TravelSettings = {
      enabled: true,
      baseLocationText: "1 Old Home St",
      mode: "walking",
      navigationPreference: null,
      routingConsentAt: "2026-10-01T12:00:00Z",
      onboardingCompletedAt: null,
      updatedAt: "2026-10-01T12:00:00Z",
    };
    const travelClient = {
      load: vi.fn(async () => currentSettings),
      save: vi.fn(async (input: { baseLocationText: string | null }) => {
        currentSettings = { ...currentSettings, baseLocationText: input.baseLocationText, updatedAt: new Date().toISOString() };
        return currentSettings;
      }),
    };

    await act(async () => {
      root.render(
        <PlaceLabelProvider client={placeLabels}>
          <TravelSettingsPanel
            client={travelClient}
            homeLookupClient={null}
            placeSearchClient={searchClient}
            readLocation={async () => ({ state: "prompt" as const })}
          />
        </PlaceLabelProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    const homeInput = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(homeInput.value).toBe("1 Old Home St");

    // Search and select Home suggestion.
    await act(async () => {
      homeInput.focus();
      setInputValue(homeInput, "123 Bedford");
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLElement>('[role="option"]')!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    expect(homeInput.value).toBe(HOME_SUGGESTION.formatted);
    expect(travelClient.save).not.toHaveBeenCalled();
    expect(placeLabels.recordMarker).not.toHaveBeenCalled();

    // Undo BEFORE save: reverts text with 0 saves and 0 marker writes.
    await act(async () => {
      const undo = findButton("Undo");
      undo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      undo.click();
    });
    expect(homeInput.value).toBe("1 Old Home St");
    expect(travelClient.save).not.toHaveBeenCalled();
    expect(placeLabels.recordMarker).not.toHaveBeenCalled();

    // Select again and press Enter to save Home + Home marker.
    await act(async () => {
      homeInput.focus();
      setInputValue(homeInput, "123 Bedford");
      vi.advanceTimersByTime(360);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector<HTMLElement>('[role="option"]')!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      homeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(travelClient.save).toHaveBeenCalledWith(expect.objectContaining({
      baseLocationText: HOME_SUGGESTION.formatted,
    }));
    expect(placeLabels.recordMarker).toHaveBeenCalledWith({
      place: { kind: "home" },
      position: { latitudeE6: 40_717_800, longitudeE6: -73_957_700, accuracyMeters: 25 },
      sampleAgeSeconds: 0,
    });

    // Undo AFTER save: reverts Home back to "1 Old Home St" AND removes the Home marker!
    await act(async () => {
      findButton("Undo").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(travelClient.save).toHaveBeenLastCalledWith(expect.objectContaining({
      baseLocationText: "1 Old Home St",
    }));
    expect(placeLabels.removeMarkers).toHaveBeenCalledWith("home");
  });
});
