import { Temporal } from "@js-temporal/polyfill";
import { canonicalTravelInstant, planTravelSettingsSave, type TravelSettingsSaveInput } from "@cadence/core/services/travel-settings";
import { canonicalTravelHabits, planTravelHabitChange, travelPlaceLabels, type TravelHabitSaveInput } from "@cadence/core/services/travel-habits";
import type { TravelSettings } from "@cadence/core/types/travel";
import { localCommand, localMutation } from "./local-store";

export type TravelSettingsClient = {
  load(): Promise<TravelSettings>;
  save(input: TravelSettingsSaveInput): Promise<TravelSettings>;
  saveHabits(input: TravelHabitSaveInput): Promise<TravelSettings>;
  placeLabels(): Promise<Readonly<Record<string, string>>>;
};

export async function readLocalTravelSettings(): Promise<TravelSettings> {
  const profile = await localCommand("readProfile", {});
  return normalizeInstants(await localCommand("readTravelSettings", { profileId: profile.id }));
}

/** Ticket 212: the setup guide learns only whether Home and usual travel exist. */
export async function readLocalTravelSetupPresence(): Promise<{ hasHome: boolean; hasMode: boolean }> {
  const settings = await readLocalTravelSettings();
  return { hasHome: Boolean(settings.baseLocationText?.trim()), hasMode: settings.mode !== null };
}

export async function saveLocalTravelSettings(
  input: TravelSettingsSaveInput,
  now = Temporal.Now.instant(),
): Promise<TravelSettings> {
  const profile = await localCommand("readProfile", {});
  const stored = await localCommand("readTravelSettings", { profileId: profile.id });
  const current = normalizeInstants(stored);
  const instant = canonicalTravelInstant(now.toString());
  // Learned habits have their own revision and command (Ticket 217).
  const { habits: _habits, ...next } = planTravelSettingsSave(current, input, instant);
  void _habits;
  return normalizeInstants(await localCommand("commitTravelSettings", {
    ...localMutation(profile.id, instant),
    expectedUpdatedAt: stored.updatedAt,
    next,
  }));
}

/** Ticket 217: the shared core rules plan the change; SQLite checks its revision. */
export async function saveLocalTravelHabits(
  input: TravelHabitSaveInput,
  now = Temporal.Now.instant(),
): Promise<TravelSettings> {
  const profile = await localCommand("readProfile", {});
  const stored = await localCommand("readTravelSettings", { profileId: profile.id });
  const instant = canonicalTravelInstant(now.toString());
  const next = planTravelHabitChange(normalizeInstants(stored).habits, input, instant);
  return normalizeInstants(await localCommand("commitTravelHabits", {
    ...localMutation(profile.id, instant),
    expectedUpdatedAt: stored.habits?.updatedAt ?? null,
    next: { ...next, updatedAt: instant },
  }));
}

/** Ticket 217: names for remembered places from Home and local Behavior places. */
export async function readLocalTravelPlaceLabels(): Promise<Readonly<Record<string, string>>> {
  const profile = await localCommand("readProfile", {});
  const [settings, graphs] = await Promise.all([
    localCommand("readTravelSettings", { profileId: profile.id }),
    localCommand("readBehaviorGraphs", { profileId: profile.id }),
  ]);
  return travelPlaceLabels({ homeText: settings.baseLocationText,
    behaviors: graphs.map(({ behavior }) => ({ whereKind: behavior.where_kind ?? null, locationText: behavior.location_text ?? null })),
    placeKeys: settings.habits?.placeModes.map((entry) => entry.placeKey) ?? [] });
}

export function createLocalTravelSettingsClient(): TravelSettingsClient {
  return { load: readLocalTravelSettings, save: saveLocalTravelSettings, saveHabits: saveLocalTravelHabits,
    placeLabels: readLocalTravelPlaceLabels };
}

function normalizeInstants(settings: TravelSettings): TravelSettings {
  return {
    ...settings,
    routingConsentAt: settings.routingConsentAt ? canonicalTravelInstant(settings.routingConsentAt) : null,
    onboardingCompletedAt: settings.onboardingCompletedAt ? canonicalTravelInstant(settings.onboardingCompletedAt) : null,
    updatedAt: canonicalTravelInstant(settings.updatedAt),
    ...(settings.habits ? { habits: canonicalTravelHabits(settings.habits) } : {}),
  };
}
