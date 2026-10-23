import type { AdvisorDayContextV1 } from "../types/advisor-day-context";
import type { DailyBriefing } from "../types/daily-brief";

/** Lane label for the deterministic duration nudge; not an analysis lane. */
export const BRIEFING_SETUP_DURATION_LANE = "setup-duration" as const;

/**
 * Recipe 1.2 Setup tip (owner review, October 23). When no other tip is shown, nudge
 * the user to add a typical length for the first of today's unresolved Behaviors that
 * still has none after any estimate. Cadence writes the text; no model is involved.
 */
export function briefingSetupTip(context: Pick<AdvisorDayContextV1, "cadence" | "localDate">): NonNullable<DailyBriefing["tip"]> | null {
  const missing = context.cadence.occurrences
    .filter((occurrence) => occurrence.status === "unresolved" && occurrence.localDate === context.localDate && occurrence.duration.kind === "unknown")
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor) || left.ref.localeCompare(right.ref))[0];
  if (!missing) return null;
  return {
    text: `Add a typical length to ${missing.title} so Cadence can suggest times around it.`,
    laneId: BRIEFING_SETUP_DURATION_LANE,
    basis: `${missing.title} has no default length, and there are too few tracked sessions to estimate one.`,
    limitation: null,
    category: "setup",
  };
}
