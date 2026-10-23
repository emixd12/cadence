import type {
  TravelWeatherSummary,
  WeatherAttribution,
  WeatherConditionId,
  WeatherModeSuggestion,
} from "@cadence/core/types/weather";

const CONDITION_LABELS: Record<WeatherConditionId, string> = {
  thunderstorm: "thunderstorms",
  snow: "snow",
  freezing_precipitation: "freezing rain",
  heavy_rain: "heavy rain",
  rain: "rain",
  extreme_heat: "extreme heat",
  strong_wind: "strong wind",
};

export type TravelWeatherMargin = Readonly<{
  marginMinutes: number;
  /** Table order; the first condition set the margin. */
  conditions: readonly WeatherConditionId[];
  suggestion: WeatherModeSuggestion | null;
}>;

/** Plain copy for a fixed weather margin, for example "Includes 10 min for rain." */
export function travelWeatherMarginText(weather: TravelWeatherMargin): string {
  const condition = weather.conditions[0];
  if (!condition || weather.marginMinutes <= 0) return "";
  const margin = `Includes ${weather.marginMinutes} min for ${CONDITION_LABELS[condition]}.`;
  if (!weather.suggestion) return margin;
  return `${margin} Consider ${weather.suggestion.alternatives.join(" or ")} instead of ${weather.suggestion.instead}.`;
}

/** Says plainly why no weather margin was added; null when the forecast was used. */
export function travelWeatherStateText(state: TravelWeatherSummary["state"] | null | undefined): string | null {
  if (state === "no_position") return "No weather margin: device location is unavailable.";
  if (state === "unavailable") return "No weather margin: the forecast is unavailable.";
  return null;
}

/** Open-Meteo's CC BY 4.0 credit with both links, shown next to weather-derived lines. */
export function TravelWeatherCredit({ attribution, onOpenExternal }: Readonly<{
  attribution: WeatherAttribution;
  onOpenExternal?: (url: string) => void | Promise<void>;
}>) {
  const open = onOpenExternal
    ? (url: string) => (event: { preventDefault: () => void }) => { event.preventDefault(); void Promise.resolve(onOpenExternal(url)).catch(() => undefined); }
    : () => undefined;
  return <p data-weather-credit>
    <a href={attribution.url} target="_blank" rel="noreferrer" className="text-link" onClick={open(attribution.url)}>{attribution.text}</a>
    {" ("}<a href={attribution.licenceUrl} target="_blank" rel="noreferrer" className="text-link" onClick={open(attribution.licenceUrl)}>{attribution.licence}</a>{"). "}
    {attribution.changes}
  </p>;
}
