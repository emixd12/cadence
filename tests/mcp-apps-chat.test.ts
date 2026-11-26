// Ticket 376: `show_day` is a transport tool outside the contract registry, so Cadence
// Chat, which builds its tools from the registry, neither lists nor executes it, with
// `CADENCE_MCP_APPS` on or off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ day: vi.fn(), rateLimit: vi.fn(), activity: vi.fn() }));
vi.mock("@/lib/services/integration-day.service", () => ({ getIntegrationDay: mocks.day }));
vi.mock("@/lib/services/oauth/server", () => ({ consumeMcpRateLimit: mocks.rateLimit, consumeAgentRateLimit: mocks.rateLimit }));
vi.mock("@/lib/db/integration.repo", async (original) => ({
  ...(await original<typeof import("@/lib/db/integration.repo")>()), recordIntegrationActivity: mocks.activity,
}));
vi.mock("@/lib/services/model-armor.service", () => ({
  screenExternalCalendarTextWithModelArmor: async ({ text }: { text: string }) => ({ text, blocked: false }),
}));

import { INTEGRATION_OPERATION_NAMES, isIntegrationOperationName, resolveOperationName } from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { SHOW_DAY_TOOL_NAME } from "@/lib/mcp/apps/config";
import { mcpListedTools } from "@/lib/mcp/server";
import { createLiveChatExecutor } from "@/lib/services/chat/chat-executor";
import { buildChatToolDefinitions, CHAT_TOOL_SUBJECT, isChatWrite, type ChatToolName, CHAT_UNOFFERED_OPERATIONS } from "@/lib/services/chat/chat-tools";

const ALL_ON = { notes: true, googleCalendar: true, outlookCalendar: true, icloudCalendar: true, hevy: true };
const context = { userId: "u", supabase: {}, now: new Date("2026-11-25T15:00:00Z"), tokenExpiresAt: new Date(),
  actor: { channel: "chat", clientId: "chat", clientLabel: "Cadence Chat", grantId: "grant-chat", grantedScopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] } } as unknown as IntegrationContext;

beforeEach(() => {
  mocks.rateLimit.mockResolvedValue({ allowed: true, limit: 120, remaining: 119, resetAt: "", retryAfterSeconds: 1 });
  mocks.activity.mockResolvedValue(undefined);
  mocks.day.mockResolvedValue({ local_date: "2026-11-25" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe.each([["on", "true"], ["off", ""]])("Cadence Chat with CADENCE_MCP_APPS %s", (_label, value) => {
  beforeEach(() => { vi.stubEnv("CADENCE_MCP_APPS", value); });

  it("does not list show_day", () => {
    for (const alongside of [true, false]) {
      const names = buildChatToolDefinitions(ALL_ON, { alongside }).map((tool) => tool.name as string);
      expect(names).not.toContain(SHOW_DAY_TOOL_NAME);
      expect(names.some((name) => name.includes("view_resource"))).toBe(false);
      // Chat still offers every registry tool, except the Period writes it does not offer yet (Ticket 370).
      for (const name of INTEGRATION_OPERATION_NAMES) expect(names.includes(name), name).toBe(!CHAT_UNOFFERED_OPERATIONS.has(name));
    }
    expect(CHAT_TOOL_SUBJECT[SHOW_DAY_TOOL_NAME]).toBeUndefined();
    expect(isChatWrite(SHOW_DAY_TOOL_NAME)).toBe(false);
  });

  it("does not execute show_day when a model names it anyway", async () => {
    const executor = createLiveChatExecutor({ context, sources: ALL_ON, today: () => "2026-11-25", timezone: "America/New_York",
      reads: { calendarEvents: async () => ({ events: [], sources: [] }), workouts: async () => ({ workouts: [], sources: [] }) } as never });
    // The executor has no branch for the name. Whether it refuses or throws, it returns no day.
    const outcome = await executor(SHOW_DAY_TOOL_NAME as ChatToolName, { date: "2026-11-25" }, { idempotencyKey: null })
      .then((result) => result, () => ({ ok: false as const }));
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain("2026-11-25");
    expect(mocks.day).not.toHaveBeenCalled();
    // No show_day activity row is written under Chat's grant.
    expect(mocks.activity.mock.calls.every((call) => call[1].outcome !== "success")).toBe(true);
  });

  it("keeps show_day out of the registry that Chat and the contract share", () => {
    expect(isIntegrationOperationName(SHOW_DAY_TOOL_NAME)).toBe(false);
    expect(resolveOperationName(SHOW_DAY_TOOL_NAME)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("show_day on the MCP endpoint and in Chat", () => {
  it("is listed by the MCP endpoint with the flag on while Chat's list stays the same", () => {
    vi.stubEnv("CADENCE_MCP_APPS", "");
    const chatOff = JSON.stringify(buildChatToolDefinitions(ALL_ON));
    vi.stubEnv("CADENCE_MCP_APPS", "true");
    expect(mcpListedTools().map((tool) => tool.name)).toContain(SHOW_DAY_TOOL_NAME);
    expect(JSON.stringify(buildChatToolDefinitions(ALL_ON))).toBe(chatOff);
  });
});
