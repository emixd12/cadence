"use client";

import { Temporal } from "@js-temporal/polyfill";
import { useCallback, useEffect, useMemo, useState } from "react";

import { WebRuntimeProvider } from "@/components/layout/WebRuntimeProvider";
import { OccurrenceMovesProvider, type OccurrenceMoveActions } from "@/components/timeline/OccurrenceMoves";
import { Timeline } from "@/components/timeline/Timeline";
import { storeSemanticZoomLayer, type SemanticZoomLayer } from "@/components/timeline/use-semantic-zoom";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { OPEN_NEEDS_DECISION_EVENT } from "@/lib/ui/advisor";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimeTrackingFormAction,
  TimelineOccurrenceInput,
  TimelineStatus,
} from "@/lib/types/timeline";

/**
 * Sub-behaviors on Timeline: routines (Layer 1), all steps (Layer 2), partial progress (2/3), a
 * custom-schedule child (Retinol, Mon/Wed/Fri), a fully Completed routine and a routine in Needs
 * decision. /design-system?preview=timeline-sub-behaviors&state=routines|all-steps|needs-decision
 * Pinch, Ctrl/Cmd + wheel, Ctrl/Cmd + = / - and the Routines / All steps control switch layers.
 * Nothing is saved. Check 390px by resizing the window.
 */
export type TimelineSubBehaviorsBenchState = "routines" | "all-steps" | "needs-decision";

const TIMEZONE = "America/New_York";
// Friday, Nov 20 2026, 10:00 AM in New York.
const NOW = "2026-11-20T15:00:00Z";
const TODAY = "2026-11-20";
const YESTERDAY = "2026-11-19";
const TOMORROW = "2026-11-21";

type Fixture = Readonly<{
  id: string;
  title: string;
  at: string;
  localDate: string;
  label: string;
  status?: TimelineStatus;
  parent?: Readonly<{ id: string; title: string; order: number }>;
  schedule?: string;
}>;

const SKIN = { id: "behavior-skin", title: "Skin routine" };
const STRETCH = { id: "behavior-stretch", title: "Lunch stretch" };
const MOBILITY = { id: "behavior-mobility", title: "Morning mobility" };

const FIXTURES: readonly Fixture[] = [
  // Needs decision: yesterday's skin routine (no Retinol on Thursday) and a standalone Behavior.
  { id: "y-cerave", title: "Cerave", at: "2026-11-19T12:00:00Z", localDate: YESTERDAY, label: "7:00 AM", parent: { ...SKIN, order: 0 } },
  { id: "y-facewash", title: "Facewash", at: "2026-11-19T12:00:00Z", localDate: YESTERDAY, label: "7:00 AM", parent: { ...SKIN, order: 1 } },
  { id: "y-read", title: "Read", at: "2026-11-20T02:30:00Z", localDate: YESTERDAY, label: "9:30 PM" },
  // Today.
  { id: "t-hips", title: "Hip circles", at: "2026-11-20T11:00:00Z", localDate: TODAY, label: "6:00 AM", status: "completed", parent: { ...MOBILITY, order: 0 } },
  { id: "t-ankles", title: "Ankle rolls", at: "2026-11-20T11:00:00Z", localDate: TODAY, label: "6:00 AM", status: "completed", parent: { ...MOBILITY, order: 1 } },
  { id: "t-cerave", title: "Cerave", at: "2026-11-20T12:00:00Z", localDate: TODAY, label: "7:00 AM", status: "completed", parent: { ...SKIN, order: 0 } },
  { id: "t-facewash", title: "Facewash", at: "2026-11-20T12:00:00Z", localDate: TODAY, label: "7:00 AM", status: "completed", parent: { ...SKIN, order: 1 } },
  { id: "t-retinol", title: "Retinol", at: "2026-11-20T12:00:00Z", localDate: TODAY, label: "7:00 AM", parent: { ...SKIN, order: 2 },
    schedule: "Mon, Wed and Fri at 7:00 AM (own schedule)" },
  { id: "t-walk", title: "Walk outside", at: "2026-11-20T13:30:00Z", localDate: TODAY, label: "8:30 AM", status: "completed" },
  { id: "t-neck", title: "Neck release", at: "2026-11-20T17:00:00Z", localDate: TODAY, label: "12:00 PM", parent: { ...STRETCH, order: 0 } },
  { id: "t-hamstrings", title: "Hamstring stretch", at: "2026-11-20T17:00:00Z", localDate: TODAY, label: "12:00 PM", parent: { ...STRETCH, order: 1 } },
  { id: "t-gym", title: "Gym", at: "2026-11-20T23:30:00Z", localDate: TODAY, label: "6:30 PM" },
  // Tomorrow (Saturday): Retinol is not scheduled, so the routine holds two steps.
  { id: "n-cerave", title: "Cerave", at: "2026-11-21T12:00:00Z", localDate: TOMORROW, label: "7:00 AM", parent: { ...SKIN, order: 0 } },
  { id: "n-facewash", title: "Facewash", at: "2026-11-21T12:00:00Z", localDate: TOMORROW, label: "7:00 AM", parent: { ...SKIN, order: 1 } },
  { id: "n-walk", title: "Walk outside", at: "2026-11-21T13:30:00Z", localDate: TOMORROW, label: "8:30 AM" },
];

function toInput(fixture: Fixture, status: TimelineStatus): TimelineOccurrenceInput {
  return {
    id: fixture.id,
    behaviorId: fixture.parent ? `${fixture.parent.id}-${fixture.title.toLowerCase().replace(/\s+/g, "-")}` : `behavior-${fixture.title.toLowerCase().replace(/\s+/g, "-")}`,
    title: fixture.title,
    scheduledFor: fixture.at,
    scheduledTimeLabel: fixture.label,
    localDate: fixture.localDate,
    status,
    statusMarkedAt: { unresolved: null, completed: fixture.at, not_completed: fixture.at }[status],
    description: "",
    categoryName: "Bench",
    scheduleSummary: fixture.schedule ?? (fixture.parent ? `Same as ${fixture.parent.title}: every day at ${fixture.label}` : `Every day at ${fixture.label}`),
    note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null },
    canStartTimeTracking: fixture.localDate !== TOMORROW,
    ...(fixture.parent ? { parentBehaviorId: fixture.parent.id, parentTitle: fixture.parent.title, subBehaviorSortOrder: fixture.parent.order } : {}),
  };
}

const NO_MOVES: OccurrenceMoveActions = {
  async suggest() { return []; },
  async move(input) { return { status: "moved", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r2" }; },
  async revert(input) { return { status: "undone", occurrenceId: input.occurrenceId, moveId: "bench", effectiveStartAt: null, revision: "r3" }; },
  async reason(input) { return { status: "saved", reason: input.reason }; },
  async keep() { return { status: "kept" }; },
};

const idleTime: TimeTrackingFormAction = async () => ({ status: "idle", message: "" });
const savedNote: OccurrenceFormAction = async () => ({ status: "success", message: "Bench note not saved." });

function readStatus(formData: FormData): TimelineStatus | null {
  const value = formData.get("status");
  return value === "completed" || value === "not_completed" || value === "unresolved" ? value : null;
}

export function TimelineSubBehaviorsBench({ state }: Readonly<{ state: TimelineSubBehaviorsBenchState }>) {
  const [statuses, setStatuses] = useState<Readonly<Record<string, TimelineStatus>>>(() =>
    Object.fromEntries(FIXTURES.map((fixture) => [fixture.id, fixture.status ?? "unresolved"])));
  const timeline = useMemo(() => resolveTimeline({
    timezone: TIMEZONE,
    now: Temporal.Instant.from(NOW),
    futureDays: 1,
    occurrences: FIXTURES.map((fixture) => toInput(fixture, statuses[fixture.id] ?? "unresolved")),
  }), [statuses]);

  const mark = useCallback((ids: readonly string[], status: TimelineStatus) => {
    setStatuses((previous) => ({ ...previous, ...Object.fromEntries(ids.map((id) => [id, status])) }));
  }, []);
  const statusAction = useCallback<OccurrenceFormAction>(async (_previous: OccurrenceActionState, formData) => {
    const status = readStatus(formData);
    const id = formData.get("occurrence_id");
    if (!status || typeof id !== "string") return { status: "error", message: "Bench could not read the status." };
    await new Promise((resolve) => setTimeout(resolve, 150));
    mark([id], status);
    return { status: "success", message: "", nextStatus: status };
  }, [mark]);
  const parentSlotStatusAction = useCallback<OccurrenceFormAction>(async (_previous: OccurrenceActionState, formData) => {
    const status = readStatus(formData);
    const ids = formData.getAll("occurrence_id").filter((value): value is string => typeof value === "string");
    if (!status || ids.length === 0) return { status: "error", message: "Choose the sub-behaviors to mark." };
    await new Promise((resolve) => setTimeout(resolve, 150));
    mark(ids, status);
    return { status: "success", message: "", nextStatus: status };
  }, [mark]);

  useEffect(() => {
    const layer: SemanticZoomLayer = state === "all-steps" ? "sub_behaviors" : "parents";
    storeSemanticZoomLayer(layer);
    if (state === "needs-decision") window.dispatchEvent(new CustomEvent(OPEN_NEEDS_DECISION_EVENT));
  }, [state]);

  return (
    <WebRuntimeProvider>
      <main className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Bench states">
            <a href="/design-system" className="underline underline-offset-4">Back to the design-system bench</a>
            <a href="?preview=timeline-sub-behaviors&state=routines" className="underline underline-offset-4">Routines</a>
            <a href="?preview=timeline-sub-behaviors&state=all-steps" className="underline underline-offset-4">All steps</a>
            <a href="?preview=timeline-sub-behaviors&state=needs-decision" className="underline underline-offset-4">Needs decision</a>
          </nav>
          <h1 className="sr-only">Timeline</h1>
          <OccurrenceMovesProvider actions={NO_MOVES} timezone={TIMEZONE} todayLocalDate={TODAY} hasMovedBefore>
            <Timeline
              timeline={timeline}
              statusAction={statusAction}
              noteAction={savedNote}
              startTimeTrackingAction={idleTime}
              stopTimeTrackingAction={idleTime}
              resetTimeTrackingAction={idleTime}
              parentSlotStatusAction={parentSlotStatusAction}
              dayProgress={{ now: NOW, events: [] }}
            />
          </OccurrenceMovesProvider>
        </div>
      </main>
    </WebRuntimeProvider>
  );
}
