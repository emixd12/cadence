import { calendarPreflight, calendarResponse } from "@/lib/services/google-calendar-request";
import { clientSignInMethods } from "@/lib/services/desktop-sign-in.service";

export const dynamic = "force-dynamic";

// Ticket 336: Cadence for Mac reads the methods this deployment has on.
export function GET(request: Request) {
  return calendarResponse(request, clientSignInMethods());
}
export const OPTIONS = calendarPreflight;
