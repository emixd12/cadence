import { createHash, timingSafeEqual } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { User } from "@supabase/supabase-js";
import { saveConnectorPreferences } from "@/lib/db/connectors.repo";
import {
  ConnectorError,
  DEFAULT_CONNECTOR_PREFERENCES,
  type ConnectorConnection,
  type ConnectorConnectionView,
  type ConnectorOAuthAttempt,
  type ConnectorRevocationInstruction,
} from "@/lib/types/connectors";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import {
  beginConnectorOAuthAttempt,
  completeConnectorOAuthAttempt,
  consumeConnectorOAuthAttempt,
  disconnectConnector,
  getConnectorConnection,
  markConnectorReconnectRequired,
  readConnectorCredentialConfig,
  rotateConnectorCredential,
  withConnectorCredential,
  type ConnectorCaller,
} from "./connector-credentials";
import {
  createOutlookAuthorizationUrl,
  createOutlookState,
  createOutlookVerifier,
  exchangeOutlookCode,
  outlookConsentFailure,
  parseOutlookState,
  readOutlookCalendarOAuthConfig,
  refreshOutlookToken,
  type OutlookConsentResult,
  type OutlookFetch,
  type OutlookOAuthConfig,
} from "./outlook-calendar-oauth";
import {
  OUTLOOK_READ_DEADLINE_MS,
  OutlookCalendarProviderError,
  listOutlookCalendars,
  readOutlookCalendarEvents,
  type OutlookCalendar,
  type OutlookCalendarReadResult,
  type OutlookGraphFetch,
} from "./outlook-calendar-provider";

// Ticket 224 Outlook Calendar broker for web and linked desktop. Lifecycle,
// sealing, generation fencing, and disconnect come from Ticket 222
// (connector-credentials.ts). Microsoft linking never uses or changes Cadence's
// Google sign-in. Disconnect deletes Cadence's sealed refresh token only;
// Microsoft documents no app-side revocation for these delegated scopes, so the
// response names the user's removal step instead of claiming revocation.
const PROVIDER = "outlook_calendar" as const;
const CLIENT_STATE = /^[a-zA-Z0-9_-]{32,128}$/;

/** Test seams only; production uses global fetch and the system clock. */
export type OutlookServiceOptions = Readonly<{ fetch?: OutlookFetch & OutlookGraphFetch; clock?: () => number; signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void> }>;

function config(requestOrigin?: string): OutlookOAuthConfig {
  const settings = readOutlookCalendarOAuthConfig(process.env, requestOrigin);
  if (!settings || !readConnectorCredentialConfig()) throw new ConnectorError("not_configured");
  return settings;
}

export async function getOutlookCalendarConnection(caller: ConnectorCaller): Promise<ConnectorConnectionView> {
  const view = await getConnectorConnection(caller, PROVIDER);
  if (readOutlookCalendarOAuthConfig()) return view;
  return { accountId: caller.user.id, provider: PROVIDER, status: "not_configured", generation: view.generation, selectionRevision: 0, preferences: DEFAULT_CONNECTOR_PREFERENCES };
}

function exactKeys(value: unknown, allowed: readonly (readonly string[])[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorError("invalid_request");
  const keys = Object.keys(value).sort().join(",");
  if (!allowed.some((set) => [...set].sort().join(",") === keys)) throw new ConnectorError("invalid_request");
  return value as Record<string, unknown>;
}

/**
 * Starts consent. Web attempts carry no client state. Desktop attempts carry the
 * opaque Keychain-held client state that completion must present again.
 */
export async function startOutlookCalendarConnection(caller: ConnectorCaller, raw: unknown, requestOrigin?: string): Promise<{ url: string }> {
  const body = exactKeys(raw, [["target"], ["target", "clientState"]]);
  if (body.target !== "web" && body.target !== "desktop") throw new ConnectorError("invalid_request");
  const clientState = body.clientState ?? "";
  if (typeof clientState !== "string" || (body.target === "desktop" ? !CLIENT_STATE.test(clientState) : clientState !== "")) throw new ConnectorError("invalid_request");
  // Web consent must return to the initiating host so its session cookie is present.
  const settings = config(body.target === "web" ? requestOrigin : undefined);
  const state = createOutlookState(body.target);
  const verifier = createOutlookVerifier();
  await beginConnectorOAuthAttempt(caller, { provider: PROVIDER, state, verifier, target: body.target, clientState });
  return { url: createOutlookAuthorizationUrl(settings, state, verifier) };
}

async function install(settings: OutlookOAuthConfig, attempt: ConnectorOAuthAttempt, verifier: string, code: string | null, options: OutlookServiceOptions): Promise<void> {
  if (!code) throw new ConnectorError("invalid_request");
  const tokens = await exchangeOutlookCode(settings, code, verifier, { fetch: options.fetch, signal: AbortSignal.timeout(15_000),
    nowSeconds: Math.floor((options.clock ?? Date.now)() / 1000) });
  // The RPC requires the live attempt hash and generation, and raises wrong_account
  // when a different tid/sub is still bound (reconnect_required keeps the binding).
  await completeConnectorOAuthAttempt(attempt, [tokens.identity.tenantId, tokens.identity.subject], { provider: PROVIDER, refreshToken: tokens.refreshToken });
}

export type OutlookCallbackResult = "connected" | OutlookConsentResult | "error" | ConnectorError["code"];
function resultFor(error: unknown): OutlookCallbackResult {
  return error instanceof ConnectorError ? error.code : "error";
}

/**
 * Microsoft redirect handler. A web attempt is consumed once and installed only
 * when the current Cadence cookie user equals the attempt owner. A desktop
 * attempt is not consumed here: the code and state go to the app, which must
 * complete through its authenticated session and Keychain client state.
 */
export async function finishOutlookCalendarCallback(input: { state: string; code: string | null; error: string | null;
  errorDescription: string | null; cookieUser: User | null; requestOrigin?: string }, options: OutlookServiceOptions = {}): Promise<string> {
  const settings = config(input.requestOrigin);
  const settingsUrl = (result: OutlookCallbackResult) => new URL(`/settings?outlook_calendar=${encodeURIComponent(result)}`, settings.callbackUrl).toString();
  const target = parseOutlookState(input.state);
  if (!target) return settingsUrl("error");
  if (target === "desktop") {
    const params = new URLSearchParams({ state: input.state });
    if (input.error !== null) params.set("result", outlookConsentFailure(input.error, input.errorDescription));
    else if (!input.code || input.code.length > 8192) params.set("result", "error");
    else params.set("code", input.code);
    return `cadence://outlook-calendar/callback?${params}`;
  }
  let consumed: Awaited<ReturnType<typeof consumeConnectorOAuthAttempt>>;
  try { consumed = await consumeConnectorOAuthAttempt(PROVIDER, input.state); }
  catch (error) { return settingsUrl(resultFor(error)); }
  if (!consumed) return settingsUrl("expired_attempt");
  try {
    if (consumed.attempt.target !== "web") throw new ConnectorError("expired_attempt");
    if (!input.cookieUser || input.cookieUser.id !== consumed.attempt.userId) throw new ConnectorError("unauthenticated");
    if (input.error !== null) return settingsUrl(outlookConsentFailure(input.error, input.errorDescription));
    await install(settings, consumed.attempt, consumed.verifier, input.code, options);
    return settingsUrl("connected");
  } catch (error) { return settingsUrl(resultFor(error)); }
}

function sameClientState(expected: string, presented: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(presented).digest();
  return timingSafeEqual(left, right) && expected.length > 0;
}

/**
 * Desktop completion. The caller is the desktop's authenticated Cadence session.
 * The attempt must be a desktop attempt owned by that caller and carrying the
 * same Keychain client state; OAuth state alone never binds a Microsoft account.
 */
export async function completeOutlookCalendarDesktopConnection(caller: ConnectorCaller, raw: unknown, options: OutlookServiceOptions = {}):
  Promise<ConnectorConnectionView & { result: OutlookCallbackResult }> {
  const body = exactKeys(raw, [["state", "clientState", "code"], ["state", "clientState", "result"]]);
  if (parseOutlookState(body.state) !== "desktop" || typeof body.clientState !== "string" || !CLIENT_STATE.test(body.clientState)) throw new ConnectorError("invalid_request");
  if ("code" in body && (typeof body.code !== "string" || !body.code || body.code.length > 8192)) throw new ConnectorError("invalid_request");
  if ("result" in body && body.result !== "cancelled" && body.result !== "admin_approval_required" && body.result !== "error") throw new ConnectorError("invalid_request");
  const settings = config();
  const consumed = await consumeConnectorOAuthAttempt(PROVIDER, body.state as string);
  if (!consumed || consumed.attempt.target !== "desktop" || consumed.attempt.userId !== caller.user.id ||
    !sameClientState(consumed.attempt.clientState, body.clientState)) throw new ConnectorError("expired_attempt");
  if ("result" in body) return { ...await getOutlookCalendarConnection(caller), result: body.result as OutlookCallbackResult };
  await install(settings, consumed.attempt, consumed.verifier, body.code as string, options);
  return { ...await getOutlookCalendarConnection(caller), result: "connected" };
}

/** Runs `read` with a fresh access token inside the generation fence, rotating any replacement refresh token first. */
async function withOutlookAccess<T>(caller: ConnectorCaller, deadlineAt: number, options: OutlookServiceOptions,
  read: (accessToken: string, connection: ConnectorConnection) => Promise<T>): Promise<T> {
  const settings = config();
  const clock = options.clock ?? Date.now;
  return withConnectorCredential(caller, PROVIDER, async (credential, connection) => {
    if (credential.provider !== PROVIDER) throw new ConnectorError("reconnect_required");
    const remaining = deadlineAt - clock();
    if (remaining <= 0) throw new ConnectorError("timeout");
    let tokens: Awaited<ReturnType<typeof refreshOutlookToken>>;
    try {
      tokens = await refreshOutlookToken(settings, credential.refreshToken, { fetch: options.fetch,
        signal: AbortSignal.any([AbortSignal.timeout(Math.min(10_000, remaining)), ...(options.signal ? [options.signal] : [])]) });
    } catch (error) {
      if (error instanceof ConnectorError && (error.code === "reconnect_required" || error.code === "consent_denied")) {
        await markConnectorReconnectRequired(connection).catch(() => undefined);
        throw new ConnectorError("reconnect_required");
      }
      throw error;
    }
    // A refresh that completes after the absolute deadline is discarded before use or rotation.
    if (clock() >= deadlineAt) throw new ConnectorError("timeout");
    if (tokens.refreshToken && tokens.refreshToken !== credential.refreshToken) {
      await rotateConnectorCredential(connection, { provider: PROVIDER, refreshToken: tokens.refreshToken });
    }
    return read(tokens.accessToken, connection);
  });
}

async function providerCall<T>(connection: ConnectorConnection, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (!(error instanceof OutlookCalendarProviderError)) throw error;
    if (error.failure.code === "reconnect_required") await markConnectorReconnectRequired(connection).catch(() => undefined);
    throw new ConnectorError(error.failure.code);
  }
}

function graphOptions(accessToken: string, deadlineAt: number, options: OutlookServiceOptions) {
  return { accessToken, deadlineAt, now: options.clock, fetch: options.fetch, signal: options.signal, sleep: options.sleep };
}

export async function listOutlookCalendarsForCaller(caller: ConnectorCaller, options: OutlookServiceOptions = {}): Promise<{ calendars: OutlookCalendar[] }> {
  const deadlineAt = (options.clock ?? Date.now)() + OUTLOOK_READ_DEADLINE_MS;
  return withOutlookAccess(caller, deadlineAt, options, async (accessToken, connection) =>
    ({ calendars: await providerCall(connection, () => listOutlookCalendars(graphOptions(accessToken, deadlineAt, options))) }));
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some((id) => typeof id !== "string" || !id || id.length > 1024) || new Set(value).size !== value.length) {
    throw new ConnectorError("invalid_request");
  }
  return value as string[];
}

/** Saves the selection only when every selected calendar is currently readable. */
export async function updateOutlookCalendarPreferences(caller: ConnectorCaller, raw: unknown, options: OutlookServiceOptions = {}): Promise<ConnectorConnectionView> {
  const body = exactKeys(raw, [["selectedSourceIds", "hiddenSourceIds", "visible", "showAllDay"]]);
  const selectedSourceIds = idList(body.selectedSourceIds);
  const hiddenSourceIds = idList(body.hiddenSourceIds);
  if (typeof body.visible !== "boolean" || typeof body.showAllDay !== "boolean" || hiddenSourceIds.some((id) => !selectedSourceIds.includes(id))) {
    throw new ConnectorError("invalid_request");
  }
  const { calendars } = await listOutlookCalendarsForCaller(caller, options);
  if (selectedSourceIds.some((id) => !calendars.some((calendar) => calendar.id === id))) throw new ConnectorError("invalid_request");
  await saveConnectorPreferences(caller.client, caller.user.id, PROVIDER, { selectedSourceIds, hiddenSourceIds, visible: body.visible, showAllDay: body.showAllDay });
  return getOutlookCalendarConnection(caller);
}

export type OutlookEventsOptions = OutlookServiceOptions & Readonly<{
  /** Daily Brief passes its smaller remaining budget; interactive reads use 25 s. */
  deadlineMs?: number;
  authorizedCalendarIds?: readonly string[];
  expectedConnectionGeneration?: number;
  expectedSelectionRevision?: number;
}>;
export type OutlookCalendarRead = Readonly<{ connection: ConnectorConnection; result: OutlookCalendarReadResult }>;

/**
 * Reads today through at most today + 30 in the profile timezone for the saved
 * selection, under one absolute deadline across token refresh, calendar
 * listing, every selected calendar, every page, and every retry.
 */
export async function getOutlookCalendarEventsForCaller(caller: ConnectorCaller, start: string, end: string, options: OutlookEventsOptions = {}): Promise<OutlookCalendarRead> {
  const clock = options.clock ?? Date.now;
  if (options.deadlineMs !== undefined && (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0)) throw new ConnectorError("timeout");
  const deadlineAt = clock() + Math.min(OUTLOOK_READ_DEADLINE_MS, options.deadlineMs ?? OUTLOOK_READ_DEADLINE_MS);
  const { data: profile, error } = await caller.client.from("profiles").select("timezone").eq("id", caller.user.id).single();
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

  return withOutlookAccess(caller, deadlineAt, options, async (accessToken, connection) => {
    if ((options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) ||
      (options.expectedSelectionRevision !== undefined && options.expectedSelectionRevision !== connection.selectionRevision)) throw new ConnectorError("connection_changed");
    const selectedIds = connection.preferences.selectedSourceIds.filter((id) => authorized === null || authorized.includes(id));
    if (selectedIds.length === 0) throw new ConnectorError("invalid_request");
    const graph = graphOptions(accessToken, deadlineAt, options);
    const calendars = await providerCall(connection, () => listOutlookCalendars(graph));
    const selected = selectedIds.map((id) => {
      const calendar = calendars.find((value) => value.id === id);
      if (!calendar) throw new ConnectorError("provider_unavailable");
      return calendar;
    });
    const result = await readOutlookCalendarEvents({ ...graph, accountId: caller.user.id, connectionGeneration: connection.generation, calendars: selected,
      range: { startLocalDate: start, endLocalDate: end, timezone: profile.timezone, selectedCalendarIds: selected.map((calendar) => calendar.id) },
      fetchedAt: nowInstant.toString() });
    if (!result.ok && result.error.code === "reconnect_required") await markConnectorReconnectRequired(connection).catch(() => undefined);
    return { connection, result };
  });
}

/** Route form: a snapshot (complete, or incomplete with recorded quarantine reasons) or a stable error code. */
export async function getOutlookCalendarEvents(caller: ConnectorCaller, start: string, end: string, options: OutlookEventsOptions = {}): Promise<ExternalEventSnapshotV1_1> {
  const read = await getOutlookCalendarEventsForCaller(caller, start, end, options);
  if (!read.result.ok) throw new ConnectorError(read.result.error.code);
  return read.result.snapshot;
}

export async function disconnectOutlookCalendar(caller: ConnectorCaller): Promise<ConnectorConnectionView & { revocation: ConnectorRevocationInstruction }> {
  return disconnectConnector(caller, PROVIDER);
}
