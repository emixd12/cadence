import { Temporal } from "@js-temporal/polyfill";

import { isConnectorStatusEvent } from "../resolvers/status.resolver";
import type { TimelineOccurrenceView, TimelineSourceEvidence, TimelineView } from "../types/timeline";

/**
 * Ticket 317 (web) and Ticket 319 (Mac): what a connected service contributed to a
 * Timeline row. "From <source>" shows only while the connector's own status event is
 * the Occurrence's latest and the Occurrence is Completed. Attached workouts are
 * listed whoever marked the row. A linked Mac passes the matches it received through
 * account sync contract 5 (Ticket 320); a Mac in local mode has none.
 */

export const CONNECTOR_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({ hevy: "Hevy" });

export type SourceEvidenceStatusEvent = Readonly<{
  statusSemantics?: string | null;
  sourceCaptureMethod?: string | null;
  reasonCode?: string | null;
}>;

export type SourceEvidenceMatch = Readonly<{
  occurrenceId: string;
  source: string;
  state: string;
  activityStartAt: string;
  activityEndAt: string;
}>;

export function resolveTimelineSourceEvidence(input: Readonly<{
  timezone: string;
  occurrences: readonly Readonly<{ id: string; status: string }>[];
  latestEvents: ReadonlyMap<string, SourceEvidenceStatusEvent>;
  matches: readonly SourceEvidenceMatch[];
}>): Record<string, TimelineSourceEvidence> {
  const result: Record<string, TimelineSourceEvidence> = {};
  for (const occurrence of input.occurrences) {
    const latest = input.latestEvents.get(occurrence.id);
    const fromConnector = occurrence.status === "completed" && latest !== undefined && isConnectorStatusEvent(latest);
    const active = input.matches
      .filter((match) => match.occurrenceId === occurrence.id && match.state === "active")
      .sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.activityStartAt), Temporal.Instant.from(right.activityStartAt)));
    if (!fromConnector && active.length === 0) continue;
    const source = fromConnector ? latest!.reasonCode!.slice("connector:".length) : active[0].source;
    result[occurrence.id] = {
      source,
      sourceLabel: CONNECTOR_SOURCE_LABELS[source] ?? "a connected service",
      fromConnector,
      workouts: active.map((match) => ({
        startAt: match.activityStartAt,
        endAt: match.activityEndAt,
        label: `${clockLabel(match.activityStartAt, input.timezone)}–${clockLabel(match.activityEndAt, input.timezone)}`,
      })),
    };
  }
  return result;
}

/** The collapsed-row line: "From Hevy", or "From Hevy · 2 workouts". Null for a row the user marked. */
export function sourceEvidenceSummary(evidence: TimelineSourceEvidence | undefined, status: string): string | null {
  if (!evidence?.fromConnector || status !== "completed") return null;
  return evidence.workouts.length > 1
    ? `From ${evidence.sourceLabel} · ${evidence.workouts.length} workouts`
    : `From ${evidence.sourceLabel}`;
}

export function attachTimelineSourceEvidence<T extends TimelineView>(view: T, byId: Readonly<Record<string, TimelineSourceEvidence>>): T {
  if (Object.keys(byId).length === 0) return view;
  const occurrence = (item: TimelineOccurrenceView): TimelineOccurrenceView =>
    byId[item.id] ? { ...item, sourceEvidence: byId[item.id] } : item;
  const section = (value: TimelineView["daySections"][number]) => ({
    ...value,
    occurrences: value.occurrences.map(occurrence),
    occurrenceGroups: value.occurrenceGroups.map((group) => ({ ...group, occurrences: group.occurrences.map(occurrence) })),
  });
  return {
    ...view,
    daySections: view.daySections.map(section),
    needsDecision: { ...view.needsDecision, daySections: view.needsDecision.daySections.map(section) },
  };
}

/** Ticket 324: one workout a row may count by hand. */
export type CountableSourceWorkout = Readonly<{
  activityRef: string;
  startAt: string;
  endAt: string;
  /** "Count the 6:05 PM Hevy workout". */
  label: string;
}>;

/**
 * Ticket 324: the workouts an Unresolved row of today may count by hand. A workout
 * counts only once it has ended and lasted the source's minimum, and only when no
 * Occurrence in view already shows it (a link matched it). The server checks again.
 */
export function countableSourceWorkouts(input: Readonly<{
  occurrence: Readonly<{ status: string; localDate: string; sourceCountable?: readonly string[] }>;
  source: string;
  todayLocalDate: string;
  now: Temporal.Instant;
  timezone: string;
  minimumDurationSeconds: number;
  items: readonly Readonly<{ id: string; startAt: string; endAt: string; durationSeconds: number }>[];
  /** Start instants of every workout already shown on a row in view. */
  matchedStartAts: ReadonlySet<string>;
}>): CountableSourceWorkout[] {
  const { occurrence } = input;
  if (occurrence.status !== "unresolved" || occurrence.localDate !== input.todayLocalDate
    || !occurrence.sourceCountable?.includes(input.source)) return [];
  const label = CONNECTOR_SOURCE_LABELS[input.source] ?? "connected";
  return input.items
    .filter((item) => item.durationSeconds >= input.minimumDurationSeconds
      && Temporal.Instant.compare(Temporal.Instant.from(item.endAt), input.now) <= 0
      && Temporal.Instant.from(item.startAt).toZonedDateTimeISO(input.timezone).toPlainDate().toString() === input.todayLocalDate
      && !input.matchedStartAts.has(Temporal.Instant.from(item.startAt).toString()))
    .sort((left, right) => Temporal.Instant.compare(Temporal.Instant.from(left.startAt), Temporal.Instant.from(right.startAt)))
    .map((item) => ({
      activityRef: item.id,
      startAt: item.startAt,
      endAt: item.endAt,
      label: `Count the ${clockLabel(item.startAt, input.timezone)} ${label} workout`,
    }));
}

/** Ticket 324: marks the rows that may count a source's workouts by hand. */
export function attachTimelineSourceCountable<T extends TimelineView>(view: T, byId: Readonly<Record<string, readonly string[]>>): T {
  if (Object.keys(byId).length === 0) return view;
  const occurrence = (item: TimelineOccurrenceView): TimelineOccurrenceView =>
    byId[item.id] ? { ...item, sourceCountable: byId[item.id] } : item;
  const section = (value: TimelineView["daySections"][number]) => ({
    ...value,
    occurrences: value.occurrences.map(occurrence),
    occurrenceGroups: value.occurrenceGroups.map((group) => ({ ...group, occurrences: group.occurrences.map(occurrence) })),
  });
  return { ...view, daySections: view.daySections.map(section) };
}

function clockLabel(instant: string, timezone: string): string {
  const time = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
  const hour = time.hour % 12 === 0 ? 12 : time.hour % 12;
  return `${hour}:${String(time.minute).padStart(2, "0")} ${time.hour < 12 ? "AM" : "PM"}`;
}
