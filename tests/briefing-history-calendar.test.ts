import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { getCalendarEventsForAdvisor, getCalendarEventsForWorkbenchHistory, type CalendarCaller } from "@/lib/services/google-calendar.service";
import { readCalendarOAuthConfig, sealCalendarSecret } from "@/lib/services/google-calendar-oauth";
const mocks = vi.hoisted(() => ({ connection: vi.fn(), credential: vi.fn(), preference: vi.fn(), calendars: vi.fn(), events: vi.fn() }));
vi.mock("@/lib/db/google-calendar.repo", () => ({ readCalendarConnection: mocks.connection, readCalendarCredential: mocks.credential, removeCalendarCredential: vi.fn() }));
vi.mock("@/lib/db/daily-brief.repo", () => ({ readDailyBriefPreferences: mocks.preference }));
vi.mock("@/lib/services/google-calendar-provider", async importOriginal => ({ ...await importOriginal<object>(), readGoogleCalendarCalendars: mocks.calendars, readGoogleCalendarEvents: mocks.events }));
const user = { id: "owner", identities: [{ provider: "google", identity_data: { sub: "subject" } }] } as unknown as User;
const connection = { userId: "owner", googleSubject: "subject", status: "connected", generation: 3, selectionRevision: 4,
  preferences: { selectedCalendarIds: ["work"], hiddenCalendarIds: [], visible: true, showAllDay: true } } as const;
const preference = { enabled: true, includeCalendar: true, revision: 5, calendarConnectionGeneration: 3, calendarSelectionRevision: 4 };
const caller = { user, client: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "America/New_York" }, error: null }) }) }) }) } } as unknown as CalendarCaller;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-15T12:00Z"));
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "client"); vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "secret");
  vi.stubEnv("GOOGLE_CALENDAR_CALLBACK_URL", "https://cadence.example/auth/google-calendar/callback"); vi.stubEnv("GOOGLE_CALENDAR_LEGACY_CALLBACK_URL", "");
  vi.stubEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64")); vi.stubEnv("GOOGLE_CALENDAR_KEY_ID", "v1");
  mocks.connection.mockResolvedValue(connection); mocks.preference.mockResolvedValue(preference);
  mocks.credential.mockResolvedValue(sealCalendarSecret(readCalendarOAuthConfig()!, "refresh", { ...connection, purpose: "refresh" }));
  mocks.calendars.mockResolvedValue([{ id: "work", name: "Work", timezone: "America/New_York", primary: true, selected: true, accessRole: "owner" }]);
  mocks.events.mockResolvedValue({ ok: true, snapshot: {} });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ access_token: "ephemeral", token_type: "Bearer" }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("permits only explicit development history while keeping the production today-only adapter unchanged", async () => {
  await expect(getCalendarEventsForAdvisor(caller, "2026-11-01", "2026-11-01")).rejects.toMatchObject({ code: "invalid_request" });
  expect(mocks.events).not.toHaveBeenCalled();
  await getCalendarEventsForWorkbenchHistory(caller, "2026-11-01", "2026-11-02");
  expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ fetchedAt: "2026-11-15T12:00:00Z", range: { startLocalDate: "2026-11-01", endLocalDate: "2026-11-02",
    timezone: "America/New_York", selectedCalendarIds: ["work"] } }));
  expect(mocks.preference).toHaveBeenCalledTimes(2);
});

it.each(["production", "test"])("rejects %s before reading credentials or contacting the provider", async environment => {
  vi.stubEnv("NODE_ENV", environment);
  await expect(getCalendarEventsForWorkbenchHistory(caller, "2026-11-01", "2026-11-02")).rejects.toMatchObject({ code: "permission_denied" });
  expect(mocks.credential).not.toHaveBeenCalled(); expect(mocks.preference).not.toHaveBeenCalled(); expect(mocks.events).not.toHaveBeenCalled();
});

it.each([{ enabled: false }, { includeCalendar: false }])("checks current disclosure before credential use: %j", async change => {
  mocks.preference.mockResolvedValue({ ...preference, ...change });
  await expect(getCalendarEventsForWorkbenchHistory(caller, "2026-11-01", "2026-11-02")).rejects.toMatchObject({ code: "permission_denied" });
  expect(mocks.credential).not.toHaveBeenCalled(); expect(mocks.events).not.toHaveBeenCalled();
});

it("withholds the read after consent or Calendar selection changes during provider work", async () => {
  mocks.preference.mockResolvedValueOnce(preference).mockResolvedValueOnce({ ...preference, revision: 6, includeCalendar: false });
  await expect(getCalendarEventsForWorkbenchHistory(caller, "2026-11-01", "2026-11-02")).rejects.toMatchObject({ code: "connection_changed" });
  mocks.preference.mockResolvedValue(preference); mocks.connection.mockResolvedValueOnce(connection).mockResolvedValueOnce(connection).mockResolvedValueOnce({ ...connection, selectionRevision: 5 });
  await expect(getCalendarEventsForWorkbenchHistory(caller, "2026-11-01", "2026-11-02")).rejects.toMatchObject({ code: "connection_changed" });
});

it.each([["2026-10-01", "2026-11-01"], ["2026-11-14", "2026-11-15"], ["2026-11-02", "2026-11-01"]])("rejects unbounded or nonhistorical ranges %s through %s", async (start, end) => {
  await expect(getCalendarEventsForWorkbenchHistory(caller, start, end)).rejects.toMatchObject({ code: "invalid_request" });
  expect(mocks.events).not.toHaveBeenCalled(); expect(mocks.credential).not.toHaveBeenCalled();
});
