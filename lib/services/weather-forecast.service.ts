import { Temporal } from "@js-temporal/polyfill";

import { resolveWeatherArea, weatherCacheHour } from "@cadence/core/resolvers/weather-margin.resolver";
import type { TravelWeatherInput, WeatherArea, WeatherForecastSnapshot } from "@cadence/core/types/weather";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import { fetchOpenMeteoForecast, type WeatherProviderConfig } from "@/lib/services/weather-provider";

const CACHE_CAP = 256;

/**
 * Process memory shared by every user: one forecast per area per clock hour. Entries hold
 * no user, account or route data, expire at the end of their hour and are never written to
 * storage. Each server instance keeps its own copy.
 */
const forecasts = new Map<string, WeatherForecastSnapshot>();
const inFlight = new Map<string, Promise<WeatherForecastSnapshot>>();

export type WeatherDeviceSample = Readonly<{ latitude: number; longitude: number; accuracyMeters: number; sampledAt: string }>;

/**
 * The weather input for one travel refresh. Weather is derived from the device position
 * only; without one there is no weather. A provider failure never blocks travel.
 */
export async function readTravelWeather(input: Readonly<{
  device: WeatherDeviceSample | null;
  config: WeatherProviderConfig;
  now: Temporal.Instant;
  fetch?: typeof fetch;
}>): Promise<TravelWeatherInput | null> {
  if (input.config.status === "off") return null;
  if (input.config.status === "invalid") return { state: "unavailable" };
  const area = resolveWeatherArea(input.device, input.now.toString());
  if (!area) return { state: "no_position" };
  try {
    return { state: "forecast", forecast: await sharedForecast(area, input.config, input.now, input.fetch) };
  } catch {
    return { state: "unavailable" };
  }
}

async function sharedForecast(
  area: WeatherArea,
  config: Extract<WeatherProviderConfig, { status: "ready" }>,
  now: Temporal.Instant,
  fetchImpl: typeof fetch | undefined,
): Promise<WeatherForecastSnapshot> {
  const { hourStart } = weatherCacheHour(now.toString());
  const key = `${area.key}@${hourStart}`;
  evictExpired(now);
  const cached = forecasts.get(key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;
  // Joined requests share one fetch bounded by the provider timeout, not by any one
  // caller's request deadline. A failure is not cached.
  const request = measurePerformanceSpan({ span: "weather.forecast", counts: { forecasts: 1 } },
    () => fetchOpenMeteoForecast(area, hourStart, { config, now, fetch: fetchImpl }))
    .then((forecast) => {
      forecasts.set(key, forecast);
      while (forecasts.size > CACHE_CAP) forecasts.delete(forecasts.keys().next().value!);
      return forecast;
    })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}

function evictExpired(now: Temporal.Instant): void {
  for (const [key, forecast] of forecasts) {
    if (Temporal.Instant.compare(Temporal.Instant.from(forecast.expiresAt), now) <= 0) forecasts.delete(key);
  }
}

/** Test-only reset of the shared forecast cache. */
export function resetWeatherForecastCacheForTest(): void {
  forecasts.clear();
  inFlight.clear();
}
