import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { aiFeatureOn, aiSourceAllowed, readAiSettings, type AiSettings } from "@/lib/services/ai-settings.service";
import type { ChatSourceFlags } from "./chat-tools";

/**
 * Advisor plan Phase 5 (5A): what chat may read, from the one AI features approval
 * and its Settings opt-outs (D2, workstream 4F's `readAiSettings`).
 */
export type ChatAiSettings = AiSettings;

export function readChatAiSettings(client: AppSupabaseClient, signal?: AbortSignal): Promise<ChatAiSettings> {
  return readAiSettings(client, signal);
}

/** Chat answers only after the AI features approval, while chat is on in Settings. */
export function chatEnabled(settings: ChatAiSettings): boolean {
  return settings.approved && aiFeatureOn(settings, "chat");
}

/** Sources chat reads, all off when chat is off. */
export function chatSources(settings: ChatAiSettings): ChatSourceFlags {
  const on = chatEnabled(settings);
  return {
    notes: on && aiSourceAllowed(settings, "chat", "notes"),
    googleCalendar: on && aiSourceAllowed(settings, "chat", "googleCalendar"),
    outlookCalendar: on && aiSourceAllowed(settings, "chat", "outlookCalendar"),
    icloudCalendar: on && aiSourceAllowed(settings, "chat", "icloudCalendar"),
    hevy: on && aiSourceAllowed(settings, "chat", "hevy"),
  };
}

export function chatGoogleCalendarSource(settings: ChatAiSettings): "agent_mcp" | "standard" {
  return settings.googleCalendarSource ?? "agent_mcp";
}

export function chatLongitudinalReviewSettings(settings: ChatAiSettings): Readonly<{
  enabled: boolean;
  cadence: "weekly" | "monthly";
}> {
  return {
    enabled: settings.longitudinalCalendarReviewEnabled === true,
    cadence: settings.longitudinalCalendarReviewCadence === "monthly" ? "monthly" : "weekly",
  };
}

/** Plain names of the sources that are off, for the prompt. */
export function chatSourcesOff(sources: ChatSourceFlags): string[] {
  const names: Array<[keyof ChatSourceFlags, string]> = [
    ["notes", "notes and day notes"], ["googleCalendar", "Google Calendar"], ["outlookCalendar", "Outlook Calendar"],
    ["icloudCalendar", "iCloud Calendar"], ["hevy", "Hevy workouts"],
  ];
  return names.filter(([key]) => !sources[key]).map(([, name]) => name);
}
