import type { ActivityMatchLink, SourceLinkSelectorKind } from "@cadence/core/resolvers/activity-match.resolver";
import type { RecordedActivitySourceV1_1 } from "@cadence/core/types/recorded-activity";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

// Ticket 314: source links are owner rows under RLS. The database trigger binds
// each link to the source's connected account digest and refuses a routine that
// another enabled link already holds (invariant 11). Database errors map to codes.
const LINK_COLUMNS = "id,user_id,behavior_id,source,selector_kind,selector_keys,account_digest,enabled,created_at,updated_at";

export type SourceLinkRow = {
  id: string;
  user_id: string;
  behavior_id: string;
  source: string;
  selector_kind: string;
  selector_keys: string[];
  account_digest: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type SourceLinkWriteError =
  | "source_not_connected"
  | "selector_already_linked"
  | "any_link_exists"
  | "invalid_selector"
  | "write_failed";

export class SourceLinkRepositoryError extends Error {
  constructor(public readonly code: SourceLinkWriteError) {
    super(code);
    this.name = "SourceLinkRepositoryError";
  }
}

export function toActivityMatchLink(row: SourceLinkRow): ActivityMatchLink {
  return {
    id: row.id,
    behaviorId: row.behavior_id,
    source: row.source as RecordedActivitySourceV1_1,
    selectorKind: row.selector_kind as SourceLinkSelectorKind,
    selectorKeys: row.selector_keys,
    accountDigest: row.account_digest,
    enabled: row.enabled,
  };
}

export async function listSourceLinks(
  supabase: AppSupabaseClient,
  userId: string,
  source: RecordedActivitySourceV1_1,
): Promise<SourceLinkRow[]> {
  const { data, error } = await supabase
    .from("behavior_source_links")
    .select(LINK_COLUMNS)
    .eq("user_id", userId)
    .eq("source", source)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new SourceLinkRepositoryError("write_failed");
  return (data ?? []) as SourceLinkRow[];
}

export async function upsertSourceLink(
  supabase: AppSupabaseClient,
  input: Readonly<{
    userId: string;
    behaviorId: string;
    source: RecordedActivitySourceV1_1;
    selectorKind: SourceLinkSelectorKind;
    selectorKeys: readonly string[];
    enabled: boolean;
  }>,
): Promise<SourceLinkRow> {
  const existing = await supabase
    .from("behavior_source_links")
    .select(LINK_COLUMNS)
    .eq("user_id", input.userId)
    .eq("behavior_id", input.behaviorId)
    .eq("source", input.source)
    .maybeSingle();
  if (existing.error) throw new SourceLinkRepositoryError("write_failed");
  const values = {
    selector_kind: input.selectorKind,
    selector_keys: [...input.selectorKeys],
    enabled: input.enabled,
  };
  const result = existing.data
    ? await supabase.from("behavior_source_links").update(values)
      .eq("user_id", input.userId).eq("id", (existing.data as SourceLinkRow).id).select(LINK_COLUMNS).single()
    : await supabase.from("behavior_source_links").insert({ ...values, behavior_id: input.behaviorId, source: input.source })
      .select(LINK_COLUMNS).single();
  if (result.error) throw new SourceLinkRepositoryError(mapLinkError(result.error));
  return result.data as SourceLinkRow;
}

export async function deleteSourceLink(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorId: string,
  source: RecordedActivitySourceV1_1,
): Promise<void> {
  const { error } = await supabase
    .from("behavior_source_links")
    .delete()
    .eq("user_id", userId)
    .eq("behavior_id", behaviorId)
    .eq("source", source);
  if (error) throw new SourceLinkRepositoryError("write_failed");
}

function mapLinkError(error: { code?: string; message?: string }): SourceLinkWriteError {
  const message = error.message ?? "";
  if (message.includes("source_not_connected")) return "source_not_connected";
  if (message.includes("selector_already_linked")) return "selector_already_linked";
  if (error.code === "23505") return "any_link_exists";
  if (error.code === "23514") return "invalid_selector";
  return "write_failed";
}
