import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ retire: vi.fn() }));
vi.mock("@/lib/services/google-calendar-agent-retirement.service", () => ({ retireDailyBriefCalendarGrants: mocks.retire }));
import { POST } from "@/app/api/google-calendar/agent-grants/retire/route";
import { resetAuthFailureRateLimitersForTests } from "@/lib/security/auth-failure-rate-limits";

const url = "https://cadence.example/api/google-calendar/agent-grants/retire";
const post = (authorization?: string) => POST(new NextRequest(url, { method: "POST", headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  vi.resetAllMocks(); resetAuthFailureRateLimitersForTests();
  vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
  mocks.retire.mockResolvedValue({ state: "complete", revoked: 2, unrevocable: 0, failed: 0, remaining: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); });

it("retires Daily Brief Calendar grants only with the cron secret and returns counts (Ticket 307)", async () => {
  expect((await post()).status).toBe(401);
  expect((await post("Bearer wrong")).status).toBe(401);
  expect(mocks.retire).not.toHaveBeenCalled();
  const response = await post("Bearer synthetic-cron-secret");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, result: { state: "complete", revoked: 2, unrevocable: 0, failed: 0, remaining: 0 } });
  mocks.retire.mockResolvedValue({ state: "incomplete", revoked: 0, unrevocable: 0, failed: 1, remaining: 1 });
  expect(await (await post("Bearer synthetic-cron-secret")).json()).toMatchObject({ ok: false, result: { remaining: 1 } });
});

it("fails closed without a configured secret and rate-limits repeated failures", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await post("Bearer synthetic-cron-secret")).status).toBe(503);
  vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 7; attempt += 1) statuses.push((await post("Bearer wrong")).status);
  expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
  expect(statuses.at(-1)).toBe(429);
  expect((await post("Bearer synthetic-cron-secret")).status).toBe(429);
  expect(mocks.retire).not.toHaveBeenCalled();
});

it("reports a failed run without detail", async () => {
  mocks.retire.mockRejectedValue(new Error("synthetic database detail"));
  const response = await post("Bearer synthetic-cron-secret");
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain("synthetic database detail");
});
