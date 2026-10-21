import { resolveBehaviorLogImportCapabilities, previewRequiresSensitiveNoteConfirmation } from "@cadence/core/services/behaviorlog-preview";
export { resolveBehaviorLogImportCapabilities, previewRequiresSensitiveNoteConfirmation } from "@cadence/core/services/behaviorlog-preview";
import { assembleBehaviorLogExistingRecords } from "@cadence/core/services/behaviorlog-existing";
import { createHash } from "node:crypto";


import {
  resolveBehaviorLogImportMergePreview,
  resolveBehaviorLogImportPreview,
  type ResolveBehaviorLogImportMergePreviewInput,
} from "@/lib/resolvers/behaviorlog-import.resolver";
import {
  getBehaviorLogImportRunById,
  listAppliedBehaviorLogImportRuns,
  listBehaviorLogImportRecordMappings,
} from "@/lib/db/behaviorLogImports.repo";
import { listImportedNotes } from "@/lib/db/notes.repo";
import { listImportedInterventions } from "@/lib/db/importedInterventions.repo";
import {
  listUserBehaviors,
  type AppSupabaseClient,
} from "@/lib/db/behaviors.repo";
import { listUserOccurrences } from "@/lib/db/occurrences.repo";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { listBehaviorDefinitionEvents } from "@/lib/db/behaviorDefinitionEvents.repo";
import { listBehaviorConfigurationEvents } from "@/lib/db/behaviorConfigurationEvents.repo";
import { listTimeSessionsByOccurrenceIds } from "@/lib/db/timeSessions.repo";
import {
  applyAcceptedBehaviorLogImportPlanAtomically,
  createBehaviorLogImportRunFromPreview,
} from "@/lib/services/behaviorlog-import-write.service";
import { readCachedBehaviorLogImportRuns } from "@/lib/cache/stable-user-data.cache";
import {
  DEFAULT_ZIP_READ_LIMITS,
  readZipEntries,
} from "@/lib/services/zip";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import type {
  BehaviorLogExistingRecords,
  BehaviorLogImportFile,
  BehaviorLogImportMergePreviewResult,
  BehaviorLogImportPreview,
} from "@/lib/types/behaviorlog-import";
import type {
  BehaviorLogImportActionState,
  BehaviorLogImportApplyMode,
  BehaviorLogImportCapabilities,
  BehaviorLogImportPageData,
} from "@/lib/types/behaviorlog-import-ui";
import { BEHAVIORLOG_BUNDLE_SIZE_ERROR } from "@/lib/types/behaviorlog-bundle-ui";
import {
  BEHAVIORLOG_IMPORT_INITIAL_STATE,
  isBehaviorLogApplyMode,
  toImportRunView,
} from "@/lib/types/behaviorlog-import-ui";
import type {
  BehaviorLogImportRun,
} from "@/lib/types/database";

export type BehaviorLogZipInput = Buffer | Uint8Array | ArrayBuffer;

const MAX_BEHAVIORLOG_UPLOAD_BYTES = DEFAULT_ZIP_READ_LIMITS.maxArchiveBytes;

type BehaviorLogUploadBundle = {
  fileName: string;
  fileSize: number;
  zip: Buffer;
  files: BehaviorLogImportFile[];
  archiveFingerprint: string;
};

export class BehaviorLogImportAuthError extends Error {
  constructor(message = "Sign in again before importing data.") {
    super(message);
    this.name = "BehaviorLogImportAuthError";
  }
}

export class BehaviorLogImportUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BehaviorLogImportUserError";
  }
}

export function parseBehaviorLogZipFiles(
  zip: BehaviorLogZipInput,
): BehaviorLogImportFile[] {
  return readZipEntries(zip).map((entry) => {
    assertSafeZipPath(entry.path);

    return {
      path: entry.path,
      mediaType: inferMediaType(entry.path),
      content: entry.content,
    };
  });
}

export function previewBehaviorLogImportFromZip(input: {
  zip: BehaviorLogZipInput;
  existing?: BehaviorLogExistingRecords;
  supportedSchemaVersions?: readonly string[];
  convertNativeRemindersToBrowser?: boolean;
}): BehaviorLogImportPreview {
  return resolveBehaviorLogImportPreview({
    files: parseBehaviorLogZipFiles(input.zip),
    existing: input.existing,
    supportedSchemaVersions: input.supportedSchemaVersions,
    convertNativeRemindersToBrowser: input.convertNativeRemindersToBrowser,
  });
}

export function previewBehaviorLogMergeImportFromFiles(
  input: ResolveBehaviorLogImportMergePreviewInput,
): BehaviorLogImportMergePreviewResult {
  return resolveBehaviorLogImportMergePreview(input);
}

export async function listCurrentUserBehaviorLogImportRuns(
  limit: number,
): Promise<BehaviorLogImportRun[]> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  return readCachedBehaviorLogImportRuns(supabase, userId, limit);
}

export function createBehaviorLogImportPageDataFromRuns(
  recentRuns: BehaviorLogImportRun[],
): BehaviorLogImportPageData {
  return {
    recentRuns: recentRuns
      .filter(
        (run) =>
          run.import_mode !== "restore_preview" &&
          run.import_mode !== "restore_apply",
      )
      .map(toImportRunView),
  };
}

export async function previewBehaviorLogImportUploadFromFormData(
  formData: FormData,
): Promise<BehaviorLogImportActionState> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const bundle = await readUploadBundle(formData);
  const existing = await listBehaviorLogExistingRecords(supabase, userId);
  const preview = previewBehaviorLogMergeImportFromFiles({
    files: bundle.files,
    existing,
    convertNativeRemindersToBrowser: formData.get("convert_native_reminders") === "yes",
  });
  const importRun = await createBehaviorLogImportRunFromPreview(supabase, {
    userId,
    files: bundle.files,
    preview,
    archiveFingerprint: bundle.archiveFingerprint,
    importMode: "merge_preview",
  });

  return {
    status: "previewed",
    message: preview.valid
      ? "BehaviorLog preview ready."
      : "BehaviorLog preview found validation errors.",
    upload: {
      fileName: bundle.fileName,
      fileSize: bundle.fileSize,
    },
    archiveFingerprint: bundle.archiveFingerprint,
    preview,
    previewRun: toImportRunView(importRun),
    capabilities: resolveBehaviorLogImportCapabilities(preview),
    applyResult: null,
  };
}

export async function applyBehaviorLogImportUploadFromFormData(
  formData: FormData,
): Promise<BehaviorLogImportActionState> {
  const modeValue = formData.get("import_mode");

  if (!isBehaviorLogApplyMode(modeValue)) {
    throw new BehaviorLogImportUserError("Choose an import mode before applying.");
  }

  if (formData.get("confirm_apply") !== "yes") {
    throw new BehaviorLogImportUserError(
      "Confirm that you want to apply this import before writing records.",
    );
  }

  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const bundle = readBundlePayload(formData);
  const previewRunId = readRequiredString(
    formData,
    "import_preview_run_id",
    "Preview the .behaviorlog.zip bundle again before applying.",
  );
  const acceptedPreviewFingerprint = readRequiredString(
    formData,
    "preview_fingerprint",
    "Preview the .behaviorlog.zip bundle again before applying.",
  );
  const acceptedLocalDataFingerprint = readRequiredString(
    formData,
    "local_data_fingerprint",
    "Preview the .behaviorlog.zip bundle again before applying.",
  );
  const acceptedBundleFingerprint = readRequiredString(
    formData,
    "bundle_fingerprint",
    "Preview the .behaviorlog.zip bundle again before applying.",
  );
  const acceptedArchiveFingerprint = readRequiredString(
    formData,
    "archive_fingerprint",
    "Preview the .behaviorlog.zip bundle again before applying.",
  );
  const previewRun = await getBehaviorLogImportRunById(
    supabase,
    userId,
    previewRunId,
  );

  const acceptedPreview = {
    run: previewRun,
    bundleFingerprint: acceptedBundleFingerprint,
    archiveFingerprint: acceptedArchiveFingerprint,
    localDataFingerprint: acceptedLocalDataFingerprint,
    previewFingerprint: acceptedPreviewFingerprint,
  };

  assertAcceptedImportPreviewRun(acceptedPreview);
  assertArchiveMatchesAcceptedImportPreview(
    bundle.archiveFingerprint,
    acceptedArchiveFingerprint,
  );

  const existing = await listBehaviorLogExistingRecords(supabase, userId);
  const preview = previewBehaviorLogMergeImportFromFiles({
    files: bundle.files,
    existing,
    convertNativeRemindersToBrowser: formData.get("convert_native_reminders") === "yes",
  });

  assertFreshAcceptedImportPreview({
    preview,
    bundleFingerprint: acceptedBundleFingerprint,
    localDataFingerprint: acceptedLocalDataFingerprint,
    previewFingerprint: acceptedPreviewFingerprint,
  });
  const capabilities = resolveBehaviorLogImportCapabilities(preview);

  assertImportModeCanApply(modeValue, capabilities);
  assertSensitiveNotesCanApply(formData, preview);

  const result = await applyAcceptedBehaviorLogImportPlanAtomically(supabase, {
    userId,
    files: bundle.files,
    preview,
    importMode: modeValue,
    acceptedPreviewRunId: acceptedPreview.run.id,
    acceptedPreviewFingerprint,
  });
  if (modeValue === "create_missing_only") {
    return {
      status: "applied",
      message: "Create-only import applied.",
      upload: {
        fileName: bundle.fileName,
        fileSize: bundle.fileSize,
      },
      archiveFingerprint: null,
      preview,
      previewRun: toImportRunView(result.importRun),
      capabilities,
      applyResult: {
        mode: modeValue,
        importRun: toImportRunView(result.importRun),
        created: result.created,
        skipped: result.skipped,
      },
    };
  }

  return {
    status: "applied",
    message: "Approved merge import applied.",
    upload: {
      fileName: bundle.fileName,
      fileSize: bundle.fileSize,
    },
    archiveFingerprint: null,
    preview,
    previewRun: toImportRunView(result.importRun),
    capabilities,
    applyResult: {
      mode: modeValue,
      importRun: toImportRunView(result.importRun),
      created: result.created,
      mapped: result.mapped,
      skipped: result.skipped,
    },
  };
}

export function behaviorLogImportErrorToActionState(
  error: unknown,
  previousState: BehaviorLogImportActionState = BEHAVIORLOG_IMPORT_INITIAL_STATE,
): BehaviorLogImportActionState {
  return {
    ...previousState,
    status: "error",
    message: errorMessage(error),
    applyResult: null,
  };
}

function assertSafeZipPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${path || "(empty)"}.`);
  }
}

function inferMediaType(path: string): string {
  if (path.endsWith(".json")) {
    return "application/json";
  }

  if (path.endsWith(".jsonl")) {
    return "application/jsonl";
  }

  if (path.endsWith(".md")) {
    return "text/markdown";
  }

  return "application/octet-stream";
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  try {
    return await requireCurrentUserId("Sign in again before importing data.");
  } catch {
    throw new BehaviorLogImportAuthError();
  }
}

async function readUploadBundle(
  formData: FormData,
): Promise<BehaviorLogUploadBundle> {
  const value = formData.get("behaviorlog_file");

  if (!isUploadFile(value)) {
    throw new BehaviorLogImportUserError("Choose a .behaviorlog.zip file.");
  }

  const fileName = value.name.trim();

  if (!fileName.endsWith(".behaviorlog.zip")) {
    throw new BehaviorLogImportUserError(
      "Unsupported file. Upload a .behaviorlog.zip bundle.",
    );
  }

  if (value.size === 0) {
    throw new BehaviorLogImportUserError("The uploaded bundle is empty.");
  }

  if (value.size > MAX_BEHAVIORLOG_UPLOAD_BYTES) {
    throw new BehaviorLogImportUserError(BEHAVIORLOG_BUNDLE_SIZE_ERROR);
  }

  const zip = Buffer.from(await value.arrayBuffer());

  return createUploadBundle({
    fileName,
    fileSize: value.size,
    zip,
  });
}

function readBundlePayload(formData: FormData): BehaviorLogUploadBundle {
  const payload = formData.get("bundle_payload");
  const fileNameValue = formData.get("upload_file_name");
  const fileSizeValue = formData.get("upload_file_size");

  if (typeof payload !== "string" || payload.length === 0) {
    throw new BehaviorLogImportUserError(
      "Preview the .behaviorlog.zip bundle again before applying.",
    );
  }

  const zip = Buffer.from(payload, "base64");

  if (zip.byteLength === 0) {
    throw new BehaviorLogImportUserError("The uploaded bundle is empty.");
  }

  if (zip.byteLength > MAX_BEHAVIORLOG_UPLOAD_BYTES) {
    throw new BehaviorLogImportUserError(BEHAVIORLOG_BUNDLE_SIZE_ERROR);
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

function assertAcceptedImportPreviewRun(input: {
  run: BehaviorLogImportRun | null;
  bundleFingerprint: string;
  archiveFingerprint: string;
  localDataFingerprint: string;
  previewFingerprint: string;
}): asserts input is { run: BehaviorLogImportRun } & typeof input {
  if (
    !input.run ||
    input.run.import_mode !== "merge_preview" ||
    input.run.status !== "previewed"
  ) {
    throw new BehaviorLogImportUserError(
      "Preview the .behaviorlog.zip bundle again before applying.",
    );
  }

  const summary = readObject(input.run.dry_run_summary);

  if (
    summary?.valid !== true ||
    input.run.bundle_fingerprint !== input.bundleFingerprint ||
    readString(summary?.bundleFingerprint) !== input.bundleFingerprint ||
    readString(summary?.archiveFingerprint) !== input.archiveFingerprint ||
    readString(summary?.localDataFingerprint) !== input.localDataFingerprint ||
    readString(summary?.previewFingerprint) !== input.previewFingerprint
  ) {
    throw new BehaviorLogImportUserError(
      "Import preview no longer matches the accepted preview run.",
    );
  }
}

function assertArchiveMatchesAcceptedImportPreview(
  archiveFingerprint: string,
  acceptedArchiveFingerprint: string,
): void {
  if (archiveFingerprint === acceptedArchiveFingerprint) {
    return;
  }

  throw new BehaviorLogImportUserError(
    "The uploaded bundle no longer matches the accepted import preview. Preview the import again.",
  );
}

function assertFreshAcceptedImportPreview(input: {
  preview: BehaviorLogImportMergePreviewResult;
  bundleFingerprint: string;
  localDataFingerprint: string;
  previewFingerprint: string;
}): void {
  if (input.preview.bundleFingerprint !== input.bundleFingerprint) {
    throw new BehaviorLogImportUserError(
      "Uploaded bundle changed since this import preview. Preview it again before applying.",
    );
  }

  if (input.preview.localDataFingerprint !== input.localDataFingerprint) {
    throw new BehaviorLogImportUserError(
      "Local data changed since this import preview. Preview it again before applying.",
    );
  }

  if (input.preview.previewFingerprint !== input.previewFingerprint) {
    throw new BehaviorLogImportUserError(
      "Import preview is stale. Preview it again before applying.",
    );
  }
}

function readRequiredString(
  formData: FormData,
  field: string,
  message: string,
): string {
  const value = formData.get(field);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BehaviorLogImportUserError(message);
  }

  return value.trim();
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function createUploadBundle(input: {
  fileName: string;
  fileSize: number;
  zip: Buffer;
}): BehaviorLogUploadBundle {
  try {
    return {
      ...input,
      files: parseBehaviorLogZipFiles(input.zip),
      archiveFingerprint: createHash("sha256").update(input.zip).digest("hex"),
    };
  } catch (error) {
    throw new BehaviorLogImportUserError(
      `Unable to read BehaviorLog bundle: ${errorMessage(error)}`,
    );
  }
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function assertImportModeCanApply(
  mode: BehaviorLogImportApplyMode,
  capabilities: BehaviorLogImportCapabilities,
): void {
  if (mode === "create_missing_only" && !capabilities.canApplyCreateOnly) {
    throw new BehaviorLogImportUserError(
      capabilities.createOnlyReason ?? "Create-only import is unavailable.",
    );
  }

  if (
    mode === "merge_by_user_approved_plan" &&
    !capabilities.canApplyMerge
  ) {
    throw new BehaviorLogImportUserError(
      capabilities.mergeReason ?? "Merge import is unavailable.",
    );
  }
}

function assertSensitiveNotesCanApply(
  formData: FormData,
  preview: BehaviorLogImportMergePreviewResult,
): void {
  if (!previewRequiresSensitiveNoteConfirmation(preview)) {
    return;
  }

  if (formData.get("confirm_sensitive_notes") === "yes") {
    return;
  }

  throw new BehaviorLogImportUserError(
    "Review and acknowledge high or restricted note sensitivity before importing notes.",
  );
}

export async function listBehaviorLogExistingRecords(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<BehaviorLogExistingRecords> {
  const [
    behaviors,
    occurrences,
    definitionEvents,
    mappings,
    importedNotes,
    importedInterventions,
    configurationEvents,
    importRuns,
  ] = await Promise.all([
    listUserBehaviors(supabase, userId),
    listUserOccurrences(supabase, userId),
    listBehaviorDefinitionEvents(supabase, userId),
    listBehaviorLogImportRecordMappings(supabase, userId),
    listImportedNotes(supabase, userId),
    listImportedInterventions(supabase, userId),
    listBehaviorConfigurationEvents(supabase, userId),
    listAppliedBehaviorLogImportRuns(supabase, userId),
  ]);
  const occurrenceIds = occurrences.map((occurrence) => occurrence.id);
  const [statusEvents, timeSessions] = await Promise.all([
    listOccurrenceStatusEventsByOccurrenceIds(supabase, userId, occurrenceIds),
    listTimeSessionsByOccurrenceIds(supabase, {
      userId,
      occurrenceIds,
    }),
  ]);
  return assembleBehaviorLogExistingRecords({ behaviors, occurrences, definitionEvents, configurationEvents, mappings, importedNotes, importedInterventions, statusEvents, timeSessions, importRuns });
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "BehaviorLog import could not be completed.";
}
