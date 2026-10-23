import { resolveCompletionTiming } from "@cadence/core/resolvers/completion-timing.resolver";
import { createHmac } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { User } from "@supabase/supabase-js";

import {
  AdvisorDayContextValidationError,
  projectAdvisorActivityConnector,
  projectAdvisorCadenceSource,
  projectAdvisorCalendarConnector,
  projectUnavailableAdvisorActivity,
  projectUnavailableAdvisorCalendar,
  projectUnavailableVersionedAdvisorCalendar,
  projectVersionedAdvisorCalendarConnector,
  validateAdvisorDayContext,
  validateVersionedAdvisorDayContext,
} from "@cadence/core/services/advisor-day-context";
import { decideOccurrenceSyncCoverage } from "@cadence/core/services/occurrence-sync";
import {
  ADVISOR_DAY_CONTEXT_LIMITS,
  ADVISOR_DAY_CONTEXT_VERSION,
  ADVISOR_DAY_CONTEXT_VERSION_1_1,
  type AdvisorActivityConnector,
  type AdvisorCalendarConnector,
  type AdvisorCalendarConnectorV1_1,
  type AdvisorDayContext,
  type AdvisorDayContextErrorCode,
  type AdvisorDuration,
  type AdvisorOpaqueRef,
  type AdvisorSourceFailureCode,
} from "@cadence/core/types/advisor-day-context";
import type { BehaviorDurationHistoryOccurrence } from "@cadence/core/types/day-progress";
import { resolveBehaviorDurationSources } from "@cadence/core/resolvers/timeline-context.resolver";
import { normalizeOccurrenceStatus } from "@cadence/core/services/occurrence.service";
import {
  readAdvisorCadenceRevision,
  readAdvisorCadenceSnapshot,
  readAdvisorProfileTimezone,
} from "@/lib/db/advisor-context.repo";
import {
  acquireAdvisorDayContextRead,
  releaseAdvisorDayContextRead,
} from "@/lib/db/advisor-read-admission.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  getCalendarEventsForAdvisor,
  getCalendarConnection,
  type CalendarCaller,
} from "@/lib/services/google-calendar.service";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { getConnectorConnection } from "@/lib/services/connector-credentials";
import { getHevyActivities } from "@/lib/services/hevy.service";
import { getOutlookCalendarConnection, getOutlookCalendarEventsForCaller } from "@/lib/services/outlook-calendar.service";
import { getIcloudCalendarConnection, getIcloudCalendarEventsForCaller } from "@/lib/services/icloud-calendar.service";
import { ConnectorError } from "@/lib/types/connectors";

/** Ticket 239: each connector read stops at 25 s or the brief's remaining source budget, whichever is sooner. */
export const ADVISOR_CONNECTOR_READ_DEADLINE_MS = 25_000;

type AdvisorCalendarFence = Readonly<{
  calendarIds: string[];
  connectionGeneration: number;
  selectionRevision: number;
}>;

export type AdvisorAuthorizationFence = Readonly<{
  userId: string;
  clientId: string;
  /** Server-generated opaque account reference bound to this owner, client, and grant. */
  accountRef: string;
  grantGeneration: number;
  grantExpiresAt: string;
  behaviorIds: string[];
  calendar: AdvisorCalendarFence | null;
  /** Separately disclosed sources (Ticket 239); absent unless the caller requested connector sources. */
  outlookCalendar?: AdvisorCalendarFence | null;
  icloudCalendar?: AdvisorCalendarFence | null;
  hevy?: Readonly<{ connectionGeneration: number }> | null;
}>;

export type AdvisorConnectorSourceRequest = Readonly<{
  outlookCalendar: boolean;
  icloudCalendar: boolean;
  hevy: boolean;
  /** Epoch milliseconds after which no connector read starts or continues. */
  deadlineAt: number;
}>;

export type AdvisorDayContextCaller = Readonly<{
  client: AppSupabaseClient;
  user: User;
}>;

export class AdvisorDayContextServiceError extends Error {
  constructor(
    public readonly code: AdvisorDayContextErrorCode,
    public readonly retryable = false,
    public readonly retryAfterSeconds: number | null = null,
    public readonly recovery: string | null = null,
  ) {
    super(code);
    this.name = "AdvisorDayContextServiceError";
  }
}

type AdvisorDayContextReadInput = Readonly<{
  caller: AdvisorDayContextCaller;
  authorization: AdvisorAuthorizationFence;
  revalidateAuthorization: (signal?: AbortSignal) => Promise<AdvisorAuthorizationFence>;
  includeGoogleCalendar: boolean;
  /** Each requested source also needs its fence in `authorization`. */
  connectorSources?: AdvisorConnectorSourceRequest;
  includeRecordedElapsedDurations?: boolean;
    includeHistoricalCompletionTimes?: boolean;
  localDate?: string;
  now?: Temporal.Instant;
  clock?: () => Temporal.Instant;
  opaqueRefKey: string | Uint8Array;
  deadlineMs?: number;
  signal?: AbortSignal;
}>;

export async function readAdvisorDayContext(input: AdvisorDayContextReadInput & Readonly<{
  historyDays?: number;
}>): Promise<AdvisorDayContext> {
  const [context] = await readAdvisorDayContexts({
    ...input,
    historyDays: [input.historyDays ?? 90],
  });
  return context!;
}

export async function readAdvisorDayContexts(input: AdvisorDayContextReadInput & Readonly<{
  historyDays: readonly number[];
}>): Promise<AdvisorDayContext[]> {
  const clock = input.clock ?? (input.now ? () => input.now as Temporal.Instant : () => Temporal.Now.instant());
  const now = clock();
  const authorization = normalizeAuthorization(input.authorization, input.caller.user.id, now);
  if (input.includeGoogleCalendar && !authorization.calendar) throw new AdvisorDayContextServiceError("access_denied");
  const sources = input.connectorSources;
  if (sources && ((sources.outlookCalendar && !authorization.outlookCalendar) || (sources.icloudCalendar && !authorization.icloudCalendar) ||
      (sources.hevy && !authorization.hevy) || !Number.isFinite(sources.deadlineAt))) {
    throw new AdvisorDayContextServiceError("access_denied");
  }
  if (input.historyDays.length < 1 || input.historyDays.length > 2 ||
      input.historyDays.some((days) => !Number.isInteger(days) || days < 1 || days > 90)) {
    throw new AdvisorDayContextServiceError("invalid_request");
  }
  const deadlineMs = input.deadlineMs ?? ADVISOR_DAY_CONTEXT_LIMITS.deadlineMs;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > ADVISOR_DAY_CONTEXT_LIMITS.deadlineMs) {
    throw new AdvisorDayContextServiceError("invalid_request");
  }
  if (input.signal?.aborted) throw new AdvisorDayContextServiceError("timeout", true);
  const controller = new AbortController();
  const work = (async () => {
    const admission = await acquireAdvisorDayContextRead(input.caller.client, authorization.clientId);
    if (!admission.allowed) throw new AdvisorDayContextServiceError("rate_limited", true, admission.retryAfterSeconds);
    try {
      if (controller.signal.aborted) throw new AdvisorDayContextServiceError("timeout", true);
      return await assembleDayContexts(input, authorization, now, clock, controller.signal);
    } finally {
      // Cleanup cannot delay disclosure after its final authorization check.
      // The database lease expires if the host stops before this best-effort release.
      void releaseAdvisorDayContextRead(input.caller.client, authorization.clientId, admission.leaseToken).catch(() => undefined);
    }
  })();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectExternal: (() => void) | undefined;
  const externalAbort = input.signal ? new Promise<never>((_, reject) => {
    rejectExternal = () => {
      controller.abort();
      reject(new AdvisorDayContextServiceError("timeout", true));
    };
    input.signal?.addEventListener("abort", rejectExternal, { once: true });
  }) : null;
  try {
    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new AdvisorDayContextServiceError("timeout", true));
        }, deadlineMs);
      }),
      ...(externalAbort ? [externalAbort] : []),
    ]);
    if (timer) clearTimeout(timer);
    return result;
  } catch (error) {
    if (timer) clearTimeout(timer);
    if (timedOut) void work.catch(() => undefined);
    throw error;
  } finally {
    if (rejectExternal) input.signal?.removeEventListener("abort", rejectExternal);
  }
}

async function assembleDayContexts(
  input: Readonly<{
    caller: AdvisorDayContextCaller;
    revalidateAuthorization: (signal?: AbortSignal) => Promise<AdvisorAuthorizationFence>;
    includeGoogleCalendar: boolean;
    connectorSources?: AdvisorConnectorSourceRequest;
    includeRecordedElapsedDurations?: boolean;
    includeHistoricalCompletionTimes?: boolean;
    historyDays: readonly number[];
    localDate?: string;
    opaqueRefKey: string | Uint8Array;
    deadlineMs?: number;
  }>,
  authorization: AdvisorAuthorizationFence,
  now: Temporal.Instant,
  clock: () => Temporal.Instant,
  signal: AbortSignal,
): Promise<AdvisorDayContext[]> {
  const opaqueRef = createAdvisorOpaqueRef(input.opaqueRefKey, authorization);
  const timezone = await readAdvisorProfileTimezone(input.caller.client, authorization.userId);
  assertNotAborted(signal);
  const today = now.toZonedDateTimeISO(timezone).toPlainDate();
  const localDate = input.localDate ?? today.toString();
  let requestedDate: Temporal.PlainDate;
  try { requestedDate = Temporal.PlainDate.from(localDate); }
  catch { throw new AdvisorDayContextServiceError("invalid_request"); }
  if (requestedDate.toString() !== localDate || Temporal.PlainDate.compare(requestedDate, today) !== 0) {
    throw new AdvisorDayContextServiceError("invalid_request");
  }
  // Keep the full duration-estimation horizon even when completion history is narrower.
  const readHistoryStartLocalDate = requestedDate.subtract({ days: 90 }).toString();
  const cadenceSnapshot = await readAdvisorCadenceSnapshot(input.caller.client, {
    localDate,
    historyStartLocalDate: readHistoryStartLocalDate,
    behaviorIds: authorization.behaviorIds,
    signal,
  });
  if (cadenceSnapshot.timezone !== timezone || now.toZonedDateTimeISO(cadenceSnapshot.timezone).toPlainDate().toString() !== localDate) {
    throw new AdvisorDayContextServiceError("context_changed", true);
  }
  if (cadenceSnapshot.behaviors.length > ADVISOR_DAY_CONTEXT_LIMITS.behaviors || cadenceSnapshot.occurrences.length > ADVISOR_DAY_CONTEXT_LIMITS.occurrences) {
    throw new AdvisorDayContextServiceError("context_limit_exceeded");
  }
  const coverage = decideOccurrenceSyncCoverage(cadenceSnapshot.syncState, {
    timezone: cadenceSnapshot.timezone,
    startLocalDate: localDate,
    endLocalDate: localDate,
  });
  // A fresh sync fences current Behavior configurations. Preserved occurrences may
  // legitimately retain older or null lineage (past times, notes, or time sessions).
  if (!coverage.covered || cadenceSnapshot.dueArchiveCount > 0) {
    throw new AdvisorDayContextServiceError(
      "context_incomplete",
      true,
      null,
      `${cadenceSnapshot.dueArchiveCount > 0 ? "Open Timeline to reconcile due archives. Then open" : "Open"} Settings, confirm your current timezone, and choose Save timezone to retry schedule synchronization. Then return and try again.`,
    );
  }

  const occurrenceHistoryCapped = cadenceSnapshot.historyOccurrences.length > ADVISOR_DAY_CONTEXT_LIMITS.historyOccurrences;
  const durationHistoryCapped = occurrenceHistoryCapped || cadenceSnapshot.historySessions.length > ADVISOR_DAY_CONTEXT_LIMITS.historySessions;
  const history = durationHistoryCapped ? [] : durationHistory(cadenceSnapshot, authorization.userId);
  const behaviorById = new Map(cadenceSnapshot.behaviors.map((behavior) => [behavior.id, behavior]));
  const durationSources = new Map(cadenceSnapshot.behaviors.map((behavior) => {
    const sources = resolveBehaviorDurationSources({
      behaviorId: behavior.id,
      defaultDurationMinutes: behavior.defaultDurationMinutes,
      occurrences: history,
      now,
      timezone: cadenceSnapshot.timezone,
    });
    return [behavior.id, durationHistoryCapped ? {
      ...sources,
      historicalAverage: { kind: "unknown" as const, reason: "history_limit_exceeded" as const, sampleCount: 0 as const, requiredSampleCount: 3 as const, lookbackDays: 90 as const },
      recordedElapsedDurations: [],
    } : sources] as const;
  }));
  const occurrenceInputs = cadenceSnapshot.occurrences.map((occurrence) => {
    const behavior = behaviorById.get(occurrence.behaviorId);
    const sources = durationSources.get(occurrence.behaviorId);
    if (!behavior || !sources) throw new AdvisorDayContextServiceError("context_changed", true);
    const scheduleKind = occurrence.scheduleKind;
    if (scheduleKind !== "exact" && scheduleKind !== "range") {
      throw new AdvisorDayContextServiceError("context_incomplete", false);
    }
    return {
      id: occurrence.id,
      behaviorId: occurrence.behaviorId,
      title: behavior.title,
      status: normalizeOccurrenceStatus(occurrence.status),
      localDate: occurrence.localDate,
      scheduledFor: occurrence.scheduledFor,
      scheduleKind: scheduleKind as "exact" | "range",
      scheduleStartTime: occurrence.scheduleStartTime,
      scheduleEndTime: occurrence.scheduleEndTime,
      duration: sources.configuredDefault ?? sources.historicalAverage,
      durationCandidates: {
        configuredDefault: sources.configuredDefault ? {
          kind: "known" as const,
          seconds: sources.configuredDefault.seconds,
          source: sources.configuredDefault.provenance,
          sampleCount: sources.configuredDefault.sampleCount,
          lookbackDays: 90 as const,
        } : null,
        historicalAverage: advisorDuration(sources.historicalAverage),
      },
    };
  });

  let connector: AdvisorCalendarConnector | { source: "google_calendar"; state: "not_requested" } = {
    source: "google_calendar",
    state: "not_requested",
  };
  if (input.includeGoogleCalendar && !authorization.calendar) throw new AdvisorDayContextServiceError("access_denied");
  // Separately disclosed sources read beside Google; a failure in one cancels the others.
  const sourceRequest = input.connectorSources;
  const sourceController = new AbortController();
  const sourceSignal = AbortSignal.any([signal, sourceController.signal]);
  const reads = Promise.all([
    input.includeGoogleCalendar ? readCalendar(input.caller, authorization, localDate, now, opaqueRef, signal) : Promise.resolve(connector),
    sourceRequest?.outlookCalendar && authorization.outlookCalendar
      ? readConnectorCalendar("outlook_calendar", input.caller, authorization.outlookCalendar, localDate, clock, opaqueRef, sourceSignal, sourceRequest.deadlineAt) : null,
    sourceRequest?.icloudCalendar && authorization.icloudCalendar
      ? readConnectorCalendar("icloud_calendar", input.caller, authorization.icloudCalendar, localDate, clock, opaqueRef, sourceSignal, sourceRequest.deadlineAt) : null,
    sourceRequest?.hevy && authorization.hevy
      ? readHevyActivity(input.caller, authorization.hevy.connectionGeneration, localDate, clock, opaqueRef, sourceSignal, sourceRequest.deadlineAt) : null,
  ]);
  let added: Array<AdvisorCalendarConnectorV1_1 | AdvisorActivityConnector>;
  try {
    const [google, outlook, icloud, hevy] = await reads;
    connector = google;
    added = [outlook, icloud, hevy].filter((item): item is AdvisorCalendarConnectorV1_1 | AdvisorActivityConnector => item !== null);
  } catch (error) {
    sourceController.abort();
    throw error;
  }

  const currentRevision = await readAdvisorCadenceRevision(input.caller.client, {
    localDate,
    historyStartLocalDate: readHistoryStartLocalDate,
    behaviorIds: authorization.behaviorIds,
    signal,
  });
  if (currentRevision !== cadenceSnapshot.revision) throw new AdvisorDayContextServiceError("context_changed", true);
  assertNotAborted(signal);
  if (input.includeGoogleCalendar && authorization.calendar) {
    const currentCalendar = await getCalendarConnection(input.caller, "agent");
    if (currentCalendar.status !== "connected" || currentCalendar.generation !== authorization.calendar.connectionGeneration || currentCalendar.selectionRevision !== authorization.calendar.selectionRevision) {
      throw new AdvisorDayContextServiceError("context_changed", true);
    }
  }
  assertNotAborted(signal);
  await assertConnectorSourcesCurrent(input.caller, authorization, sourceRequest);
  assertNotAborted(signal);
  const currentAuthorization = normalizeAuthorization(await input.revalidateAuthorization(signal), input.caller.user.id, clock());
  assertNotAborted(signal);
  if (!sameAuthorization(authorization, currentAuthorization)) throw new AdvisorDayContextServiceError("context_changed", true);
  const finalNow = clock();
  if (Temporal.Instant.compare(finalNow, now) < 0 || Temporal.Instant.compare(finalNow, Temporal.Instant.from(cadenceSnapshot.observedAt)) < 0) {
    throw new AdvisorDayContextServiceError("context_changed", true);
  }
  normalizeAuthorization(currentAuthorization, input.caller.user.id, finalNow);
  if (finalNow.toZonedDateTimeISO(cadenceSnapshot.timezone).toPlainDate().toString() !== localDate) {
    throw new AdvisorDayContextServiceError("context_changed", true);
  }

  const dayStart = requestedDate.toZonedDateTime({ timeZone: cadenceSnapshot.timezone, plainTime: "00:00" });
  const dayEnd = dayStart.add({ days: 1 });
  const calendarExpiry = connector.state === "not_requested" || connector.fetchedAt === null
    ? null
    : Temporal.Instant.from(connector.fetchedAt).add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs });
  const addedExpiry = added.flatMap((item) => item.complete && item.fetchedAt
    ? [Temporal.Instant.from(item.fetchedAt).add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs })] : []);
  const expiresAt = minInstant([
    Temporal.Instant.from(cadenceSnapshot.observedAt).add({ milliseconds: ADVISOR_DAY_CONTEXT_LIMITS.freshnessMs }),
    Temporal.Instant.from(authorization.grantExpiresAt),
    dayEnd.toInstant(),
    ...(calendarExpiry ? [calendarExpiry] : []),
    ...addedExpiry,
  ]);
  if (Temporal.Instant.compare(expiresAt, finalNow) <= 0) throw new AdvisorDayContextServiceError("context_changed", true);
  const revisionMaterial = JSON.stringify([
    cadenceSnapshot.revision,
    connector.state,
    connector.state === "not_requested" ? null : [connector.connectionGeneration, connector.selectionRevision, connector.fetchedAt],
    finalNow.toString(),
    ...(added.length ? [added.map((item) => [item.source, item.state, item.connectionGeneration, "selectionRevision" in item ? item.selectionRevision : null, item.fetchedAt])] : []),
  ]);
  // Google-only reads keep the exact `1.0` shape; any disclosed new source moves the context to `1.1`.
  const versioned = added.length > 0;
  const status = (connector.state === "not_requested" || connector.complete) && added.every((item) => item.complete) ? "complete" : "partial";
  return input.historyDays.map((historyDays) => {
    const historyStartLocalDate = requestedDate.subtract({ days: historyDays }).toString();
    const cadence = projectAdvisorCadenceSource({
      observedAt: cadenceSnapshot.observedAt,
      revision: cadenceSnapshot.revision,
      historyStartLocalDate,
      historyEndLocalDateExclusive: localDate,
      historyDays,
      behaviors: cadenceSnapshot.behaviors,
      historyOccurrences: occurrenceHistoryCapped ? [] : cadenceSnapshot.historyOccurrences.filter(
        (occurrence) => occurrence.localDate >= historyStartLocalDate && occurrence.localDate < localDate,
      ).map((occurrence) => ({
        id: occurrence.id,
        behaviorId: occurrence.behaviorId,
        localDate: occurrence.localDate,
        status: normalizeOccurrenceStatus(occurrence.status),
      })),
      historyComplete: !occurrenceHistoryCapped,
      ...(input.includeRecordedElapsedDurations ? {
        recordedElapsedDurations: [...durationSources.entries()].flatMap(([behaviorId, sources]) =>
          sources.recordedElapsedDurations.map((sample) => ({ behaviorId, ...sample }))),
      } : {}),
      makeOpaqueRef: opaqueRef,
      occurrences: occurrenceInputs,
      ...(input.includeHistoricalCompletionTimes ? {
        historicalCompletionTimes: {
          semantics: "completion_mark" as const,
          timezone: cadenceSnapshot.timezone,
          lookbackDays: historyDays,
          startLocalDate: historyStartLocalDate,
          endLocalDateExclusive: localDate,
          behaviors: cadenceSnapshot.behaviors.map(behavior => ({
            behaviorRef: opaqueRef("behavior", behavior.id),
            ...resolveCompletionTiming({ behaviorId: behavior.id, occurrences: cadenceSnapshot.historyOccurrences,
              timezone: cadenceSnapshot.timezone, now, historyDays, complete: !occurrenceHistoryCapped,
              sourceAvailable: cadenceSnapshot.historyOccurrences.every(item => "statusMarkedAt" in item) }),
          })),
        },
      } : {}),
    });
    const validate = versioned ? validateVersionedAdvisorDayContext : validateAdvisorDayContext;
    const validated = validate({
      version: versioned ? ADVISOR_DAY_CONTEXT_VERSION_1_1 : ADVISOR_DAY_CONTEXT_VERSION,
      snapshotId: opaqueRef("snapshot", revisionMaterial),
      accountRef: authorization.accountRef,
      localDate,
      timezone: cadenceSnapshot.timezone,
      dayStartAt: dayStart.toInstant().toString(),
      dayEndAt: dayEnd.toInstant().toString(),
      capturedAt: finalNow.toString(),
      expiresAt: expiresAt.toString(),
      status,
      authority: "read_only",
      grantGeneration: authorization.grantGeneration,
      cadence,
      connectors: [connector, ...added],
    });
    if (Buffer.byteLength(JSON.stringify(validated), "utf8") > ADVISOR_DAY_CONTEXT_LIMITS.responseBytes) {
      throw new AdvisorDayContextServiceError("context_limit_exceeded");
    }
    return validated;
  });
}

function advisorDuration(estimate: ReturnType<typeof resolveBehaviorDurationSources>["historicalAverage"] | Readonly<{
  kind: "unknown";
  reason: "history_limit_exceeded";
  sampleCount: 0;
  requiredSampleCount: 3;
  lookbackDays: 90;
}>): AdvisorDuration {
  return estimate.kind === "known"
    ? { kind: "known", seconds: estimate.seconds, source: estimate.provenance, sampleCount: estimate.sampleCount, lookbackDays: 90 }
    : { kind: "unknown", reason: estimate.reason, sampleCount: estimate.sampleCount, lookbackDays: 90 };
}

async function readCalendar(
  caller: CalendarCaller,
  authorization: AdvisorAuthorizationFence,
  localDate: string,
  now: Temporal.Instant,
  makeOpaqueRef: AdvisorOpaqueRef,
  signal: AbortSignal,
): Promise<AdvisorCalendarConnector> {
  if (!authorization.calendar) throw new AdvisorDayContextServiceError("access_denied");
  const calendarAuthorization = authorization.calendar;
  try {
    const read = await getCalendarEventsForAdvisor(caller, localDate, localDate, {
      authorizedCalendarIds: calendarAuthorization.calendarIds,
      expectedConnectionGeneration: calendarAuthorization.connectionGeneration,
      expectedSelectionRevision: calendarAuthorization.selectionRevision,
      authorizationScope: `${authorization.clientId}:${authorization.grantGeneration}`,
      now,
      signal,
    });
    const snapshot = read.result.ok ? read.result.snapshot : read.result.partialSnapshot;
    return projectAdvisorCalendarConnector({
      snapshot,
      selectionRevision: read.connection.selectionRevision,
      now,
      makeOpaqueRef,
      failure: read.result.ok ? null : read.result.error,
    });
  } catch (error) {
    if (error instanceof AdvisorDayContextValidationError && error.code === "context_limit_exceeded") {
      throw new AdvisorDayContextServiceError("context_limit_exceeded");
    }
    if (error instanceof CalendarConnectionError && error.code === "connection_changed") {
      throw new AdvisorDayContextServiceError("context_changed", true);
    }
    if (error instanceof CalendarConnectionError && error.code === "same_account_required") {
      throw new AdvisorDayContextServiceError("access_denied");
    }
    return projectUnavailableAdvisorCalendar({
      connectionGeneration: calendarAuthorization.connectionGeneration,
      selectionRevision: calendarAuthorization.selectionRevision,
      failure: calendarFailure(error),
    });
  }
}

/** Remaining source budget, capped at 25 s. Zero or less means the read must not start. */
function connectorReadDeadline(deadlineAt: number): number {
  return Math.min(ADVISOR_CONNECTOR_READ_DEADLINE_MS, Math.floor(deadlineAt - Date.now()));
}

const SOURCE_TIMEOUT = { code: "timeout" as const, retryable: true, retryAfterSeconds: null };

/** Outlook or iCloud: today's selected calendars under the fenced generation, selection, and remaining brief budget. */
async function readConnectorCalendar(
  source: "outlook_calendar" | "icloud_calendar",
  caller: CalendarCaller,
  fence: AdvisorCalendarFence,
  localDate: string,
  clock: () => Temporal.Instant,
  makeOpaqueRef: AdvisorOpaqueRef,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<AdvisorCalendarConnectorV1_1> {
  const unavailable = (failure: ReturnType<typeof connectorFailure>) => projectUnavailableVersionedAdvisorCalendar({
    source, connectionGeneration: fence.connectionGeneration, selectionRevision: fence.selectionRevision, failure,
  });
  const deadlineMs = connectorReadDeadline(deadlineAt);
  if (deadlineMs <= 0) return unavailable(SOURCE_TIMEOUT);
  const readEvents = source === "outlook_calendar" ? getOutlookCalendarEventsForCaller : getIcloudCalendarEventsForCaller;
  try {
    const read = await readEvents(caller, localDate, localDate, {
      deadlineMs,
      signal,
      authorizedCalendarIds: fence.calendarIds,
      expectedConnectionGeneration: fence.connectionGeneration,
      expectedSelectionRevision: fence.selectionRevision,
    });
    assertNotAborted(signal);
    return projectVersionedAdvisorCalendarConnector({
      snapshot: read.result.ok ? read.result.snapshot : read.result.partialSnapshot,
      selectionRevision: read.connection.selectionRevision,
      now: clock(),
      makeOpaqueRef,
      failure: read.result.ok ? null : read.result.error,
    });
  } catch (error) {
    rethrowSourceError(error);
    return unavailable(connectorFailure(error));
  }
}

/** Today's recorded workouts only: past timing, never a schedule, availability, or completion. */
async function readHevyActivity(
  caller: CalendarCaller,
  connectionGeneration: number,
  localDate: string,
  clock: () => Temporal.Instant,
  makeOpaqueRef: AdvisorOpaqueRef,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<AdvisorActivityConnector> {
  const deadlineMs = connectorReadDeadline(deadlineAt);
  if (deadlineMs <= 0) return projectUnavailableAdvisorActivity({ connectionGeneration, failure: SOURCE_TIMEOUT });
  try {
    const snapshot = await getHevyActivities(caller, localDate, localDate, { expectedConnectionGeneration: connectionGeneration, signal, deadlineMs });
    assertNotAborted(signal);
    return projectAdvisorActivityConnector({ snapshot, now: clock(), makeOpaqueRef });
  } catch (error) {
    rethrowSourceError(error);
    return projectUnavailableAdvisorActivity({ connectionGeneration, failure: connectorFailure(error) });
  }
}

function rethrowSourceError(error: unknown): void {
  if (error instanceof AdvisorDayContextServiceError) throw error;
  if (error instanceof AdvisorDayContextValidationError && error.code === "context_limit_exceeded") {
    throw new AdvisorDayContextServiceError("context_limit_exceeded");
  }
  if (error instanceof ConnectorError && error.code === "connection_changed") throw new AdvisorDayContextServiceError("context_changed", true);
}

/** Every disclosed source must still be the connected generation and selection the brief read. */
async function assertConnectorSourcesCurrent(
  caller: CalendarCaller,
  authorization: AdvisorAuthorizationFence,
  request: AdvisorConnectorSourceRequest | undefined,
): Promise<void> {
  if (!request) return;
  const checks: Array<Promise<boolean>> = [];
  const calendar = (provider: "outlook_calendar" | "icloud_calendar", fence: AdvisorCalendarFence) =>
    (provider === "outlook_calendar" ? getOutlookCalendarConnection(caller) : getIcloudCalendarConnection(caller)).then((current) =>
      current.status === "connected" && current.generation === fence.connectionGeneration && current.selectionRevision === fence.selectionRevision);
  if (request.outlookCalendar && authorization.outlookCalendar) checks.push(calendar("outlook_calendar", authorization.outlookCalendar));
  if (request.icloudCalendar && authorization.icloudCalendar) checks.push(calendar("icloud_calendar", authorization.icloudCalendar));
  const hevy = authorization.hevy;
  if (request.hevy && hevy) {
    checks.push(getConnectorConnection(caller, "hevy").then((current) => current.status === "connected" && current.generation === hevy.connectionGeneration));
  }
  if ((await Promise.all(checks)).some((current) => !current)) throw new AdvisorDayContextServiceError("context_changed", true);
}

function connectorFailure(error: unknown): { code: AdvisorSourceFailureCode; retryable: boolean; retryAfterSeconds: number | null } {
  const code = error instanceof ConnectorError ? error.code : "provider_unavailable";
  if (code === "reconnect_required" || code === "not_connected") return { code, retryable: false, retryAfterSeconds: null };
  if (code === "not_configured") return { code: "not_connected", retryable: false, retryAfterSeconds: null };
  if (code === "permission_denied" || code === "rate_limited" || code === "timeout" || code === "provider_unavailable" || code === "malformed_provider_response" || code === "incomplete_pagination") {
    return { code, retryable: code === "rate_limited" || code === "timeout" || code === "provider_unavailable", retryAfterSeconds: null };
  }
  return { code: "provider_unavailable", retryable: true, retryAfterSeconds: null };
}

function durationHistory(snapshot: Awaited<ReturnType<typeof readAdvisorCadenceSnapshot>>, userId: string): BehaviorDurationHistoryOccurrence[] {
  const sessionsByOccurrence = new Map<string, typeof snapshot.historySessions>();
  for (const session of snapshot.historySessions) {
    const sessions = sessionsByOccurrence.get(session.occurrenceId) ?? [];
    sessions.push(session);
    sessionsByOccurrence.set(session.occurrenceId, sessions);
  }
  return snapshot.historyOccurrences.map((occurrence) => ({
    id: occurrence.id,
    behaviorId: occurrence.behaviorId,
    localDate: occurrence.localDate,
    status: normalizeOccurrenceStatus(occurrence.status),
    sessions: (sessionsByOccurrence.get(occurrence.id) ?? []).map((session) => ({
      id: session.id,
      userId,
      occurrenceId: session.occurrenceId,
      behaviorId: session.behaviorId,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
    })),
  }));
}

function normalizeAuthorization(value: AdvisorAuthorizationFence, userId: string, now: Temporal.Instant): AdvisorAuthorizationFence {
  if (value.userId !== userId || !value.clientId || !value.accountRef || !Number.isInteger(value.grantGeneration) || value.grantGeneration < 0) {
    throw new AdvisorDayContextServiceError("access_denied");
  }
  let expiry: Temporal.Instant;
  try { expiry = Temporal.Instant.from(value.grantExpiresAt); }
  catch { throw new AdvisorDayContextServiceError("access_denied"); }
  if (Temporal.Instant.compare(expiry, now) <= 0) throw new AdvisorDayContextServiceError("access_denied");
  const behaviorIds = uniqueIds(value.behaviorIds, ADVISOR_DAY_CONTEXT_LIMITS.behaviors);
  const calendar = value.calendar ? {
    ...value.calendar,
    calendarIds: uniqueIds(value.calendar.calendarIds, ADVISOR_DAY_CONTEXT_LIMITS.calendars),
  } : null;
  if (calendar && (!Number.isInteger(calendar.connectionGeneration) || calendar.connectionGeneration < 0 || !Number.isInteger(calendar.selectionRevision) || calendar.selectionRevision < 0)) {
    throw new AdvisorDayContextServiceError("access_denied");
  }
  const connectorCalendar = (fence: AdvisorCalendarFence | null | undefined) => {
    if (!fence) return fence;
    const ids = uniqueIds(fence.calendarIds, ADVISOR_DAY_CONTEXT_LIMITS.calendars);
    if (ids.length === 0 || !Number.isInteger(fence.connectionGeneration) || fence.connectionGeneration < 0 ||
        !Number.isInteger(fence.selectionRevision) || fence.selectionRevision < 0) throw new AdvisorDayContextServiceError("access_denied");
    return { ...fence, calendarIds: ids };
  };
  if (value.hevy && (!Number.isInteger(value.hevy.connectionGeneration) || value.hevy.connectionGeneration < 0)) {
    throw new AdvisorDayContextServiceError("access_denied");
  }
  return {
    ...value, behaviorIds, calendar,
    ...("outlookCalendar" in value ? { outlookCalendar: connectorCalendar(value.outlookCalendar) } : {}),
    ...("icloudCalendar" in value ? { icloudCalendar: connectorCalendar(value.icloudCalendar) } : {}),
  };
}

function uniqueIds(ids: readonly string[], max: number): string[] {
  if (!Array.isArray(ids) || ids.length > max || ids.some((id) => typeof id !== "string" || !id || id.length > 1024)) {
    throw new AdvisorDayContextServiceError("access_denied");
  }
  const unique = [...new Set(ids)].sort();
  if (unique.length !== ids.length) throw new AdvisorDayContextServiceError("access_denied");
  return unique;
}

function sameAuthorization(left: AdvisorAuthorizationFence, right: AdvisorAuthorizationFence): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createAdvisorOpaqueRef(key: string | Uint8Array, authorization: AdvisorAuthorizationFence): AdvisorOpaqueRef {
  const bytes = typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (bytes.byteLength < 32) throw new AdvisorDayContextServiceError("access_denied");
  const domain = `${authorization.userId}\0${authorization.clientId}\0${authorization.grantGeneration}`;
  return (kind, value) => `${kind}_${createHmac("sha256", bytes).update(`${domain}\0${kind}\0${value}`).digest("base64url")}`;
}

function calendarFailure(error: unknown): { code: AdvisorSourceFailureCode; retryable: boolean; retryAfterSeconds: number | null } {
  const code = error instanceof CalendarConnectionError ? error.code : "provider_unavailable";
  if (code === "reconnect_required") return { code, retryable: false, retryAfterSeconds: null };
  if (code === "not_configured") return { code: "not_connected", retryable: false, retryAfterSeconds: null };
  if (code === "permission_denied" || code === "rate_limited" || code === "timeout" || code === "provider_unavailable" || code === "malformed_provider_response" || code === "incomplete_pagination") {
    return { code, retryable: code === "rate_limited" || code === "timeout" || code === "provider_unavailable", retryAfterSeconds: null };
  }
  return { code: "provider_unavailable", retryable: true, retryAfterSeconds: null };
}

function minInstant(values: Temporal.Instant[]): Temporal.Instant {
  return values.reduce((earliest, value) => Temporal.Instant.compare(value, earliest) < 0 ? value : earliest);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new AdvisorDayContextServiceError("timeout", true);
}
