import type { OccurrenceStatus } from "./types/database";
import type { MarkDetailEventPlan, OccurrenceStatusEventPlan } from "./resolvers/status.resolver";

// Portable persisted records. Web's generated rows must satisfy these contracts.
export type OccurrenceRecord = {
  id: string;
  user_id: string;
  behavior_id: string;
  behavior_configuration_event_id: string | null;
  behavior_schedule_slot_id: string | null;
  scheduled_for: string;
  local_date: string;
  schedule_kind: string;
  schedule_preset: string | null;
  schedule_start_time: string;
  schedule_end_time: string | null;
  schedule_range_identity: number | null;
  status: string;
  completed_at: string | null;
  status_marked_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  /** Derived from the latest per-day move; null when at the planned time. Server rows only. */
  effective_start_at?: string | null;
  effective_end_at?: string | null;
  /** Behaviors of Opportunity. A missing origin means "scheduled". */
  origin?: string;
  added_by?: string | null;
};

export type OccurrenceStatusEventRecord = {
  id: string;
  user_id: string;
  behavior_id: string;
  occurrence_id: string;
  local_date: string;
  timezone: string;
  previous_status: string | null;
  status: string;
  status_semantics: string;
  recorded_at: string;
  effective_at: string | null;
  revises_event_id: string | null;
  reason_code: string | null;
  source_capture_method: string;
  source_confidence: string;
  created_at: string;
  updated_at: string;
};

export type StatusTransitionCommit = {
  occurrenceId: string;
  expectedStatus: OccurrenceStatus;
  expectedLatestEventId: string | null;
  status: OccurrenceStatus;
  completedAt: string | null;
  statusMarkedAt: string | null;
  cancelPendingReminders: boolean;
  event: OccurrenceStatusEventPlan | null;
};

export type StatusTransitionResult = {
  statusChanged: boolean;
  concurrentDuplicate: boolean;
  occurrence: OccurrenceRecord;
  statusEvent: OccurrenceStatusEventRecord | null;
};

/** Advisor plan 4G: a same-status detail event ("Done at" or "Why not done"). */
export type MarkDetailCommit = {
  occurrenceId: string;
  expectedLatestEventId: string;
  /** The Occurrence's `completed_at` after the commit. */
  completedAt: string | null;
  event: MarkDetailEventPlan;
};

export type MarkDetailResult = {
  occurrence: OccurrenceRecord;
  statusEvent: OccurrenceStatusEventRecord;
};

// Each adapter is scoped to one authorized web user or the stable local profile.
// Commits must check preconditions and write history/reminder changes atomically.
export type OccurrenceDataStore = {
  readStatusContext(occurrenceId: string): Promise<{
    occurrence: OccurrenceRecord;
    latestStatusEventId: string | null;
    timezone: string;
  } | null>;
  applyStatusTransition(input: StatusTransitionCommit): Promise<StatusTransitionResult>;
  /** Appends the detail event and sets `completed_at`, only while the latest event is still the expected one. */
  applyMarkDetail(input: MarkDetailCommit): Promise<MarkDetailResult>;
  updateOccurrenceNote(input: {
    occurrenceId: string;
    expectedNote: string | null;
    note: string | null;
    usedShortcut?: boolean;
  }): Promise<OccurrenceRecord | null>;
};

export type DayNoteSaveCommit = {
  localDate: string;
  expectedNote: string | null;
  note: string | null;
  usedShortcut?: boolean;
};

// Day notes belong to a calendar date, never to an Occurrence. Adapters are scoped
// to one authorized web user or the stable local profile and compare-and-set on
// the stored note text. A null result means the stored note changed.
export type DayNoteDataStore = {
  listDayNotes(range: { from: string; to: string }): Promise<import("./resolvers/day-note.resolver").DayNoteRecord[]>;
  saveDayNote(input: DayNoteSaveCommit): Promise<import("./resolvers/day-note.resolver").DayNoteRecord | null>;
};
