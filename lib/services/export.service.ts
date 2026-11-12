import { buildExportDownload } from "@cadence/core/services/export-download";
import { Temporal } from "@js-temporal/polyfill";
import { assembleExportBundle, type ExportOptions } from "@cadence/core/services/export-assembly";
export type { ExportOptions } from "@cadence/core/services/export-assembly";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readExportPageSummary, readExportPageBundle, type ExportPageSyncStateRow } from "@/lib/db/exportPageRead.repo";
import { listBehaviorDefinitionEvents } from "@/lib/db/behaviorDefinitionEvents.repo";
import { listBehaviorConfigurationEvents } from "@/lib/db/behaviorConfigurationEvents.repo";
import { consumeExportDownloadRateLimit } from "@/lib/db/launchRateLimits.repo";
import { listTimeSessionHistory } from "@/lib/db/timeSessions.repo";
import { listAllDayNotes } from "@/lib/db/dayNotes.repo";
import { listAppliedBehaviorLogImportRuns, listBehaviorLogImportRecordMappings } from "@/lib/db/behaviorLogImports.repo";
import { listImportedNotes } from "@/lib/db/notes.repo";
import { listImportedInterventions } from "@/lib/db/importedInterventions.repo";
import { resolveExportPageSummary, exportReadEndLocalDate, resolveExportDateRange } from "@/lib/resolvers/export.resolver";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { assertLaunchCircuitBreakerClosed } from "@/lib/security/launch-circuit-breakers";
import { ensureUserOccurrencesFresh } from "@/lib/services/occurrence.service";
import { reconcileMyDueBehaviorArchives } from "@/lib/services/behavior-lifecycle.service";
import { createStoredZip } from "@/lib/services/zip";
import { createClient } from "@/lib/supabase/server";
import { readCachedProfileTimezone, readCachedUserBehaviors } from "@/lib/cache/stable-user-data.cache";
import type { ExportPageData, ExportBundle } from "@/lib/types/export";
import type { OccurrenceSyncState } from "@/lib/types/database";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";

export type ExportDownloadFormat = "jsonl" | "csv" | "json" | "behaviorlog" | "markdown";

export type ExportDownload = {
  content: BodyInit;
  contentType: string;
  fileName: string;
};

export class ExportAuthError extends Error {
  constructor(message = "Sign in again before exporting data.") {
    super(message);
    this.name = "ExportAuthError";
  }
}

export class ExportRateLimitError extends Error {
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;

  constructor(input: {
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
  }) {
    super("Too many export downloads. Try again later.");
    this.name = "ExportRateLimitError";
    this.limit = input.limit;
    this.remaining = input.remaining;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

export async function getExportPageData(
  options: ExportOptions = {},
): Promise<ExportPageData> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const now = options.now ?? Temporal.Now.instant();
  const timezone = (await readCachedProfileTimezone(supabase, userId)) ?? DEFAULT_TIMEZONE;
  const range = resolveExportDateRange({ now, timezone, range: options.range });
  const counts = await readExportPageSummary(supabase, {
    startLocalDate: range.startLocalDate,
    endLocalDate: exportReadEndLocalDate(range),
    includeArchived: options.includeArchived ?? false,
    includeTimeTracking: options.includeTimeTracking ?? false,
    throughStartedAt: now.toString(),
  });
  return resolveExportPageSummary({ ...options, now, timezone, counts });
}

export async function getExportDownload(
  format: ExportDownloadFormat,
  options: ExportOptions = {},
): Promise<ExportDownload> {
  const bundle = await getUserExportBundle(options);

  const payload = await buildExportDownload(bundle, format, createStoredZip);
  return {
    content: payload.text ?? new Blob([Uint8Array.from(payload.bytes!)], { type: payload.mimeType }),
    contentType: payload.mimeType,
    fileName: payload.filename,
  };
}

export async function getUserExportBundle(
  options: ExportOptions,
): Promise<ExportBundle> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  assertLaunchCircuitBreakerClosed("export_downloads");
  const rateLimit = await consumeExportDownloadRateLimit(supabase);
  if (!rateLimit.allowed) {
    throw new ExportRateLimitError(rateLimit);
  }

  const now = options.now ?? Temporal.Now.instant();
  await reconcileMyDueBehaviorArchives(supabase, userId);
  const [
    profileTimezone,
    cachedBehaviors,
    behaviorDefinitionEvents,
    behaviorConfigurationEvents,
  ] =
    await Promise.all([
      readCachedProfileTimezone(supabase, userId),
      readCachedUserBehaviors(supabase, userId),
      listBehaviorDefinitionEvents(supabase, userId),
      listBehaviorConfigurationEvents(supabase, userId),
    ]);
  const timezone = profileTimezone ?? DEFAULT_TIMEZONE;
  const range = resolveExportDateRange({
    now,
    timezone,
    range: options.range,
  });
  const endLocalDate = exportReadEndLocalDate(range);
  const [importRuns, importMappings, importedNotes, importedInterventions, dayNotes] = await Promise.all([
    listAppliedBehaviorLogImportRuns(supabase, userId), listBehaviorLogImportRecordMappings(supabase, userId),
    options.includeNotes ? listImportedNotes(supabase, userId) : Promise.resolve([]),
    listImportedInterventions(supabase, userId),
    options.includeNotes ? listAllDayNotes(supabase, userId) : Promise.resolve([]),
  ]);
  const initialRead = await readExportPageBundle(supabase, {
    startLocalDate: range.startLocalDate,
    endLocalDate,
  });

  const syncResult = await ensureUserOccurrencesFresh(supabase, userId, {
    now,
    behaviors: cachedBehaviors,
    timezone,
    horizonDays: 0,
    syncState: toSyncState(initialRead.syncState, userId),
  });
  const exportRead = syncResult.synced
    ? await readExportPageBundle(supabase, {
        startLocalDate: range.startLocalDate,
        endLocalDate,
      })
    : initialRead;
  const timeSessions = options.includeTimeTracking
    ? await listTimeSessionHistory(supabase, {
        userId,
        startLocalDate: range.startLocalDate,
        endLocalDate,
        includeArchived: options.includeArchived ?? false,
        throughStartedAt: now.toString(),
      })
    : [];
  const finalRead = await readExportPageBundle(supabase, {
    startLocalDate: range.startLocalDate,
    endLocalDate,
  });

  return assembleExportBundle({
    ...options, now, userId, timezone, range: range.key,
    categories: exportRead.categories, behaviors: cachedBehaviors,
    behaviorDefinitionEvents, behaviorConfigurationEvents,
    occurrences: exportRead.occurrences, statusEvents: exportRead.statusEvents,
    reminderDeliveries: exportRead.reminderDeliveries, timeSessions,
    finalBehaviors: finalRead.behaviors,
    importRuns, importMappings, importedNotes, importedInterventions, dayNotes,
  });
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;
  try { return await requireCurrentUserId("Sign in again before exporting data."); }
  catch { throw new ExportAuthError(); }
}

function toSyncState(syncState: ExportPageSyncStateRow | null, userId: string): OccurrenceSyncState | null {
  return syncState ? { ...syncState, user_id: userId } : null;
}

// Match only code-defined labels. A message's spelling cannot prove it contains no user data.
const EXPORT_VALIDATION_MESSAGES = new Set([
  "configuration snapshot",
  "configuration schedule graph",
  "configuration time entries",
  "configuration schedule_graph",
  "configuration schedule",
  "configuration recurrence_rule",
  "configuration schedule sort_order",
  "configuration time_entries",
  "configuration time entry",
  "configuration schedule kind",
  "configuration schedule preset",
  "configuration schedule start_time",
  "configuration schedule end_time",
  "configuration time entry sort_order",
  "configuration category_id",
  "configuration location_text",
  "configuration where_kind",
  "configuration browser_reminder_enabled",
  "configuration email_reminder_enabled",
  "configuration reminder_offset_minutes",
  "configuration active",
  "configuration timezone",
].map((label) => `Invalid ${label}.`));

export function exportFailureLabel(error: unknown): string | null {
  return error instanceof Error && EXPORT_VALIDATION_MESSAGES.has(error.message)
    ? error.message
    : null;
}
