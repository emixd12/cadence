/**
 * MCP Apps view resources (Ticket 376, D36): `resources/list` and `resources/read` for the
 * one "Cadence day" view. View HTML is the only resource Cadence serves.
 *
 * Both methods need a grant with `cadence.read`, count against the per-grant read limit
 * and write one activity row. `resources/read` answers the exact known URI only.
 */
import { createIntegrationError, type IntegrationError } from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { admitTransportRead, recordTransportRead } from "@/lib/integrations/transport-read";
import { DAY_VIEW_URI, MCP_APP_MIME_TYPE, MCP_APP_RESOURCE_BYTE_CAP, MCP_APPS_READ_LABELS } from "./config";
import { DAY_VIEW_HTML } from "./day-view-html";

type ViewUiMeta = { prefersBorder: boolean; csp: { connectDomains: string[]; resourceDomains: string[] } };
/** An explicit empty CSP: the view may connect to nothing and load nothing from outside itself. */
const viewUiMeta = (): ViewUiMeta => ({ prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } });

export type AppResourceDescriptor = {
  uri: string; name: string; title: string; description: string; mimeType: string; _meta: { ui: ViewUiMeta };
};
export type AppResourceContents = { uri: string; mimeType: string; text: string; _meta: { ui: ViewUiMeta } };

const DAY_VIEW_DESCRIPTOR = {
  uri: DAY_VIEW_URI, name: "cadence-day", title: "Cadence day", mimeType: MCP_APP_MIME_TYPE,
  description: "The Cadence day view: one day's Occurrences with Completed, Not Completed and Note.",
} as const;

export type ListAppResourcesResult = { ok: true; resources: AppResourceDescriptor[] } | { ok: false; error: IntegrationError };
export type ReadAppResourceResult = { ok: true; contents: AppResourceContents[] } | { ok: false; error: IntegrationError };

/** Descriptors only: no HTML travels in `resources/list`. */
export async function listAppResources(context: IntegrationContext): Promise<ListAppResourcesResult> {
  const refused = await admitTransportRead(context, MCP_APPS_READ_LABELS.listResources);
  if (refused) return { ok: false, error: refused };
  const unrecorded = await recordTransportRead(context, MCP_APPS_READ_LABELS.listResources, null);
  if (unrecorded) return { ok: false, error: unrecorded };
  return { ok: true, resources: [{ ...DAY_VIEW_DESCRIPTOR, _meta: { ui: viewUiMeta() } }] };
}

/** The view HTML when it is within the byte cap; an error otherwise. Never a truncated document. */
export function dayViewHtml(html: string = DAY_VIEW_HTML): { ok: true; html: string } | { ok: false; error: IntegrationError } {
  return Buffer.byteLength(html, "utf8") > MCP_APP_RESOURCE_BYTE_CAP
    ? { ok: false, error: createIntegrationError("internal_error", "The view is larger than its size limit, so Cadence did not send it.") }
    : { ok: true, html };
}

/** The exact known URI only. An unknown URI still counts as one read against the limit. */
export async function readAppResource(context: IntegrationContext, uri: unknown): Promise<ReadAppResourceResult> {
  const refused = await admitTransportRead(context, MCP_APPS_READ_LABELS.readResource);
  if (refused) return { ok: false, error: refused };
  const view = uri === DAY_VIEW_URI ? dayViewHtml() : { ok: false as const, error: createIntegrationError("not_found", "No resource with that URI exists.") };
  const unrecorded = await recordTransportRead(context, MCP_APPS_READ_LABELS.readResource, view.ok ? null : view.error);
  if (unrecorded) return { ok: false, error: unrecorded };
  if (!view.ok) return { ok: false, error: view.error };
  return { ok: true, contents: [{ uri: DAY_VIEW_URI, mimeType: MCP_APP_MIME_TYPE, text: view.html, _meta: { ui: viewUiMeta() } }] };
}
