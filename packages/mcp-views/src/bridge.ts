// The day view's connection to its host, on @modelcontextprotocol/ext-apps. This is the
// only file that imports the SDK. It sends `ui/initialize`, receives the `show_day`
// result, proxies the four server tools and reports the view's size.
import { App, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

import type { Bridge, ToolResult } from "./contract";

export type HostHandlers = Readonly<{
  /** The `show_day` result that opened the view. */
  onDayResult(result: ToolResult): void;
  /** The host cancelled the tool call, so no result will come. */
  onCancelled(): void;
}>;

/**
 * Takes the host's theme, style variables and safe area. Host fonts are not applied:
 * they are CSS the host supplies and may name files the view must never request.
 */
function applyHostContext(context: McpUiHostContext | undefined): void {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  const insets = context.safeAreaInsets;
  if (insets) {
    const style = document.documentElement.style;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      style.setProperty(`--day-safe-${side}`, `${Math.max(0, Number(insets[side]) || 0)}px`);
    }
  }
}

export async function connectHostBridge(handlers: HostHandlers): Promise<Bridge> {
  const app = new App({ name: "Cadence day", version: "1.0.0" });
  // Handlers are set before connecting, so the first tool result is not missed.
  app.ontoolresult = (params) => handlers.onDayResult(params as ToolResult);
  app.ontoolcancelled = () => handlers.onCancelled();
  app.onhostcontextchanged = (context) => applyHostContext(context);
  // No transport argument: the SDK picks the transport the host provides.
  await app.connect();
  applyHostContext(app.getHostContext());
  return {
    callTool: async (name, args) => (await app.callServerTool({ name, arguments: args })) as ToolResult,
    updateModelContext: async (text) => {
      await app.updateModelContext({ content: [{ type: "text", text }] });
    },
  };
}
