import { noticeText } from "@cadence/core/notices";
import { Temporal } from "@js-temporal/polyfill";
import { DAILY_BRIEF_CONNECTED_SOURCES, DAILY_BRIEF_POLICY_VERSION, type DailyBriefConnectedSource, type DailyBriefing, type DailyBriefNotice, type DailyBriefResponse, type DailyBriefSettings, type DailyBriefSourceStatus } from "@cadence/core/types/daily-brief";
import { BRIEF_MOVE_LINES_FEATURE, BRIEF_MOVES_VERSION, type BriefMoveConflictLine, type BriefMoveLine, type BriefMoves, type BriefPlanningContext } from "@cadence/core/types/brief-moves";
import type { AdvisorDayContext } from "@cadence/core/types/advisor-day-context";
import { dailyBriefChoiceFromAllowed, dailyBriefReadsGoogleCalendar, dailyBriefSourceFlags, dailyBriefSourcesUsed } from "@cadence/core/services/daily-brief-sources";
import { readAdvisorProfileTimezone } from "@/lib/db/advisor-context.repo";
import { readStoredAiSettings, saveStoredAiSettings, type AiSettingsWrite, type StoredAiSettings } from "@/lib/db/ai-settings.repo";
import { beginDailyBrief, finishDailyBrief, readDailyBriefPreferences, saveDailyBrief, saveDailyBriefPreferences, type DailyBriefBeginResult, type DailyBriefPreferenceInput, type DailyBriefPreferences } from "@/lib/db/daily-brief.repo";
import { agentBriefRefreshFunded } from "@/lib/db/agent-runs.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { agentCallerConfigured, createAgentClient } from "@/lib/integrations/agent-caller";
import { modelPrice } from "./agent-model-pricing";
import { BRIEF_OPENING_PROMPT_REVISION, prepareBriefOpening, stockBriefOpening, validateBriefOpening, type BriefOpeningLine, type BriefOpeningText } from "./brief-opening";
import { ensureBehaviorEstimates, planBriefMoveLines, readBriefMoves, readOpenBriefConflicts, saveBriefProposals } from "./brief-moves.service";
import { briefOpportunitiesFor, planBriefOpportunityDay, readBriefOpportunities, saveBriefOpportunityProposals } from "./brief-opportunities.service";
import { BRIEF_OPPORTUNITY_LINES_FEATURE } from "@cadence/core/types/brief-opportunities";
import { BRIEF_ALONGSIDE_QUESTION_FEATURE, type BriefAlongsideQuestion } from "@cadence/core/types/brief-alongside";
import { planBriefAlongsideQuestion, recordBriefAlongsideQuestionAsked, reopenBriefAlongsideQuestion } from "./brief-alongside.service";
import { alongsideEnabled } from "./alongside-flag";
import { prepareAccountBriefingContexts, briefingAccountRef } from "./briefing-account-context.service";
import { DailyBriefError, raceBriefAbort as raceAbort, sumDailyBriefUsage, type DailyBriefCallUsage, type DailyBriefGenerator, type DailyBriefModelUsage } from "./daily-brief-consumer";
import { dailyBriefModelSetting, generateBriefOpeningWithModel, generateDurationEstimatesWithModel } from "./daily-brief-model";
import { agentModelConfigured } from "./agent-model";
import { beginDailyBriefAgentRun, dailyBriefContextIsCalendarDerived, type DailyBriefAgentRun } from "./daily-brief-agent-run";
import { getCalendarConnection, type CalendarCaller } from "./google-calendar.service";
import { getOutlookCalendarConnection } from "./outlook-calendar.service";
import { getIcloudCalendarConnection } from "./icloud-calendar.service";
import { getHevyConnection } from "./hevy.service";

import { activeBriefingConfig, briefingConfigurationRevision } from "./briefing-pipeline";
import { measurePerformanceSpan, type PerformanceTimingCounts } from "./performance-timing";
import { readTravelConclusionsSecrets } from "./travel-conclusions-token";
import { dailyBriefDeviceModelAvailable } from "./daily-brief-device-envelope";

/** The whole in-app attempt, and the time kept back for generation after connector reads (Ticket 239). */
export const DAILY_BRIEF_DEADLINE_MS = 60_000;
export const DAILY_BRIEF_GENERATION_RESERVE_MS = 10_000;
/** Run-log writes stop this long before the request deadline (advisor plan Phase 1A). */
export const DAILY_BRIEF_LOG_MARGIN_MS = 2_000;

/** Per-source key sets sent by clients built before Ticket 306. */
const LEGACY_SETTINGS_KEY_SETS = [
  "enabled,includeCalendar",
  "enabled,includeCalendar,includeNotes,includeReminderHistory",
  "enabled,includeCalendar,includeHevy,includeIcloudCalendar,includeNotes,includeOutlookCalendar,includeReminderHistory",
];
const SETTINGS_KEYS = "enabled,excludedSources,includeNotes,includeReminderHistory,useConnectedSources";
/** Advisor 4F: every AI choice at once. Source choices no longer depend on Daily Brief being on. */
const AI_SETTINGS_KEYS = "chatEnabled,enabled,excludedSources,includeNotes,includeReminderHistory,tipsEnabled,useConnectedSources";
const AI_SETTINGS_WITH_LONGITUDINAL_KEYS = "chatEnabled,enabled,excludedSources,includeNotes,includeReminderHistory,longitudinalCalendarReviewCadence,longitudinalCalendarReviewEnabled,tipsEnabled,useConnectedSources";
/** Advisor 4F: the answer to the one AI features question. */
const AI_APPROVAL_KEYS = "approval";
const EXCLUDED_SOURCE_KEYS = [...DAILY_BRIEF_CONNECTED_SOURCES].sort().join();

/** Phase diagnostics record span, duration and error code only; never prompts, facts or output. */
const phase = <T,>(span: string, operation: () => Promise<T>) => measurePerformanceSpan({ span: `daily_brief.${span}` }, operation);

/** Ticket 288: token counts for the `daily_brief.model` span, summed across the calls that reported usage. */
export function dailyBriefUsageCounts(usage: readonly DailyBriefCallUsage[]): PerformanceTimingCounts {
  if (!usage.length) return {};
  const total = sumDailyBriefUsage(usage);
  return { usage_calls: total.calls, input_tokens: total.inputTokens, cached_input_tokens: total.cachedInputTokens,
    output_tokens: total.outputTokens, reasoning_tokens: total.reasoningTokens };
}

export async function getDailyBriefSettings(caller: CalendarCaller): Promise<DailyBriefSettings> {
  const preferences = await readDailyBriefPreferences(caller.client);
  const [timezone, sourceStatus, ai, timelineGoogle, agentGoogle] = await Promise.all([
    readAdvisorProfileTimezone(caller.client, caller.user.id),
    readDailyBriefSourceStatus(caller, preferences),
    // A server whose database lacks the 4F migration reports no AI features question.
    readStoredAiSettings(caller.client).catch(() => null),
    getCalendarConnection(caller, "standard").catch(() => null),
    getCalendarConnection(caller, "agent").catch(() => null),
  ]);
  const used = dailyBriefSourcesUsed(preferences, sourceStatus);
  return { accountRef: briefingAccountRef(caller.user.id), available: agentModelConfigured(),
    deviceModelAvailable: dailyBriefDeviceModelAvailable(process.env),
    configurationRevision: briefingConfigurationRevision(), enabled: preferences.enabled,
    useConnectedSources: preferences.useConnectedSources, excludedSources: preferences.excludedSources, sourceStatus,
    includeReminderHistory: preferences.includeReminderHistory, includeNotes: preferences.includeNotes, revision: preferences.revision,
    optionalSources: dailyBriefOptionalSources(),
    // Clients built before Ticket 306 show these as per-source checkboxes: each reports whether the brief uses the source now.
    includeCalendar: used.googleCalendar, includeOutlookCalendar: used.outlookCalendar, includeIcloudCalendar: used.icloudCalendar, includeHevy: used.hevy,
    connectorSources: { outlookCalendar: sourceStatus.outlookCalendar === "ready", icloudCalendar: sourceStatus.icloudCalendar === "ready", hevy: sourceStatus.hevy === "ready" },
    connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: null },
    timezone, localDate: Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate().toString(),
    timelineGoogleCalendarConnected: timelineGoogle?.status === "connected",
    googleCalendarAiGeneration: agentGoogle?.status === "connected" ? agentGoogle.generation : null,
    googleCalendarAiSelectionRevision: agentGoogle?.status === "connected" ? agentGoogle.selectionRevision : null,
    ...(ai ? {
      ai: { approved: ai.approvedAt !== null, tipsEnabled: ai.tipsEnabled, chatEnabled: ai.chatEnabled },
      longitudinalCalendarReviewEnabled: ai.longitudinalCalendarReviewEnabled ?? false,
      longitudinalCalendarReviewCadence: ai.longitudinalCalendarReviewCadence ?? "weekly",
    } : {}) };
}

/**
 * Accepts the Ticket 306 shape: the one connected-sources choice, per-source
 * exclusions, and the reminder-history and Notes choices. Older clients send two,
 * four or seven per-source keys; their saves map to the one choice, and every
 * source they leave off starts excluded, so an older save never adds a source.
 * Turning Daily Brief off requires every other choice off.
 */
export async function updateDailyBriefSettings(caller: CalendarCaller, value: unknown): Promise<DailyBriefSettings> {
  if (record(value)) {
    const keys = Object.keys(value).sort().join();
    if (keys === AI_SETTINGS_KEYS || keys === AI_SETTINGS_WITH_LONGITUDINAL_KEYS || Object.keys(value).join() === AI_APPROVAL_KEYS) {
      return updateAiSettings(caller, value);
    }
  }
  const input = parseDailyBriefSettingsInput(value);
  if (!input) throw new DailyBriefError("invalid_request");
  // Ticket 298: a server that offers only the device model still lets a linked Mac turn the brief on.
  if (input.enabled && !agentModelConfigured() && !dailyBriefDeviceModelAvailable(process.env)) throw new DailyBriefError("not_configured");
  const current = await readDailyBriefPreferences(caller.client);
  await saveDailyBriefPreferences(caller.client, input, current.revision);
  return getDailyBriefSettings(caller);
}

/**
 * Advisor 4F. Saves every AI choice and records the approval. `{ approval: "all_on" }`
 * turns every feature and source on; `{ approval: "all_off" }` turns every feature off
 * and keeps the source choices as stored. Daily Brief turns on only where this server
 * can run it.
 */
async function updateAiSettings(caller: CalendarCaller, value: Record<string, unknown>): Promise<DailyBriefSettings> {
  const briefCanRun = agentModelConfigured() || dailyBriefDeviceModelAvailable(process.env);
  const [current, preferences] = await Promise.all([readStoredAiSettings(caller.client), readDailyBriefPreferences(caller.client)]);
  const input = parseAiSettingsInput(value, current, briefCanRun);
  if (!input) throw new DailyBriefError("invalid_request");
  if (input.dailyBriefEnabled && !briefCanRun) throw new DailyBriefError("not_configured");
  await saveStoredAiSettings(caller.client, input, preferences.revision);
  return getDailyBriefSettings(caller);
}

export function parseAiSettingsInput(value: Record<string, unknown>, current: StoredAiSettings, briefCanRun: boolean): AiSettingsWrite | null {
  if (Object.keys(value).join() === AI_APPROVAL_KEYS) {
    if (value.approval === "all_on") {
      return { dailyBriefEnabled: briefCanRun, tipsEnabled: true, chatEnabled: true, includeNotes: true, includeReminderHistory: true,
        useConnectedSources: true, excludedSources: dailyBriefSourceFlags(() => false) };
    }
    if (value.approval === "all_off") {
      return { dailyBriefEnabled: false, tipsEnabled: false, chatEnabled: false, includeNotes: current.includeNotes,
        includeReminderHistory: current.includeReminderHistory, useConnectedSources: current.useConnectedSources, excludedSources: current.excludedSources };
    }
    return null;
  }
  const excluded = value.excludedSources;
  if (!record(excluded) || Object.keys(excluded).sort().join() !== EXCLUDED_SOURCE_KEYS ||
      Object.values(excluded).some((item) => typeof item !== "boolean") ||
      [value.enabled, value.tipsEnabled, value.chatEnabled, value.useConnectedSources, value.includeReminderHistory, value.includeNotes]
        .some((item) => typeof item !== "boolean")) return null;
  const hasLongitudinal = value.longitudinalCalendarReviewEnabled !== undefined || value.longitudinalCalendarReviewCadence !== undefined;
  if (hasLongitudinal) {
    if (typeof value.longitudinalCalendarReviewEnabled !== "boolean") return null;
    if (value.longitudinalCalendarReviewCadence !== "weekly" && value.longitudinalCalendarReviewCadence !== "monthly") return null;
  }
  return {
    dailyBriefEnabled: value.enabled as boolean, tipsEnabled: value.tipsEnabled as boolean, chatEnabled: value.chatEnabled as boolean,
    useConnectedSources: value.useConnectedSources as boolean,
    excludedSources: dailyBriefSourceFlags((source) => excluded[source] === true),
    includeReminderHistory: value.includeReminderHistory as boolean, includeNotes: value.includeNotes as boolean,
    ...(hasLongitudinal ? {
      longitudinalCalendarReviewEnabled: value.longitudinalCalendarReviewEnabled as boolean,
      longitudinalCalendarReviewCadence: value.longitudinalCalendarReviewCadence as "weekly" | "monthly",
    } : {}),
  };
}

function parseDailyBriefSettingsInput(value: unknown): DailyBriefPreferenceInput | null {
  if (!record(value)) return null;
  const keys = Object.keys(value).sort().join();
  if (keys === SETTINGS_KEYS) {
    const excluded = value.excludedSources;
    if (!record(excluded) || Object.keys(excluded).sort().join() !== EXCLUDED_SOURCE_KEYS ||
        Object.values(excluded).some((item) => typeof item !== "boolean") ||
        [value.enabled, value.useConnectedSources, value.includeReminderHistory, value.includeNotes].some((item) => typeof item !== "boolean")) return null;
    const input: DailyBriefPreferenceInput = {
      enabled: value.enabled as boolean, useConnectedSources: value.useConnectedSources as boolean,
      excludedSources: dailyBriefSourceFlags((source) => excluded[source] === true),
      includeReminderHistory: value.includeReminderHistory as boolean, includeNotes: value.includeNotes as boolean,
    };
    if (!input.enabled && (input.useConnectedSources || input.includeReminderHistory || input.includeNotes ||
        DAILY_BRIEF_CONNECTED_SOURCES.some((source) => input.excludedSources[source]))) return null;
    return input;
  }
  if (!LEGACY_SETTINGS_KEY_SETS.includes(keys) || Object.values(value).some((item) => typeof item !== "boolean") ||
      (!value.enabled && Object.entries(value).some(([key, item]) => key !== "enabled" && item === true))) return null;
  const enabled = value.enabled as boolean;
  return {
    enabled,
    ...dailyBriefChoiceFromAllowed(enabled, {
      googleCalendar: value.includeCalendar === true, outlookCalendar: value.includeOutlookCalendar === true,
      icloudCalendar: value.includeIcloudCalendar === true, hevy: value.includeHevy === true,
    }),
    includeReminderHistory: value.includeReminderHistory === true, includeNotes: value.includeNotes === true,
  };
}

/**
 * Whether each source has something to read now. Ticket 307: Google Calendar is the
 * Timeline connection and its selected calendars, once the hosted migration reports
 * it. A failed status read reports the source as not connected.
 */
export async function readDailyBriefSourceStatus(caller: CalendarCaller, preferences: Pick<DailyBriefPreferences, "googleCalendarSource">): Promise<Record<DailyBriefConnectedSource, DailyBriefSourceStatus>> {
  const read = <T,>(operation: () => Promise<T>) => Promise.resolve().then(operation).catch(() => null);
  const [google, outlook, icloud, hevy] = await Promise.all([
    dailyBriefReadsGoogleCalendar(preferences) ? read(() => getCalendarConnection(caller, "agent")) : null,
    read(() => getOutlookCalendarConnection(caller)),
    read(() => getIcloudCalendarConnection(caller)),
    read(() => getHevyConnection(caller)),
  ]);
  const calendar = (connected: boolean, selected: number) => !connected ? "not_connected" : selected > 0 ? "ready" : "no_calendars";
  return {
    googleCalendar: calendar(google?.status === "connected", google?.preferences.selectedCalendarIds.length ?? 0),
    outlookCalendar: calendar(outlook?.status === "connected", outlook?.preferences.selectedSourceIds.length ?? 0),
    icloudCalendar: calendar(icloud?.status === "connected", icloud?.preferences.selectedSourceIds.length ?? 0),
    hevy: hevy?.status === "connected" ? "ready" : "not_connected",
  };
}

export const DAILY_BRIEF_INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The brief request's optional keys (advisor Phase 3 adds features, travelTimes, calendarBusy and refresh). */
const OPTIONAL_ATTEMPT_KEYS = new Set(["travelConclusions", "features", "travelTimes", "calendarBusy", "refresh"]);
const MAX_CALENDAR_BUSY = 200;

export type DailyBriefAttemptInput = Readonly<{
  installationId: string;
  retry: boolean;
  travelConclusions?: unknown;
  features?: readonly string[];
  travelTimes?: string;
  calendarBusy?: BriefPlanningContext["calendarBusy"];
  refresh?: boolean;
}>;

/**
 * The attempt body shared by the hosted brief and the device prepare step. Ticket 219
 * Option A: an optional signed travel token. Its value is never validated here; a token
 * that fails any later check only leaves travel conclusions unsupplied. Advisor Phase 3:
 * `features` opts in to move lines, `refresh` asks for a new brief replacing today's,
 * `calendarBusy` and `travelTimes` are what the screen holds, used for this request only.
 */
export function readDailyBriefAttemptInput(value: unknown): DailyBriefAttemptInput {
  if (!record(value) || typeof value.installationId !== "string" || !DAILY_BRIEF_INSTALLATION_ID.test(value.installationId) ||
      typeof value.retry !== "boolean" || Object.keys(value).some((key) => key !== "installationId" && key !== "retry" && !OPTIONAL_ATTEMPT_KEYS.has(key))) {
    throw new DailyBriefError("invalid_request");
  }
  const { features, travelTimes, calendarBusy, refresh } = value;
  if ((features !== undefined && (!Array.isArray(features) || features.length > 16 || features.some((item) => typeof item !== "string" || item.length > 64))) ||
      (travelTimes !== undefined && (typeof travelTimes !== "string" || travelTimes.length > 32_768)) ||
      (refresh !== undefined && typeof refresh !== "boolean") ||
      (calendarBusy !== undefined && !validCalendarBusy(calendarBusy))) {
    throw new DailyBriefError("invalid_request");
  }
  return value as DailyBriefAttemptInput;
}

function validCalendarBusy(value: unknown): value is BriefPlanningContext["calendarBusy"] {
  const instant = (item: unknown) => typeof item === "string" && item.length <= 40 && !Number.isNaN(Date.parse(item));
  return Array.isArray(value) && value.length <= MAX_CALENDAR_BUSY && value.every((item) => record(item) &&
    instant(item.startAt) && instant(item.endAt) && Date.parse(item.endAt as string) >= Date.parse(item.startAt as string) &&
    (item.ref === undefined || (typeof item.ref === "string" && item.ref.length <= 512)) &&
    (item.title === undefined || (typeof item.title === "string" && item.title.length <= 512)) &&
    Object.keys(item).every((key) => key === "startAt" || key === "endAt" || key === "ref" || key === "title"));
}

/** Refreshes per account per day after the morning brief (Emi, Nov 18). */
export const DAILY_BRIEF_REFRESHES_PER_DAY = 2;

/**
 * A typical brief's size, used to price one morning brief when checking that a refresh
 * leaves the rest of the month funded. The database uses this month's real average when
 * that is higher.
 */
const TYPICAL_BRIEF_TOKENS = { input: 3_000, output: 400 } as const;

export type DailyBriefServiceOptions = Readonly<{
  /** Tests: the model call that writes the opening and reasons. */
  generate?: DailyBriefGenerator;
  now?: () => Temporal.Instant;
  deadlineMs?: number;
}>;

/**
 * Advisor Phase 3 (3A2). One brief per account per day, plus up to two refreshes:
 *
 * 1. A saved brief for today answers every later open, on any device, with no model call.
 * 2. Otherwise Cadence plans today's move lines with no model (3A1). A quiet day (no line)
 *    shows a stock opening with no model call. Else one model call writes the opening and
 *    one reason per line; any part it gets wrong, or a failed call, falls back to stock text.
 * 3. The lines are stored as proposals, then the brief is saved. Saving is required: a
 *    brief that cannot be saved is not shown.
 */
export async function requestInAppDailyBrief(caller: CalendarCaller, value: unknown, options: DailyBriefServiceOptions = {}): Promise<DailyBriefResponse> {
  const attempt = readDailyBriefAttemptInput(value);
  if (!options.generate && !agentModelConfigured()) throw new DailyBriefError("not_configured");
  const wantsMoves = attempt.features?.includes(BRIEF_MOVE_LINES_FEATURE) ?? false;
  const wantsOpportunities = attempt.features?.includes(BRIEF_OPPORTUNITY_LINES_FEATURE) ?? false;
  // Ticket 360: the alongside question line, only for a client that renders it and only with CADENCE_ALONGSIDE on.
  const wantsAlongside = (attempt.features?.includes(BRIEF_ALONGSIDE_QUESTION_FEATURE) ?? false) && alongsideEnabled();
  const setting = dailyBriefModelSetting();
  const configuration = activeBriefingConfig();
  const configurationRevision = briefingConfigurationRevision(configuration);
  const clock = options.now ?? (() => Temporal.Now.instant());
  const deadlineMs = options.deadlineMs ?? DAILY_BRIEF_DEADLINE_MS;
  // Connector reads end early enough to leave the generation reserve inside the one attempt budget.
  const sourceDeadlineAt = Date.now() + deadlineMs - DAILY_BRIEF_GENERATION_RESERVE_MS;
  const signal = AbortSignal.timeout(deadlineMs);
  // Run-log writes after the model call stop this long before the request deadline,
  // so a slow log write never turns a finished brief into a timeout.
  const logSignal = AbortSignal.timeout(Math.max(0, deadlineMs - DAILY_BRIEF_LOG_MARGIN_MS));
  const installationId = attempt.installationId;
  const typicalBrief = typicalBriefMicrodollars(setting.model);
  const refreshState = async (agentClient: AppSupabaseClient | null, refreshesUsed: number) =>
    dailyBriefRefreshState(agentClient, refreshesUsed, typicalBrief, signal);

  const work = async (): Promise<DailyBriefResponse> => {
    const preferences = await phase("preferences", () => readDailyBriefPreferences(caller.client, signal));
    signal.throwIfAborted();
    if (!preferences.enabled) throw new DailyBriefError("access_denied");
    const agentClient = dailyBriefAgentClient(caller.user.id);
    const admission = await phase("admission", () => beginDailyBrief(caller.client, {
      installationId, retry: attempt.retry, expectedRevision: preferences.revision, refresh: attempt.refresh ?? false, moves: wantsMoves,
    }, signal));
    if (admission.state === "saved") {
      return { state: "ready", briefing: await phase("reopen", () => reopenSavedBrief(caller, admission, { wantsMoves, wantsOpportunities, wantsAlongside, refresh: (used) => refreshState(agentClient, used), signal })) };
    }
    if (admission.state === "refresh_limit_reached") throw new DailyBriefError("refresh_limit_reached");
    if (admission.state === "rate_limited") throw new DailyBriefError("rate_limited", admission.retryAfterSeconds);
    if (admission.state === "retry_exhausted") throw new DailyBriefError("retry_exhausted");
    if (admission.state === "pending") return admission.retryAfterSeconds ? { state: "pending", retryAfterSeconds: admission.retryAfterSeconds } : { state: "pending" };
    if (admission.state !== "acquired") return { state: admission.state };
    const leaseToken = admission.leaseToken;
    const refreshing = admission.refresh === true;
    let successful = false;
    let agentRun: DailyBriefAgentRun | null = null;
    try {
      // A refresh may not eat into the rest of the month's morning briefs (Emi, Nov 18).
      if (refreshing) {
        const funded = await phase("refresh_budget", () => refreshState(agentClient, admission.refreshesUsed ?? 0));
        if (!funded.available) throw new DailyBriefError("budget_reached", funded.retryAfterSeconds, "budget_refresh_unfunded");
      }
      signal.throwIfAborted();
      // Advisor plan Phase 1A: one agent_runs row per attempt; each model call goes through the spend budget.
      agentRun = await phase("run_log", () => beginDailyBriefAgentRun({
        userId: caller.user.id, trigger: refreshing ? "refresh" : attempt.retry ? "retry" : "on_demand", model: setting.model,
        maxOutputTokens: setting.maxOutputTokens, promptVersion: `${BRIEF_OPENING_PROMPT_REVISION}:${configurationRevision}`, signal,
        ...(agentClient ? { client: agentClient } : {}),
      }));
      signal.throwIfAborted();
      const prepared = await phase("context", () => captureLiveDailyBriefContext(caller, {
        configuration, preferences, localDate: admission.localDate, travelConclusions: attempt.travelConclusions, sourceDeadlineAt, signal, clock,
      }));
      const context = prepared.contexts[0]!;
      const assertCurrent = async () => {
        if (briefingConfigurationRevision() !== configurationRevision) throw new DailyBriefError("context_changed");
        await prepared.assertCurrent();
      };
      await assertCurrent();
      const generator: DailyBriefGenerator = options.generate ?? ((input) => generateBriefOpeningWithModel(input));
      const metered = withAgentRun(agentRun, generator);
      const now = clock().toString();
      // Usage reaches only the performance log and the run log, never the response.
      const usage: DailyBriefCallUsage[] = [];
      const includedGoogleCalendar = prepared.calendar !== null;
      const googleCalendarGrantGeneration = prepared.calendar?.connectionGeneration ?? null;
      // Cadence plans the lines for every client, so the opening says what really needs a new
      // time. A client without move lines gets the opening only; its lines are not stored.
      // WS-2B (Path 4): ignore client-supplied calendarBusy; busy intervals come strictly from server-side AI context.
      const [plan, conflicts] = await phase("moves", async () => {
        const [, open] = await Promise.all([
          ensureBehaviorEstimates(agentRun?.client ?? null, context,
            withAgentRun(agentRun, (input) => generateDurationEstimatesWithModel(input)), signal),
          readOpenBriefConflicts(caller.client, { userId: caller.user.id, localDate: context.localDate }),
        ]);
        const planned = await planBriefMoveLines({ context, planning: { calendarBusy: [], travelTimes: attempt.travelTimes ?? null }, now, supabase: caller.client, userId: caller.user.id,
          agentClient: agentRun?.client ?? agentClient });
        return [planned, open] as const;
      });
      const words = await measurePerformanceSpan({ span: "daily_brief.model", counts: () => dailyBriefUsageCounts(usage), errorCounts: () => dailyBriefUsageCounts(usage) },
        () => writeBriefWords({ context, candidates: plan.candidates, conflicts, calendar: plan.calendar, now, requestSignal: signal,
          signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(setting.timeoutMs, DAILY_BRIEF_WORDS_TIMEOUT_MS))]),
          generate: metered, onUsage: (item) => { usage.push({ call: "brief", ...item }); } }));
      signal.throwIfAborted();
      const lines = wantsMoves ? await phase("proposals", () => saveBriefProposals(agentRun?.client ?? null, {
        runId: agentRun?.runId ?? "", localDate: context.localDate, refresh: refreshing,
        lines: plan.candidates.map((candidate) => ({ ...candidate, reason: words.reasons[candidate.key] ?? candidate.reason })),
        containsGoogleCalendar: includedGoogleCalendar,
        googleCalendarGrantGeneration,
      })) : [];
      // Task 7: "Add for today" lines after the move lines, under the same free-slot rule and line cap.
      const opportunities = wantsOpportunities ? await phase("opportunities", async () => {
        const planned = await planBriefOpportunityDay({
          supabase: caller.client, userId: caller.user.id, localDate: context.localDate, timezone: context.timezone,
          now: Temporal.Instant.from(now), context, planning: { calendarBusy: [], travelTimes: attempt.travelTimes ?? null },
          travelSecrets: readTravelConclusionsSecrets(process.env), day: plan.day, moveCandidates: wantsMoves ? plan.candidates : [],
        });
        const saved = await saveBriefOpportunityProposals(agentRun?.client ?? null, {
          runId: agentRun?.runId ?? "", localDate: context.localDate, refresh: refreshing, candidates: planned.candidates,
          containsGoogleCalendar: includedGoogleCalendar,
          googleCalendarGrantGeneration,
        });
        return briefOpportunitiesFor({ localDate: context.localDate, timezone: context.timezone, runId: agentRun?.runId ?? null, lines: saved, calendar: planned.calendar });
      }) : null;
      // Ticket 360: at most one alongside question per brief, saved with it. A failed read asks nothing.
      const alongsideQuestion = wantsAlongside ? await phase("alongside_question", () => planBriefAlongsideQuestion(caller.client, caller.user.id, {
        localDate: context.localDate, items: plan.day.items,
      })).catch(() => null) : null;
      const notices = dailyBriefNotices({ calendar: plan.calendar, words, timezone: context.timezone, lines: lines.length });
      const saved: DailyBriefing = {
        text: words.opening, localDate: context.localDate, timezone: context.timezone,
        generatedAt: clock().toString(), expiresAt: context.dayEndAt, coverage: context.status, warnings: [],
        versions: { configuration: configurationRevision, references: "none", planner: "brief-moves", pipeline: BRIEF_PIPELINE_VERSION, recipe: `daily_brief@${BRIEF_RECIPE_VERSION}`, policy: DAILY_BRIEF_POLICY_VERSION },
        ...(notices.length ? { notices } : {}),
        ...(alongsideQuestion ? { alongsideQuestion } : {}),
      };
      await assertCurrent();
      // Required (Emi, Nov 18): the shown brief is saved before it is returned, and the save completes the lease.
      const stored = await phase("save", () => saveDailyBrief(caller.client, {
        installationId, leaseToken, expectedRevision: preferences.revision, runId: agentRun?.runId ?? null,
        refresh: refreshing, withMoves: wantsMoves, briefing: saved,
        includedGoogleCalendar,
        googleCalendarGrantGeneration,
      }, signal));
      if (!stored) throw new DailyBriefError("context_changed");
      successful = true;
      // Ticket 360: the saved brief asked, so a later day's brief does not ask about this Behavior again. A failed write asks again later.
      if (alongsideQuestion) {
        await phase("alongside_asked", () => recordBriefAlongsideQuestionAsked(caller.client, caller.user.id, {
          localDate: context.localDate, question: alongsideQuestion,
        })).catch(() => undefined);
      }
      const used = (admission.refreshesUsed ?? 0) + (refreshing ? 1 : 0);
      const briefing: DailyBriefing = {
        ...saved,
        ...(wantsMoves ? { moves: briefMovesFor(context, agentRun?.runId ?? null, lines, conflicts, plan.calendar) } : {}),
        ...(opportunities ? { opportunities } : {}),
        refresh: publicRefreshState(await refreshState(agentClient, used).catch(() => ({ remaining: Math.max(0, DAILY_BRIEF_REFRESHES_PER_DAY - used), available: false, retryAfterSeconds: undefined }))),
      };
      await agentRun?.finish({ ok: true, briefing, calendarDerived: dailyBriefContextIsCalendarDerived(context),
        googleCalendarDerived: includedGoogleCalendar, wordsError: words.failure?.error,
        linkedProposalIds: lines.map((line) => line.proposalId).filter((id) => UUID.test(id)) }, logSignal);
      return { state: "ready", briefing };
    } catch (error) {
      await agentRun?.finish({ ok: false, error }, logSignal);
      throw error;
    } finally {
      if (!successful) void finishDailyBrief(caller.client, { installationId, leaseToken, success: false, expectedRevision: preferences.revision }).catch(() => undefined);
    }
  };
  return phase("request", () => raceAbort(work(), signal));
}

/**
 * The words have this long; after it the brief shows the same lines with Cadence's
 * stock text, so a slow model never holds the brief back (pass bar: under 5 seconds
 * for the brief, measured by the evals on the chosen model).
 */
export const DAILY_BRIEF_WORDS_TIMEOUT_MS = 8_000;

/** Recipe label for briefs built by the Phase 3 path; older recipes stay for the workbench. */
export const BRIEF_RECIPE_VERSION = "2.0";
export const BRIEF_PIPELINE_VERSION = "4.0";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The words of one brief. No line and no conflict: the stock quiet-day opening, no model
 * call. Otherwise one call; a refused or failed call keeps the lines with stock text.
 * Cancellation of the whole request still aborts.
 */
export async function writeBriefWords(input: Readonly<{
  context: AdvisorDayContext;
  candidates: readonly BriefOpeningLine[];
  conflicts: readonly BriefMoveConflictLine[];
  calendar: "current" | "stale" | "none";
  now: string;
  /** The model call's own signal: the request's deadline or the words timeout, whichever comes first. */
  signal: AbortSignal;
  /** The whole request's signal. Only its abort fails the brief; a slow model falls back to stock text. */
  requestSignal: AbortSignal;
  generate: DailyBriefGenerator;
  onUsage?: (usage: DailyBriefModelUsage) => void;
}>): Promise<DailyBriefWords> {
  if (!input.candidates.length && !input.conflicts.length) return { ...stockBriefOpening([], []), fallbacks: [], source: "stock", failure: null };
  const request = prepareBriefOpening({ context: input.context, lines: input.candidates, conflicts: input.conflicts, calendar: input.calendar, now: input.now });
  try {
    const output = await raceAbort(input.generate({ instructions: request.instructions, facts: request.facts, signal: input.signal,
      ...(input.onUsage ? { onUsage: input.onUsage } : {}) }), input.signal);
    return { ...validateBriefOpening(output, { lines: input.candidates, conflicts: input.conflicts, labels: request.labels }), failure: null };
  } catch (error) {
    if (input.requestSignal.aborted) throw error;
    // The run log records why the words fell back, though the brief itself is shown.
    const cause = error instanceof DailyBriefError ? error
      : input.signal.aborted ? new DailyBriefError("timeout", undefined, "words_timeout") : error;
    const failure = cause instanceof DailyBriefError && cause.code === "budget_reached"
      ? { kind: "budget_reached" as const, retryAfterSeconds: cause.retryAfterSeconds, error: cause }
      : { kind: "words_unavailable" as const, error: cause };
    return { ...stockBriefOpening(input.candidates, input.conflicts), fallbacks: ["output_shape"], source: "stock", failure };
  }
}

export type DailyBriefWords = BriefOpeningText & Readonly<{
  failure: Readonly<{ kind: "budget_reached"; retryAfterSeconds?: number; error: unknown }> | Readonly<{ kind: "words_unavailable"; error: unknown }> | null;
}>;

/** Cadence's own wording for what went wrong; shown in the alert style. */
export function dailyBriefNotices(input: Readonly<{ calendar: "current" | "stale" | "none"; words: DailyBriefWords; timezone: string; lines: number }>): DailyBriefNotice[] {
  const notices: DailyBriefNotice[] = [];
  if (input.calendar === "stale") notices.push({ kind: "calendar_stale", text: noticeText("brief.calendar-stale") });
  if (input.words.failure?.kind === "budget_reached") {
    const until = input.words.failure.retryAfterSeconds
      ? Temporal.Now.instant().add({ seconds: input.words.failure.retryAfterSeconds }).toZonedDateTimeISO(input.timezone) : null;
    const when = until ? until.toPlainDate().toLocaleString("en-US", { month: "long", day: "numeric" }) : null;
    notices.push({ kind: "budget_reached", text: noticeText("brief.budget-reached", { lines: input.lines ? "yes" : "no", until: when ?? "none" }),
      ...(until ? { until: until.toInstant().toString() } : {}) });
  } else if (input.words.failure?.kind === "words_unavailable") {
    notices.push({ kind: "words_unavailable", text: noticeText("brief.words-unavailable", { lines: input.lines ? "yes" : "no" }) });
  }
  return notices;
}

/** Reopens today's saved brief with no model call. Move lines come back with their current answers. */
async function reopenSavedBrief(caller: CalendarCaller, saved: Extract<DailyBriefBeginResult, { state: "saved" }>, input: Readonly<{
  wantsMoves: boolean;
  wantsOpportunities: boolean;
  /** Ticket 360: the client renders the alongside question and CADENCE_ALONGSIDE is on. */
  wantsAlongside?: boolean;
  refresh: (used: number) => Promise<DailyBriefRefreshState>;
  signal: AbortSignal;
}>): Promise<DailyBriefing> {
  // Ticket 360: the saved question is shown again only to a client that asked for it, while it is still open.
  const { alongsideQuestion: savedQuestion, ...briefing } = saved.briefing as unknown as DailyBriefing & { alongsideQuestion?: BriefAlongsideQuestion };
  const [moves, opportunities, refresh, alongsideQuestion] = await Promise.all([
    input.wantsMoves && saved.withMoves ? readBriefMoves(caller.client, { localDate: saved.localDate, timezone: briefing.timezone, runId: saved.runId }) : null,
    input.wantsOpportunities ? readBriefOpportunities(caller.client, { userId: caller.user.id, localDate: saved.localDate, timezone: briefing.timezone, runId: saved.runId }) : null,
    input.refresh(saved.refreshesUsed).catch(() => ({ remaining: Math.max(0, DAILY_BRIEF_REFRESHES_PER_DAY - saved.refreshesUsed), available: false, retryAfterSeconds: undefined })),
    input.wantsAlongside && savedQuestion
      ? reopenBriefAlongsideQuestion(caller.client, caller.user.id, { localDate: saved.localDate, saved: savedQuestion }).catch(() => null) : null,
  ]);
  return { ...briefing, ...(moves ? { moves } : {}), ...(opportunities ? { opportunities } : {}),
    ...(alongsideQuestion ? { alongsideQuestion } : {}), refresh: publicRefreshState(refresh) };
}

type DailyBriefRefreshState = Readonly<{ remaining: number; available: boolean; retryAfterSeconds: number | undefined }>;

async function dailyBriefRefreshState(agentClient: AppSupabaseClient | null, refreshesUsed: number, typicalBrief: number, signal: AbortSignal): Promise<DailyBriefRefreshState> {
  const remaining = Math.max(0, DAILY_BRIEF_REFRESHES_PER_DAY - refreshesUsed);
  if (!remaining) return { remaining, available: false, retryAfterSeconds: undefined };
  // Local development without an agent key has no spend budget to protect.
  if (!agentClient) return { remaining, available: true, retryAfterSeconds: undefined };
  const funded = await agentBriefRefreshFunded(agentClient, typicalBrief, signal);
  const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(funded.resetsAt) - Date.now()) / 1000));
  return { remaining, available: funded.funded, retryAfterSeconds: funded.funded ? undefined : retryAfterSeconds };
}

function publicRefreshState(state: DailyBriefRefreshState): NonNullable<DailyBriefing["refresh"]> {
  return { remaining: state.remaining, available: state.available };
}

function typicalBriefMicrodollars(model: string): number {
  const price = modelPrice(model);
  return price ? Math.ceil(TYPICAL_BRIEF_TOKENS.input * price.input + TYPICAL_BRIEF_TOKENS.output * price.output) : 1_000;
}

/** A `daily_brief` agent client, or null where this deployment has no agent signing key (local development). */
function dailyBriefAgentClient(userId: string): AppSupabaseClient | null {
  try {
    if (!agentCallerConfigured()) return null;
    return createAgentClient(userId, "daily_brief").client;
  }
  catch { throw new DailyBriefError("advisor_unavailable", undefined, "agent_key_invalid"); }
}

function briefMovesFor(context: AdvisorDayContext, runId: string | null, lines: readonly BriefMoveLine[], conflicts: readonly BriefMoveConflictLine[], calendar: BriefMoves["calendar"]): BriefMoves {
  const undecided = lines.filter((line) => line.status === "proposed").length;
  return { version: BRIEF_MOVES_VERSION, localDate: context.localDate, timezone: context.timezone, runId, lines, conflicts,
    acceptAll: undecided >= 2, undoAllBatchId: null, calendar };
}

function withAgentRun(run: DailyBriefAgentRun | null, generate: DailyBriefGenerator): DailyBriefGenerator {
  return run ? run.wrap(generate) : generate;
}

/**
 * The live Daily Brief capture, shared by the hosted path and the Ticket 298 device
 * prepare step. Only these live paths read separately disclosed sources; workbench
 * and history never do.
 */
export function captureLiveDailyBriefContext(caller: CalendarCaller, input: Readonly<{
  configuration: ReturnType<typeof activeBriefingConfig>;
  preferences: DailyBriefPreferences;
  localDate: string;
  travelConclusions: unknown;
  sourceDeadlineAt: number;
  signal: AbortSignal;
  clock: () => Temporal.Instant;
}>) {
  const { configuration } = input;
  return prepareAccountBriefingContexts(caller, {
    historyDays: [configuration.scope.historyDays],
    includeCalendar: configuration.scope.includeCalendar,
    connectorSources: { calendars: configuration.scope.includeCalendar, recordedActivity: true, deadlineAt: input.sourceDeadlineAt },
    includeRecordedElapsedDurations: configuration.context.includeRecordedElapsedDurations,
    includeHistoricalCompletionTimes: configuration.context.includeHistoricalCompletionTimes,
    signal: input.signal,
    clock: input.clock,
    preferences: input.preferences,
    localDate: input.localDate,
    travelConclusions: { token: input.travelConclusions ?? null, secrets: readTravelConclusionsSecrets(process.env) },
    ...(configuration.analysis.lanes.length ? { analysis: {
      includeReminders: configuration.analysis.lanes.includes("reminder-effectiveness"),
      includeNotes: configuration.analysis.lanes.includes("notes-failure-themes"),
    } } : {}),
  });
}

/**
 * Offers optional-source controls only when the reviewed configuration uses the
 * lane, or in development so the private workbench can evaluate candidates.
 */
function dailyBriefOptionalSources() {
  const lanes = activeBriefingConfig().analysis.lanes;
  const development = process.env.NODE_ENV === "development";
  return {
    reminders: development || lanes.includes("reminder-effectiveness"),
    notes: development || lanes.includes("notes-failure-themes"),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
