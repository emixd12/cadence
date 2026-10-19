import { Temporal } from "@js-temporal/polyfill";

import { canStartOccurrenceTimeTracking } from "./time-tracking.resolver";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import type {
  TimelineDaySection,
  TimelineOccurrenceGroup,
  TimelineOccurrenceInput,
  TimelineOccurrenceView,
  TimelineStatus,
  TimelineView,
  TimelineVisualTone,
} from "../types/timeline";

export const TIMELINE_DEFAULT_FUTURE_DAYS = 7;
export const TIMELINE_MAX_FUTURE_DAYS = 30;
export const TIMELINE_FUTURE_DAYS_STEP = 7;
export const EMPTY_DAY_MESSAGE = "No behaviors on this day";

export type ResolveTimelineInput = {
  occurrences: TimelineOccurrenceInput[];
  now: Temporal.Instant;
  timezone?: string;
  futureDays?: number;
  startLocalDate?: string;
};

// Resolve one persisted Occurrence without applying the feed's date range.
// Reminder activation uses the same status and timing eligibility as the feed.
export function resolveTimelineOccurrence(input: {
  occurrence: TimelineOccurrenceInput;
  now: Temporal.Instant;
  timezone: string;
}): TimelineOccurrenceView {
  const today = input.now.toZonedDateTimeISO(input.timezone).toPlainDate().toString();
  return toOccurrenceView(input.occurrence, today, input.timezone, input.now);
}

export function resolveTimeline(input: ResolveTimelineInput): TimelineView {
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  const today = input.now.toZonedDateTimeISO(timezone).toPlainDate();
  const todayLocalDate = today.toString();
  const visibleFutureDays = normalizeFutureDays(input.futureDays);
  const occurrences = input.occurrences.map((occurrence) =>
    toOccurrenceView(occurrence, todayLocalDate, timezone, input.now),
  );

  return {
    timezone,
    todayLocalDate,
    visibleFutureDays,
    maxFutureDays: TIMELINE_MAX_FUTURE_DAYS,
    nextFutureDays:
      visibleFutureDays < TIMELINE_MAX_FUTURE_DAYS
        ? Math.min(
            visibleFutureDays + TIMELINE_FUTURE_DAYS_STEP,
            TIMELINE_MAX_FUTURE_DAYS,
          )
        : null,
    needsDecision: resolveNeedsDecision(occurrences),
    daySections: resolveForwardDaySections({
      occurrences,
      today,
      startDate: input.startLocalDate ? Temporal.PlainDate.from(input.startLocalDate) : today,
      visibleFutureDays,
    }),
  };
}

function resolveNeedsDecision(
  occurrences: TimelineOccurrenceView[],
): TimelineView["needsDecision"] {
  const visibleOccurrences = occurrences
    .filter((occurrence) => occurrence.isVisibleInNeedsDecision)
    .sort(compareOccurrencesForNeedsDecision);
  const occurrenceCount = visibleOccurrences.filter(
    (occurrence) => occurrence.status === "unresolved",
  ).length;
  const daySections = groupNeedsDecisionDays(visibleOccurrences);

  return {
    title: "Needs decision",
    emptyMessage: "No prior unresolved occurrences.",
    occurrenceCount,
    daySections,
  };
}

function resolveForwardDaySections(input: {
  occurrences: TimelineOccurrenceView[];
  today: Temporal.PlainDate;
  startDate: Temporal.PlainDate;
  visibleFutureDays: number;
}): TimelineDaySection[] {
  const sections: TimelineDaySection[] = [];

  for (let offset = 0; offset <= input.visibleFutureDays; offset += 1) {
    const date = input.startDate.add({ days: offset });
    const daysFromToday = input.today.until(date, { largestUnit: "days" }).days;
    const localDate = date.toString();
    const dayOccurrences = input.occurrences
      .filter((occurrence) => occurrence.localDate === localDate)
      .sort(compareOccurrencesByScheduledTime);

    sections.push({
      key: `day-${localDate}`,
      kind: daysFromToday === 0 ? "today" : "future",
      localDate,
      label: formatDateLabel(date),
      relativeLabel: relativeDayLabel(daysFromToday),
      emptyMessage: EMPTY_DAY_MESSAGE,
      occurrences: dayOccurrences,
      unresolvedOccurrenceCount: countUnresolvedOccurrences(dayOccurrences),
      occurrenceGroups: groupOccurrencesByBehavior(dayOccurrences),
    });
  }

  return sections;
}

function groupNeedsDecisionDays(
  occurrences: TimelineOccurrenceView[],
): TimelineDaySection[] {
  const grouped = new Map<string, TimelineOccurrenceView[]>();

  for (const occurrence of occurrences) {
    const dayOccurrences = grouped.get(occurrence.localDate) ?? [];
    dayOccurrences.push(occurrence);
    grouped.set(occurrence.localDate, dayOccurrences);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => compareLocalDate(right, left))
    .map(([localDate, dayOccurrences]) => {
      const date = Temporal.PlainDate.from(localDate);

      return {
        key: `needs-${localDate}`,
        kind: "needs_decision_day",
        localDate,
        label: formatDateLabel(date),
        relativeLabel: "Prior unresolved",
        emptyMessage: EMPTY_DAY_MESSAGE,
        occurrences: [...dayOccurrences].sort(compareOccurrencesByScheduledTime),
        unresolvedOccurrenceCount: countUnresolvedOccurrences(dayOccurrences),
        occurrenceGroups: groupOccurrencesByBehavior(dayOccurrences),
      };
    });
}

function countUnresolvedOccurrences(
  occurrences: TimelineOccurrenceView[],
): number {
  return occurrences.filter((occurrence) => occurrence.status === "unresolved")
    .length;
}

function groupOccurrencesByBehavior(
  occurrences: TimelineOccurrenceView[],
): TimelineOccurrenceGroup[] {
  const groups = new Map<string, TimelineOccurrenceView[]>();

  for (const occurrence of [...occurrences].sort(compareOccurrencesByScheduledTime)) {
    const group = groups.get(occurrence.behaviorId) ?? [];
    group.push(occurrence);
    groups.set(occurrence.behaviorId, group);
  }

  return Array.from(groups.entries())
    .map(([behaviorId, groupOccurrences]) => {
      const sortedOccurrences = [...groupOccurrences].sort(
        compareOccurrencesByScheduledTime,
      );
      const firstOccurrence = sortedOccurrences[0];

      return {
        key: `behavior-${behaviorId}-${firstOccurrence?.localDate ?? "unknown"}`,
        behaviorId,
        title: firstOccurrence?.title ?? "Untitled behavior",
        occurrences: sortedOccurrences,
        isGroupedStack: sortedOccurrences.length > 1,
      };
    })
    .sort((left, right) => {
      const leftFirst = left.occurrences[0];
      const rightFirst = right.occurrences[0];

      if (!leftFirst || !rightFirst) {
        return left.title.localeCompare(right.title);
      }

      return compareOccurrencesByScheduledTime(leftFirst, rightFirst);
    });
}

function toOccurrenceView(
  occurrence: TimelineOccurrenceInput,
  todayLocalDate: string,
  timezone: string,
  now: Temporal.Instant,
): TimelineOccurrenceView {
  const isPriorUnresolved =
    occurrence.status === "unresolved" &&
    compareLocalDate(occurrence.localDate, todayLocalDate) < 0;
  const isRetainedNeedsDecision =
    occurrence.status !== "unresolved" &&
    compareLocalDate(occurrence.localDate, todayLocalDate) < 0 &&
    wasStatusMarkedOnLocalDate(occurrence.statusMarkedAt, todayLocalDate, timezone);
  const canShowDecisionActionsWhenUnresolved =
    compareLocalDate(occurrence.localDate, todayLocalDate) <= 0;
  const showDecisionActions =
    occurrence.status === "unresolved" && canShowDecisionActionsWhenUnresolved;

  return {
    ...occurrence,
    statusLabel: statusLabel(occurrence.status),
    statusDetail: statusDetail(occurrence.status),
    expandedStatusActionLabel: expandedStatusActionLabel(occurrence.status),
    visualTone: visualTone(occurrence.status, isPriorUnresolved),
    isVisibleInNeedsDecision: isPriorUnresolved || isRetainedNeedsDecision,
    canShowDecisionActionsWhenUnresolved,
    showDecisionActions,
    showCollapsedStatusLabel:
      occurrence.status !== "unresolved" && !showDecisionActions,
    canStartTimeTracking: canStartOccurrenceTimeTracking({
      behaviorActive: occurrence.canStartTimeTracking,
      occurrenceLocalDate: occurrence.localDate,
      occurrenceStatus: occurrence.status,
      statusMarkedAt: occurrence.statusMarkedAt,
      now,
      timezone,
    }),
  };
}

function wasStatusMarkedOnLocalDate(
  statusMarkedAt: string | null,
  localDate: string,
  timezone: string,
): boolean {
  if (!statusMarkedAt) {
    return false;
  }

  return (
    Temporal.Instant.from(statusMarkedAt)
      .toZonedDateTimeISO(timezone)
      .toPlainDate()
      .toString() === localDate
  );
}

function statusLabel(status: TimelineStatus): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "not_completed":
      return "Not Completed";
    case "unresolved":
      return "Unresolved";
  }
}

function statusDetail(status: TimelineStatus): string {
  switch (status) {
    case "completed":
      return "Resolved as Completed";
    case "not_completed":
      return "Resolved as Not Completed";
    case "unresolved":
      return "Awaiting decision";
  }
}

function expandedStatusActionLabel(status: TimelineStatus): string {
  switch (status) {
    case "completed":
    case "not_completed":
      return "Change status";
    case "unresolved":
      return "Set status";
  }
}

function visualTone(
  status: TimelineStatus,
  isPriorUnresolved: boolean,
): TimelineVisualTone {
  if (isPriorUnresolved) {
    return "needs_decision";
  }

  switch (status) {
    case "completed":
      return "completed";
    case "not_completed":
      return "not_completed";
    case "unresolved":
      return "default";
  }
}

function compareOccurrencesForNeedsDecision(
  left: TimelineOccurrenceView,
  right: TimelineOccurrenceView,
): number {
  const dayComparison = compareLocalDate(right.localDate, left.localDate);

  if (dayComparison !== 0) {
    return dayComparison;
  }

  return compareOccurrencesByScheduledTime(left, right);
}

function compareOccurrencesByScheduledTime(
  left: TimelineOccurrenceView,
  right: TimelineOccurrenceView,
): number {
  const instantComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.scheduledFor),
    Temporal.Instant.from(right.scheduledFor),
  );

  if (instantComparison !== 0) {
    return instantComparison;
  }

  return left.title.localeCompare(right.title);
}

function compareLocalDate(left: string, right: string): number {
  return Temporal.PlainDate.compare(
    Temporal.PlainDate.from(left),
    Temporal.PlainDate.from(right),
  );
}

function normalizeFutureDays(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return TIMELINE_DEFAULT_FUTURE_DAYS;
  }

  return Math.min(
    TIMELINE_MAX_FUTURE_DAYS,
    Math.max(0, Math.trunc(value)),
  );
}

function relativeDayLabel(offset: number): string {
  if (offset === 0) {
    return "Current day";
  }

  if (offset === 1) {
    return "Tomorrow";
  }

  return `In ${offset} days`;
}

const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function formatDateLabel(date: Temporal.PlainDate): string {
  return `${WEEKDAY_LABELS[date.dayOfWeek - 1]}, ${
    MONTH_LABELS[date.month - 1]
  } ${date.day}`;
}
