import type {
  NoteShortcutContext,
  NoteShortcutState,
  NoteShortcutStore,
  NoteSource,
} from "@cadence/core/types/note-shortcut";
import { isDayNoteShortcutPool, validateNoteShortcutState } from "@cadence/core/resolvers/note-suggestion.resolver";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Json } from "@/lib/db/database.types";
import { readAllPostgrestRows } from "@/lib/db/paginated-read";

export function createNoteShortcutStore(
  supabase: AppSupabaseClient,
  userId: string,
): NoteShortcutStore {
  return {
    userId,
    readStates: () => readNoteShortcutStates(supabase, userId),
    readContext: (behaviorId) =>
      readNoteShortcutContext(supabase, userId, behaviorId),
    commit: (input) => commitNoteShortcutState(supabase, userId, input),
  };
}

export async function readNoteShortcutStates(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<NoteShortcutState[]> {
  const rows = await readAllPostgrestRows({
    label: "Note shortcut states",
    createQuery: () =>
      supabase
        .from("note_shortcut_states")
        .select("*")
        .eq("user_id", userId)
        .order("id", { ascending: true }),
    getRowKey: (row) => row.id,
    absoluteCeilingError:
      "Note shortcut states exceed Cadence's absolute read ceiling of 100,000 rows.",
  });

  return rows.map((row) => readState(row, userId));
}

export async function readNoteShortcutContext(
  supabase: AppSupabaseClient,
  userId: string,
  poolId: string | null,
): Promise<NoteShortcutContext> {
  if (isDayNoteShortcutPool(poolId)) {
    const { data, error } = await supabase.rpc("read_day_note_shortcut_context");
    if (error) throw error;
    return parseContext(data, userId, poolId);
  }
  const { data, error } = await supabase.rpc("read_note_shortcut_context", {
    target_behavior_id: poolId as unknown as string,
  });
  if (error) throw error;
  return parseContext(data, userId, poolId);
}

export async function commitNoteShortcutState(
  supabase: AppSupabaseClient,
  userId: string,
  input: {
    expected: NoteShortcutContext;
    next: NoteShortcutState;
    requireEnabled: boolean;
  },
): Promise<NoteShortcutState> {
  if (input.next.user_id !== userId) {
    throw new Error("Shortcut state belongs to another owner.");
  }
  validateNoteShortcutState(input.next);
  const { data, error } = await supabase.rpc("commit_note_shortcut_state", {
    expected_context: input.expected as unknown as Json,
    next_state: input.next as unknown as Json,
    require_enabled: input.requireEnabled,
  });
  if (error) throw error;
  return readState(data, userId);
}

function parseContext(
  value: unknown,
  userId: string,
  poolId: string | null,
): NoteShortcutContext {
  if (!isRecord(value) || !Array.isArray(value.notes) ||
      !Array.isArray(value.importedOccurrenceIds)) {
    throw new Error("Invalid Note shortcut context.");
  }
  if (isDayNoteShortcutPool(poolId)) return parseDayPoolContext(value, userId);
  if ("dayPool" in value) throw new Error("Invalid Note shortcut context.");
  const behaviorId = poolId;
  const state = value.state === null ? null : readState(value.state, userId);
  const globalState = value.globalState === null
    ? null
    : readState(value.globalState, userId);
  const behavior = value.behavior === null
    ? null
    : readBehavior(value.behavior, userId, behaviorId);
  const notes = value.notes.map((note) => readNoteSource(note, userId, behaviorId));
  const importedOccurrenceIds = value.importedOccurrenceIds.map((id) => {
    if (typeof id !== "string") throw new Error("Invalid imported Occurrence ID.");
    return id;
  });
  return { state, globalState, behavior, notes, importedOccurrenceIds };
}

// The day-note pool context keeps the RPC's exact JSON, including `behavior: null`
// and null `behavior_id`/`scheduled_for`, so the guarded commit can compare it.
function parseDayPoolContext(
  value: Record<string, unknown>,
  userId: string,
): NoteShortcutContext {
  const dayPool = value.dayPool;
  if (value.behavior !== null || !isRecord(dayPool) ||
      dayPool.user_id !== userId || typeof dayPool.timezone !== "string" ||
      Object.keys(dayPool).length !== 2) {
    throw new Error("Invalid day note shortcut context.");
  }
  const state = value.state === null ? null : readState(value.state, userId);
  const globalState = value.globalState === null
    ? null
    : readState(value.globalState, userId);
  const notes = (value.notes as unknown[]).map((note) => {
    if (!isRecord(note) || typeof note.id !== "string" ||
        note.user_id !== userId || note.behavior_id !== null ||
        note.scheduled_for !== null ||
        (typeof note.note !== "string" && note.note !== null) ||
        typeof note.local_date !== "string") {
      throw new Error("Invalid day note shortcut source.");
    }
    const source: NoteSource = {
      id: note.id,
      user_id: userId,
      behavior_id: null,
      note: note.note,
      local_date: note.local_date,
      scheduled_for: null,
    };
    return source;
  });
  const importedOccurrenceIds = (value.importedOccurrenceIds as unknown[]).map((id) => {
    if (typeof id !== "string") throw new Error("Invalid imported day note ID.");
    return id;
  });
  return {
    state,
    globalState,
    behavior: null,
    notes,
    importedOccurrenceIds,
    dayPool: { user_id: userId, timezone: dayPool.timezone },
  };
}

function readState(value: unknown, userId: string): NoteShortcutState {
  validateNoteShortcutState(value);
  if (value.user_id !== userId) {
    throw new Error("Shortcut state belongs to another owner.");
  }
  return value;
}

function readBehavior(
  value: unknown,
  userId: string,
  behaviorId: string | null,
): NoteShortcutContext["behavior"] {
  if (behaviorId === null || !isRecord(value) || typeof value.id !== "string" ||
      value.user_id !== userId || value.id !== behaviorId ||
      typeof value.active !== "boolean" || typeof value.timezone !== "string") {
    throw new Error("Invalid Note shortcut Behavior context.");
  }
  return {
    id: value.id,
    user_id: userId,
    active: value.active,
    timezone: value.timezone,
  };
}

function readNoteSource(
  value: unknown,
  userId: string,
  behaviorId: string | null,
): NoteSource {
  if (behaviorId === null) {
    throw new Error("Invalid Note shortcut source.");
  }
  if (!isRecord(value) || typeof value.id !== "string" ||
      value.user_id !== userId || value.behavior_id !== behaviorId ||
      (typeof value.note !== "string" && value.note !== null) ||
      typeof value.local_date !== "string" ||
      typeof value.scheduled_for !== "string") {
    throw new Error("Invalid Note shortcut source.");
  }
  return {
    id: value.id,
    user_id: userId,
    behavior_id: behaviorId,
    note: value.note,
    local_date: value.local_date,
    scheduled_for: value.scheduled_for,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
