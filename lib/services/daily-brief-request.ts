import { authenticateCalendarRequest, calendarPreflight, calendarResponse, readCalendarRequestBody } from "./google-calendar-request";
import { CalendarConnectionError } from "./google-calendar-oauth";
import { AdvisorDayContextServiceError } from "./advisor-day-context.service";
import { DailyBriefStorageError } from "@/lib/db/daily-brief.repo";
import { DailyBriefError } from "./daily-brief-consumer";
import type { CalendarCaller } from "./google-calendar.service";

export const dailyBriefPreflight = calendarPreflight;
export const readDailyBriefRequestBody = readCalendarRequestBody;
export async function runDailyBriefRequest(request: Request, run: (caller: CalendarCaller) => Promise<unknown>) {
  try { return calendarResponse(request, await run(await authenticateCalendarRequest(request))); }
  catch (error) {
    const recognized = error instanceof DailyBriefError || error instanceof AdvisorDayContextServiceError || error instanceof CalendarConnectionError;
    const code = error instanceof DailyBriefStorageError
      ? error.code === "session" ? "unauthenticated" : error.code === "unavailable" ? "advisor_unavailable" : error.code
      : recognized ? error.code : "advisor_unavailable";
    const retryAfterSeconds = error instanceof DailyBriefError || error instanceof AdvisorDayContextServiceError ? error.retryAfterSeconds : undefined;
    const status = code === "unauthenticated" ? 401 : code === "access_denied" ? 403 : code === "invalid_request" ? 400 : code === "rate_limited" || code === "retry_exhausted" ? 429 : code === "not_configured" || code === "advisor_unavailable" ? 503 : 409;
    const recovery = error instanceof AdvisorDayContextServiceError ? error.recovery : null;
    return calendarResponse(request, { error: code, ...(recovery ? { recovery } : {}), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, status);
  }
}
