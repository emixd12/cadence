import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CalendarConnectionView, CalendarListEntry, CalendarPreferences } from "@/lib/types/google-calendar";
import type { GoogleCalendarAiConnectionView } from "@/lib/ui/google-calendar";
import {
  DESKTOP_AI_CALENDAR_PENDING_KEY,
  DESKTOP_CALENDAR_PENDING_KEY,
  DesktopAiCalendarConnection,
  DesktopCalendarBroker,
  DesktopCalendarConnection,
  DesktopGoogleCalendarPanelCoordinator,
  isDesktopAiCalendarCallback,
  isDesktopCalendarCallback,
} from "../apps/desktop/src/calendar/google-calendar";
import { OUTLOOK_ATTEMPT_KEY } from "../apps/desktop/src/calendar/outlook-calendar";

const BASE_PREFS: CalendarPreferences = {
  selectedCalendarIds: ["primary"],
  hiddenCalendarIds: [],
  visible: true,
  showAllDay: false,
};

function makeView(overrides: Partial<GoogleCalendarAiConnectionView> = {}): GoogleCalendarAiConnectionView {
  return {
    accountId: "acc-1",
    status: "connected",
    generation: 2,
    selectionRevision: 3,
    preferences: BASE_PREFS,
    affectedChatCount: 4,
    ...overrides,
  };
}

function makeMemoryIo() {
  const store = new Map<string, string>();
  const opened: string[] = [];
  return {
    store,
    opened,
    io: {
      get: vi.fn(async (name: string) => store.get(name) ?? null),
      set: vi.fn(async (name: string, value: string) => { store.set(name, value); }),
      remove: vi.fn(async (name: string) => { store.delete(name); }),
      open: vi.fn(async (url: string) => { opened.push(url); }),
    },
  };
}

describe("DesktopCalendarBroker purpose=ai_mcp endpoints", () => {
  it("calls ?purpose=ai_mcp endpoints with Bearer auth while keeping standard methods untouched", async () => {
    const calls: Array<{ url: string; method: string; auth: string | null; body?: string }> = [];
    const calendars: CalendarListEntry[] = [
      { id: "primary", name: "Primary", timezone: "America/New_York", primary: true, selected: true, accessRole: "owner" },
    ];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({ url, method, auth: headers.get("Authorization"), body: init?.body ? String(init.body) : undefined });

      if (url.endsWith("/api/google-calendar/connection?purpose=ai_mcp") && method === "GET") {
        return new Response(JSON.stringify(makeView()), { status: 200 });
      }
      if (url.endsWith("/api/google-calendar/calendars?purpose=ai_mcp") && method === "GET") {
        return new Response(JSON.stringify({ calendars }), { status: 200 });
      }
      if (url.endsWith("/api/google-calendar/connection?purpose=ai_mcp") && method === "POST") {
        return new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?ai=1" }), { status: 200 });
      }
      if (url.endsWith("/api/google-calendar/calendars?purpose=ai_mcp") && method === "PUT") {
        return new Response(JSON.stringify(makeView({ selectionRevision: 4 })), { status: 200 });
      }
      if (url.endsWith("/api/google-calendar/calendars?purpose=ai_mcp") && method === "POST") {
        return new Response(JSON.stringify({ view: makeView({ selectionRevision: 5 }), hiddenCalendarsSkipped: 1 }), { status: 200 });
      }
      if (url.endsWith("/api/google-calendar/connection?purpose=ai_mcp") && method === "DELETE") {
        return new Response(JSON.stringify({ ...makeView({ status: "disconnected" }), revocationFailed: false }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const broker = new DesktopCalendarBroker("https://cadence.example.com", async () => "tok-123", fetcher);

    const conn = await broker.aiConnection();
    expect(conn.affectedChatCount).toBe(4);
    expect(await broker.aiCalendars()).toEqual(calendars);
    expect(await broker.aiConnect("state-abc")).toEqual({ url: "https://accounts.google.com/o/oauth2/v2/auth?ai=1" });
    expect((await broker.aiUpdatePreferences(BASE_PREFS)).selectionRevision).toBe(4);
    expect(await broker.aiSyncFromTimeline()).toEqual({ view: makeView({ selectionRevision: 5 }), hiddenCalendarsSkipped: 1 });
    expect(await broker.aiDisconnect()).toEqual({ view: makeView({ status: "disconnected" }), revocationFailed: false });

    expect(calls.every((c) => c.auth === "Bearer tok-123")).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://cadence.example.com/api/google-calendar/connection?purpose=ai_mcp",
      "GET https://cadence.example.com/api/google-calendar/calendars?purpose=ai_mcp",
      "POST https://cadence.example.com/api/google-calendar/connection?purpose=ai_mcp",
      "PUT https://cadence.example.com/api/google-calendar/calendars?purpose=ai_mcp",
      "POST https://cadence.example.com/api/google-calendar/calendars?purpose=ai_mcp",
      "DELETE https://cadence.example.com/api/google-calendar/connection?purpose=ai_mcp",
    ]);
    expect(JSON.parse(calls[2].body!)).toEqual({ target: "desktop", clientState: "state-abc" });
  });
});

describe("DesktopAiCalendarConnection Keychain slot and callback isolation", () => {
  it("uses dedicated pending-ai-calendar-state slot and routes purpose=ai_mcp callbacks exclusively", async () => {
    const { store, opened, io } = makeMemoryIo();
    const broker = {
      connect: vi.fn(async (clientState: string) => ({ url: `https://example.com/std?state=${clientState}` })),
      connection: vi.fn(async (): Promise<CalendarConnectionView> => makeView()),
      aiConnect: vi.fn(async (clientState: string) => ({ url: `https://example.com/ai?state=${clientState}` })),
      aiConnection: vi.fn(async (): Promise<GoogleCalendarAiConnectionView> => makeView()),
    } as unknown as DesktopCalendarBroker;

    const stdFlow = new DesktopCalendarConnection(broker, io);
    const aiFlow = new DesktopAiCalendarConnection(broker, io);

    await stdFlow.begin("acc-1");
    await aiFlow.begin("acc-1");

    expect(store.has(DESKTOP_CALENDAR_PENDING_KEY)).toBe(true);
    expect(store.has(DESKTOP_AI_CALENDAR_PENDING_KEY)).toBe(true);
    const stdState = (JSON.parse(store.get(DESKTOP_CALENDAR_PENDING_KEY)!) as { state: string }).state;
    const aiState = (JSON.parse(store.get(DESKTOP_AI_CALENDAR_PENDING_KEY)!) as { state: string }).state;
    expect(stdState).not.toBe(aiState);
    expect(opened).toHaveLength(2);

    const aiCallbackUrl = `cadence://calendar/callback?state=${aiState}&result=connected&purpose=ai_mcp`;
    const stdCallbackUrl = `cadence://calendar/callback?state=${stdState}&result=connected`;
    const retiredCallbackUrl = `cadence://calendar/callback?state=${aiState}&result=connected&purpose=agent`;

    expect(isDesktopCalendarCallback(aiCallbackUrl)).toBe(true);
    expect(isDesktopAiCalendarCallback(aiCallbackUrl)).toBe(true);
    expect(isDesktopAiCalendarCallback(stdCallbackUrl)).toBe(false);
    expect(isDesktopAiCalendarCallback(retiredCallbackUrl)).toBe(false);

    // Standard flow ignores purpose=ai_mcp and retired purpose=agent; AI flow ignores standard and retired purpose=agent
    expect(await stdFlow.complete(aiCallbackUrl, "acc-1")).toBeNull();
    expect(await stdFlow.complete(retiredCallbackUrl, "acc-1")).toBeNull();
    expect(await aiFlow.complete(stdCallbackUrl, "acc-1")).toBeNull();
    expect(await aiFlow.complete(retiredCallbackUrl, "acc-1")).toBeNull();

    // Completing AI callback consumes ONLY pending-ai-calendar-state
    const aiResult = await aiFlow.complete(aiCallbackUrl, "acc-1");
    expect(aiResult?.result).toBe("connected");
    expect(store.has(DESKTOP_AI_CALENDAR_PENDING_KEY)).toBe(false);
    expect(store.has(DESKTOP_CALENDAR_PENDING_KEY)).toBe(true);

    // Completing standard callback consumes pending-calendar-state
    const stdResult = await stdFlow.complete(stdCallbackUrl, "acc-1");
    expect(stdResult?.result).toBe("connected");
    expect(store.has(DESKTOP_CALENDAR_PENDING_KEY)).toBe(false);
  });

  it("rejects expired or wrong-account AI callbacks", async () => {
    const { store, io } = makeMemoryIo();
    const broker = {
      aiConnect: vi.fn(async () => ({ url: "https://example.com/ai" })),
      aiConnection: vi.fn(async () => makeView()),
    } as unknown as DesktopCalendarBroker;
    const aiFlow = new DesktopAiCalendarConnection(broker, io);

    const createdAt = 1_700_000_000_000;
    store.set(DESKTOP_AI_CALENDAR_PENDING_KEY, JSON.stringify({ accountId: "acc-1", state: "s1", createdAt }));
    await expect(
      aiFlow.complete("cadence://calendar/callback?state=s1&result=connected&purpose=ai_mcp", "acc-2", createdAt + 1_000),
    ).rejects.toThrow("Cadence rejected an invalid AI Calendar connection callback.");

    store.set(DESKTOP_AI_CALENDAR_PENDING_KEY, JSON.stringify({ accountId: "acc-1", state: "s1", createdAt }));
    await expect(
      aiFlow.complete("cadence://calendar/callback?state=s1&result=connected&purpose=ai_mcp", "acc-1", createdAt + 6 * 60_000),
    ).rejects.toThrow("Cadence rejected an invalid AI Calendar connection callback.");
  });
});

describe("DesktopGoogleCalendarPanelCoordinator.ai", () => {
  it("implements GoogleCalendarAiCoordinator methods", async () => {
    const { io } = makeMemoryIo();
    const broker = {
      aiConnection: vi.fn(async () => makeView()),
      aiConnect: vi.fn(async () => ({ url: "https://example.com/ai-oauth" })),
      aiCalendars: vi.fn(async (): Promise<CalendarListEntry[]> => []),
      aiUpdatePreferences: vi.fn(async () => makeView({ selectionRevision: 9 })),
      aiSyncFromTimeline: vi.fn(async () => ({ view: makeView({ selectionRevision: 10 }), hiddenCalendarsSkipped: 2 })),
      aiDisconnect: vi.fn(async () => ({ view: makeView({ status: "disconnected" }), revocationFailed: false })),
    } as unknown as DesktopCalendarBroker;

    const aiFlow = new DesktopAiCalendarConnection(broker, io);
    const coordinator = new DesktopGoogleCalendarPanelCoordinator(broker, () => "America/New_York", undefined, undefined, undefined, aiFlow);

    expect((await coordinator.ai.getConnection()).affectedChatCount).toBe(4);
    await coordinator.ai.beginConnect();
    expect(broker.aiConnect).toHaveBeenCalledTimes(1);
    expect(io.open).toHaveBeenCalledWith("https://example.com/ai-oauth");
    expect(await coordinator.ai.listCalendars()).toEqual([]);
    expect((await coordinator.ai.savePreferences(BASE_PREFS)).selectionRevision).toBe(9);
    expect(await coordinator.ai.syncFromTimeline()).toEqual({ view: makeView({ selectionRevision: 10 }), hiddenCalendarsSkipped: 2 });
    expect((await coordinator.ai.disconnect()).view.status).toBe("disconnected");
    expect(io.remove).toHaveBeenCalledWith(DESKTOP_AI_CALENDAR_PENDING_KEY);
  });
});

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (/\.(ts|tsx)$/u.test(entry.name)) out.push(full);
  }
  return out;
}

describe("Desktop Keychain ALLOWED_KEYS parity", () => {
  it("lists every pending/webview secret key used by apps/desktop/src in Rust ALLOWED_KEYS", () => {
    const authRs = readFileSync(new URL("../apps/desktop/src-tauri/src/auth.rs", import.meta.url), "utf8");
    const allowListBlock = /const ALLOWED_KEYS: &\[&str\] = &\[([^\]]*)\]/u.exec(authRs)?.[1] ?? "";
    const allowedKeys = new Set(Array.from(allowListBlock.matchAll(/"([^"]+)"/gu), (m) => m[1]));

    const expectedKeys = new Set<string>([
      "supabase-session",
      "supabase-pkce",
      "pending-state",
      DESKTOP_CALENDAR_PENDING_KEY,
      DESKTOP_AI_CALENDAR_PENDING_KEY,
      "pending-calendar-agent-state",
      OUTLOOK_ATTEMPT_KEY,
    ]);

    const desktopSrcDir = new URL("../apps/desktop/src", import.meta.url).pathname;
    for (const file of walkTsFiles(desktopSrcDir)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/auth_secret_(?:get|set|remove)["']\s*,\s*\{\s*name:\s*["']([^"']+)["']/gu)) {
        expectedKeys.add(match[1]);
      }
    }

    for (const key of expectedKeys) {
      expect(allowedKeys.has(key), `Key "${key}" used in apps/desktop/src is missing from ALLOWED_KEYS in auth.rs`).toBe(true);
    }
  });
});
