import type { BriefingContextProjection } from "../types/briefing-config";
import type { DailyBriefing } from "../types/daily-brief";

/** Lane label for the deterministic duration nudge; not an analysis lane. */
export const BRIEFING_SETUP_DURATION_LANE = "setup-duration" as const;

/**
 * Recipe 1.2 Setup tip (owner review, October 23). When no other tip is shown, nudge
 * the user to add a typical length for the first of today's unresolved Behaviors that
 * still has none after any estimate. Cadence writes the text; no model is involved.
 */
export function briefingSetupTip({ facts, contextControls }: BriefingContextProjection): NonNullable<DailyBriefing["tip"]> | null {
  // Projection already selects unresolved, in-scope Behaviors and the final duration source.
  // An intentionally disabled input is not missing data that the user needs to supply.
  const unavailable = new Set(contextControls.duration.selections
    .filter((selection) => selection.source === null && selection.reason !== "disabled")
    .map((selection) => selection.behaviorRef));
  const missing = facts.cadence.occurrences
    .filter((occurrence) => occurrence.localDate === facts.localDate && unavailable.has(occurrence.behaviorRef) && occurrence.duration?.kind !== "known")
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
