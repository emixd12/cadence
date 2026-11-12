import { describe, expect, it, vi } from "vitest";

import {
  beginDailyBrief,
  DailyBriefStorageError,
  finishDailyBrief,
  listDailyBriefBehaviorIds,
  readDailyBriefPreferences,
  releaseDailyBrief,
  saveDailyBriefPreferences,
} from "@/lib/db/daily-brief.repo";

const excluded = { google_calendar: false, outlook_calendar: true, icloud_calendar: true, hevy: false };
const preferences = {
  enabled: true,
  include_calendar: false,
  revision: 3,
  calendar_connection_generation: null,
  calendar_selection_revision: null,
  use_connected_sources: true,
  excluded_sources: excluded,
};
const noneExcluded = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };

describe("Daily Brief repository", () => {
  it("normalizes preferences and forwards abort signals", async () => {
    const signal = new AbortController().signal;
    const abortSignal = vi.fn().mockResolvedValue({ data: preferences, error: null });
    const rpc = vi.fn(() => ({ abortSignal }));

    await expect(readDailyBriefPreferences({ rpc } as never, signal)).resolves.toEqual({
      enabled: true,
      useConnectedSources: true,
      excludedSources: { googleCalendar: false, outlookCalendar: true, icloudCalendar: true, hevy: false },
      googleCalendarSource: null,
      revision: 3,
      includeReminderHistory: false,
      includeNotes: false,
    });
    expect(rpc).toHaveBeenCalledWith("read_daily_brief_preferences");
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("derives the one choice from per-source allowances on servers before Ticket 306", async () => {
    const read = (data: unknown) => readDailyBriefPreferences({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as never);
    const legacy = { enabled: true, revision: 2, include_calendar: true, calendar_connection_generation: 7, calendar_selection_revision: 11,
      include_outlook_calendar: false, include_icloud_calendar: false, include_hevy: true, hevy_connection_generation: 2 };
    await expect(read(legacy)).resolves.toMatchObject({
      useConnectedSources: true, excludedSources: { googleCalendar: false, outlookCalendar: true, icloudCalendar: true, hevy: false },
    });
    // Nothing allowed: the choice starts off and nothing is excluded, as for a new account.
    await expect(read({ enabled: true, revision: 2, include_calendar: false })).resolves.toMatchObject({
      useConnectedSources: false, excludedSources: noneExcluded,
    });
  });

  it("reports Google Calendar through the Timeline connection only after the Ticket 307 migration", async () => {
    const read = (data: unknown) => readDailyBriefPreferences({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as never);
    await expect(read({ ...preferences, google_calendar_source: "timeline" })).resolves.toMatchObject({ googleCalendarSource: "timeline" });
    await expect(read({ ...preferences, google_calendar_source: "agent" })).rejects.toThrow("invalid result");
  });

  it("rejects a malformed or disabled choice", async () => {
    const read = (data: unknown) => readDailyBriefPreferences({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as never);
    await expect(read({ ...preferences, use_connected_sources: "true" })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, excluded_sources: { ...excluded, hevy: null } })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, excluded_sources: { ...excluded, strava: false } })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, excluded_sources: undefined })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, enabled: false })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, include_hevy: "true" })).rejects.toThrow("invalid result");
  });

  it("saves the one choice, each exclusion and the expected revision", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: preferences, error: null });
    await saveDailyBriefPreferences(
      { rpc } as never,
      { enabled: true, useConnectedSources: true, excludedSources: { ...noneExcluded, outlookCalendar: true }, includeReminderHistory: false, includeNotes: true },
      2,
    );
    expect(rpc).toHaveBeenCalledWith("save_daily_brief_preferences_v4", {
      p_enabled: true,
      p_use_connected_sources: true,
      p_exclude_google_calendar: false,
      p_exclude_outlook_calendar: true,
      p_exclude_icloud_calendar: false,
      p_exclude_hevy: false,
      p_include_reminder_history: false,
      p_include_notes: true,
      p_expected_revision: 2,
    });
  });

  it("normalizes acquisition and bounds completion with the supplied signal", async () => {
    const signal = new AbortController().signal;
    const abortSignal = vi.fn()
      .mockResolvedValueOnce({ data: { state: "acquired", lease_token: "lease", local_date: "2026-09-20" }, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const rpc = vi.fn(() => ({ abortSignal }));
    const client = { rpc } as never;

    await expect(beginDailyBrief(client, {
      installationId: "14700000-0000-4000-8000-000000000001",
      retry: false,
      expectedRevision: 3,
    }, signal)).resolves.toEqual({ state: "acquired", leaseToken: "lease", localDate: "2026-09-20" });
    await expect(finishDailyBrief(client, {
      installationId: "14700000-0000-4000-8000-000000000001",
      leaseToken: "lease",
      success: true,
      expectedRevision: 3,
    }, signal)).resolves.toBe(true);
    expect(abortSignal).toHaveBeenCalledTimes(2);
  });

  it("recognizes an exhausted daily retry allowance", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: "retry_exhausted" }, error: null });
    await expect(beginDailyBrief({ rpc } as never, {
      installationId: "14700000-0000-4000-8000-000000000001",
      retry: true,
      expectedRevision: 3,
    })).resolves.toEqual({ state: "retry_exhausted" });
  });

  it("releases a pending lease through the bounded RPC and rejects invalid storage responses", async () => {
    const signal = new AbortController().signal;
    const abortSignal = vi.fn().mockResolvedValue({ data: false, error: null });
    const rpc = vi.fn(() => ({ abortSignal }));
    const input = { installationId: "14700000-0000-4000-8000-000000000001", leaseToken: "lease", expectedRevision: 3 };
    await expect(releaseDailyBrief({ rpc } as never, input, signal)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("release_daily_brief", { p_installation_id: input.installationId, p_lease_token: "lease", p_expected_revision: 3 });
    expect(abortSignal).toHaveBeenCalledWith(signal);
    abortSignal.mockResolvedValueOnce({ data: null, error: null });
    await expect(releaseDailyBrief({ rpc } as never, input, signal)).rejects.toThrow("invalid result");
  });

  it("returns active behavior IDs in stable order and rejects overflow", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "a" }, { id: "b" }],
      error: null,
    });
    const order = vi.fn(() => ({ limit }));
    const eqActive = vi.fn(() => ({ order }));
    const eqOwner = vi.fn(() => ({ eq: eqActive }));
    const select = vi.fn(() => ({ eq: eqOwner }));
    const from = vi.fn(() => ({ select }));

    await expect(listDailyBriefBehaviorIds({ from } as never, "owner")).resolves.toEqual(["a", "b"]);
    expect(eqOwner).toHaveBeenCalledWith("user_id", "owner");
    expect(eqActive).toHaveBeenCalledWith("active", true);
    expect(order).toHaveBeenCalledWith("id", { ascending: true });
    expect(limit).toHaveBeenCalledWith(101);

    limit.mockResolvedValueOnce({ data: Array.from({ length: 101 }, (_, id) => ({ id: String(id) })), error: null });
    await expect(listDailyBriefBehaviorIds({ from } as never, "owner")).rejects.toMatchObject({
      code: "context_limit_exceeded",
    });
  });

  it("maps database errors to route-safe storage codes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(readDailyBriefPreferences({ rpc } as never)).rejects.toEqual(
      expect.objectContaining<Partial<DailyBriefStorageError>>({ code: "session" }),
    );
  });

  it.each(["55000", "40001"])("surfaces %s conflicts without retrying the RPC", async (code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code } });
    await expect(beginDailyBrief({ rpc } as never, {
      installationId: "14700000-0000-4000-8000-000000000001",
      retry: false,
      expectedRevision: 3,
    })).rejects.toMatchObject({ code: "context_changed" });
    expect(rpc).toHaveBeenCalledTimes(1);

    rpc.mockClear();
    await expect(saveDailyBriefPreferences(
      { rpc } as never,
      { enabled: true, useConnectedSources: true, excludedSources: noneExcluded, includeReminderHistory: false, includeNotes: false },
      2,
    )).rejects.toMatchObject({ code: "context_changed" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
