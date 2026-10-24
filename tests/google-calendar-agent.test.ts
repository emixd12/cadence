import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { User } from "@supabase/supabase-js";
import { disconnectCalendar, finishCalendarConnection, getCalendarConnection, getCalendarEvents, getCalendarEventsForAdvisor, prepareCalendarRevocation, startCalendarConnection, type CalendarCaller } from "@/lib/services/google-calendar.service";
import { GOOGLE_CALENDAR_SCOPES, readCalendarOAuthConfig, sealCalendarSecret } from "@/lib/services/google-calendar-oauth";
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

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-12T12:00Z"));
  for (const [name, value] of Object.entries({ GOOGLE_CALENDAR_CLIENT_ID: "standard-client", GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic-standard",
    GOOGLE_CALENDAR_PROJECT_ID: "standard-project", GOOGLE_CALENDAR_AGENT_CLIENT_ID: "agent-client", GOOGLE_CALENDAR_AGENT_CLIENT_SECRET: "synthetic-agent",
    GOOGLE_CALENDAR_AGENT_PROJECT_ID: "agent-project", GOOGLE_CALENDAR_CALLBACK_URL: "https://cadence.example/auth/google-calendar/callback",
    GOOGLE_CALENDAR_LEGACY_CALLBACK_URL: "", GOOGLE_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), GOOGLE_CALENDAR_KEY_ID: "v1" })) vi.stubEnv(name, value);
  mocks.read.mockImplementation(async (_client, _owner, purpose: CalendarPurpose) => purpose === "agent" ? agent : standard);
  mocks.credential.mockImplementation(async (connection: CalendarConnection) => sealCalendarSecret(readCalendarOAuthConfig(process.env, undefined, connection.grantPurpose)!, connection.grantPurpose === "agent" ? "agent-refresh" : "standard-refresh", { ...connection, purpose: "refresh" }));
  mocks.calendars.mockResolvedValue([{ id: "work", name: "Work", timezone: "UTC", primary: true, selected: true, accessRole: "owner" }]);
  mocks.events.mockResolvedValue({ ok: true, snapshot: {} }); mocks.user.mockResolvedValue(user);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => Response.json({ token_type: "Bearer", access_token: `${new URLSearchParams(init?.body as URLSearchParams).get("client_id")}-access` }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("keeps Timeline available without agent configuration and never reads its standard grant for AI", async () => {
  vi.stubEnv("GOOGLE_CALENDAR_AGENT_CLIENT_ID", "");
  expect((await getCalendarConnection(caller, "agent")).status).toBe("not_configured");
  await getCalendarEvents(caller, "2026-10-12", "2026-10-12");
  expect(mocks.events).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "standard-client-access" }));
  mocks.credential.mockClear();
  await expect(getCalendarEventsForAdvisor(caller, "2026-10-12", "2026-10-12")).rejects.toThrow("not_configured");
  expect(mocks.credential).not.toHaveBeenCalled();
});

it("uses distinct credentials and pending reads even when account, dates and revisions match", async () => {
  await Promise.all([getCalendarEvents(caller, "2026-10-12", "2026-10-12"), getCalendarEventsForAdvisor(caller, "2026-10-12", "2026-10-12", { now: Temporal.Instant.from("2026-10-12T12:00Z") })]);
  expect(mocks.events).toHaveBeenCalledTimes(2);
  expect(mocks.events.mock.calls.map(([input]) => input.accessToken).sort()).toEqual(["agent-client-access", "standard-client-access"]);
});

it("rejects changed agent client identity before requesting credentials", async () => {
  mocks.read.mockResolvedValue({ ...agent, oauthClientId: "retired-client" });
  expect((await getCalendarConnection(caller, "agent")).status).toBe("reconnect_required");
  await expect(getCalendarEventsForAdvisor(caller, "2026-10-12", "2026-10-12")).rejects.toThrow("reconnect_required");
  expect(mocks.credential).not.toHaveBeenCalled();
});

it("binds the agent callback to its attempted client, state and encrypted verifier", async () => {
  const { url } = await startCalendarConnection(caller, "web", "", "https://cadence.example", "agent");
  const authorization = new URL(url);
  expect(authorization.searchParams.get("client_id")).toBe("agent-client");
  const attempt = mocks.begin.mock.calls[0][0];
  expect(attempt.grantPurpose).toBe("agent");
  mocks.consume.mockResolvedValue(attempt);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ token_type: "Bearer", access_token: "agent-access", refresh_token: "agent-refresh", scope: GOOGLE_CALENDAR_SCOPES.join(" ") }))
    .mockResolvedValueOnce(Response.json({ sub: "google-owner" }));
  const input = { state: authorization.searchParams.get("state")!, code: "synthetic-code", denied: false, cookieUser: user };
  expect(await finishCalendarConnection(input)).toContain("agentCalendar=connected");
  expect(mocks.consume).toHaveBeenCalledWith(attempt.stateHash, "agent");
  expect(mocks.install).toHaveBeenCalledWith(attempt, expect.any(String));
  vi.stubEnv("GOOGLE_CALENDAR_AGENT_CLIENT_ID", "replacement-client");
  vi.mocked(fetch).mockClear();
  expect(await finishCalendarConnection(input)).toContain("agentCalendar=connection_changed");
  expect(fetch).not.toHaveBeenCalled();
});

it("disconnects only the agent grant and reports revocation failure without touching standard credentials", async () => {
  mocks.remove.mockImplementation(async (connection: CalendarConnection) => {
    expect(connection.grantPurpose).toBe("agent");
    return mocks.credential(connection);
  });
  vi.mocked(fetch).mockRejectedValue(new Error("synthetic outage"));
  const result = await disconnectCalendar(caller, "agent");
  expect(result.revocationFailed).toBe(true);
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect((await getCalendarConnection(caller)).status).toBe("connected");
});


it("attempts both account-deletion revocations even if one credential cannot decrypt", async () => {
  mocks.credential.mockImplementation(async (connection: CalendarConnection) => connection.grantPurpose === "agent"
    ? sealCalendarSecret(readCalendarOAuthConfig(process.env, undefined, "agent")!, "agent-refresh", { ...connection, purpose: "refresh" }) : "corrupt");
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
  const revoke = await prepareCalendarRevocation(caller);
  expect(fetch).not.toHaveBeenCalled();
  await expect(revoke!()).rejects.toThrow("provider_unavailable");
  expect(fetch).toHaveBeenCalledOnce();
  expect(new URLSearchParams(vi.mocked(fetch).mock.calls[0][1]!.body as URLSearchParams).get("token")).toBe("agent-refresh");
});
