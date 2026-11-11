import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import type { DayNoteDataStore, DayNoteSaveCommit } from "@cadence/core/data-store";
import {
  BEHAVIORLOG_DAY_NOTE_REVIEWS_PATH,
  describeBehaviorLogDayNoteOutcome,
  planBehaviorLogDayNoteWrites,
  previewBehaviorLogDayNoteOutcome,
  readBehaviorLogDayNoteReviews,
  withBehaviorLogDayNoteMessage,
} from "@cadence/core/resolvers/behaviorlog-day-note.resolver";
import type { DayNoteRecord } from "@cadence/core/resolvers/day-note.resolver";
import { applyBehaviorLogDayNotes, previewBehaviorLogDayNotes } from "@cadence/core/services/behaviorlog-day-note.service";
import { resolveExportBundle } from "../lib/resolvers/export.resolver";
import type { ExportDayNoteInput } from "../lib/types/export";
import { resolveBehaviorLogImportPreview } from "../lib/resolvers/behaviorlog-import.resolver";

const TIMEZONE = "America/New_York";
const NOW = Temporal.Instant.from("2026-06-10T16:00:00Z");

function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_type: "review",
    review_id: "60000000-0000-4000-8000-000000000001",
    period_start_local_date: "2026-06-07",
    period_end_local_date: "2026-06-07",
    timezone: TIMEZONE,
    created_at_utc: "2026-06-07T12:00:00Z",
    review_role: "user",
    summary_markdown: "Sick",
    barriers_markdown: null,
    adjustments_markdown: null,
    extensions: { "app.cadence": { day_note: true, updated_at_utc: "2026-06-07T12:00:00Z" } },
    ...overrides,
  };
}

function reviewsFile(records: unknown[]) {
  return { path: BEHAVIORLOG_DAY_NOTE_REVIEWS_PATH, content: `${records.map((record) => JSON.stringify(record)).join("\n")}\n` };
}

function memoryStore(initial: Record<string, string | null> = {}) {
  const rows = new Map<string, DayNoteRecord>();
  let sequence = 0;
  const put = (localDate: string, note: string | null, previous?: DayNoteRecord): DayNoteRecord => {
    const record: DayNoteRecord = {
      id: previous?.id ?? `day-note-${++sequence}`, user_id: "user-1", local_date: localDate, note,
      revision: (previous?.revision ?? 0) + 1, created_at: previous?.created_at ?? NOW.toString(), updated_at: NOW.toString(),
    };
    rows.set(localDate, record);
    return record;
  };
  for (const [date, note] of Object.entries(initial)) put(date, note);
  const saves: DayNoteSaveCommit[] = [];
  const store: DayNoteDataStore = {
    listDayNotes: async ({ from, to }) => [...rows.values()].filter((row) => row.local_date >= from && row.local_date <= to),
    saveDayNote: async (input) => {
      saves.push(input);
      const stored = rows.get(input.localDate);
      if ((stored?.note ?? null) !== input.expectedNote) return null;
      return put(input.localDate, input.note, stored);
    },
  };
  const notes = () => Object.fromEntries([...rows.values()].filter((row) => row.note).sort((a, b) => a.local_date.localeCompare(b.local_date)).map((row) => [row.local_date, row.note]));
  return { store, saves, rows, notes };
}

function exportBundle(dayNotes: ExportDayNoteInput[]) {
  return resolveExportBundle({
    profile: { timezone: TIMEZONE, subjectId: "subject_test", producerName: "Cadence Tracker", producerVersion: "0.1.0" },
    categories: [], behaviors: [], occurrences: [], now: NOW, timezone: TIMEZONE, range: "all", includeNotes: true, dayNotes,
  });
}

describe("reading Cadence day-note reviews from BehaviorLog", () => {
  it("reads only Cadence day-note reviews and normalizes their text", () => {
    const read = readBehaviorLogDayNoteReviews([reviewsFile([
      review({ summary_markdown: "  Sick\r\nStayed in  " }),
      review({ review_id: "other-review", extensions: {} }),
      review({ review_id: "coach-review", review_role: "coach", extensions: { "app.cadence": { day_note: false } } }),
      { record_type: "behavior", behavior_id: "b-1" },
    ])]);
    expect(read).toEqual({ reviews: [{ externalId: "60000000-0000-4000-8000-000000000001", localDate: "2026-06-07", note: "Sick\nStayed in" }], skipped: [] });
  });

  it("returns nothing when the bundle has no reviews file", () => {
    expect(readBehaviorLogDayNoteReviews([{ path: "data/behaviors.jsonl", content: "" }])).toEqual({ reviews: [], skipped: [] });
  });

  it("skips invalid day-note reviews and dates with different duplicate notes", () => {
    const read = readBehaviorLogDayNoteReviews([reviewsFile([
      review({ review_id: "multi-day", period_end_local_date: "2026-06-08" }),
      review({ review_id: "bad-date", period_start_local_date: "2026-02-30", period_end_local_date: "2026-02-30" }),
      review({ review_id: "empty", summary_markdown: "   " }),
      review({ review_id: "long", summary_markdown: "x".repeat(2_001) }),
      review({ review_id: "ai", review_role: "ai" }),
      review({ review_id: "dup-a", period_start_local_date: "2026-06-09", period_end_local_date: "2026-06-09", summary_markdown: "A" }),
      review({ review_id: "dup-b", period_start_local_date: "2026-06-09", period_end_local_date: "2026-06-09", summary_markdown: "B" }),
      review({ review_id: "same-a", period_start_local_date: "2026-06-10", period_end_local_date: "2026-06-10", summary_markdown: "Same" }),
      review({ review_id: "same-b", period_start_local_date: "2026-06-10", period_end_local_date: "2026-06-10", summary_markdown: "Same" }),
    ])]);
    expect(read.reviews).toEqual([{ externalId: "same-a", localDate: "2026-06-10", note: "Same" }]);
    expect(read.skipped.map((entry) => entry.externalId)).toEqual(["multi-day", "bad-date", "empty", "long", "ai", "dup-a", "dup-b"]);
  });
});

describe("planning day-note writes", () => {
  const read = readBehaviorLogDayNoteReviews([reviewsFile([
    review(),
    review({ review_id: "r-2", period_start_local_date: "2026-06-08", period_end_local_date: "2026-06-08", summary_markdown: "Travel day" }),
    review({ review_id: "r-3", period_start_local_date: "2026-06-09", period_end_local_date: "2026-06-09", summary_markdown: "Rest" }),
  ])]);
  const existing = [
    { local_date: "2026-06-07", note: "Sick" },
    { local_date: "2026-06-08", note: "Different" },
    { local_date: "2026-06-09", note: null },
  ];

  it("reports a different saved note as an import conflict instead of overwriting it", () => {
    const plan = planBehaviorLogDayNoteWrites({ read, existing, mode: "import" });
    expect(plan.actions.map((action) => [action.localDate, action.action])).toEqual([
      ["2026-06-07", "keep"], ["2026-06-08", "conflict"], ["2026-06-09", "create"],
    ]);
    const outcome = previewBehaviorLogDayNoteOutcome(plan);
    expect(describeBehaviorLogDayNoteOutcome(outcome, "preview")).toBe(
      "Day notes: 1 to add, 1 already saved. 1 day already has a different day note, which this import will not change: 2026-06-08.",
    );
  });

  it("replaces a different saved note on restore", () => {
    const plan = planBehaviorLogDayNoteWrites({ read, existing, mode: "restore" });
    expect(plan.actions.map((action) => [action.localDate, action.action, action.existingNote])).toEqual([
      ["2026-06-07", "keep", "Sick"], ["2026-06-08", "replace", "Different"], ["2026-06-09", "create", null],
    ]);
    expect(describeBehaviorLogDayNoteOutcome(previewBehaviorLogDayNoteOutcome(plan), "preview")).toBe("Day notes: 1 to add, 1 to replace, 1 already saved.");
  });

  it("keeps a different saved note on a retried restore and still fills empty dates", () => {
    const plan = planBehaviorLogDayNoteWrites({ read, existing, mode: "restore", replaceDifferent: false });
    expect(plan.actions.map((action) => [action.localDate, action.action])).toEqual([
      ["2026-06-07", "keep"], ["2026-06-08", "conflict"], ["2026-06-09", "create"],
    ]);
    expect(describeBehaviorLogDayNoteOutcome(previewBehaviorLogDayNoteOutcome(plan), "applied")).toBe(
      "Day notes: 1 added, 1 already saved. 1 day already has a different day note, which this restore did not change: 2026-06-08.",
    );
  });

  it("leaves status messages unchanged when the bundle has no day notes", () => {
    expect(withBehaviorLogDayNoteMessage("BehaviorLog import applied.", null, "applied")).toBe("BehaviorLog import applied.");
  });
});

describe("restoring and importing day notes", () => {
  const exported: ExportDayNoteInput[] = [
    { id: "60000000-0000-4000-8000-000000000001", localDate: "2026-06-07", note: "Sick\nStayed in", createdAt: "2026-06-07T12:00:00Z", updatedAt: "2026-06-07T12:00:00Z" },
    { id: "60000000-0000-4000-8000-000000000002", localDate: "2026-06-08", note: "Travel day", createdAt: "2026-06-08T12:00:00Z", updatedAt: "2026-06-08T13:00:00Z" },
    { id: "60000000-0000-4000-8000-000000000003", localDate: "2026-06-06", note: null, createdAt: "2026-06-06T12:00:00Z", updatedAt: "2026-06-06T12:30:00Z" },
  ];

  it("reproduces the exported day notes after export and destructive restore", async () => {
    const bundle = exportBundle(exported);
    expect(resolveBehaviorLogImportPreview({ files: bundle.behaviorLog.files }).valid).toBe(true);
    const target = memoryStore({ "2026-06-07": "Changed after the backup", "2026-06-08": null });

    const outcome = await applyBehaviorLogDayNotes(target.store, bundle.behaviorLog.files, "restore");

    expect(target.notes()).toEqual(Object.fromEntries(bundle.jsonBackup.day_notes!.map((note) => [note.local_date, note.note])));
    expect(target.notes()).toEqual({ "2026-06-07": "Sick\nStayed in", "2026-06-08": "Travel day" });
    expect(outcome).toEqual({ mode: "restore", unavailable: false, saved: { create: 1, replace: 1 }, kept: 0, conflictDates: [], failedDates: [], skippedCount: 0 });

    const again = await applyBehaviorLogDayNotes(target.store, bundle.behaviorLog.files, "restore");
    expect(again).toMatchObject({ saved: { create: 0, replace: 0 }, kept: 2 });
    expect(target.saves).toHaveLength(2);
  });

  it("imports new day notes and keeps a different saved note", async () => {
    const bundle = exportBundle(exported);
    const target = memoryStore({ "2026-06-07": "Mine" });

    expect(await previewBehaviorLogDayNotes(target.store, bundle.behaviorLog.files, "import")).toMatchObject({ saved: { create: 1, replace: 0 }, conflictDates: ["2026-06-07"] });
    const outcome = await applyBehaviorLogDayNotes(target.store, bundle.behaviorLog.files, "import");

    expect(target.notes()).toEqual({ "2026-06-07": "Mine", "2026-06-08": "Travel day" });
    expect(describeBehaviorLogDayNoteOutcome(outcome!, "applied")).toBe(
      "Day notes: 1 added. 1 day already has a different day note, which this import did not change: 2026-06-07.",
    );
  });

  it("reports a note changed after planning as a conflict and a failed save by date", async () => {
    const bundle = exportBundle(exported);
    const target = memoryStore();
    const store: DayNoteDataStore = {
      listDayNotes: target.store.listDayNotes,
      saveDayNote: async (input) => {
        if (input.localDate === "2026-06-07") return null;
        throw new Error("offline");
      },
    };
    expect(await applyBehaviorLogDayNotes(store, bundle.behaviorLog.files, "import")).toEqual({
      mode: "import", unavailable: false,
      saved: { create: 0, replace: 0 }, kept: 0, conflictDates: ["2026-06-07"], failedDates: ["2026-06-08"], skippedCount: 0,
    });
  });

  it("uses restore wording when a restore save finds a changed note", async () => {
    const bundle = exportBundle(exported);
    const target = memoryStore();
    const store: DayNoteDataStore = { listDayNotes: target.store.listDayNotes, saveDayNote: async () => null };
    const outcome = await applyBehaviorLogDayNotes(store, bundle.behaviorLog.files, "restore");
    expect(describeBehaviorLogDayNoteOutcome(outcome!, "applied")).toBe(
      "2 days already have a different day note, which this restore did not change: 2026-06-07, 2026-06-08.",
    );
  });

  it("never throws when the saved day notes cannot be read", async () => {
    const bundle = exportBundle(exported);
    const store: DayNoteDataStore = {
      listDayNotes: async () => { throw new Error("network down"); },
      saveDayNote: async () => { throw new Error("must not save"); },
    };
    const restored = await applyBehaviorLogDayNotes(store, bundle.behaviorLog.files, "restore");
    const imported = await applyBehaviorLogDayNotes(store, bundle.behaviorLog.files, "import");
    const previewed = await previewBehaviorLogDayNotes(store, bundle.behaviorLog.files, "import");
    expect(restored).toMatchObject({ mode: "restore", unavailable: true, saved: { create: 0, replace: 0 } });
    expect(withBehaviorLogDayNoteMessage("BehaviorLog restore applied.", restored, "applied")).toBe(
      "BehaviorLog restore applied. Day notes could not be restored. Your other data was restored. Apply this restore again to add the day notes.",
    );
    expect(withBehaviorLogDayNoteMessage("BehaviorLog import applied.", imported, "applied")).toBe(
      "BehaviorLog import applied. Day notes could not be imported. Your other data was imported. Preview and apply the bundle again to add the day notes.",
    );
    expect(describeBehaviorLogDayNoteOutcome(previewed!, "preview")).toBe("Day notes could not be checked. Preview the bundle again to include them.");
  });

  it("does nothing when the export left notes out", async () => {
    const bundle = resolveExportBundle({
      profile: { timezone: TIMEZONE, subjectId: "subject_test", producerName: "Cadence Tracker", producerVersion: "0.1.0" },
      categories: [], behaviors: [], occurrences: [], now: NOW, timezone: TIMEZONE, range: "all", includeNotes: false, dayNotes: exported,
    });
    const target = memoryStore({ "2026-06-07": "Mine" });
    expect(await applyBehaviorLogDayNotes(target.store, bundle.behaviorLog.files, "restore")).toBeNull();
    expect(target.saves).toHaveLength(0);
  });
});
