import { DAILY_BRIEF_CONNECTED_SOURCES, type DailyBriefConnectedSource, type DailyBriefSourceFlags } from "@cadence/core/types/daily-brief";
import { dailyBriefSourceFlags } from "@cadence/core/services/daily-brief-sources";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { DailyBriefStorageError } from "@/lib/db/daily-brief.repo";

// Advisor plan Phase 4, workstream 4F (migration 20261120100000). One row of AI
// choices per person: the approval, a switch per feature, and the source choices
// shared by every feature. Source choices are stored on the Daily Brief preference
// row; tips, Chat and the approval on their own private row.

export type StoredAiSettings = Readonly<{
  /** ISO time the person first answered the AI features question; null before. */
  approvedAt: string | null;
  revision: number;
  dailyBriefEnabled: boolean;
  tipsEnabled: boolean;
  chatEnabled: boolean;
  includeNotes: boolean;
  includeReminderHistory: boolean;
  useConnectedSources: boolean;
  excludedSources: DailyBriefSourceFlags;
}>;

export type AiSettingsWrite = Omit<StoredAiSettings, "approvedAt" | "revision">;

const EXCLUDED_KEYS: Readonly<Record<DailyBriefConnectedSource, string>> = {
  googleCalendar: "google_calendar", outlookCalendar: "outlook_calendar", icloudCalendar: "icloud_calendar", hevy: "hevy",
};

type JsonRecord = Record<string, unknown>;

/** Reads with the person's session or with one of Cadence's agent tokens. */
export async function readStoredAiSettings(client: AppSupabaseClient, signal?: AbortSignal): Promise<StoredAiSettings> {
  const request = client.rpc("read_ai_settings");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return parseAiSettings(data);
}

/**
 * Saves every choice and records the approval. Only the person's own session may save.
 * `expectedRevision` is the Daily Brief preference revision the caller read.
 */
export async function saveStoredAiSettings(
  client: AppSupabaseClient,
  input: AiSettingsWrite,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<StoredAiSettings> {
  const request = client.rpc("save_ai_settings", {
    p_daily_brief_enabled: input.dailyBriefEnabled,
    p_tips_enabled: input.tipsEnabled,
    p_chat_enabled: input.chatEnabled,
    p_use_connected_sources: input.useConnectedSources,
    p_exclude_google_calendar: input.excludedSources.googleCalendar,
    p_exclude_outlook_calendar: input.excludedSources.outlookCalendar,
    p_exclude_icloud_calendar: input.excludedSources.icloudCalendar,
    p_exclude_hevy: input.excludedSources.hevy,
    p_include_reminder_history: input.includeReminderHistory,
    p_include_notes: input.includeNotes,
    p_expected_revision: expectedRevision,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return parseAiSettings(data);
}

export function parseAiSettings(value: unknown): StoredAiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const record = value as JsonRecord;
  const flags = record.excluded_sources;
  const booleans = ["daily_brief_enabled", "tips_enabled", "chat_enabled", "include_notes", "include_reminder_history", "use_connected_sources"];
  if (booleans.some((key) => typeof record[key] !== "boolean") ||
      (record.approved_at !== null && typeof record.approved_at !== "string") ||
      !Number.isSafeInteger(record.revision) || (record.revision as number) < 0 ||
      !flags || typeof flags !== "object" || Array.isArray(flags) ||
      DAILY_BRIEF_CONNECTED_SOURCES.some((source) => typeof (flags as JsonRecord)[EXCLUDED_KEYS[source]] !== "boolean")) {
    throw invalid();
  }
  return {
    approvedAt: record.approved_at as string | null,
    revision: record.revision as number,
    dailyBriefEnabled: record.daily_brief_enabled as boolean,
    tipsEnabled: record.tips_enabled as boolean,
    chatEnabled: record.chat_enabled as boolean,
    includeNotes: record.include_notes as boolean,
    includeReminderHistory: record.include_reminder_history as boolean,
    useConnectedSources: record.use_connected_sources as boolean,
    excludedSources: dailyBriefSourceFlags((source) => (flags as JsonRecord)[EXCLUDED_KEYS[source]] === true),
  };
}

function invalid(): Error {
  return new Error("AI settings returned an invalid result.");
}

function storageError(error: { code?: string }): DailyBriefStorageError {
  const code = error.code === "42501" ? "session"
    : error.code === "40001" || error.code === "55000" ? "context_changed"
      : error.code === "22023" ? "invalid_request" : "unavailable";
  return new DailyBriefStorageError(code, { cause: error });
}
