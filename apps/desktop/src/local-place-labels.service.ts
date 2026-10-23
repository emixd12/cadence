import { Temporal } from "@js-temporal/polyfill";

import { placeLabelRetentionCutoff } from "@cadence/core/resolvers/place-label.resolver";
import {
  buildPlaceLabelState,
  placeLabelSettingsFromRecord,
  planCompletionCapture,
  planCompletionLabel,
  planPlaceLabelSettingsSave,
  planPlaceMarker,
  planWhereSuggestionDismissal,
} from "@cadence/core/services/place-labels";
import { canonicalTravelInstant } from "@cadence/core/services/travel-settings";
import type {
  CompletionPlaceLabelRecord,
  PlaceLabelSettingsRecord,
  PlaceLabelState,
  PlaceMarkerRecord,
  WhereSuggestionDismissalRecord,
} from "@cadence/core/types/place-labels";
import type { PlaceLabelClient } from "../../../lib/ui/place-labels";
import { readMacForegroundLocation } from "./foreground-location";
import { localCommand, localMutation } from "./local-store";

type Owned<T> = T & { user_id: string };
export type LocalPlaceLabelRows = {
  settings: Owned<PlaceLabelSettingsRecord & { id: string }> | null;
  markers: Owned<PlaceMarkerRecord>[];
  labels: Owned<CompletionPlaceLabelRecord>[];
  dismissals: Owned<WhereSuggestionDismissalRecord>[];
};
export type LocalPlaceLabelMutation =
  | { kind: "saveSettings"; expectedUpdatedAt: string | null; next: Owned<PlaceLabelSettingsRecord & { id: string }>; retentionCutoff: string | null }
  | { kind: "upsertMarker"; marker: Owned<PlaceMarkerRecord> }
  | { kind: "deleteMarkers"; id: string | null }
  | { kind: "insertLabel"; label: Owned<CompletionPlaceLabelRecord> }
  | { kind: "deleteLabels"; beforeLocalDate: string | null }
  | { kind: "upsertDismissal"; dismissal: Owned<WhereSuggestionDismissalRecord> };

/**
 * Ticket 216 on desktop: the same core planners as the web route, over SQLite.
 * Works offline; account synchronization carries the rows when a link exists.
 */
export function createLocalPlaceLabelClient(onChanged: () => void = () => undefined): PlaceLabelClient {
  const profile = () => localCommand("readProfile", {});
  const rows = (profileId: string) => localCommand("readPlaceLabels", { profileId }) as Promise<LocalPlaceLabelRows>;
  const now = () => canonicalTravelInstant(Temporal.Now.instant().toString());
  // One instant per commit: the native settings save requires `updated_at` to equal it.
  const commit = async (profileId: string, mutation: LocalPlaceLabelMutation, at = now()) => {
    await localCommand("commitPlaceLabels", { ...localMutation(profileId, at), mutation });
    onChanged();
  };
  const today = (timezone: string) => Temporal.Now.instant().toZonedDateTimeISO(timezone).toPlainDate();
  const load = async (): Promise<PlaceLabelState> => {
    const owner = await profile();
    const [stored, travel, graphs] = await Promise.all([
      rows(owner.id),
      localCommand("readTravelSettings", { profileId: owner.id }),
      localCommand("readBehaviorGraphs", { profileId: owner.id }),
    ]);
    // Rolling retention: delete expired labels when they are read, then sync the deletion.
    const settings = placeLabelSettingsFromRecord(stored.settings);
    const cutoff = settings.enabled ? placeLabelRetentionCutoff(settings.retention, today(owner.timezone))?.toString() ?? null : null;
    let labels = stored.labels;
    if (cutoff && labels.some((label) => label.local_date < cutoff)) {
      await commit(owner.id, { kind: "deleteLabels", beforeLocalDate: cutoff });
      labels = labels.filter((label) => label.local_date >= cutoff);
    }
    const behaviors = [...graphs].sort((left, right) => left.behavior.created_at.localeCompare(right.behavior.created_at) || left.behavior.id.localeCompare(right.behavior.id))
      .map(({ behavior }) => ({ id: behavior.id, active: behavior.active, where_kind: behavior.where_kind ?? null, location_text: behavior.location_text ?? null }));
    return buildPlaceLabelState({ settings: stored.settings, homeText: travel.baseLocationText, markers: stored.markers, labels,
      dismissals: stored.dismissals, behaviors, today: today(owner.timezone) });
  };
  const captureContext = async (occurrenceId: string) => {
    const owner = await profile();
    const [stored, travel, occurrence, history, graphs] = await Promise.all([
      rows(owner.id),
      localCommand("readTravelSettings", { profileId: owner.id }),
      localCommand("readOccurrence", { profileId: owner.id, occurrenceId }),
      localCommand("readOccurrenceHistory", { profileId: owner.id, occurrenceIds: [occurrenceId] }),
      localCommand("readBehaviorGraphs", { profileId: owner.id }),
    ]);
    if (!occurrence) return null;
    const timezone = graphs.find(({ behavior }) => behavior.id === occurrence.behavior_id)?.behavior.timezone ?? owner.timezone;
    const latest = [...history.statusEvents].sort((left, right) => right.recorded_at.localeCompare(left.recorded_at)
      || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))[0] ?? null;
    return {
      owner: owner.id,
      settings: placeLabelSettingsFromRecord(stored.settings),
      homeText: travel.baseLocationText,
      markers: stored.markers,
      occurrence: { id: occurrence.id, behaviorId: occurrence.behavior_id, status: occurrence.status, localDate: occurrence.local_date,
        timezone, scheduledFor: occurrence.scheduled_for, scheduleKind: occurrence.schedule_kind,
        scheduleStartTime: occurrence.schedule_start_time, scheduleEndTime: occurrence.schedule_end_time },
      latestMark: latest ? { status: latest.status, previousStatus: latest.previous_status,
        sourceCaptureMethod: latest.source_capture_method, recordedAt: latest.recorded_at } : null,
    };
  };
  return {
    load,
    async saveSettings(input) {
      const owner = await profile();
      const stored = (await rows(owner.id)).settings;
      const current = placeLabelSettingsFromRecord(stored);
      const { retentionCutoff } = planPlaceLabelSettingsSave(current, input, today(owner.timezone));
      const at = now();
      await commit(owner.id, { kind: "saveSettings", expectedUpdatedAt: stored?.updated_at ?? null, retentionCutoff, next: {
        user_id: owner.id, id: "place_labels", enabled: input.enabled, retention: input.retention,
        enabled_at: input.enabled ? stored?.enabled_at ?? at : null,
        marker_prompt_dismissed_at: input.markerPromptDismissed ? stored?.marker_prompt_dismissed_at ?? at : null,
        updated_at: at,
      } }, at);
      return load();
    },
    async recordMarker(marker) {
      const owner = await profile();
      const [stored, travel] = await Promise.all([rows(owner.id), localCommand("readTravelSettings", { profileId: owner.id })]);
      const row = planPlaceMarker({ settings: placeLabelSettingsFromRecord(stored.settings), marker, homeText: travel.baseLocationText, recordedAt: now() });
      await commit(owner.id, { kind: "upsertMarker", marker: { ...row, user_id: owner.id } });
      return load();
    },
    async removeMarkers(ref) {
      const owner = await profile();
      await commit(owner.id, { kind: "deleteMarkers", id: ref });
      return load();
    },
    async deleteLabels() {
      const owner = await profile();
      await commit(owner.id, { kind: "deleteLabels", beforeLocalDate: null });
      return load();
    },
    async dismissSuggestion(dismissal) {
      const owner = await profile();
      const settings = placeLabelSettingsFromRecord((await rows(owner.id)).settings);
      const row = planWhereSuggestionDismissal({ settings, dismissal, dismissedAt: now() });
      await commit(owner.id, { kind: "upsertDismissal", dismissal: { ...row, user_id: owner.id } });
      return load();
    },
    async capturePlan(occurrenceId) {
      const context = await captureContext(occurrenceId);
      return context ? planCompletionCapture({ ...context, now: Temporal.Now.instant() }) : null;
    },
    async recordLabel(label) {
      const context = await captureContext(label.occurrenceId);
      if (!context) throw new Error("This completion cannot be labeled.");
      const row = planCompletionLabel({ ...context, label, now: Temporal.Instant.from(now()) });
      await commit(context.owner, { kind: "insertLabel", label: { ...row, user_id: context.owner } });
    },
    // The native read never shows a prompt unless asked, so the completion read can try directly.
    locationAllowed: async () => true,
    readLocation: readMacForegroundLocation,
  };
}
