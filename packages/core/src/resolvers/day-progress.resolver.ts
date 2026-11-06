import { Temporal } from "@js-temporal/polyfill";
import type { TravelOccupiedSegment } from "../types/travel";
import type { DepartureState, DepartureTrip } from "../types/departure";

import type {
  DayProgressDayGeometry,
  DayProgressDayLayout,
  DayProgressIconOverflowGroup,
  DayProgressLayout,
  DayProgressNextTripInput,
  DayProgressNextTripMarks,
  DayProgressPositionAnchor,
  DayProgressTimedEventSpan,
  NormalizedExternalEvent,
  NormalizedTimedExternalEvent,
} from "../types/day-progress";

export const DAY_PROGRESS_MAX_ICON_LANES = 1;
export const DAY_PROGRESS_DEFAULT_ICON_SPACING = 44;

/** Ticket 270: trip states with a leave time worth marking. Steps the user must take have none. */
const NEXT_TRIP_MARKED_STATES: ReadonlySet<DepartureState> = new Set(["upcoming", "soon", "leave_now", "late", "head_home"]);

/**
 * Ticket 270 (D2, "Next trip only"; D13): the next trip's marks, or null. Only a trip with a leave
 * time and an arrival gets them; a last estimate keeps them (D1). The span starts at the leave
 * time and ends at the arrival.
 */
export function resolveNextTripMarkInput(
  next: Pick<DepartureTrip, "key" | "legId" | "state" | "leaveAt" | "arriveAt"> | null | undefined,
): DayProgressNextTripInput | null {
  if (!next || !NEXT_TRIP_MARKED_STATES.has(next.state) || !next.leaveAt || !next.arriveAt) return null;
  const leaveAt = Temporal.Instant.from(next.leaveAt);
  const arriveAt = Temporal.Instant.from(next.arriveAt);
  if (Temporal.Instant.compare(arriveAt, leaveAt) <= 0) return null;
  return { key: next.key, legId: next.legId, leaveAt: leaveAt.toString(), arriveAt: arriveAt.toString() };
}

/** Ticket 270: a Behavior is crowded by the next trip when that trip's leg created its travel overlap. */
export function nextTripCrowdsBehavior(
  context: Readonly<{ travelOverlapLegIds?: readonly string[] }> | undefined,
  trip: DayProgressNextTripInput | null,
): boolean {
  return !!trip?.legId && !!context?.travelOverlapLegIds?.includes(trip.legId);
}

export function resolveDayProgressLayout(input: Readonly<{
  timezone: string;
  days: DayProgressDayGeometry[];
  /** Shared range origin when days are measured in separate UI components. */
  firstVisibleDate?: string;
  events?: NormalizedExternalEvent[];
  travelSegments?: readonly TravelOccupiedSegment[];
  now?: Temporal.Instant;
  minIconSpacing?: number;
  maxIconLanes?: 1 | 2;
  /** Ticket 270: the next trip, from `resolveNextTripMarkInput`. */
  nextTrip?: DayProgressNextTripInput | null;
  /**
   * Ticket 270 (D13): the leader label's height. With `avoidIcons`, the label and the Calendar
   * markers share the rail (narrow layouts), so the label moves clear of them.
   */
  nextTripLabel?: Readonly<{ height: number; avoidIcons: boolean }>;
}>): DayProgressLayout {
  validateTimezone(input.timezone);
  const minIconSpacing = input.minIconSpacing ?? DAY_PROGRESS_DEFAULT_ICON_SPACING;
  const maxIconLanes = input.maxIconLanes ?? DAY_PROGRESS_MAX_ICON_LANES;

  if (!Number.isFinite(minIconSpacing) || minIconSpacing < DAY_PROGRESS_DEFAULT_ICON_SPACING) {
    throw new Error("Day-progress icon spacing must be at least 44 pixels.");
  }
  if (maxIconLanes !== 1 && maxIconLanes !== 2) {
    throw new Error("Day-progress icon lanes must be one or two.");
  }

  const firstVisibleDate = input.firstVisibleDate ?? input.days[0]?.localDate;
  if (firstVisibleDate) parseDate(firstVisibleDate, "First visible date");
  if (firstVisibleDate && input.days[0] && Temporal.PlainDate.compare(firstVisibleDate, input.days[0].localDate) > 0) {
    throw new Error("First visible date cannot follow the measured days.");
  }

  const eventIds = new Set<string>();
  for (const event of input.events ?? []) {
    if (!event.id || eventIds.has(event.id)) {
      throw new Error("External event ids must be non-empty and unique.");
    }
    eventIds.add(event.id);
    validateEvent(event);
  }

  const localDates = new Set<string>();
  const occurrenceIds = new Set<string>();
  let previousDate: Temporal.PlainDate | null = null;
  let previousBottom: number | null = null;
  const days = input.days.map((day) => {
    if (localDates.has(day.localDate)) {
      throw new Error("Day-progress local dates must be unique.");
    }
    localDates.add(day.localDate);
    const date = parseDate(day.localDate, "Day-progress local date");
    if (
      previousDate &&
      (!date.equals(previousDate.add({ days: 1 })) || day.top < previousBottom!)
    ) {
      throw new Error("Day-progress days must be consecutive with non-overlapping geometry.");
    }
    for (const row of day.rows) {
      if (occurrenceIds.has(row.occurrenceId)) {
        throw new Error("Day-progress occurrence ids must be unique across days.");
      }
      occurrenceIds.add(row.occurrenceId);
    }
    previousDate = date;
    previousBottom = day.bottom;
    return resolveDay(
      day,
      input.timezone,
      input.events ?? [],
      input.now,
      minIconSpacing,
      day.localDate === firstVisibleDate,
      input.travelSegments ?? [],
      input.nextTrip ?? null,
      input.nextTripLabel ?? null,
    );
  });

  return { timezone: input.timezone, days };
}

function resolveDay(
  day: DayProgressDayGeometry,
  timezone: string,
  events: NormalizedExternalEvent[],
  now: Temporal.Instant | undefined,
  minIconSpacing: number,
  includeContinuingMarkers: boolean,
  travelSegments: readonly TravelOccupiedSegment[],
  nextTrip: DayProgressNextTripInput | null,
  nextTripLabel: Readonly<{ height: number; avoidIcons: boolean }> | null,
): DayProgressDayLayout {
  validateGeometry(day);
  const date = parseDate(day.localDate, "Day-progress local date");
  const dayStart = date.toZonedDateTime(timezone).toInstant();
  const dayEnd = date.add({ days: 1 }).toZonedDateTime(timezone).toInstant();
  const rowInstants = day.rows.map((row) => parseInstant(row.scheduledFor, "row scheduled_for"));

  for (let index = 0; index < day.rows.length; index += 1) {
    const instant = rowInstants[index]!;
    if (
      Temporal.Instant.compare(instant, dayStart) < 0 ||
      Temporal.Instant.compare(instant, dayEnd) >= 0
    ) {
      throw new Error("Day-progress rows must fall inside their local day.");
    }
    if (index > 0 && Temporal.Instant.compare(rowInstants[index - 1]!, instant) > 0) {
      throw new Error("Day-progress rows must be chronological.");
    }
  }

  const midnightRow = rowInstants[0] && Temporal.Instant.compare(rowInstants[0], dayStart) === 0
    ? day.rows[0]!
    : null;
  const positionAnchors: DayProgressPositionAnchor[] = [{
    kind: "day_start",
    actualAt: dayStart.toString(),
    position: midnightRow?.center ?? day.top,
    occurrenceId: midnightRow?.occurrenceId ?? null,
  }];
  for (let index = 0; index < day.rows.length; index += 1) {
    if (Temporal.Instant.compare(rowInstants[index]!, dayStart) === 0) {
      continue;
    }
    if (index > 0 && Temporal.Instant.compare(rowInstants[index - 1]!, rowInstants[index]!) === 0) {
      continue;
    }
    const row = day.rows[index]!;
    positionAnchors.push({
      kind: "row",
      actualAt: rowInstants[index]!.toString(),
      position: row.center,
      occurrenceId: row.occurrenceId,
    });
  }
  positionAnchors.push({
    kind: "day_end",
    actualAt: dayEnd.toString(),
    position: day.bottom,
    occurrenceId: null,
  });

  const mapPosition = createPositionMapper(positionAnchors);
  const rowLayouts = day.rows.map((row, index) => {
    const actualAt = rowInstants[index]!;
    const mapped = mapPosition(actualAt);
    return {
      occurrenceId: row.occurrenceId,
      actualAt: actualAt.toString(),
      actualPosition: mapped,
      displayPosition: row.center,
      displacement: row.center - mapped,
    };
  });
  const sameTimeBrackets = rowInstants.flatMap((instant, index) => {
    if (index > 0 && Temporal.Instant.compare(rowInstants[index - 1]!, instant) === 0) {
      return [];
    }
    let end = index + 1;
    while (end < rowInstants.length && Temporal.Instant.compare(rowInstants[end]!, instant) === 0) {
      end += 1;
    }
    if (end - index < 2) return [];
    return [{
      actualAt: instant.toString(),
      anchorOccurrenceId: day.rows[index]!.occurrenceId,
      peerOccurrenceIds: day.rows.slice(index + 1, end).map((row) => row.occurrenceId),
      top: day.rows[index]!.center,
      bottom: day.rows[end - 1]!.center,
    }];
  });

  const rawSpans = events.flatMap((event) =>
    event.kind === "timed"
      ? clipTimedEvent(event, dayStart, dayEnd, mapPosition)
      : [],
  ).sort((left, right) =>
    left.startPosition - right.startPosition ||
    Temporal.Instant.compare(left.actualStart, right.actualStart) ||
    left.eventId.localeCompare(right.eventId)
  );
  const {
    spans: timedEventSpans,
    groups: iconOverflowGroups,
    requiredHeight: requiredIconHeight,
    overflow: iconLayoutOverflow,
  } = assignIconPositions(
    rawSpans.filter((span) => !span.continuesBefore || includeContinuingMarkers),
    minIconSpacing,
    day.localDate,
    day.top,
    day.bottom,
  );
  const allDayEventIds = events
    .filter((event) =>
      event.kind === "all_day" &&
      Temporal.PlainDate.compare(parseDate(event.startLocalDate, "all-day start date"), date) <= 0 &&
      Temporal.PlainDate.compare(date, parseDate(event.endLocalDate, "all-day end date")) < 0,
    )
    .map((event) => event.id)
    .sort();
  const movingDot = now && Temporal.Instant.compare(now, dayStart) >= 0 && Temporal.Instant.compare(now, dayEnd) < 0
    ? {
        actualAt: now.toString(),
        actualPosition: mapPosition(now),
        displayPosition: mapPosition(now),
        displacement: 0,
      }
    : null;

  const markersById = new Map(timedEventSpans.map((span) => [span.eventId, span]));
  return {
    localDate: day.localDate,
    dayStart: dayStart.toString(),
    dayEnd: dayEnd.toString(),
    top: day.top,
    bottom: day.bottom,
    positionAnchors,
    rowLayouts,
    sameTimeBrackets,
    movingDot,
    timedEventSpans: rawSpans.map((span) => markersById.get(span.eventId) ?? span),
    travelSpans: travelSegments.flatMap((segment) => {
      const start = parseInstant(segment.startAt, "Travel segment start");
      const end = parseInstant(segment.endAt, "Travel segment end");
      if (Temporal.Instant.compare(start, end) >= 0) throw new Error("Travel segments must have positive duration.");
      if (Temporal.Instant.compare(start, dayEnd) >= 0 || Temporal.Instant.compare(end, dayStart) <= 0) return [];
      return [{ segmentId: segment.id, sourceRefs: segment.sourceRefs,
        startPosition: mapPosition(Temporal.Instant.compare(start, dayStart) < 0 ? dayStart : start),
        endPosition: mapPosition(Temporal.Instant.compare(end, dayEnd) > 0 ? dayEnd : end) }];
    }),
    requiredIconHeight,
    iconLayoutOverflow,
    allDayEventIds,
    iconOverflowGroups,
    nextTrip: resolveNextTripMarks(nextTrip, dayStart, dayEnd, mapPosition, day,
      nextTripLabel, [...timedEventSpans.filter((span) => span.iconLane !== null && !span.overflowGroupId).map((span) => span.iconPosition),
        ...iconOverflowGroups.map((group) => group.position)], minIconSpacing),
  };
}

function resolveNextTripMarks(
  trip: DayProgressNextTripInput | null,
  dayStart: Temporal.Instant,
  dayEnd: Temporal.Instant,
  mapPosition: (instant: Temporal.Instant) => number,
  day: DayProgressDayGeometry,
  label: Readonly<{ height: number; avoidIcons: boolean }> | null,
  iconPositions: readonly number[],
  iconSpacing: number,
): DayProgressNextTripMarks | null {
  if (!trip) return null;
  const leave = parseInstant(trip.leaveAt, "Next trip leave time");
  const end = parseInstant(trip.arriveAt, "Next trip arrival");
  if (Temporal.Instant.compare(end, leave) <= 0) throw new Error("The next trip must leave before it arrives.");
  if (Temporal.Instant.compare(leave, dayEnd) >= 0 || Temporal.Instant.compare(end, dayStart) <= 0) return null;
  const leaveToday = Temporal.Instant.compare(leave, dayStart) >= 0;
  const leavePosition = leaveToday ? mapPosition(leave) : null;
  return {
    key: trip.key,
    startPosition: leavePosition ?? mapPosition(dayStart),
    endPosition: mapPosition(Temporal.Instant.compare(end, dayEnd) > 0 ? dayEnd : end),
    leavePosition,
    labelPosition: leavePosition === null ? null
      : label ? placeRailLabel(leavePosition, label.height, label.avoidIcons ? iconPositions : [], iconSpacing, day.top, day.bottom) : leavePosition,
  };
}

/**
 * The nearest position to `target` where a label of `height` clears every Calendar marker (each
 * `spacing` tall) and stays inside the day. Without a clear position, the target.
 */
function placeRailLabel(target: number, height: number, icons: readonly number[], spacing: number, top: number, bottom: number): number {
  if (!Number.isFinite(height) || height <= 0) throw new Error("The rail label height must be positive.");
  const reach = height / 2 + spacing / 2;
  const clear = (position: number) => position - height / 2 >= top && position + height / 2 <= bottom &&
    icons.every((icon) => Math.abs(icon - position) >= reach);
  if (clear(target)) return target;
  const candidates = icons.flatMap((icon) => [icon - reach, icon + reach]).filter(clear)
    .sort((left, right) => Math.abs(left - target) - Math.abs(right - target) || left - right);
  return candidates[0] ?? target;
}

function clipTimedEvent(
  event: NormalizedTimedExternalEvent,
  dayStart: Temporal.Instant,
  dayEnd: Temporal.Instant,
  mapPosition: (instant: Temporal.Instant) => number,
): DayProgressTimedEventSpan[] {
  const start = Temporal.Instant.from(event.startAt);
  const end = Temporal.Instant.from(event.endAt);
  if (event.endUnspecified) {
    if (Temporal.Instant.compare(start, dayStart) < 0 || Temporal.Instant.compare(start, dayEnd) >= 0) {
      return [];
    }
    return [{
      eventId: event.id,
      actualStart: start.toString(),
      actualEnd: null,
      clippedStart: start.toString(),
      clippedEnd: null,
      startPosition: mapPosition(start),
      iconPosition: mapPosition(start),
      endPosition: null,
      endUnspecified: true,
      continuesBefore: false,
      continuesAfter: false,
      iconLane: null,
      overflowGroupId: null,
    }];
  }
  if (Temporal.Instant.compare(start, dayEnd) >= 0 || Temporal.Instant.compare(end, dayStart) <= 0) {
    return [];
  }
  const clippedStart = Temporal.Instant.compare(start, dayStart) < 0 ? dayStart : start;
  const clippedEnd = Temporal.Instant.compare(end, dayEnd) > 0 ? dayEnd : end;
  return [{
    eventId: event.id,
    actualStart: start.toString(),
    actualEnd: end.toString(),
    clippedStart: clippedStart.toString(),
    clippedEnd: clippedEnd.toString(),
    startPosition: mapPosition(clippedStart),
    iconPosition: mapPosition(clippedStart),
    endPosition: mapPosition(clippedEnd),
    endUnspecified: false,
    continuesBefore: Temporal.Instant.compare(start, dayStart) < 0,
    continuesAfter: Temporal.Instant.compare(end, dayEnd) > 0,
    iconLane: null,
    overflowGroupId: null,
  }];
}

function assignIconPositions(
  spans: DayProgressTimedEventSpan[],
  minSpacing: number,
  localDate: string,
  top: number,
  bottom: number,
): {
  spans: DayProgressTimedEventSpan[];
  groups: DayProgressIconOverflowGroup[];
  requiredHeight: number;
  overflow: boolean;
} {
  const groups: DayProgressIconOverflowGroup[] = [];
  const exactStartGroups: DayProgressTimedEventSpan[][] = [];
  for (const span of spans) {
    const group = exactStartGroups.at(-1);
    if (group && group[0]!.actualStart === span.actualStart) group.push(span);
    else exactStartGroups.push([span]);
  }
  const requiredHeight = exactStartGroups.length === 0
    ? 0
    : (exactStartGroups.length + 1) * minSpacing;
  const overflow = requiredHeight > bottom - top;
  const positions = overflow
    ? exactStartGroups.map((_, index) => top + minSpacing * (index + 1))
    : packIconPositions(
        exactStartGroups.map((group) => group[0]!.startPosition),
        minSpacing,
        top + minSpacing,
        bottom - minSpacing,
      );
  const output: DayProgressTimedEventSpan[] = [];
  exactStartGroups.forEach((group, index) => {
    const position = positions[index]!;
    if (group.length === 1) {
      output.push({ ...group[0]!, iconPosition: position, iconLane: 0 });
      return;
    }
    const groupId = `exact-start-${localDate}-${groups.length + 1}`;
    groups.push({
      id: groupId,
      position,
      iconLane: 0,
      eventIds: group.map((span) => span.eventId),
      count: group.length,
    });
    output.push(...group.map((span) => ({ ...span, iconPosition: position, overflowGroupId: groupId })));
  });
  return { spans: output, groups, requiredHeight, overflow };
}

function packIconPositions(
  targets: number[],
  minSpacing: number,
  lower: number,
  upper: number,
): number[] {
  const blocks: Array<{ start: number; end: number; mean: number }> = [];
  for (let index = 0; index < targets.length; index += 1) {
    blocks.push({ start: index, end: index, mean: targets[index]! - index * minSpacing });
    while (blocks.length > 1 && blocks.at(-2)!.mean > blocks.at(-1)!.mean) {
      const right = blocks.pop()!;
      const left = blocks.pop()!;
      const leftCount = left.end - left.start + 1;
      const rightCount = right.end - right.start + 1;
      blocks.push({
        start: left.start,
        end: right.end,
        mean: (left.mean * leftCount + right.mean * rightCount) / (leftCount + rightCount),
      });
    }
  }
  const maxBase = upper - Math.max(0, targets.length - 1) * minSpacing;
  const positions = Array<number>(targets.length);
  for (const block of blocks) {
    const base = Math.min(maxBase, Math.max(lower, block.mean));
    for (let index = block.start; index <= block.end; index += 1) {
      positions[index] = base + index * minSpacing;
    }
  }
  return positions;
}

function createPositionMapper(anchors: DayProgressPositionAnchor[]): (instant: Temporal.Instant) => number {
  return (instant) => {
    for (let index = 1; index < anchors.length; index += 1) {
      const right = anchors[index]!;
      const rightInstant = Temporal.Instant.from(right.actualAt);
      if (Temporal.Instant.compare(instant, rightInstant) <= 0) {
        const left = anchors[index - 1]!;
        return interpolateInstant(
          instant,
          Temporal.Instant.from(left.actualAt),
          rightInstant,
          left.position,
          right.position,
        );
      }
    }
    return anchors.at(-1)!.position;
  };
}

function interpolateInstant(
  instant: Temporal.Instant,
  start: Temporal.Instant,
  end: Temporal.Instant,
  startPosition: number,
  endPosition: number,
): number {
  const duration = start.until(end).total({ unit: "milliseconds" });
  const elapsed = start.until(instant).total({ unit: "milliseconds" });
  return startPosition + (endPosition - startPosition) * (elapsed / duration);
}

function validateGeometry(day: DayProgressDayGeometry): void {
  if (!Number.isFinite(day.top) || !Number.isFinite(day.bottom) || day.bottom <= day.top) {
    throw new Error("Day-progress geometry requires finite top and bottom positions.");
  }
  const ids = new Set<string>();
  for (let index = 0; index < day.rows.length; index += 1) {
    const row = day.rows[index]!;
    if (!row.occurrenceId || ids.has(row.occurrenceId)) {
      throw new Error("Day-progress occurrence ids must be non-empty and unique per day.");
    }
    ids.add(row.occurrenceId);
    if (!Number.isFinite(row.center) || row.center < day.top || row.center > day.bottom) {
      throw new Error("Day-progress row centers must fall within the day geometry.");
    }
    if (index > 0 && row.center < day.rows[index - 1]!.center) {
      throw new Error("Day-progress row centers must be nondecreasing.");
    }
  }
}

function validateEvent(event: NormalizedExternalEvent): void {
  if (event.attachments && event.attachments.length > 25) {
    throw new Error("External events cannot contain more than 25 attachments.");
  }
  if (event.kind === "timed") {
    const start = parseInstant(event.startAt, "external event start");
    const end = parseInstant(event.endAt, "external event end");
    if (Temporal.Instant.compare(end, start) <= 0) {
      throw new Error("Timed external events must end after they start.");
    }
    return;
  }
  const start = parseDate(event.startLocalDate, "all-day start date");
  const end = parseDate(event.endLocalDate, "all-day end date");
  if (Temporal.PlainDate.compare(end, start) <= 0) {
    throw new Error("All-day external events must have an exclusive end after their start.");
  }
}

function validateTimezone(timezone: string): void {
  try {
    Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(timezone);
  } catch {
    throw new Error("Day-progress timezone is invalid.");
  }
}

function parseInstant(value: string, field: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`${field} is invalid.`);
  }
}

function parseDate(value: string, field: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    throw new Error(`${field} is invalid.`);
  }
}
