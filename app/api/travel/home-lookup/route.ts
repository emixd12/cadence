import { authenticateCalendarRequest, calendarPreflight, calendarResponse, readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { assertTravelProviderReady, readTravelProviderConfig, TravelProviderError } from "@/lib/services/travel-provider";
import { lookupTravelHomeAddress, TravelHomeLookupError } from "@/lib/services/travel-home-lookup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = calendarPreflight;

/**
 * Ticket 308: one device position in, one suggested Home address out. The position stays in
 * the request body, goes only to Google and is never stored or logged. Responses carry an
 * address or an error code, never the position.
 */
export async function POST(request: Request): Promise<Response> {
  let authenticated = false;
  try {
    const caller = await authenticateCalendarRequest(request);
    authenticated = true;
    const config = readTravelProviderConfig(process.env, request.headers.get("x-vercel-oidc-token"));
    // Without provider clearance the body is never read.
    assertTravelProviderReady(config);
    const body = await readCalendarRequestBody(request, 1_000);
    return calendarResponse(request, await lookupTravelHomeAddress(caller, body, config));
  } catch (error) {
    if (error instanceof TravelHomeLookupError) {
      const status = error.code === "invalid_request" ? 400 : error.code === "inaccurate_position" ? 422
        : error.code === "travel_off" ? 409 : error.code === "rate_limited" || error.code === "quota_exceeded" ? 429 : 503;
      const retryAfter = error.retryAfterSeconds;
      const response = calendarResponse(request, { error: error.code, retryAfterSeconds: retryAfter }, status);
      if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
    if (error instanceof TravelProviderError) return calendarResponse(request, { error: error.code }, 503);
    if (error instanceof CalendarConnectionError && error.code === "invalid_request") return calendarResponse(request, { error: "invalid_request" }, 400);
    return calendarResponse(request, { error: authenticated ? "unavailable" : "unauthenticated" }, authenticated ? 503 : 401);
  }
}
