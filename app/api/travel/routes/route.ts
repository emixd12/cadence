import { calendarPreflight, authenticateCalendarRequest, calendarResponse, readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { refreshTravelRoutes } from "@/lib/services/travel-route-refresh.service";
import { assertTravelProviderReady, readTravelProviderConfig, TravelProviderError } from "@/lib/services/travel-provider";
import { TravelRoutingError } from "@/lib/services/travel-routing.service";
import { readWeatherProviderConfig } from "@/lib/services/weather-provider";
import { readTravelConclusionsSecrets } from "@/lib/services/travel-conclusions-token";
import { withPerformanceRoute } from "@/lib/services/performance-timing";

export const runtime = "nodejs";
export const OPTIONS = calendarPreflight;

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await authenticateCalendarRequest(request);
    const config = readTravelProviderConfig(process.env, request.headers.get("x-vercel-oidc-token"));
    try { assertTravelProviderReady(config); }
    catch { return calendarResponse(request, { configured: false, accountId: caller.user.id }); }
    return calendarResponse(request, { configured: true, accountId: caller.user.id });
  } catch {
    return calendarResponse(request, { error: "unauthenticated" }, 401);
  }
}

/**
 * The release guard does not read a request body or any
 * route source before the operator's provider-use clearance is active.
 */
export async function POST(request: Request): Promise<Response> {
  let authenticated = false;
  try {
    const caller = await authenticateCalendarRequest(request);
    authenticated = true;
    const config = readTravelProviderConfig(process.env, request.headers.get("x-vercel-oidc-token"));
    try { assertTravelProviderReady(config); }
    catch (error) {
      const code = error instanceof TravelProviderError ? error.code : "provider_clearance_required";
      return calendarResponse(request, {
        error: code,
        accountId: caller.user.id,
        mode: null,
        navigationPreference: null,
        settingsRevision: null,
        expiresAt: null,
      }, 503);
    }
    const body = await readCalendarRequestBody(request);
    return calendarResponse(request, await withPerformanceRoute("/api/travel/routes", "travel.refresh", () => refreshTravelRoutes(caller, body, config, undefined, readWeatherProviderConfig(process.env), readTravelConclusionsSecrets(process.env).current)));
  } catch (error) {
    if (error instanceof TravelRoutingError) {
      const status = error.failure.code === "quota_exceeded" ? 429 : error.failure.code === "context_changed" ? 409 : 503;
      return calendarResponse(request, { error: error.failure.code, retryAfterSeconds: error.failure.retryAfterSeconds, resetsAt: error.failure.resetsAt ?? null }, status);
    }
    if (error instanceof TravelProviderError) return calendarResponse(request, { error: error.code }, 503);
    return calendarResponse(request, { error: authenticated ? "provider_unavailable" : "unauthenticated" }, authenticated ? 503 : 401);
  }
}
