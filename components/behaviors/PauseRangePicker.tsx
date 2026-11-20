"use client";

import { useId, useState } from "react";

import {
  addDays,
  formatLongDay,
  parseLocalDate,
  pauseRangeSummary,
} from "@/lib/ui/behavior-run";

/**
 * One range picker for a pause (Ended and Paused plan, answers 2A and 3A): the first
 * paused day, then the back-on day, the day the Behavior comes back by itself. Days
 * before today can't be picked. The first paused day starts as today, so a pause from
 * now takes one tap; tapping a day on or before the first paused day, or tapping again
 * after both are set, starts a new range there. Controlled, so the web and the Mac
 * share it.
 */

export type PauseRange = Readonly<{ fromOn: string; backOn: string | null }>;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"] as const;
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export function nextPauseRange(current: PauseRange, picked: string, todayLocalDate: string): PauseRange {
  if (picked < todayLocalDate) return current;
  if (current.backOn === null && picked > current.fromOn) return { fromOn: current.fromOn, backOn: picked };
  return { fromOn: picked, backOn: null };
}

export function PauseRangePicker({
  value,
  todayLocalDate,
  onChange,
  label = "Pause",
}: Readonly<{
  value: PauseRange;
  todayLocalDate: string;
  onChange: (next: PauseRange) => void;
  label?: string;
}>) {
  const labelId = useId();
  const summaryId = useId();
  const initial = parseLocalDate(value.fromOn) ?? parseLocalDate(todayLocalDate) ?? { year: 2026, month: 1, day: 1 };
  const [shown, setShown] = useState({ year: initial.year, month: initial.month });
  const today = parseLocalDate(todayLocalDate);
  const canGoBack = today ? shown.year > today.year || (shown.year === today.year && shown.month > today.month) : true;

  const first = `${shown.year}-${String(shown.month).padStart(2, "0")}-01`;
  const leading = new Date(Date.UTC(shown.year, shown.month - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(shown.year, shown.month, 0)).getUTCDate();
  const days = Array.from({ length }, (_, index) => addDays(first, index));

  function step(delta: number) {
    setShown((current) => {
      const month = current.month + delta;
      if (month < 1) return { year: current.year - 1, month: 12 };
      if (month > 12) return { year: current.year + 1, month: 1 };
      return { year: current.year, month };
    });
  }

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={summaryId} className="grid w-full max-w-xs gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId}>{label}</span>
        <span className="flex items-center gap-3">
          <button type="button" className="product-action product-action-secondary min-h-11 px-1"
            aria-label="Previous month" disabled={!canGoBack} onClick={() => step(-1)}>‹</button>
          <span aria-live="polite">{MONTH_NAMES[shown.month - 1]} {shown.year}</span>
          <button type="button" className="product-action product-action-secondary min-h-11 px-1"
            aria-label="Next month" onClick={() => step(1)}>›</button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-muted-readable" aria-hidden="true">
        {WEEKDAY_INITIALS.map((initialLetter, index) => <span key={index}>{initialLetter}</span>)}
      </div>
      <div className="grid grid-cols-7 text-center">
        {Array.from({ length: leading }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
        {days.map((day) => {
          const past = day < todayLocalDate;
          const isFrom = day === value.fromOn;
          const isBack = day === value.backOn;
          const inRange = value.backOn !== null && day >= value.fromOn && day < value.backOn;
          const role = isFrom ? ", first paused day" : isBack ? ", back on" : inRange ? ", paused" : "";
          return (
            <button key={day} type="button" disabled={past}
              aria-label={`${formatLongDay(day)}${day === todayLocalDate ? ", today" : ""}${role}`}
              aria-pressed={isFrom || isBack || inRange}
              onClick={() => onChange(nextPauseRange(value, day, todayLocalDate))}
              className={[
                "min-h-10 text-sm tabular-nums disabled:cursor-default disabled:text-muted-readable disabled:opacity-50",
                inRange ? "bg-surface" : "",
                isFrom || isBack ? "font-bold underline underline-offset-4" : "",
                day === todayLocalDate && !isFrom ? "italic" : "",
              ].join(" ")}>
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
      <p id={summaryId} className="italic" aria-live="polite">{pauseRangeSummary(value, todayLocalDate)}</p>
    </div>
  );
}
