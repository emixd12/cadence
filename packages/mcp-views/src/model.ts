/**
 * The day view's logic, free of any UI framework. It computes nothing about tracking:
 * it arranges what `show_day` returned and sends each write with the precondition the
 * displayed row carries (docs/qa/2026-11-26-mcp-apps-spike.md, "View contract").
 */
import {
  GRANTED_SCOPES_META_KEY,
  OCCURRENCES_WRITE_SCOPE,
  type Bridge,
  type Day,
  type DayOccurrence,
  type DayParentGroup,
  type OccurrenceStatus,
  type ResolvedStatus,
  type ToolErrorBody,
  type ToolResult,
} from "./contract";
import { STATUS_LABELS, type DayViewNoticeId } from "./strings";

export type ViewNotice = Readonly<{ id: DayViewNoticeId; seconds?: number }>;

export type ViewState = Readonly<{
  phase: "loading" | "ready" | "unavailable";
  day: Day | null;
  /** null: the host passed no `_meta`, so the view shows controls and relies on the error. */
  canWrite: boolean | null;
  notice: ViewNotice | null;
  /** The Occurrence whose note save was refused by a conflict. Its saved note shows above the editor. */
  noteConflictFor: string | null;
}>;

export const INITIAL_STATE: ViewState = { phase: "loading", day: null, canWrite: null, notice: null, noteConflictFor: null };

export type Row =
  | Readonly<{ kind: "occurrence"; at: string; occurrence: DayOccurrence }>
  | Readonly<{ kind: "group"; at: string; group: DayParentGroup; children: readonly DayOccurrence[] }>;

/**
 * Top-level rows: the parent slots, plus each Occurrence that belongs to no slot, in the
 * contract's order. A sub-behavior Occurrence renders once, inside its slot.
 */
export function rows(day: Day): Row[] {
  const byId = new Map(day.occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const grouped = new Set(day.parent_groups.flatMap((group) => group.occurrence_ids));
  const list: Row[] = [
    ...day.parent_groups.map((group): Row => ({
      kind: "group",
      at: group.slot_key,
      group,
      children: group.occurrence_ids.flatMap((id) => byId.get(id) ?? []),
    })),
    ...day.occurrences
      .filter((occurrence) => !grouped.has(occurrence.id))
      .map((occurrence): Row => ({ kind: "occurrence", at: occurrence.effective_start_at, occurrence })),
  ];
  // Both values are server instants. Groups come first on a tie.
  return list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === b.kind ? 0 : a.kind === "group" ? -1 : 1));
}

export function groupKey(group: DayParentGroup): string {
  return `${group.parent_behavior_id}/${group.slot_key}`;
}

function isDay(value: unknown): value is Day {
  const day = value as Partial<Day> | null | undefined;
  return Boolean(day) && typeof day!.local_date === "string" && Array.isArray(day!.occurrences)
    && Array.isArray(day!.parent_groups) && typeof day!.needs_decision?.count === "number";
}

function toolError(result: ToolResult): ToolErrorBody | null {
  if (!result.isError) return null;
  return (result.structuredContent?.error as ToolErrorBody | undefined) ?? {};
}

/** Takes a `show_day` result into the state. Returns null when the result holds no day. */
export function applyDayResult(state: ViewState, result: ToolResult): ViewState | null {
  if (toolError(result) || !isDay(result.structuredContent)) return null;
  const scopes = result._meta?.[GRANTED_SCOPES_META_KEY];
  return {
    ...state,
    phase: "ready",
    day: result.structuredContent,
    canWrite: Array.isArray(scopes) ? scopes.includes(OCCURRENCES_WRITE_SCOPE) : state.canWrite,
  };
}

/** The first result the host hands over. Without a day the view says it could not load. */
export function receiveDayResult(state: ViewState, result: ToolResult): ViewState {
  const next = applyDayResult(state, result);
  if (next) return next;
  if (toolError(result)?.code === "insufficient_scope") return { ...state, canWrite: false };
  return state.day ? state : { ...state, phase: "unavailable" };
}

export type Write =
  | Readonly<{ tool: "set_occurrence_status"; occurrence: DayOccurrence; status: OccurrenceStatus }>
  | Readonly<{ tool: "set_parent_occurrence_status"; group: DayParentGroup; children: readonly DayOccurrence[]; status: ResolvedStatus }>
  | Readonly<{ tool: "update_occurrence_note"; occurrence: DayOccurrence; note: string }>;

/** Clicking the status a row already has returns it to Unresolved. */
export function statusAfterClick(occurrence: DayOccurrence, clicked: ResolvedStatus): OccurrenceStatus {
  return occurrence.status === clicked ? "unresolved" : clicked;
}

/** Each write's arguments, with the precondition read from the displayed row. */
export function writeArguments(write: Write): Record<string, unknown> {
  if (write.tool === "set_occurrence_status") {
    return { occurrence_id: write.occurrence.id, status: write.status, expected_status: write.occurrence.status };
  }
  if (write.tool === "set_parent_occurrence_status") {
    return {
      parent_behavior_id: write.group.parent_behavior_id,
      status: write.status,
      occurrence_ids: [...write.group.occurrence_ids],
      expected_statuses: write.children.map((child) => ({ occurrence_id: child.id, status: child.status })),
    };
  }
  return { occurrence_id: write.occurrence.id, note: write.note, expected_revision: write.occurrence.revision };
}

/**
 * The one line the model receives after a successful write. It names the Behavior and
 * the new status, or says a note was saved. It never holds note text.
 */
export function modelContextLine(write: Write): string {
  if (write.tool === "set_occurrence_status") {
    return `${write.occurrence.behavior_title}: ${STATUS_LABELS[write.status]} (set by the person in the Cadence day view)`;
  }
  if (write.tool === "set_parent_occurrence_status") {
    return `${write.group.title}: ${STATUS_LABELS[write.status]} for every step (set by the person in the Cadence day view)`;
  }
  return `${write.occurrence.behavior_title}: note saved (by the person in the Cadence day view)`;
}

export type WriteOutcome = "saved" | "conflict" | "rate_limited" | "reconnect" | "not_saved";
export type WriteResult = Readonly<{ state: ViewState; outcome: WriteOutcome; retryAfterSeconds?: number }>;

/** Errors after which the same call can never succeed, so its idempotency key is dropped. */
const FINAL_ERRORS = new Set(["conflict", "not_found", "invalid_state", "invalid_input", "idempotency_key_reused"]);
const DEFAULT_RETRY_AFTER_SECONDS = 60;

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `view-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Re-reads the displayed day. Returns null when the read failed. */
async function readDay(bridge: Bridge, state: ViewState): Promise<ViewState | null> {
  try {
    return applyDayResult(state, await bridge.callTool("show_day", state.day ? { date: state.day.local_date } : {}));
  } catch {
    return null;
  }
}

export type Writer = (bridge: Bridge, state: ViewState, write: Write) => Promise<WriteResult>;

/**
 * Builds the function that sends writes. It keeps one idempotency key per pending
 * action and reuses a key only to retry the same tool with the same arguments.
 */
export function createWriter(newKey: () => string = randomKey): Writer {
  const pendingKeys = new Map<string, string>();

  return async function performWrite(bridge, state, write) {
    const args = writeArguments(write);
    const signature = JSON.stringify([write.tool, args]);
    const key = pendingKeys.get(signature) ?? newKey();
    pendingKeys.set(signature, key);
    const isNote = write.tool === "update_occurrence_note";
    const cleared: ViewState = { ...state, notice: null, noteConflictFor: null };

    let result: ToolResult;
    try {
      result = await bridge.callTool(write.tool, { ...args, idempotency_key: key });
    } catch {
      // The host rejected the call. A host built on the MCP SDK does this on the 403
      // step-up challenge, and a denied approval may arrive the same way. Read the day
      // again and let its scopes decide; the key stays for an identical retry.
      const reread = await readDay(bridge, cleared);
      if (reread?.canWrite === false) return { state: reread, outcome: "reconnect" };
      return { state: { ...(reread ?? cleared), notice: { id: "day-view.not-saved" } }, outcome: "not_saved" };
    }

    const error = toolError(result);
    if (error?.code === "insufficient_scope") {
      return { state: { ...cleared, canWrite: false }, outcome: "reconnect" };
    }
    if (error?.code === "rate_limited") {
      const seconds = typeof error.retry_after_seconds === "number" ? Math.max(1, Math.ceil(error.retry_after_seconds)) : DEFAULT_RETRY_AFTER_SECONDS;
      return { state: { ...cleared, notice: { id: "day-view.rate-limited", seconds } }, outcome: "rate_limited", retryAfterSeconds: seconds };
    }
    if (error) {
      if (!error.code || !FINAL_ERRORS.has(error.code)) {
        return { state: { ...cleared, notice: { id: "day-view.not-saved" } }, outcome: "not_saved" };
      }
      pendingKeys.delete(signature);
      const reread = (await readDay(bridge, cleared)) ?? cleared;
      if (error.code !== "conflict") return { state: { ...reread, notice: { id: "day-view.not-saved" } }, outcome: "not_saved" };
      // Never send the write again without a new click. A refused note save keeps the
      // person's draft open beside the note that is saved now.
      return {
        state: { ...reread, notice: { id: "day-view.conflict" }, noteConflictFor: isNote ? write.occurrence.id : null },
        outcome: "conflict",
      };
    }

    pendingKeys.delete(signature);
    await bridge.updateModelContext(modelContextLine(write)).catch(() => undefined);
    const reread = await readDay(bridge, cleared);
    if (!reread) return { state: { ...cleared, notice: { id: "day-view.reload-failed" } }, outcome: "saved" };
    return { state: reread, outcome: "saved" };
  };
}
