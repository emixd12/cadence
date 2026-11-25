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

const mockListTimeSessionsByOccurrenceIds = vi.fn();

vi.mock("@/lib/db/timeSessions.repo", () => ({
  listTimeSessionsByOccurrenceIds: (...args: unknown[]) => mockListTimeSessionsByOccurrenceIds(...args),
}));

vi.mock("@/lib/services/model-armor.service", () => ({
  screenExternalCalendarTextWithModelArmor: async ({ text }: { text: string }) => ({ text, blocked: false }),
}));

describe("Chat cross-day move execution, revision guard, and undo (Finding #1)", () => {
  function makeOccurrenceDb(
    initial: {
      id: string;
      behavior_id: string;
      local_date: string;
      scheduled_for: string;
      effective_start_at: string | null;
      effective_end_at: string | null;
      status: string;
      updated_at: string;
    },
    behaviorDurationMinutes: number | null = 60,
    occupiedDates: readonly string[] = [],
  ) {
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
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { title: "Gym", timezone: "America/New_York", default_duration_minutes: behaviorDurationMinutes },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
      rpc: async (fn: string, params: Record<string, unknown>) => {
        if (fn !== "move_occurrence_to_date") {
          return { data: null, error: new Error(`Unexpected rpc: ${fn}`) };
        }
        if (params.p_occurrence_id !== row.id) {
          return { data: { ok: false, reason: "not_found" }, error: null };
        }
        if (row.status !== "unresolved") {
          return { data: { ok: false, reason: "already_resolved" }, error: null };
        }
        if (params.p_expected_revision !== row.updated_at) {
          return { data: { ok: false, reason: "revision_changed" }, error: null };
        }
        // Like the SQL function: one row per schedule slot and day.
        if (params.p_target_local_date !== row.local_date && occupiedDates.includes(params.p_target_local_date as string)) {
          return { data: { ok: false, reason: "destination_conflict" }, error: null };
        }
        const targetStart = params.p_target_start_at as string;
        const targetEnd = (params.p_target_end_at as string | null) ?? targetStart; // exact: no planned length
        // The plan never changes; back on the planned day and time clears the effective time.
        const toPlan = params.p_target_local_date === row.scheduled_for.slice(0, 10)
          && Date.parse(targetStart) === Date.parse(row.scheduled_for)
          && params.p_target_end_at === null;
        const previous = {
          local_date: row.local_date,
          scheduled_for: row.scheduled_for,
          effective_start_at: row.effective_start_at,
          effective_end_at: row.effective_end_at,
        };
        updateCounter += 1;
        row = {
          ...row,
          local_date: params.p_target_local_date as string,
          effective_start_at: toPlan ? null : targetStart,
          effective_end_at: toPlan ? null : targetEnd,
          updated_at: `2026-11-25T15:0${updateCounter}:00.000Z`,
        };
        return {
          data: {
            ok: true,
            occurrence: {
              id: row.id,
              behavior_id: row.behavior_id,
              local_date: row.local_date,
              scheduled_for: row.scheduled_for,
              effective_start_at: row.effective_start_at,
              effective_end_at: row.effective_end_at,
              updated_at: row.updated_at,
            },
            previous,
          },
          error: null,
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
    expect(db.getRow().effective_end_at).toBe("2026-11-26T16:00:00Z");
    // The recurrence identity stays the plan.
    expect(db.getRow().scheduled_for).toBe("2026-11-25T14:00:00.000Z");

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
    // Back at the planned time: the row follows its plan again.
    expect(db.getRow().scheduled_for).toBe("2026-11-25T14:00:00.000Z");
    expect(db.getRow().effective_start_at).toBeNull();
  });

  it("refuses a move onto a day that already holds the same slot, without an error", async () => {
    const db = makeOccurrenceDb(
      {
        id: "occ-daily",
        behavior_id: "beh-daily",
        local_date: "2026-11-25",
        scheduled_for: "2026-11-25T14:00:00.000Z",
        effective_start_at: null,
        effective_end_at: null,
        status: "unresolved",
        updated_at: "2026-11-25T12:00:00.000Z",
      },
      30,
      ["2026-11-26"],
    );
    const executor = createLiveChatExecutor({
      context: { userId: "user-1", supabase: db.supabase } as unknown as IntegrationContext,
      sources: { notes: true, googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false },
      reads: {
        calendarEvents: async () => ({ events: [], sources: [] }),
        workouts: async () => ({ workouts: [], sources: [] }),
      },
      today: () => "2026-11-25",
      timezone: "America/New_York",
    });
    const result = await executor(
      "move_occurrence_to_date",
      { occurrence_id: "occ-daily", target_local_date: "2026-11-26", start_time: "10:00", expected_revision: "2026-11-25T12:00:00.000Z" },
      { idempotencyKey: null },
    );
    expect(result).toEqual({
      ok: true,
      result: {
        outcome: "refused",
        refusal: { reason: "destination_conflict", message: "That day already has this item at the same time slot." },
      },
    });
    expect(db.getRow().local_date).toBe("2026-11-25");
  });

  it("handles a null-duration cross-day move and Undo back to the plan", async () => {
    const db = makeOccurrenceDb(
      {
        id: "occ-null-dur",
        behavior_id: "beh-2",
        local_date: "2026-11-25",
        scheduled_for: "2026-11-25T14:00:00.000Z",
        effective_start_at: null,
        effective_end_at: null,
        status: "unresolved",
        updated_at: "2026-11-25T12:00:00.000Z",
      },
      null,
    );

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

    const confirmRun = await runChatConfirm({
      confirmId: "confirm-null-dur",
      executor,
      writes: [
        {
          call: {
            name: "move_occurrence_to_date",
            args: { occurrence_id: "occ-null-dur", target_local_date: "2026-11-26", start_time: "10:00" },
          },
          item: { kind: "move", text: "Move Gym to Thu Nov 26 at 10 am" },
          guard: { kind: "occurrence", id: "occ-null-dur", revision: "2026-11-25T12:00:00.000Z" },
        },
      ],
    });

    expect(confirmRun.state).toBe("accepted");
    expect(db.getRow().local_date).toBe("2026-11-26");
    // No duration: the plan stays, and the effective time takes the schedule's own length.
    expect(db.getRow().scheduled_for).toBe("2026-11-25T14:00:00.000Z");
    expect(db.getRow().effective_start_at).toBe("2026-11-26T15:00:00Z");
    expect(db.getRow().effective_end_at).toBe("2026-11-26T15:00:00Z");

    const write = confirmRun.writes[0]!;
    const undoRun = await runChatUndo({
      outcome: write.outcome,
      plan: write.undo!,
      executor,
      idempotencyKey: "undo-null-dur",
    });
    expect(undoRun.ok).toBe(true);
    expect(db.getRow().local_date).toBe("2026-11-25");
    expect(db.getRow().scheduled_for).toBe("2026-11-25T14:00:00.000Z");
    expect(db.getRow().effective_start_at).toBeNull();
    expect(db.getRow().effective_end_at).toBeNull();
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

  it("reports no_calendars and skips onGoogleCalendarRead when advisor read succeeds with 0 selected calendars (M1)", async () => {
    mockGetCalendarEventsForAdvisor.mockReset();
    mockGetCalendarEventsForAdvisor.mockResolvedValue({
      connection: { generation: 5 },
      result: {
        ok: true,
        snapshot: {
          requestedRange: { selectedCalendarIds: [] },
          events: [],
        },
      },
    });

    const onGoogleCalendarRead = vi.fn();
    const caller = { user: { id: "user-1" }, client: {} } as unknown as CalendarCaller;
    const reads = liveChatConnectorReads(
      caller,
      { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      { today: () => "2026-11-25", timezone: "UTC", onGoogleCalendarRead },
    );

    const ev = await reads.calendarEvents("2026-11-25", "2026-11-25");
    expect(ev.sources).toContainEqual({ source: "googleCalendar", state: "no_calendars" });
    expect(onGoogleCalendarRead).not.toHaveBeenCalled();
  });
});

describe("plan_travel_horizon route estimates (PR #398 review)", () => {
  const lunchEvent = {
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
  };
  const emptyCaller = {
    user: { id: "user-1" },
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({ eq: async () => ({ data: [], error: null }) }),
            }),
          }),
        }),
      }),
    },
  } as unknown as CalendarCaller;
  // The Timeline refresh's display projection: one routed outbound leg to the lunch.
  const evidence = {
    version: 1,
    journeyRef: "2026-11-25:2026-11-25",
    legs: [
      {
        leg: {
          id: "leg-1", role: "outbound", journeyRef: "2026-11-25:2026-11-25", originCommitmentRef: null,
          destinationCommitmentRef: "event-lunch", mode: "driving", readyAt: "2026-11-25T16:20:00Z", provenance: {},
        },
        state: "current",
        estimate: {
          durationSeconds: 25 * 60, departureAt: "2026-11-25T16:30:00Z", arrivalAt: "2026-11-25T16:55:00Z",
          warnings: [], fallback: false, attribution: "Google", observedAt: "2026-11-25T12:00:00Z", expiresAt: "2026-11-25T18:00:00Z",
        },
        reason: null,
      },
    ],
    unknownLegs: [],
    segments: [
      { id: "seg-1", kind: "commitment", startAt: "2026-11-25T17:00:00Z", endAt: "2026-11-25T18:00:00Z", sourceRefs: ["event-lunch"], legId: null },
    ],
    occupiedSpans: [],
    collisions: [],
    completeTrip: true,
    finalAvailabilityAt: null,
  };

  async function planWith(travelRouteEvidence: (localDate: string) => Promise<unknown>) {
    mockGetCalendarEventsForAdvisor.mockReset();
    mockGetCalendarEventsForAdvisor.mockResolvedValue({ connection: { generation: 1 }, result: { ok: true, snapshot: { events: [lunchEvent] } } });
    const requestedDays: string[] = [];
    const reads = liveChatConnectorReads(
      emptyCaller,
      { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      {
        today: () => "2026-11-25",
        timezone: "UTC",
        travelRouteEvidence: async (localDate) => {
          requestedDays.push(localDate);
          return (await travelRouteEvidence(localDate)) as never;
        },
      },
    );
    const executor = createLiveChatExecutor({
      context: {} as IntegrationContext,
      sources: { notes: true, googleCalendar: true, outlookCalendar: false, icloudCalendar: false, hevy: false },
      reads,
      today: () => "2026-11-25",
      timezone: "UTC",
    });
    const result = await executor("plan_travel_horizon", { horizon_days: 7 }, { idempotencyKey: null });
    return { result, requestedDays, horizon: await reads.travelHorizonData!(7) };
  }

  it("fills leave-by and duration from the routed leg, shows them only in the inline card", async () => {
    const { result, requestedDays, horizon } = await planWith(async () => evidence);
    // Only days with a located event are routed.
    expect(requestedDays[0]).toBe("2026-11-25");
    expect(new Set(requestedDays)).toEqual(new Set(["2026-11-25"]));
    expect(horizon.trips[0]).toMatchObject({
      departureAt: "2026-11-25T16:30:00Z",
      arrivalAt: "2026-11-25T16:55:00Z",
      durationSeconds: 1500,
      mode: "driving",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uiTravelCards).toHaveLength(1);
    expect(result.uiTravelCards?.[0]).toMatchObject({ tripLabel: "Client Lunch", leaveByLocalTime: "16:30", durationMinutes: 25 });
    // L-001: the model payload carries no leave-by time, duration or place.
    const modelPayload = JSON.stringify(result.result);
    expect(modelPayload).not.toContain("16:30");
    expect(modelPayload).not.toContain("leaveByLocalTime");
    expect(modelPayload).not.toContain("durationMinutes");
    expect(modelPayload).not.toContain("Midtown Cafe");
  });

  it("keeps the trip without estimates when routing fails", async () => {
    const { result, horizon } = await planWith(async () => {
      throw new Error("context_changed");
    });
    expect(horizon.trips).toHaveLength(1);
    expect(horizon.trips[0]).toMatchObject({ departureAt: null, durationSeconds: null, arrivalAt: "2026-11-25T17:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uiTravelCards ?? []).toHaveLength(0);
  });

  it("keeps the trip without estimates when travel is off (no evidence)", async () => {
    const { horizon } = await planWith(async () => null);
    expect(horizon.trips[0]).toMatchObject({ departureAt: null, durationSeconds: null });
  });
});

describe("get_longitudinal_patterns tracked durations (PR #398 review)", () => {
  function longitudinalCaller(rows: readonly Record<string, unknown>[]) {
    return {
      user: { id: "user-1" },
      client: {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: async () => ({ data: table === "occurrences" ? rows : [], error: null }),
              }),
            }),
          }),
        }),
      },
    } as unknown as CalendarCaller;
  }

  it("takes tracked minutes from finished time sessions, never from planned or moved times", async () => {
    mockListTimeSessionsByOccurrenceIds.mockReset();
    mockListTimeSessionsByOccurrenceIds.mockResolvedValue([
      { id: "s-1", user_id: "user-1", occurrence_id: "occ-timed", behavior_id: "beh-1", started_at: "2026-11-24T14:00:00Z", stopped_at: "2026-11-24T14:20:00Z" },
      { id: "s-2", user_id: "user-1", occurrence_id: "occ-timed", behavior_id: "beh-1", started_at: "2026-11-24T15:00:00Z", stopped_at: "2026-11-24T15:25:00Z" },
      // A running session (no stop) adds nothing.
      { id: "s-3", user_id: "user-1", occurrence_id: "occ-running", behavior_id: "beh-1", started_at: "2026-11-25T14:00:00Z", stopped_at: null },
    ]);
    const reads = liveChatConnectorReads(
      longitudinalCaller([
        { id: "occ-timed", behavior_id: "beh-1", local_date: "2026-11-24", status: "completed" },
        // Moved, still unresolved, no session: an hour of moved time is not tracked time.
        { id: "occ-moved", behavior_id: "beh-1", local_date: "2026-11-25", status: "unresolved", effective_start_at: "2026-11-25T15:00:00Z", effective_end_at: "2026-11-25T16:00:00Z" },
        { id: "occ-running", behavior_id: "beh-1", local_date: "2026-11-25", status: "unresolved" },
      ]),
      { notes: true, googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      { today: () => "2026-11-25", timezone: "UTC" },
    );

    const data = await reads.longitudinalData!(7);
    expect(mockListTimeSessionsByOccurrenceIds).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      occurrenceIds: ["occ-timed", "occ-moved", "occ-running"],
    });
    const byDate = data.occurrences.map((record) => [record.localDate, record.status, record.trackedDurationMinutes]);
    expect(byDate).toEqual([
      ["2026-11-24", "completed", 45],
      ["2026-11-25", "unresolved", null],
      ["2026-11-25", "unresolved", null],
    ]);
  });

  it("gives no tracked minutes when the session history cannot be read", async () => {
    mockListTimeSessionsByOccurrenceIds.mockReset();
    mockListTimeSessionsByOccurrenceIds.mockRejectedValue(new Error("db down"));
    const reads = liveChatConnectorReads(
      longitudinalCaller([{ id: "occ-1", behavior_id: "beh-1", local_date: "2026-11-24", status: "completed" }]),
      { notes: true, googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false },
      new AbortController().signal,
      { today: () => "2026-11-25", timezone: "UTC" },
    );
    const data = await reads.longitudinalData!(7);
    expect(data.occurrences).toHaveLength(1);
    expect(data.occurrences[0]?.trackedDurationMinutes).toBeNull();
  });
});
