import { describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { finishChatReply, markChatConversationGoogleCalendarTouched } from "@/lib/db/chat.repo";
import {
  computeSummaryGoogleCalendarExpiresAt,
  filterChatHistoryForRetention,
} from "@/lib/services/chat/chat.service";
import { createLiveChatExecutor, liveChatConnectorReads } from "@/lib/services/chat/chat-executor";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";

const mockGetDailyCalendarLoadForUser = vi.fn();

vi.mock("@/lib/services/daily-calendar-load.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/services/daily-calendar-load.service")>();
  return {
    ...original,
    getDailyCalendarLoadForUser: (...args: unknown[]) => mockGetDailyCalendarLoadForUser(...args),
  };
});

describe("Chat summary retention leak & list_calendar_load false-positive stamping (Findings #2, #11)", () => {
  it("excludes >30-day Google Calendar messages from history/summaries while keeping non-Google and <=30-day messages", () => {
    const nowMs = Date.parse("2026-11-25T12:00:00.000Z");
    const messages = [
      { id: "m-old-google", createdAt: "2026-10-20T12:00:00.000Z" }, // 36 days old
      { id: "m-old-plain", createdAt: "2026-10-20T12:00:00.000Z" }, // 36 days old, no Google
      { id: "m-recent-google", createdAt: "2026-11-10T12:00:00.000Z" }, // 15 days old
    ];
    const googleIds = new Set(["m-old-google", "m-recent-google"]);

    const filtered = filterChatHistoryForRetention(messages, googleIds, nowMs);
    expect(filtered.map((m) => m.id)).toEqual(["m-old-plain", "m-recent-google"]);

    // Compute summary_google_calendar_expires_at from oldest contributing Google message
    const expiresAt = computeSummaryGoogleCalendarExpiresAt(
      [
        { id: "m-recent-google", createdAt: "2026-11-10T12:00:00.000Z" },
        { id: "m-latest", createdAt: "2026-11-25T10:00:00.000Z" },
      ],
      googleIds,
      "Older summary",
      1,
      nowMs,
    );
    expect(expiresAt).toBe("2026-12-10T12:00:00.000Z");

    // Non-Google older messages yield null expiry
    const nonGoogleExpiresAt = computeSummaryGoogleCalendarExpiresAt(
      [
        { id: "m-old-plain", createdAt: "2026-10-20T12:00:00.000Z" },
        { id: "m-latest", createdAt: "2026-11-25T10:00:00.000Z" },
      ],
      googleIds,
      "Older summary",
      1,
      nowMs,
    );
    expect(nonGoogleExpiresAt).toBeNull();
  });

  it("persists summary_google_calendar_expires_at in finishChatReply alongside summary", async () => {
    const convUpdates: Array<Record<string, unknown>> = [];
    const client = {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => {
          if (table === "chat_conversations") convUpdates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      }),
    } as unknown as AppSupabaseClient;

    await finishChatReply(client, {
      conversationId: "conv-1",
      replyId: "reply-1",
      parts: [{ type: "text", text: "Done." }],
      agentRunId: "run-1",
      summary: "Summary text",
      summaryGoogleCalendarExpiresAt: "2026-12-10T12:00:00.000Z",
    });

    expect(convUpdates).toHaveLength(1);
    expect(convUpdates[0]?.summary).toBe("Summary text");
    expect(convUpdates[0]?.summary_google_calendar_expires_at).toBe("2026-12-10T12:00:00.000Z");
  });

  it("does NOT fire onGoogleCalendarRead on list_calendar_load when Google returned 0 rows and no ephemeral read occurred", async () => {
    mockGetDailyCalendarLoadForUser.mockReset();
    mockGetDailyCalendarLoadForUser.mockResolvedValue({
      days: [
        {
          local_date: "2026-11-24",
          busy_minutes: 45,
          event_count: 1,
          earliest_start_minute: 600,
          latest_end_minute: 645,
          has_all_day_busy: false,
          sources: ["outlook_calendar"],
        },
      ],
    });

    const onGoogleCalendarRead = vi.fn();
    const caller = { user: { id: "user-1" }, client: {} } as unknown as CalendarCaller;
    const reads = liveChatConnectorReads(
      caller,
      { notes: true, googleCalendar: true, outlookCalendar: true, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      {
        today: () => "2026-11-25",
        timezone: "UTC",
        onGoogleCalendarRead,
      },
    );

    // Range is within last 30 days so no ephemeral MCP read is triggered, and persisted rows are Outlook-only.
    await reads.calendarLoad!("2026-11-20", "2026-11-25");
    expect(onGoogleCalendarRead).not.toHaveBeenCalled();
  });

  it("does NOT overwrite a previously stamped google_calendar_grant_generation with null (H3)", async () => {
    const convUpdates: Array<Record<string, unknown>> = [];
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                google_calendar_first_touched_at: "2026-11-20T10:00:00.000Z",
                summary_google_calendar_expires_at: "2026-12-20T10:00:00.000Z",
              },
              error: null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          if (table === "chat_conversations") convUpdates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      }),
    } as unknown as AppSupabaseClient;

    await markChatConversationGoogleCalendarTouched(client, {
      conversationId: "conv-1",
      replyId: "reply-2",
      grantGeneration: null,
      touchedAt: "2026-11-25T10:00:00.000Z",
    });

    expect(convUpdates).toHaveLength(1);
    expect("google_calendar_grant_generation" in convUpdates[0]!).toBe(false);
  });

  it("preserves the real grant generation during plan_travel_horizon instead of clobbering with null (H3)", async () => {
    const observedGenerations: Array<number | null> = [];
    const onGoogleCalendarRead = (gen: number | null) => {
      observedGenerations.push(gen);
    };

    const executor = createLiveChatExecutor({
      context: { userId: "user-1", supabase: {} } as unknown as IntegrationContext,
      sources: { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      reads: {
        calendarEvents: async () => ({ events: [], sources: [] }),
        workouts: async () => ({ workouts: [], sources: [] }),
        travelHorizonData: async () => {
          // Simulates readSource("googleCalendar") stamping the real generation
          onGoogleCalendarRead(7);
          return {
            trips: [],
            occurrences: [],
            sources: [{ source: "googleCalendar", state: "read" }],
          };
        },
      },
      today: () => "2026-11-25",
      timezone: "UTC",
      onGoogleCalendarRead,
    });

    const result = await executor("plan_travel_horizon", { horizon_days: 7 }, { idempotencyKey: null });
    expect(result.ok).toBe(true);
    expect(observedGenerations).toEqual([7]);
  });
});
