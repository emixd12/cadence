import { describe, expect, it } from "vitest";

import { DAY_NOTE_CONFLICT_MESSAGE, listDayNotes, saveDayNote } from "@cadence/core/services/day-note.service";
import {
  attachTimelineDayNotes,
  timelineDayNoteRange,
  DAY_NOTE_LIMITS,
  dayNotePreview,
  dayNotesByDate,
  normalizeDayNote,
  parseDayNoteLocalDate,
  resolveDayNoteRange,
  resolveDayNoteUpdate,
} from "@cadence/core/resolvers/day-note.resolver";

describe("day note update planning", () => {
  it("normalizes like Occurrence notes and turns empty text into a cleared note", () => {
    expect(normalizeDayNote("  Slept badly\r\nShort run  ")).toBe("Slept badly\nShort run");
    expect(normalizeDayNote("   \n ")).toBeNull();
    expect(resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote: "", note: "Travel day" })).toEqual({
      localDate: "2026-11-10",
      expectedNote: null,
      note: "Travel day",
    });
    expect(resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote: "Travel day", note: "  " })).toEqual({
      localDate: "2026-11-10",
      expectedNote: "Travel day",
      note: null,
    });
  });

  it("rejects invalid calendar dates without JavaScript Date parsing", () => {
    expect(parseDayNoteLocalDate("2028-02-29")).toBe("2028-02-29");
    for (const value of ["2026-02-30", "2026-13-01", "2026-1-01", "", null, 20261110]) {
      expect(() => parseDayNoteLocalDate(value)).toThrow("Choose a valid day for this note.");
    }
  });

  it("enforces the character limit on the normalized text", () => {
    const limit = DAY_NOTE_LIMITS.characters;
    expect(resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote: "", note: ` ${"a".repeat(limit)} ` }).note).toHaveLength(limit);
    expect(() => resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote: "", note: "a".repeat(limit + 1) })).toThrow("2,000 characters");
    expect(resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote: "", note: "🐴".repeat(limit) }).note).not.toBeNull();
  });

  it("requires string inputs for the note and the expected note", () => {
    expect(() => resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote: "", note: 3 })).toThrow("Enter a day note");
    expect(() => resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote: null, note: "x" })).toThrow("Refresh this day");
  });
});

describe("day note expected text", () => {
  it("normalizes CRLF and lone CR line breaks without trimming", () => {
    const plan = (expectedNote: string) => resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote, note: "x" }).expectedNote;
    expect(plan("line one\r\nline two")).toBe("line one\nline two");
    expect(plan("line one\rline two")).toBe("line one\nline two");
    expect(plan("a\r\n\r\nb")).toBe("a\n\nb");
    expect(plan(" kept as sent ")).toBe(" kept as sent ");
    expect(plan("")).toBeNull();
  });
});

describe("day note ranges and views", () => {
  it("accepts inclusive ranges up to the limit", () => {
    expect(resolveDayNoteRange({ from: "2026-11-01", to: "2026-11-01" })).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(() => resolveDayNoteRange({ from: "2026-11-02", to: "2026-11-01" })).toThrow("end on or after");
    expect(resolveDayNoteRange({ from: "2026-01-01", to: "2026-04-02" }).to).toBe("2026-04-02");
    expect(() => resolveDayNoteRange({ from: "2026-01-01", to: "2026-04-03" })).toThrow("at most 92 days");
  });

  it("indexes only non-empty notes by date", () => {
    expect(dayNotesByDate([
      { local_date: "2026-11-09", note: "Sick" },
      { local_date: "2026-11-10", note: null },
      { local_date: "2026-11-11", note: "  " },
    ])).toEqual({ "2026-11-09": "Sick" });
  });

  it("builds a one-line preview", () => {
    expect(dayNotePreview("Travel\n\nday")).toBe("Travel day");
    expect(dayNotePreview("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("day note service", () => {
  const record = (note: string | null, localDate = "2026-11-10") => ({
    id: "40000000-0000-4000-8000-000000000001", user_id: "10000000-0000-4000-8000-000000000001",
    local_date: localDate, note, revision: 1, created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z",
  });

  it("passes the planned compare-and-set to the store", async () => {
    const calls: unknown[] = [];
    const result = await saveDayNote({ saveDayNote: async (input) => { calls.push(input); return record(input.note); } },
      { localDate: "2026-11-10", expectedNote: "", note: " Rest day " });
    expect(calls).toEqual([{ localDate: "2026-11-10", expectedNote: null, note: "Rest day" }]);
    expect(result).toMatchObject({ localDate: "2026-11-10", note: "Rest day", changed: true });
  });

  it("does not write when clearing a day that has no note", async () => {
    let called = false;
    const result = await saveDayNote({ saveDayNote: async () => { called = true; return null; } },
      { localDate: "2026-11-10", expectedNote: "", note: "   " });
    expect(called).toBe(false);
    expect(result).toEqual({ localDate: "2026-11-10", note: null, record: null, changed: false });
  });

  it("reports a conflict when the stored note changed", async () => {
    await expect(saveDayNote({ saveDayNote: async () => null }, { localDate: "2026-11-10", expectedNote: "Old", note: "New" }))
      .rejects.toThrow(DAY_NOTE_CONFLICT_MESSAGE);
  });

  it("forwards shortcut use only when text is saved", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const store = { saveDayNote: async (input: Record<string, unknown>) => { calls.push(input); return record((input.note as string | null) ?? null); } };
    await saveDayNote(store as never, { localDate: "2026-11-10", expectedNote: "", note: "Rest day", usedShortcut: true });
    await saveDayNote(store as never, { localDate: "2026-11-10", expectedNote: "Rest day", note: "", usedShortcut: true });
    expect(calls[0]).toHaveProperty("usedShortcut", true);
    expect(calls[1]).not.toHaveProperty("usedShortcut");
  });

  // Defect D3 (Ticket 292): browsers submit form text with CRLF line breaks, while
  // the saved note uses LF. This store compares like the hosted save_day_note RPC.
  function compareAndSetStore(saved: string | null) {
    const state = { saved };
    return {
      state,
      store: {
        saveDayNote: async (input: { expectedNote: string | null; note: string | null }) => {
          if (input.expectedNote !== state.saved) return null;
          state.saved = input.note;
          return record(input.note);
        },
      },
    };
  }

  it.each([
    ["CRLF", "line one\r\nline two"],
    ["lone CR", "line one\rline two"],
  ])("edits a multi-line note when the expected text uses %s line breaks", async (_label, expectedNote) => {
    const { state, store } = compareAndSetStore("line one\nline two");
    const result = await saveDayNote(store, { localDate: "2026-11-10", expectedNote, note: "line one\r\nline three" });
    expect(result).toMatchObject({ note: "line one\nline three", changed: true });
    expect(state.saved).toBe("line one\nline three");
  });

  it("clears a multi-line sync-merged note submitted with CRLF line breaks", async () => {
    const { state, store } = compareAndSetStore("From the Mac\n\nFrom the web");
    const result = await saveDayNote(store, {
      localDate: "2026-11-10", expectedNote: "From the Mac\r\n\r\nFrom the web", note: "",
    });
    expect(result).toMatchObject({ note: null, changed: true });
    expect(state.saved).toBeNull();
  });

  it("still reports a conflict when a multi-line expected note is stale", async () => {
    const { state, store } = compareAndSetStore("line one\nline two changed");
    await expect(saveDayNote(store, { localDate: "2026-11-10", expectedNote: "line one\r\nline two", note: "New" }))
      .rejects.toThrow(DAY_NOTE_CONFLICT_MESSAGE);
    expect(state.saved).toBe("line one\nline two changed");
  });

  it("lists sorted notes inside the requested range", async () => {
    const notes = await listDayNotes({ listDayNotes: async () => [record("B", "2026-11-12"), record("A", "2026-11-11"), record("X", "2026-12-30")] },
      { from: "2026-11-01", to: "2026-11-30" });
    expect(notes.map((note) => note.note)).toEqual(["A", "B"]);
  });

  it("attaches notes only for dates the Timeline shows", () => {
    const view = { daySections: [{ localDate: "2026-11-10" }, { localDate: "2026-11-11" }], needsDecision: { daySections: [{ localDate: "2026-11-02" }] } };
    expect(timelineDayNoteRange(view)).toEqual({ from: "2026-11-02", to: "2026-11-11" });
    expect(timelineDayNoteRange({ daySections: [], needsDecision: { daySections: [] } })).toBeNull();
    expect(attachTimelineDayNotes(view, [record("Shown", "2026-11-02"), record("Hidden", "2026-11-05"), record(null, "2026-11-10")]).dayNotes)
      .toEqual({ "2026-11-02": "Shown" });
  });
});
