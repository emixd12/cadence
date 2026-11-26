import { resolveTimelineSourceEvidence } from "@cadence/core/services/timeline-source-evidence";
import type { TimelineSourceEvidence } from "@cadence/core/types/timeline";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { listSourceMatchesForOccurrences } from "@/lib/db/sourceMatches.repo";
import { connectorCompletionEnabled } from "@/lib/services/connector-completion.service";

/** The two Occurrence fields the evidence rule reads. */
export type SourceEvidenceOccurrence = Readonly<{ id: string; status: string }>;

/**
 * Tickets 317 and 322: connector labels and attached workout times for the rows in
 * view. Read only while `CADENCE_CONNECTOR_COMPLETION` is on, so the Timeline's reads
 * are unchanged while the feature is off. A failed read shows no labels.
 *
 * The web Timeline and the MCP `show_day` projection (Ticket 376) share this reader, so
 * both say "from a connected service" by the same rule.
 */
export async function readTimelineSourceEvidence(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: readonly SourceEvidenceOccurrence[],
  timezone: string,
): Promise<Record<string, TimelineSourceEvidence>> {
  if (!connectorCompletionEnabled() || occurrences.length === 0) return {};
  try {
    const ids = occurrences.map((occurrence) => occurrence.id);
    const completedIds = occurrences.filter((occurrence) => occurrence.status === "completed").map((occurrence) => occurrence.id);
    const [matches, events] = await Promise.all([
      listSourceMatchesForOccurrences(supabase, userId, ids),
      completedIds.length ? listOccurrenceStatusEventsByOccurrenceIds(supabase, userId, completedIds) : Promise.resolve([]),
    ]);
    const latestEvents = new Map<string, { statusSemantics: string; sourceCaptureMethod: string; reasonCode: string | null; recordedAt: string; createdAt: string; id: string }>();
    for (const event of events) {
      const previous = latestEvents.get(event.occurrence_id);
      const candidate = { statusSemantics: event.status_semantics, sourceCaptureMethod: event.source_capture_method, reasonCode: event.reason_code,
        recordedAt: event.recorded_at, createdAt: event.created_at, id: event.id };
      if (!previous || compareLatest(candidate, previous) > 0) latestEvents.set(event.occurrence_id, candidate);
    }
    return resolveTimelineSourceEvidence({
      timezone,
      occurrences,
      latestEvents,
      matches: matches.map((match) => ({ occurrenceId: match.occurrence_id, source: match.source, state: match.state,
        activityStartAt: match.activity_start_at, activityEndAt: match.activity_end_at })),
    });
  } catch {
    return {};
  }
}

function compareLatest(left: { recordedAt: string; createdAt: string; id: string }, right: { recordedAt: string; createdAt: string; id: string }): number {
  return Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
    || Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
