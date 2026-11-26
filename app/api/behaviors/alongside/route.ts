import { calendarPreflight, runCalendarRequest } from "@/lib/services/google-calendar-request";
import { readAlongsideGuesses } from "@/lib/services/alongside-view.service";

export const dynamic = "force-dynamic";

/**
 * Ticket 363 (D33): the account's current alongside and Where model guesses for a linked
 * Cadence for Mac (ALONGSIDE_GUESSES_ROUTE). GET only; web session or Mac Bearer, the same
 * origins as the brief routes. `{ enabled: false, guesses: [] }` while CADENCE_ALONGSIDE is off.
 */
export function GET(request: Request) {
  return runCalendarRequest(request, (caller) => readAlongsideGuesses(caller.client, caller.user.id));
}
export const OPTIONS = calendarPreflight;
