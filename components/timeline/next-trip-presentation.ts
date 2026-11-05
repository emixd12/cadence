/**
 * Ticket 270 (D2, "Next trip only"): how the Timeline marks the next trip. The owner compares
 * the six combinations on the design-system bench ("Travel timing states"). Production uses
 * `NEXT_TRIP_PRESENTATION`, so the owner's choice is a one-line change here.
 *
 * - `rail_label` (A): "Leave 1:15" in the left rail beside the axis, with a tick on the axis.
 * - `behavior_row` (B): a slim row among the Behaviors at the leave time.
 * - `axis_tick` (C): a tick on the axis only; the time is in the next-departure line.
 *
 * `line` sets the next-departure line's size: `status` is the small status size, `title` the
 * Behavior title size. Both stay regular weight.
 */
export type NextTripMarker = "rail_label" | "behavior_row" | "axis_tick";
export type NextDepartureLineSize = "status" | "title";
export type NextTripPresentation = Readonly<{ marker: NextTripMarker; line: NextDepartureLineSize }>;

/** Recommended on the bench; not yet chosen by the owner. */
export const NEXT_TRIP_PRESENTATION: NextTripPresentation = { marker: "rail_label", line: "status" };
