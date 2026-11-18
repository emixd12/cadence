import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorGraphRecord } from "@cadence/core/behavior-store";
import type { OccurrenceRecord } from "@cadence/core/data-store";
import { resolveGenerationWindow, type OccurrenceGenerationPlan } from "@cadence/core/resolvers/occurrence.resolver";
import { resolveNativeReminderGenerationHorizon } from "@cadence/core/resolvers/native-reminder.resolver";
import { planPersistedOccurrences } from "@cadence/core/services/occurrence-generation";
import { decideOccurrenceSyncCoverage, summarizeOccurrenceSyncPlans } from "@cadence/core/services/occurrence-sync";
import type { Category, Profile } from "../../../lib/types/database";
import { withLocalMoves } from "./local-moves.service";
import { localCommand, localMutation, type LocalBehaviorGraph } from "./local-store";

let generationQueue: Promise<void> = Promise.resolve();

export function ensureLocalOccurrencesFresh(profile: Profile, now = Temporal.Now.instant()) {
  // One local profile. Focus, mutations, and screen loads share the same generation queue.
  const next = generationQueue.catch(() => undefined).then(() => syncLocalOccurrences(profile, now));
  generationQueue = next;
  return next;
}

async function syncLocalOccurrences(profile: Profile, now: Temporal.Instant) {
  const profileId = profile.id;
  // Capture the state before graph reads. A concurrent graph write invalidates this version.
  const state = await localCommand("readSyncState", { profileId });
  const graphs = await localCommand("readBehaviorGraphs", { profileId });
  const { horizonDays } = resolveNativeReminderGenerationHorizon(graphs.map(({ behavior }) => behavior));
  const window = resolveGenerationWindow({ now, timezone: profile.timezone, horizonDays });
  if (decideOccurrenceSyncCoverage(state, window).covered) return;
  const plans: OccurrenceGenerationPlan[] = [];
  for (const graph of graphs) {
    const behaviorWindow = resolveGenerationWindow({ now, timezone: graph.behavior.timezone, horizonDays, behaviorEndDate: graph.behavior.end_date });
    const rows = await localCommand("readOccurrences", {
      profileId, behaviorId: graph.behavior.id,
      startLocalDate: behaviorWindow.startLocalDate, endLocalDate: "9999-12-31",
    });
    const history = await localCommand("readOccurrenceHistory", { profileId, occurrenceIds: rows.map(({ id }) => id) });
    // Generation keeps a moved Occurrence and adds no second copy for its day. It reads
    // effective time from these in-memory copies; writes below still use the stored rows.
    const moved = await withLocalMoves(profileId, rows);
    const plan = planPersistedOccurrences({
      behavior: toLocalBehaviorGraphRecord(graph, []), occurrences: moved,
      timeSessionOccurrenceIds: new Set(history.timeSessions.map((session) => session.occurrence_id)),
      now, horizonDays,
    });
    plans.push(plan);
    if (plan.create.length + plan.updateUnresolved.length + plan.deleteUnresolved.length === 0) continue;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const expected = (id: string) => {
      const row = byId.get(id);
      if (!row) throw new Error("Occurrence changed before generation.");
      return row;
    };
    await localCommand("applyOccurrenceGeneration", {
      ...localMutation(profileId, now.toString()), behaviorId: graph.behavior.id,
      expectedConfigurationEventId: graph.behavior.current_configuration_event_id!,
      create: plan.create.map((row): OccurrenceRecord => ({
        id: crypto.randomUUID(), user_id: profileId, behavior_id: row.behaviorId,
        ...scheduleColumns(row), status: "unresolved", note: null,
        completed_at: null, status_marked_at: null, created_at: now.toString(), updated_at: now.toString(),
      })),
      update: plan.updateUnresolved.map((row) => ({ expected: expected(row.id),
        next: { ...expected(row.id), ...scheduleColumns(row), updated_at: now.toString() } })),
      delete: plan.deleteUnresolved.map((row) => expected(row.id)),
    });
  }
  const summary = summarizeOccurrenceSyncPlans({ plans, fallbackWindow: window, timezone: profile.timezone });
  await localCommand("commitSyncState", {
    ...localMutation(profileId, now.toString()), expectedVersion: state.state_version,
    state: { ...state, timezone: summary.timezone, stale: false, stale_reason: null,
      last_synced_local_date: summary.lastSyncedLocalDate, synced_through_local_date: summary.syncedThroughLocalDate,
      last_successful_sync_at: now.toString(), last_sync_behavior_count: summary.behaviorCount,
      last_sync_created_count: summary.createdCount, last_sync_updated_count: summary.updatedCount,
      last_sync_deleted_count: summary.deletedCount, updated_at: now.toString() },
  });
}

export function toLocalBehaviorGraphRecord(graph: LocalBehaviorGraph, categories: Category[]): BehaviorGraphRecord {
  const category = categories.find(({ id }) => id === graph.behavior.category_id);
  return { ...graph.behavior, category: category ? { id: category.id, name: category.name } : null,
    schedules: graph.schedules.map((schedule) => ({ ...schedule,
      schedule_slots: graph.slots.filter((slot) => slot.behavior_schedule_id === schedule.id) })),
    schedule_slots: graph.slots };
}

function scheduleColumns(row: OccurrenceGenerationPlan["create"][number] | OccurrenceGenerationPlan["updateUnresolved"][number]) {
  const end = row.scheduleEndTime ? Temporal.PlainTime.from(row.scheduleEndTime) : null;
  return {
    behavior_configuration_event_id: row.behaviorConfigurationEventId,
    behavior_schedule_slot_id: row.scheduleSlotId,
    scheduled_for: row.scheduledFor, local_date: row.localDate,
    schedule_kind: row.scheduleKind, schedule_preset: row.schedulePreset,
    schedule_start_time: canonicalTime(row.scheduleStartTime),
    schedule_end_time: row.scheduleEndTime ? canonicalTime(row.scheduleEndTime) : null,
    schedule_range_identity: end ? (end.hour * 3600 + end.minute * 60 + end.second) * 1_000_000
      + end.millisecond * 1000 + end.microsecond : -1,
  };
}

export function canonicalTime(value: string) {
  return Temporal.PlainTime.from(value).toString({ smallestUnit: "microsecond" }).replace(/\.0+$/, "");
}
