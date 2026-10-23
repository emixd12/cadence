import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readTravelWeather, resetWeatherForecastCacheForTest } from "@/lib/services/weather-forecast.service";
import {
  OPEN_METEO_FREE_FORECAST_URL,
  WeatherProviderError,
  fetchOpenMeteoForecast,
  openMeteoForecastUrl,
  parseOpenMeteoHours,
  readWeatherProviderConfig,
} from "@/lib/services/weather-provider";

const NOW = Temporal.Instant.from("2026-10-22T14:10:00Z");
const READY = { status: "ready" as const, baseUrl: OPEN_METEO_FREE_FORECAST_URL, apiKey: null };
// Synthetic samples near public landmarks; never a real user position.
const WILLIS_TOWER = { latitude: 41.8789, longitude: -87.6359, accuracyMeters: 30, sampledAt: "2026-10-22T14:09:30Z" };
const ART_INSTITUTE = { latitude: 41.8796, longitude: -87.6237, accuracyMeters: 40, sampledAt: "2026-10-22T14:09:00Z" };
const NAVY_PIER = { latitude: 41.8917, longitude: -87.6043, accuracyMeters: 25, sampledAt: "2026-10-22T14:09:00Z" };
const AREA = { key: "41.9,-87.6", latitude: 41.9, longitude: -87.6, gridDegrees: 0.1 };

function payload(hours = 48, overrides: Record<string, unknown> = {}) {
  const series = (value: number | null) => Array.from({ length: hours }, () => value);
  return {
    latitude: 41.875, longitude: -87.625, timezone: "GMT",
    hourly_units: { time: "unixtime", weather_code: "wmo code", rain: "mm", showers: "mm", snowfall: "cm",
      precipitation_probability: "%", apparent_temperature: "°C", wind_gusts_10m: "km/h" },
    hourly: {
      time: Array.from({ length: hours }, (_, index) => Date.parse("2026-10-22T14:00:00Z") / 1000 + index * 3600),
      weather_code: series(61), rain: series(0.4), showers: series(0.3), snowfall: series(0),
      precipitation_probability: series(40), apparent_temperature: series(12.5), wind_gusts_10m: series(30),
      ...overrides,
    },
  };
}

const okFetch = (body: unknown = payload()) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("readWeatherProviderConfig", () => {
  it("keeps weather off unless the operator approves it", () => {
    expect(readWeatherProviderConfig({})).toEqual({ status: "off" });
    expect(readWeatherProviderConfig({ CADENCE_WEATHER_PROVIDER_CLEARANCE: "disabled" })).toEqual({ status: "off" });
  });

  it("uses the free endpoint by default and the paid endpoint without code changes", () => {
    expect(readWeatherProviderConfig({ CADENCE_WEATHER_PROVIDER_CLEARANCE: "approved" }))
      .toEqual({ status: "ready", baseUrl: "https://api.open-meteo.com/v1/forecast", apiKey: null });
    expect(readWeatherProviderConfig({ CADENCE_WEATHER_PROVIDER_CLEARANCE: "approved",
      CADENCE_WEATHER_BASE_URL: "https://customer-api.open-meteo.com/v1/forecast", CADENCE_WEATHER_API_KEY: " test-key " }))
      .toEqual({ status: "ready", baseUrl: "https://customer-api.open-meteo.com/v1/forecast", apiKey: "test-key" });
  });

  it("refuses a host that is not Open-Meteo, plain HTTP or a URL with its own query", () => {
    for (const url of ["https://weather.example.com/v1/forecast", "http://api.open-meteo.com/v1/forecast",
      "https://api.open-meteo.com.example.com/v1/forecast", "https://api.open-meteo.com/v1/forecast?apikey=x", "not a url"]) {
      expect(readWeatherProviderConfig({ CADENCE_WEATHER_PROVIDER_CLEARANCE: "approved", CADENCE_WEATHER_BASE_URL: url })).toEqual({ status: "invalid" });
    }
  });
});

describe("Open-Meteo adapter", () => {
  it("requests only the rounded area, fixed variables and the cache hour window", () => {
    const url = new URL(openMeteoForecastUrl(AREA, Temporal.Instant.from("2026-10-22T14:00:00Z"), READY));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "41.9", longitude: "-87.6",
      hourly: "weather_code,rain,showers,snowfall,precipitation_probability,apparent_temperature,wind_gusts_10m",
      timezone: "GMT", timeformat: "unixtime", temperature_unit: "celsius", wind_speed_unit: "kmh", precipitation_unit: "mm",
      start_hour: "2026-10-22T14:00", end_hour: "2026-10-24T13:00",
    });
    const paid = new URL(openMeteoForecastUrl(AREA, Temporal.Instant.from("2026-10-22T14:00:00Z"),
      { status: "ready", baseUrl: "https://customer-api.open-meteo.com/v1/forecast", apiKey: "test-key" }));
    expect(paid.searchParams.get("apikey")).toBe("test-key");
  });

  it("maps hours, adds rain and showers and keeps missing values missing", () => {
    const hours = parseOpenMeteoHours(payload(2, { rain: [0.4, null], showers: [0.3, null], apparent_temperature: [12.5, null] }));
    expect(hours[0]).toEqual({ time: "2026-10-22T14:00:00Z", weatherCode: 61, rainMillimeters: 0.7,
      snowfallCentimeters: 0, precipitationProbabilityPercent: 40, apparentTemperatureCelsius: 12.5, windGustsKilometersPerHour: 30 });
    expect(hours[1]).toMatchObject({ rainMillimeters: null, apparentTemperatureCelsius: null });
  });

  it("rejects unexpected units, shapes and sizes", () => {
    const malformed = (body: unknown) => expect(() => parseOpenMeteoHours(body)).toThrow(WeatherProviderError);
    malformed(null);
    malformed({ hourly: {} });
    malformed({ ...payload(), hourly_units: { ...payload().hourly_units, wind_gusts_10m: "mph" } });
    malformed({ ...payload(), hourly_units: { ...payload().hourly_units, apparent_temperature: "°F" } });
    malformed(payload(2, { rain: [0.1] }));
    malformed(payload(2, { snowfall: ["1", 0] }));
    malformed(payload(49));
    malformed(payload(0));
  });

  it("reports provider errors and timeouts without the response body", async () => {
    const options = { config: READY, now: NOW };
    await expect(fetchOpenMeteoForecast(AREA, "2026-10-22T14:00:00Z", { ...options,
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: true, reason: "bad" }), { status: 400 })) }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(fetchOpenMeteoForecast(AREA, "2026-10-22T14:00:00Z", { ...options,
      fetch: vi.fn(async () => new Response("not json", { status: 200 })) }))
      .rejects.toMatchObject({ code: "malformed_provider_response" });
    await expect(fetchOpenMeteoForecast(AREA, "2026-10-22T14:00:00Z", { ...options, timeoutMs: 5,
      fetch: vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) }))
      .rejects.toMatchObject({ code: "timeout" });
  });
});

describe("readTravelWeather", () => {
  beforeEach(() => resetWeatherForecastCacheForTest());

  it("returns nothing while weather is off and unavailable while misconfigured", async () => {
    const fetch = okFetch();
    expect(await readTravelWeather({ device: WILLIS_TOWER, config: { status: "off" }, now: NOW, fetch })).toBeNull();
    expect(await readTravelWeather({ device: WILLIS_TOWER, config: { status: "invalid" }, now: NOW, fetch })).toEqual({ state: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("has no weather without a device position and makes no request", async () => {
    const fetch = okFetch();
    expect(await readTravelWeather({ device: null, config: READY, now: NOW, fetch })).toEqual({ state: "no_position" });
    expect(await readTravelWeather({ device: { ...WILLIS_TOWER, sampledAt: "2026-10-22T13:00:00Z" }, config: READY, now: NOW, fetch }))
      .toEqual({ state: "no_position" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares one forecast per area per hour across users and never sends the exact position", async () => {
    const fetch = okFetch();
    const first = await readTravelWeather({ device: WILLIS_TOWER, config: READY, now: NOW, fetch });
    const second = await readTravelWeather({ device: { ...ART_INSTITUTE, sampledAt: "2026-10-22T14:49:00Z" }, config: READY, now: NOW.add({ minutes: 40 }), fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ state: "forecast", forecast: { provider: "open-meteo", areaKey: "41.9,-87.6",
      hourStart: "2026-10-22T14:00:00Z", fetchedAt: "2026-10-22T14:10:00Z", expiresAt: "2026-10-22T15:00:00Z" } });
    const requested = String((fetch.mock.calls[0] as unknown[])[0]);
    expect(requested).toContain("latitude=41.9&longitude=-87.6");
    expect(requested).not.toMatch(/41\.87|87\.63|87\.62|accuracy|sampled/);

    await readTravelWeather({ device: { ...NAVY_PIER, latitude: 42.0 }, config: READY, now: NOW, fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    await readTravelWeather({ device: { ...WILLIS_TOWER, sampledAt: "2026-10-22T15:00:00Z" }, config: READY, now: Temporal.Instant.from("2026-10-22T15:00:30Z"), fetch });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("joins concurrent requests for the same area and hour", async () => {
    const fetch = okFetch();
    const results = await Promise.all([WILLIS_TOWER, ART_INSTITUTE, NAVY_PIER].map((device) =>
      readTravelWeather({ device, config: READY, now: NOW, fetch })));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
  });

  it("does not cache a failure; travel gets unavailable and the next request tries again", async () => {
    const failing = vi.fn(async () => new Response("", { status: 503 }));
    expect(await readTravelWeather({ device: WILLIS_TOWER, config: READY, now: NOW, fetch: failing })).toEqual({ state: "unavailable" });
    const fetch = okFetch();
    expect((await readTravelWeather({ device: WILLIS_TOWER, config: READY, now: NOW, fetch }))?.state).toBe("forecast");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
