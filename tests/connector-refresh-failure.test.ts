import { it, expect, vi, afterEach } from "vitest";
import {
  webIcloudCalendarCoordinator as c,
  clearWebConnectorSource,
} from "@/lib/ui/connectors";
import fixture from "@/tests/fixtures/external-event-snapshot.icloud.valid.json";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearWebConnectorSource("icloud_calendar", "review-owner");
});
it("C1 a forced partial refresh stays stale on the next unforced read", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T15:05:00Z"));
  const view = {
    accountId: "review-owner",
    provider: "icloud_calendar",
    status: "connected",
    generation: 2,
    selectionRevision: 1,
    preferences: {
      selectedSourceIds: ["calendar-1"],
      hiddenSourceIds: [],
      visible: true,
      showAllDay: true,
    },
  };
  const complete = {
    ...fixture,
    accountId: view.accountId,
    fetchedAt: "2026-11-01T15:00:00Z",
    freshness: { ...fixture.freshness, refreshedAt: "2026-11-01T15:00:00Z" },
  };
  let snapshot: unknown = complete;
  let status = 200;
  let connectionStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/connection")
              ? connectionStatus === 200
                ? view
                : { error: "provider_unavailable" }
              : snapshot,
          ),
          { status: url.includes("/connection") ? connectionStatus : status },
        ),
    ),
  );
  const range = {
    startLocalDate: "2026-11-01",
    endLocalDate: "2026-11-03",
    timezone: "America/New_York",
  };
  await c.refreshEvents(range);
  snapshot = {
    ...complete,
    events: [],
    completeness: "incomplete",
    freshness: {
      state: "incomplete",
      refreshedAt: null,
      label: "incomplete",
      canAssertNoOverlap: false,
    },
    coverage: [{ ...fixture.coverage[0], paginationComplete: false }],
    failures: [
      {
        code: "incomplete_pagination",
        calendarId: "calendar-1",
        retryable: false,
        retryAfterSeconds: null,
        message: "Incomplete",
      },
    ],
  };
  expect(
    (await c.refreshEvents(range, { force: true })).freshness
      .canAssertNoOverlap,
  ).toBe(false);
  expect((await c.refreshEvents(range)).freshness.canAssertNoOverlap).toBe(
    false,
  );
  snapshot = complete;
  expect(
    (await c.refreshEvents(range, { force: true })).freshness
      .canAssertNoOverlap,
  ).toBe(true);
  status = 503;
  snapshot = { error: "provider_unavailable" };
  await expect(c.refreshEvents(range, { force: true })).rejects.toMatchObject({
    code: "provider_unavailable",
  });
  for (let read = 0; read < 2; read++) {
    const retained = await c.refreshEvents(range);
    expect(retained.events).toEqual(complete.events);
    expect(retained.freshness).toMatchObject({
      state: "stale",
      canAssertNoOverlap: false,
    });
  }
  status = 200;
  snapshot = complete;
  expect(
    (await c.refreshEvents(range, { force: true })).freshness
      .canAssertNoOverlap,
  ).toBe(true);
  connectionStatus = 503;
  await expect(c.getConnection()).rejects.toMatchObject({
    code: "provider_unavailable",
  });
  connectionStatus = 200;
  expect((await c.refreshEvents(range)).freshness.canAssertNoOverlap).toBe(
    false,
  );
});
it("C2 desktop does not erase a known partial-read failure on the next foreground cache hit", async () => {
  const { DesktopConnectorSnapshots } =
    await import("@/apps/desktop/src/calendar/connector-coordinator");
  const { icloudSourceRules, icloudScopeKey } =
    await import("@/apps/desktop/src/calendar/icloud-calendar");
  const view = {
    accountId: "account-1",
    provider: "icloud_calendar" as const,
    status: "connected" as const,
    generation: 2,
    selectionRevision: 1,
    preferences: {
      selectedSourceIds: ["calendar-1"],
      hiddenSourceIds: [],
      visible: true,
      showAllDay: true,
    },
  };
  const range = fixture.requestedRange;
  const key = icloudScopeKey(view, range);
  let stored: string | null = null;
  const cache = {
    read: async () => stored,
    readCurrent: async () =>
      stored ? { scopeKey: key, snapshotJson: stored } : null,
    begin: async () => {},
    replace: async (
      _p: string,
      _a: string,
      _s: string,
      _r: string,
      json: string,
    ) => {
      stored = json;
    },
    clear: async () => {
      stored = null;
    },
  };
  const snapshots = new DesktopConnectorSnapshots(icloudSourceRules(), cache);
  const now = Date.parse(fixture.fetchedAt) + 60_000;
  await snapshots.refresh("account-1", key, async () => fixture, "manual", now);
  const partial = {
    ...fixture,
    events: [],
    completeness: "incomplete",
    freshness: {
      state: "incomplete",
      refreshedAt: null,
      label: "incomplete",
      canAssertNoOverlap: false,
    },
    coverage: [{ ...fixture.coverage[0], paginationComplete: false }],
    failures: [
      {
        code: "incomplete_pagination",
        calendarId: "calendar-1",
        retryable: false,
        retryAfterSeconds: null,
        message: "Incomplete",
      },
    ],
  };
  expect(
    (
      await snapshots.refresh(
        "account-1",
        key,
        async () => partial,
        "manual",
        now,
      )
    ).stale,
  ).toBe(true);
  expect(
    (
      await snapshots.refresh(
        "account-1",
        key,
        async () => partial,
        "visible",
        now,
      )
    ).stale,
  ).toBe(true);
  const failed = async () => {
    throw new Error("synthetic network failure");
  };
  expect(
    await snapshots.refresh("account-1", key, failed, "manual", now),
  ).toMatchObject({ stale: true });
  expect(
    await snapshots.refresh("account-1", key, failed, "visible", now),
  ).toMatchObject({ stale: true });
  expect(
    await snapshots.refresh(
      "account-1",
      key,
      async () => fixture,
      "manual",
      now,
    ),
  ).toMatchObject({ stale: false, refreshError: null });
  expect(
    await snapshots.refresh("account-1", key, failed, "visible", now),
  ).toMatchObject({ stale: false, refreshError: null });
  // Cold opens must verify the provider before certifying a saved snapshot as current.
  const reopened = new DesktopConnectorSnapshots(icloudSourceRules(), cache);
  expect(
    await reopened.refresh("account-1", key, failed, "open", now),
  ).toMatchObject({ stale: true });
});
