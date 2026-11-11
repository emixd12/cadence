import { Temporal } from "@js-temporal/polyfill";
import { exportReadEndLocalDate, resolveExportDateRange } from "@cadence/core/resolvers/export.resolver";
import { assembleExportBundle, type ExportOptions } from "@cadence/core/services/export-assembly";
import { buildExportDownload, type ExportDownloadFormat } from "@cadence/core/services/export-download";
import type { Profile } from "../../../lib/types/database";
import { createDesktopZip } from "./archive";
import { ensureLocalOccurrencesFresh, toLocalBehaviorGraphRecord } from "./local-generation.service";
import { localCommand } from "./local-store";

export async function getLocalExportPageData(profile: Profile, options: ExportOptions = {}) {
  const now = options.now ?? Temporal.Now.instant();
  const range = resolveExportDateRange({ now, timezone: profile.timezone, range: options.range });
  if (range.key !== "all") await ensureLocalOccurrencesFresh(profile, now);
  const snapshot = await localCommand("readExportSnapshot", {
    profileId: profile.id, startLocalDate: range.startLocalDate, endLocalDate: exportReadEndLocalDate(range),
    includeTimeTracking: options.includeTimeTracking ?? false, throughStartedAt: now.toString(),
  });
  return assembleExportBundle({ ...options, ...snapshot, now, userId: profile.id, timezone: profile.timezone,
    behaviors: snapshot.graphs.map((graph) => toLocalBehaviorGraphRecord(graph, snapshot.categories)),
    // Export assembly reads both the local camelCase and the synchronized snake_case snapshot shapes.
    behaviorConfigurationEvents: snapshot.behaviorConfigurationEvents,
    nativeReminders: snapshot.nativeReminders.map((row) => ({
      id: row.id, occurrenceId: row.occurrence_id, requestId: row.request_id, fireAt: row.fire_at,
      status: row.status, verifiedAt: row.verified_at, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  });
}

export async function getLocalExportDownload(profile: Profile, format: ExportDownloadFormat, options: ExportOptions = {}) {
  return buildExportDownload(await getLocalExportPageData(profile, options), format, createDesktopZip);
}
