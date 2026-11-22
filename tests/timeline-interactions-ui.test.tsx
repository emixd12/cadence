import { renderToStaticMarkup } from "./helpers/render-with-refresh";

import { describe, expect, it, vi } from "vitest";

import { Timeline } from "../components/timeline/Timeline";
import { TimelineScreen } from "../apps/desktop/src/timeline-screen";
import { insertNoteShortcutDraft, reconcileSavedNoteDraft } from "../components/timeline/OccurrenceNoteForm";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimeTrackingActionState,
  TimeTrackingFormAction,
  TimelineOccurrenceView,
  TimelineView,
} from "../lib/types/timeline";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const occurrenceAction: OccurrenceFormAction = async (
  state: OccurrenceActionState,
) => state;
const timeTrackingAction: TimeTrackingFormAction = async (
  state: TimeTrackingActionState,
) => state;

describe("Timeline interaction controls", () => {
  it("uses shared row controls inside the desktop callback wrapper", () => {
    const html = renderToStaticMarkup(
      <TimelineScreen
        timeline={timelineView([occurrence()])}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        startTimeTrackingAction={timeTrackingAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
        onRefresh={vi.fn()}
        onShowMore={vi.fn()}
      />,
    );
    expect(html).toContain('name="expected_status" value="unresolved"');
    expect(html).toContain('name="expected_note" value=""');
    expect(html).toContain('aria-label="Open Needs decision');
    expect(html).toContain("<span>Show more days</span></button>");
    expect(html).not.toContain('href="/timeline');
    expect(html).not.toContain("data-timeline-pull-to-refresh");
    expect(html).toContain('/brand/cadence-timeline-horse-lines-dots-clear-background.png');
  });

  it("preserves note typing that happens after save starts", () => {
    expect(
      reconcileSavedNoteDraft({
        submittedDraft: "Saved draft",
        submittedRevision: 1,
        currentDraft: "Newer typing",
        currentRevision: 2,
      }),
    ).toBe("Newer typing");
    expect(
      reconcileSavedNoteDraft({
        submittedDraft: "Saved draft",
        submittedRevision: 1,
        currentDraft: "Saved draft",
        currentRevision: 1,
      }),
    ).toBe("Saved draft");
  });

  it("fills or appends accepted shortcut text without replacing the draft", () => {
    expect(insertNoteShortcutDraft("", "Took a shorter walk.")).toBe("Took a shorter walk.");
    expect(insertNoteShortcutDraft("Warm-up", "Took a shorter walk.")).toBe("Warm-up\nTook a shorter walk.");
    expect(reconcileSavedNoteDraft({
      submittedDraft: "Warm-up",
      submittedRevision: 1,
      currentDraft: "Warm-up\nTook a shorter walk.",
      currentRevision: 2,
    })).toBe("Warm-up\nTook a shorter walk.");
  });

  it("renders the future-day, review, status, disclosure, and note interactions", () => {
    const unresolved = occurrence();
    const completed = occurrence({
      id: "occurrence-2",
      status: "completed",
      statusMarkedAt: "2026-07-26T13:05:00Z",
      statusLabel: "Completed",
      statusDetail: "Resolved as Completed",
      expandedStatusActionLabel: "Change status",
      visualTone: "completed",
      showDecisionActions: false,
      showCollapsedStatusLabel: true,
    });
    const html = renderToStaticMarkup(
      <Timeline
        timeline={timelineView([unresolved, completed])}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        startTimeTrackingAction={timeTrackingAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
      />,
    );

    expect(html).toContain('href="/timeline?days=14"');
    expect(html).toContain(">Show more days</span>");
    expect(html).toContain('aria-label="Open Needs decision');
    expect(html).toContain('data-timeline-pull-to-refresh="true"');
    expect(html).toContain('data-pull-state="idle"');
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain('name="status" value="completed"');
    expect(html).toContain("<span>Completed</span>");
    expect(html).toContain('name="status" value="not_completed"');
    expect(html).toContain("<span>Not Completed</span>");
    expect(html).toContain('name="status" value="unresolved"');
    expect(html).toContain("<span>Unmark</span>");
    expect(html).toContain('name="note"');
    expect(html).toContain('name="expected_note" value=""');
    expect(html).toContain(">Save note</button>");

    const statusForms = (html.match(/<form\b.*?<\/form>/g) ?? []).filter(
      (form) => form.includes('name="status"'),
    );

    expect(statusForms).not.toHaveLength(0);
    for (const form of statusForms) {
      expect(form.match(/name="expected_status"/g)).toHaveLength(1);

      if (form.includes(`value="${unresolved.id}"`)) {
        expect(form).toContain(
          'name="expected_status" value="unresolved"',
        );
      }

      if (form.includes(`value="${completed.id}"`)) {
        expect(form).toContain(
          'name="expected_status" value="completed"',
        );
      }
    }
  });
});

function timelineView(
  occurrences: TimelineOccurrenceView[],
): TimelineView {
  return {
    timezone: "America/New_York",
    todayLocalDate: "2026-07-26",
    visibleFutureDays: 7,
    maxFutureDays: 30,
    nextFutureDays: 14,
    needsDecision: {
      title: "Needs decision",
      emptyMessage: "No prior unresolved occurrences.",
      occurrenceCount: 0,
      daySections: [],
    },
    daySections: [
      {
        key: "today-2026-07-26",
        kind: "today",
        localDate: "2026-07-26",
        label: "Sunday, July 26",
        relativeLabel: "Today",
        emptyMessage: "No behaviors today.",
        occurrences,
        unresolvedOccurrenceCount: 1,
        parentGroups: [],
        rows: [],
        occurrenceGroups: occurrences.map((item) => ({
          key: item.id,
          behaviorId: item.behaviorId,
          title: item.title,
          occurrences: [item],
          isGroupedStack: false,
        })),
      },
    ],
  };
}

function occurrence(
  overrides: Partial<TimelineOccurrenceView> = {},
): TimelineOccurrenceView {
  return {
    id: "occurrence-1",
    behaviorId: "behavior-1",
    title: "Morning walk",
    scheduledFor: "2026-07-26T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    localDate: "2026-07-26",
    status: "unresolved",
    statusMarkedAt: null,
    statusLabel: "Unresolved",
    statusDetail: "Awaiting decision",
    expandedStatusActionLabel: "Set status",
    visualTone: "default",
    isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true,
    showDecisionActions: true,
    showCollapsedStatusLabel: false,
    description: "Walk outside.",
    categoryName: "Health",
    scheduleSummary: "Daily at 9:00 AM",
    note: "",
    timeTracking: { recordedSeconds: 0, runningStartedAt: null },
    canStartTimeTracking: true,
    ...overrides,
  };
}

it("shows no automatic archive notice in either Timeline shell, because Behaviors never auto-archive", () => {
  const timeline = timelineView([]);
  const props = { timeline, statusAction: occurrenceAction, noteAction: occurrenceAction,
    startTimeTrackingAction: timeTrackingAction, stopTimeTrackingAction: timeTrackingAction, resetTimeTrackingAction: timeTrackingAction };
  for (const element of [<Timeline key="web" {...props} />, <TimelineScreen key="desktop" {...props} onRefresh={vi.fn()} onShowMore={vi.fn()} />]) {
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("was automatically archived");
    expect(html).not.toContain("Review archived behaviors");
  }
});
