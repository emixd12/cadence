"use client";

import { useEffect, useRef, useState } from "react";
import type { TravelEvidenceResult, TravelMode, TravelNavigationPreference } from "@cadence/core/types/travel";
import type { NormalizedExternalEvent } from "@cadence/core/types/day-progress";
import type { TimelineView } from "@/lib/types/timeline";
import type { TravelSettingsClient } from "./travel-settings";
import { webTravelSettingsClient } from "./travel-settings";
import { readBrowserForegroundLocation, type ForegroundLocation } from "./foreground-location";
import { travelDeviceMoved, type TravelDeviceSample } from "@cadence/core/services/travel-refresh-policy";

export type TravelCorrection = Readonly<{ eventId: string; revision: string; attendance: "physical" | "remote"; locationText: string | null }>;
export type TravelRoutesInput = Readonly<{
  startLocalDate: string; endLocalDate: string;
  scope?: "timeline" | "day";
  device: Readonly<{ latitude: number; longitude: number; accuracyMeters: number; sampledAt: string }> | null;
  corrections?: readonly TravelCorrection[];
}>;
export type TravelRoutesView = Readonly<{
  accountId: string; mode: TravelMode | null; navigationPreference: TravelNavigationPreference | null;
  settingsRevision: string | null; expiresAt: string | null; evidence: Omit<TravelEvidenceResult, "modelProjection"> | null;
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
const UNAVAILABLE_MESSAGE = "Travel estimates are unavailable right now. Tracking and Calendar still work.";
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

export type TravelBehaviorRevision = Readonly<{ id: string; locationText: string | null; updatedAt: string }>;
/**
 * Travel inputs only: visible events, occurrence schedule and owning Behavior location revisions.
 * Status, Note and duration-history changes are excluded (Ticket 214): they make no provider call.
 * Core recomputes overlaps from current statuses; the next refresh drops resolved stops.
 */
export function travelSourceKey(events: readonly NormalizedExternalEvent[], timeline: Pick<TimelineView, "daySections" | "durationEstimates">, behaviors: readonly TravelBehaviorRevision[] = []): string {
  const byId = new Map(behaviors.map((behavior) => [behavior.id, behavior.locationText]));
  const eventInputs = events.map((event) => [event.id, event.location, event.state, event.currentUserResponse, !!event.conference,
    event.kind === "timed" ? [event.startAt, event.endAt, event.endUnspecified] : null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([eventInputs, timeline.daySections.map((section) => section.occurrences.map((occurrence) => [occurrence.id, occurrence.scheduledFor, byId.get(occurrence.behaviorId) ?? null]))]);
}

type TravelCacheEntry = Readonly<{
  view: TravelRoutesView | null; message: string | null; at: number;
  /** The device sample the view was computed from, kept in page memory to detect movement. */
  device?: TravelDeviceSample | null;
  /** A budget refusal is reused until the budget renews. */
  resumesAt?: string | null;
}>;
const TRAVEL_CACHE_CAP = 32;
const FAILURE_REUSE_MS = 5 * 60 * 1000;
/** Page-session memory only: survives Timeline remounts, never persisted. */
const travelViewCache = new Map<string, TravelCacheEntry>();
/** Page-session memory only: routes calls in flight by state key, so an immediate remount joins them instead of spending another quota slot. */
const travelInFlight = new Map<string, Promise<TravelRoutesView>>();
const travelBudgetResets = new Map<string, string>();
// A generated brief asks for the day once, including when the Timeline mounts later.
const briefTravelRequests = new Map<string, { generation: string; pending: boolean }>();
export function requestDailyBriefTravel(accountId: string, localDate: string, generatedAt: string): void {
  const key = JSON.stringify([accountId, localDate]);
  if (briefTravelRequests.get(key)?.generation === generatedAt) return;
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
function clearTravelCacheForAccount(accountId: string): void {
  travelEpoch++;
  for (const key of [...travelViewCache.keys()]) if ((JSON.parse(key) as unknown[])[0] === accountId) travelViewCache.delete(key);
  for (const key of [...travelInFlight.keys()]) if ((JSON.parse((JSON.parse(key) as string[])[0]!) as unknown[])[0] === accountId) travelInFlight.delete(key);
}
/** Settings and Behavior location saves fire this event from screens where no Timeline is mounted, so invalidate at module level too. */
function invalidateAllTravel(): void { travelEpoch++; travelViewCache.clear(); travelInFlight.clear(); }
if (typeof window !== "undefined") window.addEventListener("cadence:travel-changed", invalidateAllTravel);
/** Test-only reset of the in-memory travel view cache. */
export function resetTravelViewCacheForTest(): void { travelViewCache.clear(); travelInFlight.clear(); travelBudgetResets.clear(); briefTravelRequests.clear(); }

export type TravelState = Readonly<{
  view: TravelRoutesView | null; message: string | null;
  stale: boolean; pending: boolean; observedAt: string | null;
  /** Set while the travel budget is used up: when estimates resume. The last plan stays visible. */
  resumesAt: string | null;
  refresh: () => void;
}>;
type StoredTravel = Readonly<{ key: string; view: TravelRoutesView | null; message: string | null; stale: boolean; pending: boolean; observedAt: string | null; resumesAt: string | null }>;

function earliestObservedAt(view: TravelRoutesView, fallback: string): string {
  const times = (view.evidence?.legs ?? []).flatMap((item) => item.estimate?.observedAt ? [item.estimate.observedAt] : []);
  return times.length ? times.reduce((left, right) => Date.parse(left) <= Date.parse(right) ? left : right) : fallback;
}

/**
 * Requests automatically only on the first Timeline open of a local date, or when the
 * travel inputs or settings change. Focus and visibility never request; refresh() does.
 * Leaving the foreground cancels a request only before its routes call. Once that call
 * has started the server may have admitted quota, so the request finishes even if the
 * window blurs, hides or unmounts, and its result is cached for the page session.
 */
export function useTravelContext(input: Readonly<{
  enabled: boolean; accountId: string | null; localDate: string; sourceKey: string;
  client?: TravelClient | null; corrections?: readonly TravelCorrection[];
}>): TravelState {
  const client = input.client === undefined ? webTravelClient : input.client;
  const correctionsKey = JSON.stringify(input.corrections ?? []);
  const stateKey = JSON.stringify([input.accountId, input.localDate, input.sourceKey, correctionsKey]);
  const empty: Omit<StoredTravel, "key"> = { view: null, message: null, stale: false, pending: false, observedAt: null, resumesAt: null };
  const [stored, setStored] = useState<StoredTravel>({ key: "", ...empty });
  const storedRef = useRef(stored);
  const manual = useRef<() => void>(() => undefined);
  const [refresh] = useState(() => () => manual.current());
  const state = stored.key === stateKey ? stored : { key: stateKey, ...empty };
  useEffect(() => {
    if (!input.enabled || !input.accountId || !client) return;
    const accountId = input.accountId;
    const briefKey = JSON.stringify([accountId, input.localDate]);
    const setState = (value: Omit<StoredTravel, "key">) => { const next = { ...value, key: stateKey }; storedRef.current = next; setStored(next); };
    const current = () => storedRef.current.key === stateKey ? storedRef.current : { key: stateKey, ...empty };
    const patch = (value: Partial<Omit<StoredTravel, "key">>) => setState({ ...current(), ...value });
    let generation = 0;
    let active = true;
    let inFlight = false;
    let deferred = false;
    let committed = false; // A routes call has started; the server may already have admitted quota.
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let renewal: ReturnType<typeof setTimeout> | undefined;
    let permission: PermissionStatus | null = null;
    const foreground = () => !document.hidden && document.hasFocus() && navigator.onLine;
    const stop = () => { generation++; committed = false; controller?.abort(); clearTimeout(timer); if (inFlight) { inFlight = false; patch({ pending: false }); } };
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
      return owner === accountId && day === input.localDate && entry.view;
    })?.[1];
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
    const request = () => {
      if (!active || inFlight) return;
      const reset = budgetReset();
      if (reset) { pauseBudget(reset); return; }
      if (!foreground()) { deferred = true; return; }
      deferred = false; inFlight = true; generation++;
      patch({ pending: true });
      const run = generation;
      timer = setTimeout(async () => {
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
          if (!settings.enabled || !settings.routingConsentAt || !settings.mode) { settle({ view: null, message: null, resumesAt: null, stale: false, observedAt: null }); return; }
          const configured = await client.configured(signal);
          if (!valid()) return;
          if (!configured) { if (sameEpoch()) cacheTravel(stateKey, { view: null, message: CLEARANCE_MESSAGE, at: Date.now() }); settle({ view: null, message: CLEARANCE_MESSAGE, resumesAt: null, stale: false, observedAt: null }); return; }
          // Device position is read only inside a request.
          const position = await client.readLocation(false);
          if (!valid()) return;
          const device = position.state === "available" ? { latitude: position.latitude, longitude: position.longitude,
            accuracyMeters: position.accuracyMeters, sampledAt: new Date(position.sampledAt).toISOString() } : null;
          const briefRequest = briefTravelRequests.get(briefKey);
          const scope = briefRequest?.pending ? "day" : "timeline";
          const flightKey = JSON.stringify([stateKey, scope]);
          const routesInput: TravelRoutesInput = { scope, startLocalDate: input.localDate, endLocalDate: input.localDate,
            device, corrections: JSON.parse(correctionsKey) as TravelCorrection[] };
          committed = true;
          if (briefRequest) briefRequest.pending = false;
          // Join a routes call already in flight for this key (an immediate remount); otherwise start one and register it.
          const callRoutes = (): Promise<TravelRoutesView> => {
            const shared = travelInFlight.get(flightKey);
            if (shared) return shared;
            const own = client.routes(routesInput, signal);
            travelInFlight.set(flightKey, own);
            void own.finally(() => { if (travelInFlight.get(flightKey) === own) travelInFlight.delete(flightKey); }).catch(() => undefined);
            return own;
          };
          let view: TravelRoutesView;
          try { view = await callRoutes(); }
          catch (error) {
            if (!(error instanceof TravelClientError && error.code === "context_changed") || !live()) throw error;
            await new Promise((resolve) => setTimeout(resolve, 350));
            if (!live()) return;
            try { view = await callRoutes(); }
            catch (retryError) {
              throw retryError instanceof TravelClientError && retryError.code === "context_changed" ? new TravelClientError("provider_unavailable") : retryError;
            }
          }
          if (!live()) return;
          if (view.accountId !== accountId || view.settingsRevision !== settings.updatedAt) { settle({}); return; }
          if (sameEpoch()) cacheTravel(stateKey, { view, message: null, at: Date.now(), device: device ? { latitude: device.latitude, longitude: device.longitude, accuracyMeters: device.accuracyMeters } : null });
          inFlight = false; committed = false;
          if (active) {
            showView(view, Date.now(), { pending: false });
            if (briefTravelRequests.get(briefKey)?.pending) request();
          }
        } catch (error) {
          if (committed ? !live() : !valid()) return;
          const resumesAt = resumesAtOf(error);
          if (resumesAt || (error instanceof TravelClientError && error.code === "quota_exceeded")) {
            // The budget is used up: keep the last plan visible as stale and stop live updates until it renews.
            if (!current().view) {
              const last = lastDayView();
              if (last?.view) showView(last.view, last.at);
            }
            const previous = current();
            if (resumesAt) travelBudgetResets.set(accountId, resumesAt);
            if (sameEpoch()) cacheTravel(stateKey, { view: previous.view, message: travelErrorMessage(error), at: Date.now(), resumesAt });
            settle({ view: previous.view, message: travelErrorMessage(error), resumesAt, stale: !!previous.view?.evidence, observedAt: previous.observedAt });
            if (resumesAt && active) pauseBudget(resumesAt);
            return;
          }
          if (sameEpoch()) cacheTravel(stateKey, { view: null, message: travelErrorMessage(error), at: Date.now() });
          settle({ view: null, message: travelErrorMessage(error), resumesAt: null, stale: false, observedAt: null });
        }
      }, 350);
    };
    manual.current = () => {
      if (!active || inFlight || budgetReset()) return;
      if (!navigator.onLine) { patch({ message: UNAVAILABLE_MESSAGE }); return; }
      if (document.hidden || !document.hasFocus()) return;
      request();
    };
    // Returning to the window resumes only an automatic request that could not start.
    const resume = () => { if (deferred) request(); else setStored((value) => ({ ...value })); };
    // Leaving the foreground cancels a request only before its routes call; an admitted request finishes and is cached.
    const suspend = () => { if (inFlight && !committed) { stop(); deferred = true; } };
    const offline = () => { if (inFlight) { stop(); deferred = true; } };
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
    const changed = () => { clearTravelCacheForAccount(accountId); stop(); clearTimeout(expiry); setState({ ...empty }); request(); };
    const briefReady = () => { if (briefTravelRequests.get(briefKey)?.pending) request(); };
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
        const sample = position.state === "available" ? position : null;
        if (active && foreground() && epoch === travelEpoch && travelDeviceMoved(cached.device ?? null, sample)) request();
      } catch { /* Location is optional. Saved places still work. */ }
      finally { checkingPosition = false; }
    };
    const movement = setInterval(() => { void checkMovement(); }, 60_000);
    const cached = travelViewCache.get(stateKey);
    const freshView = !!cached?.view && (!cached.view.evidence || (!!cached.view.expiresAt && Date.parse(cached.view.expiresAt) > Date.now()));
    const resumesAt = budgetReset();
    if (resumesAt) {
      // The budget is still used up: show the last plan as stale without another request.
      const previous = cached?.view ? cached : lastDayView();
      if (previous?.view) showView(previous.view, previous.at);
      pauseBudget(resumesAt);
    }
    else if (briefTravelRequests.get(briefKey)?.pending) request();
    else if (cached?.view && freshView && !cached.resumesAt) {
      showView(cached.view, cached.at);
      void checkMovement();
    }
    else if (cached && !cached.view && cached.message && !cached.resumesAt && Date.now() - cached.at < FAILURE_REUSE_MS) patch({ message: cached.message });
    else request();
    return () => {
      channel?.close();
      active = false;
      // A committed request finishes and caches its result for remount; anything earlier is cancelled.
      if (!committed) { generation++; controller?.abort(); }
      clearTimeout(timer); clearTimeout(expiry); clearTimeout(renewal); clearInterval(movement);
      manual.current = () => undefined;
      permission?.removeEventListener("change", revoked);
      window.removeEventListener("cadence:brief-travel", briefReady);
      window.removeEventListener("focus", resume); window.removeEventListener("blur", suspend); window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline); window.removeEventListener("cadence:travel-changed", changed);
      document.removeEventListener("visibilitychange", visibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stateKey covers localDate, sourceKey and corrections.
  }, [client, input.accountId, input.enabled, stateKey]);
  const visible = input.enabled && (!state.view || state.view.accountId === input.accountId);
  return visible
    ? { view: state.view, message: state.message, stale: state.stale, pending: state.pending, observedAt: state.observedAt, resumesAt: state.resumesAt, refresh }
    : { view: null, message: null, stale: false, pending: false, observedAt: null, resumesAt: null, refresh };
}
