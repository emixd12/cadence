import { beforeEach, describe, expect, it, vi } from "vitest";
import { stored } from "./helpers/behavior-graph-fixture";

// Audit fix 12 (D33): the web's question surfaces record the same configuration history
// as the Mac's row question: one revision naming `alongside` with reason code
// `alongside_answered`, not `behavior_edited`.

const commits = vi.fn();
const held = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
vi.mock("@/lib/db/behavior-store", () => ({
  createBehaviorStore: () => ({
    getBehaviorById: async () => held.row,
    updateBehaviorWithAtomicScheduleGraph: async (input: Record<string, unknown>) => { commits(input); return { ...held.row, ...(input.behavior as object) }; },
  }),
}));
vi.mock("@/lib/db/behaviors.repo", () => ({ getBehaviorById: async () => held.row, getProfileTimezone: vi.fn(), listUserBehaviors: vi.fn() }));
vi.mock("@/lib/cache/stable-user-data.cache", () => ({
  invalidateBehaviorData: vi.fn(), readCachedBehaviorCategories: vi.fn(), readCachedProfileTimezone: async () => null, readCachedUserBehaviors: vi.fn(),
}));
vi.mock("@/lib/monitoring/privacy-safe-events", () => ({ reportMonitoringError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/occurrence.service", () => ({ syncUserOccurrencesAndReminders: vi.fn() }));

const { recordBehaviorAlongsideAnswer } = await import("@/lib/services/alongside-answer.service");

const behavior = { ...stored, id: "11111111-1111-4111-8111-111111111111", alongside: null };

beforeEach(() => { commits.mockReset(); held.row = { ...behavior }; });

describe("web alongside answer history (audit fix 12)", () => {
  it("records one revision with reason code alongside_answered", async () => {
    await expect(recordBehaviorAlongsideAnswer({} as never, "user-1", {
      behaviorId: behavior.id, alongside: true, recordedAt: "2026-11-25T14:00:00Z", env: { CADENCE_ALONGSIDE: "on" },
    })).resolves.toEqual({ behaviorId: behavior.id, alongside: true, changed: true });
    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits.mock.calls[0]![0]).toMatchObject({
      expectedUpdatedAt: behavior.updated_at, definitionEventPlan: null,
      behavior: { alongside: true, title: behavior.title },
      configurationEventPlan: { changedFields: ["alongside"], reasonCode: "alongside_answered" },
    });
  });
});
