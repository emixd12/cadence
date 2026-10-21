import { describe, expect, it, vi } from "vitest";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";
import { DesktopCalendarCoordinator, shouldRefresh } from "../apps/desktop/src/calendar/coordinator";
import { assertSnapshotMatches, type CalendarCacheRequest, DesktopCalendarCache } from "../apps/desktop/src/calendar/cache";
import { DesktopCalendarBroker, DesktopCalendarConnection, isDesktopCalendarCallback, parseDesktopCalendarCallback, readDesktopCalendarBrokerOrigin } from "../apps/desktop/src/calendar/google-calendar";
import { clearDesktopCalendarClientState, isDesktopAuthCallback } from "../apps/desktop/src/account/auth";

const request: CalendarCacheRequest = { accountId: "account-a", connectionGeneration: 2, selectionRevision: 4,
  startLocalDate: "2026-09-16", endLocalDate: "2026-09-18", timezone: "America/New_York", selectedCalendarIds: ["primary"],
  hiddenCalendarIds: [], visible: true, showAllDay: true };

function snapshot(overrides: Partial<ExternalEventSnapshotV1> = {}): ExternalEventSnapshotV1 {
  const capability = { support: "supported", permission: "granted", availability: "available" } as const;
  return { schemaVersion: "1.0.0", adapterVersion: "google-calendar-v1", accountId: request.accountId,
    connectionGeneration: request.connectionGeneration, source: "google_calendar", requestedRange: {
      startLocalDate: request.startLocalDate, endLocalDate: request.endLocalDate, timezone: request.timezone,
      selectedCalendarIds: request.selectedCalendarIds,
    }, fetchedAt: "2026-09-16T12:00:00Z", completeness: "complete",
    freshness: { state: "current", refreshedAt: "2026-09-16T12:00:00Z", label: "Updated now", canAssertNoOverlap: true },
    capabilities: { calendar_listing: capability, timed_events: capability, all_day_events: capability,
      recurrence: capability, details: capability, source_links: capability },
    coverage: [{ calendarId: "primary", startLocalDate: request.startLocalDate, endLocalDate: request.endLocalDate,
      paginationComplete: true, itemCount: 0 }], failures: [], events: [], tombstones: [], ...overrides };
}

function fakeCache(current: ExternalEventSnapshotV1 | null) {
  return { read: vi.fn(async () => current), begin: vi.fn(async () => undefined), replace: vi.fn(async (_request, _id, value) => value as ExternalEventSnapshotV1), clear: vi.fn(async () => undefined) };
}

describe("desktop Calendar coordinator", () => {
  it("coalesces matching refreshes and atomically stores only the complete result", async () => {
    let release!: (value: ExternalEventSnapshotV1) => void;
    const events = vi.fn(() => new Promise<ExternalEventSnapshotV1>((resolve) => { release = resolve; }));
    const cache = fakeCache(null);
    const coordinator = new DesktopCalendarCoordinator({ events }, cache);
    const first = coordinator.refresh(request, "manual", Date.parse("2026-09-16T12:20:00Z"));
    const second = coordinator.refresh(request, "visible", Date.parse("2026-09-16T12:20:00Z"));
    await vi.waitFor(() => expect(events).toHaveBeenCalledOnce());
    release(snapshot());
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ source: "network", stale: false }), expect.objectContaining({ source: "network", stale: false }),
    ]);
    expect(cache.begin).toHaveBeenCalledOnce();
    expect(cache.replace).toHaveBeenCalledOnce();
  });

  it("returns a stale complete cache when offline or when a late native write is fenced", async () => {
    const cached = snapshot();
    const cache = fakeCache(cached);
    cache.replace.mockRejectedValueOnce(new Error("Calendar refresh was cleared or superseded."));
    const online = new DesktopCalendarCoordinator({ events: vi.fn(async () => snapshot()) }, cache);
    await expect(online.refresh(request, "manual")).resolves.toEqual(expect.objectContaining({ snapshot: cached, source: "cache", stale: true }));
    const offline = new DesktopCalendarCoordinator({ events: vi.fn(async () => { throw new Error("offline"); }) }, cache);
    await expect(offline.refresh(request, "manual")).resolves.toEqual(expect.objectContaining({ snapshot: cached, source: "cache", stale: true, refreshError: "offline" }));
  });

  it("does not return a captured snapshot after account cleanup fences the refresh", async () => {
    let release!: (value: ExternalEventSnapshotV1) => void;
    const cache = fakeCache(snapshot());
    const coordinator = new DesktopCalendarCoordinator({ events: () => new Promise((resolve) => { release = resolve; }) }, cache);
    const pending = coordinator.refresh(request, "manual");
    await vi.waitFor(() => expect(cache.begin).toHaveBeenCalledOnce());
    await coordinator.clear();
    release(snapshot());
    await expect(pending).resolves.toEqual({ snapshot: null, source: "none", stale: true, refreshError: "cleared" });
  });

  it("does not replace a complete cache with an incomplete response", async () => {
    const cached = snapshot();
    const incomplete = snapshot({ completeness: "incomplete", freshness: { state: "incomplete", refreshedAt: "2026-09-16T12:10:00Z", label: "Incomplete", canAssertNoOverlap: false },
      coverage: [{ calendarId: "primary", startLocalDate: request.startLocalDate, endLocalDate: request.endLocalDate, paginationComplete: false, itemCount: 0 }],
      failures: [{ code: "incomplete_pagination", calendarId: "primary", retryable: true, retryAfterSeconds: null, message: "Incomplete" }] });
    const cache = fakeCache(cached);
    const coordinator = new DesktopCalendarCoordinator({ events: vi.fn(async () => incomplete) }, cache);
    await expect(coordinator.refresh(request, "manual")).resolves.toEqual(expect.objectContaining({ snapshot: cached, stale: true, refreshError: "incomplete_pagination" }));
    expect(cache.replace).not.toHaveBeenCalled();
  });

  it("uses a fifteen-minute policy and rejects account, range, or selection reuse", () => {
    const current = snapshot();
    expect(shouldRefresh(current, "visible", Date.parse("2026-09-16T12:14:59Z"))).toBe(false);
    expect(shouldRefresh(current, "resume", Date.parse("2026-09-16T12:15:00Z"))).toBe(true);
    expect(shouldRefresh(current, "manual", Date.parse("2026-09-16T12:01:00Z"))).toBe(true);
    expect(() => assertSnapshotMatches(current, { ...request, accountId: "account-b" })).toThrow("account");
    expect(() => assertSnapshotMatches(current, { ...request, endLocalDate: "2026-09-19" })).toThrow("range");
  });
});

describe("desktop Calendar transport", () => {
  it("revalidates the native offline bootstrap before returning its cache request", async () => {
    const call = async <T,>() => ({ request, snapshotJson: JSON.stringify(snapshot()) } as T);
    const cache = new DesktopCalendarCache(call);
    await expect(cache.readCurrent({ accountId: request.accountId, startLocalDate: request.startLocalDate,
      endLocalDate: request.endLocalDate, timezone: request.timezone })).resolves.toEqual({ request, snapshot: snapshot() });
  });
  it("is disabled without a strict HTTPS origin and sends only the current Supabase bearer token", async () => {
    expect(readDesktopCalendarBrokerOrigin(undefined)).toBeNull();
    expect(readDesktopCalendarBrokerOrigin("http://calendar.example")).toBeNull();
    expect(readDesktopCalendarBrokerOrigin("https://calendar.example/")).toBe("https://calendar.example");
    const fetcher = vi.fn(async function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return new Response(JSON.stringify({ status: "connected" }), { status: 200 });
    });
    const broker = new DesktopCalendarBroker("https://calendar.example", async () => "supabase-access", fetcher as typeof fetch);
    await broker.connection();
    expect(fetcher).toHaveBeenCalledWith("https://calendar.example/api/google-calendar/connection", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer supabase-access" }),
    }));
  });

  it("keeps Calendar and account callbacks isolated and validates one-time Calendar state", () => {
    const calendar = "cadence://calendar/callback?state=opaque&result=connected";
    expect(isDesktopCalendarCallback(calendar)).toBe(true);
    expect(isDesktopAuthCallback(calendar)).toBe(false);
    expect(parseDesktopCalendarCallback(calendar, { accountId: "account-a", state: "opaque", createdAt: 1_000 }, "account-a", 2_000)).toBe("connected");
    expect(parseDesktopCalendarCallback(calendar.replace("result=connected", "result=same_account_required"), { accountId: "account-a", state: "opaque", createdAt: 1_000 }, "account-a", 2_000)).toBe("same_account_required");
    expect(() => parseDesktopCalendarCallback(calendar, { accountId: "account-b", state: "opaque", createdAt: 1_000 }, "account-a", 2_000)).toThrow("invalid");
    expect(() => parseDesktopCalendarCallback(calendar, { accountId: "account-a", state: "different", createdAt: 1_000 }, "account-a", 2_000)).toThrow("invalid");
    expect(() => parseDesktopCalendarCallback(calendar, { accountId: "account-a", state: "opaque", createdAt: 1_000 }, "account-a", 301_001)).toThrow("invalid");
    expect(() => parseDesktopCalendarCallback(calendar, { accountId: "account-a", state: "opaque", createdAt: 1_000 }, "account-a", 999)).toThrow("invalid");
  });

  it("clears pending Calendar state and the native cache during account cleanup", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    await clearDesktopCalendarClientState(async (command, args) => { calls.push([command, args]); });
    expect(calls).toEqual(expect.arrayContaining([
      ["auth_secret_remove", { name: "pending-calendar-state" }],
      ["calendar_cache_clear", undefined],
    ]));
  });

  it.each([
    [{ accountId: "account-a", state: "opaque" }, "state=opaque&result=connected"],
    [{ accountId: "account-a", state: null, createdAt: 1_000 }, "result=connected"],
  ])("rejects malformed persisted Calendar state before reading the broker", async (pending, query) => {
    const broker = { connection: vi.fn() };
    const io = { get: vi.fn(async () => JSON.stringify(pending)), set: vi.fn(), remove: vi.fn(async () => undefined), open: vi.fn() };
    const flow = new DesktopCalendarConnection(broker as unknown as DesktopCalendarBroker, io);
    await expect(flow.complete(`cadence://calendar/callback?${query}`, "account-a", 2_000)).rejects.toThrow("invalid");
    expect(io.remove).toHaveBeenCalledWith("pending-calendar-state");
    expect(broker.connection).not.toHaveBeenCalled();
  });

  it("preserves pending state across restart and rejects replay, cancellation, and browser failure", async () => {
    const secrets = new Map<string, string>();
    const connection = { accountId: "account-a", status: "connected", generation: 2, selectionRevision: 4,
      preferences: { selectedCalendarIds: ["primary"], hiddenCalendarIds: [], visible: true, showAllDay: true } } as const;
    const broker = { connect: vi.fn(async (state: string) => ({ url: `https://accounts.example/connect?state=${state}` })), connection: vi.fn(async () => connection) };
    const io = { get: vi.fn(async (name: string) => secrets.get(name) ?? null), set: vi.fn(async (name: string, value: string) => { secrets.set(name, value); }),
      remove: vi.fn(async (name: string) => { secrets.delete(name); }), open: vi.fn(async () => undefined) };
    const flow = new DesktopCalendarConnection(broker as unknown as DesktopCalendarBroker, io);
    await flow.begin("account-a");
    const pending = JSON.parse(secrets.get("pending-calendar-state") ?? "null") as { state: string; createdAt: number };
    expect(pending.state).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(io.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\//));
    const callback = `cadence://calendar/callback?state=${pending.state}&result=connected`;
    const restarted = new DesktopCalendarConnection(broker as unknown as DesktopCalendarBroker, io);
    await expect(restarted.complete(callback, "account-a", pending.createdAt + 1_000))
      .resolves.toEqual({ result: "connected", connection });
    expect(secrets.has("pending-calendar-state")).toBe(false);
    await expect(restarted.complete(callback, "account-a")).rejects.toThrow("already used or cancelled");
    await flow.begin("account-a");
    await flow.cancel();
    await expect(restarted.complete(callback, "account-a")).rejects.toThrow("already used or cancelled");
    io.open.mockRejectedValueOnce(new Error("browser unavailable"));
    await expect(flow.begin("account-a")).rejects.toThrow("browser unavailable");
    expect(secrets.has("pending-calendar-state")).toBe(false);
    expect(broker.connection).toHaveBeenCalledOnce();
  });
});
