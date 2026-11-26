/**
 * MCP Apps trial (Ticket 376, D36): the flag and the fixed names. `show_day` and the
 * view resources live in the transport layer, outside the contract registry.
 */

export const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
/** A breaking view change gets a new URI (`docs/qa/2026-11-26-mcp-apps-spike.md`). */
export const DAY_VIEW_URI = "ui://cadence/day/v1.html";
export const SHOW_DAY_TOOL_NAME = "show_day";
/** Result `_meta` key that carries the grant's scopes to the view, outside the model's context. */
export const GRANTED_SCOPES_META_KEY = "com.cadence-me/granted_scopes";
/** Largest view HTML `resources/read` serves, in UTF-8 bytes. A larger build is refused, never truncated. */
export const MCP_APP_RESOURCE_BYTE_CAP = 1_048_576;

/**
 * Labels for the activity row and the `cadence_mcp` log line. The activity table accepts
 * only `^[a-z][a-z0-9_]{0,63}$`, so the MCP method names (`resources/read`) cannot be used.
 */
export const MCP_APPS_READ_LABELS = Object.freeze({
  showDay: SHOW_DAY_TOOL_NAME,
  listResources: "list_view_resources",
  readResource: "read_view_resource",
} as const);

/** Server-only. Only the exact value `true` enables the trial; default off. */
export function mcpAppsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.CADENCE_MCP_APPS === "true";
}
