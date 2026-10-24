import { Temporal } from "@js-temporal/polyfill";

import {
  PlaceLabelError,
  buildPlaceLabelState,
  parseCompletionLabelInput,
  parsePlaceLabelSettingsInput,
  parsePlaceMarkerInput,
  parseWhereSuggestionDismissInput,
  placeLabelSettingsFromRecord,
  planCompletionCapture,
  planCompletionLabel,
  planPlaceLabelSettingsSave,
  planPlaceMarker,
  planWhereSuggestionDismissal,
} from "@cadence/core/services/place-labels";
import { isPlaceRef } from "@cadence/core/resolvers/place-label.resolver";
import type { CompletionCapturePlan, PlaceLabelState } from "@cadence/core/types/place-labels";
import { DEFAULT_TIMEZONE } from "@cadence/core/types/recurrence";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { getOccurrenceWithBehaviorTimezoneById } from "@/lib/db/occurrences.repo";
import { getLatestOccurrenceStatusEventForOccurrence } from "@/lib/db/occurrenceStatusEvents.repo";
import {
  deleteCompletionPlaceLabelRows,
  deletePlaceMarkerRows,
  insertCompletionPlaceLabelRow,
  purgeExpiredCompletionPlaceLabels,
  readCompletionPlaceLabelRows,
  readPlaceLabelBehaviorRows,
  readPlaceLabelSettingsRow,
  readPlaceMarkerRows,
  readProfileTimezone,
  readWhereSuggestionDismissalRows,
  savePlaceLabelSettingsRow,
  upsertPlaceMarkerRow,
  upsertWhereSuggestionDismissalRow,
} from "@/lib/db/placeLabels.repo";
import { readTravelSettingsRow } from "@/lib/db/travelSettings.repo";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { CalendarCaller } from "./google-calendar.service";

export { PlaceLabelError };

/** Ticket 216: coordinate-free state for Settings, the Behavior form and the Behavior list. */
export async function getPlaceLabelState(caller: CalendarCaller, now = Temporal.Now.instant()): Promise<PlaceLabelState> {
  const { client, user } = caller;
  const [settings, travel, markers, labels, dismissals, behaviors, timezone] = await Promise.all([
    readPlaceLabelSettingsRow(client, user.id),
    readTravelSettingsRow(client, user.id),
    readPlaceMarkerRows(client, user.id),
    readCompletionPlaceLabelRows(client, user.id),
    readWhereSuggestionDismissalRows(client, user.id),
    readPlaceLabelBehaviorRows(client, user.id),
    readProfileTimezone(client, user.id),
  ]);
  return buildPlaceLabelState({ settings, homeText: travel?.base_location_text ?? null, markers, labels, dismissals, behaviors,
    today: now.toZonedDateTimeISO(timezone ?? DEFAULT_TIMEZONE).toPlainDate() });
}

export async function savePlaceLabelSettings(caller: CalendarCaller, value: unknown, now = Temporal.Now.instant()): Promise<PlaceLabelState> {
  const input = parsePlaceLabelSettingsInput(value);
  const { client, user } = caller;
  const [current, timezone] = await Promise.all([readPlaceLabelSettingsRow(client, user.id), readProfileTimezone(client, user.id)]);
  const { retentionCutoff } = planPlaceLabelSettingsSave(placeLabelSettingsFromRecord(current), input,
    now.toZonedDateTimeISO(timezone ?? DEFAULT_TIMEZONE).toPlainDate());
  try {
    await savePlaceLabelSettingsRow(client, { enabled: input.enabled, retention: input.retention,
      markerPromptDismissed: input.markerPromptDismissed, expectedUpdatedAt: input.expectedUpdatedAt, retentionCutoff });
  } catch (error) {
    if (databaseMessage(error).startsWith("Place label settings changed")) throw new PlaceLabelError("conflict", "Place label settings changed after they were loaded.");
    throw error;
  }
  return getPlaceLabelState(caller, now);
}

export async function recordPlaceMarker(caller: CalendarCaller, value: unknown, now = Temporal.Now.instant()): Promise<PlaceLabelState> {
  const marker = parsePlaceMarkerInput(value);
  const { client, user } = caller;
  const [settings, travel] = await Promise.all([readPlaceLabelSettingsRow(client, user.id), readTravelSettingsRow(client, user.id)]);
  const row = planPlaceMarker({ settings: placeLabelSettingsFromRecord(settings), marker,
    homeText: travel?.base_location_text ?? null, recordedAt: now.toString() });
  await upsertPlaceMarkerRow(client, user.id, row);
  return getPlaceLabelState(caller, now);
}

/** Removes one marker, or every marker when `ref` is null. */
export async function removePlaceMarkers(caller: CalendarCaller, ref: unknown): Promise<PlaceLabelState> {
  if (!(ref === null || isPlaceRef(ref))) throw new PlaceLabelError("invalid_request", "The place is invalid.");
  await deletePlaceMarkerRows(caller.client, caller.user.id, ref);
  return getPlaceLabelState(caller);
}

export async function deleteCompletionPlaceLabels(caller: CalendarCaller): Promise<PlaceLabelState> {
  await deleteCompletionPlaceLabelRows(caller.client, caller.user.id, null);
  return getPlaceLabelState(caller);
}

export async function dismissWhereSuggestion(caller: CalendarCaller, value: unknown, now = Temporal.Now.instant()): Promise<PlaceLabelState> {
  const dismissal = parseWhereSuggestionDismissInput(value);
  const settings = placeLabelSettingsFromRecord(await readPlaceLabelSettingsRow(caller.client, caller.user.id));
  await upsertWhereSuggestionDismissalRow(caller.client, caller.user.id,
    planWhereSuggestionDismissal({ settings, dismissal, dismissedAt: now.toString() }));
  return getPlaceLabelState(caller, now);
}

/** Markers for a completion this browser just marked, or null. Positions are the user's own markers. */
export async function getCompletionCapturePlan(caller: CalendarCaller, occurrenceId: unknown, now = Temporal.Now.instant()): Promise<CompletionCapturePlan | null> {
  if (typeof occurrenceId !== "string" || !occurrenceId) throw new PlaceLabelError("invalid_request", "The occurrence is invalid.");
  const context = await readCaptureContext(caller, occurrenceId);
  return context ? planCompletionCapture({ ...context, now }) : null;
}

export async function recordCompletionPlaceLabel(caller: CalendarCaller, value: unknown, now = Temporal.Now.instant()): Promise<void> {
  const label = parseCompletionLabelInput(value);
  const context = await readCaptureContext(caller, label.occurrenceId);
  if (!context) throw new PlaceLabelError("not_eligible", "This completion cannot be labeled.");
  await insertCompletionPlaceLabelRow(caller.client, caller.user.id, planCompletionLabel({ ...context, label, now }));
}

/** Daily rolling retention for every account (occurrence-sync cron, service role). */
export async function purgeExpiredPlaceLabels(client: AppSupabaseClient): Promise<number> {
  return purgeExpiredCompletionPlaceLabels(client);
}

async function readCaptureContext(caller: CalendarCaller, occurrenceId: string) {
  const { client, user } = caller;
  const [settings, travel, markers, occurrence, latest] = await Promise.all([
    readPlaceLabelSettingsRow(client, user.id),
    readTravelSettingsRow(client, user.id),
    readPlaceMarkerRows(client, user.id),
    getOccurrenceWithBehaviorTimezoneById(client, user.id, occurrenceId),
    getLatestOccurrenceStatusEventForOccurrence(client, user.id, occurrenceId),
  ]);
  if (!occurrence) return null;
  return {
    settings: placeLabelSettingsFromRecord(settings),
    homeText: travel?.base_location_text ?? null,
    markers,
    occurrence: {
      id: occurrence.id, behaviorId: occurrence.behavior_id, status: occurrence.status, localDate: occurrence.local_date,
      timezone: occurrence.behavior?.timezone ?? DEFAULT_TIMEZONE, scheduledFor: occurrence.scheduled_for,
      scheduleKind: occurrence.schedule_kind, scheduleStartTime: occurrence.schedule_start_time, scheduleEndTime: occurrence.schedule_end_time,
    },
    latestMark: latest ? { status: latest.status, previousStatus: latest.previous_status,
      sourceCaptureMethod: latest.source_capture_method, recordedAt: latest.recorded_at } : null,
  };
}

function databaseMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
}

/** Runs beside OAuth maintenance in the daily occurrence-sync cron; failures never change that response. */
export async function runPlaceLabelMaintenance(): Promise<void> {
  try {
    const deleted = await purgeExpiredPlaceLabels(createServiceRoleClient());
    reportMonitoringEvent({ name: "place_label_maintenance_completed", context: { labels_deleted: deleted } });
  } catch {
    try { reportMonitoringEvent({ name: "place_label_maintenance_failed", severity: "error", context: { outcome: "unknown" } }); }
    catch { /* A failed monitoring sink must not replace the occurrence result. */ }
  }
}
