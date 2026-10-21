import { integrationWriteHash } from "@/lib/services/integration-write.service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { integrationBehaviorInput } from "@/lib/services/integration-behavior-input";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { recordIntegrationActivity, beginIdempotentWrite } from "@/lib/db/integration.repo";
import { getBehaviorById } from "@/lib/db/behaviors.repo";
import { serializeIntegrationBehavior } from "@/lib/services/integration-read-serialization";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/integration.repo", () => ({
  beginIdempotentWrite: vi.fn(), releaseIdempotentWrite: vi.fn(), recordIntegrationActivity: vi.fn(),
}));
vi.mock("@/lib/db/behaviors.repo", () => ({ getBehaviorById: vi.fn(), listBehaviorCategories: vi.fn() }));
const id = "22500000-0000-4000-8000-000000000001";
const context = { supabase: {}, userId: id, now: new Date("2026-10-18T12:00:00Z"),
  actor: { grantedScopes: ["cadence.read", "cadence.behaviors.write", "cadence.occurrences.write"] } } as unknown as IntegrationContext;
const create = { title: "Walk", schedules: [{ recurrence: { frequency: "daily" as const, interval: 1 },
  time_entries: [{ kind: "exact" as const, start_time: "09:00" }] }] };

beforeEach(() => vi.resetAllMocks());
describe("integration write boundary", () => {
  it("denies each operation before data access and records the attempt", async () => {
    for (const handler of Object.values(writeOperationHandlers)) {
      const result = await handler({ ...context, actor: { ...context.actor, grantedScopes: ["cadence.read"] } }, {});
      expect(result).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
    }
    expect(recordIntegrationActivity).toHaveBeenCalledTimes(6);
    expect(beginIdempotentWrite).not.toHaveBeenCalled();
    expect(getBehaviorById).not.toHaveBeenCalled();
  });
  it("returns contract errors for invalid status and malformed create", async () => {
    expect(await writeOperationHandlers.set_occurrence_status(context, { occurrence_id: id, status: "missed" }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(await writeOperationHandlers.create_behavior(context, { ...create, title: " " }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
  it("uses the web duplicate-time validator", async () => {
    const invalid = { ...create, schedules: [{ ...create.schedules[0], time_entries: [create.schedules[0].time_entries[0], create.schedules[0].time_entries[0]] }] };
    expect(await writeOperationHandlers.create_behavior(context, invalid))
      .toMatchObject({ ok: false, error: { code: "invalid_input", field_errors: [{ path: "$.schedule" }] } });
  });
  it("rejects a reused key and a running key before writing", async () => {
    vi.mocked(beginIdempotentWrite).mockResolvedValueOnce({ state: "mismatch" }).mockResolvedValueOnce({ state: "in_progress" });
    const input = { ...create, idempotency_key: "request-225" };
    expect(await writeOperationHandlers.create_behavior(context, input)).toMatchObject({ ok: false, error: { code: "idempotency_key_reused" } });
    expect(await writeOperationHandlers.create_behavior(context, input)).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
  });
  it("hashes object ordering consistently but preserves array order", () => {
    expect(integrationWriteHash("create_behavior", { a: 1, b: 2, idempotency_key: "x" }))
      .toBe(integrationWriteHash("create_behavior", { b: 2, a: 1, idempotency_key: "y" }));
    expect(integrationWriteHash("create_behavior", [1, 2])).not.toBe(integrationWriteHash("create_behavior", [2, 1]));
  });
  it("preserves microseconds when checking stale Behavior revisions", async () => {
    vi.mocked(getBehaviorById).mockResolvedValue({ updated_at: "2026-10-18T12:00:00.000001+00:00" } as BehaviorWithCategory);
    expect(await writeOperationHandlers.update_behavior(context, {
      behavior_id: id, expected_revision: "2026-10-18T12:00:00Z", title: "Other",
    })).toMatchObject({ ok: false, error: { code: "conflict" } });
  });
});

describe("structured Behavior input", () => {
  it("uses web defaults and normalizes fields", () => {
    expect(integrationBehaviorInput({ ...create, title: " Walk " })).toMatchObject({
      title: "Walk", browserReminderEnabled: true, emailReminderEnabled: false,
      reminderOffsetMinutes: 0, recurrenceRule: { frequency: "daily", interval: 1 },
    });
  });
  it.each([
    [{ frequency: "interval_days", interval_days: 3 }, { frequency: "interval_days", intervalDays: 3 }],
    [{ frequency: "weekly", interval: 2, days_of_week: ["monday"] }, { frequency: "weekly", interval: 2, daysOfWeek: ["monday"] }],
    [{ frequency: "monthly", interval: 1, day_of_month: 31 }, { frequency: "monthly", interval: 1, dayOfMonth: 31 }],
  ] as const)("maps %j through web validation", (recurrence, expected) => {
    const values = integrationBehaviorInput({ ...create, schedules: [{ recurrence: structuredClone(recurrence) as never,
      time_entries: [{ kind: "range", start_time: "22:00", end_time: "01:00" }] }] });
    expect(values.recurrenceRule).toEqual(expected);
    expect(values.schedules[0].timeEntries[0]).toMatchObject({ kind: "range", startTime: "22:00", endTime: "01:00" });
  });
  it("merges partial updates and maps web validation errors", async () => {
    const current = { id, title: "Walk", description: "Existing", location_text: null, category: null, active: true,
      recurrence_rule: { frequency: "daily", interval: 1 }, scheduled_time: "09:00:00", timezone: "America/New_York",
      browser_reminder_enabled: true, email_reminder_enabled: true, reminder_offset_minutes: 60,
      created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", archived_at: null,
      auto_archived_at: null, end_date: null, default_duration_minutes: null, archive_notes: [],
      schedule_slots: [{ id, kind: "exact", preset: null, start_time: "09:00:00", end_time: null, sort_order: 0 }],
    } as unknown as BehaviorWithCategory;
    const values = integrationBehaviorInput({ behavior_id: id, expected_revision: current.updated_at,
      title: "New", reminders: { email_enabled: false } }, serializeIntegrationBehavior(current, null));
    expect(values).toMatchObject({ title: "New", description: "Existing", browserReminderEnabled: true,
      emailReminderEnabled: false, reminderOffsetMinutes: 60, scheduledTime: "09:00" });
    vi.mocked(getBehaviorById).mockResolvedValue(current);
    expect(await writeOperationHandlers.update_behavior(context, {
      behavior_id: id, expected_revision: current.updated_at,
      schedules: [{ ...create.schedules[0], time_entries: [create.schedules[0].time_entries[0], create.schedules[0].time_entries[0]] }],
    })).toMatchObject({ ok: false, error: { code: "invalid_input", field_errors: [{ path: "$.schedule" }] } });
  });
});
