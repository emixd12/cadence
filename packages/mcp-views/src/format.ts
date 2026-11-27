// Display formatting only. Every value and the timezone come from the server; the view
// reads no clock and decides no date.
import type { Day, DayOccurrence } from "./contract";

const LOCALE = "en-US";

/** "Wednesday, November 25" from the server's `local_date` (YYYY-MM-DD), without parsing it as a Date string. */
export function dayLabel(day: Day): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.local_date);
  if (!match) return day.local_date;
  const [, year, month, date] = match;
  const noonUtc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), 12));
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(noonUtc);
}

/**
 * The time a row shows. A moved Occurrence shows where it sits today, formatted from the
 * server's instant in the server's timezone. Otherwise the server's own label is used.
 */
export function timeLabel(occurrence: DayOccurrence): string {
  if (!occurrence.move) return occurrence.schedule.label;
  try {
    return new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit", timeZone: occurrence.timezone })
      .format(new Date(occurrence.effective_start_at));
  } catch {
    return occurrence.schedule.label;
  }
}
