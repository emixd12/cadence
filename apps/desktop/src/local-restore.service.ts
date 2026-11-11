import { Temporal } from "@js-temporal/polyfill";
import { resolveBehaviorLogImportPreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { resolveBehaviorLogRestorePreview } from "@cadence/core/resolvers/behaviorlog-restore.resolver";
import { existingRecords, planBehaviorLogRestoreWrite } from "@cadence/core/services/behaviorlog-write-plan";
import type { BehaviorLogRestorePreview } from "@cadence/core/types/behaviorlog-restore";
import type { PortabilityImportRunRow } from "@cadence/core/types/portability-rows";
import type { Profile } from "../../../lib/types/database";
import type { BehaviorLogRestoreActionState, BehaviorLogRestorePageData } from "../../../lib/types/behaviorlog-restore-ui";
import { BEHAVIORLOG_RESTORE_INITIAL_STATE } from "../../../lib/types/behaviorlog-restore-ui";
import { localCommand, localMutation } from "./local-store";
import { createLocalDayNoteStore } from "./local-day-note.service";
import { applyBehaviorLogDayNotes, previewBehaviorLogDayNotes } from "@cadence/core/services/behaviorlog-day-note.service";
import { withBehaviorLogDayNoteMessage } from "@cadence/core/resolvers/behaviorlog-day-note.resolver";
import { acceptedRun, applyRun, applyStoredPlan, assertFreshPreview, checkedApplyResult, object, portabilityError, portabilityNow, previewRun, readLocalBundle } from "./local-portability";

const view = (run: PortabilityImportRunRow) => ({ id: run.id, mode: run.import_mode, status: run.status, startedAt: run.started_at, completedAt: run.completed_at, failureMessage: run.failure_message });
export async function getLocalBehaviorLogRestorePageData(profile: Profile): Promise<BehaviorLogRestorePageData> {
  const runs = await localCommand("readImportRuns", { profileId: profile.id, limit: 6, kind: "restore" });
  return { recentRuns: runs.filter((run) => run.import_mode.startsWith("restore_")).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 6).map(view) };
}
export async function previewLocalBehaviorLogRestore(profile: Profile, form: FormData, clock?: Temporal.Instant): Promise<BehaviorLogRestoreActionState> {
  try {
    const bundle = await readLocalBundle(form, "restore_behaviorlog_file"); const now = portabilityNow(clock);
    const snapshot = await localCommand("readImportSnapshot", { profileId: profile.id });
    const importPreview = resolveBehaviorLogImportPreview({ files: bundle.files, reminderChannel: "other" });
    const preview = resolveBehaviorLogRestorePreview({ importPreview, existing: existingRecords(snapshot) });
    const run = previewRun(profile.id, bundle, preview, now);
    await localCommand("prepareBehaviorLogImport", { ...localMutation(profile.id, now), expectedRevision: snapshot.revision, previewRun: run, plan: null });
    const dayNotes = preview.valid ? await previewBehaviorLogDayNotes(createLocalDayNoteStore(profile.id, Temporal.Instant.from(now)), bundle.files, "restore") : null;
    return { status: "previewed", message: preview.valid ? withBehaviorLogDayNoteMessage("BehaviorLog restore preview ready.", dayNotes, "preview") : "BehaviorLog restore preview found validation errors.", upload: { fileName: bundle.fileName, fileSize: bundle.fileSize }, archiveFingerprint: bundle.archiveFingerprint, preview, previewRun: view(run), applyResult: null };
  } catch (error) { return { ...BEHAVIORLOG_RESTORE_INITIAL_STATE, status: "error", message: portabilityError(error) }; }
}
export async function applyLocalBehaviorLogRestore(profile: Profile, form: FormData, clock?: Temporal.Instant): Promise<BehaviorLogRestoreActionState> {
  try {
    if (form.get("confirm_backup") !== "yes") throw new Error("Acknowledge that you created or downloaded a fresh backup before restoring.");
    if (form.get("confirm_restore_text") !== "RESTORE") throw new Error("Type RESTORE to confirm this destructive restore.");
    const bundle = await readLocalBundle(form, "bundle_payload"); const now = portabilityNow(clock);
    const snapshot = await localCommand("readImportSnapshot", { profileId: profile.id }); const accepted = acceptedRun(snapshot, form, bundle, "restore");
    const storedPreview = object(accepted.dry_run_summary) as unknown as BehaviorLogRestorePreview;
    if (storedPreview.errors.length || storedPreview.summary.skippedCount || storedPreview.summary.unsupportedActionCount || storedPreview.statusHistoryPolicy.selected !== "preserve_append_only_history" || !storedPreview.statusHistoryPolicy.applySupportedInThisTicket) throw new Error("Restore preview still contains skipped or unsupported actions.");
    if (storedPreview.sensitivity.highOrRestrictedNotesPresent && form.get("confirm_sensitive_notes") !== "yes") throw new Error("Review and acknowledge high or restricted note sensitivity before restoring.");
    let result;
    let reviewedPreview: BehaviorLogRestorePreview | null = null;
    try { result = await applyStoredPlan(profile.id, accepted, now, "restore_apply"); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "The preview has no applicable write plan.") throw error;
      const importPreview = resolveBehaviorLogImportPreview({ files: bundle.files, reminderChannel: "other" });
      const preview = resolveBehaviorLogRestorePreview({ importPreview, existing: existingRecords(snapshot) }); assertFreshPreview(accepted, preview);
      reviewedPreview = preview;
      const plan = planBehaviorLogRestoreWrite({ snapshot, applyRun: applyRun(accepted, "restore_apply", now), now, newId: () => crypto.randomUUID(), importPreview, preview });
      await localCommand("prepareBehaviorLogImport", { ...localMutation(profile.id, now), expectedRevision: snapshot.revision, previewRun: accepted, plan });
      result = await applyStoredPlan(profile.id, accepted, now, "restore_apply");
    }
    const applied = checkedApplyResult(result);
    // Ticket 292: day notes save after the import commits, one compare-and-set save per date.
    const dayNotes = await applyBehaviorLogDayNotes(createLocalDayNoteStore(profile.id, Temporal.Instant.from(now)), bundle.files, "restore", { replaceDifferent: !applied.alreadyApplied });
    return { status: "applied", message: withBehaviorLogDayNoteMessage("BehaviorLog restore applied.", dayNotes, "applied"), upload: { fileName: bundle.fileName, fileSize: bundle.fileSize }, archiveFingerprint: bundle.archiveFingerprint, preview: reviewedPreview, previewRun: view(accepted), applyResult: { importRun: view(applied.importRun), appliedCounts: Object.fromEntries(Object.entries(object(applied.result)).filter((entry): entry is [string, number] => typeof entry[1] === "number")) } };
  } catch (error) { return { ...BEHAVIORLOG_RESTORE_INITIAL_STATE, status: "error", message: portabilityError(error) }; }
}
