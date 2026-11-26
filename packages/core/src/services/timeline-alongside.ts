import type { AlongsideRowView } from "../resolvers/alongside.resolver";
import type { TimelineOccurrenceView, TimelineView } from "../types/timeline";
import { mapTimelineDaySectionOccurrences } from "../resolvers/timeline.resolver";

/**
 * Ticket 358 (D33): puts each alongside Behavior's row facts on its Occurrences. The
 * hosted Timeline calls this only while `CADENCE_ALONGSIDE` is on; with an empty map
 * the view is returned unchanged.
 */
export function attachTimelineAlongside<T extends TimelineView>(view: T, byBehaviorId: Readonly<Record<string, AlongsideRowView>>): T {
  if (Object.keys(byBehaviorId).length === 0) return view;
  const occurrence = (item: TimelineOccurrenceView): TimelineOccurrenceView =>
    byBehaviorId[item.behaviorId] ? { ...item, alongside: byBehaviorId[item.behaviorId] } : item;
  const section = (value: TimelineView["daySections"][number]) => mapTimelineDaySectionOccurrences(value, occurrence);
  return {
    ...view,
    daySections: view.daySections.map(section),
    needsDecision: { ...view.needsDecision, daySections: view.needsDecision.daySections.map(section) },
  };
}
