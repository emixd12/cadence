/**
 * The part of the frozen `show_day` contract the day view reads
 * (docs/qa/2026-11-26-mcp-apps-spike.md, "Frozen `show_day` contract").
 * The view ignores every field it does not name here.
 */

export const DAY_VIEW_RESOURCE_URI = "ui://cadence/day/v1.html";
export const GRANTED_SCOPES_META_KEY = "com.cadence-me/granted_scopes";
export const OCCURRENCES_WRITE_SCOPE = "cadence.occurrences.write";

export type OccurrenceStatus = "unresolved" | "completed" | "not_completed";
export type ResolvedStatus = Exclude<OccurrenceStatus, "unresolved">;

export type DayOccurrence = Readonly<{
  id: string;
  behavior_title: string;
  timezone: string;
  effective_start_at: string;
  move: Readonly<{ planned_start_at: string; start_at: string; end_at: string }> | null;
  schedule: Readonly<{ label: string }>;
  status: OccurrenceStatus;
  status_label: string;
  origin: "scheduled" | "opportunity";
  added_by: "user" | "daily_brief" | "chat" | "mcp" | null;
  note: string | null;
  revision: string;
  /** Present only in the alongside contract edition. The view shows "Alongside" only for `true`. */
  alongside?: boolean | null;
  connector_completion: Readonly<{ source: string; source_label: string }> | null;
}>;

export type DayParentGroup = Readonly<{
  parent_behavior_id: string;
  title: string;
  slot_key: string;
  scheduled_time_label: string;
  derived_status: OccurrenceStatus | "partial";
  progress_label: string;
  occurrence_ids: readonly string[];
}>;

export type Day = Readonly<{
  local_date: string;
  is_today: boolean;
  timezone: string;
  day_note: string | null;
  occurrences: readonly DayOccurrence[];
  parent_groups: readonly DayParentGroup[];
  needs_decision: Readonly<{ count: number; truncated: boolean }>;
}>;

/** A tool result as the host hands it to the view. */
export type ToolResult = Readonly<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}>;

export type ToolErrorBody = Readonly<{ code?: string; retry_after_seconds?: number | null }>;

/** The four server tools the view calls. Nothing else. */
export type ViewToolName = "show_day" | "set_occurrence_status" | "set_parent_occurrence_status" | "update_occurrence_note";

/** What the view needs from its host. `@modelcontextprotocol/ext-apps` implements it in `bridge.ts`. */
export interface Bridge {
  callTool(name: ViewToolName, args: Record<string, unknown>): Promise<ToolResult>;
  updateModelContext(text: string): Promise<void>;
}

export type HostTheme = "light" | "dark";
