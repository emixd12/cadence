import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import type { RecordedActivitySnapshotV1 } from "@cadence/core/types/recorded-activity";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import {
  clearWebConnectorSource,
  outlookTimelineRange,
  webHevyCoordinator,
  webOutlookCalendarCoordinator,
} from "@/lib/ui/connectors";
import outlookFixture from "./fixtures/external-event-snapshot.outlook.valid.json";
import hevyFixture from "./fixtures/recorded-activity-snapshot.valid.json";

type Route = (init: RequestInit | undefined) => Promise<Response> | Response;
let routes: Record<string, Route>;
let calls: { path: string; init?: RequestInit }[];

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
function view(accountId: string, provider: "outlook_calendar" | "hevy", overrides: Partial<ConnectorConnectionView> = {}): ConnectorConnectionView {
  return { accountId, provider, status: "connected", generation: provider === "outlook_calendar" ? 2 : 1, selectionRevision: 1,
    preferences: { selectedSourceIds: ["calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true }, ...overrides };
}
function outlookSnapshot(accountId: string, overrides: Record<string, unknown> = {}) {
  return { ...outlookFixture, accountId, ...overrides };
}
function hevySnapshot(accountId: string, overrides: Partial<RecordedActivitySnapshotV1> = {}): RecordedActivitySnapshotV1 {
  const base = validateRecordedActivitySnapshot(hevyFixture, { now: Temporal.Instant.from("2026-11-01T15:00:00Z") });
  return { ...base, accountId, requestedRange: { startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", timezone: "America/New_York" },
    activities: base.activities.filter((activity) => activity.localStartDate === "2026-11-01"), ...overrides };
}
const range = { startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T15:05:00Z"));
  routes = {}; calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const pathname = input.split("?")[0]!;
    calls.push({ path: input, init });
    const route = routes[`${init?.method ?? "GET"} ${pathname}`];
    return route ? route(init) : json({ error: "not_found" }, 404);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("web Outlook coordinator", () => {
  it("accepts only a snapshot for the exact account, generation, selection, range, and timezone", async () => {
    routes["GET /api/outlook-calendar/connection"] = () => json(view("outlook-scope", "outlook_calendar"));
    routes["GET /api/outlook-calendar/events"] = () => json(outlookSnapshot("outlook-scope"));
    await expect(webOutlookCalendarCoordinator.refreshEvents(range)).resolves.toMatchObject({ source: "outlook_calendar", accountId: "outlook-scope" });
    for (const wrong of [{ connectionGeneration: 1 }, { accountId: "someone-else" }, { requestedRange: { ...outlookFixture.requestedRange, timezone: "Europe/Madrid" } },
      { requestedRange: { ...outlookFixture.requestedRange, selectedCalendarIds: ["calendar-2"] } }]) {
      routes["GET /api/outlook-calendar/events"] = () => json(outlookSnapshot("outlook-scope", wrong));
      await expect(webOutlookCalendarCoordinator.refreshEvents(range, { force: true })).rejects.toMatchObject({ code: expect.stringMatching(/connection_changed|schema|invalid|unsupported/) });
    }
    // A Google 1.0.0 snapshot never satisfies an Outlook request.
    routes["GET /api/outlook-calendar/events"] = () => json({ ...outlookSnapshot("outlook-scope"), schemaVersion: "1.0.0" });
    await expect(webOutlookCalendarCoordinator.refreshEvents(range, { force: true })).rejects.toBeDefined();
  });

  it("drops a response that finishes after disconnect and does not repopulate the cache", async () => {
    let release!: (response: Response) => void;
    routes["GET /api/outlook-calendar/connection"] = () => json(view("outlook-late", "outlook_calendar"));
    routes["GET /api/outlook-calendar/events"] = () => new Promise<Response>((resolve) => { release = resolve; });
    routes["DELETE /api/outlook-calendar/connection"] = () => json({ ...view("outlook-late", "outlook_calendar", { status: "disconnected", generation: 2 }), revocation: "microsoft_account_permissions" });
    const pending = webOutlookCalendarCoordinator.refreshEvents(range);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(webOutlookCalendarCoordinator.disconnect()).resolves.toMatchObject({ revocation: "microsoft_account_permissions" });
    release(json(outlookSnapshot("outlook-late")));
    await expect(pending).rejects.toMatchObject({ code: "connection_changed" });
    routes["GET /api/outlook-calendar/events"] = () => json(outlookSnapshot("outlook-late"));
    const before = calls.filter((call) => call.path.startsWith("/api/outlook-calendar/events")).length;
    await webOutlookCalendarCoordinator.refreshEvents(range);
    expect(calls.filter((call) => call.path.startsWith("/api/outlook-calendar/events")).length).toBe(before + 1);
  });

  it("clamps the Timeline range to today through 30 days later", () => {
    expect(outlookTimelineRange("2026-11-01", "2026-12-31", "UTC")).toEqual({ startLocalDate: "2026-11-01", endLocalDate: "2026-12-01", timezone: "UTC" });
    expect(outlookTimelineRange("2026-11-01", "2026-10-01", "UTC").endLocalDate).toBe("2026-11-01");
  });
});

describe("web Hevy coordinator", () => {
  it("posts the API key once and keeps no copy", async () => {
    routes["POST /api/hevy/connection"] = () => json(view("hevy-key", "hevy"));
    await webHevyCoordinator.connect("hevy-secret-key");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ apiKey: "hevy-secret-key" });
    expect(JSON.stringify(webHevyCoordinator)).not.toContain("hevy-secret-key");
  });

  it("keeps a same-scope complete read when a later read is incomplete and ignores another scope", async () => {
    routes["GET /api/hevy/connection"] = () => json(view("hevy-scope", "hevy"));
    routes["GET /api/hevy/activities"] = () => json(hevySnapshot("hevy-scope"));
    const first = await webHevyCoordinator.refreshActivities("2026-11-01", "America/New_York");
    expect(first.snapshot.activities).toHaveLength(1);
    routes["GET /api/hevy/activities"] = () => json(hevySnapshot("hevy-scope", { completeness: "incomplete", activities: [], fetchedAt: "2026-11-01T15:04:00Z",
      failures: [{ code: "timeout", retryable: true, retryAfterSeconds: null, message: "Timed out" }] }));
    const second = await webHevyCoordinator.refreshActivities("2026-11-01", "America/New_York", { force: true });
    expect(second.snapshot.activities).toHaveLength(1);
    expect(second.refreshFailures[0]?.code).toBe("timeout");
    // A response for an older generation is late for the active scope.
    routes["GET /api/hevy/connection"] = () => json(view("hevy-scope", "hevy", { generation: 2 }));
    routes["GET /api/hevy/activities"] = () => json(hevySnapshot("hevy-scope"));
    await expect(webHevyCoordinator.refreshActivities("2026-11-01", "America/New_York", { force: true })).rejects.toMatchObject({ code: "connection_changed" });
  });

  it("clears one source without touching another source's cache", async () => {
    routes["GET /api/hevy/connection"] = () => json(view("isolated", "hevy"));
    routes["GET /api/hevy/activities"] = () => json(hevySnapshot("isolated"));
    await webHevyCoordinator.refreshActivities("2026-11-01", "America/New_York");
    clearWebConnectorSource("outlook_calendar", "isolated");
    await webHevyCoordinator.refreshActivities("2026-11-01", "America/New_York");
    expect(calls.filter((call) => call.path.startsWith("/api/hevy/activities"))).toHaveLength(1);
    clearWebConnectorSource("hevy", "isolated");
    await webHevyCoordinator.refreshActivities("2026-11-01", "America/New_York");
    expect(calls.filter((call) => call.path.startsWith("/api/hevy/activities"))).toHaveLength(2);
  });

  it("reports disconnected and not-configured status without reading activity", async () => {
    routes["GET /api/hevy/connection"] = () => json(view("hevy-off", "hevy", { status: "not_configured" }));
    await expect(webHevyCoordinator.refreshActivities("2026-11-01", "America/New_York")).rejects.toMatchObject({ code: "not_configured" });
    expect(calls.some((call) => call.path.startsWith("/api/hevy/activities"))).toBe(false);
  });
});
