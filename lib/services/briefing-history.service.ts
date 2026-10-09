import { createHash, randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { parseBriefingConfig } from "@cadence/core/services/briefing-config";
import { projectAdvisorCadenceSource, projectAdvisorCalendarConnector, projectUnavailableAdvisorCalendar, validateAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import type { AdvisorCalendarConnector, AdvisorDayContextV1, AdvisorOpaqueRef } from "@cadence/core/types/advisor-day-context";
import { ADVISOR_DAY_CONTEXT_LIMITS, ADVISOR_DAY_CONTEXT_VERSION } from "@cadence/core/types/advisor-day-context";
import type { BriefingAnalysisSource } from "@cadence/core/types/briefing-analysis";
import type { BriefingConfig } from "@cadence/core/types/briefing-config";
import { resolveBehaviorDurationSources } from "@cadence/core/resolvers/timeline-context.resolver";
import { listUserOccurrences } from "@/lib/db/occurrences.repo";
import { listUserBehaviors, type BehaviorWithCategory } from "@/lib/db/behaviors.repo";
import type { Occurrence, OccurrenceStatus } from "@/lib/types/database";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { listBehaviorConfigurationEvents } from "@/lib/db/behaviorConfigurationEvents.repo";
import { projectBriefingAnalysisSource } from "./briefing-analysis-source";
import { briefingAccountRef, prepareAccountBriefingContexts, workbenchBehaviorRef } from "./briefing-account-context.service";
import { briefingFixture, BRIEFING_FIXTURE_IDS, BRIEFING_FIXTURE_VERSION, type BriefingFixtureId } from "./briefing-fixtures";
import { briefingAnalysisFixture, BRIEFING_ANALYSIS_FIXTURE_IDS, BRIEFING_ANALYSIS_FIXTURE_VERSION, type BriefingAnalysisFixtureId } from "./briefing-analysis-fixtures";
import { prepareBriefing } from "./briefing-pipeline";
import { benchPartition, BRIEFING_BENCH_MAX_INPUT_BYTES, BRIEFING_BENCH_RETENTION_DAYS, BRIEFING_BENCH_SCHEMA_VERSION, createBriefingBenchStore,
  isBriefingBenchStoreError, type BenchCase, type BenchCaseHistory, type BenchHistoryCoverage, type BriefingBenchStore } from "./briefing-bench-store";
import { guard, json, readComparisonBody } from "./briefing-workbench.service";
import { DailyBriefError, raceBriefAbort } from "./daily-brief-consumer";
import { runDailyBriefRequest } from "./daily-brief-request";
import { getCalendarEventsForWorkbenchHistory, type CalendarCaller } from "./google-calendar.service";
import { CalendarConnectionError } from "./google-calendar-oauth";

export const BRIEFING_HISTORY_DEFAULTS = Object.freeze({ targetDays: 14, maxTargetDays: 90, logicalTime: "07:00", timezone: "America/New_York" });
const RECONSTRUCTION_LIMIT = "Production advisor RPCs require today's local date. Retained records do not establish ingestion cutoffs or full historical state.";

export type BriefingHistoryInput = Readonly<{
  mode: "synthetic" | "account";
  fixtureId?: BriefingFixtureId;
  analysisFixtureId?: BriefingAnalysisFixtureId;
  accountRef?: string;
  preferenceRevision?: number;
  startLocalDate?: string;
  endLocalDate?: string;
  logicalTime?: string;
  timezone?: string;
  includePastCalendar?: boolean;
  configs: readonly BriefingConfig[];
  /** Save only this explicitly selected day. Discovery never saves account inputs automatically. */
  saveLocalDate?: string;
}>;

export type BriefingHistoryDay = Readonly<{
  localDate: string;
  logicalAt: string;
  evidenceType: "synthetic" | "retrospective";
  state: "available" | "unavailable";
  retainedCases: readonly Readonly<{ id: string; evidenceType: BenchCase["evidenceType"]; logicalAt: string; rerunnable: boolean }>[];
  coverage: readonly BenchHistoryCoverage[];
  /** Counts describe supplied retained rows. Null means no verified target-day source. */
  counts: Readonly<{ scheduled: number; completed: number; notCompleted: number; unresolved: number }> | null;
  inspections: readonly ReturnType<typeof prepareBriefing>[];
}>;

export type BriefingHistoryResponse = Readonly<{
  mode: BriefingHistoryInput["mode"];
  accountRef: string | null;
  observedAt: string;
  range: Readonly<{ startLocalDate: string; endLocalDate: string; targetDays: number; timezone: string; logicalTime: string;
    underlyingStartLocalDate: string; endLocalDateExclusive: string; lookbackDays: readonly number[] }>;
  reconstruction: Readonly<{ available: false; reason: string }>;
  days: readonly BriefingHistoryDay[];
  savedCaseId: string | null;
}>;

export async function readBriefingHistory(request: Request): Promise<Response> {
  return guard(request) ?? json({ defaults: BRIEFING_HISTORY_DEFAULTS, reconstruction: { available: false, reason: RECONSTRUCTION_LIMIT },
    retentionDays: BRIEFING_BENCH_RETENTION_DAYS, modelCalls: 0 });
}

/** No generator, provider model, production admission, or production tip-history writes. */
export async function inspectBriefingHistory(request: Request, store: BriefingBenchStore = createBriefingBenchStore()): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  let input: BriefingHistoryInput;
  try { input = parseInput(await raceBriefAbort(readComparisonBody(request), signal)); }
  catch { return json({ error: "invalid_request" }, 400); }
  const inspect = async (caller: CalendarCaller | null) => {
    try { return await inspectRange(input, caller, store, signal); }
    catch (error) {
      if (isBriefingBenchStoreError(error)) throw new DailyBriefError(error.code === "not_found" ? "case_not_found" : "invalid_request");
      throw error;
    }
  };
  if (input.mode === "account") return runDailyBriefRequest(request, inspect);
  try { return json(await inspect(null)); }
  catch (error) { return json({ error: error instanceof DailyBriefError ? error.code : signal.aborted ? "cancelled" : "invalid_request" }, 400); }
}

function parseInput(value: unknown): BriefingHistoryInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DailyBriefError("invalid_request");
  const item = value as Record<string, unknown>;
  const allowed = ["mode", "fixtureId", "analysisFixtureId", "accountRef", "preferenceRevision", "startLocalDate", "endLocalDate", "logicalTime", "timezone", "includePastCalendar", "configs", "saveLocalDate"];
  if (Object.keys(item).some(key => !allowed.includes(key)) || !["synthetic", "account"].includes(item.mode as string) ||
      !Array.isArray(item.configs) || item.configs.length < 1 || item.configs.length > 2 ||
      (item.logicalTime !== undefined && (typeof item.logicalTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.logicalTime))) ||
      (item.includePastCalendar !== undefined && typeof item.includePastCalendar !== "boolean")) throw new DailyBriefError("invalid_request");
  for (const key of ["startLocalDate", "endLocalDate", "saveLocalDate"] as const) if (item[key] !== undefined) parseDate(item[key]);
  if (item.timezone !== undefined) {
    if (typeof item.timezone !== "string" || item.timezone.length > 100 || /^[+-]/.test(item.timezone)) throw new DailyBriefError("invalid_request");
    Temporal.Instant.from("2026-01-01T00:00Z").toZonedDateTimeISO(item.timezone);
  }
  if (item.mode === "synthetic") {
    if (item.accountRef !== undefined || item.preferenceRevision !== undefined ||
        (item.fixtureId !== undefined && !BRIEFING_FIXTURE_IDS.includes(item.fixtureId as BriefingFixtureId)) ||
        (item.analysisFixtureId !== undefined && !BRIEFING_ANALYSIS_FIXTURE_IDS.includes(item.analysisFixtureId as BriefingAnalysisFixtureId)) || item.includePastCalendar === true) {
      throw new DailyBriefError("invalid_request");
    }
  } else if (typeof item.accountRef !== "string" || item.accountRef.length > 128 || !Number.isSafeInteger(item.preferenceRevision) ||
      (item.preferenceRevision as number) < 0 || item.fixtureId !== undefined || item.analysisFixtureId !== undefined) throw new DailyBriefError("invalid_request");
  return { ...item, mode: item.mode as BriefingHistoryInput["mode"], configs: item.configs.map(parseBriefingConfig) } as BriefingHistoryInput;
}

function parseDate(value: unknown): Temporal.PlainDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DailyBriefError("invalid_request");
  const date = Temporal.PlainDate.from(value);
  if (date.toString() !== value) throw new DailyBriefError("invalid_request");
  return date;
}

type AccountRows = Readonly<{ behaviors: readonly BehaviorWithCategory[]; occurrences: readonly Occurrence[] }>;
async function readAccountRows(caller: CalendarCaller, allowed: ReadonlySet<string>): Promise<AccountRows> {
  // Existing repositories enforce authenticated owner RLS, pagination, duplicate rejection and a 100,000-row ceiling.
  const [behaviors, occurrences] = await Promise.all([listUserBehaviors(caller.client, caller.user.id), listUserOccurrences(caller.client, caller.user.id)]);
  return { behaviors: behaviors.filter(row => allowed.has(row.id)), occurrences: occurrences.filter(row => allowed.has(row.behavior_id)) };
}

async function inspectRange(input: BriefingHistoryInput, caller: CalendarCaller | null, store: BriefingBenchStore, signal: AbortSignal): Promise<BriefingHistoryResponse> {
  const observed = Temporal.Now.instant();
  const historyDays = [...new Set(input.configs.map(config => config.scope.historyDays))];
  const capture = caller ? await raceBriefAbort(prepareAccountBriefingContexts(caller, { historyDays, includeCalendar: false, signal }), signal) : null;
  if (caller && (!capture || briefingAccountRef(caller.user.id) !== input.accountRef || capture.preferences.revision !== input.preferenceRevision)) throw new DailyBriefError("context_changed");
  const timezone = input.timezone ?? capture?.contexts[0].timezone ?? BRIEFING_HISTORY_DEFAULTS.timezone;
  if (capture && timezone !== capture.contexts[0].timezone) throw new DailyBriefError("invalid_request");
  const logicalTime = input.logicalTime ?? BRIEFING_HISTORY_DEFAULTS.logicalTime;
  const today = observed.toZonedDateTimeISO(timezone).toPlainDate();
  const end = input.endLocalDate ? parseDate(input.endLocalDate) : today.subtract({ days: 1 });
  const start = input.startLocalDate ? parseDate(input.startLocalDate) : end.subtract({ days: BRIEFING_HISTORY_DEFAULTS.targetDays - 1 });
  const targetDays = start.until(end).days + 1;
  if (targetDays < 1 || targetDays > BRIEFING_HISTORY_DEFAULTS.maxTargetDays || Temporal.PlainDate.compare(end, today) >= 0 ||
      (input.saveLocalDate && (input.saveLocalDate < start.toString() || input.saveLocalDate > end.toString()))) throw new DailyBriefError("invalid_request");
  const allowed = new Set(capture ? Object.keys(capture.configurationRefs).map(ref => ref) : []);
  if (caller && input.configs.some(config => (config.scope.behaviorRefs !== "all" && config.scope.behaviorRefs.some(ref => !allowed.has(ref))) ||
      config.planner.movableBehaviorRefs.some(ref => !allowed.has(ref)))) throw new DailyBriefError("invalid_request");
  const ownedBehaviorIds = caller ? new Set((await listUserBehaviors(caller.client, caller.user.id)).filter(row => allowed.has(workbenchBehaviorRef(caller.user.id, row.id))).map(row => row.id)) : new Set<string>();
  const rows = caller ? await raceBriefAbort(readAccountRows(caller, ownedBehaviorIds), signal) : null;
  const revision = rows ? digest(rows) : "synthetic";
  const analysisRows = caller && input.configs.some(config => config.analysis.lanes.length > 0) ? await raceBriefAbort(readAnalysisRows(caller, rows!, start.subtract({ days: 90 }).toString(), end.toString()), signal) : null;
  const accountRef = caller ? briefingAccountRef(caller.user.id) : null;
  const partition = benchPartition(accountRef);
  await store.pruneExpired(partition, new Date(observed.epochMilliseconds));
  const retained = await store.listCases(partition);
  const days: BriefingHistoryDay[] = [];
  let selected: { contexts: AdvisorDayContextV1[]; analysisSource: BriefingAnalysisSource | null; history: BenchCaseHistory } | null = null;
  const calendarRequested = !!(caller && capture && input.includePastCalendar && capture.preferences.includeCalendar && input.configs.some(config => config.scope.includeCalendar));
  const calendars = calendarRequested ? await readPastCalendars(caller!, start, end, timezone, signal) : new Map<string, AdvisorCalendarConnector>();
  for (let date = start; Temporal.PlainDate.compare(date, end) <= 0; date = date.add({ days: 1 })) {
    signal.throwIfAborted();
    const logical = date.toZonedDateTime({ timeZone: timezone, plainTime: logicalTime }).toInstant();
    let coverage = sourceCoverage(date, historyDays, rows, input, calendars.get(date.toString()), !!analysisRows);
    const targetCount = rows?.occurrences.filter(row => row.local_date === date.toString()).length;
    const available = !rows || (!!targetCount && targetCount <= ADVISOR_DAY_CONTEXT_LIMITS.occurrences);
    const contexts = !available ? [] : rows && capture && caller ? retrospectiveContexts(rows, date, logical, timezone, historyDays, caller, capture.preferences.revision, calendarRequested, capture.preferences, calendars.get(date.toString()))
      : historyDays.map(days => historicalFixture(input.fixtureId ?? "sparse", { ...input.configs[0],
        scope: { ...input.configs[0].scope, historyDays: days },
        context: { ...input.configs[0].context, includeHistoricalCompletionTimes: true } }, date, timezone, logical));
    const source = !contexts.length ? null : rows && caller ? analysisRows ? retrospectiveAnalysis(rows, analysisRows, contexts[0], caller) : null
      : briefingAnalysisFixture(input.analysisFixtureId ?? "none", contexts[0]);
    if (source && (source.completeness === "capped" || source.statusEvents.state === "capped" || source.configurationPeriods.state === "capped")) {
      coverage = coverage.map(row => row.source === "analysis" ? { ...row, state: "capped" } : row);
    }
    const inspections = available ? input.configs.map(config => prepareBriefing(contexts.find(context => context.cadence.history.lookbackDays === config.scope.historyDays)!, config, logical.toString(), { source, cadenceComplete: !rows })) : [];
    const first = contexts[0];
    const count = first?.cadence.occurrences ?? [];
    days.push({ localDate: date.toString(), logicalAt: logical.toString(), evidenceType: rows ? "retrospective" : "synthetic", state: available ? "available" : "unavailable",
      retainedCases: await Promise.all(retained.filter(item => item.localDate === date.toString()).map(async item => {
        const saved = (await store.readCase(partition, item.id)).case;
        return { id: saved.id, evidenceType: saved.evidenceType, logicalAt: saved.capturedAt, rerunnable: item.rerunnable };
      })), coverage, counts: available ? { scheduled: count.length, completed: count.filter(row => row.status === "completed").length,
        notCompleted: count.filter(row => row.status === "not_completed").length, unresolved: count.filter(row => row.status === "unresolved").length } : null,
      inspections: available ? inspections : [] });
    if (date.toString() === input.saveLocalDate && available) selected = { contexts, analysisSource: source, history: {
      version: 1, observedAt: observed.toString(), logicalTime, lookbackDays: historyDays, coverage,
      cutoff: rows ? "local-date half-open lookback; current retained state, no as-of reconstruction" : "authored synthetic evaluation",
    } };
  }
  if (capture) await raceBriefAbort(capture.assertCurrent(), signal);
  if (caller && digest(await raceBriefAbort(readAccountRows(caller, ownedBehaviorIds), signal)) !== revision) throw new DailyBriefError("context_changed");
  if (caller && analysisRows && digest(await raceBriefAbort(readAnalysisRows(caller, rows!, start.subtract({ days: 90 }).toString(), end.toString()), signal)) !== digest(analysisRows)) throw new DailyBriefError("context_changed");
  signal.throwIfAborted();
  let savedCaseId: string | null = null;
  if (input.saveLocalDate) {
    if (!selected) throw new DailyBriefError("input_not_captured");
    const inputs = { contexts: selected.contexts, analysisSource: selected.analysisSource,
      configurationRefs: caller ? Object.fromEntries([...ownedBehaviorIds].map(id => [workbenchBehaviorRef(caller.user.id, id), workbenchBehaviorRef(caller.user.id, id)])) : {} };
    if (Buffer.byteLength(JSON.stringify(inputs), "utf8") > BRIEFING_BENCH_MAX_INPUT_BYTES) throw new DailyBriefError("input_not_captured");
    const titles = new Map<string, string>();
    for (const context of selected.contexts) for (const occurrence of context.cadence.occurrences) titles.set(occurrence.behaviorRef, occurrence.title);
    const first = selected.contexts[0];
    savedCaseId = randomUUID();
    const record: BenchCase = { schemaVersion: BRIEFING_BENCH_SCHEMA_VERSION, kind: "case", id: savedCaseId, createdAt: observed.toString(),
      source: caller && capture ? { mode: "account", accountRef: accountRef!, preferenceRevision: capture.preferences.revision }
        : { mode: "synthetic", fixtureId: input.fixtureId ?? "sparse", fixtureVersion: BRIEFING_FIXTURE_VERSION, analysisFixtureId: input.analysisFixtureId ?? null, analysisFixtureVersion: BRIEFING_ANALYSIS_FIXTURE_VERSION },
      evidenceType: caller ? "retrospective" : "synthetic", history: selected.history, localDate: first.localDate, timezone, capturedAt: first.capturedAt, expiresAt: first.expiresAt,
      capture: { historyDays, includeCalendar: caller ? calendarRequested : input.configs.some(config => config.scope.includeCalendar),
        calendarDisclosed: capture?.preferences.includeCalendar ?? true, includeRecordedElapsedDurations: input.configs.some(config => config.context.includeRecordedElapsedDurations),
        includeHistoricalCompletionTimes: input.configs.some(config => config.context.includeHistoricalCompletionTimes), analysis: input.configs.some(config => config.analysis.lanes.length > 0),
        includeReminders: false, remindersDisclosed: capture?.preferences.includeReminderHistory ?? false, includeNotes: false, notesDisclosed: capture?.preferences.includeNotes ?? false },
      inputs, behaviorTitles: [...titles].map(([ref, title]) => ({ ref, title })) };
    await store.createCase(partition, record);
    try { if (capture) await raceBriefAbort(capture.assertCurrent(), signal); signal.throwIfAborted(); }
    catch (error) { await store.deleteCase(partition, savedCaseId); throw error; }
  }
  return { mode: input.mode, accountRef, observedAt: observed.toString(), range: { startLocalDate: start.toString(), endLocalDate: end.toString(), targetDays, timezone, logicalTime,
    underlyingStartLocalDate: start.subtract({ days: 90 }).toString(), endLocalDateExclusive: end.add({ days: 1 }).toString(), lookbackDays: historyDays },
    reconstruction: { available: false, reason: RECONSTRUCTION_LIMIT }, days, savedCaseId };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ownerRef = (caller: CalendarCaller): AdvisorOpaqueRef => (kind, id) => kind === "behavior" ? workbenchBehaviorRef(caller.user.id, id)
  : `${kind}_${digest([briefingAccountRef(caller.user.id), kind, id])}`;

async function readAnalysisRows(caller: CalendarCaller, rows: AccountRows, start: string, end: string) {
  const ids = rows.occurrences.filter(row => row.local_date >= start && row.local_date <= end).map(row => row.id);
  const [statusEvents, configurations] = await Promise.all([listOccurrenceStatusEventsByOccurrenceIds(caller.client, caller.user.id, ids), listBehaviorConfigurationEvents(caller.client, caller.user.id)]);
  const allowed = new Set(rows.behaviors.map(row => row.id));
  return { statusEvents, configurations: configurations.filter(row => allowed.has(row.behavior_id)) };
}

function retrospectiveAnalysis(rows: AccountRows, analysis: Awaited<ReturnType<typeof readAnalysisRows>>, context: AdvisorDayContextV1, caller: CalendarCaller): BriefingAnalysisSource {
  const start = Temporal.PlainDate.from(context.localDate).subtract({ days: 90 }).toString();
  const occurrences = rows.occurrences.filter(row => row.local_date >= start && row.local_date < context.localDate);
  const ids = new Set(occurrences.map(row => row.id));
  return projectBriefingAnalysisSource({ timezone: context.timezone, observedAt: context.capturedAt, revision: digest([occurrences, analysis]),
    occurrences: occurrences.map(row => ({ id: row.id, behaviorId: row.behavior_id, localDate: row.local_date, scheduledFor: row.scheduled_for, scheduleKind: row.schedule_kind,
      scheduleStartTime: row.schedule_start_time, scheduleEndTime: row.schedule_end_time, status: row.status, statusMarkedAt: row.status_marked_at, configurationEventId: row.behavior_configuration_event_id })),
    statusEvents: analysis.statusEvents.filter(row => ids.has(row.occurrence_id)).map(row => ({ id: row.id, occurrenceId: row.occurrence_id, previousStatus: row.previous_status,
      status: row.status, semantics: row.status_semantics, recordedAt: row.recorded_at, revisesEventId: row.revises_event_id })),
    configurationEvents: analysis.configurations.filter(row => row.effective_local_date <= context.localDate).map(row => {
      const configuration = row.next_configuration && typeof row.next_configuration === "object" && !Array.isArray(row.next_configuration) ? row.next_configuration : {};
      return { id: row.id, behaviorId: row.behavior_id, eventKind: row.event_kind, effectiveAt: row.effective_at, effectiveLocalDate: row.effective_local_date,
        changedFields: row.changed_fields, source: row.source, reasonCode: row.reason_code, browserReminderEnabled: configuration.browser_reminder_enabled === true,
        emailReminderEnabled: configuration.email_reminder_enabled === true };
    }), reminders: "not_requested", notes: "not_requested",
  }, { context, makeOpaqueRef: ownerRef(caller), startLocalDate: start });
}

async function readPastCalendars(caller: CalendarCaller, start: Temporal.PlainDate, end: Temporal.PlainDate, timezone: string, signal: AbortSignal): Promise<Map<string, AdvisorCalendarConnector>> {
  const days = new Map<string, AdvisorCalendarConnector>();
  for (let first = start; Temporal.PlainDate.compare(first, end) <= 0; first = first.add({ days: 31 })) {
    const limit = first.add({ days: 30 }), last = Temporal.PlainDate.compare(limit, end) < 0 ? limit : end;
    signal.throwIfAborted();
    try {
      const read = await raceBriefAbort(getCalendarEventsForWorkbenchHistory(caller, first.toString(), last.toString(), { signal }), signal);
      const snapshot = read.result.ok ? read.result.snapshot : read.result.partialSnapshot;
      if (!snapshot) continue;
      const connector = projectAdvisorCalendarConnector({ snapshot, selectionRevision: read.connection.selectionRevision, now: Temporal.Now.instant(),
        makeOpaqueRef: ownerRef(caller), failure: read.result.ok ? null : read.result.error });
      for (let date = first; Temporal.PlainDate.compare(date, last) <= 0; date = date.add({ days: 1 })) {
        const next = date.add({ days: 1 }), dayStart = date.toZonedDateTime({ timeZone: timezone, plainTime: "00:00" }).toInstant(),
          dayEnd = next.toZonedDateTime({ timeZone: timezone, plainTime: "00:00" }).toInstant();
        // Provider coverage stays bounded by both the requested range and each actual Calendar coverage row.
        const inRequestedRange = snapshot.requestedRange.startLocalDate <= date.toString() && snapshot.requestedRange.endLocalDate >= date.toString();
        const dayCoverage = connector.coverage.filter(row => inRequestedRange && row.startLocalDate <= date.toString() && row.endLocalDate >= date.toString());
        const complete = connector.complete && dayCoverage.length > 0 && dayCoverage.length === connector.coverage.length && dayCoverage.every(row => row.paginationComplete);
        days.set(date.toString(), { ...connector, complete, state: connector.state === "current" && !complete ? "incomplete" : connector.state,
          failure: complete ? null : connector.failure ?? { code: "incomplete_pagination", retryable: false, retryAfterSeconds: null },
          coverage: dayCoverage.map(row => ({ ...row, startLocalDate: date.toString(), endLocalDate: date.toString() })),
          events: complete ? connector.events.filter(event => event.interval.kind === "all_day"
            ? event.interval.startLocalDate < next.toString() && event.interval.endLocalDate > date.toString()
            : Temporal.Instant.compare(Temporal.Instant.from(event.interval.startAt), dayEnd) < 0 && Temporal.Instant.compare(Temporal.Instant.from(event.interval.endAt), dayStart) > 0) : [] });
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CalendarConnectionError && ["permission_denied", "connection_changed", "same_account_required"].includes(error.code)) throw error;
      // A failed or capped provider snapshot stays unavailable. Never claim an empty past Calendar.
    }
  }
  return days;
}

function sourceCoverage(date: Temporal.PlainDate, historyDays: readonly number[], rows: AccountRows | null, input: BriefingHistoryInput, calendar?: AdvisorCalendarConnector, analysisRead = false): BenchHistoryCoverage[] {
  const start = date.subtract({ days: 90 }).toString(), end = date.toString();
  const historyRows = rows?.occurrences.filter(row => row.local_date >= start && row.local_date < end).length ?? null;
  const entry = (source: BenchHistoryCoverage["source"], state: BenchHistoryCoverage["state"], limitations: readonly string[], retainedRows: number | null = null,
    from = start, through = end): BenchHistoryCoverage => ({ source, state, startLocalDate: from, endLocalDateExclusive: through, retainedRows, limitations });
  if (!rows) return [entry("occurrences", "synthetic", ["Authored fixture; no account or provider history."], null, end, date.add({ days: 1 }).toString()),
    ...historyDays.map(days => entry("completion_history", input.fixtureId === "incomplete_history" ? "unknown" : "synthetic", ["Synthetic daily records only."], null, date.subtract({ days }).toString())),
    entry("durations", input.fixtureId === "incomplete_history" ? "unknown" : "synthetic", ["Authored durations; no elapsed-time reconstruction."]),
    entry("calendar", input.fixtureId === "calendar_absent" ? "not_requested" : "synthetic", ["Authored Calendar intervals; historical Calendar-pattern lane remains unavailable."], null, end, date.add({ days: 1 }).toString())];
  const targetRows = rows.occurrences.filter(row => row.local_date === end).length;
  return [entry("occurrences", targetRows > ADVISOR_DAY_CONTEXT_LIMITS.occurrences ? "capped" : targetRows ? "retained" : "unknown", ["Current owner-authorized rows only. Later corrections, imports and late creation remain current retained state.",
    "Deleted and archived Behaviors are excluded. Missing dates do not prove a quiet day. Stable row order: local_date, scheduled_for, id.",
    "Existing reads paginate at 1,000 rows and fail above 100,000; no truncated result is returned. A day above 200 retained occurrences is unavailable."], targetRows, end, date.add({ days: 1 }).toString()),
    ...historyDays.map(days => entry("completion_history", "unknown", ["Original occurrence coverage, late ingestion and deleted records cannot be reconstructed. Counts remain unknown."],
      rows.occurrences.filter(row => row.local_date >= date.subtract({ days }).toString() && row.local_date < end).length, date.subtract({ days }).toString())),
    entry("durations", "unknown", ["Elapsed sessions and their ingestion/deletion history are not captured. No zero total or historical average is substituted."], historyRows),
    entry("configuration", "retained", ["Retained occurrence schedule snapshots and current titles/default durations only. No effective/recorded/ingested as-of reconstruction."]),
    entry("timezone", "unknown", ["The current account timezone defines replay day boundaries. Historical timezone changes are not reconstructed."]),
    entry("notes", "unavailable", ["Current Note text does not establish past Note state. No historical Note text is supplied."]),
    entry("reminders", "unavailable", ["Current delivery status and send time do not establish past reminder state."]),
    entry("analysis", analysisRead ? "retained" : "not_requested", ["Current retained occurrence/status/configuration records only. Ingestion and later revisions never establish facts known at the replay cutoff.",
      "Analysis caps: 10,000 occurrences, 20,000 status events, 2,000 configuration events. A capped source never becomes complete."], historyRows),
    entry("calendar", calendar?.complete ? "retained" : input.includePastCalendar ? "unavailable" : "not_requested", [calendar ? `Retrospective provider snapshot read at ${calendar.fetchedAt ?? "unknown live time"}; not Calendar as known on the selected morning.`
      : input.includePastCalendar ? "Past Calendar is unavailable or not currently disclosed; no empty Calendar is substituted." : "Past Calendar requires a separate explicit request.",
      "A retrospective past Calendar day never enables the historical Calendar-pattern lane."], null, end, date.add({ days: 1 }).toString())];
}

function retrospectiveContexts(rows: AccountRows, date: Temporal.PlainDate, logical: Temporal.Instant, timezone: string, windows: readonly number[], caller: CalendarCaller,
  grantGeneration: number, includeCalendar: boolean, preferences: { calendarConnectionGeneration: number | null; calendarSelectionRevision: number | null }, calendar?: AdvisorCalendarConnector): AdvisorDayContextV1[] {
  const ref = ownerRef(caller);
  const byId = new Map(rows.behaviors.map(behavior => [behavior.id, behavior]));
  const unknownAverage = { kind: "unknown" as const, reason: "history_limit_exceeded" as const, sampleCount: 0 as const, requiredSampleCount: 3 as const, lookbackDays: 90 as const };
  const occurrences = rows.occurrences.filter(row => row.local_date === date.toString()).map(row => {
    const behavior = byId.get(row.behavior_id);
    if (!behavior || (row.schedule_kind !== "exact" && row.schedule_kind !== "range") || !["unresolved", "completed", "not_completed"].includes(row.status)) throw new DailyBriefError("context_changed");
    const configured = resolveBehaviorDurationSources({ behaviorId: behavior.id, defaultDurationMinutes: behavior.default_duration_minutes, occurrences: [], now: logical, timezone }).configuredDefault;
    return { id: row.id, behaviorId: row.behavior_id, title: behavior.title, status: row.status as OccurrenceStatus, localDate: row.local_date, scheduledFor: row.scheduled_for,
      scheduleKind: row.schedule_kind as "exact" | "range", scheduleStartTime: row.schedule_start_time, scheduleEndTime: row.schedule_end_time, duration: configured ?? unknownAverage,
      durationCandidates: { configuredDefault: configured ? { kind: "known" as const, seconds: configured.seconds, source: "behavior_default" as const, sampleCount: 0, lookbackDays: 90 as const } : null,
        historicalAverage: { kind: "unknown" as const, reason: "history_limit_exceeded" as const, sampleCount: 0, lookbackDays: 90 as const } } };
  });
  const connectors: AdvisorDayContextV1["connectors"] = includeCalendar ? [calendar ? { ...calendar, fetchedAt: calendar.fetchedAt ? logical.toString() : null }
    : projectUnavailableAdvisorCalendar({ connectionGeneration: preferences.calendarConnectionGeneration!, selectionRevision: preferences.calendarSelectionRevision!,
      failure: { code: "provider_unavailable", retryable: false, retryAfterSeconds: null } })] : [{ source: "google_calendar", state: "not_requested" }];
  const start = date.toZonedDateTime({ timeZone: timezone, plainTime: "00:00" }).toInstant(), end = date.add({ days: 1 }).toZonedDateTime({ timeZone: timezone, plainTime: "00:00" }).toInstant();
  const expiry = logical.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs });
  return windows.map(historyDays => validateAdvisorDayContext({ version: ADVISOR_DAY_CONTEXT_VERSION, snapshotId: ref("snapshot", `${date}:${historyDays}:${digest(rows)}`),
    accountRef: briefingAccountRef(caller.user.id), localDate: date.toString(), timezone, dayStartAt: start.toString(), dayEndAt: end.toString(), capturedAt: logical.toString(),
    expiresAt: (Temporal.Instant.compare(expiry, end) < 0 ? expiry : end).toString(), status: includeCalendar && !calendar?.complete ? "partial" : "complete", authority: "read_only", grantGeneration,
    // These timestamps adapt evaluation freshness only. BenchCase.history.observedAt retains the actual live read clock.
    cadence: projectAdvisorCadenceSource({ observedAt: logical.toString(), revision: digest(rows), historyStartLocalDate: date.subtract({ days: historyDays }).toString(),
      historyEndLocalDateExclusive: date.toString(), historyDays, behaviors: rows.behaviors, historyOccurrences: [], historyComplete: false, occurrences, makeOpaqueRef: ref }), connectors }));
}

/** Materializes authored fixture clocks across DST without treating elapsed days as 24 hours. */
export function historicalFixture(id: BriefingFixtureId, config: BriefingConfig, date: Temporal.PlainDate, timezone: string, logical: Temporal.Instant): AdvisorDayContextV1 {
  const base = briefingFixture(id, config), baseDate = Temporal.PlainDate.from(base.localDate);
  const moveDate = (old: string) => date.add({ days: baseDate.until(Temporal.PlainDate.from(old)).days }).toString();
  const moveInstant = (old: string) => {
    const zoned = Temporal.Instant.from(old).toZonedDateTimeISO(base.timezone);
    return Temporal.PlainDate.from(moveDate(zoned.toPlainDate().toString())).toZonedDateTime({ timeZone: timezone, plainTime: zoned.toPlainTime() }).toInstant().toString();
  };
  const dayStartAt = date.toZonedDateTime({ timeZone: timezone, plainTime: "00:00" }).toInstant().toString();
  const dayEnd = date.add({ days: 1 }).toZonedDateTime({ timeZone: timezone, plainTime: "00:00" }).toInstant();
  const expiry = logical.add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs });
  return validateAdvisorDayContext({ ...base, snapshotId: `snapshot_history_${id}_${date}_${config.scope.historyDays}`, localDate: date.toString(), timezone,
    dayStartAt, dayEndAt: dayEnd.toString(), capturedAt: logical.toString(), expiresAt: (Temporal.Instant.compare(expiry, dayEnd) < 0 ? expiry : dayEnd).toString(),
    cadence: { ...base.cadence, observedAt: logical.toString(), occurrences: base.cadence.occurrences.map(row => ({ ...row, localDate: moveDate(row.localDate), scheduledFor: moveInstant(row.scheduledFor) })),
      history: { ...base.cadence.history, startLocalDate: moveDate(base.cadence.history.startLocalDate), endLocalDateExclusive: date.toString() },
      ...(base.cadence.recordedElapsedDurations ? { recordedElapsedDurations: base.cadence.recordedElapsedDurations.map(row => ({ ...row, localDate: moveDate(row.localDate) })) } : {}),
      ...(base.cadence.historicalCompletionTimes ? { historicalCompletionTimes: { ...base.cadence.historicalCompletionTimes, timezone,
        startLocalDate: moveDate(base.cadence.historicalCompletionTimes.startLocalDate), endLocalDateExclusive: date.toString() } } : {}) },
    connectors: base.connectors.map(connector => connector.state === "not_requested" ? connector : { ...connector, fetchedAt: connector.fetchedAt ? logical.toString() : null,
      coverage: connector.coverage.map(row => ({ ...row, startLocalDate: moveDate(row.startLocalDate), endLocalDate: moveDate(row.endLocalDate) })),
      events: connector.events.map(event => ({ ...event, sourceTimezone: timezone, interval: event.interval.kind === "all_day"
        ? { ...event.interval, startLocalDate: moveDate(event.interval.startLocalDate), endLocalDate: moveDate(event.interval.endLocalDate) }
        : { ...event.interval, startAt: moveInstant(event.interval.startAt), endAt: moveInstant(event.interval.endAt), duration: event.interval.duration.kind === "known"
          ? { kind: "known", seconds: Temporal.Instant.from(moveInstant(event.interval.startAt)).until(Temporal.Instant.from(moveInstant(event.interval.endAt))).total("seconds") } : event.interval.duration } })) }),
  });
}
