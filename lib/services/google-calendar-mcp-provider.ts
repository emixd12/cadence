import { Temporal } from "@js-temporal/polyfill";

import { sanitizeGoogleCalendarText } from "@/lib/services/google-calendar-provider";
import {
  PROVIDER_CALL_TIMEOUT_MS,
  ProviderCallTimeoutError,
  runProviderCallWithTimeout,
} from "@/lib/services/provider-call-timeout";
import type { CalendarListEntry } from "@/lib/types/google-calendar";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";
import type {
  ExternalEventAvailability,
  ExternalEventField,
  ExternalEventFieldAvailability,
  ExternalEventOriginalStart,
  ExternalEventResponseStatus,
  ExternalEventRevision,
  ExternalEventSourceTimezoneFallback,
  NormalizedExternalEvent,
} from "@cadence/core/types/day-progress";
import {
  EXTERNAL_EVENT_ADAPTER_VERSION,
  EXTERNAL_EVENT_MAX_CALENDARS,
  EXTERNAL_EVENT_MAX_RANGE_DAYS,
  EXTERNAL_EVENT_SCHEMA_VERSION,
  type ExternalEventCancellationTombstone,
  type ExternalEventCapabilities,
  type ExternalEventErrorCode,
  type ExternalEventFailure,
  type ExternalEventRequestedRange,
  type ExternalEventSnapshotV1,
} from "@cadence/core/types/external-event";

export const GOOGLE_CALENDAR_MCP_ENDPOINT_URL = "https://calendarmcp.googleapis.com/mcp/v1";
export const GOOGLE_CALENDAR_MCP_ALLOWED_TOOLS = ["list_calendars", "list_events"] as const;
export type GoogleCalendarMcpAllowedTool = (typeof GOOGLE_CALENDAR_MCP_ALLOWED_TOOLS)[number];

const ALLOWED_TOOL_SET: ReadonlySet<string> = new Set(GOOGLE_CALENDAR_MCP_ALLOWED_TOOLS);
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_ELAPSED_MS = 25_000;
const MAX_CONFERENCE_ENTRY_POINTS = 10;

export type GoogleCalendarMcpFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GoogleCalendarMcpErrorCode =
  | "mcp_unauthorized"
  | "permission_denied"
  | "rate_limited"
  | "mcp_tool_error"
  | "provider_unavailable"
  | "timeout"
  | "malformed_provider_response"
  | "incomplete_pagination"
  | "invalid_request"
  | "budget_exceeded";

export type GoogleCalendarMcpFailure = ExternalEventFailure & Readonly<{
  mcpErrorCode: GoogleCalendarMcpErrorCode;
  /**
   * MCP HTTP 401 and tool errors MUST NEVER trigger stored credential deletion.
   * Only OAuth token-endpoint `invalid_grant` deletes a stored credential.
   */
  deleteCredential: false;
}>;

export type GoogleCalendarMcpCalendar = Readonly<{
  id: string;
  name: string;
  timezone: string;
  primary: boolean;
  selected: boolean;
  accessRole: CalendarListEntry["accessRole"] | "freeBusyReader" | "none";
}>;

export type GoogleCalendarMcpReadResult =
  | Readonly<{
      ok: true;
      snapshot: ExternalEventSnapshotV1;
      requestCount: number;
      sessionId: string | null;
    }>
  | Readonly<{
      ok: false;
      error: GoogleCalendarMcpFailure;
      partialSnapshot: ExternalEventSnapshotV1;
      requestCount: number;
      sessionId: string | null;
    }>;

export type GoogleCalendarMcpListInput = Readonly<{
  accessToken: string;
  endpointUrl?: string;
  sessionId?: string | null;
  fetch?: GoogleCalendarMcpFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxPages?: number;
  maxRetries?: number;
  /**
   * Runs before every outbound MCP HTTP request, including retries and later pages.
   * A throw stops the call before `fetch` runs and propagates unchanged: it is never
   * retried or reported as a provider failure. The service uses it to charge the
   * per-user daily MCP budget once per request.
   */
  beforeRequest?: () => void;
  maxTotalBytes?: number;
  maxElapsedMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}>;

export type GoogleCalendarMcpReadInput = Readonly<{
  accessToken: string;
  accountId: string;
  connectionGeneration: number;
  calendars: GoogleCalendarMcpCalendar[];
  range: ExternalEventRequestedRange;
  fetchedAt: string;
  endpointUrl?: string;
  sessionId?: string | null;
  fetch?: GoogleCalendarMcpFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxPagesPerCalendar?: number;
  maxRetries?: number;
  /**
   * Runs before every outbound MCP HTTP request, including retries and later pages.
   * A throw stops the call before `fetch` runs and propagates unchanged: it is never
   * retried or reported as a provider failure. The service uses it to charge the
   * per-user daily MCP budget once per request.
   */
  beforeRequest?: () => void;
  maxTotalBytes?: number;
  maxElapsedMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}>;

export type GoogleCalendarMcpToolCallInput = Readonly<{
  accessToken: string;
  toolName: string;
  arguments: Record<string, unknown>;
  endpointUrl?: string;
  sessionId?: string | null;
  requestId?: string | number;
  calendarId?: string | null;
  fetch?: GoogleCalendarMcpFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Runs before every outbound MCP HTTP request, including retries and later pages.
   * A throw stops the call before `fetch` runs and propagates unchanged: it is never
   * retried or reported as a provider failure. The service uses it to charge the
   * per-user daily MCP budget once per request.
   */
  beforeRequest?: () => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}>;

export type GoogleCalendarMcpToolCallResponse = Readonly<{
  payload: unknown;
  sessionId: string | null;
  bytesRead: number;
}>;

export class GoogleCalendarMcpDisallowedToolError extends Error {
  constructor(public readonly toolName: string) {
    super(`Google Calendar MCP tool "${toolName}" is not permitted. Allowed tools: ${GOOGLE_CALENDAR_MCP_ALLOWED_TOOLS.join(", ")}.`);
    this.name = "GoogleCalendarMcpDisallowedToolError";
  }
}

export class GoogleCalendarMcpProviderError extends Error {
  constructor(public readonly failure: GoogleCalendarMcpFailure) {
    super(failure.message);
    this.name = "GoogleCalendarMcpProviderError";
  }
}

class McpItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpItemError";
  }
}

class McpRequestError extends Error {
  constructor(
    public readonly failure: GoogleCalendarMcpFailure,
    public readonly pageItems: number,
  ) {
    super(failure.message);
    this.name = "McpRequestError";
  }
}

export function assertAllowedGoogleCalendarMcpTool(
  toolName: string,
): asserts toolName is GoogleCalendarMcpAllowedTool {
  if (!ALLOWED_TOOL_SET.has(toolName)) {
    throw new GoogleCalendarMcpDisallowedToolError(toolName);
  }
}

export async function callGoogleCalendarMcpTool(
  input: GoogleCalendarMcpToolCallInput,
): Promise<GoogleCalendarMcpToolCallResponse> {
  assertAllowedGoogleCalendarMcpTool(input.toolName);
  if (!input.accessToken) {
    throw new TypeError("Google Calendar MCP calls require an access token.");
  }

  const endpointUrl = input.endpointUrl ?? GOOGLE_CALENDAR_MCP_ENDPOINT_URL;
  const fetcher = input.fetch ?? fetch;
  const sleep = input.sleep ?? wait;
  const random = input.random ?? Math.random;
  const maxRetries = boundedInteger(input.maxRetries, DEFAULT_MAX_RETRIES, 0, 4);
  const calendarId = input.calendarId ?? null;
  const requestId = input.requestId ?? `cadence-${input.toolName}-1`;

  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
      name: input.toolName,
      arguments: input.arguments,
    },
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    const providerSignal = input.signal
      ? AbortSignal.any([
          input.signal,
          AbortSignal.timeout(input.timeoutMs ?? PROVIDER_CALL_TIMEOUT_MS),
        ])
      : undefined;

    const headers: Record<string, string> = {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (input.sessionId) {
      headers["MCP-Session-Id"] = input.sessionId;
    }

    // Outside the try below: a throw here (budget exhausted) must not be retried
    // or turned into a provider failure, and no request is sent.
    input.beforeRequest?.();

    try {
      response = await runProviderCallWithTimeout(
        (signal) => fetcher(endpointUrl, {
          method: "POST",
          headers,
          body: rpcBody,
          signal,
        }),
        { timeoutMs: input.timeoutMs, signal: providerSignal },
      );
    } catch (error) {
      const timedOut = error instanceof ProviderCallTimeoutError || Boolean(input.signal?.aborted);
      if (attempt < maxRetries && !input.signal?.aborted) {
        await sleep(backoffMilliseconds(attempt, null, random), input.signal);
        continue;
      }
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: timedOut ? "timeout" : "provider_unavailable",
        mcpErrorCode: timedOut ? "timeout" : "provider_unavailable",
        calendarId,
        retryable: !input.signal?.aborted,
        retryAfterSeconds: null,
        message: timedOut
          ? "Google Calendar MCP request timed out."
          : "Google Calendar MCP request failed.",
      }));
    }

    const responseSessionId = response.headers.get("mcp-session-id") ?? input.sessionId ?? null;

    if (!response.ok) {
      const retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
      const failure = mapMcpHttpFailure(response.status, calendarId, retryAfter);
      if (failure.retryable && attempt < maxRetries) {
        await sleep(backoffMilliseconds(attempt, retryAfter, random), input.signal);
        continue;
      }
      throw new GoogleCalendarMcpProviderError(failure);
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "malformed_provider_response",
        mcpErrorCode: "malformed_provider_response",
        calendarId,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP response body could not be read.",
      }));
    }

    const bytesRead = new TextEncoder().encode(rawText).byteLength;
    const contentType = response.headers.get("content-type") ?? "";
    const envelope = parseJsonRpcResponse(rawText, contentType, calendarId);

    // JSON-RPC error object — never retry on HTTP 200 (billed on Scaled Tier).
    if ("error" in envelope && envelope.error !== undefined) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "provider_unavailable",
        mcpErrorCode: "mcp_tool_error",
        calendarId,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP returned a JSON-RPC error.",
      }));
    }

    const resultRecord = asOptionalRecord(envelope.result);
    if (!resultRecord) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "malformed_provider_response",
        mcpErrorCode: "malformed_provider_response",
        calendarId,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP returned a malformed result envelope.",
      }));
    }

    // NEVER retry HTTP 200 JSON-RPC isError: true (billed on Scaled Tier).
    if (resultRecord.isError === true) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "provider_unavailable",
        mcpErrorCode: "mcp_tool_error",
        calendarId,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP tool returned an error.",
      }));
    }

    const payload = extractMcpToolPayload(resultRecord, calendarId);
    return { payload, sessionId: responseSessionId, bytesRead };
  }

  throw new GoogleCalendarMcpProviderError(mcpFailure({
    code: "provider_unavailable",
    mcpErrorCode: "provider_unavailable",
    calendarId,
    retryable: true,
    retryAfterSeconds: null,
    message: "Google Calendar MCP retry budget ended.",
  }));
}

export async function listGoogleCalendarMcpCalendars(
  input: GoogleCalendarMcpListInput,
): Promise<CalendarListEntry[]> {
  if (!input.accessToken) {
    throw new TypeError("Google Calendar MCP listing requires an access token.");
  }
  const maxPages = boundedInteger(input.maxPages, DEFAULT_MAX_PAGES, 1, DEFAULT_MAX_PAGES);
  const maxTotalBytes = boundedInteger(input.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, 1_024, 32 * 1024 * 1024);
  const maxElapsedMs = boundedInteger(input.maxElapsedMs, DEFAULT_MAX_ELAPSED_MS, 100, 120_000);
  const clock = input.now ?? Date.now;
  const startedAt = clock();

  const calendars = new Map<string, CalendarListEntry>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  let sessionId: string | null = input.sessionId ?? null;
  let totalBytes = 0;

  for (let page = 0; page < maxPages; page += 1) {
    if (clock() - startedAt > maxElapsedMs) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "timeout",
        mcpErrorCode: "timeout",
        calendarId: null,
        retryable: true,
        retryAfterSeconds: null,
        message: "Google Calendar MCP calendar listing exceeded elapsed time limit.",
      }));
    }
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "incomplete_pagination",
        mcpErrorCode: "incomplete_pagination",
        calendarId: null,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP repeated a calendar-list page token.",
      }));
    }
    if (pageToken) seenPageTokens.add(pageToken);

    const args: Record<string, unknown> = { pageSize: DEFAULT_PAGE_SIZE };
    if (pageToken) args.pageToken = pageToken;

    const response = await callGoogleCalendarMcpTool({
      accessToken: input.accessToken,
      toolName: "list_calendars",
      arguments: args,
      endpointUrl: input.endpointUrl,
      sessionId,
      requestId: `list-calendars-${page + 1}`,
      fetch: input.fetch,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      maxRetries: input.maxRetries,
      beforeRequest: input.beforeRequest,
      sleep: input.sleep,
      random: input.random,
    });

    sessionId = response.sessionId;
    totalBytes += response.bytesRead;
    if (totalBytes > maxTotalBytes) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "incomplete_pagination",
        mcpErrorCode: "incomplete_pagination",
        calendarId: null,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP calendar listing exceeded response size limit.",
      }));
    }

    try {
      const pageRecord = record(response.payload, "calendarList");
      const rawItems = pageRecord.calendars ?? pageRecord.items;
      const items = rawItems === undefined ? [] : array(rawItems, "calendarList.items");
      for (let index = 0; index < items.length; index += 1) {
        const entry = adaptMcpCalendarListEntry(items[index], index);
        if (entry) calendars.set(entry.id, entry);
      }
      const rawNext = pageRecord.nextPageToken ?? pageRecord.next_page_token;
      pageToken = rawNext === undefined || rawNext === null || rawNext === ""
        ? null
        : requiredString(rawNext, "calendarList.nextPageToken");
    } catch (error) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "malformed_provider_response",
        mcpErrorCode: "malformed_provider_response",
        calendarId: null,
        retryable: false,
        retryAfterSeconds: null,
        message: error instanceof Error ? error.message : "Google Calendar MCP returned a malformed calendar list.",
      }));
    }

    if (!pageToken) {
      return [...calendars.values()].sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      );
    }

    if (page === maxPages - 1) {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "incomplete_pagination",
        mcpErrorCode: "incomplete_pagination",
        calendarId: null,
        retryable: false,
        retryAfterSeconds: null,
        message: `Google Calendar MCP exceeded the ${maxPages}-page calendar-list limit.`,
      }));
    }
  }

  throw new GoogleCalendarMcpProviderError(mcpFailure({
    code: "incomplete_pagination",
    mcpErrorCode: "incomplete_pagination",
    calendarId: null,
    retryable: false,
    retryAfterSeconds: null,
    message: "Google Calendar MCP calendar-list pagination did not complete.",
  }));
}

export async function readGoogleCalendarMcpEvents(
  input: GoogleCalendarMcpReadInput,
): Promise<GoogleCalendarMcpReadResult> {
  validateReadInput(input);
  const maxPages = boundedInteger(input.maxPagesPerCalendar, DEFAULT_MAX_PAGES, 1, DEFAULT_MAX_PAGES);
  const maxTotalBytes = boundedInteger(input.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, 1_024, 32 * 1024 * 1024);
  const maxElapsedMs = boundedInteger(input.maxElapsedMs, DEFAULT_MAX_ELAPSED_MS, 100, 120_000);
  const clock = input.now ?? Date.now;
  const startedAt = clock();

  const startTime = `${input.range.startLocalDate}T00:00:00`;
  const endTime = `${Temporal.PlainDate.from(input.range.endLocalDate).add({ days: 1 }).toString()}T00:00:00`;

  const events = new Map<string, NormalizedExternalEvent>();
  const tombstones = new Map<string, ExternalEventCancellationTombstone>();
  const coverage: ExternalEventSnapshotV1["coverage"][number][] = [];
  let sessionId: string | null = input.sessionId ?? null;
  let requestCount = 0;
  let totalBytes = 0;
  // A `beforeRequest` throw ends the whole read and propagates unchanged. It is not a
  // calendar failure, so no partial snapshot is returned for it.
  const gate: { blocked: boolean; error: unknown } = { blocked: false, error: undefined };
  const beforeRequest = input.beforeRequest
    ? () => {
        try {
          input.beforeRequest?.();
        } catch (error) {
          gate.blocked = true;
          gate.error = error;
          throw error;
        }
      }
    : undefined;

  for (const calendar of input.calendars) {
    let pageToken: string | null = null;
    const seenPageTokens = new Set<string>();
    let itemCount = 0;

    try {
      for (let page = 0; page < maxPages; page += 1) {
        if (clock() - startedAt > maxElapsedMs) {
          throw new McpRequestError(mcpFailure({
            code: "timeout",
            mcpErrorCode: "timeout",
            calendarId: calendar.id,
            retryable: true,
            retryAfterSeconds: null,
            message: "Google Calendar MCP event read exceeded elapsed time limit.",
          }), itemCount);
        }
        if (pageToken && seenPageTokens.has(pageToken)) {
          throw new McpRequestError(mcpFailure({
            code: "incomplete_pagination",
            mcpErrorCode: "incomplete_pagination",
            calendarId: calendar.id,
            retryable: false,
            retryAfterSeconds: null,
            message: "Google Calendar MCP repeated an event page token.",
          }), itemCount);
        }
        if (pageToken) seenPageTokens.add(pageToken);

        const args: Record<string, unknown> = {
          calendarId: calendar.id,
          startTime,
          endTime,
          timeZone: input.range.timezone,
          pageSize: DEFAULT_PAGE_SIZE,
        };
        if (pageToken) args.pageToken = pageToken;

        requestCount += 1;
        let response: GoogleCalendarMcpToolCallResponse;
        try {
          response = await callGoogleCalendarMcpTool({
            accessToken: input.accessToken,
            toolName: "list_events",
            arguments: args,
            endpointUrl: input.endpointUrl,
            sessionId,
            requestId: `list-events-${calendar.id}-${page + 1}`,
            calendarId: calendar.id,
            fetch: input.fetch,
            signal: input.signal,
            timeoutMs: input.timeoutMs,
            maxRetries: input.maxRetries,
            beforeRequest,
            sleep: input.sleep,
            random: input.random,
          });
        } catch (error) {
          if (error instanceof GoogleCalendarMcpProviderError) {
            throw new McpRequestError(error.failure, itemCount);
          }
          throw error;
        }

        sessionId = response.sessionId;
        totalBytes += response.bytesRead;
        if (totalBytes > maxTotalBytes) {
          throw new McpRequestError(mcpFailure({
            code: "incomplete_pagination",
            mcpErrorCode: "incomplete_pagination",
            calendarId: calendar.id,
            retryable: false,
            retryAfterSeconds: null,
            message: "Google Calendar MCP event read exceeded response size limit.",
          }), itemCount);
        }

        const providerPage = parseMcpEventsPage(response.payload, calendar.id);
        itemCount += providerPage.items.length;

        for (const rawItem of providerPage.items) {
          let adapted: AdaptedMcpItem;
          try {
            adapted = adaptGoogleCalendarMcpItem(rawItem, {
              calendar,
              requestTimezone: input.range.timezone,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Google Calendar MCP returned a malformed event.";
            throw new McpRequestError(mcpFailure({
              code: "malformed_provider_response",
              mcpErrorCode: "malformed_provider_response",
              calendarId: calendar.id,
              retryable: false,
              retryAfterSeconds: null,
              message,
            }), itemCount);
          }

          if (adapted.kind === "event") {
            events.set(adapted.event.id, adapted.event);
            tombstones.delete(adapted.event.id);
          } else {
            tombstones.set(adapted.tombstone.id, adapted.tombstone);
            events.delete(adapted.tombstone.id);
          }
        }

        pageToken = providerPage.nextPageToken;
        if (!pageToken) {
          coverage.push(coverageFor(calendar.id, input.range, true, itemCount));
          break;
        }
        if (page === maxPages - 1) {
          throw new McpRequestError(mcpFailure({
            code: "incomplete_pagination",
            mcpErrorCode: "incomplete_pagination",
            calendarId: calendar.id,
            retryable: false,
            retryAfterSeconds: null,
            message: `Google Calendar MCP exceeded the ${maxPages}-page read limit.`,
          }), itemCount);
        }
      }
    } catch (error) {
      if (gate.blocked) throw gate.error;
      const requestFailure = error instanceof McpRequestError
        ? error
        : new McpRequestError(mcpFailure({
            code: input.signal?.aborted ? "timeout" : "provider_unavailable",
            mcpErrorCode: input.signal?.aborted ? "timeout" : "provider_unavailable",
            calendarId: calendar.id,
            retryable: !input.signal?.aborted,
            retryAfterSeconds: null,
            message: "Google Calendar MCP event retrieval failed.",
          }), itemCount);

      coverage.push(coverageFor(
        calendar.id,
        input.range,
        false,
        Math.max(itemCount, requestFailure.pageItems),
      ));

      const failure = requestFailure.failure;
      const partialSnapshot = buildSnapshot({
        input,
        completeness: "incomplete",
        coverage,
        failures: [toExternalEventFailure(failure)],
        events: [...events.values()],
        tombstones: [...tombstones.values()],
      });

      return {
        ok: false,
        error: failure,
        partialSnapshot,
        requestCount,
        sessionId,
      };
    }
  }

  return {
    ok: true,
    snapshot: buildSnapshot({
      input,
      completeness: "complete",
      coverage,
      failures: [],
      events: [...events.values()],
      tombstones: [...tombstones.values()],
    }),
    requestCount,
    sessionId,
  };
}

type AdaptedMcpItem =
  | Readonly<{ kind: "event"; event: NormalizedExternalEvent }>
  | Readonly<{ kind: "tombstone"; tombstone: ExternalEventCancellationTombstone }>;

export function adaptGoogleCalendarMcpItem(
  value: unknown,
  context: Readonly<{
    calendar: GoogleCalendarMcpCalendar;
    requestTimezone: string;
  }>,
): AdaptedMcpItem {
  const item = record(value, "event");
  const providerEventId = requiredString(item.id ?? item.eventId, "event.id");
  const id = normalizedId(context.calendar.id, providerEventId);
  const revision = adaptRevision(item);
  const recurrence = adaptRecurrence(item, context);
  const logicalInstanceId = logicalId(item, recurrence, context.calendar.id, providerEventId, context);

  const normalizedStatus = typeof item.status === "string" ? item.status.toLowerCase() : undefined;
  if (normalizedStatus === "cancelled" || normalizedStatus === "canceled") {
    return {
      kind: "tombstone",
      tombstone: {
        id,
        providerEventId,
        logicalInstanceId,
        calendarId: context.calendar.id,
        source: "google_calendar",
        recurrence,
        revision,
      },
    };
  }

  const start = record(item.start, "event.start");
  const end = record(item.end, "event.end");
  const timed = start.dateTime !== undefined || end.dateTime !== undefined;
  const allDay = start.date !== undefined || end.date !== undefined;
  if (timed === allDay) {
    throw new McpItemError("event start/end must be consistently timed or all-day");
  }

  const { timezone, fallback } = sourceTimezone(start, end, context);

  // Enforce accessRole check before projecting private details.
  const freeBusyOnly = context.calendar.accessRole === "freeBusyReader" || context.calendar.accessRole === "none";
  const visibility = typeof item.visibility === "string" ? item.visibility.toLowerCase() : undefined;
  const restricted = freeBusyOnly || (
    visibility === "private" &&
    context.calendar.accessRole !== "owner" &&
    context.calendar.accessRole !== "writer"
  );

  const attendeesOmitted = restricted
    ? false
    : (optionalBoolean(item.attendeesOmitted, "event.attendeesOmitted") ?? false);
  const attendees = restricted ? null : adaptAttendees(item.attendees);
  const organizer = restricted ? null : adaptOrganizer(item.organizer);
  const conference = restricted ? null : adaptConference(item);
  const attachments = restricted ? null : adaptAttachments(item.attachments);
  const sourceUrl = restricted ? null : optionalHttpsUrl(item.htmlLink, "event.htmlLink");

  const rawTitle = restricted ? undefined : (item.summary ?? item.title);
  const rawDescription = restricted ? undefined : item.description;
  const rawLocation = restricted ? undefined : item.location;

  const title = rawTitle === undefined || rawTitle === null
    ? ""
    : sanitizeGoogleCalendarText(textString(rawTitle, "event.summary"), 1_024, false);
  const description = rawDescription === undefined || rawDescription === null
    ? ""
    : sanitizeGoogleCalendarText(textString(rawDescription, "event.description"), 16_384, true);
  const location = rawLocation === undefined || rawLocation === null
    ? ""
    : sanitizeGoogleCalendarText(textString(rawLocation, "event.location"), 2_048, false);

  const fieldAvailability: Partial<Record<ExternalEventField, ExternalEventFieldAvailability>> = {};
  setFieldAvailability(fieldAvailability, "title", rawTitle, restricted);
  setFieldAvailability(fieldAvailability, "description", rawDescription, restricted);
  setFieldAvailability(fieldAvailability, "location", rawLocation, restricted);
  setFieldAvailability(fieldAvailability, "source_url", restricted ? undefined : item.htmlLink, restricted);
  setFieldAvailability(fieldAvailability, "organizer", restricted ? undefined : item.organizer, restricted);
  setFieldAvailability(fieldAvailability, "attendees", restricted ? undefined : item.attendees, restricted, attendeesOmitted);
  setFieldAvailability(fieldAvailability, "conference", restricted ? undefined : (item.conferenceData ?? item.hangoutLink), restricted);
  setFieldAvailability(fieldAvailability, "recurrence", item.recurringEventId, false);
  setFieldAvailability(fieldAvailability, "attachments", restricted ? undefined : item.attachments, restricted);

  const detailCompleteness: NormalizedExternalEvent["detailCompleteness"] = {};
  if (attendeesOmitted) detailCompleteness.attendees = "provider_omitted";
  else if (attendees) detailCompleteness.attendees = "complete";
  else if (restricted) detailCompleteness.attendees = "restricted";
  if (conference) {
    const providerCount = conferenceProviderEntryCount(item);
    detailCompleteness.conference_entry_points = providerCount > MAX_CONFERENCE_ENTRY_POINTS
      ? "client_truncated"
      : "complete";
  } else if (restricted) {
    detailCompleteness.conference_entry_points = "restricted";
  }
  if (attachments) detailCompleteness.attachments = "complete";
  else if (restricted) detailCompleteness.attachments = "restricted";

  const base = {
    id,
    providerEventId,
    logicalInstanceId,
    calendarId: context.calendar.id,
    source: "google_calendar" as const,
    calendarName: sanitizeGoogleCalendarText(context.calendar.name, 1_024, false) || context.calendar.id,
    sourceTimezone: timezone,
    sourceTimezoneFallback: fallback,
    state: adaptEventState(item.status),
    availability: adaptMcpAvailability(item.availability ?? item.transparency),
    currentUserResponse: currentUserResponse(attendees),
    revision,
    title,
    description,
    location,
    sourceUrl,
    fieldAvailability,
    detailCompleteness,
    organizer,
    attendees,
    attendeesOmitted,
    conference,
    recurrence,
    attachments,
  };

  if (timed) {
    const startAt = parseInstantOrLocalDateTime(start.dateTime, timezone, "event.start.dateTime");
    const endAt = parseInstantOrLocalDateTime(end.dateTime, timezone, "event.end.dateTime");
    const startInstant = Temporal.Instant.from(startAt);
    const endInstant = Temporal.Instant.from(endAt);
    if (Temporal.Instant.compare(endInstant, startInstant) <= 0) {
      throw new McpItemError("event.end.dateTime must follow event.start.dateTime");
    }
    const endUnspecified = optionalBoolean(item.endTimeUnspecified, "event.endTimeUnspecified") ?? false;
    return {
      kind: "event",
      event: {
        ...base,
        kind: "timed",
        startAt,
        endAt,
        endUnspecified,
        duration: endUnspecified
          ? { kind: "unknown", reason: "end_unspecified" }
          : { kind: "known", seconds: startInstant.until(endInstant).total({ unit: "seconds" }) },
      },
    };
  }

  const startLocalDate = dateString(start.date, "event.start.date");
  const endLocalDate = dateString(end.date, "event.end.date");
  const days = Temporal.PlainDate.from(startLocalDate).until(Temporal.PlainDate.from(endLocalDate)).days;
  if (days <= 0) {
    throw new McpItemError("event.end.date must follow event.start.date");
  }
  return {
    kind: "event",
    event: {
      ...base,
      kind: "all_day",
      startLocalDate,
      endLocalDate,
      duration: { kind: "calendar_days", days },
    },
  };
}

export function adaptMcpAvailability(value: unknown): ExternalEventAvailability {
  if (value === undefined || value === null) return "busy";
  if (typeof value !== "string") {
    throw new McpItemError("event.availability must be a string");
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "AVAILABILITY_FREE" || normalized === "FREE" || normalized === "TRANSPARENT") {
    return "free";
  }
  return "busy";
}

function adaptMcpCalendarListEntry(value: unknown, index: number): CalendarListEntry | null {
  const item = record(value, `calendarList.items[${index}]`);
  const rawRole = item.accessRole ?? item.access_role;
  const accessRole = rawRole === undefined || rawRole === null
    ? "reader"
    : normalizeAccessRole(requiredString(rawRole, `calendarList.items[${index}].accessRole`));

  if (accessRole === "freeBusyReader" || accessRole === "none") return null;
  if (accessRole !== "reader" && accessRole !== "writer" && accessRole !== "owner") {
    throw new McpItemError(`calendarList.items[${index}].accessRole is unsupported`);
  }

  const id = requiredString(item.id ?? item.calendarId, `calendarList.items[${index}].id`);
  if (id.length > 1_024) {
    throw new McpItemError(`calendarList.items[${index}].id is too long`);
  }

  const rawOverride = item.summaryOverride;
  const override = rawOverride === undefined || rawOverride === null
    ? ""
    : sanitizeGoogleCalendarText(textString(rawOverride, `calendarList.items[${index}].summaryOverride`), 1_024, false);

  const rawSummary = item.summary ?? item.title ?? item.name;
  const summary = rawSummary === undefined || rawSummary === null
    ? ""
    : sanitizeGoogleCalendarText(textString(rawSummary, `calendarList.items[${index}].summary`), 1_024, false);

  const name = override || summary || id;

  const rawTimezone = item.timeZone ?? item.time_zone ?? item.timezone;
  const timezone = rawTimezone === undefined || rawTimezone === null || rawTimezone === ""
    ? "UTC"
    : requiredString(rawTimezone, `calendarList.items[${index}].timeZone`);
  Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(timezone);

  return {
    id,
    name,
    timezone,
    primary: optionalBoolean(item.primary, `calendarList.items[${index}].primary`) ?? false,
    selected: optionalBoolean(item.selected, `calendarList.items[${index}].selected`) ?? false,
    accessRole,
  };
}

function normalizeAccessRole(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "owner" || lower === "access_role_owner") return "owner";
  if (lower === "writer" || lower === "access_role_writer") return "writer";
  if (lower === "reader" || lower === "access_role_reader") return "reader";
  if (lower === "freebusyreader" || lower === "free_busy_reader" || lower === "access_role_free_busy_reader") {
    return "freeBusyReader";
  }
  if (lower === "none" || lower === "access_role_none") return "none";
  return value;
}

function parseJsonRpcResponse(
  rawText: string,
  contentType: string,
  calendarId: string | null,
): Record<string, unknown> {
  const trimmed = rawText.trim();
  const isSse = contentType.toLowerCase().includes("text/event-stream") || trimmed.startsWith("data:") || trimmed.startsWith("event:");

  if (!isSse) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return record(parsed, "jsonrpc");
    } catch {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "malformed_provider_response",
        mcpErrorCode: "malformed_provider_response",
        calendarId,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP returned invalid JSON.",
      }));
    }
  }

  // Parse SSE `data:` framing; take the last JSON-RPC message carrying `result` or `error`.
  const dataLines: string[] = [];
  const messages: Record<string, unknown>[] = [];
  const flush = () => {
    if (dataLines.length === 0) return;
    const joined = dataLines.join("\n").trim();
    dataLines.length = 0;
    if (!joined || joined === "[DONE]") return;
    try {
      const parsed = JSON.parse(joined) as unknown;
      const obj = asOptionalRecord(parsed);
      if (obj) messages.push(obj);
    } catch {
      throw new GoogleCalendarMcpProviderError(mcpFailure({
        code: "malformed_provider_response",
        mcpErrorCode: "malformed_provider_response",
        calendarId,
        retryable: false,
        retryAfterSeconds: null,
        message: "Google Calendar MCP returned invalid SSE JSON payload.",
      }));
    }
  };

  for (const line of rawText.split(/\r?\n/)) {
    if (line.trim() === "") {
      flush();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();

  const responseMessage = [...messages].reverse().find(
    (msg) => "result" in msg || "error" in msg,
  );
  if (!responseMessage) {
    throw new GoogleCalendarMcpProviderError(mcpFailure({
      code: "malformed_provider_response",
      mcpErrorCode: "malformed_provider_response",
      calendarId,
      retryable: false,
      retryAfterSeconds: null,
      message: "Google Calendar MCP SSE stream contained no JSON-RPC response.",
    }));
  }
  return responseMessage;
}

function extractMcpToolPayload(
  resultRecord: Record<string, unknown>,
  calendarId: string | null,
): unknown {
  if (resultRecord.structuredContent !== undefined) {
    return resultRecord.structuredContent;
  }
  const content = resultRecord.content;
  if (Array.isArray(content)) {
    const textPart = content.find((entry) => {
      const item = asOptionalRecord(entry);
      return item?.type === "text" && typeof item.text === "string";
    }) as Record<string, unknown> | undefined;
    if (textPart && typeof textPart.text === "string") {
      try {
        return JSON.parse(textPart.text);
      } catch {
        throw new GoogleCalendarMcpProviderError(mcpFailure({
          code: "malformed_provider_response",
          mcpErrorCode: "malformed_provider_response",
          calendarId,
          retryable: false,
          retryAfterSeconds: null,
          message: "Google Calendar MCP text content was not valid JSON.",
        }));
      }
    }
  }
  return resultRecord;
}

function parseMcpEventsPage(value: unknown, calendarId: string): Readonly<{
  items: unknown[];
  nextPageToken: string | null;
}> {
  try {
    const page = record(value, "page");
    const rawItems = page.events ?? page.items;
    const items = rawItems === undefined ? [] : array(rawItems, "page.items");
    const rawNext = page.nextPageToken ?? page.next_page_token;
    const nextPageToken = rawNext === undefined || rawNext === null || rawNext === ""
      ? null
      : requiredString(rawNext, "page.nextPageToken");
    return { items, nextPageToken };
  } catch (error) {
    throw new McpRequestError(mcpFailure({
      code: "malformed_provider_response",
      mcpErrorCode: "malformed_provider_response",
      calendarId,
      retryable: false,
      retryAfterSeconds: null,
      message: error instanceof Error ? error.message : "Google Calendar MCP returned a malformed events page.",
    }), 0);
  }
}

function mapMcpHttpFailure(
  status: number,
  calendarId: string | null,
  retryAfter: number | null,
): GoogleCalendarMcpFailure {
  if (status === 401) {
    // NEVER signal credential deletion on MCP HTTP 401.
    return mcpFailure({
      code: "unauthenticated",
      mcpErrorCode: "mcp_unauthorized",
      calendarId,
      retryable: false,
      retryAfterSeconds: null,
      message: "Google Calendar MCP rejected the access token (HTTP 401).",
    });
  }
  if (status === 403) {
    return mcpFailure({
      code: "permission_denied",
      mcpErrorCode: "permission_denied",
      calendarId,
      retryable: false,
      retryAfterSeconds: null,
      message: "Google Calendar MCP denied access (HTTP 403).",
    });
  }
  if (status === 429) {
    return mcpFailure({
      code: "rate_limited",
      mcpErrorCode: "rate_limited",
      calendarId,
      retryable: true,
      retryAfterSeconds: retryAfter,
      message: "Google Calendar MCP rate limited the request (HTTP 429).",
    });
  }
  if (status >= 500) {
    return mcpFailure({
      code: "provider_unavailable",
      mcpErrorCode: "provider_unavailable",
      calendarId,
      retryable: true,
      retryAfterSeconds: retryAfter,
      message: `Google Calendar MCP is unavailable (HTTP ${status}).`,
    });
  }
  if (status === 400) {
    return mcpFailure({
      code: "invalid_request",
      mcpErrorCode: "invalid_request",
      calendarId,
      retryable: false,
      retryAfterSeconds: null,
      message: "Google Calendar MCP rejected the request (HTTP 400).",
    });
  }
  return mcpFailure({
    code: "provider_unavailable",
    mcpErrorCode: "provider_unavailable",
    calendarId,
    retryable: false,
    retryAfterSeconds: null,
    message: `Google Calendar MCP failed with HTTP ${status}.`,
  });
}

function mcpFailure(input: Readonly<{
  code: ExternalEventErrorCode;
  mcpErrorCode: GoogleCalendarMcpErrorCode;
  calendarId: string | null;
  retryable: boolean;
  retryAfterSeconds: number | null;
  message: string;
}>): GoogleCalendarMcpFailure {
  return {
    code: input.code,
    calendarId: input.calendarId,
    retryable: input.retryable,
    retryAfterSeconds: input.retryAfterSeconds,
    message: input.message,
    mcpErrorCode: input.mcpErrorCode,
    deleteCredential: false,
  };
}

function toExternalEventFailure(failure: GoogleCalendarMcpFailure): ExternalEventFailure {
  return {
    code: failure.code,
    calendarId: failure.calendarId,
    retryable: failure.retryable,
    retryAfterSeconds: failure.retryAfterSeconds,
    message: failure.message,
  };
}

function buildSnapshot(input: Readonly<{
  input: GoogleCalendarMcpReadInput;
  completeness: "complete" | "incomplete";
  coverage: ExternalEventSnapshotV1["coverage"];
  failures: ExternalEventFailure[];
  events: NormalizedExternalEvent[];
  tombstones: ExternalEventCancellationTombstone[];
}>): ExternalEventSnapshotV1 {
  const complete = input.completeness === "complete";
  return validateExternalEventSnapshot({
    schemaVersion: EXTERNAL_EVENT_SCHEMA_VERSION,
    adapterVersion: EXTERNAL_EVENT_ADAPTER_VERSION,
    accountId: input.input.accountId,
    connectionGeneration: input.input.connectionGeneration,
    source: "google_calendar",
    requestedRange: input.input.range,
    fetchedAt: input.input.fetchedAt,
    completeness: input.completeness,
    freshness: {
      state: complete ? "current" : "incomplete",
      refreshedAt: complete ? input.input.fetchedAt : null,
      label: complete ? "Calendar current" : "Calendar data incomplete",
      canAssertNoOverlap: complete,
    },
    capabilities: buildCapabilities(complete, input.failures),
    coverage: input.coverage,
    failures: input.failures,
    events: input.events.sort(compareIdentity),
    tombstones: input.tombstones.sort(compareIdentity),
  });
}

function buildCapabilities(
  complete: boolean,
  failures: ExternalEventFailure[],
): ExternalEventCapabilities {
  const permission = failures.some((item) => item.code === "permission_denied")
    ? "denied" as const
    : failures.some((item) => item.code === "reconnect_required" || item.code === "unauthenticated")
      ? "unknown" as const
      : "granted" as const;
  const capability = {
    support: "supported" as const,
    permission,
    availability: complete ? "available" as const : "degraded" as const,
  };
  return {
    calendar_listing: capability,
    timed_events: capability,
    all_day_events: capability,
    recurrence: capability,
    details: capability,
    source_links: capability,
  };
}

function coverageFor(
  calendarId: string,
  range: ExternalEventRequestedRange,
  paginationComplete: boolean,
  itemCount: number,
): ExternalEventSnapshotV1["coverage"][number] {
  return {
    calendarId,
    startLocalDate: range.startLocalDate,
    endLocalDate: range.endLocalDate,
    paginationComplete,
    itemCount,
  };
}

function validateReadInput(input: GoogleCalendarMcpReadInput): void {
  if (!input.accessToken || !input.accountId || !Number.isSafeInteger(input.connectionGeneration) || input.connectionGeneration < 1) {
    throw new TypeError("Google Calendar MCP reads require a token, account, and positive connection generation.");
  }
  Temporal.Instant.from(input.fetchedAt);
  const start = Temporal.PlainDate.from(input.range.startLocalDate);
  const end = Temporal.PlainDate.from(input.range.endLocalDate);
  start.toZonedDateTime(input.range.timezone);
  if (start.until(end).days < 0 || start.until(end).days + 1 > EXTERNAL_EVENT_MAX_RANGE_DAYS) {
    throw new RangeError(`Google Calendar MCP reads must cover 1-${EXTERNAL_EVENT_MAX_RANGE_DAYS} days.`);
  }
  if (input.calendars.length < 1 || input.calendars.length > EXTERNAL_EVENT_MAX_CALENDARS) {
    throw new RangeError(`Google Calendar MCP reads require 1-${EXTERNAL_EVENT_MAX_CALENDARS} calendars.`);
  }
  const ids = input.calendars.map((calendar) => calendar.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new TypeError("Google Calendar IDs must be non-empty and unique.");
  }
  if (ids.length !== input.range.selectedCalendarIds.length || ids.some((id) => !input.range.selectedCalendarIds.includes(id))) {
    throw new TypeError("Google Calendar MCP input must match the selected calendar set.");
  }
  for (const calendar of input.calendars) {
    if (!calendar.name) {
      throw new TypeError("Google Calendar metadata requires a non-empty name.");
    }
    if (calendar.timezone) {
      Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(calendar.timezone);
    }
  }
}

function setFieldAvailability(
  target: Partial<Record<ExternalEventField, ExternalEventFieldAvailability>>,
  field: ExternalEventField,
  value: unknown,
  restricted: boolean,
  omitted = false,
): void {
  if (value !== undefined && value !== null) return;
  target[field] = omitted ? "provider_omitted" : restricted ? "restricted" : "not_provided";
}

function sourceTimezone(
  start: Record<string, unknown>,
  end: Record<string, unknown>,
  context: Readonly<{ calendar: GoogleCalendarMcpCalendar; requestTimezone: string }>,
): Readonly<{ timezone: string; fallback: ExternalEventSourceTimezoneFallback }> {
  const providerTimezone = optionalString(start.timeZone, "event.start.timeZone")
    ?? optionalString(end.timeZone, "event.end.timeZone");
  const timezone = providerTimezone ?? context.calendar.timezone ?? context.requestTimezone;
  Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(timezone);
  return {
    timezone,
    fallback: providerTimezone ? "none" : context.calendar.timezone ? "calendar" : "request",
  };
}

function adaptRevision(item: Record<string, unknown>): ExternalEventRevision {
  const providerUpdatedAt = item.updated === undefined || item.updated === null
    ? null
    : instantString(item.updated, "event.updated");
  const providerEtag = optionalString(item.etag, "event.etag");
  return {
    availability: providerUpdatedAt || providerEtag ? "available" : "unavailable",
    providerUpdatedAt,
    providerEtag,
  };
}

function adaptRecurrence(
  item: Record<string, unknown>,
  context: Readonly<{ calendar: GoogleCalendarMcpCalendar; requestTimezone: string }>,
): NormalizedExternalEvent["recurrence"] {
  if (item.recurringEventId === undefined || item.recurringEventId === null) return null;
  const seriesId = requiredString(item.recurringEventId, "event.recurringEventId");
  if (item.originalStartTime === undefined || item.originalStartTime === null) return null;
  const rawOriginal = record(item.originalStartTime, "event.originalStartTime");
  let originalStart: ExternalEventOriginalStart;
  if (rawOriginal.dateTime !== undefined) {
    const tz = optionalString(rawOriginal.timeZone, "event.originalStartTime.timeZone")
      ?? context.calendar.timezone
      ?? context.requestTimezone;
    originalStart = {
      kind: "timed",
      startAt: parseInstantOrLocalDateTime(rawOriginal.dateTime, tz, "event.originalStartTime.dateTime"),
    };
  } else if (rawOriginal.date !== undefined) {
    originalStart = { kind: "all_day", startLocalDate: dateString(rawOriginal.date, "event.originalStartTime.date") };
  } else {
    throw new McpItemError("event.originalStartTime requires dateTime or date");
  }
  return { seriesId, originalStart };
}

function adaptOrganizer(value: unknown): NormalizedExternalEvent["organizer"] {
  if (value === undefined || value === null) return null;
  const organizer = record(value, "event.organizer");
  return {
    displayName: nullablePlainText(organizer.displayName, "event.organizer.displayName", 512),
    email: optionalString(organizer.email, "event.organizer.email"),
    self: optionalBoolean(organizer.self, "event.organizer.self") ?? false,
  };
}

function adaptAttendees(value: unknown): NormalizedExternalEvent["attendees"] {
  if (value === undefined || value === null) return null;
  const values = array(value, "event.attendees");
  if (values.length > 100) throw new McpItemError("event.attendees cannot exceed 100 entries");
  return values.map((entry, index) => {
    const attendee = record(entry, `event.attendees[${index}]`);
    return {
      displayName: nullablePlainText(attendee.displayName, `event.attendees[${index}].displayName`, 512),
      email: optionalString(attendee.email, `event.attendees[${index}].email`),
      responseStatus: adaptResponseStatus(attendee.responseStatus),
      optional: optionalBoolean(attendee.optional, `event.attendees[${index}].optional`) ?? false,
      organizer: optionalBoolean(attendee.organizer, `event.attendees[${index}].organizer`) ?? false,
      self: optionalBoolean(attendee.self, `event.attendees[${index}].self`) ?? false,
    };
  });
}

function adaptConference(item: Record<string, unknown>): NormalizedExternalEvent["conference"] {
  if (item.conferenceData === undefined && item.hangoutLink === undefined) return null;
  const data = item.conferenceData === undefined || item.conferenceData === null
    ? {}
    : record(item.conferenceData, "event.conferenceData");
  const solution = data.conferenceSolution === undefined || data.conferenceSolution === null
    ? null
    : record(data.conferenceSolution, "event.conferenceData.conferenceSolution");
  const name = solution?.name === undefined
    ? null
    : nullablePlainText(solution.name, "event.conferenceData.conferenceSolution.name", 512);
  const rawEntries = data.entryPoints === undefined ? [] : array(data.entryPoints, "event.conferenceData.entryPoints");
  const entryPoints = rawEntries.slice(0, MAX_CONFERENCE_ENTRY_POINTS).map((value, index) => {
    const entry = record(value, `event.conferenceData.entryPoints[${index}]`);
    const type: "video" | "phone" | "sip" | "more" | "unknown" =
      entry.entryPointType === "video" ||
      entry.entryPointType === "phone" ||
      entry.entryPointType === "sip" ||
      entry.entryPointType === "more"
        ? entry.entryPointType
        : "unknown";
    return {
      type,
      uri: conferenceUri(entry.uri, type, `event.conferenceData.entryPoints[${index}].uri`),
      label: nullablePlainText(entry.label, `event.conferenceData.entryPoints[${index}].label`, 512),
    };
  });
  if (entryPoints.length === 0 && item.hangoutLink !== undefined && item.hangoutLink !== null) {
    entryPoints.push({
      type: "video",
      uri: requiredHttpsUrl(item.hangoutLink, "event.hangoutLink"),
      label: null,
    });
  }
  const notes = data.notes === undefined || data.notes === null
    ? null
    : sanitizeGoogleCalendarText(textString(data.notes, "event.conferenceData.notes"), 8_192, true);
  return { name, entryPoints, notes };
}

function adaptAttachments(value: unknown): NormalizedExternalEvent["attachments"] {
  if (value === undefined || value === null) return null;
  const attachments = array(value, "event.attachments");
  if (attachments.length > 25) throw new McpItemError("event.attachments cannot exceed 25 entries");
  return attachments.map((entry, index) => {
    const attachment = record(entry, `event.attachments[${index}]`);
    return {
      title: nullablePlainText(attachment.title, `event.attachments[${index}].title`, 1_024),
      mimeType: optionalString(attachment.mimeType, `event.attachments[${index}].mimeType`),
      url: requiredHttpsUrl(attachment.fileUrl, `event.attachments[${index}].fileUrl`),
    };
  });
}

function adaptEventState(value: unknown): NormalizedExternalEvent["state"] {
  if (value === undefined || value === null) return "confirmed";
  if (typeof value !== "string") throw new McpItemError("event.status must be a string");
  const lower = value.toLowerCase();
  if (lower === "confirmed") return "confirmed";
  if (lower === "tentative") return "tentative";
  return "unknown";
}

function currentUserResponse(attendees: NormalizedExternalEvent["attendees"]): ExternalEventResponseStatus | null {
  return attendees?.find((attendee) => attendee.self)?.responseStatus ?? null;
}

function adaptResponseStatus(value: unknown): ExternalEventResponseStatus {
  if (value === undefined || value === null) return "unknown";
  if (typeof value !== "string") throw new McpItemError("attendee responseStatus must be a string");
  const lower = value.trim().toLowerCase();
  if (lower === "needsaction" || lower === "needs_action") return "needs_action";
  if (lower === "declined" || lower === "tentative" || lower === "accepted") return lower;
  return "unknown";
}

function logicalId(
  item: Record<string, unknown>,
  recurrence: NormalizedExternalEvent["recurrence"],
  calendarId: string,
  eventId: string,
  context: Readonly<{ calendar: GoogleCalendarMcpCalendar; requestTimezone: string }>,
): string {
  const iCalUid = optionalString(item.iCalUID, "event.iCalUID");
  if (!iCalUid) return normalizedId(calendarId, eventId);
  const original = recurrence?.originalStart;
  const occurrence = original?.kind === "timed"
    ? original.startAt
    : original?.kind === "all_day"
      ? original.startLocalDate
      : item.start === undefined
        ? eventId
        : startIdentity(item, context);
  return `google_calendar/${encodeURIComponent(iCalUid)}/${encodeURIComponent(occurrence)}`;
}

function startIdentity(
  item: Record<string, unknown>,
  context: Readonly<{ calendar: GoogleCalendarMcpCalendar; requestTimezone: string }>,
): string {
  const start = record(item.start, "event.start");
  if (start.dateTime !== undefined) {
    const tz = optionalString(start.timeZone, "event.start.timeZone")
      ?? context.calendar.timezone
      ?? context.requestTimezone;
    return parseInstantOrLocalDateTime(start.dateTime, tz, "event.start.dateTime");
  }
  if (start.date !== undefined) return dateString(start.date, "event.start.date");
  throw new McpItemError("event.start requires dateTime or date");
}

function normalizedId(calendarId: string, eventId: string): string {
  return `google_calendar/${encodeURIComponent(calendarId)}/${encodeURIComponent(eventId)}`;
}

function conferenceProviderEntryCount(item: Record<string, unknown>): number {
  if (item.conferenceData === undefined || item.conferenceData === null) {
    return item.hangoutLink === undefined || item.hangoutLink === null ? 0 : 1;
  }
  const data = record(item.conferenceData, "event.conferenceData");
  return data.entryPoints === undefined
    ? (item.hangoutLink === undefined || item.hangoutLink === null ? 0 : 1)
    : array(data.entryPoints, "event.conferenceData.entryPoints").length;
}

function conferenceUri(value: unknown, type: string, path: string): string {
  const uri = requiredString(value, path);
  const protocol = type === "phone" ? "tel:" : type === "sip" ? "sip:" : "https:";
  if (!uri.startsWith(protocol)) throw new McpItemError(`${path} must use ${protocol}`);
  if (protocol === "https:") requiredHttpsUrl(uri, path);
  return uri;
}

function requiredHttpsUrl(value: unknown, path: string): string {
  const text = requiredString(value, path);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new McpItemError(`${path} must be a valid HTTPS URL`);
  }
}

function optionalHttpsUrl(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : requiredHttpsUrl(value, path);
}

function parseInstantOrLocalDateTime(value: unknown, timezone: string, path: string): string {
  const source = requiredString(value, path);
  try {
    return Temporal.Instant.from(source).toString();
  } catch {
    try {
      return Temporal.PlainDateTime.from(source).toZonedDateTime(timezone).toInstant().toString();
    } catch {
      throw new McpItemError(`${path} must be a valid instant or local ISO datetime`);
    }
  }
}

function instantString(value: unknown, path: string): string {
  try {
    return Temporal.Instant.from(requiredString(value, path)).toString();
  } catch (error) {
    if (error instanceof McpItemError) throw error;
    throw new McpItemError(`${path} must be a valid instant`);
  }
}

function dateString(value: unknown, path: string): string {
  try {
    const source = requiredString(value, path);
    const parsed = Temporal.PlainDate.from(source).toString();
    if (parsed !== source) throw new Error();
    return parsed;
  } catch (error) {
    if (error instanceof McpItemError) throw error;
    throw new McpItemError(`${path} must be a valid date`);
  }
}

function nullablePlainText(value: unknown, path: string, maximumLength: number): string | null {
  return value === undefined || value === null
    ? null
    : sanitizeGoogleCalendarText(textString(value, path), maximumLength, false);
}

function optionalString(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : requiredString(value, path);
}

function textString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new McpItemError(`${path} must be a string`);
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new McpItemError(`${path} must be a non-empty string`);
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new McpItemError(`${path} must be a boolean`);
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpItemError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new McpItemError(`${path} must be an array`);
  return value;
}

function compareIdentity(
  left: { calendarId: string; providerEventId: string },
  right: { calendarId: string; providerEventId: string },
): number {
  return left.calendarId.localeCompare(right.calendarId) || left.providerEventId.localeCompare(right.providerEventId);
}

function retryAfterSeconds(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return Math.min(Number(value), 300);
}

function backoffMilliseconds(attempt: number, retryAfter: number | null, random: () => number): number {
  if (retryAfter !== null) return retryAfter * 1_000;
  return Math.min(5_000, 250 * (2 ** attempt) + Math.floor(random() * 100));
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Value must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}
