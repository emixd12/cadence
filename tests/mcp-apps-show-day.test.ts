// Ticket 376: the `show_day` transport tool and the view resources, below the HTTP route.
// The frozen schema lives in docs/qa/2026-11-26-mcp-apps-spike.md; this file reads it from there.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS, INTEGRATION_OPERATION_NAMES, validateAgainstSchema, type JsonSchemaObject,
} from "@cadence/core/integration";
import { recordIntegrationActivity } from "@/lib/db/integration.repo";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import {
  DAY_VIEW_URI, GRANTED_SCOPES_META_KEY, MCP_APP_MIME_TYPE, MCP_APP_RESOURCE_BYTE_CAP, MCP_APPS_READ_LABELS, SHOW_DAY_TOOL_NAME, mcpAppsEnabled,
} from "@/lib/mcp/apps/config";
import { DAY_VIEW_HTML } from "@/lib/mcp/apps/day-view-html";
import { SHOW_DAY_INPUT_SCHEMA, SHOW_DAY_OUTPUT_SCHEMA, showDay, showDayTool } from "@/lib/mcp/apps/show-day";
import { dayViewHtml, listAppResources, readAppResource } from "@/lib/mcp/apps/view-resources";
import { getIntegrationDay } from "@/lib/services/integration-day.service";
import { IntegrationReadError } from "@/lib/services/integration-read.service";
import { consumeMcpRateLimit } from "@/lib/services/oauth/server";

vi.mock("@/lib/services/oauth/server", () => ({ consumeMcpRateLimit: vi.fn() }));
vi.mock("@/lib/db/integration.repo", () => ({ recordIntegrationActivity: vi.fn() }));
vi.mock("@/lib/services/integration-day.service", () => ({ getIntegrationDay: vi.fn() }));
vi.mock("@/lib/services/integration-read.service", () => {
  class IntegrationReadError extends Error {
    readonly error: { code: string; message: string };
    constructor(code: string, message: string) { super(message); this.error = { code, message }; }
  }
  return { IntegrationReadError };
});

const NOTE = "Private note: knee hurt after the run";
const context = (scopes: string[] = ["cadence.occurrences.write", "cadence.read"]) => ({ userId: "user-a", supabase: {}, now: new Date("2026-11-25T15:00:00Z"),
  tokenExpiresAt: new Date(), actor: { channel: "mcp", clientId: "client", clientLabel: "Test", grantId: "grant-a", grantedScopes: scopes } }) as unknown as IntegrationContext;
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const occurrence = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n), behavior_id: id(9), behavior_title: `Behavior ${n}`, category_name: null, local_date: "2026-11-25", timezone: "America/New_York",
  scheduled_for: "2026-11-25T13:00:00Z", effective_start_at: "2026-11-25T13:00:00Z", move: null,
  schedule: { kind: "exact", preset: null, start_time: "08:00", end_time: null, label: "8:00 AM" },
  status: "completed", status_label: "Completed", needs_decision: false, origin: "scheduled", added_by: null,
  completed_at: "2026-11-25T13:30:00Z", status_marked_at: "2026-11-25T13:30:00Z", note: NOTE, parent_behavior_id: null, parent_title: null,
  updated_at: "2026-11-25T13:30:00Z", revision: "r1", connector_completion: { source: "hevy", source_label: "Hevy" }, ...extra,
});
const day = (extra: Record<string, unknown> = {}, occurrenceExtra: Record<string, unknown> = {}) => ({
  local_date: "2026-11-25", is_today: true, timezone: "America/New_York", today_local_date: "2026-11-25", day_note: "Rest day",
  occurrences: [occurrence(1, occurrenceExtra), occurrence(2, { status: "unresolved", status_label: "Unresolved", completed_at: null, status_marked_at: null, note: null, connector_completion: null })],
  parent_groups: [], needs_decision: { count: 4, truncated: false },
  freshness: { as_of: "2026-11-25T15:00:00Z", occurrences_generated_through: "2026-12-25" }, ...extra,
});
const activity = () => vi.mocked(recordIntegrationActivity).mock.calls.map((call) => call[1]);

/** The fenced JSON block that follows a heading or marker in the spike note. */
function frozenJson(after: string): JsonSchemaObject {
  const note = fs.readFileSync(path.resolve(__dirname, "../docs/qa/2026-11-26-mcp-apps-spike.md"), "utf8");
  const from = note.indexOf(after);
  expect(from, `marker ${after}`).toBeGreaterThan(-1);
  const start = note.indexOf("```json", from) + "```json".length;
  return JSON.parse(note.slice(start, note.indexOf("```", start))) as JsonSchemaObject;
}
function walk(schema: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(schema)) { schema.forEach((child) => walk(child, visit)); return; }
  if (!schema || typeof schema !== "object") return;
  visit(schema as Record<string, unknown>);
  Object.values(schema).forEach((child) => walk(child, visit));
}

beforeEach(() => {
  vi.mocked(consumeMcpRateLimit).mockResolvedValue({ allowed: true, limit: 120, remaining: 119, resetAt: "", retryAfterSeconds: 1 });
  vi.mocked(recordIntegrationActivity).mockResolvedValue();
  vi.mocked(getIntegrationDay).mockResolvedValue(day() as never);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("the frozen show_day contract (Ticket 375 note)", () => {
  it("serves the frozen input and output schemas", () => {
    expect(SHOW_DAY_INPUT_SCHEMA).toEqual(frozenJson("### Input schema"));
    expect(SHOW_DAY_OUTPUT_SCHEMA).toEqual(frozenJson("Full output JSON Schema, as the spike served it"));
  });

  it("serves the frozen tool descriptor", () => {
    const tool = showDayTool() as unknown as Record<string, unknown>;
    expect(tool).toMatchObject({ name: "show_day", title: "Show day",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      securitySchemes: [{ type: "oauth2", scopes: ["cadence.read"] }],
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["cadence.read"] }], ui: { resourceUri: "ui://cadence/day/v1.html" } },
      inputSchema: { type: "object" }, outputSchema: { type: "object" } });
    // Visibility is omitted, so the model and the view may both call it.
    expect((tool._meta as { ui: Record<string, unknown> }).ui).toEqual({ resourceUri: DAY_VIEW_URI });
    expect(SHOW_DAY_TOOL_NAME).toBe("show_day");
    expect(GRANTED_SCOPES_META_KEY).toBe("com.cadence-me/granted_scopes");
  });

  it("stays outside the contract registry", () => {
    expect(INTEGRATION_OPERATION_NAMES as readonly string[]).not.toContain(SHOW_DAY_TOOL_NAME);
  });

  it("closes every output object and names no excluded data class", () => {
    walk(SHOW_DAY_OUTPUT_SCHEMA, (node) => {
      if (!node.properties) return;
      expect(node.additionalProperties, JSON.stringify(Object.keys(node.properties))).toBe(false);
      for (const key of Object.keys(node.properties as object)) {
        for (const fragment of [...INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS, "location", "leave", "period", "duration", "tracked"]) {
          expect(key.includes(fragment), `${key} contains ${fragment}`).toBe(false);
        }
      }
    });
    // Needs decision is a count, never a list.
    expect(Object.keys((SHOW_DAY_OUTPUT_SCHEMA.properties as Record<string, JsonSchemaObject>).needs_decision.properties as object)).toEqual(["count", "truncated"]);
  });

  it("enables the trial only for the exact value true", () => {
    expect(mcpAppsEnabled({})).toBe(false);
    for (const value of ["", "false", "on", "1", "TRUE", " true"]) expect(mcpAppsEnabled({ CADENCE_MCP_APPS: value })).toBe(false);
    expect(mcpAppsEnabled({ CADENCE_MCP_APPS: "true" })).toBe(true);
  });
});

describe("show_day", () => {
  it("returns the validated day, with the grant's scopes in _meta only", async () => {
    const result = await showDay(context(), {});
    expect(result).toMatchObject({ ok: true, value: { local_date: "2026-11-25", day_note: "Rest day", needs_decision: { count: 4, truncated: false },
      occurrences: [{ connector_completion: { source: "hevy", source_label: "Hevy" } }, { connector_completion: null }] } });
    if (!result.ok) throw new Error("expected a day");
    expect(validateAgainstSchema(SHOW_DAY_OUTPUT_SCHEMA, result.value).ok).toBe(true);
    // Consent order, whatever order the grant lists them in.
    expect(result.meta).toEqual({ "com.cadence-me/granted_scopes": ["cadence.read", "cadence.occurrences.write"] });
    expect(JSON.stringify(result.value)).not.toContain("cadence.read");
    expect(getIntegrationDay).toHaveBeenCalledExactlyOnceWith(expect.anything(), {});
  });

  it("counts one read against the grant and records one success row, as a registry read does", async () => {
    await showDay(context(), { date: "2026-11-20" });
    expect(consumeMcpRateLimit).toHaveBeenCalledExactlyOnceWith("grant-a", "read");
    expect(activity()).toEqual([{ operation: "show_day", targetIds: [], outcome: "success", errorCode: null }]);
    expect(getIntegrationDay).toHaveBeenCalledWith(expect.anything(), { date: "2026-11-20" });
  });

  it("accepts the alongside edition's optional field and nothing else new", async () => {
    vi.mocked(getIntegrationDay).mockResolvedValue(day({}, { alongside: true }) as never);
    expect(await showDay(context(), {})).toMatchObject({ ok: true, value: { occurrences: [{ alongside: true }, {}] } });
    vi.mocked(getIntegrationDay).mockResolvedValue(day({}, { alongside: null }) as never);
    expect((await showDay(context(), {})).ok).toBe(true);
  });

  it.each([
    ["Calendar events", { calendar_events: [{ title: "Dentist" }] }, {}],
    ["travel", { travel: { minutes: 20 } }, {}],
    ["a leave time", {}, { leave_time: "2026-11-25T12:40:00Z" }],
    ["Daily Brief text", { daily_brief: "Move your run to 6 PM." }, {}],
    ["a location", {}, { location: { latitude: 40.7, longitude: -74 } }],
    ["Periods", { periods: [{ label: "Sick" }] }, {}],
    ["tracked time", {}, { tracked_seconds: 1800 }],
    ["an intended duration", {}, { intended_duration_minutes: 30 }],
    ["a Needs decision list", { needs_decision: { count: 1, truncated: false, occurrences: [occurrence(3)] } }, {}],
  ])("refuses a result that carries %s instead of returning it", async (_label, dayExtra, occurrenceExtra) => {
    vi.mocked(getIntegrationDay).mockResolvedValue(day(dayExtra, occurrenceExtra) as never);
    const result = await showDay(context(), {});
    expect(result).toMatchObject({ ok: false, error: { code: "internal_error" } });
    for (const leaked of ["Dentist", "minutes", "12:40", "6 PM", "40.7", "Sick", "1800", "intended"]) expect(JSON.stringify(result)).not.toContain(leaked);
    expect(activity()).toEqual([{ operation: "show_day", targetIds: [], outcome: "error", errorCode: "internal_error" }]);
  });

  it.each([[{ date: "2026-02-30" }], [{ date: "tomorrow" }], [{ days: 3 }], [{ date: "2026-11-25", include_needs_decision: true }], ["2026-11-25"]])(
    "rejects input %j without reading", async (input) => {
      expect(await showDay(context(), input)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
      expect(getIntegrationDay).not.toHaveBeenCalled();
      expect(activity()).toEqual([{ operation: "show_day", targetIds: [], outcome: "invalid", errorCode: "invalid_input" }]);
    });

  it("refuses a grant without cadence.read before the limiter or the read", async () => {
    const result = await showDay(context(["cadence.occurrences.write"]), {});
    expect(result).toMatchObject({ ok: false, error: { code: "insufficient_scope", required_scopes: ["cadence.read"] } });
    expect(consumeMcpRateLimit).not.toHaveBeenCalled();
    expect(getIntegrationDay).not.toHaveBeenCalled();
    expect(activity()).toEqual([{ operation: "show_day", targetIds: [], outcome: "denied", errorCode: "insufficient_scope" }]);
  });

  it("returns rate_limited past the read limit without reading", async () => {
    vi.mocked(consumeMcpRateLimit).mockResolvedValue({ allowed: false, limit: 120, remaining: 0, resetAt: "", retryAfterSeconds: 9 });
    expect(await showDay(context(), {})).toMatchObject({ ok: false, error: { code: "rate_limited", retry_after_seconds: 9 } });
    expect(getIntegrationDay).not.toHaveBeenCalled();
    expect(activity()).toEqual([{ operation: "show_day", targetIds: [], outcome: "rate_limited", errorCode: "rate_limited" }]);
  });

  it("fails closed when the limiter or the activity write fails", async () => {
    vi.mocked(consumeMcpRateLimit).mockRejectedValueOnce(new Error("private backend details"));
    const limited = await showDay(context(), {});
    expect(limited).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
    expect(JSON.stringify(limited)).not.toContain("private backend details");
    expect(getIntegrationDay).not.toHaveBeenCalled();

    vi.mocked(recordIntegrationActivity).mockRejectedValueOnce(new Error("activity table down"));
    const unrecorded = await showDay(context(), {});
    expect(unrecorded).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
    expect(JSON.stringify(unrecorded)).not.toContain("Rest day");

    // A refusal that cannot be recorded is still a refusal.
    vi.mocked(consumeMcpRateLimit).mockResolvedValueOnce({ allowed: false, limit: 120, remaining: 0, resetAt: "", retryAfterSeconds: 9 });
    vi.mocked(recordIntegrationActivity).mockRejectedValueOnce(new Error("activity table down"));
    expect((await showDay(context(), {})).ok).toBe(false);
  });

  it("maps read failures to the tool's declared error codes", async () => {
    vi.mocked(getIntegrationDay).mockRejectedValueOnce(new IntegrationReadError("service_unavailable" as never, "Tracking data changed during this read. Retry the request."));
    expect(await showDay(context(), {})).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
    vi.mocked(getIntegrationDay).mockRejectedValueOnce(new IntegrationReadError("limit_exceeded" as never, "Too much."));
    expect(await showDay(context(), {})).toMatchObject({ ok: false, error: { code: "internal_error" } });
    vi.mocked(getIntegrationDay).mockRejectedValueOnce(new Error("select failed: relation private.x"));
    const failed = await showDay(context(), {});
    expect(failed).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(JSON.stringify(failed)).not.toContain("relation");
  });

  it("refuses a day larger than the response limit", async () => {
    vi.mocked(getIntegrationDay).mockResolvedValue(day({ day_note: "x".repeat(100_001) }) as never);
    expect(await showDay(context(), {})).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });

  it("writes activity rows that hold labels and codes only", async () => {
    await showDay(context(), {});
    await readAppResource(context(), DAY_VIEW_URI);
    await listAppResources(context());
    const rows = activity();
    expect(rows.map((row) => row.operation)).toEqual(["show_day", "read_view_resource", "list_view_resources"]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["errorCode", "operation", "outcome", "targetIds"]);
    expect(JSON.stringify(rows)).not.toContain(NOTE);
    expect(JSON.stringify(rows)).not.toContain("<html");
  });
});

describe("activity labels", () => {
  it("fit the activity table's operation rule, which the method names do not", () => {
    const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261018160000_add_oauth_integration_persistence.sql"), "utf8");
    const table = migration.slice(migration.indexOf("create table cadence_oauth_private.activity"));
    const rule = /operation text not null check \(operation ~ '([^']+)'\)/.exec(table)?.[1];
    expect(rule).toBe("^[a-z][a-z0-9_]{0,63}$");
    for (const label of Object.values(MCP_APPS_READ_LABELS)) expect(label).toMatch(new RegExp(rule!));
    expect("resources/read").not.toMatch(new RegExp(rule!));
    // No registry tool shares a label, so each activity row names one thing.
    for (const label of Object.values(MCP_APPS_READ_LABELS)) expect(INTEGRATION_OPERATION_NAMES as readonly string[]).not.toContain(label);
  });
});

describe("view resources", () => {
  it("lists descriptors only", async () => {
    const listed = await listAppResources(context());
    expect(listed).toEqual({ ok: true, resources: [{ uri: "ui://cadence/day/v1.html", name: "cadence-day", title: "Cadence day",
      description: expect.any(String), mimeType: "text/html;profile=mcp-app",
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }] });
    expect(JSON.stringify(listed)).not.toContain("<html");
    expect(consumeMcpRateLimit).toHaveBeenCalledExactlyOnceWith("grant-a", "read");
    expect(activity()).toEqual([{ operation: "list_view_resources", targetIds: [], outcome: "success", errorCode: null }]);
  });

  it("reads the HTML for the exact URI with an explicit empty CSP", async () => {
    expect(await readAppResource(context(), DAY_VIEW_URI)).toEqual({ ok: true, contents: [{ uri: DAY_VIEW_URI, mimeType: MCP_APP_MIME_TYPE,
      text: DAY_VIEW_HTML, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }] });
    expect(consumeMcpRateLimit).toHaveBeenCalledExactlyOnceWith("grant-a", "read");
    expect(activity()).toEqual([{ operation: "read_view_resource", targetIds: [], outcome: "success", errorCode: null }]);
  });

  it.each(["ui://cadence/day/v2.html", "ui://cadence/day/v1.html?x=1", "ui://cadence/day/v1.html/", "UI://CADENCE/DAY/V1.HTML", "ui://cadence/", "file:///etc/passwd", "", null, 7, { uri: DAY_VIEW_URI }])(
    "refuses the URI %j, and still counts the read", async (uri) => {
      const result = await readAppResource(context(), uri);
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
      expect(JSON.stringify(result)).not.toContain("<html");
      expect(consumeMcpRateLimit).toHaveBeenCalledExactlyOnceWith("grant-a", "read");
      expect(activity()).toEqual([{ operation: "read_view_resource", targetIds: [], outcome: "invalid", errorCode: "not_found" }]);
    });

  it("needs cadence.read, and returns rate_limited past the read limit", async () => {
    for (const read of [() => readAppResource(context(["cadence.occurrences.write"]), DAY_VIEW_URI), () => listAppResources(context(["cadence.occurrences.write"]))]) {
      expect(await read()).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
    }
    expect(consumeMcpRateLimit).not.toHaveBeenCalled();
    vi.mocked(consumeMcpRateLimit).mockResolvedValue({ allowed: false, limit: 120, remaining: 0, resetAt: "", retryAfterSeconds: 12 });
    for (const read of [() => readAppResource(context(), DAY_VIEW_URI), () => listAppResources(context())]) {
      const result = await read();
      expect(result).toMatchObject({ ok: false, error: { code: "rate_limited", retry_after_seconds: 12 } });
      expect(JSON.stringify(result)).not.toContain("<html");
    }
  });

  it("fails closed when the limiter or the activity write fails", async () => {
    vi.mocked(consumeMcpRateLimit).mockRejectedValueOnce(new Error("down"));
    expect(await readAppResource(context(), DAY_VIEW_URI)).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
    vi.mocked(recordIntegrationActivity).mockRejectedValueOnce(new Error("down"));
    const unrecorded = await readAppResource(context(), DAY_VIEW_URI);
    expect(unrecorded).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
    expect(JSON.stringify(unrecorded)).not.toContain("<html");
    vi.mocked(recordIntegrationActivity).mockRejectedValueOnce(new Error("down"));
    expect(await listAppResources(context())).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
  });

  it("enforces the byte cap in UTF-8 bytes and never truncates", () => {
    expect(dayViewHtml("a".repeat(MCP_APP_RESOURCE_BYTE_CAP))).toMatchObject({ ok: true });
    expect(dayViewHtml("a".repeat(MCP_APP_RESOURCE_BYTE_CAP + 1))).toMatchObject({ ok: false, error: { code: "internal_error" } });
    // 3 bytes each: under the cap in characters, over it in bytes.
    expect(dayViewHtml("€".repeat(Math.ceil(MCP_APP_RESOURCE_BYTE_CAP / 3) + 1))).toMatchObject({ ok: false });
    expect(dayViewHtml()).toEqual({ ok: true, html: DAY_VIEW_HTML });
  });

  it("ships the built view (Ticket 377) as one self-contained file under the byte cap", () => {
    // What the view does and requests is tested on the bundle itself in tests/mcp-day-view.dom.test.ts.
    expect(DAY_VIEW_HTML.startsWith("<!doctype html>")).toBe(true);
    expect(DAY_VIEW_HTML.includes("<title>Cadence day</title>")).toBe(true);
    expect(DAY_VIEW_HTML.includes('<script type="module"')).toBe(true);
    // Inline code only. The bundle's own tests check that no tag loads a file and nothing is requested.
    expect(DAY_VIEW_HTML.includes("<script src")).toBe(false);
    expect(DAY_VIEW_HTML.includes("<link")).toBe(false);
    expect(Buffer.byteLength(DAY_VIEW_HTML, "utf8")).toBeLessThan(MCP_APP_RESOURCE_BYTE_CAP);
  });
});
