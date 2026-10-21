import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeMcpOperation } from "@/lib/integrations/operations/execute";
import { consumeMcpRateLimit } from "@/lib/services/oauth/server";
import { recordIntegrationActivity } from "@/lib/db/integration.repo";
import { listIntegrationCategories } from "@/lib/services/integration-read.service";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import type { IntegrationContext } from "@/lib/integrations/request-context";

vi.mock("@/lib/services/oauth/server", () => ({ consumeMcpRateLimit: vi.fn() }));
vi.mock("@/lib/db/integration.repo", () => ({ recordIntegrationActivity: vi.fn() }));
vi.mock("@/lib/services/integration-read.service", async importOriginal => ({ ...await importOriginal<object>(), listIntegrationCategories: vi.fn() }));
vi.mock("@/lib/integrations/operations/write", () => ({ writeOperationHandlers: { create_behavior: vi.fn() } }));
const context: IntegrationContext = { userId: "user", now: new Date(), tokenExpiresAt: new Date(), supabase: {} as IntegrationContext["supabase"],
  actor: { channel: "mcp", clientId: "client", clientLabel: "Test", grantId: "grant", grantedScopes: ["cadence.read", "cadence.behaviors.write"] } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumeMcpRateLimit).mockResolvedValue({ allowed: true, limit: 120, remaining: 119, resetAt: "", retryAfterSeconds: 1 });
  vi.mocked(recordIntegrationActivity).mockResolvedValue();
});
describe("MCP operation admission and activity", () => {
  it("validates a real read handler's output and records one privacy-safe failure", async () => {
    vi.mocked(listIntegrationCategories).mockResolvedValue({ categories: [], next_cursor: null, unexpected: "private" } as never);
    expect(await executeMcpOperation("list_categories", context, {})).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(recordIntegrationActivity).toHaveBeenCalledExactlyOnceWith(context.supabase, { operation: "list_categories", targetIds: [], outcome: "error", errorCode: "internal_error" });
  });
  it("checks scope before admission or writes", async () => {
    expect(await executeMcpOperation("create_behavior", { ...context, actor: { ...context.actor, grantedScopes: ["cadence.read"] } }, {}))
      .toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
    expect(consumeMcpRateLimit).not.toHaveBeenCalled(); expect(writeOperationHandlers.create_behavior).not.toHaveBeenCalled();
    expect(recordIntegrationActivity).toHaveBeenCalledTimes(1);
  });
  it("denies exhausted writes without invoking their handler", async () => {
    vi.mocked(consumeMcpRateLimit).mockResolvedValue({ allowed: false, limit: 30, remaining: 0, resetAt: "", retryAfterSeconds: 8 });
    expect(await executeMcpOperation("create_behavior", context, {})).toMatchObject({ ok: false, error: { code: "rate_limited", retry_after_seconds: 8 } });
    expect(consumeMcpRateLimit).toHaveBeenCalledWith("grant", "write");
    expect(writeOperationHandlers.create_behavior).not.toHaveBeenCalled();
  });
  it("fails closed when admission storage fails without exposing the backend error", async () => {
    vi.mocked(consumeMcpRateLimit).mockRejectedValueOnce(new Error("private backend details"));
    const result = await executeMcpOperation("create_behavior", context, {});
    expect(result).toMatchObject({ ok: false, error: { code: "service_unavailable" } });
    expect(JSON.stringify(result)).not.toContain("private backend details");
    expect(writeOperationHandlers.create_behavior).not.toHaveBeenCalled();
  });
  it("leaves write result validation and activity to the approved write handler", async () => {
    vi.mocked(writeOperationHandlers.create_behavior).mockResolvedValue({ ok: true, value: { marker: "already validated and committed" } } as never);
    expect(await executeMcpOperation("create_behavior", context, {})).toMatchObject({ ok: true });
    expect(recordIntegrationActivity).not.toHaveBeenCalled();
  });
});
