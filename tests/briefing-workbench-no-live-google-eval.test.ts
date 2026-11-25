import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeBriefingConfig } from "@/lib/services/briefing-pipeline";
import { briefingFixture, BRIEFING_FIXTURE_VERSION } from "@/lib/services/briefing-fixtures";
import { BRIEFING_ANALYSIS_FIXTURE_VERSION } from "@/lib/services/briefing-analysis-fixtures";
import { BRIEFING_BENCH_SCHEMA_VERSION, type BenchCase } from "@/lib/services/briefing-bench-store";
import { briefingAccountRef } from "@/lib/services/briefing-account-context.service";
import {
  assertSavedCaseAuthorized,
  hasLiveAccountGoogleCalendar,
  replaySavedCase,
} from "@/lib/services/briefing-workbench.service";
import { inspectBriefingHistory } from "@/lib/services/briefing-history.service";

const {
  getCalendarConnectionMock,
  getCalendarEventsMock,
  getOutlookCalendarConnectionMock,
  getOutlookCalendarEventsMock,
  getIcloudCalendarConnectionMock,
  getIcloudCalendarEventsMock,
} = vi.hoisted(() => ({
  getCalendarConnectionMock: vi.fn(),
  getCalendarEventsMock: vi.fn(),
  getOutlookCalendarConnectionMock: vi.fn(),
  getOutlookCalendarEventsMock: vi.fn(),
  getIcloudCalendarConnectionMock: vi.fn(),
  getIcloudCalendarEventsMock: vi.fn(),
}));

vi.mock("@/lib/services/google-calendar.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/google-calendar.service")>();
  return {
    ...actual,
    getCalendarConnection: getCalendarConnectionMock,
    getCalendarEvents: getCalendarEventsMock,
  };
});

vi.mock("@/lib/services/outlook-calendar.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/outlook-calendar.service")>();
  return {
    ...actual,
    getOutlookCalendarConnection: getOutlookCalendarConnectionMock,
    getOutlookCalendarEvents: getOutlookCalendarEventsMock,
  };
});

vi.mock("@/lib/services/icloud-calendar.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/icloud-calendar.service")>();
  return {
    ...actual,
    getIcloudCalendarConnection: getIcloudCalendarConnectionMock,
    getIcloudCalendarEvents: getIcloudCalendarEventsMock,
  };
});

import { createHostedDayLoadReads } from "@/lib/services/day-load.service";

const baseConfig = activeBriefingConfig();
const configWithCalendar = { ...baseConfig, scope: { ...baseConfig.scope, includeCalendar: true } };

function makeSavedCase(overrides: Partial<BenchCase> = {}): BenchCase {
  const syntheticContext = briefingFixture("dense", configWithCalendar);
  return {
    schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION,
    kind: "case",
    id: "case-1",
    createdAt: "2026-11-25T12:00:00Z",
    source: {
      mode: "account",
      accountRef: briefingAccountRef("user-1"),
      preferenceRevision: 1,
    },
    evidenceType: "captured",
    localDate: syntheticContext.localDate,
    timezone: syntheticContext.timezone,
    capturedAt: syntheticContext.capturedAt,
    expiresAt: syntheticContext.expiresAt,
    capture: {
      historyDays: [baseConfig.scope.historyDays],
      includeCalendar: true,
      calendarDisclosed: true,
      includeRecordedElapsedDurations: false,
      includeHistoricalCompletionTimes: false,
      analysis: false,
      includeReminders: false,
      remindersDisclosed: false,
      includeNotes: false,
      notesDisclosed: false,
    },
    inputs: {
      contexts: [syntheticContext],
      analysisSource: null,
      configurationRefs: {},
    },
    behaviorTitles: [],
    ...overrides,
  };
}

describe("Workbench §2(f) live Google Calendar block", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    getCalendarConnectionMock.mockReset();
    getCalendarEventsMock.mockReset();
    getOutlookCalendarConnectionMock.mockReset();
    getOutlookCalendarEventsMock.mockReset();
    getIcloudCalendarConnectionMock.mockReset();
    getIcloudCalendarEventsMock.mockReset();
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  });

  it("blocks replaySavedCase and assertSavedCaseAuthorized for account cases with live Google Calendar", async () => {
    const accountWithCalendar = makeSavedCase();
    expect(hasLiveAccountGoogleCalendar(accountWithCalendar)).toBe(true);
    expect(() => replaySavedCase(accountWithCalendar, [configWithCalendar])).toThrow("access_denied");

    const accountWithConnectorOnly = makeSavedCase({
      capture: { ...makeSavedCase().capture, includeCalendar: false, calendarDisclosed: false },
    });
    expect(hasLiveAccountGoogleCalendar(accountWithConnectorOnly)).toBe(true);
    expect(() => replaySavedCase(accountWithConnectorOnly, [configWithCalendar])).toThrow("access_denied");

    const caller = { user: { id: "user-1" }, client: {} } as never;
    const preferences = {
      enabled: true,
      useConnectedSources: true,
      excludedSources: { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false },
      googleCalendarSource: "agent_mcp" as const,
      includeReminderHistory: false,
      includeNotes: false,
      revision: 1,
    };
    await expect(
      assertSavedCaseAuthorized(caller, preferences, accountWithCalendar, new AbortController().signal),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  it("preserves synthetic Calendar fixture replay cleanly", () => {
    const syntheticCase = makeSavedCase({
      source: {
        mode: "synthetic",
        fixtureId: "dense",
        fixtureVersion: BRIEFING_FIXTURE_VERSION,
        analysisFixtureId: null,
        analysisFixtureVersion: BRIEFING_ANALYSIS_FIXTURE_VERSION,
      },
      evidenceType: "synthetic",
      inputs: undefined,
    });
    expect(hasLiveAccountGoogleCalendar(syntheticCase)).toBe(false);
    expect(replaySavedCase(syntheticCase, [configWithCalendar])).toBeNull();
  });

  it("rejects includePastCalendar in account mode on inspectBriefingHistory", async () => {
    const request = new Request("http://127.0.0.1:4321/api/briefing/workbench/history", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:4321",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({
        mode: "account",
        accountRef: briefingAccountRef("user-1"),
        preferenceRevision: 1,
        includePastCalendar: true,
        configs: [configWithCalendar],
      }),
    });

    const response = await inspectBriefingHistory(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
  });
});

describe("day-load.service.ts Travel REST Google Calendar fence", () => {
  beforeEach(() => {
    getCalendarConnectionMock.mockReset();
    getCalendarEventsMock.mockReset();
    getOutlookCalendarConnectionMock.mockReset();
    getOutlookCalendarEventsMock.mockReset();
    getIcloudCalendarConnectionMock.mockReset();
    getIcloudCalendarEventsMock.mockReset();
  });

  it("never reads Google Calendar via Travel REST while keeping Outlook and iCloud readable", async () => {
    getOutlookCalendarConnectionMock.mockResolvedValue({
      status: "connected",
      generation: 1,
      selectionRevision: 1,
      preferences: { selectedSourceIds: ["outlook-primary"] },
    });
    getIcloudCalendarConnectionMock.mockResolvedValue({
      status: "not_connected",
      generation: 0,
      selectionRevision: 0,
      preferences: { selectedSourceIds: [] },
    });
    getOutlookCalendarEventsMock.mockResolvedValue({
      completeness: "complete",
      events: [
        {
          id: "evt-1",
          source: "outlook_calendar",
          title: "Standup",
          startAt: "2026-11-25T14:00:00Z",
          endAt: "2026-11-25T14:30:00Z",
          allDay: false,
          busy: true,
        },
      ],
    });

    const reads = createHostedDayLoadReads({ user: { id: "user-1" }, client: {} } as never);
    const events = await reads.calendarEvents("2026-11-25");

    expect(getCalendarConnectionMock).not.toHaveBeenCalled();
    expect(getCalendarEventsMock).not.toHaveBeenCalled();
    expect(getOutlookCalendarConnectionMock).toHaveBeenCalledTimes(1);
    expect(getOutlookCalendarEventsMock).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events?.[0]?.id).toBe("evt-1");
  });
});
