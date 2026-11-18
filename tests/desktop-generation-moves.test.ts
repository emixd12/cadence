import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLocalOccurrencesFresh } from "../apps/desktop/src/local-generation.service";
import type { Profile } from "../lib/types/database";
import { storedBehavior, storedExportOccurrence, USER_ID } from "./helpers/export-row-fixture";

// Advisor plan, Phase 2B: Mac generation sees a synced move, so a schedule edit keeps the moved item.
const mocks = vi.hoisted(() => ({ command: vi.fn(), plan: vi.fn() }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: mocks.command, localMutation: (profileId: string, at: string) => ({ profileId, at }) }));
vi.mock("@cadence/core/services/occurrence-sync", () => ({
  decideOccurrenceSyncCoverage: () => ({ covered: false }),
  summarizeOccurrenceSyncPlans: () => ({ timezone: "America/New_York", lastSyncedLocalDate: null, syncedThroughLocalDate: null,
    behaviorCount: 1, createdCount: 0, updatedCount: 0, deletedCount: 1 }),
}));
vi.mock("@cadence/core/services/occurrence-generation", () => ({ planPersistedOccurrences: mocks.plan }));

const NOW = Temporal.Instant.from("2026-05-01T12:00:00Z");
const { category, schedules, schedule_slots, ...behavior } = storedBehavior();
void category; void schedule_slots;
const stored = storedExportOccurrence();
const move = { id: "50000000-0000-4000-8000-000000000001", user_id: USER_ID, occurrence_id: stored.id, behavior_id: behavior.id,
  local_date: stored.local_date, weekday: 5, timezone: behavior.timezone, kind: "move",
  from_start_at: stored.scheduled_for, from_end_at: stored.scheduled_for, from_planned: true,
  to_start_at: "2026-05-01T23:30:00Z", to_end_at: "2026-05-01T23:30:00Z", to_planned: false, duration_source: "planned_length",
  revises_move_id: null, chain_root_id: "50000000-0000-4000-8000-000000000001", chain_position: 1, reason: null,
  source: "person", created_at: NOW.toString() };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.command.mockImplementation(async (operation: string) => ({
    readSyncState: { state_version: 1 }, readBehaviorGraphs: [{ behavior, schedules, slots: [], revision: 1 }],
    readOccurrences: [stored], readOccurrenceHistory: { timeSessions: [] }, readOccurrenceMoves: [move],
  } as Record<string, unknown>)[operation]);
  mocks.plan.mockReturnValue({ create: [], updateUnresolved: [], deleteUnresolved: [{ id: stored.id }] });
});

describe("Mac generation with synced moves", () => {
  it("plans from the moved time and writes against the stored row", async () => {
    await ensureLocalOccurrencesFresh({ id: USER_ID, timezone: "America/New_York" } as Profile, NOW);
    expect(mocks.command).toHaveBeenCalledWith("readOccurrenceMoves", { profileId: USER_ID, occurrenceIds: [stored.id] });
    expect(mocks.plan.mock.calls[0]![0].occurrences[0]).toMatchObject({ id: stored.id, effective_start_at: "2026-05-01T23:30:00Z" });
    // The native store compares whole rows, so the write must carry the row as stored, without effective time.
    const apply = mocks.command.mock.calls.find(([operation]) => operation === "applyOccurrenceGeneration")![1];
    expect(apply.delete).toEqual([stored]);
  });
});
