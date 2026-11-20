import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

/**
 * Advisor plan Phase 4, workstream 4B step 7: whether tips are on, and whether day notes
 * may reach the model, for one account.
 *
 * Workstream 4F owns the AI features approval and Settings ("Advisor tips" switch, shared
 * source choices) and its helper `lib/services/ai-settings.service.ts` with the database
 * function `read_ai_settings`. Until that lands this reads the function when it exists and
 * otherwise uses the owner's decision E1: tips on by default, and notes off (nothing from
 * notes reaches a model without a choice that covers it).
 */

export type AdvisorTipsSettings = Readonly<{ tipsOn: boolean; notesAllowed: boolean }>;

export const ADVISOR_TIPS_DEFAULT_SETTINGS: AdvisorTipsSettings = Object.freeze({ tipsOn: true, notesAllowed: false });

export async function readAdvisorTipsSettings(client: AppSupabaseClient): Promise<AdvisorTipsSettings> {
  // `read_ai_settings` arrives with workstream 4F, so it is not in the generated types yet.
  const untyped = client as unknown as { rpc(name: string): PromiseLike<{ data: unknown; error: { code?: string } | null }> };
  const { data, error } = await untyped.rpc("read_ai_settings");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return ADVISOR_TIPS_DEFAULT_SETTINGS;
    throw new Error("advisor_tips_settings_unavailable");
  }
  return parseAiSettings(data);
}

/** Accepts the 4F shape: { approved, features: { tips }, sources: { notes } } (snake or camel case). */
export function parseAiSettings(data: unknown): AdvisorTipsSettings {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== "object") return { tipsOn: false, notesAllowed: false };
  const features = (row.features ?? {}) as Record<string, unknown>;
  const sources = (row.sources ?? {}) as Record<string, unknown>;
  const approved = row.approved !== false;
  const tips = features.tips ?? row.tips_enabled;
  const notes = sources.notes ?? row.include_notes;
  return { tipsOn: approved && tips === true, notesAllowed: approved && tips === true && notes === true };
}
