import { Temporal } from "@js-temporal/polyfill";

import { canRemoveOpportunityOccurrence } from "./opportunity.resolver";
import { compareSubBehaviors, resolveParentSlotRollup } from "./sub-behavior.resolver";
import { canStartOccurrenceTimeTracking } from "./time-tracking.resolver";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import type {
  TimelineDayRow,
  TimelineDaySection,
  TimelineOccurrenceGroup,
  TimelineParentGroupView,
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

/**
 * Applies one row transform everywhere a day section holds the row: the flat list,
 * standalone groups, parent slots and the ordered rows. Parent rollups are recomputed.
 */
export function mapTimelineDaySectionOccurrences(
  section: TimelineDaySection,
  transform: (occurrence: TimelineOccurrenceView) => TimelineOccurrenceView,
): TimelineDaySection {
  const mapGroup = (group: TimelineOccurrenceGroup): TimelineOccurrenceGroup => ({
    ...group,
    occurrences: group.occurrences.map(transform),
  });
  const mapParent = (group: TimelineParentGroupView): TimelineParentGroupView => {
    const children = group.children.map(transform);
    return { ...group, children, rollup: resolveParentSlotRollup(children.map((child) => child.status)) };
  };
  const occurrenceGroups = section.occurrenceGroups.map(mapGroup);
  const parentGroups = section.parentGroups.map(mapParent);
  const groupByKey = new Map(occurrenceGroups.map((group) => [group.key, group]));
  const parentByKey = new Map(parentGroups.map((group) => [group.key, group]));
  return {
    ...section,
    occurrences: section.occurrences.map(transform),
    occurrenceGroups,
    parentGroups,
    rows: section.rows.map((row): TimelineDayRow => row.kind === "parent"
      ? { ...row, group: parentByKey.get(row.key) ?? mapParent(row.group) }
      : { ...row, group: groupByKey.get(row.key) ?? mapGroup(row.group) }),
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
      ...groupDayRows(dayOccurrences, "day"),
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
        ...groupDayRows(dayOccurrences, "needs"),
      };
    });
}

function countUnresolvedOccurrences(
  occurrences: TimelineOccurrenceView[],
): number {
  return occurrences.filter((occurrence) => occurrence.status === "unresolved")
    .length;
}

function groupDayRows(
  occurrences: TimelineOccurrenceView[],
  scope: "day" | "needs",
): Pick<TimelineDaySection, "occurrenceGroups" | "parentGroups" | "rows"> {
  const standalone = occurrences.filter((occurrence) => !occurrence.parentBehaviorId);
  const occurrenceGroups = groupOccurrencesByBehavior(standalone);
  const parentGroups = groupOccurrencesByParentSlot(
    occurrences.filter((occurrence) => occurrence.parentBehaviorId),
    scope,
  );
  const rows: TimelineDayRow[] = [
    ...occurrenceGroups.map((group): TimelineDayRow => ({ kind: "behavior", key: group.key, group })),
    ...parentGroups.map((group): TimelineDayRow => ({ kind: "parent", key: group.key, group })),
  ].sort((left, right) =>
    compareInstants(rowStartsAt(left), rowStartsAt(right)) || left.group.title.localeCompare(right.group.title));

  return { occurrenceGroups, parentGroups, rows };
}

// One group per parent, day and slot. Sub-behavior rows keep their own status; the
// group's status is derived and never stored.
function groupOccurrencesByParentSlot(
  occurrences: TimelineOccurrenceView[],
  scope: "day" | "needs",
): TimelineParentGroupView[] {
  const groups = new Map<string, TimelineOccurrenceView[]>();

  for (const occurrence of occurrences) {
    const slotKey = occurrence.parentSlotKey ?? occurrence.scheduledFor;
    const key = `${scope}-parent-${occurrence.parentBehaviorId}-${occurrence.localDate}-${slotKey}`;
    const group = groups.get(key) ?? [];
    group.push(occurrence);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, children]): TimelineParentGroupView => {
      const ordered = [...children].sort((left, right) =>
        compareSubBehaviors(
          { id: left.behaviorId, title: left.title, subBehaviorSortOrder: left.subBehaviorSortOrder },
          { id: right.behaviorId, title: right.title, subBehaviorSortOrder: right.subBehaviorSortOrder },
        ) || compareOccurrencesByScheduledTime(left, right));
      const earliest = [...children].sort(compareOccurrencesByScheduledTime)[0]!;
      const rollup = resolveParentSlotRollup(children.map((child) => child.status));
      const isPriorUnresolved = children.some((child) => child.visualTone === "needs_decision");

      return {
        key,
        parentBehaviorId: earliest.parentBehaviorId!,
        title: children.find((child) => child.parentTitle)?.parentTitle ?? "Untitled behavior",
        localDate: earliest.localDate,
        scheduledFor: earliest.scheduledFor,
        scheduledTimeLabel: earliest.scheduledTimeLabel,
        children: ordered,
        rollup,
        visualTone: isPriorUnresolved ? "needs_decision"
          : rollup.status === "completed" ? "completed"
            : rollup.status === "not_completed" ? "not_completed"
              : "default",
        showDecisionActions: children.some((child) => child.showDecisionActions),
        isVisibleInNeedsDecision: children.some((child) => child.isVisibleInNeedsDecision),
      };
    })
    .sort((left, right) =>
      compareInstants(left.scheduledFor, right.scheduledFor) || left.title.localeCompare(right.title));
}

function rowStartsAt(row: TimelineDayRow): string | undefined {
  return row.kind === "parent" ? row.group.scheduledFor : row.group.occurrences[0]?.scheduledFor;
}

function compareInstants(left: string | undefined, right: string | undefined): number {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right));
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
  const origin = occurrence.origin === "opportunity" ? "opportunity" : "scheduled";
  const hasTimeSessions = occurrence.hasTimeSessions ?? (occurrence.timeTracking.recordedSeconds > 0
    || occurrence.timeTracking.runningStartedAt !== null);

  return {
    ...occurrence,
    origin,
    addedBy: origin === "opportunity" ? occurrence.addedBy ?? null : null,
    canRemove: canRemoveOpportunityOccurrence({
      origin,
      status: occurrence.status,
      note: occurrence.note,
      hasTimeSessions,
      hasStatusHistory: occurrence.hasStatusHistory,
      hasActiveSourceMatch: occurrence.hasActiveSourceMatch,
    }),
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
