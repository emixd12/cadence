import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

export type DailyBriefPreferences = {
  enabled: boolean;
  includeCalendar: boolean;
  /** Separate disclosure for reminder delivery history (Ticket 172). */
  includeReminderHistory: boolean;
  /** Separate disclosure for Notes on Not Completed occurrences (Ticket 172). */
  includeNotes: boolean;
  revision: number;
  calendarConnectionGeneration: number | null;
  calendarSelectionRevision: number | null;
  /**
   * Separate connector disclosures (Ticket 239). `includeCalendar` stays Google
   * only. Each binds the connection generation, and calendars also the
   * selection revision, current when it was granted.
   */
  includeOutlookCalendar: boolean;
  outlookConnectionGeneration: number | null;
  outlookSelectionRevision: number | null;
  includeIcloudCalendar: boolean;
  icloudConnectionGeneration: number | null;
  icloudSelectionRevision: number | null;
  includeHevy: boolean;
  hevyConnectionGeneration: number | null;
};

export type DailyBriefPreferenceInput = Pick<DailyBriefPreferences, "enabled" | "includeCalendar" | "includeReminderHistory" | "includeNotes">
  & Partial<Pick<DailyBriefPreferences, "includeOutlookCalendar" | "includeIcloudCalendar" | "includeHevy">>;

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
  // Omitted connector disclosures save as off; a save never grants one silently.
  const request = client.rpc(
    "save_daily_brief_preferences_v3",
    {
      p_enabled: input.enabled,
      p_include_calendar: input.includeCalendar,
      p_include_reminder_history: input.includeReminderHistory,
      p_include_notes: input.includeNotes,
      p_include_outlook_calendar: input.includeOutlookCalendar === true,
      p_include_icloud_calendar: input.includeIcloudCalendar === true,
      p_include_hevy: input.includeHevy === true,
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

function parsePreferences(value: unknown): DailyBriefPreferences {
  const record = asRecord(value, "preferences");
  if (
    typeof record.enabled !== "boolean"
    || typeof record.include_calendar !== "boolean"
    || !Number.isSafeInteger(record.revision)
    || (record.revision as number) < 0
    || (record.calendar_connection_generation !== null && !Number.isSafeInteger(record.calendar_connection_generation))
    || (record.calendar_selection_revision !== null && !Number.isSafeInteger(record.calendar_selection_revision))
    || (record.include_calendar && (record.calendar_connection_generation === null || record.calendar_selection_revision === null))
    || (record.include_reminder_history !== undefined && typeof record.include_reminder_history !== "boolean")
    || (record.include_notes !== undefined && typeof record.include_notes !== "boolean")
    || (!record.include_calendar && (record.calendar_connection_generation !== null || record.calendar_selection_revision !== null))
    || !connectorFenceValid(record, "include_outlook_calendar", ["outlook_connection_generation", "outlook_selection_revision"])
    || !connectorFenceValid(record, "include_icloud_calendar", ["icloud_connection_generation", "icloud_selection_revision"])
    || !connectorFenceValid(record, "include_hevy", ["hevy_connection_generation"])
  ) {
    throw new Error("Daily Brief preferences returned an invalid result.");
  }
  const fence = (key: string) => (record[key] ?? null) as number | null;
  return {
    enabled: record.enabled,
    includeCalendar: record.include_calendar,
    // Absent before migration 20260926170000; absence never grants disclosure.
    includeReminderHistory: record.include_reminder_history === true,
    includeNotes: record.include_notes === true,
    revision: record.revision as number,
    calendarConnectionGeneration: record.calendar_connection_generation as number | null,
    calendarSelectionRevision: record.calendar_selection_revision as number | null,
    // Absent before migration 20261019041000; absence never grants disclosure.
    includeOutlookCalendar: record.include_outlook_calendar === true,
    outlookConnectionGeneration: record.include_outlook_calendar === true ? fence("outlook_connection_generation") : null,
    outlookSelectionRevision: record.include_outlook_calendar === true ? fence("outlook_selection_revision") : null,
    includeIcloudCalendar: record.include_icloud_calendar === true,
    icloudConnectionGeneration: record.include_icloud_calendar === true ? fence("icloud_connection_generation") : null,
    icloudSelectionRevision: record.include_icloud_calendar === true ? fence("icloud_selection_revision") : null,
    includeHevy: record.include_hevy === true,
    hevyConnectionGeneration: record.include_hevy === true ? fence("hevy_connection_generation") : null,
  };
}

/** A missing key is off. A present disclosure must carry every bound fence value. */
function connectorFenceValid(record: JsonRecord, flag: string, fences: readonly string[]): boolean {
  const value = record[flag];
  if (value === undefined) return fences.every((key) => record[key] === undefined || record[key] === null);
  if (typeof value !== "boolean") return false;
  return fences.every((key) => value
    ? Number.isSafeInteger(record[key]) && (record[key] as number) >= 0
    : record[key] === undefined || record[key] === null);
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
