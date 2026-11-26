import { describe, expect, it } from "vitest";

import { DAY_NOTE_CONFLICT_MESSAGE, listDayNotes, saveDayNote } from "@cadence/core/services/day-note.service";
import {
  BRIEF_DAY_NOTE_LIMITS,
  briefDayNoteRange,
  resolveBriefDayNotes,
  textQuotesDayNote,
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
  it("turns CRLF into LF, keeps a lone CR and does not trim", () => {
    const plan = (expectedNote: string) => resolveDayNoteUpdate({ localDate: "2026-11-10", expectedNote, note: "x" }).expectedNote;
    expect(plan("line one\r\nline two")).toBe("line one\nline two");
    expect(plan("line one\rline two")).toBe("line one\rline two");
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

  it("edits a multi-line note when a browser submits the expected text with CRLF", async () => {
    const { state, store } = compareAndSetStore("line one\nline two");
    const result = await saveDayNote(store, { localDate: "2026-11-10", expectedNote: "line one\r\nline two", note: "line one\r\nline three" });
    expect(result).toMatchObject({ note: "line one\nline three", changed: true });
    expect(state.saved).toBe("line one\nline three");
  });

  it("edits a note saved with a lone CR when desktop or MCP sends the saved text", async () => {
    const { state, store } = compareAndSetStore("First\rSecond");
    const result = await saveDayNote(store, { localDate: "2026-11-10", expectedNote: "First\rSecond", note: "Third" });
    expect(result).toMatchObject({ note: "Third", changed: true });
    expect(state.saved).toBe("Third");
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

describe("day notes for the Daily Brief (Ticket 367)", () => {
  it("reads today and the two local days before it, across a month and a year", () => {
    expect(BRIEF_DAY_NOTE_LIMITS).toMatchObject({ days: 3, characters: 280 });
    expect(briefDayNoteRange("2026-11-25")).toEqual({ from: "2026-11-23", to: "2026-11-25" });
    expect(briefDayNoteRange("2026-03-01")).toEqual({ from: "2026-02-27", to: "2026-03-01" });
    expect(briefDayNoteRange("2027-01-01")).toEqual({ from: "2026-12-30", to: "2027-01-01" });
    expect(() => briefDayNoteRange("2026-02-30")).toThrow("Choose a valid day for this note.");
  });

  it("names each day, newest first, and leaves out days with no note and days outside the range", () => {
    const records = [
      { local_date: "2026-11-22", note: "Too old" },
      { local_date: "2026-11-23", note: "Long drive" },
      { local_date: "2026-11-24", note: null },
      { local_date: "2026-11-25", note: "  Head cold  " },
      { local_date: "2026-11-26", note: "Tomorrow" },
    ];
    expect(resolveBriefDayNotes({ localDate: "2026-11-25", records })).toEqual([
      { day: "today", note: "Head cold" },
      { day: "2 days ago", note: "Long drive" },
    ]);
    // A cleared note (null) and a note on a later date are never sent.
    expect(resolveBriefDayNotes({ localDate: "2026-11-24", records })).toEqual([
      { day: "yesterday", note: "Long drive" },
      { day: "2 days ago", note: "Too old" },
    ]);
    expect(resolveBriefDayNotes({ localDate: "2026-11-25", records: [{ local_date: "2026-11-25", note: "   " }] })).toEqual([]);
    expect(resolveBriefDayNotes({ localDate: "2026-11-25", records: [] })).toEqual([]);
  });

  it("cuts each note to 280 characters, counting an emoji as one", () => {
    const [long] = resolveBriefDayNotes({ localDate: "2026-11-25", records: [{ local_date: "2026-11-25", note: "a".repeat(2_000) }] });
    expect(long!.note).toBe("a".repeat(280));
    const [emoji] = resolveBriefDayNotes({ localDate: "2026-11-25", records: [{ local_date: "2026-11-25", note: "😴".repeat(300) }] });
    expect([...emoji!.note]).toHaveLength(280);
    const [short] = resolveBriefDayNotes({ localDate: "2026-11-25", records: [{ local_date: "2026-11-25", note: "b".repeat(280) }] });
    expect(short!.note).toBe("b".repeat(280));
  });

  it("finds a whole note of three or more words, whatever the case, spacing or punctuation", () => {
    const five = ["Head cold, slept four hours."];
    expect(textQuotesDayNote("You wrote: head cold slept   FOUR hours, so take it easy.", five)).toBe(true);
    expect(textQuotesDayNote("HEAD COLD, SLEPT FOUR HOURS", five)).toBe(true);
    // Part of a short note is not the whole note.
    expect(textQuotesDayNote("A head cold makes today harder.", five)).toBe(false);
    expect(textQuotesDayNote("You slept four hours.", five)).toBe(false);
    expect(textQuotesDayNote("Sick again today.", ["Sick again today"])).toBe(true);
    // One or two words are ordinary language, not a quote.
    expect(textQuotesDayNote("You are sick today.", ["Sick today"])).toBe(false);
    expect(textQuotesDayNote("Tired.", ["Tired"])).toBe(false);
    expect(textQuotesDayNote("Anything at all.", [])).toBe(false);
    expect(textQuotesDayNote("Anything at all.", ["", "  "])).toBe(false);
  });

  it("finds six words in a row from a longer note, and not five", () => {
    const note = ["Flight home was delayed three hours, so dinner and the evening routine both slipped past ten."];
    expect(textQuotesDayNote("Your flight home was delayed three hours yesterday.", note)).toBe(true);
    expect(textQuotesDayNote("The evening routine both slipped past ten.", note)).toBe(true);
    expect(textQuotesDayNote("Your flight home was delayed three times.", note)).toBe(false);
    expect(textQuotesDayNote("After a late flight, the evening is tight.", note)).toBe(false);
    // Whole words only.
    expect(textQuotesDayNote("Flight homes was delayed three hours so.", note)).toBe(false);
  });

  it("Ticket 371: lets a sentence name a Period label that a note also uses, and nothing more of the note", () => {
    // The note is the label: naming the label is allowed.
    expect(textQuotesDayNote("Sick with flu: Walk needs a new time.", ["Sick with flu"])).toBe(true);
    expect(textQuotesDayNote("Sick with flu: Walk needs a new time.", ["Sick with flu"], ["Sick with flu"])).toBe(false);
    expect(textQuotesDayNote("During SICK  with flu, Walk needs a new time.", ["sick with flu"], ["Sick with flu"])).toBe(false);
    // A short label does not excuse the rest of a note.
    expect(textQuotesDayNote("Sick again today.", ["Sick again today"], ["Sick"])).toBe(true);
    // Six words that reach past the label are still a quote.
    const note = ["Recovering from knee surgery at home this week and very tired."];
    const label = ["Recovering from knee surgery at home"];
    expect(textQuotesDayNote("Recovering from knee surgery at home: a slow day.", note, label)).toBe(false);
    expect(textQuotesDayNote("Recovering from knee surgery at home this week.", note, label)).toBe(true);
  });
});
