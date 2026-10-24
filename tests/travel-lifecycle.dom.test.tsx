// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestDailyBriefTravel, travelConclusionsToken, TravelClientError, travelClientErrorFromResponse, resetTravelViewCacheForTest, useTravelContext, type TravelClient, type TravelState, type TravelRoutesView } from "@/lib/ui/travel";

const settings = { enabled: true, mode: "walking" as const, baseLocationText: null, navigationPreference: "google_maps" as const,
  routingConsentAt: "2026-09-21T12:00:00Z", onboardingCompletedAt: null, updatedAt: "revision" };
const view = (accountId: string): TravelRoutesView => ({ accountId, mode: "walking", navigationPreference: "google_maps", settingsRevision: "revision",
  expiresAt: new Date(Date.now() + 300_000).toISOString(), evidence: { version: "1.0", journeyRef: accountId,
    legs: [], segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null } });
const capture = vi.fn<(state: TravelState) => void>();
const latest = () => capture.mock.lastCall![0];
function Probe({ client, accountId, sourceKey = "source" }: { client: TravelClient; accountId: string; sourceKey?: string }) {
  const state = useTravelContext({ enabled: true, accountId, sourceKey, localDate: "2026-09-21", client });
  capture(state);
  return <p>{state.view?.evidence?.journeyRef ?? state.message ?? "empty"}</p>;
}
beforeEach(() => { resetTravelViewCacheForTest(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("gates device reads, shows provider review, and rejects late account responses", async () => {
  vi.useFakeTimers();
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
    expect(host.textContent).toBe("empty");
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
  vi.useFakeTimers();
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
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const at = (latitude: number) => ({ state: "available" as const, latitude, longitude: -87.68, accuracyMeters: 10, sampledAt: Date.now() });
  const readLocation = vi.fn(async () => at(42.0500));
  const routes = vi.fn<TravelClient["routes"]>(async () => view("account-a"));
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
    expect(routes).toHaveBeenCalledTimes(2);
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
  vi.useFakeTimers();
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
  vi.useFakeTimers();
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
  vi.useFakeTimers();
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
  vi.useFakeTimers();
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
  vi.useFakeTimers();
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
  const routes = vi.fn(async () => view("account-a"));
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
    expect(routes).toHaveBeenCalledTimes(3);
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
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    // A travel settings or location change forgets it.
    await act(() => window.dispatchEvent(new Event("cadence:travel-changed")));
    expect(travelConclusionsToken("account-a", "2026-09-21")).toBeNull();
  } finally { await unmount(); }
});
