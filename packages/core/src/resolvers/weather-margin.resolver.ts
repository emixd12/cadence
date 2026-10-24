import { Temporal } from "@js-temporal/polyfill";

import type {
  TravelMode,
  TravelOccupiedSegment,
  TravelPlannedLeg,
  TravelResolvedLegEvidence,
} from "../types/travel";
import type {
  TravelLegWeather,
  TravelWeatherInput,
  TravelWeatherSummary,
  WeatherArea,
  WeatherAttribution,
  WeatherConditionId,
  WeatherForecastHour,
  WeatherForecastSnapshot,
  WeatherModeSuggestion,
} from "../types/weather";
import { WEATHER_MARGIN_TABLE_VERSION } from "../types/weather";

/** Device positions are rounded to this grid before any weather request (about 11 km of latitude). */
export const WEATHER_AREA_GRID_DEGREES = 0.1;
/** Weather is read for the two hours before an arrival target, or after a fixed departure. */
export const WEATHER_DEPARTURE_PERIOD_SECONDS = 2 * 60 * 60;
const MAX_POSITION_AGE_SECONDS = 15 * 60;
const MAX_POSITION_FUTURE_SECONDS = 5 * 60;
const MAX_POSITION_ACCURACY_METERS = 5_000;
const HOUR_SECONDS = 60 * 60;

export const OPEN_METEO_ATTRIBUTION: WeatherAttribution = {
  text: "Weather data by Open-Meteo.com",
  url: "https://open-meteo.com/",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  changes: "Cadence derived travel margins from the forecast.",
};

type NumericField = "rainMillimeters" | "snowfallCentimeters" | "precipitationProbabilityPercent" |
  "apparentTemperatureCelsius" | "windGustsKilometersPerHour";

export type WeatherMarginRule = Readonly<{
  id: WeatherConditionId;
  marginMinutes: number;
  /** WMO weather interpretation codes that match this row. */
  weatherCodes: readonly number[];
  /** Any threshold that holds matches this row. Missing values never match. */
  thresholds: readonly Readonly<{ field: NumericField; atLeast?: number; above?: number }>[];
  /** Modes that receive the suggestion, and what to use instead. */
  insteadOf: readonly TravelMode[];
  alternatives: readonly TravelMode[];
}>;

const range = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

/**
 * `weather-margin@1`, ordered from the largest margin down. The owner set these starting
 * values on October 22, 2026; changing a value or a threshold needs a new version.
 */
export const WEATHER_MARGIN_TABLE: readonly WeatherMarginRule[] = [
  { id: "thunderstorm", marginMinutes: 15, weatherCodes: range(95, 99), thresholds: [],
    insteadOf: ["walking", "cycling"], alternatives: ["transit", "driving"] },
  { id: "snow", marginMinutes: 15, weatherCodes: [...range(71, 77), 85, 86],
    thresholds: [{ field: "snowfallCentimeters", above: 0 }],
    insteadOf: ["cycling"], alternatives: ["transit", "driving"] },
  { id: "freezing_precipitation", marginMinutes: 15, weatherCodes: [56, 57, 66, 67], thresholds: [],
    insteadOf: ["cycling"], alternatives: ["transit", "driving"] },
  { id: "heavy_rain", marginMinutes: 15, weatherCodes: [65, 82],
    thresholds: [{ field: "rainMillimeters", atLeast: 4 }],
    insteadOf: ["walking", "cycling"], alternatives: ["transit"] },
  { id: "rain", marginMinutes: 10, weatherCodes: [],
    thresholds: [{ field: "rainMillimeters", atLeast: 0.5 }, { field: "precipitationProbabilityPercent", atLeast: 60 }],
    insteadOf: ["cycling"], alternatives: ["transit"] },
  { id: "extreme_heat", marginMinutes: 5, weatherCodes: [],
    thresholds: [{ field: "apparentTemperatureCelsius", atLeast: 35 }],
    insteadOf: ["cycling"], alternatives: ["transit"] },
  { id: "strong_wind", marginMinutes: 5, weatherCodes: [],
    thresholds: [{ field: "windGustsKilometersPerHour", atLeast: 60 }],
    insteadOf: ["cycling"], alternatives: ["transit"] },
];

export type WeatherMarginResult = Readonly<{
  tableVersion: typeof WEATHER_MARGIN_TABLE_VERSION;
  state: TravelLegWeather["state"];
  conditions: readonly WeatherConditionId[];
  marginSeconds: number;
  suggestion: WeatherModeSuggestion | null;
}>;

/** Table rows that match one forecast hour, in table order. */
export function resolveWeatherConditions(hour: WeatherForecastHour): WeatherConditionId[] {
  return WEATHER_MARGIN_TABLE.filter((rule) => ruleMatches(rule, hour)).map((rule) => rule.id);
}

/**
 * The single largest matching margin for a period; margins never stack and never depend
 * on route duration. The suggestion comes from the first matching row that covers the mode.
 */
export function resolveWeatherMargin(input: Readonly<{
  hours: readonly WeatherForecastHour[];
  period: Readonly<{ startAt: string; endAt: string }>;
  mode: TravelMode;
}>): WeatherMarginResult {
  const start = instant(input.period.startAt, "Weather period start");
  const end = instant(input.period.endAt, "Weather period end");
  if (Temporal.Instant.compare(start, end) >= 0) throw new Error("Weather period end must follow its start.");
  // A forecast hour ending at `time` covers (time − 1 h, time]; it counts when that hour overlaps the period.
  const relevant = input.hours.filter((hour) => {
    const time = instant(hour.time, "Forecast hour");
    return Temporal.Instant.compare(time, start) > 0 &&
      Temporal.Instant.compare(time.subtract({ seconds: HOUR_SECONDS }), end) < 0;
  });
  const matched = new Set(relevant.flatMap(resolveWeatherConditions));
  const rules = WEATHER_MARGIN_TABLE.filter((rule) => matched.has(rule.id));
  if (!rules.length && !coversPeriod(relevant, start, end)) {
    return { tableVersion: WEATHER_MARGIN_TABLE_VERSION, state: "unknown", conditions: [], marginSeconds: 0, suggestion: null };
  }
  const marginMinutes = rules.reduce((largest, rule) => Math.max(largest, rule.marginMinutes), 0);
  const suggesting = rules.find((rule) => rule.insteadOf.includes(input.mode));
  return {
    tableVersion: WEATHER_MARGIN_TABLE_VERSION,
    state: rules.length ? "margin" : "clear",
    conditions: rules.map((rule) => rule.id),
    marginSeconds: marginMinutes * 60,
    suggestion: suggesting ? { instead: input.mode, alternatives: suggesting.alternatives } : null,
  };
}

/**
 * The departure period comes from the leg's planned timing, never from a route estimate:
 * the two hours before an arrival target, or the two hours after a fixed departure. Weather
 * facts therefore reveal no route duration (`docs/LEGAL.md` L-001).
 */
export function weatherDeparturePeriod(leg: Pick<TravelPlannedLeg, "request">): Readonly<{ startAt: string; endAt: string }> {
  const at = instant(leg.request.timing.at, "Leg timing");
  return leg.request.timing.kind === "arrive_by"
    ? { startAt: at.subtract({ seconds: WEATHER_DEPARTURE_PERIOD_SECONDS }).toString(), endAt: at.toString() }
    : { startAt: at.toString(), endAt: at.add({ seconds: WEATHER_DEPARTURE_PERIOD_SECONDS }).toString() };
}

/**
 * Rounds a device sample to the coarse weather grid. Only the device position may become
 * a weather area; Google coordinates never do (`docs/LEGAL.md` L-002).
 */
export function resolveWeatherArea(
  sample: Readonly<{ latitude: number; longitude: number; accuracyMeters: number; sampledAt: string }> | null,
  now: string,
): WeatherArea | null {
  if (!sample) return null;
  const { latitude, longitude, accuracyMeters } = sample;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    !Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > MAX_POSITION_ACCURACY_METERS) return null;
  let age: number;
  try { age = instant(now, "Weather now").since(Temporal.Instant.from(sample.sampledAt)).total("seconds"); }
  catch { return null; }
  if (age > MAX_POSITION_AGE_SECONDS || age < -MAX_POSITION_FUTURE_SECONDS) return null;
  const roundedLatitude = gridValue(latitude);
  const roundedLongitude = gridValue(longitude);
  return {
    key: `${roundedLatitude.toFixed(1)},${roundedLongitude.toFixed(1)}`,
    latitude: roundedLatitude,
    longitude: roundedLongitude,
    gridDegrees: WEATHER_AREA_GRID_DEGREES,
  };
}

/** The clock hour (UTC) that keys the shared forecast cache: one forecast per area per hour. */
export function weatherCacheHour(now: string): Readonly<{ hourStart: string; expiresAt: string }> {
  const hourStart = instant(now, "Weather now").toZonedDateTimeISO("UTC")
    .round({ smallestUnit: "hour", roundingMode: "floor" }).toInstant();
  return { hourStart: hourStart.toString(), expiresAt: hourStart.add({ seconds: HOUR_SECONDS }).toString() };
}

/**
 * Applies the weather input to resolved legs. The margin sits immediately before an
 * arrive-by departure, or after a fixed-departure arrival. Ticket 217's get-ready time,
 * when present, precedes the weather-adjusted departure.
 */
export function resolveTravelWeather(input: Readonly<{
  weather: TravelWeatherInput | null | undefined;
  plannedLegs: readonly TravelPlannedLeg[];
  legs: readonly TravelResolvedLegEvidence[];
  now: string;
  current: boolean;
}>): Readonly<{
  summary: TravelWeatherSummary | null;
  legs: TravelResolvedLegEvidence[];
  segments: TravelOccupiedSegment[];
}> {
  const weather = input.weather;
  if (!weather) return { summary: null, legs: [...input.legs], segments: [] };
  const forecast = weather.state === "forecast" && input.current && forecastUsable(weather.forecast, input.now)
    ? weather.forecast
    : null;
  if (!forecast) {
    const state = weather.state === "no_position" ? "no_position" : "unavailable";
    return { summary: { tableVersion: WEATHER_MARGIN_TABLE_VERSION, state, forecastAt: null, attribution: null },
      legs: [...input.legs], segments: [] };
  }
  const plannedById = new Map(input.plannedLegs.map((leg) => [leg.id, leg]));
  const segments: TravelOccupiedSegment[] = [];
  const legs = input.legs.map((entry): TravelResolvedLegEvidence => {
    const planned = plannedById.get(entry.leg.id);
    if (!planned || entry.state === "rejected_revision") return entry;
    const margin = resolveWeatherMargin({ hours: forecast.hours, period: weatherDeparturePeriod(planned), mode: planned.mode });
    const estimate = entry.state === "current" ? entry.estimate : null;
    const fixedDeparture = planned.request.timing.kind === "depart_at";
    const departureAt = estimate
      ? fixedDeparture ? estimate.departureAt : shift(estimate.departureAt, -margin.marginSeconds)
      : null;
    const arrivalAt = estimate
      ? fixedDeparture ? shift(estimate.arrivalAt, margin.marginSeconds) : estimate.arrivalAt
      : null;
    if (estimate && margin.marginSeconds > 0) {
      const sourceRefs = [entry.leg.originCommitmentRef, entry.leg.destinationCommitmentRef]
        .filter((ref): ref is string => ref !== null);
      segments.push(fixedDeparture
        ? { id: `weather:${entry.leg.id}`, kind: "weather_margin", startAt: estimate.arrivalAt, endAt: arrivalAt!, sourceRefs, legId: entry.leg.id }
        : { id: `weather:${entry.leg.id}`, kind: "weather_margin", startAt: departureAt!, endAt: estimate.departureAt, sourceRefs, legId: entry.leg.id });
    }
    return { ...entry, weather: { ...margin, departureAt, arrivalAt } };
  });
  return {
    summary: { tableVersion: WEATHER_MARGIN_TABLE_VERSION, state: "applied", forecastAt: forecast.fetchedAt, attribution: OPEN_METEO_ATTRIBUTION },
    legs,
    segments,
  };
}

function forecastUsable(forecast: WeatherForecastSnapshot, now: string): boolean {
  const current = instant(now, "Weather now");
  return Temporal.Instant.compare(instant(forecast.fetchedAt, "Forecast fetch"), current) <= 0 &&
    Temporal.Instant.compare(instant(forecast.expiresAt, "Forecast expiry"), current) > 0;
}

function ruleMatches(rule: WeatherMarginRule, hour: WeatherForecastHour): boolean {
  if (hour.weatherCode !== null && rule.weatherCodes.includes(hour.weatherCode)) return true;
  return rule.thresholds.some((threshold) => {
    const value = hour[threshold.field];
    if (value === null || !Number.isFinite(value)) return false;
    if (threshold.atLeast !== undefined && value >= threshold.atLeast) return true;
    return threshold.above !== undefined && value > threshold.above;
  });
}

function fullyReported(hour: WeatherForecastHour): boolean {
  return [hour.weatherCode, hour.rainMillimeters, hour.snowfallCentimeters, hour.precipitationProbabilityPercent,
    hour.apparentTemperatureCelsius, hour.windGustsKilometersPerHour].every((value) => value !== null && Number.isFinite(value));
}

/** Missing hours or measurements cannot establish that the entire departure period is clear. */
function coversPeriod(hours: readonly WeatherForecastHour[], start: Temporal.Instant, end: Temporal.Instant): boolean {
  const ends = hours.filter(fullyReported).map((hour) => instant(hour.time, "Forecast hour"))
    .sort(Temporal.Instant.compare);
  let coveredThrough = start;
  for (const hourEnd of ends) {
    if (Temporal.Instant.compare(hourEnd.subtract({ seconds: HOUR_SECONDS }), coveredThrough) > 0) return false;
    if (Temporal.Instant.compare(hourEnd, coveredThrough) > 0) coveredThrough = hourEnd;
    if (Temporal.Instant.compare(coveredThrough, end) >= 0) return true;
  }
  return false;
}

/** Nearest 0.1° cell centre; the grid and the key's one decimal place change together. */
function gridValue(value: number): number {
  const rounded = Number((Math.round(value * 10) / 10).toFixed(1));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function shift(value: string, seconds: number): string {
  return instant(value, "Weather-adjusted time").add({ seconds }).toString();
}

function instant(value: string, label: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`${label} must be a valid instant.`);
  }
}
