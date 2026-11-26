import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { resolveBehaviorLogImportPreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { readBehaviorLogDayNoteReviews } from "@cadence/core/resolvers/behaviorlog-day-note.resolver";

import { EXPORT_TODAY, cadenceExtension, exportBundle, exportBytes, period, reviews } from "./helpers/period-portability-fixture";

/**
 * Ticket 373: Full JSON and BehaviorLog carry Periods. An account without Periods
 * exports the bytes it exported before.
 */

const DAY_NOTE = { id: "60000000-0000-4000-8000-000000000001", local_date: "2026-06-02", note: "Slept badly", created_at: "2026-06-02T12:00:00Z", updated_at: "2026-06-02T12:00:00Z" };

describe("Period export (Ticket 373)", () => {
  it("writes the same bytes when no Period is exported", () => {
    const before = exportBytes(exportBundle(undefined));
    expect(exportBytes(exportBundle([]))).toBe(before);
    // A Period outside a 7-day range is not exported.
    const old = period({ start_on: "2026-01-01", end_on: "2026-01-05" });
    expect(exportBytes(exportBundle([old], { range: 7 }))).toBe(exportBytes(exportBundle(undefined, { range: 7 })));
    expect(exportBundle([]).jsonBackup).not.toHaveProperty("periods");
    expect(exportBundle([]).behaviorLog.files.some((file) => file.path === "data/reviews.jsonl")).toBe(false);
  });

  it("adds a periods array to Full JSON, after the existing keys", () => {
    const bundle = exportBundle([period({ note: "Flu" })]);
    expect(bundle.jsonBackup.periods).toEqual([{
      id: "70000000-0000-4000-8000-000000000001", label: "Sick", start_on: "2026-06-01", end_on: "2026-06-03", note: "Flu",
      created_at: "2026-06-01T12:00:00Z", updated_at: "2026-06-01T12:00:00Z",
    }]);
    expect(Object.keys(JSON.parse(bundle.json) as object).at(-1)).toBe("periods");
  });

  it("keeps the label and drops the note when notes are not included", () => {
    const bundle = exportBundle([period({ note: "Flu" })], { includeNotes: false });
    expect(bundle.jsonBackup.periods).toHaveLength(1);
    expect(bundle.jsonBackup.periods![0]).not.toHaveProperty("note");
    expect(bundle.jsonBackup.periods![0]!.label).toBe("Sick");
    const [review] = reviews(bundle.behaviorLog.files);
    expect(review!.summary_markdown).toBe("Sick");
    expect(cadenceExtension(review!)).toEqual({ period: true, label: "Sick", ongoing: false, updated_at_utc: "2026-06-01T12:00:00Z" });
    expect(exportBytes(bundle)).not.toContain("Flu");
  });

  it("exports a Period with no note as an explicit null when notes are included", () => {
    const bundle = exportBundle([period()]);
    expect(bundle.jsonBackup.periods![0]).toHaveProperty("note", null);
    expect(cadenceExtension(reviews(bundle.behaviorLog.files)[0]!)).toEqual({ period: true, label: "Sick", ongoing: false, note: null, updated_at_utc: "2026-06-01T12:00:00Z" });
  });

  it("keeps only Periods with a day inside the range", () => {
    const periods = [
      period({ id: "a", label: "Before", start_on: "2026-05-20", end_on: "2026-06-01" }),
      period({ id: "b", label: "Edge", start_on: "2026-05-20", end_on: "2026-06-02" }),
      period({ id: "c", label: "Ongoing", start_on: "2026-01-01", end_on: null }),
      period({ id: "d", label: "Today", start_on: EXPORT_TODAY, end_on: EXPORT_TODAY }),
      period({ id: "e", label: "Tomorrow", start_on: "2026-06-09", end_on: null }),
    ];
    // 7 days ending June 8 is June 2 to June 8.
    expect(exportBundle(periods, { range: 7 }).jsonBackup.periods!.map((row) => row.label)).toEqual(["Ongoing", "Edge", "Today"]);
    expect(exportBundle(periods).jsonBackup.periods!.map((row) => row.label)).toEqual(["Ongoing", "Before", "Edge", "Today", "Tomorrow"]);
  });

  it("writes one user review per Period with the Cadence extension", () => {
    const bundle = exportBundle([period({ note: "Flu", updated_at: "2026-06-04T09:00:00Z" })]);
    const [review] = reviews(bundle.behaviorLog.files);
    expect(review).toMatchObject({
      record_type: "review", review_id: "70000000-0000-4000-8000-000000000001", period_start_local_date: "2026-06-01",
      period_end_local_date: "2026-06-03", timezone: "America/New_York", created_at_utc: "2026-06-01T12:00:00Z",
      review_role: "user", summary_markdown: "Sick",
    });
    expect(cadenceExtension(review!)).toEqual({ period: true, label: "Sick", ongoing: false, note: "Flu", updated_at_utc: "2026-06-04T09:00:00Z" });
    const manifest = JSON.parse(bundle.behaviorLog.files.find((file) => file.path === "manifest.json")!.content) as { files: { path: string; schema_ref: string }[] };
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: "data/reviews.jsonl", schema_ref: "#/$defs/Review" })]));
  });

  it("ends an ongoing Period on the export's last date, and never before its first day", () => {
    const bundle = exportBundle([
      period({ id: "past", label: "Travel", start_on: "2026-05-01", end_on: null }),
      period({ id: "future", label: "Leave", start_on: "2026-07-01", end_on: null }),
    ]);
    const [past, future] = reviews(bundle.behaviorLog.files);
    expect(past).toMatchObject({ period_start_local_date: "2026-05-01", period_end_local_date: EXPORT_TODAY });
    expect(future).toMatchObject({ period_start_local_date: "2026-07-01", period_end_local_date: "2026-07-01" });
    expect(cadenceExtension(past!).ongoing).toBe(true);
    expect(cadenceExtension(future!).ongoing).toBe(true);
    expect(bundle.jsonBackup.periods!.map((row) => row.end_on)).toEqual([null, null]);
  });

  it("orders overlapping Periods and day notes in one deterministic order", () => {
    const periods = [
      period({ id: "p3", label: "Ongoing", start_on: "2026-06-02", end_on: null }),
      period({ id: "p2", label: "Long", start_on: "2026-06-02", end_on: "2026-06-06" }),
      period({ id: "p1", label: "Sick", start_on: "2026-06-01", end_on: "2026-06-03" }),
      period({ id: "p4", label: "Short", start_on: "2026-06-02", end_on: "2026-06-02" }),
    ];
    const order = (list: typeof periods) => reviews(exportBundle(list, { dayNotes: [DAY_NOTE] }).behaviorLog.files).map((review) => review.summary_markdown);
    expect(order(periods)).toEqual(["Sick", "Slept badly", "Short", "Long", "Ongoing"]);
    expect(order([...periods].reverse())).toEqual(order(periods));
    // Each overlapping Period is its own record; the day-note reader ignores them all.
    const files = exportBundle(periods, { dayNotes: [DAY_NOTE] }).behaviorLog.files;
    expect(readBehaviorLogDayNoteReviews(files)).toEqual({ reviews: [{ externalId: DAY_NOTE.id, localDate: "2026-06-02", note: "Slept badly" }], skipped: [] });
  });

  it("carries no Period in JSONL, CSV or Markdown", () => {
    const withPeriod = exportBundle([period({ label: "Zzyzx", note: "Qwfp" })]);
    const without = exportBundle(undefined);
    expect(withPeriod.jsonl).toBe(without.jsonl);
    expect(withPeriod.csv).toBe(without.csv);
    expect(withPeriod.markdownSummary).toBe(without.markdownSummary);
  });

  it("stays a valid BehaviorLog bundle for the importer and the vendored reference validator", async () => {
    const files = exportBundle([
      period({ note: "Flu" }),
      period({ id: "70000000-0000-4000-8000-000000000002", label: "Leave", start_on: "2026-07-01", end_on: null }),
    ], { dayNotes: [DAY_NOTE] }).behaviorLog.files;
    expect(resolveBehaviorLogImportPreview({ files }).valid).toBe(true);
    const manifest = JSON.parse(files.find((file) => file.path === "manifest.json")!.content) as { files: { path: string; sha256: string }[] };
    const reviewFile = files.find((file) => file.path === "data/reviews.jsonl")!;
    expect(manifest.files.find((file) => file.path === reviewFile.path)!.sha256).toBe(createHash("sha256").update(reviewFile.content).digest("hex"));
    const root = await mkdtemp(path.join(tmpdir(), "cadence-periods-"));
    const bundlePath = path.join(root, "cadence.behaviorlog");
    try {
      for (const file of files) {
        await mkdir(path.dirname(path.join(bundlePath, file.path)), { recursive: true });
        await writeFile(path.join(bundlePath, file.path), file.content, "utf8");
      }
      const result = spawnSync(process.execPath, ["scripts/behaviorlog-conformance.mjs", bundlePath], { cwd: process.cwd(), encoding: "utf8" });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("BehaviorLog bundle valid:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
