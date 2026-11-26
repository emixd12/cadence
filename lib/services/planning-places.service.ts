import {
  calendarEventPlace,
  planningPlaceCatalog,
  type CalendarEventPlace,
  type PlanningPlaceCatalog,
} from "@cadence/core/resolvers/alongside.resolver";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { alongsideEnabled } from "@/lib/services/alongside-flag";

/**
 * Ticket 384 (docs/DECISIONS.md, 2026-11-25, D37): the places a calendar event's
 * location text is compared with, and the coarse place each busy event gets for the
 * same-place rule (`calendarEventPlace`).
 *
 * The catalog holds keys only: Home's `travel_settings.base_location_text` and each
 * place-Where Behavior's `location_text`, keyed by `travelPlaceKey`. The texts are read
 * here and dropped; neither they nor the keys are stored, logged or sent to a model. A
 * label lives for the request that computed it. Nothing is read and every event stays
 * unknown while `CADENCE_ALONGSIDE` is off, so request bodies and outputs are unchanged.
 * A failed read is no catalog: every event is unknown, the behavior before Ticket 384.
 */
export async function readPlanningPlaceCatalog(
  supabase: AppSupabaseClient,
  userId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PlanningPlaceCatalog | null> {
  if (!alongsideEnabled(env)) return null;
  try {
    const [home, places] = await Promise.all([
      supabase.from("travel_settings").select("base_location_text").eq("user_id", userId).maybeSingle(),
      supabase.from("behaviors").select("location_text").eq("user_id", userId).eq("where_kind", "place"),
    ]);
    if (home.error || places.error) return null;
    return planningPlaceCatalog({
      homeText: (home.data as { base_location_text?: string | null } | null)?.base_location_text ?? null,
      placeTexts: ((places.data ?? []) as readonly { location_text: string | null }[]).map((row) => row.location_text),
    });
  } catch {
    return null;
  }
}

/**
 * Each event's coarse place, keyed as `locations` is keyed. Events whose place is
 * unknown are left out. The location texts are not kept.
 */
export function eventPlacesFromLocations(locations: ReadonlyMap<string, string>, catalog: PlanningPlaceCatalog | null)
  : ReadonlyMap<string, CalendarEventPlace> {
  const places = new Map<string, CalendarEventPlace>();
  if (!catalog) return places;
  for (const [ref, text] of locations) {
    const place = calendarEventPlace(text, catalog);
    if (place) places.set(ref, place);
  }
  return places;
}
