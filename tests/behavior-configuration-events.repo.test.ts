import { describe, expect, it, vi } from "vitest";

import { listBehaviorConfigurationEvents } from "../lib/db/behaviorConfigurationEvents.repo";
import type { AppSupabaseClient } from "../lib/db/behaviors.repo";
import type { BehaviorConfigurationEvent } from "../lib/types/database";
import { storedConfigurationEvent } from "./helpers/export-row-fixture";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const RECORDED_AT = "2026-08-15T03:00:00Z";

describe("behavior configuration events repository", () => {
  it("normalizes Mac-written snapshots while preserving hosted rows and pagination metadata", async () => {
    const snapshot = storedConfigurationEvent().next_configuration;
    const macSnapshot = {
      categoryId: snapshot.category_id,
      scheduleGraph: snapshot.schedule_graph.map((schedule) => ({
        recurrenceRule: schedule.recurrence_rule,
        sortOrder: schedule.sort_order,
        timeEntries: schedule.time_entries.map((entry) => ({
          kind: entry.kind, preset: entry.preset, startTime: entry.start_time,
          endTime: entry.end_time, sortOrder: entry.sort_order,
        })),
      })),
      browserReminderEnabled: snapshot.browser_reminder_enabled,
      emailReminderEnabled: snapshot.email_reminder_enabled,
      reminderOffsetMinutes: snapshot.reminder_offset_minutes,
      active: snapshot.active,
      timezone: snapshot.timezone,
    };
    const hosted = { ...storedEvent("event-0000"), previous_configuration: null };
    const mac = { ...storedEvent("event-0001"), previous_configuration: macSnapshot, next_configuration: macSnapshot };
    const from = vi.fn()
      .mockReturnValueOnce(queryBuilder({ data: [{ id: mac.id, recorded_at: RECORDED_AT }], error: null }))
      .mockReturnValueOnce(queryBuilder({ data: [hosted, mac], error: null }));

    const result = await listBehaviorConfigurationEvents({ from } as unknown as AppSupabaseClient, USER_ID);

    expect(result[0]).toEqual(hosted);
    expect(result[1]).toEqual({
      ...mac,
      previous_configuration: { ...snapshot, location_text: null },
      next_configuration: { ...snapshot, location_text: null },
    });
    expect(mac.next_configuration).toHaveProperty("scheduleGraph");
  });

  it("reads past the Data API row cap with a fixed high-water and keyset cursor", async () => {
    const events = Array.from({ length: 1_001 }, (_, index) =>
      storedEvent(`event-${String(index).padStart(4, "0")}`),
    );
    const highWaterBuilder = queryBuilder({
      data: [{ id: events[1_000].id, recorded_at: RECORDED_AT }],
      error: null,
    });
    const firstPageBuilder = queryBuilder({
      data: events.slice(0, 1_000),
      error: null,
    });
    const secondPageBuilder = queryBuilder({
      data: events.slice(1_000),
      error: null,
    });
    const from = vi
      .fn()
      .mockReturnValueOnce(highWaterBuilder)
      .mockReturnValueOnce(firstPageBuilder)
      .mockReturnValueOnce(secondPageBuilder);
    const supabase = { from } as unknown as AppSupabaseClient;

    const result = await listBehaviorConfigurationEvents(supabase, USER_ID);

    expect(result).toHaveLength(1_001);
    expect(result[0]?.id).toBe("event-0000");
    expect(result.at(-1)?.id).toBe("event-1000");
    expect(secondPageBuilder.or).toHaveBeenCalledWith(
      `recorded_at.gt.${RECORDED_AT},and(recorded_at.eq.${RECORDED_AT},id.gt.event-0999)`,
    );
    expect(firstPageBuilder.lte).toHaveBeenCalledWith(
      "recorded_at",
      RECORDED_AT,
    );
  });

  it("returns exactly 100,000 events when the high-water is the ceiling row", async () => {
    const supabase = pagedSupabase(100_000);

    const result = await listBehaviorConfigurationEvents(supabase, USER_ID);

    expect(result).toHaveLength(100_000);
    expect(result.at(-1)?.id).toBe("event-099999");
  });

  it("fails loudly when the captured high-water proves a 100,001st event", async () => {
    const supabase = pagedSupabase(100_001);

    await expect(
      listBehaviorConfigurationEvents(supabase, USER_ID),
    ).rejects.toThrow(
      "Configuration history exceeds Cadence's 100,000-event export ceiling.",
    );
  });

  it("fails loudly when a later page is empty before the captured high-water", async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) =>
      storedEvent(eventId(index)),
    );
    const highWaterBuilder = queryBuilder({
      data: [{ id: eventId(1_000), recorded_at: RECORDED_AT }],
      error: null,
    });
    const firstPageBuilder = queryBuilder({ data: firstPage, error: null });
    const emptyPageBuilder = queryBuilder({ data: [], error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(highWaterBuilder)
      .mockReturnValueOnce(firstPageBuilder)
      .mockReturnValueOnce(emptyPageBuilder);

    await expect(
      listBehaviorConfigurationEvents(
        { from } as unknown as AppSupabaseClient,
        USER_ID,
      ),
    ).rejects.toThrow(
      "Behavior configuration history pagination ended before the captured high-water event.",
    );
  });
});

function pagedSupabase(eventCount: number): AppSupabaseClient {
  let fromCall = 0;

  return {
    from: vi.fn(() => {
      if (fromCall === 0) {
        fromCall += 1;
        return queryBuilder({
          data: [
            {
              id: eventId(eventCount - 1),
              recorded_at: RECORDED_AT,
            },
          ],
          error: null,
        });
      }

      const pageIndex = fromCall - 1;
      const start = pageIndex * 1_000;
      const pageLength = Math.max(0, Math.min(1_000, eventCount - start));

      fromCall += 1;
      return queryBuilder({
        data: Array.from({ length: pageLength }, (_, index) =>
          storedEvent(eventId(start + index)),
        ),
        error: null,
      });
    }),
  } as unknown as AppSupabaseClient;
}

function eventId(index: number): string {
  return `event-${String(index).padStart(6, "0")}`;
}

function queryBuilder(response: {
  data: unknown[];
  error: Error | null;
}) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    or: vi.fn(),
    then: (
      onFulfilled: (value: typeof response) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(onFulfilled, onRejected),
  };

  for (const method of [
    "select",
    "eq",
    "lte",
    "order",
    "limit",
    "or",
  ] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

function storedEvent(id: string): BehaviorConfigurationEvent {
  return {
    id,
    user_id: USER_ID,
    behavior_id: "22222222-2222-4222-8222-222222222222",
    event_kind: "revision",
    previous_configuration: storedConfigurationEvent().next_configuration,
    next_configuration: storedConfigurationEvent().next_configuration,
    changed_fields: ["schedule_graph"],
    recorded_at: RECORDED_AT,
    effective_at: RECORDED_AT,
    effective_local_date: "2026-08-14",
    timezone: "America/New_York",
    source: "manual",
    reason_code: "behavior_form_update",
    created_at: RECORDED_AT,
  };
}
