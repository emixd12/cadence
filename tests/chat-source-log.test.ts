import { afterEach, describe, expect, it, vi } from "vitest";

// Chat engine: a calendar or Hevy read that fails is logged with its source and code only.

const mocks = vi.hoisted(() => ({ google: vi.fn(), outlook: vi.fn(), outlookConnection: vi.fn(), icloud: vi.fn(), icloudConnection: vi.fn(), hevy: vi.fn() }));
vi.mock("@/lib/services/google-calendar.service", () => ({ getCalendarEventsForAdvisor: mocks.google }));
vi.mock("@/lib/services/outlook-calendar.service", () => ({ getOutlookCalendarEventsForCaller: mocks.outlook, getOutlookCalendarConnection: mocks.outlookConnection }));
vi.mock("@/lib/services/icloud-calendar.service", () => ({ getIcloudCalendarEventsForCaller: mocks.icloud, getIcloudCalendarConnection: mocks.icloudConnection }));
vi.mock("@/lib/services/hevy.service", () => ({ getHevyActivities: mocks.hevy }));

import { createLiveChatExecutor, liveChatConnectorReads } from "@/lib/services/chat/chat-executor";

const caller = { client: {}, user: { id: "owner" } } as never;
const on = { notes: true, googleCalendar: false, outlookCalendar: true, icloudCalendar: false, hevy: true };

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe("chat connector read logs", () => {
  it("logs a failed Outlook read with its source and code, and no message text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.outlook.mockRejectedValue(Object.assign(new Error("secret provider text"), { code: "provider_unavailable" }));
    const read = await liveChatConnectorReads(caller, on, new AbortController().signal).calendarEvents("2026-11-21", "2026-11-21");
    expect(read.sources).toEqual([{ source: "googleCalendar", state: "off" }, { source: "outlookCalendar", state: "failed" }, { source: "icloudCalendar", state: "off" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(warn.mock.calls[0]![0]));
    expect(logged).toMatchObject({ name: "chat_source_read_failed", context: { source: "outlookCalendar", code: "provider_unavailable", error_name: "Error" } });
    expect(JSON.stringify(logged)).not.toContain("secret");
  });

  it("logs a failed Hevy read the same way", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.hevy.mockRejectedValue(Object.assign(new Error("x"), { code: "timeout" }));
    await liveChatConnectorReads(caller, on, new AbortController().signal).workouts("2026-11-15", "2026-11-21");
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ context: { source: "hevy", code: "timeout" } });
  });

  it("reports Outlook connected with no calendars chosen, points to Settings, and logs nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.outlook.mockRejectedValue(Object.assign(new Error("invalid_request"), { code: "invalid_request" }));
    mocks.outlookConnection.mockResolvedValue({ status: "connected", preferences: { selectedSourceIds: [] } });
    const reads = liveChatConnectorReads(caller, on, new AbortController().signal);
    const read = await reads.calendarEvents("2026-11-21", "2026-11-21");
    expect(read.sources).toContainEqual({ source: "outlookCalendar", state: "no_calendars" });
    expect(warn).not.toHaveBeenCalled();
    const run = createLiveChatExecutor({ context: {} as never, sources: on, reads, today: () => "2026-11-21" });
    const result = await run("list_calendar_events", { start_date: "2026-11-21", end_date: "2026-11-21" }, {} as never);
    expect(JSON.stringify(result)).toContain("Outlook Calendar is connected, but no calendars are chosen");
    expect(JSON.stringify(result)).toContain("Connected sources");
  });

  it("still reports a failure when Outlook has calendars chosen", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.outlook.mockRejectedValue(Object.assign(new Error("invalid_request"), { code: "invalid_request" }));
    mocks.outlookConnection.mockResolvedValue({ status: "connected", preferences: { selectedSourceIds: ["cal-1"] } });
    const read = await liveChatConnectorReads(caller, on, new AbortController().signal).calendarEvents("2026-11-21", "2026-11-21");
    expect(read.sources).toContainEqual({ source: "outlookCalendar", state: "failed" });
  });
});
