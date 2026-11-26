// Ticket 376: the one-day adapter behind the MCP `show_day` transport tool. The Timeline
// read is mocked; the connector label runs through the real reader and the real resolver.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { listSourceMatchesForOccurrences } from "@/lib/db/sourceMatches.repo";
import { getIntegrationDay } from "@/lib/services/integration-day.service";
import { getIntegrationTimeline, IntegrationReadError } from "@/lib/services/integration-read.service";

vi.mock("@/lib/services/integration-read.service", () => {
  class IntegrationReadError extends Error {
    readonly error: { code: string; message: string };
    constructor(code: string, message: string) { super(message); this.error = { code, message }; }
  }
  return { getIntegrationTimeline: vi.fn(), IntegrationReadError };
});
vi.mock("@/lib/db/sourceMatches.repo", () => ({ listSourceMatchesForOccurrences: vi.fn() }));
vi.mock("@/lib/db/occurrenceStatusEvents.repo", () => ({ listOccurrenceStatusEventsByOccurrenceIds: vi.fn() }));

const context = { userId: "user-a", supabase: {}, now: new Date("2026-11-25T15:00:00Z"), tokenExpiresAt: new Date(),
  actor: { channel: "mcp", clientId: "client", clientLabel: "Test", grantId: "grant", grantedScopes: ["cadence.read"] } } as unknown as IntegrationContext;
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const occurrence = (n: number, status: "unresolved" | "completed" | "not_completed") => ({
  id: id(n), behavior_id: id(9), behavior_title: `Behavior ${n}`, category_name: null, local_date: "2026-11-25", timezone: "America/New_York",
  scheduled_for: "2026-11-25T13:00:00Z", effective_start_at: "2026-11-25T13:00:00Z", move: null,
  schedule: { kind: "exact", preset: null, start_time: "08:00", end_time: null, label: "8:00 AM" },
  status, status_label: status === "completed" ? "Completed" : status === "unresolved" ? "Unresolved" : "Not Completed",
  needs_decision: false, origin: "scheduled", added_by: null, completed_at: null, status_marked_at: null, note: null,
  parent_behavior_id: null, parent_title: null, updated_at: "2026-11-25T12:00:00Z", revision: "r1",
});
const timeline = (overrides: Record<string, unknown> = {}) => ({
  timezone: "America/New_York", today_local_date: "2026-11-25",
  needs_decision: { occurrences: [occurrence(7, "unresolved")], total_count: 4, truncated: false, lookback_start_local_date: "2026-08-27", parent_groups: [] },
  days: [{ local_date: "2026-11-25", is_today: true, day_note: "Rest day", occurrences: [occurrence(1, "completed"), occurrence(2, "completed"), occurrence(3, "unresolved")], parent_groups: [] }],
  freshness: { as_of: "2026-11-25T15:00:00Z", occurrences_generated_through: "2026-12-25" },
  ...overrides,
});
const statusEvent = (n: number, occurrenceId: string, recordedAt: string, connector: boolean) => ({
  id: `event-${n}`, occurrence_id: occurrenceId, status_semantics: connector ? "system_rule_declared" : "user_declared",
  source_capture_method: connector ? "derived" : "manual", reason_code: connector ? "connector:hevy" : null,
  recorded_at: recordedAt, created_at: recordedAt,
});

beforeEach(() => {
  vi.stubEnv("CADENCE_CONNECTOR_COMPLETION", "on");
  vi.mocked(getIntegrationTimeline).mockResolvedValue(timeline() as never);
  vi.mocked(listSourceMatchesForOccurrences).mockResolvedValue([]);
  vi.mocked(listOccurrenceStatusEventsByOccurrenceIds).mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("getIntegrationDay (Ticket 376)", () => {
  it("reads exactly one day from the Timeline read and passes the date through", async () => {
    await getIntegrationDay(context, {});
    expect(getIntegrationTimeline).toHaveBeenCalledExactlyOnceWith(context, { days: 1 });
    vi.mocked(getIntegrationTimeline).mockClear();
    await getIntegrationDay(context, { date: "2026-11-20" });
    expect(getIntegrationTimeline).toHaveBeenCalledExactlyOnceWith(context, { start_local_date: "2026-11-20", days: 1 });
  });

  it("returns the day, its note and parent groups, and Needs decision as a count only", async () => {
    const day = await getIntegrationDay(context, {});
    expect(day).toMatchObject({ local_date: "2026-11-25", is_today: true, timezone: "America/New_York", today_local_date: "2026-11-25",
      day_note: "Rest day", parent_groups: [], needs_decision: { count: 4, truncated: false },
      freshness: { as_of: "2026-11-25T15:00:00Z", occurrences_generated_through: "2026-12-25" } });
    expect(Object.keys(day).sort()).toEqual(["day_note", "freshness", "is_today", "local_date", "needs_decision", "occurrences", "parent_groups", "timezone", "today_local_date"]);
    expect(Object.keys(day.needs_decision).sort()).toEqual(["count", "truncated"]);
    // The Needs decision Occurrence itself never travels.
    expect(JSON.stringify(day)).not.toContain(id(7));
    expect(day.occurrences.map((row) => row.id)).toEqual([id(1), id(2), id(3)]);
  });

  it("fills an absent day note and absent parent groups with null and an empty list", async () => {
    vi.mocked(getIntegrationTimeline).mockResolvedValue(timeline({ needs_decision: null,
      days: [{ local_date: "2026-11-25", is_today: true, occurrences: [] }] }) as never);
    expect(await getIntegrationDay(context, {})).toMatchObject({ day_note: null, parent_groups: [], occurrences: [], needs_decision: { count: 0, truncated: false } });
  });

  it("labels a Completed Occurrence whose latest status event is a connector's, and no other", async () => {
    vi.mocked(listOccurrenceStatusEventsByOccurrenceIds).mockResolvedValue([
      statusEvent(1, id(1), "2026-11-25T14:00:00Z", true),
      // The person changed it after the connector: their event is the latest.
      statusEvent(2, id(2), "2026-11-25T13:00:00Z", true),
      statusEvent(3, id(2), "2026-11-25T14:30:00Z", false),
    ] as never);
    const day = await getIntegrationDay(context, {});
    expect(day.occurrences.map((row) => row.connector_completion)).toEqual([{ source: "hevy", source_label: "Hevy" }, null, null]);
    // Status events are read for the Completed rows only.
    expect(listOccurrenceStatusEventsByOccurrenceIds).toHaveBeenCalledExactlyOnceWith(context.supabase, "user-a", [id(1), id(2)]);
  });

  it("does not label an Unresolved Occurrence that only has an attached workout", async () => {
    vi.mocked(listSourceMatchesForOccurrences).mockResolvedValue([{ occurrence_id: id(3), source: "hevy", state: "active",
      activity_start_at: "2026-11-25T12:00:00Z", activity_end_at: "2026-11-25T12:40:00Z" }] as never);
    const day = await getIntegrationDay(context, {});
    expect(day.occurrences.every((row) => row.connector_completion === null)).toBe(true);
    // Workout times stay out of the projection.
    expect(JSON.stringify(day)).not.toContain("12:40");
  });

  it("reads no evidence and labels nothing while connector completion is off", async () => {
    vi.stubEnv("CADENCE_CONNECTOR_COMPLETION", "");
    vi.mocked(listOccurrenceStatusEventsByOccurrenceIds).mockResolvedValue([statusEvent(1, id(1), "2026-11-25T14:00:00Z", true)] as never);
    const day = await getIntegrationDay(context, {});
    expect(day.occurrences.every((row) => row.connector_completion === null)).toBe(true);
    expect(listSourceMatchesForOccurrences).not.toHaveBeenCalled();
    expect(listOccurrenceStatusEventsByOccurrenceIds).not.toHaveBeenCalled();
  });

  it("reports the cap and truncated when Needs decision is above get_timeline's limit", async () => {
    vi.mocked(getIntegrationTimeline)
      .mockRejectedValueOnce(new IntegrationReadError("limit_exceeded", "Needs decision exceeds 100 Occurrences."))
      .mockResolvedValueOnce(timeline({ needs_decision: null }) as never);
    const day = await getIntegrationDay(context, { date: "2026-11-25" });
    expect(day.needs_decision).toEqual({ count: 100, truncated: true });
    expect(day.occurrences).toHaveLength(3);
    expect(getIntegrationTimeline).toHaveBeenLastCalledWith(context, { start_local_date: "2026-11-25", days: 1, include_needs_decision: false });
  });

  it("passes other read failures to the caller", async () => {
    vi.mocked(getIntegrationTimeline).mockRejectedValue(new IntegrationReadError("service_unavailable", "Retry."));
    await expect(getIntegrationDay(context, {})).rejects.toMatchObject({ error: { code: "service_unavailable" } });
    expect(getIntegrationTimeline).toHaveBeenCalledTimes(1);
    vi.mocked(getIntegrationTimeline).mockResolvedValue(timeline({ days: [] }) as never);
    await expect(getIntegrationDay(context, {})).rejects.toMatchObject({ error: { code: "service_unavailable" } });
  });

  it("copies named fields only, so Periods and any other Timeline addition stay out", async () => {
    vi.mocked(getIntegrationTimeline).mockResolvedValue(timeline({ periods: [{ label: "Sick" }], calendar_events: [{ title: "Dentist" }],
      days: [{ local_date: "2026-11-25", is_today: true, day_note: null, occurrences: [occurrence(1, "unresolved")], parent_groups: [],
        periods: [{ label: "Sick" }], leave_time: "08:10", travel: { minutes: 20 } }] }) as never);
    const text = JSON.stringify(await getIntegrationDay(context, {}));
    for (const leaked of ["periods", "Sick", "calendar_events", "Dentist", "leave_time", "travel"]) expect(text).not.toContain(leaked);
  });
});
