import { describe, expect, it, vi } from "vitest";

import {
  beginDailyBrief,
  DailyBriefStorageError,
  finishDailyBrief,
  listDailyBriefBehaviorIds,
  readDailyBriefPreferences,
  saveDailyBriefPreferences,
} from "@/lib/db/daily-brief.repo";

const preferences = {
  enabled: true,
  include_calendar: true,
  revision: 3,
  calendar_connection_generation: 7,
  calendar_selection_revision: 11,
};

describe("Daily Brief repository", () => {
  it("normalizes preferences and forwards abort signals", async () => {
    const signal = new AbortController().signal;
    const abortSignal = vi.fn().mockResolvedValue({ data: preferences, error: null });
    const rpc = vi.fn(() => ({ abortSignal }));

    await expect(readDailyBriefPreferences({ rpc } as never, signal)).resolves.toEqual({
      enabled: true,
      includeCalendar: true,
      revision: 3,
      calendarConnectionGeneration: 7,
      calendarSelectionRevision: 11,
      includeReminderHistory: false,
      includeNotes: false,
      includeOutlookCalendar: false,
      outlookConnectionGeneration: null,
      outlookSelectionRevision: null,
      includeIcloudCalendar: false,
      icloudConnectionGeneration: null,
      icloudSelectionRevision: null,
      includeHevy: false,
      hevyConnectionGeneration: null,
    });
    expect(rpc).toHaveBeenCalledWith("read_daily_brief_preferences");
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("reads connector disclosures with their bound fences and rejects a disclosure without one (Ticket 226)", async () => {
    const read = (data: unknown) => readDailyBriefPreferences({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as never);
    await expect(read({
      ...preferences, include_outlook_calendar: true, outlook_connection_generation: 4, outlook_selection_revision: 5,
      include_icloud_calendar: false, icloud_connection_generation: null, icloud_selection_revision: null,
      include_hevy: true, hevy_connection_generation: 2,
    })).resolves.toMatchObject({
      includeCalendar: true, includeOutlookCalendar: true, outlookConnectionGeneration: 4, outlookSelectionRevision: 5,
      includeIcloudCalendar: false, includeHevy: true, hevyConnectionGeneration: 2,
    });
    await expect(read({ ...preferences, include_hevy: true, hevy_connection_generation: null })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, include_outlook_calendar: true, outlook_connection_generation: 4 })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, include_hevy: false, hevy_connection_generation: 2 })).rejects.toThrow("invalid result");
    await expect(read({ ...preferences, include_hevy: "true", hevy_connection_generation: 2 })).rejects.toThrow("invalid result");
  });

  it("saves only the requested controls and expected revision", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: preferences, error: null });
    await saveDailyBriefPreferences(
      { rpc } as never,
      { enabled: true, includeCalendar: true, includeReminderHistory: false, includeNotes: true },
      2,
    );
    expect(rpc).toHaveBeenCalledWith("save_daily_brief_preferences_v3", {
      p_enabled: true,
      p_include_calendar: true,
      p_include_reminder_history: false,
      p_include_notes: true,
      p_include_outlook_calendar: false,
      p_include_icloud_calendar: false,
      p_include_hevy: false,
      p_expected_revision: 2,
    });
    await saveDailyBriefPreferences(
      { rpc } as never,
      { enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false, includeOutlookCalendar: true, includeHevy: true },
      3,
    );
    expect(rpc).toHaveBeenLastCalledWith("save_daily_brief_preferences_v3", expect.objectContaining({
      p_include_calendar: false, p_include_outlook_calendar: true, p_include_icloud_calendar: false, p_include_hevy: true, p_expected_revision: 3,
    }));
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
      { enabled: true, includeCalendar: true, includeReminderHistory: false, includeNotes: false },
      2,
    )).rejects.toMatchObject({ code: "context_changed" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
