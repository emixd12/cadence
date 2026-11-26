import type { OccurrenceStatus } from "./types/database";
import type { MarkDetailEventPlan, OccurrenceStatusEventPlan } from "./resolvers/status.resolver";
import type { TimeSession } from "./types/time-tracking";

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

export type StatusTransitionTimeTrackingStop = Readonly<{
  sessionId: string;
  stoppedAt: string;
}>;

export type StatusTransitionCommit = {
  occurrenceId: string;
  expectedStatus: OccurrenceStatus;
  expectedLatestEventId: string | null;
  status: OccurrenceStatus;
  completedAt: string | null;
  statusMarkedAt: string | null;
  cancelPendingReminders: boolean;
  timeTrackingStop?: StatusTransitionTimeTrackingStop | null;
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
    timeSessions?: TimeSession[];
  } | null>;
  applyStatusTransition(input: StatusTransitionCommit): Promise<StatusTransitionResult>;
  /**
   * Sub-behaviors: every commit of one parent slot in one transaction, in order. Stores
   * without it cannot mark a parent slot.
   */
  applyParentSlotStatusTransition?(input: {
    parentBehaviorId: string;
    commits: StatusTransitionCommit[];
  }): Promise<StatusTransitionResult[]>;
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

export type PeriodCreateCommit = {
  label: string;
  startOn: string;
  endOn: string | null;
  note: string | null;
};

export type PeriodCreateIfAbsentResult = {
  period: import("./resolvers/period.resolver").PeriodRecord;
  /** False when a Period with the same natural key already existed. */
  created: boolean;
};

export type PeriodUpdateCommit = PeriodCreateCommit & {
  id: string;
  expectedRevision: number;
};

export type PeriodDeleteCommit = {
  id: string;
  expectedRevision: number;
};

// Periods belong to the account, never to a Behavior or an Occurrence (Ticket 368).
// Adapters are scoped to one authorized web user or the stable local profile and
// compare-and-set on `revision`. A null result from updatePeriod or deletePeriod
// means the Period changed or is gone. createPeriod throws when the account already
// holds PERIOD_LIMITS.perAccount Periods. listPeriods returns every Period of the
// account, or with a range at least those with a day inside it.
export type PeriodDataStore = {
  listPeriods(range?: { from: string; to: string }): Promise<import("./resolvers/period.resolver").PeriodRecord[]>;
  getPeriod(id: string): Promise<import("./resolvers/period.resolver").PeriodRecord | null>;
  createPeriod(input: PeriodCreateCommit): Promise<import("./resolvers/period.resolver").PeriodRecord>;
  /**
   * Ticket 373: adds the Period unless the account already has one with the same
   * natural key (`periodNaturalKey`: exact label, first day, last day, ongoing
   * matching ongoing), as one atomic step. An existing Period is returned unchanged
   * with `created: false`. Throws at the cap like createPeriod. Optional: BehaviorLog
   * import and restore use it when present, so overlapping applies of one bundle
   * cannot store a Period twice; without it they fall back to createPeriod.
   */
  createPeriodIfAbsent?(input: PeriodCreateCommit): Promise<PeriodCreateIfAbsentResult>;
  updatePeriod(input: PeriodUpdateCommit): Promise<import("./resolvers/period.resolver").PeriodRecord | null>;
  deletePeriod(input: PeriodDeleteCommit): Promise<string | null>;
};
