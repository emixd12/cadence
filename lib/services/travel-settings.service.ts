import type { TravelSettings } from "@cadence/core/types/travel";
import { canonicalTravelInstant, planTravelSettingsSave, type TravelSettingsSaveInput } from "@cadence/core/services/travel-settings";
import { storedBehaviorWhere } from "@cadence/core/services/behavior-where";
import type { BehaviorWhereKind } from "@cadence/core/types/behavior";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  readTravelBehaviorLocations,
  readTravelSettingsRow,
  updateTravelSettingsRow,
} from "@/lib/db/travelSettings.repo";
import type { CalendarCaller } from "./google-calendar.service";

export type TravelRouteBehavior = {
  id: string;
  whereKind: BehaviorWhereKind | null;
  locationText: string | null;
  updatedAt: string;
};

export class TravelSettingsError extends Error {
  constructor(readonly code: "invalid_request" | "conflict" | "unavailable", message: string) {
    super(message);
    this.name = "TravelSettingsError";
  }
}

export async function getTravelSettings(caller: CalendarCaller): Promise<TravelSettings> {
  return getTravelSettingsForUser(caller.client, caller.user.id);
}

export async function getTravelSettingsForUser(
  client: AppSupabaseClient,
  userId: string,
): Promise<TravelSettings> {
  const row = await readTravelSettingsRow(client, userId);
  if (!row) throw new TravelSettingsError("unavailable", "Travel settings are unavailable.");
  return settings(row);
}

export async function saveTravelSettings(
  caller: CalendarCaller,
  value: unknown,
  now = new Date().toISOString(),
): Promise<TravelSettings> {
  const input = saveInput(value);
  const current = await getTravelSettings(caller);
  let planned: TravelSettings;
  try { planned = planTravelSettingsSave(current, input, now); }
  catch (error) {
    throw new TravelSettingsError(
      error instanceof Error && error.message.includes("changed after") ? "conflict" : "invalid_request",
      error instanceof Error ? error.message : "Travel settings are invalid.",
    );
  }
  const updated = await updateTravelSettingsRow(caller.client, caller.user.id, input.expectedUpdatedAt, planned);
  if (!updated) throw new TravelSettingsError("conflict", "Travel settings changed after they were loaded.");
  return settings(updated);
}

export async function readTravelRouteSource(
  client: AppSupabaseClient,
  userId: string,
): Promise<{
  settings: TravelSettings;
  settingsRevision: string;
  behaviors: TravelRouteBehavior[];
}> {
  const [current, behaviors] = await Promise.all([
    getTravelSettingsForUser(client, userId),
    readTravelBehaviorLocations(client, userId),
  ]);
  return {
    settings: current,
    settingsRevision: current.updatedAt,
    behaviors: behaviors.map((behavior) => {
      const where = storedBehaviorWhere(behavior);
      return {
        id: behavior.id,
        whereKind: where.where_kind,
        locationText: where.location_text,
        updatedAt: canonicalTravelInstant(behavior.updated_at),
      };
    }),
  };
}

function settings(row: Awaited<ReturnType<typeof readTravelSettingsRow>> & object): TravelSettings {
  return {
    enabled: row.enabled,
    baseLocationText: row.base_location_text,
    mode: row.mode,
    navigationPreference: row.navigation_preference,
    routingConsentAt: row.routing_consent_at ? canonicalTravelInstant(row.routing_consent_at) : null,
    onboardingCompletedAt: row.onboarding_completed_at ? canonicalTravelInstant(row.onboarding_completed_at) : null,
    updatedAt: canonicalTravelInstant(row.updated_at),
  };
}

function saveInput(value: unknown): TravelSettingsSaveInput {
  if (!record(value)
    || typeof value.enabled !== "boolean"
    || !(value.baseLocationText === null || typeof value.baseLocationText === "string")
    || !(value.mode === null || ["walking", "cycling", "transit", "driving"].includes(String(value.mode)))
    || !(value.navigationPreference === null || ["google_maps", "apple_maps"].includes(String(value.navigationPreference)))
    || typeof value.expectedUpdatedAt !== "string"
    || typeof value.acceptRoutingDisclosure !== "boolean"
    || Object.keys(value).length !== 6) {
    throw new TravelSettingsError("invalid_request", "Travel settings are invalid.");
  }
  return value as unknown as TravelSettingsSaveInput;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
