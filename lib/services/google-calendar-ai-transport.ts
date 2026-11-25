/**
 * Server-only transport gate for Google Calendar AI reads (Google Workspace AI Tools Addendum).
 *
 * Only `"agent_mcp"` enables Google Calendar reads for AI features (Daily Brief, Advisor Chat,
 * opted-in longitudinal review). Any unset, empty, `"disabled"`, `"timeline"`, or unrecognized
 * value fails closed to `"disabled"`. REST / Timeline fallback for AI is never permitted.
 */
export const GOOGLE_CALENDAR_AI_TRANSPORT_ENV = "CADENCE_GOOGLE_CALENDAR_AI_TRANSPORT";

export type GoogleCalendarAiTransportMode = "disabled" | "agent_mcp";

export function readGoogleCalendarAiTransportMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GoogleCalendarAiTransportMode {
  const raw = env[GOOGLE_CALENDAR_AI_TRANSPORT_ENV]?.trim();
  if (raw === "agent_mcp") return "agent_mcp";
  return "disabled";
}

export function isGoogleCalendarAiTransportEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return readGoogleCalendarAiTransportMode(env) === "agent_mcp";
}
