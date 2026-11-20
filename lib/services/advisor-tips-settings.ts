import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { aiFeatureOn, aiSourceAllowed, readAiSettings, type AiSettings } from "./ai-settings.service";

/**
 * Advisor plan Phase 4, workstream 4B step 7: whether tips are on, and which sources may
 * reach the model, for one account. Reads the shared AI features settings (workstream 4F,
 * `lib/services/ai-settings.service.ts`).
 */

export type AdvisorTipsSettings = Readonly<{ tipsOn: boolean; notesAllowed: boolean; reminderHistoryAllowed: boolean }>;

export async function readAdvisorTipsSettings(client: AppSupabaseClient): Promise<AdvisorTipsSettings> {
  return advisorTipsSettingsFrom(await readAiSettings(client));
}

export function advisorTipsSettingsFrom(settings: AiSettings): AdvisorTipsSettings {
  return {
    tipsOn: aiFeatureOn(settings, "tips"),
    notesAllowed: aiSourceAllowed(settings, "tips", "notes"),
    reminderHistoryAllowed: aiSourceAllowed(settings, "tips", "reminderHistory"),
  };
}
