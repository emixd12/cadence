import type { TravelMode } from "./travel";

/** Version of the fixed weather margin table (Ticket 218). Every computed margin records it. */
export const WEATHER_MARGIN_TABLE_VERSION = "weather-margin@1" as const;
/** Version of the model-safe weather outlook projection (consumed by Ticket 219). */
export const WEATHER_OUTLOOK_VERSION = "weather-outlook@1" as const;

export type WeatherMarginTableVersion = typeof WEATHER_MARGIN_TABLE_VERSION;

export type WeatherConditionId =
  | "thunderstorm"
  | "snow"
  | "freezing_precipitation"
  | "heavy_rain"
  | "rain"
  | "extreme_heat"
  | "strong_wind";

/**
 * One forecast hour ending at `time`. Rain, snowfall, probability and gusts describe the
 * hour ending at `time`; the weather code and apparent temperature are values at `time`.
 * Null means the provider did not report the value; it never means zero.
 */
export type WeatherForecastHour = Readonly<{
  time: string;
  weatherCode: number | null;
  /** Rain plus showers, millimetres in the hour. */
  rainMillimeters: number | null;
  snowfallCentimeters: number | null;
  precipitationProbabilityPercent: number | null;
  apparentTemperatureCelsius: number | null;
  windGustsKilometersPerHour: number | null;
}>;

/** A coarse grid cell derived from the device position only, never from provider coordinates. */
export type WeatherArea = Readonly<{
  key: string;
  latitude: number;
  longitude: number;
  gridDegrees: number;
}>;

/** One shared forecast for an area and a clock hour. It holds no user, account or route data. */
export type WeatherForecastSnapshot = Readonly<{
  provider: "open-meteo";
  areaKey: string;
  /** Start of the clock hour the forecast was fetched for; the shared cache key. */
  hourStart: string;
  fetchedAt: string;
  expiresAt: string;
  hours: readonly WeatherForecastHour[];
}>;

export type WeatherAttribution = Readonly<{
  text: string;
  url: string;
  licence: string;
  licenceUrl: string;
  changes: string;
}>;

export type WeatherModeSuggestion = Readonly<{
  instead: TravelMode;
  alternatives: readonly TravelMode[];
}>;

/** The resolver's weather input beside the travel buffers. Absent means weather is off. */
export type TravelWeatherInput =
  | Readonly<{ state: "forecast"; forecast: WeatherForecastSnapshot }>
  | Readonly<{ state: "no_position" | "unavailable" }>;

export type TravelWeatherSummary = Readonly<{
  tableVersion: WeatherMarginTableVersion;
  state: "applied" | "no_position" | "unavailable";
  forecastAt: string | null;
  attribution: WeatherAttribution | null;
}>;

/** Weather margin for one leg. The margin is a fixed table value, never a share of the trip. */
export type TravelLegWeather = Readonly<{
  tableVersion: WeatherMarginTableVersion;
  /** `unknown`: the forecast does not cover this leg's departure period. */
  state: "clear" | "margin" | "unknown";
  conditions: readonly WeatherConditionId[];
  marginSeconds: number;
  suggestion: WeatherModeSuggestion | null;
  /** Weather-adjusted timing for a current estimate; null without one. */
  departureAt: string | null;
  arrivalAt: string | null;
}>;

/**
 * Model-safe weather facts for a later Daily Brief stage (Ticket 219). It carries no
 * area, coordinates, departure or arrival times, durations or provider payloads.
 */
export type WeatherOutlookModelProjection = Readonly<{
  version: typeof WEATHER_OUTLOOK_VERSION;
  tableVersion: WeatherMarginTableVersion;
  state: TravelWeatherSummary["state"];
  attribution: string | null;
  commitments: readonly Readonly<{
    commitmentRef: string;
    role: "outbound" | "onward" | "return";
    mode: TravelMode;
    /** `unknown` stays unknown; it never becomes clear weather. */
    state: TravelLegWeather["state"];
    conditions: readonly WeatherConditionId[];
    marginMinutes: number;
    suggestion: WeatherModeSuggestion | null;
  }>[];
}>;
