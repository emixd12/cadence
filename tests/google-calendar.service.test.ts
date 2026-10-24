import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { startCalendarConnection, finishCalendarConnection, listCalendarCalendars, getCalendarEvents, getCalendarEventsForAdvisor, prepareCalendarRevocation } from "@/lib/services/google-calendar.service";
import { GOOGLE_CALENDAR_SCOPES, hashCalendarState, readCalendarOAuthConfig, sealCalendarSecret } from "@/lib/services/google-calendar-oauth";
const repo = vi.hoisted(() => ({ beginCalendarAttempt: vi.fn(), consumeCalendarAttempt: vi.fn(), readCalendarCallbackUser: vi.fn(), installCalendarCredential: vi.fn(), readCalendarConnection: vi.fn(), readCalendarCredential: vi.fn(), removeCalendarCredential: vi.fn() }));
vi.mock("@/lib/db/google-calendar.repo", () => repo);
const provider = vi.hoisted(() => ({ readGoogleCalendarCalendars: vi.fn(), readGoogleCalendarEvents: vi.fn() }));
vi.mock("@/lib/services/google-calendar-provider", async (importOriginal) => ({ ...await importOriginal<object>(), ...provider }));
import { GoogleCalendarProviderError } from "@/lib/services/google-calendar-provider";
import type { CalendarCaller } from "@/lib/services/google-calendar.service";
import { Temporal } from "@js-temporal/polyfill";
const user = { id: "owner", identities: [{ provider: "google", identity_data: { sub: "subject" } }] } as unknown as User;
const state = "a".repeat(43);
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs();
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "client"); vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "secret");
  vi.stubEnv("GOOGLE_CALENDAR_CALLBACK_URL", "https://cadence.example/auth/google-calendar/callback");
  vi.stubEnv("GOOGLE_CALENDAR_LEGACY_CALLBACK_URL", "");
  vi.stubEnv("GOOGLE_CALENDAR_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64")); vi.stubEnv("GOOGLE_CALENDAR_KEY_ID", "v1");
  const attempt = { userId: user.id, googleSubject: "subject", generation: 0, stateHash: hashCalendarState(state), target: "web", clientState: "b".repeat(43), expiresAt: "2099-01-01T00:00:00Z" };
  repo.consumeCalendarAttempt.mockResolvedValue({ ...attempt, sealedVerifier: sealCalendarSecret(readCalendarOAuthConfig()!, "verifier", { ...attempt, purpose: "verifier" }) });
  repo.readCalendarCallbackUser.mockResolvedValue(user);
});
describe("Calendar callback lifecycle", () => {
  it.each(["https://cadence.example", "https://legacy.example"])("keeps consent, code exchange and Settings on %s", async (requestOrigin) => {
    vi.stubEnv("GOOGLE_CALENDAR_LEGACY_CALLBACK_URL", "https://legacy.example/auth/google-calendar/callback");
    repo.readCalendarConnection.mockResolvedValue(null);
    const authorization = await startCalendarConnection({ client: {} as CalendarCaller["client"], user }, "web", "", requestOrigin);
    expect(new URL(authorization.url).searchParams.get("redirect_uri")).toBe(`${requestOrigin}/auth/google-calendar/callback`);
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: "ephemeral", token_type: "Bearer", scope: GOOGLE_CALENDAR_SCOPES.join(" "), refresh_token: "refresh" }))
      .mockResolvedValueOnce(Response.json({ sub: "subject" }));
    expect(await finishCalendarConnection({ state, code: "code", denied: false, cookieUser: user, requestOrigin })).toBe(`${requestOrigin}/settings?calendar=connected`);
    expect(new URLSearchParams(fetcher.mock.calls[0][1]?.body as URLSearchParams).get("redirect_uri")).toBe(`${requestOrigin}/auth/google-calendar/callback`);
    expect(repo.installCalendarCredential).toHaveBeenCalledOnce();
  });
  it("rejects an unconfigured callback host before consuming state or contacting Google", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(finishCalendarConnection({ state, code: "code", denied: false, cookieUser: user, requestOrigin: "https://evil.example" })).rejects.toThrow("not_configured");
    expect(repo.consumeCalendarAttempt).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("consumes denied attempts and returns a fixed cancellation without exchanging tokens", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    expect(await finishCalendarConnection({ state, code: null, denied: true, cookieUser: user })).toBe("https://cadence.example/settings?calendar=cancelled");
    expect(repo.consumeCalendarAttempt).toHaveBeenCalledWith(hashCalendarState(state), "standard");
    expect(fetcher).not.toHaveBeenCalled(); expect(repo.installCalendarCredential).not.toHaveBeenCalled();
  });
  it("rejects a web callback from a different signed-in account", async () => {
    const result = await finishCalendarConnection({ state, code: "code", denied: false, cookieUser: { ...user, id: "other" } });
    expect(result).toContain("calendar=unauthenticated");
    expect(repo.installCalendarCredential).not.toHaveBeenCalled();
  });
  it("does not exchange replayed or expired state", async () => {
    repo.consumeCalendarAttempt.mockResolvedValue(null);
    const fetcher = vi.spyOn(globalThis, "fetch");
    expect(await finishCalendarConnection({ state, code: "code", denied: false, cookieUser: user })).toContain("calendar=error");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves only the fixed wrong-account recovery result for desktop", async () => {
    const attempt = await repo.consumeCalendarAttempt();
    repo.consumeCalendarAttempt.mockResolvedValue({ ...attempt, target: "desktop" });
    repo.readCalendarCallbackUser.mockResolvedValue({ ...user, identities: [{ provider: "google", identity_data: { sub: "other" } }] });
    const fetcher = vi.spyOn(globalThis, "fetch");
    const result = await finishCalendarConnection({ state, code: "code", denied: false, cookieUser: null });
    expect(result).toBe(`cadence://calendar/callback?state=${attempt.clientState}&result=same_account_required`);
    expect(repo.installCalendarCredential).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects an account whose Google identity changed since consent started", async () => {
    repo.readCalendarCallbackUser.mockResolvedValue({ ...user, identities: [{ provider: "google", identity_data: { sub: "other" } }] });
    expect(await finishCalendarConnection({ state, code: "code", denied: false, cookieUser: user })).toContain("same_account_required");
    expect(repo.installCalendarCredential).not.toHaveBeenCalled();
  });
});


describe("Calendar broker typed failures", () => {
  it.each(["permission_denied", "timeout", "malformed_provider_response", "incomplete_pagination", "invalid_request"] as const)("preserves %s for both calendar and event reads", async (code) => {
    const connection = { userId: user.id, googleSubject: "subject", generation: 1, selectionRevision: 1, status: "connected",
      preferences: { selectedCalendarIds: ["work"], hiddenCalendarIds: [], visible: true, showAllDay: true } };
    repo.readCalendarConnection.mockResolvedValue(connection);
    repo.readCalendarCredential.mockResolvedValue(sealCalendarSecret(readCalendarOAuthConfig()!, "refresh", { ...connection, purpose: "refresh" }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ access_token: "ephemeral", token_type: "Bearer" }));
    const failure = { code, calendarId: null, retryable: false, retryAfterSeconds: null, message: "Private provider detail" };
    provider.readGoogleCalendarCalendars.mockRejectedValueOnce(new GoogleCalendarProviderError(failure));
    const client = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "UTC" }, error: null }) }) }) }) } as unknown as CalendarCaller["client"];
    const caller = { client, user };
    await expect(listCalendarCalendars(caller)).rejects.toMatchObject({ code, message: code });
    provider.readGoogleCalendarCalendars.mockResolvedValue([{ id: "work", name: "Work", timezone: "UTC", primary: true, selected: true, accessRole: "owner" }]);
    provider.readGoogleCalendarEvents.mockResolvedValue({ ok: false, error: failure });
    const today = Temporal.Now.instant().toZonedDateTimeISO("UTC").toPlainDate().toString();
    await expect(getCalendarEvents(caller, today, today)).rejects.toMatchObject({ code, message: code });
  });
});

it("intersects advisor consent before the provider event read and fences connector revisions", async () => {
  vi.stubEnv("GOOGLE_CALENDAR_PROJECT_ID", "standard-project");
  vi.stubEnv("GOOGLE_CALENDAR_AGENT_PROJECT_ID", "agent-project");
  vi.stubEnv("GOOGLE_CALENDAR_AGENT_CLIENT_ID", "agent-client");
  vi.stubEnv("GOOGLE_CALENDAR_AGENT_CLIENT_SECRET", "agent-secret");
  const connection = { grantPurpose: "agent" as const, oauthClientId: "agent-client", userId: user.id, googleSubject: "subject", generation: 3, selectionRevision: 4, status: "connected",
    preferences: { selectedCalendarIds: ["work", "private"], hiddenCalendarIds: [], visible: true, showAllDay: true } } as const;
  repo.readCalendarConnection.mockResolvedValue(connection);
  repo.readCalendarCredential.mockResolvedValue(sealCalendarSecret(readCalendarOAuthConfig(process.env, undefined, "agent")!, "refresh", { ...connection, purpose: "refresh" }));
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ access_token: "ephemeral", token_type: "Bearer" }));
  provider.readGoogleCalendarCalendars.mockResolvedValue([
    { id: "work", name: "Work", timezone: "UTC", primary: true, selected: true, accessRole: "owner" },
    { id: "private", name: "Private", timezone: "UTC", primary: false, selected: true, accessRole: "owner" },
  ]);
  provider.readGoogleCalendarEvents.mockResolvedValue({ ok: true, snapshot: {} });
  const client = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { timezone: "UTC" }, error: null }) }) }) }) } as unknown as CalendarCaller["client"];
  const now = Temporal.Instant.from("2026-09-19T12:00:00Z");

  await getCalendarEventsForAdvisor({ client, user }, "2026-09-19", "2026-09-19", {
    authorizedCalendarIds: ["work"], expectedConnectionGeneration: 3, expectedSelectionRevision: 4,
    authorizationScope: "daily-brief:7", now,
  });
  expect(provider.readGoogleCalendarEvents).toHaveBeenCalledWith(expect.objectContaining({
    calendars: [expect.objectContaining({ id: "work" })],
    range: expect.objectContaining({ selectedCalendarIds: ["work"] }),
  }));
  expect(provider.readGoogleCalendarEvents.mock.calls[0]?.[0].calendars).not.toContainEqual(expect.objectContaining({ id: "private" }));

  await expect(getCalendarEventsForAdvisor({ client, user }, "2026-09-19", "2026-09-19", {
    authorizedCalendarIds: ["work"], expectedConnectionGeneration: 2, expectedSelectionRevision: 4,
    authorizationScope: "daily-brief:7", now,
  })).rejects.toMatchObject({ code: "connection_changed" });
});

it("prepares Calendar revocation without mutating the surviving account", async () => {
  const connection = { userId: user.id, googleSubject: "subject", generation: 1, selectionRevision: 1, status: "connected",
    preferences: { selectedCalendarIds: ["work"], hiddenCalendarIds: [], visible: true, showAllDay: true } };
  repo.readCalendarConnection.mockResolvedValue(connection);
  repo.readCalendarCredential.mockResolvedValue(sealCalendarSecret(readCalendarOAuthConfig()!, "refresh", { ...connection, purpose: "refresh" }));
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  const revoke = await prepareCalendarRevocation({ client: {} as CalendarCaller["client"], user });
  expect(repo.removeCalendarCredential).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(revoke).not.toBeNull();
  await revoke!();
  expect(fetcher).toHaveBeenCalledOnce();
});
