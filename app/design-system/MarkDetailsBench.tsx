"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { TimelineOccurrenceView } from "@cadence/core/types/timeline";
import { MARK_DETAIL_PROMPTS, type MarkDetailPromptSettings } from "@cadence/core/resolvers/status.resolver";
import { OccurrenceMarkDetailsProvider, type OccurrenceMarkDetailActions } from "@/components/timeline/OccurrenceMarkDetails";
import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import type { OccurrenceActionState } from "@/lib/types/timeline";
// The Timeline's own row layout, so the bench shows rows as the Timeline does.
import timelineStyles from "@/components/timeline/day-progress-timeline.module.css";

// Advisor plan Phase 4, workstream 4G. Synthetic rows set five hours ago, so a tap on
// Completed is a late mark and offers "Done at"; a tap on Not Completed offers "Why?".
// Nothing is stored. Walk is a range ("Morning") and offers only Just now and Other time.
// Ticket 360: Red light helmet is set for now with its alongside question open, so a tap
// on Completed asks "Done alongside other things? Yes · No" (every time on the bench).

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

function rows(): TimelineOccurrenceView[] {
  const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000);
  fiveHoursAgo.setUTCMinutes(0, 0, 0);
  const label = fiveHoursAgo.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  const localDate = fiveHoursAgo.toLocaleDateString("en-CA", { timeZone: TZ });
  const now = new Date();
  const nowLabel = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  const base: TimelineOccurrenceView = {
    id: "bench-gym", behaviorId: "bench-b1", title: "Gym", scheduledFor: fiveHoursAgo.toISOString(), scheduledTimeLabel: label,
    scheduleKind: "exact", localDate, status: "unresolved", statusMarkedAt: null, statusLabel: "Unresolved", statusDetail: "",
    expandedStatusActionLabel: "Change status", visualTone: "default", isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true, showDecisionActions: true, showCollapsedStatusLabel: false,
    description: "Strength session.", categoryName: "Fitness", scheduleSummary: "Daily", note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true,
  };
  return [
    base,
    { ...base, id: "bench-reading", behaviorId: "bench-b2", title: "Reading", description: "Twenty pages." },
    { ...base, id: "bench-walk", behaviorId: "bench-b3", title: "Walk", scheduleKind: "range", scheduledTimeLabel: "Morning",
      scheduleEndTime: "00:00", description: "Outside if it is dry." },
    { ...base, id: "bench-helmet", behaviorId: "bench-b4", title: "Red light helmet", scheduledFor: now.toISOString(), scheduledTimeLabel: nowLabel,
      localDate: now.toLocaleDateString("en-CA", { timeZone: TZ }), description: "Ten minutes.", alongside: { source: "guess" }, alongsideQuestion: true },
  ];
}

const BENCH_STATUSES = ["completed", "not_completed", "unresolved"] as const;
/** The bench asks the alongside question on every eligible mark, so it can be seen. */
const BENCH_PROMPTS: MarkDetailPromptSettings = { ...MARK_DETAIL_PROMPTS, alongside: { share: 1 } };

const markAction = async (_state: OccurrenceActionState, formData: FormData): Promise<OccurrenceActionState> => {
  const status = String(formData.get("status"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  const nextStatus = BENCH_STATUSES.find((value) => value === status);
  return { status: "success", message: "", ...(nextStatus ? { nextStatus } : {}) };
};
const noop = async () => ({ status: "idle" as const, message: "" });

export function MarkDetailsBench() {
  const [occurrences] = useState(rows);
  const narrow = useNarrow();
  const actions = useMemo<OccurrenceMarkDetailActions>(() => ({
    async doneAt(input) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return Date.parse(input.doneAt) > Date.now() ? { status: "refused", message: "That time is after you marked it." } : { status: "saved" };
    },
    async notDoneReason() {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { status: "saved" };
    },
    async alongside() {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { status: "saved" };
    },
  }), []);
  return (
    <OccurrenceMarkDetailsProvider actions={actions} timezone={TZ} prompts={BENCH_PROMPTS}>
      <div className={`grid max-w-3xl gap-1 ${timelineStyles.timeline}`}>
        {occurrences.map((occurrence) => (
          <div key={occurrence.id} className={timelineStyles.row} data-status-icons-only={narrow ? "true" : "false"}>
            <OccurrenceRow occurrence={occurrence} statusIconsOnly={narrow} statusAction={markAction} noteAction={noop as never}
              startTimeTrackingAction={noop as never} stopTimeTrackingAction={noop as never} resetTimeTrackingAction={noop as never} />
          </div>
        ))}
      </div>
    </OccurrenceMarkDetailsProvider>
  );
}
