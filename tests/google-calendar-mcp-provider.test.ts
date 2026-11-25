import { describe, expect, it, vi } from "vitest";

import {
  assertAllowedGoogleCalendarMcpTool,
  callGoogleCalendarMcpTool,
  GoogleCalendarMcpDisallowedToolError,
  GoogleCalendarMcpProviderError,
  listGoogleCalendarMcpCalendars,
  readGoogleCalendarMcpEvents,
  type GoogleCalendarMcpCalendar,
} from "@/lib/services/google-calendar-mcp-provider";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";

const BASE_CALENDAR: GoogleCalendarMcpCalendar = {
  id: "primary",
  name: "Primary",
  timezone: "America/New_York",
  primary: true,
  selected: true,
  accessRole: "owner",
};

const BASE_RANGE = {
  startLocalDate: "2026-11-25",
  endLocalDate: "2026-11-26",
  timezone: "America/New_York",
  selectedCalendarIds: ["primary"],
};

function jsonRpcResponse(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      result: {
        structuredContent: payload,
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    },
  );
}

describe("google-calendar-mcp-provider", () => {
  it("enforces strict tool allowlist (list_calendars and list_events only)", async () => {
    expect(() => assertAllowedGoogleCalendarMcpTool("list_calendars")).not.toThrow();
    expect(() => assertAllowedGoogleCalendarMcpTool("list_events")).not.toThrow();
    expect(() => assertAllowedGoogleCalendarMcpTool("create_event")).toThrow(
      GoogleCalendarMcpDisallowedToolError,
    );

    const fetchMock = vi.fn();
    await expect(
      callGoogleCalendarMcpTool({
        accessToken: "tok",
        toolName: "delete_event",
        arguments: { eventId: "e1" },
        fetch: fetchMock,
      }),
    ).rejects.toBeInstanceOf(GoogleCalendarMcpDisallowedToolError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses application/json and text/event-stream (SSE) responses and passes MCP-Session-Id", async () => {
    const seenSessionIds: Array<string | null> = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenSessionIds.push(headers.get("MCP-Session-Id"));
      if (seenSessionIds.length === 1) {
        return new Response(
          [
            "event: message",
            `data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: "list-calendars-1",
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      calendars: [
                        { id: "work@example.com", summary: "Work", timeZone: "America/New_York", accessRole: "writer" },
                        { id: "fb@example.com", summary: "FreeBusy", timeZone: "America/New_York", accessRole: "freeBusyReader" },
                      ],
                      nextPageToken: "page-2",
                    }),
                  },
                ],
              },
            })}`,
            "",
          ].join("\n"),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "mcp-session-id": "sess-123",
            },
          },
        );
      }
      return jsonRpcResponse({
        calendars: [
          { id: "personal@example.com", summary: "Personal", accessRole: "owner" },
        ],
      });
    });

    const calendars = await listGoogleCalendarMcpCalendars({
      accessToken: "tok",
      endpointUrl: "https://mcp.test/v1",
      fetch: fetchMock,
    });

    expect(seenSessionIds).toEqual([null, "sess-123"]);
    expect(calendars).toEqual([
      {
        id: "personal@example.com",
        name: "Personal",
        timezone: "UTC",
        primary: false,
        selected: false,
        accessRole: "owner",
      },
      {
        id: "work@example.com",
        name: "Work",
        timezone: "America/New_York",
        primary: false,
        selected: false,
        accessRole: "writer",
      },
    ]);
  });

  it("reads events with offset-free local ISO startTime/endTime, normalizes AVAILABILITY_FREE, all-day, tombstones, and validates snapshot", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonRpcResponse({
        events: [
          {
            id: "evt-free",
            status: "confirmed",
            summary: "Focus\u0007 Block",
            location: "Home Office",
            availability: "AVAILABILITY_FREE",
            start: { dateTime: "2026-11-25T09:00:00-05:00", timeZone: "America/New_York" },
            end: { dateTime: "2026-11-25T10:00:00-05:00", timeZone: "America/New_York" },
            attendees: [
              { email: "me@example.com", self: true, responseStatus: "accepted" },
            ],
          },
          {
            id: "evt-busy",
            status: "tentative",
            summary: "Dentist",
            availability: "AVAILABILITY_BUSY",
            start: { dateTime: "2026-11-25T14:00:00", timeZone: "America/New_York" },
            end: { dateTime: "2026-11-25T15:00:00", timeZone: "America/New_York" },
          },
          {
            id: "evt-allday",
            status: "confirmed",
            summary: "Holiday",
            start: { date: "2026-11-26" },
            end: { date: "2026-11-27" },
          },
          {
            id: "evt-cancelled",
            status: "cancelled",
          },
        ],
      });
    });

    const result = await readGoogleCalendarMcpEvents({
      accessToken: "tok",
      accountId: "user-1",
      connectionGeneration: 2,
      calendars: [BASE_CALENDAR],
      range: BASE_RANGE,
      fetchedAt: "2026-11-25T12:00:00Z",
      fetch: fetchMock,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    // Verify local offset-free ISO startTime/endTime + IANA timeZone + pageSize 250
    const params = (capturedBody as unknown as { params: { name: string; arguments: Record<string, unknown> } }).params;
    expect(params.name).toBe("list_events");
    expect(params.arguments).toMatchObject({
      calendarId: "primary",
      startTime: "2026-11-25T00:00:00",
      endTime: "2026-11-27T00:00:00",
      timeZone: "America/New_York",
      pageSize: 250,
    });

    // Validated against ExternalEventSnapshotV1 schema
    expect(() => validateExternalEventSnapshot(result.snapshot)).not.toThrow();
    expect(result.snapshot.completeness).toBe("complete");
    expect(result.snapshot.freshness.canAssertNoOverlap).toBe(true);
    expect(result.snapshot.events).toHaveLength(3);
    expect(result.snapshot.tombstones).toHaveLength(1);

    const freeEvt = result.snapshot.events.find((e) => e.providerEventId === "evt-free");
    expect(freeEvt?.availability).toBe("free");
    expect(freeEvt?.title).toBe("Focus Block");
    expect(freeEvt?.currentUserResponse).toBe("accepted");

    const busyEvt = result.snapshot.events.find((e) => e.providerEventId === "evt-busy");
    expect(busyEvt?.availability).toBe("busy");
    expect(busyEvt?.state).toBe("tentative");

    const allDayEvt = result.snapshot.events.find((e) => e.providerEventId === "evt-allday");
    expect(allDayEvt?.kind).toBe("all_day");
    if (allDayEvt?.kind === "all_day") {
      expect(allDayEvt.duration).toEqual({ kind: "calendar_days", days: 1 });
    }
  });

  it("enforces accessRole check and strips private details for freeBusyReader/none calendars", async () => {
    const fetchMock = vi.fn(async () =>
      jsonRpcResponse({
        events: [
          {
            id: "evt-secret",
            status: "confirmed",
            summary: "Confidential Therapy",
            location: "123 Secret St",
            description: "Private notes",
            start: { dateTime: "2026-11-25T10:00:00Z" },
            end: { dateTime: "2026-11-25T11:00:00Z" },
          },
        ],
      }),
    );

    const fbCalendar: GoogleCalendarMcpCalendar = {
      ...BASE_CALENDAR,
      id: "fb-cal",
      name: "Shared Busy",
      accessRole: "freeBusyReader",
    };

    const result = await readGoogleCalendarMcpEvents({
      accessToken: "tok",
      accountId: "user-1",
      connectionGeneration: 1,
      calendars: [fbCalendar],
      range: { ...BASE_RANGE, selectedCalendarIds: ["fb-cal"] },
      fetchedAt: "2026-11-25T12:00:00Z",
      fetch: fetchMock,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const evt = result.snapshot.events[0];
    expect(evt.title).toBe("");
    expect(evt.location).toBe("");
    expect(evt.description).toBe("");
    expect(evt.fieldAvailability.title).toBe("restricted");
    expect(evt.fieldAvailability.location).toBe("restricted");
  });

  it("never signals credential deletion on MCP HTTP 401 and returns typed mcp_unauthorized", async () => {
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));

    const result = await readGoogleCalendarMcpEvents({
      accessToken: "expired-tok",
      accountId: "user-1",
      connectionGeneration: 1,
      calendars: [BASE_CALENDAR],
      range: BASE_RANGE,
      fetchedAt: "2026-11-25T12:00:00Z",
      fetch: fetchMock,
      maxRetries: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error.code).toBe("unauthenticated");
    expect(result.error.mcpErrorCode).toBe("mcp_unauthorized");
    expect(result.error.deleteCredential).toBe(false);
    expect(result.error.retryable).toBe(false);
    expect(result.partialSnapshot.completeness).toBe("incomplete");
    expect(result.partialSnapshot.freshness.canAssertNoOverlap).toBe(false);
  });

  it("maps MCP HTTP 403 to non-retryable permission_denied", async () => {
    const fetchMock = vi.fn(async () => new Response("Forbidden", { status: 403 }));

    await expect(
      listGoogleCalendarMcpCalendars({
        accessToken: "tok",
        fetch: fetchMock,
        maxRetries: 2,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GoogleCalendarMcpProviderError);
      const failure = (error as GoogleCalendarMcpProviderError).failure;
      expect(failure.code).toBe("permission_denied");
      expect(failure.mcpErrorCode).toBe("permission_denied");
      expect(failure.retryable).toBe(false);
      expect(failure.deleteCredential).toBe(false);
      return true;
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries HTTP 200 JSON-RPC isError: true (billed on Scaled Tier)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          result: {
            isError: true,
            content: [{ type: "text", text: "Calendar not found" }],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await readGoogleCalendarMcpEvents({
      accessToken: "tok",
      accountId: "user-1",
      connectionGeneration: 1,
      calendars: [BASE_CALENDAR],
      range: BASE_RANGE,
      fetchedAt: "2026-11-25T12:00:00Z",
      fetch: fetchMock,
      maxRetries: 3,
      sleep: async () => {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error.mcpErrorCode).toBe("mcp_tool_error");
    expect(result.error.retryable).toBe(false);
  });

  it("maps HTTP 429 to rate_limited, retries up to maxRetries, and preserves partial snapshot honesty", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonRpcResponse({
          events: [
            {
              id: "evt-1",
              status: "confirmed",
              summary: "Standup",
              start: { dateTime: "2026-11-25T09:00:00Z" },
              end: { dateTime: "2026-11-25T09:30:00Z" },
            },
          ],
        });
      }
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "retry-after": "5" },
      });
    });

    const secondCalendar: GoogleCalendarMcpCalendar = {
      ...BASE_CALENDAR,
      id: "work",
      name: "Work",
      primary: false,
    };

    const result = await readGoogleCalendarMcpEvents({
      accessToken: "tok",
      accountId: "user-1",
      connectionGeneration: 1,
      calendars: [BASE_CALENDAR, secondCalendar],
      range: { ...BASE_RANGE, selectedCalendarIds: ["primary", "work"] },
      fetchedAt: "2026-11-25T12:00:00Z",
      fetch: fetchMock,
      maxRetries: 1,
      sleep: async () => {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("rate_limited");
    expect(result.error.retryable).toBe(true);
    expect(result.error.retryAfterSeconds).toBe(5);
    expect(result.partialSnapshot.completeness).toBe("incomplete");
    expect(result.partialSnapshot.freshness.canAssertNoOverlap).toBe(false);
    expect(result.partialSnapshot.events).toHaveLength(1);
    expect(() => validateExternalEventSnapshot(result.partialSnapshot)).not.toThrow();
  });
});
