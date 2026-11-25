import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import {
  isEligibleForLongitudinalReview,
  runLongitudinalCalendarReviewForUser,
} from "@/lib/services/longitudinal-calendar-review.service";

describe("Opted-in, activity-gated longitudinal calendar-load review (Q2)", () => {
  const now = Temporal.Instant.from("2026-11-25T12:00:00Z");

  it("enforces opt-in, 14-day activity, and weekly/monthly cadence gates", () => {
    expect(
      isEligibleForLongitudinalReview({
        longitudinalCalendarReviewEnabled: false,
        cadence: "weekly",
        lastReviewAt: null,
        lastCadenceActivityAt: "2026-11-24T12:00:00Z",
        now,
      }),
    ).toEqual({ eligible: false, reason: "not_opted_in" });

    expect(
      isEligibleForLongitudinalReview({
        longitudinalCalendarReviewEnabled: true,
        cadence: "weekly",
        lastReviewAt: null,
        lastCadenceActivityAt: "2026-11-01T12:00:00Z",
        now,
      }),
    ).toEqual({ eligible: false, reason: "inactive_user" });

    expect(
      isEligibleForLongitudinalReview({
        longitudinalCalendarReviewEnabled: true,
        cadence: "weekly",
        lastReviewAt: "2026-11-22T12:00:00Z",
        lastCadenceActivityAt: "2026-11-24T12:00:00Z",
        now,
      }),
    ).toEqual({ eligible: false, reason: "cadence_not_due" });

    expect(
      isEligibleForLongitudinalReview({
        longitudinalCalendarReviewEnabled: true,
        cadence: "monthly",
        lastReviewAt: "2026-11-05T12:00:00Z",
        lastCadenceActivityAt: "2026-11-24T12:00:00Z",
        now,
      }),
    ).toEqual({ eligible: false, reason: "cadence_not_due" });

    expect(
      isEligibleForLongitudinalReview({
        longitudinalCalendarReviewEnabled: true,
        cadence: "weekly",
        lastReviewAt: "2026-11-17T12:00:00Z",
        lastCadenceActivityAt: "2026-11-24T12:00:00Z",
        now,
      }),
    ).toEqual({ eligible: true });
  });

  it("respects per-user MCP budget gate", async () => {
    const caller = { user: { id: "user-1" }, client: {} } as unknown as CalendarCaller;
    const result = await runLongitudinalCalendarReviewForUser(caller, {
      longitudinalCalendarReviewEnabled: true,
      cadence: "weekly",
      lastReviewAt: null,
      lastCadenceActivityAt: "2026-11-24T12:00:00Z",
      now,
      checkBudget: () => ({ allowed: false, reason: "mcp_daily_budget_exceeded" }),
    });
    expect(result).toEqual({ ran: false, reason: "mcp_daily_budget_exceeded" });
  });

  it("reads >30d Google Calendar ephemerally and persists compact summary with <=30-day expiry", async () => {
    const insertedRows: Array<Record<string, unknown>> = [];
    const caller = {
      user: { id: "user-1" },
      client: {
        from: (table: string) => {
          expect(table).toBe("longitudinal_calendar_reviews");
          return {
            insert: (row: Record<string, unknown>) => {
              insertedRows.push(row);
              return {
                select: () => ({
                  single: async () => ({ data: { id: "rev-1" }, error: null }),
                }),
              };
            },
          };
        },
      },
    } as unknown as CalendarCaller;

    const readChunk = vi.fn().mockResolvedValue({
      grantGeneration: 7,
      events: [
        {
          kind: "timed",
          state: "confirmed",
          availability: "busy",
          currentUserResponse: "accepted",
          title: "Confidential Board Meeting",
          calendarName: "Work",
          startAt: "2026-10-20T14:00:00Z",
          endAt: "2026-10-20T18:30:00Z",
          endUnspecified: false,
          duration: { kind: "known", seconds: 270 * 60 },
          location: "123 Secret St",
        },
      ],
    });

    const result = await runLongitudinalCalendarReviewForUser(caller, {
      longitudinalCalendarReviewEnabled: true,
      cadence: "monthly",
      windowDays: 60,
      lastReviewAt: null,
      lastCadenceActivityAt: "2026-11-24T12:00:00Z",
      timezone: "UTC",
      now,
      checkBudget: () => ({ allowed: true }),
      readGoogleCalendarChunk: readChunk,
    });

    expect(result.ran).toBe(true);
    if (!result.ran) return;
    expect(result.reviewId).toBe("rev-1");
    expect(result.containsGoogleCalendar).toBe(true);
    expect(readChunk).toHaveBeenCalledWith(
      caller,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ allowPastDates: true, ephemeralOnly: true }),
    );

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0]!;
    expect(row.contains_google_calendar).toBe(true);
    expect(row.google_calendar_grant_generation).toBe(7);
    const createdMs = Date.parse(row.created_at as string);
    const expiresMs = Date.parse(row.expires_at as string);
    expect(expiresMs - createdMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1_000);

    // Raw calendar titles/locations must never appear in persisted summary_json
    const serializedSummary = JSON.stringify(row.summary_json);
    expect(serializedSummary).not.toContain("Confidential Board Meeting");
    expect(serializedSummary).not.toContain("123 Secret St");
  });
});
