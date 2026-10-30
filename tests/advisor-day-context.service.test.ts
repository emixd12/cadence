import { readFile } from "node:fs/promises";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  readAdvisorProfileTimezone: vi.fn(),
  readAdvisorCadenceSnapshot: vi.fn(),
  readAdvisorCadenceRevision: vi.fn(),
}));
const admission = vi.hoisted(() => ({
  acquireAdvisorDayContextRead: vi.fn(),
  releaseAdvisorDayContextRead: vi.fn(),
}));
const calendar = vi.hoisted(() => ({
  getCalendarEventsForAdvisor: vi.fn(),
  getCalendarConnection: vi.fn(),
}));

const connectors = vi.hoisted(() => ({
  getOutlookCalendarEventsForCaller: vi.fn(),
  getOutlookCalendarConnection: vi.fn(),
  getHevyActivities: vi.fn(),
  getConnectorConnection: vi.fn(),
  getIcloudCalendarEventsForCaller: vi.fn(),
  getIcloudCalendarConnection: vi.fn(),
}));

vi.mock("../lib/services/outlook-calendar.service", () => ({
  getOutlookCalendarEventsForCaller: connectors.getOutlookCalendarEventsForCaller,
  getOutlookCalendarConnection: connectors.getOutlookCalendarConnection,
}));
vi.mock("../lib/services/hevy.service", () => ({ getHevyActivities: connectors.getHevyActivities }));
vi.mock("../lib/services/icloud-calendar.service", () => ({
  getIcloudCalendarEventsForCaller: connectors.getIcloudCalendarEventsForCaller,
  getIcloudCalendarConnection: connectors.getIcloudCalendarConnection,
}));
vi.mock("../lib/services/connector-credentials", () => ({ getConnectorConnection: connectors.getConnectorConnection }));
vi.mock("../lib/db/advisor-context.repo", () => repo);
vi.mock("../lib/db/advisor-read-admission.repo", () => admission);
vi.mock("../lib/services/google-calendar.service", () => calendar);

import type { FixtureSnapshot } from "./helpers/connector-day-context";
import {
  AdvisorDayContextServiceError,
  readAdvisorDayContext,
  readAdvisorDayContexts,
  type AdvisorAuthorizationFence,
} from "../lib/services/advisor-day-context.service";

const user = { id: "owner-1" } as never;
const client = {} as never;
const authorization: AdvisorAuthorizationFence = {
  userId: "owner-1",
  clientId: "daily-brief",
  accountRef: "account_ref",
  grantGeneration: 2,
  grantExpiresAt: "2026-09-20T00:00:00Z",
  behaviorIds: ["behavior-1"],
  calendar: null,
};
const snapshot = {
  timezone: "America/New_York",
  profileUpdatedAt: "2026-09-19T11:00:00Z",
  observedAt: "2026-09-19T12:00:01Z",
  revision: "revision-1",
  behaviors: [{ id: "behavior-1", title: "Walk", defaultDurationMinutes: 20, currentConfigurationEventId: null, updatedAt: "2026-09-19T11:00:00Z", endDate: null }],
  occurrences: [{ id: "occurrence-1", behaviorId: "behavior-1", behaviorConfigurationEventId: null, scheduledFor: "2026-09-19T16:30:00Z", localDate: "2026-09-19", scheduleKind: "exact", scheduleStartTime: "12:30:00", scheduleEndTime: null, status: "unresolved", updatedAt: "2026-09-19T11:00:00Z" }],
  historyOccurrences: [],
  historySessions: [],
  syncState: { timezone: "America/New_York", last_synced_local_date: "2026-09-19", synced_through_local_date: "2026-09-19", last_successful_sync_at: "2026-09-19T11:59:00Z", stale: false, stale_reason: null, state_version: 1, updated_at: "2026-09-19T11:59:00Z" },
  dueArchiveCount: 0,
  staleConfigurationCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.readAdvisorProfileTimezone.mockResolvedValue("America/New_York");
  repo.readAdvisorCadenceSnapshot.mockResolvedValue(snapshot);
  repo.readAdvisorCadenceRevision.mockResolvedValue("revision-1");
  admission.acquireAdvisorDayContextRead.mockResolvedValue({ allowed: true, leaseToken: "14600000-0000-4000-8000-000000000001" });
  admission.releaseAdvisorDayContextRead.mockResolvedValue(true);
});

describe("advisor day-context service", () => {
  it("returns one validated read-only day without invoking Calendar or mutation owners", async () => {
    const times = ["2026-09-19T12:00:00Z", "2026-09-19T12:00:02Z"].map(Temporal.Instant.from);
    const result = await readAdvisorDayContext({
      caller: { client, user },
      authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      clock: () => times.shift() ?? Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });

    expect(result).toMatchObject({ version: "1.0", accountRef: "account_ref", localDate: "2026-09-19", status: "complete", authority: "read_only" });
    expect(result.connectors).toEqual([{ source: "google_calendar", state: "not_requested" }]);
    expect(result.cadence.occurrences[0]).toMatchObject({ title: "Walk", duration: { source: "behavior_default", seconds: 1200 } });
    expect(result.cadence.history).toEqual({
      lookbackDays: 90,
      startLocalDate: "2026-06-21",
      endLocalDateExclusive: "2026-09-19",
      completeness: "complete",
      reason: null,
      behaviors: [{
        behaviorRef: expect.stringMatching(/^behavior_/),
        completedCount: 0,
        notCompletedCount: 0,
        unresolvedCount: 0,
      }],
    });
    expect(result.cadence.occurrences[0]?.ref).not.toContain("occurrence-1");
    expect(calendar.getCalendarEventsForAdvisor).not.toHaveBeenCalled();
    expect(admission.releaseAdvisorDayContextRead).toHaveBeenCalledOnce();
  });

  it("denies missing Calendar disclosure permission before admission or source reads", async () => {
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: true,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:00Z"),
    })).rejects.toMatchObject({ code: "access_denied" });
    expect(admission.acquireAdvisorDayContextRead).not.toHaveBeenCalled();
    expect(repo.readAdvisorProfileTimezone).not.toHaveBeenCalled();
  });

  it("rejects stale coverage without generating Occurrences or archiving Behaviors", async () => {
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({ ...snapshot, syncState: { ...snapshot.syncState, stale: true, stale_reason: "behavior_changed" } });
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:00Z"),
    })).rejects.toMatchObject({ code: "context_incomplete", recovery: expect.stringContaining("Save timezone") });
    expect(repo.readAdvisorCadenceRevision).not.toHaveBeenCalled();
    expect(admission.releaseAdvisorDayContextRead).toHaveBeenCalledOnce();
  });

  it.each([null, "previous-configuration"])("accepts preserved occurrence lineage %s after a fully fenced sync", async (lineage) => {
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({ ...snapshot,
      behaviors: [{ ...snapshot.behaviors[0], currentConfigurationEventId: "current-configuration" }],
      occurrences: [{ ...snapshot.occurrences[0], behaviorConfigurationEventId: lineage,
        scheduledFor: "2026-09-19T11:00:00Z", scheduleStartTime: "07:00:00" }],
      staleConfigurationCount: 1,
    });
    const result = await readAdvisorDayContext({
      caller: { client, user }, authorization, revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false, opaqueRefKey: "k".repeat(32), now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });
    expect(result.cadence.occurrences).toHaveLength(1);
    expect(result.cadence.occurrences[0]).toMatchObject({ status: "unresolved" });
    expect(repo.readAdvisorCadenceRevision).toHaveBeenCalledOnce();
  });

  it("directs due archives to Timeline reconciliation before full synchronization", async () => {
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({ ...snapshot, dueArchiveCount: 1 });
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization, revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false, opaqueRefKey: "k".repeat(32), now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    })).rejects.toMatchObject({ code: "context_incomplete", recovery: expect.stringMatching(/Open Timeline.*Save timezone/) });
    expect(repo.readAdvisorCadenceRevision).not.toHaveBeenCalled();
  });

  it("times out a hung final authorization check and releases only after the work settles", async () => {
    let finish!: (value: AdvisorAuthorizationFence) => void;
    const revalidation = new Promise<AdvisorAuthorizationFence>((resolve) => { finish = resolve; });
    const read = readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: () => revalidation,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
      deadlineMs: 5,
    });
    await expect(read).rejects.toMatchObject({ code: "timeout" });
    expect(admission.releaseAdvisorDayContextRead).not.toHaveBeenCalled();
    finish(authorization);
    await vi.waitFor(() => expect(admission.releaseAdvisorDayContextRead).toHaveBeenCalledOnce());
  });

  it("fails when authorization changes before release", async () => {
    const changed = { ...authorization, grantGeneration: 3 };
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => changed,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    })).rejects.toBeInstanceOf(AdvisorDayContextServiceError);
  });

  it("does not delay the validated response on lease cleanup", async () => {
    admission.releaseAdvisorDayContextRead.mockImplementationOnce(() => new Promise(() => undefined));
    const result = await readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false, opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"), deadlineMs: 20,
    });
    expect(result.authority).toBe("read_only");
    expect(admission.releaseAdvisorDayContextRead).toHaveBeenCalledOnce();
  });

  it("returns unknown for capped history while preserving explicit defaults", async () => {
    const behaviors = [
      snapshot.behaviors[0],
      { ...snapshot.behaviors[0], id: "behavior-2", title: "Read", defaultDurationMinutes: null },
    ];
    const occurrences = [
      snapshot.occurrences[0],
      { ...snapshot.occurrences[0], id: "occurrence-2", behaviorId: "behavior-2", scheduledFor: "2026-09-19T17:30:00Z" },
    ];
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({
      ...snapshot,
      behaviors,
      occurrences,
      historyOccurrences: Array.from({ length: 10_001 }, (_, index) => ({ id: `history-${index}`, behaviorId: "behavior-2", localDate: "2026-09-18", status: "completed" })),
    });
    const expandedAuthorization = { ...authorization, behaviorIds: ["behavior-1", "behavior-2"] };
    const [result, short] = await readAdvisorDayContexts({
      caller: { client, user }, authorization: expandedAuthorization,
      revalidateAuthorization: async () => expandedAuthorization,
      includeGoogleCalendar: false,
      historyDays: [90, 30],
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });
    expect(result.cadence.occurrences.map(({ duration }) => duration)).toEqual([
      expect.objectContaining({ kind: "known", source: "behavior_default" }),
      expect.objectContaining({ kind: "unknown", reason: "history_limit_exceeded" }),
    ]);
    expect(result.cadence.history).toMatchObject({
      completeness: "unknown",
      reason: "history_limit_exceeded",
      behaviors: [
        { completedCount: null, notCompletedCount: null, unresolvedCount: null },
        { completedCount: null, notCompletedCount: null, unresolvedCount: null },
      ],
    });
    expect(short.cadence.history).toMatchObject({ completeness: "unknown", reason: "history_limit_exceeded" });
    expect(short.cadence.occurrences.map(({ duration }) => duration)).toEqual(result.cadence.occurrences.map(({ duration }) => duration));
    expect(repo.readAdvisorCadenceSnapshot).toHaveBeenCalledOnce();
  });

  it("counts every manual status per Behavior and includes zero histories", async () => {
    const behaviors = [
      snapshot.behaviors[0],
      { ...snapshot.behaviors[0], id: "behavior-2", title: "Read", defaultDurationMinutes: null },
    ];
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({
      ...snapshot,
      behaviors,
      historyOccurrences: [
        { id: "history-1", behaviorId: "behavior-1", localDate: "2026-09-16", status: "completed" },
        { id: "history-2", behaviorId: "behavior-1", localDate: "2026-09-17", status: "not_completed" },
        { id: "history-3", behaviorId: "behavior-1", localDate: "2026-09-18", status: "unresolved" },
      ],
    });
    const expandedAuthorization = { ...authorization, behaviorIds: ["behavior-1", "behavior-2"] };
    const result = await readAdvisorDayContext({
      caller: { client, user }, authorization: expandedAuthorization,
      revalidateAuthorization: async () => expandedAuthorization,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });

    expect(result.cadence.history.behaviors).toEqual([
      expect.objectContaining({ completedCount: 1, notCompletedCount: 1, unresolvedCount: 1 }),
      expect.objectContaining({ completedCount: 0, notCompletedCount: 0, unresolvedCount: 0 }),
    ]);
  });

  it("filters a shorter history before aggregation while retaining 90 days for duration estimates", async () => {
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({
      ...snapshot,
      behaviors: [{ ...snapshot.behaviors[0], defaultDurationMinutes: null }],
      historyOccurrences: [
        { id: "recent", behaviorId: "behavior-1", localDate: "2026-09-18", status: "not_completed" },
        ...["2026-08-20", "2026-08-21", "2026-08-22"].map((localDate, index) => ({
          id: `old-${index}`,
          behaviorId: "behavior-1",
          localDate,
          status: "completed",
        })),
      ],
      historySessions: ["2026-08-20", "2026-08-21", "2026-08-22"].map((_localDate, index) => ({
        id: `session-${index}`,
        occurrenceId: `old-${index}`,
        behaviorId: "behavior-1",
        startedAt: `2026-08-${20 + index}T12:00:00Z`,
        stoppedAt: `2026-08-${20 + index}T12:20:00Z`,
      })),
    });

    const result = await readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      includeRecordedElapsedDurations: true,
      historyDays: 7,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });

    expect(repo.readAdvisorCadenceSnapshot).toHaveBeenCalledWith(client, expect.objectContaining({ historyStartLocalDate: "2026-06-21" }));
    expect(repo.readAdvisorCadenceRevision).toHaveBeenCalledWith(client, expect.objectContaining({ historyStartLocalDate: "2026-06-21" }));
    expect(result.cadence.history).toMatchObject({
      lookbackDays: 7,
      startLocalDate: "2026-09-12",
      endLocalDateExclusive: "2026-09-19",
      behaviors: [{ completedCount: 0, notCompletedCount: 1, unresolvedCount: 0 }],
    });
    expect(result.cadence.occurrences[0]?.duration).toMatchObject({ kind: "known", sampleCount: 3, lookbackDays: 90 });
    expect(result.cadence.occurrences[0]?.durationCandidates).toMatchObject({
      configuredDefault: null,
      historicalAverage: { kind: "known", sampleCount: 3, lookbackDays: 90 },
    });
    expect(result.cadence.recordedElapsedDurations).toHaveLength(3);
  });

  it("projects 90-day and 30-day aggregation windows from one raw snapshot", async () => {
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({
      ...snapshot,
      historyOccurrences: [
        { id: "old", behaviorId: "behavior-1", localDate: "2026-07-01", status: "completed" },
        { id: "recent", behaviorId: "behavior-1", localDate: "2026-09-18", status: "not_completed" },
      ],
    });
    const contexts = await readAdvisorDayContexts({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      historyDays: [90, 30],
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });

    expect(repo.readAdvisorCadenceSnapshot).toHaveBeenCalledOnce();
    expect(repo.readAdvisorCadenceRevision).toHaveBeenCalledOnce();
    expect(contexts.map((context) => context.cadence.history.behaviors[0])).toEqual([
      expect.objectContaining({ completedCount: 1, notCompletedCount: 1 }),
      expect.objectContaining({ completedCount: 0, notCompletedCount: 1 }),
    ]);
    expect(new Set(contexts.map((context) => context.snapshotId)).size).toBe(1);
    expect(new Set(contexts.map((context) => context.cadence.revision)).size).toBe(1);
    expect(contexts[0]?.cadence.occurrences[0]?.duration).toEqual(contexts[1]?.cadence.occurrences[0]?.duration);
  });

  it("honors caller cancellation before admission", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readAdvisorDayContexts({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      historyDays: [90, 30],
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "timeout" });
    expect(admission.acquireAdvisorDayContextRead).not.toHaveBeenCalled();
  });

  it("allows two configurations to share the same bounded history window", async () => {
    const contexts = await readAdvisorDayContexts({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      historyDays: [30, 30],
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });
    expect(contexts).toHaveLength(2);
    expect(repo.readAdvisorCadenceSnapshot).toHaveBeenCalledOnce();
  });

  it.each([0, 91, 1.5])("rejects invalid historyDays %s before source reads", async (historyDays) => {
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      historyDays,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(admission.acquireAdvisorDayContextRead).not.toHaveBeenCalled();
    expect(repo.readAdvisorProfileTimezone).not.toHaveBeenCalled();
  });

  it("keeps complete status counts when only duration sessions reach their cap", async () => {
    repo.readAdvisorCadenceSnapshot.mockResolvedValue({
      ...snapshot,
      historyOccurrences: [
        { id: "history-1", behaviorId: "behavior-1", localDate: "2026-09-18", status: "completed" },
      ],
      historySessions: Array.from({ length: 20_001 }, (_, index) => ({
        id: `session-${index}`,
        occurrenceId: "history-1",
        behaviorId: "behavior-1",
        startedAt: "2026-09-18T12:00:00Z",
        stoppedAt: "2026-09-18T12:05:00Z",
      })),
    });

    const result = await readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });

    expect(result.cadence.history).toMatchObject({
      completeness: "complete",
      behaviors: [{ completedCount: 1, notCompletedCount: 0, unresolvedCount: 0 }],
    });
  });

  it("rejects changed Cadence revisions and occurrence record overflow", async () => {
    repo.readAdvisorCadenceRevision.mockResolvedValueOnce("revision-2");
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    })).rejects.toMatchObject({ code: "context_changed" });

    repo.readAdvisorCadenceSnapshot.mockResolvedValue({
      ...snapshot,
      occurrences: Array.from({ length: 201 }, (_, index) => ({ ...snapshot.occurrences[0], id: `occurrence-${index}`, scheduledFor: `2026-09-19T${String(12 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z` })),
    });
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization,
      revalidateAuthorization: async () => authorization,
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    })).rejects.toMatchObject({ code: "context_limit_exceeded" });
  });

  it("domains opaque references by client", async () => {
    const read = async (clientId: string) => readAdvisorDayContext({
      caller: { client, user },
      authorization: { ...authorization, clientId },
      revalidateAuthorization: async () => ({ ...authorization, clientId }),
      includeGoogleCalendar: false,
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });
    const [first, second] = await Promise.all([read("daily-brief-a"), read("daily-brief-b")]);
    expect(first.cadence.occurrences[0]?.ref).not.toBe(second.cadence.occurrences[0]?.ref);
    expect(first.snapshotId).not.toBe(second.snapshotId);
  });

  it("reuses one separately authorized Calendar snapshot across history windows", async () => {
    const calendarSnapshot = JSON.parse(await readFile(new URL("./fixtures/external-event-snapshot.valid.json", import.meta.url), "utf8"));
    calendarSnapshot.requestedRange.startLocalDate = "2026-09-19";
    calendarSnapshot.requestedRange.endLocalDate = "2026-09-19";
    calendarSnapshot.fetchedAt = "2026-09-19T12:00:01Z";
    calendarSnapshot.freshness.refreshedAt = "2026-09-19T12:00:01Z";
    calendarSnapshot.events = [];
    calendarSnapshot.coverage = [{ calendarId: "calendar-1", startLocalDate: "2026-09-19", endLocalDate: "2026-09-19", paginationComplete: true, itemCount: 0 }];
    const calendarAuthorization = {
      ...authorization,
      calendar: { calendarIds: ["calendar-1"], connectionGeneration: calendarSnapshot.connectionGeneration, selectionRevision: 2 },
    };
    calendar.getCalendarEventsForAdvisor.mockResolvedValue({
      result: { ok: true, snapshot: calendarSnapshot }, connection: { selectionRevision: 2 },
    });
    calendar.getCalendarConnection.mockResolvedValue({ status: "connected", generation: calendarSnapshot.connectionGeneration, selectionRevision: 2 });

    const contexts = await readAdvisorDayContexts({
      caller: { client, user }, authorization: calendarAuthorization,
      revalidateAuthorization: async () => calendarAuthorization,
      includeGoogleCalendar: true,
      historyDays: [90, 30],
      opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    });

    expect(calendar.getCalendarEventsForAdvisor).toHaveBeenCalledOnce();
    expect(contexts[0]?.connectors).toEqual(contexts[1]?.connectors);
    expect(calendar.getCalendarConnection).toHaveBeenCalledWith({ client, user }, "agent");
    calendar.getCalendarConnection.mockResolvedValue({ status: "reconnect_required", generation: calendarSnapshot.connectionGeneration, selectionRevision: 2 });
    await expect(readAdvisorDayContexts({
      caller: { client, user }, authorization: calendarAuthorization,
      revalidateAuthorization: async () => calendarAuthorization,
      includeGoogleCalendar: true, historyDays: [90, 30], opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    })).rejects.toThrow("context_changed");
  });

  it("rejects 501 Calendar events instead of disclosing partial context", async () => {
    const fixture = JSON.parse(await readFile(new URL("./fixtures/external-event-snapshot.valid.json", import.meta.url), "utf8"));
    fixture.events = Array.from({ length: 501 }, (_, index) => ({
      ...fixture.events[0], id: `google_calendar/calendar-1/event-${index}`,
      providerEventId: `event-${index}`, logicalInstanceId: `instance-${index}`,
    }));
    fixture.coverage[0].itemCount = 501;
    const calendarAuthorization = {
      ...authorization,
      calendar: { calendarIds: ["calendar-1"], connectionGeneration: fixture.connectionGeneration, selectionRevision: 2 },
    };
    calendar.getCalendarEventsForAdvisor.mockResolvedValueOnce({
      result: { ok: true, snapshot: fixture }, connection: { selectionRevision: 2 },
    });
    await expect(readAdvisorDayContext({
      caller: { client, user }, authorization: calendarAuthorization,
      revalidateAuthorization: async () => calendarAuthorization,
      includeGoogleCalendar: true, opaqueRefKey: "k".repeat(32),
      now: Temporal.Instant.from("2026-09-19T12:00:02Z"),
    })).rejects.toMatchObject({ code: "context_limit_exceeded", retryable: false });
    expect(admission.releaseAdvisorDayContextRead).toHaveBeenCalledOnce();
  });
});

it('summarizes completion marks from one snapshot for each selected window and gates acquisition', async () => {
  const historyOccurrences = ['2026-09-18', '2026-09-17', '2026-09-16'].map((localDate, index) => ({
    id: `history-${index}`, behaviorId: 'behavior-1', localDate, status: 'completed',
    statusMarkedAt: `${localDate}T12:${['10', '25', '15'][index]}:00Z`,
  }));
  repo.readAdvisorCadenceSnapshot.mockResolvedValue({ ...snapshot, historyOccurrences });
  const input = { caller: { client, user }, authorization, revalidateAuthorization: async () => authorization,
    includeGoogleCalendar: false, opaqueRefKey: 'k'.repeat(32),
    clock: () => Temporal.Instant.from('2026-09-19T12:00:02Z') };
  const results = await readAdvisorDayContexts({ ...input, historyDays: [7, 2], includeHistoricalCompletionTimes: true });
  expect(repo.readAdvisorCadenceSnapshot).toHaveBeenCalledTimes(1);
  expect(results[0].cadence.historicalCompletionTimes?.behaviors[0]).toMatchObject({ sampleCount: 3, typicalMarkedTime: '08:15' });
  expect(results[1].cadence.historicalCompletionTimes?.behaviors[0]).toMatchObject({ sampleCount: 2, typicalMarkedTime: null, exclusions: { outsideWindow: 1 } });
  expect((await readAdvisorDayContext(input)).cadence).not.toHaveProperty('historicalCompletionTimes');
  repo.readAdvisorCadenceSnapshot.mockResolvedValue({ ...snapshot, historyOccurrences: historyOccurrences.map(row => ({ id: row.id, behaviorId: row.behaviorId, localDate: row.localDate, status: row.status })) });
  expect((await readAdvisorDayContext({ ...input, includeHistoricalCompletionTimes: true })).cadence.historicalCompletionTimes?.behaviors[0].reason).toBe('source_unavailable');
});

describe("separately disclosed connector sources (Ticket 239)", () => {
  const sourcesAuthorization: AdvisorAuthorizationFence = {
    ...authorization,
    outlookCalendar: { calendarIds: ["calendar-1"], connectionGeneration: 2, selectionRevision: 3 },
    icloudCalendar: null,
    hevy: { connectionGeneration: 1 },
  };
  const now = Temporal.Instant.from("2026-09-19T12:00:02Z");
  const request = (overrides: Partial<{ outlookCalendar: boolean; icloudCalendar: boolean; hevy: boolean; deadlineAt: number }> = {}) => ({
    outlookCalendar: true, icloudCalendar: false, hevy: true, deadlineAt: Date.now() + 50_000, ...overrides,
  });
  const read = (input: Partial<Parameters<typeof readAdvisorDayContext>[0]> = {}) => readAdvisorDayContext({
    caller: { client, user }, authorization: sourcesAuthorization,
    revalidateAuthorization: async () => sourcesAuthorization,
    includeGoogleCalendar: false, opaqueRefKey: "k".repeat(32), now,
    connectorSources: request(),
    ...input,
  });
  let outlookSnapshot: FixtureSnapshot;
  let hevySnapshot: FixtureSnapshot;

  beforeEach(async () => {
    const { outlookDaySnapshot, hevyDaySnapshot } = await import("./helpers/connector-day-context");
    outlookSnapshot = outlookDaySnapshot();
    Object.assign(outlookSnapshot, {
      requestedRange: { ...outlookSnapshot.requestedRange, startLocalDate: "2026-09-19", endLocalDate: "2026-09-19" },
      fetchedAt: "2026-09-19T12:00:01Z",
      freshness: { ...outlookSnapshot.freshness, refreshedAt: "2026-09-19T12:00:01Z" },
      coverage: [{ ...outlookSnapshot.coverage[0], startLocalDate: "2026-09-19", endLocalDate: "2026-09-19" }],
      events: [{ ...outlookSnapshot.events[0], startAt: "2026-09-19T15:00:00Z", endAt: "2026-09-19T15:30:00Z" }],
    });
    hevySnapshot = hevyDaySnapshot();
    Object.assign(hevySnapshot, {
      requestedRange: { ...hevySnapshot.requestedRange, startLocalDate: "2026-09-19", endLocalDate: "2026-09-19" },
      fetchedAt: "2026-09-19T12:00:01Z",
      activities: [{ ...hevySnapshot.activities[0], startAt: "2026-09-19T10:00:00Z", endAt: "2026-09-19T10:45:00Z", localStartDate: "2026-09-19" }],
    });
    connectors.getOutlookCalendarEventsForCaller.mockResolvedValue({ connection: { selectionRevision: 3 }, result: { ok: true, snapshot: outlookSnapshot } });
    connectors.getHevyActivities.mockResolvedValue(hevySnapshot);
    connectors.getOutlookCalendarConnection.mockResolvedValue({ status: "connected", generation: 2, selectionRevision: 3, preferences: { selectedSourceIds: ["calendar-1"] } });
    connectors.getConnectorConnection.mockResolvedValue({ status: "connected", generation: 1, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
  });

  it("reads nothing new and keeps exact 1.0 output without a disclosed source request", async () => {
    const plain = await read({ connectorSources: undefined, authorization, revalidateAuthorization: async () => authorization });
    const declined = await read({ connectorSources: request({ outlookCalendar: false, hevy: false }) });
    for (const context of [plain, declined]) {
      expect(context.version).toBe("1.0");
      expect(context.connectors).toEqual([{ source: "google_calendar", state: "not_requested" }]);
    }
    expect(connectors.getOutlookCalendarEventsForCaller).not.toHaveBeenCalled();
    expect(connectors.getHevyActivities).not.toHaveBeenCalled();
  });

  it("denies a requested source without its disclosure fence before admission or any read", async () => {
    await expect(read({ authorization, revalidateAuthorization: async () => authorization })).rejects.toMatchObject({ code: "access_denied" });
    await expect(read({ connectorSources: request({ outlookCalendar: false, hevy: false, icloudCalendar: true }) })).rejects.toMatchObject({ code: "access_denied" });
    expect(admission.acquireAdvisorDayContextRead).not.toHaveBeenCalled();
    expect(connectors.getOutlookCalendarEventsForCaller).not.toHaveBeenCalled();
  });

  it("reads each disclosed source within its fence and the bounded budget, keeping workouts as past timing only", async () => {
    const context = await read();
    expect(context.version).toBe("1.1");
    expect(context.status).toBe("complete");
    expect(context.connectors.map((item) => item.source)).toEqual(["google_calendar", "outlook_calendar", "hevy"]);
    const outlookOptions = connectors.getOutlookCalendarEventsForCaller.mock.calls[0]![3];
    expect(connectors.getOutlookCalendarEventsForCaller).toHaveBeenCalledWith({ client, user }, "2026-09-19", "2026-09-19", expect.objectContaining({
      authorizedCalendarIds: ["calendar-1"], expectedConnectionGeneration: 2, expectedSelectionRevision: 3, signal: expect.any(AbortSignal),
    }));
    expect(outlookOptions.deadlineMs).toBeGreaterThan(24_000);
    expect(outlookOptions.deadlineMs).toBeLessThanOrEqual(25_000);
    const hevyOptions = connectors.getHevyActivities.mock.calls[0]![3];
    expect(connectors.getHevyActivities).toHaveBeenCalledWith({ client, user }, "2026-09-19", "2026-09-19", expect.objectContaining({
      expectedConnectionGeneration: 1, signal: expect.any(AbortSignal),
    }));
    expect(hevyOptions.deadlineMs).toBeLessThanOrEqual(25_000);
    const activity = context.connectors.find((item) => item.source === "hevy");
    expect(activity).toMatchObject({ state: "current", activities: [{ startAt: "2026-09-19T10:00:00Z", endAt: "2026-09-19T10:45:00Z", location: "unsupported" }] });
    expect(JSON.stringify(context)).not.toMatch(/Private review|hevy\/[0-9a-f]{16}|calendar-1/);
  });

  it("caps each read by the remaining source budget and skips reads once it is spent", async () => {
    await read({ connectorSources: request({ deadlineAt: Date.now() + 8_000 }) });
    expect(connectors.getOutlookCalendarEventsForCaller.mock.calls[0]![3].deadlineMs).toBeLessThanOrEqual(8_000);
    expect(connectors.getHevyActivities.mock.calls[0]![3].deadlineMs).toBeLessThanOrEqual(8_000);
    vi.clearAllMocks();
    admission.acquireAdvisorDayContextRead.mockResolvedValue({ allowed: true, leaseToken: "14600000-0000-4000-8000-000000000001" });
    admission.releaseAdvisorDayContextRead.mockResolvedValue(true);
    const spent = await read({ connectorSources: request({ deadlineAt: Date.now() - 1 }) });
    expect(connectors.getOutlookCalendarEventsForCaller).not.toHaveBeenCalled();
    expect(connectors.getHevyActivities).not.toHaveBeenCalled();
    expect(spent.status).toBe("partial");
    expect(spent.connectors.slice(1)).toEqual([
      expect.objectContaining({ source: "outlook_calendar", state: "unavailable", failure: expect.objectContaining({ code: "timeout" }), events: [] }),
      expect.objectContaining({ source: "hevy", state: "unavailable", failure: expect.objectContaining({ code: "timeout" }), activities: [] }),
    ]);
  });

  it("reports provider failures and partial reads as unknown, never as an empty day", async () => {
    const { ConnectorError } = await import("../lib/types/connectors");
    connectors.getOutlookCalendarEventsForCaller.mockRejectedValue(new ConnectorError("rate_limited"));
    hevySnapshot.completeness = "incomplete";
    hevySnapshot.coverage = { ...hevySnapshot.coverage, paginationComplete: false };
    hevySnapshot.failures = [{ code: "incomplete_pagination", message: "Hevy pages changed during the read.", retryable: true, retryAfterSeconds: null }];
    const context = await read();
    expect(context.status).toBe("partial");
    expect(context.connectors.slice(1)).toEqual([
      expect.objectContaining({ source: "outlook_calendar", state: "unavailable", complete: false, failure: { code: "rate_limited", retryable: true, retryAfterSeconds: null } }),
      expect.objectContaining({ source: "hevy", state: "incomplete", complete: false, activities: [] }),
    ]);
  });

  it("reads a disclosed iCloud source through its service within the fence and budget, sending no titles or provider IDs (Ticket 240)", async () => {
    const { icloudDaySnapshot } = await import("./helpers/connector-day-context");
    const snapshot = icloudDaySnapshot();
    Object.assign(snapshot, {
      requestedRange: { ...snapshot.requestedRange, startLocalDate: "2026-09-19", endLocalDate: "2026-09-19" },
      fetchedAt: "2026-09-19T12:00:01Z",
      freshness: { ...snapshot.freshness, refreshedAt: "2026-09-19T12:00:01Z" },
      coverage: [{ ...snapshot.coverage[0], startLocalDate: "2026-09-19", endLocalDate: "2026-09-19" }],
      events: [{ ...snapshot.events[0], startAt: "2026-09-19T15:00:00Z", endAt: "2026-09-19T15:30:00Z" }],
    });
    const icloud = { ...sourcesAuthorization, icloudCalendar: { calendarIds: ["calendar-1"], connectionGeneration: 4, selectionRevision: 2 } };
    connectors.getIcloudCalendarEventsForCaller.mockResolvedValue({ connection: { selectionRevision: 2 }, result: { ok: true, snapshot } });
    connectors.getIcloudCalendarConnection.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 2, preferences: { selectedSourceIds: ["calendar-1"] } });
    const context = await read({ authorization: icloud, revalidateAuthorization: async () => icloud,
      connectorSources: request({ outlookCalendar: false, hevy: false, icloudCalendar: true, deadlineAt: Date.now() + 9_000 }) });
    expect(context.version).toBe("1.1");
    expect(context.connectors[1]).toMatchObject({ source: "icloud_calendar", state: "current", complete: true, events: [expect.objectContaining({ interval: expect.objectContaining({ startAt: "2026-09-19T15:00:00Z" }) })] });
    const options = connectors.getIcloudCalendarEventsForCaller.mock.calls[0]![3];
    expect(connectors.getIcloudCalendarEventsForCaller).toHaveBeenCalledWith({ client, user }, "2026-09-19", "2026-09-19", expect.objectContaining({
      authorizedCalendarIds: ["calendar-1"], expectedConnectionGeneration: 4, expectedSelectionRevision: 2, signal: expect.any(AbortSignal) }));
    expect(options.deadlineMs).toBeLessThanOrEqual(9_000);
    expect(connectors.getOutlookCalendarEventsForCaller).not.toHaveBeenCalled();
    expect(JSON.stringify(context)).not.toMatch(/Private dentist|uid-9|calendar-1/);
  });

  it("reports an iCloud read failure or spent budget as unavailable, never an empty day, and fences an iCloud change", async () => {
    const { ConnectorError } = await import("../lib/types/connectors");
    const icloud = { ...sourcesAuthorization, icloudCalendar: { calendarIds: ["calendar-1"], connectionGeneration: 4, selectionRevision: 2 } };
    const only = request({ outlookCalendar: false, hevy: false, icloudCalendar: true });
    connectors.getIcloudCalendarConnection.mockResolvedValue({ status: "connected", generation: 4, selectionRevision: 2, preferences: { selectedSourceIds: ["calendar-1"] } });
    connectors.getIcloudCalendarEventsForCaller.mockRejectedValue(new ConnectorError("incomplete_pagination"));
    const failed = await read({ authorization: icloud, revalidateAuthorization: async () => icloud, connectorSources: only });
    expect(failed.connectors[1]).toMatchObject({ source: "icloud_calendar", state: "unavailable", events: [], failure: { code: "incomplete_pagination" } });
    connectors.getIcloudCalendarEventsForCaller.mockClear();
    const spent = await read({ authorization: icloud, revalidateAuthorization: async () => icloud, connectorSources: { ...only, deadlineAt: Date.now() - 1 } });
    expect(connectors.getIcloudCalendarEventsForCaller).not.toHaveBeenCalled();
    expect(spent.connectors[1]).toMatchObject({ state: "unavailable", failure: { code: "timeout" } });
    connectors.getIcloudCalendarConnection.mockResolvedValueOnce({ status: "connected", generation: 5, selectionRevision: 2, preferences: { selectedSourceIds: ["calendar-1"] } });
    await expect(read({ authorization: icloud, revalidateAuthorization: async () => icloud, connectorSources: only })).rejects.toMatchObject({ code: "context_changed" });
  });

  it("rejects output when a source connection or selection changes during or after its read", async () => {
    const { ConnectorError } = await import("../lib/types/connectors");
    connectors.getHevyActivities.mockRejectedValueOnce(new ConnectorError("connection_changed"));
    await expect(read()).rejects.toMatchObject({ code: "context_changed" });
    connectors.getOutlookCalendarConnection.mockResolvedValueOnce({ status: "connected", generation: 2, selectionRevision: 4, preferences: { selectedSourceIds: ["calendar-1"] } });
    await expect(read()).rejects.toMatchObject({ code: "context_changed" });
    connectors.getConnectorConnection.mockResolvedValueOnce({ status: "disconnected", generation: 2, selectionRevision: 0, preferences: { selectedSourceIds: [] } });
    await expect(read()).rejects.toMatchObject({ code: "context_changed" });
    const revoked = { ...sourcesAuthorization, hevy: null };
    await expect(read({ revalidateAuthorization: async () => revoked })).rejects.toMatchObject({ code: "context_changed" });
  });

  it("cancels pending provider reads when the brief is aborted", async () => {
    let providerSignal: AbortSignal | undefined;
    connectors.getOutlookCalendarEventsForCaller.mockImplementation((_caller, _start, _end, options) => {
      providerSignal = options.signal;
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const pending = read({ signal: controller.signal });
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "timeout" });
    expect(providerSignal?.aborted).toBe(true);
  });
});
