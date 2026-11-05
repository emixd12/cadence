import { Temporal } from "@js-temporal/polyfill";

import type { TravelRouteEstimate, TravelRouteRequest } from "@cadence/core/types/travel";
import {
  TravelProviderError,
  assertTravelProviderReady,
  computeGoogleRoute,
  travelRouteMicrodollars,
  type TravelProviderConfig,
} from "./travel-provider";

export const TRAVEL_ROUTING_LIMITS = {
  legs: 8,
  concurrency: 4,
  batchDeadlineMs: 45_000,
} as const;

export type TravelRoutingFailure = Readonly<{
  code: TravelProviderError["code"] | "quota_exceeded" | "context_changed";
  retryable: boolean;
  retryAfterSeconds: number | null;
  /** Set for quota_exceeded: when the refused budget renews. */
  resetsAt?: string | null;
}>;

export type TravelRoutingResult = Readonly<{
  id: string;
  estimate: TravelRouteEstimate | null;
  failure: TravelRoutingFailure | null;
}>;

export class TravelRoutingError extends Error {
  constructor(public readonly failure: TravelRoutingFailure) {
    super(failure.code);
    this.name = "TravelRoutingError";
  }
}

/** Reserves list-price spend before provider calls; throws TravelRoutingError("quota_exceeded") when refused. */
export type TravelSpendReservation = (microdollars: number) => Promise<void>;

/**
 * This service never stores inputs or provider output. The caller fences source
 * revisions before and after the batch; this service reserves spend before every
 * provider call, including the single batch retry.
 */
export async function routeTravelLegs(
  input: Readonly<{
    routes: readonly Readonly<{ id: string; request: TravelRouteRequest }>[];
    provider: TravelProviderConfig;
    reserve: TravelSpendReservation;
    now: Temporal.Instant;
    fetch?: typeof fetch;
    signal?: AbortSignal;
  }>,
): Promise<TravelRoutingResult[]> {
  assertTravelProviderReady(input.provider);
  if (!input.routes.length || input.routes.length > TRAVEL_ROUTING_LIMITS.legs || new Set(input.routes.map((route) => route.id)).size !== input.routes.length || input.routes.some((route) => !route.id || route.id.length > 128)) {
    throw new TravelRoutingError({ code: "context_changed", retryable: false, retryAfterSeconds: null });
  }
  const deadline = AbortSignal.timeout(TRAVEL_ROUTING_LIMITS.batchDeadlineMs);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  await input.reserve(input.routes.reduce((sum, route) => sum + travelRouteMicrodollars(route.request, input.now), 0));

  const compute = (request: TravelRouteRequest) => computeGoogleRoute(request, {
    config: input.provider,
    now: input.now,
    fetch: input.fetch,
    signal,
    maxRetries: 0,
  });
  let retried = false;
  return boundedMap(input.routes, TRAVEL_ROUTING_LIMITS.concurrency, async (route) => {
    let first: TravelRouteEstimate | null = null;
    let lateReserved = false;
    for (;;) {
      try {
        first ??= await compute(route.request);
        if (!transitTooEarly(route.request, first)) return { id: route.id, estimate: first, failure: null };
        // Ticket 264: the timetable has no journey from the ready time that this estimate
        // describes. One more paid call finds the next one. Its budget refusal costs only this leg.
        const late = lateTransitRequest(route.request);
        if (!lateReserved) {
          try {
            await input.reserve(travelRouteMicrodollars(late, input.now));
          } catch (error) {
            if (error instanceof TravelRoutingError) return { id: route.id, estimate: null, failure: error.failure };
            throw error;
          }
          lateReserved = true;
        }
        return { id: route.id, estimate: fromReadyTime(await compute(late), route.request.readyAt), failure: null };
      } catch (error) {
        if (error instanceof TravelRoutingError) throw error;
        if (error instanceof TravelProviderError && error.retryable && !retried) {
          retried = true;
          try {
            await input.reserve(travelRouteMicrodollars(route.request, input.now));
          } catch (refusal) {
            // After the first call was paid for, a refusal costs only this leg (Ticket 264).
            if (first && refusal instanceof TravelRoutingError) return { id: route.id, estimate: null, failure: refusal.failure };
            throw refusal;
          }
          continue;
        }
        if (error instanceof TravelProviderError) {
          return { id: route.id, estimate: null, failure: {
            code: error.code,
            retryable: error.retryable,
            retryAfterSeconds: null,
          } };
        }
        return { id: route.id, estimate: null, failure: {
          code: signal.aborted ? "timeout" : "provider_unavailable",
          retryable: true,
          retryAfterSeconds: null,
        } };
      }
    }
  });
}

function transitTooEarly(request: TravelRouteRequest, estimate: TravelRouteEstimate): boolean {
  return request.mode === "transit" && request.timing.kind === "arrive_by" &&
    Temporal.Instant.compare(Temporal.Instant.from(estimate.departureAt), Temporal.Instant.from(request.readyAt)) < 0;
}

function lateTransitRequest(request: TravelRouteRequest): TravelRouteRequest {
  return { ...request, timing: { kind: "depart_at", at: request.readyAt } };
}

/** A walk to the first stop can round to just before the ready time. The arrival stays the timetable's. */
function fromReadyTime(estimate: TravelRouteEstimate, readyAt: string): TravelRouteEstimate {
  const ready = Temporal.Instant.from(readyAt);
  const arrival = Temporal.Instant.from(estimate.arrivalAt);
  if (Temporal.Instant.compare(Temporal.Instant.from(estimate.departureAt), ready) >= 0 || Temporal.Instant.compare(arrival, ready) < 0) return estimate;
  return { ...estimate, departureAt: ready.toString(), durationSeconds: Math.round(arrival.since(ready).total({ unit: "seconds" })) };
}

/** Maps values with at most `limit` in flight, preserving input order. */
export async function boundedMap<T, U>(values: readonly T[], limit: number, map: (value: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await map(values[index]!);
    }
  }));
  return results;
}
