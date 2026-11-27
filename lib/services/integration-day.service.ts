import { INTEGRATION_LIMITS as L, type IntegrationOperationOutput } from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { getIntegrationTimeline, IntegrationReadError } from "./integration-read.service";
import { readTimelineSourceEvidence } from "./timeline-source-evidence.service";

type TimelineOutput = IntegrationOperationOutput<"get_timeline">;
type TimelineDayOutput = TimelineOutput["days"][number];

/** One day as the MCP `show_day` transport tool returns it (Ticket 376, D36). */
export type IntegrationDay = {
  local_date: string;
  is_today: boolean;
  timezone: string;
  today_local_date: string;
  day_note: string | null;
  occurrences: Array<TimelineDayOutput["occurrences"][number] & {
    /** Set only while the Occurrence is Completed and its latest status event is a connector's. */
    connector_completion: { source: string; source_label: string } | null;
  }>;
  parent_groups: NonNullable<TimelineDayOutput["parent_groups"]>;
  /** A count, never a list. `truncated` means more exist than the count states. */
  needs_decision: { count: number; truncated: boolean };
  freshness: TimelineOutput["freshness"];
};

/**
 * Ticket 376: a one-day adapter over `getIntegrationTimeline`. It adds no rule of its
 * own: the day, its parent groups and the Needs decision count come from the Timeline
 * read, and the connector label from the reader the web Timeline uses. It copies named
 * fields only, so a field a later contract adds to a Timeline day (Periods, Ticket 370)
 * stays out until this projection names it.
 */
export async function getIntegrationDay(context: IntegrationContext, input: { date?: string }): Promise<IntegrationDay> {
  const oneDay = { ...(input.date === undefined ? {} : { start_local_date: input.date }), days: 1 };
  let truncated = false;
  let timeline: TimelineOutput;
  try {
    timeline = await getIntegrationTimeline(context, oneDay);
  } catch (error) {
    // get_timeline refuses a Needs decision group above its item cap. The day still shows, with the cap as the count.
    if (!(error instanceof IntegrationReadError) || error.error.code !== "limit_exceeded") throw error;
    truncated = true;
    timeline = await getIntegrationTimeline(context, { ...oneDay, include_needs_decision: false });
  }
  const day = timeline.days[0];
  if (!day) throw new IntegrationReadError("service_unavailable", "Tracking data changed during this read. Retry the request.");
  const evidence = await readTimelineSourceEvidence(context.supabase, context.userId, day.occurrences, timeline.timezone);
  return {
    local_date: day.local_date, is_today: day.is_today, timezone: timeline.timezone, today_local_date: timeline.today_local_date,
    day_note: day.day_note ?? null,
    occurrences: day.occurrences.map((occurrence) => {
      const found = evidence[occurrence.id];
      // `fromConnector` is the resolver's rule: Completed, and the latest status event is the connector's.
      return { ...occurrence, connector_completion: found?.fromConnector ? { source: found.source, source_label: found.sourceLabel } : null };
    }),
    parent_groups: day.parent_groups ?? [],
    needs_decision: { count: truncated ? L.maxNeedsDecisionItems : timeline.needs_decision?.total_count ?? 0, truncated },
    freshness: timeline.freshness,
  };
}
