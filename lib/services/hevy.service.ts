import { Temporal } from "@js-temporal/polyfill";
import { recordedActivitySnapshotScopeKey } from "@cadence/core/services/recorded-activity-validation";
import {
  RECORDED_ACTIVITY_MAX_RANGE_DAYS,
  type RecordedActivityFailure,
  type RecordedActivitySnapshotV1,
} from "@cadence/core/types/recorded-activity";
import {
  ConnectorError,
  type ConnectorConnectionView,
  type ConnectorRevocationInstruction,
} from "@/lib/types/connectors";
import {
  connectDirectCredential,
  disconnectConnector,
  getConnectorConnection,
  markConnectorReconnectRequired,
  withConnectorCredential,
  type ConnectorCaller,
} from "./connector-credentials";
import { HevyProviderError, readHevyWorkouts, verifyHevyApiKey, type HevyRequestOptions } from "./hevy-provider";

// Ticket 223 Hevy orchestration. Credentials stay inside the Ticket 222
// lifecycle; this service exposes status, explicit connect or reconnect with a
// user-entered key, bounded activity reads, and disconnect. It exposes no
// workout-writing operation. Recorded activity never changes a Behavior,
// Occurrence, status, Note, reminder, or tracked time.

export type HevyServiceOptions = Pick<HevyRequestOptions, "fetch" | "clock" | "sleep" | "random" | "signal" | "deadlineMs">;

export function getHevyConnection(caller: ConnectorCaller): Promise<ConnectorConnectionView> {
  return getConnectorConnection(caller, "hevy");
}

/**
 * Accepts exactly `{ apiKey }`. The key is verified against Hevy `user/info`,
 * sealed, and never returned. Connect and reconnect share this path; a
 * different Hevy account while one is still bound fails as `wrong_account`.
 * A key Hevy refuses is `reconnect_required`; a non-Pro account is
 * `permission_denied`.
 */
export async function connectHevy(caller: ConnectorCaller, body: unknown, options: HevyServiceOptions = {}): Promise<ConnectorConnectionView> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConnectorError("invalid_request");
  const entry = body as Record<string, unknown>;
  const keys = Object.keys(entry);
  if (keys.length !== 1 || keys[0] !== "apiKey" || typeof entry.apiKey !== "string") throw new ConnectorError("invalid_request");
  return connectDirectCredential(caller, { provider: "hevy", apiKey: entry.apiKey }, async (credential) => {
    if (credential.provider !== "hevy") throw new ConnectorError("invalid_request");
    try { return await verifyHevyApiKey(credential.apiKey, options); }
    catch (error) { throw connectorError(error); }
  });
}

export function disconnectHevy(caller: ConnectorCaller): Promise<ConnectorConnectionView & { revocation: ConnectorRevocationInstruction }> {
  return disconnectConnector(caller, "hevy");
}

export type HevyActivityReadOptions = HevyServiceOptions & Readonly<{
  /** Rejects the read when the caller authorized an earlier connection. */
  expectedConnectionGeneration?: number;
}>;

/**
 * Reads recorded workout timing for inclusive local dates in the profile
 * timezone: at most 31 days, ending no later than today. Returns a validated
 * snapshot, complete or incomplete. Incomplete snapshots carry a stable failure
 * and must not erase known records (see `applyHevyActivityRefresh`). A response
 * that finishes after disconnect, reconnect, or account change is discarded as
 * `connection_changed`.
 */
export async function getHevyActivities(caller: ConnectorCaller, start: string, end: string,
  options: HevyActivityReadOptions = {}): Promise<RecordedActivitySnapshotV1> {
  const clock = options.clock ?? Date.now;
  const timezone = await profileTimezone(caller);
  const range = validateRange(start, end, timezone, Temporal.Instant.fromEpochMilliseconds(clock()));
  return withConnectorCredential(caller, "hevy", async (credential, connection) => {
    if (credential.provider !== "hevy") throw new ConnectorError("reconnect_required");
    if (options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) {
      throw new ConnectorError("connection_changed");
    }
    let snapshot: RecordedActivitySnapshotV1;
    try {
      snapshot = await readHevyWorkouts({ ...options, clock, apiKey: credential.apiKey, accountId: caller.user.id,
        connectionGeneration: connection.generation, range });
    } catch (error) {
      throw connectorError(error);
    }
    if (snapshot.failures.some((failure) => failure.code === "reconnect_required")) {
      await markConnectorReconnectRequired(connection);
      throw new ConnectorError("reconnect_required");
    }
    return snapshot;
  });
}

export type HevyActivityRefresh = Readonly<{
  snapshot: RecordedActivitySnapshotV1;
  /** True only when `next` replaced the cached snapshot. */
  replaced: boolean;
  /** Failures of the attempted refresh, kept even when the cached snapshot remains. */
  refreshFailures: RecordedActivityFailure[];
}>;

/**
 * Cache rule for Ticket 225 consumers. A complete refresh replaces the cached
 * snapshot for the same scope at once, which is how edits and deletions are
 * proved. An incomplete refresh never erases known records. A response from an
 * older connection generation or an earlier fetch than the cached one is late
 * and ignored. A different account, range, or timezone never reuses the cache.
 */
export function applyHevyActivityRefresh(cached: RecordedActivitySnapshotV1 | null, next: RecordedActivitySnapshotV1): HevyActivityRefresh {
  if (!cached || cached.accountId !== next.accountId) return { snapshot: next, replaced: true, refreshFailures: next.failures };
  if (next.connectionGeneration < cached.connectionGeneration) return { snapshot: cached, replaced: false, refreshFailures: next.failures };
  if (scopeKey(cached) !== scopeKey(next)) return { snapshot: next, replaced: true, refreshFailures: next.failures };
  if (Temporal.Instant.compare(Temporal.Instant.from(next.fetchedAt), Temporal.Instant.from(cached.fetchedAt)) < 0) {
    return { snapshot: cached, replaced: false, refreshFailures: next.failures };
  }
  if (next.completeness === "complete") return { snapshot: next, replaced: true, refreshFailures: next.failures };
  return { snapshot: cached, replaced: false, refreshFailures: next.failures };
}

function scopeKey(snapshot: RecordedActivitySnapshotV1): string {
  return recordedActivitySnapshotScopeKey({ source: snapshot.source, accountId: snapshot.accountId,
    connectionGeneration: snapshot.connectionGeneration, startLocalDate: snapshot.requestedRange.startLocalDate,
    endLocalDate: snapshot.requestedRange.endLocalDate, timezone: snapshot.requestedRange.timezone });
}

async function profileTimezone(caller: ConnectorCaller): Promise<string> {
  const { data, error } = await caller.client.from("profiles").select("timezone").eq("id", caller.user.id).single();
  if (error || !data || typeof data.timezone !== "string") throw new ConnectorError("provider_unavailable");
  return data.timezone;
}

function validateRange(start: string, end: string, timezone: string, now: Temporal.Instant) {
  let first: Temporal.PlainDate; let last: Temporal.PlainDate; let today: Temporal.PlainDate;
  try {
    first = Temporal.PlainDate.from(start); last = Temporal.PlainDate.from(end);
    today = now.toZonedDateTimeISO(timezone).toPlainDate();
  } catch { throw new ConnectorError("invalid_request"); }
  if (first.toString() !== start || last.toString() !== end || Temporal.PlainDate.compare(first, last) > 0
    || Temporal.PlainDate.compare(last, today) > 0
    || Temporal.PlainDate.compare(first, today.subtract({ days: RECORDED_ACTIVITY_MAX_RANGE_DAYS - 1 })) < 0) {
    throw new ConnectorError("invalid_request");
  }
  return { startLocalDate: start, endLocalDate: end, timezone };
}

function connectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (error instanceof HevyProviderError) return new ConnectorError(error.failure.code);
  return new ConnectorError("provider_unavailable");
}
