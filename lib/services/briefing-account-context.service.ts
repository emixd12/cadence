import { createHash, randomBytes } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { AdvisorDayContextV1 } from "@cadence/core/types/advisor-day-context";
import type { BriefingAnalysisSource, BriefingFinding } from "@cadence/core/types/briefing-analysis";
import { readAdvisorAnalysisRevision, readAdvisorAnalysisSnapshot } from "@/lib/db/advisor-analysis.repo";
import { projectBriefingAnalysisSource } from "./briefing-analysis-source";

import { readAdvisorCadenceRevision, readAdvisorProfileTimezone } from "@/lib/db/advisor-context.repo";
import {
  listDailyBriefBehaviorIds,
  readDailyBriefPreferences,
  type DailyBriefPreferences,
} from "@/lib/db/daily-brief.repo";
import {
  createAdvisorOpaqueRef,
  readAdvisorDayContexts,
  type AdvisorAuthorizationFence,
} from "./advisor-day-context.service";
import { assertBriefContextFresh, DailyBriefError } from "./daily-brief-consumer";
import { getCalendarConnection, type CalendarCaller } from "./google-calendar.service";

const CLIENT_ID = "cadence-daily-brief";

export function briefingAccountRef(userId: string): string {
  return createHash("sha256").update(`cadence-daily-brief-account\0${userId}`).digest("base64url");
}

export function workbenchBehaviorRef(userId: string, behaviorId: string): string {
  return `behavior_${createHash("sha256").update(`cadence-briefing-workbench-behavior\0${userId}\0${behaviorId}`).digest("base64url")}`;
}

export async function prepareAccountBriefingContexts(
  caller: CalendarCaller,
  input: Readonly<{
    historyDays: readonly number[];
    includeCalendar: boolean;
    includeRecordedElapsedDurations?: boolean;
    includeHistoricalCompletionTimes?: boolean;
    signal: AbortSignal;
    clock?: () => Temporal.Instant;
    preferences?: DailyBriefPreferences;
    localDate?: string;
    /** Reads analysis history only when a configuration selects lanes. Optional sources also need their disclosure. */
    analysis?: Readonly<{ includeReminders: boolean; includeNotes: boolean }>;
  }>,
): Promise<Readonly<{
  contexts: AdvisorDayContextV1[];
  assertCurrent: () => Promise<void>;
  configurationRefs: Record<string, string>;
  preferences: DailyBriefPreferences;
  analysisSource: BriefingAnalysisSource | null;
  /** Stable, account-scoped one-way fingerprint for tip repetition control. */
  tipFingerprint: (finding: BriefingFinding) => string;
}>> {
  const clock = input.clock ?? (() => Temporal.Now.instant());
  input.signal.throwIfAborted();
  const preferences = input.preferences ?? await readDailyBriefPreferences(caller.client, input.signal);
  input.signal.throwIfAborted();
  if (!preferences.enabled) throw new DailyBriefError("access_denied");

  const key = randomBytes(32);
  const grantExpiresAt = clock().add({ minutes: 5 }).toString();
  const readAuthorization = async (signal: AbortSignal = input.signal): Promise<AdvisorAuthorizationFence> => {
    signal.throwIfAborted();
    const current = await readDailyBriefPreferences(caller.client, signal);
    signal.throwIfAborted();
    if (!samePreferences(current, preferences)) throw new DailyBriefError("context_changed");
    const behaviorIds = await listDailyBriefBehaviorIds(caller.client, caller.user.id, signal);
    signal.throwIfAborted();
    let calendar: AdvisorAuthorizationFence["calendar"] = null;
    if (preferences.includeCalendar) {
      const connection = await getCalendarConnection(caller);
      signal.throwIfAborted();
      if (connection.status !== "connected" || connection.generation !== preferences.calendarConnectionGeneration ||
          connection.selectionRevision !== preferences.calendarSelectionRevision) {
        throw new DailyBriefError("context_changed");
      }
      calendar = {
        calendarIds: [...connection.preferences.selectedCalendarIds].sort(),
        connectionGeneration: connection.generation,
        selectionRevision: connection.selectionRevision,
      };
    }
    return {
      userId: caller.user.id,
      clientId: CLIENT_ID,
      accountRef: briefingAccountRef(caller.user.id),
      grantGeneration: preferences.revision,
      grantExpiresAt,
      behaviorIds,
      calendar,
    };
  };

  const authorization = await readAuthorization();
  const contexts = await readAdvisorDayContexts({
    caller,
    authorization,
    revalidateAuthorization: readAuthorization,
    historyDays: input.historyDays,
    includeGoogleCalendar: input.includeCalendar && preferences.includeCalendar,
    includeRecordedElapsedDurations: input.includeRecordedElapsedDurations,
    includeHistoricalCompletionTimes: input.includeHistoricalCompletionTimes,
    localDate: input.localDate,
    opaqueRefKey: key,
    clock,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  const makeOpaqueRef = createAdvisorOpaqueRef(key, authorization);
  const configurationRefs = Object.fromEntries(authorization.behaviorIds.map((behaviorId) => [
    workbenchBehaviorRef(caller.user.id, behaviorId),
    makeOpaqueRef("behavior", behaviorId),
  ]));
  const behaviorIdByRef = new Map(authorization.behaviorIds.map((behaviorId) => [makeOpaqueRef("behavior", behaviorId), behaviorId]));
  const firstContext = contexts[0]!;
  const analysisRequest = input.analysis ? {
    localDate: firstContext.localDate,
    historyStartLocalDate: Temporal.PlainDate.from(firstContext.localDate).subtract({ days: 90 }).toString(),
    behaviorIds: authorization.behaviorIds,
    // The database also refuses undisclosed sources; requesting one never grants it.
    includeReminders: input.analysis.includeReminders && preferences.includeReminderHistory,
    includeNotes: input.analysis.includeNotes && preferences.includeNotes,
    signal: input.signal,
  } : null;
  let analysisSource: BriefingAnalysisSource | null = null;
  let analysisRevision: string | null = null;
  if (analysisRequest) {
    const snapshot = await readAdvisorAnalysisSnapshot(caller.client, analysisRequest);
    input.signal.throwIfAborted();
    if (snapshot.timezone !== firstContext.timezone) throw new DailyBriefError("context_changed");
    analysisRevision = snapshot.revision;
    analysisSource = projectBriefingAnalysisSource(snapshot, {
      context: firstContext, makeOpaqueRef, startLocalDate: analysisRequest.historyStartLocalDate,
    });
  }
  const tipFingerprint = (finding: BriefingFinding) => {
    const behaviorId = finding.behaviorRef ? behaviorIdByRef.get(finding.behaviorRef) : "all";
    if (!behaviorId) throw new DailyBriefError("context_changed");
    return createHash("sha256").update(["cadence-daily-brief-tip", caller.user.id, finding.laneId, behaviorId, finding.key, finding.evidenceBand].join("\0")).digest("hex");
  };

  const assertCurrent = async (): Promise<void> => {
    input.signal.throwIfAborted();
    const context = contexts[0]!;
    const revision = await readAdvisorCadenceRevision(caller.client, {
      localDate: context.localDate,
      historyStartLocalDate: Temporal.PlainDate.from(context.localDate).subtract({ days: 90 }).toString(),
      behaviorIds: authorization.behaviorIds,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    const timezone = await readAdvisorProfileTimezone(caller.client, caller.user.id);
    input.signal.throwIfAborted();
    const currentAuthorization = await readAuthorization();
    if (timezone !== context.timezone || makeOpaqueRef("revision", revision) !== context.cadence.revision ||
        JSON.stringify(currentAuthorization) !== JSON.stringify(authorization)) {
      throw new DailyBriefError("context_changed");
    }
    if (analysisRequest && await readAdvisorAnalysisRevision(caller.client, analysisRequest) !== analysisRevision) {
      throw new DailyBriefError("context_changed");
    }
    input.signal.throwIfAborted();
    const now = clock();
    for (const candidate of contexts) assertBriefContextFresh(candidate, now);
    input.signal.throwIfAborted();
  };

  return { contexts, assertCurrent, configurationRefs, preferences, analysisSource, tipFingerprint };
}

function samePreferences(left: DailyBriefPreferences, right: DailyBriefPreferences): boolean {
  return left.enabled === right.enabled && left.includeCalendar === right.includeCalendar && left.revision === right.revision &&
    left.includeReminderHistory === right.includeReminderHistory && left.includeNotes === right.includeNotes &&
    left.calendarConnectionGeneration === right.calendarConnectionGeneration && left.calendarSelectionRevision === right.calendarSelectionRevision;
}
