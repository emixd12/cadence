import { Temporal } from "@js-temporal/polyfill";
import { exportReadEndLocalDate, resolveExportDateRange } from "@cadence/core/resolvers/export.resolver";
import { assembleExportBundle, type ExportOptions } from "@cadence/core/services/export-assembly";
import { buildExportDownload, type ExportDownloadFormat } from "@cadence/core/services/export-download";
import type { Json } from "@cadence/core/types/json";
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
    behaviorConfigurationEvents: snapshot.behaviorConfigurationEvents.map((row) => ({ ...row,
      previous_configuration: row.previous_configuration === null ? null : toStoredConfigurationSnapshot(row.previous_configuration),
      next_configuration: toStoredConfigurationSnapshot(row.next_configuration),
    })),
    nativeReminders: snapshot.nativeReminders.map((row) => ({
      id: row.id, occurrenceId: row.occurrence_id, requestId: row.request_id, fireAt: row.fire_at,
      status: row.status, verifiedAt: row.verified_at, createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  });
}

export async function getLocalExportDownload(profile: Profile, format: ExportDownloadFormat, options: ExportOptions = {}) {
  return buildExportDownload(await getLocalExportPageData(profile, options), format, createDesktopZip);
}

// Local edits store camelCase; synchronized web history already uses the export payload shape.
function toStoredConfigurationSnapshot(value: Json): Json {
  const snapshot = object(value);
  // Shared export assembly validates both paths after normalization.
  if ("schedule_graph" in snapshot) return value;
  const schedules = snapshot.scheduleGraph;
  if (!Array.isArray(schedules)) throw new Error("Invalid native configuration schedule graph.");
  return {
    category_id: snapshot.categoryId, location_text: snapshot.locationText ?? null,
    // Shared export assembly derives a missing Where from location text.
    ...(snapshot.whereKind === undefined ? {} : { where_kind: snapshot.whereKind }),
    browser_reminder_enabled: snapshot.browserReminderEnabled,
    email_reminder_enabled: snapshot.emailReminderEnabled, reminder_offset_minutes: snapshot.reminderOffsetMinutes,
    active: snapshot.active, timezone: snapshot.timezone,
    schedule_graph: schedules.map((item) => {
      const schedule = object(item);
      if (!Array.isArray(schedule.timeEntries)) throw new Error("Invalid native configuration time entries.");
      return { recurrence_rule: schedule.recurrenceRule, sort_order: schedule.sortOrder,
        time_entries: schedule.timeEntries.map((item) => {
          const entry = object(item);
          return { kind: entry.kind, preset: entry.preset, start_time: entry.startTime,
            end_time: entry.endTime, sort_order: entry.sortOrder };
        }),
      };
    }),
  };
}

function object(value: Json): { [key: string]: Json | undefined } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native configuration snapshot.");
  return value;
}
