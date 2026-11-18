"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { TimelineOccurrenceView, TimelineView } from "@cadence/core/types/timeline";
import { MoveConflictNotices } from "@/components/timeline/MoveConflictNotices";
import {
  MOVE_CONFIRMATION_STYLES,
  OccurrenceMovesProvider,
  type MoveConfirmationStyle,
  type OccurrenceMoveActions,
} from "@/components/timeline/OccurrenceMoves";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
// The Timeline's own row layout, so the bench shows rows as the Timeline does.
import timelineStyles from "@/components/timeline/day-progress-timeline.module.css";

// Advisor plan Phase 2C. The web's own "Move for today" with synthetic rows and no
// account: Gym moves and undoes in memory, Reading is always refused, and Walk shows
// the schedule-edit overlap line. Open a row to see its menu. The four confirmation
// options are side by side for Emi's choice (review of Nov 18).

const STYLE_LABELS: Record<MoveConfirmationStyle, string> = {
  row: "1. In the row",
  corner: "2. Corner note",
  drawer: "3. Bottom drawer",
  dialog: "4. Dialog",
};

// The Timeline measures each row; on a phone width its status actions are icons only.
const NARROW = "(max-width: 639px)";
function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
}

const TZ = "America/New_York";
const TODAY = "2026-11-16";

const base: TimelineOccurrenceView = {
  id: "bench-gym", behaviorId: "bench-b1", title: "Gym", scheduledFor: "2026-11-16T14:00:00Z", scheduledTimeLabel: "9:00 AM",
  scheduleKind: "exact", revision: "r1",
  localDate: TODAY, status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "",
  expandedStatusActionLabel: "Change status", visualTone: "default", isVisibleInNeedsDecision: false,
  canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false,
  description: "Strength session.", categoryName: "Fitness", scheduleSummary: "Daily", note: "",
  timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true,
};
const reading: TimelineOccurrenceView = { ...base, id: "bench-reading", behaviorId: "bench-b2", title: "Reading", scheduledFor: "2026-11-16T16:00:00Z", scheduledTimeLabel: "11:00 AM" };
const walk: TimelineOccurrenceView = {
  ...base, id: "bench-walk", behaviorId: "bench-b3", title: "Walk", scheduledFor: "2026-11-16T16:00:00Z", scheduledTimeLabel: "11:00 AM",
  movedFromLabel: "8:00 AM", revision: "r9",
};

const noop = async () => ({ status: "idle" as const, message: "" });

export function OccurrenceMoveBench() {
  const [gym, setGym] = useState(base);
  const [style, setStyle] = useState<MoveConfirmationStyle>("drawer");
  const narrow = useNarrow();
  const actions = useMemo<OccurrenceMoveActions>(() => ({
    async suggest() { return ["2026-11-16T15:00:00Z", "2026-11-16T17:30:00Z", "2026-11-16T19:00:00Z"]; },
    async move(input) {
      if (input.occurrenceId !== base.id) {
        return { status: "refused", occurrenceId: input.occurrenceId, reason: "slot_taken", message: "Something else is already at that time.",
          alternatives: ["2026-11-16T17:30:00Z", "2026-11-16T19:00:00Z"], revision: input.expectedRevision, currentStartAt: null };
      }
      const [hour, minute] = input.startTime.split(":").map(Number);
      const start = `2026-11-16T${String(hour! + 5).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
      setGym({ ...base, scheduledFor: start, scheduledTimeLabel: label(input.startTime), movedFromLabel: "9:00 AM", revision: "r2" });
      return { status: "moved", occurrenceId: input.occurrenceId, moveId: "bench-move", effectiveStartAt: start, revision: "r2" };
    },
    async revert(input) {
      setGym(base);
      return { status: "undone", occurrenceId: input.occurrenceId, moveId: "bench-undo", effectiveStartAt: base.scheduledFor, revision: "r3" };
    },
    async reason(input) { return { status: "saved", reason: input.reason }; },
    async keep() { return { status: "kept" }; },
  }), []);
  const timeline = { timezone: TZ, todayLocalDate: TODAY, daySections: [{ localDate: TODAY, occurrences: [gym, reading, walk] }] } as unknown as TimelineView;
  return (
    <OccurrenceMovesProvider key={style} confirmation={style} actions={actions} timezone={TZ} todayLocalDate={TODAY} hasMovedBefore={false}>
      <p className="mb-3 text-sm leading-6 text-muted-readable" data-move-style-picker>
        Confirmation:{" "}
        {MOVE_CONFIRMATION_STYLES.map((option, index) => (
          <span key={option} className="whitespace-nowrap">
            {index ? " · " : ""}
            <button type="button" aria-pressed={style === option} data-move-style={option}
              className={`-my-2 inline-block py-2 underline underline-offset-2 ${style === option ? "text-foreground" : ""}`}
              onClick={() => { setGym(base); setStyle(option); }}>{STYLE_LABELS[option]}</button>
          </span>
        ))}
      </p>
      <div className={`grid max-w-3xl gap-1 ${timelineStyles.timeline}`}>
        <MoveConflictNotices conflicts={[{ id: "bench-conflict", occurrenceId: walk.id, conflictingOccurrenceId: reading.id }]} timeline={timeline} />
        {[gym, reading, walk].map((occurrence) => (
          <div key={occurrence.id} className={timelineStyles.row} data-status-icons-only={narrow ? "true" : "false"}>
            <OccurrenceRow occurrence={occurrence} statusIconsOnly={narrow} statusAction={noop as never} noteAction={noop as never}
              startTimeTrackingAction={noop as never} stopTimeTrackingAction={noop as never} resetTimeTrackingAction={noop as never} />
          </div>
        ))}
      </div>
    </OccurrenceMovesProvider>
  );
}

function label(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour! % 12 || 12}:${String(minute).padStart(2, "0")} ${hour! >= 12 ? "PM" : "AM"}`;
}
