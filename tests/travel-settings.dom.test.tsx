// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import type { TravelSettings } from "@cadence/core/types/travel";
import { ExternalEventDetails } from "@/components/timeline/ExternalEventDetails";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import snapshotFixture from "./fixtures/external-event-snapshot.valid.json";

it("separates routing consent and foreground permission and saves without a base", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const settings: TravelSettings = { enabled: false, baseLocationText: null, mode: "walking", navigationPreference: "google_maps", routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const save = vi.fn(async () => settings);
  const readLocation = vi.fn(async () => ({ state: "denied" as const }));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TravelSettingsPanel client={{ load: async () => settings, save }} readLocation={readLocation} />));
    const buttons = () => [...container.querySelectorAll("button")];
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    const saveButton = buttons().find((button) => button.textContent === "Save travel settings")!;
    expect(readLocation).not.toHaveBeenCalled();
    await act(() => checkboxes[0]!.click());
    expect(saveButton.disabled).toBe(true);
    await act(() => checkboxes[1]!.click());
    expect(saveButton.disabled).toBe(false);
    await act(async () => saveButton.click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, baseLocationText: null, acceptRoutingDisclosure: true }));
    await act(async () => buttons().find((button) => button.textContent === "Check device location permission")!.click());
    expect(readLocation).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain("known event-to-event routes");
    expect(container.textContent).toContain("not sent to the Daily Brief model");
  } finally { await act(() => root.unmount()); container.remove(); }
});

it("keeps journey corrections transient and builds a source-location search link", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  const event = { ...validateExternalEventSnapshot(snapshotFixture).events[0]!, location: "User source address", revision: { availability: "available" as const, providerEtag: "revision-1", providerUpdatedAt: null } };
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

async function renderPanel(options: { readLocation: (requestPermission: boolean) => Promise<{ state: "available"; latitude: number; longitude: number; accuracyMeters: number; sampledAt: number } | { state: "prompt" | "denied" | "unavailable"; reason?: string }>; desktop?: boolean; save?: () => Promise<TravelSettings>; settings?: TravelSettings }) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const settings: TravelSettings = options.settings ?? { enabled: false, baseLocationText: null, mode: "walking", navigationPreference: "google_maps", routingConsentAt: null, onboardingCompletedAt: null, updatedAt: "2026-09-21T12:00:00Z" };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<TravelSettingsPanel client={{ load: async () => settings, save: options.save ?? (async () => settings) }} readLocation={options.readLocation} desktop={options.desktop} />));
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

it("maps desktop states from readLocation(false)", async () => {
  mockPermissions(null);
  const readLocation = vi.fn(async () => ({ state: "denied" as const }));
  const { container, unmount } = await renderPanel({ readLocation, desktop: true });
  try {
    expect(readLocation).toHaveBeenCalledWith(false);
    expect(container.textContent).toContain("Device location: blocked. Allow it in System Settings › Privacy & Security › Location Services › Cadence.");
  } finally { await unmount(); }
});

it("tells desktop users where to allow location when macOS gives no decision", async () => {
  mockPermissions(null);
  const readLocation = vi.fn(async (requestPermission: boolean) => requestPermission
    ? { state: "unavailable" as const, reason: "no_permission_response" } : { state: "prompt" as const });
  const { container, unmount } = await renderPanel({ readLocation, desktop: true });
  try {
    expect(container.textContent).toContain("Device location: not yet allowed. If macOS does not ask, turn on Cadence in System Settings › Privacy & Security › Location Services, then check again.");
    const check = [...container.querySelectorAll("button")].find((button) => button.textContent === "Check device location permission")!;
    await act(async () => check.click());
    expect(readLocation).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain("Diagnostic: no_permission_response.");
    expect(container.textContent).toContain("Device location: not yet allowed. If macOS does not ask");
  } finally { await unmount(); }
});

it("requests permission inside the consent save click without showing Saving…", async () => {
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
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(() => checkboxes[1]!.click());
    const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save travel settings")!;
    act(() => saveButton.click());
    expect(readLocation).toHaveBeenCalledWith(true);
    expect(readLocation.mock.invocationCallOrder.at(-1)!).toBeLessThan(save.mock.invocationCallOrder[0]!);
    await act(async () => { finishSave(); });
    expect(container.textContent).toContain("Checking…");
    expect(container.textContent).not.toContain("Saving…");
    await act(async () => { finishLocate(); });
    expect(container.textContent).toContain("known event-to-event routes");
  } finally { await unmount(); }
});

it("shows a diagnostic reason only when the check returns one", async () => {
  mockPermissions(null);
  const withReason = await renderPanel({ readLocation: vi.fn(async () => ({ state: "unavailable" as const, reason: "timeout" })) });
  try {
    const button = [...withReason.container.querySelectorAll("button")].find((item) => item.textContent === "Check device location permission")!;
    await act(async () => button.click());
    expect(withReason.container.textContent).toContain("Location unavailable. Add a saved base for the immediate origin, or continue with known event-to-event routes. Diagnostic: timeout.");
  } finally { await withReason.unmount(); }
  const without = await renderPanel({ readLocation: vi.fn(async () => ({ state: "denied" as const })) });
  try {
    const button = [...without.container.querySelectorAll("button")].find((item) => item.textContent === "Check device location permission")!;
    await act(async () => button.click());
    expect(without.container.textContent).toContain("Location denied.");
    expect(without.container.textContent).not.toContain("Diagnostic:");
  } finally { await without.unmount(); }
});
