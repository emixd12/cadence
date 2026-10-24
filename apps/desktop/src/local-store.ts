import type { LocalImportWritePlan, PortabilityImportRunRow, PortabilitySnapshot, PortabilityNoteRow, PortabilityInterventionRow, PortabilityMappingRow } from "@cadence/core/types/portability-rows";
import { invoke } from "@tauri-apps/api/core";
import type { NativeDeliveryProof } from "./native-spike";
import type {
  Behavior, BehaviorConfigurationEvent, BehaviorDefinitionEvent,
  BehaviorSchedule, BehaviorScheduleSlot, Category, OccurrenceSyncState,
  OccurrenceTimeSession, Profile, ReminderDelivery,
} from "../../../lib/types/database";
import type {
  OccurrenceRecord, OccurrenceStatusEventRecord, StatusTransitionResult,
  StatusTransitionCommit,
} from "@cadence/core/data-store";
import type { AccountSyncEntity, AccountSyncWrite } from "@cadence/core/resolvers/account-sync.resolver";
import type { NoteShortcutContext, NoteShortcutState } from "@cadence/core/types/note-shortcut";
import type { TravelHabits, TravelSettings } from "@cadence/core/types/travel";

export type LocalBehaviorGraph = {
  behavior: Behavior;
  schedules: BehaviorSchedule[];
  slots: BehaviorScheduleSlot[];
};
type Owned = { profileId: string };
export type Mutation = Owned & { mutationId: string; now: string };
export type NativeReminderRow = {
  user_id: string; id: string; occurrence_id: string; request_id: string; fire_at: string;
  title: string; body: string; status: "planned" | "scheduled" | "cancelled" | "failed" | "delivered";
  error: string | null; verified_at: string | null; created_at: string; updated_at: string;
};
export type NativeCoverageRow = {
  user_id: string; status: "complete" | "limited" | "unverified";
  target_through: string; scheduled_through: string; first_unscheduled_at: string | null;
  expected_count: number; scheduled_count: number; missing_ids: string[]; reason: string | null;
  verified_at: string | null; updated_at: string; dataset_revision: number;
};
export type NativeReminderState = { revision: number; reminders: NativeReminderRow[]; coverage: NativeCoverageRow | null };
export type LocalCommandMap = {
  validateAccountSyncSnapshot: { input: { entities: AccountSyncEntity[] }; result: null };
  manageCategories: { input: Mutation & {
    expectedCategories: import("@cadence/core/services/category.service").ManagedCategory[];
    nextCategories: import("@cadence/core/services/category.service").ManagedCategory[];
    updates: { graph: LocalBehaviorGraph; expectedRevision: number; configurationEvent: BehaviorConfigurationEvent | null }[];
  }; result: null };

  applyAccountSync: { input: Owned & { writes: AccountSyncWrite[] }; result: { appliedCount: number } };
  applyFirstLinkAccountSync: { input: Owned & { hostedUserId: string; choice: "import" | "ignore" | "hydrate"; attemptId: string; localFingerprint: string; hostedFingerprint: string;
    expectedRevision: number; idempotencyKey: string; baselineFingerprint: string; baselineJson: string; backupPath: string | null; completedAt: string; writes: AccountSyncWrite[] }; result: { appliedCount: number } };
  readImportRuns: { input: Owned & { limit: number; kind?: "import" | "restore" }; result: PortabilityImportRunRow[] };
  readImportSnapshot: { input: Owned; result: PortabilitySnapshot & { noteShortcutStates: NoteShortcutState[] } };
  readTravelSettings: { input: Owned; result: TravelSettings };
  commitTravelSettings: {
    input: Mutation & { expectedUpdatedAt: string; next: Omit<TravelSettings, "habits"> };
    result: TravelSettings;
  };
  commitTravelHabits: {
    input: Mutation & { expectedUpdatedAt: string | null; next: Omit<TravelHabits, "updatedAt"> & { updatedAt: string } };
    result: TravelSettings;
  };
  readNoteShortcutStates: { input: Owned; result: NoteShortcutState[] };
  readPlaceLabels: { input: Owned; result: import("./local-place-labels.service").LocalPlaceLabelRows };
  commitPlaceLabels: {
    input: Mutation & { mutation: import("./local-place-labels.service").LocalPlaceLabelMutation };
    result: import("./local-place-labels.service").LocalPlaceLabelRows;
  };
  readNoteShortcutContext: { input: Owned & { behaviorId: string | null }; result: NoteShortcutContext };
  commitNoteShortcutState: {
    input: Mutation & { expected: NoteShortcutContext; next: NoteShortcutState; requireEnabled: boolean };
    result: NoteShortcutState;
  };
  prepareBehaviorLogImport: {
    input: Mutation & { expectedRevision: number; previewRun: PortabilityImportRunRow; plan: LocalImportWritePlan | null };
    result: { previewRun: PortabilityImportRunRow; revision: number };
  };
  applyBehaviorLogImport: {
    input: Mutation & { previewRunId: string; importMode: LocalImportWritePlan["mode"]; previewFingerprint: string; localDataFingerprint: string; bundleFingerprint: string; bundlePayloadFingerprint: string | null };
    result: { status: "applied" | "failed"; importRun: PortabilityImportRunRow; result?: import("@cadence/core/types/json").Json; error?: string; alreadyApplied: boolean };
  };
  updateProfileTimezone: {
    input: Mutation & { expectedTimezone: string; expectedSyncVersion: number; timezone: string;
      updates: { graph: LocalBehaviorGraph; expectedRevision: number; configurationEvent: BehaviorConfigurationEvent | null }[] };
    result: Profile;
  };
  readNativeReminderState: { input: Owned; result: NativeReminderState };
  commitNativeReminderPlan: {
    input: Mutation & { expectedRevision: number; reminders: NativeReminderRow[]; cancelIds: string[] };
    result: NativeReminderState;
  };
  recordNativeReminderCoverage: {
    input: Mutation & { expectedRevision: number;
      coverage: Omit<NativeCoverageRow, "user_id" | "dataset_revision" | "updated_at">;
      observed: { id: string; status: "scheduled" | "cancelled" | "failed" | "delivered"; error: string | null; delivery?: NativeDeliveryProof }[] };
    result: NativeReminderState;
  };
  readExportSnapshot: {
    input: Owned & { startLocalDate: string | null; endLocalDate: string; includeTimeTracking: boolean; throughStartedAt: string };
    result: { categories: Category[]; graphs: (LocalBehaviorGraph & { revision: number })[];
      behaviorDefinitionEvents: BehaviorDefinitionEvent[]; behaviorConfigurationEvents: BehaviorConfigurationEvent[];
      occurrences: OccurrenceRecord[]; statusEvents: OccurrenceStatusEventRecord[]; reminderDeliveries: ReminderDelivery[];
      timeSessions: OccurrenceTimeSession[]; nativeReminders: NativeReminderRow[];
      importedNotes: PortabilityNoteRow[]; importedInterventions: PortabilityInterventionRow[];
      importRuns: PortabilityImportRunRow[]; importMappings: PortabilityMappingRow[] };
  };
  readProfile: { input: Record<string, never>; result: Profile };
  readCategories: { input: Owned; result: Category[] };
  readBehaviorGraphs: { input: Owned; result: (LocalBehaviorGraph & { revision: number })[] };
  readOccurrence: { input: Owned & { occurrenceId: string }; result: OccurrenceRecord | null };
  readOccurrences: {
    input: Owned & { startLocalDate: string; endLocalDate: string; behaviorId?: string; status?: OccurrenceRecord["status"] };
    result: OccurrenceRecord[];
  };
  readOccurrenceHistory: {
    input: Owned & { occurrenceIds: string[] };
    result: { statusEvents: OccurrenceStatusEventRecord[]; timeSessions: OccurrenceTimeSession[] };
  };
  readSyncState: { input: Owned; result: OccurrenceSyncState };
  createBehaviorGraph: {
    input: Mutation & { graph: LocalBehaviorGraph; definitionEvent: BehaviorDefinitionEvent; configurationEvent: BehaviorConfigurationEvent };
    result: LocalBehaviorGraph & { revision: number };
  };
  updateBehaviorGraph: {
    input: Mutation & { graph: LocalBehaviorGraph; expectedRevision: number;
      expectedNormalizedDefinition: { title: string; description: string | null };
      definitionEvent: BehaviorDefinitionEvent | null; configurationEvent: BehaviorConfigurationEvent | null };
    result: LocalBehaviorGraph & { revision: number };
  };
  applyOccurrenceGeneration: {
    input: Mutation & {
      behaviorId: string; expectedConfigurationEventId: string;
      create: OccurrenceRecord[];
      update: { expected: OccurrenceRecord; next: OccurrenceRecord }[];
      delete: OccurrenceRecord[];
    };
    result: { insertedCount: number; updatedCount: number; deletedCount: number };
  };
  applyStatusTransition: {
    input: Mutation & Omit<StatusTransitionCommit, "event"> & { event: OccurrenceStatusEventRecord | null };
    result: StatusTransitionResult;
  };
  updateOccurrenceNote: {
    input: Mutation & { occurrenceId: string; expectedNote: string | null; note: string | null; usedShortcut?: boolean };
    result: OccurrenceRecord | null;
  };
  startTimeSession: { input: Mutation & { session: OccurrenceTimeSession }; result: OccurrenceTimeSession | null };
  stopTimeSession: { input: Mutation & { occurrenceId: string; sessionId: string; stoppedAt: string }; result: OccurrenceTimeSession | null };
  resetTimeSessions: {
    input: Mutation & { occurrenceId: string; expectedSessions: OccurrenceTimeSession[] };
    result: { deletedIds: string[] };
  };
  commitSyncState: { input: Mutation & { expectedVersion: number; state: OccurrenceSyncState }; result: OccurrenceSyncState };
};

let pendingLocalCommands = 0;
export function hasPendingLocalCommands() { return pendingLocalCommands > 0; }

export async function localDatabaseCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  pendingLocalCommands += 1;
  try { return await invoke<T>(command, args); }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
  finally { pendingLocalCommands -= 1; }
}

// No SQL, arbitrary table names, filesystem paths, or provider credentials cross IPC.
export function localCommand<K extends keyof LocalCommandMap>(
  operation: K,
  input: LocalCommandMap[K]["input"],
): Promise<LocalCommandMap[K]["result"]> {
  return localDatabaseCommand("local_store", { request: { operation, ...input } });
}

export function localMutation(profileId: string, now: string): Mutation {
  return { profileId, now, mutationId: crypto.randomUUID() };
}
