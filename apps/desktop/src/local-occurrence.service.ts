import { Temporal } from "@js-temporal/polyfill";
import type { OccurrenceDataStore, OccurrenceStatusEventRecord, StatusTransitionCommit } from "@cadence/core/data-store";
import {
  applyOccurrenceStatusTransition, applyParentSlotStatusTransition, recordOccurrenceDoneAt, recordOccurrenceNotDoneReason, updateOccurrenceNote,
} from "@cadence/core/services/occurrence.service";
import {
  startOccurrenceTimeTracking, stopOccurrenceTimeTracking, resetOccurrenceTimeTracking,
  type TimeTrackingDataStore,
} from "@cadence/core/services/time-tracking.service";
import type { OccurrenceStatus } from "@cadence/core/types/database";
import type { TimeSession } from "@cadence/core/types/time-tracking";
import type { OccurrenceTimeSession } from "../../../lib/types/database";
import { localCommand, localMutation } from "./local-store";

export function createLocalOccurrenceStore(profileId: string, now: Temporal.Instant): OccurrenceDataStore {
  type StatusContext = NonNullable<Awaited<ReturnType<OccurrenceDataStore["readStatusContext"]>>>;
  let context: StatusContext | null = null;
  // A routine mark reads every sub-behavior Occurrence of the slot before one commit.
  const contexts = new Map<string, StatusContext>();
  const statusEvent = (plan: StatusTransitionCommit, read: StatusContext): OccurrenceStatusEventRecord | null => plan.event ? {
    id: crypto.randomUUID(), user_id: profileId,
    occurrence_id: plan.occurrenceId, behavior_id: read.occurrence.behavior_id,
    local_date: read.occurrence.local_date, timezone: read.timezone,
    previous_status: plan.event.previousStatus, status: plan.event.status,
    status_semantics: plan.event.statusSemantics, recorded_at: plan.event.recordedAt,
    effective_at: plan.event.effectiveAt, reason_code: null,
    revises_event_id: plan.event.statusSemantics === "explicit_user_correction" ? plan.expectedLatestEventId : null,
    source_capture_method: plan.event.sourceCaptureMethod,
    source_confidence: plan.event.sourceConfidence,
    created_at: now.toString(), updated_at: now.toString(),
  } : null;
  return {
    async readStatusContext(occurrenceId) {
      const [occurrence, history, graphs] = await Promise.all([
        localCommand("readOccurrence", { profileId, occurrenceId }),
        localCommand("readOccurrenceHistory", { profileId, occurrenceIds: [occurrenceId] }),
        localCommand("readBehaviorGraphs", { profileId }),
      ]);
      if (!occurrence) return null;
      const graph = graphs.find(({ behavior }) => behavior.id === occurrence.behavior_id);
      if (!graph) throw new Error("Behavior not found.");
      const latest = [...history.statusEvents].sort(compareStatusEvents)[0];
      context = { occurrence, latestStatusEventId: latest?.id ?? null, timezone: graph.behavior.timezone };
      contexts.set(occurrence.id, context);
      return context;
    },
    async applyStatusTransition(plan) {
      if (!context || context.occurrence.id !== plan.occurrenceId) throw new Error("Read the occurrence before changing its status.");
      return localCommand("applyStatusTransition", { ...localMutation(profileId, now.toString()), ...plan, event: statusEvent(plan, context) });
    },
    async applyParentSlotStatusTransition({ parentBehaviorId, commits }) {
      const transitions = commits.map((plan) => {
        const read = contexts.get(plan.occurrenceId);
        if (!read) throw new Error("Read the occurrence before changing its status.");
        return { ...plan, event: statusEvent(plan, read) };
      });
      return localCommand("applyParentSlotStatusTransition", {
        ...localMutation(profileId, now.toString()), parentBehaviorId, transitions,
      });
    },
    async applyMarkDetail(plan) {
      if (!context || context.occurrence.id !== plan.occurrenceId) throw new Error("Read the occurrence before changing it.");
      const event: OccurrenceStatusEventRecord = {
        id: crypto.randomUUID(), user_id: profileId,
        occurrence_id: plan.occurrenceId, behavior_id: context.occurrence.behavior_id,
        local_date: context.occurrence.local_date, timezone: context.timezone,
        previous_status: plan.event.previousStatus, status: plan.event.status,
        status_semantics: plan.event.statusSemantics, recorded_at: plan.event.recordedAt,
        effective_at: plan.event.effectiveAt, reason_code: plan.event.reasonCode,
        revises_event_id: plan.expectedLatestEventId,
        source_capture_method: plan.event.sourceCaptureMethod,
        source_confidence: plan.event.sourceConfidence,
        created_at: now.toString(), updated_at: now.toString(),
      };
      return localCommand("applyMarkDetail", {
        ...localMutation(profileId, now.toString()),
        occurrenceId: plan.occurrenceId, expectedLatestEventId: plan.expectedLatestEventId, completedAt: plan.completedAt, event,
      });
    },
    updateOccurrenceNote: ({ usedShortcut, ...plan }) => localCommand("updateOccurrenceNote", {
      ...localMutation(profileId, now.toString()), ...plan, ...(usedShortcut ? { usedShortcut: true } : {}),
    }),
  };
}

export function createLocalTimeTrackingStore(profileId: string, now: Temporal.Instant): TimeTrackingDataStore {
  const sessions = async (occurrenceId: string) =>
    (await localCommand("readOccurrenceHistory", { profileId, occurrenceIds: [occurrenceId] })).timeSessions;
  return {
    readOccurrence: (occurrenceId) => localCommand("readOccurrence", { profileId, occurrenceId }),
    readBehavior: async (id) => (await localCommand("readBehaviorGraphs", { profileId }))
      .find(({ behavior }) => behavior.id === id)?.behavior ?? null,
    listSessions: async (id) => (await sessions(id)).map(toTimeSession),
    async createRunningSession(input) {
      const session = await localCommand("startTimeSession", {
        ...localMutation(profileId, now.toString()),
        session: { id: crypto.randomUUID(), user_id: profileId, occurrence_id: input.occurrenceId,
          behavior_id: input.behaviorId, started_at: input.startedAt, stopped_at: null,
          created_at: now.toString(), updated_at: now.toString() },
      });
      return session ? toTimeSession(session) : null;
    },
    async stopRunningSession(input) {
      const session = await localCommand("stopTimeSession", { ...localMutation(profileId, now.toString()), ...input });
      return session ? toTimeSession(session) : null;
    },
    async resetSessions(occurrenceId, expected) {
      const current = await sessions(occurrenceId);
      const before = [...expected].sort((a, b) => a.id.localeCompare(b.id));
      const after = current.map(toTimeSession).sort((a, b) => a.id.localeCompare(b.id));
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Time tracking changed. Review it before resetting.");
      return (await localCommand("resetTimeSessions", {
        ...localMutation(profileId, now.toString()), occurrenceId, expectedSessions: current,
      })).deletedIds;
    },
  };
}

export async function markLocalOccurrence(profileId: string, input: {
  occurrenceId: string; expectedStatus: OccurrenceStatus; nextStatus: OccurrenceStatus;
}, now = Temporal.Now.instant()) {
  return (await applyOccurrenceStatusTransition(createLocalOccurrenceStore(profileId, now), { ...input, now })).result;
}

/** Sub-behaviors: marks every sub-behavior Occurrence of one routine slot on the Mac. */
export async function markLocalParentSlot(profileId: string, input: {
  parentBehaviorId: string; occurrenceIds: string[]; nextStatus: OccurrenceStatus;
}, now = Temporal.Now.instant()) {
  return (await applyParentSlotStatusTransition(createLocalOccurrenceStore(profileId, now), { ...input, now })).results;
}

/** Advisor plan 4G: "Done at" after a late Completed mark on the Mac. */
export async function recordLocalDoneAt(profileId: string, input: { occurrenceId: string; doneAt: string }, now = Temporal.Now.instant()) {
  return recordOccurrenceDoneAt(createLocalOccurrenceStore(profileId, now), {
    occurrenceId: input.occurrenceId, doneAt: Temporal.Instant.from(input.doneAt), now,
  });
}

/** Advisor plan 4G: an optional reason on Not Completed on the Mac. */
export async function recordLocalNotDoneReason(profileId: string, input: { occurrenceId: string; reason: string }, now = Temporal.Now.instant()) {
  return recordOccurrenceNotDoneReason(createLocalOccurrenceStore(profileId, now), { ...input, now });
}

export async function saveLocalOccurrenceNote(profileId: string, input: {
  occurrenceId: string; expectedNote: string; note: string; usedShortcut?: boolean;
}, now = Temporal.Now.instant()) {
  return updateOccurrenceNote(createLocalOccurrenceStore(profileId, now), input);
}

export async function trackLocalOccurrence(profileId: string, occurrenceId: string,
  operation: "start" | "stop" | "reset", now = Temporal.Now.instant()) {
  const store = createLocalTimeTrackingStore(profileId, now);
  if (operation === "start") return startOccurrenceTimeTracking(store, occurrenceId, now);
  if (operation === "stop") return stopOccurrenceTimeTracking(store, occurrenceId, now);
  return resetOccurrenceTimeTracking(store, occurrenceId);
}

export function toTimeSession(session: OccurrenceTimeSession): TimeSession {
  return { id: session.id, userId: session.user_id, occurrenceId: session.occurrence_id,
    behaviorId: session.behavior_id, startedAt: session.started_at, stoppedAt: session.stopped_at };
}

function compareStatusEvents(a: OccurrenceStatusEventRecord, b: OccurrenceStatusEventRecord) {
  return Temporal.Instant.compare(b.recorded_at, a.recorded_at)
    || Temporal.Instant.compare(b.created_at, a.created_at) || b.id.localeCompare(a.id);
}
