import type { TravelSettings } from "@cadence/core/types/travel";
import { consumeTravelHomeLookupRateLimit, type LaunchRateLimitResult } from "@/lib/db/launchRateLimits.repo";
import { reserveTravelProviderSpend, type TravelSpendDecision } from "@/lib/db/travelSpend.repo";
import type { CalendarCaller } from "./google-calendar.service";
import { getTravelSettings } from "./travel-settings.service";
import {
  TRAVEL_GEOCODE_MICRODOLLARS,
  TravelProviderError,
  assertTravelProviderReady,
  reverseGeocodeGooglePosition,
  type DevicePosition,
  type TravelProviderConfig,
} from "./travel-provider";

/** The same bound the device read applies before it offers a position (`validateForegroundLocation`). */
export const HOME_LOOKUP_MAX_ACCURACY_METERS = 100;

export type TravelHomeLookupResult = Readonly<{ address: string | null }>;

export type TravelHomeLookupErrorCode =
  | "invalid_request"
  | "inaccurate_position"
  | "travel_off"
  | "rate_limited"
  | "quota_exceeded"
  | TravelProviderError["code"];

export class TravelHomeLookupError extends Error {
  constructor(readonly code: TravelHomeLookupErrorCode, readonly retryAfterSeconds: number | null = null) {
    super(code);
    this.name = "TravelHomeLookupError";
  }
}

export type TravelHomeLookupDependencies = Readonly<{
  readSettings: (caller: CalendarCaller) => Promise<TravelSettings>;
  consumeRateLimit: (caller: CalendarCaller) => Promise<LaunchRateLimitResult>;
  reserveSpend: (caller: CalendarCaller, microdollars: number) => Promise<TravelSpendDecision>;
  reverseGeocode: (position: DevicePosition, config: TravelProviderConfig) => Promise<string | null>;
}>;

const defaultDependencies: TravelHomeLookupDependencies = {
  readSettings: getTravelSettings,
  consumeRateLimit: (caller) => consumeTravelHomeLookupRateLimit(caller.client),
  reserveSpend: (caller, microdollars) => reserveTravelProviderSpend(caller.client, microdollars),
  reverseGeocode: (position, config) => reverseGeocodeGooglePosition(position, { config }),
};

/**
 * Ticket 308: turns one device position into a Home address suggestion. The position is used
 * for this one provider request only. Nothing here stores, logs, syncs or returns it; errors
 * carry codes only. The caller's Home is not changed: the person edits and saves it.
 */
export async function lookupTravelHomeAddress(
  caller: CalendarCaller,
  value: unknown,
  config: TravelProviderConfig,
  dependencies: TravelHomeLookupDependencies = defaultDependencies,
): Promise<TravelHomeLookupResult> {
  const position = parsePosition(value);
  const settings = await dependencies.readSettings(caller);
  // The Travel disclosure covers sending positions to Google only while Travel estimates is on.
  if (!settings.enabled || !settings.routingConsentAt) throw new TravelHomeLookupError("travel_off");
  const limit = await dependencies.consumeRateLimit(caller);
  if (!limit.allowed) throw new TravelHomeLookupError("rate_limited", limit.retryAfterSeconds);
  const spend = await dependencies.reserveSpend(caller, TRAVEL_GEOCODE_MICRODOLLARS);
  if (!spend.allowed) throw new TravelHomeLookupError("quota_exceeded", spend.retryAfterSeconds || 1);
  assertTravelProviderReady(config);
  try {
    return { address: await dependencies.reverseGeocode(position, config) };
  } catch (error) {
    if (error instanceof TravelProviderError) throw new TravelHomeLookupError(error.code);
    throw new TravelHomeLookupError("provider_unavailable");
  }
}

function parsePosition(value: unknown): DevicePosition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid();
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== "accuracyMeters" || keys[1] !== "latitude" || keys[2] !== "longitude") throw invalid();
  const { latitude, longitude, accuracyMeters } = value as Record<string, unknown>;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180
    || typeof accuracyMeters !== "number" || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) throw invalid();
  if (accuracyMeters > HOME_LOOKUP_MAX_ACCURACY_METERS) throw new TravelHomeLookupError("inaccurate_position");
  return { latitude, longitude };
}

function invalid(): TravelHomeLookupError {
  return new TravelHomeLookupError("invalid_request");
}
