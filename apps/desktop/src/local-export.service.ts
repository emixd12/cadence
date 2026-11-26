import { Temporal } from "@js-temporal/polyfill";
import { exportReadEndLocalDate, resolveExportDateRange } from "@cadence/core/resolvers/export.resolver";
import { assembleExportBundle, type ExportOptions } from "@cadence/core/services/export-assembly";
import { buildExportDownload, type ExportDownloadFormat } from "@cadence/core/services/export-download";
import type { Profile } from "../../../lib/types/database";
import { createDesktopZip } from "./archive";
import { ensureLocalOccurrencesFresh, toLocalBehaviorGraphRecord } from "./local-generation.service";
import { localCommand } from "./local-store";
import { alongsideOption } from "./alongside";

export async function getLocalExportPageData(profile: Profile, options: ExportOptions = {}) {
  const now = options.now ?? Temporal.Now.instant();
  const range = resolveExportDateRange({ now, timezone: profile.timezone, range: options.range });
  if (range.key !== "all") await ensureLocalOccurrencesFresh(profile, now);
  const snapshot = await localCommand("readExportSnapshot", {
    profileId: profile.id, startLocalDate: range.startLocalDate, endLocalDate: exportReadEndLocalDate(range),
    includeTimeTracking: options.includeTimeTracking ?? false, throughStartedAt: now.toString(),
  });
  return assembleExportBundle({ ...options, ...snapshot, now, userId: profile.id, timezone: profile.timezone,
    // Ticket 363 (D33): the person's alongside answer, with the Mac's alongside switch on (as the web with the flag on). Never a guess.
    ...alongsideOption(),
    behaviors: snapshot.graphs.map((graph) => toLocalBehaviorGraphRecord(graph, snapshot.categories)),
    // Export assembly reads both the local camelCase and the synchronized snake_case snapshot shapes.
    behaviorConfigurationEvents: snapshot.behaviorConfigurationEvents,
    nativeReminders: snapshot.nativeReminders.map((row) => ({
      id: row.id, occurrenceId: row.occurrence_id, requestId: row.request_id, fireAt: row.fire_at,
      status: row.status, verifiedAt: row.verified_at, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    // Advisor Phase 2B: the Mac's read-only copies of per-day moves. The person's chosen
    // reason stays on the server and never syncs to a Mac, so it exports as null here.
    occurrenceMoves: snapshot.occurrenceMoves.map((row) => ({
      id: row.id, occurrenceId: row.occurrence_id, behaviorId: row.behavior_id, localDate: row.local_date,
      timezone: row.timezone, kind: row.kind, fromStartAt: row.from_start_at, fromEndAt: row.from_end_at,
      fromPlanned: row.from_planned, toStartAt: row.to_start_at, toEndAt: row.to_end_at, toPlanned: row.to_planned,
      durationSource: row.duration_source, chainPosition: row.chain_position, revisesMoveId: row.revises_move_id,
      reason: row.reason, personReason: null, source: row.source, createdAt: row.created_at,
    })),
  });
}

export async function getLocalExportDownload(profile: Profile, format: ExportDownloadFormat, options: ExportOptions = {}) {
  return buildExportDownload(await getLocalExportPageData(profile, options), format, createDesktopZip);
}
