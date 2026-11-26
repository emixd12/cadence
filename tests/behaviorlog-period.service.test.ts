import { describe, expect, it } from "vitest";

import { periodNaturalKey } from "@cadence/core/resolvers/period.resolver";
import { applyBehaviorLogPeriods, previewBehaviorLogPeriods } from "@cadence/core/services/behaviorlog-period.service";
import { PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";

import { exportBundle, memoryPeriodStore, period, periodReview, reviewFiles, reviews } from "./helpers/period-portability-fixture";

/** Ticket 373: saving Periods from a BehaviorLog bundle after the main import or restore commits. */

const SOURCE = [
  period({ id: "70000000-0000-4000-8000-000000000001", label: "Sick", start_on: "2026-06-01", end_on: "2026-06-03", note: "Flu" }),
  period({ id: "70000000-0000-4000-8000-000000000002", label: "Travel", start_on: "2026-06-02", end_on: "2026-06-06" }),
  period({ id: "70000000-0000-4000-8000-000000000003", label: "Night shifts", start_on: "2026-05-01", end_on: null }),
  period({ id: "70000000-0000-4000-8000-000000000004", label: "Leave", start_on: "2026-07-01", end_on: null, note: "Booked" }),
];
const fields = (row: { label: string; start_on: string; end_on: string | null; note: string | null }) =>
  [row.label, row.start_on, row.end_on, row.note];

describe("BehaviorLog Period import and restore", () => {
  it("returns null for a bundle with no Periods and reads nothing", async () => {
    const files = exportBundle(undefined).behaviorLog.files;
    const store = { listPeriods: async () => { throw new Error("not read"); } };
    expect(await previewBehaviorLogPeriods(store, files, "import")).toBeNull();
    expect(await applyBehaviorLogPeriods(memoryPeriodStore().store, files, "restore")).toBeNull();
  });

  it("round-trips an export into an empty account, ongoing and future Periods included", async () => {
    const files = exportBundle(SOURCE).behaviorLog.files;
    const { store, rows } = memoryPeriodStore();
    expect(await previewBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 4, existing: 0, overLimit: 0 });
    expect(rows).toHaveLength(0);
    expect(await applyBehaviorLogPeriods(store, files, "import")).toEqual({
      mode: "import", unavailable: false, added: 4, notesSet: 0, existing: 0, overLimit: 0, failed: 0, skippedCount: 0,
    });
    expect(rows.map(fields).sort()).toEqual(SOURCE.map(fields).sort());
    // New ids: the file's ids are never stored.
    expect(rows.some((row) => SOURCE.some((source) => source.id === row.id))).toBe(false);
    // Exporting the new account writes the same Period reviews apart from ids and timestamps.
    const strip = (list: ReturnType<typeof reviews>) => list.map((review) => [review.period_start_local_date, review.period_end_local_date, review.summary_markdown]);
    expect(strip(reviews(exportBundle(rows).behaviorLog.files))).toEqual(strip(reviews(files)));
  });

  it("adds nothing on a repeated import", async () => {
    const files = exportBundle(SOURCE).behaviorLog.files;
    const { store, rows, calls } = memoryPeriodStore();
    await applyBehaviorLogPeriods(store, files, "import");
    expect(await previewBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 0, existing: 4 });
    expect(await applyBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 0, existing: 4, failed: 0 });
    expect(rows).toHaveLength(4);
    expect(calls).toEqual({ create: 4, update: 0, createIfAbsent: 0 });
  });

  it("stores each Period once when two applies of the same bundle overlap", async () => {
    const files = exportBundle(SOURCE).behaviorLog.files;
    for (const [first, second] of [["import", "import"], ["restore", "restore"], ["import", "restore"]] as const) {
      const { store, rows, calls } = memoryPeriodStore([], { ifAbsent: true });
      // Both read the empty account before either saves, so both plan four creates.
      const outcomes = await Promise.all([
        applyBehaviorLogPeriods(store, files, first),
        applyBehaviorLogPeriods(store, files, second, { setNotes: false }),
      ]);
      expect(calls).toEqual({ create: 0, update: 0, createIfAbsent: 8 });
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map(periodNaturalKey)).size).toBe(4);
      // Each Period is added by one apply and reported as already saved by the other.
      expect(outcomes[0]!.added + outcomes[1]!.added).toBe(4);
      expect(outcomes[0]!.existing + outcomes[1]!.existing).toBe(4);
      expect(outcomes.map((outcome) => outcome!.failed + outcome!.overLimit)).toEqual([0, 0]);
    }
  });

  it("keeps the note of the Period that was saved first when overlapping applies disagree", async () => {
    const { store, rows } = memoryPeriodStore([], { ifAbsent: true });
    await Promise.all([
      applyBehaviorLogPeriods(store, reviewFiles([periodReview({}, { note: "First" })]), "import"),
      applyBehaviorLogPeriods(store, reviewFiles([periodReview({}, { note: "Second" })]), "import"),
    ]);
    expect(rows.map((row) => row.note)).toEqual(["First"]);
  });

  it("without createPeriodIfAbsent, overlapping applies can store a Period twice (store fallback)", async () => {
    const files = exportBundle(SOURCE.slice(0, 1)).behaviorLog.files;
    const { store, rows } = memoryPeriodStore();
    expect(store.createPeriodIfAbsent).toBeUndefined();
    await Promise.all([applyBehaviorLogPeriods(store, files, "import"), applyBehaviorLogPeriods(store, files, "import")]);
    expect(rows).toHaveLength(2);
  });

  it("counts a cap refusal from createPeriodIfAbsent as not fitting, and does not throw", async () => {
    const files = exportBundle(SOURCE).behaviorLog.files;
    const { store, rows, calls } = memoryPeriodStore([], { limit: 1, ifAbsent: true });
    expect(await applyBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 1, overLimit: 3, failed: 0 });
    expect(rows).toHaveLength(1);
    expect(calls.createIfAbsent).toBe(2);
  });

  it("finishes a partly saved import on the next run", async () => {
    const files = exportBundle(SOURCE).behaviorLog.files;
    const { store, rows } = memoryPeriodStore();
    let fail = 2;
    const flaky = { ...store, createPeriod: async (input: Parameters<typeof store.createPeriod>[0]) => {
      if (fail-- > 0) throw new Error("network");
      return store.createPeriod(input);
    } };
    expect(await applyBehaviorLogPeriods(flaky, files, "import")).toMatchObject({ added: 2, failed: 2 });
    expect(await applyBehaviorLogPeriods(flaky, files, "import")).toMatchObject({ added: 2, existing: 2, failed: 0 });
    expect(new Set(rows.map(periodNaturalKey)).size).toBe(4);
  });

  it("adds a Period beside one whose label was edited after the export (known limitation)", async () => {
    const files = exportBundle(SOURCE.slice(0, 1)).behaviorLog.files;
    const { store, rows } = memoryPeriodStore([period({ id: SOURCE[0]!.id, label: "Flu week", note: "Flu" })]);
    expect(await applyBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 1, existing: 0 });
    // The same id in the file does not help: matching is by label and dates only.
    expect(rows.map((row) => row.label)).toEqual(["Flu week", "Sick"]);
  });

  it("treats a file from another account like its own: ids are ignored", async () => {
    const other = SOURCE.map((row, index) => ({ ...row, id: `90000000-0000-4000-8000-00000000000${index}`, user_id: "other-user" }));
    const files = exportBundle(other, { userId: "other-user" }).behaviorLog.files;
    // This account already has "Sick" under a different id, and an unrelated Period under one of the file's ids.
    const { store, rows } = memoryPeriodStore([
      period({ id: "mine", label: "Sick", start_on: "2026-06-01", end_on: "2026-06-03", note: "My words" }),
      period({ id: other[1]!.id, label: "Unrelated", start_on: "2026-01-01", end_on: "2026-01-02" }),
    ]);
    expect(await applyBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 3, existing: 1, failed: 0 });
    expect(rows.find((row) => row.id === "mine")!.note).toBe("My words");
    expect(rows.find((row) => row.id === other[1]!.id)).toMatchObject({ label: "Unrelated", start_on: "2026-01-01" });
    expect(rows).toHaveLength(5);
  });

  it("never changes or removes a stored Period on import", async () => {
    const files = exportBundle([period({ note: "From file" })]).behaviorLog.files;
    const initial = [period({ id: "match", note: "Mine" }), period({ id: "unnamed", label: "Not in the file", start_on: "2026-03-01", end_on: null })];
    const { store, rows, calls } = memoryPeriodStore(initial);
    expect(await applyBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 0, existing: 1, notesSet: 0 });
    expect(rows).toEqual(initial);
    expect(calls).toEqual({ create: 0, update: 0, createIfAbsent: 0 });
  });

  it("restore sets the note of a matching Period: absent keeps, null clears", async () => {
    const initial = [
      period({ id: "set", label: "Set", note: "Old" }),
      period({ id: "clear", label: "Clear", note: "Old" }),
      period({ id: "absent", label: "Absent", note: "Old" }),
      period({ id: "same", label: "Same", note: "Old" }),
      period({ id: "unnamed", label: "Unnamed", note: "Old" }),
    ];
    const files = reviewFiles([
      periodReview({ review_id: "1" }, { label: "Set", note: "New" }),
      periodReview({ review_id: "2" }, { label: "Clear", note: null }),
      periodReview({ review_id: "3" }, { label: "Absent" }),
      periodReview({ review_id: "4" }, { label: "Same", note: "Old" }),
      periodReview({ review_id: "5" }, { label: "Added", note: "Brand new" }),
    ]);
    const { store, rows } = memoryPeriodStore(initial);
    expect(await previewBehaviorLogPeriods(store, files, "restore")).toMatchObject({ added: 1, existing: 4, notesSet: 2 });
    expect(await applyBehaviorLogPeriods(store, files, "restore")).toEqual({
      mode: "restore", unavailable: false, added: 1, notesSet: 2, existing: 4, overLimit: 0, failed: 0, skippedCount: 0,
    });
    expect(Object.fromEntries(rows.map((row) => [row.label, row.note]))).toEqual({
      Set: "New", Clear: null, Absent: "Old", Same: "Old", Unnamed: "Old", Added: "Brand new",
    });
    // Only the note changed on a matched Period.
    expect(rows.find((row) => row.id === "set")).toMatchObject({ label: "Set", start_on: "2026-06-01", end_on: "2026-06-03", revision: 2 });
    // Applying again changes nothing.
    expect(await applyBehaviorLogPeriods(store, files, "restore")).toMatchObject({ added: 0, notesSet: 0, existing: 5 });
  });

  it("an export without notes restores without touching stored notes", async () => {
    const files = exportBundle([period({ note: "Secret" })], { includeNotes: false }).behaviorLog.files;
    const { store, rows } = memoryPeriodStore([period({ id: "mine", note: "Mine" })]);
    expect(await applyBehaviorLogPeriods(store, files, "restore")).toMatchObject({ existing: 1, notesSet: 0 });
    expect(rows[0]!.note).toBe("Mine");
  });

  it("a retried restore keeps a note edited since the first run", async () => {
    const files = reviewFiles([periodReview({}, { note: "From file" })]);
    const { store, rows } = memoryPeriodStore([period({ note: "Edited after the restore" })]);
    expect(await applyBehaviorLogPeriods(store, files, "restore", { setNotes: false })).toMatchObject({ existing: 1, notesSet: 0 });
    expect(rows[0]!.note).toBe("Edited after the restore");
  });

  it("reports a Period that changed between the plan and the save, and leaves it", async () => {
    const files = reviewFiles([periodReview({}, { note: "From file" })]);
    const { store, rows } = memoryPeriodStore([period({ note: "Mine", revision: 3 })]);
    const stale = { ...store, listPeriods: async () => [period({ note: "Mine", revision: 2 })] };
    expect(await applyBehaviorLogPeriods(stale, files, "restore")).toMatchObject({ existing: 1, notesSet: 0, failed: 1 });
    expect(rows[0]!.note).toBe("Mine");
  });

  it("never passes the cap: preview reports what does not fit and apply adds the rest", async () => {
    const stored = Array.from({ length: 498 }, (_, index) => period({ id: `stored-${index}`, label: `Stored ${index}` }));
    const files = exportBundle(SOURCE).behaviorLog.files;
    for (const mode of ["import", "restore"] as const) {
      const { store, rows, calls } = memoryPeriodStore(stored);
      expect(await previewBehaviorLogPeriods(store, files, mode)).toMatchObject({ added: 2, existing: 0, overLimit: 2 });
      expect(await applyBehaviorLogPeriods(store, files, mode)).toMatchObject({ added: 2, overLimit: 2, failed: 0 });
      expect(rows).toHaveLength(500);
      // Display order decides which fit: the two earliest first days.
      expect(rows.slice(-2).map((row) => row.label)).toEqual(["Night shifts", "Sick"]);
      expect(calls.create).toBe(2);
    }
  });

  it("does not throw when the store refuses a Period at the cap", async () => {
    const files = exportBundle(SOURCE).behaviorLog.files;
    // The plan sees an empty account; another writer has filled it to one below the cap.
    const { store, rows, calls } = memoryPeriodStore([], { limit: 1 });
    const outcome = await applyBehaviorLogPeriods(store, files, "import");
    expect(outcome).toMatchObject({ added: 1, overLimit: 3, failed: 0 });
    expect(rows).toHaveLength(1);
    // After the first refusal no further create is sent.
    expect(calls.create).toBe(2);
    expect(PERIOD_LIMIT_MESSAGE).toContain("500");
  });

  it("returns an unavailable outcome when the stored Periods cannot be read", async () => {
    const files = exportBundle(SOURCE).behaviorLog.files;
    const { store, calls } = memoryPeriodStore();
    const broken = { ...store, listPeriods: async () => { throw new Error("offline"); } };
    expect(await previewBehaviorLogPeriods(broken, files, "import")).toMatchObject({ unavailable: true });
    expect(await applyBehaviorLogPeriods(broken, files, "restore")).toMatchObject({ unavailable: true, added: 0 });
    expect(calls.create).toBe(0);
  });

  it("skips invalid Period records and still saves the valid ones", async () => {
    const files = reviewFiles([
      periodReview({ review_id: "bad-label" }, { label: "" }),
      periodReview({ review_id: "backwards", period_end_local_date: "2026-05-01" }),
      periodReview({ review_id: "good" }, { label: "Travel" }),
    ]);
    const { store, rows } = memoryPeriodStore();
    expect(await previewBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 1, skippedCount: 2 });
    expect(await applyBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 1, skippedCount: 2, failed: 0 });
    expect(rows.map((row) => row.label)).toEqual(["Travel"]);
  });

  it("leaves day-note reviews in the same file to the day-note step", async () => {
    const dayNote = { id: "60000000-0000-4000-8000-000000000001", local_date: "2026-06-02", note: "Slept badly", created_at: "2026-06-02T12:00:00Z", updated_at: "2026-06-02T12:00:00Z" };
    const files = exportBundle(SOURCE.slice(0, 1), { dayNotes: [dayNote] }).behaviorLog.files;
    const { store, rows } = memoryPeriodStore();
    expect(await applyBehaviorLogPeriods(store, files, "import")).toMatchObject({ added: 1, skippedCount: 0 });
    expect(rows.map((row) => row.label)).toEqual(["Sick"]);
  });
});
