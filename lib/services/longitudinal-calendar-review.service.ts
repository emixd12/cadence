import { Temporal } from "@js-temporal/polyfill";
import { resolveDailyCalendarLoad } from "@cadence/core/resolvers/calendar-load.resolver";
import {
  mergeLongitudinalLayers,
  resolveFirstPartyLongitudinalPatterns,
  type LongitudinalOccurrenceOutcomeRecord,
  type LongitudinalProposalOutcomeRecord,
} from "@cadence/core/resolvers/longitudinal-patterns.resolver";
import type { LongitudinalPatternSnapshot } from "@cadence/core/types/chat-travel";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { Json } from "@/lib/db/database.types";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import { getCalendarEventsForAdvisor } from "@/lib/services/google-calendar.service";
import { consumeGoogleCalendarMcpBudget } from "@/lib/services/google-calendar-mcp-cache";
import { MAX_CALENDAR_LIVE_SPAN_DAYS } from "@/lib/services/chat/chat-calendar-cache";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

const DEFAULT_ACTIVITY_WINDOW_DAYS = 14;
const WEEKLY_CADENCE_DAYS = 7;
const MONTHLY_CADENCE_DAYS = 28;
const SUMMARY_EXPIRY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;
const MAX_EPHEMERAL_CHUNKS = 3;

export type LongitudinalReviewCadence = "weekly" | "monthly";

export type LongitudinalReviewEligibilityInput = Readonly<{
  longitudinalCalendarReviewEnabled: boolean;
  cadence: LongitudinalReviewCadence;
  lastReviewAt: string | null;
  lastCadenceActivityAt: string | null;
  now?: Temporal.Instant | string;
  activityWindowDays?: number;
}>;

export type LongitudinalReviewEligibilityResult =
  | Readonly<{ eligible: true }>
  | Readonly<{ eligible: false; reason: "not_opted_in" | "inactive_user" | "cadence_not_due" }>;

/**
 * Q2 eligibility gate for opted-in, activity-gated weekly/monthly longitudinal review:
 * - Explicit opt-in required (`longitudinalCalendarReviewEnabled === true`)
 * - Strictly activity-gated: user must have Cadence activity within the last 14 days (configurable 7–14d)
 * - Cadence gate: weekly >= 7 days since last review, monthly >= 28 days since last review
 */
export function isEligibleForLongitudinalReview(
  input: LongitudinalReviewEligibilityInput,
): LongitudinalReviewEligibilityResult {
  if (!input.longitudinalCalendarReviewEnabled) {
    return { eligible: false, reason: "not_opted_in" };
  }

  const nowMs =
    input.now === undefined
      ? Date.now()
      : typeof input.now === "string"
        ? Date.parse(input.now)
        : input.now.epochMilliseconds;

  const activityWindowDays = Math.max(7, Math.min(14, input.activityWindowDays ?? DEFAULT_ACTIVITY_WINDOW_DAYS));
  if (!input.lastCadenceActivityAt) {
    return { eligible: false, reason: "inactive_user" };
  }
  const lastActivityMs = Date.parse(input.lastCadenceActivityAt);
  if (Number.isNaN(lastActivityMs) || nowMs - lastActivityMs > activityWindowDays * MS_PER_DAY) {
    return { eligible: false, reason: "inactive_user" };
  }

  if (input.lastReviewAt) {
    const lastReviewMs = Date.parse(input.lastReviewAt);
    const minIntervalDays = input.cadence === "monthly" ? MONTHLY_CADENCE_DAYS : WEEKLY_CADENCE_DAYS;
    if (!Number.isNaN(lastReviewMs) && nowMs - lastReviewMs < minIntervalDays * MS_PER_DAY) {
      return { eligible: false, reason: "cadence_not_due" };
    }
  }

  return { eligible: true };
}

export type RunLongitudinalCalendarReviewOptions = Readonly<{
  longitudinalCalendarReviewEnabled: boolean;
  cadence: LongitudinalReviewCadence;
  lastReviewAt: string | null;
  lastCadenceActivityAt: string | null;
  timezone?: string;
  windowDays?: number;
  now?: Temporal.Instant;
  activityWindowDays?: number;
  signal?: AbortSignal;
  grantGeneration?: number | null;
  proposalOutcomes?: readonly LongitudinalProposalOutcomeRecord[];
  occurrences?: readonly LongitudinalOccurrenceOutcomeRecord[];
  /** Injectable for tests: defaults to `consumeGoogleCalendarMcpBudget`. */
  checkBudget?: (userId: string, count: number) => Readonly<{ allowed: boolean; reason?: string }>;
  /** Injectable for tests: defaults to `getCalendarEventsForAdvisor`. */
  readGoogleCalendarChunk?: (
    caller: CalendarCaller,
    startLocalDate: string,
    endLocalDate: string,
    options: Readonly<{ allowPastDates: true; ephemeralOnly: true; signal?: AbortSignal }>,
  ) => Promise<Readonly<{
    events: readonly NormalizedExternalEvent[];
    grantGeneration: number | null;
  }>>;
}>;

export type RunLongitudinalCalendarReviewResult =
  | Readonly<{
      ran: false;
      reason: "not_opted_in" | "inactive_user" | "cadence_not_due" | "mcp_daily_budget_exceeded";
    }>
  | Readonly<{
      ran: true;
      reviewId: string | null;
      windowStart: string;
      windowEnd: string;
      expiresAt: string;
      containsGoogleCalendar: boolean;
      summary: LongitudinalPatternSnapshot;
    }>;

/**
 * Runs an opted-in, activity-gated weekly or monthly longitudinal calendar-load review (Q2).
 *
 * - Reads >30-day Google Calendar spans live via MCP (`ephemeralOnly: true`), subject to
 *   the per-user 40 req/day MCP budget.
 * - Discards raw >30-day Google Calendar events immediately after computing numeric load.
 * - Persists ONLY the compact summary into `public.longitudinal_calendar_reviews` with
 *   `expires_at = now + 30 days` (<=30d per Addendum §2(b)).
 */
export async function runLongitudinalCalendarReviewForUser(
  caller: CalendarCaller,
  options: RunLongitudinalCalendarReviewOptions,
): Promise<RunLongitudinalCalendarReviewResult> {
  const now = options.now ?? Temporal.Now.instant();
  const eligibility = isEligibleForLongitudinalReview({
    longitudinalCalendarReviewEnabled: options.longitudinalCalendarReviewEnabled,
    cadence: options.cadence,
    lastReviewAt: options.lastReviewAt,
    lastCadenceActivityAt: options.lastCadenceActivityAt,
    now,
    activityWindowDays: options.activityWindowDays,
  });
  if (!eligibility.eligible) {
    return { ran: false, reason: eligibility.reason };
  }

  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const windowDays = Math.max(7, Math.min(90, Math.trunc(options.windowDays ?? (options.cadence === "monthly" ? 60 : 30))));
  const endDate = now.toZonedDateTimeISO(timezone).toPlainDate();
  const startDate = endDate.subtract({ days: windowDays - 1 });
  const requiredChunks = Math.min(
    MAX_EPHEMERAL_CHUNKS,
    Math.ceil(windowDays / MAX_CALENDAR_LIVE_SPAN_DAYS),
  );

  const checkBudget = options.checkBudget ?? consumeGoogleCalendarMcpBudget;
  const budget = checkBudget(caller.user.id, requiredChunks);
  if (!budget.allowed) {
    return { ran: false, reason: "mcp_daily_budget_exceeded" };
  }

  const readChunk = options.readGoogleCalendarChunk ?? defaultReadGoogleCalendarChunk;
  const loadDays: Array<{ localDate: string; busyMinutes: number }> = [];
  let containsGoogleCalendar = false;
  let grantGeneration = options.grantGeneration ?? null;

  let cursor = startDate;
  let chunkCount = 0;
  while (Temporal.PlainDate.compare(cursor, endDate) <= 0 && chunkCount < requiredChunks) {
    const chunkEndCandidate = cursor.add({ days: MAX_CALENDAR_LIVE_SPAN_DAYS - 1 });
    const chunkEnd = Temporal.PlainDate.compare(chunkEndCandidate, endDate) <= 0 ? chunkEndCandidate : endDate;
    chunkCount += 1;

    const chunkResult = await readChunk(caller, cursor.toString(), chunkEnd.toString(), {
      allowPastDates: true,
      ephemeralOnly: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    containsGoogleCalendar = true;
    if (chunkResult.grantGeneration !== null) {
      grantGeneration = chunkResult.grantGeneration;
    }

    // Compute numeric daily load in memory and discard raw events immediately.
    const computed = resolveDailyCalendarLoad({
      startLocalDate: cursor.toString(),
      endLocalDate: chunkEnd.toString(),
      timezone,
      events: chunkResult.events,
    });
    for (const day of computed) {
      loadDays.push({ localDate: day.localDate, busyMinutes: day.busyMinutes });
    }
    cursor = chunkEnd.add({ days: 1 });
  }

  const firstParty = resolveFirstPartyLongitudinalPatterns({
    now,
    proposalOutcomes: options.proposalOutcomes ?? [],
    occurrences: options.occurrences ?? [],
  });

  const rollingSummary = loadDays.length > 0 ? summarizeLoadDays(loadDays, windowDays) : null;
  const summary = mergeLongitudinalLayers(firstParty, rollingSummary);
  const createdAt = now.toString();
  const expiresAt = new Date(now.epochMilliseconds + SUMMARY_EXPIRY_DAYS * MS_PER_DAY).toISOString();

  const { data, error } = await (caller.client as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id?: string } | null; error: unknown }>;
        };
      };
    };
  })
    .from("longitudinal_calendar_reviews")
    .insert({
      user_id: caller.user.id,
      cadence: options.cadence,
      window_start: startDate.toString(),
      window_end: endDate.toString(),
      summary_json: summary as unknown as Json,
      contains_google_calendar: containsGoogleCalendar,
      google_calendar_grant_generation: grantGeneration,
      created_at: createdAt,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return {
    ran: true,
    reviewId: typeof data?.id === "string" ? data.id : null,
    windowStart: startDate.toString(),
    windowEnd: endDate.toString(),
    expiresAt,
    containsGoogleCalendar,
    summary,
  };
}

function summarizeLoadDays(
  days: readonly Readonly<{ localDate: string; busyMinutes: number }>[],
  windowDays: number,
) {
  const totalBusy = days.reduce((sum, day) => sum + day.busyMinutes, 0);
  const heavyDayCount = days.filter((day) => day.busyMinutes >= 240).length;
  const weekdayTotals = new Map<number, { sum: number; count: number }>();
  for (const day of days) {
    const weekday = Temporal.PlainDate.from(day.localDate).dayOfWeek;
    const current = weekdayTotals.get(weekday) ?? { sum: 0, count: 0 };
    weekdayTotals.set(weekday, { sum: current.sum + day.busyMinutes, count: current.count + 1 });
  }
  const busiestWeekdays = Array.from(weekdayTotals.entries())
    .sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count))
    .slice(0, 2)
    .map(([weekday]) => weekday);

  return {
    windowDays,
    heavyDayCount,
    averageBusyMinutes: totalBusy / days.length,
    busiestWeekdays,
  };
}

async function defaultReadGoogleCalendarChunk(
  caller: CalendarCaller,
  startLocalDate: string,
  endLocalDate: string,
  options: Readonly<{ allowPastDates: true; ephemeralOnly: true; signal?: AbortSignal }>,
): Promise<Readonly<{ events: readonly NormalizedExternalEvent[]; grantGeneration: number | null }>> {
  const read = await getCalendarEventsForAdvisor(
    caller,
    startLocalDate,
    endLocalDate,
    options as Parameters<typeof getCalendarEventsForAdvisor>[3],
  );
  const snapshot = read.result.ok ? read.result.snapshot : read.result.partialSnapshot;
  const record = read as unknown as Record<string, unknown>;
  const candidate = record.grantGeneration ?? record.connectionGeneration;
  return {
    events: snapshot.events as readonly NormalizedExternalEvent[],
    grantGeneration: typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null,
  };
}
