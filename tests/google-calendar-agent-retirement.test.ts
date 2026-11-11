import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { User } from "@supabase/supabase-js";
import { disconnectCalendar, finishCalendarConnection, getCalendarEventsForAdvisor, listCalendarCalendars, prepareCalendarRevocation, retiredAgentCalendarConnection, startCalendarConnection, updateCalendarPreferences, type CalendarCaller } from "@/lib/services/google-calendar.service";
import { readCalendarOAuthConfig, sealCalendarSecret } from "@/lib/services/google-calendar-oauth";
import { retireDailyBriefCalendarGrants } from "@/lib/services/google-calendar-agent-retirement.service";
import type { CalendarConnection, CalendarPurpose } from "@/lib/types/google-calendar";

const mocks = vi.hoisted(() => ({ read: vi.fn(), credential: vi.fn(), remove: vi.fn(), begin: vi.fn(), consume: vi.fn(), install: vi.fn(), user: vi.fn(), calendars: vi.fn(), events: vi.fn() }));
vi.mock("@/lib/db/google-calendar.repo", () => ({ readCalendarConnection: mocks.read, readCalendarCredential: mocks.credential, removeCalendarCredential: mocks.remove,
  beginCalendarAttempt: mocks.begin, consumeCalendarAttempt: mocks.consume, installCalendarCredential: mocks.install, readCalendarCallbackUser: mocks.user }));
vi.mock("@/lib/services/google-calendar-provider", async original => ({ ...await original<object>(), readGoogleCalendarCalendars: mocks.calendars, readGoogleCalendarEvents: mocks.events }));
const user = { id: "owner", identities: [{ provider: "google", identity_data: { sub: "google-owner" } }] } as unknown as User;
const caller = { user, client: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "UTC" } }) }) }) }) } } as unknown as CalendarCaller;
const standard: CalendarConnection = { userId: "owner", googleSubject: "google-owner", generation: 1, selectionRevision: 1, status: "connected",
  preferences: { selectedCalendarIds: ["work"], hiddenCalendarIds: [], visible: true, showAllDay: true } };
const agent: CalendarConnection = { ...standard, grantPurpose: "agent", oauthClientId: "agent-client" };
const agentConfig = () => readCalendarOAuthConfig(process.env, undefined, "agent")!;
const seal = (token: string, row: { user_id: string; google_subject: string; generation: number }) =>
  sealCalendarSecret(agentConfig(), token, { purpose: "refresh", userId: row.user_id, googleSubject: row.google_subject, generation: row.generation });

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-10T12:00Z"));
  for (const [name, value] of Object.entries({ GOOGLE_CALENDAR_CLIENT_ID: "standard-client", GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic-standard",
    GOOGLE_CALENDAR_PROJECT_ID: "standard-project", GOOGLE_CALENDAR_AGENT_CLIENT_ID: "agent-client", GOOGLE_CALENDAR_AGENT_CLIENT_SECRET: "synthetic-agent",
    GOOGLE_CALENDAR_AGENT_PROJECT_ID: "agent-project", GOOGLE_CALENDAR_CALLBACK_URL: "https://cadence.example/auth/google-calendar/callback",
    GOOGLE_CALENDAR_LEGACY_CALLBACK_URL: "", GOOGLE_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), GOOGLE_CALENDAR_KEY_ID: "v1" })) vi.stubEnv(name, value);
  mocks.read.mockImplementation(async (_client, _owner, purpose: CalendarPurpose = "standard") => purpose === "agent" ? agent : standard);
  mocks.credential.mockImplementation(async (connection: CalendarConnection) => sealCalendarSecret(readCalendarOAuthConfig(process.env, undefined, connection.grantPurpose)!, connection.grantPurpose === "agent" ? "agent-refresh" : "standard-refresh", { ...connection, purpose: "refresh" }));
  mocks.calendars.mockResolvedValue([{ id: "work", name: "Work", timezone: "UTC", primary: true, selected: true, accessRole: "owner" }]);
  mocks.events.mockResolvedValue({ ok: true, snapshot: {} }); mocks.user.mockResolvedValue(user);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => Response.json({ token_type: "Bearer", access_token: `${new URLSearchParams(init?.body as URLSearchParams).get("client_id")}-access` }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("reads Daily Brief Calendar timing with the Timeline grant only (Ticket 307)", async () => {
  await getCalendarEventsForAdvisor(caller, "2026-11-10", "2026-11-10", { now: Temporal.Instant.from("2026-11-10T12:00Z") });
  expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "standard-client-access" }));
  expect(mocks.read).not.toHaveBeenCalledWith(expect.anything(), "owner", "agent");
});

it("starts, lists, saves and disconnects no Daily Brief grant, and reads it as not configured", async () => {
  await expect(startCalendarConnection(caller, "web", "", "https://cadence.example", "agent")).rejects.toThrow("not_configured");
  await expect(listCalendarCalendars(caller, "agent")).rejects.toThrow("not_configured");
  await expect(updateCalendarPreferences(caller, standard.preferences, "agent")).rejects.toThrow("not_configured");
  await expect(disconnectCalendar(caller, "agent")).rejects.toThrow("not_configured");
  expect(mocks.begin).not.toHaveBeenCalled();
  expect(retiredAgentCalendarConnection(caller)).toMatchObject({ accountId: "owner", status: "not_configured", preferences: { selectedCalendarIds: [] } });
});

it("installs nothing from a late Daily Brief consent callback", async () => {
  const result = await finishCalendarConnection({ state: `a_${"b".repeat(43)}`, code: "synthetic-code", denied: false, cookieUser: user });
  expect(result).toBe("https://cadence.example/settings?agentCalendar=error");
  expect(mocks.consume).not.toHaveBeenCalled();
  expect(mocks.install).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("still revokes a remaining Daily Brief grant on account deletion, and skips it once its tables are gone", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
  await (await prepareCalendarRevocation(caller))!();
  expect(vi.mocked(fetch).mock.calls.map(([, init]) => new URLSearchParams(init!.body as URLSearchParams).get("token")).sort()).toEqual(["agent-refresh", "standard-refresh"]);
  vi.mocked(fetch).mockClear();
  mocks.read.mockImplementation(async (_client, _owner, purpose: CalendarPurpose = "standard") => {
    if (purpose === "agent") throw new Error("relation does not exist");
    return standard;
  });
  await (await prepareCalendarRevocation(caller))!();
  expect(fetch).toHaveBeenCalledOnce();
});

describe("Daily Brief grant retirement job", () => {
  const rows = [
    { user_id: "owner-a", google_subject: "subject-a", generation: 2, oauth_client_id: "agent-client" },
    { user_id: "owner-b", google_subject: "subject-b", generation: 5, oauth_client_id: "agent-client" },
  ];

  it("revokes each grant at Google before deleting its credential, and reports counts only", async () => {
    const order: string[] = [];
    let left = 2;
    const report = await retireDailyBriefCalendarGrants({
      listConnected: async (limit) => ({ rows: limit ? rows : [], total: left }),
      readCredential: async (connection) => seal(`token-${connection.userId}`, rows.find((row) => row.user_id === connection.userId)!),
      revoke: async (token) => { order.push(`revoke:${token}`); },
      removeCredential: async (connection) => { order.push(`remove:${connection.userId}`); expect(connection.grantPurpose).toBe("agent"); left -= 1; return null; },
    });
    expect(order).toEqual(["revoke:token-owner-a", "remove:owner-a", "revoke:token-owner-b", "remove:owner-b"]);
    expect(report).toEqual({ state: "complete", revoked: 2, unrevocable: 0, failed: 0, remaining: 0 });
    expect(JSON.stringify(report)).not.toMatch(/owner|subject|token/);
  });

  it("keeps a credential Google did not revoke for the next run, and is safe to repeat", async () => {
    const removed: string[] = [];
    const run = (revoke: (token: string) => Promise<void>) => retireDailyBriefCalendarGrants({
      listConnected: async (limit) => {
        const open = rows.filter((row) => !removed.includes(row.user_id));
        return { rows: limit ? open : [], total: open.length };
      },
      readCredential: async (connection) => seal("token", rows.find((row) => row.user_id === connection.userId)!),
      revoke,
      removeCredential: async (connection) => { removed.push(connection.userId); return null; },
    });
    expect(await run(async () => { throw new Error("synthetic outage"); })).toEqual({ state: "incomplete", revoked: 0, unrevocable: 0, failed: 2, remaining: 2 });
    expect(removed).toEqual([]);
    expect(await run(async () => undefined)).toMatchObject({ state: "complete", revoked: 2, remaining: 0 });
    expect(await run(async () => { throw new Error("never called"); })).toEqual({ state: "complete", revoked: 0, unrevocable: 0, failed: 0, remaining: 0 });
  });

  it("removes a credential Cadence cannot open, and revokes once a grant whose identity is gone", async () => {
    const revoke = vi.fn(async () => undefined);
    const removeCredential = vi.fn(async (connection: CalendarConnection) => connection.userId === "owner-b" ? seal("orphan", rows[1]!) : null);
    const report = await retireDailyBriefCalendarGrants({
      listConnected: async (limit) => ({ rows: limit ? rows : [], total: 0 }),
      readCredential: async (connection) => {
        if (connection.userId === "owner-b") throw new Error("reconnect_required");
        return "not-a-sealed-token";
      },
      revoke, removeCredential,
    });
    expect(report).toEqual({ state: "complete", revoked: 1, unrevocable: 1, failed: 0, remaining: 0 });
    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("orphan");
    expect(removeCredential).toHaveBeenCalledTimes(2);
  });

  it("revokes nothing without the Daily Brief client and sealing key", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_AGENT_CLIENT_ID", "");
    const revoke = vi.fn();
    expect(await retireDailyBriefCalendarGrants({ listConnected: async () => ({ rows, total: 2 }), revoke }))
      .toEqual({ state: "not_configured", revoked: 0, unrevocable: 0, failed: 0, remaining: 2 });
    expect(await retireDailyBriefCalendarGrants({ listConnected: async () => ({ rows: [], total: 0 }), revoke }))
      .toMatchObject({ state: "complete", remaining: 0 });
    expect(revoke).not.toHaveBeenCalled();
  });
});
