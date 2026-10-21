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

  let retried = false;
  return boundedMap(input.routes, TRAVEL_ROUTING_LIMITS.concurrency, async (route) => {
    for (;;) {
      try {
        const estimate = await computeGoogleRoute(route.request, {
          config: input.provider,
          now: input.now,
          fetch: input.fetch,
          signal,
          maxRetries: 0,
        });
        return { id: route.id, estimate, failure: null };
      } catch (error) {
        if (error instanceof TravelRoutingError) throw error;
        if (error instanceof TravelProviderError && error.retryable && !retried) {
          retried = true;
          await input.reserve(travelRouteMicrodollars(route.request, input.now));
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
