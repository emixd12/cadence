import { integrationWriteHash } from "@/lib/services/integration-write.service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { integrationBehaviorInput } from "@/lib/services/integration-behavior-input";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { recordIntegrationActivity, beginIdempotentWrite } from "@/lib/db/integration.repo";
import { getBehaviorById, listUserBehaviors } from "@/lib/db/behaviors.repo";
import { serializeIntegrationBehavior } from "@/lib/services/integration-read-serialization";
import type { BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import { updateBehaviorForUser } from "@/lib/services/behavior.service";
import { getPeriod } from "@/lib/db/periods.repo";
import { periodTodayForUser } from "@/lib/services/period.service";
import type { PeriodRecord } from "@cadence/core/resolvers/period.resolver";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/integration.repo", () => ({
  beginIdempotentWrite: vi.fn(), releaseIdempotentWrite: vi.fn(), recordIntegrationActivity: vi.fn(),
}));
vi.mock("@/lib/db/periods.repo", () => ({ getPeriod: vi.fn() }));
vi.mock("@/lib/services/period.service", () => ({ periodTodayForUser: vi.fn() }));
vi.mock("@/lib/db/behaviors.repo", () => ({ getBehaviorById: vi.fn(), listBehaviorCategories: vi.fn(), listUserBehaviors: vi.fn() }));
vi.mock("@/lib/services/behavior.service", async (original) => ({
  ...await original<typeof import("@/lib/services/behavior.service")>(), updateBehaviorForUser: vi.fn(),
}));
const id = "22500000-0000-4000-8000-000000000001";
const context = { supabase: {}, userId: id, now: new Date("2026-10-18T12:00:00Z"),
  actor: { grantedScopes: ["cadence.read", "cadence.behaviors.write", "cadence.occurrences.write"] } } as unknown as IntegrationContext;
const create = { title: "Walk", schedules: [{ recurrence: { frequency: "daily" as const, interval: 1 },
  time_entries: [{ kind: "exact" as const, start_time: "09:00" }] }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listUserBehaviors).mockResolvedValue([]);
});
describe("integration write boundary", () => {
  it("denies each operation before data access and records the attempt", async () => {
    for (const handler of Object.values(writeOperationHandlers)) {
      const result = await handler({ ...context, actor: { ...context.actor, grantedScopes: ["cadence.read"] } }, {});
      expect(result).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
    }
    expect(recordIntegrationActivity).toHaveBeenCalledTimes(18);
    expect(beginIdempotentWrite).not.toHaveBeenCalled();
    expect(getBehaviorById).not.toHaveBeenCalled();
  });
  it("writes a day note through one transaction with the normalized note and returns its receipt", async () => {
    const output = { local_date: "2026-10-18", changed: true, day_note: { id, local_date: "2026-10-18", note: "Travel day",
      revision: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z" } };
    const rpc = vi.fn().mockResolvedValue({ data: { receipt: { version: 2, output_json: JSON.stringify(output) } }, error: null });
    const result = await writeOperationHandlers.update_day_note({ ...context, supabase: { rpc } } as unknown as IntegrationContext,
      { local_date: "2026-10-18", note: "  Travel day \r\n" });
    expect(result).toEqual({ ok: true, value: output });
    expect(rpc).toHaveBeenCalledWith("integration_apply_day_note_write", expect.objectContaining({
      p_key: null, p_local_date: "2026-10-18", p_note: "Travel day", p_expected_revision: null,
    }));
    const cleared = vi.fn().mockResolvedValue({ data: { receipt: { version: 2, output_json: JSON.stringify({ local_date: "2026-10-18", changed: false, day_note: null }) } }, error: null });
    await writeOperationHandlers.update_day_note({ ...context, supabase: { rpc: cleared } } as unknown as IntegrationContext, { local_date: "2026-10-18", note: "" });
    expect(cleared).toHaveBeenCalledWith("integration_apply_day_note_write", expect.objectContaining({ p_note: null }));
  });
  it("maps a day note compare-and-set failure to conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "integration_conflict" } });
    expect(await writeOperationHandlers.update_day_note({ ...context, supabase: { rpc } } as unknown as IntegrationContext,
      { local_date: "2026-10-18", note: "x", expected_revision: "2026-10-18T11:00:00Z" }))
      .toMatchObject({ ok: false, error: { code: "conflict" } });
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

describe("update_behavior opportunity flag", () => {
  it("writes an is_opportunity-only update through the update transaction and returns its receipt", async () => {
    const current = { id, title: "Walk", description: null, location_text: null, category: null, active: true,
      recurrence_rule: { frequency: "daily", interval: 1 }, scheduled_time: "09:00:00", timezone: "America/New_York",
      browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0,
      created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", archived_at: null,
      auto_archived_at: null, end_date: null, default_duration_minutes: null, archive_notes: [], is_opportunity: false,
      schedule_slots: [{ id, kind: "exact", preset: null, start_time: "09:00:00", end_time: null, sort_order: 0 }],
    } as unknown as BehaviorWithCategory;
    vi.mocked(getBehaviorById).mockResolvedValue(current);
    const rpc = vi.fn(async (_name: string, args: { p_args: { _integration_prepared?: { output_json: string } } }) => {
      const prepared = args.p_args._integration_prepared;
      if (!prepared) return { data: { fingerprint: "f", source: { version: 1, behavior: { ...current, is_opportunity: true, recurrence_rule: null, scheduled_time: null, schedule_slots: [], schedules: [] },
        occurrence: null, previous_status: null, changed: true, as_of: current.updated_at, timezone: "America/New_York", external_ref: null } }, error: null };
      return { data: { receipt: { version: 2, output_json: prepared.output_json }, rpc_result: { id } }, error: null };
    });
    vi.mocked(updateBehaviorForUser).mockImplementation(async (client) => {
      await client.rpc("update_behavior_with_schedule_graph" as never, {} as never);
      return undefined as never;
    });
    const result = await writeOperationHandlers.update_behavior({ ...context, supabase: { rpc } } as unknown as IntegrationContext,
      { behavior_id: id, expected_revision: current.updated_at, is_opportunity: true });
    expect(result).toMatchObject({ ok: true, value: { changed: true } });
    expect(updateBehaviorForUser).toHaveBeenCalledWith(expect.anything(), id,
      expect.objectContaining({ behaviorId: id, values: expect.objectContaining({ isOpportunity: true }) }), expect.any(String));
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

describe("Period writes (Ticket 370)", () => {
  const revision = "2026-10-18T11:00:00Z";
  const stored: PeriodRecord = { id, user_id: id, label: "Sick", start_on: "2026-10-12", end_on: null, note: "Flu",
    revision: 4, created_at: "2026-10-12T09:00:00+00:00", updated_at: "2026-10-18T11:00:00+00:00" };
  const output = (overrides: Record<string, unknown> = {}, changed?: boolean) => ({
    period: { id, label: "Sick", start_local_date: "2026-10-12", end_local_date: null, ongoing: true, note: "Flu",
      revision: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", ...overrides },
    ...(changed === undefined ? {} : { changed }),
  });
  const receiptFor = (value: unknown) => ({ data: { receipt: { version: 2, output_json: JSON.stringify(value) } }, error: null });
  const withRpc = (rpc: unknown) => ({ ...context, supabase: { rpc } }) as unknown as IntegrationContext;

  beforeEach(() => {
    vi.mocked(getPeriod).mockResolvedValue(stored);
    vi.mocked(periodTodayForUser).mockResolvedValue("2026-10-18");
  });

  it("creates a Period through one transaction with the resolver's normalized fields", async () => {
    const created = output({ label: "Sick", note: "Flu.\nStayed home." });
    const rpc = vi.fn().mockResolvedValue(receiptFor(created));
    const result = await writeOperationHandlers.create_period(withRpc(rpc),
      { label: "Sick", start_local_date: "2026-10-12", note: "  Flu.\r\nStayed home. " });
    expect(result).toEqual({ ok: true, value: created });
    expect(rpc).toHaveBeenCalledWith("integration_apply_period_write", {
      p_key: null, p_hash: expect.stringMatching(/^[0-9a-f]{64}$/), p_operation: "create_period", p_period_id: null, p_expected_revision: null,
      p_label: "Sick", p_start_on: "2026-10-12", p_end_on: null, p_note: "Flu.\nStayed home.",
    });
    expect(getPeriod).not.toHaveBeenCalled();
    // A blank note is no note, and an explicit null end is ongoing.
    await writeOperationHandlers.create_period(withRpc(rpc), { label: "Trip", start_local_date: "2026-10-12", end_local_date: null, note: "  " });
    expect(rpc).toHaveBeenLastCalledWith("integration_apply_period_write", expect.objectContaining({ p_label: "Trip", p_end_on: null, p_note: null }));
  });

  it("refuses a create whose last day is before its first, and tells an agent the account is full", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "54000", message: "An account can hold at most 500 periods." } });
    expect(await writeOperationHandlers.create_period(withRpc(rpc), { label: "Sick", start_local_date: "2026-10-12", end_local_date: "2026-10-11" }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(rpc).not.toHaveBeenCalled();
    const full = await writeOperationHandlers.create_period(withRpc(rpc), { label: "Sick", start_local_date: "2026-10-12" });
    expect(full).toMatchObject({ ok: false, error: { code: "limit_exceeded", retry: "after_change" } });
    if (!full.ok) {
      expect(full.error.message).toContain("500 Periods");
      expect(full.error.message).toContain("No tool removes a Period");
    }
  });

  it("edits only the fields sent: null makes it ongoing or clears the note, absent keeps", async () => {
    const rpc = vi.fn().mockResolvedValue(receiptFor(output({ end_local_date: "2026-10-20", ongoing: false }, true)));
    expect(await writeOperationHandlers.update_period(withRpc(rpc), { period_id: id, expected_revision: revision, end_local_date: "2026-10-20" }))
      .toMatchObject({ ok: true, value: { changed: true, period: { end_local_date: "2026-10-20" } } });
    expect(rpc).toHaveBeenLastCalledWith("integration_apply_period_write", expect.objectContaining({
      p_operation: "update_period", p_period_id: id, p_expected_revision: revision,
      p_label: "Sick", p_start_on: "2026-10-12", p_end_on: "2026-10-20", p_note: "Flu",
    }));
    vi.mocked(getPeriod).mockResolvedValue({ ...stored, end_on: "2026-10-20" });
    await writeOperationHandlers.update_period(withRpc(rpc), { period_id: id, expected_revision: revision, end_local_date: null, note: null, label: " Flu week " });
    expect(rpc).toHaveBeenLastCalledWith("integration_apply_period_write", expect.objectContaining({
      p_label: "Flu week", p_start_on: "2026-10-12", p_end_on: null, p_note: null,
    }));
  });

  it("checks the revision and the stored dates before any write", async () => {
    const rpc = vi.fn();
    expect(await writeOperationHandlers.update_period(withRpc(rpc), { period_id: id, expected_revision: "2026-10-18T10:00:00Z", label: "Flu" }))
      .toMatchObject({ ok: false, error: { code: "conflict" } });
    // The sent first day is after the stored last day.
    vi.mocked(getPeriod).mockResolvedValue({ ...stored, end_on: "2026-10-14" });
    expect(await writeOperationHandlers.update_period(withRpc(rpc), { period_id: id, expected_revision: revision, start_local_date: "2026-10-15" }))
      .toMatchObject({ ok: false, error: { code: "invalid_input", message: "The last day must be on or after the first day." } });
    expect(await writeOperationHandlers.update_period(withRpc(rpc), { period_id: id, expected_revision: revision }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    vi.mocked(getPeriod).mockResolvedValue(null);
    for (const name of ["update_period", "end_period"] as const) {
      expect(await writeOperationHandlers[name](withRpc(rpc), { period_id: id, expected_revision: revision, ...(name === "update_period" ? { label: "Flu" } : {}) }))
        .toMatchObject({ ok: false, error: { code: "not_found" } });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ends a Period on the account's today and takes no date from the caller", async () => {
    const ended = output({ end_local_date: "2026-10-18", ongoing: false }, true);
    const rpc = vi.fn().mockResolvedValue(receiptFor(ended));
    expect(await writeOperationHandlers.end_period(withRpc(rpc), { period_id: id, expected_revision: revision })).toEqual({ ok: true, value: ended });
    expect(periodTodayForUser).toHaveBeenCalledWith(expect.anything(), id, expect.anything());
    expect(rpc).toHaveBeenCalledWith("integration_apply_period_write", expect.objectContaining({
      p_operation: "end_period", p_period_id: id, p_expected_revision: revision,
      p_label: "Sick", p_start_on: "2026-10-12", p_end_on: "2026-10-18", p_note: "Flu",
    }));
    expect(await writeOperationHandlers.end_period(withRpc(rpc), { period_id: id, expected_revision: revision, end_local_date: "2026-10-01" }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it.each([
    ["not started", { start_on: "2026-10-19", end_on: null }],
    ["ended today", { end_on: "2026-10-18" }],
    ["ended earlier", { end_on: "2026-10-15" }],
  ])("refuses to end a Period that has %s with invalid_state and writes nothing", async (_label, overrides) => {
    vi.mocked(getPeriod).mockResolvedValue({ ...stored, ...overrides });
    const rpc = vi.fn();
    const result = await writeOperationHandlers.end_period(withRpc(rpc), { period_id: id, expected_revision: revision });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    if (!result.ok) expect(result.error.message).toContain("update_period");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ends a Period whose last day is still ahead", async () => {
    vi.mocked(getPeriod).mockResolvedValue({ ...stored, end_on: "2026-10-25" });
    const rpc = vi.fn().mockResolvedValue(receiptFor(output({ end_local_date: "2026-10-18", ongoing: false }, true)));
    expect(await writeOperationHandlers.end_period(withRpc(rpc), { period_id: id, expected_revision: revision })).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("integration_apply_period_write", expect.objectContaining({ p_end_on: "2026-10-18" }));
  });

  it("maps the transaction's refusals to contract errors", async () => {
    for (const [message, code] of [["integration_conflict", "conflict"], ["integration_not_found", "not_found"],
      ["integration_period_end_refused", "invalid_state"], ["integration_insufficient_scope", "insufficient_scope"],
      ["The period label is invalid.", "invalid_input"]] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message } });
      expect(await writeOperationHandlers.end_period(withRpc(rpc), { period_id: id, expected_revision: revision }))
        .toMatchObject({ ok: false, error: { code } });
    }
  });

  it("replays a stored result by key and records the Period id, never its label or note", async () => {
    const replayed = output({}, false);
    vi.mocked(beginIdempotentWrite).mockResolvedValue({ state: "replay", result: { version: 2, output_json: JSON.stringify(replayed) } } as never);
    const rpc = vi.fn();
    expect(await writeOperationHandlers.update_period(withRpc(rpc), { period_id: id, expected_revision: revision, label: "Flu", idempotency_key: "period-key-1" }))
      .toEqual({ ok: true, value: replayed });
    expect(rpc).not.toHaveBeenCalled();
    expect(getPeriod).not.toHaveBeenCalled();
    expect(recordIntegrationActivity).toHaveBeenCalledWith(expect.anything(), { operation: "update_period", targetIds: [id], outcome: "success", errorCode: null });
    expect(JSON.stringify(vi.mocked(recordIntegrationActivity).mock.calls)).not.toMatch(/Sick|Flu/);
  });
});
