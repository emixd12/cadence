import type { Temporal } from "@js-temporal/polyfill";
import { currentNoteShortcuts, noteShortcutRevision, noteShortcutsEnabled, resolveNoteShortcutCommand, validateNoteShortcutState } from "../resolvers/note-suggestion.resolver";
import type { NoteShortcut, NoteShortcutCommand, NoteShortcutStore, NoteShortcutView } from "../types/note-shortcut";

export async function getNoteShortcutView(store: NoteShortcutStore, behaviorId: string | null, now: Temporal.Instant): Promise<NoteShortcutView> {
  try {
    const context = await store.readContext(behaviorId);
    if (behaviorId && (!context.behavior || context.behavior.user_id !== store.userId || context.behavior.id !== behaviorId)) throw new Error("Behavior not found.");
    for (const state of [context.state, context.globalState]) {
      if (!state) continue;
      validateNoteShortcutState(state);
      if (state.user_id !== store.userId) throw new Error("Shortcut state belongs to another owner.");
    }
    if (context.state && context.state.behavior_id !== behaviorId) throw new Error("Shortcut state belongs to another Behavior.");
    if (context.globalState && context.globalState.id !== "global") throw new Error("Invalid global shortcut state.");
    return { state: context.state, globalEnabled: noteShortcutsEnabled(context.globalState), available: !behaviorId || context.behavior?.active === true, entries: currentNoteShortcuts({ context, userId: store.userId, now }) };
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

// Ticket 305: after a Note is saved, propose repeated Notes for that Behavior without a
// request. Deterministic text matching only. Writes only when the current reviewable
// entries change, so ordinary saves do not churn the synchronized state.
export async function matchRepeatedNoteShortcuts(store: NoteShortcutStore, behaviorId: string, now: Temporal.Instant): Promise<boolean> {
  const context = await store.readContext(behaviorId);
  if (!context.behavior?.active || !noteShortcutsEnabled(context.globalState)) return false;
  const next = resolveNoteShortcutCommand({ context, userId: store.userId, behaviorId, command: { operation: "analyze" }, now });
  if (entriesFingerprint(currentNoteShortcuts({ context, userId: store.userId, now })) === entriesFingerprint(next.entries)) return false;
  await store.commit({ expected: context, next, requireEnabled: true });
  return true;
}

// Stored rows and fresh resolver output can differ in object key order and entry order.
function entriesFingerprint(entries: NoteShortcut[]): string {
  return JSON.stringify(entries.map((entry) => [entry.key, entry.text, entry.status, entry.source,
    entry.evidence.map((ref) => [ref.occurrence_id, ref.note_hash]), entry.created_at, entry.expires_at])
    .sort(([left], [right]) => String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0));
}

export async function listAcceptedNoteShortcuts(store: NoteShortcutStore): Promise<Record<string, NoteShortcut[]>> {
  try {
    const states = await store.readStates();
    for (const state of states) {
      validateNoteShortcutState(state);
      if (state.user_id !== store.userId) throw new Error("Shortcut state belongs to another owner.");
    }
    if (!noteShortcutsEnabled(states.find((state) => state.id === "global"))) return {};
    return Object.fromEntries(states.filter((state) => state.behavior_id).map((state) => [state.behavior_id!, state.entries.filter((entry) => entry.status === "accepted")]));
  } catch {
    return {};
  }
}
