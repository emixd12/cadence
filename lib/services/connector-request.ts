import { ConnectorError, type ConnectorErrorCode } from "@/lib/types/connectors";
import { CalendarConnectionError } from "./google-calendar-oauth";
import { authenticateCalendarRequest, calendarPreflight, calendarResponse, readCalendarRequestBody } from "./google-calendar-request";
import type { ConnectorCaller } from "./connector-credentials";

// Ticket 222 request boundary for the new connector routes. It reuses the Google
// Calendar caller authentication: a user JWT from web cookies or a desktop bearer
// token, same-origin writes, the fixed Tauri origins, and no-store responses.
// Error bodies carry only a stable code; messages, causes, and provider bodies
// never reach the client.
export const connectorPreflight = calendarPreflight;
export const authenticateConnectorRequest: (request: Request) => Promise<ConnectorCaller> = authenticateCalendarRequest;

const CREDENTIAL_BODY_LIMIT = 8_192;
function statusFor(code: ConnectorErrorCode): number {
  if (code === "unauthenticated") return 401;
  if (code === "invalid_request") return 400;
  if (code === "not_configured") return 503;
  if (code === "rate_limited") return 429;
  return 409;
}
function codeFor(error: unknown): ConnectorErrorCode {
  if (error instanceof ConnectorError) return error.code;
  if (error instanceof CalendarConnectionError && (error.code === "unauthenticated" || error.code === "invalid_request")) return error.code;
  return "provider_unavailable";
}
export async function runConnectorRequest(request: Request, run: (caller: ConnectorCaller) => Promise<unknown>): Promise<Response> {
  try { return calendarResponse(request, await run(await authenticateConnectorRequest(request))); }
  catch (error) {
    const code = codeFor(error);
    return calendarResponse(request, { error: code }, statusFor(code));
  }
}
/** Reads a small JSON credential submission. The caller must discard it after sealing. */
export async function readConnectorCredentialBody(request: Request): Promise<unknown> {
  try { return await readCalendarRequestBody(request, CREDENTIAL_BODY_LIMIT); }
  catch { throw new ConnectorError("invalid_request"); }
}
