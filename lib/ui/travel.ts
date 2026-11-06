"use client";

import { useEffect, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TimelineView } from "@/lib/types/timeline";
import type { TravelSettingsClient } from "./travel-settings";
import { webTravelSettingsClient } from "./travel-settings";
import { clearTravelLeaveMemory } from "./travel-habits";
import { readBrowserForegroundLocation, type ForegroundLocation } from "./foreground-location";
import {
  recordTravelRefresh, resolveTravelRefreshPlan, resolveTravelTomorrowPlan, travelDeviceMoved, travelRefreshRequestFields, travelRefreshTripsFromEvidence,
  type TravelBudgetState, type TravelDeviceSample, type TravelRefreshRequest, type TravelRefreshState, type TravelTripRef,
} from "@cadence/core/services/travel-refresh-policy";
import { changedTravelStops, mergeTravelLastEstimates, withdrawChangedTravelTrips } from "@cadence/core/resolvers/travel.resolver";
import { firstLocatedStopAhead } from "@cadence/core/services/departure-stops";

/** One event revision's destination for this trip. Decision D12: a located event is in person, so nothing asks attendance. */
export type TravelCorrection = Readonly<{ eventId: string; revision: string; locationText: string }>;
export type TravelRoutesInput = Readonly<{
  startLocalDate: string; endLocalDate: string;
  /** Ticket 282: `first_trip` asks for tomorrow's first trip alone. */
  scope?: "timeline" | "day" | "first_trip";
  /** Ticket 267: route only these trips. Ticket 268 clients send it for trip refreshes. */
  trips?: readonly TravelTripRef[];
  device: Readonly<{ latitude: number; longitude: number; accuracyMeters: number; sampledAt: string }> | null;
  corrections?: readonly TravelCorrection[];
}>;
export type TravelRoutesView = Readonly<{
  accountId: string; mode: TravelMode | null; navigationPreference: TravelNavigationPreference | null;
  settingsRevision: string | null; expiresAt: string | null; evidence: Omit<TravelEvidenceResult, "modelProjection"> | null;
  /** Ticket 217: learned-habit revision; a desktop view waits until its habits have synchronized. */
  habitsRevision?: string | null;
  /** Ticket 219 Option A: signed conclusions, returned unchanged with the Daily Brief request. */
  conclusionsToken?: string;
  /** Ticket 267: the month's reserved spend after this request. Absent from older servers. */
  budget?: TravelBudgetState;
}>;
export type TravelClient = Readonly<{
  settings: TravelSettingsClient;
  configured: (signal: AbortSignal) => Promise<boolean>;
  routes: (input: TravelRoutesInput, signal: AbortSignal) => Promise<TravelRoutesView>;
  readLocation: (requestPermission: boolean) => Promise<ForegroundLocation>;
}>;
export type TravelClientErrorCode = "quota_exceeded" | "context_changed" | "provider_unavailable" | "provider_clearance_required" | "unauthenticated" | "unknown";
export class TravelClientError extends Error {
  code: TravelClientErrorCode;
  retryAfterSeconds: number | null;
  /** For quota_exceeded: when the travel budget renews. */
  resetsAt: string | null;
  constructor(code: TravelClientErrorCode, retryAfterSeconds: number | null = null, resetsAt: string | null = null) {
    super("Travel unavailable.");
    this.name = "TravelClientError"; this.code = code; this.retryAfterSeconds = retryAfterSeconds; this.resetsAt = resetsAt;
  }
}

/** Maps a failed /api/travel/routes response to a client error code. */
export async function travelClientErrorFromResponse(response: Response): Promise<TravelClientError> {
  let body: { error?: unknown; retryAfterSeconds?: unknown; resetsAt?: unknown } = {};
  try { body = await response.json() as typeof body; } catch { /* Error bodies are optional. */ }
  const retryAfterSeconds = typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : null;
  const resetsAt = typeof body.resetsAt === "string" && Number.isFinite(Date.parse(body.resetsAt)) ? body.resetsAt : null;
  if (response.status === 429 || body.error === "quota_exceeded") return new TravelClientError("quota_exceeded", retryAfterSeconds, resetsAt);
  if (response.status === 409 || body.error === "context_changed") return new TravelClientError("context_changed", retryAfterSeconds);
  if (response.status === 503) return new TravelClientError(body.error === "provider_clearance_required" || body.error === "not_configured" ? "provider_clearance_required" : "provider_unavailable", retryAfterSeconds);
  if (response.status === 401) return new TravelClientError("unauthenticated");
  return new TravelClientError("unknown");
}

/** Performs a travel routes fetch and converts every failure to a TravelClientError. */
export async function travelRouteFetch(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) { if (init.signal?.aborted) throw error; throw new TravelClientError("unknown"); }
  if (!response.ok) throw await travelClientErrorFromResponse(response);
  try { return await response.json(); } catch { throw new TravelClientError("unknown"); }
}

async function routeRequest(init: RequestInit): Promise<unknown> {
  return travelRouteFetch("/api/travel/routes", { ...init, cache: "no-store", redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(50_000)]) : AbortSignal.timeout(50_000),
    headers: { "Content-Type": "application/json" } });
}

/** Used only when a refusal arrives without its reset time; the status line otherwise names the date. */
const QUOTA_MESSAGE = "Travel estimates are paused until the travel limit renews.";
export const TRAVEL_UNAVAILABLE_MESSAGE = "Travel estimates are unavailable right now. Tracking and Calendar still work.";
const UNAVAILABLE_MESSAGE = TRAVEL_UNAVAILABLE_MESSAGE;
/** Development builds only (Ticket 261). Production shows the unavailable message instead. */
export const TRAVEL_CLEARANCE_MESSAGE = "Travel estimates await this deployment’s provider review.";
const CLEARANCE_MESSAGE = TRAVEL_CLEARANCE_MESSAGE;
function travelErrorMessage(error: unknown): string | null {
  const code = error instanceof TravelClientError ? error.code : "unknown";
  if (code === "quota_exceeded") return resumesAtOf(error) ? null : QUOTA_MESSAGE;
  if (code === "provider_clearance_required") return CLEARANCE_MESSAGE;
  return UNAVAILABLE_MESSAGE;
}
function resumesAtOf(error: unknown): string | null {
  return error instanceof TravelClientError && error.code === "quota_exceeded" ? error.resetsAt : null;
}
export const webTravelClient: TravelClient = {
  settings: webTravelSettingsClient,
  configured: async (signal) => (await routeRequest({ signal }) as { configured: boolean }).configured === true,
  routes: async (input, signal) => await routeRequest({ method: "POST", body: JSON.stringify(input), signal }) as TravelRoutesView,
  readLocation: readBrowserForegroundLocation,
};

/**
 * Ticket 212 setup: asks whether this deployment has travel routing configured.
 * The report makes no provider call. A failed, slow or aborted check returns null.
 */
export async function readTravelRoutingReport(
  readConfigured: TravelClient["configured"],
  signal: AbortSignal,
  timeoutMs = 5_000,
): Promise<boolean | null> {
  try { return await readConfigured(AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])); }
  catch { return null; }
}

export type TravelBehaviorRevision = Readonly<{ id: string; whereKind?: string | null; locationText: string | null; updatedAt: string }>;
/**
 * Travel inputs only: visible events, occurrence schedule and owning Behavior Where revisions.
 * Status, Note and duration-history changes are excluded (Ticket 214): they make no provider call.
 * Core filters resolved stops and withdraws evidence when a reopened stop or duration needs new routes.
 */
export function travelSourceKey(events: readonly NormalizedExternalEvent[], timeline: Pick<TimelineView, "daySections" | "durationEstimates">, behaviors: readonly TravelBehaviorRevision[] = []): string {
  const byId = new Map(behaviors.map((behavior) => [behavior.id, [behavior.whereKind ?? null, behavior.locationText]]));
  const eventInputs = events.map((event) => [event.id, event.location, event.state, event.currentUserResponse, !!event.conference,
    event.kind === "timed" ? [event.startAt, event.endAt, event.endUnspecified] : null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([eventInputs, timeline.daySections.map((section) => section.occurrences.map((occurrence) => [occurrence.id, occurrence.scheduledFor, byId.get(occurrence.behaviorId) ?? null]))]);
}


/**
 * Ticket 268: each stop's travel inputs, by commitment ref (event ID or Occurrence ID): its
 * times, place, video link and response. The same inputs as `travelSourceKey`, per stop, so a
 * kept view can withdraw only the trips whose stop changed or is gone. Kept in memory; the
 * browser session holds only digests.
 */
export function travelStopRevisions(events: readonly NormalizedExternalEvent[], timeline: Pick<TimelineView, "daySections">, behaviors: readonly TravelBehaviorRevision[] = []): Record<string, string> {
  const byId = new Map(behaviors.map((behavior) => [behavior.id, [behavior.whereKind ?? null, behavior.locationText]]));
  return Object.fromEntries([
    ...events.map((event) => [event.id, JSON.stringify([event.location, event.state, event.currentUserResponse, !!event.conference,
      event.kind === "timed" ? [event.startAt, event.endAt, event.endUnspecified] : null])] as const),
    ...timeline.daySections.flatMap((section) => section.occurrences.map((occurrence) =>
      [occurrence.id, JSON.stringify([occurrence.scheduledFor, byId.get(occurrence.behaviorId) ?? null])] as const)),
  ]);
}

/**
 * Ticket 282: identifies tomorrow's first located stop and its travel inputs, so tomorrow's first
 * trip is estimated once per stop and revision. Null when tomorrow has none. Kept in memory; the
 * browser session holds only its digest.
 */
export function travelTomorrowStopKey(events: readonly NormalizedExternalEvent[],
  timeline: Pick<TimelineView, "daySections" | "todayLocalDate" | "timezone">, behaviors: readonly TravelBehaviorRevision[] = []): string | null {
  const tomorrow = Temporal.PlainDate.from(timeline.todayLocalDate).add({ days: 1 });
  const section = timeline.daySections.find((day) => day.localDate === tomorrow.toString());
  // Every stop on tomorrow's date starts after this instant, so no clock is needed.
  const start = tomorrow.toZonedDateTime({ timeZone: timeline.timezone }).toInstant().subtract({ nanoseconds: 1 }).toString();
  const stop = firstLocatedStopAhead({ events, occurrences: section?.occurrences ?? [], now: start, localDate: tomorrow.toString(), timezone: timeline.timezone });
  if (!stop) return null;
  const revisions = travelStopRevisions(events, { daySections: section ? [section] : [] }, behaviors);
  return JSON.stringify([tomorrow.toString(), stop.ref, revisions[stop.ref] ?? null]);
}

/** Ticket 282: tomorrow's first trip, from its own request. Never merged into today's view. */
export type TravelTomorrow = Readonly<{ localDate: string; view: TravelRoutesView }>;
/** `retryAt`: after a first failure worth retrying, when the one retry is due. */
type TravelTomorrowEntry = Readonly<{ localDate: string; stopDigest: string; view: TravelRoutesView | null; retryAt?: string | null }>;
/** Ticket 282: failures worth one more try; quota, clearance and sign-in failures are not. */
const TOMORROW_RETRY_CODES: ReadonlySet<TravelClientErrorCode> = new Set(["provider_unavailable", "context_changed", "unknown"]);

type TravelCacheEntry = Readonly<{
  view: TravelRoutesView | null; message: string | null; at: number;
  /** Ticket 268: digests of each stop's revision when the view was made, to withdraw changed trips. */
  stops?: Readonly<Record<string, string>> | null;
  /** A budget refusal is reused until the budget renews. */
  resumesAt?: string | null;
}>;
const TRAVEL_CACHE_CAP = 32;
const FAILURE_REUSE_MS = 5 * 60 * 1000;
/** Page-session memory: survives Timeline remounts. Ticket 268 mirrors the current day's view in sessionStorage. */
const travelViewCache = new Map<string, TravelCacheEntry>();
/** Page-session memory only: routes calls in flight by state key, so an immediate remount joins them instead of spending another quota slot. */
const travelInFlight = new Map<string, Promise<TravelRoutesView>>();
const travelBudgetResets = new Map<string, string>();
/** Ticket 268: per account, what the refresh plan remembers about its last requests. */
const travelRefreshStates = new Map<string, TravelRefreshState>();
/** Ticket 268: per account, the budget from the latest route response. */
const travelBudgets = new Map<string, TravelBudgetState>();
/** Ticket 282: per account, the last request for tomorrow's first trip and its view, recorded when sent. */
const travelTomorrowTrips = new Map<string, TravelTomorrowEntry>();
/** Ticket 268: per account, when an automatic request last failed. Automatic requests wait 5 minutes after one. */
const travelFailures = new Map<string, number>();
/** Ticket 268: automatic requests wait this long at most for the Calendar reads that feed travel to settle. */
export const TRAVEL_SOURCE_WAIT_MS = 10_000;
/** Per account and date: when travel first waited for its sources, so a remount does not restart the wait. */
const travelSourceWaits = new Map<string, number>();
/** Accounts restored from the browser session, whose device sample was not kept. The next sample becomes the baseline. */
const travelDeviceUnknown = new Set<string>();
// A generated brief asks for the day once, including when the Timeline mounts later.
const briefTravelRequests = new Map<string, { generation: string; pending: boolean }>();
/** Ticket 272: the day's first brief asked for the day before it was requested. */
const BRIEF_FIRST_GENERATION = "first-brief";
/** Ticket 272: the day's first Daily Brief waits at most this long for the first whole-day travel result. */
export const DAILY_BRIEF_TRAVEL_WAIT_MS = 5_000;
/** Ticket 272: travel hooks mounted per account and date. With none, no travel result is coming. */
const travelHooksActive = new Map<string, number>();
/** Ticket 272: accounts whose last request found travel off or not configured. Their brief does not wait. */
const travelOffAccounts = new Set<string>();
/** Ticket 272: first briefs waiting per account and date for a whole-day travel result. */
const briefTravelWaiters = new Map<string, Set<() => void>>();
function settleBriefTravelWait(key: string): void {
  const waiters = briefTravelWaiters.get(key);
  if (!waiters) return;
  briefTravelWaiters.delete(key);
  for (const finish of waiters) finish();
}
/**
 * Ticket 272: the signed conclusions for the day's first Daily Brief. Returns at once with a
 * token already held, with travel off or not configured, or with no Timeline travel mounted.
 * Otherwise it asks the Timeline for the whole day and waits for that result, at most
 * `timeoutMs`. It resolves with the token, or null, and never rejects.
 */
export function waitForDailyBriefTravel(accountId: string | null, localDate: string, signal?: AbortSignal,
  timeoutMs = DAILY_BRIEF_TRAVEL_WAIT_MS): Promise<string | null> {
  if (!accountId) return Promise.resolve(null);
  const held = travelConclusionsToken(accountId, localDate);
  const key = JSON.stringify([accountId, localDate]);
  if (held || signal?.aborted || travelOffAccounts.has(accountId) || !travelHooksActive.get(key)) return Promise.resolve(held);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      briefTravelWaiters.get(key)?.delete(finish);
      resolve(travelConclusionsToken(accountId, localDate));
    };
    const timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener("abort", finish, { once: true });
    briefTravelWaiters.set(key, (briefTravelWaiters.get(key) ?? new Set()).add(finish));
    if (!briefTravelRequests.get(key)?.pending) {
      briefTravelRequests.set(key, { generation: BRIEF_FIRST_GENERATION, pending: true });
      while (briefTravelRequests.size > TRAVEL_CACHE_CAP) briefTravelRequests.delete(briefTravelRequests.keys().next().value!);
    }
    window.dispatchEvent(new Event("cadence:brief-travel"));
  });
}
export function requestDailyBriefTravel(accountId: string, localDate: string, generatedAt: string): void {
  const key = JSON.stringify([accountId, localDate]);
  const existing = briefTravelRequests.get(key);
  if (existing?.generation === generatedAt) return;
  // Ticket 272: the first brief already asked for the day; that request serves this brief too.
  if (existing?.generation === BRIEF_FIRST_GENERATION) { existing.generation = generatedAt; return; }
  briefTravelRequests.set(key, { generation: generatedAt, pending: true });
  while (briefTravelRequests.size > TRAVEL_CACHE_CAP) briefTravelRequests.delete(briefTravelRequests.keys().next().value!);
  window.dispatchEvent(new Event("cadence:brief-travel"));
}
/** Advances on every travel settings or Behavior location change, so requests started earlier neither cache nor share their results. */
let travelEpoch = 0;
function cacheTravel(key: string, entry: TravelCacheEntry): void {
  travelViewCache.delete(key);
  travelViewCache.set(key, entry);
  while (travelViewCache.size > TRAVEL_CACHE_CAP) travelViewCache.delete(travelViewCache.keys().next().value!);
}
function forgetTravelAccount(accountId: string): void {
  for (const key of [...travelViewCache.keys()]) if ((JSON.parse(key) as unknown[])[0] === accountId) travelViewCache.delete(key);
  for (const key of [...travelInFlight.keys()]) if ((JSON.parse((JSON.parse(key) as string[])[0]!) as unknown[])[0] === accountId) travelInFlight.delete(key);
  for (const key of [...travelConclusionTokens.keys()]) if ((JSON.parse(key) as unknown[])[0] === accountId) travelConclusionTokens.delete(key);
  travelRefreshStates.delete(accountId); travelBudgets.delete(accountId); travelFailures.delete(accountId); travelDeviceUnknown.delete(accountId);
  travelTomorrowTrips.delete(accountId);
  if (readTravelSession()?.accountId === accountId) removeTravelSession();
}
function clearTravelCacheForAccount(accountId: string): void {
  travelEpoch++;
  forgetTravelAccount(accountId);
}
/** Settings and Behavior location saves fire this event from screens where no Timeline is mounted, so invalidate at module level too. */
function invalidateAllTravel(): void {
  travelEpoch++; travelViewCache.clear(); travelInFlight.clear(); travelConclusionTokens.clear(); travelOffAccounts.clear();
  travelRefreshStates.clear(); travelBudgets.clear(); travelFailures.clear(); travelDeviceUnknown.clear(); travelSourceWaits.clear(); travelTomorrowTrips.clear(); removeTravelSession();
}
if (typeof window !== "undefined") window.addEventListener("cadence:travel-changed", invalidateAllTravel);
/**
 * Ticket 268: forgets every travel view, estimate and refresh record in page memory and the
 * browser session. Sign-out calls it on web and Mac. Ticket 274: it also removes today's
 * leave-time candidates.
 */
export function clearTravelSession(): void { invalidateAllTravel(); clearTravelLeaveMemory(); }
/** Test-only reset of the in-memory travel view cache. `keepSession` simulates a page reload. */
export function resetTravelViewCacheForTest(options: Readonly<{ keepSession?: boolean }> = {}): void {
  if (options.keepSession) {
    travelViewCache.clear(); travelInFlight.clear(); travelBudgetResets.clear(); briefTravelRequests.clear(); travelConclusionTokens.clear();
    travelRefreshStates.clear(); travelBudgets.clear(); travelFailures.clear(); travelDeviceUnknown.clear(); travelSourceWaits.clear(); travelOffAccounts.clear();
    travelTomorrowTrips.clear();
    return;
  }
  travelViewCache.clear(); travelInFlight.clear(); travelBudgetResets.clear(); briefTravelRequests.clear(); travelConclusionTokens.clear();
  travelRefreshStates.clear(); travelBudgets.clear(); travelFailures.clear(); travelDeviceUnknown.clear(); travelSourceWaits.clear(); travelOffAccounts.clear(); removeTravelSession();
  travelTomorrowTrips.clear();
}

/**
 * Ticket 268: the browser-session copy of today's travel display, so a reload keeps last
 * estimates. One account and one local date. It holds the route view the page already shows,
 * minus the Daily Brief token, plus the refresh record minus its device sample. Source keys are
 * kept only as a digest, so no event title, place text or device position is stored. The Mac
 * webview keeps sessionStorage in memory for the app session; it never reaches SQLite.
 */
const TRAVEL_SESSION_KEY = "cadence:travel-session";
/**
 * Raise this when the stored view's shape or meaning changes. Version 2: decision D12 removed the
 * `attendance_unknown` trip reason, so a record from before it is discarded, not restored.
 */
const TRAVEL_SESSION_VERSION = 2;
type TravelSessionRecord = Readonly<{
  version: typeof TRAVEL_SESSION_VERSION; accountId: string; localDate: string; stateDigest: string;
  view: TravelRoutesView | null; at: number; stops?: Readonly<Record<string, string>> | null;
  refresh: Omit<TravelRefreshState, "device"> | null; budget: TravelBudgetState | null;
  /** Ticket 282: tomorrow's first trip, by stop digest. Absent from older records. */
  tomorrow?: TravelTomorrowEntry | null;
}>;
function travelSessionStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}
function readTravelSession(): TravelSessionRecord | null {
  const storage = travelSessionStorage();
  try {
    const value = JSON.parse(storage?.getItem(TRAVEL_SESSION_KEY) ?? "null") as Partial<TravelSessionRecord> | null;
    if (!value) return null;
    // An older version or a damaged record is removed, so nothing else reads it either.
    if (value.version !== TRAVEL_SESSION_VERSION || typeof value.accountId !== "string" || typeof value.localDate !== "string" ||
      typeof value.stateDigest !== "string" || typeof value.at !== "number") { removeTravelSession(); return null; }
    return value as TravelSessionRecord;
  } catch { removeTravelSession(); return null; }
}
function writeTravelSession(record: TravelSessionRecord): void {
  try { travelSessionStorage()?.setItem(TRAVEL_SESSION_KEY, JSON.stringify(record)); } catch { /* A full or blocked store keeps memory only. */ }
}
function removeTravelSession(): void {
  try { travelSessionStorage()?.removeItem(TRAVEL_SESSION_KEY); } catch { /* Nothing to remove. */ }
}
/** A short digest, so source keys with event and place text never reach storage. Not a security boundary. */
function travelDigest(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * Ticket 219 Option A: the latest signed conclusions per account and local date, in page
 * memory only. The token is opaque here; only the server reads and verifies it.
 */
const travelConclusionTokens = new Map<string, Readonly<{ token: string; expiresAt: string }>>();
function rememberTravelConclusions(accountId: string, localDate: string, view: TravelRoutesView): void {
  const key = JSON.stringify([accountId, localDate]);
  if (view.conclusionsToken && view.expiresAt) travelConclusionTokens.set(key, { token: view.conclusionsToken, expiresAt: view.expiresAt });
  else travelConclusionTokens.delete(key);
}
/** The unexpired token for a Daily Brief request, or null. */
export function travelConclusionsToken(accountId: string | null, localDate: string, nowMs = Date.now()): string | null {
  if (!accountId) return null;
  const entry = travelConclusionTokens.get(JSON.stringify([accountId, localDate]));
  return entry && Date.parse(entry.expiresAt) > nowMs ? entry.token : null;
}

export type TravelState = Readonly<{
  view: TravelRoutesView | null; message: string | null;
  stale: boolean; pending: boolean; observedAt: string | null;
  /** Set while the travel budget is used up: when estimates resume. The last plan stays visible. */
  resumesAt: string | null;
  refresh: () => void;
  /** Ticket 282: tomorrow's first trip once estimated. Absent or null otherwise. */
  tomorrow?: TravelTomorrow | null;
}>;
type StoredTravel = Readonly<{ key: string; view: TravelRoutesView | null; message: string | null; stale: boolean; pending: boolean; observedAt: string | null; resumesAt: string | null;
  tomorrow?: TravelTomorrow | null }>;

function earliestObservedAt(view: TravelRoutesView, fallback: string): string {
  const times = (view.evidence?.legs ?? []).flatMap((item) => item.estimate?.observedAt ? [item.estimate.observedAt] : []);
  return times.length ? times.reduce((left, right) => Date.parse(left) <= Date.parse(right) ? left : right) : fallback;
}

/**
 * Ticket 268: a route response merged into the last view per trip, so a trip refresh never
 * erases another trip's time. A trip response carries no Daily Brief token. The view expires
 * with its earliest estimate, so a kept last estimate marks the whole line stale.
 */
function mergedTravelView(previous: TravelRoutesView | null | undefined, next: TravelRoutesView, now: string): TravelRoutesView {
  if (!next.evidence) return next;
  const evidence = mergeTravelLastEstimates(previous?.evidence ?? null, next.evidence, now);
  if (evidence === next.evidence) return next;
  const expiresAt = evidence.legs.reduce<string | null>((earliest, entry) => !entry.estimate ? earliest
    : !earliest || Date.parse(entry.estimate.expiresAt) < Date.parse(earliest) ? entry.estimate.expiresAt : earliest, null) ?? next.expiresAt;
  return { ...next, evidence, expiresAt };
}

/**
 * Ticket 268: a view planned from older sources, shown until a new response arrives or while
 * automatic requests are paused. Every estimate counts as expired, so each trip reads
 * "Last estimate" with its checked time, and Refresh travel stays offered.
 */
function asLastEstimates(view: TravelRoutesView, now: string): TravelRoutesView {
  if (!view.evidence) return view;
  const cap = (value: string) => Date.parse(value) < Date.parse(now) ? value : now;
  return { ...view, expiresAt: now, evidence: { ...view.evidence, legs: view.evidence.legs.map((entry) => entry.estimate
    ? { ...entry, estimate: { ...entry.estimate, expiresAt: cap(entry.estimate.expiresAt) } } : entry) } };
}

function sampleOf(device: Readonly<{ latitude: number; longitude: number; accuracyMeters: number }> | null): TravelDeviceSample | null {
  return device ? { latitude: device.latitude, longitude: device.longitude, accuracyMeters: device.accuracyMeters } : null;
}

/**
 * Ticket 268 (decision D1): follows the core refresh plan. On each open, focus, return to the
 * window or plan timer, the hook builds trips from the kept view and asks
 * `resolveTravelRefreshPlan` whether a whole-day or trip request is due. Returning to the window
 * requests only when a trigger is due. Each response is merged per trip, so a known leave time
 * stays, marked "Last estimate" once it expires. Today's view is kept in the browser session
 * and cleared on sign-out, account change, travel turned off, settings change and day change.
 * Leaving the foreground cancels a request only before its routes call. Once that call has
 * started the server may have admitted quota, so the request finishes even if the window blurs,
 * hides or unmounts, and its result is kept for the page session.
 */
export function useTravelContext(input: Readonly<{
  enabled: boolean; accountId: string | null; localDate: string; sourceKey: string;
  client?: TravelClient | null; corrections?: readonly TravelCorrection[];
  /** The account's timezone, for the plan's local date. Defaults to America/New_York. */
  timezone?: string;
  /**
   * Ticket 268: false while a connected Calendar read that feeds travel has not settled.
   * Automatic requests wait for it, at most 10 seconds; Refresh travel does not. Defaults to true.
   */
  sourceReady?: boolean;
  /** Ticket 268: `travelStopRevisions` for the same sources as `sourceKey`. Without it a kept view withdraws nothing. */
  stopRevisions?: Readonly<Record<string, string>>;
  /** Ticket 282: `travelTomorrowStopKey` for the same sources. Without it tomorrow's first trip is never requested. */
  tomorrowStopKey?: string | null;
}>): TravelState {
  const client = input.client === undefined ? webTravelClient : input.client;
  const correctionsKey = JSON.stringify(input.corrections ?? []);
  const timezone = input.timezone ?? "America/New_York";
  const sourceReady = input.sourceReady ?? true;
  const stateKey = JSON.stringify([input.accountId, input.localDate, input.sourceKey, correctionsKey]);
  const tomorrowStopKey = input.tomorrowStopKey ?? null;
  const empty: Omit<StoredTravel, "key"> = { view: null, message: null, stale: false, pending: false, observedAt: null, resumesAt: null };
  const [stored, setStored] = useState<StoredTravel>({ key: "", ...empty });
  const storedRef = useRef(stored);
  const manual = useRef<() => void>(() => undefined);
  const [refresh] = useState(() => () => manual.current());
  const state = stored.key === stateKey ? stored : { key: stateKey, ...empty };
  useEffect(() => {
    if (!input.enabled || !input.accountId || !client) return;
    const accountId = input.accountId;
    const localDate = input.localDate;
    const briefKey = JSON.stringify([accountId, localDate]);
    travelHooksActive.set(briefKey, (travelHooksActive.get(briefKey) ?? 0) + 1);
    /** Ticket 272: a waiting first brief stops waiting when this hook will not ask for the day it wanted. */
    const releaseBrief = () => { if (briefTravelRequests.get(briefKey)?.pending) settleBriefTravelWait(briefKey); };
    // The plan's source key covers Calendar, Behaviors and corrections. A settings change clears the plan instead.
    const planKey = travelDigest(JSON.stringify([input.sourceKey, correctionsKey]));
    const stateDigest = travelDigest(stateKey);
    const stopDigests = input.stopRevisions
      ? Object.fromEntries(Object.entries(input.stopRevisions).map(([ref, revision]) => [ref, travelDigest(revision)])) : null;
    const tomorrowDigest = tomorrowStopKey ? travelDigest(tomorrowStopKey) : null;
    const tomorrowLocalDate = Temporal.PlainDate.from(localDate).add({ days: 1 }).toString();
    const setState = (value: Omit<StoredTravel, "key">) => { const next = { ...value, key: stateKey }; storedRef.current = next; setStored(next); };
    const current = () => storedRef.current.key === stateKey ? storedRef.current : { key: stateKey, ...empty };
    const patch = (value: Partial<Omit<StoredTravel, "key">>) => setState({ ...current(), ...value });
    let generation = 0;
    let active = true;
    let inFlight = false;
    let committed = false; // A routes call has started; the server may already have admitted quota.
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let planTimer: ReturnType<typeof setTimeout> | undefined;
    let sourceTimer: ReturnType<typeof setTimeout> | undefined;
    let tomorrowTimer: ReturnType<typeof setTimeout> | undefined;
    // Until the Calendar settles, the source key is partial: a request now would be spent again
    // when the events arrive. Wait at most TRAVEL_SOURCE_WAIT_MS from the first wait for this day.
    const waitKey = JSON.stringify([accountId, localDate]);
    if (sourceReady) travelSourceWaits.delete(waitKey);
    else if (!travelSourceWaits.has(waitKey)) travelSourceWaits.set(waitKey, Date.now());
    const sourcesSettled = () => sourceReady || Date.now() - (travelSourceWaits.get(waitKey) ?? 0) >= TRAVEL_SOURCE_WAIT_MS;
    let permission: PermissionStatus | null = null;
    const foreground = () => !document.hidden && document.hasFocus() && navigator.onLine;
    const stop = () => { generation++; committed = false; controller?.abort(); clearTimeout(timer); if (inFlight) { inFlight = false; patch({ pending: false }); } };

    // Day change and account change: the browser-session copy belongs to one account and one date.
    const restore = () => {
      const record = readTravelSession();
      if (!record) return;
      if (record.accountId !== accountId) { forgetTravelAccount(record.accountId); return; }
      if (record.localDate !== localDate) { removeTravelSession(); travelRefreshStates.delete(accountId); travelBudgets.delete(accountId); return; }
      if (record.refresh && !travelRefreshStates.has(accountId)) {
        travelRefreshStates.set(accountId, { ...record.refresh, device: null });
        travelDeviceUnknown.add(accountId);
      }
      if (record.budget && !travelBudgets.has(accountId)) travelBudgets.set(accountId, record.budget);
      if (record.tomorrow && !travelTomorrowTrips.has(accountId)) travelTomorrowTrips.set(accountId, record.tomorrow);
      if (record.view && record.stateDigest === stateDigest && !travelViewCache.has(stateKey)) cacheTravel(stateKey, { view: record.view, message: null, at: record.at, stops: record.stops ?? null });
      // Ticket 268: after a source change the record belongs to the old sources. Keep it for
      // keptDayView, which withdraws the changed trips and marks the rest "Last estimate".
      else if (record.view && record.stateDigest !== stateDigest) {
        const keptKey = JSON.stringify([accountId, localDate, "session", record.stateDigest]);
        if (!travelViewCache.has(keptKey)) cacheTravel(keptKey, { view: record.view, message: null, at: record.at, stops: record.stops ?? null });
      }
    };
    const persist = () => {
      const cached = travelViewCache.get(stateKey);
      const refreshState = travelRefreshStates.get(accountId) ?? null;
      // The Daily Brief token stays in page memory; JSON omits the undefined field.
      const view = cached?.view ? { ...cached.view, conclusionsToken: undefined } : null;
      writeTravelSession({ version: TRAVEL_SESSION_VERSION, accountId, localDate, stateDigest, view, at: cached?.at ?? Date.now(), stops: cached?.stops ?? null,
        refresh: refreshState ? { localDate: refreshState.localDate, sourceKey: refreshState.sourceKey, tripAttempts: refreshState.tripAttempts,
          ...(refreshState.deviceRoutedAt ? { deviceRoutedAt: refreshState.deviceRoutedAt } : {}) } : null,
        budget: travelBudgets.get(accountId) ?? null, tomorrow: travelTomorrowTrips.get(accountId) ?? null });
    };
    restore();
    /** Ticket 282: tomorrow's first trip, when its request was for the current first stop. */
    const showTomorrow = () => {
      const entry = travelTomorrowTrips.get(accountId);
      if (entry?.view && entry.localDate === tomorrowLocalDate && entry.stopDigest === tomorrowDigest) patch({ tomorrow: { localDate: entry.localDate, view: entry.view } });
    };
    /**
     * Ticket 282: after 5 PM, or once today has no trips left, asks once for tomorrow's first trip
     * in a request of its own. Its view is kept apart from today's, so today's conclusions, the
     * Daily Brief and leave reminders never see it.
     */
    const planTomorrow = () => {
      clearTimeout(tomorrowTimer);
      const failedAt = travelFailures.get(accountId);
      if (failedAt !== undefined && Date.now() - failedAt < FAILURE_REUSE_MS) return;
      const today = travelViewCache.get(stateKey)?.view ?? null;
      const last = travelTomorrowTrips.get(accountId);
      const plan = resolveTravelTomorrowPlan({ now: new Date().toISOString(), timezone, localDate,
        todayTrips: today ? today.evidence ? travelRefreshTripsFromEvidence(today.evidence) : [] : null,
        stopKey: tomorrowDigest, last: last ? { localDate: last.localDate, stopKey: last.stopDigest, retryAt: last.retryAt ?? null } : null,
        budget: travelBudgets.get(accountId) ?? null });
      if (plan.nextDueAt) tomorrowTimer = setTimeout(() => evaluate(), Math.min(Math.max(0, Date.parse(plan.nextDueAt) - Date.now()), 2_147_483_647));
      if (plan.dueLocalDate && today) requestTomorrow(plan.dueLocalDate, today);
    };
    const requestTomorrow = (dueLocalDate: string, today: TravelRoutesView) => {
      if (!active || inFlight || !foreground() || !tomorrowDigest) return;
      inFlight = true; committed = true; generation++;
      const run = generation;
      const epoch = travelEpoch;
      const stopDigest = tomorrowDigest;
      const previous = travelTomorrowTrips.get(accountId);
      const retried = !!previous?.retryAt && previous.localDate === dueLocalDate && previous.stopDigest === stopDigest;
      // Recorded when sent: one request per first stop and revision, plus one retry after a failure.
      travelTomorrowTrips.set(accountId, { localDate: dueLocalDate, stopDigest, view: null });
      persist();
      controller = new AbortController();
      const signal = controller.signal;
      void (async () => {
        let view: TravelRoutesView | null = null;
        try {
          const response = await client.routes({ scope: "first_trip", startLocalDate: dueLocalDate, endLocalDate: dueLocalDate, device: null, corrections: [] }, signal);
          if (epoch === travelEpoch && response.accountId === accountId && response.settingsRevision === today.settingsRevision
            && (response.habitsRevision ?? null) === (today.habitsRevision ?? null)) {
            view = { ...response, conclusionsToken: undefined };
            travelTomorrowTrips.set(accountId, { localDate: dueLocalDate, stopDigest, view });
            noteBudget(response.budget);
            persist();
          }
        } catch (error) {
          // No line for tomorrow. A first failure worth retrying is tried once more after the failure wait.
          if (!retried && !signal.aborted && epoch === travelEpoch && error instanceof TravelClientError && TOMORROW_RETRY_CODES.has(error.code)) {
            travelTomorrowTrips.set(accountId, { localDate: dueLocalDate, stopDigest, view: null, retryAt: new Date(Date.now() + FAILURE_REUSE_MS).toISOString() });
            persist();
          }
        }
        if (run !== generation) return;
        inFlight = false; committed = false;
        if (active && !view) planTomorrow();
        if (active && view && dueLocalDate === tomorrowLocalDate) patch({ tomorrow: { localDate: dueLocalDate, view } });
      })();
    };

    const showView = (view: TravelRoutesView, at: number, extra: Partial<Omit<StoredTravel, "key">> = {}) => {
      const remaining = view.expiresAt ? Date.parse(view.expiresAt) - Date.now() : 0;
      const stale = !!view.evidence && (!Number.isFinite(remaining) || remaining <= 0);
      patch({ ...extra, view, message: null, resumesAt: null, stale, observedAt: view.evidence ? earliestObservedAt(view, new Date(at).toISOString()) : null });
      clearTimeout(expiry);
      if (view.evidence && !stale) expiry = setTimeout(() => {
        if (active && storedRef.current.view === view) patch({ stale: true });
      }, Math.min(remaining, 2_147_483_647));
    };
    const lastDayView = () => [...travelViewCache.entries()].reverse().find(([key, entry]) => {
      const [owner, day] = JSON.parse(key) as string[];
      return owner === accountId && day === localDate && entry.view;
    })?.[1];
    /**
     * Ticket 268: today's last view from other sources, every time marked "Last estimate", with
     * each trip to or from a stop that changed or is gone withdrawn as changed.
     */
    const keptDayView = (): Readonly<{ view: TravelRoutesView; at: number }> | null => {
      const last = lastDayView();
      if (!last?.view) return null;
      const marked = asLastEstimates(last.view, new Date().toISOString());
      const changed = last.stops && stopDigests ? changedTravelStops(last.stops, stopDigests) : new Set<string>();
      return { view: marked.evidence && changed.size ? { ...marked, evidence: withdrawChangedTravelTrips(marked.evidence, changed) } : marked, at: last.at };
    };
    const budgetReset = () => {
      const reset = travelBudgetResets.get(accountId);
      return reset && Date.parse(reset) > Date.now() ? reset : null;
    };
    const pauseBudget = (resumesAt: string) => {
      clearTimeout(renewal);
      patch({ resumesAt, stale: !!current().view?.evidence });
      const remaining = Date.parse(resumesAt) - Date.now();
      renewal = setTimeout(() => {
        if (budgetReset()) { pauseBudget(resumesAt); return; }
        travelBudgetResets.delete(accountId);
        patch({ resumesAt: null, message: current().view ? null : "Travel estimates can be refreshed." });
      }, Math.min(Math.max(0, remaining), 2_147_483_647));
    };
    // A response reporting the whole ceiling used reuses the approved paused line until it renews.
    const noteBudget = (budget: TravelBudgetState | undefined) => {
      if (!budget) { travelBudgets.delete(accountId); return; }
      travelBudgets.set(accountId, budget);
      if (budget.ceilingMicrodollars > 0 && budget.reservedMicrodollars >= budget.ceilingMicrodollars && Date.parse(budget.resetsAt) > Date.now()) {
        travelBudgetResets.set(accountId, budget.resetsAt);
      }
    };

    /** Asks the refresh plan what is due now, schedules its next check, and sends any request. */
    const evaluate = (options: Readonly<{ refreshTravel?: boolean; device?: TravelDeviceSample | null }> = {}) => {
      if (!active || inFlight) return;
      const reset = budgetReset();
      if (reset) { pauseBudget(reset); releaseBrief(); return; }
      if (!options.refreshTravel && !sourcesSettled()) {
        clearTimeout(sourceTimer);
        sourceTimer = setTimeout(() => evaluate(), Math.max(0, (travelSourceWaits.get(waitKey) ?? Date.now()) + TRAVEL_SOURCE_WAIT_MS - Date.now()));
        return;
      }
      const now = new Date().toISOString();
      const cached = travelViewCache.get(stateKey);
      const last = travelRefreshStates.get(accountId) ?? null;
      const evidence = cached?.view?.evidence ?? null;
      const plan = resolveTravelRefreshPlan({ now, timezone, refreshTravel: options.refreshTravel, timelineFocused: foreground(),
        sourceKey: planKey, device: options.device === undefined ? last?.device ?? null : options.device,
        trips: evidence ? travelRefreshTripsFromEvidence(evidence) : [], budget: travelBudgets.get(accountId) ?? null, last });
      clearTimeout(planTimer);
      if (plan.nextDueAt) {
        const wait = Math.min(Math.max(0, Date.parse(plan.nextDueAt) - Date.now()), 2_147_483_647);
        planTimer = setTimeout(() => evaluate(), wait);
      }
      let planned: TravelRefreshRequest | null = plan.request;
      // A generated brief asks for the whole day once, for its signed conclusions.
      if (briefTravelRequests.get(briefKey)?.pending && !plan.automaticPaused && planned?.kind !== "day") planned = { kind: "day", trigger: "first_open" };
      if (!planned) { releaseBrief(); planTomorrow(); return; }
      if (!options.refreshTravel) {
        // After midnight the Timeline moves to the new date; this day's view does not request.
        const today = Temporal.Instant.from(now).toZonedDateTimeISO(timezone).toPlainDate().toString();
        if (today !== localDate) { releaseBrief(); return; }
        const failedAt = travelFailures.get(accountId);
        if (failedAt !== undefined && Date.now() - failedAt < FAILURE_REUSE_MS) { releaseBrief(); return; }
      }
      request(planned, !!options.refreshTravel);
    };

    const request = (planned: TravelRefreshRequest, manualRequest: boolean) => {
      if (!active || inFlight) return;
      if (!foreground()) { releaseBrief(); return; } // Planned again on return to the window.
      inFlight = true; generation++;
      patch({ pending: true });
      const run = generation;
      const routeOnce = async () => {
        const epoch = travelEpoch;
        const sameEpoch = () => travelEpoch === epoch;
        controller = new AbortController();
        const signal = controller.signal;
        const valid = () => active && run === generation && !signal.aborted && !document.hidden && document.hasFocus();
        // After the routes call only explicit invalidation (settings change, revoked permission, offline) stops the request.
        const live = () => run === generation && !signal.aborted;
        const settle = (value: Partial<Omit<StoredTravel, "key">>) => { inFlight = false; committed = false; if (active) patch({ ...value, pending: false }); };
        try {
          const settings = await client.settings.load();
          if (!valid()) return;
          if (!settings.enabled || !settings.routingConsentAt || !settings.mode) {
            // Travel turned off: nothing of today's travel stays in the session.
            forgetTravelAccount(accountId);
            clearTravelLeaveMemory();
            travelOffAccounts.add(accountId);
            settle({ view: null, message: null, resumesAt: null, stale: false, observedAt: null, tomorrow: null }); return;
          }
          const configured = await client.configured(signal);
          if (!valid()) return;
          if (!configured) { travelOffAccounts.add(accountId); if (!manualRequest) travelFailures.set(accountId, Date.now()); if (sameEpoch()) cacheTravel(stateKey, { view: null, message: CLEARANCE_MESSAGE, at: Date.now() }); settle({ view: null, message: CLEARANCE_MESSAGE, resumesAt: null, stale: false, observedAt: null }); return; }
          // Device position is read only inside a request.
          const position = await client.readLocation(false);
          if (!valid()) return;
          const device = position.state === "available" ? { latitude: position.latitude, longitude: position.longitude,
            accuracyMeters: position.accuracyMeters, sampledAt: new Date(position.sampledAt).toISOString() } : null;
          const fields = travelRefreshRequestFields(planned);
          const flightKey = JSON.stringify([stateKey, fields]);
          const routesInput: TravelRoutesInput = { ...fields, startLocalDate: localDate, endLocalDate: localDate,
            device, corrections: JSON.parse(correctionsKey) as TravelCorrection[] };
          committed = true;
          const sentAt = new Date().toISOString();
          const briefRequest = briefTravelRequests.get(briefKey);
          if (planned.kind === "day" && briefRequest) briefRequest.pending = false;
          // A trip request is recorded when sent, so a failing trip waits for its next threshold.
          if (planned.kind === "trip" && sameEpoch()) {
            // Movement moves the baseline to the sample this request uses.
            travelRefreshStates.set(accountId, recordTravelRefresh(travelRefreshStates.get(accountId) ?? null, planned,
              { now: sentAt, timezone, sourceKey: planKey, device: planned.trigger === "device_moved" ? sampleOf(device) : travelRefreshStates.get(accountId)?.device ?? null }));
          }
          // Join a routes call already in flight for this key (an immediate remount); otherwise start one and register it.
          const callRoutes = (): Promise<TravelRoutesView> => {
            const shared = travelInFlight.get(flightKey);
            if (shared) return shared;
            const own = client.routes(routesInput, signal);
            travelInFlight.set(flightKey, own);
            void own.finally(() => { if (travelInFlight.get(flightKey) === own) travelInFlight.delete(flightKey); }).catch(() => undefined);
            return own;
          };
          let response: TravelRoutesView;
          try { response = await callRoutes(); }
          catch (error) {
            if (!(error instanceof TravelClientError && error.code === "context_changed") || !live()) throw error;
            await new Promise((resolve) => setTimeout(resolve, 350));
            if (!live()) return;
            try { response = await callRoutes(); }
            catch (retryError) {
              throw retryError instanceof TravelClientError && retryError.code === "context_changed" ? new TravelClientError("provider_unavailable") : retryError;
            }
          }
          if (!live()) return;
          if (response.accountId !== accountId || response.settingsRevision !== settings.updatedAt
            || (response.habitsRevision ?? null) !== (settings.habits?.updatedAt ?? null)) {
            // A revision mismatch is a failed request: automatic requests wait 5 minutes, not every focus.
            if (!manualRequest) travelFailures.set(accountId, Date.now());
            settle({}); return;
          }
          const receivedAt = new Date().toISOString();
          const previous = travelViewCache.get(stateKey)?.view ?? lastDayView()?.view ?? null;
          const view = mergedTravelView(previous, planned.kind === "trip" ? { ...response, conclusionsToken: undefined } : response, receivedAt);
          if (sameEpoch()) {
            cacheTravel(stateKey, { view, message: null, at: Date.now(), stops: stopDigests });
            // Trip requests carry no conclusions; only a whole-day response replaces the token.
            if (planned.kind === "day") {
              rememberTravelConclusions(accountId, localDate, view);
              travelOffAccounts.delete(accountId);
              // Ticket 272: this response serves a first brief that asked while it was in flight.
              const firstBrief = briefTravelRequests.get(briefKey);
              if (firstBrief?.generation === BRIEF_FIRST_GENERATION) firstBrief.pending = false;
              travelRefreshStates.set(accountId, recordTravelRefresh(travelRefreshStates.get(accountId) ?? null, planned,
                { now: sentAt, timezone, sourceKey: planKey, device: sampleOf(device) }));
              travelDeviceUnknown.delete(accountId);
            }
            travelFailures.delete(accountId);
            noteBudget(response.budget);
            persist();
          }
          inFlight = false; committed = false;
          if (active) {
            showView(view, Date.now(), { pending: false });
            const reset = budgetReset();
            if (reset) pauseBudget(reset);
            else evaluate();
          }
        } catch (error) {
          if (committed ? !live() : !valid()) return;
          if (!manualRequest) travelFailures.set(accountId, Date.now());
          if (error instanceof TravelClientError && error.code === "unauthenticated") forgetTravelAccount(accountId);
          const resumesAt = resumesAtOf(error);
          if (resumesAt || (error instanceof TravelClientError && error.code === "quota_exceeded")) {
            // The budget is used up: keep the last plan visible as stale and stop live updates until it renews.
            if (!current().view) {
              const last = keptDayView();
              if (last) showView(last.view, last.at);
            }
            const previous = current();
            if (resumesAt) travelBudgetResets.set(accountId, resumesAt);
            if (sameEpoch()) cacheTravel(stateKey, { view: previous.view, message: travelErrorMessage(error), at: Date.now(), resumesAt });
            settle({ view: previous.view, message: travelErrorMessage(error), resumesAt, stale: !!previous.view?.evidence, observedAt: previous.observedAt });
            if (resumesAt && active) pauseBudget(resumesAt);
            return;
          }
          const message = travelErrorMessage(error);
          const kept = current().view;
          if (kept && !(error instanceof TravelClientError && error.code === "unauthenticated")) {
            // Ticket 268: a failed refresh never takes away a leave time already known.
            settle({ message }); return;
          }
          if (sameEpoch()) cacheTravel(stateKey, { view: null, message, at: Date.now() });
          settle({ view: null, message, resumesAt: null, stale: false, observedAt: null });
        }
      };
      // Ticket 272: whatever happens to a whole-day request, a first brief waiting for it stops waiting.
      timer = setTimeout(() => { void routeOnce().finally(() => { if (planned.kind === "day") settleBriefTravelWait(briefKey); }); }, 350);
    };
    manual.current = () => {
      if (!active || inFlight || budgetReset()) return;
      if (!navigator.onLine) { patch({ message: UNAVAILABLE_MESSAGE }); return; }
      if (document.hidden || !document.hasFocus()) return;
      evaluate({ refreshTravel: true });
    };
    // Returning to the window asks the plan again; it requests only when a trigger is due.
    const resume = () => { if (!inFlight) evaluate(); else setStored((value) => ({ ...value })); };
    // Leaving the foreground cancels a request only before its routes call; an admitted request finishes and is kept.
    const suspend = () => { if (inFlight && !committed) stop(); };
    const offline = () => { if (inFlight) stop(); };
    const channel = typeof window.BroadcastChannel === "function" ? new BroadcastChannel("cadence-travel") : null;
    if (channel) channel.onmessage = () => setStored((value) => ({ ...value }));
    const visibility = () => { if (document.hidden) suspend(); else resume(); };
    const revoked = () => { if (permission?.state !== "granted") { stop(); clearTimeout(expiry); setState({ ...empty }); } };
    if (typeof navigator.permissions?.query === "function") {
      void navigator.permissions.query({ name: "geolocation" }).then((value) => {
        if (!active) return;
        permission = value; permission.addEventListener("change", revoked);
      }).catch(() => undefined);
    }
    // Settings changes on this window always replace the view.
    const changed = () => { clearTravelCacheForAccount(accountId); stop(); clearTimeout(expiry); setState({ ...empty }); evaluate(); };
    const briefReady = () => { if (briefTravelRequests.get(briefKey)?.pending) evaluate(); };
    window.addEventListener("cadence:brief-travel", briefReady);
    window.addEventListener("focus", resume);
    window.addEventListener("blur", suspend);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    window.addEventListener("cadence:travel-changed", changed);
    document.addEventListener("visibilitychange", visibility);
    let checkingPosition = false;
    const checkMovement = async () => {
      const cached = travelViewCache.get(stateKey);
      if (checkingPosition || inFlight || !foreground() || budgetReset() || !cached?.view?.evidence) return;
      checkingPosition = true;
      const epoch = travelEpoch;
      try {
        const position = await client.readLocation(false);
        const sample = position.state === "available" ? sampleOf(position) : null;
        if (!active || !foreground() || epoch !== travelEpoch) return;
        const last = travelRefreshStates.get(accountId);
        if (last && sample && travelDeviceUnknown.has(accountId)) {
          // Restored after a reload without its sample: this one becomes the baseline.
          travelDeviceUnknown.delete(accountId);
          travelRefreshStates.set(accountId, { ...last, device: sample });
          return;
        }
        if (travelDeviceMoved(last?.device ?? null, sample)) evaluate({ device: sample });
      } catch { /* Location is optional. Saved places still work. */ }
      finally { checkingPosition = false; }
    };
    const movement = setInterval(() => { void checkMovement(); }, 60_000);
    showTomorrow();
    const cached = travelViewCache.get(stateKey);
    const resumesAt = budgetReset();
    if (resumesAt) {
      // The budget is still used up: show the last plan as stale without another request.
      const previous = cached?.view ? cached : keptDayView();
      if (previous?.view) showView(previous.view, previous.at);
      pauseBudget(resumesAt);
    } else {
      if (cached?.view && !cached.resumesAt) showView(cached.view, cached.at);
      else {
        // A changed source: keep today's last view, marked, until its response arrives. The merge
        // then withdraws the changed trips. While paused or failing it stays, with Refresh travel.
        const last = keptDayView();
        if (last) showView(last.view, last.at);
        if (cached && !cached.view && cached.message && !cached.resumesAt && Date.now() - cached.at < FAILURE_REUSE_MS) patch({ message: cached.message });
      }
      const failedRecently = !!cached && !cached.view && !!cached.message && Date.now() - cached.at < FAILURE_REUSE_MS;
      if (!failedRecently) evaluate();
      if (cached?.view?.evidence) void checkMovement();
    }
    return () => {
      channel?.close();
      active = false;
      const hooks = (travelHooksActive.get(briefKey) ?? 1) - 1;
      if (hooks > 0) travelHooksActive.set(briefKey, hooks); else travelHooksActive.delete(briefKey);
      // A committed request finishes and keeps its result for remount; anything earlier is cancelled.
      if (!committed) { generation++; controller?.abort(); }
      clearTimeout(timer); clearTimeout(expiry); clearTimeout(renewal); clearTimeout(planTimer); clearTimeout(sourceTimer); clearTimeout(tomorrowTimer); clearInterval(movement);
      manual.current = () => undefined;
      permission?.removeEventListener("change", revoked);
      window.removeEventListener("cadence:brief-travel", briefReady);
      window.removeEventListener("focus", resume); window.removeEventListener("blur", suspend); window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline); window.removeEventListener("cadence:travel-changed", changed);
      document.removeEventListener("visibilitychange", visibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stateKey covers localDate, sourceKey and corrections.
  }, [client, input.accountId, input.enabled, stateKey, timezone, sourceReady, tomorrowStopKey]);
  const visible = input.enabled && (!state.view || state.view.accountId === input.accountId);
  return visible
    ? { view: state.view, message: state.message, stale: state.stale, pending: state.pending, observedAt: state.observedAt, resumesAt: state.resumesAt, refresh,
      tomorrow: state.tomorrow ?? null }
    : { view: null, message: null, stale: false, pending: false, observedAt: null, resumesAt: null, refresh };
}
