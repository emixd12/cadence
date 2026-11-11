import { Temporal } from "@js-temporal/polyfill";
import { resolveBehaviorLogImportMergePreview } from "@cadence/core/resolvers/behaviorlog-import.resolver";
import { planBehaviorLogImportWrite } from "@cadence/core/services/behaviorlog-import-plan";
import { existingRecords } from "@cadence/core/services/behaviorlog-write-plan";
import { resolveBehaviorLogImportCapabilities, previewRequiresSensitiveNoteConfirmation } from "@cadence/core/services/behaviorlog-preview";
import type { BehaviorLogImportMergePreviewResult } from "@cadence/core/types/behaviorlog-import";
import type { Profile } from "../../../lib/types/database";
import type { BehaviorLogImportActionState, BehaviorLogImportPageData } from "../../../lib/types/behaviorlog-import-ui";
import { BEHAVIORLOG_IMPORT_INITIAL_STATE, toImportRunView } from "../../../lib/types/behaviorlog-import-ui";
import { localCommand, localMutation } from "./local-store";
import { createLocalDayNoteStore } from "./local-day-note.service";
import { applyBehaviorLogDayNotes, previewBehaviorLogDayNotes } from "@cadence/core/services/behaviorlog-day-note.service";
import { withBehaviorLogDayNoteMessage } from "@cadence/core/resolvers/behaviorlog-day-note.resolver";
import { acceptedRun, applyRun, applyStoredPlan, assertFreshPreview, checkedApplyResult, object, portabilityError, portabilityNow, previewRun, readLocalBundle } from "./local-portability";

export async function getLocalBehaviorLogImportPageData(profile: Profile): Promise<BehaviorLogImportPageData> {
  const runs = await localCommand("readImportRuns", { profileId: profile.id, limit: 12, kind: "import" });
  return { recentRuns: runs.filter((run) => !run.import_mode.startsWith("restore_")).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 12).map(toImportRunView) };
}
export async function previewLocalBehaviorLogImport(profile: Profile, form: FormData, clock?: Temporal.Instant): Promise<BehaviorLogImportActionState> {
  try {
    const bundle = await readLocalBundle(form, "behaviorlog_file"); const now = portabilityNow(clock);
    const snapshot = await localCommand("readImportSnapshot", { profileId: profile.id });
    const preview = resolveBehaviorLogImportMergePreview({ files: bundle.files, existing: existingRecords(snapshot), reminderChannel: "other" });
    const run = previewRun(profile.id, bundle, preview, now);
    await localCommand("prepareBehaviorLogImport", { ...localMutation(profile.id, now), expectedRevision: snapshot.revision, previewRun: run, plan: null });
    const dayNotes = preview.valid ? await previewBehaviorLogDayNotes(createLocalDayNoteStore(profile.id, Temporal.Instant.from(now)), bundle.files, "import") : null;
    return { status: "previewed", message: preview.valid ? withBehaviorLogDayNoteMessage("BehaviorLog preview ready.", dayNotes, "preview") : "BehaviorLog preview found validation errors.", upload: { fileName: bundle.fileName, fileSize: bundle.fileSize }, archiveFingerprint: bundle.archiveFingerprint, preview, previewRun: toImportRunView(run), capabilities: resolveBehaviorLogImportCapabilities(preview), applyResult: null };
  } catch (error) { return { ...BEHAVIORLOG_IMPORT_INITIAL_STATE, status: "error", message: portabilityError(error) }; }
}
export async function applyLocalBehaviorLogImport(profile: Profile, form: FormData, clock?: Temporal.Instant): Promise<BehaviorLogImportActionState> {
  try {
    const mode = form.get("import_mode");
    if (mode !== "create_missing_only" && mode !== "merge_by_user_approved_plan") throw new Error("Choose an import mode before applying.");
    if (form.get("confirm_apply") !== "yes") throw new Error("Confirm that you want to apply this import before writing records.");
    const bundle = await readLocalBundle(form, "bundle_payload"); const now = portabilityNow(clock);
    const snapshot = await localCommand("readImportSnapshot", { profileId: profile.id }); const accepted = acceptedRun(snapshot, form, bundle, "import");
    const storedPreview = object(accepted.dry_run_summary) as unknown as BehaviorLogImportMergePreviewResult;
    const capabilities = resolveBehaviorLogImportCapabilities(storedPreview);
    if (mode === "create_missing_only" ? !capabilities.canApplyCreateOnly : !capabilities.canApplyMerge) throw new Error("The selected import mode is unavailable for this preview.");
    if ((object(accepted.dry_run_summary).requiresSensitiveNoteConfirmation === true || (storedPreview.plan && previewRequiresSensitiveNoteConfirmation(storedPreview))) && form.get("confirm_sensitive_notes") !== "yes") throw new Error("Review and acknowledge high or restricted note sensitivity before importing notes.");
    let result;
    let reviewedPreview: BehaviorLogImportMergePreviewResult | null = null;
    try { result = await applyStoredPlan(profile.id, accepted, now, mode); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "The preview has no applicable write plan.") throw error;
      const preview = resolveBehaviorLogImportMergePreview({ files: bundle.files, existing: existingRecords(snapshot), reminderChannel: "other" }); assertFreshPreview(accepted, preview);
      reviewedPreview = preview;
      const plan = planBehaviorLogImportWrite({ snapshot, applyRun: applyRun(accepted, mode, now), now, newId: () => crypto.randomUUID(), preview, mode, interventionRulesPresent: bundle.files.some(({ path }) => path === "data/intervention_rules.jsonl") });
      await localCommand("prepareBehaviorLogImport", { ...localMutation(profile.id, now), expectedRevision: snapshot.revision, previewRun: accepted, plan });
      result = await applyStoredPlan(profile.id, accepted, now, mode);
    }
    const applied = checkedApplyResult(result);
    if (applied.importRun.import_mode !== mode) throw new Error("This preview was already accepted with another import mode.");
    const counts = object(applied.result);
    // Ticket 292: day notes save after the import commits, one compare-and-set save per date.
    const dayNotes = await applyBehaviorLogDayNotes(createLocalDayNoteStore(profile.id, Temporal.Instant.from(now)), bundle.files, "import");
    return { status: "applied", message: withBehaviorLogDayNoteMessage("BehaviorLog import applied.", dayNotes, "applied"), upload: { fileName: bundle.fileName, fileSize: bundle.fileSize }, archiveFingerprint: bundle.archiveFingerprint, preview: reviewedPreview, previewRun: toImportRunView(accepted), capabilities,
      applyResult: { mode, importRun: toImportRunView(applied.importRun), created: counts.created as NonNullable<BehaviorLogImportActionState["applyResult"]>["created"], mapped: counts.mapped as NonNullable<BehaviorLogImportActionState["applyResult"]>["mapped"], skipped: counts.skipped as NonNullable<BehaviorLogImportActionState["applyResult"]>["skipped"] } };
  } catch (error) { return { ...BEHAVIORLOG_IMPORT_INITIAL_STATE, status: "error", message: portabilityError(error) }; }
}
