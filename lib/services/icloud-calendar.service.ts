import { ProviderCallTimeoutError, runProviderCallWithTimeout } from "./provider-call-timeout";
import { Temporal } from "@js-temporal/polyfill";
import { saveConnectorPreferences } from "@/lib/db/connectors.repo";
import {
  ConnectorError,
  type ConnectorConnection,
  type ConnectorConnectionView,
  type ConnectorCredential,
  type ConnectorRevocationInstruction,
} from "@/lib/types/connectors";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import {
  connectDirectCredential,
  connectorAccountDigest,
  disconnectConnector,
  getConnectorConnection,
  markConnectorReconnectRequired,
  withConnectorCredential,
  type ConnectorCaller,
} from "./connector-credentials";
import {
  ICLOUD_READ_DEADLINE_MS,
  IcloudCalendarProviderError,
  discoverIcloudCalendar,
  listIcloudCalendars,
  readIcloudCalendarEvents,
  type IcloudCalendar,
  type IcloudCalendarReadResult,
  type IcloudFetch,
  type IcloudLogin,
  type IcloudRequestOptions,
} from "./icloud-calendar-provider";

// Ticket 227 iCloud Calendar broker for web and linked desktop. The user enters
// an Apple Account email and an app-specific password once; this service
// verifies them against CalDAV discovery, binds the connection to the
// `current-user-principal` href, seals both values with the Ticket 222
// lifecycle, and never returns them. Apple does not limit an app-specific
// password to Calendar, so Cadence's reads are limited by its own PROPFIND and
// REPORT allowlist. Apple documents no programmatic revocation: disconnect
// deletes Cadence's sealed copy and names the user's removal step.
const PROVIDER = "icloud_calendar" as const;
const APP_PASSWORD = /^[a-z]{4}-?[a-z]{4}-?[a-z]{4}-?[a-z]{4}$/i;

/** Test seams only; production uses global fetch and the system clock. */
export type IcloudServiceOptions = Readonly<{ fetch?: IcloudFetch; clock?: () => number; signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>; random?: () => number;
  /** Daily Brief passes its smaller remaining budget; interactive requests use 25 s. */
  deadlineMs?: number }>;

export function getIcloudCalendarConnection(caller: ConnectorCaller): Promise<ConnectorConnectionView> {
  return getConnectorConnection(caller, PROVIDER);
}

function exactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorError("invalid_request");
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new ConnectorError("invalid_request");
  return value as Record<string, unknown>;
}

/**
 * Normalizes intake. The Apple Account must look like an address without a
 * colon (Basic authentication separator). The password must have the
 * app-specific shape (four groups of four letters). Shape alone cannot prove
 * that the value is an app-specific password.
 */
export function normalizeIcloudLogin(raw: unknown): IcloudLogin {
  const body = exactKeys(raw, ["appleId", "appPassword"]);
  const appleId = typeof body.appleId === "string" ? body.appleId.trim() : "";
  const password = typeof body.appPassword === "string" ? body.appPassword.trim() : "";
  if (!appleId || appleId.length > 254 || /[\s:\u0000-\u001f\u007f]/.test(appleId) || !/^[^@]+@[^@]+\.[^@]+$/.test(appleId)) throw new ConnectorError("invalid_request");
  if (!APP_PASSWORD.test(password)) throw new ConnectorError("invalid_request");
  const letters = password.replace(/-/g, "").toLowerCase();
  return { appleId: appleId.toLowerCase(), appPassword: `${letters.slice(0, 4)}-${letters.slice(4, 8)}-${letters.slice(8, 12)}-${letters.slice(12)}` };
}

function deadlineFor(options: IcloudServiceOptions): number {
  if (options.deadlineMs !== undefined && (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)) throw new ConnectorError("timeout");
  return (options.clock ?? Date.now)() + Math.min(ICLOUD_READ_DEADLINE_MS, options.deadlineMs ?? ICLOUD_READ_DEADLINE_MS);
}

function assertReadActive(options: IcloudServiceOptions, deadlineAt: number): void {
  if (options.signal?.aborted || (options.clock ?? Date.now)() >= deadlineAt) throw new ConnectorError("timeout");
}

/** Includes database waits and the final credential fence, even if a dependency ignores abort. */
async function boundedRead<T>(options: IcloudServiceOptions, read: (options: IcloudServiceOptions, deadlineAt: number) => Promise<T>): Promise<T> {
  const deadlineAt = deadlineFor(options);
  const timeoutMs = Math.max(1, Math.ceil(deadlineAt - (options.clock ?? Date.now)()));
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const bounded = { ...options, signal };
  try {
    return await runProviderCallWithTimeout(async () => {
      assertReadActive(bounded, deadlineAt);
      const result = await read(bounded, deadlineAt);
      assertReadActive(bounded, deadlineAt);
      return result;
    }, { signal, timeoutMs });
  } catch (error) {
    if (error instanceof ProviderCallTimeoutError) throw new ConnectorError("timeout");
    throw error;
  }
}

function requestOptions(login: IcloudLogin, deadlineAt: number, options: IcloudServiceOptions): IcloudRequestOptions {
  return { login, deadlineAt, now: options.clock, fetch: options.fetch, signal: options.signal, sleep: options.sleep, random: options.random };
}

function providerError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (error instanceof IcloudCalendarProviderError) return new ConnectorError(error.failure.code);
  return new ConnectorError("provider_unavailable");
}

/**
 * Accepts exactly `{ appleId, appPassword }`. Verification (principal and
 * calendar-home discovery) shares one 25-second deadline. A different principal
 * while one is still bound fails as `wrong_account`; disconnect first.
 */
export async function connectIcloudCalendar(caller: ConnectorCaller, raw: unknown, options: IcloudServiceOptions = {}): Promise<ConnectorConnectionView> {
  const login = normalizeIcloudLogin(raw);
  const deadlineAt = deadlineFor(options);
  return connectDirectCredential(caller, { provider: PROVIDER, ...login }, async (credential) => {
    if (credential.provider !== PROVIDER) throw new ConnectorError("invalid_request");
    try { return [(await discoverIcloudCalendar(requestOptions(credential, deadlineAt, options))).principal]; }
    catch (error) { throw providerError(error); }
  });
}

type IcloudAccess = Readonly<{ login: IcloudLogin; connection: ConnectorConnection; deadlineAt: number }>;

/**
 * Opens the sealed login for one request and rediscovers the principal. The
 * principal must still hash to the bound identity before any calendar is read.
 * A 401 fences this provider as reconnect_required.
 */
async function withIcloudAccess<T>(caller: ConnectorCaller, options: IcloudServiceOptions, deadlineAt: number,
  read: (access: IcloudAccess, discovered: Awaited<ReturnType<typeof discoverIcloudCalendar>>) => Promise<T>): Promise<T> {
  return withConnectorCredential(caller, PROVIDER, async (credential: ConnectorCredential, connection) => {
    assertReadActive(options, deadlineAt);
    if (credential.provider !== PROVIDER) throw new ConnectorError("reconnect_required");
    const access = { login: { appleId: credential.appleId, appPassword: credential.appPassword }, connection, deadlineAt };
    try {
      const discovered = await discoverIcloudCalendar(requestOptions(access.login, deadlineAt, options));
      if (connectorAccountDigest(PROVIDER, [discovered.principal]) !== connection.accountDigest) throw new ConnectorError("wrong_account");
      return await read(access, discovered);
    } catch (error) {
      const failure = providerError(error);
      if (failure.code === "reconnect_required") await markConnectorReconnectRequired(connection).catch(() => undefined);
      throw failure;
    }
  });
}

export async function listIcloudCalendarsForCaller(caller: ConnectorCaller, options: IcloudServiceOptions = {}): Promise<{ calendars: IcloudCalendar[] }> {
  return boundedRead(options, (bounded, deadlineAt) => withIcloudAccess(caller, bounded, deadlineAt, async (access, discovered) => {
    const calendars = await listIcloudCalendars(requestOptions(access.login, deadlineAt, bounded), discovered);
    return { calendars: calendars.map(({ id, name, isDefault }) => ({ id, name, isDefault })) };
  }));
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some((id) => typeof id !== "string" || !/^ic_[A-Za-z0-9_-]{32}$/.test(id)) || new Set(value).size !== value.length) {
    throw new ConnectorError("invalid_request");
  }
  return value as string[];
}

/** Saves the selection only when every selected calendar is a current VEVENT collection. */
export async function updateIcloudCalendarPreferences(caller: ConnectorCaller, raw: unknown, options: IcloudServiceOptions = {}): Promise<ConnectorConnectionView> {
  const body = exactKeys(raw, ["selectedSourceIds", "hiddenSourceIds", "visible", "showAllDay"]);
  const selectedSourceIds = idList(body.selectedSourceIds);
  const hiddenSourceIds = idList(body.hiddenSourceIds);
  if (typeof body.visible !== "boolean" || typeof body.showAllDay !== "boolean" || hiddenSourceIds.some((id) => !selectedSourceIds.includes(id))) {
    throw new ConnectorError("invalid_request");
  }
  const { calendars } = await listIcloudCalendarsForCaller(caller, options);
  if (selectedSourceIds.some((id) => !calendars.some((calendar) => calendar.id === id))) throw new ConnectorError("invalid_request");
  await saveConnectorPreferences(caller.client, caller.user.id, PROVIDER, { selectedSourceIds, hiddenSourceIds, visible: body.visible, showAllDay: body.showAllDay });
  return getIcloudCalendarConnection(caller);
}

export type IcloudEventsOptions = IcloudServiceOptions & Readonly<{
  authorizedCalendarIds?: readonly string[];
  expectedConnectionGeneration?: number;
  expectedSelectionRevision?: number;
}>;
export type IcloudCalendarRead = Readonly<{ connection: ConnectorConnection; result: IcloudCalendarReadResult }>;

/**
 * Reads today through at most today + 30 in the profile timezone for the saved
 * selection, under one absolute deadline across credential opening, discovery,
 * listing, every selected calendar, every retry, every body, and the final credential fence.
 */
export async function getIcloudCalendarEventsForCaller(caller: ConnectorCaller, start: string, end: string, options: IcloudEventsOptions = {}): Promise<IcloudCalendarRead> {
  return boundedRead(options, (bounded, deadlineAt) => readEventsForCaller(caller, start, end, { ...options, signal: bounded.signal }, deadlineAt));
}

async function readEventsForCaller(caller: ConnectorCaller, start: string, end: string, options: IcloudEventsOptions, deadlineAt: number): Promise<IcloudCalendarRead> {
  const clock = options.clock ?? Date.now;
  const query = caller.client.from("profiles").select("timezone").eq("id", caller.user.id);
  const { data: profile, error } = await (options.signal && query.abortSignal ? query.abortSignal(options.signal) : query).single();
  assertReadActive(options, deadlineAt);
  if (error || !profile) throw new ConnectorError("provider_unavailable");
  let first: Temporal.PlainDate; let last: Temporal.PlainDate;
  try { first = Temporal.PlainDate.from(start); last = Temporal.PlainDate.from(end); }
  catch { throw new ConnectorError("invalid_request"); }
  const nowInstant = Temporal.Instant.fromEpochMilliseconds(clock());
  const today = nowInstant.toZonedDateTimeISO(profile.timezone).toPlainDate();
  const span = first.until(last).days;
  if (first.toString() !== start || last.toString() !== end || span < 0 || span > 30 || Temporal.PlainDate.compare(first, today) !== 0) throw new ConnectorError("invalid_request");
  const authorized = options.authorizedCalendarIds === undefined ? null : [...new Set(options.authorizedCalendarIds)];
  if (authorized && (authorized.length > 32 || authorized.some((id) => !id || id.length > 1024))) throw new ConnectorError("invalid_request");

  return withIcloudAccess(caller, options, deadlineAt, async (access, discovered) => {
    const { connection } = access;
    if ((options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) ||
      (options.expectedSelectionRevision !== undefined && options.expectedSelectionRevision !== connection.selectionRevision)) throw new ConnectorError("connection_changed");
    const selectedIds = connection.preferences.selectedSourceIds.filter((id) => authorized === null || authorized.includes(id));
    if (selectedIds.length === 0) throw new ConnectorError("invalid_request");
    const request = requestOptions(access.login, deadlineAt, options);
    const calendars = await listIcloudCalendars(request, discovered);
    // A selected calendar that is no longer listed fails the read; it is never shown as empty.
    const selected = selectedIds.map((id) => {
      const calendar = calendars.find((value) => value.id === id);
      if (!calendar) throw new ConnectorError("provider_unavailable");
      return calendar;
    });
    const result = await readIcloudCalendarEvents({ ...request, accountId: caller.user.id, connectionGeneration: connection.generation, calendars: selected,
      range: { startLocalDate: start, endLocalDate: end, timezone: profile.timezone, selectedCalendarIds: selected.map((calendar) => calendar.id) },
      fetchedAt: nowInstant.toString() });
    if (!result.ok && result.error.code === "reconnect_required") await markConnectorReconnectRequired(connection).catch(() => undefined);
    return { connection, result };
  });
}

/** Route form: a snapshot (complete, or incomplete with recorded reasons) or a stable error code. */
export async function getIcloudCalendarEvents(caller: ConnectorCaller, start: string, end: string, options: IcloudEventsOptions = {}): Promise<ExternalEventSnapshotV1_1> {
  const read = await getIcloudCalendarEventsForCaller(caller, start, end, options);
  if (!read.result.ok) throw new ConnectorError(read.result.error.code);
  return read.result.snapshot;
}

export function disconnectIcloudCalendar(caller: ConnectorCaller): Promise<ConnectorConnectionView & { revocation: ConnectorRevocationInstruction }> {
  return disconnectConnector(caller, PROVIDER);
}
