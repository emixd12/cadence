import type { BehaviorInput } from "@cadence/core/behavior-store";
import { reconcileMyDueBehaviorArchives } from "./behavior-lifecycle.service";
import { assembleBehaviorPageData, toBehaviorView } from "@cadence/core/services/behavior-views";
import {
  createBehavior, setBehaviorActive, updateBehavior, updateBehaviorArchiveNote,
} from "@cadence/core/services/behavior.service";
import { createBehaviorStore } from "@/lib/db/behavior-store";
import {
  getProfileTimezone,
  listUserBehaviors,
  type AppSupabaseClient,
} from "@/lib/db/behaviors.repo";
import { createClient } from "@/lib/supabase/server";
import { syncUserOccurrencesAndReminders } from "@/lib/services/occurrence.service";
import { reportMonitoringError } from "@/lib/monitoring/privacy-safe-events";
import {
  invalidateBehaviorData,
  readCachedBehaviorCategories,
  readCachedProfileTimezone,
  readCachedUserBehaviors,
} from "@/lib/cache/stable-user-data.cache";
import type {
  BehaviorPageData,
  BehaviorView,
} from "@/lib/types/behavior";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import {
  behaviorErrorToActionState,
  parseBehaviorFormData,
} from "@/lib/services/behavior-form";
import { requireCurrentUserId } from "@/lib/auth/current-user";
export { behaviorErrorToActionState };

export async function getBehaviorReadDataForUser(supabase: AppSupabaseClient, userId: string) {
  const [behaviors, profileTimezone] = await Promise.all([
    listUserBehaviors(supabase, userId), getProfileTimezone(supabase, userId),
  ]);
  return { behaviors, profileTimezone };
}

export async function getBehaviorPageData(): Promise<BehaviorPageData> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await reconcileMyDueBehaviorArchives(supabase, userId);
  const [categories, behaviors, profileTimezone] = await Promise.all([
    readCachedBehaviorCategories(supabase, userId),
    readCachedUserBehaviors(supabase, userId),
    readCachedProfileTimezone(supabase, userId),
  ]);

  return assembleBehaviorPageData({ categories, behaviors, profileTimezone });
}

export async function createBehaviorFromFormData(formData: FormData): Promise<BehaviorView> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  return toBehaviorView(await createBehaviorForUser(supabase, userId,
    parseBehaviorFormData(formData, { mode: "create" })));
}

export async function createBehaviorForUser(
  supabase: AppSupabaseClient, userId: string, values: BehaviorInput,
  recordedAt = new Date().toISOString(),
) {
  const timezone = (await getProfileTimezone(supabase, userId)) ?? DEFAULT_TIMEZONE;
  const confirmed = await createBehavior(createBehaviorStore(supabase, userId), {
    userId, timezone, values, recordedAt,
  });
  invalidateBehaviorData(userId);
  await syncBehaviorGraphForUser(supabase, userId, "create");
  return confirmed;
}

export async function updateBehaviorFromFormData(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const values = parseBehaviorFormData(formData, { mode: "update" });
  await updateBehaviorForUser(supabase, userId, {
    behaviorId: values.behaviorId, values,
    expectedUpdatedAt: getExpectedUpdatedAtFromFormData(formData),
  });
}

export async function updateBehaviorForUser(
  supabase: AppSupabaseClient, userId: string,
  input: { behaviorId: string; values: BehaviorInput; expectedUpdatedAt: string },
  recordedAt = new Date().toISOString(),
) {
  const updated = await updateBehavior(createBehaviorStore(supabase, userId), {
    ...input, newArchiveNoteId: crypto.randomUUID(), recordedAt,
  });
  invalidateBehaviorData(userId);
  await syncBehaviorGraphForUser(supabase, userId, "update");
  return updated;
}

function getExpectedUpdatedAtFromFormData(formData: FormData): string {
  const value = formData.get("expected_updated_at");

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Reload this behavior before saving changes.");
  }

  return value;
}

export async function archiveBehaviorFromFormData(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await setBehaviorActiveForUser(supabase, userId, {
    behaviorId: getBehaviorIdForArchive(formData), active: false,
    expectedUpdatedAt: getExpectedUpdatedAtFromFormData(formData),
    archiveNote: getArchiveNoteFromFormData(formData),
  });
}

export async function restoreBehaviorFromFormData(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await setBehaviorActiveForUser(supabase, userId, {
    behaviorId: getBehaviorIdForArchive(formData), active: true,
    expectedUpdatedAt: getExpectedUpdatedAtFromFormData(formData),
  });
}

export async function setBehaviorActiveForUser(
  supabase: AppSupabaseClient, userId: string,
  input: { behaviorId: string; active: boolean; expectedUpdatedAt: string; archiveNote?: string },
  recordedAt = new Date().toISOString(),
) {
  const updated = await setBehaviorActive(createBehaviorStore(supabase, userId), {
    ...input, ...(!input.active ? { newArchiveNoteId: crypto.randomUUID() } : {}), recordedAt,
  });
  invalidateBehaviorData(userId);
  await syncBehaviorGraphForUser(supabase, userId, input.active ? "restore" : "archive");
  return updated;
}

export async function updateBehaviorArchiveNoteFromFormData(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await updateBehaviorArchiveNote(createBehaviorStore(supabase, userId), {
    behaviorId: getBehaviorIdForArchive(formData),
    archiveNoteId: getArchiveNoteIdFromFormData(formData),
    note: getArchiveNoteFromFormData(formData),
    expectedUpdatedAt: getExpectedUpdatedAtFromFormData(formData),
    recordedAt: new Date().toISOString(),
  });
  invalidateBehaviorData(userId);
}

export async function syncBehaviorGraphForUser(
  supabase: AppSupabaseClient,
  userId: string,
  operation: "create" | "update" | "archive" | "restore",
): Promise<void> {
  const syncTimezone = await readAuthoritativeProfileTimezone(
    supabase,
    userId,
    operation,
  );

  if (!syncTimezone) {
    return;
  }

  try {
    const behaviors = await listUserBehaviors(supabase, userId);

    await syncUserOccurrencesAndReminders(supabase, userId, {
      behaviors,
      timezone: syncTimezone,
    });
  } catch (error) {
    reportBehaviorGraphErrorSafely(
      "behavior_graph_post_write_sync_failed",
      error,
      operation,
    );
  }
}

async function readAuthoritativeProfileTimezone(
  supabase: AppSupabaseClient,
  userId: string,
  operation: "create" | "update" | "archive" | "restore",
): Promise<string | null> {
  try {
    const timezone = await readCachedProfileTimezone(supabase, userId);

    if (!timezone) {
      reportBehaviorGraphErrorSafely(
        "behavior_graph_profile_timezone_missing",
        new Error("Profile timezone is unavailable for behavior graph repair."),
        operation,
      );
      return null;
    }

    return timezone;
  } catch (error) {
    reportBehaviorGraphErrorSafely(
      "behavior_graph_profile_timezone_read_failed",
      error,
      operation,
    );
    return null;
  }
}

function reportBehaviorGraphErrorSafely(
  name: string,
  error: unknown,
  operation: "create" | "update" | "archive" | "restore",
): void {
  try {
    reportMonitoringError(name, error, { operation });
  } catch {
    // Monitoring must never change the result of a product write.
  }
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  return requireCurrentUserId("Sign in again before saving behaviors.");
}

function getBehaviorIdForArchive(formData: FormData): string {
  const value = formData.get("behavior_id");

  if (typeof value !== "string" || !value) {
    throw new Error("Choose an existing behavior to archive.");
  }

  return value;
}

function getArchiveNoteIdFromFormData(formData: FormData): string {
  const value = formData.get("archive_note_id");
  if (typeof value !== "string" || !value) throw new Error("Choose an archive note to edit.");
  return value;
}

function getArchiveNoteFromFormData(formData: FormData): string {
  if (formData.get("archive_note_remove") === "1") return "";
  const value = formData.get("archive_note");
  if (typeof value !== "string") throw new Error("Archive note must be text.");
  return value;
}
