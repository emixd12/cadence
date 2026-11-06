import { renderToStaticMarkup } from "./helpers/render-with-refresh";

import { describe, expect, it, vi } from "vitest";

import { OccurrenceRow } from "@/components/timeline/OccurrenceRow";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimeTrackingActionState,
  TimeTrackingFormAction,
  TimelineOccurrenceView,
} from "@/lib/types/timeline";

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

describe("OccurrenceRow resolved summary alignment", () => {
  it.each([
    ["Completed", "completed", "completed"],
    ["Not Completed", "not_completed", "not_completed"],
  ] as const)(
    "keeps %s in the summary grid row with a long title and expanded details",
    (statusLabel, status, visualTone) => {
      const html = renderToStaticMarkup(
        <OccurrenceRow
          occurrence={resolvedOccurrence({ status, statusLabel, visualTone })}
          statusAction={occurrenceAction}
          noteAction={occurrenceAction}
          startTimeTrackingAction={timeTrackingAction}
          stopTimeTrackingAction={timeTrackingAction}
          resetTimeTrackingAction={timeTrackingAction}
        />,
      );

      expect(html).toContain(
        "timeline-occurrence-row-grid grid grid-cols-[minmax(0,1fr)_auto] items-center",
      );
      expect(html).toContain(
        "<details class=\"group col-start-1 col-end-3 row-start-1 min-w-0\"",
      );
      expect(html).toContain('data-status-region="label"');
      expect(html).toContain(
        "timeline-occurrence-status pointer-events-none col-start-2 row-start-1",
      );
      expect(html).toContain("flex min-h-12 items-center self-start justify-self-end");
      expect(html).not.toContain("self-center justify-self-end");
      expect(html).toContain("timeline-occurrence-title min-w-0 truncate");
      expect(html).toContain("timeline-occurrence-details");
      expect(html).toContain(`>${statusLabel}</p>`);
    },
  );

  it("anchors unresolved actions to the same summary row without changing their controls", () => {
    const html = renderToStaticMarkup(
      <OccurrenceRow
        occurrence={resolvedOccurrence({
          status: "unresolved",
          statusLabel: "Unresolved",
          visualTone: "default",
          showCollapsedStatusLabel: false,
          showDecisionActions: true,
        })}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        startTimeTrackingAction={timeTrackingAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
      />,
    );

    expect(html).toContain('data-status-region="actions"');
    expect(html).toContain("flex min-h-12 items-center self-start justify-self-end");
    expect(html).toContain('name="status" value="completed"');
    expect(html).toContain('name="status" value="not_completed"');
  });
});

describe("OccurrenceRow time range (Ticket 284 finding)", () => {
  it("lets a range break only after its dash, so a narrow time column wraps it instead of running into the title", () => {
    const render = (scheduledTimeLabel: string) => renderToStaticMarkup(
      <OccurrenceRow
        occurrence={resolvedOccurrence({ scheduledTimeLabel })}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        startTimeTrackingAction={timeTrackingAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
      />,
    );
    const range = render("2:30 PM - 3:00 PM");
    const time = range.match(/<time[^>]*class="([^"]*)"[^>]*>(.*?)<\/time>/)!;
    expect(time[1]).toContain("timeline-occurrence-time");
    expect(time[1]).not.toContain("whitespace-nowrap");
    expect(time[2]).toBe('<span class="whitespace-nowrap">2:30 PM -</span> <span class="whitespace-nowrap" data-time-range-end="true">3:00 PM</span>');
    expect(render("Morning").match(/<time[^>]*>(.*?)<\/time>/)![1]).toBe('<span class="whitespace-nowrap">Morning</span>');
  });
});

function resolvedOccurrence(
  overrides: Partial<TimelineOccurrenceView>,
): TimelineOccurrenceView {
  return {
    id: "occurrence-1",
    behaviorId: "behavior-1",
    title:
      "A long behavior title that must truncate before the resolved status label overflows a narrow mobile Timeline row",
    scheduledFor: "2026-08-04T13:00:00Z",
    scheduledTimeLabel: "Morning",
    localDate: "2026-08-04",
    status: "completed",
    statusMarkedAt: "2026-08-04T13:05:00Z",
    statusLabel: "Completed",
    statusDetail: "Resolved as Completed",
    expandedStatusActionLabel: "Change status",
    visualTone: "completed",
    isVisibleInNeedsDecision: false,
    canShowDecisionActionsWhenUnresolved: true,
    showDecisionActions: false,
    showCollapsedStatusLabel: true,
    description: "Expanded detail remains below the summary row.",
    categoryName: "Home",
    scheduleSummary: "Weekly on Monday",
    note: "A note keeps the expanded detail fixture representative.",
    timeTracking: { recordedSeconds: 65, runningStartedAt: null },
    canStartTimeTracking: true,
    ...overrides,
  };
}
