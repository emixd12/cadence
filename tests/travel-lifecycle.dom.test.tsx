// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_BRIEF_TRAVEL_WAIT_MS, clearTravelSession, requestDailyBriefTravel, waitForDailyBriefTravel, travelConclusionsToken, TravelClientError, travelClientErrorFromResponse, resetTravelViewCacheForTest, useTravelContext, type TravelClient, type TravelState, type TravelRoutesInput, type TravelRoutesView } from "@/lib/ui/travel";
import { resolveDepartureModel } from "@cadence/core/resolvers/departure.resolver";
import { travelTripMatches } from "@cadence/core/services/travel-refresh-policy";
import type { TravelEvidenceLeg, TravelOccupiedSegment, TravelResolvedLegEvidence } from "@cadence/core/types/travel";

/** 10:00 AM in New York on the Timeline's date, so the refresh plan sees the same day. */
const TEST_NOW = new Date("2026-09-21T14:00:00Z");
const settings = { enabled: true, mode: "walking" as const, baseLocationText: null, navigationPreference: "google_maps" as const,
  routingConsentAt: "2026-09-21T12:00:00Z", onboardingCompletedAt: null, updatedAt: "revision" };
const view = (accountId: string): TravelRoutesView => ({ accountId, mode: "walking", navigationPreference: "google_maps", settingsRevision: "revision",
  expiresAt: new Date(Date.now() + 300_000).toISOString(), evidence: { version: "1.0", journeyRef: accountId,
    legs: [], segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null } });
/** A view with one outbound trip, which leaves from the device, so movement has a trip to refresh. */
const movingView = (accountId: string): TravelRoutesView => {
  const now = new Date().toISOString();
  const leg = { id: `out-${Date.now()}`, role: "outbound" as const, journeyRef: accountId, originCommitmentRef: null, destinationCommitmentRef: "dentist",
    mode: "walking" as const, readyAt: now, provenance: { originRef: "device", originSource: "device", originRevision: now, destinationRef: "dentist",
      destinationSource: "calendar", destinationRevision: "r1", grantRevision: "revision" } as TravelEvidenceLeg["provenance"] };
  const estimate = { durationSeconds: 1200, departureAt: "2026-09-21T23:00:00Z", arrivalAt: "2026-09-21T23:20:00Z", warnings: [], fallback: false,
    attribution: "Google", observedAt: now, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  return { ...view(accountId), evidence: { ...view(accountId).evidence!, legs: [{ leg, state: "current", estimate, reason: null }] } };
};
const capture = vi.fn<(state: TravelState) => void>();
const latest = () => capture.mock.lastCall![0];
function Probe({ client, accountId, sourceKey = "source", localDate = "2026-09-21", sourceReady }: { client: TravelClient; accountId: string; sourceKey?: string; localDate?: string; sourceReady?: boolean }) {
  const state = useTravelContext({ enabled: true, accountId, sourceKey, localDate, client, timezone: "America/New_York", sourceReady });
  capture(state);
  return <p>{state.view?.evidence?.journeyRef ?? state.message ?? "empty"}</p>;
}
beforeEach(() => { resetTravelViewCacheForTest(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("gates device reads, shows provider review, and rejects late account responses", async () => {
  vi.useFakeTimers({ now: TEST_NOW });
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const configured = vi.fn(async () => false);
  const readLocation = vi.fn(async () => ({ state: "denied" as const }));
  let resolveOld!: (value: TravelRoutesView) => void;
  const routes = vi.fn().mockImplementationOnce(() => new Promise<TravelRoutesView>((resolve) => { resolveOld = resolve; }))
    .mockImplementation(async () => view("account-b"));
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings }, configured, readLocation, routes };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(350); });
    expect(configured).toHaveBeenCalledTimes(1);
    expect(readLocation).not.toHaveBeenCalled();
    expect(host.textContent).toContain("provider review");
    configured.mockResolvedValue(true);
    await act(async () => { latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    expect(readLocation).toHaveBeenCalledWith(false);
    await act(() => root.render(<Probe client={client} accountId="account-b" />));
    await act(async () => { resolveOld(view("account-a")); await vi.advanceTimersByTimeAsync(350); });
    expect(host.textContent).toBe("account-b");
    await act(() => root.render(<Probe client={client} accountId="account-b" sourceKey="changed" />));
    // Ticket 268: a changed source keeps today's last view, marked, until its response arrives.
    expect(host.textContent).toBe("account-b");
    expect(latest().stale).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(host.textContent).toBe("account-b");
    await act(() => window.dispatchEvent(new Event("offline")));
    expect(host.textContent).toBe("account-b");
    focused.mockReturnValue(false);
    const readsBeforeBlur = readLocation.mock.calls.length;
    await act(() => root.render(<Probe client={client} accountId="account-b" sourceKey="background-change" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(readLocation).toHaveBeenCalledTimes(readsBeforeBlur);
  } finally { await act(() => root.unmount()); host.remove(); }
});

async function mount(routes: TravelClient["routes"]) {
  vi.useFakeTimers({ now: TEST_NOW });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings },
    configured: async () => true, readLocation: async () => ({ state: "denied" as const }), routes };
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  const render = (sourceKey = "source") => act(() => root.render(<Probe client={client} accountId="account-a" sourceKey={sourceKey} />));
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(350));
  const remount = async () => {
    await act(() => root.unmount()); root = createRoot(host);
    await render(); await act(async () => vi.advanceTimersByTimeAsync(350));
  };
  return { host, client, render, remount, unmount: async () => { await act(() => root.unmount()); host.remove(); } };
}
const focusAndWait = (ms = 350) => act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(ms); });

it("requests once on page load and not on focus", async () => {
  const routes = vi.fn(async () => view("account-a"));
  const { host, unmount } = await mount(routes);
  try {
    expect(routes).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("account-a");
    await act(() => window.dispatchEvent(new Event("blur")));
    await focusAndWait();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(1);
  } finally { await unmount(); }
});

it("reuses a fresh cached view on remount without a request", async () => {
  const routes = vi.fn(async () => view("account-a"));
  const { host, remount, unmount } = await mount(routes);
  try {
    await remount();
    expect(routes).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("account-a");
  } finally { await unmount(); }
});

it("shows a recent cached failure on remount without a request, and requests after 5 minutes", async () => {
  const routes = vi.fn(async () => { throw new TravelClientError("provider_unavailable"); });
  const { host, remount, unmount } = await mount(routes);
  try {
    await remount();
    expect(routes).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("unavailable");
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    await remount();
    expect(routes).toHaveBeenCalledTimes(2);
  } finally { await unmount(); }
});

it("clears the cache and requests on a settings change", async () => {
  const routes = vi.fn(async () => view("account-a"));
  const { remount, unmount } = await mount(routes);
  try {
    await act(async () => { window.dispatchEvent(new Event("cadence:travel-changed")); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(2);
    await remount();
    expect(routes).toHaveBeenCalledTimes(2);
  } finally { await unmount(); }
});

it("requests when the sourceKey changes after a successful view", async () => {
  const routes = vi.fn(async () => view("account-a"));
  const { render, unmount } = await mount(routes);
  try {
    await render("changed");
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(2);
  } finally { await unmount(); }
});

it("refreshes manually once and ignores calls while pending", async () => {
  const routes = vi.fn(async () => view("account-a"));
  const { unmount } = await mount(routes);
  try {
    await act(async () => { latest().refresh(); });
    expect(latest().pending).toBe(true);
    await act(async () => { latest().refresh(); latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(2);
    expect(latest().pending).toBe(false);
  } finally { await unmount(); }
});

it("keeps an expired view as stale evidence without requesting", async () => {
  const routes = vi.fn(async () => view("account-a"));
  const { host, unmount } = await mount(routes);
  try {
    expect(latest().stale).toBe(false);
    expect(latest().observedAt).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(host.textContent).toBe("account-a");
    expect(latest().stale).toBe(true);
    await focusAndWait();
    expect(routes).toHaveBeenCalledTimes(1);
  } finally { await unmount(); }
});

it("shows a paused message for a 429 without a renewal time", async () => {
  const error = await travelClientErrorFromResponse(new Response(JSON.stringify({ error: "quota_exceeded", retryAfterSeconds: 60 }), { status: 429 }));
  expect(error).toMatchObject({ code: "quota_exceeded", retryAfterSeconds: 60, resetsAt: null });
  const { host, unmount } = await mount(vi.fn(async () => { throw error; }));
  try {
    expect(host.textContent).toBe("Travel estimates are paused until the travel limit renews.");
    expect(host.textContent).not.toContain("tomorrow");
  } finally { await unmount(); }
});

it("keeps the last plan, stops requests and carries the renewal time when the budget is used up", async () => {
  const resetsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const error = await travelClientErrorFromResponse(new Response(JSON.stringify({ error: "quota_exceeded", retryAfterSeconds: 604_800, resetsAt }), { status: 429 }));
  expect(error).toMatchObject({ code: "quota_exceeded", resetsAt });
  const routes = vi.fn<TravelClient["routes"]>().mockResolvedValueOnce(view("account-a")).mockRejectedValue(error);
  const { host, remount, unmount } = await mount(routes);
  try {
    await act(async () => { latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("account-a");
    expect(latest()).toMatchObject({ resumesAt: resetsAt, stale: true, message: null });
    await act(async () => { latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    await remount();
    expect(routes).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("account-a");
    expect(latest().resumesAt).toBe(resetsAt);
  } finally { await unmount(); }
});

it("requests again on open only when the device moved beyond the threshold", async () => {
  vi.useFakeTimers({ now: TEST_NOW });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const at = (latitude: number) => ({ state: "available" as const, latitude, longitude: -87.68, accuracyMeters: 10, sampledAt: Date.now() });
  const readLocation = vi.fn(async () => at(42.0500));
  const routes = vi.fn<TravelClient["routes"]>(async () => movingView("account-a"));
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings }, configured: async () => true, readLocation, routes };
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  const open = async () => {
    root = createRoot(host);
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
  };
  try {
    await open();
    expect(routes).toHaveBeenCalledTimes(1);
    expect(routes.mock.calls[0]![0].device).toMatchObject({ latitude: 42.05 });
    await act(() => root.unmount());
    readLocation.mockResolvedValue(at(42.0510)); // About 110 m: reuse the cached view.
    await open();
    expect(routes).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    readLocation.mockResolvedValue(at(42.0700)); // About 2.2 km: the estimate is out of date.
    await open();
    // Ticket 268: movement waits 10 minutes from the last request that routed from the device.
    expect(routes).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    await open();
    expect(routes).toHaveBeenCalledTimes(2);
    // Ticket 268: movement refreshes only the trip that leaves from the device.
    expect(routes.mock.calls[1]![0].trips).toEqual([{ role: "outbound", originRef: null, destinationRef: "dentist" }]);
  } finally { await act(() => root.unmount()); host.remove(); }
});

it("retries one context change and shows the view", async () => {
  const routes = vi.fn().mockRejectedValueOnce(new TravelClientError("context_changed")).mockImplementation(async () => view("account-a"));
  const { host, unmount } = await mount(routes);
  try {
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("account-a");
  } finally { await unmount(); }
});

it("shows the unavailable message after two context changes", async () => {
  const routes = vi.fn(async () => { throw await travelClientErrorFromResponse(new Response(JSON.stringify({ error: "context_changed" }), { status: 409 })); });
  const { host, unmount } = await mount(routes);
  try {
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("Travel estimates are unavailable right now. Tracking and Calendar still work.");
  } finally { await unmount(); }
});

it("finishes an admitted request while hidden and does not request again on return", async () => {
  let resolveRoutes!: (value: TravelRoutesView) => void;
  const routes = vi.fn(() => new Promise<TravelRoutesView>((resolve) => { resolveRoutes = resolve; }));
  const { host, unmount } = await mount(routes);
  try {
    expect(routes).toHaveBeenCalledTimes(1);
    expect(latest().pending).toBe(true);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await act(async () => { window.dispatchEvent(new Event("blur")); document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(latest().pending).toBe(true);
    await act(async () => { resolveRoutes(view("account-a")); await vi.advanceTimersByTimeAsync(0); });
    expect(host.textContent).toBe("account-a");
    expect(latest().pending).toBe(false);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(1);
  } finally { await unmount(); }
});

it("cancels a request that has not reached the routes call when hidden, and restarts it on return", async () => {
  vi.useFakeTimers({ now: TEST_NOW });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  let resolveConfigured!: (value: boolean) => void;
  const configured = vi.fn(() => new Promise<boolean>((resolve) => { resolveConfigured = resolve; }));
  const routes = vi.fn(async () => view("account-a"));
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings }, configured, readLocation: async () => ({ state: "denied" as const }), routes };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(configured).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(latest().pending).toBe(false);
    await act(async () => { resolveConfigured(true); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(350); });
    expect(configured).toHaveBeenCalledTimes(2);
    await act(async () => { resolveConfigured(true); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(1);
  } finally { await act(() => root.unmount()); host.remove(); }
});

it("caches an admitted request's view across unmount and reuses it on remount", async () => {
  vi.useFakeTimers({ now: TEST_NOW });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  let resolveRoutes!: (value: TravelRoutesView) => void;
  const routes = vi.fn(() => new Promise<TravelRoutesView>((resolve) => { resolveRoutes = resolve; }));
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings }, configured: async () => true, readLocation: async () => ({ state: "denied" as const }), routes };
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  try {
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    await act(async () => { resolveRoutes(view("account-a")); await vi.advanceTimersByTimeAsync(0); });
    root = createRoot(host);
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("account-a");
  } finally { await act(() => root.unmount()); host.remove(); }
});

it("joins an in-flight routes call on immediate remount instead of requesting again", async () => {
  vi.useFakeTimers({ now: TEST_NOW });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  let resolveRoutes!: (value: TravelRoutesView) => void;
  const routes = vi.fn(() => new Promise<TravelRoutesView>((resolve) => { resolveRoutes = resolve; }));
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings }, configured: async () => true, readLocation: async () => ({ state: "denied" as const }), routes };
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  try {
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    root = createRoot(host);
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(1);
    expect(latest().pending).toBe(true);
    await act(async () => { resolveRoutes(view("account-a")); await vi.advanceTimersByTimeAsync(0); });
    expect(host.textContent).toBe("account-a");
    expect(latest().pending).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(1);
  } finally { await act(() => root.unmount()); host.remove(); }
});

it("does not join or cache a routes call started before a settings change", async () => {
  vi.useFakeTimers({ now: TEST_NOW });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const resolvers: ((value: TravelRoutesView) => void)[] = [];
  const routes = vi.fn(() => new Promise<TravelRoutesView>((resolve) => { resolvers.push(resolve); }));
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings }, configured: async () => true, readLocation: async () => ({ state: "denied" as const }), routes };
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  try {
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    root = createRoot(host);
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("cadence:travel-changed")); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(2);
    await act(async () => { resolvers[0]!(view("account-a")); await vi.advanceTimersByTimeAsync(0); });
    expect(latest().view).toBeNull();
    expect(latest().pending).toBe(true);
    await act(async () => { resolvers[1]!(view("account-a")); await vi.advanceTimersByTimeAsync(0); });
    expect(host.textContent).toBe("account-a");
    expect(latest().pending).toBe(false);
    await act(() => root.unmount());
    root = createRoot(host);
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("account-a");
  } finally { await act(() => root.unmount()); host.remove(); }
});

it("invalidates cached and in-flight travel when settings change while no Timeline is mounted", async () => {
  vi.useFakeTimers({ now: TEST_NOW });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const resolvers: ((value: TravelRoutesView) => void)[] = [];
  const routes = vi.fn(() => new Promise<TravelRoutesView>((resolve) => { resolvers.push(resolve); }));
  const client: TravelClient = { settings: { load: async () => settings, save: async () => settings }, configured: async () => true, readLocation: async () => ({ state: "denied" as const }), routes };
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  const remount = async () => {
    root = createRoot(host);
    await act(() => root.render(<Probe client={client} accountId="account-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(350));
  };
  try {
    await remount();
    expect(routes).toHaveBeenCalledTimes(1);
    await act(() => root.unmount());
    window.dispatchEvent(new Event("cadence:travel-changed"));
    await remount();
    expect(routes).toHaveBeenCalledTimes(2);
    await act(async () => { resolvers[0]!(view("account-a")); await vi.advanceTimersByTimeAsync(0); });
    expect(latest().view).toBeNull();
    expect(latest().pending).toBe(true);
    await act(async () => { resolvers[1]!(view("account-a")); await vi.advanceTimersByTimeAsync(0); });
    expect(host.textContent).toBe("account-a");
    await act(() => root.unmount());
    window.dispatchEvent(new Event("cadence:travel-changed"));
    await remount();
    expect(routes).toHaveBeenCalledTimes(3);
    expect(latest().pending).toBe(true);
  } finally { await act(() => root.unmount()); host.remove(); }
});


it("routes the day once per generated brief, without repeating on remount", async () => {
  const routes = vi.fn(async () => view("account-a"));
  const { remount, unmount } = await mount(routes);
  try {
    await act(async () => {
      requestDailyBriefTravel("account-b", "2026-09-21", "generation-1");
      requestDailyBriefTravel("account-a", "2026-09-22", "generation-1");
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(routes).toHaveBeenCalledTimes(1);
    await act(async () => {
      requestDailyBriefTravel("account-a", "2026-09-21", "generation-1");
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(routes).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "day" }), expect.any(AbortSignal));
    await act(() => requestDailyBriefTravel("account-a", "2026-09-21", "generation-1"));
    await remount();
    expect(routes).toHaveBeenCalledTimes(2);
  } finally { await unmount(); }
});

it("queues the day when a brief finishes during a Timeline request", async () => {
  let resolve!: (value: TravelRoutesView) => void;
  const routes = vi.fn().mockImplementationOnce(() => new Promise<TravelRoutesView>(done => { resolve = done; }))
    .mockImplementation(async () => view("account-a"));
  const { unmount } = await mount(routes);
  try {
    await act(() => requestDailyBriefTravel("account-a", "2026-09-21", "generation-1"));
    await act(async () => { resolve(view("account-a")); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(2);
    expect(routes).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "day" }), expect.any(AbortSignal));
  } finally { await unmount(); }
});

it("honors a budget refusal across source changes and unlocks manual refresh at renewal", async () => {
  const routes = vi.fn().mockImplementationOnce(async () => view("account-a"))
    .mockImplementationOnce(async () => { throw new TravelClientError("quota_exceeded", 60, new Date(Date.now() + 60_000).toISOString()); })
    .mockImplementation(async () => view("account-a"));
  const { render, unmount } = await mount(routes);
  try {
    await act(async () => { latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    expect(latest().resumesAt).not.toBeNull();
    await render("changed");
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(routes).toHaveBeenCalledTimes(2);
    expect(latest().view?.accountId).toBe("account-a");
    expect(latest().stale).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(latest().resumesAt).toBeNull();
    await act(async () => { latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(3);
  } finally { await unmount(); }
});


it("checks foreground movement without refreshing stationary or background positions", async () => {
  const routes = vi.fn<TravelClient["routes"]>(async () => movingView("account-a"));
  const { client, unmount } = await mount(routes);
  try {
    const position = { state: "available" as const, latitude: 40, longitude: -74, accuracyMeters: 10, sampledAt: Date.now() };
    const read = vi.fn(async () => position);
    Object.assign(client, { readLocation: read });
    await act(async () => { latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(routes).toHaveBeenCalledTimes(2);
    read.mockResolvedValue({ ...position, latitude: 40.01 });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(routes).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await act(async () => vi.advanceTimersByTimeAsync(60_350));
    // Ticket 268: within 10 minutes of the last request that routed from the device, movement waits.
    expect(routes).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(8 * 60_000));
    expect(routes).toHaveBeenCalledTimes(3);
    expect(routes.mock.lastCall![0].trips).toEqual([{ role: "outbound", originRef: null, destinationRef: "dentist" }]);
  } finally { await unmount(); }
});


it("keeps the last same-day plan when changed inputs hit the budget limit", async () => {
  const routes = vi.fn().mockImplementationOnce(async () => view("account-a"))
    .mockImplementation(async () => { throw new TravelClientError("quota_exceeded", 60, new Date(Date.now() + 60_000).toISOString()); });
  const { render, unmount } = await mount(routes);
  try {
    await render("changed");
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(latest().view?.accountId).toBe("account-a");
    expect(latest().stale).toBe(true);
    expect(latest().resumesAt).not.toBeNull();
  } finally { await unmount(); }
});

it("keeps the latest signed conclusions per account and day in page memory only (Ticket 219 Option A)", async () => {
  const signed = { ...view("account-a"), conclusionsToken: "signed.token" };
  const routes = vi.fn(async () => signed);
  const { unmount } = await mount(routes);
  try {
    expect(travelConclusionsToken("account-a", "2026-09-21")).toBe("signed.token");
    expect(travelConclusionsToken("account-b", "2026-09-21")).toBeNull();
    expect(travelConclusionsToken("account-a", "2026-09-22")).toBeNull();
    expect(travelConclusionsToken(null, "2026-09-21")).toBeNull();
    // An expired view's token is never offered.
    expect(travelConclusionsToken("account-a", "2026-09-21", Date.parse(signed.expiresAt!) + 1)).toBeNull();
    // Ticket 268 keeps today's view in the browser session, never the token, and nothing in localStorage.
    expect(window.localStorage.length).toBe(0);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain("signed.token");
    // A travel settings or location change forgets it.
    await act(() => window.dispatchEvent(new Event("cadence:travel-changed")));
    expect(travelConclusionsToken("account-a", "2026-09-21")).toBeNull();
  } finally { await unmount(); }
});


/**
 * Ticket 268: a typical day in New York. Dentist 9:00–10:00 AM, Gym 1:00–2:00 PM, then home.
 * Leave 8:30 AM, 12:30 PM and 2:05 PM. Each response gives the legs new IDs, as a new device
 * sample would, and routes only the trips a trip request names.
 */
const DAY_STOPS = [
  { ref: "dentist", label: "Dentist", startAt: "2026-09-21T13:00:00Z", endAt: "2026-09-21T14:00:00Z" },
  { ref: "gym", label: "Gym", startAt: "2026-09-21T17:00:00Z", endAt: "2026-09-21T18:00:00Z" },
];
const DAY_TRIPS = [
  { role: "outbound" as const, originRef: null, destinationRef: "dentist", readyAt: "2026-09-21T10:00:00Z", leaveAt: "2026-09-21T12:30:00Z", arriveAt: "2026-09-21T12:50:00Z" },
  { role: "onward" as const, originRef: "dentist", destinationRef: "gym", readyAt: "2026-09-21T14:05:00Z", leaveAt: "2026-09-21T16:30:00Z", arriveAt: "2026-09-21T16:50:00Z" },
  { role: "return" as const, originRef: "gym", destinationRef: null, readyAt: "2026-09-21T18:05:00Z", leaveAt: "2026-09-21T18:05:00Z", arriveAt: "2026-09-21T18:25:00Z" },
];
function dayServer() {
  let response = 0;
  const routedLegs: number[] = [];
  const routes = vi.fn(async (input: TravelRoutesInput): Promise<TravelRoutesView> => {
    response++;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    const legs = DAY_TRIPS.map((trip): TravelResolvedLegEvidence => {
      const leg: TravelEvidenceLeg = { id: `${trip.role}-${response}`, role: trip.role, journeyRef: "journey",
        originCommitmentRef: trip.originRef, destinationCommitmentRef: trip.destinationRef, mode: "walking", readyAt: trip.readyAt,
        provenance: { originRef: trip.originRef ?? "base", originSource: trip.originRef ? "calendar" : "saved_base", originRevision: "r1",
          destinationRef: trip.destinationRef ?? "base", destinationSource: trip.destinationRef ? "calendar" : "saved_base", destinationRevision: "r1", grantRevision: "revision" } as TravelEvidenceLeg["provenance"] };
      const routed = !input.trips || input.trips.some((ref) => travelTripMatches(ref, leg));
      return routed
        ? { leg, state: "current", reason: null, estimate: { durationSeconds: 1200, departureAt: trip.leaveAt, arrivalAt: trip.arriveAt,
            warnings: [], fallback: false, attribution: "Google", observedAt: now, expiresAt } }
        : { leg, state: "unavailable", estimate: null, reason: "outside_route_window" };
    });
    routedLegs.push(legs.filter((entry) => entry.estimate).length);
    const segments: TravelOccupiedSegment[] = [
      ...DAY_STOPS.map((stop) => ({ id: `commitment:${stop.ref}`, kind: "commitment" as const, startAt: stop.startAt, endAt: stop.endAt!, sourceRefs: [stop.ref], legId: null })),
      ...legs.flatMap((entry) => entry.estimate ? [{ id: `route:${entry.leg.id}`, kind: "route" as const, startAt: entry.estimate.departureAt,
        endAt: entry.estimate.arrivalAt, sourceRefs: [entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef].filter((ref): ref is string => !!ref), legId: entry.leg.id }] : []),
    ];
    return { accountId: "account-a", mode: "walking", navigationPreference: "google_maps", settingsRevision: "revision", expiresAt,
      evidence: { version: "1.0", journeyRef: "journey", legs, unknownLegs: [], segments, occupiedSpans: [], collisions: [],
        completeTrip: !input.trips, finalAvailabilityAt: null },
      budget: { reservedMicrodollars: 100_000, ceilingMicrodollars: 5_000_000, resetsAt: "2026-10-01T04:00:00Z" } };
  });
  return { routes, routedLegs };
}
const departureAt = (view: TravelRoutesView | null) => resolveDepartureModel({ evidence: view?.evidence ?? null, stops: DAY_STOPS,
  now: new Date().toISOString(), timezone: "America/New_York", arrivalBufferSeconds: 600, preparationSeconds: 0, pausedUntil: null });
async function openDay(routes: TravelClient["routes"], at = "2026-09-21T11:00:00Z", settingsValue: typeof settings = settings, first: { sourceKey?: string; sourceReady?: boolean } = {}) {
  vi.useFakeTimers({ now: new Date(at) });
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const client: TravelClient = { settings: { load: async () => settingsValue, save: async () => settingsValue },
    configured: async () => true, readLocation: async () => ({ state: "denied" as const }), routes };
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host);
  type OpenProps = { accountId?: string; localDate?: string; sourceKey?: string; sourceReady?: boolean };
  const render = (props: OpenProps = {}) => act(() => root.render(<Probe client={client} accountId={props.accountId ?? "account-a"} localDate={props.localDate}
    sourceKey={props.sourceKey ?? "Dentist at 12 Main St"} sourceReady={props.sourceReady} />));
  const open = async (props: OpenProps = {}) => {
    root = createRoot(host);
    await render(props);
    await act(async () => vi.advanceTimersByTimeAsync(350));
  };
  await open(first);
  const close = () => act(() => root.unmount());
  return { focus, open, close, render, reload: async (props: OpenProps = {}) => {
    await close(); resetTravelViewCacheForTest({ keepSession: true }); await open(props);
  }, done: async () => { await close(); host.remove(); } };
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const advanceTo = (at: string) => advance(Date.parse(at) - Date.now());
const storedTravel = () => window.sessionStorage.getItem("cadence:travel-session");

it("keeps last estimates through a reload, marked Last estimate, without another request (Ticket 268)", async () => {
  const { routes } = dayServer();
  const day = await openDay(routes);
  try {
    expect(routes).toHaveBeenCalledTimes(1);
    expect(routes.mock.calls[0]![0]).toMatchObject({ scope: "day" });
    expect(routes.mock.calls[0]![0]).not.toHaveProperty("trips");
    expect(departureAt(latest().view).next).toMatchObject({ freshness: "current", leaveAt: "2026-09-21T12:30:00Z" });
    await advance(10 * 60_000);
    await day.reload();
    expect(routes).toHaveBeenCalledTimes(1);
    const model = departureAt(latest().view);
    expect(model.next).toMatchObject({ freshness: "last_estimate", leaveAt: "2026-09-21T12:30:00Z", checkedAt: "2026-09-21T11:00:00.350Z" });
    expect(model.phrase).toMatch(/^Last estimate:/);
    expect(latest().stale).toBe(true);
    // The source key holds event and place text; only its digest is stored.
    expect(storedTravel()).not.toContain("Main St");
    expect(storedTravel()).not.toContain("Dentist");
  } finally { await day.done(); }
});

it("merges a trip response per trip, so other trips keep their times (Ticket 268)", async () => {
  const { routes } = dayServer();
  const day = await openDay(routes);
  try {
    await advanceTo("2026-09-21T12:00:00Z");
    await advance(350);
    expect(routes).toHaveBeenCalledTimes(2);
    expect(routes.mock.calls[1]![0]).toMatchObject({ scope: "day", trips: [{ role: "outbound", originRef: null, destinationRef: "dentist" }] });
    const legs = latest().view!.evidence!.legs;
    expect(legs.map((entry) => [entry.leg.id, entry.estimate?.observedAt])).toEqual([
      ["outbound-2", "2026-09-21T12:00:00.350Z"], ["onward-2", "2026-09-21T11:00:00.350Z"], ["return-2", "2026-09-21T11:00:00.350Z"]]);
    const trips = departureAt(latest().view).trips;
    expect(trips.map((trip) => [trip.role, trip.freshness, trip.leaveAt])).toEqual([
      ["outbound", "current", "2026-09-21T12:30:00Z"], ["onward", "last_estimate", "2026-09-21T16:30:00Z"], ["return", "last_estimate", "2026-09-21T18:05:00Z"]]);
    expect(latest().view!.evidence!.segments.filter((segment) => segment.kind === "route").map((segment) => segment.legId)).toEqual(["outbound-2", "onward-2", "return-2"]);
  } finally { await day.done(); }
});

it("follows the plan's timers, waits while the window is unfocused, and requests on return only when due", async () => {
  const { routes } = dayServer();
  const day = await openDay(routes);
  try {
    day.focus.mockReturnValue(false);
    await act(() => window.dispatchEvent(new Event("blur")));
    await advanceTo("2026-09-21T12:10:00Z");
    expect(routes).toHaveBeenCalledTimes(1);
    day.focus.mockReturnValue(true);
    await focusAndWait();
    expect(routes).toHaveBeenCalledTimes(2);
    expect(routes.mock.calls[1]![0].trips).toEqual([{ role: "outbound", originRef: null, destinationRef: "dentist" }]);
    await focusAndWait();
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(350); });
    expect(routes).toHaveBeenCalledTimes(2);
    // The onward trip falls due 3 hours before its 12:30 PM leave time, with no event.
    await advanceTo("2026-09-21T13:30:00Z");
    await advance(350);
    expect(routes).toHaveBeenCalledTimes(3);
    expect(routes.mock.calls[2]![0].trips).toEqual([{ role: "onward", originRef: "dentist", destinationRef: "gym" }]);
  } finally { await day.done(); }
});

it("keeps nothing after sign-out, account change, day change, travel off or a settings change", async () => {
  const { routes } = dayServer();
  const day = await openDay(routes);
  try {
    expect(storedTravel()).toContain("account-a");
    await act(() => clearTravelSession());
    expect(storedTravel()).toBeNull();
    await day.reload();
    expect(storedTravel()).toContain("account-a");
    await act(() => window.dispatchEvent(new Event("cadence:travel-changed")));
    expect(storedTravel()).toBeNull();
    await advance(350);
    expect(storedTravel()).toContain("account-a");
    await day.close(); resetTravelViewCacheForTest({ keepSession: true });
    await act(() => day.open({ accountId: "account-b" }));
    expect(storedTravel() ?? "").not.toContain("account-a");
    await day.close(); resetTravelViewCacheForTest();
    await day.open();
    expect(storedTravel()).toContain("2026-09-21");
    vi.setSystemTime(new Date("2026-09-22T11:00:00Z"));
    await day.close(); resetTravelViewCacheForTest({ keepSession: true });
    const reopened = createRoot(document.createElement("div"));
    await act(() => reopened.render(<Probe client={{ settings: { load: async () => settings, save: async () => settings }, configured: async () => true,
      readLocation: async () => ({ state: "denied" as const }), routes: async () => { throw new TravelClientError("provider_unavailable"); } }} accountId="account-a" localDate="2026-09-22" />));
    await advance(350);
    expect(storedTravel()).toBeNull();
    await act(() => reopened.unmount());
  } finally { await day.done(); }
  const off = await openDay(dayServer().routes, "2026-09-21T11:00:00Z", { ...settings, enabled: false });
  try { expect(storedTravel()).toBeNull(); } finally { await off.done(); }
});

it("keeps the known estimates when a trip refresh fails", async () => {
  const { routes } = dayServer();
  const day = await openDay(routes);
  try {
    routes.mockRejectedValueOnce(new TravelClientError("provider_unavailable"));
    await advanceTo("2026-09-21T12:00:00Z");
    await advance(350);
    expect(routes).toHaveBeenCalledTimes(2);
    expect(latest().view!.evidence!.legs.every((entry) => !!entry.estimate)).toBe(true);
    expect(latest().message).toBe("Travel estimates are unavailable right now. Tracking and Calendar still work.");
    await focusAndWait();
    expect(routes).toHaveBeenCalledTimes(2);
  } finally { await day.done(); }
});

it("spends the call counts docs/COSTS.md records for a typical day of normal use (Ticket 268)", async () => {
  const { routes, routedLegs } = dayServer();
  const day = await openDay(routes, "2026-09-21T11:00:00Z");
  try {
    // A day of normal use: hourly returns to the window, a break away, a remount and a reload.
    for (let hour = 12; hour <= 22; hour++) {
      await advanceTo(`2026-09-21T${String(hour).padStart(2, "0")}:00:00Z`);
      await focusAndWait();
      if (hour === 13) {
        day.focus.mockReturnValue(false);
        await act(() => window.dispatchEvent(new Event("blur")));
        await advance(20 * 60_000);
        day.focus.mockReturnValue(true);
        await focusAndWait();
      }
      if (hour === 15) { await day.close(); await day.open(); }
      if (hour === 19) await day.reload();
    }
    await advanceTo("2026-09-21T23:59:00Z");
    // One whole-day pass (3 legs), the 30-minute refresh for the first trip (already inside
    // 3 hours at first open), and the 3-hour and 30-minute refreshes for the other two.
    expect(routes.mock.calls.map(([input]) => input.trips?.map((trip) => trip.role).join() ?? "day")).toEqual(
      ["day", "outbound", "onward", "return", "onward", "return"]);
    expect(routedLegs).toEqual([3, 1, 1, 1, 1, 1]);
    expect(routedLegs.reduce((sum, legs) => sum + legs, 0)).toBe(8);
  } finally { await day.done(); }
});


it("waits for the Calendar to settle, so a late Calendar costs one whole-day request, not two (Ticket 268)", async () => {
  const { routes } = dayServer();
  // First open: Calendar events are still loading, so the source key has no events yet.
  const day = await openDay(routes, "2026-09-21T11:00:00Z", settings, { sourceKey: "no events yet", sourceReady: false });
  try {
    await advance(3_000);
    await focusAndWait();
    expect(routes).not.toHaveBeenCalled();
    // The settled load is the first source, not a source change.
    await day.render({ sourceReady: true });
    await advance(350);
    expect(routes).toHaveBeenCalledTimes(1);
    await advance(20_000);
    expect(routes).toHaveBeenCalledTimes(1);
    // A reload: the Calendar again arrives late, and the kept view needs no request at all.
    await day.reload({ sourceKey: "no events yet", sourceReady: false });
    await advance(3_000);
    await day.render({ sourceReady: true });
    await advance(350);
    expect(routes).toHaveBeenCalledTimes(1);
    expect(departureAt(latest().view).next).toMatchObject({ leaveAt: "2026-09-21T12:30:00Z" });
  } finally { await day.done(); }
});

it("proceeds after 10 seconds when the Calendar never settles, and never delays Refresh travel (Ticket 268)", async () => {
  const { routes } = dayServer();
  const day = await openDay(routes, "2026-09-21T11:00:00Z", settings, { sourceReady: false });
  try {
    await advance(9_000);
    expect(routes).not.toHaveBeenCalled();
    await advance(1_350);
    expect(routes).toHaveBeenCalledTimes(1);
  } finally { await day.done(); }
  resetTravelViewCacheForTest();
  const manualDay = await openDay(dayServer().routes, "2026-09-21T11:00:00Z", settings, { sourceReady: false });
  try {
    const before = Date.now();
    await act(async () => { latest().refresh(); await vi.advanceTimersByTimeAsync(350); });
    expect(Date.now() - before).toBe(350);
    expect(latest().view?.evidence?.legs).toHaveLength(3);
  } finally { await manualDay.done(); }
});


it("waits 5 minutes after a revision mismatch instead of requesting on every focus (O4)", async () => {
  const routes = vi.fn(async () => ({ ...view("account-a"), settingsRevision: "older" }));
  const { unmount } = await mount(routes);
  try {
    expect(routes).toHaveBeenCalledTimes(1);
    await focusAndWait(); await focusAndWait();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await focusAndWait();
    expect(routes).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    await focusAndWait();
    expect(routes).toHaveBeenCalledTimes(2);
  } finally { await unmount(); }
});

describe("Ticket 272: the first Daily Brief's travel wait", () => {
  const signed = (accountId: string): TravelRoutesView => ({ ...view(accountId), conclusionsToken: "signed.token" });

  it("uses the page-load request already in flight, and the delivered brief routes nothing more", async () => {
    let answer!: (value: TravelRoutesView) => void;
    const routes = vi.fn<TravelClient["routes"]>().mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockImplementation(async () => signed("account-a"));
    const { unmount } = await mount(routes);
    try {
      expect(routes).toHaveBeenCalledOnce();
      const token = waitForDailyBriefTravel("account-a", "2026-09-21");
      await act(async () => { answer(signed("account-a")); await vi.advanceTimersByTimeAsync(0); });
      await expect(token).resolves.toBe("signed.token");
      await act(async () => { requestDailyBriefTravel("account-a", "2026-09-21", "generation-1"); await vi.advanceTimersByTimeAsync(1_000); });
      expect(routes).toHaveBeenCalledOnce();
    } finally { await unmount(); }
  });

  it("asks for the day when nothing is in flight and resolves with its token", async () => {
    const routes = vi.fn<TravelClient["routes"]>(async () => view("account-a"));
    const { unmount } = await mount(routes);
    try {
      routes.mockImplementation(async () => signed("account-a"));
      // The page-load response carried no token, so a later first brief asks for the day.
      const token = waitForDailyBriefTravel("account-a", "2026-09-21");
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await expect(token).resolves.toBe("signed.token");
      expect(routes).toHaveBeenCalledTimes(2);
      expect(routes).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "day" }), expect.any(AbortSignal));
    } finally { await unmount(); }
  });

  it("returns a held token at once and null without a mounted travel view", async () => {
    const routes = vi.fn<TravelClient["routes"]>(async () => signed("account-a"));
    const { unmount } = await mount(routes);
    try {
      await expect(waitForDailyBriefTravel("account-a", "2026-09-21")).resolves.toBe("signed.token");
      await expect(waitForDailyBriefTravel("account-b", "2026-09-21")).resolves.toBeNull();
      await expect(waitForDailyBriefTravel(null, "2026-09-21")).resolves.toBeNull();
    } finally { await unmount(); }
  });

  it("never waits longer than 5 seconds", async () => {
    const routes = vi.fn<TravelClient["routes"]>(async () => view("account-a"));
    const { unmount } = await mount(routes);
    try {
      routes.mockImplementation(() => new Promise(() => {}));
      let settled: string | null | undefined;
      void waitForDailyBriefTravel("account-a", "2026-09-21").then((value) => { settled = value; });
      await act(async () => { await vi.advanceTimersByTimeAsync(DAILY_BRIEF_TRAVEL_WAIT_MS - 1); });
      expect(settled).toBeUndefined();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(settled).toBeNull();
    } finally { await unmount(); }
  });
});
