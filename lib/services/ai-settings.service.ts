import { NO_DAILY_BRIEF_SOURCES } from "@cadence/core/services/daily-brief-sources";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { readStoredAiSettings, type AiSettingsWrite, type StoredAiSettings } from "@/lib/db/ai-settings.repo";

// Advisor plan Phase 4, workstream 4F (owner decision D2, 2026-11-19).
//
// The one place every AI feature reads its switches and source choices: the Daily
// Brief, the coach's tips run (4B) and Chat (5A). A feature that is off makes no
// model call. A source that is off is never sent to a model and never returned by a
// Chat tool. Behaviors, schedules and marks are always usable while a feature is on.
//
// Works with the person's session client and with an agent-token client.

export const AI_FEATURES = ["dailyBrief", "tips", "chat"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_SOURCES = ["notes", "reminderHistory", "googleCalendar", "outlookCalendar", "icloudCalendar", "hevy"] as const;
export type AiSource = (typeof AI_SOURCES)[number];

export type AiSettings = Readonly<{
  /** False until the person answers the AI features question at first run or in Settings. */
  approved: boolean;
  features: Readonly<Record<AiFeature, boolean>>;
  sources: Readonly<Record<AiSource, boolean>>;
}>;

export async function readAiSettings(client: AppSupabaseClient, signal?: AbortSignal): Promise<AiSettings> {
  return aiSettingsFromStored(await readStoredAiSettings(client, signal));
}

export function aiSettingsFromStored(stored: StoredAiSettings): AiSettings {
  const connected = (excluded: boolean) => stored.useConnectedSources && !excluded;
  return {
    approved: stored.approvedAt !== null,
    features: { dailyBrief: stored.dailyBriefEnabled, tips: stored.tipsEnabled, chat: stored.chatEnabled },
    sources: {
      notes: stored.includeNotes,
      reminderHistory: stored.includeReminderHistory,
      googleCalendar: connected(stored.excludedSources.googleCalendar),
      outlookCalendar: connected(stored.excludedSources.outlookCalendar),
      icloudCalendar: connected(stored.excludedSources.icloudCalendar),
      hevy: connected(stored.excludedSources.hevy),
    },
  };
}

export function aiFeatureOn(settings: AiSettings, feature: AiFeature): boolean {
  return settings.features[feature];
}

/** A source is usable by a feature only while that feature is on and the source is on. */
export function aiSourceAllowed(settings: AiSettings, feature: AiFeature, source: AiSource): boolean {
  return settings.features[feature] && settings.sources[source];
}

/** What approving the AI features question writes: every feature and every source on. */
export const AI_SETTINGS_ALL_ON: AiSettingsWrite = Object.freeze({
  dailyBriefEnabled: true, tipsEnabled: true, chatEnabled: true,
  includeNotes: true, includeReminderHistory: true,
  useConnectedSources: true, excludedSources: NO_DAILY_BRIEF_SOURCES,
});
