import { Temporal } from "@js-temporal/polyfill";
import type { IntegrationOperationName } from "@cadence/core/integration";
import type { MoveCalendarBusy } from "@cadence/core/resolvers/move.resolver";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { executeMcpOperation } from "@/lib/integrations/operations/execute";
import { getCalendarEventsForAdvisor, type CalendarCaller } from "@/lib/services/google-calendar.service";
import { getOutlookCalendarConnection, getOutlookCalendarEventsForCaller } from "@/lib/services/outlook-calendar.service";
import { getIcloudCalendarConnection, getIcloudCalendarEventsForCaller } from "@/lib/services/icloud-calendar.service";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { searchAdviceCards } from "./chat-advice";
import { getPersistedHevyActivities } from "@/lib/services/recorded-activity-sync.service";
import {
  CALENDAR_LOAD_MAX_QUERY_DAYS,
  getDailyCalendarLoadForUser,
  type DailyCalendarLoadSummary,
} from "@/lib/services/daily-calendar-load.service";
import type { ExternalEventSource } from "@cadence/core/types/day-progress";
import {
  createEphemeralCalendarSessionCache,
  MAX_CALENDAR_LIVE_SPAN_DAYS,
} from "./chat-calendar-cache";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import { withoutNotes, type ChatSourceFlags, type ChatToolName } from "./chat-tools";
import type { ChatToolExecutor, ChatToolResult } from "./chat-writes";
import { CHAT_PLANNING_READS, chatPlanningBehaviorIds, withChatPlanning } from "./chat-planning";
import { readBehaviorPlanningFacts } from "@/lib/services/brief-move-day.service";
import { alongsideEnabled } from "@/lib/services/alongside-flag";

/**
 * Advisor plan Phase 5 (5A): the live executor. Cadence tools run through
 * `executeMcpOperation` with chat's own grant (scopes, rate limit, activity label
 * "Cadence chat"). Connector tools read the person's calendars and Hevy live through
 * the existing server services (the server keeps no calendar copy). A source that is
 * off returns nothing and says so; a provider failure says it could not be read,
 * never a guess (D4).
 */

export type ChatCalendarSource = "googleCalendar" | "outlookCalendar" | "icloudCalendar";
export type ChatSourceReport = Readonly<{ source: ChatCalendarSource | "hevy"; state: "read" | "partial" | "off" | "not_connected" | "no_calendars" | "failed" }>;

export type ChatCalendarEvent = Readonly<{
  title: string;
  calendar: string;
  source: ChatCalendarSource;
  start: string;
  end: string | null;
  all_day: boolean;
  location: string | null;
  busy: boolean;
}>;

export type ChatConnectorReads = Readonly<{
  calendarEvents: (start: string, end: string) => Promise<Readonly<{ events: ChatCalendarEvent[]; sources: ChatSourceReport[] }>>;
  calendarLoad?: (start: string, end: string) => Promise<Readonly<{ days: DailyCalendarLoadSummary[]; sources: ChatSourceReport[] }>>;
  workouts: (start: string, end: string) => Promise<Readonly<{ workouts: unknown[]; sources: ChatSourceReport[] }>>;
}>;

const CALENDAR_READ_MS = 12_000;

/** Live connector reads for one signed-in person. */
export function liveChatConnectorReads(caller: CalendarCaller, sources: ChatSourceFlags, signal: AbortSignal): ChatConnectorReads {
  const readSource = async (source: ChatCalendarSource, start: string, end: string): Promise<Readonly<{ events: ChatCalendarEvent[]; report: ChatSourceReport }>> => {
    if (!sources[source]) return { events: [], report: { source, state: "off" } };
    const options = { signal: AbortSignal.any([signal, AbortSignal.timeout(CALENDAR_READ_MS)]), allowPastDates: true };
    try {
      const read = source === "googleCalendar" ? await getCalendarEventsForAdvisor(caller, start, end, options)
        : source === "outlookCalendar" ? await getOutlookCalendarEventsForCaller(caller, start, end, { ...options, includeLocation: true })
          : await getIcloudCalendarEventsForCaller(caller, start, end, { ...options, includeLocation: true });
      if (!read.result.ok) logConnectorRead("chat_source_read_partial", source, read.result.error.code, null);
      const snapshot = read.result.ok ? read.result.snapshot : read.result.partialSnapshot;
      const events = (snapshot.events as readonly NormalizedExternalEvent[]).flatMap((event) => projectEvent(event, source));
      return { events, report: { source, state: read.result.ok ? "read" : "partial" } };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      const notConnected = code === "reconnect_required" || code === "not_connected" || code === "same_account_required" || code === "not_configured";
      if (!notConnected && code === "invalid_request" && await connectedWithNoCalendars(caller, source)) {
        return { events: [], report: { source, state: "no_calendars" } };
      }
      logConnectorRead("chat_source_read_failed", source, code, error);
      return { events: [], report: { source, state: notConnected ? "not_connected" : "failed" } };
    }
  };
  return {
    calendarEvents: async (start, end) => {
      const reads = await Promise.all((["googleCalendar", "outlookCalendar", "icloudCalendar"] as const).map((source) => readSource(source, start, end)));
      const events = reads.flatMap((read) => read.events).sort((a, b) => a.start.localeCompare(b.start));
      // A source that was never connected is not worth mentioning to the model.
      return { events, sources: reads.map((read) => read.report).filter((report) => report.state !== "not_connected") };
    },
    calendarLoad: async (start, end) => {
      const enabledSources: ExternalEventSource[] = [];
      const reports: ChatSourceReport[] = [];
      const pairs: ReadonlyArray<readonly [ChatCalendarSource, ExternalEventSource]> = [
        ["googleCalendar", "google_calendar"],
        ["outlookCalendar", "outlook_calendar"],
        ["icloudCalendar", "icloud_calendar"],
      ];
      for (const [chatSource, dbSource] of pairs) {
        if (sources[chatSource]) {
          enabledSources.push(dbSource);
          reports.push({ source: chatSource, state: "read" });
        } else {
          reports.push({ source: chatSource, state: "off" });
        }
      }
      if (enabledSources.length === 0) return { days: [], sources: reports };
      try {
        const result = await getDailyCalendarLoadForUser(caller.client, caller.user.id, start, end, {
          sources: enabledSources,
          signal: AbortSignal.any([signal, AbortSignal.timeout(CALENDAR_READ_MS)]),
        });
        return { days: result.days, sources: reports };
      } catch (error) {
        logConnectorRead("chat_calendar_load_failed", "googleCalendar", "provider_unavailable", error);
        return { days: [], sources: reports.map((r) => r.state === "read" ? { ...r, state: "failed" as const } : r) };
      }
    },
    workouts: async (start, end) => {
      if (!sources.hevy) return { workouts: [], sources: [{ source: "hevy", state: "off" }] };
      try {
        const snapshot = await getPersistedHevyActivities(caller, start, end, "chat", {
          signal: AbortSignal.any([signal, AbortSignal.timeout(CALENDAR_READ_MS)]),
        });
        const workouts = snapshot.activities.map((activity) => ({
          start: activity.startAt, end: activity.endAt, minutes: Math.round(activity.duration.seconds / 60), date: activity.localStartDate,
        }));
        return { workouts, sources: [{ source: "hevy", state: snapshot.completeness === "complete" ? "read" : "partial" }] };
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
        logConnectorRead("chat_source_read_failed", "hevy", code, error);
        return { workouts: [], sources: [{ source: "hevy", state: code === "reconnect_required" || code === "not_connected" ? "not_connected" : "failed" }] };
      }
    },
  };
}

/** Source, error code and error class only: never event content, ids or messages. */
/**
 * Outlook and iCloud refuse a read when the person connected the account but chose no
 * calendars. Checked only after that refusal, so a normal read costs nothing extra.
 */
async function connectedWithNoCalendars(caller: CalendarCaller, source: ChatCalendarSource): Promise<boolean> {
  if (source === "googleCalendar") return false;
  try {
    const connection = source === "outlookCalendar" ? await getOutlookCalendarConnection(caller) : await getIcloudCalendarConnection(caller);
    return connection.status === "connected" && connection.preferences.selectedSourceIds.length === 0;
  } catch {
    return false;
  }
}

function logConnectorRead(name: string, source: ChatCalendarSource | "hevy", code: string, error: unknown): void {
  reportMonitoringEvent({ name, severity: "warning", context: {
    source, code: code || null, error_name: error instanceof Error ? error.name : error === null ? null : typeof error,
  } });
}

function projectEvent(event: NormalizedExternalEvent, source: ChatCalendarSource): ChatCalendarEvent[] {
  if (event.state === "cancelled") return [];
  const common = {
    title: event.title || "(no title)", calendar: event.calendarName, source, location: event.location || null,
    busy: event.availability !== "free" && event.currentUserResponse !== "declined",
  };
  if (event.kind === "timed") return [{ ...common, start: event.startAt, end: event.endAt, all_day: false }];
  return [{ ...common, start: event.startLocalDate, end: event.endLocalDate, all_day: true }];
}

/** Today's busy times for the move check, from the calendars chat may read. */
export function calendarBusyFrom(events: readonly ChatCalendarEvent[]): MoveCalendarBusy[] {
  return events.flatMap((event, index) => {
    if (event.all_day || !event.busy || !event.end) return [];
    const start = Temporal.Instant.from(event.start), end = Temporal.Instant.from(event.end);
    return Temporal.Instant.compare(end, start) > 0 ? [{ ref: `chat:${index}`, start, end }] : [];
  });
}

/**
 * The executor for one turn. Moves, and opportunity adds at an exact time, load today's
 * events first and pass their busy times to the same slot check the brief's apply path
 * uses; a clash is refused with `calendar_busy` and up to three other times (5A step 4).
 */
export function createLiveChatExecutor(input: Readonly<{
  context: IntegrationContext;
  sources: ChatSourceFlags;
  reads: ChatConnectorReads;
  /** Today's local date in the person's timezone. */
  today: () => string;
  /** Person's IANA timezone for local-day cache filtering. */
  timezone?: string;
}>): ChatToolExecutor {
  const sessionCache = createEphemeralCalendarSessionCache(
    (start, end) => input.reads.calendarEvents(start, end),
    input.timezone ?? DEFAULT_TIMEZONE,
  );
  let todayBusy: Promise<MoveCalendarBusy[]> | null = null;
  const busyToday = () => (todayBusy ??= sessionCache.readSpan(input.today(), input.today())
    .then((read) => calendarBusyFrom(read.events)).catch(() => []));

  return async (name: ChatToolName, args, options): Promise<ChatToolResult> => {
    if (name === "list_calendar_events") return calendarTool(sessionCache, args, input.today());
    if (name === "list_calendar_load") return calendarLoadTool(input.reads, args);
    if (name === "list_workouts") return workoutsTool(input.reads, args);
    if (name === "search_advice") {
      if (typeof args.query !== "string" || !args.query.trim()) return { ok: false, error: { code: "invalid_input", message: "Send a query of a few words." } };
      return { ok: true, result: searchAdviceCards(args.query.slice(0, 200)) };
    }
    if (!input.sources.notes && (name === "list_day_notes" || name === "update_occurrence_note" || name === "update_day_note")) {
      return { ok: false, error: { code: "source_off", message: "Notes are off in Settings." } };
    }
    const operationInput = options.idempotencyKey ? { ...args, idempotency_key: options.idempotencyKey } : { ...args };
    // Adding an opportunity at an exact time passes the same busy times: the handler then
    // checks today's items and events with the shared free-slot rule, as a move does.
    const exactAdd = name === "add_opportunity_occurrence" && typeof args.start_time === "string" && args.end_time === undefined && args.mark_completed !== true;
    const calendarBusy = name === "move_occurrence_for_day" || exactAdd ? await busyToday() : undefined;
    const result = await executeMcpOperation(name as IntegrationOperationName, input.context, operationInput, calendarBusy ? { calendarBusy } : {});
    if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message } };
    const planned = await withPlanningFacts(name, result.value, input.context, input.today());
    return { ok: true, result: input.sources.notes ? planned : withoutNotes(planned) };
  };
}

/**
 * Ticket 359: timeline and Behavior reads carry each item's effective alongside value and
 * Where kind while `CADENCE_ALONGSIDE` is on (chat-planning.ts). Off, or when the facts
 * cannot be read, the MCP result passes through unchanged.
 */
export async function withPlanningFacts(name: string, value: unknown, context: Pick<IntegrationContext, "supabase" | "userId">, today: string,
  env: Readonly<Record<string, string | undefined>> = process.env): Promise<unknown> {
  if (!CHAT_PLANNING_READS.has(name) || !alongsideEnabled(env)) return value;
  try {
    const facts = await readBehaviorPlanningFacts(context.supabase, context.userId, chatPlanningBehaviorIds(value), today, { env });
    return withChatPlanning(value, facts);
  } catch {
    return value;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function calendarTool(
  cache: ReturnType<typeof createEphemeralCalendarSessionCache>,
  args: Readonly<Record<string, unknown>>,
  today: string,
): Promise<ChatToolResult> {
  const maxFuture = Temporal.PlainDate.from(today).add({ days: 30 });
  const minPast = Temporal.PlainDate.from("2000-01-01");

  if (Array.isArray(args.dates) && args.dates.length > 0) {
    if (args.dates.length > 14) {
      return { ok: false, error: { code: "invalid_input", message: "Request at most 14 outlier dates per call." } };
    }
    const dates: string[] = [];
    for (const entry of args.dates) {
      if (typeof entry !== "string" || !DATE.test(entry)) {
        return { ok: false, error: { code: "invalid_input", message: "Use dates as YYYY-MM-DD." } };
      }
      try {
        const parsed = Temporal.PlainDate.from(entry);
        if (Temporal.PlainDate.compare(parsed, maxFuture) > 0 || Temporal.PlainDate.compare(parsed, minPast) < 0) {
          return { ok: false, error: { code: "invalid_input", message: `Dates must be on or before ${maxFuture.toString()}.` } };
        }
        dates.push(entry);
      } catch {
        return { ok: false, error: { code: "invalid_input", message: "Use dates as YYYY-MM-DD." } };
      }
    }
    const read = await cache.readDates(dates);
    return { ok: true, result: { events: read.events, sources: read.sources, note: sourceNote(read.sources) } };
  }

  const start = typeof args.start_date === "string" && DATE.test(args.start_date) ? args.start_date : today;
  const end = typeof args.end_date === "string" && DATE.test(args.end_date) ? args.end_date : start;
  try {
    const first = Temporal.PlainDate.from(start);
    const last = Temporal.PlainDate.from(end);
    const spanDays = first.until(last).days + 1;
    if (spanDays < 1 || spanDays > MAX_CALENDAR_LIVE_SPAN_DAYS) {
      return { ok: false, error: { code: "invalid_input", message: `Calendar live reads are capped at ${MAX_CALENDAR_LIVE_SPAN_DAYS} days per call.` } };
    }
    if (Temporal.PlainDate.compare(last, maxFuture) > 0 || Temporal.PlainDate.compare(first, minPast) < 0) {
      return { ok: false, error: { code: "invalid_input", message: `end_date must be on or before ${maxFuture.toString()}.` } };
    }
  } catch {
    return { ok: false, error: { code: "invalid_input", message: "Use dates as YYYY-MM-DD." } };
  }
  const read = await cache.readSpan(start, end);
  return { ok: true, result: { events: read.events, sources: read.sources, note: sourceNote(read.sources) } };
}

async function calendarLoadTool(reads: ChatConnectorReads, args: Readonly<Record<string, unknown>>): Promise<ChatToolResult> {
  const start = typeof args.start_date === "string" && DATE.test(args.start_date) ? args.start_date : null;
  const end = typeof args.end_date === "string" && DATE.test(args.end_date) ? args.end_date : null;
  if (!start || !end) return { ok: false, error: { code: "invalid_input", message: "Use dates as YYYY-MM-DD." } };
  try {
    const spanDays = Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end)).days + 1;
    if (spanDays < 1 || spanDays > CALENDAR_LOAD_MAX_QUERY_DAYS) {
      return { ok: false, error: { code: "invalid_input", message: `Calendar load range must be between 1 and ${CALENDAR_LOAD_MAX_QUERY_DAYS} days.` } };
    }
  } catch {
    return { ok: false, error: { code: "invalid_input", message: "Use dates as YYYY-MM-DD." } };
  }
  if (!reads.calendarLoad) return { ok: true, result: { days: [], sources: [], note: null } };
  const read = await reads.calendarLoad(start, end);
  return { ok: true, result: { days: read.days, sources: read.sources, note: sourceNote(read.sources) } };
}

async function workoutsTool(reads: ChatConnectorReads, args: Readonly<Record<string, unknown>>): Promise<ChatToolResult> {
  const start = typeof args.start_date === "string" && DATE.test(args.start_date) ? args.start_date : null;
  const end = typeof args.end_date === "string" && DATE.test(args.end_date) ? args.end_date : null;
  if (!start || !end) return { ok: false, error: { code: "invalid_input", message: "Use dates as YYYY-MM-DD." } };
  const read = await reads.workouts(start, end);
  return { ok: true, result: { workouts: read.workouts, sources: read.sources, note: sourceNote(read.sources) } };
}

/** One plain sentence about sources that could not be read, so the model never fills the gap. */
function sourceNote(sources: readonly ChatSourceReport[]): string | null {
  const names: Readonly<Record<ChatSourceReport["source"], string>> = {
    googleCalendar: "Google Calendar", outlookCalendar: "Outlook Calendar", icloudCalendar: "iCloud Calendar", hevy: "Hevy",
  };
  const failed = sources.filter((item) => item.state === "failed").map((item) => names[item.source]);
  const partial = sources.filter((item) => item.state === "partial").map((item) => names[item.source]);
  const off = sources.filter((item) => item.state === "off").map((item) => names[item.source]);
  const unselected = sources.filter((item) => item.state === "no_calendars").map((item) => names[item.source]);
  const lines = [
    failed.length ? `Could not read ${failed.join(" and ")} just now; do not guess what is there.` : null,
    partial.length ? `Only part of ${partial.join(" and ")} could be read.` : null,
    off.length ? `${off.join(" and ")} ${off.length === 1 ? "is" : "are"} off in Settings.` : null,
    unselected.length ? `${unselected.join(" and ")} ${unselected.length === 1 ? "is" : "are"} connected, but no calendars are chosen, so there is nothing to read. If they want it included, they can choose calendars in Settings, under Connected sources.` : null,
    sources.length === 0 ? "No calendar is connected." : null,
  ].filter(Boolean);
  return lines.length ? lines.join(" ") : null;
}
