import { createHash } from "node:crypto";
import { expect } from "vitest";
import { assembleExportBundle } from "@cadence/core/services/export-assembly";
import { createBehavior, updateBehavior } from "@cadence/core/services/behavior.service";
import { planBehaviorLogRestoreWrite, existingRecords, graphRecord } from "@cadence/core/services/behaviorlog-write-plan";
import { resolveBehaviorLogImportMergePreview, resolveBehaviorLogImportPreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { type AppSupabaseClient, listBehaviorCategories } from "@/lib/db/behaviors.repo";
import { syncUserOccurrences, applyOccurrenceStatusTransition, updateOccurrenceNote } from "@/lib/services/occurrence.service";
import { startOccurrenceTimeTracking, stopOccurrenceTimeTracking } from "@/lib/services/time-tracking.service";
import { applyAcceptedBehaviorLogImportPlanAtomically, createBehaviorLogImportRunFromPreview } from "@/lib/services/behaviorlog-import-write.service";
import { applyBehaviorLogRestoreUploadFromFormData, createBehaviorLogRestorePreviewRun } from "@/lib/services/behaviorlog-restore.service";
import type { BehaviorLogRestorePreview } from "@cadence/core/types/behaviorlog-restore";
import { createStoredZip } from "@/lib/services/zip";
import { CONTRACT_NOW, snapshotHash } from "./behavior-store-contract";
import { createBehaviorStore } from "@/lib/db/behavior-store";
import { CONTRACT_VALUES } from "./behavior-store-contract";
import { emptyPortabilitySnapshot, fixtureIds, portabilityApplyRun } from "./portability-fixture";
import { readPortabilitySqlSnapshot } from "./portability-sql-contract";

// Same self-export/merge/Keep-restore scenario as the actual SQLite contract.
// The caller injects its ordinary signed-in client at the server-client boundary.
// Auth claims, preview ledgers, payload binding, and the production RPC stay real.
export async function exerciseRestoreSqlContract(client: AppSupabaseClient, userId: string) {
  const now = CONTRACT_NOW.add({ seconds: 100 });
  await createBehavior(createBehaviorStore(client, userId), { userId, timezone: "America/New_York",
    values: { ...CONTRACT_VALUES, title: "Native self export", description: "Keep this definition" }, recordedAt: now.toString() });
  await syncUserOccurrences(client, userId, { now, horizonDays: 30, timezone: "America/New_York", planReminderDeliveries: false });
  const base = emptyPortabilitySnapshot();
  base.profile.id = userId;
  base.categories = await listBehaviorCategories(client, userId);
  const generated = await readPortabilitySqlSnapshot(client, base);
  const target = generated.occurrences.find((row) => row.local_date === "2026-08-30")!;
  expect(target).toBeDefined();
  expect(generated.occurrences.length).toBeGreaterThan(1);
  await applyOccurrenceStatusTransition(client, userId, { occurrenceId: target.id, expectedStatus: "unresolved", nextStatus: "completed", now });
  await updateOccurrenceNote(client, userId, { occurrenceId: target.id, expectedNote: "", note: "Private self-export note" });
  await startOccurrenceTimeTracking(target.id, { now: now.add({ seconds: 1 }) });
  await stopOccurrenceTimeTracking(target.id, { now: now.add({ seconds: 61 }) });
  const source = await readPortabilitySqlSnapshot(client, base);
  const files = assembleExportBundle({ now: now.add({ seconds: 90 }), userId, timezone: source.profile.timezone,
    range: "30", includeNotes: true, includeTimeTracking: true,
    categories: source.categories, behaviors: source.graphs.map((graph) => graphRecord(graph, source.categories)),
    behaviorDefinitionEvents: source.definitionEvents, behaviorConfigurationEvents: source.configurationEvents,
    occurrences: source.occurrences, statusEvents: source.statusEvents, reminderDeliveries: [], timeSessions: source.timeSessions,
    importedNotes: source.importedNotes, importedInterventions: source.importedInterventions,
    importRuns: source.importRuns, importMappings: source.mappings,
  }).behaviorLog.files;
  const mergePreview = resolveBehaviorLogImportMergePreview({ files, existing: existingRecords(source) });
  expect(mergePreview.valid).toBe(true);
  expect(mergePreview.mergePreview.conflictCodes).toEqual([]);
  const mergeRun = await createBehaviorLogImportRunFromPreview(client, { userId, files, preview: mergePreview,
    importMode: "merge_preview", startedAt: now.toString(), completedAt: now.toString() });
  await applyAcceptedBehaviorLogImportPlanAtomically(client, { userId, files, preview: mergePreview,
    importMode: "merge_by_user_approved_plan", acceptedPreviewRunId: mergeRun.id,
    acceptedPreviewFingerprint: mergePreview.previewFingerprint, completedAt: now.add({ seconds: 92 }).toString() });

  const before = await readPortabilitySqlSnapshot(client, base);
  const zip = Buffer.from(createStoredZip(files));
  const archiveFingerprint = createHash("sha256").update(zip).digest("hex");
  const { preview, importRun } = await createBehaviorLogRestorePreviewRun(client, { userId, files, archiveFingerprint });
  expect(preview.valid).toBe(true);
  expect(preview.actions.behaviors.every((action) => action.action === "keep")).toBe(true);
  expect(preview.actions.schedules.every((action) => action.action === "keep")).toBe(true);
  const plan = planBehaviorLogRestoreWrite({ snapshot: before, now: now.add({ seconds: 94 }).toString(), newId: fixtureIds(),
    applyRun: { ...portabilityApplyRun(), user_id: userId, accepted_preview_run_id: importRun.id,
      accepted_preview_fingerprint: preview.previewFingerprint }, preview, importPreview: resolveBehaviorLogImportPreview({ files }) });
  expect(plan.graphWrites).toHaveLength(0);
  const futureIds = before.occurrences.filter((row) => row.local_date > "2026-08-30").map((row) => row.id).sort();
  expect(plan.occurrenceDeletes.map((row) => row.id).sort()).toEqual(futureIds);
  expect(plan.occurrenceWrites).toHaveLength(0);
  const form = restoreForm(zip, preview, importRun.id, archiveFingerprint);
  const result = await applyBehaviorLogRestoreUploadFromFormData(form);
  expect(result.status).toBe("applied");
  const after = await readPortabilitySqlSnapshot(client, base);
  // These exact Keep promises catch silent category/configuration/timestamp rewrites.
  expect(snapshotHash(after.graphs), "Restore must keep the exact reviewed Behavior and schedule graph").toBe(snapshotHash(before.graphs));
  expect(snapshotHash(after.configurationEvents), "Restore must preserve configuration lineage for Keep graphs").toBe(snapshotHash(before.configurationEvents));
  expect(after.occurrences.map((row) => row.id)).toEqual([target.id]);
  expect(snapshotHash(after.occurrences[0]), "Keep must preserve the exact saved Occurrence").toBe(snapshotHash(before.occurrences.find((row) => row.id === target.id)));
  expect(snapshotHash(after.statusEvents)).toBe(snapshotHash(before.statusEvents));
  expect(snapshotHash(after.timeSessions)).toBe(snapshotHash(before.timeSessions));
  expect(after.occurrences[0]).toMatchObject({ status: "completed", note: "Private self-export note" });
  expect(after.timeSessions).toHaveLength(1);
  expect(result.applyResult?.appliedCounts.deleted_occurrences).toBe(futureIds.length);

  // Replacing metadata does not authorize rewriting kept schedule parents or slots.
  const graph = after.graphs[0];
  await updateBehavior(createBehaviorStore(client, userId), { behaviorId: graph.behavior.id,
    expectedUpdatedAt: graph.behavior.updated_at,
    values: { ...CONTRACT_VALUES, title: "Locally revised title", description: "Locally revised description",
      schedules: [{ ...CONTRACT_VALUES.schedules[0], id: graph.schedules[0].id,
        timeEntries: [{ ...CONTRACT_VALUES.schedules[0].timeEntries[0], id: graph.slots[0].id }] }] },
    recordedAt: now.add({ seconds: 100 }).toString() });
  const revised = await readPortabilitySqlSnapshot(client, base);
  const replacement = await createBehaviorLogRestorePreviewRun(client, { userId, files, archiveFingerprint });
  expect(replacement.preview.valid).toBe(true);
  expect(replacement.preview.actions.behaviors[0]?.action).toBe("replace");
  expect(replacement.preview.actions.schedules.every((action) => action.action === "keep")).toBe(true);
  const replacementPlan = planBehaviorLogRestoreWrite({ snapshot: revised, now: now.add({ seconds: 102 }).toString(), newId: fixtureIds(),
    applyRun: { ...portabilityApplyRun(), user_id: userId, accepted_preview_run_id: replacement.importRun.id,
      accepted_preview_fingerprint: replacement.preview.previewFingerprint }, preview: replacement.preview,
    importPreview: resolveBehaviorLogImportPreview({ files }) });
  const replaced = await applyBehaviorLogRestoreUploadFromFormData(restoreForm(zip, replacement.preview, replacement.importRun.id, archiveFingerprint));
  expect(replaced.status).toBe("applied");
  const afterReplacement = await readPortabilitySqlSnapshot(client, base);
  expect(afterReplacement.graphs[0].behavior.title).toBe(replacementPlan.graphWrites[0].graph.behavior.title);
  expect(afterReplacement.graphs[0].behavior.description).toBe(replacementPlan.graphWrites[0].graph.behavior.description);
  expect(snapshotHash(afterReplacement.graphs[0].schedules)).toBe(snapshotHash(revised.graphs[0].schedules));
  expect(snapshotHash(afterReplacement.graphs[0].slots)).toBe(snapshotHash(revised.graphs[0].slots));
  expect(snapshotHash(afterReplacement.occurrences)).toBe(snapshotHash(revised.occurrences));
  expect(snapshotHash(afterReplacement.statusEvents)).toBe(snapshotHash(revised.statusEvents));
  expect(snapshotHash(afterReplacement.timeSessions)).toBe(snapshotHash(revised.timeSessions));

  // Inline Note approval is separate from the kept Occurrence schedule snapshot.
  await updateOccurrenceNote(client, userId, { occurrenceId: target.id,
    expectedNote: "Private self-export note", note: "New local note" });
  const beforeNote = await readPortabilitySqlSnapshot(client, base);
  const notePreview = await createBehaviorLogRestorePreviewRun(client, { userId, files, archiveFingerprint });
  expect(notePreview.preview.valid).toBe(true);
  expect(notePreview.preview.actions.occurrences[0]?.action).toBe("keep");
  expect(notePreview.preview.actions.inlineOccurrenceNotes[0]?.action).toBe("replace");
  const notePlan = planBehaviorLogRestoreWrite({ snapshot: beforeNote, now: now.add({ seconds: 104 }).toString(), newId: fixtureIds(),
    applyRun: { ...portabilityApplyRun(), user_id: userId, accepted_preview_run_id: notePreview.importRun.id,
      accepted_preview_fingerprint: notePreview.preview.previewFingerprint }, preview: notePreview.preview,
    importPreview: resolveBehaviorLogImportPreview({ files }) });
  expect(notePlan.occurrenceWrites[0]?.next.note).toBe("Private self-export note");
  const noteResult = await applyBehaviorLogRestoreUploadFromFormData(restoreForm(zip, notePreview.preview, notePreview.importRun.id, archiveFingerprint));
  expect(noteResult.status).toBe("applied");
  const afterNote = await readPortabilitySqlSnapshot(client, base);
  expect(afterNote.occurrences.find((row) => row.id === target.id)?.note).toBe("Private self-export note");
  expect(snapshotHash(afterNote.statusEvents)).toBe(snapshotHash(beforeNote.statusEvents));
  expect(snapshotHash(afterNote.timeSessions)).toBe(snapshotHash(beforeNote.timeSessions));

  // A changed schedule must not rewrite a different kept schedule in the graph.
  const current = afterNote.graphs[0];
  const addedValues = { ...CONTRACT_VALUES, title: current.behavior.title, description: current.behavior.description,
    schedules: [{ ...CONTRACT_VALUES.schedules[0], id: current.schedules[0].id,
      timeEntries: [{ ...CONTRACT_VALUES.schedules[0].timeEntries[0], id: current.slots[0].id },
        { ...CONTRACT_VALUES.schedules[0].timeEntries[0], startTime: "17:00", sortOrder: 1 }] }] };
  await updateBehavior(createBehaviorStore(client, userId), { behaviorId: current.behavior.id,
    expectedUpdatedAt: current.behavior.updated_at, values: addedValues, recordedAt: now.add({ seconds: 106 }).toString() });
  const twoTimes = await readPortabilitySqlSnapshot(client, base);
  const twoFiles = assembleExportBundle({ now: now.add({ seconds: 110 }), userId, timezone: base.profile.timezone,
    range: "30", includeNotes: true, includeTimeTracking: true, categories: twoTimes.categories,
    behaviors: twoTimes.graphs.map((value) => graphRecord(value, twoTimes.categories)),
    behaviorDefinitionEvents: twoTimes.definitionEvents, behaviorConfigurationEvents: twoTimes.configurationEvents,
    occurrences: twoTimes.occurrences, statusEvents: twoTimes.statusEvents, reminderDeliveries: [], timeSessions: twoTimes.timeSessions,
    importedNotes: twoTimes.importedNotes, importedInterventions: twoTimes.importedInterventions,
    importRuns: twoTimes.importRuns, importMappings: twoTimes.mappings,
  }).behaviorLog.files;
  const twoMergePreview = resolveBehaviorLogImportMergePreview({ files: twoFiles, existing: existingRecords(twoTimes) });
  expect(twoMergePreview.valid).toBe(true);
  expect(twoMergePreview.mergePreview.conflictCodes).toEqual([]);
  const twoMergeRun = await createBehaviorLogImportRunFromPreview(client, { userId, files: twoFiles, preview: twoMergePreview,
    importMode: "merge_preview", startedAt: now.toString(), completedAt: now.toString() });
  await applyAcceptedBehaviorLogImportPlanAtomically(client, { userId, files: twoFiles, preview: twoMergePreview,
    importMode: "merge_by_user_approved_plan", acceptedPreviewRunId: twoMergeRun.id,
    acceptedPreviewFingerprint: twoMergePreview.previewFingerprint, completedAt: now.add({ seconds: 111 }).toString() });
  const twoZip = Buffer.from(createStoredZip(twoFiles));
  const twoFingerprint = createHash("sha256").update(twoZip).digest("hex");
  const firstSlot = twoTimes.graphs[0].slots.find((row) => row.start_time.startsWith("09:00"))!;
  const secondSlot = twoTimes.graphs[0].slots.find((row) => row.start_time.startsWith("17:00"))!;
  await updateBehavior(createBehaviorStore(client, userId), { behaviorId: current.behavior.id,
    expectedUpdatedAt: twoTimes.graphs[0].behavior.updated_at,
    values: { ...addedValues, schedules: [{ ...addedValues.schedules[0],
      timeEntries: [{ ...addedValues.schedules[0].timeEntries[0], id: firstSlot.id, startTime: "10:00" },
        { ...addedValues.schedules[0].timeEntries[1], id: secondSlot.id }] }] }, recordedAt: now.add({ seconds: 112 }).toString() });
  const beforeMixed = await readPortabilitySqlSnapshot(client, base);
  const mixed = await createBehaviorLogRestorePreviewRun(client, { userId, files: twoFiles, archiveFingerprint: twoFingerprint });
  expect(mixed.preview.valid).toBe(true);
  expect(mixed.preview.actions.schedules.find((action) => action.localId === firstSlot.id)?.action).toBe("replace");
  expect(mixed.preview.actions.schedules.find((action) => action.localId === secondSlot.id)?.action).toBe("keep");
  const mixedResult = await applyBehaviorLogRestoreUploadFromFormData(restoreForm(twoZip, mixed.preview, mixed.importRun.id, twoFingerprint));
  expect(mixedResult.status).toBe("applied");
  const afterMixed = await readPortabilitySqlSnapshot(client, base);
  expect(afterMixed.graphs[0].slots.find((row) => row.id === firstSlot.id)?.start_time).toBe("09:00:00");
  expect(snapshotHash(afterMixed.graphs[0].slots.find((row) => row.id === secondSlot.id)))
    .toBe(snapshotHash(beforeMixed.graphs[0].slots.find((row) => row.id === secondSlot.id)));
  expect(afterMixed.graphs[0].schedules.map((row) => row.id)).toEqual(beforeMixed.graphs[0].schedules.map((row) => row.id));
  expect(snapshotHash(afterMixed.statusEvents)).toBe(snapshotHash(beforeMixed.statusEvents));
  expect(snapshotHash(afterMixed.timeSessions)).toBe(snapshotHash(beforeMixed.timeSessions));

  // A bundle written before Ended and Paused carries no end or pause. Restoring it keeps
  // the stored end: Restore never clears an end, so the Behavior comes back as Ended.
  await updateBehavior(createBehaviorStore(client, userId), { behaviorId: current.behavior.id,
    expectedUpdatedAt: afterMixed.graphs[0].behavior.updated_at,
    values: { ...addedValues, endOn: "2026-08-31" }, recordedAt: now.add({ seconds: 114 }).toString() });
  const legacyFiles = twoFiles.map((file) => ({ ...file }));
  const legacyBehaviors = legacyFiles.find((file) => file.path === "data/behaviors.jsonl")!;
  legacyBehaviors.content = legacyBehaviors.content.trim().split("\n").map((line) => {
    const row = JSON.parse(line);
    delete row.expected_duration_minutes;
    for (const key of ["end_on", "end_time", "pause_from_on", "pause_from_time", "pause_back_on"]) delete row.extensions["app.cadence"][key];
    delete row.extensions["app.cadence"].auto_archived_at;
    return JSON.stringify(row);
  }).join("\n") + "\n";
  const manifestFile = legacyFiles.find((file) => file.path === "manifest.json")!;
  const manifest = JSON.parse(manifestFile.content);
  manifest.files.find((file: { path: string }) => file.path === legacyBehaviors.path).sha256 =
    createHash("sha256").update(legacyBehaviors.content).digest("hex");
  manifestFile.content = JSON.stringify(manifest);
  const legacyZip = Buffer.from(createStoredZip(legacyFiles));
  const legacyFingerprint = createHash("sha256").update(legacyZip).digest("hex");
  const legacyPreview = await createBehaviorLogRestorePreviewRun(client, { userId,
    files: legacyFiles, archiveFingerprint: legacyFingerprint });
  expect(legacyPreview.preview.valid).toBe(true);
  const legacyResult = await applyBehaviorLogRestoreUploadFromFormData(restoreForm(
    legacyZip, legacyPreview.preview, legacyPreview.importRun.id, legacyFingerprint));
  expect(legacyResult.status).toBe("applied");
  const legacyRestored = await readPortabilitySqlSnapshot(client, base);
  expect(legacyRestored.graphs[0].behavior).toMatchObject({
    active: true, default_duration_minutes: 45, end_on: "2026-08-31", auto_archived_at: null,
  });
}

export function restoreForm(zip: Buffer, preview: BehaviorLogRestorePreview, importRunId: string, archiveFingerprint: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    bundle_payload: zip.toString("base64"), upload_file_name: "self-export.behaviorlog.zip", upload_file_size: String(zip.length),
    restore_preview_run_id: importRunId, preview_fingerprint: preview.previewFingerprint,
    local_data_fingerprint: preview.localDataFingerprint, archive_fingerprint: archiveFingerprint,
    confirm_backup: "yes", confirm_restore_text: "RESTORE", confirm_sensitive_notes: "yes",
  })) form.set(key, value);
  return form;
}
