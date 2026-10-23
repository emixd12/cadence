import type { TravelHabits, TravelSettings } from "@cadence/core/types/travel";
import { travelHabitsToSyncValue } from "@cadence/core/services/travel-habits";
import type { Json } from "./database.types";
import type { AppSupabaseClient } from "./behaviors.repo";

export type TravelSettingsRow = {
  base_location_text: string | null;
  enabled: boolean;
  mode: TravelSettings["mode"];
  navigation_preference: TravelSettings["navigationPreference"];
  onboarding_completed_at: string | null;
  routing_consent_at: string | null;
  updated_at: string;
  preparation_minutes: number | null;
  arrival_buffer_minutes: number | null;
  place_modes: Json;
  leave_feedback: Json;
  habits_updated_at: string | null;
};

const TRAVEL_SETTINGS_COLUMNS =
  "enabled,base_location_text,mode,navigation_preference,routing_consent_at,onboarding_completed_at,updated_at,preparation_minutes,arrival_buffer_minutes,place_modes,leave_feedback,habits_updated_at";

export async function readTravelSettingsRow(
  client: AppSupabaseClient,
  userId: string,
): Promise<TravelSettingsRow | null> {
  const { data, error } = await client.from("travel_settings").select(TRAVEL_SETTINGS_COLUMNS)
    .eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data as TravelSettingsRow | null;
}

/** Ticket 212: reports whether Home and usual travel exist without returning the Home text. */
export async function readTravelSetupPresence(
  client: AppSupabaseClient,
  userId: string,
): Promise<{ hasHome: boolean; hasMode: boolean } | null> {
  const { data, error } = await client.from("travel_settings").select("base_location_text,mode")
    .eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Pick<TravelSettingsRow, "base_location_text" | "mode">;
  return { hasHome: Boolean(row.base_location_text?.trim()), hasMode: row.mode !== null };
}

export async function updateTravelSettingsRow(
  client: AppSupabaseClient,
  userId: string,
  expectedUpdatedAt: string,
  settings: TravelSettings,
): Promise<TravelSettingsRow | null> {
  const { data, error } = await client.from("travel_settings").update({
    enabled: settings.enabled,
    base_location_text: settings.baseLocationText,
    mode: settings.mode,
    navigation_preference: settings.navigationPreference,
    routing_consent_at: settings.routingConsentAt,
    onboarding_completed_at: settings.onboardingCompletedAt,
    updated_at: settings.updatedAt,
  }).eq("user_id", userId).eq("updated_at", expectedUpdatedAt).select(TRAVEL_SETTINGS_COLUMNS).maybeSingle();
  if (error) throw error;
  return data as TravelSettingsRow | null;
}

/** Ticket 217: writes only habit columns, compared against the habit revision. */
export async function updateTravelHabitsRow(
  client: AppSupabaseClient,
  userId: string,
  expectedUpdatedAt: string | null,
  habits: TravelHabits & { updatedAt: string },
): Promise<TravelSettingsRow | null> {
  const value = travelHabitsToSyncValue(habits);
  const query = client.from("travel_settings").update({
    preparation_minutes: value.travel_preparation_minutes,
    arrival_buffer_minutes: value.travel_arrival_buffer_minutes,
    place_modes: value.travel_place_modes,
    leave_feedback: value.travel_leave_feedback,
    habits_updated_at: habits.updatedAt,
  }).eq("user_id", userId);
  const { data, error } = await (expectedUpdatedAt === null
    ? query.is("habits_updated_at", null)
    : query.eq("habits_updated_at", expectedUpdatedAt)).select(TRAVEL_SETTINGS_COLUMNS).maybeSingle();
  if (error) throw error;
  return data as TravelSettingsRow | null;
}

export async function readTravelBehaviorLocations(
  client: AppSupabaseClient,
  userId: string,
): Promise<{ id: string; where_kind: string | null; location_text: string | null; updated_at: string }[]> {
  const { data, error } = await client.from("behaviors")
    .select("id,where_kind,location_text,updated_at")
    .eq("user_id", userId)
    .order("id");
  if (error) throw error;
  return (data ?? []) as { id: string; where_kind: string | null; location_text: string | null; updated_at: string }[];
}
