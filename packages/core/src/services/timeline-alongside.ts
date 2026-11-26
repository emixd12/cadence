import type { AlongsideRowView, PlanningPlaceCatalog } from "../resolvers/alongside.resolver";
import type { TimelineOccurrenceView, TimelineView } from "../types/timeline";
import { mapTimelineDaySectionOccurrences } from "../resolvers/timeline.resolver";

/**
 * Ticket 358 (D33): puts each alongside Behavior's row facts on its Occurrences. The
 * hosted Timeline calls this only while `CADENCE_ALONGSIDE` is on; with an empty map
 * (and no open questions) the view is returned unchanged.
 *
 * Ticket 384: `planningPlaces` (Home's and the saved places' keys) rides along only when
 * some row is alongside, the only rows whose overlap a Calendar event's place decides.
 */
export function attachTimelineAlongside<T extends TimelineView>(view: T, byBehaviorId: Readonly<Record<string, AlongsideRowView>>,
  /** Ticket 360: Behaviors whose alongside question is open; their rows may ask after a Completed mark. */
  questionBehaviorIds: ReadonlySet<string> = new Set(),
  planningPlaces: PlanningPlaceCatalog | null = null): T {
  if (Object.keys(byBehaviorId).length === 0 && questionBehaviorIds.size === 0) return view;
  const places = planningPlaces && Object.keys(byBehaviorId).length > 0 ? { planningPlaces } : {};
  const occurrence = (item: TimelineOccurrenceView): TimelineOccurrenceView => {
    const row = byBehaviorId[item.behaviorId];
    const ask = questionBehaviorIds.has(item.behaviorId);
    return row || ask ? { ...item, ...(row ? { alongside: row } : {}), ...(ask ? { alongsideQuestion: true as const } : {}) } : item;
  };
  const section = (value: TimelineView["daySections"][number]) => mapTimelineDaySectionOccurrences(value, occurrence);
  return {
    ...view,
    ...places,
    daySections: view.daySections.map(section),
    needsDecision: { ...view.needsDecision, daySections: view.needsDecision.daySections.map(section) },
  };
}
