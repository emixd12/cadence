import { renderToStaticMarkup } from "./helpers/render-with-refresh";
import { describe, expect, it, vi } from "vitest";

import {
  resolveActionStateForRequest,
  TimeTracker,
} from "@/components/timeline/TimeTracker";
import { TimelineGroup } from "@/components/timeline/TimelineGroup";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimeTrackingActionState,
  TimeTrackingFormAction,
  TimelineDaySection,
} from "@/lib/types/timeline";

const action: TimeTrackingFormAction = async (state) => state;
const occurrenceAction: OccurrenceFormAction = async (
  state: OccurrenceActionState,
) => state;
const IDLE: TimeTrackingActionState = { status: "idle", message: "" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("Timeline time tracking", () => {
  it("renders idle, running, and recorded controls with the required labels", () => {
    const idle = renderToStaticMarkup(
      <TimeTracker
        occurrenceId="occurrence-1"
        tracking={{ recordedSeconds: 0, runningStartedAt: null }}
        canStart
        startAction={action}
        stopAction={action}
        resetAction={action}
      />,
    );
    const running = renderToStaticMarkup(
      <TimeTracker
        occurrenceId="occurrence-1"
        tracking={{ recordedSeconds: 65, runningStartedAt: "2026-08-02T14:00:00Z" }}
        canStart
        startAction={action}
        stopAction={action}
        resetAction={action}
      />,
    );
    const stopped = renderToStaticMarkup(
      <TimeTracker
        occurrenceId="occurrence-1"
        tracking={{ recordedSeconds: 65, runningStartedAt: null }}
        canStart
        startAction={action}
        stopAction={action}
        resetAction={action}
      />,
    );

    expect(idle).toContain(">Track Time</button>");
    expect(idle).not.toContain("<h4");
    expect(running).toContain(">Stop</button>");
    expect(running).toContain(">Reset tracked time</button>");
    expect(running).toContain(">Track time</h4>");
    expect(stopped).toContain("00:01:05");
    expect(stopped).toContain(">Track Time</button>");
    expect(stopped).toContain(">Reset tracked time</button>");
    expect(stopped).not.toContain("<h4");
    expect(idle).toContain("timeline-time-tracker-action");
    expect(stopped).toContain("timeline-time-tracker-strong");
  });

  it("renders Track Time inside a Needs decision occurrence", () => {
    const occurrence = {
      id: "occurrence-prior",
      behaviorId: "behavior-1",
      title: "Evening reset",
      scheduledFor: "2026-08-02T23:00:00Z",
      scheduledTimeLabel: "Evening",
      localDate: "2026-08-02",
      status: "unresolved" as const,
      statusMarkedAt: null,
      statusLabel: "Unresolved",
      statusDetail: "Awaiting decision",
      expandedStatusActionLabel: "Set status",
      visualTone: "needs_decision" as const,
      isVisibleInNeedsDecision: true,
      canShowDecisionActionsWhenUnresolved: true,
      showDecisionActions: true,
      showCollapsedStatusLabel: false,
      description: "Prepare for tomorrow.",
      categoryName: "Other",
      scheduleSummary: "Daily",
      note: "",
      timeTracking: { recordedSeconds: 0, runningStartedAt: null },
      canStartTimeTracking: true,
    };
    const section: TimelineDaySection = {
      key: "needs-2026-08-02",
      kind: "needs_decision_day",
      localDate: "2026-08-02",
      label: "Sunday, August 2",
      relativeLabel: "Prior unresolved",
      emptyMessage: "No behaviors on this day",
      occurrences: [occurrence],
      unresolvedOccurrenceCount: 1,
      parentGroups: [],
      rows: [],
      occurrenceGroups: [
        {
          key: "behavior-1-2026-08-02",
          behaviorId: occurrence.behaviorId,
          title: occurrence.title,
          occurrences: [occurrence],
          isGroupedStack: false,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <TimelineGroup
        section={section}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        startTimeTrackingAction={action}
        stopTimeTrackingAction={action}
        resetTimeTrackingAction={action}
        variant="needsDecisionDialog"
      />,
    );

    expect(html).toContain('data-visual-tone="needs_decision"');
    expect(html).toContain('aria-label="Track time"');
    expect(html).toContain(">Track Time</button>");
  });

  it("accepts only the latest response across start, stop, reset, then start", () => {
    const firstStart: TimeTrackingActionState = {
      status: "success",
      message: "Time tracking started.",
      requestId: "start-1",
      tracking: { recordedSeconds: 0, runningStartedAt: "2026-08-02T14:00:00Z" },
    };
    const stop: TimeTrackingActionState = {
      status: "success",
      message: "Time tracking stopped.",
      requestId: "stop-2",
      tracking: { recordedSeconds: 20, runningStartedAt: null },
    };
    const reset: TimeTrackingActionState = {
      status: "success",
      message: "Tracked time reset.",
      requestId: "reset-3",
      tracking: { recordedSeconds: 0, runningStartedAt: null },
    };
    const secondStart: TimeTrackingActionState = {
      status: "success",
      message: "Time tracking started.",
      requestId: "start-4",
      tracking: { recordedSeconds: 0, runningStartedAt: "2026-08-02T15:00:00Z" },
    };

    expect(resolveActionStateForRequest("stop-2", firstStart, stop, IDLE)).toBe(stop);
    expect(resolveActionStateForRequest("reset-3", firstStart, stop, reset)).toBe(reset);
    expect(resolveActionStateForRequest("start-4", secondStart, stop, reset)).toBe(secondStart);
    expect(resolveActionStateForRequest("start-4", firstStart, stop, reset)).toBeNull();
  });
});
