import type { TravelEvidenceResult } from "../types/travel";
import type { WeatherOutlookModelProjection } from "../types/weather";
import { WEATHER_MARGIN_TABLE_VERSION, WEATHER_OUTLOOK_VERSION } from "../types/weather";

/**
 * Projects weather facts the Daily Brief may send to the model (Ticket 219 stage 2,
 * through `advisorWeatherOutlook`). Each fact names a commitment, never a time: no area,
 * coordinates, departure or arrival times, durations or provider payloads. The departure
 * period comes from planned timing, so the facts reveal no route duration
 * (`docs/LEGAL.md` L-001).
 */
export function projectWeatherOutlook(
  evidence: Pick<TravelEvidenceResult, "legs" | "weather"> | null | undefined,
): WeatherOutlookModelProjection | null {
  const weather = evidence?.weather;
  if (!evidence || !weather) return null;
  const commitments = weather.state !== "applied" ? [] : evidence.legs.flatMap(({ leg, weather: legWeather }) => {
    const commitmentRef = leg.role === "return" ? leg.originCommitmentRef : leg.destinationCommitmentRef;
    if (!legWeather || !commitmentRef) return [];
    return [{
      commitmentRef,
      role: leg.role,
      mode: leg.mode,
      state: legWeather.state,
      conditions: [...legWeather.conditions],
      marginMinutes: legWeather.marginSeconds / 60,
      suggestion: legWeather.suggestion ? { instead: legWeather.suggestion.instead, alternatives: [...legWeather.suggestion.alternatives] } : null,
    }];
  });
  return {
    version: WEATHER_OUTLOOK_VERSION,
    tableVersion: WEATHER_MARGIN_TABLE_VERSION,
    state: weather.state,
    attribution: weather.attribution ? `${weather.attribution.text} (${weather.attribution.licence})` : null,
    commitments,
  };
}
