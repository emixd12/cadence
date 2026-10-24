import { createHash, randomBytes } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { AdvisorDayContext, AdvisorOpaqueRef } from "@cadence/core/types/advisor-day-context";
import type { AdvisorTravelContext } from "@cadence/core/types/briefing-travel";
import { validateVersionedAdvisorDayContext } from "@cadence/core/services/advisor-day-context";
import { storedBehaviorWhere } from "@cadence/core/services/behavior-where";
import { advisorPlaceLabelCounts, advisorTravelHabits, buildAdvisorTravelContext } from "@cadence/core/services/briefing-travel";
import { travelHabitsFromSyncValue } from "@cadence/core/services/travel-habits";
import { PLACE_LABEL_RETENTIONS, type PlaceLabelRetention, type PlaceLabelValue } from "@cadence/core/types/place-labels";
import { readTravelBehaviorLocations, readTravelSettingsRow } from "@/lib/db/travelSettings.repo";
import { readCompletionPlaceLabelRows, readPlaceLabelSettingsRow } from "@/lib/db/placeLabels.repo";
import { listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import { listTimeSessionHistory } from "@/lib/db/timeSessions.repo";
import { readTravelRouteSource } from "./travel-settings.service";
import {
  renameTravelConclusionRefs,
  travelConclusionsSourceKey,
  travelDurationHistoryRange,
  travelDurationRevision,
  verifyTravelConclusionsToken,
  type TravelConclusionsPayload,
  type TravelConclusionsSecrets,
} from "./travel-conclusions-token";
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
import { getConnectorConnection } from "./connector-credentials";
import { getOutlookCalendarConnection } from "./outlook-calendar.service";

const CLIENT_ID = "cadence-daily-brief";
type VerifiedTravelConclusions = TravelConclusionsPayload & Readonly<{ calendarRequired: boolean }>;

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
    /**
     * Ticket 239: only the live Daily Brief passes this. Each source is read
     * only with its own disclosure; `deadlineAt` (epoch ms) ends provider reads
     * before the generation reserve. Workbench and history omit it, so older
     * presets and evaluations never read a new source.
     */
    connectorSources?: Readonly<{ calendars: boolean; recordedActivity: boolean; deadlineAt: number }>;
    /**
     * Ticket 219 Option A: only the live Daily Brief passes the token its request
     * returned. A token that fails any check leaves route and weather facts
     * `not_supplied`; it never fails the brief. Workbench and history omit it.
     */
    travelConclusions?: Readonly<{ token: unknown; secrets: TravelConclusionsSecrets }>;
  }>,
): Promise<Readonly<{
  contexts: AdvisorDayContext[];
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

  const sources = input.connectorSources;
  const includeOutlook = !!sources?.calendars && preferences.includeOutlookCalendar;
  const includeIcloud = !!sources?.calendars && preferences.includeIcloudCalendar;
  const includeHevy = !!sources?.recordedActivity && preferences.includeHevy;
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
    // Each disclosed connector must still match the generation and selection it was granted for.
    const connectorFence = async (provider: "outlook_calendar" | "icloud_calendar", generation: number | null, revision: number | null) => {
      const connection = provider === "outlook_calendar" ? await getOutlookCalendarConnection(caller) : await getConnectorConnection(caller, provider);
      signal.throwIfAborted();
      if (connection.status !== "connected" || connection.generation !== generation || connection.selectionRevision !== revision) {
        throw new DailyBriefError("context_changed");
      }
      return {
        calendarIds: [...connection.preferences.selectedSourceIds].sort(),
        connectionGeneration: connection.generation,
        selectionRevision: connection.selectionRevision,
      };
    };
    const outlookCalendar = includeOutlook ? await connectorFence("outlook_calendar", preferences.outlookConnectionGeneration, preferences.outlookSelectionRevision) : null;
    const icloudCalendar = includeIcloud ? await connectorFence("icloud_calendar", preferences.icloudConnectionGeneration, preferences.icloudSelectionRevision) : null;
    let hevy: AdvisorAuthorizationFence["hevy"] = null;
    if (includeHevy) {
      const connection = await getConnectorConnection(caller, "hevy");
      signal.throwIfAborted();
      if (connection.status !== "connected" || connection.generation !== preferences.hevyConnectionGeneration) throw new DailyBriefError("context_changed");
      hevy = { connectionGeneration: connection.generation };
    }
    return {
      userId: caller.user.id,
      clientId: CLIENT_ID,
      accountRef: briefingAccountRef(caller.user.id),
      grantGeneration: preferences.revision,
      grantExpiresAt,
      behaviorIds,
      calendar,
      ...(sources ? { outlookCalendar, icloudCalendar, hevy } : {}),
    };
  };

  const authorization = await readAuthorization();
  const capturedContexts = await readAdvisorDayContexts({
    caller,
    authorization,
    revalidateAuthorization: readAuthorization,
    historyDays: input.historyDays,
    includeGoogleCalendar: input.includeCalendar && preferences.includeCalendar,
    ...(sources ? { connectorSources: { outlookCalendar: includeOutlook, icloudCalendar: includeIcloud, hevy: includeHevy, deadlineAt: sources.deadlineAt } } : {}),
    includeRecordedElapsedDurations: input.includeRecordedElapsedDurations,
    includeHistoricalCompletionTimes: input.includeHistoricalCompletionTimes,
    localDate: input.localDate,
    opaqueRefKey: key,
    clock,
    signal: input.signal,
  });
  input.signal.throwIfAborted();
  const makeOpaqueRef = createAdvisorOpaqueRef(key, authorization);
  // Ticket 219: stored travel facts only (Where, usual travel, learned habits and
  // place label counts). Route conclusions and weather never come from this path,
  // so the account workbench never sends Maps-derived facts.
  const readTravel = () => readBriefingTravel(caller, authorization.behaviorIds, makeOpaqueRef, capturedContexts[0]!.localDate);
  const travel = await readTravel();
  input.signal.throwIfAborted();
  const supplied = input.travelConclusions && travel.routing === "on"
    ? await readSuppliedTravelConclusions(caller, input.travelConclusions, capturedContexts[0]!.localDate, clock()).catch(() => null)
    : null;
  input.signal.throwIfAborted();
  // Expiry is checked on admission; delivery still fences the stored inputs behind accepted conclusions.
  const contexts = capturedContexts.map((context) => withTravel(context, travel, supplied, makeOpaqueRef));
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
    // Where edits do not change the Cadence revision, so travel facts are fenced directly.
    if (JSON.stringify(await readTravel()) !== JSON.stringify(travel)) throw new DailyBriefError("context_changed");
    if (supplied && contexts.some((candidate) => candidate.travel?.route.state === "available")) {
      const currentSource = await readCurrentTravelSource(caller, context.localDate, clock());
      if (currentSource.key !== supplied.src) throw new DailyBriefError("context_changed");
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

async function readBriefingTravel(caller: CalendarCaller, behaviorIds: readonly string[], makeOpaqueRef: AdvisorOpaqueRef, localDate: string): Promise<AdvisorTravelContext> {
  const [settings, behaviors, labelSettings] = await Promise.all([
    readTravelSettingsRow(caller.client, caller.user.id),
    readTravelBehaviorLocations(caller.client, caller.user.id),
    readPlaceLabelSettingsRow(caller.client, caller.user.id),
  ]);
  const labelsOn = labelSettings?.enabled === true;
  const labels = labelsOn ? await readCompletionPlaceLabelRows(caller.client, caller.user.id) : [];
  const authorized = new Set(behaviorIds);
  // Place and Home text derive place keys and label refs here; neither leaves this function.
  const visible = behaviors.filter((behavior) => authorized.has(behavior.id)).map((behavior) => ({
    id: behavior.id,
    behaviorRef: makeOpaqueRef("behavior", behavior.id),
    whereKind: storedBehaviorWhere({ where_kind: behavior.where_kind }).where_kind,
    locationText: behavior.location_text,
  }));
  const habits = settings ? travelHabitsFromSyncValue({
    travel_preparation_minutes: settings.preparation_minutes,
    travel_arrival_buffer_minutes: settings.arrival_buffer_minutes,
    travel_place_modes: settings.place_modes,
    travel_leave_feedback: settings.leave_feedback,
    travel_habits_updated_at: settings.habits_updated_at,
  }) : null;
  return buildAdvisorTravelContext({
    routing: !!settings?.enabled && !!settings.routing_consent_at,
    usualMode: settings?.mode ?? null,
    behaviors: visible.map(({ behaviorRef, whereKind }) => ({ behaviorRef, whereKind })),
    habits: advisorTravelHabits(habits, visible, settings?.base_location_text ?? null),
    placeLabels: advisorPlaceLabelCounts({ enabled: labelsOn, retention: (PLACE_LABEL_RETENTIONS as readonly string[]).includes(labelSettings?.retention ?? "")
        ? labelSettings!.retention as PlaceLabelRetention : "90_days", behaviors: visible,
      today: Temporal.PlainDate.from(localDate),
      labels: labels.map((label) => ({ behaviorId: label.behavior_id, localDate: label.local_date, label: label.label as PlaceLabelValue })) }),
  });
}

/** Keeps only Behaviors this context carries, as the strict context validator requires. */
function withTravel(context: AdvisorDayContext, travel: AdvisorTravelContext, supplied: VerifiedTravelConclusions | null,
  makeOpaqueRef: AdvisorOpaqueRef): AdvisorDayContext {
  const refs = new Set([...context.cadence.occurrences.map(({ behaviorRef }) => behaviorRef), ...context.cadence.history.behaviors.map(({ behaviorRef }) => behaviorRef)]);
  const placeLabels = travel.placeLabels ? { ...travel.placeLabels,
    behaviors: travel.placeLabels.behaviors.filter(({ behaviorRef }) => refs.has(behaviorRef)),
    retained: { ...travel.placeLabels.retained, behaviors: travel.placeLabels.retained.behaviors.filter(({ behaviorRef }) => refs.has(behaviorRef)) },
  } : null;
  const stored: AdvisorTravelContext = {
    ...travel,
    behaviors: travel.behaviors.filter(({ behaviorRef }) => refs.has(behaviorRef)),
    ...(travel.habits ? { habits: { ...travel.habits, placeModes: travel.habits.placeModes.filter(({ behaviorRef }) => refs.has(behaviorRef)) } } : {}),
    ...(placeLabels ? { placeLabels } : {}),
  };
  if (supplied) {
    try {
      return validateVersionedAdvisorDayContext({ ...context, travel: withSuppliedConclusions(context, stored, supplied, makeOpaqueRef) });
    } catch {
      // A token naming a commitment this context lacks, or a changed Calendar event, supplies nothing.
    }
  }
  return validateVersionedAdvisorDayContext({ ...context, travel: stored });
}

/**
 * Ticket 219 Option A: verifies the signature, owner, local date and expiry, then the
 * current stored travel inputs. Returns null on any mismatch.
 */
async function readSuppliedTravelConclusions(caller: CalendarCaller, supplied: Readonly<{ token: unknown; secrets: TravelConclusionsSecrets }>,
  localDate: string, now: Temporal.Instant): Promise<VerifiedTravelConclusions | null> {
  const payload = verifyTravelConclusionsToken(supplied.token, { secrets: supplied.secrets, userId: caller.user.id, localDate, now });
  if (!payload) return null;
  const current = await readCurrentTravelSource(caller, localDate, now);
  return current.key === payload.src ? { ...payload, calendarRequired: current.calendarRequired } : null;
}

async function readCurrentTravelSource(caller: CalendarCaller, localDate: string, now: Temporal.Instant): Promise<Readonly<{ key: string; calendarRequired: boolean }>> {
  const historyRange = travelDurationHistoryRange(localDate);
  const [source, calendar, occurrences, timezone, historyOccurrences, historySessions] = await Promise.all([
    readTravelRouteSource(caller.client, caller.user.id),
    getCalendarConnection(caller),
    listOccurrencesBetweenLocalDates(caller.client, caller.user.id, localDate, localDate),
    readAdvisorProfileTimezone(caller.client, caller.user.id),
    listOccurrencesBetweenLocalDates(caller.client, caller.user.id, historyRange.startLocalDate, historyRange.endLocalDate),
    listTimeSessionHistory(caller.client, { userId: caller.user.id, ...historyRange, includeArchived: false, throughStartedAt: now.toString() }),
  ]);
  if (!timezone) throw new DailyBriefError("context_changed");
  const key = travelConclusionsSourceKey({ settingsRevision: source.settingsRevision, habitsRevision: source.habitsRevision,
    enabled: source.settings.enabled, mode: source.settings.mode, routingConsentAt: source.settings.routingConsentAt,
    baseLocationText: source.settings.baseLocationText, habits: source.settings.habits ?? null,
    calendar, behaviors: source.behaviors, occurrences, timezone, durationRevision: travelDurationRevision(historyOccurrences, historySessions) });
  return { key, calendarRequired: calendar.status === "connected" };
}

/** Maps the token's commitments to this context's opaque refs; a changed Calendar event throws. */
function withSuppliedConclusions(context: AdvisorDayContext, travel: AdvisorTravelContext, supplied: VerifiedTravelConclusions,
  makeOpaqueRef: AdvisorOpaqueRef): AdvisorTravelContext {
  const calendar = context.connectors.find((connector) => connector.source === "google_calendar");
  if (supplied.calendarRequired && (!calendar || calendar.state !== "current" || !calendar.complete)) {
    throw new Error("Current Calendar snapshot is required for travel conclusions.");
  }
  const eventRevisions = new Map(context.connectors.flatMap((connector) =>
    connector.source === "google_calendar" && connector.state !== "not_requested" && "events" in connector
      ? connector.events.map((event) => [event.ref, event.revision] as const) : []));
  if (Object.keys(supplied.events).length !== eventRevisions.size || Object.entries(supplied.events).some(([key, revision]) =>
    !key.startsWith("event:") || eventRevisions.get(makeOpaqueRef("event", key.slice("event:".length))) !== makeOpaqueRef("revision", revision))) {
    throw new Error("Calendar event set changed after travel was planned.");
  }
  const rename = (key: string) => {
    if (key.startsWith("occurrence:")) return makeOpaqueRef("occurrence", key.slice("occurrence:".length));
    if (!key.startsWith("event:")) throw new Error("Unknown travel commitment.");
    const ref = makeOpaqueRef("event", key.slice("event:".length));
    const revision = supplied.events[key];
    if (revision === undefined || eventRevisions.get(ref) !== makeOpaqueRef("revision", revision)) throw new Error("Calendar event changed after travel was planned.");
    return ref;
  };
  const facts = renameTravelConclusionRefs({ conclusions: supplied.conclusions, weather: supplied.weather }, rename);
  return { ...travel, route: { state: "available", conclusions: facts.conclusions }, ...(facts.weather ? { weather: facts.weather } : {}) };
}

function samePreferences(left: DailyBriefPreferences, right: DailyBriefPreferences): boolean {
  return left.enabled === right.enabled && left.includeCalendar === right.includeCalendar && left.revision === right.revision &&
    left.includeReminderHistory === right.includeReminderHistory && left.includeNotes === right.includeNotes &&
    left.calendarConnectionGeneration === right.calendarConnectionGeneration && left.calendarSelectionRevision === right.calendarSelectionRevision &&
    left.includeOutlookCalendar === right.includeOutlookCalendar && left.outlookConnectionGeneration === right.outlookConnectionGeneration &&
    left.outlookSelectionRevision === right.outlookSelectionRevision && left.includeIcloudCalendar === right.includeIcloudCalendar &&
    left.icloudConnectionGeneration === right.icloudConnectionGeneration && left.icloudSelectionRevision === right.icloudSelectionRevision &&
    left.includeHevy === right.includeHevy && left.hevyConnectionGeneration === right.hevyConnectionGeneration;
}
