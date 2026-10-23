import type { TravelMode, TravelNavigationPreference, TravelSettings } from "@cadence/core/types/travel";
import type { TravelHabitSaveInput } from "@cadence/core/services/travel-habits";

export type TravelSettingsUpdate = Readonly<{
  enabled: boolean;
  baseLocationText: string | null;
  mode: TravelMode | null;
  navigationPreference: TravelNavigationPreference | null;
  expectedUpdatedAt: string;
  acceptRoutingDisclosure: boolean;
}>;
/** Ticket 217: names for remembered places. Home and Behavior places only; Calendar places have none. */
export type TravelPlaceLabels = Readonly<Record<string, string>>;
export type TravelSettingsClient = Readonly<{
  load: () => Promise<TravelSettings>;
  save: (input: TravelSettingsUpdate) => Promise<TravelSettings>;
  /** Ticket 217: one learned-habit change, checked against the habit revision. */
  saveHabits?: (input: TravelHabitSaveInput) => Promise<TravelSettings>;
  placeLabels?: () => Promise<TravelPlaceLabels>;
}>;

async function request<T = TravelSettings>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error("Travel settings unavailable.");
  return response.json();
}
export const webTravelSettingsClient: TravelSettingsClient = {
  load: () => request("/api/travel/settings"),
  save: (input) => request("/api/travel/settings", { method: "PUT", body: JSON.stringify(input) }),
  saveHabits: (input) => request("/api/travel/habits", { method: "PUT", body: JSON.stringify(input) }),
  placeLabels: async () => (await request<{ places: TravelPlaceLabels }>("/api/travel/habits")).places,
};


/** No settings or locations enter the cross-tab notification. */
export function notifyTravelSettingsChanged(): void {
  window.dispatchEvent(new Event("cadence:travel-changed"));
  if (typeof window.BroadcastChannel === "function") {
    const channel = new BroadcastChannel("cadence-travel");
    channel.postMessage("changed");
    channel.close();
  }
}
