// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TravelSettings } from "@cadence/core/types/travel";
import { FirstRunOnboardingPanel } from "@/components/onboarding/FirstRunOnboardingPanel";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { readTravelRoutingReport } from "@/lib/ui/travel";
import type { FirstRunOnboardingState } from "@/lib/types/onboarding";
import { DesktopOnboardingGuide } from "../apps/desktop/src/onboarding-guide";

// Ticket 212: the optional Home and travel setup row on web and desktop.
const PURPOSE = "Cadence uses these to estimate travel time to and from located Behaviors and Calendar events.";
const STATE: FirstRunOnboardingState = {
  hasAnyBehavior: false,
  hasImportRuns: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  vapidPublicKey: "",
  travel: { hasHome: false, hasMode: false },
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function flush() {
  for (let step = 0; step < 4; step++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
function travelLink() {
  return container.querySelector<HTMLAnchorElement>('a[href="/settings#travel"]');
}

describe("web first-run setup", () => {
  it("shows Home and travel with its purpose when the deployment reports routing", async () => {
    const configured = vi.fn(async () => true);
    await act(async () => root.render(<FirstRunOnboardingPanel onboarding={STATE} readTravelRoutingConfigured={configured} />));
    await flush();
    expect(configured).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Home and travel");
    expect(container.textContent).toContain(PURPOSE);
    expect(travelLink()?.textContent).toBe("Open travel");
    expect(container.textContent).toContain("Use this only if you already have a BehaviorLog bundle.");
  });

  it.each([
    ["not configured", async () => false],
    ["unreachable", async () => { throw new Error("offline"); }],
  ])("omits the row when routing is %s", async (_case, read) => {
    await act(async () => root.render(<FirstRunOnboardingPanel onboarding={STATE} readTravelRoutingConfigured={read} />));
    await flush();
    expect(container.textContent).toContain("Set up Cadence");
    expect(container.textContent).not.toContain("Home and travel");
    expect(travelLink()).toBeNull();
  });

  it("does not ask the deployment when setup is dismissed or presence is unknown", async () => {
    const configured = vi.fn(async () => true);
    localStorage.setItem("cadence-first-run-dismissed", "true");
    await act(async () => root.render(<FirstRunOnboardingPanel onboarding={STATE} readTravelRoutingConfigured={configured} />));
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    localStorage.clear();
    await act(async () => root.render(<FirstRunOnboardingPanel key="unknown" onboarding={{ ...STATE, travel: null }} readTravelRoutingConfigured={configured} />));
    await flush();
    expect(container.textContent).toContain("Set up Cadence");
    expect(configured).not.toHaveBeenCalled();
  });

  it("times out a slow routing report instead of holding setup", async () => {
    const never = vi.fn((signal: AbortSignal) => new Promise<boolean>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    }));
    await expect(readTravelRoutingReport(never, new AbortController().signal, 5)).resolves.toBeNull();
  });
});

describe("desktop setup guide", () => {
  const props = {
    hasAnyBehavior: false, hasImportRuns: false, currentTimezone: STATE.timezone, permission: "denied" as const,
    coverage: null, availableScreens: ["timeline", "behaviors", "export", "settings"] as const,
  };

  it("routes Home and travel to the Settings travel anchor after the hosted report", async () => {
    const onNavigate = vi.fn();
    const loadTravelSetup = vi.fn(async () => ({ hasHome: true, hasMode: false }));
    await act(async () => root.render(<DesktopOnboardingGuide {...props} onNavigate={onNavigate} forceOpen
      loadTravelSetup={loadTravelSetup} readTravelRoutingConfigured={async () => true} />));
    await flush();
    expect(loadTravelSetup).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Home and travel");
    expect(container.textContent).toContain(PURPOSE);
    const open = [...container.querySelectorAll("button")].find((button) => button.textContent === "Open travel")!;
    await act(() => open.click());
    expect(onNavigate).toHaveBeenCalledWith("settings", "travel");
    // Unlinking removes the hosted reader; the earlier answer must not keep the row.
    await act(async () => root.render(<DesktopOnboardingGuide {...props} onNavigate={onNavigate} forceOpen
      loadTravelSetup={loadTravelSetup} readTravelRoutingConfigured={null} />));
    expect(container.textContent).not.toContain("Home and travel");
  });

  it("omits the row in local mode, where no account can ask the deployment", async () => {
    const loadTravelSetup = vi.fn(async () => ({ hasHome: true, hasMode: true }));
    await act(async () => root.render(<DesktopOnboardingGuide {...props} onNavigate={vi.fn()} forceOpen
      loadTravelSetup={loadTravelSetup} readTravelRoutingConfigured={null} />));
    await flush();
    expect(container.textContent).toContain("Set up Cadence");
    expect(container.textContent).not.toContain("Home and travel");
    expect(loadTravelSetup).not.toHaveBeenCalled();
  });
});

describe("Travel settings as the setup destination", () => {
  it("has the travel anchor and saves Home and usual travel without enabling routing or asking for location", async () => {
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
    const settings: TravelSettings = { enabled: false, baseLocationText: null, mode: null, navigationPreference: null,
      routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-10-22T12:00:00Z" };
    const save = vi.fn(async () => ({ ...settings, baseLocationText: "1 Example Street", mode: "transit" as const }));
    const readLocation = vi.fn(async () => ({ state: "prompt" as const }));
    await act(async () => root.render(<TravelSettingsPanel client={{ load: async () => settings, save }} readLocation={readLocation} />));
    await flush();
    expect(container.querySelector("section#travel h2")?.textContent).toBe("Travel");
    const home = container.querySelector<HTMLInputElement>("#travel input:not([type])")!;
    await act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(home, "1 Example Street"); home.dispatchEvent(new Event("input", { bubbles: true })); });
    const mode = container.querySelector<HTMLSelectElement>("#travel select")!;
    await act(() => { mode.value = "transit"; mode.dispatchEvent(new Event("change", { bubbles: true })); });
    const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save travel settings")!;
    await act(async () => saveButton.click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, baseLocationText: "1 Example Street", mode: "transit", acceptRoutingDisclosure: false }));
    expect(readLocation).not.toHaveBeenCalledWith(true);
  });
});
