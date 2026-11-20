import type { BehaviorRunAction } from "@cadence/core/services/behavior.service";
import type { BehaviorView } from "@/lib/types/behavior";

/**
 * Display helpers for Ended and Paused Behaviors (docs/RECURRENCE_RULES.md, "Behavior
 * end and pause"). The run state itself is worked out in core
 * (`behaviorRunState`); these only turn stored local days and times into the short
 * text the Behaviors list, the Pause picker and the Timeline notices show.
 */

export type RunStateKind = "running" | "ended" | "paused" | "archived";

/** The run actions a Behavior's run form posts as `run_action`. */
export type BehaviorRunActionKind = "end_now" | "start_again" | "pause" | "resume";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** A view without a computed state (a view built without `now`) counts as running. */
export function runStateOf(behavior: Pick<BehaviorView, "active" | "runState">): RunStateKind {
  if (!behavior.active) return "archived";
  return behavior.runState ?? "running";
}

export function isNotRunning(behavior: Pick<BehaviorView, "active" | "runState">): boolean {
  const state = runStateOf(behavior);
  return state === "ended" || state === "paused";
}

/** Today's local date (`YYYY-MM-DD`) in a time zone. */
export function localDateIn(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }
}

type DateParts = Readonly<{ year: number; month: number; day: number }>;

export function parseLocalDate(localDate: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toLocalDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

export function addDays(localDate: string, days: number): string {
  const parts = parseLocalDate(localDate);
  if (!parts) return localDate;
  return toLocalDate(parts.year, parts.month, parts.day + days);
}

/** Days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** "Dec 8", or "Dec 8, 2027" when the year is not this year. */
export function formatRunDay(localDate: string, todayLocalDate: string): string {
  const parts = parseLocalDate(localDate);
  if (!parts) return localDate;
  const today = parseLocalDate(todayLocalDate);
  const label = `${MONTHS[parts.month - 1]} ${parts.day}`;
  return today && today.year === parts.year ? label : `${label}, ${parts.year}`;
}

/** "Monday, December 8, 2026", for screen readers. */
export function formatLongDay(localDate: string): string {
  const parts = parseLocalDate(localDate);
  if (!parts) return localDate;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${LONG_MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/** "2:00 PM" from `HH:MM` or `HH:MM:SS`. */
export function formatRunTime(time: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

function endLabel(behavior: Pick<BehaviorView, "endOn" | "endTime">, todayLocalDate: string): string | null {
  if (!behavior.endOn) return null;
  const day = formatRunDay(behavior.endOn, todayLocalDate);
  return behavior.endTime ? `${day}, ${formatRunTime(behavior.endTime)}` : day;
}

/**
 * Why a Not running row isn't running: "Ended Nov 30" or "Paused, back Dec 8".
 * Null for a running or archived Behavior.
 */
export function notRunningLabel(behavior: BehaviorView, todayLocalDate: string): string | null {
  const state = runStateOf(behavior);
  if (state === "ended") {
    const end = endLabel(behavior, todayLocalDate);
    return end ? `Ended ${end}` : "Ended";
  }
  if (state === "paused") {
    return behavior.pause ? `Paused, back ${formatRunDay(behavior.pause.backOn, todayLocalDate)}` : "Paused";
  }
  return null;
}

/**
 * The small grey note on a running row about an upcoming end or pause:
 * "Ends after Dec 31", "Paused from Dec 20, back Jan 3", or both.
 */
export function upcomingRunNote(behavior: BehaviorView, todayLocalDate: string): string | null {
  if (runStateOf(behavior) !== "running") return null;
  const notes: string[] = [];
  const end = endLabel(behavior, todayLocalDate);
  if (end) notes.push(`Ends after ${end}`);
  if (behavior.pause && behavior.pause.backOn > todayLocalDate) {
    notes.push(`Paused from ${formatRunDay(behavior.pause.fromOn, todayLocalDate)}, back ${formatRunDay(behavior.pause.backOn, todayLocalDate)}`);
  }
  return notes.length ? notes.join(" · ") : null;
}

/** The picker's summary line for a chosen range. */
export function pauseRangeSummary(range: Readonly<{ fromOn: string; backOn: string | null }>, todayLocalDate: string): string {
  const from = range.fromOn === todayLocalDate ? "today" : formatRunDay(range.fromOn, todayLocalDate);
  if (!range.backOn) return `Paused from ${from}. Pick the day it comes back.`;
  const days = daysBetween(range.fromOn, range.backOn);
  return `Paused from ${from}, back ${formatRunDay(range.backOn, todayLocalDate)} (${days} ${days === 1 ? "day" : "days"} off).`;
}

/** The italic outcome line after a run action (P-077). Shared by the web server action and the Mac local action. */
export function behaviorRunOutcomeMessage(title: string, action: BehaviorRunAction, todayLocalDate: string): string {
  if (action.kind === "end_now") return `${title} ended. Start again brings it back.`;
  if (action.kind === "start_again") return `${title} is running again.`;
  if (action.kind === "resume") return `${title} has no pause and runs as scheduled.`;
  const back = formatRunDay(action.pause.backOn, todayLocalDate);
  return action.pause.fromOn <= todayLocalDate
    ? `${title} is paused, back ${back}.`
    : `${title} pauses from ${formatRunDay(action.pause.fromOn, todayLocalDate)}, back ${back}.`;
}
