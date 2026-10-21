import { createHash } from "node:crypto";
import { buildRestorePayload, BehaviorLogRestoreUserError, type RestoreProductPayload } from "@cadence/core/services/behaviorlog-restore-plan";
export { deriveBehaviorLogRestoreLocalId, BehaviorLogRestoreUserError } from "@cadence/core/services/behaviorlog-restore-plan";


import {
  bindBehaviorLogRestoreApplyPayload,
  createBehaviorLogImportRun,
  getAppliedBehaviorLogRestoreRunByAcceptedPreview,
  getBehaviorLogImportRunById,
  markBehaviorLogRestoreRunFailedIfPending,
} from "@/lib/db/behaviorLogImports.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  resolveBehaviorLogImportPreview,
} from "@/lib/resolvers/behaviorlog-import.resolver";
import { resolveBehaviorLogRestorePreview } from "@/lib/resolvers/behaviorlog-restore.resolver";
import {
  listBehaviorLogExistingRecords,
  parseBehaviorLogZipFiles,
  type BehaviorLogZipInput,
} from "@/lib/services/behaviorlog-import.service";
import { markOccurrenceSyncStale } from "@/lib/services/occurrence-sync-state.service";
import { repairUserOccurrenceReminderGraphBestEffort } from "@/lib/services/occurrence-reminder-repair.service";
import {
  invalidateBehaviorData,
  invalidateImportRunData,
} from "@/lib/cache/stable-user-data.cache";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import type {
  BehaviorLogExistingRecords,
  BehaviorLogImportFile,
  BehaviorLogImportRecordMappingInput,
  BehaviorLogImportRunCreateInput,
} from "@/lib/types/behaviorlog-import";
import type { BehaviorLogImportRun } from "@/lib/types/database";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ZIP_READ_LIMITS } from "@/lib/services/zip";
import type {
  BehaviorLogRestorePreview,
  BehaviorLogRestoreStatusHistoryPolicy,
} from "@/lib/types/behaviorlog-restore";
import type {
  BehaviorLogRestoreActionState,
  BehaviorLogRestorePageData,
  BehaviorLogRestoreRunView,
} from "@/lib/types/behaviorlog-restore-ui";
import { BEHAVIORLOG_RESTORE_INITIAL_STATE } from "@/lib/types/behaviorlog-restore-ui";
import { BEHAVIORLOG_BUNDLE_SIZE_ERROR } from "@/lib/types/behaviorlog-bundle-ui";

const BEHAVIORLOG_FORMAT = "behaviorlog.bundle";
const MAX_BEHAVIORLOG_UPLOAD_BYTES = DEFAULT_ZIP_READ_LIMITS.maxArchiveBytes;
const RESTORE_CONFIRMATION_TEXT = "RESTORE";

type BehaviorLogRestoreUploadBundle = {
  fileName: string;
  fileSize: number;
  zip: Buffer;
  files: BehaviorLogImportFile[];
  archiveFingerprint: string;
};

type RestoreRpcClient = {
  rpc: (
    fn: "apply_behaviorlog_restore_with_configuration_events",
    args: { restore_payload: RestorePayload },
  ) => Promise<{ data: unknown; error: Error | null }>;
};

type RestoreBoundPayload = RestoreProductPayload & {
  apply_run_id: string;
  accepted_preview_run_id: string;
  accepted_preview_fingerprint: string;
  accepted_local_data_fingerprint: string;
  accepted_bundle_fingerprint: string;
  accepted_bundle_payload_fingerprint: string;
  mappings: Array<{
    record_type: BehaviorLogImportRecordMappingInput["recordType"];
    external_id: string;
    local_id: string;
  }>;
};

type RestorePayload = RestoreBoundPayload & {
  apply_payload_digest: string;
};

export class BehaviorLogRestoreAuthError extends Error {
  constructor(message = "Sign in again before restoring data.") {
    super(message);
    this.name = "BehaviorLogRestoreAuthError";
  }
}

export function previewBehaviorLogRestoreFromZip(input: {
  zip: BehaviorLogZipInput;
  existing?: BehaviorLogExistingRecords;
  statusHistoryPolicy?: BehaviorLogRestoreStatusHistoryPolicy;
  convertNativeRemindersToBrowser?: boolean;
}): BehaviorLogRestorePreview {
  return previewBehaviorLogRestoreFromFiles({
    files: parseBehaviorLogZipFiles(input.zip),
    existing: input.existing,
    statusHistoryPolicy: input.statusHistoryPolicy,
    convertNativeRemindersToBrowser: input.convertNativeRemindersToBrowser,
  });
}

export function previewBehaviorLogRestoreFromFiles(input: {
  files: BehaviorLogImportFile[];
  existing?: BehaviorLogExistingRecords;
  statusHistoryPolicy?: BehaviorLogRestoreStatusHistoryPolicy;
  convertNativeRemindersToBrowser?: boolean;
}): BehaviorLogRestorePreview {
  const importPreview = resolveBehaviorLogImportPreview({
    files: input.files,
    convertNativeRemindersToBrowser: input.convertNativeRemindersToBrowser,
  });

  return resolveBehaviorLogRestorePreview({
    importPreview,
    existing: input.existing,
    statusHistoryPolicy: input.statusHistoryPolicy,
  });
}

export async function previewCurrentUserBehaviorLogRestoreFromFiles(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    files: BehaviorLogImportFile[];
    statusHistoryPolicy?: BehaviorLogRestoreStatusHistoryPolicy;
    convertNativeRemindersToBrowser?: boolean;
  },
): Promise<BehaviorLogRestorePreview> {
  const existing = await listBehaviorLogExistingRecords(supabase, input.userId);

  return previewBehaviorLogRestoreFromFiles({
    files: input.files,
    existing,
    statusHistoryPolicy: input.statusHistoryPolicy,
    convertNativeRemindersToBrowser: input.convertNativeRemindersToBrowser,
  });
}

export async function createBehaviorLogRestorePreviewRun(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    files: BehaviorLogImportFile[];
    archiveFingerprint: string;
    statusHistoryPolicy?: BehaviorLogRestoreStatusHistoryPolicy;
    convertNativeRemindersToBrowser?: boolean;
  },
): Promise<{
  preview: BehaviorLogRestorePreview;
  importRun: BehaviorLogImportRun;
}> {
  const startedAt = new Date().toISOString();
  const preview = await previewCurrentUserBehaviorLogRestoreFromFiles(supabase, {
    userId: input.userId,
    files: input.files,
    statusHistoryPolicy: input.statusHistoryPolicy,
    convertNativeRemindersToBrowser: input.convertNativeRemindersToBrowser,
  });
  const completedAt = new Date().toISOString();
  const manifest = readManifestMetadata(input.files);
  const importRun = await createBehaviorLogImportRun(supabase, {
    userId: input.userId,
    bundleFormat: manifest.bundleFormat ?? BEHAVIORLOG_FORMAT,
    schemaVersion: manifest.schemaVersion ?? null,
    manifestSha256: manifest.manifestSha256,
    bundleFingerprint: preview.bundleFingerprint,
    producerName: manifest.producerName,
    producerVersion: manifest.producerVersion,
    subjectIdStrategy: manifest.subjectIdStrategy,
    privacyRedactionLevel: manifest.privacyRedactionLevel,
    importMode: "restore_preview",
    dryRunSummary: toRestorePreviewSnapshot(
      preview,
      input.archiveFingerprint,
    ),
    status: "previewed",
    failureMessage: null,
    startedAt,
    completedAt,
  });
  invalidateImportRunData(input.userId);

  return { preview, importRun };
}

export function createBehaviorLogRestorePageDataFromRuns(
  recentRuns: BehaviorLogImportRun[],
): BehaviorLogRestorePageData {
  return {
    recentRuns: recentRuns
      .filter(
        (run) =>
          run.import_mode === "restore_preview" ||
          run.import_mode === "restore_apply",
      )
      .slice(0, 6)
      .map(toRestoreRunView),
  };
}

export async function previewBehaviorLogRestoreUploadFromFormData(
  formData: FormData,
): Promise<BehaviorLogRestoreActionState> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const bundle = await readUploadBundle(formData);
  const { preview, importRun } = await createBehaviorLogRestorePreviewRun(
    supabase,
    {
      userId,
      files: bundle.files,
      archiveFingerprint: bundle.archiveFingerprint,
      convertNativeRemindersToBrowser: formData.get("convert_native_reminders") === "yes",
    },
  );

  return {
    status: "previewed",
    message: preview.valid
      ? "BehaviorLog restore preview ready."
      : "BehaviorLog restore preview found validation errors.",
    upload: {
      fileName: bundle.fileName,
      fileSize: bundle.fileSize,
    },
    archiveFingerprint: bundle.archiveFingerprint,
    preview,
    previewRun: toRestoreRunView(importRun),
    applyResult: null,
  };
}

export async function applyBehaviorLogRestoreUploadFromFormData(
  formData: FormData,
): Promise<BehaviorLogRestoreActionState> {
  assertRestoreApplyAcknowledgements(formData);

  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const bundle = readBundlePayload(formData);
  const previewRunId = readRequiredString(
    formData,
    "restore_preview_run_id",
    "Preview the BehaviorLog restore again before applying.",
  );
  const acceptedPreviewFingerprint = readRequiredString(
    formData,
    "preview_fingerprint",
    "Preview the BehaviorLog restore again before applying.",
  );
  const acceptedLocalDataFingerprint = readRequiredString(
    formData,
    "local_data_fingerprint",
    "Preview the BehaviorLog restore again before applying.",
  );
  const acceptedArchiveFingerprint = readRequiredString(
    formData,
    "archive_fingerprint",
    "Preview the BehaviorLog restore again before applying.",
  );
  const previewRun = await getBehaviorLogImportRunById(
    supabase,
    userId,
    previewRunId,
  );

  assertAcceptedPreviewRun(
    previewRun,
    acceptedPreviewFingerprint,
    acceptedLocalDataFingerprint,
    acceptedArchiveFingerprint,
  );
  const archiveFingerprint = assertArchiveMatchesAcceptedPreview(
    bundle.archiveFingerprint,
    acceptedArchiveFingerprint,
  );

  const alreadyAppliedRun =
    await getAppliedBehaviorLogRestoreRunByAcceptedPreview(supabase, {
      userId,
      acceptedPreviewRunId: previewRun.id,
      acceptedPreviewFingerprint,
    });

  if (alreadyAppliedRun) {
    await repairUserOccurrenceReminderGraphBestEffort(supabase, userId, {
      operation: "behaviorlog_restore",
    });
    return createAlreadyAppliedRestoreState({
      bundle,
      previewRun,
      appliedRun: alreadyAppliedRun,
    });
  }

  const existing = await listBehaviorLogExistingRecords(supabase, userId);
  const importPreview = resolveBehaviorLogImportPreview({
    files: bundle.files,
    convertNativeRemindersToBrowser: formData.get("convert_native_reminders") === "yes",
  });
  const preview = resolveBehaviorLogRestorePreview({
    importPreview,
    existing,
  });

  try {
    assertFreshAcceptedPreview({
      preview,
      acceptedPreviewFingerprint,
      acceptedLocalDataFingerprint,
    });
  } catch (stalePreviewError) {
    const concurrentlyAppliedRun =
      await getAppliedBehaviorLogRestoreRunByAcceptedPreview(supabase, {
        userId,
        acceptedPreviewRunId: previewRun.id,
        acceptedPreviewFingerprint,
      });

    if (concurrentlyAppliedRun) {
      await repairUserOccurrenceReminderGraphBestEffort(supabase, userId, {
        operation: "behaviorlog_restore",
      });
      return createAlreadyAppliedRestoreState({
        bundle,
        previewRun,
        appliedRun: concurrentlyAppliedRun,
      });
    }

    throw stalePreviewError;
  }
  assertRestorePreviewCanApply(preview, formData);
  await markOccurrenceSyncStale(supabase, {
    userId,
    reason: "behaviorlog_restore_applied",
  });

  const manifest = readManifestMetadata(bundle.files);
  const applyRunSummary = toRestorePreviewSnapshot(
    preview,
    archiveFingerprint,
  );
  const applyRun = await createBehaviorLogImportRun(supabase, {
    userId,
    bundleFormat: manifest.bundleFormat ?? BEHAVIORLOG_FORMAT,
    schemaVersion: manifest.schemaVersion,
    manifestSha256: manifest.manifestSha256,
    bundleFingerprint: preview.bundleFingerprint,
    producerName: manifest.producerName,
    producerVersion: manifest.producerVersion,
    subjectIdStrategy: manifest.subjectIdStrategy,
    privacyRedactionLevel: manifest.privacyRedactionLevel,
    importMode: "restore_apply",
    acceptedPreviewRunId: previewRun.id,
    acceptedPreviewFingerprint,
    dryRunSummary: { ...applyRunSummary, ...(importPreview.portability ? { portability: importPreview.portability } : {}) },
    status: "previewed",
    failureMessage: null,
    completedAt: null,
  } satisfies BehaviorLogImportRunCreateInput);
  invalidateImportRunData(userId);
  let rpcData: unknown;

  try {
    const { payload, mappings } = buildRestorePayload({
      userId,
      importRunId: applyRun.id,
      now: new Date().toISOString(),
      importPreview,
      preview,
      existing,
    });
    const boundPayload: RestoreBoundPayload = {
      ...payload,
      apply_run_id: applyRun.id,
      accepted_preview_run_id: previewRun.id,
      accepted_preview_fingerprint: acceptedPreviewFingerprint,
      accepted_local_data_fingerprint: acceptedLocalDataFingerprint,
      accepted_bundle_fingerprint: preview.bundleFingerprint,
      accepted_bundle_payload_fingerprint: archiveFingerprint,
      mappings: mappings.map((mapping) => ({
        record_type: mapping.recordType,
        external_id: mapping.externalId,
        local_id: mapping.localId,
      })),
    };
    const applyPayloadDigest = await bindBehaviorLogRestoreApplyPayload(
      supabase,
      {
        userId,
        importRunId: applyRun.id,
        restorePayload: boundPayload as unknown as Record<string, unknown>,
      },
    );
    const { data, error } = await (supabase as unknown as RestoreRpcClient).rpc(
      "apply_behaviorlog_restore_with_configuration_events",
      {
        restore_payload: {
          ...boundPayload,
          apply_payload_digest: applyPayloadDigest,
        },
      },
    );

    if (error) {
      throw error;
    }

    rpcData = data;
  } catch (error) {
    const failedRun = await markBehaviorLogRestoreRunFailedIfPending(supabase, {
      userId,
      importRunId: applyRun.id,
      failureMessage: errorMessage(error),
      completedAt: new Date().toISOString(),
    });
    invalidateImportRunData(userId);

    if (!failedRun) {
      const committedRun =
        await getAppliedBehaviorLogRestoreRunByAcceptedPreview(supabase, {
          userId,
          acceptedPreviewRunId: previewRun.id,
          acceptedPreviewFingerprint,
        });

      if (committedRun) {
        await repairUserOccurrenceReminderGraphBestEffort(supabase, userId, {
          operation: "behaviorlog_restore",
        });
        return createAlreadyAppliedRestoreState({
          bundle,
          previewRun,
          appliedRun: committedRun,
        });
      }
    }

    throw error;
  }

  const rpcResult = normalizeRestoreRpcResult(rpcData, applyRun);
  invalidateBehaviorData(userId);
  invalidateImportRunData(userId);
  await repairUserOccurrenceReminderGraphBestEffort(supabase, userId, {
    operation: "behaviorlog_restore",
  });

  return {
    status: "applied",
    message: rpcResult.alreadyApplied
      ? "This accepted BehaviorLog restore was already applied."
      : "BehaviorLog restore applied.",
    upload: {
      fileName: bundle.fileName,
      fileSize: bundle.fileSize,
    },
    archiveFingerprint: null,
    preview,
    previewRun: toRestoreRunView(previewRun),
    applyResult: {
      importRun: rpcResult.appliedRun,
      appliedCounts: rpcResult.appliedCounts,
    },
  };
}

export function behaviorLogRestoreErrorToActionState(
  error: unknown,
  previousState: BehaviorLogRestoreActionState = BEHAVIORLOG_RESTORE_INITIAL_STATE,
): BehaviorLogRestoreActionState {
  return {
    ...previousState,
    status: "error",
    message: errorMessage(error),
    applyResult: null,
  };
}

function toRestorePreviewSnapshot(
  preview: BehaviorLogRestorePreview,
  archiveFingerprint: string,
): Record<string, unknown> {
  return {
    mode: preview.mode,
    valid: preview.valid,
    previewFingerprint: preview.previewFingerprint,
    localDataFingerprint: preview.localDataFingerprint,
    bundleFingerprint: preview.bundleFingerprint,
    archiveFingerprint,
    // Production SQL retains this field name for the exact reviewed ZIP bytes.
    bundlePayloadFingerprint: archiveFingerprint,
    statusHistoryPolicy: preview.statusHistoryPolicy,
    semantics: preview.semantics,
    summary: preview.summary,
    nonRestorableFields: preview.nonRestorableFields,
    sensitivity: preview.sensitivity,
    errorCount: preview.errors.length,
    warningCount: preview.warnings.length,
    errors: preview.errors,
    warnings: preview.warnings,
    // SQL authorizes mappings with these fields; apply recomputes full records.
    actions: Object.fromEntries(Object.entries(preview.actions).map(([group, actions]) =>
      [group, actions.map(({ action, externalId, localId }) => ({ action, externalId, localId }))])),
  };
}

function createAlreadyAppliedRestoreState(input: {
  bundle: BehaviorLogRestoreUploadBundle;
  previewRun: BehaviorLogImportRun;
  appliedRun: BehaviorLogImportRun;
}): BehaviorLogRestoreActionState {
  const appliedSummary = readObject(input.appliedRun.dry_run_summary);

  return {
    status: "applied",
    message: "This accepted BehaviorLog restore was already applied.",
    upload: {
      fileName: input.bundle.fileName,
      fileSize: input.bundle.fileSize,
    },
    archiveFingerprint: null,
    preview: null,
    previewRun: toRestoreRunView(input.previewRun),
    applyResult: {
      importRun: toRestoreRunView(input.appliedRun),
      appliedCounts: normalizeRpcResult(appliedSummary?.applyResult),
    },
  };
}

function assertRestoreApplyAcknowledgements(formData: FormData): void {
  if (formData.get("confirm_backup") !== "yes") {
    throw new BehaviorLogRestoreUserError(
      "Acknowledge that you created or downloaded a fresh backup before restoring.",
    );
  }

  if (formData.get("confirm_restore_text") !== RESTORE_CONFIRMATION_TEXT) {
    throw new BehaviorLogRestoreUserError(
      `Type ${RESTORE_CONFIRMATION_TEXT} to confirm this destructive restore.`,
    );
  }
}

function assertRestorePreviewCanApply(
  preview: BehaviorLogRestorePreview,
  formData: FormData,
): void {
  if (!preview.valid || preview.errors.length > 0) {
    throw new BehaviorLogRestoreUserError(
      "Fix restore preview validation errors before applying.",
    );
  }

  if (
    preview.summary.unsupportedActionCount > 0 ||
    preview.summary.skippedCount > 0
  ) {
    throw new BehaviorLogRestoreUserError(
      "Restore preview still contains skipped or unsupported actions.",
    );
  }

  if (
    preview.statusHistoryPolicy.selected !==
      "preserve_append_only_history" ||
    !preview.statusHistoryPolicy.applySupportedInThisTicket
  ) {
    throw new BehaviorLogRestoreUserError(
      "The selected status-history policy is preview-only and cannot be applied.",
    );
  }

  if (
    preview.sensitivity.highOrRestrictedNotesPresent &&
    formData.get("confirm_sensitive_notes") !== "yes"
  ) {
    throw new BehaviorLogRestoreUserError(
      "Review and acknowledge high or restricted note sensitivity before restoring.",
    );
  }
}

function assertAcceptedPreviewRun(
  run: BehaviorLogImportRun | null,
  previewFingerprint: string,
  localDataFingerprint: string,
  archiveFingerprint: string,
): asserts run is BehaviorLogImportRun {
  if (!run || run.import_mode !== "restore_preview" || run.status !== "previewed") {
    throw new BehaviorLogRestoreUserError(
      "Preview the BehaviorLog restore again before applying.",
    );
  }

  const summary = readObject(run.dry_run_summary);

  if (
    readString(summary?.previewFingerprint) !== previewFingerprint ||
    readString(summary?.localDataFingerprint) !== localDataFingerprint ||
    readString(summary?.archiveFingerprint) !== archiveFingerprint
  ) {
    throw new BehaviorLogRestoreUserError(
      "Restore preview no longer matches the accepted preview run.",
    );
  }

  assertAcceptedRestorePreviewSnapshotCanApply(summary);
}

function assertAcceptedRestorePreviewSnapshotCanApply(
  snapshot: Record<string, unknown> | null,
): void {
  const summary = readObject(snapshot?.summary);
  const policy = readObject(snapshot?.statusHistoryPolicy);
  const errors = Array.isArray(snapshot?.errors) ? snapshot.errors : null;

  if (
    snapshot?.mode !== "restore_preview" ||
    snapshot.valid !== true ||
    snapshot.errorCount !== 0 ||
    !errors ||
    errors.length !== 0 ||
    summary?.unsupportedActionCount !== 0 ||
    summary.skippedCount !== 0
  ) {
    throw new BehaviorLogRestoreUserError(
      "The accepted restore preview is not safe to apply. Preview the restore again.",
    );
  }

  if (
    policy?.selected !== "preserve_append_only_history" ||
    policy.applySupportedInThisTicket !== true
  ) {
    throw new BehaviorLogRestoreUserError(
      "The accepted status-history policy is preview-only and cannot be applied.",
    );
  }
}

function assertArchiveMatchesAcceptedPreview(
  archiveFingerprint: string,
  acceptedArchiveFingerprint: string,
): string {
  if (archiveFingerprint !== acceptedArchiveFingerprint) {
    throw new BehaviorLogRestoreUserError(
      "The uploaded bundle no longer matches the accepted restore preview. Preview the restore again.",
    );
  }

  return archiveFingerprint;
}

function assertFreshAcceptedPreview(input: {
  preview: BehaviorLogRestorePreview;
  acceptedPreviewFingerprint: string;
  acceptedLocalDataFingerprint: string;
}): void {
  if (input.preview.localDataFingerprint !== input.acceptedLocalDataFingerprint) {
    throw new BehaviorLogRestoreUserError(
      "Local data changed since this restore preview. Preview the restore again before applying.",
    );
  }

  if (input.preview.previewFingerprint !== input.acceptedPreviewFingerprint) {
    throw new BehaviorLogRestoreUserError(
      "Restore preview is stale. Preview the restore again before applying.",
    );
  }
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  try {
    return await requireCurrentUserId("Sign in again before restoring data.");
  } catch {
    throw new BehaviorLogRestoreAuthError();
  }
}

async function readUploadBundle(
  formData: FormData,
): Promise<BehaviorLogRestoreUploadBundle> {
  const value = formData.get("restore_behaviorlog_file");

  if (!isUploadFile(value)) {
    throw new BehaviorLogRestoreUserError("Choose a .behaviorlog.zip file.");
  }

  const fileName = value.name.trim();

  if (!fileName.endsWith(".behaviorlog.zip")) {
    throw new BehaviorLogRestoreUserError(
      "Unsupported file. Upload a .behaviorlog.zip bundle.",
    );
  }

  if (value.size === 0) {
    throw new BehaviorLogRestoreUserError("The uploaded bundle is empty.");
  }

  if (value.size > MAX_BEHAVIORLOG_UPLOAD_BYTES) {
    throw new BehaviorLogRestoreUserError(BEHAVIORLOG_BUNDLE_SIZE_ERROR);
  }

  const zip = Buffer.from(await value.arrayBuffer());

  return createUploadBundle({
    fileName,
    fileSize: value.size,
    zip,
  });
}

function readBundlePayload(formData: FormData): BehaviorLogRestoreUploadBundle {
  const payload = formData.get("bundle_payload");
  const fileNameValue = formData.get("upload_file_name");
  const fileSizeValue = formData.get("upload_file_size");

  if (typeof payload !== "string" || payload.length === 0) {
    throw new BehaviorLogRestoreUserError(
      "Preview the .behaviorlog.zip bundle again before applying.",
    );
  }

  const zip = Buffer.from(payload, "base64");

  if (zip.byteLength === 0) {
    throw new BehaviorLogRestoreUserError("The uploaded bundle is empty.");
  }

  if (zip.byteLength > MAX_BEHAVIORLOG_UPLOAD_BYTES) {
    throw new BehaviorLogRestoreUserError(BEHAVIORLOG_BUNDLE_SIZE_ERROR);
  }

  return createUploadBundle({
    fileName:
      typeof fileNameValue === "string" && fileNameValue.trim()
        ? fileNameValue.trim()
        : "uploaded.behaviorlog.zip",
    fileSize:
      typeof fileSizeValue === "string" && Number.isFinite(Number(fileSizeValue))
        ? Number(fileSizeValue)
        : zip.byteLength,
    zip,
  });
}

function createUploadBundle(input: {
  fileName: string;
  fileSize: number;
  zip: Buffer;
}): BehaviorLogRestoreUploadBundle {
  try {
    return {
      ...input,
      files: parseBehaviorLogZipFiles(input.zip),
      archiveFingerprint: createHash("sha256")
        .update(input.zip)
        .digest("hex"),
    };
  } catch (error) {
    throw new BehaviorLogRestoreUserError(
      `Unable to read BehaviorLog bundle: ${errorMessage(error)}`,
    );
  }
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function readRequiredString(
  formData: FormData,
  field: string,
  message: string,
): string {
  const value = formData.get(field);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BehaviorLogRestoreUserError(message);
  }

  return value.trim();
}

function toRestoreRunView(run: BehaviorLogImportRun): BehaviorLogRestoreRunView {
  return {
    id: run.id,
    mode: run.import_mode,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    failureMessage: run.failure_message,
  };
}

function normalizeRpcResult(data: unknown): Record<string, number> {
  const value = readObject(data);

  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, count]) => typeof count === "number" && Number.isFinite(count))
      .map(([key, count]) => [key, count as number]),
  );
}

function normalizeRestoreRpcResult(
  data: unknown,
  fallbackRun: BehaviorLogImportRun,
): {
  alreadyApplied: boolean;
  appliedRun: BehaviorLogRestoreRunView;
  appliedCounts: Record<string, number>;
} {
  const value = readObject(data);

  return {
    alreadyApplied: value?.already_applied === true,
    appliedRun: {
      id: readString(value?.applied_run_id) ?? fallbackRun.id,
      mode: "restore_apply",
      status: "applied",
      startedAt:
        readString(value?.applied_run_started_at) ?? fallbackRun.started_at,
      completedAt:
        readString(value?.applied_run_completed_at) ?? fallbackRun.completed_at,
      failureMessage: null,
    },
    appliedCounts: normalizeRpcResult(data),
  };
}

function readManifestMetadata(files: BehaviorLogImportFile[]): {
  bundleFormat: string | null;
  schemaVersion: string | null;
  manifestSha256: string | null;
  producerName: string | null;
  producerVersion: string | null;
  subjectIdStrategy: string | null;
  privacyRedactionLevel: string | null;
} {
  const manifestFile = files.find((file) => file.path === "manifest.json");
  const manifest = parseJsonObject(manifestFile?.content ?? null);
  const producer = readObject(manifest?.producer);
  const privacy = readObject(manifest?.privacy);

  return {
    bundleFormat: readString(manifest?.format),
    schemaVersion: readString(manifest?.schema_version),
    manifestSha256: manifestFile ? sha256(manifestFile.content) : null,
    producerName: readString(producer?.name),
    producerVersion: readString(producer?.version),
    subjectIdStrategy: readString(privacy?.subject_id_strategy),
    privacyRedactionLevel: readString(privacy?.redaction_level),
  };
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return readObject(parsed);
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "BehaviorLog restore could not be completed.";
}
