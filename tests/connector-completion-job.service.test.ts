import { generateKeyPairSync } from "node:crypto";

import { Temporal } from "@js-temporal/polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createConnectorCompletionCaller } from "@/lib/integrations/connector-completion-caller";
import {
  processConnectorCompletions,
  type CompletionJobAccountPort,
  type DueCompletionAccount,
} from "@/lib/services/connector-completion-job.service";
import type { ReconcileResult } from "@/lib/services/connector-completion.service";
import { mintConnectorCompletionAccessToken, parseIntegrationSigningKey } from "@/lib/supabase/integration-token";

const ON = { CADENCE_CONNECTOR_COMPLETION: "on" };
const NOW = Temporal.Instant.from("2026-11-10T20:00:00Z");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function signingKey() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return parseIntegrationSigningKey(JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "completion-kid", alg: "ES256" }));
}
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;

function reconciled(completed = 1): ReconcileResult {
  return { status: "reconciled", source: "hevy", counts: { completed, attached: 0, removed: 0, reverted: 0, skipped: 0, refused: 0, deferred: 0 }, codes: [], lastReconciledAt: NOW.toString() };
}

function account(userId: string): DueCompletionAccount {
  return { userId, source: "hevy", nextCheckAt: NOW.subtract({ minutes: 1 }).toString() };
}

function port(overrides: Partial<CompletionJobAccountPort> = {}) {
  const schedules: Array<{ nextCheckAt: string | null; checkCount: number; checkCountDate: string }> = [];
  const value: CompletionJobAccountPort = {
    reconcile: async () => reconciled(),
    readScheduleContext: async () => ({
      timezone: "America/New_York", occurrences: [{ scheduledStartAt: "2026-11-10T23:00:00Z", reminderAt: ["2026-11-10T22:45:00Z"] }],
      checkCountDate: "2026-11-10", checkCount: 3, consecutiveFailures: 0, lastAttemptedAt: null, reconnectRequired: false,
    }),
    writeSchedule: async (input) => { schedules.push(input); },
    ...overrides,
  };
  return { value, schedules };
}

afterEach(() => vi.restoreAllMocks());

describe("connector completion job (Ticket 321)", () => {
  it("does nothing while the flag is off", async () => {
    const select = vi.fn(async () => [account(USER_A)]);
    const result = await processConnectorCompletions({ env: {}, now: () => NOW, selectDueAccounts: select, openAccount: () => port().value });
    expect(result).toMatchObject({ enabled: false, selected: 0 });
    expect(select).not.toHaveBeenCalled();
  });

  it("reconciles each due account, schedules its next check and counts its checks", async () => {
    const { value, schedules } = port();
    const result = await processConnectorCompletions({ env: ON, now: () => NOW, selectDueAccounts: async () => [account(USER_A)], openAccount: () => value });
    expect(result).toMatchObject({ enabled: true, selected: 1, visited: 1, failed: 0, completed: 1 });
    expect(schedules).toEqual([{ nextCheckAt: "2026-11-10T22:37:00Z", checkCountDate: "2026-11-10", checkCount: 4 }]);
  });

  it("keeps going when one account fails", async () => {
    const good = port();
    const result = await processConnectorCompletions({
      env: ON, now: () => NOW,
      selectDueAccounts: async () => [account(USER_A), account(USER_B)],
      openAccount: (due) => {
        if (due.userId === USER_A) throw new Error("token_unavailable");
        return good.value;
      },
    });
    expect(result).toMatchObject({ selected: 2, visited: 1, failed: 1 });
    expect(good.schedules).toHaveLength(1);
  });

  it("still schedules after a reconcile that throws, and stops checks when reconnect is required", async () => {
    const failing = port({ reconcile: async () => { throw new Error("database_unavailable"); } });
    expect(await processConnectorCompletions({ env: ON, now: () => NOW, selectDueAccounts: async () => [account(USER_A)], openAccount: () => failing.value }))
      .toMatchObject({ visited: 1, failed: 1 });
    expect(failing.schedules).toHaveLength(1);
    const fenced = port({ reconcile: async () => ({ ...reconciled(0), status: "not_connected" }) });
    await processConnectorCompletions({ env: ON, now: () => NOW, selectDueAccounts: async () => [account(USER_A)], openAccount: () => fenced.value });
    expect(fenced.schedules[0].nextCheckAt).toBeNull();
  });

  it("starts the count again on a new local date", async () => {
    const { value, schedules } = port({
      readScheduleContext: async () => ({ timezone: "America/New_York", occurrences: [], checkCountDate: "2026-11-09", checkCount: 24,
        consecutiveFailures: 0, lastAttemptedAt: null, reconnectRequired: false }),
    });
    await processConnectorCompletions({ env: ON, now: () => NOW, selectDueAccounts: async () => [account(USER_A)], openAccount: () => value });
    expect(schedules[0]).toMatchObject({ checkCount: 1, checkCountDate: "2026-11-10" });
  });

  it("mints a five-minute token on its own channel and never logs it", async () => {
    const minted = mintConnectorCompletionAccessToken(signingKey(), { userId: USER_A, now: new Date(NOW.epochMilliseconds) });
    const claims = claimsOf(minted.token);
    expect(claims).toMatchObject({ sub: USER_A, role: "authenticated", cadence_channel: "connector_completion" });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(300);
    expect(Object.keys(claims)).not.toContain("cadence_grant_id");

    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const tokens: string[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      tokens.push((new Headers(init?.headers).get("Authorization") ?? "").replace(/^Bearer /, ""));
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const caller = createConnectorCompletionCaller(USER_A, {
      now: new Date(NOW.epochMilliseconds), signingKey: signingKey(),
      runtimeConfig: { url: "https://cadence.test", publishableKey: "sb_publishable_test" }, fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await caller.client.from("connector_completion_state").select("next_check_at");
    expect(claimsOf(tokens[0])).toMatchObject({ sub: USER_A, cadence_channel: "connector_completion" });
    expect(Object.values(caller)).not.toContain(tokens[0]);
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(tokens[0]);
    }
  });
});
