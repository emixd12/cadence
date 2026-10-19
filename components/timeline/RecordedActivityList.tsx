"use client";

import { Temporal } from "@js-temporal/polyfill";
import { Activity } from "lucide-react";
import type { RecordedActivityDayView } from "@cadence/core/services/recorded-activity-refresh";

import styles from "./day-progress-timeline.module.css";
import type { HevyTimelineState } from "@/lib/ui/connectors";

/**
 * Ticket 238. Recorded workouts from Hevy for the current day: when and how
 * long only. They are actual past activity, so they never appear as Calendar
 * markers, never create overlap cues, and never change an Occurrence.
 */
export function RecordedActivityList({ activity, timezone, label }: Readonly<{
  activity: HevyTimelineState | null | undefined;
  timezone: string;
  label: string;
}>) {
  const status = activity ? recordedActivityStatus(activity, timezone) : null;
  const items = activity?.day?.items ?? [];
  if (!activity || (!items.length && !status)) return null;
  return (
    <section className={styles.activity} aria-label={`Recorded activity · ${label}`} data-recorded-activity={activity.state}>
      <h3 className="font-bold text-muted-readable">Recorded activity · Hevy</h3>
      {status ? <p>{status}</p> : null}
      {items.length ? <ul>
        {items.map((item) => <li key={item.id}>
          <Activity size={14} aria-hidden="true" />
          <span>Workout</span>
          <span>{timeRange(item.startAt, item.endAt, timezone)}</span>
          <span>{workoutDuration(item.durationSeconds)}</span>
        </li>)}
      </ul> : null}
    </section>
  );
}

export function recordedActivityStatus(activity: HevyTimelineState, timezone: string): string | null {
  const day: RecordedActivityDayView | null = activity.day;
  if (activity.state === "ready" || activity.state === "empty") return activity.state === "empty" ? "No recorded workouts today." : null;
  if (activity.state === "incomplete") return `Hevy workouts may be incomplete.${day ? ` Last read ${clock(day.fetchedAt, timezone)}.` : ""}`;
  if (activity.state === "stale") return `Hevy workouts may be out of date.${day ? ` Last read ${clock(day.fetchedAt, timezone)}.` : ""}`;
  if (activity.state === "reconnect_required") return "Hevy needs a current API key in Settings.";
  if (activity.state === "error") return `Hevy workouts could not refresh: ${activity.error ?? "unavailable"}.${day ? ` Showing workouts read at ${clock(day.fetchedAt, timezone)}.` : ""}`;
  return null;
}

function clock(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
}

function timeRange(start: string, end: string, timezone: string): string {
  const from = clock(start, timezone);
  const to = clock(end, timezone);
  if (from !== to) return `${from}–${to}`;
  // A daylight-saving fall-back hour repeats clock times; name each zone offset.
  const zoned = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(timezone)
    .toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${zoned(start)}–${zoned(end)}`;
}

/** Display-only duration such as "1 hr 5 min" or "45 min". */
export function workoutDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}
