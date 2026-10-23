import { Temporal } from "@js-temporal/polyfill";
import { canonicalTravelInstant, planTravelSettingsSave, type TravelSettingsSaveInput } from "@cadence/core/services/travel-settings";
import type { TravelSettings } from "@cadence/core/types/travel";
import { localCommand, localMutation } from "./local-store";

export type TravelSettingsClient = {
  load(): Promise<TravelSettings>;
  save(input: TravelSettingsSaveInput): Promise<TravelSettings>;
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
  const next = planTravelSettingsSave(current, input, instant);
  return normalizeInstants(await localCommand("commitTravelSettings", {
    ...localMutation(profile.id, instant),
    expectedUpdatedAt: stored.updatedAt,
    next,
  }));
}

export function createLocalTravelSettingsClient(): TravelSettingsClient {
  return { load: readLocalTravelSettings, save: saveLocalTravelSettings };
}

function normalizeInstants(settings: TravelSettings): TravelSettings {
  return {
    ...settings,
    routingConsentAt: settings.routingConsentAt ? canonicalTravelInstant(settings.routingConsentAt) : null,
    onboardingCompletedAt: settings.onboardingCompletedAt ? canonicalTravelInstant(settings.onboardingCompletedAt) : null,
    updatedAt: canonicalTravelInstant(settings.updatedAt),
  };
}
