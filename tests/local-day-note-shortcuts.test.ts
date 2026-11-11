import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const localCommand = vi.hoisted(() => vi.fn());
vi.mock("../apps/desktop/src/local-store", () => ({
  localCommand,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "mutation-1" }),
}));

import { createLocalNoteShortcutStore } from "../apps/desktop/src/local-note-shortcut.service";
import { getNoteShortcutView, listAcceptedNoteShortcuts, manageNoteShortcuts } from "@cadence/core/services/note-shortcut.service";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import { noteShortcutRevision } from "@cadence/core/resolvers/note-suggestion.resolver";
import type { NoteShortcutContext, NoteShortcutState } from "@cadence/core/types/note-shortcut";

// Ticket 292: the Mac app's day-note pool goes through the same core service as the web.
const profileId = "29200000-0000-4000-8000-000000000001";
const now = Temporal.Instant.from("2026-11-10T17:00:00Z");
const state = (id: string, patch: Partial<NoteShortcutState> = {}): NoteShortcutState => ({
  id, user_id: profileId, behavior_id: null, enabled: true, entries: [], excluded_occurrence_ids: [], revision: 1,
  updated_at: "2026-11-10T12:00:00Z", ...patch,
});
const dayNote = (index: number, date: string) => ({ id: `29200000-0000-4000-8000-00000000010${index}`, user_id: profileId,
  behavior_id: null, note: "Travel day", local_date: date, scheduled_for: null });
const context = (patch: Partial<NoteShortcutContext> = {}): NoteShortcutContext => ({
  state: state(DAY_NOTE_SHORTCUT_POOL_ID), globalState: state("global"), behavior: null,
  notes: [dayNote(1, "2026-11-08"), dayNote(2, "2026-11-09"), dayNote(3, "2026-11-10")],
  importedOccurrenceIds: [], dayPool: { user_id: profileId, timezone: "America/New_York" }, ...patch,
});

beforeEach(() => { localCommand.mockReset(); });

describe("local day-note shortcuts", () => {
  it("reads the day pool context from the native store and proposes repeated day notes", async () => {
    localCommand.mockImplementation(async (operation: string, input: { next?: NoteShortcutState }) => {
      if (operation === "readNoteShortcutContext") return context();
      if (operation === "commitNoteShortcutState") return input.next;
      throw new Error(operation);
    });
    const store = createLocalNoteShortcutStore(profileId);
    const view = await getNoteShortcutView(store, DAY_NOTE_SHORTCUT_POOL_ID, now);
    expect(localCommand).toHaveBeenCalledWith("readNoteShortcutContext", { profileId, behaviorId: DAY_NOTE_SHORTCUT_POOL_ID });
    expect(view.unavailable).toBeUndefined();
    expect(view.available).toBe(true);

    await manageNoteShortcuts(store, { behaviorId: DAY_NOTE_SHORTCUT_POOL_ID, command: { operation: "analyze" }, expectedRevision: noteShortcutRevision(view.state), now });
    const commit = localCommand.mock.calls.find(([operation]) => operation === "commitNoteShortcutState")?.[1];
    expect(commit).toMatchObject({ profileId, requireEnabled: true, next: { id: DAY_NOTE_SHORTCUT_POOL_ID, behavior_id: null, revision: 2 } });
    expect(commit.next.entries).toEqual([expect.objectContaining({ status: "proposed", text: "Travel day" })]);
  });

  it("returns accepted day-note chips under the day pool key only", async () => {
    const accepted = { key: "a".repeat(64), text: "Travel day", status: "accepted" as const, source: "repeated_text" as const,
      evidence: [], created_at: "2026-11-10T12:00:00Z", expires_at: null };
    localCommand.mockResolvedValue([state("global"), state(DAY_NOTE_SHORTCUT_POOL_ID, { entries: [accepted] })]);
    const chips = await listAcceptedNoteShortcuts(createLocalNoteShortcutStore(profileId));
    expect(Object.keys(chips)).toEqual([DAY_NOTE_SHORTCUT_POOL_ID]);
    expect(chips[DAY_NOTE_SHORTCUT_POOL_ID]).toEqual([accepted]);
  });
});
