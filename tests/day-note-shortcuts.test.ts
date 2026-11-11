import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";

import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import {
  currentNoteShortcuts,
  eligibleNoteSources,
  resolveNoteShortcutCommand,
  resolveNoteSuggestions,
  validateNoteShortcutState,
} from "@cadence/core/resolvers/note-suggestion.resolver";
import { getNoteShortcutView, listAcceptedNoteShortcuts } from "@cadence/core/services/note-shortcut.service";
import type { NoteShortcutContext, NoteShortcutState, NoteShortcutStore, NoteSource } from "@cadence/core/types/note-shortcut";
import { readNoteShortcutContext } from "@/lib/db/noteShortcuts.repo";
import { saveDayNoteIfExpected } from "@/lib/db/dayNotes.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

const owner = "10000000-0000-4000-8000-000000000001";
const foreign = "90000000-0000-4000-8000-000000000001";
const behaviorId = "20000000-0000-4000-8000-000000000001";
const now = Temporal.Instant.from("2026-11-11T03:00:00Z"); // November 10 in New York.
const id = (n: number) => `29200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pool = DAY_NOTE_SHORTCUT_POOL_ID;

const state = (overrides: Partial<NoteShortcutState> = {}): NoteShortcutState => ({
  id: pool, user_id: owner, behavior_id: null, enabled: true, entries: [],
  excluded_occurrence_ids: [], revision: 1, updated_at: now.toString(), ...overrides,
});
const globalState = (enabled = true): NoteShortcutState => ({ ...state(), id: "global", enabled });
const dayNote = (n: number, text = "Travel day", date = `2026-11-${String(10 - n).padStart(2, "0")}`): NoteSource => ({
  id: id(n), user_id: owner, behavior_id: null, note: text, local_date: date, scheduled_for: null,
});
const context = (notes: NoteSource[] = [dayNote(1), dayNote(2), dayNote(3)]): NoteShortcutContext => ({
  state: state(), globalState: globalState(), behavior: null, notes, importedOccurrenceIds: [],
  dayPool: { user_id: owner, timezone: "America/New_York" },
});
const command = (ctx: NoteShortcutContext, operation: Parameters<typeof resolveNoteShortcutCommand>[0]["command"], at = now) =>
  resolveNoteShortcutCommand({ context: ctx, userId: owner, behaviorId: pool, command: operation, now: at });

describe("Day note shortcut pool", () => {
  it("proposes a shortcut from three matching day notes in 90 days, with day-note IDs as evidence", () => {
    const ctx = context();
    const next = command(ctx, { operation: "analyze" });
    expect(next.id).toBe(pool);
    expect(next.behavior_id).toBeNull();
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({ text: "Travel day", status: "proposed", source: "repeated_text" });
    expect(next.entries[0].evidence.map((ref) => ref.occurrence_id)).toEqual([id(1), id(2), id(3)]);
    expect(() => validateNoteShortcutState(next)).not.toThrow();
  });

  it("needs three days and counts only the owner's day notes inside the local 90-day window", () => {
    expect(resolveNoteSuggestions({ context: context([dayNote(1), dayNote(2)]), userId: owner, now })).toEqual([]);
    const ctx = context([
      dayNote(1), dayNote(2),
      dayNote(3, "Travel day", "2026-08-12"), // 91 days before November 10.
      dayNote(4, "Travel day", "2026-11-11"), // Tomorrow in New York.
      { ...dayNote(5), user_id: foreign },
      { ...dayNote(6), behavior_id: behaviorId },
      { ...dayNote(7), scheduled_for: "2026-11-03T12:00:00Z" },
      dayNote(8, " "),
      dayNote(9, "a".repeat(2001)),
      dayNote(10, "Travel day", "2026-08-13"),
    ]);
    expect(eligibleNoteSources({ context: ctx, userId: owner, now }).map((row) => row.id)).toEqual([id(1), id(2), id(10)]);
    expect(resolveNoteSuggestions({ context: ctx, userId: owner, now })).toHaveLength(1);
  });

  it("excludes day notes written with a shortcut and imported day notes", () => {
    const ctx = context([dayNote(1), dayNote(2), dayNote(3), dayNote(4)]);
    ctx.state!.excluded_occurrence_ids = [id(1)];
    ctx.importedOccurrenceIds = [id(2)];
    expect(eligibleNoteSources({ context: ctx, userId: owner, now }).map((row) => row.id)).toEqual([id(3), id(4)]);
    expect(resolveNoteSuggestions({ context: ctx, userId: owner, now })).toEqual([]);
  });

  it("expires proposals after 30 days and drops them when evidence notes change", () => {
    const ctx = context();
    ctx.state = command(ctx, { operation: "analyze" });
    expect(currentNoteShortcuts({ context: ctx, userId: owner, now })).toHaveLength(1);
    expect(currentNoteShortcuts({ context: ctx, userId: owner, now: now.add({ hours: 30 * 24 }) })).toEqual([]);
    const edited = { ...ctx, notes: [dayNote(1, "Rest day"), dayNote(2), dayNote(3)] };
    expect(currentNoteShortcuts({ context: edited, userId: owner, now })).toEqual([]);
  });

  it("accepts, edits, removes and dismisses within the day pool only", () => {
    const ctx = context();
    ctx.state = command(ctx, { operation: "analyze" });
    const key = ctx.state.entries[0].key;
    ctx.state = command(ctx, { operation: "accept", key, text: "Travel day" });
    expect(ctx.state.entries[0]).toMatchObject({ status: "accepted", evidence: [], expires_at: null });
    ctx.state = command(ctx, { operation: "edit", key, text: "Travel day, long drive" });
    expect(ctx.state.entries[0].text).toBe("Travel day, long drive");
    ctx.state = command(ctx, { operation: "remove", key });
    expect(ctx.state.entries.every((entry) => entry.status === "dismissed")).toBe(true);
    expect(resolveNoteSuggestions({ context: ctx, userId: owner, now })).toEqual(ctx.state.entries);
  });

  it("keeps at most 20 accepted day note shortcuts", () => {
    const accepted = Array.from({ length: 20 }, (_, n) => ({
      key: `${String(n).padStart(2, "0")}`.repeat(32), text: `Shortcut ${n}`, status: "accepted" as const,
      source: "repeated_text" as const, evidence: [], created_at: now.toString(), expires_at: null,
    }));
    const ctx = context([dayNote(1, "Fresh"), dayNote(2, "Fresh"), dayNote(3, "Fresh")]);
    ctx.state = { ...state(), entries: accepted };
    ctx.state = command(ctx, { operation: "analyze" });
    const proposal = ctx.state.entries.find((entry) => entry.status === "proposed")!;
    expect(() => command(ctx, { operation: "accept", key: proposal.key, text: "Fresh" })).toThrow("20 accepted day note shortcuts");
  });

  it("requires the global switch and the day pool switch before analysis or acceptance", () => {
    const off = { ...context(), globalState: globalState(false) };
    expect(() => command(off, { operation: "analyze" })).toThrow("for day notes first");
    const poolOff = { ...context(), state: state({ enabled: false }) };
    expect(() => command(poolOff, { operation: "analyze" })).toThrow("for day notes first");
    expect(command(poolOff, { operation: "enable", enabled: true }).enabled).toBe(true);
  });

  it("rejects a day pool context mixed with a Behavior or a foreign owner", () => {
    expect(() => command({ ...context(), behavior: { id: behaviorId, user_id: owner, active: true, timezone: "UTC" } }, { operation: "analyze" })).toThrow("unavailable");
    expect(() => command({ ...context(), dayPool: { user_id: foreign, timezone: "UTC" } }, { operation: "analyze" })).toThrow("unavailable");
    expect(() => command({ ...context(), state: { ...state(), id: behaviorId, behavior_id: behaviorId } }, { operation: "analyze" })).toThrow("another owner or Behavior");
    expect(() => resolveNoteShortcutCommand({ context: context(), userId: owner, behaviorId, command: { operation: "analyze" }, now })).toThrow("Invalid Note shortcut context");
  });

  it("validates day pool state identity", () => {
    expect(() => validateNoteShortcutState(state())).not.toThrow();
    expect(() => validateNoteShortcutState(state({ behavior_id: behaviorId }))).toThrow();
    expect(() => validateNoteShortcutState({ ...state(), id: "day_note" })).toThrow();
  });
});

describe("Day note shortcut services", () => {
  const accepted = { key: "a".repeat(64), text: "Travel day", status: "accepted" as const, source: "repeated_text" as const, evidence: [], created_at: now.toString(), expires_at: null };
  const behaviorState: NoteShortcutState = { ...state(), id: behaviorId, behavior_id: behaviorId, entries: [{ ...accepted, key: "b".repeat(64), text: "Wore aligners" }] };
  const store = (states: NoteShortcutState[], ctx?: NoteShortcutContext): NoteShortcutStore => ({
    userId: owner,
    readStates: async () => states,
    readContext: async () => ctx ?? context(),
    commit: vi.fn(),
  });

  it("keys accepted day note shortcuts by the pool ID, separate from Behavior pools", async () => {
    const result = await listAcceptedNoteShortcuts(store([globalState(), state({ entries: [accepted] }), behaviorState]));
    expect(result[pool].map((entry) => entry.text)).toEqual(["Travel day"]);
    expect(result[behaviorId].map((entry) => entry.text)).toEqual(["Wore aligners"]);
    expect(result[behaviorId].some((entry) => entry.text === "Travel day")).toBe(false);
  });

  it("returns no chips for either pool while the global switch is off", async () => {
    expect(await listAcceptedNoteShortcuts(store([globalState(false), state({ entries: [accepted] }), behaviorState]))).toEqual({});
    expect(await listAcceptedNoteShortcuts(store([globalState(), state({ enabled: false, entries: [accepted] })]))).toEqual({});
  });

  it("builds an available day pool view and rejects a mismatched context", async () => {
    const view = await getNoteShortcutView(store([], context()), pool, now);
    expect(view).toMatchObject({ globalEnabled: true, available: true });
    expect(view.unavailable).toBeUndefined();
    const broken = await getNoteShortcutView(store([], { ...context(), dayPool: undefined }), pool, now);
    expect(broken.unavailable).toBe(true);
  });
});

describe("Day note shortcut web repository", () => {
  const rpcContext = {
    state: state(), globalState: globalState(), behavior: null,
    notes: [{ id: id(1), user_id: owner, behavior_id: null, note: "Travel day", local_date: "2026-11-09", scheduled_for: null }],
    importedOccurrenceIds: [id(9)],
    dayPool: { user_id: owner, timezone: "America/New_York" },
  };

  it("reads the day pool through its own RPC and keeps the exact context shape", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcContext, error: null });
    const ctx = await readNoteShortcutContext({ rpc } as unknown as AppSupabaseClient, owner, pool);
    expect(rpc).toHaveBeenCalledWith("read_day_note_shortcut_context");
    expect(ctx).toEqual(rpcContext);
  });

  it("rejects day pool sources that point at a Behavior or another owner", async () => {
    for (const note of [{ ...rpcContext.notes[0], behavior_id: behaviorId }, { ...rpcContext.notes[0], user_id: foreign }]) {
      const rpc = vi.fn().mockResolvedValue({ data: { ...rpcContext, notes: [note] }, error: null });
      await expect(readNoteShortcutContext({ rpc } as unknown as AppSupabaseClient, owner, pool)).rejects.toThrow();
    }
    const rpc = vi.fn().mockResolvedValue({ data: { ...rpcContext, dayPool: { user_id: foreign, timezone: "UTC" } }, error: null });
    await expect(readNoteShortcutContext({ rpc } as unknown as AppSupabaseClient, owner, pool)).rejects.toThrow();
  });

  it("saves a shortcut-written day note through the atomic exclusion RPC", async () => {
    const row = { id: id(1), user_id: owner, local_date: "2026-11-10", note: "Travel day", revision: 1, created_at: now.toString(), updated_at: now.toString() };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const rpc = vi.fn().mockReturnValue({ maybeSingle });
    const client = { rpc } as unknown as AppSupabaseClient;
    await expect(saveDayNoteIfExpected(client, { localDate: "2026-11-10", expectedNote: null, note: "Travel day", usedShortcut: true })).resolves.toEqual(row);
    expect(rpc).toHaveBeenCalledWith("save_day_note_with_shortcut", { target_local_date: "2026-11-10", expected_note: null, next_note: "Travel day", used_shortcut: true });
    await saveDayNoteIfExpected(client, { localDate: "2026-11-10", expectedNote: "Travel day", note: "Rest" });
    expect(rpc).toHaveBeenLastCalledWith("save_day_note", { target_local_date: "2026-11-10", expected_note: "Travel day", next_note: "Rest" });
  });
});
