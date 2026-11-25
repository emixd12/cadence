import { describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { markChatConversationGoogleCalendarTouched, readChatHistory } from "@/lib/db/chat.repo";
import { createLiveChatExecutor, liveChatConnectorReads } from "@/lib/services/chat/chat-executor";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";

const mockGetCalendarEventsForAdvisor = vi.fn();
const mockGetDailyCalendarLoadForUser = vi.fn();

vi.mock("@/lib/services/google-calendar.service", () => ({
  getCalendarEventsForAdvisor: (...args: unknown[]) => mockGetCalendarEventsForAdvisor(...args),
}));

vi.mock("@/lib/services/daily-calendar-load.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/daily-calendar-load.service")>();
  return {
    ...original,
    getDailyCalendarLoadForUser: (...args: unknown[]) => mockGetDailyCalendarLoadForUser(...args),
  };
});

describe("Chat Google Calendar retention & ephemeral >30d load (Q2, Q4, Q8)", () => {
  it("stamps Google Calendar provenance immediately and preserves earliest first_touched_at", async () => {
    const convUpdates: Array<Record<string, unknown>> = [];
    const msgUpdates: Array<Record<string, unknown>> = [];
    let storedConv: { google_calendar_first_touched_at: string | null; summary_google_calendar_expires_at: string | null } = {
      google_calendar_first_touched_at: null,
      summary_google_calendar_expires_at: null,
    };

    const client = {
      from: (table: string) => {
        if (table === "chat_conversations") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: storedConv, error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              convUpdates.push(payload);
              storedConv = {
                google_calendar_first_touched_at: payload.google_calendar_first_touched_at as string,
                summary_google_calendar_expires_at: payload.summary_google_calendar_expires_at as string,
              };
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        return {
          update: (payload: Record<string, unknown>) => {
            msgUpdates.push(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    } as unknown as AppSupabaseClient;

    await markChatConversationGoogleCalendarTouched(client, {
      conversationId: "conv-1",
      replyId: "reply-1",
      grantGeneration: 4,
      touchedAt: "2026-11-01T12:00:00.000Z",
    });

    expect(convUpdates[0]).toEqual({
      google_calendar_first_touched_at: "2026-11-01T12:00:00.000Z",
      google_calendar_grant_generation: 4,
      summary_google_calendar_expires_at: "2026-12-01T12:00:00.000Z",
    });
    expect(msgUpdates[0]).toEqual({ contains_google_calendar: true });

    // A later turn on Nov 15 MUST NOT push out first_touched_at or summary expiry.
    await markChatConversationGoogleCalendarTouched(client, {
      conversationId: "conv-1",
      replyId: "reply-2",
      grantGeneration: 4,
      touchedAt: "2026-11-15T12:00:00.000Z",
    });

    expect(convUpdates[1]?.google_calendar_first_touched_at).toBe("2026-11-01T12:00:00.000Z");
    expect(convUpdates[1]?.summary_google_calendar_expires_at).toBe("2026-12-01T12:00:00.000Z");
  });

  it("enforces <=30-day read-time summary expiry while keeping conversation messages intact", async () => {
    const makeClient = (expiresAt: string | null) =>
      ({
        from: (table: string) => {
          if (table === "chat_messages") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: [
                          {
                            id: "m-1",
                            role: "user",
                            created_at: "2026-10-01T10:00:00.000Z",
                            parts: [{ type: "text", text: "What is on my calendar?" }],
                            state: "complete",
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "chat_conversations") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      summary: "Earlier summary mentioning calendar",
                      summary_google_calendar_expires_at: expiresAt,
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          };
        },
      }) as unknown as AppSupabaseClient;

    const nowMs = Date.parse("2026-11-25T12:00:00.000Z");
    const expired = await readChatHistory(makeClient("2026-11-20T00:00:00.000Z"), "conv-1", undefined, nowMs);
    expect(expired.summary).toBeNull();
    expect(expired.messages).toHaveLength(1);

    const active = await readChatHistory(makeClient("2026-12-10T00:00:00.000Z"), "conv-1", undefined, nowMs);
    expect(active.summary).toBe("Earlier summary mentioning calendar");
    expect(active.messages).toHaveLength(1);
  });

  it("computes >30-day Google Calendar load ephemerally in memory and degrades gracefully on MCP budget exceeded", async () => {
    mockGetCalendarEventsForAdvisor.mockReset();
    mockGetDailyCalendarLoadForUser.mockReset();

    mockGetDailyCalendarLoadForUser.mockResolvedValue({
      days: [
        {
          local_date: "2026-11-20",
          busy_minutes: 60,
          event_count: 1,
          earliest_start_minute: 540,
          latest_end_minute: 600,
          has_all_day_busy: false,
          sources: ["google_calendar"],
        },
      ],
    });

    mockGetCalendarEventsForAdvisor.mockResolvedValue({
      grantGeneration: 2,
      result: {
        ok: true,
        snapshot: {
          events: [
            {
              kind: "timed",
              state: "confirmed",
              availability: "busy",
              currentUserResponse: "accepted",
              title: "Quarterly review",
              calendarName: "Work",
              startAt: "2026-10-15T14:00:00Z",
              endAt: "2026-10-15T15:30:00Z",
              endUnspecified: false,
              duration: { kind: "known", seconds: 90 * 60 },
              location: null,
            },
          ],
        },
      },
    });

    const touchedCalls: Array<number | null> = [];
    const caller = {
      user: { id: "user-1" },
      client: {} as AppSupabaseClient,
    } as unknown as CalendarCaller;

    const reads = liveChatConnectorReads(
      caller,
      { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      {
        today: () => "2026-11-25",
        timezone: "UTC",
        onGoogleCalendarRead: (gen) => {
          touchedCalls.push(gen);
        },
      },
    );

    const load = await reads.calendarLoad!("2026-10-10", "2026-11-25");
    expect(touchedCalls.length).toBeGreaterThan(0);
    expect(mockGetCalendarEventsForAdvisor).toHaveBeenCalledWith(
      caller,
      "2026-10-10",
      "2026-10-25",
      expect.objectContaining({ allowPastDates: true, ephemeralOnly: true }),
    );
    const oct15 = load.days.find((d) => d.local_date === "2026-10-15");
    expect(oct15?.busy_minutes).toBe(90);

    // Graceful degradation on mcp_daily_budget_exceeded:
    mockGetCalendarEventsForAdvisor.mockRejectedValueOnce({ code: "mcp_daily_budget_exceeded" });
    const executor = createLiveChatExecutor({
      context: {} as IntegrationContext,
      sources: { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      reads,
      today: () => "2026-11-25",
      timezone: "UTC",
    });
    const evRes = await executor("list_calendar_events", { start_date: "2026-11-25", end_date: "2026-11-25" }, { idempotencyKey: null });
    expect(evRes.ok).toBe(true);
    if (evRes.ok) {
      const payload = evRes.result as { note: string | null; sources: Array<{ source: string; state: string }> };
      expect(payload.sources).toContainEqual({ source: "googleCalendar", state: "unavailable" });
      expect(payload.note).toContain("Google Calendar is temporarily unavailable for AI features.");
    }
  });
});
