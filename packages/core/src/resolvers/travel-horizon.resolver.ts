import { Temporal } from "@js-temporal/polyfill";
import { sha256 } from "../hash";
import { localDateAt, localDayBounds, zonedInstant } from "./time.resolver";
import type { TravelMode } from "../types/travel";
import {
  CHAT_TRAVEL_MODEL_VERSION,
  type ChatTravelBehaviorFit,
  type ChatTravelDayFitConclusion,
  type ChatTravelDaypartBucket,
  type ChatTravelFreeWindowBucket,
  type ChatTravelHorizonResult,
  type ChatTravelUiCard,
  type CrossDayRescheduleCandidate,
} from "../types/chat-travel";

const MAX_HORIZON_DAYS = 7;
const TIGHT_MARGIN_SECONDS = 15 * 60;
const HEAVY_TRAVEL_MINUTES_THRESHOLD = 90;

const DAYPART_BUCKETS: readonly Readonly<{
  bucket: ChatTravelDaypartBucket;
  label: string;
  startWallTime: string;
  endWallTime: string;
}>[] = [
  { bucket: "early_morning", label: "Early morning", startWallTime: "05:00", endWallTime: "08:00" },
  { bucket: "morning", label: "Morning", startWallTime: "08:00", endWallTime: "12:00" },
  { bucket: "midday", label: "Midday", startWallTime: "12:00", endWallTime: "14:00" },
  { bucket: "afternoon", label: "Afternoon", startWallTime: "14:00", endWallTime: "17:00" },
  { bucket: "evening", label: "Evening", startWallTime: "17:00", endWallTime: "20:00" },
  { bucket: "late_evening", label: "Late evening", startWallTime: "20:00", endWallTime: "22:00" },
];

export type ChatTravelHorizonTripInput = Readonly<{
  localDate: string;
  tripLabel: string;
  destinationLabel: string;
  mode: TravelMode;
  /** ISO instant when the user should depart; null when travel estimate is unavailable. */
  departureAt: string | null;
  /** ISO instant when the user arrives; null when travel estimate is unavailable. */
  arrivalAt: string | null;
  /** Route duration in seconds; null when unavailable. */
  durationSeconds: number | null;
  /** Total buffer minutes (preparation + arrival/exit/settling). */
  bufferMinutes: number;
  late?: boolean;
}>;

export type ChatTravelHorizonOccurrenceInput = Readonly<{
  occurrenceRef: string;
  behaviorId: string;
  localDate: string;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  flexible: boolean;
}>;

export type ChatTravelHorizonInput = Readonly<{
  now: Temporal.Instant | string;
  timezone: string;
  todayLocalDate?: string;
  horizonDays?: number;
  trips: readonly ChatTravelHorizonTripInput[];
  occurrences: readonly ChatTravelHorizonOccurrenceInput[];
}>;

type TimeInterval = Readonly<{ startEpochSeconds: number; endEpochSeconds: number }>;

function toInstant(value: Temporal.Instant | string): Temporal.Instant {
  return typeof value === "string" ? Temporal.Instant.from(value) : value;
}

function toEpochSeconds(value: Temporal.Instant | string): number {
  return Math.floor(toInstant(value).epochMilliseconds / 1000);
}

function formatLocalHHMM(instantIso: string, timezone: string): string {
  const zdt = Temporal.Instant.from(instantIso).toZonedDateTimeISO(timezone);
  const hour = String(zdt.hour).padStart(2, "0");
  const minute = String(zdt.minute).padStart(2, "0");
  return `${hour}:${minute}`;
}

function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.startEpochSeconds < b.endEpochSeconds && b.startEpochSeconds < a.endEpochSeconds;
}

function minGapSeconds(a: TimeInterval, b: TimeInterval): number {
  if (intervalsOverlap(a, b)) return 0;
  if (a.endEpochSeconds <= b.startEpochSeconds) {
    return b.startEpochSeconds - a.endEpochSeconds;
  }
  return a.startEpochSeconds - b.endEpochSeconds;
}

/**
 * Evaluates today + up to 7-day lookahead for Cadence's hybrid Chat travel-organizing UI.
 *
 * Strictly enforces `docs/LEGAL.md` L-001:
 * - `modelSummary` contains only deterministic fit/conflict conclusions, heavy-travel flags,
 *   coarse daypart free-slot buckets, and cross-day shift candidates — ZERO route durations,
 *   distances, leave-by times, coordinates, or raw addresses.
 * - `uiCards` contains exact leave-by times and route durations for Cadence's inline UI cards.
 */
export function resolveChatTravelHorizon(input: ChatTravelHorizonInput): ChatTravelHorizonResult {
  const nowInstant = toInstant(input.now);
  const todayLocalDate = input.todayLocalDate
    ? Temporal.PlainDate.from(input.todayLocalDate).toString()
    : localDateAt(nowInstant, input.timezone);
  const requestedDays = input.horizonDays ?? MAX_HORIZON_DAYS;
  const horizonDays = Math.max(1, Math.min(MAX_HORIZON_DAYS, Math.trunc(requestedDays)));

  const startDate = Temporal.PlainDate.from(todayLocalDate);
  const horizonDates: string[] = [];
  for (let offset = 0; offset < horizonDays; offset += 1) {
    horizonDates.push(startDate.add({ days: offset }).toString());
  }

  const tripsByDate = new Map<string, ChatTravelHorizonTripInput[]>();
  for (const trip of input.trips) {
    const bucket = tripsByDate.get(trip.localDate) ?? [];
    bucket.push(trip);
    tripsByDate.set(trip.localDate, bucket);
  }

  const occurrencesByDate = new Map<string, ChatTravelHorizonOccurrenceInput[]>();
  for (const occ of input.occurrences) {
    const bucket = occurrencesByDate.get(occ.localDate) ?? [];
    bucket.push(occ);
    occurrencesByDate.set(occ.localDate, bucket);
  }

  const uiCards: ChatTravelUiCard[] = [];
  const prelimDays: Array<{
    localDate: string;
    heavyTravelDay: boolean;
    tripCount: number;
    hasUnknownTravel: boolean;
    behaviorFits: ChatTravelBehaviorFit[];
    freeWindows: ChatTravelFreeWindowBucket[];
  }> = [];

  for (const localDate of horizonDates) {
    const dayTrips = tripsByDate.get(localDate) ?? [];
    const dayOccurrences = occurrencesByDate.get(localDate) ?? [];
    const { start: dayStart, end: dayEnd } = localDayBounds(localDate, input.timezone);

    const occupiedTravelIntervals: Array<{ interval: TimeInterval; late: boolean }> = [];
    let hasUnknownTravel = false;
    let totalTravelAndBufferMinutes = 0;

    for (const trip of dayTrips) {
      if (trip.departureAt === null || trip.arrivalAt === null || trip.durationSeconds === null) {
        hasUnknownTravel = true;
        continue;
      }
      const depEpoch = toEpochSeconds(trip.departureAt);
      const arrEpoch = toEpochSeconds(trip.arrivalAt);
      const bufferSeconds = Math.max(0, Math.round(trip.bufferMinutes)) * 60;
      occupiedTravelIntervals.push({
        interval: {
          startEpochSeconds: depEpoch - bufferSeconds,
          endEpochSeconds: arrEpoch + bufferSeconds,
        },
        late: Boolean(trip.late),
      });
      totalTravelAndBufferMinutes += Math.round(trip.durationSeconds / 60) + Math.max(0, Math.round(trip.bufferMinutes));
    }

    const behaviorFits: ChatTravelBehaviorFit[] = [];
    const conflictedBehaviorIds = new Set<string>();

    for (const occ of dayOccurrences) {
      const startEpoch = toEpochSeconds(occ.startAt);
      let endEpoch: number | null = null;
      if (occ.endAt !== null) {
        endEpoch = toEpochSeconds(occ.endAt);
      } else if (occ.durationMinutes !== null && occ.durationMinutes > 0) {
        endEpoch = startEpoch + Math.round(occ.durationMinutes) * 60;
      }

      if (endEpoch === null || endEpoch <= startEpoch) {
        behaviorFits.push({
          occurrenceRef: occ.occurrenceRef,
          behaviorId: occ.behaviorId,
          status: "unknown",
          basis: "duration_unknown",
          flexible: occ.flexible,
        });
        continue;
      }

      const occInterval: TimeInterval = { startEpochSeconds: startEpoch, endEpochSeconds: endEpoch };
      let hasOverlap = false;
      let hasLateOverlap = false;
      let closestGap = Number.POSITIVE_INFINITY;

      for (const occupied of occupiedTravelIntervals) {
        if (intervalsOverlap(occInterval, occupied.interval)) {
          hasOverlap = true;
          if (occupied.late) hasLateOverlap = true;
        } else {
          const gap = minGapSeconds(occInterval, occupied.interval);
          if (gap < closestGap) closestGap = gap;
        }
      }

      if (hasOverlap) {
        conflictedBehaviorIds.add(occ.behaviorId);
        behaviorFits.push({
          occurrenceRef: occ.occurrenceRef,
          behaviorId: occ.behaviorId,
          status: "does_not_fit",
          basis: hasLateOverlap ? "late_arrival" : "travel_overlap",
          flexible: occ.flexible,
        });
      } else if (hasUnknownTravel && occupiedTravelIntervals.length === 0) {
        behaviorFits.push({
          occurrenceRef: occ.occurrenceRef,
          behaviorId: occ.behaviorId,
          status: "unknown",
          basis: "travel_unknown",
          flexible: occ.flexible,
        });
      } else if (closestGap < TIGHT_MARGIN_SECONDS) {
        behaviorFits.push({
          occurrenceRef: occ.occurrenceRef,
          behaviorId: occ.behaviorId,
          status: "tight",
          basis: "travel_known",
          flexible: occ.flexible,
        });
      } else {
        behaviorFits.push({
          occurrenceRef: occ.occurrenceRef,
          behaviorId: occ.behaviorId,
          status: "fits",
          basis: "travel_known",
          flexible: occ.flexible,
        });
      }
    }

    // Emit UI cards for trips with known route timing (never sent to LLM).
    for (const trip of dayTrips) {
      if (trip.departureAt === null || trip.arrivalAt === null || trip.durationSeconds === null) {
        continue;
      }
      const depEpoch = toEpochSeconds(trip.departureAt);
      const arrEpoch = toEpochSeconds(trip.arrivalAt);
      const bufferSeconds = Math.max(0, Math.round(trip.bufferMinutes)) * 60;
      const tripInterval: TimeInterval = {
        startEpochSeconds: depEpoch - bufferSeconds,
        endEpochSeconds: arrEpoch + bufferSeconds,
      };
      const overlappingOccCount = dayOccurrences.filter((occ) => {
        const s = toEpochSeconds(occ.startAt);
        const e = occ.endAt
          ? toEpochSeconds(occ.endAt)
          : occ.durationMinutes && occ.durationMinutes > 0
            ? s + Math.round(occ.durationMinutes) * 60
            : null;
        return e !== null && intervalsOverlap(tripInterval, { startEpochSeconds: s, endEpochSeconds: e });
      }).length;

      let conflictSummary: string | null = null;
      if (trip.late) {
        conflictSummary = "Estimated arrival is after target start time.";
      } else if (overlappingOccCount === 1) {
        conflictSummary = "Overlaps 1 scheduled Behavior.";
      } else if (overlappingOccCount > 1) {
        conflictSummary = `Overlaps ${overlappingOccCount} scheduled Behaviors.`;
      }

      uiCards.push({
        localDate,
        tripLabel: trip.tripLabel,
        destinationLabel: trip.destinationLabel,
        mode: trip.mode,
        leaveByLocalTime: formatLocalHHMM(trip.departureAt, input.timezone),
        durationMinutes: Math.max(0, Math.round(trip.durationSeconds / 60)),
        arrivalLocalTime: formatLocalHHMM(trip.arrivalAt, input.timezone),
        bufferMinutes: Math.max(0, Math.round(trip.bufferMinutes)),
        conflictSummary,
      });
    }

    // Coarse daypart free windows (never revealing exact route-derived minutes).
    const freeWindows: ChatTravelFreeWindowBucket[] = [];
    for (const part of DAYPART_BUCKETS) {
      const partStart = toEpochSeconds(zonedInstant(localDate, part.startWallTime, input.timezone));
      const partEnd = toEpochSeconds(zonedInstant(localDate, part.endWallTime, input.timezone));
      const clippedStart = Math.max(partStart, toEpochSeconds(dayStart));
      const clippedEnd = Math.min(partEnd, toEpochSeconds(dayEnd));
      if (clippedEnd <= clippedStart) continue;
      const partInterval: TimeInterval = { startEpochSeconds: clippedStart, endEpochSeconds: clippedEnd };
      const blockedByTravel = occupiedTravelIntervals.some((occupied) =>
        intervalsOverlap(partInterval, occupied.interval),
      );
      if (!blockedByTravel) {
        freeWindows.push({ bucket: part.bucket, label: part.label });
      }
    }

    const heavyTravelDay =
      dayTrips.length >= 2 ||
      totalTravelAndBufferMinutes >= HEAVY_TRAVEL_MINUTES_THRESHOLD ||
      conflictedBehaviorIds.size > 0;

    prelimDays.push({
      localDate,
      heavyTravelDay,
      tripCount: dayTrips.length,
      hasUnknownTravel,
      behaviorFits,
      freeWindows,
    });
  }

  // Cross-day shift candidates for flexible Behaviors on heavy/conflicting days.
  const allCrossDayCandidates: CrossDayRescheduleCandidate[] = [];
  const days: ChatTravelDayFitConclusion[] = prelimDays.map((day, dayIndex) => {
    const dayCandidates: CrossDayRescheduleCandidate[] = [];
    for (const fit of day.behaviorFits) {
      if (!fit.flexible) continue;
      const needsShift =
        fit.status === "does_not_fit" || (fit.status === "tight" && day.heavyTravelDay);
      if (!needsShift) continue;

      const targetDay = prelimDays.slice(dayIndex + 1).find(
        (candidate) =>
          !candidate.heavyTravelDay &&
          candidate.freeWindows.length > 0 &&
          !candidate.behaviorFits.some(
            (other) => other.behaviorId === fit.behaviorId && other.status === "does_not_fit",
          ),
      );
      if (!targetDay) continue;

      const candidate: CrossDayRescheduleCandidate = {
        occurrenceRef: fit.occurrenceRef,
        behaviorId: fit.behaviorId,
        fromLocalDate: day.localDate,
        suggestedLocalDate: targetDay.localDate,
        suggestedBucket: targetDay.freeWindows[0].bucket,
        reason:
          fit.status === "does_not_fit"
            ? "travel_conflict"
            : day.heavyTravelDay
              ? "heavy_travel_day"
              : "tight_schedule",
        requiresConfirmation: true,
      };
      dayCandidates.push(candidate);
      allCrossDayCandidates.push(candidate);
    }

    return {
      localDate: day.localDate,
      heavyTravelDay: day.heavyTravelDay,
      tripCount: day.tripCount,
      hasUnknownTravel: day.hasUnknownTravel,
      behaviorFits: day.behaviorFits,
      freeWindows: day.freeWindows,
      crossDayCandidates: dayCandidates,
    };
  });

  return {
    modelSummary: {
      version: CHAT_TRAVEL_MODEL_VERSION,
      todayLocalDate,
      horizonDays,
      days,
      crossDayCandidates: allCrossDayCandidates,
    },
    uiCards,
    horizonDays,
  };
}

export type TravelEventFingerprintInput = Readonly<{
  source: string;
  calendarId?: string | null;
  eventId: string;
  startAt: string;
  endAt: string | null;
  location?: string | null;
  status?: string | null;
  availability?: string | null;
}>;

function normalizeInstantOrText(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return Temporal.Instant.from(trimmed).toString();
  } catch {
    return trimmed;
  }
}

function normalizeToken(value: string | null | undefined, fallback = ""): string {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  return trimmed || fallback;
}

function normalizeLocationDigest(location: string | null | undefined): string {
  const normalized = (location ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "";
  return sha256(normalized);
}

/**
 * Builds a deterministic, etag-free revision fingerprint for a calendar event across
 * Google REST, Google Calendar MCP, Outlook, and iCloud.
 */
export function buildTravelEventRevisionFingerprint(event: TravelEventFingerprintInput): string {
  const payload = [
    normalizeToken(event.source),
    (event.calendarId ?? "").trim(),
    event.eventId.trim(),
    normalizeInstantOrText(event.startAt),
    normalizeInstantOrText(event.endAt),
    normalizeLocationDigest(event.location),
    normalizeToken(event.status, "confirmed"),
    normalizeToken(event.availability, "busy"),
  ].join("\0");
  return `evfp:v1:${sha256(payload)}`;
}

export type SuppliedTravelConclusionEventRef = Readonly<{
  eventKey: string;
  source: string;
  calendarId?: string | null;
  eventId: string;
  fingerprint: string;
}>;

export type TravelEventMatchCandidate = TravelEventFingerprintInput &
  Readonly<{
    ref: string;
  }>;

export type TravelConclusionMatchResult = Readonly<{
  matched: boolean;
  matchedCount: number;
  unmatchedKeys: readonly string[];
  changedKeys: readonly string[];
  matchedRefs: Readonly<Record<string, string>>;
}>;

function eventIdentityKey(source: string, calendarId: string | null | undefined, eventId: string): string {
  return `${normalizeToken(source)}\0${(calendarId ?? "").trim()}\0${eventId.trim()}`;
}

/**
 * Matches supplied travel conclusions against current calendar events using etag-free
 * deterministic revision fingerprints, so Google MCP, Outlook, and iCloud conclusions
 * remain valid when `etag` is absent.
 */
export function matchTravelConclusionsToEvents(
  conclusions: readonly SuppliedTravelConclusionEventRef[],
  events: readonly TravelEventMatchCandidate[],
): TravelConclusionMatchResult {
  const currentByIdentity = new Map<string, { ref: string; fingerprint: string }>();
  for (const event of events) {
    const idKey = eventIdentityKey(event.source, event.calendarId, event.eventId);
    currentByIdentity.set(idKey, {
      ref: event.ref,
      fingerprint: buildTravelEventRevisionFingerprint(event),
    });
  }

  const unmatchedKeys: string[] = [];
  const changedKeys: string[] = [];
  const matchedRefs: Record<string, string> = {};
  let matchedCount = 0;

  for (const conclusion of conclusions) {
    const idKey = eventIdentityKey(conclusion.source, conclusion.calendarId, conclusion.eventId);
    const current = currentByIdentity.get(idKey);
    if (!current) {
      unmatchedKeys.push(conclusion.eventKey);
      continue;
    }
    if (current.fingerprint !== conclusion.fingerprint) {
      changedKeys.push(conclusion.eventKey);
      continue;
    }
    matchedRefs[conclusion.eventKey] = current.ref;
    matchedCount += 1;
  }

  const matched =
    unmatchedKeys.length === 0 &&
    changedKeys.length === 0 &&
    matchedCount === conclusions.length;

  return {
    matched,
    matchedCount,
    unmatchedKeys,
    changedKeys,
    matchedRefs,
  };
}
