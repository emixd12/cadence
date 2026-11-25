// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { fixtureBriefOpportunityClient } from "@/app/design-system/brief-opportunity-fixtures";
import { resetTravelViewCacheForTest, useTravelContext, type TravelClient, type TravelRoutesView } from "@/lib/ui/travel";
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
it("keeps a delivered brief past its preparation time (advisor Phase 3: no whole-brief expiry)", async () => {
  const request = vi.fn(async () => ready("Fresh advice"));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toContain("Fresh advice");
  await act(() => vi.advanceTimersByTime(60 * 60_000));
  expect(container.textContent).toContain("Fresh advice");
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
    expect(container.textContent).toBe("Today’s brief");
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

describe("advisor Phase 3: reopen, Refresh and move lines", () => {
  const moveClient = () => ({ answer: vi.fn(), replan: vi.fn(), length: vi.fn(), preference: vi.fn(), readPreference: vi.fn() });

  it("reopens today's brief after Close from memory, with no new request", async () => {
    const request = vi.fn(async () => ready("Morning brief"));
    await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
    await act(() => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss Daily Brief"]')!.click());
    expect(container.textContent).toBe("Today’s brief");
    await act(() => buttonNamed("Today’s brief")!.click());
    expect(container.textContent).toContain("Morning brief");
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(markerKey)!)).toMatchObject({ dismissed: false });
  });

  it("asks the server for the saved brief when reopening after a reload", async () => {
    localStorage.setItem(markerKey, JSON.stringify({ attempted: true, delivered: true, dismissed: true }));
    const request = vi.fn(async () => ready("Saved brief"));
    await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
    expect(container.textContent).toBe("Today’s brief");
    await act(() => buttonNamed("Today’s brief")!.click());
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ retry: false }), expect.any(AbortSignal));
    expect(container.textContent).toContain("Saved brief");
  });

  it("asks for move lines only when the client can answer them", async () => {
    const request = vi.fn(async () => ready("With moves"));
    await act(() => root.render(<DailyBriefLauncher client={{ ...client("owner", request), moves: moveClient() }} />));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ features: ["move_lines_v1"] }), expect.any(AbortSignal));
    await act(() => root.render(null));
    localStorage.clear();
    const plain = vi.fn<DailyBriefClient["requestBrief"]>(async () => ready("Without moves"));
    await act(() => root.render(<DailyBriefLauncher client={client("other", plain)} />));
    expect(plain.mock.calls[0]![0]).not.toHaveProperty("features");
  });

  it("asks for opportunity lines only when the client can answer them (Task 7)", async () => {
    const request = vi.fn(async () => ready("With opportunities"));
    await act(() => root.render(<DailyBriefLauncher client={{ ...client("owner", request), moves: moveClient(), opportunities: fixtureBriefOpportunityClient() }} />));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ features: ["move_lines_v1", "opportunity_lines_v1"] }), expect.any(AbortSignal));
  });

  it("refreshes in place and keeps the brief when a refresh is refused", async () => {
    const request = vi.fn<DailyBriefClient["requestBrief"]>()
      .mockResolvedValueOnce(ready("First brief"))
      .mockResolvedValueOnce(ready("Second brief"))
      .mockRejectedValueOnce(new DailyBriefRequestError("refresh_limit_reached"));
    await act(() => root.render(<DailyBriefLauncher client={{ ...client("owner", request), moves: moveClient() }} />));
    await act(async () => { buttonNamed("Refresh")!.click(); });
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true, retry: false }));
    expect(container.textContent).toContain("Second brief");
    await act(async () => { buttonNamed("Refresh")!.click(); });
    expect(container.textContent).toContain("Second brief");
    expect(container.textContent).toContain("used today’s refreshes");
  });

  it("keeps the refreshed brief when Timeline remounts", async () => {
    const request = vi.fn<DailyBriefClient["requestBrief"]>()
      .mockResolvedValueOnce(ready("First brief"))
      .mockResolvedValueOnce(ready("Second brief"));
    const adapter = { ...client("owner", request), moves: moveClient() };
    await act(() => root.render(<DailyBriefLauncher client={adapter} />));
    await act(async () => { buttonNamed("Refresh")!.click(); });
    expect(container.textContent).toContain("Second brief");
    await act(() => root.render(null));
    await act(() => root.render(<DailyBriefLauncher client={adapter} />));
    expect(container.textContent).toContain("Second brief");
    expect(container.textContent).not.toContain("First brief");
    expect(request).toHaveBeenCalledTimes(2);
  });
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
  expect(container.textContent).toBe("Today’s brief");
  expect(request).not.toHaveBeenCalled();
});

it("hides a parallel tab's pending notice when the other tab delivers", async () => {
  const request = vi.fn(async (): Promise<DailyBriefResponse> => ({ state: "pending" }));
  await act(() => root.render(<DailyBriefLauncher client={client("owner", request)} />));
  expect(container.textContent).toContain("still being prepared");
  localStorage.setItem(markerKey, JSON.stringify({ attempted: true, delivered: true, dismissed: false }));
  await act(() => window.dispatchEvent(new StorageEvent("storage", { key: markerKey })));
  expect(container.textContent).toBe("Today’s brief");
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


it("does not signal Timeline REST travel when a brief is ready (Path 3 closure)", async () => {
  const listener = vi.fn();
  window.addEventListener("cadence:brief-travel", listener);
  try {
    await act(() => root.render(<DailyBriefLauncher client={client("travel-owner")} travelAccountId="travel-owner" />));
    expect(listener).not.toHaveBeenCalled();
    await act(() => window.dispatchEvent(new Event("focus")));
    expect(listener).not.toHaveBeenCalled();
  } finally { window.removeEventListener("cadence:brief-travel", listener); }
});
it("drops pending output when a connected source is excluded in Settings (Tickets 239 and 306)", async () => {
  const { DailyBriefSettingsPanel } = await import("@/components/briefing/DailyBriefSettingsPanel");
  let complete!: (value: DailyBriefResponse) => void;
  const none = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
  const settings = { accountRef: "owner", available: true, enabled: true, includeCalendar: false, revision: 1, localDate: "2026-09-20", timezone: "America/New_York",
    useConnectedSources: true, excludedSources: none,
    sourceStatus: { googleCalendar: "not_connected", outlookCalendar: "not_connected", icloudCalendar: "not_connected", hevy: "ready" } as const };
  const updatePreferences = vi.fn(async (input: object) => ({ ...settings, ...input, revision: 2 }));
  const adapter: DailyBriefClient = { preferences: async () => settings, updatePreferences,
    requestBrief: () => new Promise((resolve) => { complete = resolve; }) };
  await act(() => root.render(<><DailyBriefLauncher client={adapter} /><DailyBriefSettingsPanel client={adapter} /></>));
  const hevy = container.querySelector<HTMLInputElement>('input[aria-describedby="daily-brief-hevy-disclosure"]')!;
  expect(hevy.checked).toBe(true);
  await act(() => hevy.click());
  expect(updatePreferences).toHaveBeenCalledWith({ enabled: true, useConnectedSources: true, excludedSources: { ...none, hevy: true },
    includeReminderHistory: false, includeNotes: false });
  await act(async () => { await Promise.resolve(); });
  await act(() => complete(ready("Advice prepared with workout timing")));
  expect(container.textContent).not.toContain("Advice prepared with workout timing");
});

describe("Ticket 272: the first brief waits up to 5 seconds for its travel conclusions", () => {
  const travelSettings = { enabled: true, mode: "walking" as const, baseLocationText: null, navigationPreference: "google_maps" as const,
    routingConsentAt: "2026-09-20T11:00:00Z", onboardingCompletedAt: null, updatedAt: "revision" };
  const travelView = (): TravelRoutesView => ({ accountId: "owner", mode: "walking", navigationPreference: "google_maps", settingsRevision: "revision",
    expiresAt: new Date(Date.now() + 300_000).toISOString(), conclusionsToken: "signed.token",
    evidence: { version: "1.0", journeyRef: "owner", legs: [], segments: [], occupiedSpans: [], collisions: [], completeTrip: false, finalAvailabilityAt: null } });
  function travelClient(routes: TravelClient["routes"], enabled = true): TravelClient {
    const loaded = { ...travelSettings, enabled };
    return { settings: { load: async () => loaded, save: async () => loaded }, configured: async () => true,
      readLocation: async () => ({ state: "denied" as const }), routes };
  }
  function TravelTimeline({ client: travel }: Readonly<{ client: TravelClient }>) {
    useTravelContext({ enabled: true, accountId: "owner", sourceKey: "source", localDate: "2026-09-20", client: travel, timezone: "America/New_York" });
    return null;
  }
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  beforeEach(() => {
    resetTravelViewCacheForTest();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("does not wait for Timeline REST travel or attach REST travelConclusions (Path 3 closure)", async () => {
    let answer!: (value: TravelRoutesView) => void;
    const routes = vi.fn<TravelClient["routes"]>(() => new Promise((resolve) => { answer = resolve; }));
    const requestBrief = vi.fn<DailyBriefClient["requestBrief"]>(async () => ready("Brief without REST travel", 3_600_000));
    await act(() => root.render(<><TravelTimeline client={travelClient(routes)} /><DailyBriefLauncher client={client("owner", requestBrief)} travelAccountId="owner" /></>));
    await flush();
    expect(requestBrief).toHaveBeenCalledOnce();
    const sent = requestBrief.mock.calls[0]![0];
    expect(sent).not.toHaveProperty("travelConclusions");
    expect(container.textContent).toContain("Brief without REST travel");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(routes).toHaveBeenCalledOnce();
    await act(async () => { answer(travelView()); await vi.advanceTimersByTimeAsync(0); });
    expect(routes).toHaveBeenCalledOnce();
  });

  it("sends the brief immediately without waiting when Timeline REST travel is pending (Path 3 closure)", async () => {
    const routes = vi.fn<TravelClient["routes"]>(() => new Promise(() => {}));
    const requestBrief = vi.fn<DailyBriefClient["requestBrief"]>(async () => ready("Brief on time", 3_600_000));
    await act(() => root.render(<><TravelTimeline client={travelClient(routes)} /><DailyBriefLauncher client={client("owner", requestBrief)} travelAccountId="owner" /></>));
    await flush();
    expect(requestBrief).toHaveBeenCalledOnce();
    expect(requestBrief.mock.calls[0]![0]).not.toHaveProperty("travelConclusions");
  });

  it("does not wait when travel is known to be off", async () => {
    const routes = vi.fn<TravelClient["routes"]>(async () => travelView());
    const travel = travelClient(routes, false);
    await act(() => root.render(<TravelTimeline client={travel} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    const requestBrief = vi.fn<DailyBriefClient["requestBrief"]>(async () => ready("Brief without travel", 3_600_000));
    await act(() => root.render(<><TravelTimeline client={travel} /><DailyBriefLauncher client={client("owner", requestBrief)} travelAccountId="owner" /></>));
    await flush();
    expect(requestBrief).toHaveBeenCalledOnce();
    expect(requestBrief.mock.calls[0]![0]).not.toHaveProperty("travelConclusions");
    expect(routes).not.toHaveBeenCalled();
  });

  it("stops waiting as soon as the request finds travel off", async () => {
    const routes = vi.fn<TravelClient["routes"]>(async () => travelView());
    const requestBrief = vi.fn<DailyBriefClient["requestBrief"]>(async () => ready("Brief without travel", 3_600_000));
    await act(() => root.render(<><TravelTimeline client={travelClient(routes, false)} /><DailyBriefLauncher client={client("owner", requestBrief)} travelAccountId="owner" /></>));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(requestBrief).toHaveBeenCalledOnce();
    expect(routes).not.toHaveBeenCalled();
  });

  it("does not wait without a Timeline travel view or a travel account", async () => {
    const requestBrief = vi.fn<DailyBriefClient["requestBrief"]>(async () => ready("Brief without travel", 3_600_000));
    await act(() => root.render(<DailyBriefLauncher client={client("owner", requestBrief)} travelAccountId="owner" />));
    await flush();
    expect(requestBrief).toHaveBeenCalledOnce();
  });
});
