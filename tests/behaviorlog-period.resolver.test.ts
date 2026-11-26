import { describe, expect, it } from "vitest";

import {
  describeBehaviorLogPeriodOutcome,
  planBehaviorLogPeriodWrites,
  previewBehaviorLogPeriodOutcome,
  readBehaviorLogPeriodReviews,
  unavailableBehaviorLogPeriodOutcome,
  withBehaviorLogPeriodMessage,
  type BehaviorLogPeriodRead,
} from "@cadence/core/resolvers/behaviorlog-period.resolver";

import { period, periodReview, reviewFiles } from "./helpers/period-portability-fixture";

/** Ticket 373: reading Period reviews from a BehaviorLog bundle and planning writes. */

const read = (records: Parameters<typeof reviewFiles>[0]) => readBehaviorLogPeriodReviews(reviewFiles(records));

function readOf(...entries: Partial<BehaviorLogPeriodRead["periods"][number]>[]): BehaviorLogPeriodRead {
  return {
    periods: entries.map((entry) => ({ externalId: null, label: "Sick", startOn: "2026-06-01", endOn: "2026-06-03", hasNote: false, note: null, ...entry })),
    skipped: [],
  };
}

describe("readBehaviorLogPeriodReviews", () => {
  it("returns nothing for a bundle without a reviews file", () => {
    expect(readBehaviorLogPeriodReviews([{ path: "data/behaviors.jsonl", content: "{}\n" }])).toEqual({ periods: [], skipped: [] });
  });

  it("reads a Period review", () => {
    expect(read([periodReview({}, { note: "Flu" })])).toEqual({
      periods: [{ externalId: "file-review-1", label: "Sick", startOn: "2026-06-01", endOn: "2026-06-03", hasNote: true, note: "Flu" }],
      skipped: [],
    });
  });

  it("reads `ongoing: true` as no last day, whatever end date the file carries", () => {
    const { periods } = read([periodReview({ period_end_local_date: "2026-06-08" }, { ongoing: true })]);
    expect(periods[0]).toMatchObject({ startOn: "2026-06-01", endOn: null });
  });

  it("tells an absent note field from an explicit null", () => {
    expect(read([periodReview()]).periods[0]).toMatchObject({ hasNote: false, note: null });
    expect(read([periodReview({}, { note: null })]).periods[0]).toMatchObject({ hasNote: true, note: null });
    // Blank text normalizes to no note, like every Period note.
    expect(read([periodReview({}, { note: "  \r\n " })]).periods[0]).toMatchObject({ hasNote: true, note: null });
  });

  it("ignores reviews that are not Cadence Periods", () => {
    const dayNote = periodReview({ review_id: "day", period_end_local_date: "2026-06-01" }, {});
    (dayNote.extensions as Record<string, unknown>)["app.cadence"] = { day_note: true, updated_at_utc: "2026-06-01T12:00:00Z" };
    const foreign = { ...periodReview({ review_id: "foreign" }), extensions: { "org.example": { period: true } } };
    const plain = { ...periodReview({ review_id: "plain" }), extensions: undefined };
    const notTrue = periodReview({ review_id: "string-flag" }, { period: "true" });
    const otherType = periodReview({ record_type: "note" });
    const content = [dayNote, foreign, plain, notTrue, otherType].map((record) => JSON.stringify(record)).join("\n") + "\nnot json\n\n";
    expect(readBehaviorLogPeriodReviews([{ path: "data/reviews.jsonl", content }])).toEqual({ periods: [], skipped: [] });
  });

  it("falls back to the summary when the extension has no label, and trims it", () => {
    const record = periodReview({ summary_markdown: "  Travel  " });
    delete (record.extensions as Record<string, Record<string, unknown>>)["app.cadence"]!.label;
    expect(read([record]).periods[0]!.label).toBe("Travel");
  });

  it("skips invalid Period records and reports why, without the label", () => {
    const result = read([
      periodReview({ review_id: "long" }, { label: "x".repeat(61) }),
      periodReview({ review_id: "lines" }, { label: "Two\nlines" }),
      periodReview({ review_id: "backwards", period_end_local_date: "2026-05-31" }),
      periodReview({ review_id: "no-start", period_start_local_date: "2026-02-30" }),
      periodReview({ review_id: "no-end", period_end_local_date: null }),
      periodReview({ review_id: "note-type" }, { note: 7 }),
      periodReview({ review_id: "note-long" }, { note: "n".repeat(2_001) }),
      periodReview({ review_id: "coach", review_role: "coach" }),
      periodReview({ review_id: "good", period_start_local_date: "2026-06-05", period_end_local_date: "2026-06-05" }),
    ]);
    expect(result.periods.map((entry) => entry.externalId)).toEqual(["good"]);
    expect(result.skipped).toEqual([
      { externalId: "long", reason: "The period has no valid label." },
      { externalId: "lines", reason: "The period has no valid label." },
      { externalId: "backwards", reason: "The period ends before it starts." },
      { externalId: "no-start", reason: "The period has no valid first day." },
      { externalId: "no-end", reason: "The period has no valid last day." },
      { externalId: "note-type", reason: "The period note is not valid." },
      { externalId: "note-long", reason: "The period note is not valid." },
      { externalId: "coach", reason: "Only periods the person wrote can be imported." },
    ]);
  });

  it("needs no review id: identity is the natural key", () => {
    expect(read([periodReview({ review_id: undefined })]).periods).toEqual([
      { externalId: null, label: "Sick", startOn: "2026-06-01", endOn: "2026-06-03", hasNote: false, note: null },
    ]);
  });

  it("reads the same Period twice as one, and drops the note when the copies disagree", () => {
    expect(read([periodReview({ review_id: "a" }, { note: "Flu" }), periodReview({ review_id: "b" }, { note: "Flu" })])).toEqual({
      periods: [expect.objectContaining({ externalId: "a", hasNote: true, note: "Flu" })], skipped: [],
    });
    const disagree = read([periodReview({ review_id: "a" }, { note: "Flu" }), periodReview({ review_id: "b" }, { note: "Cold" })]);
    expect(disagree.periods).toEqual([expect.objectContaining({ externalId: "a", hasNote: false, note: null })]);
    expect(disagree.skipped).toEqual([{ externalId: "b", reason: "The file has this period more than once with different notes. Its note was left out." }]);
  });

  it("keeps overlapping Periods and Periods that differ only by ongoing apart, in display order", () => {
    const { periods } = read([
      periodReview({ review_id: "ongoing" }, { ongoing: true }),
      periodReview({ review_id: "later", period_start_local_date: "2026-06-02", period_end_local_date: "2026-06-04" }, { label: "Travel" }),
      periodReview({ review_id: "ended" }),
      periodReview({ review_id: "other-label" }, { label: "Travel" }),
    ]);
    expect(periods.map((entry) => entry.externalId)).toEqual(["ended", "other-label", "ongoing", "later"]);
  });
});

describe("planBehaviorLogPeriodWrites", () => {
  it("adds a Period no stored Period matches, in both modes", () => {
    for (const mode of ["import", "restore"] as const) {
      const plan = planBehaviorLogPeriodWrites({ read: readOf({ hasNote: true, note: "Flu" }), existing: [], mode });
      expect(plan.actions).toEqual([expect.objectContaining({ action: "create", existing: null, note: "Flu" })]);
    }
  });

  it("matches on label, first day and last day, never on an id", () => {
    const stored = period({ id: "stored-id" });
    const plan = planBehaviorLogPeriodWrites({
      read: readOf(
        { externalId: "another-accounts-id" },
        { externalId: "stored-id", label: "sick" },
        { externalId: "x", endOn: null },
        { externalId: "y", startOn: "2026-06-02" },
      ),
      existing: [stored],
      mode: "import",
    });
    // The second entry reuses the stored id with a different label: still a new Period.
    expect(plan.actions.map((action) => action.action)).toEqual(["keep", "create", "create", "create"]);
    expect(plan.actions[0]!.existing).toEqual({ id: "stored-id", revision: 1, note: null });
  });

  it("matches ongoing only with ongoing", () => {
    const plan = planBehaviorLogPeriodWrites({ read: readOf({ endOn: null }), existing: [period({ end_on: null })], mode: "import" });
    expect(plan.actions[0]!.action).toBe("keep");
  });

  it("never changes a stored Period on import, even when the file carries another note", () => {
    const plan = planBehaviorLogPeriodWrites({ read: readOf({ hasNote: true, note: "From file" }), existing: [period({ note: "Mine" })], mode: "import" });
    expect(plan.actions[0]!.action).toBe("keep");
  });

  it("sets the note on restore only when the file carries a note field that differs", () => {
    const plan = (entry: Parameters<typeof readOf>[0], note: string | null, setNotes?: boolean) =>
      planBehaviorLogPeriodWrites({ read: readOf(entry), existing: [period({ note })], mode: "restore", setNotes }).actions[0]!.action;
    expect(plan({ hasNote: true, note: "From file" }, "Mine")).toBe("set_note");
    expect(plan({ hasNote: true, note: null }, "Mine")).toBe("set_note"); // explicit null clears
    expect(plan({ hasNote: false, note: null }, "Mine")).toBe("keep"); // absent keeps
    expect(plan({ hasNote: true, note: "Mine" }, "Mine")).toBe("keep");
    expect(plan({ hasNote: true, note: null }, null)).toBe("keep");
    // A retried restore keeps every stored note.
    expect(plan({ hasNote: true, note: "From file" }, "Mine", false)).toBe("keep");
  });

  it("uses the oldest stored Period when two share a key", () => {
    const plan = planBehaviorLogPeriodWrites({
      read: readOf({ hasNote: true, note: "Flu" }),
      existing: [period({ id: "newer", created_at: "2026-06-02T00:00:00Z" }), period({ id: "older", created_at: "2026-06-01T00:00:00Z" })],
      mode: "restore",
    });
    expect(plan.actions[0]).toMatchObject({ action: "set_note", existing: { id: "older" } });
  });

  it("adds in display order while room remains and reports the rest", () => {
    const existing = Array.from({ length: 498 }, (_, index) => period({ id: `p-${index}`, label: `Stored ${index}` }));
    const plan = planBehaviorLogPeriodWrites({
      read: readOf({ label: "A" }, { label: "B" }, { label: "Stored 0" }, { label: "C" }, { label: "D" }),
      existing,
      mode: "import",
    });
    expect(plan.actions.map((action) => action.action)).toEqual(["create", "create", "keep", "over_limit", "over_limit"]);
    expect(previewBehaviorLogPeriodOutcome(plan)).toEqual({
      mode: "import", unavailable: false, added: 2, notesSet: 0, existing: 1, overLimit: 2, failed: 0, skippedCount: 0,
    });
  });

  it("adds nothing to a full account and still matches stored Periods", () => {
    const plan = planBehaviorLogPeriodWrites({ read: readOf({ label: "New" }, {}), existing: [period()], mode: "restore", limit: 1 });
    expect(plan.actions.map((action) => action.action)).toEqual(["over_limit", "keep"]);
  });

  it("carries skipped records into the plan and the preview count", () => {
    const plan = planBehaviorLogPeriodWrites({ read: { periods: [], skipped: [{ externalId: "bad", reason: "x" }] }, existing: [], mode: "import" });
    expect(previewBehaviorLogPeriodOutcome(plan).skippedCount).toBe(1);
  });
});

describe("describeBehaviorLogPeriodOutcome", () => {
  const base = { mode: "import" as const, unavailable: false, added: 0, notesSet: 0, existing: 0, overLimit: 0, failed: 0, skippedCount: 0 };

  it("says nothing when the bundle changes nothing", () => {
    expect(describeBehaviorLogPeriodOutcome(base, "preview")).toBeNull();
    expect(withBehaviorLogPeriodMessage("Ready.", null, "preview")).toBe("Ready.");
    expect(withBehaviorLogPeriodMessage("Ready.", base, "preview")).toBe("Ready.");
  });

  it("reports the counts in the preview", () => {
    expect(describeBehaviorLogPeriodOutcome({ ...base, mode: "restore", added: 2, existing: 3, notesSet: 1, overLimit: 4, skippedCount: 1 }, "preview")).toBe(
      "Periods: 2 to add, 3 already saved. 1 note on saved periods will be set from the bundle. 4 periods do not fit under the limit of 500 periods and will not be added. 1 period record in the bundle was invalid and was skipped.",
    );
  });

  it("reports what happened after apply", () => {
    expect(describeBehaviorLogPeriodOutcome({ ...base, mode: "restore", added: 1, notesSet: 2, existing: 2, overLimit: 1, failed: 1, skippedCount: 2 }, "applied")).toBe(
      "Periods: 1 added, 2 already saved. 2 notes on saved periods were set from the bundle. 1 period does not fit under the limit of 500 periods and was not added. 1 period could not be saved. 2 period records in the bundle were invalid and were skipped.",
    );
  });

  it("explains an unavailable read for each mode and phase", () => {
    expect(describeBehaviorLogPeriodOutcome(unavailableBehaviorLogPeriodOutcome("import"), "preview")).toContain("could not be checked");
    expect(describeBehaviorLogPeriodOutcome(unavailableBehaviorLogPeriodOutcome("import"), "applied")).toContain("Your other data was imported");
    expect(describeBehaviorLogPeriodOutcome(unavailableBehaviorLogPeriodOutcome("restore"), "applied")).toContain("Your other data was restored");
  });
});
