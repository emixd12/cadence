import { authenticateCalendarRequest, calendarPreflight, calendarResponse } from "@/lib/services/google-calendar-request";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { readGeoapifyConfig } from "@/lib/services/geoapify-provider";
import { PlaceSearchError, searchPlaces } from "@/lib/services/place-search.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = calendarPreflight;

/**
 * Authenticated place and address autocomplete backed by Geoapify (OpenStreetMap).
 * Accepts web session cookies and linked Mac Bearer tokens.
 */
export async function GET(request: Request): Promise<Response> {
  let authenticated = false;
  try {
    const caller = await authenticateCalendarRequest(request);
    authenticated = true;
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const config = readGeoapifyConfig(process.env);
    return calendarResponse(request, await searchPlaces(caller, query, config));
  } catch (error) {
    if (error instanceof PlaceSearchError) {
      const status = error.code === "invalid_request" ? 400
        : error.code === "rate_limited" ? 429
          : 503;
      const response = calendarResponse(request, { error: error.code, retryAfterSeconds: error.retryAfterSeconds }, status);
      if (error.retryAfterSeconds) response.headers.set("Retry-After", String(error.retryAfterSeconds));
      return response;
    }
    if (error instanceof CalendarConnectionError && error.code === "unauthenticated") {
      return calendarResponse(request, { error: "unauthenticated" }, 401);
    }
    return calendarResponse(request, { error: authenticated ? "provider_unavailable" : "unauthenticated" }, authenticated ? 503 : 401);
  }
}
