import { DAILY_BRIEF_CONNECTED_SOURCES, type DailyBriefConnectedSource, type DailyBriefSourceFlags } from "@cadence/core/types/daily-brief";
import { dailyBriefChoiceFromAllowed, dailyBriefSourceFlags } from "@cadence/core/services/daily-brief-sources";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

export type DailyBriefPreferences = {
  enabled: boolean;
  /**
   * Ticket 306: one choice covers every connected source, including one connected
   * later, except the sources excluded under Advanced. Which sources a brief reads
   * also depends on each connection (`dailyBriefSourcesUsed`).
   */
  useConnectedSources: boolean;
  excludedSources: DailyBriefSourceFlags;
  /**
   * Ticket 307: "timeline" once the hosted migration moved Google Calendar to the
   * Timeline connection. Null before it, when no Google Calendar is read.
   */
  googleCalendarSource: "timeline" | null;
  /** Separate choice for reminder delivery history (Ticket 172). */
  includeReminderHistory: boolean;
  /** Separate choice for Notes on Not Completed occurrences (Ticket 172). */
  includeNotes: boolean;
  revision: number;
};

export type DailyBriefPreferenceInput = Pick<DailyBriefPreferences,
  "enabled" | "useConnectedSources" | "excludedSources" | "includeReminderHistory" | "includeNotes">;

export type DailyBriefBeginResult =
  | { state: "acquired"; leaseToken: string; localDate: string }
  | { state: "pending" | "rate_limited"; retryAfterSeconds?: number }
  | { state: "already_attempted" | "retry_exhausted" };

type JsonRecord = Record<string, unknown>;

export type DailyBriefStorageErrorCode =
  | "session"
  | "context_changed"
  | "invalid_request"
  | "context_limit_exceeded"
  | "unavailable";

export class DailyBriefStorageError extends Error {
  constructor(
    public readonly code: DailyBriefStorageErrorCode,
    options?: ErrorOptions,
  ) {
    super(`Daily Brief storage failed: ${code}.`, options);
    this.name = "DailyBriefStorageError";
  }
}

export async function readDailyBriefPreferences(
  client: AppSupabaseClient,
  signal?: AbortSignal,
): Promise<DailyBriefPreferences> {
  const request = client.rpc(
    "read_daily_brief_preferences",
  );
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return parsePreferences(data);
}

export async function saveDailyBriefPreferences(
  client: AppSupabaseClient,
  input: DailyBriefPreferenceInput,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<DailyBriefPreferences> {
  const request = client.rpc(
    "save_daily_brief_preferences_v4",
    {
      p_enabled: input.enabled,
      p_use_connected_sources: input.useConnectedSources,
      p_exclude_google_calendar: input.excludedSources.googleCalendar,
      p_exclude_outlook_calendar: input.excludedSources.outlookCalendar,
      p_exclude_icloud_calendar: input.excludedSources.icloudCalendar,
      p_exclude_hevy: input.excludedSources.hevy,
      p_include_reminder_history: input.includeReminderHistory,
      p_include_notes: input.includeNotes,
      p_expected_revision: expectedRevision,
    },
  );
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return parsePreferences(data);
}

export async function beginDailyBrief(
  client: AppSupabaseClient,
  input: { installationId: string; retry: boolean; expectedRevision: number },
  signal?: AbortSignal,
): Promise<DailyBriefBeginResult> {
  const request = client.rpc(
    "begin_daily_brief",
    {
      p_installation_id: input.installationId,
      p_retry: input.retry,
      p_expected_revision: input.expectedRevision,
    },
  );
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return parseBeginResult(data);
}

export async function finishDailyBrief(
  client: AppSupabaseClient,
  input: {
    installationId: string;
    leaseToken: string;
    success: boolean;
    expectedRevision: number;
  },
  signal?: AbortSignal,
): Promise<boolean> {
  const request = client.rpc(
    "finish_daily_brief",
    {
      p_installation_id: input.installationId,
      p_lease_token: input.leaseToken,
      p_success: input.success,
      p_expected_revision: input.expectedRevision,
    },
  );
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if (typeof data !== "boolean") throw new Error("Daily Brief completion returned an invalid result.");
  return data;
}

/** Releases only a matching pending lease; replay cannot downgrade a completed attempt. */
export async function releaseDailyBrief(
  client: AppSupabaseClient,
  input: Readonly<{ installationId: string; leaseToken: string; expectedRevision: number }>,
  signal?: AbortSignal,
): Promise<boolean> {
  const request = client.rpc("release_daily_brief", {
    p_installation_id: input.installationId,
    p_lease_token: input.leaseToken,
    p_expected_revision: input.expectedRevision,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if (typeof data !== "boolean") throw new Error("Daily Brief release returned an invalid result.");
  return data;
}

export type DailyBriefTipDelivery = Readonly<{ fingerprint: string; lastShownLocalDate: string }>;

/** Fingerprints and last-shown dates from the last 30 local days. Content-free. */
export async function readDailyBriefTipHistory(client: AppSupabaseClient, signal?: AbortSignal): Promise<DailyBriefTipDelivery[]> {
  const request = client.rpc("read_daily_brief_tip_history");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if (!Array.isArray(data)) throw new Error("Daily Brief tip history returned an invalid result.");
  return data.map((item) => {
    const row = asRecord(item, "tip history");
    if (typeof row.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(row.fingerprint) ||
        typeof row.lastShownLocalDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.lastShownLocalDate)) {
      throw new Error("Daily Brief tip history returned an invalid result.");
    }
    return { fingerprint: row.fingerprint, lastShownLocalDate: row.lastShownLocalDate };
  });
}

/** Records a shown tip against this installation's completed lease only. */
export async function recordDailyBriefTip(
  client: AppSupabaseClient,
  input: Readonly<{ installationId: string; leaseToken: string; expectedRevision: number; fingerprint: string }>,
  signal?: AbortSignal,
): Promise<boolean> {
  const request = client.rpc("record_daily_brief_tip", {
    p_installation_id: input.installationId,
    p_lease_token: input.leaseToken,
    p_expected_revision: input.expectedRevision,
    p_fingerprint: input.fingerprint,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if (typeof data !== "boolean") throw new Error("Daily Brief tip record returned an invalid result.");
  return data;
}

export async function listDailyBriefBehaviorIds(
  client: AppSupabaseClient,
  userId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const request = client
    .from("behaviors")
    .select("id")
    .eq("user_id", userId)
    .eq("active", true)
    .order("id", { ascending: true })
    .limit(101);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  if ((data?.length ?? 0) > 100) throw new DailyBriefStorageError("context_limit_exceeded");
  return (data ?? []).map(({ id }) => id);
}

/** Ticket 188: owner-scoped descriptions for active Behaviors. Callers must check disclosure first. */
export async function listDailyBriefBehaviorDescriptions(
  client: AppSupabaseClient,
  userId: string,
  behaviorIds: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (!behaviorIds.length) return {};
  const request = client
    .from("behaviors")
    .select("id, description")
    .eq("user_id", userId)
    .eq("active", true)
    .in("id", [...behaviorIds])
    .not("description", "is", null)
    .limit(101);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw storageError(error);
  return Object.fromEntries((data ?? []).flatMap(({ id, description }) => description?.trim() ? [[id, description]] : []));
}

/** Private workbench labels only; never sent to a model by this read. */
export async function listBriefingWorkbenchBehaviors(client: AppSupabaseClient, userId: string) {
  const { data, error } = await client.from("behaviors").select("id,title")
    .eq("user_id", userId).eq("active", true).order("id", { ascending: true }).limit(101);
  if (error) throw storageError(error);
  if ((data?.length ?? 0) > 100) throw new DailyBriefStorageError("context_limit_exceeded");
  return data ?? [];
}

const EXCLUDED_SOURCE_KEYS = {
  googleCalendar: "google_calendar", outlookCalendar: "outlook_calendar", icloudCalendar: "icloud_calendar", hevy: "hevy",
} as const satisfies Record<DailyBriefConnectedSource, string>;
const ALLOWED_SOURCE_KEYS = {
  googleCalendar: "include_calendar", outlookCalendar: "include_outlook_calendar", icloudCalendar: "include_icloud_calendar", hevy: "include_hevy",
} as const satisfies Record<DailyBriefConnectedSource, string>;

function parsePreferences(value: unknown): DailyBriefPreferences {
  const record = asRecord(value, "preferences");
  if (
    typeof record.enabled !== "boolean"
    || !Number.isSafeInteger(record.revision)
    || (record.revision as number) < 0
    || (record.include_reminder_history !== undefined && typeof record.include_reminder_history !== "boolean")
    || (record.include_notes !== undefined && typeof record.include_notes !== "boolean")
    || DAILY_BRIEF_CONNECTED_SOURCES.some((source) => record[ALLOWED_SOURCE_KEYS[source]] !== undefined && typeof record[ALLOWED_SOURCE_KEYS[source]] !== "boolean")
    || (record.google_calendar_source !== undefined && record.google_calendar_source !== "timeline")
  ) {
    throw new Error("Daily Brief preferences returned an invalid result.");
  }
  const enabled = record.enabled;
  // Absent before migration 20261110150000: derive the choice from what was allowed.
  const choice = record.use_connected_sources === undefined && record.excluded_sources === undefined
    ? dailyBriefChoiceFromAllowed(enabled, dailyBriefSourceFlags((source) => record[ALLOWED_SOURCE_KEYS[source]] === true))
    : parseSourceChoice(record);
  if (!enabled && (choice.useConnectedSources || DAILY_BRIEF_CONNECTED_SOURCES.some((source) => choice.excludedSources[source]))) {
    throw new Error("Daily Brief preferences returned an invalid result.");
  }
  return {
    enabled,
    ...choice,
    googleCalendarSource: record.google_calendar_source === "timeline" ? "timeline" : null,
    // Absent before migration 20260926170000; absence never allows a source.
    includeReminderHistory: record.include_reminder_history === true,
    includeNotes: record.include_notes === true,
    revision: record.revision as number,
  };
}

function parseSourceChoice(record: JsonRecord): Pick<DailyBriefPreferences, "useConnectedSources" | "excludedSources"> {
  const excluded = record.excluded_sources;
  if (typeof record.use_connected_sources !== "boolean" || !excluded || typeof excluded !== "object" || Array.isArray(excluded)) {
    throw new Error("Daily Brief preferences returned an invalid result.");
  }
  const flags = excluded as JsonRecord;
  if (Object.keys(flags).length !== DAILY_BRIEF_CONNECTED_SOURCES.length ||
      DAILY_BRIEF_CONNECTED_SOURCES.some((source) => typeof flags[EXCLUDED_SOURCE_KEYS[source]] !== "boolean")) {
    throw new Error("Daily Brief preferences returned an invalid result.");
  }
  return {
    useConnectedSources: record.use_connected_sources,
    excludedSources: dailyBriefSourceFlags((source) => flags[EXCLUDED_SOURCE_KEYS[source]] === true),
  };
}

function parseBeginResult(value: unknown): DailyBriefBeginResult {
  const record = asRecord(value, "admission");
  if (record.state === "already_attempted" || record.state === "retry_exhausted") return { state: record.state };
  if (record.state === "acquired") {
    if (typeof record.lease_token !== "string" || typeof record.local_date !== "string") {
      throw new Error("Daily Brief admission returned an invalid result.");
    }
    return { state: record.state, leaseToken: record.lease_token, localDate: record.local_date };
  }
  if (record.state === "pending" || record.state === "rate_limited") {
    if (record.retry_after_seconds !== undefined && (!Number.isInteger(record.retry_after_seconds) || (record.retry_after_seconds as number) < 1)) {
      throw new Error("Daily Brief admission returned an invalid result.");
    }
    return {
      state: record.state,
      ...(record.retry_after_seconds === undefined ? {} : { retryAfterSeconds: record.retry_after_seconds as number }),
    };
  }
  throw new Error("Daily Brief admission returned an invalid result.");
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Daily Brief ${label} returned an invalid result.`);
  }
  return value as JsonRecord;
}

function storageError(error: { code?: string }): DailyBriefStorageError {
  const code = error.code === "42501"
    ? "session"
    : error.code === "40001" || error.code === "55000"
      ? "context_changed"
      : error.code === "22023"
        ? "invalid_request"
        : "unavailable";
  return new DailyBriefStorageError(code, { cause: error });
}
