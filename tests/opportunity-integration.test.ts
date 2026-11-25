import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorGraphRecord } from "@cadence/core/behavior-store";
import type { OccurrenceRecord } from "@cadence/core/data-store";
import type { IntegrationContext } from "@/lib/integrations/request-context";

// MCP 1.6.0 and chat: add_opportunity_occurrence and remove_opportunity_occurrence run
// through opportunity.service.ts against a mocked database function.

const mocks = vi.hoisted(() => ({
  getBehaviorById: vi.fn(), getOccurrenceById: vi.fn(), readBriefMoveDay: vi.fn(), readBehaviorPlanningFacts: vi.fn(),
  beginIdempotentWrite: vi.fn(), completeIdempotentWrite: vi.fn(), releaseIdempotentWrite: vi.fn(), recordIntegrationActivity: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/stable-user-data.cache", () => ({ invalidateBehaviorData: vi.fn() }));
vi.mock("@/lib/db/behaviors.repo", async (importOriginal) => ({ ...(await importOriginal<object>()), getBehaviorById: mocks.getBehaviorById }));
vi.mock("@/lib/db/occurrences.repo", async (importOriginal) => ({ ...(await importOriginal<object>()), getOccurrenceById: mocks.getOccurrenceById }));
vi.mock("@/lib/db/profiles.repo", () => ({ getProfileSettings: vi.fn().mockResolvedValue({ timezone: "America/New_York" }) }));
vi.mock("@/lib/services/brief-move-day.service", () => ({ readBriefMoveDay: mocks.readBriefMoveDay, readBehaviorPlanningFacts: mocks.readBehaviorPlanningFacts }));
vi.mock("@/lib/services/reminder.service", () => ({ syncReminderDeliveriesForBehavior: vi.fn() }));
vi.mock("@/lib/db/integration.repo", () => ({
  beginIdempotentWrite: mocks.beginIdempotentWrite, completeIdempotentWrite: mocks.completeIdempotentWrite,
  releaseIdempotentWrite: mocks.releaseIdempotentWrite, recordIntegrationActivity: mocks.recordIntegrationActivity,
}));

import { writeOperationHandlers } from "@/lib/integrations/operations/write";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BEHAVIOR_ID = "22222222-2222-4222-8222-222222222222";
const OCCURRENCE_ID = "33333333-3333-4333-8333-333333333333";
// 14:02 local on 2026-11-21.
const NOW = new Date("2026-11-21T19:02:30Z");

const behavior = (overrides: Partial<BehaviorGraphRecord> = {}): BehaviorGraphRecord => ({
  id: BEHAVIOR_ID, user_id: USER_ID, current_configuration_event_id: null,
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
  category_id: null, category: null, title: "Stretch", description: null,
  recurrence_rule: null, scheduled_time: null, is_opportunity: true, timezone: "America/New_York",
  browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0,
  active: true, archived_at: null, schedule_slots: [], schedules: [], default_duration_minutes: 30,
  ...overrides,
});
const occurrence = (overrides: Partial<OccurrenceRecord> = {}): OccurrenceRecord => ({
  id: OCCURRENCE_ID, user_id: USER_ID, behavior_id: BEHAVIOR_ID,
  behavior_configuration_event_id: null, behavior_schedule_slot_id: null,
  scheduled_for: "2026-11-21T20:00:00Z", local_date: "2026-11-21",
  schedule_kind: "exact", schedule_preset: null, schedule_start_time: "15:00:00", schedule_end_time: null,
  schedule_range_identity: null, status: "unresolved", completed_at: null, status_marked_at: null,
  note: null, created_at: "2026-11-21T19:00:00Z", updated_at: "2026-11-21T19:00:00Z",
  origin: "opportunity", added_by: "mcp",
  ...overrides,
});

function context(channel: "mcp" | "chat", rpc = vi.fn()) {
  return {
    rpc,
    context: { supabase: { rpc }, userId: USER_ID, now: NOW, actor: {
      channel, clientId: "client-1", grantId: "grant-1", clientLabel: "Test",
      grantedScopes: ["cadence.read", "cadence.occurrences.write"],
    } } as unknown as IntegrationContext,
  };
}
const added = (row: OccurrenceRecord) => vi.fn().mockResolvedValue({ data: { created: true, occurrence: row, status_event: null }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBehaviorById.mockResolvedValue(behavior());
  mocks.beginIdempotentWrite.mockResolvedValue({ state: "started" });
  mocks.completeIdempotentWrite.mockResolvedValue(true);
  mocks.readBriefMoveDay.mockResolvedValue({ items: [] });
  // CADENCE_ALONGSIDE off: no planning facts.
  mocks.readBehaviorPlanningFacts.mockResolvedValue(new Map());
});

describe("add_opportunity_occurrence", () => {
  it("adds as the connected app and reports origin and provenance", async () => {
    const { rpc, context: ctx } = context("mcp", added(occurrence()));
    const result = await writeOperationHandlers.add_opportunity_occurrence(ctx, { behavior_id: BEHAVIOR_ID, start_time: "15:00" });
    expect(rpc).toHaveBeenCalledWith("add_opportunity_occurrence", expect.objectContaining({
      target_behavior_id: BEHAVIOR_ID, planned_local_date: "2026-11-21", planned_start_time: "15:00", planned_added_by: "mcp", mark_completed: false,
    }));
    expect(result).toMatchObject({ ok: true, value: { outcome: "added", refusal: null, occurrence: { id: OCCURRENCE_ID, origin: "opportunity", added_by: "mcp" } } });
    expect(mocks.readBriefMoveDay).not.toHaveBeenCalled();
  });

  it("marks chat's item as added in chat and logs Done now", async () => {
    const row = occurrence({ added_by: "chat", status: "completed", completed_at: "2026-11-21T19:02:00Z", status_marked_at: "2026-11-21T19:02:00Z" });
    const { rpc, context: ctx } = context("chat", added(row));
    const result = await writeOperationHandlers.add_opportunity_occurrence(ctx, { behavior_id: BEHAVIOR_ID, mark_completed: true }, { calendarBusy: [] });
    expect(rpc).toHaveBeenCalledWith("add_opportunity_occurrence", expect.objectContaining({ planned_added_by: "chat", mark_completed: true, planned_start_time: "14:02" }));
    expect(result).toMatchObject({ ok: true, value: { outcome: "logged", occurrence: { added_by: "chat", status: "completed" } } });
  });

  it("refuses a chat time a calendar event holds, with free times, and adds nothing", async () => {
    const { rpc, context: ctx } = context("chat");
    const busy = { start: Temporal.Instant.from("2026-11-21T20:00:00Z"), end: Temporal.Instant.from("2026-11-21T21:00:00Z") };
    const result = await writeOperationHandlers.add_opportunity_occurrence(ctx, { behavior_id: BEHAVIOR_ID, start_time: "15:15" }, { calendarBusy: [busy] });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { outcome: "refused", occurrence: null, refusal: { reason: "calendar_busy" } } });
    const alternatives = result.ok ? result.value.refusal!.alternatives : [];
    expect(alternatives.length).toBeGreaterThan(0);
    for (const item of alternatives) expect(item.start_time < "14:50" || item.start_time >= "16:10").toBe(true);
  });

  it("Ticket 359: an alongside Behavior added at a calendar event's time follows the same-place rule", async () => {
    const busy = { start: Temporal.Instant.from("2026-11-21T20:00:00Z"), end: Temporal.Instant.from("2026-11-21T21:00:00Z") };
    // A pill taken anywhere may share the meeting's time: the event's place is unknown.
    mocks.readBehaviorPlanningFacts.mockResolvedValue(new Map([[BEHAVIOR_ID, {
      alongside: { value: true, source: "person" }, where: { kind: "anywhere", source: "person" } }]]));
    const { rpc, context: ctx } = context("chat", added(occurrence({ added_by: "chat", schedule_start_time: "15:15:00" })));
    const result = await writeOperationHandlers.add_opportunity_occurrence(ctx, { behavior_id: BEHAVIOR_ID, start_time: "15:15" }, { calendarBusy: [busy] });
    expect(rpc).toHaveBeenCalledWith("add_opportunity_occurrence", expect.objectContaining({ planned_start_time: "15:15" }));
    expect(result).toMatchObject({ ok: true, value: { outcome: "added" } });
    // Not alongside: the same request is refused, as before.
    mocks.readBehaviorPlanningFacts.mockResolvedValue(new Map([[BEHAVIOR_ID, {
      alongside: { value: false, source: "person" }, where: { kind: "elsewhere", source: "guess" } }]]));
    const refused = await writeOperationHandlers.add_opportunity_occurrence(context("chat").context, { behavior_id: BEHAVIOR_ID, start_time: "15:15" }, { calendarBusy: [busy] });
    expect(refused).toMatchObject({ ok: true, value: { outcome: "refused", refusal: { reason: "calendar_busy" } } });
  });

  it("keys the new Occurrence id to the idempotency key and replays without a second add", async () => {
    const first = added(occurrence());
    const { context: ctx } = context("mcp", first);
    await writeOperationHandlers.add_opportunity_occurrence(ctx, { behavior_id: BEHAVIOR_ID, start_time: "15:00", idempotency_key: "add-stretch-1" });
    const plannedId = first.mock.calls[0]![1].planned_occurrence_id as string;
    expect(plannedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const stored = mocks.completeIdempotentWrite.mock.calls[0]![1].result;

    const second = vi.fn();
    mocks.beginIdempotentWrite.mockResolvedValue({ state: "replay", result: stored });
    const replay = await writeOperationHandlers.add_opportunity_occurrence(context("mcp", second).context,
      { behavior_id: BEHAVIOR_ID, start_time: "15:00", idempotency_key: "add-stretch-1" });
    expect(second).not.toHaveBeenCalled();
    expect(replay).toMatchObject({ ok: true, value: { outcome: "added", occurrence: { id: OCCURRENCE_ID } } });
  });

  it("returns the database refusal as a refusal, not an error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "This Behavior is not running at that time.", code: "P0001" } });
    const result = await writeOperationHandlers.add_opportunity_occurrence(context("mcp", rpc).context, { behavior_id: BEHAVIOR_ID, preset: "evening" });
    expect(result).toMatchObject({ ok: true, value: { outcome: "refused", refusal: { reason: "not_running", message: "Stretch is not running at that time." } } });
  });
});

describe("remove_opportunity_occurrence", () => {
  it("never calls the remove function for a scheduled item", async () => {
    mocks.getOccurrenceById.mockResolvedValue(occurrence({ origin: "scheduled", added_by: null }));
    const { rpc, context: ctx } = context("mcp");
    const result = await writeOperationHandlers.remove_opportunity_occurrence(ctx, { occurrence_id: OCCURRENCE_ID });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { outcome: "refused", refusal: { reason: "scheduled" }, occurrence: { origin: "scheduled" } } });
  });

  it("refuses a stale revision, then removes with the current one", async () => {
    mocks.getOccurrenceById.mockResolvedValue(occurrence());
    const rpc = vi.fn().mockResolvedValue({ data: { removed: true, occurrence: occurrence(), cancelled_reminder_count: 1 }, error: null });
    const { context: ctx } = context("mcp", rpc);
    const stale = await writeOperationHandlers.remove_opportunity_occurrence(ctx, { occurrence_id: OCCURRENCE_ID, expected_revision: "2026-11-21T18:00:00Z" });
    expect(stale).toMatchObject({ ok: true, value: { outcome: "refused", refusal: { reason: "revision_changed" } } });
    expect(rpc).not.toHaveBeenCalled();
    const removed = await writeOperationHandlers.remove_opportunity_occurrence(ctx, { occurrence_id: OCCURRENCE_ID, expected_revision: "2026-11-21T19:00:00Z" });
    expect(rpc).toHaveBeenCalledWith("remove_opportunity_occurrence", { target_occurrence_id: OCCURRENCE_ID });
    expect(removed).toMatchObject({ ok: true, value: { outcome: "removed", refusal: null, occurrence: { id: OCCURRENCE_ID } } });
  });

  it("maps a missing item to not_found", async () => {
    mocks.getOccurrenceById.mockResolvedValue(null);
    const result = await writeOperationHandlers.remove_opportunity_occurrence(context("mcp").context, { occurrence_id: OCCURRENCE_ID });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
