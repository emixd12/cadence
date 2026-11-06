import { beforeEach, describe, expect, it, vi } from "vitest";

// Ticket 279: the hosted leave reminder switch for web and a linked Mac.
const auth = vi.hoisted(() => ({ caller: null as unknown, travelEnabled: true }));
vi.mock("@/lib/services/google-calendar-request", async (original) => ({
  ...(await original<typeof import("@/lib/services/google-calendar-request")>()),
  authenticateCalendarRequest: vi.fn(async () => {
    if (!auth.caller) { const { CalendarConnectionError } = await import("@/lib/services/google-calendar-oauth"); throw new CalendarConnectionError("unauthenticated"); }
    return auth.caller;
  }),
}));
vi.mock("@/lib/services/travel-settings.service", async (original) => ({
  ...(await original<typeof import("@/lib/services/travel-settings.service")>()),
  getTravelSettings: vi.fn(async () => ({ enabled: auth.travelEnabled })),
}));

import { GET, OPTIONS, PUT } from "@/app/api/travel/leave-reminders/route";
import { createLeaveReminderClient } from "@/lib/ui/leave-reminders";
import { nativeLeaveReminderNotifications } from "../apps/desktop/src/leave-reminders";

type Row = { user_id: string; enabled: boolean };
function fakeClient(rows: Row[]) {
  const calls: Array<{ op: string; value?: unknown; options?: unknown }> = [];
  const client = {
    from(table: string) {
      expect(table).toBe("travel_leave_reminder_settings");
      let userId = "";
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => { userId = value; return query; },
        maybeSingle: async () => ({ data: rows.find((row) => row.user_id === userId) ?? null, error: null }),
        upsert: (value: Row, options: unknown) => {
          calls.push({ op: "upsert", value, options });
          const index = rows.findIndex((row) => row.user_id === value.user_id);
          if (index >= 0) rows[index] = value; else rows.push(value);
          return { select: () => ({ single: async () => ({ data: { enabled: value.enabled }, error: null }) }) };
        },
      };
      return query;
    },
  };
  return { client, calls };
}

const put = (body: string, origin?: string) => PUT(new Request("https://cadence.example/api/travel/leave-reminders", {
  method: "PUT", body, headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) } }));
const get = () => GET(new Request("https://cadence.example/api/travel/leave-reminders"));

describe("leave reminder setting endpoint", () => {
  beforeEach(() => { auth.caller = null; auth.travelEnabled = true; });

  it("reads off when the account has no row and never creates one on read", async () => {
    const { client, calls } = fakeClient([]);
    auth.caller = { client, user: { id: "user-a" } };
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(calls).toEqual([]);
  });

  it("saves the switch for the session's account only, ignoring nothing but `enabled`", async () => {
    const { client, calls } = fakeClient([{ user_id: "user-b", enabled: true }]);
    auth.caller = { client, user: { id: "user-a" } };
    const response = await put(JSON.stringify({ enabled: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
    expect(calls).toEqual([{ op: "upsert", value: { user_id: "user-a", enabled: true }, options: { onConflict: "user_id" } }]);
    expect((await put(JSON.stringify({ enabled: false }))).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ value: { user_id: "user-a", enabled: false } });
  });

  it("refuses a body with other fields, a non-boolean or another account", async () => {
    const { client, calls } = fakeClient([]);
    auth.caller = { client, user: { id: "user-a" } };
    for (const body of ['{"enabled":"yes"}', '{"enabled":true,"user_id":"user-b"}', "[]", "not json", "{}"]) {
      const response = await put(body);
      expect(response.status, body).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(calls).toEqual([]);
  });

  it("turns on only while Travel estimates is on, and always turns off", async () => {
    const { client, calls } = fakeClient([{ user_id: "user-a", enabled: true }]);
    auth.caller = { client, user: { id: "user-a" } };
    auth.travelEnabled = false;
    const refused = await put(JSON.stringify({ enabled: true }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "travel_off" });
    expect(calls).toEqual([]);
    expect((await put(JSON.stringify({ enabled: false }))).status).toBe(200);
  });

  it("refuses an unauthenticated request and answers a Mac preflight", async () => {
    expect((await get()).status).toBe(401);
    const preflight = OPTIONS(new Request("https://cadence.example/api/travel/leave-reminders", { method: "OPTIONS", headers: { Origin: "tauri://localhost" } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost");
  });
});

describe("leave reminder clients", () => {
  it("sends a linked Mac's bearer token to the hosted origin and stores nothing", async () => {
    const fetch = vi.fn(async () => Response.json({ enabled: true }));
    vi.stubGlobal("fetch", fetch);
    try {
      const client = createLeaveReminderClient({ origin: "https://cadence.example", accessToken: async () => "token" });
      expect(await client.save(true)).toEqual({ enabled: true });
      expect(fetch).toHaveBeenCalledWith("https://cadence.example/api/travel/leave-reminders", expect.objectContaining({
        method: "PUT", body: '{"enabled":true}', headers: { "Content-Type": "application/json", Authorization: "Bearer token" } }));
      fetch.mockResolvedValueOnce(Response.json({ error: "travel_off" }, { status: 409 }));
      await expect(client.save(true)).rejects.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });

  it("maps macOS notification permission to the readiness states", () => {
    expect(nativeLeaveReminderNotifications("authorized")).toBe("enabled");
    expect(nativeLeaveReminderNotifications("provisional")).toBe("enabled");
    expect(nativeLeaveReminderNotifications("denied")).toBe("blocked");
    expect(nativeLeaveReminderNotifications("notDetermined")).toBe("not_enabled");
    expect(nativeLeaveReminderNotifications("unavailable")).toBe("unsupported");
    expect(nativeLeaveReminderNotifications("checking")).toBeNull();
  });
});
