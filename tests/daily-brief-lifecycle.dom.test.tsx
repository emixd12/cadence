// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { DailyBriefRequestError, createWebDailyBriefClient, dailyBriefInstallationId, type DailyBriefClient } from "@/lib/ui/daily-brief";
import type { DailyBriefResponse } from "@cadence/core/types/daily-brief";
let container: HTMLDivElement;
let root: Root;
const instant = Date.parse("2026-09-20T12:00:00Z");
const ready = (text: string, lifetime = 1000): DailyBriefResponse => ({ state: "ready", briefing: {
  text, generatedAt: new Date(instant).toISOString(), expiresAt: new Date(instant + lifetime).toISOString(),
  timezone: "America/New_York", localDate: "2026-09-20", coverage: "complete", warnings: [],
} });
function client(accountRef: string, requestBrief: DailyBriefClient["requestBrief"] = async () => ready(accountRef)): DailyBriefClient {
  return { preferences: async () => ({ accountRef, available: true, enabled: true, includeCalendar: false, revision: 1, localDate: "2026-09-20", timezone: "America/New_York" }), requestBrief,
    updatePreferences: vi.fn() };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(instant);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.useRealTimers(); });
it("leaves Timeline unobstructed when preferences fail before an attempt exists", async () => {
  const unavailable = client("owner");
  const request = vi.fn();
  await act(() => root.render(<DailyBriefLauncher client={{ ...unavailable, preferences: async () => { throw new Error("offline"); }, requestBrief: request }} />));
  expect(container.textContent).toBe("");
  expect(request).not.toHaveBeenCalled();
});
it("withdraws timing text at expiry without another render or model request", async () => {
  const request = vi.fn(async () => ready("Fresh advice"));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toContain("Fresh advice");
  await act(() => vi.advanceTimersByTime(1001));
  expect(container.textContent).not.toContain("Fresh advice");
  expect(request).toHaveBeenCalledTimes(1);
});
it("hides an old owner's output immediately on account switch and logout", async () => {
  await act(() => root.render(<DailyBriefLauncher client={client("first")} sessionKey="first" />));
  expect(container.textContent).toContain("first");
  const pending = client("second", () => new Promise(() => {}));
  await act(() => root.render(<DailyBriefLauncher client={pending} sessionKey="second" />));
  expect(container.textContent).not.toContain("first");
  await act(() => root.render(<DailyBriefLauncher client={null} sessionKey="local" />));
  expect(container.textContent).toBe("");
});
it("discards late model output after a cross-tab disclosure change", async () => {
  let complete!: (value: DailyBriefResponse) => void;
  await act(() => root.render(<DailyBriefLauncher client={client("owner", () => new Promise((resolve) => { complete = resolve; }))} />));
  await act(() => window.dispatchEvent(new StorageEvent("storage", { key: "cadence.daily-brief.settings-revision.v1", newValue: "2" })));
  await act(() => complete(ready("Withdrawn advice")));
  expect(container.textContent).toBe("");
});
it("preserves pending and ready briefings when focus returns to an unchanged account", async () => {
  let complete!: (value: DailyBriefResponse) => void;
  const request = vi.fn(() => new Promise<DailyBriefResponse>((resolve) => { complete = resolve; }));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Preparing today’s");
  await act(() => complete(ready("Keep this briefing")));
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).toContain("Keep this briefing");
  expect(request).toHaveBeenCalledTimes(1);
});
it.each(["accountRef", "localDate", "timezone", "revision", "configurationRevision", "enabled", "unavailable"])("withdraws the briefing when focus detects a changed %s", async (field) => {
  const request = vi.fn(async () => ready("Original advice", 120_000));
  const adapter = client("owner", request);
  const initial = await adapter.preferences();
  const preferences = vi.fn().mockResolvedValue(initial);
  await act(() => root.render(<DailyBriefLauncher client={{ ...adapter, preferences }} />));
  expect(container.textContent).toContain("Original advice");
  if (field === "unavailable") preferences.mockRejectedValue(new Error("revoked"));
  else preferences.mockResolvedValue({ ...initial, [field]: field === "enabled" ? false : field === "revision" ? 2 : "changed" });
  request.mockImplementation(() => new Promise(() => {}));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(container.textContent).not.toContain("Original advice");
  // A new local day or account has its own automatic start; other changes stay hidden.
  expect(request).toHaveBeenCalledTimes(field === "localDate" || field === "accountRef" ? 2 : 1);
});
it("keeps explicit retry available after a pending lease without automatic polling", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ state: "pending" }).mockResolvedValueOnce(ready("Recovered briefing", 120_000));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  const retry = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again")!;
  await act(() => retry().click());
  expect(container.textContent).toContain("Try again shortly");
  await act(() => vi.advanceTimersByTime(80_000));
  expect(request).toHaveBeenCalledTimes(2);
  await act(() => retry().click());
  expect(request).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("Recovered briefing");
});

it.each([false, true])("preserves daily admission and dismissal across rollout and rollback (dismissed=%s)", async (dismissed) => {
  const request = vi.fn(async () => ready("Reviewed briefing", 120_000));
  const adapter = client("owner", request);
  const settings = await adapter.preferences();
  const preferences = vi.fn().mockResolvedValue({ ...settings, configurationRevision: "before" });
  await act(() => root.render(<DailyBriefLauncher client={{ ...adapter, preferences }} />));
  if (dismissed) await act(() => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss Daily Brief"]')!.click());
  const key = "cadence.daily-brief.presentation.v1:owner:2026-09-20";
  const admission = localStorage.getItem(key);
  expect(JSON.parse(admission!)).toMatchObject({ attempted: true, dismissed });
  for (const configurationRevision of ["after", "before"]) {
    preferences.mockResolvedValue({ ...settings, configurationRevision });
    await act(() => window.dispatchEvent(new Event("focus")));
    await act(() => root.render(null));
    await act(() => root.render(<DailyBriefLauncher client={{ ...adapter, preferences }} />));
    expect(container.textContent).toBe("");
    expect(localStorage.getItem(key)).toBe(admission);
    expect(request).toHaveBeenCalledTimes(1);
  }
});

it("keeps offline desktop tracking free from generation attempts", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const preferences = vi.fn(), requestBrief = vi.fn();
  try {
    await act(() => root.render(<DailyBriefLauncher desktop client={{ ...client("owner"), preferences, requestBrief }} />));
    expect(container.textContent).toBe("");
    expect(preferences).not.toHaveBeenCalled();
    expect(requestBrief).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  } finally { vi.restoreAllMocks(); }
});

// Ticket 168 regressions: navigation, dropped delivery, parallel tabs and bounded loading.
const markerKey = "cadence.daily-brief.presentation.v1:owner:2026-09-20";
const buttonNamed = (label: string) => [...container.querySelectorAll("button")].find((button) => button.textContent === label);

it("reattaches a remounted launcher to the in-flight attempt instead of losing it", async () => {
  let complete!: (value: DailyBriefResponse) => void;
  const request = vi.fn(() => new Promise<DailyBriefResponse>((resolve) => { complete = resolve; }));
  const adapter = client("owner", request);
  await act(() => root.render(<DailyBriefLauncher client={adapter} />));
  expect(container.textContent).toContain("Preparing today’s");
  await act(() => root.render(null));
  await act(() => root.render(<DailyBriefLauncher client={adapter} />));
  expect(container.textContent).toContain("Preparing today’s");
  await act(() => complete(ready("Survived navigation", 120_000)));
  expect(container.textContent).toContain("Survived navigation");
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => root.render(null));
  await act(() => root.render(<DailyBriefLauncher client={adapter} />));
  expect(container.textContent).toContain("Survived navigation");
  expect(request).toHaveBeenCalledTimes(1);
});

it("keeps loading through a Timeline change and offers a refresh instead of stale text", async () => {
  let complete!: (value: DailyBriefResponse) => void;
  const request = vi.fn(() => new Promise<DailyBriefResponse>((resolve) => { complete = resolve; }));
  const adapter = client("owner", request);
  await act(() => root.render(<DailyBriefLauncher client={adapter} sourceKey="before" />));
  await act(() => root.render(<DailyBriefLauncher client={adapter} sourceKey="after" />));
  expect(container.textContent).toContain("Preparing today’s");
  await act(() => complete(ready("Prepared before the mark", 120_000)));
  expect(container.textContent).not.toContain("Prepared before the mark");
  expect(container.textContent).toContain("Your Timeline changed after this brief was prepared.");
});

it("withdraws delivered text when Timeline facts change and refreshes only on request", async () => {
  const request = vi.fn(async () => ready("Current advice", 120_000));
  const adapter = client("owner", request);
  await act(() => root.render(<DailyBriefLauncher client={adapter} sourceKey="before" />));
  expect(container.textContent).toContain("Current advice");
  await act(() => root.render(<DailyBriefLauncher client={adapter} sourceKey="after" />));
  expect(container.textContent).not.toContain("Current advice");
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => buttonNamed("Refresh brief")!.click());
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ retry: true }), expect.any(AbortSignal));
  expect(container.textContent).toContain("Current advice");
});

it("offers recovery after a reload abandoned the automatic attempt", async () => {
  localStorage.setItem(markerKey, JSON.stringify({ attempted: true, delivered: false, dismissed: false }));
  const request = vi.fn(async () => ready("Recovered", 120_000));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toContain("did not finish loading");
  expect(request).not.toHaveBeenCalled();
  await act(() => buttonNamed("Try again")!.click());
  expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ retry: true }), expect.any(AbortSignal));
  expect(container.textContent).toContain("Recovered");
  expect(JSON.parse(localStorage.getItem(markerKey)!)).toEqual({ attempted: true, delivered: true, dismissed: false });
});

it("treats a server-completed but undelivered attempt as recoverable", async () => {
  const request = vi.fn<DailyBriefClient["requestBrief"]>().mockResolvedValueOnce({ state: "already_attempted" })
    .mockResolvedValueOnce(ready("Delivered on retry", 120_000));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toContain("already started but not shown here");
  await act(() => buttonNamed("Try again")!.click());
  expect(container.textContent).toContain("Delivered on retry");
});

it("waits for another tab's attempt, then hides when that tab delivers", async () => {
  localStorage.setItem(markerKey, JSON.stringify({ attempted: true, delivered: false, dismissed: false, pendingUntil: instant + 10_000 }));
  const request = vi.fn();
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toBe("");
  await act(() => vi.advanceTimersByTime(10_001));
  expect(container.textContent).toContain("did not finish loading");
  localStorage.setItem(markerKey, JSON.stringify({ attempted: true, delivered: true, dismissed: false }));
  await act(() => window.dispatchEvent(new StorageEvent("storage", { key: markerKey })));
  expect(container.textContent).toBe("");
  expect(request).not.toHaveBeenCalled();
});

it("hides a parallel tab's pending notice when the other tab delivers", async () => {
  const request = vi.fn(async (): Promise<DailyBriefResponse> => ({ state: "pending" }));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toContain("still being prepared");
  localStorage.setItem(markerKey, JSON.stringify({ attempted: true, delivered: true, dismissed: false }));
  await act(() => window.dispatchEvent(new StorageEvent("storage", { key: markerKey })));
  expect(container.textContent).toBe("");
});

it("honors server retry timing before enabling the retry control", async () => {
  const request = vi.fn<DailyBriefClient["requestBrief"]>()
    .mockRejectedValueOnce(new DailyBriefRequestError("rate_limited", 30))
    .mockResolvedValueOnce(ready("After waiting", 120_000));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toContain("Try again in about 30 seconds");
  expect(buttonNamed("Try again")!.disabled).toBe(true);
  await act(() => vi.advanceTimersByTime(30_000));
  expect(buttonNamed("Try again")!.disabled).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  ["timeout", "took too long", true],
  ["offline", "appear to be offline", true],
  ["unauthenticated", "Sign in again", false],
  ["context_changed", "changed while the brief was prepared", true],
  ["retry_exhausted", "retry limit has been reached", false],
])("distinguishes the %s outcome", async (code, message, retryable) => {
  await act(() => root.render(<DailyBriefLauncher client={client("owner", async () => { throw new DailyBriefRequestError(code); })} />));
  expect(container.textContent).toContain(message);
  expect(container.querySelectorAll("button")).toHaveLength(retryable ? 2 : 1);
});

it("shows returned recovery guidance for unrecognized failures", async () => {
  await act(() => root.render(<DailyBriefLauncher client={client("owner", async () => { throw new DailyBriefRequestError("calendar_reconnect_required", undefined, "Reconnect Google Calendar in Settings."); })} />));
  expect(container.textContent).toContain("Reconnect Google Calendar in Settings.");
});

it("keeps an expired brief's recovery state without regenerating", async () => {
  const request = vi.fn(async () => ready("Timed advice", 1_000));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  await act(() => vi.advanceTimersByTime(1_001));
  expect(container.textContent).toContain("timing has expired");
  expect(buttonNamed("Get a fresh brief")).toBeDefined();
  expect(request).toHaveBeenCalledTimes(1);
});

it("never reopens a dismissed attempt after remount or delivery", async () => {
  let complete!: (value: DailyBriefResponse) => void;
  const request = vi.fn(() => new Promise<DailyBriefResponse>((resolve) => { complete = resolve; }));
  const adapter = client("owner", request);
  await act(() => root.render(<DailyBriefLauncher client={adapter} />));
  await act(() => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss Daily Brief"]')!.click());
  await act(() => complete(ready("Dismissed advice", 120_000)));
  await act(() => root.render(null));
  await act(() => root.render(<DailyBriefLauncher client={adapter} />));
  expect(container.textContent).toBe("");
  expect(JSON.parse(localStorage.getItem(markerKey)!)).toMatchObject({ dismissed: true });
  expect(request).toHaveBeenCalledTimes(1);
});

it("makes the automatic start after a failed preference read recovers on focus", async () => {
  const adapter = client("owner");
  const settings = await adapter.preferences();
  const preferences = vi.fn<DailyBriefClient["preferences"]>().mockRejectedValueOnce(new DailyBriefRequestError("timeout")).mockResolvedValue(settings);
  const request = vi.fn(async () => ready("After recovery", 120_000));
  await act(() => root.render(<DailyBriefLauncher client={{ ...adapter, preferences, requestBrief: request }} />));
  expect(container.textContent).toBe("");
  await act(() => window.dispatchEvent(new Event("focus")));
  expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ retry: false }), expect.any(AbortSignal));
  expect(container.textContent).toContain("After recovery");
});

it("isolates remembered attempts by account", async () => {
  const request = vi.fn(async () => ready("First account advice", 120_000));
  const adapter = client("first", request);
  await act(() => root.render(<DailyBriefLauncher client={adapter} />));
  expect(container.textContent).toContain("First account advice");
  const switched = { ...adapter, preferences: async () => ({ ...(await adapter.preferences()), accountRef: "second" }), requestBrief: vi.fn(() => new Promise<DailyBriefResponse>(() => {})) };
  await act(() => root.render(<DailyBriefLauncher client={switched} sessionKey="second" />));
  expect(container.textContent).not.toContain("First account advice");
});

it("bounds a stalled web request and body decode even when a caller signal is supplied", async () => {
  const stalled = createWebDailyBriefClient(vi.fn<typeof fetch>(() => new Promise(() => {})));
  const request = stalled.requestBrief({ installationId: "synthetic", retry: false }, new AbortController().signal);
  const outcome = expect(request).rejects.toMatchObject({ code: "timeout" });
  await act(() => vi.advanceTimersByTime(75_000));
  await outcome;
  const stalledBody = createWebDailyBriefClient(vi.fn<typeof fetch>(async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response));
  const preferences = stalledBody.preferences(new AbortController().signal);
  const preferencesOutcome = expect(preferences).rejects.toMatchObject({ code: "timeout" });
  await act(() => vi.advanceTimersByTime(15_000));
  await preferencesOutcome;
  const caller = new AbortController();
  const cancelled = stalled.preferences(caller.signal);
  caller.abort();
  await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
});

it("bounds a stalled installation lock", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: () => new Promise(() => {}) } });
  try {
    const id = dailyBriefInstallationId(localStorage);
    const outcome = expect(id).rejects.toMatchObject({ code: "timeout" });
    await act(() => vi.advanceTimersByTime(5_000));
    await outcome;
  } finally {
    Reflect.deleteProperty(navigator, "locks");
  }
});

it("makes the next day's automatic start on a launcher left mounted overnight", async () => {
  const adapter = client("owner");
  const settings = await adapter.preferences();
  const preferences = vi.fn<DailyBriefClient["preferences"]>().mockResolvedValue(settings);
  const request = vi.fn(async () => ready("Today's advice", 120_000));
  await act(() => root.render(<DailyBriefLauncher client={{ ...adapter, preferences, requestBrief: request }} />));
  expect(request).toHaveBeenCalledTimes(1);
  preferences.mockResolvedValue({ ...settings, localDate: "2026-09-21" });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ retry: false }), expect.any(AbortSignal));
});

it("keeps another tab's newer claim when this tab's attempt settles", async () => {
  let complete!: (value: DailyBriefResponse) => void;
  const request = vi.fn(() => new Promise<DailyBriefResponse>((resolve) => { complete = resolve; }));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  const otherClaim = instant + 500_000;
  localStorage.setItem(markerKey, JSON.stringify({ attempted: true, delivered: false, dismissed: false, pendingUntil: otherClaim }));
  await act(() => complete({ state: "pending", retryAfterSeconds: 40 }));
  expect(JSON.parse(localStorage.getItem(markerKey)!).pendingUntil).toBe(otherClaim);
  expect(container.textContent).toContain("Try again in about 40 seconds");
  expect(buttonNamed("Try again")!.disabled).toBe(true);
});

it("cancels the previous account's in-flight attempt when the client changes", async () => {
  let firstSignal: AbortSignal | undefined;
  const first = client("first", (_input, signal) => { firstSignal = signal; return new Promise(() => {}); });
  await act(() => root.render(<DailyBriefLauncher client={first} sessionKey="first" />));
  expect(firstSignal?.aborted).toBe(false);
  await act(() => root.render(<DailyBriefLauncher client={client("second", () => new Promise(() => {}))} sessionKey="second" />));
  expect(firstSignal?.aborted).toBe(true);
});

it("cancels an in-flight attempt on sign-out", async () => {
  let signal: AbortSignal | undefined;
  await act(() => root.render(<DailyBriefLauncher client={client("owner", (_input, value) => { signal = value; return new Promise(() => {}); })} />));
  await act(() => root.render(<DailyBriefLauncher client={null} sessionKey="local" />));
  expect(signal?.aborted).toBe(true);
});
