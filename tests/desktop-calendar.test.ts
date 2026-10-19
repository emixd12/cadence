import { describe, expect, it, vi } from "vitest";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";
import { DesktopCalendarCoordinator, shouldRefresh } from "../apps/desktop/src/calendar/coordinator";
import { assertSnapshotMatches, type CalendarCacheRequest, DesktopCalendarCache } from "../apps/desktop/src/calendar/cache";
import { DesktopCalendarBroker, DesktopCalendarConnection, isDesktopCalendarCallback, parseDesktopCalendarCallback, readDesktopCalendarBrokerOrigin } from "../apps/desktop/src/calendar/google-calendar";
import { clearDesktopCalendarClientState, isDesktopAuthCallback } from "../apps/desktop/src/account/auth";
import { Temporal } from "@js-temporal/polyfill";
import { validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import type { RecordedActivitySnapshotV1 } from "@cadence/core/types/recorded-activity";
import type { ConnectorProvider } from "@/lib/types/connectors";
import { DesktopConnectorCache, type ConnectorCacheOperations } from "../apps/desktop/src/calendar/connector-cache";
import { DesktopConnectorSnapshots, shouldRefreshConnector } from "../apps/desktop/src/calendar/connector-coordinator";
import { DesktopConnectorBroker } from "../apps/desktop/src/calendar/connector-broker";
import { hevyScopeKey, hevySourceRules } from "../apps/desktop/src/calendar/hevy";
import { DesktopOutlookConnection, isDesktopOutlookCallback, OUTLOOK_ATTEMPT_KEY, outlookAuthorizationState, outlookScopeKey,
  outlookSourceRules } from "../apps/desktop/src/calendar/outlook-calendar";
import { desktopTimelineFreshness } from "../apps/desktop/src/calendar/timeline-freshness";
import outlookFixture from "./fixtures/external-event-snapshot.outlook.valid.json";
import hevyFixture from "./fixtures/recorded-activity-snapshot.valid.json";

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

// Ticket 225 desktop connector sources.
const hevyBase = validateRecordedActivitySnapshot(hevyFixture, { now: Temporal.Instant.from("2026-11-01T15:00:00Z") });
function hevyToday(overrides: Partial<RecordedActivitySnapshotV1> = {}): RecordedActivitySnapshotV1 {
  return { ...hevyBase, requestedRange: { startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", timezone: "America/New_York" },
    activities: hevyBase.activities.filter((activity) => activity.localStartDate === "2026-11-01"), ...overrides };
}
const hevyView = { accountId: "account-1", provider: "hevy" as const, status: "connected" as const, generation: 1, selectionRevision: 0,
  preferences: { selectedSourceIds: [], hiddenSourceIds: [], visible: true, showAllDay: true } };
const outlookView = { ...hevyView, provider: "outlook_calendar" as const, generation: 2, preferences: { ...hevyView.preferences, selectedSourceIds: ["calendar-1"] } };
const outlookRange = { startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York" };

function memoryCache() {
  const rows = new Map<ConnectorProvider, { accountId: string; scopeKey: string; json: string }>();
  const pending = new Map<ConnectorProvider, string>();
  const cache: ConnectorCacheOperations & { cleared: (ConnectorProvider | undefined)[] } = {
    cleared: [],
    read: vi.fn(async (provider, accountId, scopeKey) => { const row = rows.get(provider); return row && row.accountId === accountId && row.scopeKey === scopeKey ? row.json : null; }),
    readCurrent: vi.fn(async (provider, accountId) => { const row = rows.get(provider); return row && row.accountId === accountId ? { scopeKey: row.scopeKey, snapshotJson: row.json } : null; }),
    begin: vi.fn(async (provider, _accountId, _scopeKey, requestId) => { pending.set(provider, requestId); }),
    replace: vi.fn(async (provider, accountId, scopeKey, requestId, json) => {
      if (pending.get(provider) !== requestId) throw new Error("Connector refresh was cleared or superseded.");
      rows.set(provider, { accountId, scopeKey, json });
    }),
    clear: vi.fn(async (provider) => { cache.cleared.push(provider); for (const value of provider ? [provider] : [...rows.keys()]) { rows.delete(value); pending.delete(value); } }),
  };
  return { cache, rows };
}

describe("desktop connector caches", () => {
  const now = Date.parse("2026-11-01T15:05:00Z");
  it("stores only complete, same-scope Hevy reads and keeps them through an incomplete refresh", async () => {
    const { cache, rows } = memoryCache();
    const snapshots = new DesktopConnectorSnapshots(hevySourceRules(() => Temporal.Instant.from("2026-11-01T15:05:00Z")), cache);
    const key = hevyScopeKey(hevyView, "2026-11-01", "America/New_York");
    await expect(snapshots.refresh("account-1", key, async () => hevyToday(), "manual", now)).resolves.toMatchObject({ source: "network", refreshError: null });
    expect(JSON.parse(rows.get("hevy")!.json).activities).toHaveLength(1);
    const incomplete = hevyToday({ completeness: "incomplete", activities: [], fetchedAt: "2026-11-01T15:04:00Z",
      failures: [{ code: "incomplete_pagination", retryable: false, retryAfterSeconds: null, message: "Over 500" }] });
    const kept = await snapshots.refresh("account-1", key, async () => incomplete, "manual", now);
    expect(kept).toMatchObject({ source: "cache", stale: true, refreshError: "incomplete_pagination" });
    expect(kept.snapshot?.activities).toHaveLength(1);
    expect(cache.replace).toHaveBeenCalledTimes(1);
  });

  it("rejects a response for another account, generation, range, or source", async () => {
    const { cache, rows } = memoryCache();
    const snapshots = new DesktopConnectorSnapshots(hevySourceRules(() => Temporal.Instant.from("2026-11-01T15:05:00Z")), cache);
    const key = hevyScopeKey(hevyView, "2026-11-01", "America/New_York");
    for (const wrong of [hevyToday({ accountId: "account-2" }), hevyToday({ connectionGeneration: 3 }),
      hevyToday({ requestedRange: { startLocalDate: "2026-10-31", endLocalDate: "2026-11-01", timezone: "America/New_York" } }),
      outlookFixture as unknown as RecordedActivitySnapshotV1]) {
      const result = await snapshots.refresh("account-1", key, async () => wrong, "manual", now);
      expect(result.snapshot).toBeNull();
      expect(result.refreshError).toMatch(/connection_changed|malformed_provider_response/);
    }
    expect(rows.size).toBe(0);
  });

  it("fences a late response after disconnect, sign-out, or account switch", async () => {
    const { cache, rows } = memoryCache();
    const snapshots = new DesktopConnectorSnapshots(hevySourceRules(() => Temporal.Instant.from("2026-11-01T15:05:00Z")), cache);
    let release!: (value: unknown) => void;
    const pending = snapshots.refresh("account-1", hevyScopeKey(hevyView, "2026-11-01", "America/New_York"),
      () => new Promise((resolve) => { release = resolve; }), "manual", now);
    await vi.waitFor(() => expect(cache.begin).toHaveBeenCalledOnce());
    await snapshots.clear();
    release(hevyToday());
    await expect(pending).resolves.toEqual({ snapshot: null, source: "none", stale: true, refreshError: "cleared" });
    expect(rows.size).toBe(0);
    expect(cache.replace).not.toHaveBeenCalled();
  });

  it("clears one source without touching the other and validates Outlook scope keys", async () => {
    const { cache, rows } = memoryCache();
    const hevy = new DesktopConnectorSnapshots(hevySourceRules(() => Temporal.Instant.from("2026-11-01T15:05:00Z")), cache);
    const outlook = new DesktopConnectorSnapshots<ExternalEventSnapshotV1_1>(outlookSourceRules(), cache);
    await hevy.refresh("account-1", hevyScopeKey(hevyView, "2026-11-01", "America/New_York"), async () => hevyToday(), "manual", now);
    const outlookKey = outlookScopeKey(outlookView, outlookRange);
    await expect(outlook.refresh("account-1", outlookKey, async () => outlookFixture, "manual", now)).resolves.toMatchObject({ source: "network" });
    await outlook.clear();
    expect(cache.cleared).toEqual(["outlook_calendar"]);
    expect(rows.has("hevy")).toBe(true);
    expect(rows.has("outlook_calendar")).toBe(false);
    // A selection change produces a different scope; the old snapshot cannot satisfy it.
    const otherSelection = outlookScopeKey({ ...outlookView, preferences: { ...outlookView.preferences, selectedSourceIds: ["calendar-2"] } }, outlookRange);
    await expect(outlook.refresh("account-1", otherSelection, async () => outlookFixture, "manual", now)).resolves.toMatchObject({ snapshot: null });
    // Offline bootstrap honors only an accepted scope and revalidates the stored snapshot.
    await expect(hevy.readCurrent("account-1", () => false)).resolves.toBeNull();
    await expect(hevy.readCurrent("account-1", () => true)).resolves.toMatchObject({ source: "hevy" });
    await expect(hevy.readCurrent("account-2", () => true)).resolves.toBeNull();
  });

  it("uses the fifteen-minute policy and always refreshes incomplete snapshots", () => {
    expect(shouldRefreshConnector(hevyToday(), "visible", Date.parse("2026-11-01T15:14:59Z"))).toBe(false);
    expect(shouldRefreshConnector(hevyToday(), "visible", Date.parse("2026-11-01T15:15:00Z"))).toBe(true);
    expect(shouldRefreshConnector(hevyToday({ completeness: "incomplete" }), "visible", Date.parse("2026-11-01T15:01:00Z"))).toBe(true);
    expect(shouldRefreshConnector(hevyToday(), "manual", Date.parse("2026-11-01T15:01:00Z"))).toBe(true);
  });

  it("passes the source to every native cache command and never sends credentials", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const native = new DesktopConnectorCache(async <T,>(command: string, args?: Record<string, unknown>) => { calls.push([command, args]); return null as T; });
    await native.begin("hevy", "account-1", "[]", "r1");
    await native.clear("hevy");
    await native.clear();
    expect(calls).toEqual([
      ["connector_cache_begin", { provider: "hevy", accountId: "account-1", scopeKey: "[]", requestId: "r1" }],
      ["connector_cache_clear", { provider: "hevy" }],
      ["connector_cache_clear", { provider: null }],
    ]);
  });

  it("clears connector caches and the pending Outlook attempt during account cleanup", async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    await clearDesktopCalendarClientState(async (command, args) => { calls.push([command, args]); });
    expect(calls).toEqual(expect.arrayContaining([
      ["auth_secret_remove", { name: OUTLOOK_ATTEMPT_KEY }],
      ["connector_cache_clear", { provider: null }],
    ]));
  });
});

describe("desktop Outlook deep link", () => {
  const authorize = (state: string) => `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&state=${state}`;
  const desktopState = `d${"A".repeat(43)}`;
  function harness() {
    const secrets = new Map<string, string>();
    const broker = {
      outlookStart: vi.fn<(clientState: string) => Promise<{ url: string }>>(async () => ({ url: authorize(desktopState) })),
      outlookComplete: vi.fn<(body: unknown) => Promise<typeof outlookView & { result: string }>>(async () => ({ ...outlookView, result: "connected" })),
    };
    const io = { get: vi.fn(async (name: string) => secrets.get(name) ?? null), set: vi.fn(async (name: string, value: string) => { secrets.set(name, value); }),
      remove: vi.fn(async (name: string) => { secrets.delete(name); }), open: vi.fn(async () => undefined) };
    return { secrets, broker, io, flow: new DesktopOutlookConnection(broker, io) };
  }

  it("stores a Keychain attempt with the server state and a fresh client state", async () => {
    const { secrets, broker, flow, io } = harness();
    await flow.begin("account-1", 1_000);
    const clientState = broker.outlookStart.mock.calls[0]![0];
    expect(clientState).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(JSON.parse(secrets.get(OUTLOOK_ATTEMPT_KEY)!)).toEqual({ accountId: "account-1", state: desktopState, clientState, createdAt: 1_000 });
    expect(io.open).toHaveBeenCalledWith(authorize(desktopState));
  });

  it("ignores links it did not start and keeps the pending attempt", async () => {
    const { secrets, broker, flow } = harness();
    await flow.begin("account-1", 1_000);
    await expect(flow.complete(`cadence://outlook-calendar/callback?state=d${"B".repeat(43)}&code=attacker`, "account-1", 2_000)).resolves.toBe("ignored");
    await expect(flow.complete("cadence://outlook-calendar/callback?code=attacker", "account-1", 2_000)).resolves.toBe("ignored");
    await expect(flow.complete("cadence://calendar/callback?state=x&result=connected", "account-1", 2_000)).resolves.toBeNull();
    expect(broker.outlookComplete).not.toHaveBeenCalled();
    expect(secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(true);
    expect(isDesktopOutlookCallback("cadence://outlook-calendar/callback?state=x")).toBe(true);
    expect(isDesktopOutlookCallback("cadence://outlook-calendar/callback/extra")).toBe(false);
  });

  it("completes once through the authenticated PUT with the Keychain client state", async () => {
    const { secrets, broker, flow } = harness();
    await flow.begin("account-1", 1_000);
    const clientState = broker.outlookStart.mock.calls[0]![0];
    const link = `cadence://outlook-calendar/callback?state=${desktopState}&code=auth-code`;
    await expect(flow.complete(link, "account-1", 2_000)).resolves.toBe("connected");
    expect(broker.outlookComplete).toHaveBeenCalledWith({ state: desktopState, clientState, code: "auth-code" });
    expect(secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(false);
    await expect(flow.complete(link, "account-1", 2_100)).resolves.toBe("ignored");
    expect(broker.outlookComplete).toHaveBeenCalledOnce();
  });

  it("clears the attempt on expiry, account change, cancellation, and browser failure", async () => {
    const expired = harness();
    await expired.flow.begin("account-1", 1_000);
    await expect(expired.flow.complete(`cadence://outlook-calendar/callback?state=${desktopState}&code=c`, "account-1", 1_000 + 5 * 60_000 + 1)).resolves.toBe("expired_attempt");
    expect(expired.secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(false);
    const switched = harness();
    await switched.flow.begin("account-1", 1_000);
    await expect(switched.flow.complete(`cadence://outlook-calendar/callback?state=${desktopState}&code=c`, "account-2", 2_000)).resolves.toBe("expired_attempt");
    expect(switched.broker.outlookComplete).not.toHaveBeenCalled();
    const cancelled = harness();
    cancelled.broker.outlookComplete.mockResolvedValueOnce({ ...outlookView, result: "cancelled" });
    await cancelled.flow.begin("account-1", 1_000);
    await expect(cancelled.flow.complete(`cadence://outlook-calendar/callback?state=${desktopState}&result=cancelled`, "account-1", 2_000)).resolves.toBe("cancelled");
    expect(cancelled.broker.outlookComplete).toHaveBeenCalledWith(expect.objectContaining({ result: "cancelled" }));
    const odd = harness();
    odd.broker.outlookComplete.mockResolvedValueOnce({ ...outlookView, result: "error" });
    await odd.flow.begin("account-1", 1_000);
    await odd.flow.complete(`cadence://outlook-calendar/callback?state=${desktopState}&result=consent_denied`, "account-1", 2_000);
    expect(odd.broker.outlookComplete).toHaveBeenCalledWith(expect.objectContaining({ result: "error" }));
    const browser = harness();
    browser.io.open.mockRejectedValueOnce(new Error("browser unavailable"));
    await expect(browser.flow.begin("account-1")).rejects.toThrow("browser unavailable");
    expect(browser.secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(false);
    const manual = harness();
    await manual.flow.begin("account-1");
    await manual.flow.cancel();
    expect(manual.secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(false);
  });

  it("refuses an authorization URL that is not Microsoft's and stores nothing", async () => {
    const { secrets, broker, flow } = harness();
    broker.outlookStart.mockResolvedValueOnce({ url: `https://login.example.com/authorize?state=${desktopState}` });
    await expect(flow.begin("account-1")).rejects.toMatchObject({ code: "invalid_request" });
    expect(secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(false);
    expect(() => outlookAuthorizationState("https://login.microsoftonline.com/authorize?state=short")).toThrow();
  });

  it("routes connector requests through the bearer broker transport", async () => {
    const request = vi.fn(async () => ({ ...hevyView, revocation: "hevy_api_key" }));
    const broker = new DesktopConnectorBroker({ request } as never);
    await broker.hevyConnect("key-once");
    expect(request).toHaveBeenCalledWith("/api/hevy/connection", { method: "POST", body: JSON.stringify({ apiKey: "key-once" }) });
    await expect(broker.hevyDisconnect()).resolves.toEqual({ view: hevyView, revocation: "hevy_api_key" });
    await broker.outlookComplete({ state: desktopState, clientState: "c".repeat(43), code: "x" });
    expect(request).toHaveBeenLastCalledWith("/api/outlook-calendar/connection", expect.objectContaining({ method: "PUT" }));
  });
});

describe("desktop Timeline freshness (Ticket 225 review)", () => {
  const outlookReady = { state: "ready" as const, snapshot: outlookFixture as unknown as ExternalEventSnapshotV1_1, error: null, hiddenCalendarIds: [], showAllDay: true };
  const notLoaded = { state: "not_loaded" as const, snapshot: null, error: null, hiddenCalendarIds: [], showAllDay: true };

  it("keeps Outlook-only context able to assert no timed overlap and hides the unused Google line", () => {
    const result = desktopTimelineFreshness({ snapshot: null, stale: true, label: "Google Calendar is not connected." }, outlookReady);
    expect(result.freshness).toMatchObject({ state: "current", canAssertNoOverlap: true });
    expect(result.freshness.label).not.toContain("Google");
    expect(result.sourceMessages).toEqual([]);
  });

  it("still reports Google problems and keeps the Google-only behavior when Outlook is inactive", () => {
    const reconnect = desktopTimelineFreshness({ snapshot: null, stale: true, label: "Reconnect Google Calendar." }, outlookReady);
    expect(reconnect.freshness).toEqual({ state: "unavailable", refreshedAt: null, label: "Reconnect Google Calendar.", canAssertNoOverlap: false });
    expect(reconnect.sourceMessages).toEqual([]);
    expect(desktopTimelineFreshness({ snapshot: null, stale: true, label: "Google Calendar is not connected." }, notLoaded))
      .toEqual({ freshness: { state: "unavailable", refreshedAt: null, label: "Google Calendar is not connected.", canAssertNoOverlap: false }, sourceMessages: [] });
    const google = snapshot();
    expect(desktopTimelineFreshness({ snapshot: google, stale: false, label: "Calendar refreshed." }, notLoaded).freshness)
      .toEqual({ ...google.freshness, label: "Calendar refreshed." });
  });

  it.each([
    ["not connected", { label: "Google Calendar is not connected.", error: null }, true],
    ["not configured in this build", { label: "Calendar is unavailable in this build.", error: null }, true],
    ["no calendars selected", { label: "No calendars are selected.", error: null }, true],
    ["reconnect required", { label: "Reconnect Google Calendar.", error: null }, false],
    ["failed read", { label: "Calendar data is unavailable.", error: "provider_unavailable" }, false],
    ["unreadable cache", { label: "Calendar cache is unavailable.", error: "cache" }, false],
    ["connection changed", { label: "Reconnect Google Calendar.", error: "connection_changed" }, false],
  ] as const)("Google %s with Outlook ready: no-overlap allowed = %s", (_name, google, allowed) => {
    const result = desktopTimelineFreshness({ snapshot: null, stale: true, ...google }, outlookReady);
    expect(result.freshness.canAssertNoOverlap).toBe(allowed);
    expect(result.freshness.state).toBe(allowed ? "current" : "unavailable");
  });

  it("weakens overlap claims for stale Google or failing Outlook context", () => {
    expect(desktopTimelineFreshness({ snapshot: snapshot(), stale: true, label: "Saved" }, outlookReady).freshness).toMatchObject({ state: "stale", canAssertNoOverlap: false });
    const failing = desktopTimelineFreshness({ snapshot: snapshot(), stale: false, label: "Fresh" }, { ...notLoaded, state: "error", error: "timeout" });
    expect(failing.freshness).toMatchObject({ state: "unavailable", canAssertNoOverlap: false });
    expect(failing.sourceMessages).toEqual(["Outlook Calendar context could not refresh: timeout."]);
  });
});
