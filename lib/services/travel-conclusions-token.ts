import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";

import type { AdvisorWeatherOutlook } from "@cadence/core/types/briefing-travel";
import type { TravelTimingModelProjection } from "@cadence/core/types/travel";

/**
 * Ticket 219 Option A (owner decision, October 23, 2026). The routes response carries
 * Cadence's own deterministic conclusions for its view, signed with a server-only HMAC
 * secret. The Daily Brief request returns the token unchanged; the server verifies it
 * before any conclusion reaches model input. The payload holds yes/no fits, trips,
 * unknowns and weather rule conclusions only: no durations, distances, departure,
 * arrival or leave-by times, places or place keys. It is signed, not encrypted: it
 * names the user's own occurrences and Calendar events, which the client already has.
 */
export const TRAVEL_CONCLUSIONS_TOKEN_VERSION = 1 as const;
export const TRAVEL_CONCLUSIONS_SECRET_ENV = "TRAVEL_CONCLUSIONS_SIGNING_SECRET";
export const TRAVEL_CONCLUSIONS_PREVIOUS_SECRET_ENV = "TRAVEL_CONCLUSIONS_SIGNING_SECRET_PREVIOUS";
const DOMAIN = "cadence.travel-conclusions.v1";
const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 32_768;
/** Clock skew tolerated between the instance that signed and the one that verifies. */
const ISSUED_SKEW_SECONDS = 60;

export type TravelConclusionsSecrets = Readonly<{ current: string | null; previous: string | null }>;

export const NO_TRAVEL_CONCLUSIONS_SECRETS: TravelConclusionsSecrets = Object.freeze({ current: null, previous: null });

/**
 * Commitments are named by data the brief can turn into its own opaque refs:
 * `occurrence:<occurrence id>` or `event:<calendar id>\0<provider event id>`.
 */
export type TravelConclusionsPayload = Readonly<{
  v: typeof TRAVEL_CONCLUSIONS_TOKEN_VERSION;
  /** The signed-in user. */
  sub: string;
  /** The local date the view covers. */
  date: string;
  /** `travelConclusionsSourceKey` of the stored inputs the view was planned from. */
  src: string;
  iat: string;
  /** The view's expiry. */
  exp: string;
  conclusions: TravelTimingModelProjection;
  weather: AdvisorWeatherOutlook | null;
  /** Provider revision of each named Calendar event, checked against the brief's own events. */
  events: Readonly<Record<string, string>>;
}>;

/** A secret shorter than 32 characters counts as not configured. */
export function readTravelConclusionsSecrets(env: Readonly<Record<string, string | undefined>>): TravelConclusionsSecrets {
  const value = (name: string) => {
    const secret = env[name]?.trim();
    return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
  };
  return { current: value(TRAVEL_CONCLUSIONS_SECRET_ENV), previous: value(TRAVEL_CONCLUSIONS_PREVIOUS_SECRET_ENV) };
}

export function issueTravelConclusionsToken(payload: Omit<TravelConclusionsPayload, "v">, secret: string): string {
  const body = Buffer.from(JSON.stringify({ v: TRAVEL_CONCLUSIONS_TOKEN_VERSION, ...payload }), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/**
 * Returns the payload only for an untampered, unexpired token of this user and local
 * date under the current or previous secret. Every failure returns null; nothing throws.
 * The caller still compares `src` with the current stored inputs.
 */
export function verifyTravelConclusionsToken(token: unknown, input: Readonly<{
  secrets: TravelConclusionsSecrets;
  userId: string;
  localDate: string;
  now: Temporal.Instant;
}>): TravelConclusionsPayload | null {
  try {
    // The previous secret only verifies during rotation; it never stands in for a missing current one.
    if (!input.secrets.current || typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) return null;
    const [body, signature] = parts as [string, string];
    const keys = [input.secrets.current, input.secrets.previous].filter((key): key is string => !!key);
    if (!keys.some((key) => sameSignature(signature, sign(body, key)))) return null;
    const payload: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!isPayload(payload) || payload.sub !== input.userId || payload.date !== input.localDate) return null;
    const issuedAt = Temporal.Instant.from(payload.iat), expiresAt = Temporal.Instant.from(payload.exp);
    if (Temporal.Instant.compare(input.now, expiresAt) >= 0) return null;
    if (Temporal.Instant.compare(issuedAt, input.now.add({ seconds: ISSUED_SKEW_SECONDS })) > 0) return null;
    if (Temporal.Instant.compare(issuedAt, expiresAt) >= 0) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The stored travel inputs a view was planned from. A change makes a token stale. */
export function travelConclusionsSourceKey(input: Readonly<{
  settingsRevision: string;
  habitsRevision: string | null;
  enabled: boolean;
  mode: string | null;
  routingConsentAt: string | null;
  calendar: Readonly<{ status: string; generation: number | null; selectionRevision: number | null }>;
  behaviors: readonly Readonly<{ id: string; whereKind: string | null; locationText: string | null; updatedAt: string }>[];
  occurrences: readonly Readonly<{ id: string; behavior_id: string; scheduled_for: string; local_date: string; schedule_kind: string; schedule_end_time: string | null; status: string }>[];
}>): string {
  return createHash("sha256").update(JSON.stringify([
    input.settingsRevision, input.habitsRevision, input.enabled, input.mode, input.routingConsentAt,
    [input.calendar.status, input.calendar.generation, input.calendar.selectionRevision],
    input.behaviors.map((behavior) => [behavior.id, behavior.whereKind, behavior.locationText, behavior.updatedAt]),
    [...input.occurrences].sort((left, right) => left.id.localeCompare(right.id)).map((occurrence) => [occurrence.id, occurrence.behavior_id,
      occurrence.scheduled_for, occurrence.local_date, occurrence.schedule_kind, occurrence.schedule_end_time, occurrence.status]),
  ])).digest("base64url");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${DOMAIN}.${body}`).digest("base64url");
}

function sameSignature(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape only; the strict advisor-context validator checks every value before model use. */
function isPayload(value: unknown): value is TravelConclusionsPayload {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort().join();
  return keys === "conclusions,date,events,exp,iat,src,sub,v,weather"
    && value.v === TRAVEL_CONCLUSIONS_TOKEN_VERSION
    && typeof value.sub === "string" && !!value.sub
    && typeof value.date === "string" && LOCAL_DATE.test(value.date)
    && typeof value.src === "string" && !!value.src
    && typeof value.iat === "string" && INSTANT.test(value.iat)
    && typeof value.exp === "string" && INSTANT.test(value.exp)
    && record(value.conclusions)
    && (value.weather === null || record(value.weather))
    && record(value.events) && Object.values(value.events).every((revision) => typeof revision === "string");
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Renames every commitment ref in the conclusions and weather facts. `rename` throws
 * for a ref it cannot name, so a partial set never survives.
 */
export function renameTravelConclusionRefs(
  facts: Readonly<{ conclusions: TravelTimingModelProjection; weather: AdvisorWeatherOutlook | null }>,
  rename: (ref: string) => string,
): Readonly<{ conclusions: TravelTimingModelProjection; weather: AdvisorWeatherOutlook | null }> {
  const nullable = (ref: string | null) => ref === null ? null : rename(ref);
  return {
    conclusions: {
      ...facts.conclusions,
      trips: facts.conclusions.trips.map((trip) => ({ ...trip, destinationRef: nullable(trip.destinationRef) })),
      fits: facts.conclusions.fits.map((fit) => ({ ...fit, ref: rename(fit.ref),
        trip: fit.trip ? { ...fit.trip, destinationRef: nullable(fit.trip.destinationRef) } : null })),
    },
    weather: facts.weather ? { ...facts.weather, trips: facts.weather.trips.map((trip) => ({ ...trip, destinationRef: nullable(trip.destinationRef) })) } : null,
  };
}
