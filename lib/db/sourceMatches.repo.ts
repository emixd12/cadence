import type { ActivityMatchRecord, SourceMatchRole, SourceMatchState } from "@cadence/core/resolvers/activity-match.resolver";
import type { RecordedActivitySourceV1_1 } from "@cadence/core/types/recorded-activity";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readAllPostgrestRows } from "@/lib/db/paginated-read";

// Ticket 314: matches are written only by the three database functions below, as
// the caller under RLS. A failed precondition is a stable reason, not an error.
const MATCH_COLUMNS = "id,user_id,occurrence_id,behavior_id,link_id,source,activity_ref,activity_start_at,activity_end_at,activity_revision,scheduled_start_at,scheduled_end_at,role,state,applied_event_id,reverted_event_id,created_at,updated_at";

export type SourceMatchRow = {
  id: string;
  user_id: string;
  occurrence_id: string;
  behavior_id: string;
  link_id: string | null;
  source: string;
  activity_ref: string;
  activity_start_at: string;
  activity_end_at: string;
  activity_revision: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  role: string;
  state: string;
  applied_event_id: string | null;
  reverted_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ConnectorWriteResult = Readonly<{ ok: boolean; reason: string; statusEventId?: string; reverted?: boolean }>;

export function toActivityMatchRecord(row: SourceMatchRow): ActivityMatchRecord {
  return {
    id: row.id,
    occurrenceId: row.occurrence_id,
    behaviorId: row.behavior_id,
    linkId: row.link_id ?? "",
    activityRef: row.activity_ref,
    activityStartAt: row.activity_start_at,
    activityEndAt: row.activity_end_at,
    activityRevision: row.activity_revision,
    role: row.role as SourceMatchRole,
    state: row.state as SourceMatchState,
    appliedEventId: row.applied_event_id,
    revertedEventId: row.reverted_event_id,
  };
}

export async function listSourceMatchesForOccurrences(
  supabase: AppSupabaseClient,
  userId: string,
  occurrenceIds: readonly string[],
): Promise<SourceMatchRow[]> {
  if (occurrenceIds.length === 0) return [];
  const rows: SourceMatchRow[] = [];
  for (let index = 0; index < occurrenceIds.length; index += 200) {
    const chunk = occurrenceIds.slice(index, index + 200);
    rows.push(...await readAllPostgrestRows<SourceMatchRow>({
      label: "Occurrence source matches",
      getRowKey: (row) => row.id,
      createQuery: () => supabase
        .from("occurrence_source_matches")
        .select(MATCH_COLUMNS)
        .eq("user_id", userId)
        .in("occurrence_id", chunk)
        .order("id", { ascending: true }),
    }));
  }
  return rows;
}

export async function listSourceMatchesForActivities(
  supabase: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
  activityRefs: readonly string[],
): Promise<SourceMatchRow[]> {
  if (activityRefs.length === 0) return [];
  const rows: SourceMatchRow[] = [];
  for (let index = 0; index < activityRefs.length; index += 100) {
    const chunk = activityRefs.slice(index, index + 100);
    rows.push(...await readAllPostgrestRows<SourceMatchRow>({
      label: "Occurrence source matches",
      getRowKey: (row) => row.id,
      createQuery: () => supabase
        .from("occurrence_source_matches")
        .select(MATCH_COLUMNS)
        .eq("user_id", userId)
        .eq("source", source)
        .in("activity_ref", chunk)
        .order("id", { ascending: true }),
    }));
  }
  return rows;
}

export async function listAllSourceMatches(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<SourceMatchRow[]> {
  return readAllPostgrestRows<SourceMatchRow>({
    label: "Occurrence source matches",
    getRowKey: (row) => row.id,
    createQuery: () => supabase
      .from("occurrence_source_matches")
      .select(MATCH_COLUMNS)
      .eq("user_id", userId)
      .order("id", { ascending: true }),
  });
}

type ActivityArgs = Readonly<{
  linkId: string;
  occurrenceId: string;
  activityRef: string;
  activityStartAt: string;
  activityEndAt: string;
  activityRevision: string | null;
  recordedAt: string;
}>;

export async function applyConnectorCompletion(
  supabase: AppSupabaseClient,
  input: ActivityArgs & Readonly<{ expectedLatestEventId: string | null }>,
): Promise<ConnectorWriteResult> {
  const { data, error } = await supabase.rpc("apply_connector_completion", {
    p_link_id: input.linkId,
    p_occurrence_id: input.occurrenceId,
    p_activity_ref: input.activityRef,
    p_activity_start_at: input.activityStartAt,
    p_activity_end_at: input.activityEndAt,
    p_activity_revision: input.activityRevision,
    p_expected_latest_event_id: input.expectedLatestEventId,
    p_recorded_at: input.recordedAt,
  });
  if (error) throw new Error("connector_completion_failed");
  const result = data as { applied?: boolean; reason?: string; status_event_id?: string };
  return { ok: result.applied === true, reason: String(result.reason ?? "unknown"), statusEventId: result.status_event_id };
}

export async function attachSourceActivity(
  supabase: AppSupabaseClient,
  input: ActivityArgs,
): Promise<ConnectorWriteResult> {
  const { data, error } = await supabase.rpc("attach_source_activity", {
    p_link_id: input.linkId,
    p_occurrence_id: input.occurrenceId,
    p_activity_ref: input.activityRef,
    p_activity_start_at: input.activityStartAt,
    p_activity_end_at: input.activityEndAt,
    p_activity_revision: input.activityRevision,
    p_recorded_at: input.recordedAt,
  });
  if (error) throw new Error("connector_attach_failed");
  const result = data as { attached?: boolean; reason?: string };
  return { ok: result.attached === true, reason: String(result.reason ?? "unknown") };
}

export async function removeSourceMatch(
  supabase: AppSupabaseClient,
  input: Readonly<{ matchId: string; recordedAt: string }>,
): Promise<ConnectorWriteResult> {
  const { data, error } = await supabase.rpc("remove_source_match", {
    p_match_id: input.matchId,
    p_recorded_at: input.recordedAt,
  });
  if (error) throw new Error("connector_remove_failed");
  const result = data as { removed?: boolean; reverted?: boolean; reason?: string; status_event_id?: string };
  return { ok: result.removed === true, reverted: result.reverted === true, reason: String(result.reason ?? "unknown"), statusEventId: result.status_event_id };
}

/**
 * Ticket 322: the Completed Occurrences whose current status is a standing connector
 * completion the user has not changed. A user re-mark sets a new `status_marked_at`,
 * so the snapshot matches the connector event's `recorded_at` only while it stands.
 */
export async function listConnectorMarkedOccurrenceIds(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: readonly Readonly<{ id: string; status: string; statusMarkedAt?: string | null }>[],
): Promise<Set<string>> {
  const completed = occurrences.filter((occurrence) => occurrence.status === "completed" && occurrence.statusMarkedAt);
  const marked = new Set<string>();
  for (let index = 0; index < completed.length; index += 100) {
    const chunk = completed.slice(index, index + 100);
    const { data: matches, error } = await supabase
      .from("occurrence_source_matches")
      .select("occurrence_id,applied_event_id")
      .eq("user_id", userId)
      .eq("role", "completion")
      .is("reverted_event_id", null)
      .in("occurrence_id", chunk.map((occurrence) => occurrence.id));
    if (error) throw new Error("connector_marks_unavailable");
    const eventIds = (matches ?? []).flatMap((match) => match.applied_event_id ? [match.applied_event_id] : []);
    if (eventIds.length === 0) continue;
    const { data: events, error: eventError } = await supabase
      .from("occurrence_status_events")
      .select("id,occurrence_id,recorded_at")
      .eq("user_id", userId)
      .in("id", eventIds);
    if (eventError) throw new Error("connector_marks_unavailable");
    const byOccurrence = new Map(chunk.map((occurrence) => [occurrence.id, occurrence.statusMarkedAt!]));
    for (const event of events ?? []) {
      const markedAt = byOccurrence.get(event.occurrence_id);
      if (markedAt && Date.parse(markedAt) === Date.parse(event.recorded_at)) marked.add(event.occurrence_id);
    }
  }
  return marked;
}
