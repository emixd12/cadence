import type { BehaviorPlanningFacts } from "@/lib/services/brief-move-day.service";

/**
 * Ticket 359 (D33): what Chat's reads add for planning while `CADENCE_ALONGSIDE` is on.
 * Each Occurrence and Behavior in a timeline or Behavior read gets one `planning` object:
 *
 *   planning: {
 *     alongside: boolean,                                  // the effective value
 *     alongside_source: "person" | "guess" | "default",    // the person's answer, the model's guess, or neither
 *     where: "home" | "anywhere" | "elsewhere" | "place" | "unknown",
 *     where_source: "person" | "evidence" | "guess" | "none",
 *   }
 *
 * Chat adds it after the MCP operation ran and validated, so the MCP contract (which
 * carries only the person's `alongside` answer) is unchanged. A place's key, name, label
 * or coordinates never appear: `where` is the kind only. With the flag off nothing is
 * added and every result is exactly the MCP result.
 */

export const CHAT_PLANNING_READS: ReadonlySet<string> = new Set(["get_timeline", "list_occurrences", "get_occurrence", "list_behaviors", "get_behavior"]);

export type ChatPlanning = Readonly<{
  alongside: boolean;
  alongside_source: BehaviorPlanningFacts["alongside"]["source"];
  where: BehaviorPlanningFacts["where"]["kind"];
  where_source: BehaviorPlanningFacts["where"]["source"];
}>;

type PlanningFactsLike = Readonly<{
  alongside: Readonly<{ value: boolean; source: ChatPlanning["alongside_source"] }>;
  where: Readonly<{ kind: ChatPlanning["where"]; source: ChatPlanning["where_source"] }>;
}>;

export function chatPlanning(facts: PlanningFactsLike): ChatPlanning {
  return { alongside: facts.alongside.value, alongside_source: facts.alongside.source, where: facts.where.kind, where_source: facts.where.source };
}

type Found = Readonly<{ behaviorId: string; record: Record<string, unknown> }>;

/** The Behavior an output object describes: an Occurrence (by `behavior_id`) or a Behavior (by `id`). */
function describedBehavior(record: Record<string, unknown>): string | null {
  if (typeof record.behavior_id === "string" && typeof record.local_date === "string" && "status" in record) return record.behavior_id;
  if (typeof record.id === "string" && "is_opportunity" in record && Array.isArray(record.schedules)) return record.id;
  return null;
}

function walk(value: unknown, found: Found[]): void {
  if (Array.isArray(value)) { for (const item of value) walk(item, found); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const behaviorId = describedBehavior(record);
  if (behaviorId) found.push({ behaviorId, record });
  for (const child of Object.values(record)) walk(child, found);
}

/** Behavior ids the result describes, for one planning read. */
export function chatPlanningBehaviorIds(value: unknown): string[] {
  const found: Found[] = [];
  walk(value, found);
  return [...new Set(found.map((item) => item.behaviorId))];
}

/** A copy of `value` with `planning` on every Occurrence and Behavior that has facts. */
export function withChatPlanning(value: unknown, facts: ReadonlyMap<string, PlanningFactsLike>): unknown {
  if (!facts.size) return value;
  const copy = structuredClone(value);
  const found: Found[] = [];
  walk(copy, found);
  for (const item of found) {
    const known = facts.get(item.behaviorId);
    if (known) item.record.planning = chatPlanning(known);
  }
  return copy;
}
