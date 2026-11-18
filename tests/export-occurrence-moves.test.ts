import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import { assembleExportBundle, type ExportAssemblyInput } from "@cadence/core/services/export-assembly";
import { sha256 } from "@cadence/core/hash";
import type { ExportOccurrenceMoveInput } from "@cadence/core/types/export";
import { USER_ID, storedBehavior, storedConfigurationEvent, storedExportOccurrence } from "./helpers/export-row-fixture";

const input: ExportAssemblyInput = {
  userId: USER_ID, timezone: "America/New_York", now: Temporal.Instant.from("2026-06-08T16:00:00Z"), range: "all",
  categories: [], behaviors: [storedBehavior()], behaviorDefinitionEvents: [],
  behaviorConfigurationEvents: [storedConfigurationEvent()], occurrences: [storedExportOccurrence()],
  statusEvents: [], reminderDeliveries: [], timeSessions: [],
};
const occurrence = storedExportOccurrence();
const move: ExportOccurrenceMoveInput = {
  id: "move-1", occurrenceId: occurrence.id, behaviorId: occurrence.behavior_id, localDate: occurrence.local_date,
  timezone: "America/New_York", kind: "move", fromStartAt: "2026-05-01T13:00:00Z", fromEndAt: "2026-05-01T13:30:00Z",
  fromPlanned: true, toStartAt: "2026-05-01T16:00:00Z", toEndAt: "2026-05-01T16:30:00Z", toPlanned: false,
  durationSource: "behavior_duration", chainPosition: 1, revisesMoveId: null, reason: "calendar_overlap",
  personReason: "running_late", source: "daily_brief", createdAt: "2026-05-01T12:00:00Z",
};
const undo: ExportOccurrenceMoveInput = {
  ...move, id: "move-2", kind: "revert", fromStartAt: move.toStartAt, fromEndAt: move.toEndAt, fromPlanned: false,
  toStartAt: move.fromStartAt, toEndAt: move.fromEndAt, toPlanned: true, durationSource: "restored", chainPosition: 2,
  revisesMoveId: "move-1", reason: null, personReason: null, source: "person", createdAt: "2026-05-01T12:05:00Z",
};

describe("occurrence move export extension (advisor Phase 2A)", () => {
  it("adds ordered move records under app.cadence without changing the other formats", () => {
    const plain = assembleExportBundle(input);
    const withMoves = assembleExportBundle({ ...input, occurrenceMoves: [undo, move, { ...move, id: "elsewhere", occurrenceId: "other" }] });
    expect([withMoves.jsonl, withMoves.csv, withMoves.json, withMoves.markdownSummary])
      .toEqual([plain.jsonl, plain.csv, plain.json, plain.markdownSummary]);
    const file = withMoves.behaviorLog.files.find(({ path }) => path === "raw/cadence/occurrence_moves.jsonl");
    expect(file).toBeDefined();
    const rows = file!.content.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => row.id)).toEqual(["move-1", "move-2"]);
    expect(rows[0]).toEqual({
      id: "move-1", occurrence_id: occurrence.id, behavior_id: occurrence.behavior_id, local_date: occurrence.local_date,
      timezone: "America/New_York", kind: "move",
      from_start_at_utc: "2026-05-01T13:00:00Z", from_end_at_utc: "2026-05-01T13:30:00Z", from_planned: true,
      to_start_at_utc: "2026-05-01T16:00:00Z", to_end_at_utc: "2026-05-01T16:30:00Z", to_planned: false,
      duration_source: "behavior_duration", chain_position: 1, revises_move_id: null, reason: "calendar_overlap",
      person_reason: "running_late", source: "daily_brief", created_at_utc: "2026-05-01T12:00:00Z",
    });
    expect(rows[1]).toMatchObject({ kind: "revert", to_planned: true, revises_move_id: "move-1" });
    const manifest = JSON.parse(withMoves.behaviorLog.files[0].content);
    expect(manifest.extensions["app.cadence"].occurrence_moves).toEqual({
      path: file!.path, record_count: 2, ordering: ["created_at_utc", "id"], import_restore_support: "export_only",
    });
    expect(manifest.files.find((entry: { path: string }) => entry.path === file!.path).sha256).toBe(sha256(file!.content));
  });

  it("adds no file and no manifest entry without moves", () => {
    const bundle = assembleExportBundle({ ...input, occurrenceMoves: [] });
    expect(bundle.behaviorLog.files.some(({ path }) => path.includes("occurrence_moves"))).toBe(false);
    expect(JSON.parse(bundle.behaviorLog.files[0].content).extensions["app.cadence"]).not.toHaveProperty("occurrence_moves");
  });
});
