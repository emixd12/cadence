import { Temporal } from "@js-temporal/polyfill";

export type CompletionTimingOccurrence = Readonly<{
  id: string;
  behaviorId: string;
  localDate: string;
  status: string;
  statusMarkedAt?: string | null;
}>;

export type CompletionTimingSummary = Readonly<{
  sampleCount: number;
  sampledDayCount: number;
  delayedMarkCount: number;
  typicalMarkedTime: string | null;
  range: Readonly<{ startTime: string; endTime: string; spansMidnight: boolean }> | null;
  reason: "insufficient_samples" | "dispersed_times" | "history_limit_exceeded" | "source_unavailable" | null;
  exclusions: Readonly<{
    notCompleted: number;
    outsideWindow: number;
    missingMark: number;
    invalidMark: number;
    futureMark: number;
    duplicateOccurrence: number;
  }>;
}>;

/** Current status snapshots already collapse corrections and repeated taps.
 * These are marking patterns, never measurements of actual start/finish time.
 * Ticket 322 (D28): an Occurrence whose current status came from a connector is
 * excluded, so the patterns stay the user's own marking times. */
export function resolveCompletionTiming(input: Readonly<{
  behaviorId: string;
  occurrences: readonly CompletionTimingOccurrence[];
  timezone: string;
  now: Temporal.Instant;
  historyDays: number;
  complete: boolean;
  sourceAvailable: boolean;
  /** Occurrences whose current Completed status is a connector completion. */
  connectorMarkedOccurrenceIds?: ReadonlySet<string>;
}>): CompletionTimingSummary {
  if (!Number.isInteger(input.historyDays) || input.historyDays < 1 || input.historyDays > 90) {
    throw new RangeError("Completion timing history must span 1 to 90 days.");
  }
  const today = input.now.toZonedDateTimeISO(input.timezone).toPlainDate();
  const start = today.subtract({ days: input.historyDays }).toString();
  const end = today.toString();
  const exclusions = { notCompleted: 0, outsideWindow: 0, missingMark: 0, invalidMark: 0, futureMark: 0, duplicateOccurrence: 0 };
  const empty = { sampleCount: 0, sampledDayCount: 0, delayedMarkCount: 0, typicalMarkedTime: null, range: null, exclusions };
  if (!input.complete) return { ...empty, reason: "history_limit_exceeded" };
  if (!input.sourceAvailable) return { ...empty, reason: "source_unavailable" };
  const seen = new Set<string>();
  const days = new Set<string>();
  const minutes: number[] = [];
  let delayedMarkCount = 0;
  for (const occurrence of input.occurrences) {
    if (occurrence.behaviorId !== input.behaviorId) continue;
    if (seen.has(occurrence.id)) { exclusions.duplicateOccurrence++; continue; }
    seen.add(occurrence.id);
    if (occurrence.status !== "completed") { exclusions.notCompleted++; continue; }
    // A connector completion carries no user marking time; the frozen exclusion
    // shape (advisor day context) counts it as a missing mark.
    if (input.connectorMarkedOccurrenceIds?.has(occurrence.id)) { exclusions.missingMark++; continue; }
    if (occurrence.localDate < start || occurrence.localDate >= end) { exclusions.outsideWindow++; continue; }
    if (!occurrence.statusMarkedAt) { exclusions.missingMark++; continue; }
    let mark: Temporal.Instant;
    try { mark = Temporal.Instant.from(occurrence.statusMarkedAt); }
    catch { exclusions.invalidMark++; continue; }
    if (Temporal.Instant.compare(mark, input.now) > 0) { exclusions.futureMark++; continue; }
    const local = mark.toZonedDateTimeISO(input.timezone);
    const date = local.toPlainDate().toString();
    if (date < start || date >= end) { exclusions.outsideWindow++; continue; }
    days.add(date);
    minutes.push(local.hour * 60 + local.minute);
    if (date > occurrence.localDate) delayedMarkCount++;
  }
  const result = { ...empty, sampleCount: minutes.length, sampledDayCount: days.size, delayedMarkCount };
  // Three separate marking days prevent one batch of delayed logging from defining a routine.
  if (minutes.length < 3 || days.size < 3) return { ...result, reason: "insufficient_samples" };
  minutes.sort((a, b) => a - b);
  // Cut the clock at its largest empty arc, so 23:55 and 00:05 remain neighbors.
  let cut = 0;
  let largestGap = -1;
  for (let index = 0; index < minutes.length; index++) {
    const gap = (index + 1 < minutes.length ? minutes[index + 1] : minutes[0] + 1440) - minutes[index];
    if (gap > largestGap) { largestGap = gap; cut = (index + 1) % minutes.length; }
  }
  const unwrapped = [...minutes.slice(cut), ...minutes.slice(0, cut).map(minute => minute + 1440)];
  // ponytail: one three-hour cluster; add multimodal summaries when a recipe needs separate routines.
  if (1440 - largestGap > 180) return { ...result, reason: "dispersed_times" };
  const middle = Math.floor(unwrapped.length / 2);
  const median = unwrapped.length % 2 ? unwrapped[middle] : (unwrapped[middle - 1] + unwrapped[middle]) / 2;
  return {
    ...result,
    typicalMarkedTime: clockTime(median),
    range: { startTime: clockTime(unwrapped[0]), endTime: clockTime(unwrapped.at(-1)!), spansMidnight: unwrapped.at(-1)! >= 1440 },
    reason: null,
  };
}

function clockTime(minute: number): string {
  const rounded = Math.round(minute) % 1440;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}
