// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import { useDesktopConnectors, type DesktopConnectorsResult } from "../apps/desktop/src/calendar/use-connectors";
import { hevyScopeKey } from "../apps/desktop/src/calendar/hevy";
import { OUTLOOK_ATTEMPT_KEY } from "../apps/desktop/src/calendar/outlook-calendar";
import hevyFixture from "./fixtures/recorded-activity-snapshot.valid.json";

// Ticket 225 desktop connector hook: offline freshness from the per-source cache,
// account-switch cleanup, and the Outlook deep link with Keychain correlation.

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../apps/desktop/src/calendar/google-calendar", async (importOriginal) => ({
  ...await importOriginal<object>(), createDesktopCalendarBroker: () => transport,
}));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
const deepLink = vi.hoisted(() => ({ onOpenUrl: vi.fn<(handler: (urls: string[]) => void) => Promise<() => void>>(async () => () => undefined), getCurrent: vi.fn(async () => [] as string[]) }));
vi.mock("@tauri-apps/plugin-deep-link", () => deepLink);

const hevyBase = validateRecordedActivitySnapshot(hevyFixture, { now: Temporal.Instant.from("2026-11-01T15:00:00Z") });
const hevyToday = { ...hevyBase, requestedRange: { startLocalDate: "2026-11-01", endLocalDate: "2026-11-01", timezone: "America/New_York" },
  activities: hevyBase.activities.filter((activity) => activity.localStartDate === "2026-11-01") };
const view = (provider: string, accountId = "account-1", status = "connected") => ({ accountId, provider, status, generation: provider === "hevy" ? 1 : 2, selectionRevision: 0,
  preferences: { selectedSourceIds: provider === "hevy" ? [] : ["calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true } });

let rows: Map<string, { accountId: string; scopeKey: string; snapshotJson: string }>;
let secrets: Map<string, string>;
let root: Root;
let container: HTMLDivElement;
let current!: DesktopConnectorsResult;

function Probe({ accountId }: { accountId: string | null }) {
  current = useDesktopConnectors({ client: {} as SupabaseClient, accountId, timezone: "America/New_York",
    todayLocalDate: "2026-11-01", lastLocalDate: "2026-11-03", enabled: accountId !== null, screen: "timeline" });
  return null;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T15:05:00Z"));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  rows = new Map(); secrets = new Map();
  native.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const provider = args.provider as string;
    if (command === "connector_cache_read_current") { const row = rows.get(provider); return row && row.accountId === args.accountId ? row : null; }
    if (command === "connector_cache_read") { const row = rows.get(provider); return row && row.accountId === args.accountId && row.scopeKey === args.scopeKey ? row.snapshotJson : null; }
    if (command === "connector_cache_begin") return undefined;
    if (command === "connector_cache_replace") { rows.set(provider, { accountId: args.accountId as string, scopeKey: args.scopeKey as string, snapshotJson: args.snapshotJson as string }); return undefined; }
    if (command === "connector_cache_clear") { if (provider) rows.delete(provider); else rows.clear(); return undefined; }
    if (command === "auth_secret_get") return secrets.get(args.name as string) ?? null;
    if (command === "auth_secret_set") { secrets.set(args.name as string, args.value as string); return undefined; }
    if (command === "auth_secret_remove") { secrets.delete(args.name as string); return undefined; }
    throw new Error(`unexpected ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  transport.request.mockReset();
});

describe("useDesktopConnectors", () => {
  it("shows saved Hevy workouts offline, labeled, while Outlook fails separately", async () => {
    rows.set("hevy", { accountId: "account-1", scopeKey: hevyScopeKey(view("hevy") as never, "2026-11-01", "America/New_York"), snapshotJson: JSON.stringify(hevyToday) });
    transport.request.mockRejectedValue(Object.assign(new Error("offline"), { code: "provider_unavailable" }));
    await act(() => root.render(<Probe accountId="account-1" />));
    await vi.waitFor(() => expect(current.hevy.state).toBe("error"));
    expect(current.hevy.day?.items).toHaveLength(1);
    expect(current.hevy.day?.state).toBe("stale");
    expect(current.outlook).toMatchObject({ state: "error", error: "provider_unavailable", snapshot: null });
    expect(rows.has("hevy")).toBe(true);
  });

  it("clears both source caches and the pending Outlook attempt on account switch and ignores late results", async () => {
    let release!: (value: unknown) => void;
    transport.request.mockImplementation(async (path: string) => {
      if (path === "/api/hevy/connection") return view("hevy");
      if (path.startsWith("/api/hevy/activities")) return new Promise((resolve) => { release = resolve; });
      if (path === "/api/outlook-calendar/connection") return view("outlook_calendar", "account-1", "disconnected");
      throw Object.assign(new Error("unexpected"), { code: "provider_unavailable" });
    });
    secrets.set(OUTLOOK_ATTEMPT_KEY, "{}");
    rows.set("outlook_calendar", { accountId: "account-1", scopeKey: "[]", snapshotJson: "{}" });
    await act(() => root.render(<Probe accountId="account-1" />));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await act(() => root.render(<Probe accountId="account-2" />));
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledWith("auth_secret_remove", { name: OUTLOOK_ATTEMPT_KEY }));
    expect(native.invoke).toHaveBeenCalledWith("connector_cache_clear", { provider: "hevy" });
    expect(native.invoke).toHaveBeenCalledWith("connector_cache_clear", { provider: "outlook_calendar" });
    expect(secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(false);
    await act(async () => { release(hevyToday); });
    expect(rows.has("hevy")).toBe(false);
    expect(current.hevy.day).toBeNull();
  });

  it("completes an app-started Outlook deep link and ignores a foreign one", async () => {
    transport.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/outlook-calendar/connection" && init?.method === "PUT") return { ...view("outlook_calendar"), result: "connected" };
      if (path.endsWith("/connection")) return view(path.includes("hevy") ? "hevy" : "outlook_calendar", "account-1", "disconnected");
      throw Object.assign(new Error("unexpected"), { code: "provider_unavailable" });
    });
    const state = `d${"A".repeat(43)}`;
    const clientState = "c".repeat(43);
    secrets.set(OUTLOOK_ATTEMPT_KEY, JSON.stringify({ accountId: "account-1", state, clientState, createdAt: Date.now() - 1_000 }));
    await act(() => root.render(<Probe accountId="account-1" />));
    await vi.waitFor(() => expect(deepLink.onOpenUrl).toHaveBeenCalled());
    const handler = deepLink.onOpenUrl.mock.lastCall![0];
    await act(async () => { handler([`cadence://outlook-calendar/callback?state=d${"B".repeat(43)}&code=foreign`]); });
    expect(transport.request).not.toHaveBeenCalledWith("/api/outlook-calendar/connection", expect.objectContaining({ method: "PUT" }));
    expect(current.panelVersion).toBe(0);
    await act(async () => { handler([`cadence://outlook-calendar/callback?state=${state}&code=auth-code`]); });
    await vi.waitFor(() => expect(current.outlookMessage).toBe("Outlook Calendar connected. Choose the calendars Cadence can show."));
    expect(transport.request).toHaveBeenCalledWith("/api/outlook-calendar/connection", { method: "PUT", body: JSON.stringify({ state, clientState, code: "auth-code" }) });
    expect(secrets.has(OUTLOOK_ATTEMPT_KEY)).toBe(false);
    expect(current.panelVersion).toBe(1);
  });

  it("requires a linked account in local mode", async () => {
    await act(() => root.render(<Probe accountId={null} />));
    expect(current).toMatchObject({ outlookCoordinator: null, hevyCoordinator: null, unavailableReason: "local" });
    expect(transport.request).not.toHaveBeenCalled();
  });
});
