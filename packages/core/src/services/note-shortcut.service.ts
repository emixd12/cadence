import type { Temporal } from "@js-temporal/polyfill";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "../resolvers/day-note.resolver";
import { currentNoteShortcuts, isDayNoteShortcutPool, noteShortcutRevision, resolveNoteShortcutCommand, validateNoteShortcutState } from "../resolvers/note-suggestion.resolver";
import type { NoteShortcut, NoteShortcutCommand, NoteShortcutStore, NoteShortcutView } from "../types/note-shortcut";

export async function getNoteShortcutView(store: NoteShortcutStore, behaviorId: string | null, now: Temporal.Instant): Promise<NoteShortcutView> {
  try {
    const context = await store.readContext(behaviorId);
    const dayPool = isDayNoteShortcutPool(behaviorId);
    if (dayPool && (!context.dayPool || context.dayPool.user_id !== store.userId || context.behavior)) throw new Error("Day note shortcuts are unavailable.");
    if (!dayPool && context.dayPool) throw new Error("Invalid Note shortcut context.");
    if (behaviorId && !dayPool && (!context.behavior || context.behavior.user_id !== store.userId || context.behavior.id !== behaviorId)) throw new Error("Behavior not found.");
    for (const state of [context.state, context.globalState]) {
      if (!state) continue;
      validateNoteShortcutState(state);
      if (state.user_id !== store.userId) throw new Error("Shortcut state belongs to another owner.");
    }
    if (context.state && (context.state.id !== (behaviorId ?? "global") || context.state.behavior_id !== (dayPool ? null : behaviorId))) throw new Error("Shortcut state belongs to another Behavior.");
    if (context.globalState && context.globalState.id !== "global") throw new Error("Invalid global shortcut state.");
    return { state: context.state, globalEnabled: context.globalState?.enabled ?? false, available: !behaviorId || dayPool || context.behavior?.active === true, entries: currentNoteShortcuts({ context, userId: store.userId, now }) };
  } catch {
    return { state: null, globalEnabled: false, available: false, entries: [], unavailable: true };
  }
}

export async function manageNoteShortcuts(store: NoteShortcutStore, input: { behaviorId: string | null; command: NoteShortcutCommand; expectedRevision: string; now: Temporal.Instant }) {
  const expected = await store.readContext(input.behaviorId);
  if (input.expectedRevision !== noteShortcutRevision(expected.state)) throw new Error("This shortcut changed elsewhere. Refresh and try again.");
  const next = resolveNoteShortcutCommand({ ...input, context: expected, userId: store.userId });
  return store.commit({ expected, next, requireEnabled: ["analyze", "accept", "edit"].includes(input.command.operation) });
}

export async function listAcceptedNoteShortcuts(store: NoteShortcutStore): Promise<Record<string, NoteShortcut[]>> {
  try {
    const states = await store.readStates();
    for (const state of states) {
      validateNoteShortcutState(state);
      if (state.user_id !== store.userId) throw new Error("Shortcut state belongs to another owner.");
    }
    if (!states.find((state) => state.id === "global")?.enabled) return {};
    // Keys are Behavior IDs plus DAY_NOTE_SHORTCUT_POOL_ID, so day-note chips never reach Occurrence notes.
    return Object.fromEntries(states.filter((state) => (state.behavior_id || state.id === DAY_NOTE_SHORTCUT_POOL_ID) && state.enabled)
      .map((state) => [state.behavior_id ?? DAY_NOTE_SHORTCUT_POOL_ID, state.entries.filter((entry) => entry.status === "accepted")]));
  } catch {
    return {};
  }
}
