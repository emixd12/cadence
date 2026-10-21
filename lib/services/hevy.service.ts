import { Temporal } from "@js-temporal/polyfill";
import { applyRecordedActivityRefresh, type RecordedActivityRefresh } from "@cadence/core/services/recorded-activity-refresh";
import {
  RECORDED_ACTIVITY_MAX_RANGE_DAYS,
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
import { HEVY_READ_DEADLINE_MS, HevyProviderError, readHevyWorkouts, verifyHevyApiKey, type HevyRequestOptions } from "./hevy-provider";
import { assertConnectorReadActive, withConnectorReadDeadline } from "./connector-read-deadline";

// Ticket 236 Hevy orchestration. Credentials stay inside the Ticket 235
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
  return withConnectorReadDeadline(options, HEVY_READ_DEADLINE_MS, (bounded, deadlineAt) =>
    readActivities(caller, start, end, bounded, deadlineAt));
}

async function readActivities(caller: ConnectorCaller, start: string, end: string,
  options: HevyActivityReadOptions, deadlineAt: number): Promise<RecordedActivitySnapshotV1> {
  const clock = options.clock ?? Date.now;
  const timezone = await profileTimezone(caller, options.signal);
  assertConnectorReadActive(options, deadlineAt);
  const range = validateRange(start, end, timezone, Temporal.Instant.fromEpochMilliseconds(clock()));
  return withConnectorCredential(caller, "hevy", async (credential, connection) => {
    assertConnectorReadActive(options, deadlineAt);
    if (credential.provider !== "hevy") throw new ConnectorError("reconnect_required");
    if (options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) {
      throw new ConnectorError("connection_changed");
    }
    let snapshot: RecordedActivitySnapshotV1;
    try {
      snapshot = await readHevyWorkouts({ ...options, clock, deadlineMs: deadlineAt - clock(), apiKey: credential.apiKey, accountId: caller.user.id,
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

/**
 * Cache rule for Ticket 238 consumers. The pure implementation lives in
 * `@cadence/core/services/recorded-activity-refresh` so web and desktop clients
 * can apply it without importing this server module.
 */
export type HevyActivityRefresh = RecordedActivityRefresh;
export const applyHevyActivityRefresh = applyRecordedActivityRefresh;

async function profileTimezone(caller: ConnectorCaller, signal?: AbortSignal): Promise<string> {
  const query = caller.client.from("profiles").select("timezone").eq("id", caller.user.id);
  const { data, error } = await (signal && query.abortSignal ? query.abortSignal(signal) : query).single();
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
