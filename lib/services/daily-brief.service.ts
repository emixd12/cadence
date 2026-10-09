import { Temporal } from "@js-temporal/polyfill";
import type { DailyBriefResponse, DailyBriefSettings } from "@cadence/core/types/daily-brief";
import { readAdvisorProfileTimezone } from "@/lib/db/advisor-context.repo";
import { beginDailyBrief, finishDailyBrief, readDailyBriefPreferences, readDailyBriefTipHistory, recordDailyBriefTip, saveDailyBriefPreferences } from "@/lib/db/daily-brief.repo";
import { prepareAccountBriefingContexts, briefingAccountRef } from "./briefing-account-context.service";
import { DailyBriefError, generateDailyBrief, raceBriefAbort as raceAbort, type DailyBriefGenerator } from "./daily-brief-consumer";
import { generateOpenAIDailyBrief } from "./daily-brief-openai";
import { getCalendarConnection, type CalendarCaller } from "./google-calendar.service";

import { activeBriefingConfig, briefingConfigurationRevision } from "./briefing-pipeline";
import { measurePerformanceSpan } from "./performance-timing";

/** Phase diagnostics record span, duration and error code only; never prompts, facts or output. */
const phase = <T,>(span: string, operation: () => Promise<T>) => measurePerformanceSpan({ span: `daily_brief.${span}` }, operation);

export async function getDailyBriefSettings(caller: CalendarCaller): Promise<DailyBriefSettings> {
  const preferences = await readDailyBriefPreferences(caller.client);
  const timezone = await readAdvisorProfileTimezone(caller.client, caller.user.id);
  return { accountRef: briefingAccountRef(caller.user.id), available: !!process.env.OPENAI_API_KEY,
    configurationRevision: briefingConfigurationRevision(), enabled: preferences.enabled, includeCalendar: preferences.includeCalendar,
    includeReminderHistory: preferences.includeReminderHistory, includeNotes: preferences.includeNotes, revision: preferences.revision,
    optionalSources: dailyBriefOptionalSources(),
    timezone, localDate: Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate().toString() };
}

/**
 * Accepts the original two controls or all four. Older clients that send two
 * controls revoke the optional sources, so an update never grants them silently.
 */
export async function updateDailyBriefSettings(caller: CalendarCaller, value: unknown): Promise<DailyBriefSettings> {
  const keys = record(value) ? Object.keys(value).sort().join() : "";
  if (!record(value) || (keys !== "enabled,includeCalendar" && keys !== "enabled,includeCalendar,includeNotes,includeReminderHistory") ||
      typeof value.enabled !== "boolean" || typeof value.includeCalendar !== "boolean" ||
      (value.includeReminderHistory !== undefined && typeof value.includeReminderHistory !== "boolean") ||
      (value.includeNotes !== undefined && typeof value.includeNotes !== "boolean") ||
      (!value.enabled && (value.includeCalendar || value.includeReminderHistory === true || value.includeNotes === true))) {
    throw new DailyBriefError("invalid_request");
  }
  if (value.enabled && !process.env.OPENAI_API_KEY) throw new DailyBriefError("not_configured");
  if (value.includeCalendar && (await getCalendarConnection(caller)).status !== "connected") throw new DailyBriefError("calendar_unavailable");
  const current = await readDailyBriefPreferences(caller.client);
  await saveDailyBriefPreferences(caller.client, {
    enabled: value.enabled, includeCalendar: value.includeCalendar,
    includeReminderHistory: value.includeReminderHistory === true, includeNotes: value.includeNotes === true,
  }, current.revision);
  return getDailyBriefSettings(caller);
}

export async function requestInAppDailyBrief(caller: CalendarCaller, value: unknown, options: Readonly<{
  generate?: DailyBriefGenerator;
  now?: () => Temporal.Instant;
  deadlineMs?: number;
}> = {}): Promise<DailyBriefResponse> {
  if (!record(value) || Object.keys(value).sort().join() !== "installationId,retry" || typeof value.installationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.installationId) || typeof value.retry !== "boolean") {
    throw new DailyBriefError("invalid_request");
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new DailyBriefError("not_configured");
  const configuration = activeBriefingConfig();
  const configurationRevision = briefingConfigurationRevision(configuration);
  const clock = options.now ?? (() => Temporal.Now.instant());
  const signal = AbortSignal.timeout(options.deadlineMs ?? 60_000);
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
        includeRecordedElapsedDurations: configuration.context.includeRecordedElapsedDurations,
        includeHistoricalCompletionTimes: configuration.context.includeHistoricalCompletionTimes,
        signal,
        clock,
        preferences,
        localDate: admission.localDate,
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
      const briefing = await phase("model", () => raceAbort(generateDailyBrief(context, { config: configuration, now: clock, signal: modelSignal,
        analysis: { source: prepared.analysisSource, shown, fingerprintOf: prepared.tipFingerprint },
        onTip: (fingerprints) => { tipFingerprints = fingerprints; },
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
