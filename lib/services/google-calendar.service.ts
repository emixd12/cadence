import { Temporal } from "@js-temporal/polyfill";
import type { User } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { beginCalendarAttempt, consumeCalendarAttempt, installCalendarCredential, readCalendarCallbackUser, readCalendarConnection, readCalendarCredential, removeCalendarCredential, saveCalendarPreferences } from "@/lib/db/google-calendar.repo";
import type { CalendarConnection, CalendarConnectionView, CalendarGoogleSignIn, CalendarListEntry, CalendarPreferences, CalendarPurpose } from "@/lib/types/google-calendar";
import { CALENDAR_AFTER_GOOGLE_SIGN_IN, DEFAULT_CALENDAR_PREFERENCES, GOOGLE_CALENDAR_AI_MCP_PURPOSE_PARAM, GOOGLE_CALENDAR_SETTINGS_PATH } from "@/lib/types/google-calendar";
import { REAUTH_REQUIRED_ERROR, signInLinkingEnabled } from "@/lib/auth/account-sign-in-methods";
import { buildLoginPath } from "@/lib/auth/redirects";
import { endSessionForRecentSignIn, startAddSignInMethod } from "@/lib/services/sign-in-methods.service";
import {
  CalendarConnectionError,
  GOOGLE_CALENDAR_AI_MCP_STATE_PREFIX,
  GOOGLE_CALENDAR_RETIRED_AGENT_STATE_PREFIX,
  calendarGoogleSubject,
  googleSignInSubjects,
  type CalendarIdentityUser,
  createCalendarAuthorization,
  exchangeCalendarCode,
  hashCalendarState,
  openCalendarSecret,
  readCalendarOAuthConfig,
  refreshCalendarToken,
  revokeCalendarToken,
  sealCalendarSecret,
} from "./google-calendar-oauth";
import { readGoogleCalendarEvents, readGoogleCalendarCalendars, GoogleCalendarProviderError, type GoogleCalendarReadResult } from "./google-calendar-provider";
import {
  GoogleCalendarMcpProviderError,
  listGoogleCalendarMcpCalendars,
  readGoogleCalendarMcpEvents,
} from "./google-calendar-mcp-provider";
import {
  consumeGoogleCalendarMcpBudget,
  getCachedGoogleCalendarMcpCalendars,
  getCachedGoogleCalendarMcpSnapshot,
  invalidateGoogleCalendarMcpCache,
  setCachedGoogleCalendarMcpCalendars,
  setCachedGoogleCalendarMcpSnapshot,
} from "./google-calendar-mcp-cache";
import { isGoogleCalendarAiTransportEnabled } from "./google-calendar-ai-transport";
import { screenSnapshotWithModelArmor } from "./model-armor.service";
import { readDailyBriefPreferences } from "@/lib/db/daily-brief.repo";
import { dailyBriefReadsGoogleCalendar, dailyBriefSourceAllowed } from "@cadence/core/services/daily-brief-sources";
import {
  EXTERNAL_EVENT_ADAPTER_VERSION,
  EXTERNAL_EVENT_SCHEMA_VERSION,
  type ExternalEventSnapshotV1,
} from "@cadence/core/types/external-event";
import {
  backfillCalendarLoadAfterSelection,
  clearCalendarLoadForSource,
  persistCalendarLoadFromSnapshot,
} from "./daily-calendar-load.service";

/** `via: "bearer"` marks the Mac's token requests; the web sends its session cookie. */
export type CalendarCaller = { client: AppSupabaseClient; user: User; via?: "cookie" | "bearer" };
/** Calendar reads need only the account id and its Google identity, so the leave reminder job's caller (Ticket 276) fits. */
export type CalendarReadCaller = { client: AppSupabaseClient; user: CalendarIdentityUser };
function config(requestOrigin?: string, grantPurpose: CalendarPurpose = "standard") { const value = readCalendarOAuthConfig(process.env, requestOrigin, grantPurpose); if (!value) throw new CalendarConnectionError("not_configured"); return value; }
/**
 * Ticket 335 (D31.5): what Connect does for an account without exactly one Google sign-in.
 * `undefined` for the one-Google-sign-in account, which connects as before.
 */
export function calendarGoogleSignIn(caller: CalendarReadCaller & { via?: CalendarCaller["via"] }): CalendarGoogleSignIn | undefined {
  const count = googleSignInSubjects(caller.user).length;
  if (count === 1) return undefined;
  if (count > 1) return "multiple";
  if (!signInLinkingEnabled()) return "unavailable";
  return caller.via === "bearer" ? "add_on_web" : "add";
}
export async function getCalendarConnection(caller: CalendarReadCaller & { via?: CalendarCaller["via"] }, grantPurpose: CalendarPurpose = "standard"): Promise<CalendarConnectionView> {
  const settings = readCalendarOAuthConfig(process.env, undefined, grantPurpose);
  if (!settings) return { accountId: caller.user.id, status: "not_configured", generation: 0, selectionRevision: 0, preferences: DEFAULT_CALENDAR_PREFERENCES };
  const connection = await readCalendarConnection(caller.client, caller.user.id, grantPurpose);
  // A row without a credential keeps its first Google subject until the next connect moves it
  // (calendar_begin_attempt). A connected row must use one of the account's Google sign-ins.
  if (connection?.status === "connected" && !googleSignInSubjects(caller.user).includes(connection.googleSubject)) throw new CalendarConnectionError("same_account_required");
  const googleSignIn = calendarGoogleSignIn(caller);
  const hint = googleSignIn ? { googleSignIn } : {};
  return connection ? { accountId: caller.user.id, status: connection.status === "connected" && grantPurpose === "agent" && connection.oauthClientId !== settings.clientId ? "reconnect_required" : connection.status, generation: connection.generation, selectionRevision: connection.selectionRevision, preferences: connection.preferences, ...hint }
    : { accountId: caller.user.id, status: "disconnected", generation: 0, selectionRevision: 0, preferences: DEFAULT_CALENDAR_PREFERENCES, ...hint };
}
/**
 * Ticket 335 (D31.5): an account with no Google sign-in adds one first, through Ticket 334's
 * linking. The return lands on Settings with `calendar=link`, and the Calendar panel then
 * starts the Calendar consent for that same Google account. Calendar keeps its own OAuth:
 * the link callback does not keep Google's tokens.
 */
async function addGoogleSignInFirst(origin: URL, grantPurpose: CalendarPurpose = "standard"): Promise<{ url: string }> {
  const [path, hash] = GOOGLE_CALENDAR_SETTINGS_PATH.split("#");
  const purposeQuery = grantPurpose === "agent" ? `&purpose=${GOOGLE_CALENDAR_AI_MCP_PURPOSE_PARAM}` : "";
  const outcome = await startAddSignInMethod({ origin, methodId: "google", returnPath: `${path}?calendar=${CALENDAR_AFTER_GOOGLE_SIGN_IN}${purposeQuery}#${hash}` });
  if (outcome.kind === "redirect") return { url: outcome.url };
  if (outcome.result === "reauth_required") {
    await endSessionForRecentSignIn();
    return { url: buildLoginPath(GOOGLE_CALENDAR_SETTINGS_PATH, REAUTH_REQUIRED_ERROR) };
  }
  throw new CalendarConnectionError("provider_unavailable");
}
export async function startCalendarConnection(caller: CalendarCaller, target: "web" | "desktop", clientState = "", requestOrigin?: string, grantPurpose: CalendarPurpose = "standard") {
  if (grantPurpose === "agent" && !isGoogleCalendarAiTransportEnabled()) throw new CalendarConnectionError("not_configured");
  const settings = config(requestOrigin, grantPurpose);
  if (target === "web" && requestOrigin && calendarGoogleSignIn(caller) === "add") return addGoogleSignInFirst(new URL(requestOrigin), grantPurpose);
  const googleSubject = calendarGoogleSubject(caller.user);
  if (target === "desktop" && !/^[a-zA-Z0-9_-]{32,128}$/.test(clientState)) throw new CalendarConnectionError("invalid_request");
  const existing = await readCalendarConnection(caller.client, caller.user.id, grantPurpose);
  const generation = existing?.generation ?? 0;
  const flow = createCalendarAuthorization(settings, googleSubject);
  const stateHash = hashCalendarState(flow.state);
  await beginCalendarAttempt({
    ...(grantPurpose === "agent" ? { grantPurpose, oauthClientId: settings.clientId } : {}),
    userId: caller.user.id, googleSubject, generation, stateHash, target, clientState,
    sealedVerifier: sealCalendarSecret(settings, flow.verifier, { purpose: "verifier", userId: caller.user.id, googleSubject, generation, stateHash }),
  });
  return { url: flow.url };
}
export async function finishCalendarConnection(input: { state: string; code: string | null; denied: boolean; cookieUser: User | null; requestOrigin?: string }): Promise<string> {
  // Ticket 307: a late callback for the retired Daily Brief grant ("a_" state) installs nothing.
  if (input.state.length === 45 && input.state.startsWith(GOOGLE_CALENDAR_RETIRED_AGENT_STATE_PREFIX)) {
    const standardSettings = readCalendarOAuthConfig(process.env, input.requestOrigin, "standard");
    const base = standardSettings?.callbackUrl ?? input.requestOrigin ?? "https://cadence.app";
    return new URL("/settings?agentCalendar=error", base).toString();
  }
  const isAgentMcp = input.state.length === 45 && input.state.startsWith(GOOGLE_CALENDAR_AI_MCP_STATE_PREFIX);
  const grantPurpose: CalendarPurpose = isAgentMcp ? "agent" : "standard";
  const settings = config(input.requestOrigin, grantPurpose);
  const queryKey = isAgentMcp ? "aiCalendar" : "calendar";
  const fallback = new URL(`/settings?${queryKey}=error`, settings.callbackUrl).toString();
  const validState = isAgentMcp
    ? /^m_[a-zA-Z0-9_-]{43}$/.test(input.state)
    : /^[a-zA-Z0-9_-]{43}$/.test(input.state);
  if (!validState) return fallback;
  const attempt = await consumeCalendarAttempt(hashCalendarState(input.state), grantPurpose);
  if (!attempt) return fallback;
  let result = "error";
  let hiddenCalendarsSkipped = 0;
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
      if (isAgentMcp) {
        invalidateGoogleCalendarMcpCache(attempt.userId);
        // Q6 First-connect seeding: copy Timeline's selected calendars that MCP returns.
        hiddenCalendarsSkipped = await seedAiSelectionFromTimeline(attempt.userId, token.accessToken).catch(() => 0);
      }
      result = "connected";
    }
  } catch (error) {
    if (error instanceof CalendarConnectionError && (attempt.target === "web" || error.code === "same_account_required")) result = error.code;
  }
  if (attempt.target === "desktop") {
    const params = new URLSearchParams({ state: attempt.clientState, result });
    if (isAgentMcp) params.set("purpose", GOOGLE_CALENDAR_AI_MCP_PURPOSE_PARAM);
    return `cadence://calendar/callback?${params}`;
  }
  const redirect = new URL(`/settings?${queryKey}=${encodeURIComponent(result)}`, settings.callbackUrl);
  if (isAgentMcp && result === "connected" && hiddenCalendarsSkipped > 0) {
    redirect.searchParams.set("aiCalendarSkipped", String(hiddenCalendarsSkipped));
  }
  return redirect.toString();
}

/**
 * Q6 First-connect seeding: when AI MCP connects and Timeline already has selected calendars,
 * copy the calendars that MCP returns into AI's initial selection and return how many
 * Timeline calendars were hidden/unavailable in MCP.
 */
async function seedAiSelectionFromTimeline(userId: string, mcpAccessToken: string): Promise<number> {
  const { createServiceRoleClient } = await import("@/lib/supabase/admin");
  const admin = createServiceRoleClient();
  const [standard, agent] = await Promise.all([
    readCalendarConnection(admin, userId, "standard"),
    readCalendarConnection(admin, userId, "agent"),
  ]);
  if (!standard || standard.status !== "connected" || standard.preferences.selectedCalendarIds.length === 0) return 0;
  if (!agent || agent.status !== "connected" || agent.preferences.selectedCalendarIds.length > 0) return 0;
  const mcpCalendars = await listGoogleCalendarMcpCalendars({ accessToken: mcpAccessToken });
  const mcpIds = new Set(mcpCalendars.map((calendar) => calendar.id));
  const copied = standard.preferences.selectedCalendarIds.filter((id) => mcpIds.has(id));
  const skipped = standard.preferences.selectedCalendarIds.length - copied.length;
  if (copied.length > 0) {
    await saveCalendarPreferences(admin, userId, {
      selectedCalendarIds: copied,
      hiddenCalendarIds: [],
      visible: true,
      showAllDay: true,
    }, "agent");
  }
  return skipped;
}

/**
 * Q6 One-click Sync to AI: copies Timeline's currently selected calendars (that MCP returns)
 * onto the AI grant and invalidates MCP cache.
 */
export async function syncTimelineSelectionToAiCalendar(caller: CalendarCaller): Promise<CalendarConnectionView> {
  if (!isGoogleCalendarAiTransportEnabled()) throw new CalendarConnectionError("not_configured");
  const [standard, agent] = await Promise.all([
    connected(caller, "standard"),
    connected(caller, "agent"),
  ]);
  const mcpCalendars = await listMcpCalendarsForConnection(caller, agent);
  const mcpIds = new Set(mcpCalendars.map((calendar) => calendar.id));
  const copied = standard.preferences.selectedCalendarIds.filter((id) => mcpIds.has(id));
  const hiddenCalendarsSkipped = standard.preferences.selectedCalendarIds.length - copied.length;
  await assertCurrent(caller, agent);
  await saveCalendarPreferences(caller.client, caller.user.id, {
    ...agent.preferences,
    selectedCalendarIds: copied,
    hiddenCalendarIds: [],
  }, "agent");
  invalidateGoogleCalendarMcpCache(caller.user.id);
  await clearCalendarLoadForSource(caller.client, caller.user.id, "google_calendar");
  const view = await getCalendarConnection(caller, "agent");
  return hiddenCalendarsSkipped > 0
    ? {
        ...view,
        hiddenCalendarsSkipped,
        seedNotice: `${hiddenCalendarsSkipped} hidden Timeline calendar${hiddenCalendarsSkipped === 1 ? "" : "s"} could not be copied to AI.`,
      }
    : view;
}
async function connected(caller: CalendarReadCaller, grantPurpose: CalendarPurpose = "standard"): Promise<CalendarConnection> {
  const settings = config(undefined, grantPurpose);
  const connection = await readCalendarConnection(caller.client, caller.user.id, grantPurpose);
  if (!connection || connection.status !== "connected" || (grantPurpose === "agent" && connection.oauthClientId !== settings.clientId)) throw new CalendarConnectionError("reconnect_required");
  if (connection.googleSubject !== calendarGoogleSubject(caller.user)) throw new CalendarConnectionError("same_account_required");
  return connection;
}
async function accessToken(connection: CalendarConnection): Promise<string> {
  const settings = config(undefined, connection.grantPurpose);
  try {
    const sealed = await readCalendarCredential(connection);
    const refresh = openCalendarSecret(settings, sealed, { ...connection, purpose: "refresh" });
    return await refreshCalendarToken(settings, refresh);
  } catch (error) {
    if (error instanceof CalendarConnectionError && error.code === "reconnect_required") await removeCalendarCredential(connection, "reconnect_required");
    throw error;
  }
}
async function assertCurrent(caller: CalendarReadCaller, old: CalendarConnection) {
  const current = await connected(caller, old.grantPurpose);
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
function mapMcpErrorToCalendarConnectionError(error: GoogleCalendarMcpProviderError): CalendarConnectionError {
  // NEVER delete stored credentials on MCP 401 (`mcp_unauthorized`) or any MCP tool error.
  // Only token-endpoint `invalid_grant` (in `accessToken`) deletes stored credentials.
  switch (error.failure.mcpErrorCode) {
    case "permission_denied":
      return new CalendarConnectionError("permission_denied");
    case "rate_limited":
    case "budget_exceeded":
      return new CalendarConnectionError("rate_limited");
    case "timeout":
      return new CalendarConnectionError("timeout");
    case "malformed_provider_response":
      return new CalendarConnectionError("malformed_provider_response");
    case "incomplete_pagination":
      return new CalendarConnectionError("incomplete_pagination");
    case "invalid_request":
      return new CalendarConnectionError("invalid_request");
    case "mcp_unauthorized":
    case "mcp_tool_error":
    case "provider_unavailable":
    default:
      return new CalendarConnectionError("provider_unavailable");
  }
}

async function listMcpCalendarsForConnection(
  caller: CalendarReadCaller,
  connection: CalendarConnection,
  token?: string,
  signal?: AbortSignal,
): Promise<CalendarListEntry[]> {
  const cacheKey = {
    userId: caller.user.id,
    grantGeneration: connection.generation,
    selectionRevision: connection.selectionRevision,
  };
  const cached = getCachedGoogleCalendarMcpCalendars(cacheKey);
  if (cached) return cached;
  const budget = consumeGoogleCalendarMcpBudget(caller.user.id, 1);
  if (!budget.allowed) throw new CalendarConnectionError("rate_limited");
  const access = token ?? await accessToken(connection);
  try {
    const calendars = await listGoogleCalendarMcpCalendars({ accessToken: access, signal });
    setCachedGoogleCalendarMcpCalendars(cacheKey, calendars);
    return calendars;
  } catch (error) {
    if (error instanceof GoogleCalendarMcpProviderError) {
      throw mapMcpErrorToCalendarConnectionError(error);
    }
    throw error;
  }
}

export async function listCalendarCalendars(caller: CalendarCaller, grantPurpose: CalendarPurpose = "standard") {
  if (grantPurpose === "agent") {
    if (!isGoogleCalendarAiTransportEnabled()) throw new CalendarConnectionError("not_configured");
    const connection = await connected(caller, "agent");
    const calendars = await listMcpCalendarsForConnection(caller, connection);
    await assertCurrent(caller, connection);
    return { calendars };
  }
  const connection = await connected(caller, grantPurpose);
  const calendars = await listCalendarsWithToken(await accessToken(connection), connection);
  await assertCurrent(caller, connection);
  return { calendars };
}
export async function updateCalendarPreferences(caller: CalendarCaller, raw: unknown, grantPurpose: CalendarPurpose = "standard") {
  if (grantPurpose === "agent" && !isGoogleCalendarAiTransportEnabled()) throw new CalendarConnectionError("not_configured");
  const connection = await connected(caller, grantPurpose);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CalendarConnectionError("invalid_request");
  const value = raw as Record<string, unknown>;
  for (const key of ["selectedCalendarIds", "hiddenCalendarIds"]) {
    const ids = value[key];
    if (!Array.isArray(ids) || ids.length > 32 || ids.some((id) => typeof id !== "string" || !id || id.length > 1024) || new Set(ids).size !== ids.length) throw new CalendarConnectionError("invalid_request");
  }
  if (typeof value.visible !== "boolean" || typeof value.showAllDay !== "boolean") throw new CalendarConnectionError("invalid_request");
  const preferences = value as CalendarPreferences;
  const available = grantPurpose === "agent"
    ? await listMcpCalendarsForConnection(caller, connection)
    : await listCalendarsWithToken(await accessToken(connection), connection);
  if (preferences.selectedCalendarIds.some((id) => !available.some((calendar) => calendar.id === id)) || preferences.hiddenCalendarIds.some((id) => !preferences.selectedCalendarIds.includes(id))) throw new CalendarConnectionError("invalid_request");
  await assertCurrent(caller, connection);
  await saveCalendarPreferences(caller.client, caller.user.id, preferences, grantPurpose);
  if (grantPurpose === "agent") {
    invalidateGoogleCalendarMcpCache(caller.user.id);
    await clearCalendarLoadForSource(caller.client, caller.user.id, "google_calendar");
    if (preferences.selectedCalendarIds.length > 0) {
      await backfillCalendarLoadAfterSelection(caller.client, caller.user.id, (start, end, signal) =>
        getCalendarEventsForAdvisor(caller, start, end, { allowPastDates: true, signal }));
    }
  }
  return getCalendarConnection(caller, grantPurpose);
}
const pendingReads = new Map<string, Promise<Awaited<ReturnType<typeof readGoogleCalendarEvents>>>>();
export async function getCalendarEvents(caller: CalendarReadCaller, start: string, end: string) {
  const read = await readAuthorizedCalendarRange(caller, start, end, {}, false, "standard");
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
    allowPastDates?: boolean;
    /** When true, reads Google Calendar ephemerally in memory without persisting `daily_calendar_load`. */
    ephemeralOnly?: boolean;
    now?: Temporal.Instant;
    signal?: AbortSignal;
  }> = {},
): Promise<AdvisorCalendarRead> {
  // WS-2B: fail closed when AI MCP transport is disabled — NEVER fall back to standard REST.
  if (!isGoogleCalendarAiTransportEnabled()) {
    throw new CalendarConnectionError("not_configured");
  }
  return readAuthorizedMcpCalendarRange(caller, start, end, options);
}

/** Development-only Retrospective reads. Live authorization never uses the evaluation clock. Strictly `agent_mcp`. */
export async function getCalendarEventsForWorkbenchHistory(
  caller: CalendarCaller, start: string, end: string,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<AdvisorCalendarRead> {
  if (process.env.NODE_ENV !== "development") throw new CalendarConnectionError("permission_denied");
  options.signal?.throwIfAborted();
  const preference = await readDailyBriefPreferences(caller.client, options.signal);
  if (!dailyBriefSourceAllowed(preference, "googleCalendar") || !dailyBriefReadsGoogleCalendar(preference)) throw new CalendarConnectionError("permission_denied");
  const connection = await getCalendarConnection(caller, "agent");
  if (connection.status !== "connected") throw new CalendarConnectionError("connection_changed");
  const { data: profile, error } = await caller.client.from("profiles").select("timezone").eq("id", caller.user.id).single();
  if (error || !profile) throw new CalendarConnectionError("provider_unavailable");
  let first: Temporal.PlainDate; let last: Temporal.PlainDate;
  try { first = Temporal.PlainDate.from(start); last = Temporal.PlainDate.from(end); }
  catch { throw new CalendarConnectionError("invalid_request"); }
  const today = Temporal.Now.instant().toZonedDateTimeISO(profile.timezone).toPlainDate();
  if (first.toString() !== start || last.toString() !== end || first.until(last).days < 0 || first.until(last).days > 30
    || Temporal.PlainDate.compare(last, today) >= 0) {
    throw new CalendarConnectionError("invalid_request");
  }
  const result = await getCalendarEventsForAdvisor(caller, start, end, {
    authorizedCalendarIds: connection.preferences.selectedCalendarIds,
    expectedConnectionGeneration: connection.generation, expectedSelectionRevision: connection.selectionRevision,
    authorizationScope: `briefing-history:${preference.revision}`, allowPastDates: true, ephemeralOnly: true, signal: options.signal,
  });
  const current = await readDailyBriefPreferences(caller.client, options.signal);
  options.signal?.throwIfAborted();
  if (JSON.stringify(current) !== JSON.stringify(preference)) throw new CalendarConnectionError("connection_changed");
  return result;
}

const pendingMcpReads = new Map<string, Promise<GoogleCalendarReadResult>>();

function buildEmptyCompleteMcpSnapshot(
  accountId: string,
  connectionGeneration: number,
  start: string,
  end: string,
  timezone: string,
  fetchedAt: string,
): ExternalEventSnapshotV1 {
  return {
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION,
    adapterVersion: EXTERNAL_EVENT_ADAPTER_VERSION,
    accountId,
    connectionGeneration,
    source: "google_calendar",
    requestedRange: {
      startLocalDate: start,
      endLocalDate: end,
      timezone,
      selectedCalendarIds: [],
    },
    fetchedAt,
    completeness: "complete",
    freshness: {
      state: "current",
      refreshedAt: fetchedAt,
      label: "Calendar current",
      canAssertNoOverlap: true,
    },
    capabilities: {
      calendar_listing: { support: "supported", permission: "granted", availability: "available" },
      timed_events: { support: "supported", permission: "granted", availability: "available" },
      all_day_events: { support: "supported", permission: "granted", availability: "available" },
      recurrence: { support: "supported", permission: "granted", availability: "available" },
      details: { support: "supported", permission: "granted", availability: "available" },
      source_links: { support: "supported", permission: "granted", availability: "available" },
    },
    coverage: [],
    failures: [],
    events: [],
    tombstones: [],
  };
}

async function readAuthorizedMcpCalendarRange(
  caller: CalendarReadCaller,
  start: string,
  end: string,
  options: NonNullable<Parameters<typeof getCalendarEventsForAdvisor>[3]>,
): Promise<AdvisorCalendarRead> {
  const connection = await connected(caller, "agent");
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
  const maxFuture = today.add({ days: 30 });
  const rangeInvalid = first.toString() !== start || last.toString() !== end || first.until(last).days < 0 || first.until(last).days > 30
    || (options.allowPastDates
      ? Temporal.PlainDate.compare(last, maxFuture) > 0 || Temporal.PlainDate.compare(first, Temporal.PlainDate.from("2000-01-01")) < 0
      : Temporal.PlainDate.compare(first, today) !== 0);
  if (rangeInvalid) throw new CalendarConnectionError("invalid_request");
  const authorizedCalendarIds = options.authorizedCalendarIds === undefined
    ? null
    : [...new Set(options.authorizedCalendarIds)].sort();
  if (authorizedCalendarIds && (authorizedCalendarIds.length > 32 || authorizedCalendarIds.some((id) => !id || id.length > 1024))) {
    throw new CalendarConnectionError("invalid_request");
  }
  if (options.authorizationScope !== undefined && (!options.authorizationScope || options.authorizationScope.length > 512)) {
    throw new CalendarConnectionError("invalid_request");
  }

  const configuredSelectedIds = connection.preferences.selectedCalendarIds.filter((id) =>
    authorizedCalendarIds === null || authorizedCalendarIds.includes(id));
  if (configuredSelectedIds.length === 0) {
    const emptySnapshot = buildEmptyCompleteMcpSnapshot(caller.user.id, connection.generation, start, end, profile.timezone, now.toString());
    await assertCurrent(caller, connection);
    return { connection, result: { ok: true, snapshot: emptySnapshot } };
  }

  const rangeKey = JSON.stringify([start, end, profile.timezone, authorizedCalendarIds]);
  const snapshotCacheKey = {
    userId: caller.user.id,
    grantGeneration: connection.generation,
    selectionRevision: connection.selectionRevision,
    rangeKey,
  };
  const cachedSnapshot = getCachedGoogleCalendarMcpSnapshot(snapshotCacheKey);
  if (cachedSnapshot) {
    await assertCurrent(caller, connection);
    if (!options.ephemeralOnly) {
      await persistCalendarLoadFromSnapshot(caller.client, caller.user.id, "google_calendar", connection.generation, cachedSnapshot, now.toString(), {
        grantPurpose: "agent_mcp",
      });
    }
    return { connection, result: { ok: true, snapshot: cachedSnapshot } };
  }

  const key = JSON.stringify(["agent_mcp", connection.oauthClientId ?? null, caller.user.id, connection.generation, connection.selectionRevision, start, end, profile.timezone, authorizedCalendarIds, options.authorizationScope ?? "first_party"]);
  let pending = pendingMcpReads.get(key);
  if (!pending) {
    pending = (async (): Promise<GoogleCalendarReadResult> => {
      const token = await accessToken(connection);
      if (options.signal?.aborted) throw new CalendarConnectionError("timeout");
      const calendars = await listMcpCalendarsForConnection(caller, connection, token, options.signal);
      if (options.signal?.aborted) throw new CalendarConnectionError("timeout");
      const selectedIds = connection.preferences.selectedCalendarIds.filter((id) =>
        authorizedCalendarIds === null || authorizedCalendarIds.includes(id));
      const selected = selectedIds.map((id) => {
        const calendar = calendars.find((value) => value.id === id);
        if (!calendar) throw new CalendarConnectionError("provider_unavailable");
        return calendar;
      });
      if (selected.length === 0) {
        return { ok: true, snapshot: buildEmptyCompleteMcpSnapshot(caller.user.id, connection.generation, start, end, profile.timezone, now.toString()) };
      }
      const budget = consumeGoogleCalendarMcpBudget(caller.user.id, selected.length);
      if (!budget.allowed) throw new CalendarConnectionError("rate_limited");
      const mcpResult = await readGoogleCalendarMcpEvents({
        accessToken: token,
        accountId: caller.user.id,
        connectionGeneration: connection.generation,
        calendars: selected,
        range: {
          startLocalDate: start,
          endLocalDate: end,
          timezone: profile.timezone,
          selectedCalendarIds: selected.map((calendar) => calendar.id),
        },
        fetchedAt: now.toString(),
        signal: options.signal,
      });
      if (mcpResult.ok) {
        const screened = await screenSnapshotWithModelArmor(mcpResult.snapshot, { signal: options.signal });
        setCachedGoogleCalendarMcpSnapshot(snapshotCacheKey, screened.snapshot);
        return { ok: true, snapshot: screened.snapshot };
      }
      const screenedPartial = await screenSnapshotWithModelArmor(mcpResult.partialSnapshot, { signal: options.signal });
      return {
        ok: false,
        error: mcpResult.error,
        partialSnapshot: screenedPartial.snapshot,
      };
    })();
    pendingMcpReads.set(key, pending);
    void pending.finally(() => pendingMcpReads.delete(key)).catch(() => undefined);
  }
  const result = await pending;
  await assertCurrent(caller, connection);
  // Q2 invariant: persist Google daily_calendar_load ONLY on complete AI MCP reads and ONLY when not ephemeralOnly.
  if (result.ok && !options.ephemeralOnly) {
    await persistCalendarLoadFromSnapshot(caller.client, caller.user.id, "google_calendar", connection.generation, result.snapshot, now.toString(), {
      grantPurpose: "agent_mcp",
    });
  }
  return { connection, result };
}

async function readAuthorizedCalendarRange(
  caller: CalendarReadCaller, start: string, end: string,
  options: NonNullable<Parameters<typeof getCalendarEventsForAdvisor>[3]>, historical: boolean, grantPurpose: CalendarPurpose,
): Promise<AdvisorCalendarRead> {
  const connection = await connected(caller, grantPurpose);
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
  const maxFuture = today.add({ days: 30 });
  const rangeInvalid = first.toString() !== start || last.toString() !== end || first.until(last).days < 0 || first.until(last).days > 30
    || (historical
      ? Temporal.PlainDate.compare(last, today) >= 0
      : options.allowPastDates
        ? Temporal.PlainDate.compare(last, maxFuture) > 0 || Temporal.PlainDate.compare(first, Temporal.PlainDate.from("2000-01-01")) < 0
        : Temporal.PlainDate.compare(first, today) !== 0);
  if (rangeInvalid) throw new CalendarConnectionError("invalid_request");
  const authorizedCalendarIds = options.authorizedCalendarIds === undefined
    ? null
    : [...new Set(options.authorizedCalendarIds)].sort();
  if (authorizedCalendarIds && (authorizedCalendarIds.length > 32 || authorizedCalendarIds.some((id) => !id || id.length > 1024))) {
    throw new CalendarConnectionError("invalid_request");
  }
  if (options.authorizationScope !== undefined && (!options.authorizationScope || options.authorizationScope.length > 512)) {
    throw new CalendarConnectionError("invalid_request");
  }
  const key = JSON.stringify([grantPurpose, connection.oauthClientId ?? null, caller.user.id, connection.generation, connection.selectionRevision, start, end, profile.timezone, authorizedCalendarIds, options.authorizationScope ?? "first_party"]);
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
  // Q2 invariant: standard REST reads NEVER write Google rows to daily_calendar_load.
  return { connection, result };
}
export async function disconnectCalendar(caller: CalendarCaller, grantPurpose: CalendarPurpose = "standard") {
  const connection = await readCalendarConnection(caller.client, caller.user.id, grantPurpose);
  let revocationFailed = false;
  // Ticket 335: the account's own connection can always be disconnected and its grant
  // revoked, whatever its Google sign-ins are now.
  if (connection) {
    const sealed = await removeCalendarCredential(connection, "disconnected");
    if (sealed) {
      try { await revokeCalendarToken(openCalendarSecret(config(undefined, grantPurpose), sealed, { ...connection, purpose: "refresh" })); }
      catch { revocationFailed = true; }
    }
  }
  if (grantPurpose === "agent") {
    invalidateGoogleCalendarMcpCache(caller.user.id);
    await clearCalendarLoadForSource(caller.client, caller.user.id, "google_calendar");
  }
  return { ...await getCalendarConnection(caller, grantPurpose), revocationFailed };
}

/** Ticket 307: older desktop builds still ask for the retired Daily Brief grant; it reads as not configured. */
export function retiredAgentCalendarConnection(caller: CalendarReadCaller): CalendarConnectionView {
  return { accountId: caller.user.id, status: "not_configured", generation: 0, selectionRevision: 0, preferences: DEFAULT_CALENDAR_PREFERENCES };
}

// Capture only the revocation work; failed Auth deletion must leave the connection intact.
// Standard and agent revocations prepare independently so a missing/corrupt credential on one
// never suppresses revocation of the other.
export async function prepareCalendarRevocation(caller: CalendarCaller): Promise<(() => Promise<void>) | null> {
  const work: Array<() => Promise<void>> = [];
  for (const grantPurpose of ["standard", "agent"] as const) {
    try {
      const settings = readCalendarOAuthConfig(process.env, undefined, grantPurpose);
      if (!settings) continue;
      const connection = await readCalendarConnection(caller.client, caller.user.id, grantPurpose);
      if (!connection || connection.status !== "connected") continue;
      const sealed = await readCalendarCredential(connection);
      work.push(async () => revokeCalendarToken(openCalendarSecret(settings, sealed, { ...connection, purpose: "refresh" })));
    } catch {
      // Independent per-grant preparation: never suppress the other grant's revocation.
    }
  }
  return work.length ? async () => {
    const outcomes = await Promise.allSettled(work.map((run) => run()));
    if (outcomes.some((outcome) => outcome.status === "rejected")) throw new CalendarConnectionError("provider_unavailable");
  } : null;
}
