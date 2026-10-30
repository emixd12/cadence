import { Temporal } from "@js-temporal/polyfill";

import type { WeatherArea, WeatherForecastHour, WeatherForecastSnapshot } from "@cadence/core/types/weather";
import { runProviderCallWithTimeout } from "@/lib/services/provider-call-timeout";

/** Free API: development and testing only. Commercial use needs the paid plan (`docs/LEGAL.md` L-008). */
export const OPEN_METEO_FREE_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_PROVIDER_TIMEOUT_MS = 4_000;
/** One forecast covers the fetch hour and the next 47 hours: today and tomorrow in any timezone. */
export const WEATHER_FORECAST_HOURS = 48;

const HOURLY_VARIABLES = {
  weather_code: "wmo code",
  rain: "mm",
  showers: "mm",
  snowfall: "cm",
  precipitation_probability: "%",
  apparent_temperature: "°C",
  wind_gusts_10m: "km/h",
} as const;
type HourlyVariable = keyof typeof HOURLY_VARIABLES;

/**
 * Server-only. Weather stays off unless the operator sets the clearance, so the free API
 * never runs in production by default. The base URL and optional key switch to the paid
 * endpoint without code changes; the host must stay an Open-Meteo host.
 */
export type WeatherProviderConfig =
  | Readonly<{ status: "off" }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "ready"; baseUrl: string; apiKey: string | null }>;

export const WEATHER_PROVIDER_OFF: WeatherProviderConfig = { status: "off" };

export class WeatherProviderError extends Error {
  constructor(public readonly code: "timeout" | "provider_unavailable" | "malformed_provider_response") {
    super(code);
    this.name = "WeatherProviderError";
  }
}

export function readWeatherProviderConfig(env: Record<string, string | undefined> = process.env): WeatherProviderConfig {
  if (env.CADENCE_WEATHER_PROVIDER_CLEARANCE?.trim() !== "approved") return WEATHER_PROVIDER_OFF;
  const baseUrl = env.CADENCE_WEATHER_BASE_URL?.trim() || OPEN_METEO_FREE_FORECAST_URL;
  const apiKey = env.CADENCE_WEATHER_API_KEY?.trim() || null;
  let url: URL;
  try { url = new URL(baseUrl); } catch { return { status: "invalid" }; }
  const openMeteoHost = url.hostname === "open-meteo.com" || url.hostname.endsWith(".open-meteo.com");
  if (url.protocol !== "https:" || !openMeteoHost || url.search || url.hash || url.username || url.password) return { status: "invalid" };
  return { status: "ready", baseUrl: url.toString(), apiKey };
}

/**
 * Requests one forecast for a coarse area, starting at the cache hour. The request carries
 * only the rounded area and fixed parameters; never a user, account, place or route.
 */
export async function fetchOpenMeteoForecast(
  area: WeatherArea,
  hourStart: string,
  options: Readonly<{
    config: Extract<WeatherProviderConfig, { status: "ready" }>;
    now: Temporal.Instant;
    fetch?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  }>,
): Promise<WeatherForecastSnapshot> {
  const start = Temporal.Instant.from(hourStart);
  const url = openMeteoForecastUrl(area, start, options.config);
  const timeoutMs = options.timeoutMs ?? WEATHER_PROVIDER_TIMEOUT_MS;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let body: unknown;
  try {
    body = await runProviderCallWithTimeout(async (callSignal) => {
      const response = await (options.fetch ?? fetch)(url, { method: "GET", cache: "no-store", redirect: "error", signal: callSignal,
        headers: { Accept: "application/json" } });
      if (!response.ok) throw new WeatherProviderError("provider_unavailable");
      try { return await response.json() as unknown; }
      catch { throw new WeatherProviderError("malformed_provider_response"); }
    }, { timeoutMs, signal });
  } catch (error) {
    if (error instanceof WeatherProviderError) throw error;
    throw new WeatherProviderError(signal.aborted ? "timeout" : "provider_unavailable");
  }
  return {
    provider: "open-meteo",
    areaKey: area.key,
    hourStart: start.toString(),
    fetchedAt: options.now.toString(),
    expiresAt: start.add({ hours: 1 }).toString(),
    hours: parseOpenMeteoHours(body),
  };
}

export function openMeteoForecastUrl(area: WeatherArea, hourStart: Temporal.Instant, config: Extract<WeatherProviderConfig, { status: "ready" }>): string {
  const url = new URL(config.baseUrl);
  const hour = (value: Temporal.Instant) => value.toString().slice(0, 16);
  url.searchParams.set("latitude", area.latitude.toFixed(1));
  url.searchParams.set("longitude", area.longitude.toFixed(1));
  url.searchParams.set("hourly", Object.keys(HOURLY_VARIABLES).join(","));
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("start_hour", hour(hourStart));
  url.searchParams.set("end_hour", hour(hourStart.add({ hours: WEATHER_FORECAST_HOURS - 1 })));
  if (config.apiKey) url.searchParams.set("apikey", config.apiKey);
  return url.toString();
}

/** Validates units and array shapes, then maps hours. Raw payloads never leave this adapter. */
export function parseOpenMeteoHours(body: unknown): WeatherForecastHour[] {
  if (!record(body) || !record(body.hourly) || !record(body.hourly_units)) throw new WeatherProviderError("malformed_provider_response");
  const hourly = body.hourly;
  const units = body.hourly_units;
  const times = hourly.time;
  if (units.time !== "unixtime" || !Array.isArray(times) || times.length === 0 || times.length > WEATHER_FORECAST_HOURS ||
    !times.every((value, index) => Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000 &&
      value % 3600 === 0 && (index === 0 || value > times[index - 1]))) {
    throw new WeatherProviderError("malformed_provider_response");
  }
  const columns = {} as Record<HourlyVariable, (number | null)[]>;
  for (const [name, unit] of Object.entries(HOURLY_VARIABLES) as [HourlyVariable, string][]) {
    const values = hourly[name];
    if (units[name] !== unit || !Array.isArray(values) || values.length !== times.length ||
      !values.every((value) => value === null || (typeof value === "number" && Number.isFinite(value)))) {
      throw new WeatherProviderError("malformed_provider_response");
    }
    columns[name] = values as (number | null)[];
  }
  return (times as number[]).map((seconds, index) => {
    const rain = columns.rain[index] ?? null;
    const showers = columns.showers[index] ?? null;
    return {
      time: Temporal.Instant.fromEpochMilliseconds(seconds * 1000).toString(),
      weatherCode: columns.weather_code[index] ?? null,
      // Rounded to 0.01 mm so float noise cannot cross a table threshold.
      rainMillimeters: rain === null || showers === null ? null : Math.round((rain + showers) * 100) / 100,
      snowfallCentimeters: columns.snowfall[index] ?? null,
      precipitationProbabilityPercent: columns.precipitation_probability[index] ?? null,
      apparentTemperatureCelsius: columns.apparent_temperature[index] ?? null,
      windGustsKilometersPerHour: columns.wind_gusts_10m[index] ?? null,
    };
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
