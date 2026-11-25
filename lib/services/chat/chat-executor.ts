import { Temporal } from "@js-temporal/polyfill";
import type { IntegrationOperationName } from "@cadence/core/integration";
import { resolveDailyCalendarLoad } from "@cadence/core/resolvers/calendar-load.resolver";
import {
  mergeLongitudinalLayers,
  resolveFirstPartyLongitudinalPatterns,
  type LongitudinalOccurrenceOutcomeRecord,
  type LongitudinalProposalOutcomeRecord,
} from "@cadence/core/resolvers/longitudinal-patterns.resolver";
import type { MoveCalendarBusy } from "@cadence/core/resolvers/move.resolver";
import {
  resolveChatTravelHorizon,
  type ChatTravelHorizonOccurrenceInput,
  type ChatTravelHorizonTripInput,
} from "@cadence/core/resolvers/travel-horizon.resolver";
import type { ChatTravelUiCard } from "@cadence/core/types/chat-travel";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { executeMcpOperation } from "@/lib/integrations/operations/execute";
import { getCalendarConnection, getCalendarEventsForAdvisor, type CalendarCaller } from "@/lib/services/google-calendar.service";
import { getOutlookCalendarConnection, getOutlookCalendarEventsForCaller } from "@/lib/services/outlook-calendar.service";
import { getIcloudCalendarConnection, getIcloudCalendarEventsForCaller } from "@/lib/services/icloud-calendar.service";
import { screenExternalCalendarTextWithModelArmor } from "@/lib/services/model-armor.service";
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

/**
 * Advisor plan Phase 5 (5A): the live executor. Cadence tools run through
 * `executeMcpOperation` with chat's own grant (scopes, rate limit, activity label
 * "Cadence chat"). Connector tools read the person's calendars and Hevy live through
 * the existing server services (the server keeps no calendar copy). A source that is
 * off returns nothing and says so; a provider failure says it could not be read,
 * never a guess (D4).
 */

export type ChatCalendarSource = "googleCalendar" | "outlookCalendar" | "icloudCalendar";
export type ChatSourceReport = Readonly<{
  source: ChatCalendarSource | "hevy";
  state: "read" | "partial" | "off" | "not_connected" | "no_calendars" | "failed" | "unavailable";
}>;

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
  travelHorizonData?: (horizonDays: number) => Promise<Readonly<{
    trips: readonly ChatTravelHorizonTripInput[];
    occurrences: readonly ChatTravelHorizonOccurrenceInput[];
    sources?: readonly ChatSourceReport[];
  }>>;
  longitudinalData?: (windowDays: number) => Promise<Readonly<{
    proposalOutcomes: readonly LongitudinalProposalOutcomeRecord[];
    occurrences: readonly LongitudinalOccurrenceOutcomeRecord[];
  }>>;
}>;

export type LiveChatConnectorReadsOptions = Readonly<{
  today?: () => string;
  timezone?: string;
  onGoogleCalendarRead?: (grantGeneration: number | null) => void | Promise<void>;
}>;

const CALENDAR_READ_MS = 12_000;
const EPHEMERAL_LOAD_PERSISTED_DAYS = 30;
const EPHEMERAL_LOAD_MAX_CHUNKS = 6;

function isGracefulDegradationCode(code: string): boolean {
  return code === "rate_limited" || code === "mcp_daily_budget_exceeded" || code === "not_configured";
}

function extractGrantGeneration(read: unknown): number | null {
  if (!read || typeof read !== "object") return null;
  const record = read as Record<string, unknown>;
  const connection = record.connection && typeof record.connection === "object"
    ? (record.connection as Record<string, unknown>)
    : null;
  const candidate = connection?.generation ?? record.grantGeneration ?? record.connectionGeneration;
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

/** Live connector reads for one signed-in person. */
export function liveChatConnectorReads(
  caller: CalendarCaller,
  sources: ChatSourceFlags,
  signal: AbortSignal,
  readOptions: LiveChatConnectorReadsOptions = {},
): ChatConnectorReads {
  const timezone = readOptions.timezone ?? DEFAULT_TIMEZONE;
  const getToday = readOptions.today ?? (() => Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate().toString());

  const readSource = async (source: ChatCalendarSource, start: string, end: string): Promise<Readonly<{ events: ChatCalendarEvent[]; report: ChatSourceReport }>> => {
    if (!sources[source]) return { events: [], report: { source, state: "off" } };
    const options = { signal: AbortSignal.any([signal, AbortSignal.timeout(CALENDAR_READ_MS)]), allowPastDates: true };
    try {
      const read = source === "googleCalendar" ? await getCalendarEventsForAdvisor(caller, start, end, options)
        : source === "outlookCalendar" ? await getOutlookCalendarEventsForCaller(caller, start, end, { ...options, includeLocation: true })
          : await getIcloudCalendarEventsForCaller(caller, start, end, { ...options, includeLocation: true });
      if (source === "googleCalendar") {
        await readOptions.onGoogleCalendarRead?.(extractGrantGeneration(read));
      }
      if (!read.result.ok) logConnectorRead("chat_source_read_partial", source, read.result.error.code, null);
      const snapshot = read.result.ok ? read.result.snapshot : read.result.partialSnapshot;
      const projected = (snapshot.events as readonly NormalizedExternalEvent[]).flatMap((event) => projectEvent(event, source));
      const events = await screenCalendarEvents(projected, signal);
      return { events, report: { source, state: read.result.ok ? "read" : "partial" } };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      if (source === "googleCalendar" && isGracefulDegradationCode(code)) {
        logConnectorRead("chat_source_read_unavailable", source, code, error);
        return { events: [], report: { source, state: "unavailable" } };
      }
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
        let mergedDays = result.days;
        const hasPersistedGoogle = result.days.some((day) => day.sources.includes("google_calendar"));
        if (hasPersistedGoogle) {
          await readOptions.onGoogleCalendarRead?.(null);
        }
        if (sources.googleCalendar) {
          const ephemeral = await computeEphemeralGoogleCalendarLoad(
            caller,
            start,
            end,
            getToday(),
            timezone,
            signal,
            readOptions.onGoogleCalendarRead,
          );
          if (ephemeral.days.length > 0) {
            mergedDays = mergeCalendarLoadSummaries(mergedDays, ephemeral.days);
          }
          if (ephemeral.unavailable) {
            for (let i = 0; i < reports.length; i += 1) {
              if (reports[i]?.source === "googleCalendar") {
                reports[i] = { source: "googleCalendar", state: "unavailable" };
              }
            }
          } else if (ephemeral.partial) {
            for (let i = 0; i < reports.length; i += 1) {
              if (reports[i]?.source === "googleCalendar") {
                reports[i] = { source: "googleCalendar", state: "partial" };
              }
            }
          }
        }
        return { days: mergedDays, sources: reports };
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
    travelHorizonData: async (horizonDays) => {
      const clampedDays = Math.max(1, Math.min(7, Math.trunc(horizonDays)));
      const startDate = getToday();
      const endDate = Temporal.PlainDate.from(startDate).add({ days: clampedDays - 1 }).toString();
      const reads = await Promise.all(
        (["googleCalendar", "outlookCalendar", "icloudCalendar"] as const).map((source) =>
          readSource(source, startDate, endDate),
        ),
      );
      const events = reads.flatMap((read) => read.events).sort((a, b) => a.start.localeCompare(b.start));
      const trips: ChatTravelHorizonTripInput[] = [];
      for (const event of events) {
        if (event.all_day || !event.busy || !event.location || !event.location.trim()) continue;
        try {
          const startZdt = Temporal.Instant.from(event.start).toZonedDateTimeISO(timezone);
          trips.push({
            localDate: startZdt.toPlainDate().toString(),
            tripLabel: event.title,
            destinationLabel: event.location.trim(),
            mode: "driving",
            departureAt: null,
            arrivalAt: event.start,
            durationSeconds: null,
            bufferMinutes: 10,
          });
        } catch {
          // Skip malformed event timestamps
        }
      }
      let occurrences: ChatTravelHorizonOccurrenceInput[] = [];
      try {
        const { data } = await caller.client
          .from("occurrences")
          .select("id, behavior_id, local_date, scheduled_for, effective_start_at, effective_end_at, status, schedule_kind")
          .eq("user_id", caller.user.id)
          .gte("local_date", startDate)
          .lte("local_date", endDate)
          .eq("status", "unresolved");
        occurrences = (data ?? []).flatMap((row) => {
          const startAt = row.effective_start_at ?? row.scheduled_for;
          if (!startAt) return [];
          let durationMinutes: number | null = null;
          if (row.effective_end_at) {
            try {
              const sec = Temporal.Instant.from(startAt).until(Temporal.Instant.from(row.effective_end_at)).total({ unit: "seconds" });
              if (sec > 0) durationMinutes = Math.round(sec / 60);
            } catch {
              durationMinutes = null;
            }
          }
          return [{
            occurrenceRef: row.id,
            behaviorId: row.behavior_id,
            localDate: row.local_date,
            startAt,
            endAt: row.effective_end_at ?? null,
            durationMinutes,
            flexible: row.schedule_kind === "exact",
          }];
        });
      } catch {
        occurrences = [];
      }
      return {
        trips,
        occurrences,
        sources: reads.map((read) => read.report).filter((report) => report.state !== "not_connected"),
      };
    },
    longitudinalData: async (windowDays) => {
      const clampedDays = Math.max(7, Math.min(90, Math.trunc(windowDays)));
      const endDate = Temporal.PlainDate.from(getToday());
      const startDate = endDate.subtract({ days: clampedDays - 1 });
      const startStr = startDate.toString();
      const endStr = endDate.toString();

      let occurrences: LongitudinalOccurrenceOutcomeRecord[] = [];
      try {
        const { data } = await caller.client
          .from("occurrences")
          .select("behavior_id, local_date, status, effective_start_at, effective_end_at")
          .eq("user_id", caller.user.id)
          .gte("local_date", startStr)
          .lte("local_date", endStr);
        occurrences = (data ?? []).map((row) => {
          let trackedDurationMinutes: number | null = null;
          if (row.effective_start_at && row.effective_end_at) {
            try {
              const sec = Temporal.Instant.from(row.effective_start_at)
                .until(Temporal.Instant.from(row.effective_end_at))
                .total({ unit: "seconds" });
              if (sec > 0) trackedDurationMinutes = Math.round(sec / 60);
            } catch {
              trackedDurationMinutes = null;
            }
          }
          const status = row.status === "completed" || row.status === "not_completed" ? row.status : "unresolved";
          return {
            behaviorId: row.behavior_id,
            localDate: row.local_date,
            status,
            travelMotivatedShift: false,
            travelDay: false,
            trackedDurationMinutes,
          };
        });
      } catch {
        occurrences = [];
      }

      let proposalOutcomes: LongitudinalProposalOutcomeRecord[] = [];
      try {
        const { data: moves } = await caller.client
          .from("occurrence_moves")
          .select("kind, reason, local_date, occurrence_id, occurrences!occurrence_moves_occurrence_id_fkey(behavior_id)")
          .eq("user_id", caller.user.id)
          .gte("local_date", startStr)
          .lte("local_date", endStr);
        proposalOutcomes = (moves ?? []).flatMap((row) => {
          const nested = row.occurrences as { behavior_id?: string } | null;
          const behaviorId = nested?.behavior_id;
          if (!behaviorId || !row.local_date) return [];
          const outcome = row.kind === "revert" ? "undo" : "yes";
          const travelMotivated = typeof row.reason === "string" && row.reason.toLowerCase().includes("travel");
          return [{
            behaviorId,
            localDate: row.local_date,
            outcome,
            travelMotivated,
          }];
        });
      } catch {
        proposalOutcomes = [];
      }

      return { proposalOutcomes, occurrences };
    },
  };
}

/** Source, error code and error class only: never event content, ids or messages. */
/**
 * Outlook and iCloud refuse a read when the person connected the account but chose no
 * calendars. Checked only after that refusal, so a normal read costs nothing extra.
 */
async function connectedWithNoCalendars(caller: CalendarCaller, source: ChatCalendarSource): Promise<boolean> {
  try {
    if (source === "googleCalendar") {
      const connection = await getCalendarConnection(caller, "agent");
      return connection.status === "connected" && connection.preferences.selectedCalendarIds.length === 0;
    }
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
  onGoogleCalendarRead?: (grantGeneration: number | null) => void | Promise<void>;
  onTravelCards?: (cards: readonly ChatTravelUiCard[]) => void;
}>): ChatToolExecutor {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const sessionCache = createEphemeralCalendarSessionCache(
    (start, end) => input.reads.calendarEvents(start, end),
    timezone,
  );
  let todayBusy: Promise<Readonly<{ busy: MoveCalendarBusy[]; partial: boolean }>> | null = null;
  const busyToday = () => (todayBusy ??= sessionCache.readSpan(input.today(), input.today())
    .then((read) => ({
      busy: calendarBusyFrom(read.events),
      partial: read.sources.some((s) => s.state === "partial" || s.state === "failed" || s.state === "unavailable"),
    }))
    .catch(() => ({ busy: [], partial: true })));

  return async (name: ChatToolName, args, options): Promise<ChatToolResult> => {
    if (name === "list_calendar_events") return calendarTool(sessionCache, args, input.today());
    if (name === "list_calendar_load") return calendarLoadTool(input.reads, args);
    if (name === "list_workouts") return workoutsTool(input.reads, args);
    if (name === "plan_travel_horizon") {
      return travelHorizonTool(input.reads, args, input.today(), timezone, input.onTravelCards, input.onGoogleCalendarRead);
    }
    if (name === "get_longitudinal_patterns") {
      return longitudinalPatternsTool(input.reads, args, input.today());
    }
    if (name === "move_occurrence_to_date") {
      return moveOccurrenceToDateTool(input.context, args, timezone);
    }
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
    const busyState = name === "move_occurrence_for_day" || exactAdd ? await busyToday() : undefined;
    const result = await executeMcpOperation(name as IntegrationOperationName, input.context, operationInput, busyState ? { calendarBusy: busyState.busy } : {});
    if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message } };
    const value = input.sources.notes ? result.value : withoutNotes(result.value);
    if (busyState?.partial && value && typeof value === "object" && !Array.isArray(value)) {
      return {
        ok: true,
        result: {
          ...(value as Record<string, unknown>),
          calendar_check_partial: true,
        },
      };
    }
    return { ok: true, result: value };
  };
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
  const unavailable = sources.filter((item) => item.state === "unavailable").map((item) => names[item.source]);
  const failed = sources.filter((item) => item.state === "failed").map((item) => names[item.source]);
  const partial = sources.filter((item) => item.state === "partial").map((item) => names[item.source]);
  const off = sources.filter((item) => item.state === "off").map((item) => names[item.source]);
  const unselected = sources.filter((item) => item.state === "no_calendars").map((item) => names[item.source]);
  const lines = [
    unavailable.length ? `${unavailable.join(" and ")} ${unavailable.length === 1 ? "is" : "are"} temporarily unavailable for AI features.` : null,
    failed.length ? `Could not read ${failed.join(" and ")} just now; do not guess what is there.` : null,
    partial.length ? `Only part of ${partial.join(" and ")} could be read.` : null,
    off.length ? `${off.join(" and ")} ${off.length === 1 ? "is" : "are"} off in Settings.` : null,
    unselected.length ? `${unselected.join(" and ")} ${unselected.length === 1 ? "is" : "are"} connected, but no calendars are chosen, so there is nothing to read. If they want it included, they can choose calendars in Settings, under Connected sources.` : null,
    sources.length === 0 ? "No calendar is connected." : null,
  ].filter(Boolean);
  return lines.length ? lines.join(" ") : null;
}

async function screenCalendarEvents(
  events: readonly ChatCalendarEvent[],
  signal: AbortSignal,
): Promise<ChatCalendarEvent[]> {
  return Promise.all(
    events.map(async (event) => {
      const [screenedTitle, screenedLocation] = await Promise.all([
        screenExternalCalendarTextWithModelArmor({ text: event.title, signal, emitMonitoringEvent: false }),
        event.location
          ? screenExternalCalendarTextWithModelArmor({ text: event.location, signal, emitMonitoringEvent: false })
          : Promise.resolve(null),
      ]);
      return {
        ...event,
        title: screenedTitle.text || "(no title)",
        location: screenedLocation ? (screenedLocation.text || null) : null,
      };
    }),
  );
}

/**
 * Q2 Ephemeral >30-day Google Calendar load computation:
 * Reads older Google Calendar chunks live in memory via MCP (`ephemeralOnly: true`),
 * computes numeric load via `resolveDailyCalendarLoad`, and discards raw events immediately.
 */
async function computeEphemeralGoogleCalendarLoad(
  caller: CalendarCaller,
  start: string,
  end: string,
  today: string,
  timezone: string,
  signal: AbortSignal,
  onGoogleCalendarRead?: (grantGeneration: number | null) => void | Promise<void>,
): Promise<Readonly<{ days: DailyCalendarLoadSummary[]; partial: boolean; unavailable: boolean }>> {
  const cutoff = Temporal.PlainDate.from(today).subtract({ days: EPHEMERAL_LOAD_PERSISTED_DAYS });
  const startDate = Temporal.PlainDate.from(start);
  const endDate = Temporal.PlainDate.from(end);
  if (Temporal.PlainDate.compare(startDate, cutoff) >= 0) {
    return { days: [], partial: false, unavailable: false };
  }
  const ephemeralEnd = Temporal.PlainDate.compare(endDate, cutoff.subtract({ days: 1 })) < 0
    ? endDate
    : cutoff.subtract({ days: 1 });

  const days: DailyCalendarLoadSummary[] = [];
  let cursor = startDate;
  let chunks = 0;
  let partial = false;
  let unavailable = false;

  while (Temporal.PlainDate.compare(cursor, ephemeralEnd) <= 0 && chunks < EPHEMERAL_LOAD_MAX_CHUNKS) {
    const chunkEndCandidate = cursor.add({ days: MAX_CALENDAR_LIVE_SPAN_DAYS - 1 });
    const chunkEnd = Temporal.PlainDate.compare(chunkEndCandidate, ephemeralEnd) <= 0
      ? chunkEndCandidate
      : ephemeralEnd;
    chunks += 1;
    try {
      const read = await getCalendarEventsForAdvisor(
        caller,
        cursor.toString(),
        chunkEnd.toString(),
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(CALENDAR_READ_MS)]),
          allowPastDates: true,
          ephemeralOnly: true,
        } as Parameters<typeof getCalendarEventsForAdvisor>[3],
      );
      await onGoogleCalendarRead?.(extractGrantGeneration(read));
      if (!read.result.ok) partial = true;
      const snapshot = read.result.ok ? read.result.snapshot : read.result.partialSnapshot;
      const computed = resolveDailyCalendarLoad({
        startLocalDate: cursor.toString(),
        endLocalDate: chunkEnd.toString(),
        timezone,
        events: snapshot.events as readonly NormalizedExternalEvent[],
      });
      for (const entry of computed) {
        days.push({
          local_date: entry.localDate,
          busy_minutes: entry.busyMinutes,
          event_count: entry.eventCount,
          earliest_start_minute: entry.earliestStartMinute,
          latest_end_minute: entry.latestEndMinute,
          has_all_day_busy: entry.hasAllDayBusy,
          sources: ["google_calendar"],
        });
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      if (isGracefulDegradationCode(code)) {
        unavailable = true;
        break;
      }
      partial = true;
    }
    cursor = chunkEnd.add({ days: 1 });
  }

  return { days, partial, unavailable };
}

function mergeCalendarLoadSummaries(
  persisted: readonly DailyCalendarLoadSummary[],
  ephemeral: readonly DailyCalendarLoadSummary[],
): DailyCalendarLoadSummary[] {
  const byDate = new Map<string, DailyCalendarLoadSummary>();
  for (const day of persisted) {
    byDate.set(day.local_date, day);
  }
  for (const day of ephemeral) {
    const existing = byDate.get(day.local_date);
    if (!existing) {
      byDate.set(day.local_date, day);
      continue;
    }
    if (existing.sources.includes("google_calendar")) continue;
    byDate.set(day.local_date, {
      local_date: existing.local_date,
      busy_minutes: existing.busy_minutes + day.busy_minutes,
      event_count: existing.event_count + day.event_count,
      earliest_start_minute:
        existing.earliest_start_minute === null
          ? day.earliest_start_minute
          : day.earliest_start_minute === null
            ? existing.earliest_start_minute
            : Math.min(existing.earliest_start_minute, day.earliest_start_minute),
      latest_end_minute:
        existing.latest_end_minute === null
          ? day.latest_end_minute
          : day.latest_end_minute === null
            ? existing.latest_end_minute
            : Math.max(existing.latest_end_minute, day.latest_end_minute),
      has_all_day_busy: existing.has_all_day_busy || day.has_all_day_busy,
      sources: [...existing.sources, "google_calendar"],
    });
  }
  return Array.from(byDate.values()).sort((a, b) => a.local_date.localeCompare(b.local_date));
}

async function travelHorizonTool(
  reads: ChatConnectorReads,
  args: Readonly<Record<string, unknown>>,
  today: string,
  timezone: string,
  onTravelCards?: (cards: readonly ChatTravelUiCard[]) => void,
  onGoogleCalendarRead?: (grantGeneration: number | null) => void | Promise<void>,
): Promise<ChatToolResult> {
  const requestedDays = typeof args.horizon_days === "number" && Number.isFinite(args.horizon_days)
    ? Math.max(1, Math.min(7, Math.trunc(args.horizon_days)))
    : 7;
  const data = reads.travelHorizonData
    ? await reads.travelHorizonData(requestedDays)
    : { trips: [], occurrences: [], sources: [] };
  if (data.sources?.some((s) => s.source === "googleCalendar" && (s.state === "read" || s.state === "partial"))) {
    await onGoogleCalendarRead?.(null);
  }
  const horizon = resolveChatTravelHorizon({
    now: Temporal.Now.instant(),
    timezone,
    todayLocalDate: today,
    horizonDays: requestedDays,
    trips: data.trips,
    occurrences: data.occurrences,
  });
  if (horizon.uiCards.length > 0) {
    onTravelCards?.(horizon.uiCards);
  }
  // L-001: Return ONLY `modelSummary` to the LLM; `uiCards` are emitted directly to UI.
  return {
    ok: true,
    result: {
      travel_horizon: horizon.modelSummary,
      ui_cards_emitted: horizon.uiCards.length,
      note: data.sources ? sourceNote(data.sources) : null,
    },
    uiTravelCards: horizon.uiCards,
  };
}

async function longitudinalPatternsTool(
  reads: ChatConnectorReads,
  args: Readonly<Record<string, unknown>>,
  today: string,
): Promise<ChatToolResult> {
  const windowDays = typeof args.window_days === "number" && Number.isFinite(args.window_days)
    ? Math.max(7, Math.min(180, Math.trunc(args.window_days)))
    : 30;
  const data = reads.longitudinalData
    ? await reads.longitudinalData(windowDays)
    : { proposalOutcomes: [], occurrences: [] };
  const firstParty = resolveFirstPartyLongitudinalPatterns({
    now: Temporal.Now.instant(),
    proposalOutcomes: data.proposalOutcomes,
    occurrences: data.occurrences,
  });

  let rollingCalendarSummary = null;
  if (reads.calendarLoad) {
    const endDate = Temporal.PlainDate.from(today);
    const startDate = endDate.subtract({ days: windowDays - 1 });
    const load = await reads.calendarLoad(startDate.toString(), endDate.toString());
    if (load.days.length > 0) {
      const totalBusy = load.days.reduce((sum, d) => sum + d.busy_minutes, 0);
      const heavyDayCount = load.days.filter((d) => d.busy_minutes >= 240).length;
      const weekdayTotals = new Map<number, { sum: number; count: number }>();
      for (const d of load.days) {
        const wd = Temporal.PlainDate.from(d.local_date).dayOfWeek;
        const cur = weekdayTotals.get(wd) ?? { sum: 0, count: 0 };
        weekdayTotals.set(wd, { sum: cur.sum + d.busy_minutes, count: cur.count + 1 });
      }
      const busiestWeekdays = Array.from(weekdayTotals.entries())
        .sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count))
        .slice(0, 2)
        .map(([wd]) => wd);
      rollingCalendarSummary = {
        windowDays,
        heavyDayCount,
        averageBusyMinutes: totalBusy / load.days.length,
        busiestWeekdays,
      };
    }
  }

  return {
    ok: true,
    result: mergeLongitudinalLayers(firstParty, rollingCalendarSummary),
  };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function sameRevision(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return Temporal.Instant.from(a).equals(Temporal.Instant.from(b));
  } catch {
    return false;
  }
}

async function moveOccurrenceToDateTool(
  context: IntegrationContext,
  args: Readonly<Record<string, unknown>>,
  defaultTimezone: string,
): Promise<ChatToolResult> {
  const occurrenceId = typeof args.occurrence_id === "string" && args.occurrence_id.trim() ? args.occurrence_id.trim() : null;
  const targetLocalDate = typeof args.target_local_date === "string" && DATE.test(args.target_local_date)
    ? args.target_local_date
    : null;
  const expectedRevision = typeof args.expected_revision === "string" && args.expected_revision.trim()
    ? args.expected_revision.trim()
    : null;
  const startTimeRaw = typeof args.start_time === "string"
    ? args.start_time
    : typeof args.target_start_time === "string"
      ? args.target_start_time
      : null;
  const targetStartAtRaw = typeof args.target_start_at === "string" ? args.target_start_at : null;

  if (!occurrenceId || !targetLocalDate || !expectedRevision) {
    return {
      ok: false,
      error: { code: "invalid_input", message: "occurrence_id, target_local_date (YYYY-MM-DD), and expected_revision are required." },
    };
  }
  let parsedTargetDate: Temporal.PlainDate;
  try {
    parsedTargetDate = Temporal.PlainDate.from(targetLocalDate);
  } catch {
    return { ok: false, error: { code: "invalid_input", message: "Use target_local_date as YYYY-MM-DD." } };
  }
  if (startTimeRaw !== null && !HHMM.test(startTimeRaw)) {
    return { ok: false, error: { code: "invalid_input", message: "Use start_time as HH:MM." } };
  }

  const { data: occurrence, error: readError } = await context.supabase
    .from("occurrences")
    .select("id, behavior_id, local_date, scheduled_for, effective_start_at, effective_end_at, status, updated_at")
    .eq("id", occurrenceId)
    .eq("user_id", context.userId)
    .maybeSingle();

  if (readError) {
    return { ok: false, error: { code: "failed", message: "Could not read that item." } };
  }
  if (!occurrence) {
    return { ok: false, error: { code: "not_found", message: "Occurrence not found." } };
  }
  if (occurrence.status !== "unresolved") {
    return {
      ok: true,
      result: {
        outcome: "refused",
        refusal: {
          reason: "already_resolved",
          message: "That item is already marked, so it cannot be moved.",
        },
      },
    };
  }
  if (!sameRevision(occurrence.updated_at, expectedRevision)) {
    return {
      ok: true,
      result: {
        outcome: "refused",
        refusal: {
          reason: "revision_changed",
          message: "That item changed since it was read.",
        },
      },
    };
  }

  const { data: behavior } = await context.supabase
    .from("behaviors")
    .select("title, timezone, default_duration_minutes")
    .eq("id", occurrence.behavior_id)
    .eq("user_id", context.userId)
    .maybeSingle();

  const behaviorTimezone = typeof behavior?.timezone === "string" && behavior.timezone ? behavior.timezone : defaultTimezone;

  let newStartInstant: Temporal.Instant;
  try {
    if (targetStartAtRaw) {
      newStartInstant = Temporal.Instant.from(targetStartAtRaw);
    } else if (startTimeRaw) {
      newStartInstant = parsedTargetDate
        .toZonedDateTime({ timeZone: behaviorTimezone, plainTime: Temporal.PlainTime.from(startTimeRaw) })
        .toInstant();
    } else {
      const currentStart = Temporal.Instant.from(occurrence.effective_start_at ?? occurrence.scheduled_for)
        .toZonedDateTimeISO(behaviorTimezone);
      newStartInstant = parsedTargetDate
        .toZonedDateTime({ timeZone: behaviorTimezone, plainTime: currentStart.toPlainTime() })
        .toInstant();
    }
  } catch {
    return { ok: false, error: { code: "invalid_input", message: "Could not compute target start time." } };
  }

  let durationSeconds: number | null = null;
  if (occurrence.effective_start_at && occurrence.effective_end_at) {
    try {
      const diff = Temporal.Instant.from(occurrence.effective_start_at)
        .until(Temporal.Instant.from(occurrence.effective_end_at))
        .total({ unit: "seconds" });
      if (diff > 0) durationSeconds = Math.round(diff);
    } catch {
      durationSeconds = null;
    }
  } else if (typeof behavior?.default_duration_minutes === "number" && behavior.default_duration_minutes > 0) {
    durationSeconds = Math.round(behavior.default_duration_minutes * 60);
  }

  const newStartIso = newStartInstant.toString();
  const newEndIso = durationSeconds !== null ? newStartInstant.add({ seconds: durationSeconds }).toString() : null;

  const { data: updated, error: updateError } = await context.supabase
    .from("occurrences")
    .update({
      local_date: targetLocalDate,
      scheduled_for: newStartIso,
      effective_start_at: newStartIso,
      effective_end_at: newEndIso,
    })
    .eq("id", occurrenceId)
    .eq("user_id", context.userId)
    .eq("updated_at", occurrence.updated_at)
    .select("id, behavior_id, local_date, scheduled_for, effective_start_at, effective_end_at, status, updated_at")
    .maybeSingle();

  if (updateError) {
    return { ok: false, error: { code: "failed", message: "Could not move that item." } };
  }
  if (!updated) {
    return {
      ok: true,
      result: {
        outcome: "refused",
        refusal: {
          reason: "revision_changed",
          message: "That item changed since it was read.",
        },
      },
    };
  }

  return {
    ok: true,
    result: {
      outcome: "moved",
      occurrence: {
        id: updated.id,
        behavior_id: updated.behavior_id,
        behavior_title: behavior?.title ?? null,
        timezone: behaviorTimezone,
        local_date: updated.local_date,
        scheduled_for: updated.scheduled_for,
        effective_start_at: updated.effective_start_at,
        effective_end_at: updated.effective_end_at,
        status: updated.status,
        updated_at: updated.updated_at,
        revision: updated.updated_at,
      },
      previous: {
        local_date: occurrence.local_date,
        scheduled_for: occurrence.scheduled_for,
        effective_start_at: occurrence.effective_start_at,
        effective_end_at: occurrence.effective_end_at,
      },
    },
  };
}
