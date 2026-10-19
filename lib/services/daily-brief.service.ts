import { Temporal } from "@js-temporal/polyfill";
import type { DailyBriefResponse, DailyBriefSettings } from "@cadence/core/types/daily-brief";
import { readAdvisorProfileTimezone } from "@/lib/db/advisor-context.repo";
import { beginDailyBrief, finishDailyBrief, readDailyBriefPreferences, readDailyBriefTipHistory, recordDailyBriefTip, saveDailyBriefPreferences, type DailyBriefPreferences } from "@/lib/db/daily-brief.repo";
import { prepareAccountBriefingContexts, briefingAccountRef } from "./briefing-account-context.service";
import { DailyBriefError, generateDailyBrief, raceBriefAbort as raceAbort, type DailyBriefGenerator } from "./daily-brief-consumer";
import { generateOpenAIDailyBrief } from "./daily-brief-openai";
import { getCalendarConnection, type CalendarCaller } from "./google-calendar.service";
import { getOutlookCalendarConnection } from "./outlook-calendar.service";
import { getIcloudCalendarConnection } from "./icloud-calendar.service";
import { getHevyConnection } from "./hevy.service";

import { activeBriefingConfig, briefingConfigurationRevision } from "./briefing-pipeline";
import { measurePerformanceSpan } from "./performance-timing";

/** The whole in-app attempt, and the time kept back for generation after connector reads (Ticket 226). */
export const DAILY_BRIEF_DEADLINE_MS = 60_000;
export const DAILY_BRIEF_GENERATION_RESERVE_MS = 10_000;

const SETTINGS_KEY_SETS = [
  "enabled,includeCalendar",
  "enabled,includeCalendar,includeNotes,includeReminderHistory",
  "enabled,includeCalendar,includeHevy,includeIcloudCalendar,includeNotes,includeOutlookCalendar,includeReminderHistory",
];

/** Phase diagnostics record span, duration and error code only; never prompts, facts or output. */
const phase = <T,>(span: string, operation: () => Promise<T>) => measurePerformanceSpan({ span: `daily_brief.${span}` }, operation);

export async function getDailyBriefSettings(caller: CalendarCaller): Promise<DailyBriefSettings> {
  const preferences = await readDailyBriefPreferences(caller.client);
  const timezone = await readAdvisorProfileTimezone(caller.client, caller.user.id);
  return { accountRef: briefingAccountRef(caller.user.id), available: !!process.env.OPENAI_API_KEY,
    configurationRevision: briefingConfigurationRevision(), enabled: preferences.enabled, includeCalendar: preferences.includeCalendar,
    includeReminderHistory: preferences.includeReminderHistory, includeNotes: preferences.includeNotes, revision: preferences.revision,
    optionalSources: dailyBriefOptionalSources(),
    includeOutlookCalendar: preferences.includeOutlookCalendar, includeIcloudCalendar: preferences.includeIcloudCalendar,
    includeHevy: preferences.includeHevy, ...await dailyBriefConnectorState(caller, preferences),
    timezone, localDate: Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate().toString() };
}

/**
 * Accepts exactly the original two controls, the four current controls, or the
 * four plus the three connector disclosures (Ticket 226). Older clients that
 * send two or four controls revoke every disclosure they omit, so an update
 * never grants a source silently. Turning Daily Brief off requires every
 * disclosure off.
 */
export async function updateDailyBriefSettings(caller: CalendarCaller, value: unknown): Promise<DailyBriefSettings> {
  const keys = record(value) ? Object.keys(value).sort().join() : "";
  if (!record(value) || !SETTINGS_KEY_SETS.includes(keys) || Object.values(value).some((item) => typeof item !== "boolean") ||
      (!value.enabled && Object.entries(value).some(([key, item]) => key !== "enabled" && item === true))) {
    throw new DailyBriefError("invalid_request");
  }
  const input = {
    enabled: value.enabled as boolean, includeCalendar: value.includeCalendar as boolean,
    includeReminderHistory: value.includeReminderHistory === true, includeNotes: value.includeNotes === true,
    includeOutlookCalendar: value.includeOutlookCalendar === true, includeIcloudCalendar: value.includeIcloudCalendar === true,
    includeHevy: value.includeHevy === true,
  };
  if (input.enabled && !process.env.OPENAI_API_KEY) throw new DailyBriefError("not_configured");
  if (input.includeCalendar && (await getCalendarConnection(caller)).status !== "connected") throw new DailyBriefError("calendar_unavailable");
  if (input.includeOutlookCalendar) {
    const outlook = await getOutlookCalendarConnection(caller);
    if (outlook.status !== "connected" || outlook.preferences.selectedSourceIds.length === 0) throw new DailyBriefError("source_unavailable");
  }
  if (input.includeIcloudCalendar) {
    const icloud = await getIcloudCalendarConnection(caller);
    if (icloud.status !== "connected" || icloud.preferences.selectedSourceIds.length === 0) throw new DailyBriefError("source_unavailable");
  }
  if (input.includeHevy && (await getHevyConnection(caller)).status !== "connected") throw new DailyBriefError("source_unavailable");
  const current = await readDailyBriefPreferences(caller.client);
  await saveDailyBriefPreferences(caller.client, input, current.revision);
  return getDailyBriefSettings(caller);
}

/**
 * Connected sources Settings may offer, and why a disclosed source cannot be used
 * (Ticket 226 recovery). `changed` means the source is usable but was reconnected
 * or reselected after the user allowed it, so the stored fence no longer matches
 * and the brief refuses to start until the user allows it again. A failed status
 * read offers nothing and reports a disclosed source as unavailable.
 */
async function dailyBriefConnectorState(caller: CalendarCaller, preferences: DailyBriefPreferences): Promise<Pick<DailyBriefSettings, "connectorSources" | "connectorAttention">> {
  const [outlook, icloud, hevy] = await Promise.all([
    Promise.resolve().then(() => getOutlookCalendarConnection(caller)).catch(() => null),
    Promise.resolve().then(() => getIcloudCalendarConnection(caller)).catch(() => null),
    Promise.resolve().then(() => getHevyConnection(caller)).catch(() => null),
  ]);
  const outlookConnected = outlook?.status === "connected";
  const outlookSelected = outlookConnected && outlook.preferences.selectedSourceIds.length > 0;
  const icloudConnected = icloud?.status === "connected";
  const icloudSelected = icloudConnected && icloud.preferences.selectedSourceIds.length > 0;
  const hevyConnected = hevy?.status === "connected";
  return {
    connectorSources: { outlookCalendar: outlookSelected, icloudCalendar: icloudSelected, hevy: hevyConnected },
    connectorAttention: {
      outlookCalendar: !preferences.includeOutlookCalendar ? null : !outlookConnected ? "unavailable" : !outlookSelected ? "no_calendars"
        : outlook.generation !== preferences.outlookConnectionGeneration || outlook.selectionRevision !== preferences.outlookSelectionRevision ? "changed" : null,
      icloudCalendar: !preferences.includeIcloudCalendar ? null : !icloudConnected ? "unavailable" : !icloudSelected ? "no_calendars"
        : icloud.generation !== preferences.icloudConnectionGeneration || icloud.selectionRevision !== preferences.icloudSelectionRevision ? "changed" : null,
      hevy: !preferences.includeHevy ? null : !hevyConnected ? "unavailable"
        : hevy.generation !== preferences.hevyConnectionGeneration ? "changed" : null,
    },
  };
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
