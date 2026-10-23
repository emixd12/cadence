import { createHash } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveExportBundle } from "../lib/resolvers/export.resolver";
import {
  applyBehaviorLogRestoreUploadFromFormData,
  BehaviorLogRestoreAuthError,
  createBehaviorLogRestorePreviewRun,
  deriveBehaviorLogRestoreLocalId,
  previewBehaviorLogRestoreFromZip,
  previewBehaviorLogRestoreUploadFromFormData,
} from "../lib/services/behaviorlog-restore.service";
import { createStoredZip } from "../lib/services/zip";
import { BEHAVIORLOG_BUNDLE_SIZE_ERROR } from "../lib/types/behaviorlog-bundle-ui";
import type {
  ExportBehaviorInput,
  ExportBehaviorConfigurationEventInput,
  ExportCategoryInput,
  ExportOccurrenceInput,
  ExportStatusEventInput,
  ExportTimeSessionInput,
} from "../lib/types/export";
import { DEFAULT_TIMEZONE } from "../lib/types/recurrence";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Temporal.Instant.from("2026-06-08T16:00:00Z");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
type RestorePayloadForTest = {
  behaviors: Array<{
    id: string;
    external_id: string;
    title: string;
    description: string | null;
    active: boolean;
    created_at: string | null;
  }>;
  behavior_definition_events: Array<{
    id: string;
    external_id: string | null;
    event_kind: "baseline" | "transition";
    behavior_id: string;
    previous_title: string | null;
    next_title: string;
    previous_description: string | null;
    next_description: string | null;
    changed_fields: Array<"title" | "description">;
    recorded_at: string;
    source: "import";
    reason: "behaviorlog_restore";
    expected_previous_title: string | null;
    expected_previous_description: string | null;
  }>;
  behavior_configuration_events: Array<{
    behavior_id: string;
    event_kind: "baseline" | "revision";
    previous_configuration: Record<string, unknown> | null;
    next_configuration: Record<string, unknown>;
    changed_fields: string[];
    recorded_at: string;
    effective_at: string;
    source: "import";
    reason_code: "behaviorlog_restore";
  }>;
  schedules: Array<{
    id: string;
    external_id: string;
    behavior_id: string;
    configuration_sort_order: number;
    recurrence_rule: Record<string, unknown>;
  }>;
  occurrences: Array<{
    id: string;
    external_id: string;
    behavior_id: string;
    behavior_schedule_slot_id: string | null;
    scheduled_for: string;
    local_date: string;
    status: "unresolved" | "completed" | "not_completed";
  }>;
  status_events: Array<{
    id: string;
    external_id: string;
    occurrence_id: string;
    behavior_id: string;
    recorded_at: string;
    status: "unresolved" | "completed" | "not_completed";
    status_semantics: "explicit_user_mark";
    revises_event_id: string | null;
  }>;
  time_sessions: Array<{
    id: string;
    external_id: string;
    occurrence_id: string;
    behavior_id: string;
    started_at: string;
    stopped_at: string | null;
  }>;
  mappings: Array<{
    record_type: string;
    external_id: string;
    local_id: string;
  }>;
  preconditions: Array<{
    record_type: string;
    local_id: string;
    expectation: "absent" | "unchanged";
    expected_updated_at: string | null;
  }>;
  apply_payload_digest: string;
};

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getBehaviorLogImportRunById: vi.fn(),
  getAppliedBehaviorLogRestoreRunByAcceptedPreview: vi.fn(),
  createBehaviorLogImportRun: vi.fn(),
  markBehaviorLogRestoreRunFailedIfPending: vi.fn(),
  bindBehaviorLogRestoreApplyPayload: vi.fn(),
  listBehaviorLogExistingRecords: vi.fn(),
  markOccurrenceSyncStale: vi.fn(),
  repairUserOccurrenceReminderGraphBestEffort: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/db/behaviorLogImports.repo", async (importOriginal) => {
  const original = await importOriginal<object>();

  return {
    ...original,
    getBehaviorLogImportRunById: mocks.getBehaviorLogImportRunById,
    getAppliedBehaviorLogRestoreRunByAcceptedPreview:
      mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview,
    createBehaviorLogImportRun: mocks.createBehaviorLogImportRun,
    markBehaviorLogRestoreRunFailedIfPending:
      mocks.markBehaviorLogRestoreRunFailedIfPending,
    bindBehaviorLogRestoreApplyPayload:
      mocks.bindBehaviorLogRestoreApplyPayload,
  };
});

vi.mock("@/lib/services/behaviorlog-import.service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/services/behaviorlog-import.service")>();

  return {
    ...original,
    listBehaviorLogExistingRecords: mocks.listBehaviorLogExistingRecords,
  };
});

vi.mock("@/lib/services/occurrence-sync-state.service", () => ({
  markOccurrenceSyncStale: mocks.markOccurrenceSyncStale,
}));

vi.mock("@/lib/services/occurrence-reminder-repair.service", () => ({
  repairUserOccurrenceReminderGraphBestEffort:
    mocks.repairUserOccurrenceReminderGraphBestEffort,
}));

describe("BehaviorLog restore apply service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: {
            claims: {
              sub: USER_ID,
            },
          },
          error: null,
        })),
      },
      rpc: vi.fn(),
    });
    mocks.listBehaviorLogExistingRecords.mockResolvedValue(emptyExisting());
    mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview.mockResolvedValue(
      null,
    );
    mocks.markBehaviorLogRestoreRunFailedIfPending.mockResolvedValue({});
    mocks.markOccurrenceSyncStale.mockResolvedValue({});
    mocks.repairUserOccurrenceReminderGraphBestEffort.mockResolvedValue(false);
    mocks.bindBehaviorLogRestoreApplyPayload.mockResolvedValue(
      "a".repeat(64),
    );
  });

  it("derives account-scoped ids for create actions even when external ids are UUID-shaped", () => {
    const externalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const createAction = {
      recordType: "behavior" as const,
      action: "create" as const,
      destructive: false,
      externalId,
      localId: null,
      reasons: [],
    };
    const first = deriveBehaviorLogRestoreLocalId(createAction, {
      externalId,
      label: "behavior",
      recordType: "behavior",
      userId: USER_ID,
      bundleFingerprint: "bundle-fingerprint",
    });
    const repeated = deriveBehaviorLogRestoreLocalId(createAction, {
      externalId,
      label: "behavior",
      recordType: "behavior",
      userId: USER_ID,
      bundleFingerprint: "bundle-fingerprint",
    });
    const otherAccount = deriveBehaviorLogRestoreLocalId(createAction, {
      externalId,
      label: "behavior",
      recordType: "behavior",
      userId: "99999999-9999-4999-8999-999999999999",
      bundleFingerprint: "bundle-fingerprint",
    });

    expect(first).toMatch(UUID_PATTERN);
    expect(first).not.toBe(externalId);
    expect(repeated).toBe(first);
    expect(otherAccount).not.toBe(first);
  });

  it("requires a fresh-backup acknowledgement before auth or writes", async () => {
    await expect(
      applyBehaviorLogRestoreUploadFromFormData(new FormData()),
    ).rejects.toThrow("fresh backup");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
  });

  it("authenticates before parsing a supported-name restore upload", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: {} },
          error: null,
        })),
      },
      rpc: vi.fn(),
    });
    const formData = new FormData();

    formData.set(
      "restore_behaviorlog_file",
      new File(["not a zip"], "cadence-export.behaviorlog.zip", {
        type: "application/zip",
      }),
    );

    await expect(
      previewBehaviorLogRestoreUploadFromFormData(formData),
    ).rejects.toBeInstanceOf(BehaviorLogRestoreAuthError);
    expect(mocks.createClient).toHaveBeenCalled();
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
  });

  it("authenticates before decoding a restore apply bundle payload", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: {} },
          error: null,
        })),
      },
      rpc: vi.fn(),
    });
    const formData = new FormData();

    formData.set("confirm_backup", "yes");
    formData.set("confirm_restore_text", "RESTORE");
    formData.set("bundle_payload", Buffer.from("not a zip").toString("base64"));

    await expect(
      applyBehaviorLogRestoreUploadFromFormData(formData),
    ).rejects.toBeInstanceOf(BehaviorLogRestoreAuthError);
    expect(mocks.getBehaviorLogImportRunById).not.toHaveBeenCalled();
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
  });

  it("rejects restore files above 3 MiB with Cadence's exact size error", async () => {
    const formData = new FormData();

    formData.set(
      "restore_behaviorlog_file",
      new File(
        [new Uint8Array(3 * 1024 * 1024 + 1)],
        "too-large.behaviorlog.zip",
        { type: "application/zip" },
      ),
    );

    await expect(
      previewBehaviorLogRestoreUploadFromFormData(formData),
    ).rejects.toThrow(BEHAVIORLOG_BUNDLE_SIZE_ERROR);
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
  });

  it("keeps only the exact raw-archive fingerprint in restore preview action state", async () => {
    const zip = createStoredZip(bundleFiles());
    const formData = new FormData();

    mocks.createBehaviorLogImportRun.mockResolvedValueOnce({
      id: "preview-run",
      user_id: USER_ID,
      import_mode: "restore_preview",
      status: "previewed",
      dry_run_summary: {},
      started_at: "2026-06-08T21:10:00Z",
      completed_at: "2026-06-08T21:10:01Z",
      failure_message: null,
    });
    formData.set(
      "restore_behaviorlog_file",
      new File([new Uint8Array(zip)], "cadence-export.behaviorlog.zip", {
        type: "application/zip",
      }),
    );

    const state =
      await previewBehaviorLogRestoreUploadFromFormData(formData);

    expect(state.status).toBe("previewed");
    expect(state).not.toHaveProperty("bundlePayload");
    expect(state.archiveFingerprint).toBe(sha256Bytes(zip));
  });

  it("records synchronously completed restore previews with a completion time", async () => {
    mocks.createBehaviorLogImportRun.mockResolvedValueOnce({
      id: "preview-run",
      user_id: USER_ID,
      import_mode: "restore_preview",
      status: "previewed",
      dry_run_summary: {},
      started_at: "2026-06-08T21:10:00Z",
      completed_at: "2026-06-08T21:10:01Z",
      failure_message: null,
    });

    const result = await createBehaviorLogRestorePreviewRun(
      {} as never,
      {
        userId: USER_ID,
        files: bundleFiles(),
        archiveFingerprint: sha256Bytes(createStoredZip(bundleFiles())),
      },
    );

    expect(result.importRun.completed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
    );
    expect(mocks.createBehaviorLogImportRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        importMode: "restore_preview",
        status: "previewed",
        startedAt: expect.any(String),
        completedAt: expect.any(String),
        dryRunSummary: expect.objectContaining({
          archiveFingerprint: sha256Bytes(createStoredZip(bundleFiles())),
          bundlePayloadFingerprint: sha256Bytes(createStoredZip(bundleFiles())),
        }),
      }),
    );
  });

  it("binds native reminder conversion to the accepted restore preview", async () => {
    const zip = createStoredZip(bundleFiles({ nativeReminders: true }));
    expect(previewBehaviorLogRestoreFromZip({ zip, existing: emptyExisting() }).valid).toBe(false);
    const preview = previewBehaviorLogRestoreFromZip({ zip, existing: emptyExisting(), convertNativeRemindersToBrowser: true });
    expect(preview.valid).toBe(true);
    expect(preview.warnings.some(issue => issue.code === "native_reminder_converted_to_browser")).toBe(true);
    mocks.getBehaviorLogImportRunById.mockResolvedValue(restorePreviewRun(preview, zip));
    await expect(applyBehaviorLogRestoreUploadFromFormData(restoreApplyFormData(zip, preview))).rejects.toThrow(/preview/i);
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
    expect(mocks.bindBehaviorLogRestoreApplyPayload).not.toHaveBeenCalled();
  });

  it("requires typed restore confirmation before auth or writes", async () => {
    const formData = new FormData();

    formData.set("confirm_backup", "yes");

    await expect(applyBehaviorLogRestoreUploadFromFormData(formData)).rejects.toThrow(
      "Type RESTORE",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses stale previews when local data no longer matches the accepted run", async () => {
    const zip = createStoredZip(bundleFiles());
    const bundlePreview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const formData = new FormData();

    formData.set("confirm_backup", "yes");
    formData.set("confirm_restore_text", "RESTORE");
    formData.set("restore_preview_run_id", "preview-run");
    formData.set("preview_fingerprint", "accepted-preview");
    formData.set("local_data_fingerprint", "accepted-local");
    formData.set("archive_fingerprint", sha256Bytes(zip));
    formData.set("bundle_payload", Buffer.from(zip).toString("base64"));
    formData.set("upload_file_name", "cadence-export.behaviorlog.zip");
    formData.set("upload_file_size", String(zip.byteLength));
    mocks.getBehaviorLogImportRunById.mockResolvedValue({
      id: "preview-run",
      user_id: USER_ID,
      import_mode: "restore_preview",
      status: "previewed",
      dry_run_summary: {
        ...acceptedPreviewSnapshot(bundlePreview),
        previewFingerprint: "accepted-preview",
        localDataFingerprint: "accepted-local",
      },
      bundle_fingerprint: bundlePreview.bundleFingerprint,
      started_at: "2026-06-08T21:10:00Z",
      completed_at: null,
      failure_message: null,
    });

    await expect(applyBehaviorLogRestoreUploadFromFormData(formData)).rejects.toThrow(
      "Local data changed",
    );
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
  });

  it("rejects a replacement status-history preview as preview-only", async () => {
    const zip = createStoredZip(bundleFiles());
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
      statusHistoryPolicy: "replace_status_history",
    });

    expect(preview.valid).toBe(true);
    expect(preview.statusHistoryPolicy.applySupportedInThisTicket).toBe(false);
    mocks.getBehaviorLogImportRunById.mockResolvedValue(
      restorePreviewRun(preview, zip),
    );

    await expect(
      applyBehaviorLogRestoreUploadFromFormData(
        restoreApplyFormData(zip, preview),
      ),
    ).rejects.toThrow("status-history policy is preview-only");
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
    expect(mocks.bindBehaviorLogRestoreApplyPayload).not.toHaveBeenCalled();
  });

  it("restores a valid standard running time session", async () => {
    const zip = createStoredZip(
      bundleFiles({
        timeSessions: [
          {
            id: "session-1",
            occurrenceId: "11111111-1111-4111-8111-111111111114",
            behaviorId: "11111111-1111-4111-8111-111111111112",
            startedAt: "2026-06-08T13:00:00Z",
            stoppedAt: null,
          },
        ],
      }),
    );
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const rpc = vi.fn(
      async (
        _functionName: string,
        _args: { restore_payload: RestorePayloadForTest },
      ) => {
        void _functionName;
        void _args;

        return {
          data: { behaviors: 1, schedules: 1, occurrences: 1, status_events: 1 },
          error: null,
        };
      },
    );
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: { sub: USER_ID } },
          error: null,
        })),
      },
      rpc,
    });
    mocks.getBehaviorLogImportRunById.mockResolvedValue(
      restorePreviewRun(preview, zip),
    );
    mocks.createBehaviorLogImportRun.mockResolvedValue({
      ...restoreAppliedRun(preview),
      status: "previewed",
      completed_at: null,
    });

    expect(preview.valid).toBe(true);
    expect(preview.actions.timeSessions).toEqual([
      expect.objectContaining({ action: "create", externalId: "session-1" }),
    ]);
    expect(preview.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "time_session_running_conflict" }),
      ]),
    );

    const applyFormData = restoreApplyFormData(zip, preview);

    applyFormData.set("confirm_sensitive_notes", "yes");
    await applyBehaviorLogRestoreUploadFromFormData(applyFormData);

    const restorePayload = rpc.mock.calls[0]?.[1]?.restore_payload;
    expect(restorePayload.time_sessions).toEqual([
      expect.objectContaining({
        external_id: "session-1",
        started_at: "2026-06-08T13:00:00Z",
        stopped_at: null,
      }),
    ]);
    expect(restorePayload.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: "time_session",
          external_id: "session-1",
          local_id: restorePayload.time_sessions[0]?.id,
        }),
      ]),
    );
  });

  it("returns the applied result for an exact accepted preview before recomputing changed local data", async () => {
    const zip = createStoredZip(bundleFiles());
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const previewRun = restorePreviewRun(preview);
    const appliedRun = restoreAppliedRun(preview);

    mocks.getBehaviorLogImportRunById.mockResolvedValue(previewRun);
    mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview.mockResolvedValue(
      appliedRun,
    );

    const result = await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, preview),
    );

    expect(result.status).toBe("applied");
    expect(result.message).toContain("already applied");
    expect(result.preview).toBeNull();
    expect(result.previewRun?.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(
      mocks.repairUserOccurrenceReminderGraphBestEffort,
    ).toHaveBeenCalledWith(expect.anything(), USER_ID, {
      operation: "behaviorlog_restore",
    });
    expect(result.applyResult?.importRun.id).toBe(appliedRun.id);
    expect(result.applyResult?.appliedCounts).toEqual({
      upserted_schedules: 1,
      provenance_mappings: 4,
    });
    expect(mocks.listBehaviorLogExistingRecords).not.toHaveBeenCalled();
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
  });

  it("does not reuse an applied result for a changed bundle payload", async () => {
    const files = bundleFiles();
    const zip = createStoredZip(files);
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const previewRun = restorePreviewRun(preview);
    const changedFiles = files.map((file, index) =>
      index === 0 ? { ...file, content: `${file.content}\n` } : file,
    );

    mocks.getBehaviorLogImportRunById.mockResolvedValue(previewRun);
    mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview.mockResolvedValue(
      restoreAppliedRun(preview),
    );

    await expect(
      applyBehaviorLogRestoreUploadFromFormData(
        restoreApplyFormData(createStoredZip(changedFiles), preview, zip),
      ),
    ).rejects.toThrow(
      "The uploaded bundle no longer matches the accepted restore preview. Preview the restore again.",
    );
    expect(
      mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview,
    ).not.toHaveBeenCalled();
  });

  it("recognizes a concurrent apply that commits during stale-preview recomputation", async () => {
    const zip = createStoredZip(bundleFiles());
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const previewRun = restorePreviewRun(preview);
    const appliedRun = restoreAppliedRun(preview);

    mocks.getBehaviorLogImportRunById.mockResolvedValue(previewRun);
    mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(appliedRun);
    mocks.listBehaviorLogExistingRecords.mockResolvedValue({
      ...emptyExisting(),
      behaviors: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Local data committed by the concurrent request",
          category: null,
          active: true,
          archivedAt: null,
          schedules: [],
        },
      ],
    });

    const result = await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, preview),
    );

    expect(result.status).toBe("applied");
    expect(
      mocks.repairUserOccurrenceReminderGraphBestEffort,
    ).toHaveBeenCalledWith(expect.anything(), USER_ID, {
      operation: "behaviorlog_restore",
    });
    expect(result.applyResult?.importRun.id).toBe(appliedRun.id);
    expect(
      mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview,
    ).toHaveBeenCalledTimes(2);
    expect(mocks.createBehaviorLogImportRun).not.toHaveBeenCalled();
  });

  it("does not overwrite an atomically applied run when the RPC acknowledgement is uncertain", async () => {
    const zip = createStoredZip(bundleFiles());
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const previewRun = restorePreviewRun(preview);
    const applyRun = {
      ...restoreAppliedRun(preview),
      status: "previewed",
      completed_at: null,
    };
    const committedRun = restoreAppliedRun(preview);
    const rpc = vi.fn(async () => ({
      data: null,
      error: new Error("RPC response was interrupted"),
    }));

    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: { sub: USER_ID } },
          error: null,
        })),
      },
      rpc,
    });
    mocks.getBehaviorLogImportRunById.mockResolvedValue(previewRun);
    mocks.getAppliedBehaviorLogRestoreRunByAcceptedPreview
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committedRun);
    mocks.createBehaviorLogImportRun.mockResolvedValue(applyRun);
    mocks.markBehaviorLogRestoreRunFailedIfPending.mockResolvedValue(null);

    const result = await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, preview),
    );

    expect(result.status).toBe("applied");
    expect(result.applyResult?.importRun.id).toBe(committedRun.id);
    expect(mocks.markBehaviorLogRestoreRunFailedIfPending).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ importRunId: applyRun.id }),
    );
  });

  it("builds stable restore ids and resolver-planned definition history", async () => {
    const zip = createStoredZip(bundleFiles());
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const scheduleAction = preview.actions.schedules[0];

    expect(scheduleAction?.action).toBe("create");
    expect(scheduleAction?.localId).toBeNull();
    expect(scheduleAction?.externalId).toMatch(/^sch_/u);
    expect(preview.actions.occurrences[0]?.action).toBe("create");
    expect(preview.actions.statusEvents[0]?.action).toBe("create");

    const rpc = vi.fn(
      async (
        functionName: string,
        args: { restore_payload: RestorePayloadForTest },
      ) => {
        expect(functionName).toBe(
          "apply_behaviorlog_restore_with_configuration_events",
        );
        expect(args.restore_payload.schedules.length).toBe(1);

        return {
          data: {
            behaviors: 1,
            schedules: 1,
            occurrences: 1,
            status_events: 1,
          },
          error: null,
        };
      },
    );
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: {
            claims: {
              sub: USER_ID,
            },
          },
          error: null,
        })),
      },
      rpc,
    });
    mocks.getBehaviorLogImportRunById.mockResolvedValue(
      restorePreviewRun(preview),
    );
    const applyRun = {
      id: "33333333-3333-4333-8333-333333333333",
      user_id: USER_ID,
      import_mode: "restore_apply",
      status: "previewed",
      dry_run_summary: {},
      started_at: "2026-06-08T21:11:00Z",
      completed_at: null,
      failure_message: null,
    };
    const secondApplyRun = {
      ...applyRun,
      id: "44444444-4444-4444-8444-444444444444",
    };
    const replaceApplyRun = {
      ...applyRun,
      id: "55555555-5555-4555-8555-555555555555",
    };
    const normalizedNoOpApplyRun = {
      ...applyRun,
      id: "66666666-6666-4666-8666-666666666666",
    };
    const archiveApplyRun = {
      ...applyRun,
      id: "77777777-7777-4777-8777-777777777777",
    };
    mocks.createBehaviorLogImportRun
      .mockResolvedValueOnce(applyRun)
      .mockResolvedValueOnce(secondApplyRun)
      .mockResolvedValueOnce(normalizedNoOpApplyRun)
      .mockResolvedValueOnce(replaceApplyRun)
      .mockResolvedValueOnce(archiveApplyRun);

    const result = await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, preview),
    );

    expect(result.status).toBe("applied");
    const restorePayload = rpc.mock.calls[0]?.[1]?.restore_payload;
    const restoredScheduleId = restorePayload.schedules[0]?.id;

    expect(restoredScheduleId).toMatch(UUID_PATTERN);
    expect(restoredScheduleId).not.toBe(scheduleAction?.externalId);
    expect(restorePayload.occurrences[0]?.behavior_schedule_slot_id).toBe(
      restoredScheduleId,
    );
    expect(restorePayload.behavior_definition_events).toEqual([
      {
        id: expect.stringMatching(UUID_PATTERN),
        external_id: null,
        event_kind: "baseline",
        behavior_id: restorePayload.behaviors[0]?.id,
        previous_title: null,
        next_title: "Brush teeth",
        previous_description: null,
        next_description: "Night brushing",
        changed_fields: ["title", "description"],
        recorded_at: "2026-05-01T12:00:00Z",
        source: "import",
        reason: "behaviorlog_restore",
        expected_previous_title: null,
        expected_previous_description: null,
      },
    ]);
    expect(restorePayload.behavior_configuration_events).toEqual([
      expect.objectContaining({
        behavior_id: restorePayload.behaviors[0]?.id,
        event_kind: "baseline",
        previous_configuration: null,
        changed_fields: [
          "category_id",
          "location_text",
          "where_kind",
          "schedule_graph",
          "browser_reminder_enabled",
          "email_reminder_enabled",
          "reminder_offset_minutes",
          "active",
          "timezone",
        ],
        recorded_at: expect.any(String),
        effective_at: expect.any(String),
        source: "import",
        reason_code: "behaviorlog_restore",
        next_configuration: expect.objectContaining({
          active: true,
          schedule_graph: [
            expect.objectContaining({
              recurrence_rule: { frequency: "daily", interval: 1 },
              time_entries: [
                expect.objectContaining({ start_time: "22:00:00" }),
              ],
            }),
          ],
        }),
      }),
    ]);
    expect(restorePayload.schedules[0]).toMatchObject({
      configuration_sort_order: 0,
      recurrence_rule: { frequency: "daily", interval: 1 },
    });
    expect(restorePayload.behaviors[0]?.created_at).toBe(
      "2026-05-01T12:00:00Z",
    );
    expect(restorePayload.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: "schedule",
          external_id: scheduleAction?.externalId,
          local_id: restoredScheduleId,
        }),
      ]),
    );
    expect(restorePayload.apply_payload_digest).toBe("a".repeat(64));
    expect(mocks.bindBehaviorLogRestoreApplyPayload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        importRunId: applyRun.id,
        restorePayload: expect.objectContaining({
          apply_run_id: applyRun.id,
          preconditions: expect.arrayContaining([
            expect.objectContaining({
              record_type: "schedule",
              local_id: restoredScheduleId,
              expectation: "absent",
            }),
          ]),
        }),
      }),
    );
    expect(mocks.markBehaviorLogRestoreRunFailedIfPending).not.toHaveBeenCalled();

    await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, preview),
    );
    const repeatedPayload = rpc.mock.calls[1]?.[1]?.restore_payload;

    expect(repeatedPayload.schedules[0]?.id).toBe(restoredScheduleId);
    expect(
      repeatedPayload.mappings.find(
        (mapping) => mapping.record_type === "schedule",
      )?.local_id,
    ).toBe(restoredScheduleId);

    const existingAfterRestore = existingRecordsFromRestorePayload(restorePayload);
    const existingBehavior = existingAfterRestore.behaviors[0];

    if (!existingBehavior) {
      throw new Error("Expected a restored behavior fixture.");
    }

    existingBehavior.title = "\t\u00a0Brush teeth\u3000";
    existingBehavior.description = "\u2003Night brushing\u202f";
    const normalizedNoOpPreview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: existingAfterRestore,
    });

    expect(normalizedNoOpPreview.actions.behaviors[0]?.action).toBe("keep");
    mocks.listBehaviorLogExistingRecords.mockResolvedValueOnce(
      existingAfterRestore,
    );
    mocks.getBehaviorLogImportRunById.mockResolvedValueOnce(
      restorePreviewRun(normalizedNoOpPreview),
    );

    await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, normalizedNoOpPreview),
    );
    const normalizedNoOpPayload = rpc.mock.calls[2]?.[1]?.restore_payload;

    expect(normalizedNoOpPayload.behavior_definition_events).toEqual([]);
    expect(normalizedNoOpPayload.status_events).toEqual([]);
    expect(normalizedNoOpPayload.behaviors[0]).toMatchObject({
      title: "\t\u00a0Brush teeth\u3000",
      description: "\u2003Night brushing\u202f",
    });

    existingBehavior.title = "Old brush title";
    existingBehavior.description = "Old description";
    const laterPreview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: existingAfterRestore,
    });
    const laterScheduleAction = laterPreview.actions.schedules.find(
      (action) => action.externalId === scheduleAction?.externalId,
    );

    expect(laterScheduleAction?.localId).toBe(restoredScheduleId);
    expect(laterScheduleAction?.action).not.toBe("create");
    expect(laterPreview.actions.occurrences[0]?.action).not.toBe("skip");
    expect(laterPreview.actions.statusEvents[0]?.action).not.toBe("skip");
    expect(laterPreview.actions.behaviors[0]?.action).toBe("replace");

    mocks.listBehaviorLogExistingRecords.mockResolvedValueOnce(
      existingAfterRestore,
    );
    mocks.getBehaviorLogImportRunById.mockResolvedValueOnce(
      restorePreviewRun(laterPreview),
    );

    await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, laterPreview),
    );
    const replacePayload = rpc.mock.calls[3]?.[1]?.restore_payload;

    expect(replacePayload.behavior_definition_events).toEqual([
      expect.objectContaining({
        event_kind: "transition",
        behavior_id: restorePayload.behaviors[0]?.id,
        previous_title: "Old brush title",
        next_title: "Brush teeth",
        previous_description: "Old description",
        next_description: "Night brushing",
        changed_fields: ["title", "description"],
        recorded_at: expect.any(String),
        source: "import",
        reason: "behaviorlog_restore",
        expected_previous_title: "Old brush title",
        expected_previous_description: "Old description",
      }),
    ]);
    expect(replacePayload.behavior_configuration_events).toEqual([]);
    expect(replacePayload.preconditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: "behavior",
          local_id: restorePayload.behaviors[0]?.id,
          expectation: "unchanged",
          expected_updated_at: "2026-06-08T21:12:00Z",
        }),
      ]),
    );

    const archiveExisting = existingRecordsFromRestorePayload(restorePayload);
    const archivedBehaviorId = "88888888-8888-4888-8888-888888888888";
    const archivedScheduleId = "99999999-9999-4999-8999-999999999999";
    const archivedSchedule = {
      id: archivedScheduleId,
      rowUpdatedAtUtc: "2026-06-08T21:12:00Z",
      behaviorId: archivedBehaviorId,
      recurrenceProfile: "behaviorlog.calendar_simple.v1",
      recurrence: { type: "daily", interval: 1 },
      timezone: DEFAULT_TIMEZONE,
      localTime: "08:00",
      windowStartLocal: null,
      windowEndLocal: null,
      cadenceScheduleKind: "exact" as const,
      cadenceSchedulePreset: null,
      activeFromLocalDate: "2026-05-01",
      activeUntilLocalDate: null,
      sourceOriginalId: archivedScheduleId,
    };
    archiveExisting.behaviors.push({
      id: archivedBehaviorId,
      rowUpdatedAtUtc: "2026-06-08T21:12:00Z",
      title: "Archived context",
      description: "Retained archived context",
      category: "Other",
      active: true,
      archivedAt: null,
      sourceOriginalId: archivedBehaviorId,
      schedules: [archivedSchedule],
      configurationSnapshot: {
        categoryId: null,
        scheduleGraph: [
          {
            recurrenceRule: { frequency: "daily", interval: 1 },
            sortOrder: 0,
            timeEntries: [
              {
                id: archivedScheduleId,
                kind: "exact",
                preset: null,
                startTime: "08:00",
                endTime: null,
                sortOrder: 0,
              },
            ],
          },
        ],
        browserReminderEnabled: true,
        emailReminderEnabled: false,
        reminderOffsetMinutes: 0,
        active: true,
        timezone: DEFAULT_TIMEZONE,
      },
    });
    archiveExisting.schedules.push(archivedSchedule);
    const archivePreview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: archiveExisting,
    });

    expect(
      archivePreview.actions.behaviors.find(
        (action) => action.localId === archivedBehaviorId,
      )?.action,
    ).toBe("archive");
    mocks.listBehaviorLogExistingRecords.mockResolvedValueOnce(archiveExisting);
    mocks.getBehaviorLogImportRunById.mockResolvedValueOnce(
      restorePreviewRun(archivePreview),
    );

    await applyBehaviorLogRestoreUploadFromFormData(
      restoreApplyFormData(zip, archivePreview),
    );
    const archivePayload = rpc.mock.calls[4]?.[1]?.restore_payload;
    const archiveEvent = archivePayload.behavior_configuration_events.find(
      (event) => event.behavior_id === archivedBehaviorId,
    );

    expect(archiveEvent).toMatchObject({
      event_kind: "revision",
      changed_fields: ["active"],
      previous_configuration: expect.objectContaining({ active: true }),
      next_configuration: expect.objectContaining({
        active: false,
        schedule_graph: [
          expect.objectContaining({
            time_entries: [expect.objectContaining({ start_time: "08:00:00" })],
          }),
        ],
      }),
    });
  });

  it("restores historical Occurrences detached while keeping only the current schedule", async () => {
    const files = dailyToWeeklyBundleFiles();
    const zip = createStoredZip(files);
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const rpc = vi.fn(
      async (
        _functionName: string,
        _args: { restore_payload: RestorePayloadForTest },
      ) => {
        void _functionName;
        void _args;

        return {
          data: {
            behaviors: 1,
            schedules: 1,
            occurrences: 2,
            status_events: 2,
          },
          error: null,
        };
      },
    );

    expect(preview.errors).toEqual([]);
    expect(
      Object.values(preview.actions)
        .flat()
        .filter(
          (action) =>
            action.action === "skip" &&
            action.metadata?.historicalReferenceOnly !== true,
        ),
    ).toEqual([]);
    expect(preview.valid).toBe(true);
    expect(preview.actions.schedules.map((action) => action.action)).toEqual([
      "skip",
      "create",
    ]);
    expect(preview.actions.occurrences.map((action) => action.action)).toEqual([
      "create",
      "create",
    ]);
    expect(preview.actions.inlineOccurrenceNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "note_occurrence-daily",
          action: "create",
          relatedExternalIds: { occurrence: "occurrence-daily" },
        }),
      ]),
    );
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: { sub: USER_ID } },
          error: null,
        })),
      },
      rpc,
    });
    mocks.getBehaviorLogImportRunById.mockResolvedValue(
      restorePreviewRun(preview, zip),
    );
    mocks.createBehaviorLogImportRun.mockResolvedValue({
      ...restoreAppliedRun(preview),
      status: "previewed",
      completed_at: null,
    });

    const applyFormData = restoreApplyFormData(zip, preview);

    applyFormData.set("confirm_sensitive_notes", "yes");
    await applyBehaviorLogRestoreUploadFromFormData(applyFormData);

    const payload = rpc.mock.calls[0]?.[1]?.restore_payload;
    expect(payload.schedules).toHaveLength(1);
    expect(payload.schedules[0]?.recurrence_rule).toEqual({
      frequency: "weekly",
      interval: 1,
      daysOfWeek: ["monday"],
    });
    expect(payload.occurrences).toHaveLength(2);
    expect(
      payload.occurrences.find(
        (occurrence) => occurrence.external_id === "occurrence-daily",
      ),
    ).toMatchObject({
      behavior_schedule_slot_id: null,
      schedule_kind: "exact",
      schedule_start_time: "09:00",
      status: "completed",
      note: "Daily-period note.",
    });
    expect(
      payload.occurrences.find(
        (occurrence) => occurrence.external_id === "occurrence-weekly",
      )?.behavior_schedule_slot_id,
    ).toEqual(expect.any(String));
    expect(payload.status_events).toHaveLength(2);
    expect(payload.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          record_type: "occurrence",
          external_id: "occurrence-daily",
        }),
        expect.objectContaining({
          record_type: "status_event",
          external_id: "event-daily",
        }),
      ]),
    );
    expect(
      payload.mappings.some(
        (mapping) =>
          mapping.record_type === "schedule" &&
          mapping.external_id.includes("config-daily"),
      ),
    ).toBe(false);
  });

  it("restores an archived false-baseline Behavior with one inactive current graph", async () => {
    const files = archivedBaselineBundleFiles();
    const zip = createStoredZip(files);
    const preview = previewBehaviorLogRestoreFromZip({
      zip,
      existing: emptyExisting(),
    });
    const rpc = vi.fn(
      async (
        _functionName: string,
        _args: { restore_payload: RestorePayloadForTest },
      ) => {
        void _functionName;
        void _args;

        return {
          data: {
            behaviors: 1,
            schedules: 1,
            occurrences: 1,
            status_events: 1,
          },
          error: null,
        };
      },
    );

    expect(preview.valid).toBe(true);
    expect(preview.actions.behaviors).toEqual([
      expect.objectContaining({ action: "create" }),
    ]);
    expect(preview.actions.schedules).toEqual([
      expect.objectContaining({ action: "create" }),
    ]);
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn(async () => ({
          data: { claims: { sub: USER_ID } },
          error: null,
        })),
      },
      rpc,
    });
    mocks.getBehaviorLogImportRunById.mockResolvedValue(
      restorePreviewRun(preview, zip),
    );
    mocks.createBehaviorLogImportRun.mockResolvedValue({
      ...restoreAppliedRun(preview),
      status: "previewed",
      completed_at: null,
    });
    const applyFormData = restoreApplyFormData(zip, preview);

    applyFormData.set("confirm_sensitive_notes", "yes");
    await applyBehaviorLogRestoreUploadFromFormData(applyFormData);

    const payload = rpc.mock.calls[0]?.[1]?.restore_payload;
    expect(payload.behaviors).toEqual([
      expect.objectContaining({ active: false }),
    ]);
    expect(payload.schedules).toEqual([
      expect.objectContaining({
        recurrence_rule: { frequency: "daily", interval: 1 },
      }),
    ]);
    expect(payload.occurrences).toEqual([
      expect.objectContaining({
        status: "completed",
        note: "Archived baseline note.",
      }),
    ]);
    expect(payload.status_events).toHaveLength(1);
  });
});

function emptyExisting() {
  return {
    behaviors: [],
    schedules: [],
    occurrences: [],
    statusEvents: [],
    definitionEvents: [],
    timeSessions: [],
    importedNotes: [],
    importedInterventions: [],
    mappings: [],
  };
}

function restorePreviewRun(
  preview: ReturnType<typeof previewBehaviorLogRestoreFromZip>,
  zip: Uint8Array = createStoredZip(bundleFiles()),
) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: USER_ID,
    import_mode: "restore_preview",
    status: "previewed",
    bundle_fingerprint: preview.bundleFingerprint,
    dry_run_summary: acceptedPreviewSnapshot(preview, zip),
    started_at: "2026-06-08T21:10:00Z",
    completed_at: "2026-06-08T21:10:01Z",
    failure_message: null,
  };
}

function acceptedPreviewSnapshot(
  preview: ReturnType<typeof previewBehaviorLogRestoreFromZip>,
  zip: Uint8Array = createStoredZip(bundleFiles()),
) {
  return {
    ...preview,
    errorCount: preview.errors.length,
    warningCount: preview.warnings.length,
    archiveFingerprint: sha256Bytes(zip),
  };
}

function restoreAppliedRun(
  preview: ReturnType<typeof previewBehaviorLogRestoreFromZip>,
) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: USER_ID,
    import_mode: "restore_apply",
    status: "applied",
    accepted_preview_run_id: "22222222-2222-4222-8222-222222222222",
    accepted_preview_fingerprint: preview.previewFingerprint,
    bundle_fingerprint: preview.bundleFingerprint,
    dry_run_summary: {
      ...preview,
      applyResult: {
        upserted_schedules: 1,
        provenance_mappings: 4,
      },
    },
    started_at: "2026-06-08T21:11:00Z",
    completed_at: "2026-06-08T21:11:30Z",
    failure_message: null,
  };
}

function existingRecordsFromRestorePayload(payload: RestorePayloadForTest) {
  const behavior = payload.behaviors[0];
  const schedule = payload.schedules[0];
  const occurrence = payload.occurrences[0];
  const statusEvent = payload.status_events[0];

  if (!behavior || !schedule || !occurrence || !statusEvent) {
    throw new Error("Expected a complete core restore payload.");
  }

  const existingSchedule = {
    id: schedule.id,
    rowUpdatedAtUtc: "2026-06-08T21:12:00Z",
    behaviorId: behavior.id,
    recurrenceProfile: "behaviorlog.calendar_simple.v1",
    recurrence: { type: "daily", interval: 1 },
    timezone: DEFAULT_TIMEZONE,
    localTime: "22:00",
    windowStartLocal: null,
    windowEndLocal: null,
    cadenceScheduleKind: "exact" as const,
    cadenceSchedulePreset: null,
    activeFromLocalDate: "2026-05-01",
    activeUntilLocalDate: null,
    sourceOriginalId: schedule.id,
  };

  return {
    behaviors: [
      {
        id: behavior.id,
        rowUpdatedAtUtc: "2026-06-08T21:12:00Z",
        title: "Brush teeth",
        description: "Night brushing",
        category: "Grooming",
        active: true,
        archivedAt: null,
        sourceOriginalId: behavior.id,
        schedules: [existingSchedule],
        configurationSnapshot: {
          categoryId: null,
          scheduleGraph: [
            {
              recurrenceRule: { frequency: "daily", interval: 1 },
              sortOrder: 0,
              timeEntries: [
                {
                  id: schedule.id,
                  kind: "exact" as const,
                  preset: null,
                  startTime: "22:00",
                  endTime: null,
                  sortOrder: 0,
                },
              ],
            },
          ],
          browserReminderEnabled: true,
          emailReminderEnabled: false,
          reminderOffsetMinutes: 0,
          active: true,
          timezone: DEFAULT_TIMEZONE,
        },
      },
    ],
    schedules: [existingSchedule],
    occurrences: [
      {
        id: occurrence.id,
        rowUpdatedAtUtc: "2026-06-08T21:12:00Z",
        behaviorId: behavior.id,
        scheduleId: schedule.id,
        behaviorTitle: "Brush teeth",
        scheduledForUtc: occurrence.scheduled_for,
        localDate: occurrence.local_date,
        timezone: DEFAULT_TIMEZONE,
        status: occurrence.status,
        note: null,
        sourceOriginalId: occurrence.id,
      },
    ],
    statusEvents: [
      {
        id: statusEvent.id,
        rowUpdatedAtUtc: "2026-06-08T21:12:00Z",
        occurrenceId: occurrence.id,
        behaviorId: behavior.id,
        recordedAtUtc: statusEvent.recorded_at,
        status: statusEvent.status,
        statusSemantics: statusEvent.status_semantics,
        sourceCaptureMethod: "manual_tap" as const,
        sourceConfidence: "high" as const,
        revisesEventId: statusEvent.revises_event_id,
        sourceOriginalId: statusEvent.id,
      },
    ],
    definitionEvents: payload.behavior_definition_events.map((event) => ({
      id: event.id,
      behaviorId: event.behavior_id,
      recordedAtUtc: event.recorded_at,
      sourceOriginalId: event.external_id ?? event.id,
    })),
    timeSessions: payload.time_sessions.map((session) => ({
      id: session.id,
      occurrenceId: session.occurrence_id,
      behaviorId: session.behavior_id,
      startedAtUtc: session.started_at,
      stoppedAtUtc: session.stopped_at,
      sourceOriginalId: session.external_id,
    })),
    importedNotes: [],
    importedInterventions: [],
    mappings: payload.mappings.map((mapping) => ({
      recordType: mapping.record_type as
        | "behavior"
        | "schedule"
        | "occurrence"
        | "status_event"
        | "note"
        | "intervention",
      externalId: mapping.external_id,
      localId: mapping.local_id,
    })),
  };
}

function bundleFiles(
  input: { timeSessions?: ExportTimeSessionInput[]; nativeReminders?: boolean } = {},
) {
  const categories: ExportCategoryInput[] = [
    {
      id: "category-grooming",
      name: "Grooming",
      sortOrder: 1,
    },
  ];
  const behavior: ExportBehaviorInput = {
    id: "11111111-1111-4111-8111-111111111112",
    categoryId: "category-grooming",
    categoryName: "Grooming",
    title: "Brush teeth",
    description: "Night brushing",
    recurrenceRule: {
      frequency: "daily",
      interval: 1,
    },
    scheduledTime: "22:00",
    scheduleSlots: [
      {
        id: "11111111-1111-4111-8111-111111111113",
        kind: "exact",
        preset: null,
        startTime: "22:00",
        endTime: null,
        sortOrder: 0,
        label: "10:00 PM",
      },
    ],
    timezone: DEFAULT_TIMEZONE,
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    active: true,
    archivedAt: null,
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-05-01T12:00:00Z",
  };
  const occurrence: ExportOccurrenceInput = {
    id: "11111111-1111-4111-8111-111111111114",
    behaviorId: behavior.id,
    behaviorScheduleSlotId: behavior.scheduleSlots[0]?.id ?? null,
    scheduledFor: "2026-06-08T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    scheduleKind: "exact",
    schedulePreset: null,
    scheduleStartTime: "09:00",
    scheduleEndTime: null,
    localDate: "2026-06-08",
    status: "completed",
    completedAt: "2026-06-08T13:20:00Z",
    statusMarkedAt: "2026-06-08T13:22:00Z",
    note: null,
    createdAt: "2026-06-08T12:00:00Z",
    updatedAt: "2026-06-08T12:00:00Z",
  };
  const statusEvent: ExportStatusEventInput = {
    id: "evt_11111111111141118111111111111114_completed",
    occurrenceId: occurrence.id,
    behaviorId: behavior.id,
    previousStatus: "unresolved",
    status: "completed",
    statusSemantics: "explicit_user_mark",
    recordedAt: "2026-06-08T13:22:00Z",
    effectiveAt: "2026-06-08T13:20:00Z",
    localDate: occurrence.localDate,
    timezone: DEFAULT_TIMEZONE,
    sourceCaptureMethod: "manual_tap",
    sourceConfidence: "high",
    revisesEventId: null,
    reasonCode: null,
    createdAt: "2026-06-08T13:22:00Z",
    updatedAt: "2026-06-08T13:22:00Z",
  };

  return resolveExportBundle({
    profile: {
      reminderChannel: input.nativeReminders ? "other" : "browser_push",
      timezone: DEFAULT_TIMEZONE,
      subjectId: "subject_test",
    },
    categories,
    behaviors: [behavior],
    occurrences: [occurrence],
    statusEvents: [statusEvent],
    reminderDeliveries: [],
    timeSessions: input.timeSessions,
    now: NOW,
    timezone: DEFAULT_TIMEZONE,
    range: "30",
    includeTimeTracking: Boolean(input.timeSessions),
  }).behaviorLog.files;
}

function dailyToWeeklyBundleFiles() {
  const behaviorId = "behavior-history";
  const dailyConfiguration = {
    categoryId: null,
    scheduleGraph: [
      {
        recurrenceRule: { frequency: "daily" as const, interval: 1 },
        sortOrder: 0,
        timeEntries: [
          {
            kind: "exact" as const,
            preset: null,
            startTime: "09:00",
            endTime: null,
            sortOrder: 0,
          },
        ],
      },
    ],
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    active: true,
    timezone: DEFAULT_TIMEZONE,
  };
  const weeklyConfiguration = {
    ...dailyConfiguration,
    scheduleGraph: [
      {
        recurrenceRule: {
          frequency: "weekly" as const,
          interval: 1,
          daysOfWeek: ["monday" as const],
        },
        sortOrder: 0,
        timeEntries: dailyConfiguration.scheduleGraph[0].timeEntries,
      },
    ],
  };
  const behavior: ExportBehaviorInput = {
    id: behaviorId,
    categoryId: null,
    categoryName: null,
    title: "History behavior",
    description: "Daily then weekly",
    recurrenceRule: weeklyConfiguration.scheduleGraph[0].recurrenceRule,
    scheduledTime: "09:00",
    scheduleSlots: [
      {
        id: "slot-current",
        kind: "exact",
        preset: null,
        startTime: "09:00",
        endTime: null,
        sortOrder: 0,
        label: "9:00 AM",
      },
    ],
    timezone: DEFAULT_TIMEZONE,
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    active: true,
    archivedAt: null,
    createdAt: "2026-05-01T12:00:00Z",
    updatedAt: "2026-06-08T12:00:00Z",
  };
  const behaviorConfigurationEvents: ExportBehaviorConfigurationEventInput[] = [
    {
      id: "config-daily",
      behaviorId,
      eventKind: "baseline",
      previousConfiguration: null,
      nextConfiguration: dailyConfiguration,
      changedFields: [
        "category_id",
        "schedule_graph",
        "browser_reminder_enabled",
        "email_reminder_enabled",
        "reminder_offset_minutes",
        "active",
        "timezone",
      ],
      recordedAt: "2026-05-01T12:00:00Z",
      effectiveAt: "2026-05-01T12:00:00Z",
      effectiveLocalDate: "2026-05-01",
      timezone: DEFAULT_TIMEZONE,
      source: "system",
      reasonCode: "history_capture_started",
    },
    {
      id: "config-weekly",
      behaviorId,
      eventKind: "revision",
      previousConfiguration: dailyConfiguration,
      nextConfiguration: weeklyConfiguration,
      changedFields: ["schedule_graph"],
      recordedAt: "2026-06-08T12:00:00Z",
      effectiveAt: "2026-06-08T12:00:00Z",
      effectiveLocalDate: "2026-06-08",
      timezone: DEFAULT_TIMEZONE,
      source: "manual",
      reasonCode: "behavior_form_update",
    },
  ];
  const occurrences: ExportOccurrenceInput[] = [
    {
      id: "occurrence-daily",
      behaviorId,
      behaviorScheduleSlotId: "slot-current",
      behaviorConfigurationEventId: "config-daily",
      scheduledFor: "2026-06-01T13:00:00Z",
      scheduledTimeLabel: "9:00 AM",
      scheduleKind: "exact",
      schedulePreset: null,
      scheduleStartTime: "09:00",
      scheduleEndTime: null,
      localDate: "2026-06-01",
      status: "completed",
      completedAt: "2026-06-01T13:05:00Z",
      statusMarkedAt: "2026-06-01T13:05:00Z",
      note: "Daily-period note.",
      createdAt: "2026-06-01T12:00:00Z",
      updatedAt: "2026-06-01T13:05:00Z",
    },
    {
      id: "occurrence-weekly",
      behaviorId,
      behaviorScheduleSlotId: "slot-current",
      behaviorConfigurationEventId: "config-weekly",
      scheduledFor: "2026-06-08T13:00:00Z",
      scheduledTimeLabel: "9:00 AM",
      scheduleKind: "exact",
      schedulePreset: null,
      scheduleStartTime: "09:00",
      scheduleEndTime: null,
      localDate: "2026-06-08",
      status: "not_completed",
      completedAt: null,
      statusMarkedAt: "2026-06-08T13:05:00Z",
      note: null,
      createdAt: "2026-06-08T12:00:00Z",
      updatedAt: "2026-06-08T13:05:00Z",
    },
  ];
  const statusEvents: ExportStatusEventInput[] = [
    {
      id: "event-daily",
      occurrenceId: "occurrence-daily",
      behaviorId,
      previousStatus: "unresolved",
      status: "completed",
      statusSemantics: "explicit_user_mark",
      recordedAt: "2026-06-01T13:05:00Z",
      effectiveAt: "2026-06-01T13:05:00Z",
      localDate: "2026-06-01",
      timezone: DEFAULT_TIMEZONE,
      sourceCaptureMethod: "manual_tap",
      sourceConfidence: "high",
      revisesEventId: null,
      reasonCode: null,
    },
    {
      id: "event-weekly",
      occurrenceId: "occurrence-weekly",
      behaviorId,
      previousStatus: "unresolved",
      status: "not_completed",
      statusSemantics: "explicit_user_mark",
      recordedAt: "2026-06-08T13:05:00Z",
      effectiveAt: "2026-06-08T13:05:00Z",
      localDate: "2026-06-08",
      timezone: DEFAULT_TIMEZONE,
      sourceCaptureMethod: "manual_tap",
      sourceConfidence: "high",
      revisesEventId: null,
      reasonCode: null,
    },
  ];

  return resolveExportBundle({
    profile: { timezone: DEFAULT_TIMEZONE, subjectId: "subject-history" },
    categories: [],
    behaviors: [behavior],
    behaviorConfigurationEvents,
    occurrences,
    statusEvents,
    reminderDeliveries: [],
    now: Temporal.Instant.from("2026-06-09T12:00:00Z"),
    timezone: DEFAULT_TIMEZONE,
    range: "all",
    includeNotes: true,
  }).behaviorLog.files;
}

function archivedBaselineBundleFiles() {
  const behaviorId = "behavior-archived-baseline";
  const configuration = {
    categoryId: null,
    scheduleGraph: [
      {
        recurrenceRule: { frequency: "daily" as const, interval: 1 },
        sortOrder: 0,
        timeEntries: [
          {
            kind: "exact" as const,
            preset: null,
            startTime: "09:00",
            endTime: null,
            sortOrder: 0,
          },
        ],
      },
    ],
    browserReminderEnabled: true,
    emailReminderEnabled: false,
    reminderOffsetMinutes: 0,
    active: false,
    timezone: DEFAULT_TIMEZONE,
  };
  const occurrence: ExportOccurrenceInput = {
    id: "occurrence-archived-baseline",
    behaviorId,
    behaviorScheduleSlotId: "slot-archived",
    behaviorConfigurationEventId: "config-archived-baseline",
    scheduledFor: "2026-04-30T13:00:00Z",
    scheduledTimeLabel: "9:00 AM",
    scheduleKind: "exact",
    schedulePreset: null,
    scheduleStartTime: "09:00",
    scheduleEndTime: null,
    localDate: "2026-04-30",
    status: "completed",
    completedAt: "2026-04-30T13:05:00Z",
    statusMarkedAt: "2026-04-30T13:05:00Z",
    note: "Archived baseline note.",
    createdAt: "2026-04-30T12:00:00Z",
    updatedAt: "2026-04-30T13:05:00Z",
  };

  return resolveExportBundle({
    profile: { timezone: DEFAULT_TIMEZONE, subjectId: "subject-archived" },
    categories: [],
    behaviors: [
      {
        id: behaviorId,
        categoryId: null,
        categoryName: null,
        title: "Archived baseline",
        description: null,
        recurrenceRule: { frequency: "daily", interval: 1 },
        scheduledTime: "09:00",
        scheduleSlots: [
          {
            id: "slot-archived",
            kind: "exact",
            preset: null,
            startTime: "09:00",
            endTime: null,
            sortOrder: 0,
            label: "9:00 AM",
          },
        ],
        timezone: DEFAULT_TIMEZONE,
        browserReminderEnabled: true,
        emailReminderEnabled: false,
        reminderOffsetMinutes: 0,
        active: false,
        archivedAt: "2026-05-01T12:00:00Z",
        createdAt: "2026-04-01T12:00:00Z",
        updatedAt: "2026-05-01T12:00:00Z",
      },
    ],
    behaviorConfigurationEvents: [
      {
        id: "config-archived-baseline",
        behaviorId,
        eventKind: "baseline",
        previousConfiguration: null,
        nextConfiguration: configuration,
        changedFields: [
          "category_id",
          "schedule_graph",
          "browser_reminder_enabled",
          "email_reminder_enabled",
          "reminder_offset_minutes",
          "active",
          "timezone",
        ],
        recordedAt: "2026-05-01T12:00:00Z",
        effectiveAt: "2026-05-01T12:00:00Z",
        effectiveLocalDate: "2026-05-01",
        timezone: DEFAULT_TIMEZONE,
        source: "system",
        reasonCode: "history_capture_started",
      },
    ],
    occurrences: [occurrence],
    statusEvents: [
      {
        id: "event-archived-baseline",
        occurrenceId: occurrence.id,
        behaviorId,
        previousStatus: "unresolved",
        status: "completed",
        statusSemantics: "explicit_user_mark",
        recordedAt: "2026-04-30T13:05:00Z",
        effectiveAt: "2026-04-30T13:05:00Z",
        localDate: occurrence.localDate,
        timezone: DEFAULT_TIMEZONE,
        sourceCaptureMethod: "manual_tap",
        sourceConfidence: "high",
        revisesEventId: null,
        reasonCode: null,
      },
    ],
    reminderDeliveries: [],
    now: Temporal.Instant.from("2026-06-09T12:00:00Z"),
    timezone: DEFAULT_TIMEZONE,
    range: "all",
    includeArchived: true,
    includeNotes: true,
  }).behaviorLog.files;
}

function restoreApplyFormData(
  zip: Uint8Array,
  preview: {
    previewFingerprint: string;
    localDataFingerprint: string;
  },
  acceptedZip: Uint8Array = zip,
): FormData {
  const formData = new FormData();

  formData.set("confirm_backup", "yes");
  formData.set("confirm_restore_text", "RESTORE");
  formData.set("restore_preview_run_id", "22222222-2222-4222-8222-222222222222");
  formData.set("preview_fingerprint", preview.previewFingerprint);
  formData.set("local_data_fingerprint", preview.localDataFingerprint);
  formData.set("archive_fingerprint", sha256Bytes(acceptedZip));
  formData.set("bundle_payload", Buffer.from(zip).toString("base64"));
  formData.set("upload_file_name", "cadence-export.behaviorlog.zip");
  formData.set("upload_file_size", String(zip.byteLength));

  return formData;
}

function sha256Bytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
