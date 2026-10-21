import { Temporal } from "@js-temporal/polyfill";

import type {
  AnalyticsAdherence,
  AnalyticsAverageTrackedTime,
  AnalyticsBehaviorDayCell,
  AnalyticsBehaviorDayState,
  AnalyticsBehaviorSummary,
  AnalyticsCategorySummary,
  AnalyticsDayCell,
  AnalyticsOccurrenceInput,
  AnalyticsOverallDayState,
  AnalyticsRangeDays,
  AnalyticsSelectedBehaviorDay,
  AnalyticsStatus,
  AnalyticsStatusCounts,
  AnalyticsSummary,
  AnalyticsTimeSessionInput,
  AnalyticsTrackedTime,
  AnalyticsView,
} from "../types/analytics";
import { DEFAULT_TIMEZONE } from "../types/recurrence";
import {
  formatRecordedDuration,
  resolveOccurrenceTimeTracking,
} from "./time-tracking.resolver";

export const ANALYTICS_RANGE_OPTIONS: AnalyticsRangeDays[] = [7, 30, 90];
export const ANALYTICS_DEFAULT_RANGE_DAYS: AnalyticsRangeDays = 30;

export type AnalyticsDateRange = {
  timezone: string;
  rangeDays: AnalyticsRangeDays;
  startLocalDate: string;
  endLocalDate: string;
};

export type ResolveAnalyticsInput = {
  occurrences: AnalyticsOccurrenceInput[];
  needsDecisionOccurrences?: AnalyticsOccurrenceInput[];
  timeSessions?: AnalyticsTimeSessionInput[];
  now: Temporal.Instant;
  timezone?: string;
  rangeDays?: number;
  selectedBehaviorId?: string | null;
  selectedDayLocalDate?: string | null;
};

export function resolveAnalytics(input: ResolveAnalyticsInput): AnalyticsView {
  const dateRange = resolveAnalyticsDateRange(input);
  const selectedBehaviorDayLocalDate = resolveSelectedBehaviorDayLocalDate({
    selectedBehaviorId: input.selectedBehaviorId,
    selectedDayLocalDate: input.selectedDayLocalDate,
    startLocalDate: dateRange.startLocalDate,
    endLocalDate: dateRange.endLocalDate,
  });
  const dates = listLocalDates(dateRange.startLocalDate, dateRange.endLocalDate);
  const rangeOccurrences = input.occurrences
    .filter((occurrence) =>
      isWithinLocalDateRange(
        occurrence.localDate,
        dateRange.startLocalDate,
        dateRange.endLocalDate,
      ),
    )
    .sort(compareOccurrences);
  const summary = toAnalyticsSummary(
    countSummaryOccurrences({
      rangeOccurrences,
      needsDecisionOccurrences: input.needsDecisionOccurrences ?? rangeOccurrences,
      todayLocalDate: dateRange.endLocalDate,
    }),
  );
  const trackedTimeByOccurrenceId = resolveTrackedTimeByOccurrenceId(
    input.timeSessions ?? [],
  );

  return {
    timezone: dateRange.timezone,
    rangeDays: dateRange.rangeDays,
    rangeOptions: [...ANALYTICS_RANGE_OPTIONS],
    rangeStartLocalDate: dateRange.startLocalDate,
    rangeEndLocalDate: dateRange.endLocalDate,
    rangeLabel: `Last ${dateRange.rangeDays} days`,
    summary,
    overallHeatmap: resolveOverallHeatmap({
      dates,
      occurrences: rangeOccurrences,
    }),
    behaviorSummaries: resolveBehaviorSummaries({
      dates,
      occurrences: rangeOccurrences,
      trackedTimeByOccurrenceId,
      selectedBehaviorId: input.selectedBehaviorId ?? null,
      selectedDayLocalDate: selectedBehaviorDayLocalDate,
    }),
    categorySummaries: resolveCategorySummaries(rangeOccurrences),
    selectedBehaviorDay: resolveSelectedBehaviorDay({
      selectedBehaviorId: input.selectedBehaviorId ?? null,
      selectedDayLocalDate: selectedBehaviorDayLocalDate,
      occurrences: rangeOccurrences,
      trackedTimeByOccurrenceId,
    }),
  };
}

/** Counts a caller-selected range without the web page's range presets or backlog summary. */
export function resolveAdherenceCounts(input: {
  occurrences: Array<Pick<AnalyticsOccurrenceInput, "status" | "localDate">>;
  todayLocalDate: string;
}) {
  const counts = countOccurrences(input.occurrences);
  return {
    ...toAnalyticsSummary(counts),
    needsDecisionCount: input.occurrences.filter((row) =>
      row.status === "unresolved" && compareLocalDate(row.localDate, input.todayLocalDate) < 0,
    ).length,
  };
}

export function resolveAnalyticsDateRange(input: {
  now: Temporal.Instant;
  timezone?: string;
  rangeDays?: number;
}): AnalyticsDateRange {
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  const rangeDays = normalizeAnalyticsRangeDays(input.rangeDays);
  const endDate = input.now.toZonedDateTimeISO(timezone).toPlainDate();
  const startDate = endDate.subtract({ days: rangeDays - 1 });

  return {
    timezone,
    rangeDays,
    startLocalDate: startDate.toString(),
    endLocalDate: endDate.toString(),
  };
}

export function normalizeAnalyticsRangeDays(
  value: number | undefined,
): AnalyticsRangeDays {
  if (value === undefined || !Number.isFinite(value)) {
    return ANALYTICS_DEFAULT_RANGE_DAYS;
  }

  const roundedValue = Math.trunc(value);

  return isAnalyticsRangeDays(roundedValue)
    ? roundedValue
    : ANALYTICS_DEFAULT_RANGE_DAYS;
}

function resolveOverallHeatmap(input: {
  dates: Temporal.PlainDate[];
  occurrences: AnalyticsOccurrenceInput[];
}): AnalyticsDayCell[] {
  return input.dates.map((date) => {
    const localDate = date.toString();
    const counts = countOccurrences(
      input.occurrences.filter((occurrence) => occurrence.localDate === localDate),
    );
    const completionRate = calculateDayCompletionRate(counts);
    const state = resolveOverallDayState(counts);
    const stateLabel = overallDayStateLabel(state, completionRate);

    return {
      key: `overall-${localDate}`,
      localDate,
      label: formatDateLabel(date),
      shortLabel: formatShortDateLabel(date),
      isSelected: false,
      state,
      stateLabel,
      completionRate,
      counts,
      ariaLabel: `${formatDateLabel(date)}: ${stateLabel}; ${countsLabel(
        counts,
      )}`,
    };
  });
}

function resolveBehaviorSummaries(input: {
  dates: Temporal.PlainDate[];
  occurrences: AnalyticsOccurrenceInput[];
  trackedTimeByOccurrenceId: Map<string, AnalyticsTrackedTime>;
  selectedBehaviorId: string | null;
  selectedDayLocalDate: string | null;
}): AnalyticsBehaviorSummary[] {
  const behaviorGroups = new Map<string, AnalyticsOccurrenceInput[]>();

  for (const occurrence of input.occurrences) {
    const existing = behaviorGroups.get(occurrence.behaviorId) ?? [];
    existing.push(occurrence);
    behaviorGroups.set(occurrence.behaviorId, existing);
  }

  return Array.from(behaviorGroups.entries())
    .map(([behaviorId, occurrences]) => {
      const firstOccurrence = occurrences[0];
      const counts = countOccurrences(occurrences);
      const adherence = calculateAdherence(counts);
      const trackingStart = resolveBehaviorTrackingStart(occurrences);
      const averageTrackedTime = calculateAverageTrackedTime(
        occurrences,
        input.trackedTimeByOccurrenceId,
      );

      return {
        behaviorId,
        title: firstOccurrence?.behaviorTitle ?? "Untitled behavior",
        categoryName: firstOccurrence?.categoryName ?? "No category",
        trackingStartLocalDate: trackingStart.localDate,
        trackingStartLabel: trackingStart.label,
        averageTrackedTime,
        ...counts,
        ...adherence,
        dailyCells: input.dates.map((date) =>
          resolveBehaviorDayCell({
            date,
            occurrences,
            trackingStartLocalDate: trackingStart.localDate,
            behaviorId,
            selectedBehaviorId: input.selectedBehaviorId,
            selectedDayLocalDate: input.selectedDayLocalDate,
          }),
        ),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

function resolveBehaviorDayCell(input: {
  date: Temporal.PlainDate;
  occurrences: AnalyticsOccurrenceInput[];
  trackingStartLocalDate: string;
  behaviorId: string;
  selectedBehaviorId: string | null;
  selectedDayLocalDate: string | null;
}): AnalyticsBehaviorDayCell {
  const { date, occurrences } = input;
  const localDate = date.toString();
  const counts = countOccurrences(
    occurrences.filter((occurrence) => occurrence.localDate === localDate),
  );
  const state = resolveBehaviorDayState(counts);
  const stateLabel = behaviorDayStateLabel(state);
  const isTrackingStart = localDate === input.trackingStartLocalDate;
  const isSelected =
    counts.totalCount > 0 &&
    input.behaviorId === input.selectedBehaviorId &&
    localDate === input.selectedDayLocalDate;
  const trackingStartSuffix = isTrackingStart ? "; tracking started" : "";

  return {
    key: `behavior-${localDate}`,
    localDate,
    label: formatDateLabel(date),
    shortLabel: formatShortDateLabel(date),
    state,
    stateLabel,
    isSelected,
    isTrackingStart,
    counts,
    ariaLabel: `${formatDateLabel(date)}: ${stateLabel}; ${countsLabel(
      counts,
    )}${trackingStartSuffix}`,
  };
}

function resolveBehaviorTrackingStart(
  occurrences: AnalyticsOccurrenceInput[],
): { localDate: string; label: string } {
  const firstOccurrence = occurrences[0];

  if (!firstOccurrence) {
    return {
      localDate: "",
      label: "Unknown",
    };
  }

  const earliestOccurrence = occurrences.reduce((earliest, occurrence) =>
    Temporal.Instant.compare(
      Temporal.Instant.from(occurrence.behaviorCreatedAt),
      Temporal.Instant.from(earliest.behaviorCreatedAt),
    ) < 0
      ? occurrence
      : earliest,
  );
  const startDate = Temporal.Instant.from(
    earliestOccurrence.behaviorCreatedAt,
  )
    .toZonedDateTimeISO(earliestOccurrence.timezone || DEFAULT_TIMEZONE)
    .toPlainDate();

  return {
    localDate: startDate.toString(),
    label: formatDateLabel(startDate),
  };
}

function resolveCategorySummaries(
  occurrences: AnalyticsOccurrenceInput[],
): AnalyticsCategorySummary[] {
  const categoryGroups = new Map<string, AnalyticsOccurrenceInput[]>();

  for (const occurrence of occurrences) {
    const existing = categoryGroups.get(occurrence.categoryName) ?? [];
    existing.push(occurrence);
    categoryGroups.set(occurrence.categoryName, existing);
  }

  return Array.from(categoryGroups.entries())
    .map(([categoryName, categoryOccurrences]) => {
      const counts = countOccurrences(categoryOccurrences);

      return {
        categoryName,
        ...counts,
        ...calculateAdherence(counts),
      };
    })
    .sort((left, right) => left.categoryName.localeCompare(right.categoryName));
}

function resolveSelectedBehaviorDay(input: {
  selectedBehaviorId: string | null;
  selectedDayLocalDate: string | null;
  occurrences: AnalyticsOccurrenceInput[];
  trackedTimeByOccurrenceId: Map<string, AnalyticsTrackedTime>;
}): AnalyticsSelectedBehaviorDay | null {
  if (!input.selectedBehaviorId || !input.selectedDayLocalDate) {
    return null;
  }

  const date = Temporal.PlainDate.from(input.selectedDayLocalDate);
  const occurrences = input.occurrences
    .filter(
      (occurrence) =>
        occurrence.behaviorId === input.selectedBehaviorId &&
        occurrence.localDate === input.selectedDayLocalDate,
    )
    .sort(compareOccurrences)
    .map((occurrence) => ({
      id: occurrence.id,
      behaviorId: occurrence.behaviorId,
      title: occurrence.behaviorTitle,
      categoryName: occurrence.categoryName,
      scheduledFor: occurrence.scheduledFor,
      scheduledTimeLabel: occurrence.scheduledTimeLabel,
      status: occurrence.status,
      statusLabel: statusLabel(occurrence.status),
      note: occurrence.note,
      trackedTime: input.trackedTimeByOccurrenceId.get(occurrence.id) ?? null,
    }));

  if (occurrences.length === 0) {
    return null;
  }

  return {
    behaviorId: input.selectedBehaviorId,
    behaviorTitle: occurrences[0]?.title ?? "Untitled behavior",
    localDate: input.selectedDayLocalDate,
    label: formatDateLabel(date),
    occurrences,
  };
}

function resolveTrackedTimeByOccurrenceId(
  timeSessions: AnalyticsTimeSessionInput[],
): Map<string, AnalyticsTrackedTime> {
  const sessionsByOccurrenceId = new Map<
    string,
    AnalyticsTimeSessionInput[]
  >();

  for (const session of timeSessions) {
    const sessions = sessionsByOccurrenceId.get(session.occurrenceId) ?? [];
    sessions.push(session);
    sessionsByOccurrenceId.set(session.occurrenceId, sessions);
  }

  return new Map(
    Array.from(sessionsByOccurrenceId, ([occurrenceId, sessions]) => {
      const tracking = resolveOccurrenceTimeTracking(sessions);
      const hasRecordedTime = sessions.some((session) => session.stoppedAt !== null);

      return [
        occurrenceId,
        {
          recordedSeconds: tracking.recordedSeconds,
          durationLabel: formatRecordedDuration(tracking.recordedSeconds),
          hasRecordedTime,
          isInProgress: tracking.runningSession !== null,
        },
      ];
    }),
  );
}

function calculateAverageTrackedTime(
  occurrences: AnalyticsOccurrenceInput[],
  trackedTimeByOccurrenceId: Map<string, AnalyticsTrackedTime>,
): AnalyticsAverageTrackedTime | null {
  const timedOccurrenceTotals = occurrences
    .map((occurrence) => trackedTimeByOccurrenceId.get(occurrence.id))
    .filter(
      (trackedTime): trackedTime is AnalyticsTrackedTime =>
        Boolean(trackedTime?.hasRecordedTime),
    );

  if (timedOccurrenceTotals.length === 0) {
    return null;
  }

  const averageSeconds =
    timedOccurrenceTotals.reduce(
      (total, trackedTime) => total + trackedTime.recordedSeconds,
      0,
    ) / timedOccurrenceTotals.length;

  return {
    averageSeconds,
    durationLabel: formatRecordedDuration(averageSeconds),
    timedOccurrenceCount: timedOccurrenceTotals.length,
  };
}

function statusLabel(status: AnalyticsStatus): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "not_completed":
      return "Not Completed";
    case "unresolved":
      return "Unresolved";
  }
}

function countOccurrences(
  occurrences: Array<Pick<AnalyticsOccurrenceInput, "status">>,
): AnalyticsStatusCounts {
  const counts = emptyCounts();

  for (const occurrence of occurrences) {
    incrementCounts(counts, occurrence.status);
  }

  return counts;
}

function countSummaryOccurrences(input: {
  rangeOccurrences: AnalyticsOccurrenceInput[];
  needsDecisionOccurrences: AnalyticsOccurrenceInput[];
  todayLocalDate: string;
}): AnalyticsStatusCounts {
  const counts = emptyCounts();

  for (const occurrence of input.rangeOccurrences) {
    if (occurrence.status === "unresolved") {
      continue;
    }

    incrementCounts(counts, occurrence.status);
  }

  for (const occurrence of input.needsDecisionOccurrences) {
    if (
      occurrence.status === "unresolved" &&
      isActiveBehaviorOccurrence(occurrence) &&
      compareLocalDate(occurrence.localDate, input.todayLocalDate) < 0
    ) {
      incrementCounts(counts, occurrence.status);
    }
  }

  return counts;
}

function isActiveBehaviorOccurrence(
  occurrence: AnalyticsOccurrenceInput,
): boolean {
  return occurrence.behaviorActive !== false;
}

function emptyCounts(): AnalyticsStatusCounts {
  return {
    completedCount: 0,
    notCompletedCount: 0,
    unresolvedCount: 0,
    resolvedCount: 0,
    totalCount: 0,
  };
}

function incrementCounts(
  counts: AnalyticsStatusCounts,
  status: AnalyticsStatus,
): void {
  counts.totalCount += 1;

  switch (status) {
    case "completed":
      counts.completedCount += 1;
      counts.resolvedCount += 1;
      return;
    case "not_completed":
      counts.notCompletedCount += 1;
      counts.resolvedCount += 1;
      return;
    case "unresolved":
      counts.unresolvedCount += 1;
      return;
  }
}

function toAnalyticsSummary(counts: AnalyticsStatusCounts): AnalyticsSummary {
  return {
    ...counts,
    ...calculateAdherence(counts),
  };
}

function calculateAdherence(
  counts: AnalyticsStatusCounts,
): AnalyticsAdherence {
  if (counts.resolvedCount === 0) {
    return {
      rate: null,
      percentLabel: "No resolved occurrences",
      detailLabel: "0 resolved",
    };
  }

  const rate = counts.completedCount / counts.resolvedCount;

  return {
    rate,
    percentLabel: `${formatPercent(rate)}%`,
    detailLabel: `${counts.completedCount} of ${counts.resolvedCount} resolved Completed`,
  };
}

function calculateDayCompletionRate(
  counts: AnalyticsStatusCounts,
): number | null {
  if (counts.totalCount === 0 || counts.resolvedCount === 0) {
    return null;
  }

  return counts.completedCount / counts.totalCount;
}

function resolveOverallDayState(
  counts: AnalyticsStatusCounts,
): AnalyticsOverallDayState {
  if (counts.totalCount === 0) {
    return "empty";
  }

  if (counts.resolvedCount === 0) {
    return "unresolved";
  }

  if (counts.completedCount === counts.totalCount) {
    return "completed";
  }

  if (counts.completedCount > 0) {
    return "partial";
  }

  return "not_completed";
}

function resolveBehaviorDayState(
  counts: AnalyticsStatusCounts,
): AnalyticsBehaviorDayState {
  if (counts.totalCount === 0) {
    return "empty";
  }

  if (counts.unresolvedCount === counts.totalCount) {
    return "unresolved";
  }

  if (counts.completedCount === counts.totalCount) {
    return "full";
  }

  if (counts.completedCount > 0) {
    return "partial";
  }

  if (counts.notCompletedCount > 0) {
    return "not_completed";
  }

  return "unresolved";
}

function overallDayStateLabel(
  state: AnalyticsOverallDayState,
  completionRate: number | null,
): string {
  switch (state) {
    case "completed":
      return "Completed";
    case "partial":
      return `${formatPercent(completionRate ?? 0)}% Completed`;
    case "not_completed":
      return "Not Completed";
    case "unresolved":
      return "Unresolved";
    case "empty":
      return "No occurrences";
  }
}

function behaviorDayStateLabel(state: AnalyticsBehaviorDayState): string {
  switch (state) {
    case "full":
      return "Full";
    case "partial":
      return "Partial";
    case "not_completed":
      return "Not Completed";
    case "unresolved":
      return "Unresolved";
    case "empty":
      return "No occurrences";
  }
}

function resolveSelectedBehaviorDayLocalDate(input: {
  selectedBehaviorId?: string | null;
  selectedDayLocalDate?: string | null;
  startLocalDate: string;
  endLocalDate: string;
}): string | null {
  if (!input.selectedBehaviorId || !input.selectedDayLocalDate) {
    return null;
  }

  try {
    const selectedDate = Temporal.PlainDate.from(input.selectedDayLocalDate);
    const normalizedSelectedDate = selectedDate.toString();

    return isWithinLocalDateRange(
      normalizedSelectedDate,
      input.startLocalDate,
      input.endLocalDate,
    )
      ? normalizedSelectedDate
      : null;
  } catch {
    return null;
  }
}

function listLocalDates(
  startLocalDate: string,
  endLocalDate: string,
): Temporal.PlainDate[] {
  const dates: Temporal.PlainDate[] = [];
  let cursor = Temporal.PlainDate.from(startLocalDate);
  const endDate = Temporal.PlainDate.from(endLocalDate);

  while (Temporal.PlainDate.compare(cursor, endDate) <= 0) {
    dates.push(cursor);
    cursor = cursor.add({ days: 1 });
  }

  return dates;
}

function isWithinLocalDateRange(
  localDate: string,
  startLocalDate: string,
  endLocalDate: string,
): boolean {
  return (
    compareLocalDate(localDate, startLocalDate) >= 0 &&
    compareLocalDate(localDate, endLocalDate) <= 0
  );
}

function compareLocalDate(left: string, right: string): number {
  return Temporal.PlainDate.compare(
    Temporal.PlainDate.from(left),
    Temporal.PlainDate.from(right),
  );
}

function compareOccurrences(
  left: AnalyticsOccurrenceInput,
  right: AnalyticsOccurrenceInput,
): number {
  const instantComparison = Temporal.Instant.compare(
    Temporal.Instant.from(left.scheduledFor),
    Temporal.Instant.from(right.scheduledFor),
  );

  if (instantComparison !== 0) {
    return instantComparison;
  }

  return left.behaviorTitle.localeCompare(right.behaviorTitle);
}

function isAnalyticsRangeDays(value: number): value is AnalyticsRangeDays {
  return ANALYTICS_RANGE_OPTIONS.some((option) => option === value);
}

function formatPercent(rate: number): string {
  const percent = rate * 100;
  const rounded = Math.round(percent * 10) / 10;

  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function countsLabel(counts: AnalyticsStatusCounts): string {
  return `${counts.completedCount} Completed, ${counts.notCompletedCount} Not Completed, ${counts.unresolvedCount} Unresolved`;
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

const SHORT_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

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

function formatShortDateLabel(date: Temporal.PlainDate): string {
  return `${SHORT_WEEKDAY_LABELS[date.dayOfWeek - 1]} ${date.month}/${date.day}`;
}
