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
    });
    expect(rpc).toHaveBeenCalledWith("read_daily_brief_preferences");
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("saves only the requested controls and expected revision", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: preferences, error: null });
    await saveDailyBriefPreferences(
      { rpc } as never,
      { enabled: true, includeCalendar: true, includeReminderHistory: false, includeNotes: true },
      2,
    );
    expect(rpc).toHaveBeenCalledWith("save_daily_brief_preferences_v2", {
      p_enabled: true,
      p_include_calendar: true,
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
});
