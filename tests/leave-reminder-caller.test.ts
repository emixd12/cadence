import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLeaveReminderCaller,
  leaveReminderCalendarCaller,
  LeaveReminderCallerError,
} from "../lib/integrations/leave-reminder-caller";
import {
  LEAVE_REMINDER_ACCOUNT_BATCH_MAX,
  selectDueLeaveReminderAccounts,
} from "../lib/db/leave-reminders.repo";
import { calendarGoogleSubject } from "../lib/services/google-calendar-oauth";
import {
  INTEGRATION_TOKEN_MAX_TTL_SECONDS,
  mintIntegrationAccessToken,
  mintLeaveReminderAccessToken,
  parseIntegrationSigningKey,
} from "../lib/supabase/integration-token";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-06T12:00:00.000Z");
const RUNTIME = { url: "https://cadence.test", publishableKey: "sb_publishable_test" };

function signingKey() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return parseIntegrationSigningKey(
    JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "leave-kid", alg: "ES256" }),
  );
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

function capturingFetch(body: unknown) {
  const tokens: string[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("Authorization") ?? "";
    tokens.push(authorization.replace(/^Bearer /, ""));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, tokens };
}

afterEach(() => vi.restoreAllMocks());

describe("leave reminder token channel", () => {
  it("carries its own channel and no MCP grant or client claims", () => {
    const minted = mintLeaveReminderAccessToken(signingKey(), { userId: USER_ID, now: NOW });
    const claims = claimsOf(minted.token);

    expect(claims).toMatchObject({
      sub: USER_ID,
      role: "authenticated",
      aud: "authenticated",
      cadence_channel: "leave_reminder",
    });
    expect(Object.keys(claims).sort()).toEqual(
      ["aud", "cadence_channel", "exp", "iat", "jti", "role", "sub"].sort(),
    );
  });

  it("lasts 5 minutes or less", () => {
    const key = signingKey();
    const minted = mintLeaveReminderAccessToken(key, { userId: USER_ID, now: NOW });
    const claims = claimsOf(minted.token);

    expect(INTEGRATION_TOKEN_MAX_TTL_SECONDS).toBe(300);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(300);
    expect(minted.expiresAt.toISOString()).toBe("2026-11-06T12:05:00.000Z");
    expect(() => mintLeaveReminderAccessToken(key, { userId: USER_ID, now: NOW, ttlSeconds: 301 })).toThrow(RangeError);
    expect(() => mintLeaveReminderAccessToken(key, { userId: USER_ID, now: NOW, ttlSeconds: 0 })).toThrow(RangeError);
    expect(() => mintLeaveReminderAccessToken(key, { userId: "not-a-uuid", now: NOW })).toThrow(TypeError);
  });

  it("is not an MCP grant: the MCP minter refuses the leave reminder channel", () => {
    expect(() => mintIntegrationAccessToken(signingKey(), {
      userId: USER_ID,
      channel: "leave_reminder" as never,
      grantId: "grant",
      clientId: "client",
      now: NOW,
    })).toThrow(TypeError);
  });
});

describe("leave reminder caller", () => {
  it("sends a minted leave reminder token for that user on every request", async () => {
    const { fetch, tokens } = capturingFetch([]);
    const caller = createLeaveReminderCaller(USER_ID, { now: NOW, signingKey: signingKey(), runtimeConfig: RUNTIME, fetch });

    await caller.client.from("travel_leave_reminders").select("id");
    await caller.client.rpc("reserve_travel_provider_spend", { requested_microdollars: 5_000 });

    expect(tokens).toHaveLength(2);
    for (const token of tokens) {
      expect(claimsOf(token)).toMatchObject({ sub: USER_ID, cadence_channel: "leave_reminder" });
    }
    expect(caller.userId).toBe(USER_ID);
    expect(caller.tokenExpiresAt.getTime() - NOW.getTime()).toBeLessThanOrEqual(300_000);
    expect(Object.values(caller)).not.toContain(tokens[0]);
  });

  it("builds a Calendar caller from the one Google identity the database returns", async () => {
    const { fetch } = capturingFetch("google-subject-123");
    const caller = createLeaveReminderCaller(USER_ID, { now: NOW, signingKey: signingKey(), runtimeConfig: RUNTIME, fetch });
    const calendarCaller = await leaveReminderCalendarCaller(caller);

    expect(calendarCaller.client).toBe(caller.client);
    expect(calendarCaller.user.id).toBe(USER_ID);
    expect(calendarGoogleSubject(calendarCaller.user)).toBe("google-subject-123");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "https://cadence.test/rest/v1/rpc/leave_reminder_google_subject",
    );
  });

  it("fails closed without a single Google identity", async () => {
    for (const body of [null, ""]) {
      const { fetch } = capturingFetch(body);
      const caller = createLeaveReminderCaller(USER_ID, { now: NOW, signingKey: signingKey(), runtimeConfig: RUNTIME, fetch });
      await expect(leaveReminderCalendarCaller(caller)).rejects.toBeInstanceOf(LeaveReminderCallerError);
    }
  });

  it("never writes the token to the console, including on failure", async () => {
    const output: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map(String).join(" "));
      });
    }
    const failing = vi.fn(async () => new Response(JSON.stringify({ message: "denied" }), { status: 401 }));
    const key = signingKey();
    const caller = createLeaveReminderCaller(USER_ID, { now: NOW, signingKey: key, runtimeConfig: RUNTIME, fetch: failing as never });
    const error = await leaveReminderCalendarCaller(caller).catch((value: unknown) => value);
    const sentToken = new Headers((failing.mock.calls[0] as unknown as [unknown, RequestInit])[1].headers)
      .get("Authorization")!.replace(/^Bearer /, "");

    expect(error).toBeInstanceOf(LeaveReminderCallerError);
    expect(String((error as Error).message)).toBe("google_identity_unavailable");
    expect(output.join("\n")).not.toContain(sentToken);
    expect(JSON.stringify(error)).not.toContain(sentToken);
  });

  it("never uses the service role", () => {
    const source = readFileSync(new URL("../lib/integrations/leave-reminder-caller.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/createServiceRoleClient|SERVICE_ROLE|serviceRoleKey|@\/lib\/supabase\/admin/);
  });
});

describe("due leave reminder accounts", () => {
  function fakeServiceRole(rows: unknown[]) {
    const calls: Array<[string, ...unknown[]]> = [];
    const query = {
      select: (columns: string) => { calls.push(["select", columns]); return query; },
      eq: (...args: unknown[]) => { calls.push(["eq", ...args]); return query; },
      lte: (...args: unknown[]) => { calls.push(["lte", ...args]); return query; },
      order: (...args: unknown[]) => { calls.push(["order", ...args]); return query; },
      limit: async (count: number) => { calls.push(["limit", count]); return { data: rows, error: null }; },
    };
    const from = vi.fn((table: string) => { calls.push(["from", table]); return query; });
    return { client: { from } as never, calls };
  }

  it("reads only account ids and next check times for enabled accounts that are due", async () => {
    const { client, calls } = fakeServiceRole([
      { user_id: USER_ID, next_check_at: "2026-11-06T11:58:00+00:00" },
    ]);
    const due = await selectDueLeaveReminderAccounts(client, { dueBy: NOW, limit: 25 });

    expect(due).toEqual([{ userId: USER_ID, nextCheckAt: "2026-11-06T11:58:00+00:00" }]);
    expect(calls).toEqual([
      ["from", "travel_leave_reminder_settings"],
      ["select", "user_id, next_check_at"],
      ["eq", "enabled", true],
      ["lte", "next_check_at", "2026-11-06T12:00:00.000Z"],
      ["order", "next_check_at", { ascending: true }],
      ["limit", 25],
    ]);
  });

  it("bounds the batch", async () => {
    const { client } = fakeServiceRole([]);
    await expect(selectDueLeaveReminderAccounts(client, { dueBy: NOW, limit: 0 })).rejects.toThrow(RangeError);
    await expect(selectDueLeaveReminderAccounts(client, { dueBy: NOW, limit: LEAVE_REMINDER_ACCOUNT_BATCH_MAX + 1 })).rejects.toThrow(RangeError);
    await expect(selectDueLeaveReminderAccounts(client, { dueBy: new Date(Number.NaN), limit: 1 })).rejects.toThrow(TypeError);
  });
});
