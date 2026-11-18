import { createHmac, timingSafeEqual } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";

import type { BriefMoveTravelInput } from "@cadence/core/resolvers/brief-move.resolver";
import type { TravelEvidenceResult } from "@cadence/core/types/travel";
import type { TravelConclusionsSecrets } from "./travel-conclusions-token";

/**
 * Advisor Phase 3A1 (docs/DECISIONS.md, 2026-11-18, "Brief moves see travel"). The
 * routes response also carries the day's travel times, signed with the travel
 * conclusions secret under its own domain, so the brief's move lines, Other time,
 * Re-plan and Yes can keep room for travel. The screen returns the token unchanged.
 * The server uses it for that one request: it is never stored, never logged and never
 * sent to a model. It holds instants and seconds only: no places, distances or route text.
 *
 *   spans: occupied travel (routes and their margins) and the commitments they serve
 *   stops: per occurrence, known travel seconds needed before it and after it
 *   unknown: occurrences with a leg whose travel time is not known (the line says "travel not checked")
 */
export const TRAVEL_TIMES_TOKEN_VERSION = 1 as const;
const DOMAIN = "cadence.travel-times.v1";
const MAX_TOKEN_LENGTH = 32_768;
const ISSUED_SKEW_SECONDS = 60;

export type TravelTimesPayload = Readonly<{
  v: typeof TRAVEL_TIMES_TOKEN_VERSION;
  sub: string;
  date: string;
  iat: string;
  exp: string;
  /** [startAt, endAt, refs] with refs named `occurrence:<id>` or the calendar event id. */
  spans: readonly (readonly [string, string, readonly string[]])[];
  /** occurrence id -> [seconds before, seconds after]. */
  stops: Readonly<Record<string, readonly [number, number]>>;
  unknown: readonly string[];
}>;

/** The token's content from a routed day's evidence. Null when the evidence has no legs. */
export function travelTimesFromEvidence(evidence: TravelEvidenceResult, occurrenceIds: ReadonlySet<string>)
  : Omit<TravelTimesPayload, "v" | "sub" | "date" | "iat" | "exp"> | null {
  if (!evidence.legs.length && !(evidence.unknownLegs?.length)) return null;
  const name = (ref: string) => occurrenceIds.has(ref) ? `occurrence:${ref}` : ref;
  const legs = new Map(evidence.legs.map((item) => [item.leg.id, item]));
  const spans = evidence.segments.filter((segment) => segment.kind !== "commitment").map((segment) => {
    const leg = segment.legId ? legs.get(segment.legId)?.leg : null;
    const refs = [...new Set([...segment.sourceRefs, leg?.originCommitmentRef, leg?.destinationCommitmentRef]
      .filter((ref): ref is string => !!ref).map(name))];
    return [segment.startAt, segment.endAt, refs] as const;
  });
  const seconds = (legId: string) => evidence.segments.filter((segment) => segment.legId === legId && segment.kind !== "commitment")
    .reduce((sum, segment) => sum + Temporal.Instant.from(segment.startAt).until(Temporal.Instant.from(segment.endAt)).total("seconds"), 0);
  const stops: Record<string, [number, number]> = {};
  const unknown = new Set<string>();
  for (const item of evidence.legs) {
    const { leg } = item;
    for (const [ref, side] of [[leg.destinationCommitmentRef, 0], [leg.originCommitmentRef, 1]] as const) {
      if (!ref || !occurrenceIds.has(ref)) continue;
      if (item.state !== "current" || !item.estimate) { unknown.add(ref); continue; }
      const entry = stops[ref] ?? [0, 0];
      entry[side] = Math.max(entry[side], Math.round(seconds(leg.id)));
      stops[ref] = entry;
    }
  }
  for (const leg of evidence.unknownLegs ?? []) {
    for (const ref of [leg.destinationCommitmentRef, leg.originCommitmentRef]) if (ref && occurrenceIds.has(ref)) unknown.add(ref);
  }
  // A stop with one unknown side keeps its known side: the planner still keeps room for it and says travel was not checked.
  return { spans, stops, unknown: [...unknown].sort() };
}

export function issueTravelTimesToken(payload: Omit<TravelTimesPayload, "v">, secret: string): string | null {
  const body = Buffer.from(JSON.stringify({ v: TRAVEL_TIMES_TOKEN_VERSION, ...payload }), "utf8").toString("base64url");
  if (body.length + 44 > MAX_TOKEN_LENGTH) return null;
  return `${body}.${sign(body, secret)}`;
}

/** The verified payload, or null for any failure (wrong user or day, expired, altered). Never throws. */
export function verifyTravelTimesToken(token: unknown, input: Readonly<{
  secrets: TravelConclusionsSecrets; userId: string; localDate: string; now: Temporal.Instant;
}>): TravelTimesPayload | null {
  try {
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
    return payload;
  } catch {
    return null;
  }
}

/** The planner's view of a verified payload. */
export function briefMoveTravelInput(payload: TravelTimesPayload | null): BriefMoveTravelInput | null {
  if (!payload) return null;
  return {
    spans: payload.spans.map(([startAt, endAt, refs]) => ({ start: Temporal.Instant.from(startAt), end: Temporal.Instant.from(endAt), refs })),
    stops: new Map(Object.entries(payload.stops).map(([id, [beforeSeconds, afterSeconds]]) => [id, { beforeSeconds, afterSeconds }])),
    unknown: new Set(payload.unknown),
  };
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${DOMAIN}.${body}`).digest("base64url");
}

function sameSignature(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

function isPayload(value: unknown): value is TravelTimesPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).sort().join() === "date,exp,iat,spans,stops,sub,unknown,v"
    && item.v === TRAVEL_TIMES_TOKEN_VERSION && typeof item.sub === "string" && typeof item.date === "string"
    && typeof item.iat === "string" && INSTANT.test(item.iat) && typeof item.exp === "string" && INSTANT.test(item.exp)
    && Array.isArray(item.spans) && item.spans.every((span) => Array.isArray(span) && span.length === 3
      && typeof span[0] === "string" && INSTANT.test(span[0]) && typeof span[1] === "string" && INSTANT.test(span[1])
      && Array.isArray(span[2]) && span[2].every((ref: unknown) => typeof ref === "string"))
    && !!item.stops && typeof item.stops === "object" && !Array.isArray(item.stops)
    && Object.values(item.stops).every((stop) => Array.isArray(stop) && stop.length === 2
      && stop.every((seconds: unknown) => typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86_400))
    && Array.isArray(item.unknown) && item.unknown.every((ref) => typeof ref === "string");
}
