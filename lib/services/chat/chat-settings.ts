import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { ChatSourceFlags } from "./chat-tools";

/**
 * Advisor plan Phase 5 (5A): what chat may read, from the one AI-features approval
 * and its Settings opt-outs (D2). Phase 4's workstream 4F owns that setting and its
 * helper (`lib/services/ai-settings.service.ts`, `readAiSettings`). Until 4F merges,
 * this stand-in has the same shape and reads every feature and source as on, which
 * matches D2's default for Cadence's current accounts. When 4F lands, replace the
 * body of `readChatAiSettings` with `readAiSettings(client)`.
 */
export type ChatAiSettings = Readonly<{
  approved: boolean;
  features: Readonly<{ dailyBrief: boolean; tips: boolean; chat: boolean }>;
  sources: Readonly<{
    notes: boolean; reminderHistory: boolean; googleCalendar: boolean; outlookCalendar: boolean; icloudCalendar: boolean; hevy: boolean;
  }>;
}>;

export async function readChatAiSettings(client: AppSupabaseClient): Promise<ChatAiSettings> {
  void client;
  return {
    approved: true,
    features: { dailyBrief: true, tips: true, chat: true },
    sources: { notes: true, reminderHistory: true, googleCalendar: true, outlookCalendar: true, icloudCalendar: true, hevy: true },
  };
}

export function chatEnabled(settings: ChatAiSettings): boolean {
  return settings.approved && settings.features.chat;
}

/** Sources chat reads, all off when chat is off. */
export function chatSources(settings: ChatAiSettings): ChatSourceFlags {
  const on = chatEnabled(settings);
  return {
    notes: on && settings.sources.notes,
    googleCalendar: on && settings.sources.googleCalendar,
    outlookCalendar: on && settings.sources.outlookCalendar,
    icloudCalendar: on && settings.sources.icloudCalendar,
    hevy: on && settings.sources.hevy,
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
