import { Temporal } from "@js-temporal/polyfill";
import { DAILY_BRIEF_CONNECTED_SOURCES, type DailyBriefConnectedSource, type DailyBriefResponse, type DailyBriefSettings, type DailyBriefSourceStatus } from "@cadence/core/types/daily-brief";
import { dailyBriefChoiceFromAllowed, dailyBriefSourceFlags, dailyBriefSourcesUsed } from "@cadence/core/services/daily-brief-sources";
import { readAdvisorProfileTimezone } from "@/lib/db/advisor-context.repo";
import { beginDailyBrief, finishDailyBrief, readDailyBriefPreferences, readDailyBriefTipHistory, recordDailyBriefTip, saveDailyBriefPreferences, type DailyBriefPreferenceInput } from "@/lib/db/daily-brief.repo";
import { prepareAccountBriefingContexts, briefingAccountRef } from "./briefing-account-context.service";
import { DailyBriefError, generateDailyBrief, raceBriefAbort as raceAbort, sumDailyBriefUsage, type DailyBriefCallUsage, type DailyBriefGenerator } from "./daily-brief-consumer";
import { generateOpenAIDailyBrief } from "./daily-brief-openai";
import { getCalendarConnection, type CalendarCaller } from "./google-calendar.service";
import { getOutlookCalendarConnection } from "./outlook-calendar.service";
import { getIcloudCalendarConnection } from "./icloud-calendar.service";
import { getHevyConnection } from "./hevy.service";

import { activeBriefingConfig, briefingConfigurationRevision } from "./briefing-pipeline";
import { measurePerformanceSpan, type PerformanceTimingCounts } from "./performance-timing";
import { readTravelConclusionsSecrets } from "./travel-conclusions-token";

/** The whole in-app attempt, and the time kept back for generation after connector reads (Ticket 239). */
export const DAILY_BRIEF_DEADLINE_MS = 60_000;
export const DAILY_BRIEF_GENERATION_RESERVE_MS = 10_000;

/** Per-source key sets sent by clients built before Ticket 306. */
const LEGACY_SETTINGS_KEY_SETS = [
  "enabled,includeCalendar",
  "enabled,includeCalendar,includeNotes,includeReminderHistory",
  "enabled,includeCalendar,includeHevy,includeIcloudCalendar,includeNotes,includeOutlookCalendar,includeReminderHistory",
];
const SETTINGS_KEYS = "enabled,excludedSources,includeNotes,includeReminderHistory,useConnectedSources";
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
  const [timezone, sourceStatus] = await Promise.all([
    readAdvisorProfileTimezone(caller.client, caller.user.id),
    readDailyBriefSourceStatus(caller),
  ]);
  const used = dailyBriefSourcesUsed(preferences, sourceStatus);
  return { accountRef: briefingAccountRef(caller.user.id), available: !!process.env.OPENAI_API_KEY,
    configurationRevision: briefingConfigurationRevision(), enabled: preferences.enabled,
    useConnectedSources: preferences.useConnectedSources, excludedSources: preferences.excludedSources, sourceStatus,
    includeReminderHistory: preferences.includeReminderHistory, includeNotes: preferences.includeNotes, revision: preferences.revision,
    optionalSources: dailyBriefOptionalSources(),
    // Clients built before Ticket 306 show these as per-source checkboxes: each reports whether the brief uses the source now.
    includeCalendar: used.googleCalendar, includeOutlookCalendar: used.outlookCalendar, includeIcloudCalendar: used.icloudCalendar, includeHevy: used.hevy,
    connectorSources: { outlookCalendar: sourceStatus.outlookCalendar === "ready", icloudCalendar: sourceStatus.icloudCalendar === "ready", hevy: sourceStatus.hevy === "ready" },
    connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: null },
    timezone, localDate: Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate().toString() };
}

/**
 * Accepts the Ticket 306 shape: the one connected-sources choice, per-source
 * exclusions, and the reminder-history and Notes choices. Older clients send two,
 * four or seven per-source keys; their saves map to the one choice, and every
 * source they leave off starts excluded, so an older save never adds a source.
 * Turning Daily Brief off requires every other choice off.
 */
export async function updateDailyBriefSettings(caller: CalendarCaller, value: unknown): Promise<DailyBriefSettings> {
  const input = parseDailyBriefSettingsInput(value);
  if (!input) throw new DailyBriefError("invalid_request");
  if (input.enabled && !process.env.OPENAI_API_KEY) throw new DailyBriefError("not_configured");
  const current = await readDailyBriefPreferences(caller.client);
  await saveDailyBriefPreferences(caller.client, input, current.revision);
  return getDailyBriefSettings(caller);
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
 * Whether each source has something to read now. Ticket 187: Google Calendar is
 * the separate agent grant. A failed status read reports the source as not connected.
 */
export async function readDailyBriefSourceStatus(caller: CalendarCaller): Promise<Record<DailyBriefConnectedSource, DailyBriefSourceStatus>> {
  const read = <T,>(operation: () => Promise<T>) => Promise.resolve().then(operation).catch(() => null);
  const [google, outlook, icloud, hevy] = await Promise.all([
    read(() => getCalendarConnection(caller, "agent")),
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

export async function requestInAppDailyBrief(caller: CalendarCaller, value: unknown, options: Readonly<{
  generate?: DailyBriefGenerator;
  now?: () => Temporal.Instant;
  deadlineMs?: number;
}> = {}): Promise<DailyBriefResponse> {
  // Ticket 219 Option A: an optional signed travel token. Its value is never validated here;
  // a token that fails any later check only leaves travel conclusions unsupplied.
  const keys = record(value) ? Object.keys(value).sort().join() : "";
  if (!record(value) || (keys !== "installationId,retry" && keys !== "installationId,retry,travelConclusions") || typeof value.installationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.installationId) || typeof value.retry !== "boolean") {
    throw new DailyBriefError("invalid_request");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new DailyBriefError("not_configured");
  const configuration = activeBriefingConfig();
  const configurationRevision = briefingConfigurationRevision(configuration);
  const clock = options.now ?? (() => Temporal.Now.instant());
  const deadlineMs = options.deadlineMs ?? DAILY_BRIEF_DEADLINE_MS;
  // Connector reads end early enough to leave the generation reserve inside the one attempt budget.
  const sourceDeadlineAt = Date.now() + deadlineMs - DAILY_BRIEF_GENERATION_RESERVE_MS;
  const signal = AbortSignal.timeout(deadlineMs);
  const installationId = value.installationId;
  const work = async (): Promise<DailyBriefResponse> => {
    const preferences = await phase("preferences", () => readDailyBriefPreferences(caller.client, signal));
    signal.throwIfAborted();
    if (!preferences.enabled) throw new DailyBriefError("access_denied");
    const admission = await phase("admission", () => beginDailyBrief(caller.client, { installationId, retry: value.retry as boolean, expectedRevision: preferences.revision }, signal));
    if (admission.state === "rate_limited") throw new DailyBriefError("rate_limited", admission.retryAfterSeconds);
    if (admission.state === "retry_exhausted") throw new DailyBriefError("retry_exhausted");
    if (admission.state === "pending") return admission.retryAfterSeconds ? { state: "pending", retryAfterSeconds: admission.retryAfterSeconds } : { state: "pending" };
    if (admission.state !== "acquired") return { state: admission.state };
    const leaseToken = admission.leaseToken;
    let successful = false;
    try {
      signal.throwIfAborted();
      const prepared = await phase("context", () => prepareAccountBriefingContexts(caller, {
        historyDays: [configuration.scope.historyDays],
        includeCalendar: configuration.scope.includeCalendar,
        // Only this live path reads separately disclosed sources; workbench and history never do.
        connectorSources: { calendars: configuration.scope.includeCalendar, recordedActivity: true, deadlineAt: sourceDeadlineAt },
        includeRecordedElapsedDurations: configuration.context.includeRecordedElapsedDurations,
        includeHistoricalCompletionTimes: configuration.context.includeHistoricalCompletionTimes,
        signal,
        clock,
        preferences,
        localDate: admission.localDate,
        travelConclusions: { token: value.travelConclusions ?? null, secrets: readTravelConclusionsSecrets(process.env) },
        ...(configuration.analysis.lanes.length ? { analysis: {
          includeReminders: configuration.analysis.lanes.includes("reminder-effectiveness"),
          includeNotes: configuration.analysis.lanes.includes("notes-failure-themes"),
        } } : {}),
      }));
      const context = prepared.contexts[0]!;
      const shown = configuration.analysis.maxTips ? await phase("tip_history", () => readDailyBriefTipHistory(caller.client, signal)) : [];
      let tipFingerprints: readonly string[] = [];
      const assertCurrent = async () => {
        if (briefingConfigurationRevision() !== configurationRevision) throw new DailyBriefError("context_changed");
        await prepared.assertCurrent();
      };
      await assertCurrent();
      const modelSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      // Usage reaches only the performance log, never the response.
      const usage: DailyBriefCallUsage[] = [];
      const briefing = await measurePerformanceSpan({ span: "daily_brief.model", counts: () => dailyBriefUsageCounts(usage), errorCounts: () => dailyBriefUsageCounts(usage) },
        () => raceAbort(generateDailyBrief(context, { config: configuration, now: clock, signal: modelSignal,
          analysis: { source: prepared.analysisSource, shown, fingerprintOf: prepared.tipFingerprint },
          onTip: (fingerprints) => { tipFingerprints = fingerprints; },
          onUsage: (item) => { usage.push(item); },
          generate: options.generate ?? ((input) => generateOpenAIDailyBrief(input, { apiKey })) }), modelSignal));
      // The lease must still belong to this attempt. A superseded attempt never returns text.
      const finished = await phase("finish", () => finishDailyBrief(caller.client, { installationId, leaseToken, success: true, expectedRevision: preferences.revision }, signal));
      if (!finished) throw new DailyBriefError("context_changed");
      await assertCurrent();
      successful = true;
      // Only a completed, still-current attempt consumes the tip. A lost record may repeat the tip; it never hides text.
      if (tipFingerprints.length) {
        await phase("tip_record", async () => {
          for (const fingerprint of tipFingerprints) {
            await recordDailyBriefTip(caller.client, { installationId, leaseToken, expectedRevision: preferences.revision, fingerprint }, signal);
          }
        }).catch(() => undefined);
      }
      return { state: "ready", briefing };
    } finally {
      if (!successful) void finishDailyBrief(caller.client, { installationId, leaseToken, success: false, expectedRevision: preferences.revision }).catch(() => undefined);
    }
  };
  return phase("request", () => raceAbort(work(), signal));
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
