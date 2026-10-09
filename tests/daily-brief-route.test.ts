import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), generate: vi.fn(), settings: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/services/google-calendar-request", async (original) => ({ ...await original<typeof import("@/lib/services/google-calendar-request")>(), authenticateCalendarRequest: mocks.auth }));
vi.mock("@/lib/services/daily-brief.service", () => ({ requestInAppDailyBrief: mocks.generate, getDailyBriefSettings: mocks.settings, updateDailyBriefSettings: mocks.update }));
import { POST, OPTIONS } from "@/app/api/advisor/brief/route";
import { GET, PUT } from "@/app/api/advisor/preferences/route";
import { CalendarConnectionError } from "@/lib/services/google-calendar-oauth";
import { DailyBriefStorageError } from "@/lib/db/daily-brief.repo";
const caller = { client: {}, user: { id: "verified-owner" } };
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(caller); });
describe("in-app briefing routes", () => {
  it("authenticates before parsing or reading facts and sanitizes revoked sessions", async () => {
    mocks.auth.mockRejectedValue(new CalendarConnectionError("unauthenticated"));
    const rejected = await POST(new Request("https://cadence.example/api/advisor/brief", { method: "POST", body: "invalid" }));
    expect(rejected.status).toBe(401);
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue(caller);
    mocks.settings.mockRejectedValue(new DailyBriefStorageError("session"));
    expect((await GET(new Request("https://cadence.example/api/advisor/preferences"))).status).toBe(401);
  });
  it("passes only the verified caller, uses no-store, and returns no source context", async () => {
    mocks.generate.mockResolvedValue({ state: "already_attempted" });
    const body = { installationId: "11111111-1111-4111-8111-111111111111", retry: false };
    const result = await POST(new Request("https://cadence.example/api/advisor/brief", { method: "POST", body: JSON.stringify(body), headers: { origin: "tauri://localhost" } }));
    expect(mocks.generate).toHaveBeenCalledWith(caller, body);
    expect(await result.json()).toEqual({ state: "already_attempted" });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
  });
  it("sanitizes provider bodies and rejects oversized JSON", async () => {
    mocks.generate.mockRejectedValue(new Error("sensitive-provider-body"));
    const result = await POST(new Request("https://cadence.example/api/advisor/brief", { method: "POST", body: "{}" }));
    expect(await result.json()).toEqual({ error: "advisor_unavailable" });
    const oversized = await PUT(new Request("https://cadence.example/api/advisor/preferences", { method: "PUT", body: '"' + 'a'.repeat(70001) + '"' }));
    expect(oversized.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("returns retry limits as 429 without retry timing", async () => {
    const { DailyBriefError } = await import("@/lib/services/daily-brief-consumer");
    mocks.generate.mockRejectedValue(new DailyBriefError("retry_exhausted"));
    const result = await POST(new Request("https://cadence.example/api/advisor/brief", { method: "POST", body: "{}" }));
    expect(result.status).toBe(429);
    expect(await result.json()).toEqual({ error: "retry_exhausted" });
  });
  it("allows only fixed native preflight origins", () => {
    expect(OPTIONS(new Request("https://cadence.example/api/advisor/brief", { method: "OPTIONS", headers: { origin: "https://attacker.invalid" } })).status).toBe(403);
    expect(OPTIONS(new Request("https://cadence.example/api/advisor/brief", { method: "OPTIONS", headers: { origin: "tauri://localhost" } })).status).toBe(204);
  });
});
