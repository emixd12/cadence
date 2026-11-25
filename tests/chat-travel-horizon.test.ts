import { describe, expect, it, vi } from "vitest";
import { createLiveChatExecutor, liveChatConnectorReads } from "@/lib/services/chat/chat-executor";
import { runChatConfirm, runChatUndo } from "@/lib/services/chat/chat-confirm";
import { withRevision } from "@/lib/services/chat/chat-writes";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";

const mockGetCalendarEventsForAdvisor = vi.fn();
const mockGetCalendarConnection = vi.fn();

vi.mock("@/lib/services/google-calendar.service", () => ({
  getCalendarEventsForAdvisor: (...args: unknown[]) => mockGetCalendarEventsForAdvisor(...args),
  getCalendarConnection: (...args: unknown[]) => mockGetCalendarConnection(...args),
}));

vi.mock("@/lib/services/model-armor.service", () => ({
  screenExternalCalendarTextWithModelArmor: async ({ text }: { text: string }) => ({ text, blocked: false }),
}));

describe("Chat cross-day move execution, revision guard, and undo (Finding #1)", () => {
  function makeOccurrenceDb(initial: {
    id: string;
    behavior_id: string;
    local_date: string;
    scheduled_for: string;
    effective_start_at: string;
    effective_end_at: string;
    status: string;
    updated_at: string;
  }) {
    let row = { ...initial };
    let updateCounter = 0;

    const supabase = {
      from: (table: string) => {
        if (table === "occurrences") {
          return {
            select: () => ({
              eq: (_col1: string, val1: string) => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: val1 === row.id ? { ...row } : null,
                    error: null,
                  }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: (_c1: string, id: string) => ({
                eq: () => ({
                  eq: (_c3: string, expectedRev: string) => ({
                    select: () => ({
                      maybeSingle: async () => {
                        if (id !== row.id || expectedRev !== row.updated_at) {
                          return { data: null, error: null };
                        }
                        updateCounter += 1;
                        row = {
                          ...row,
                          local_date: patch.local_date as string,
                          scheduled_for: patch.scheduled_for as string,
                          effective_start_at: patch.effective_start_at as string,
                          effective_end_at: patch.effective_end_at as string,
                          updated_at: `2026-11-25T15:0${updateCounter}:00.000Z`,
                        };
                        return { data: { ...row }, error: null };
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { title: "Gym", timezone: "America/New_York", default_duration_minutes: 60 },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    };

    return { supabase, getRow: () => row };
  }

  it("fills expected_revision in withRevision for move_occurrence_to_date", () => {
    const call = withRevision(
      { name: "move_occurrence_to_date", args: { occurrence_id: "occ-1", target_local_date: "2026-11-26", start_time: "09:00" } },
      { occurrence: { id: "occ-1", revision: "2026-11-25T12:00:00.000Z" } },
    );
    expect(call.args.expected_revision).toBe("2026-11-25T12:00:00.000Z");
  });

  it("executes move_occurrence_to_date on confirm Yes, enforces expected_revision, and restores original date/time on Undo", async () => {
    const db = makeOccurrenceDb({
      id: "occ-1",
      behavior_id: "beh-1",
      local_date: "2026-11-25",
      scheduled_for: "2026-11-25T14:00:00.000Z",
      effective_start_at: "2026-11-25T14:00:00.000Z",
      effective_end_at: "2026-11-25T15:00:00.000Z",
      status: "unresolved",
      updated_at: "2026-11-25T12:00:00.000Z",
    });

    const liveExecutor = createLiveChatExecutor({
      context: { userId: "user-1", supabase: db.supabase } as unknown as IntegrationContext,
      sources: { notes: true, googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false },
      reads: {
        calendarEvents: async () => ({ events: [], sources: [] }),
        workouts: async () => ({ workouts: [], sources: [] }),
      },
      today: () => "2026-11-25",
      timezone: "America/New_York",
    });

    const executor: typeof liveExecutor = async (name, args, options) => {
      if (name === "get_occurrence") {
        const current = db.getRow();
        return {
          ok: true,
          result: {
            occurrence: {
              ...current,
              behavior_title: "Gym",
              timezone: "America/New_York",
              revision: current.updated_at,
            },
          },
        };
      }
      return liveExecutor(name, args, options);
    };

    // Stale revision is refused
    const stale = await executor(
      "move_occurrence_to_date",
      {
        occurrence_id: "occ-1",
        target_local_date: "2026-11-26",
        start_time: "10:00",
        expected_revision: "2026-11-25T11:00:00.000Z",
      },
      { idempotencyKey: null },
    );
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect((stale.result as { outcome: string; refusal: { reason: string } }).outcome).toBe("refused");
      expect((stale.result as { refusal: { reason: string } }).refusal.reason).toBe("revision_changed");
    }

    // Confirm Yes executes the cross-day move
    const confirmRun = await runChatConfirm({
      confirmId: "confirm-1",
      executor,
      writes: [
        {
          call: {
            name: "move_occurrence_to_date",
            args: { occurrence_id: "occ-1", target_local_date: "2026-11-26", start_time: "10:00" },
          },
          item: { kind: "move", text: "Move Gym to Thu Nov 26 at 10 am" },
          guard: { kind: "occurrence", id: "occ-1", revision: "2026-11-25T12:00:00.000Z" },
        },
      ],
    });

    expect(confirmRun.state).toBe("accepted");
    expect(confirmRun.writes).toHaveLength(1);
    expect(db.getRow().local_date).toBe("2026-11-26");
    expect(db.getRow().effective_start_at).toBe("2026-11-26T15:00:00Z"); // 10:00 America/New_York = 15:00Z

    const write = confirmRun.writes[0]!;
    expect(write.undo?.call.name).toBe("move_occurrence_to_date");
    expect(write.undo?.call.args.target_local_date).toBe("2026-11-25");

    // Undo restores the original date and time
    const undoRun = await runChatUndo({
      outcome: write.outcome,
      plan: write.undo!,
      executor,
      idempotencyKey: "undo-1",
    });
    expect(undoRun.ok).toBe(true);
    expect(db.getRow().local_date).toBe("2026-11-25");
    expect(db.getRow().effective_start_at).toBe("2026-11-25T14:00:00Z");
  });
});

describe("Wired liveChatConnectorReads travelHorizonData, longitudinalData, grantGeneration, and no_calendars (Findings #3, #6, #8)", () => {
  it("reads Google Calendar events with connection.generation, extracts trips, and loads occurrences", async () => {
    mockGetCalendarEventsForAdvisor.mockReset();
    mockGetCalendarEventsForAdvisor.mockResolvedValue({
      connection: { generation: 9 },
      result: {
        ok: true,
        snapshot: {
          events: [
            {
              kind: "timed",
              state: "confirmed",
              availability: "busy",
              currentUserResponse: "accepted",
              title: "Client Lunch",
              calendarName: "Work",
              startAt: "2026-11-25T17:00:00Z",
              endAt: "2026-11-25T18:00:00Z",
              endUnspecified: false,
              duration: { kind: "known", seconds: 3600 },
              location: "Midtown Cafe",
            },
          ],
        },
      },
    });

    const touchedGenerations: Array<number | null> = [];
    const caller = {
      user: { id: "user-1" },
      client: {
        from: (table: string) => {
          if (table === "occurrences") {
            return {
              select: () => ({
                eq: () => ({
                  gte: () => ({
                    lte: () => ({
                      eq: async () => ({
                        data: [
                          {
                            id: "occ-1",
                            behavior_id: "beh-1",
                            local_date: "2026-11-25",
                            scheduled_for: "2026-11-25T17:30:00Z",
                            effective_start_at: "2026-11-25T17:30:00Z",
                            effective_end_at: "2026-11-25T18:00:00Z",
                            status: "unresolved",
                            schedule_kind: "exact",
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
          return {
            select: () => ({
              eq: () => ({
                gte: () => ({
                  lte: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          };
        },
      },
    } as unknown as CalendarCaller;

    const reads = liveChatConnectorReads(
      caller,
      { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      {
        today: () => "2026-11-25",
        timezone: "UTC",
        onGoogleCalendarRead: (gen) => {
          touchedGenerations.push(gen);
        },
      },
    );

    const horizon = await reads.travelHorizonData!(7);
    expect(touchedGenerations).toEqual([9]);
    expect(horizon.trips).toHaveLength(1);
    expect(horizon.trips[0]?.tripLabel).toBe("Client Lunch");
    expect(horizon.trips[0]?.destinationLabel).toBe("Midtown Cafe");
    expect(horizon.occurrences).toHaveLength(1);
    expect(horizon.occurrences[0]?.occurrenceRef).toBe("occ-1");
  });

  it("reports no_calendars when Google AI grant is connected with 0 selected calendars", async () => {
    mockGetCalendarEventsForAdvisor.mockReset();
    mockGetCalendarConnection.mockReset();
    mockGetCalendarEventsForAdvisor.mockRejectedValue({ code: "invalid_request" });
    mockGetCalendarConnection.mockResolvedValue({
      status: "connected",
      preferences: { selectedCalendarIds: [] },
    });

    const caller = { user: { id: "user-1" }, client: {} } as unknown as CalendarCaller;
    const reads = liveChatConnectorReads(
      caller,
      { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      { today: () => "2026-11-25", timezone: "UTC" },
    );

    const ev = await reads.calendarEvents("2026-11-25", "2026-11-25");
    expect(ev.sources).toContainEqual({ source: "googleCalendar", state: "no_calendars" });
  });
});
