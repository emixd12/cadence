// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import type { TravelSettings } from "@cadence/core/types/travel";
import { ExternalEventDetails } from "@/components/timeline/ExternalEventDetails";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import snapshotFixture from "./fixtures/external-event-snapshot.valid.json";

it("turns travel on in one click: consent and a foreground location request, no separate checkbox (Ticket 215)", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const settings: TravelSettings = { enabled: false, baseLocationText: null, mode: "walking", navigationPreference: "apple_maps", routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const save = vi.fn(async () => ({ ...settings, enabled: true, routingConsentAt: "2026-09-22T00:00:00Z" }));
  const readLocation = vi.fn(async () => ({ state: "denied" as const }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TravelSettingsPanel client={{ load: async () => settings, save }} readLocation={readLocation} />));
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(1);
    expect(container.querySelectorAll("select")).toHaveLength(1);
    expect(container.querySelectorAll("input:not([type])")).toHaveLength(1);
    expect(container.textContent).not.toContain("Check device location permission");
    expect(container.textContent).not.toContain("saved base");
    expect(container.textContent).not.toContain("Open locations in");
    expect(container.textContent).toContain("Google Maps");
    expect(readLocation).not.toHaveBeenCalledWith(true);
    await act(async () => checkboxes[0]!.click());
    expect(readLocation).toHaveBeenCalledWith(true);
    expect(save).toHaveBeenCalledWith({ enabled: true, baseLocationText: null, mode: "walking", navigationPreference: "apple_maps",
      expectedUpdatedAt: settings.updatedAt, acceptRoutingDisclosure: true });
    expect(container.textContent).toContain("Estimates start from Home or your previous stop instead.");
    expect(container.textContent).toContain("not sent to the Daily Brief model");
  } finally { await act(() => root.unmount()); container.remove(); }
});

it("keeps the toggle off until usual travel is chosen", async () => {
  mockPermissions(null);
  const settings: TravelSettings = { enabled: false, baseLocationText: null, mode: null, navigationPreference: null, routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const { container, unmount } = await renderPanel({ readLocation: vi.fn(async () => ({ state: "prompt" as const })), settings });
  try {
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(toggle.disabled).toBe(true);
    expect(container.textContent).toContain("Choose your usual travel to turn on estimates.");
    const mode = container.querySelector<HTMLSelectElement>("select")!;
    expect([...mode.options].map((option) => option.textContent)).toEqual(["Choose", "Walking", "Cycling", "Transit", "Driving"]);
    await act(() => { mode.value = "transit"; mode.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(toggle.disabled).toBe(false);
  } finally { await unmount(); }
});

it("saves Home and usual travel without changing the toggle", async () => {
  mockPermissions(null);
  const settings: TravelSettings = { enabled: true, baseLocationText: null, mode: "walking", navigationPreference: "google_maps", routingConsentAt: "2026-09-21T12:00:00Z", onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const save = vi.fn(async () => settings);
  const readLocation = vi.fn(async () => ({ state: "prompt" as const }));
  const { container, unmount } = await renderPanel({ readLocation, save, settings });
  try {
    const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save travel settings")!;
    expect(saveButton.disabled).toBe(true);
    const home = container.querySelector<HTMLInputElement>("input:not([type])")!;
    await act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(home, " 1 Example Street "); home.dispatchEvent(new Event("input", { bubbles: true })); });
    const mode = container.querySelector<HTMLSelectElement>("select")!;
    await act(() => { mode.value = "cycling"; mode.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(saveButton.disabled).toBe(false);
    await act(async () => saveButton.click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, baseLocationText: "1 Example Street", mode: "cycling", acceptRoutingDisclosure: true }));
    expect(readLocation).not.toHaveBeenCalledWith(true);
  } finally { await unmount(); }
});

it("turns travel off without asking for location", async () => {
  mockPermissions(null);
  const settings: TravelSettings = { enabled: true, baseLocationText: "1 Example Street", mode: "walking", navigationPreference: null, routingConsentAt: "2026-09-21T12:00:00Z", onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const save = vi.fn(async () => ({ ...settings, enabled: false, routingConsentAt: null }));
  const readLocation = vi.fn(async () => ({ state: "prompt" as const }));
  const { container, unmount } = await renderPanel({ readLocation, save, settings });
  try {
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, acceptRoutingDisclosure: false, baseLocationText: "1 Example Street" }));
    expect(readLocation).not.toHaveBeenCalledWith(true);
  } finally { await unmount(); }
});

it.each([
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15", "Search in Apple Maps"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1", "Search in Apple Maps"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140", "Search in Google Maps"],
  ["Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile", "Search in Google Maps"],
])("opens locations in the platform map app (%s)", async (userAgent, label) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(navigator, "platform", { configurable: true, value: "" });
  const event = { ...validateExternalEventSnapshot(snapshotFixture).events[0]!, location: "User source address" };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<ExternalEventDetails event={event} timezone="UTC" onClose={() => {}} onDismissAllDay={() => {}} />));
    expect([...container.querySelectorAll("a")].some((element) => element.textContent === label)).toBe(true);
  } finally { await act(() => root.unmount()); container.remove(); }
});

it("keeps journey corrections transient and builds a source-location search link", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  const event = { ...validateExternalEventSnapshot(snapshotFixture).events[0]!, location: "User source address", revision: { availability: "available" as const, providerEtag: "revision-1", providerUpdatedAt: null } };
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140" });
  Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
  const corrected = vi.fn(); const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<ExternalEventDetails event={event} timezone="UTC" onClose={() => {}} onDismissAllDay={() => {}} onTravelCorrection={corrected} />));
    const link = [...container.querySelectorAll("a")].find((element) => element.textContent === "Search in Google Maps")!;
    expect(new URL(link.href).searchParams.get("query")).toBe("User source address");
    const attendance = container.querySelector<HTMLSelectElement>('select[name="travel_attendance"]')!;
    attendance.value = "remote";
    await act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(corrected).toHaveBeenCalledWith({ eventId: event.id, revision: "revision-1", attendance: "remote", locationText: "User source address" });
  } finally { await act(() => root.unmount()); container.remove(); }
});

async function renderPanel(options: Pick<ComponentProps<typeof TravelSettingsPanel>, "readLocation" | "readPermission" | "desktop" | "openLocationSettings"> & { save?: () => Promise<TravelSettings>; settings?: TravelSettings }) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const settings: TravelSettings = options.settings ?? { enabled: false, baseLocationText: null, mode: "walking", navigationPreference: "google_maps", routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<TravelSettingsPanel client={{ load: async () => settings, save: options.save ?? (async () => settings) }} readLocation={options.readLocation} readPermission={options.readPermission} openLocationSettings={options.openLocationSettings} desktop={options.desktop} />));
  return { container, unmount: async () => { await act(() => root.unmount()); container.remove(); } };
}
function mockPermissions(state: PermissionState | null, userAgent = "Mozilla/5.0 (Macintosh) Chrome/140") {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: state ? { query: async () => ({ state }) } : undefined });
}

it.each([
  ["granted", "Device location: allowed."],
  ["prompt", "Device location: not yet allowed."],
  ["denied", "Device location: blocked. Allow location for this site in your browser’s site settings."],
] as const)("shows the web state line for %s", async (state, copy) => {
  mockPermissions(state);
  const { container, unmount } = await renderPanel({ readLocation: vi.fn(async () => ({ state: "prompt" as const })) });
  try { expect(container.textContent).toContain(copy); } finally { await unmount(); }
});

it("omits the web state line without the Permissions API", async () => {
  mockPermissions(null);
  const { container, unmount } = await renderPanel({ readLocation: vi.fn(async () => ({ state: "prompt" as const })) });
  try { expect(container.textContent).not.toContain("Device location:"); } finally { await unmount(); }
});

it("shows iOS Safari hints", async () => {
  mockPermissions("prompt", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1");
  const first = await renderPanel({ readLocation: vi.fn(async () => ({ state: "prompt" as const })) });
  try { expect(first.container.textContent).toContain("Device location: not yet allowed. To stop Safari asking, tap AA, then Website Settings, then Location, then Allow."); } finally { await first.unmount(); }
  mockPermissions("denied", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1");
  const second = await renderPanel({ readLocation: vi.fn(async () => ({ state: "prompt" as const })) });
  try { expect(second.container.textContent).toContain("Allow it in Settings › Privacy & Security › Location Services › Safari Websites."); } finally { await second.unmount(); }
});

it("reads desktop permission without requesting a position", async () => {
  mockPermissions(null);
  const readLocation = vi.fn(async () => ({ state: "denied" as const }));
  const readPermission = vi.fn(async () => "denied" as const);
  const { container, unmount } = await renderPanel({ readLocation, readPermission, desktop: true });
  try {
    expect(readPermission).toHaveBeenCalledOnce();
    expect(readLocation).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Device location: blocked. Allow it in System Settings › Privacy & Security › Location Services › Cadence.");
  } finally { await unmount(); }
});

it.each(["available", "unavailable"] as const)("keeps the grant visible after a %s position read without starting another read", async (state) => {
  mockPermissions(null);
  const readPermission = vi.fn(async () => "granted" as const);
  let finish!: () => void;
  const position = state === "available"
    ? { state, latitude: 1, longitude: 1, accuracyMeters: 10, sampledAt: Date.now() }
    : { state, reason: "timeout" };
  const readLocation = vi.fn(() => new Promise<typeof position>((resolve) => {
    finish = () => resolve(position);
  }));
  const save = vi.fn(async () => travelOn);
  const { container, unmount } = await renderPanel({ readLocation, readPermission, save, desktop: true });
  try {
    expect(readLocation).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(readLocation).toHaveBeenCalledExactlyOnceWith(true);
    expect(container.textContent).toContain("Checking device location…");
    expect(container.textContent).toContain("Device location: allowed.");
    await act(async () => { finish(); });
    expect(container.textContent).toContain(state === "available" ? "A current position is available." : "Diagnostic: timeout.");
    expect(container.textContent).toContain("Device location: allowed.");
    if (state === "unavailable") {
      expect(container.textContent).toContain("Keep Cadence in front and choose Check again");
      expect(container.textContent).not.toContain("turn on Cadence in System Settings");
    }
    expect(readLocation).toHaveBeenCalledTimes(1);
    expect(readPermission).toHaveBeenCalledTimes(3); // Mount, save completion and position completion.
  } finally { await unmount(); }
});

it("requests permission inside the toggle click without showing Saving…", async () => {
  mockPermissions("prompt");
  let finishLocate!: () => void;
  const readLocation = vi.fn((requestPermission: boolean) => requestPermission
    ? new Promise<{ state: "denied" }>((resolve) => { finishLocate = () => resolve({ state: "denied" }); })
    : Promise.resolve({ state: "prompt" as const }));
  let finishSave!: () => void;
  const settings: TravelSettings = { enabled: false, baseLocationText: null, mode: "walking", navigationPreference: "google_maps", routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const save = vi.fn(() => new Promise<TravelSettings>((resolve) => { finishSave = () => resolve({ ...settings, routingConsentAt: "2026-09-22T00:00:00Z" }); }));
  const { container, unmount } = await renderPanel({ readLocation, save, settings });
  try {
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => toggle.click());
    expect(readLocation).toHaveBeenCalledWith(true);
    expect(readLocation.mock.invocationCallOrder.at(-1)!).toBeLessThan(save.mock.invocationCallOrder[0]!);
    await act(async () => { finishSave(); });
    expect(container.textContent).toContain("Checking device location…");
    expect(container.textContent).not.toContain("Saving…");
    await act(async () => { finishLocate(); });
    expect(container.textContent).toContain("Estimates start from Home or your previous stop instead.");
  } finally { await unmount(); }
});

it("shows a diagnostic reason only when the location request returns one", async () => {
  mockPermissions(null);
  const withReason = await renderPanel({ readLocation: vi.fn(async () => ({ state: "unavailable" as const, reason: "timeout" })) });
  try {
    await act(async () => withReason.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(withReason.container.textContent).toContain("Location unavailable. Estimates start from Home or your previous stop instead. Diagnostic: timeout.");
  } finally { await withReason.unmount(); }
  const without = await renderPanel({ readLocation: vi.fn(async () => ({ state: "denied" as const })) });
  try {
    await act(async () => without.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(without.container.textContent).toContain("Location denied.");
    expect(without.container.textContent).not.toContain("Diagnostic:");
  } finally { await without.unmount(); }
});

const travelOn: TravelSettings = { enabled: true, baseLocationText: null, mode: "walking", navigationPreference: null, routingConsentAt: "2026-09-21T12:00:00Z", onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
const desktopSteps = "To use your current position, turn on Cadence in System Settings › Privacy & Security › Location Services, then choose Check again.";
const fallback = "Saved places and Calendar trips keep working without device location.";
const buttonNamed = (container: HTMLElement, label: string) => [...container.querySelectorAll("button")].find((button) => button.textContent === label);

it("explains the manual macOS path when travel is on and location is not yet allowed (Ticket 165)", async () => {
  mockPermissions(null);
  const readLocation = vi.fn(async (requestPermission: boolean) => requestPermission ? { state: "unavailable" as const, reason: "timeout" } : { state: "prompt" as const });
  const openLocationSettings = vi.fn(async () => {});
  const { container, unmount } = await renderPanel({ readLocation, readPermission: async () => "prompt", desktop: true, settings: travelOn, openLocationSettings });
  try {
    expect(container.textContent).toContain("Device location: not yet allowed.");
    expect(container.textContent).toContain(desktopSteps);
    expect(container.textContent).toContain(fallback);
    expect(container.textContent).not.toContain("Allow it in System Settings");
    await act(async () => buttonNamed(container, "Open Location Services")!.click());
    expect(openLocationSettings).toHaveBeenCalledTimes(1);
    expect(readLocation).not.toHaveBeenCalledWith(true);
    await act(async () => buttonNamed(container, "Check again")!.click());
    expect(readLocation).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain("Diagnostic: timeout.");
    expect(container.textContent).toContain(desktopSteps);
  } finally { await unmount(); }
});

it("keeps the guidance in place and disables Check again while a retry runs", async () => {
  mockPermissions(null);
  let finish!: () => void;
  const readLocation = vi.fn((requestPermission: boolean) => requestPermission
    ? new Promise<{ state: "available"; latitude: number; longitude: number; accuracyMeters: number; sampledAt: number }>((resolve) => {
      finish = () => resolve({ state: "available", latitude: 1, longitude: 1, accuracyMeters: 10, sampledAt: Date.now() });
    })
    : Promise.resolve({ state: "denied" as const }));
  const { container, unmount } = await renderPanel({ readLocation, readPermission: async () => "denied", desktop: true, settings: travelOn, openLocationSettings: async () => {} });
  try {
    act(() => buttonNamed(container, "Check again")!.click());
    expect(container.textContent).toContain("Checking device location…");
    expect(buttonNamed(container, "Check again")!.disabled).toBe(true);
    await act(async () => { finish(); });
    expect(container.textContent).toContain("A current position is available. Cadence did not save it.");
    expect(container.textContent).not.toContain(desktopSteps);
  } finally { await unmount(); }
});

it("waits for the toggle's own request before showing the guidance, then shows it after a timeout", async () => {
  mockPermissions(null);
  let finish!: () => void;
  const readLocation = vi.fn((requestPermission: boolean) => requestPermission
    ? new Promise<{ state: "unavailable"; reason: string }>((resolve) => { finish = () => resolve({ state: "unavailable", reason: "timeout" }); })
    : Promise.resolve({ state: "unavailable" as const }));
  const save = vi.fn(async () => travelOn);
  const { container, unmount } = await renderPanel({ readLocation, readPermission: async () => "unavailable", desktop: true, save, openLocationSettings: async () => {} });
  try {
    expect(container.textContent).not.toContain(desktopSteps);
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(container.textContent).toContain("Checking device location…");
    expect(container.textContent).not.toContain(desktopSteps);
    await act(async () => { finish(); });
    expect(container.textContent).toContain(desktopSteps);
    expect(container.textContent).toContain(fallback);
  } finally { await unmount(); }
});

it("shows no guidance while travel is off or location is allowed", async () => {
  mockPermissions(null);
  const off = await renderPanel({ readLocation: vi.fn(async () => ({ state: "denied" as const })), readPermission: async () => "denied", desktop: true, openLocationSettings: async () => {} });
  try {
    expect(off.container.textContent).toContain("Device location: blocked. Allow it in System Settings › Privacy & Security › Location Services › Cadence.");
    expect(buttonNamed(off.container, "Check again")).toBeUndefined();
  } finally { await off.unmount(); }
  const allowed = await renderPanel({ readLocation: vi.fn(async () => ({ state: "available" as const, latitude: 1, longitude: 1, accuracyMeters: 10, sampledAt: Date.now() })), readPermission: async () => "granted", desktop: true, settings: travelOn });
  try {
    expect(allowed.container.textContent).toContain("Device location: allowed.");
    expect(buttonNamed(allowed.container, "Check again")).toBeUndefined();
  } finally { await allowed.unmount(); }
});

it("reports when System Settings cannot open", async () => {
  mockPermissions(null);
  const { container, unmount } = await renderPanel({ readLocation: vi.fn(async () => ({ state: "denied" as const })), readPermission: async () => "denied", desktop: true, settings: travelOn,
    openLocationSettings: vi.fn(async () => { throw new Error("closed"); }) });
  try {
    await act(async () => buttonNamed(container, "Open Location Services")!.click());
    expect(container.textContent).toContain("System Settings could not open. Open it from the Apple menu.");
  } finally { await unmount(); }
});

it.each([
  ["denied", "Mozilla/5.0 (Macintosh) Chrome/140", "Allow location for this site in your browser’s site settings, then choose Check again."],
  ["prompt", "Mozilla/5.0 (Macintosh) Chrome/140", "Choose Check again and allow location when your browser asks."],
  ["denied", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1", "Allow location in Settings › Privacy & Security › Location Services › Safari Websites, then choose Check again."],
  ["prompt", "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1", "Choose Check again and allow location. To stop Safari asking, tap AA, then Website Settings, then Location, then Allow."],
] as const)("gives browser guidance for %s (%s)", async (state, userAgent, copy) => {
  mockPermissions(state, userAgent);
  const { container, unmount } = await renderPanel({ readLocation: vi.fn(async () => ({ state: "prompt" as const })), settings: travelOn });
  try {
    expect(container.textContent).toContain(`Device location: ${state === "denied" ? "blocked" : "not yet allowed"}.`);
    expect(container.textContent).toContain(copy);
    expect(container.textContent).toContain(fallback);
    expect(buttonNamed(container, "Open Location Services")).toBeUndefined();
    expect(buttonNamed(container, "Check again")).toBeDefined();
  } finally { await unmount(); }
});
