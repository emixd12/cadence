import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateOperationOutput } from "@cadence/core/integration";
import type { BehaviorDataStore } from "../packages/core/src/behavior-store";
import { createBehavior, updateBehavior } from "../packages/core/src/services/behavior.service";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { getBehaviorById, listUserBehaviors, type BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import { integrationBehaviorInput } from "@/lib/services/integration-behavior-input";
import { serializeIntegrationBehavior, serializeIntegrationOccurrence } from "@/lib/services/integration-read-serialization";
import { updateBehaviorForUser } from "@/lib/services/behavior.service";
import type { Occurrence } from "@/lib/types/database";
import { Temporal } from "@js-temporal/polyfill";
import { recordedAt, stored, values } from "./helpers/behavior-graph-fixture";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/integration.repo", () => ({
  beginIdempotentWrite: vi.fn(), releaseIdempotentWrite: vi.fn(), recordIntegrationActivity: vi.fn(),
}));
vi.mock("@/lib/db/behaviors.repo", () => ({ getBehaviorById: vi.fn(), listBehaviorCategories: vi.fn(), listUserBehaviors: vi.fn() }));
vi.mock("@/lib/services/behavior.service", async (original) => ({
  ...await original<typeof import("@/lib/services/behavior.service")>(), updateBehaviorForUser: vi.fn(),
}));

const id = "22500000-0000-4000-8000-000000000001";
const context = { supabase: {}, userId: id, now: new Date("2026-10-18T12:00:00Z"),
  actor: { grantedScopes: ["cadence.read", "cadence.behaviors.write", "cadence.occurrences.write"] } } as unknown as IntegrationContext;
const create = { title: "Walk", schedules: [{ recurrence: { frequency: "daily" as const, interval: 1 },
  time_entries: [{ kind: "exact" as const, start_time: "09:00" }] }] };
const current = { id, title: "Walk", description: null, location_text: null, category: null, active: true,
  recurrence_rule: { frequency: "daily", interval: 1 }, scheduled_time: "09:00:00", timezone: "America/New_York",
  browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0,
  created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", archived_at: null,
  auto_archived_at: null, end_date: null, default_duration_minutes: null, archive_notes: [], is_opportunity: false,
  alongside: true,
  schedule_slots: [{ id, kind: "exact", preset: null, start_time: "09:00:00", end_time: null, sort_order: 0 }],
} as unknown as BehaviorWithCategory;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listUserBehaviors).mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("alongside in integration outputs (Ticket 364)", () => {
  it("leaves the field out while CADENCE_ALONGSIDE is off, even when the row carries it", () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    expect(serializeIntegrationBehavior(current, null)).not.toHaveProperty("alongside");
  });

  it("returns the person's setting with the flag on, and null when unanswered or unread", () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    expect(serializeIntegrationBehavior(current, null).alongside).toBe(true);
    expect(serializeIntegrationBehavior({ ...current, alongside: false }, null).alongside).toBe(false);
    expect(serializeIntegrationBehavior({ ...current, alongside: null }, null).alongside).toBeNull();
    const withoutColumn = Object.fromEntries(Object.entries(current).filter(([key]) => key !== "alongside"));
    expect(serializeIntegrationBehavior(withoutColumn as unknown as BehaviorWithCategory, null).alongside).toBeNull();
    const keys = Object.keys(serializeIntegrationBehavior(current, null));
    expect(keys.indexOf("alongside")).toBe(keys.indexOf("is_opportunity") + 1);
  });

  it("puts the Behavior's setting on each Occurrence with the flag on", () => {
    const occurrence = {
      id: "22500000-0000-4000-8000-000000000002", behavior_id: id, local_date: "2026-10-18", status: "unresolved",
      scheduled_for: "2026-10-18T13:00:00Z", schedule_kind: "exact", schedule_preset: null, schedule_start_time: "09:00:00",
      schedule_end_time: null, origin: "scheduled", added_by: null, completed_at: null, status_marked_at: null, note: null,
      updated_at: "2026-10-18T12:00:00Z", created_at: "2026-10-18T12:00:00Z", timezone: "America/New_York",
    } as unknown as Occurrence;
    const now = Temporal.Instant.from("2026-10-18T12:00:00Z");
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    expect(serializeIntegrationOccurrence(occurrence, current, now, "America/New_York")).not.toHaveProperty("alongside");
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    expect(serializeIntegrationOccurrence(occurrence, current, now, "America/New_York").alongside).toBe(true);
  });
});

describe("alongside on create_behavior and update_behavior (Ticket 364)", () => {
  it("passes the setting to the Behavior values only when sent", () => {
    expect(integrationBehaviorInput(create)).not.toHaveProperty("alongside");
    expect(integrationBehaviorInput({ ...create, alongside: true } as never).alongside).toBe(true);
    expect(integrationBehaviorInput({ ...create, alongside: null } as never).alongside).toBeNull();
    // An update that leaves it out never re-sends the stored answer.
    const update = integrationBehaviorInput({ behavior_id: id, expected_revision: current.updated_at, title: "Run" },
      serializeIntegrationBehavior(current, null));
    expect(update).not.toHaveProperty("alongside");
  });

  it("stores the setting through the shared service only when the values carry it", async () => {
    const store = {
      getBehaviorById: vi.fn().mockResolvedValue(stored),
      createBehaviorWithAtomicScheduleGraph: vi.fn().mockResolvedValue(stored),
      updateBehaviorWithAtomicScheduleGraph: vi.fn().mockResolvedValue(stored),
    } satisfies BehaviorDataStore;
    await createBehavior(store, { values, userId: "owner", timezone: "America/New_York", recordedAt });
    expect(store.createBehaviorWithAtomicScheduleGraph.mock.calls[0]![0].behavior).not.toHaveProperty("alongside");
    await createBehavior(store, { values: { ...values, alongside: true }, userId: "owner", timezone: "America/New_York", recordedAt });
    expect(store.createBehaviorWithAtomicScheduleGraph.mock.calls[1]![0].behavior.alongside).toBe(true);
    await updateBehavior(store, { behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, values, recordedAt });
    expect(store.updateBehaviorWithAtomicScheduleGraph.mock.calls[0]![0].behavior).not.toHaveProperty("alongside");
    await updateBehavior(store, { behaviorId: "behavior", expectedUpdatedAt: stored.updated_at, values: { ...values, alongside: null }, recordedAt });
    expect(store.updateBehaviorWithAtomicScheduleGraph.mock.calls[1]![0].behavior.alongside).toBeNull();
  });

  it("refuses the field with the flag off, as contract 1.7.0 does", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    expect(await writeOperationHandlers.create_behavior(context, { ...create, alongside: true }))
      .toMatchObject({ ok: false, error: { code: "invalid_input", contract_version: "1.7.0" } });
    vi.mocked(getBehaviorById).mockResolvedValue(current);
    expect(await writeOperationHandlers.update_behavior(context, { behavior_id: id, expected_revision: current.updated_at, alongside: false }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(updateBehaviorForUser).not.toHaveBeenCalled();
  });

  it("writes an alongside-only update through the update transaction with the flag on", async () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    vi.mocked(getBehaviorById).mockResolvedValue(current);
    const rpc = vi.fn(async (_name: string, args: { p_args: { _integration_prepared?: { output_json: string } } }) => {
      const prepared = args.p_args._integration_prepared;
      if (!prepared) return { data: { fingerprint: "f", source: { version: 1,
        // An unscheduled opportunity keeps the fixture free of schedule ids, as the is_opportunity test does.
        behavior: { ...current, alongside: false, is_opportunity: true, recurrence_rule: null, scheduled_time: null, schedule_slots: [], schedules: [] },
        occurrence: null, previous_status: null, changed: true, as_of: current.updated_at, timezone: "America/New_York", external_ref: null } }, error: null };
      return { data: { receipt: { version: 2, output_json: prepared.output_json }, rpc_result: { id } }, error: null };
    });
    vi.mocked(updateBehaviorForUser).mockImplementation(async (client) => {
      await client.rpc("update_behavior_with_schedule_graph" as never, {} as never);
      return undefined as never;
    });
    const result = await writeOperationHandlers.update_behavior({ ...context, supabase: { rpc } } as unknown as IntegrationContext,
      { behavior_id: id, expected_revision: current.updated_at, alongside: false });
    expect(result).toMatchObject({ ok: true, value: { changed: true, behavior: { alongside: false } } });
    expect(updateBehaviorForUser).toHaveBeenCalledWith(expect.anything(), id,
      expect.objectContaining({ values: expect.objectContaining({ alongside: false }) }), expect.any(String));
    if (result.ok) expect(validateOperationOutput("update_behavior", result.value, { alongside: true }).ok).toBe(true);
  });
});
