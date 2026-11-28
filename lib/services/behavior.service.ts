import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorInput } from "@cadence/core/behavior-store";
import { assembleBehaviorPageData, toBehaviorView } from "@cadence/core/services/behavior-views";
import {
  answerBehaviorAlongsideQuestion, applyBehaviorRunAction, createBehavior, createBehaviorGroup, reorderSubBehaviors, setBehaviorActive,
  updateBehavior, updateBehaviorArchiveNote, type BehaviorRunAction,
} from "@cadence/core/services/behavior.service";
import { createBehaviorStore } from "@/lib/db/behavior-store";
import { behaviorRunOutcomeMessage, localDateIn } from "@/lib/ui/behavior-run";
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
  parseBehaviorRunActionFormData,
} from "@/lib/services/behavior-form";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { alongsideEnabled } from "@/lib/services/alongside-flag";
export { behaviorErrorToActionState };

/** Ids for sub-behavior writes: new group members and the archive notes of archived children. */
const newId = () => crypto.randomUUID();

export async function getBehaviorReadDataForUser(supabase: AppSupabaseClient, userId: string) {
  const [behaviors, profileTimezone] = await Promise.all([
    listUserBehaviors(supabase, userId), getProfileTimezone(supabase, userId),
  ]);
  return { behaviors, profileTimezone };
}

export async function getBehaviorPageData(): Promise<BehaviorPageData> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const [categories, behaviors, profileTimezone] = await Promise.all([
    readCachedBehaviorCategories(supabase, userId),
    readCachedUserBehaviors(supabase, userId),
    readCachedProfileTimezone(supabase, userId),
  ]);

  // `now` gives each view its run state, so the list can group Not running items.
  return assembleBehaviorPageData({ categories, behaviors, profileTimezone, now: Temporal.Now.instant() });
}

export async function createBehaviorFromFormData(formData: FormData): Promise<BehaviorView> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  return toBehaviorView(await createBehaviorForUser(supabase, userId,
    parseBehaviorFormData(formData, { mode: "create", readAlongside: alongsideEnabled() })));
}

export async function createBehaviorForUser(
  supabase: AppSupabaseClient, userId: string, values: BehaviorInput,
  recordedAt = new Date().toISOString(),
) {
  const timezone = (await getProfileTimezone(supabase, userId)) ?? DEFAULT_TIMEZONE;
  const confirmed = await createBehavior(createBehaviorStore(supabase, userId), {
    userId, timezone, values, recordedAt, newId,
  });
  invalidateBehaviorData(userId);
  await syncBehaviorGraphForUser(supabase, userId, "create");
  return confirmed;
}

/**
 * A parent Behavior and its sub-behaviors in one write (depth 1). Sub-behaviors inherit
 * the parent's schedule unless their input says otherwise.
 */
export async function createBehaviorGroupForUser(
  supabase: AppSupabaseClient, userId: string,
  input: { parent: BehaviorInput; subBehaviors: BehaviorInput[] },
  recordedAt = new Date().toISOString(),
) {
  const timezone = (await getProfileTimezone(supabase, userId)) ?? DEFAULT_TIMEZONE;
  const created = await createBehaviorGroup(createBehaviorStore(supabase, userId), {
    ...input, userId, timezone, recordedAt, newId,
  });
  invalidateBehaviorData(userId);
  await syncBehaviorGraphForUser(supabase, userId, "create");
  return created;
}

/** Sibling order under one parent; ids must name each live sub-behavior once. */
export async function reorderSubBehaviorsForUser(
  supabase: AppSupabaseClient, userId: string,
  input: { parentBehaviorId: string; orderedBehaviorIds: string[] },
): Promise<number> {
  const changed = await reorderSubBehaviors(createBehaviorStore(supabase, userId), input);
  if (changed > 0) invalidateBehaviorData(userId);
  return changed;
}

export async function reorderSubBehaviorsFromFormData(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const parentBehaviorId = formData.get("parent_behavior_id");
  if (typeof parentBehaviorId !== "string" || !parentBehaviorId) throw new Error("Choose a parent Behavior.");
  await reorderSubBehaviorsForUser(supabase, userId, {
    parentBehaviorId,
    orderedBehaviorIds: formData.getAll("sub_behavior_id").filter((value): value is string => typeof value === "string"),
  });
}

export async function updateBehaviorFromFormData(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const values = parseBehaviorFormData(formData, { mode: "update", readAlongside: alongsideEnabled() });
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
    ...input, newArchiveNoteId: crypto.randomUUID(), recordedAt, newId,
  });
  invalidateBehaviorData(userId);
  await syncBehaviorGraphForUser(supabase, userId, "update");
  return updated;
}

/**
 * Audit fixes 7 and 12: a question prompt's alongside answer (the Timeline row and the
 * Daily Brief) through the same core writer Cadence for Mac's row uses, so it records
 * one configuration revision with reason code `alongside_answered` and answers only an
 * unanswered Behavior.
 */
export async function answerBehaviorAlongsideQuestionForUser(
  supabase: AppSupabaseClient, userId: string,
  input: { behaviorId: string; alongside: boolean },
  recordedAt = new Date().toISOString(),
) {
  const answer = await answerBehaviorAlongsideQuestion(createBehaviorStore(supabase, userId), { ...input, recordedAt });
  if (!answer.alreadyAnswered) {
    invalidateBehaviorData(userId);
    await syncBehaviorGraphForUser(supabase, userId, "update");
  }
  return answer;
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
    ...input, ...(!input.active ? { newArchiveNoteId: crypto.randomUUID() } : {}), recordedAt, newId,
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

type BehaviorGraphOperation = "create" | "update" | "archive" | "restore" | "run";

/**
 * End now, Start again, Pause or Resume now (docs/RECURRENCE_RULES.md, "Behavior end
 * and pause"). The action writes one configuration revision; the post-write sync then
 * removes the rows the end or pause stops, or brings rows back.
 */
export { behaviorRunOutcomeMessage };

export async function applyBehaviorRunActionForUser(
  supabase: AppSupabaseClient, userId: string,
  input: { behaviorId: string; action: BehaviorRunAction; expectedUpdatedAt: string },
  recordedAt = new Date().toISOString(),
) {
  const updated = await applyBehaviorRunAction(createBehaviorStore(supabase, userId), { ...input, recordedAt });
  invalidateBehaviorData(userId);
  await syncBehaviorGraphForUser(supabase, userId, "run");
  return updated;
}

/**
 * Form fields: behavior_id, expected_updated_at, run_action, and for a pause
 * pause_from_on, pause_from_time, pause_back_on. Returns the outcome line the list and
 * the Timeline notices show (docs/MESSAGING_CHANGES.md, P-077).
 */
export async function applyBehaviorRunActionFromFormData(formData: FormData): Promise<{ message: string }> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const action = parseBehaviorRunActionFormData(formData);
  const updated = await applyBehaviorRunActionForUser(supabase, userId, {
    behaviorId: getBehaviorIdForArchive(formData),
    action,
    expectedUpdatedAt: getExpectedUpdatedAtFromFormData(formData),
  });
  return { message: behaviorRunOutcomeMessage(updated.title, action, localDateIn(updated.timezone)) };
}

export async function syncBehaviorGraphForUser(
  supabase: AppSupabaseClient,
  userId: string,
  operation: BehaviorGraphOperation,
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
  operation: BehaviorGraphOperation,
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
  operation: BehaviorGraphOperation,
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
