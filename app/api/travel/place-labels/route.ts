import { calendarPreflight, calendarResponse, authenticateCalendarRequest, readCalendarRequestBody } from "@/lib/services/google-calendar-request";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import {
  PlaceLabelError,
  deleteCompletionPlaceLabels,
  dismissWhereSuggestion,
  getCompletionCapturePlan,
  getPlaceLabelState,
  recordCompletionPlaceLabel,
  recordPlaceMarker,
  removePlaceMarkers,
  savePlaceLabelSettings,
} from "@/lib/services/place-labels.service";

export const dynamic = "force-dynamic";
export const OPTIONS = calendarPreflight;

/** Ticket 216. `?occurrence=` returns the capture plan for a completion this browser just marked. */
export function GET(request: Request) {
  const occurrence = new URL(request.url).searchParams.get("occurrence");
  return run(request, (caller) => occurrence === null ? getPlaceLabelState(caller) : getCompletionCapturePlan(caller, occurrence));
}

export function PUT(request: Request) {
  return run(request, async (caller) => savePlaceLabelSettings(caller, await readCalendarRequestBody(request)));
}

export function POST(request: Request) {
  return run(request, async (caller) => {
    const body = await readCalendarRequestBody(request);
    const { action, ...rest } = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : { action: null };
    switch (action) {
      case "record_marker": return recordPlaceMarker(caller, rest);
      case "remove_markers": return removePlaceMarkers(caller, Object.keys(rest).length === 1 ? rest.ref : undefined);
      case "delete_labels": return deleteCompletionPlaceLabels(caller);
      case "dismiss_suggestion": return dismissWhereSuggestion(caller, rest);
      case "record_label": return recordCompletionPlaceLabel(caller, rest).then(() => ({ recorded: true }));
      default: throw new PlaceLabelError("invalid_request", "The place label request is invalid.");
    }
  });
}

async function run(request: Request, operation: (caller: CalendarCaller) => Promise<unknown>) {
  try { return calendarResponse(request, await operation(await authenticateCalendarRequest(request))); }
  catch (error) {
    const code = error instanceof CalendarConnectionError || error instanceof PlaceLabelError ? error.code : "unavailable";
    const status = code === "unauthenticated" ? 401
      : code === "invalid_request" ? 400 : code === "conflict" ? 409 : code === "off" || code === "not_eligible" ? 422 : 503;
    return calendarResponse(request, { error: code }, status);
  }
}
