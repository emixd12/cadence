import { BEHAVIOR_WHERE_KINDS, type BehaviorWhereKind } from "../types/behavior";
import { BehaviorValidationError } from "./behavior-values";
import { normalizeUserAuthoredLocation } from "./travel-settings";

export type StoredBehaviorWhere = Readonly<{
  where_kind: BehaviorWhereKind | null;
  location_text: string | null;
}>;

export function isBehaviorWhereKind(value: unknown): value is BehaviorWhereKind {
  return typeof value === "string" && (BEHAVIOR_WHERE_KINDS as readonly string[]).includes(value);
}

/**
 * Reads a stored Where. Rows and snapshots written before Ticket 215 carry only
 * location text, which always meant A place.
 */
export function storedBehaviorWhere(row: Readonly<{
  where_kind?: string | null;
  location_text?: string | null;
}>): StoredBehaviorWhere {
  const locationText = row.location_text?.trim() || null;
  if (row.where_kind === undefined) return { where_kind: locationText ? "place" : null, location_text: locationText };
  if (row.where_kind !== null && !isBehaviorWhereKind(row.where_kind)) {
    throw new Error("The stored Behavior Where is invalid.");
  }
  return { where_kind: row.where_kind, location_text: row.where_kind === "place" ? locationText : null };
}

/**
 * Plans the stored Where for a create or edit. A place always keeps its text;
 * Not set, Anywhere and Home keep none. Callers that predate Where (MCP tools,
 * imports) send only location text: text means A place, and clearing the text
 * of A place means Not set.
 */
export function planBehaviorWhere(
  input: Readonly<{ whereKind?: BehaviorWhereKind | null; locationText?: string | null }>,
  existing?: Readonly<{ where_kind?: string | null; location_text?: string | null }> | null,
): StoredBehaviorWhere {
  const current = existing ? storedBehaviorWhere(existing) : { where_kind: null, location_text: null };
  if (input.whereKind === undefined) {
    if (input.locationText === undefined) return current;
    const text = normalizeLocation(input.locationText);
    if (text) return { where_kind: "place", location_text: text };
    return { where_kind: current.where_kind === "place" ? null : current.where_kind, location_text: null };
  }
  if (input.whereKind !== null && !isBehaviorWhereKind(input.whereKind)) {
    throw new BehaviorValidationError("Check the highlighted fields.", { where_kind: "Choose where this happens." });
  }
  if (input.whereKind !== "place") return { where_kind: input.whereKind, location_text: null };
  const text = normalizeLocation(input.locationText);
  if (!text) throw new BehaviorValidationError("Check the highlighted fields.", { location_text: "Enter the place." });
  return { where_kind: "place", location_text: text };
}

function normalizeLocation(value: string | null | undefined): string | null {
  try { return normalizeUserAuthoredLocation(value); }
  catch {
    throw new BehaviorValidationError("Check the highlighted fields.", {
      location_text: "Keep the place to 500 characters and remove control characters.",
    });
  }
}
