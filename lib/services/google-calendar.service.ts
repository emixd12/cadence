import { Temporal } from "@js-temporal/polyfill";
import type { User } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { beginCalendarAttempt, consumeCalendarAttempt, installCalendarCredential, readCalendarCallbackUser, readCalendarConnection, readCalendarCredential, removeCalendarCredential, saveCalendarPreferences } from "@/lib/db/google-calendar.repo";
import type { CalendarConnection, CalendarConnectionView, CalendarPreferences } from "@/lib/types/google-calendar";
import { DEFAULT_CALENDAR_PREFERENCES } from "@/lib/types/google-calendar";
import { CalendarConnectionError, calendarGoogleSubject, createCalendarAuthorization, exchangeCalendarCode, hashCalendarState, openCalendarSecret, readCalendarOAuthConfig, refreshCalendarToken, revokeCalendarToken, sealCalendarSecret } from "./google-calendar-oauth";
import { readGoogleCalendarEvents, readGoogleCalendarCalendars, GoogleCalendarProviderError, type GoogleCalendarReadResult } from "./google-calendar-provider";
import { readDailyBriefPreferences } from "@/lib/db/daily-brief.repo";

export type CalendarCaller = { client: AppSupabaseClient; user: User };
function config(requestOrigin?: string) { const value = readCalendarOAuthConfig(process.env, requestOrigin); if (!value) throw new CalendarConnectionError("not_configured"); return value; }
export async function getCalendarConnection(caller: CalendarCaller): Promise<CalendarConnectionView> {
  if (!readCalendarOAuthConfig()) return { accountId: caller.user.id, status: "not_configured", generation: 0, selectionRevision: 0, preferences: DEFAULT_CALENDAR_PREFERENCES };
  const connection = await readCalendarConnection(caller.client, caller.user.id);
  if (connection && connection.googleSubject !== calendarGoogleSubject(caller.user)) throw new CalendarConnectionError("same_account_required");
  return connection ? { accountId: caller.user.id, status: connection.status, generation: connection.generation, selectionRevision: connection.selectionRevision, preferences: connection.preferences }
    : { accountId: caller.user.id, status: "disconnected", generation: 0, selectionRevision: 0, preferences: DEFAULT_CALENDAR_PREFERENCES };
}
export async function startCalendarConnection(caller: CalendarCaller, target: "web" | "desktop", clientState = "", requestOrigin?: string) {
  const settings = config(requestOrigin);
  const googleSubject = calendarGoogleSubject(caller.user);
  if (target === "desktop" && !/^[a-zA-Z0-9_-]{32,128}$/.test(clientState)) throw new CalendarConnectionError("invalid_request");
  const existing = await readCalendarConnection(caller.client, caller.user.id);
  const generation = existing?.generation ?? 0;
  const flow = createCalendarAuthorization(settings, googleSubject);
  const stateHash = hashCalendarState(flow.state);
  await beginCalendarAttempt({ userId: caller.user.id, googleSubject, generation, stateHash, target, clientState,
    sealedVerifier: sealCalendarSecret(settings, flow.verifier, { purpose: "verifier", userId: caller.user.id, googleSubject, generation, stateHash }) });
  return { url: flow.url };
}
export async function finishCalendarConnection(input: { state: string; code: string | null; denied: boolean; cookieUser: User | null; requestOrigin?: string }): Promise<string> {
  const settings = config(input.requestOrigin);
  const fallback = new URL("/settings?calendar=error", settings.callbackUrl).toString();
  if (!/^[a-zA-Z0-9_-]{43}$/.test(input.state)) return fallback;
  const attempt = await consumeCalendarAttempt(hashCalendarState(input.state));
  if (!attempt) return fallback;
  let result = "error";
  try {
    if (attempt.target === "web" && input.cookieUser?.id !== attempt.userId) throw new CalendarConnectionError("unauthenticated");
    const user = await readCalendarCallbackUser(attempt.userId);
    if (calendarGoogleSubject(user) !== attempt.googleSubject) throw new CalendarConnectionError("same_account_required");
    if (input.denied) result = "cancelled";
    else {
      if (!input.code || input.code.length > 8192) throw new CalendarConnectionError("invalid_request");
      const verifier = openCalendarSecret(settings, attempt.sealedVerifier, { ...attempt, purpose: "verifier" });
      const token = await exchangeCalendarCode(settings, input.code, verifier, attempt.googleSubject);
      await installCalendarCredential(attempt, sealCalendarSecret(settings, token.refreshToken, { ...attempt, purpose: "refresh", generation: attempt.generation + 1, stateHash: undefined }));
      result = "connected";
    }
  } catch (error) {
    if (error instanceof CalendarConnectionError && (attempt.target === "web" || error.code === "same_account_required")) result = error.code;
  }
  if (attempt.target === "desktop") return `cadence://calendar/callback?${new URLSearchParams({ state: attempt.clientState, result })}`;
  return new URL(`/settings?calendar=${encodeURIComponent(result)}`, settings.callbackUrl).toString();
}
async function connected(caller: CalendarCaller): Promise<CalendarConnection> {
  config();
  const connection = await readCalendarConnection(caller.client, caller.user.id);
  if (!connection || connection.status !== "connected") throw new CalendarConnectionError("reconnect_required");
  if (connection.googleSubject !== calendarGoogleSubject(caller.user)) throw new CalendarConnectionError("same_account_required");
  return connection;
}
async function accessToken(connection: CalendarConnection): Promise<string> {
  const settings = config();
  try {
    const sealed = await readCalendarCredential(connection);
    const refresh = openCalendarSecret(settings, sealed, { ...connection, purpose: "refresh" });
    return await refreshCalendarToken(settings, refresh);
  } catch (error) {
    if (error instanceof CalendarConnectionError && error.code === "reconnect_required") await removeCalendarCredential(connection, "reconnect_required");
    throw error;
  }
}
async function assertCurrent(caller: CalendarCaller, old: CalendarConnection) {
  const current = await connected(caller);
  if (current.generation !== old.generation || current.selectionRevision !== old.selectionRevision) throw new CalendarConnectionError("connection_changed");
}
async function listCalendarsWithToken(accessToken: string, connection: CalendarConnection, signal?: AbortSignal) {
  try { return await readGoogleCalendarCalendars({ accessToken, signal }); }
  catch (error) {
    if (error instanceof GoogleCalendarProviderError) {
      if (error.failure.code === "reconnect_required") await removeCalendarCredential(connection, "reconnect_required");
      throw new CalendarConnectionError(error.failure.code);
    }
    throw error;
  }
}
export async function listCalendarCalendars(caller: CalendarCaller) {
  const connection = await connected(caller);
  const calendars = await listCalendarsWithToken(await accessToken(connection), connection);
  await assertCurrent(caller, connection);
  return { calendars };
}
export async function updateCalendarPreferences(caller: CalendarCaller, raw: unknown) {
  const connection = await connected(caller);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CalendarConnectionError("invalid_request");
  const value = raw as Record<string, unknown>;
  for (const key of ["selectedCalendarIds", "hiddenCalendarIds"]) {
    const ids = value[key];
    if (!Array.isArray(ids) || ids.length > 32 || ids.some((id) => typeof id !== "string" || !id || id.length > 1024) || new Set(ids).size !== ids.length) throw new CalendarConnectionError("invalid_request");
  }
  if (typeof value.visible !== "boolean" || typeof value.showAllDay !== "boolean") throw new CalendarConnectionError("invalid_request");
  const preferences = value as CalendarPreferences;
  const available = await listCalendarsWithToken(await accessToken(connection), connection);
  if (preferences.selectedCalendarIds.some((id) => !available.some((calendar) => calendar.id === id)) || preferences.hiddenCalendarIds.some((id) => !preferences.selectedCalendarIds.includes(id))) throw new CalendarConnectionError("invalid_request");
  await assertCurrent(caller, connection);
  await saveCalendarPreferences(caller.client, caller.user.id, preferences);
  return getCalendarConnection(caller);
}
const pendingReads = new Map<string, Promise<Awaited<ReturnType<typeof readGoogleCalendarEvents>>>>();
export async function getCalendarEvents(caller: CalendarCaller, start: string, end: string) {
  const read = await getCalendarEventsForAdvisor(caller, start, end);
  if (!read.result.ok) {
    if (read.result.error.code === "reconnect_required") await removeCalendarCredential(read.connection, "reconnect_required");
    throw new CalendarConnectionError(read.result.error.code);
  }
  return read.result.snapshot;
}

export type AdvisorCalendarRead = Readonly<{
  connection: CalendarConnection;
  result: GoogleCalendarReadResult;
}>;

export async function getCalendarEventsForAdvisor(
  caller: CalendarCaller,
  start: string,
  end: string,
  options: Readonly<{
    authorizedCalendarIds?: readonly string[];
    expectedConnectionGeneration?: number;
    expectedSelectionRevision?: number;
    authorizationScope?: string;
    now?: Temporal.Instant;
    signal?: AbortSignal;
  }> = {},
): Promise<AdvisorCalendarRead> {
  return readAuthorizedCalendarRange(caller, start, end, options, false);
}

/** Development-only Retrospective reads. Live authorization never uses the evaluation clock. */
export async function getCalendarEventsForWorkbenchHistory(
  caller: CalendarCaller, start: string, end: string,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<AdvisorCalendarRead> {
  if (process.env.NODE_ENV !== "development") throw new CalendarConnectionError("permission_denied");
  options.signal?.throwIfAborted();
  const preference = await readDailyBriefPreferences(caller.client, options.signal);
  if (!preference.enabled || !preference.includeCalendar) throw new CalendarConnectionError("permission_denied");
  const connection = await getCalendarConnection(caller);
  if (connection.status !== "connected" || connection.generation !== preference.calendarConnectionGeneration || connection.selectionRevision !== preference.calendarSelectionRevision) {
    throw new CalendarConnectionError("connection_changed");
  }
  const result = await readAuthorizedCalendarRange(caller, start, end, {
    authorizedCalendarIds: connection.preferences.selectedCalendarIds,
    expectedConnectionGeneration: connection.generation, expectedSelectionRevision: connection.selectionRevision,
    authorizationScope: `briefing-history:${preference.revision}`, signal: options.signal,
  }, true);
  const current = await readDailyBriefPreferences(caller.client, options.signal);
  options.signal?.throwIfAborted();
  if (JSON.stringify(current) !== JSON.stringify(preference)) throw new CalendarConnectionError("connection_changed");
  return result;
}

async function readAuthorizedCalendarRange(
  caller: CalendarCaller, start: string, end: string,
  options: NonNullable<Parameters<typeof getCalendarEventsForAdvisor>[3]>, historical: boolean,
): Promise<AdvisorCalendarRead> {
  const connection = await connected(caller);
  if (
    (options.expectedConnectionGeneration !== undefined && options.expectedConnectionGeneration !== connection.generation) ||
    (options.expectedSelectionRevision !== undefined && options.expectedSelectionRevision !== connection.selectionRevision)
  ) throw new CalendarConnectionError("connection_changed");
  const { data: profile, error } = await caller.client.from("profiles").select("timezone").eq("id", caller.user.id).single();
  if (error || !profile) throw new CalendarConnectionError("provider_unavailable");
  let first: Temporal.PlainDate; let last: Temporal.PlainDate;
  try { first = Temporal.PlainDate.from(start); last = Temporal.PlainDate.from(end); }
  catch { throw new CalendarConnectionError("invalid_request"); }
  const now = options.now ?? Temporal.Now.instant();
  const today = now.toZonedDateTimeISO(profile.timezone).toPlainDate();
  if (first.toString() !== start || last.toString() !== end || first.until(last).days < 0 || first.until(last).days > 30 ||
      (historical ? Temporal.PlainDate.compare(last, today) >= 0 : Temporal.PlainDate.compare(first, today) !== 0)) throw new CalendarConnectionError("invalid_request");
  const authorizedCalendarIds = options.authorizedCalendarIds === undefined
    ? null
    : [...new Set(options.authorizedCalendarIds)].sort();
  if (authorizedCalendarIds && (authorizedCalendarIds.length > 32 || authorizedCalendarIds.some((id) => !id || id.length > 1024))) {
    throw new CalendarConnectionError("invalid_request");
  }
  if (options.authorizationScope !== undefined && (!options.authorizationScope || options.authorizationScope.length > 512)) {
    throw new CalendarConnectionError("invalid_request");
  }
  const key = JSON.stringify([caller.user.id, connection.generation, connection.selectionRevision, start, end, profile.timezone, authorizedCalendarIds, options.authorizationScope ?? "first_party"]);
  let pending = pendingReads.get(key);
  if (!pending) {
    pending = (async () => {
      const token = await accessToken(connection);
      if (options.signal?.aborted) throw new CalendarConnectionError("timeout");
      const calendars = await listCalendarsWithToken(token, connection, options.signal);
      if (options.signal?.aborted) throw new CalendarConnectionError("timeout");
      const selectedIds = connection.preferences.selectedCalendarIds.filter((id) =>
        authorizedCalendarIds === null || authorizedCalendarIds.includes(id));
      const selected = selectedIds.map((id) => {
        const calendar = calendars.find((value) => value.id === id);
        if (!calendar) throw new CalendarConnectionError("provider_unavailable");
        return calendar;
      });
      return readGoogleCalendarEvents({ accessToken: token, accountId: caller.user.id, connectionGeneration: connection.generation,
        calendars: selected, range: { startLocalDate: start, endLocalDate: end, timezone: profile.timezone, selectedCalendarIds: selected.map((calendar) => calendar.id) }, fetchedAt: now.toString(), signal: options.signal });
    })();
    pendingReads.set(key, pending);
    void pending.finally(() => pendingReads.delete(key)).catch(() => undefined);
  }
  const result = await pending;
  await assertCurrent(caller, connection);
  return { connection, result };
}
export async function disconnectCalendar(caller: CalendarCaller) {
  const connection = await readCalendarConnection(caller.client, caller.user.id);
  let revocationFailed = false;
  if (connection) {
    if (connection.googleSubject !== calendarGoogleSubject(caller.user)) throw new CalendarConnectionError("same_account_required");
    const sealed = await removeCalendarCredential(connection, "disconnected");
    if (sealed) {
      try { await revokeCalendarToken(openCalendarSecret(config(), sealed, { ...connection, purpose: "refresh" })); }
      catch { revocationFailed = true; }
    }
  }
  return { ...await getCalendarConnection(caller), revocationFailed };
}

// Capture only the revocation work; failed Auth deletion must leave the connection intact.
export async function prepareCalendarRevocation(caller: CalendarCaller): Promise<(() => Promise<void>) | null> {
  const settings = readCalendarOAuthConfig();
  if (!settings) return null;
  const connection = await readCalendarConnection(caller.client, caller.user.id);
  if (!connection) return null;
  if (connection.googleSubject !== calendarGoogleSubject(caller.user)) throw new CalendarConnectionError("same_account_required");
  const sealed = await readCalendarCredential(connection);
  return () => revokeCalendarToken(openCalendarSecret(settings, sealed, { ...connection, purpose: "refresh" }));
}
