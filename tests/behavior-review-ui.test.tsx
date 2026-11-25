import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "./helpers/render-with-refresh";

import { describe, expect, it, vi } from "vitest";

import {
  BehaviorForm,
  resetBehaviorScheduleDraft,
} from "../components/behaviors/BehaviorForm";
import { BehaviorCreateSection } from "../components/behaviors/BehaviorCreateSection";
import {
  BehaviorActionResultAnnouncement,
  BehaviorList,
} from "../components/behaviors/BehaviorList";
import { StatusButtons } from "../components/timeline/StatusButtons";
import type { AnalyticsView } from "../lib/types/analytics";
import type {
  BehaviorActionState,
  BehaviorFormAction,
  BehaviorView,
} from "../lib/types/behavior";
import { BEHAVIOR_FORM_FIELDS } from "../lib/types/behavior";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimeTrackingActionState,
  TimeTrackingFormAction,
} from "../lib/types/timeline";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const behaviorAction: BehaviorFormAction = async (
  state: BehaviorActionState,
) => state;

const occurrenceAction: OccurrenceFormAction = async (
  state: OccurrenceActionState,
) => state;

const timeTrackingAction: TimeTrackingFormAction = async (
  state: TimeTrackingActionState,
) => state;

describe("behavior date review UI", () => {
  it("renders the registered create, identity, recurrence, schedule, and save controls", () => {
    const createHtml = renderToStaticMarkup(
      <BehaviorCreateSection
        action={behaviorAction}
        categories={[{ id: "category-1", name: "Health" }]}
        defaultTimezone="America/New_York"
        defaultOpen
      />,
    );
    const editHtml = renderToStaticMarkup(
      <BehaviorForm
        mode="edit"
        action={behaviorAction}
        categories={[{ id: "category-1", name: "Health" }]}
        behavior={behaviorViewWithSchedules()}
      />,
    );

    expect(createHtml).toContain("Create behavior");
    expect(createHtml).toContain('name="title"');
    expect(createHtml).toContain('name="description"');
    expect(createHtml).toContain('name="category_id"');
    expect(createHtml).toContain('name="schedule_0_recurrence_kind"');
    expect(createHtml).toContain(">Add schedule</button>");
    expect(createHtml).toContain(">Add time</button>");
    expect(createHtml).toContain(">Save behavior</button>");

    expect(editHtml).toContain('name="schedule_0_monthly_day"');
    expect(editHtml).toContain('name="expected_updated_at"');
    expect(editHtml).toContain(`value="${behaviorViewWithSchedules().updatedAt}"`);
    expect(editHtml).toContain('name="schedule_1_weekly_days"');
    expect(editHtml).toContain('name="schedule_0_time_entry_kind_0"');
    expect(editHtml).toContain('name="schedule_0_time_entry_range_preset_0"');
    expect(editHtml).toContain('name="schedule_0_time_entry_exact_time_1"');
    expect(editHtml).toContain(">Remove schedule</button>");
    expect(editHtml).toContain(">Remove time</button>");
    expect(editHtml).toContain(">Save behavior</button>");
  });

  it("renders weekday checkboxes only for weekly recurrence", () => {
    const dailyBehavior = behaviorView();
    const dailyHtml = renderToStaticMarkup(
      <BehaviorForm
        mode="edit"
        action={behaviorAction}
        categories={[{ id: "category-1", name: "Health" }]}
        behavior={dailyBehavior}
      />,
    );
    const weeklyBehavior: BehaviorView = {
      ...dailyBehavior,
      recurrenceDefaults: {
        ...dailyBehavior.recurrenceDefaults,
        kind: "weekly",
        weeklyDays: ["monday", "wednesday"],
      },
    };
    const weeklyHtml = renderToStaticMarkup(
      <BehaviorForm
        mode="edit"
        action={behaviorAction}
        categories={[{ id: "category-1", name: "Health" }]}
        behavior={weeklyBehavior}
      />,
    );

    expect(dailyHtml).not.toContain('name="schedule_0_weekly_days"');
    expect(weeklyHtml.match(/name="schedule_0_weekly_days"/g)).toHaveLength(7);
  });

  it("renders recurrence errors and keeps every behavior error key surfaced", () => {
    const html = renderToStaticMarkup(
      <BehaviorForm
        mode="create"
        action={behaviorAction}
        categories={[]}
        initialState={{
          status: "error",
          message: "Check the highlighted fields.",
          fieldErrors: { recurrence: "Choose at least one weekday." },
        }}
      />,
    );
    const source = readFileSync(
      new URL("../components/behaviors/BehaviorForm.tsx", import.meta.url),
      "utf8",
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Choose at least one weekday.");
    for (const field of BEHAVIOR_FORM_FIELDS) {
      expect(source).toContain(`fieldErrors.${field}`);
    }
  });

  it("restores every controlled schedule value to the initial edit draft", () => {
    const behavior = behaviorViewWithSchedules();
    const dirtyDraft = resetBehaviorScheduleDraft([], behavior);

    dirtyDraft[0]!.recurrenceKind = "daily";
    dirtyDraft[0]!.timeEntries[0] = {
      ...dirtyDraft[0]!.timeEntries[0]!,
      kind: "exact",
      exactTime: "09:15",
      rangePreset: null,
    };
    dirtyDraft.splice(1, 1);

    expect(resetBehaviorScheduleDraft(dirtyDraft, behavior)).toMatchObject([
      {
        id: "schedule-monthly",
        recurrenceKind: "monthly",
        recurrenceDefaults: {
          kind: "monthly",
          monthlyInterval: 2,
          monthlyDay: 31,
        },
        timeEntries: [
          {
            id: "slot-evening",
            kind: "range",
            rangeStart: "18:00",
            rangeEnd: "00:00",
            rangePreset: "evening",
          },
          {
            id: "slot-late",
            kind: "exact",
            exactTime: "22:30",
          },
        ],
      },
      {
        id: "schedule-weekly",
        recurrenceKind: "weekly",
        timeEntries: [
          {
            id: "slot-morning",
            kind: "exact",
            exactTime: "07:00",
          },
        ],
      },
    ]);
  });

  it("names every repeated time-mode control by schedule and time row", () => {
    const html = renderToStaticMarkup(
      <BehaviorForm
        mode="edit"
        action={behaviorAction}
        categories={[{ id: "category-1", name: "Health" }]}
        behavior={behaviorViewWithSchedules()}
      />,
    );

    expect(html).toContain('aria-label="Schedule 1, time 1 mode"');
    expect(html).toContain('aria-label="Schedule 1, time 2 mode"');
    expect(html).toContain('aria-label="Schedule 2, time 1 mode"');
    expect(html).toContain('<button type="reset"');
    expect(html).toContain('name="email_reminder" checked=""');
    expect(html).toContain(
      '<option value="1440" selected="">1 day before</option>',
    );
  });

  it("keeps archive and restore results above moving rows with status and alert semantics", () => {
    const source = readFileSync(
      new URL("../components/behaviors/BehaviorList.tsx", import.meta.url),
      "utf8",
    );
    const parentStart = source.indexOf("export function BehaviorList(");
    const announcementStart = source.indexOf(
      "export function BehaviorActionResultAnnouncement(",
    );
    const rowFormStart = source.indexOf("function BehaviorStateForm(");
    const rowButtonStart = source.indexOf("function BehaviorStateButton(");
    const parentSource = source.slice(parentStart, announcementStart);
    const rowFormSource = source.slice(rowFormStart, rowButtonStart);
    const archivedHtml = renderToStaticMarkup(
      <BehaviorActionResultAnnouncement
        result={{ status: "success", message: "Behavior archived." }}
      />,
    );
    const restoreFailureHtml = renderToStaticMarkup(
      <BehaviorActionResultAnnouncement
        result={{ status: "error", message: "Behavior could not be restored." }}
      />,
    );

    expect(parentSource.match(/useActionState\(/g)).toHaveLength(1);
    expect(parentSource).toContain('? archiveAction');
    expect(parentSource).toContain('? restoreAction');
    expect(parentSource).toContain(': archiveNoteAction');
    expect(rowFormSource).not.toContain("useActionState(");
    expect(archivedHtml).toContain('role="status"');
    expect(archivedHtml).toContain("Behavior archived.");
    expect(restoreFailureHtml).toContain('role="alert"');
    expect(restoreFailureHtml).toContain("Behavior could not be restored.");
  });

  it("keeps archive-note controls in the shared web and desktop behavior list", () => {
    const source = readFileSync(
      new URL("../components/behaviors/BehaviorList.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('name="archive_note"');
    expect(source).toContain('name="archive_note_id"');
    expect(source).toContain('name="expected_updated_at"');
    expect(source).toContain("Archive history");
    expect(source).toContain("Remove note");
    expect(source).toContain("maxLength={2000}");
  });

  it("gives actionable heatmap days review scent and names the selected-day panel", () => {
    const behavior = behaviorView();
    const analytics = analyticsView(behavior);
    const archivedBehavior = {
      ...behaviorView(),
      id: "behavior-archived",
      title: "Archived walk",
      active: false,
      archivedAt: "2026-06-06T12:00:00Z",
    };
    const html = renderToStaticMarkup(
      <BehaviorList
        activeBehaviors={[behavior]}
        archivedBehaviors={[archivedBehavior]}
        categories={[{ id: "category-1", name: "Health" }]}
        analytics={analytics}
        updateAction={behaviorAction}
        archiveAction={behaviorAction}
        restoreAction={behaviorAction}
        archiveNoteAction={behaviorAction}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
      />,
    );

    expect(html).toContain("Friday, June 5; Full; 1 Completed");
    expect(html).toContain("open day review");
    expect(html).toContain("Review selected day");
    expect(html).toContain("Date of behavior");
    expect(html).toContain("Change status");
    expect(html).toContain("Clear decision");
    expect(html).toContain('name="status" value="unresolved"');
    expect(html).toContain("<span>Completed</span>");
    expect(html).toContain("<span>Not Completed</span>");
    expect(html).toContain('name="note"');
    expect(html).toContain('name="expected_note"');
    expect(html).toContain(">Done</button>");
    expect(html).toContain("Details and Settings");
    expect(html).toContain("Archived behaviors (1)");
    expect(html).toContain(">Restore</button>");
    expect(html).toContain("?range=7");
    expect(html).toContain("?range=30");
    expect(html).toContain("?range=90");
  });

  it("does not render Clear decision for an unresolved selected-day occurrence", () => {
    const behavior = behaviorView();
    const analytics = analyticsView(behavior, "unresolved");
    const html = renderToStaticMarkup(
      <BehaviorList
        activeBehaviors={[behavior]}
        archivedBehaviors={[]}
        categories={[{ id: "category-1", name: "Health" }]}
        analytics={analytics}
        updateAction={behaviorAction}
        archiveAction={behaviorAction}
        restoreAction={behaviorAction}
        archiveNoteAction={behaviorAction}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
      />,
    );

    expect(html).not.toContain("Clear decision");
  });

  it("does not offer accepted shortcuts in selected-day review when the global setting is off", () => {
    const behavior = behaviorView();
    const shortcut = {
      key: "shortcut-1", text: "Fresh shortcut", status: "accepted" as const,
      source: "repeated_text" as const, evidence: [], created_at: "2026-09-07T00:00:00Z", expires_at: null,
    };
    const html = renderToStaticMarkup(
      <BehaviorList
        activeBehaviors={[behavior]}
        archivedBehaviors={[]}
        categories={[{ id: "category-1", name: "Health" }]}
        analytics={analyticsView(behavior)}
        updateAction={behaviorAction}
        archiveAction={behaviorAction}
        restoreAction={behaviorAction}
        archiveNoteAction={behaviorAction}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
        noteShortcutViews={{
          [behavior.id]: {
            state: {
              id: "shortcut-state", user_id: "user-1", behavior_id: behavior.id, enabled: true,
              entries: [shortcut], excluded_occurrence_ids: [], revision: 1, updated_at: "2026-09-07T00:00:00Z",
            },
            globalEnabled: false,
            available: true,
            entries: [shortcut],
          },
        }}
        noteShortcutAction={async () => ({ status: "idle" as const, message: "" })}
      />,
    );

    expect(html).not.toContain('aria-label="Note shortcuts"');
  });

  it("renders Stop and Reset for a running timer inside selected-day review", () => {
    const behavior = behaviorView();
    const analytics = analyticsView(behavior);
    analytics.behaviorSummaries[0]!.averageTrackedTime = {
      averageSeconds: 134,
      durationLabel: "2m 14s",
      timedOccurrenceCount: 1,
    };
    analytics.selectedBehaviorDay!.occurrences[0]!.trackedTime = {
      recordedSeconds: 120,
      durationLabel: "2m 0s",
      hasRecordedTime: true,
      isInProgress: true,
    };

    const html = renderToStaticMarkup(
      <BehaviorList
        activeBehaviors={[behavior]}
        archivedBehaviors={[]}
        categories={[{ id: "category-1", name: "Health" }]}
        analytics={analytics}
        updateAction={behaviorAction}
        archiveAction={behaviorAction}
        restoreAction={behaviorAction}
        archiveNoteAction={behaviorAction}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
      />,
    );

    expect(html).toContain("Average tracked time");
    expect(html).toContain("2m 14s");
    expect(html).toContain("Tracked time");
    expect(html).toContain("2m 0s");
    expect(html).toContain("In progress");
    expect(html).toContain(">Stop</button>");
    expect(html).toContain("Reset tracked time");
  });

  it("uses Unmark for Timeline status controls that include unresolved", () => {
    const html = renderToStaticMarkup(
      <StatusButtons
        occurrenceId="occurrence-1"
        currentStatus="completed"
        action={occurrenceAction}
        includeUnresolved
        compact
      />,
    );

    expect(html).toContain("Unmark");
    expect(html).not.toContain("Clear decision");
    expect(html).toContain('name="status" value="unresolved"');
  });
});

function behaviorView(): BehaviorView {
  return {
    id: "behavior-1",
    title: "Walk",
    description: "Evening walk",
    categoryId: "category-1",
    categoryName: "Health",
    recurrenceSummary: "Daily",
    recurrenceDefaults: {
      kind: "daily",
      dailyInterval: 1,
      everyDays: 2,
      weeklyInterval: 1,
      weeklyDays: ["monday"],
      monthlyInterval: 1,
      monthlyDay: 5,
    },
    scheduledTime: "18:00",
    scheduledTimeLabel: "6:00 PM",
    schedules: [],
    scheduleSlots: [
      {
        id: "slot-1",
        kind: "exact",
        preset: null,
        startTime: "18:00",
        endTime: null,
        sortOrder: 0,
        label: "6:00 PM",
      },
    ],
    scheduleSummary: "6:00 PM",
    timezone: "America/New_York",
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    reminderSummary: "Browser reminders",
    active: true,
    archivedAt: null,
    archiveNotes: [],
    createdAt: "2026-06-01T12:00:00Z",
    updatedAt: "2026-06-01T12:00:00Z",
  };
}

function behaviorViewWithSchedules(): BehaviorView {
  return {
    ...behaviorView(),
    browserReminderEnabled: false,
    emailReminderEnabled: true,
    reminderOffsetMinutes: 1440,
    schedules: [
      {
        id: "schedule-monthly",
        recurrenceRule: {
          frequency: "monthly",
          interval: 2,
          dayOfMonth: 31,
        },
        recurrenceSummary: "Every 2 months on day 31",
        recurrenceDefaults: {
          kind: "monthly",
          dailyInterval: 1,
          everyDays: 2,
          weeklyInterval: 1,
          weeklyDays: ["monday"],
          monthlyInterval: 2,
          monthlyDay: 31,
        },
        timeEntries: [
          {
            id: "slot-evening",
            kind: "range",
            preset: "evening",
            startTime: "18:00",
            endTime: "00:00",
            sortOrder: 0,
            label: "Evening",
          },
          {
            id: "slot-late",
            kind: "exact",
            preset: null,
            startTime: "22:30",
            endTime: null,
            sortOrder: 1,
            label: "10:30 PM",
          },
        ],
        timeSummary: "Evening, 10:30 PM",
        sortOrder: 0,
      },
      {
        id: "schedule-weekly",
        recurrenceRule: {
          frequency: "weekly",
          interval: 1,
          daysOfWeek: ["monday", "wednesday"],
        },
        recurrenceSummary: "Weekly on Monday and Wednesday",
        recurrenceDefaults: {
          kind: "weekly",
          dailyInterval: 1,
          everyDays: 2,
          weeklyInterval: 1,
          weeklyDays: ["monday", "wednesday"],
          monthlyInterval: 1,
          monthlyDay: 1,
        },
        timeEntries: [
          {
            id: "slot-morning",
            kind: "exact",
            preset: null,
            startTime: "07:00",
            endTime: null,
            sortOrder: 0,
            label: "7:00 AM",
          },
        ],
        timeSummary: "7:00 AM",
        sortOrder: 1,
      },
    ],
  };
}

function analyticsView(
  behavior: BehaviorView,
  selectedOccurrenceStatus: "completed" | "unresolved" = "completed",
): AnalyticsView {
  const counts = {
    completedCount: 1,
    notCompletedCount: 0,
    unresolvedCount: 0,
    resolvedCount: 1,
    totalCount: 1,
  };
  const emptyCounts = {
    completedCount: 0,
    notCompletedCount: 0,
    unresolvedCount: 0,
    resolvedCount: 0,
    totalCount: 0,
  };

  return {
    timezone: "America/New_York",
    rangeDays: 30,
    rangeOptions: [7, 30, 90],
    rangeStartLocalDate: "2026-05-07",
    rangeEndLocalDate: "2026-06-05",
    rangeLabel: "Last 30 days",
    summary: {
      ...counts,
      rate: 1,
      percentLabel: "100%",
      detailLabel: "1 / 1",
    },
    overallHeatmap: [
      {
        key: "overall-2026-06-05",
        localDate: "2026-06-05",
        label: "Friday, June 5",
        shortLabel: "Jun 5",
        isSelected: true,
        state: "completed",
        stateLabel: "Completed",
        completionRate: 1,
        counts,
        ariaLabel: "Friday, June 5: Completed; 1 Completed",
      },
    ],
    behaviorSummaries: [
      {
        behaviorId: behavior.id,
        title: behavior.title,
        categoryName: behavior.categoryName,
        trackingStartLocalDate: "2026-06-01",
        trackingStartLabel: "Jun 1",
        averageTrackedTime: null,
        dailyCells: [
          {
            key: "behavior-1-2026-06-05",
            localDate: "2026-06-05",
            label: "Friday, June 5",
            shortLabel: "Jun 5",
            state: "full",
            stateLabel: "Full",
            isSelected: true,
            isTrackingStart: false,
            counts,
            ariaLabel: "Friday, June 5; Full; 1 Completed",
          },
          {
            key: "behavior-1-2026-06-04",
            localDate: "2026-06-04",
            label: "Thursday, June 4",
            shortLabel: "Jun 4",
            state: "empty",
            stateLabel: "Empty",
            isSelected: false,
            isTrackingStart: false,
            counts: emptyCounts,
            ariaLabel: "Thursday, June 4; Empty",
          },
        ],
        ...counts,
        rate: 1,
        percentLabel: "100%",
        detailLabel: "1 / 1",
      },
    ],
    parentSummaries: [],
    categorySummaries: [],
    selectedBehaviorDay: {
      behaviorId: behavior.id,
      behaviorTitle: behavior.title,
      localDate: "2026-06-05",
      label: "Friday, June 5",
      occurrences: [
        {
          id: "occurrence-1",
          behaviorId: behavior.id,
          title: behavior.title,
          categoryName: behavior.categoryName,
          scheduledFor: "2026-06-05T22:00:00Z",
          scheduledTimeLabel: "6:00 PM",
          status: selectedOccurrenceStatus,
          statusLabel:
            selectedOccurrenceStatus === "completed" ? "Completed" : "Unresolved",
          note: "",
          trackedTime: null,
        },
      ],
    },
  };
}

it("renders optional planning inputs separately from measured time", () => {
  const html = renderToStaticMarkup(<BehaviorForm mode="create" action={behaviorAction} categories={[]} />);
  expect(html).toContain('name="default_duration_minutes"');
  expect(html).toContain('type="number"');
  expect(html).toContain('name="end_on"');
  expect(html).toContain('type="date"');
  expect(html).toContain("Intended duration (minutes)");
  expect(html).toContain("until the Behavior has 3 tracked completions, then with your tracked time.");
  expect(html).toContain("The last day it runs.");
  expect(html).not.toContain("Archives at the start of this date");
});
