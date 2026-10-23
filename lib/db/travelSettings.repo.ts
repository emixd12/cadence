import type { TravelSettings } from "@cadence/core/types/travel";
import type { AppSupabaseClient } from "./behaviors.repo";

type TravelSettingsRow = {
  base_location_text: string | null;
  enabled: boolean;
  mode: TravelSettings["mode"];
  navigation_preference: TravelSettings["navigationPreference"];
  onboarding_completed_at: string | null;
  routing_consent_at: string | null;
  updated_at: string;
};

export async function readTravelSettingsRow(
  client: AppSupabaseClient,
  userId: string,
): Promise<TravelSettingsRow | null> {
  const { data, error } = await client.from("travel_settings").select(
    "enabled,base_location_text,mode,navigation_preference,routing_consent_at,onboarding_completed_at,updated_at",
  ).eq("user_id", userId).maybeSingle();
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
  }).eq("user_id", userId).eq("updated_at", expectedUpdatedAt).select(
    "enabled,base_location_text,mode,navigation_preference,routing_consent_at,onboarding_completed_at,updated_at",
  ).maybeSingle();
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
