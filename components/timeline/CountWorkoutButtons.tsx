"use client";

import { useState } from "react";
import { useRefresh } from "@cadence/ui/runtime";
import type { CountableSourceWorkout } from "@cadence/core/services/timeline-source-evidence";

/**
 * Ticket 324: "Count the 6:05 PM Hevy workout" on today's Unresolved row when no link
 * accepted that workout. The server checks the workout, records the user's own
 * Completed mark and attaches the workout for timing.
 */
export function CountWorkoutButtons({ occurrenceId, source, workouts }: Readonly<{
  occurrenceId: string;
  source: string;
  workouts: readonly CountableSourceWorkout[];
}>) {
  const refresh = useRefresh();
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (workouts.length === 0) return null;

  async function count(workout: CountableSourceWorkout) {
    setBusyRef(workout.activityRef);
    setMessage(null);
    try {
      const response = await fetch("/api/connectors/completions/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurrenceId, source, activityRef: workout.activityRef }),
      });
      const result = (await response.json().catch(() => null)) as { counted?: boolean; attached?: boolean; reason?: string; error?: string } | null;
      if (!response.ok || !result?.counted) {
        setMessage(countRefusalMessage(result?.reason ?? result?.error ?? null));
        return;
      }
      // Marked, but the workout time was not saved: keep the button so a retry attaches it.
      if (!result.attached) {
        setMessage("Marked Completed. The workout time was not saved. Try again.");
        return;
      }
      refresh();
    } catch {
      setMessage(countRefusalMessage(null));
    } finally {
      setBusyRef(null);
    }
  }

  return (
    <div className="grid gap-1" data-count-workouts={source}>
      {workouts.map((workout) => <button
        key={workout.activityRef}
        type="button"
        className="min-h-11 justify-self-start text-left text-sm font-bold text-foreground underline"
        disabled={busyRef !== null}
        onClick={() => void count(workout)}
      >
        {busyRef === workout.activityRef ? "Counting…" : workout.label}
      </button>)}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

export function countRefusalMessage(reason: string | null): string {
  switch (reason) {
    case "matched_by_link":
    case "linked":
      return "A link already uses this workout.";
    case "not_unresolved":
      return "This was already marked.";
    case "activity_unavailable":
      return "Hevy no longer lists this workout.";
    case "below_minimum":
      return "This workout is shorter than 5 minutes.";
    case "not_connected":
      return "Hevy is not connected.";
    default:
      return "The workout could not be counted. Try again.";
  }
}
