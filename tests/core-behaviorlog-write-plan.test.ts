import { describe, expect, it } from "vitest";
import { resolveBehaviorLogImportMergePreview, resolveBehaviorLogImportPreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { resolveBehaviorLogRestorePreview } from "@cadence/core/resolvers/behaviorlog-restore.resolver";
import { existingRecords, planBehaviorLogRestoreWrite } from "@cadence/core/services/behaviorlog-write-plan";
import { planBehaviorLogImportWrite } from "@cadence/core/services/behaviorlog-import-plan";
import { sha256 } from "@cadence/core/hash";
import { emptyPortabilitySnapshot, fixtureIds, portabilityApplyRun, portabilityFiles, richPortabilityFiles, PORTABILITY_NOW } from "./helpers/portability-fixture";

function context() { return { snapshot: emptyPortabilitySnapshot(), applyRun: portabilityApplyRun(), newId: fixtureIds(), now: PORTABILITY_NOW }; }
describe("portable accepted BehaviorLog writes", () => {
  it("accepts original schedule dates only with retained source identity and unchanged owned current shape", () => {
    const input = context(), files = portabilityFiles();
    const firstPreview = resolveBehaviorLogImportMergePreview({ files });
    const first = planBehaviorLogImportWrite({ ...input, preview: firstPreview, mode: "create_missing_only", interventionRulesPresent: true });
    const snapshot = { ...input.snapshot, graphs: first.graphWrites.map(({ graph }) => ({ ...graph, revision: 1 })),
      configurationEvents: first.graphWrites.flatMap((write) => write.configurationEvents),
      occurrences: first.occurrenceWrites.map(({ next }) => next), mappings: first.mappings,
      importRuns: [{ ...first.applyRun, status: "applied" }] };
    const preview = () => resolveBehaviorLogImportMergePreview({ files, existing: existingRecords(snapshot) });
    expect(existingRecords(snapshot).schedules?.[0].activeFromLocalDate).toBe("2026-06-08");
    expect(preview().mergePreview.conflicts).toEqual([]);
    const withoutProof = { ...snapshot, importRuns: [] };
    expect(resolveBehaviorLogImportMergePreview({ files, existing: existingRecords(withoutProof) }).mergePreview.conflictCodes).toContain("behavior_schedule_shape_mismatch");
    const foreignMappings = { ...snapshot, mappings: snapshot.mappings.map((row) => ({ ...row, user_id: "another-owner" })) };
    expect(resolveBehaviorLogImportMergePreview({ files, existing: existingRecords(foreignMappings) }).mergePreview.conflictCodes).toContain("behavior_schedule_shape_mismatch");
    snapshot.graphs[0].slots[0].start_time = "21:00:00";
    expect(preview().mergePreview.conflictCodes).toContain("behavior_schedule_shape_mismatch");
    snapshot.graphs[0].slots[0].start_time = "22:00:00";
    snapshot.graphs[0].behavior.created_at = "2026-05-02T12:00:00Z";
    expect(preview().mergePreview.conflictCodes).toContain("behavior_schedule_shape_mismatch");
    snapshot.configurationEvents[0].effective_local_date = "2026-05-01";
    expect(preview().mergePreview.conflictCodes).toContain("behavior_schedule_shape_mismatch");
    snapshot.configurationEvents[0].effective_local_date = "2026-06-08";
    snapshot.graphs[0].behavior.created_at = "2026-05-01T12:00:00Z";
    const schedules = files.find((file) => file.path === "data/schedules.jsonl")!;
    schedules.content = schedules.content.trim().split("\n").map((line) => JSON.stringify({ ...JSON.parse(line), active_from_local_date: "2026-05-02", effective_from_utc: "2026-05-02T12:00:00Z" })).join("\n") + "\n";
    const manifestFile = files.find((file) => file.path === "manifest.json")!, manifest = JSON.parse(manifestFile.content);
    manifest.files.find((file: { path: string }) => file.path === schedules.path).sha256 = sha256(schedules.content);
    manifestFile.content = JSON.stringify(manifest);
    expect(preview().mergePreview.conflictCodes).toContain("behavior_schedule_shape_mismatch");
  });

  it("projects create-only graph, configuration lineage and deterministic review rows without mutating input", () => {
    const input = context(); const original = structuredClone(input.snapshot);
    const preview = resolveBehaviorLogImportMergePreview({ files: portabilityFiles(), existing: existingRecords(input.snapshot) });
    expect(preview.errors).toEqual([]);
    const plan = planBehaviorLogImportWrite({ ...input, preview, mode: "create_missing_only", interventionRulesPresent: true });
    expect(plan.graphWrites).toHaveLength(1);
    expect(plan.graphWrites[0].graph.behavior.title).toBe("Brush teeth");
    expect(plan.definitionEvents).toHaveLength(1);
    expect(plan.graphWrites[0].configurationEvents).toHaveLength(1);
    expect(plan.occurrenceWrites.length).toBeGreaterThan(0);
    expect(plan.occurrenceWrites.every(({ next }) => next.status === "unresolved" && next.behavior_configuration_event_id === null)).toBe(true);
    expect(plan.applyRun.dry_run_summary).toMatchObject({portability: {version:1, configurationEvents: preview.portability!.configurationEvents}});
    expect(plan.result).toMatchObject({ created: { behaviors: 1, schedules: 1, occurrences: 1, mappings: 3 } });
    expect(input.snapshot).toEqual(original);
  });

  it("uses the production restore builder with fixed prepared time and preserves immutable status history", () => {
    const input = context(); const importPreview = resolveBehaviorLogImportPreview({ files: portabilityFiles() });
    const preview = resolveBehaviorLogRestorePreview({ importPreview, existing: existingRecords(input.snapshot) });
    expect(preview.errors).toEqual([]);
    const plan = planBehaviorLogRestoreWrite({ ...input, preview, importPreview });
    expect(plan.graphWrites).toHaveLength(1);
    expect(plan.graphWrites[0].configurationEvents[0].recorded_at).toBe(PORTABILITY_NOW);
    expect(plan.graphWrites[0].graph.slots[0].start_time).toBe("22:00:00");
    expect(plan.occurrenceDeletes).toEqual([]);
    expect(plan.occurrenceWrites.every(({next}) => next.behavior_configuration_event_id === null)).toBe(true);
    expect(plan.applyRun.dry_run_summary).toMatchObject({portability: {version:1, occurrences: importPreview.portability!.occurrences}});
    expect(plan).not.toHaveProperty("statusEventDeletes");
    expect(plan.mappings.map((row) => row.record_type)).toEqual(expect.arrayContaining(["behavior", "schedule", "occurrence"]));
  });

  it.each([false, true])("restores omitted planning fields safely (automatically archived=%s)", (archived) => {
    const input = context();
    const initial = planBehaviorLogImportWrite({
      ...input,
      preview: resolveBehaviorLogImportMergePreview({ files: portabilityFiles() }),
      mode: "create_missing_only",
      interventionRulesPresent: true,
    });
    const archiveNotes = [{
      id: "11111111-1111-4111-8111-111111111111",
      archived_at: "2026-06-01T12:00:00Z",
      note: "Keep this history.",
      updated_at: "2026-06-01T12:00:00Z",
    }];
    const snapshot = {
      ...input.snapshot,
      graphs: initial.graphWrites.map(({ graph }) => ({
        ...graph,
        revision: 1,
        behavior: {
          ...graph.behavior,
          archive_notes: archiveNotes,
          default_duration_minutes: 45,
          active: !archived,
          archived_at: archived ? "2026-06-01T12:00:00Z" : null,
          end_on: archived ? "2026-05-31" : "2099-12-30",
          end_time: null,
          auto_archived_at: archived ? "2026-06-01T12:00:00Z" : null,
        },
      })),
      definitionEvents: initial.definitionEvents,
      configurationEvents: initial.graphWrites.flatMap((write) => write.configurationEvents),
      occurrences: initial.occurrenceWrites.map(({ next }) => next),
      mappings: initial.mappings,
      importRuns: [{ ...initial.applyRun, status: "applied" as const }],
    };
    const files = withoutNewBehaviorFields(portabilityFiles());
    const importPreview = resolveBehaviorLogImportPreview({ files });
    const preview = resolveBehaviorLogRestorePreview({
      importPreview,
      existing: existingRecords(snapshot),
    });
    const plan = planBehaviorLogRestoreWrite({ ...input, snapshot, preview, importPreview });

    expect(plan.graphWrites[0].graph.behavior.archive_notes).toEqual(archiveNotes);
    expect(plan.graphWrites[0].graph.behavior).toMatchObject({
      default_duration_minutes: 45,
      active: true,
      // Restore keeps the stored end, so an ended Behavior comes back as ended.
      end_on: archived ? "2026-05-31" : "2099-12-30",
      end_time: null,
      auto_archived_at: null,
    });
  });

  it("rejects a conflicted plan before projecting rows", () => {
    const input = context(); const preview = resolveBehaviorLogImportMergePreview({ files: portabilityFiles() });
    preview.mergePreview.conflictCount = 1;
    expect(() => planBehaviorLogImportWrite({ ...input, preview, mode: "merge_by_user_approved_plan", interventionRulesPresent: true })).toThrow("cannot be applied");
  });
  it("preserves later explicit local status and nonblank notes when replaying older mapped history", () => {
    const input = context(); const files = richPortabilityFiles();
    const firstPreview = resolveBehaviorLogImportMergePreview({ files });
    const first = planBehaviorLogImportWrite({ ...input, preview: firstPreview, mode: "create_missing_only", interventionRulesPresent: true });
    const snapshot = { ...input.snapshot, graphs: first.graphWrites.map(({ graph }) => ({ ...graph, revision: 1 })), definitionEvents: first.definitionEvents, configurationEvents: first.graphWrites.flatMap(({ configurationEvents }) => configurationEvents), occurrences: first.occurrenceWrites.map(({ next }) => ({ ...next, status: "not_completed", note: "Keep local note", completed_at: null, status_marked_at: "2026-06-09T16:00:00Z" })), statusEvents: [...first.statusEvents], timeSessions: first.timeSessionWrites.map(({ next }) => next), mappings: first.mappings, importedNotes: first.importedNoteWrites.map(({ next }) => next), importRuns: [{ ...first.applyRun, status: "applied" }] };
    snapshot.statusEvents.push({ ...first.statusEvents[0], id: "99999999-9999-4999-8999-999999999999", previous_status: "completed", status: "not_completed", status_semantics: "explicit_user_correction", recorded_at: "2026-06-09T16:00:00Z", effective_at: "2026-06-09T16:00:00Z" });
    const preview = resolveBehaviorLogImportMergePreview({ files, existing: existingRecords(snapshot) });
    expect(preview.mergePreview.conflicts).toEqual([]);
    const merged = planBehaviorLogImportWrite({ ...input, snapshot, preview, mode: "merge_by_user_approved_plan", interventionRulesPresent: true });
    expect(merged.statusEvents).toEqual([]);
    expect(merged.occurrenceWrites).toEqual([]);
    expect(merged.timeSessionWrites).toEqual([]);
    expect(merged.importedNoteWrites).toEqual([]);
    expect(merged.result).toMatchObject({ mapped: { timeSessions: 1 }, skipped: { statusEvents: 1 } });
  });

  it("reads each schedule parent recurrence and accepts current definition/time provenance mapping types", () => {
    const input = context(); const preview = resolveBehaviorLogImportMergePreview({ files: portabilityFiles() });
    const first = planBehaviorLogImportWrite({ ...input, preview, mode: "create_missing_only", interventionRulesPresent: true });
    const graph = first.graphWrites[0].graph;
    const parent = { ...graph.schedules[0], id: input.newId(), recurrence_rule: { frequency: "weekly", interval: 2, daysOfWeek: ["monday"] }, sort_order: 1 };
    const slot = { ...graph.slots[0], id: input.newId(), behavior_schedule_id: parent.id, start_time: "10:00:00" };
    graph.schedules.push(parent); graph.slots.push(slot);
    const snapshot = { ...input.snapshot, graphs: [{ ...graph, revision: 1 }], mappings: [{ ...first.mappings[0], record_type: "behavior_definition_event" }, { ...first.mappings[0], id: input.newId(), record_type: "time_session" }] };
    const existing = existingRecords(snapshot);
    expect(existing.schedules?.find(({ id }) => id === slot.id)?.recurrence).toEqual({ type: "every_n_weeks_on_weekdays", interval: 2, weekdays: ["monday"] });
    expect(existing.mappings?.map((mapping) => mapping.recordType)).toEqual(["behavior_definition_event", "time_session"]);
  });

});

function withoutNewBehaviorFields(files: ReturnType<typeof portabilityFiles>) {
  const cloned = files.map((file) => ({ ...file }));
  const behaviorFile = cloned.find((file) => file.path === "data/behaviors.jsonl")!;
  const behavior = JSON.parse(behaviorFile.content);
  delete behavior.expected_duration_minutes;
  delete behavior.extensions["app.cadence"].archive_notes;
  for (const field of ["end_date", "end_on", "end_time", "pause_from_on", "pause_from_time", "pause_back_on"]) {
    delete behavior.extensions["app.cadence"][field];
  }
  delete behavior.extensions["app.cadence"].auto_archived_at;
  behavior.title = "Brush teeth after dinner";
  behaviorFile.content = `${JSON.stringify(behavior)}\n`;
  const manifestFile = cloned.find((file) => file.path === "manifest.json")!;
  const manifest = JSON.parse(manifestFile.content);
  manifest.files.find((file: { path: string }) => file.path === behaviorFile.path).sha256 = sha256(behaviorFile.content);
  manifestFile.content = JSON.stringify(manifest);
  return cloned;
}
