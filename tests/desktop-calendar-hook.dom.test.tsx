// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopCalendarCache } from "../apps/desktop/src/calendar/cache";
import { DesktopAiCalendarConnection, DesktopCalendarConnection } from "../apps/desktop/src/calendar/google-calendar";
import { DesktopCalendarCoordinator } from "../apps/desktop/src/calendar/coordinator";
import { useDesktopGoogleCalendar, type DesktopGoogleCalendarHookResult } from "../apps/desktop/src/calendar/use-google-calendar";
import fixture from "./fixtures/external-event-snapshot.valid.json";
import { validateExternalEventSnapshot } from "@cadence/core/services/external-event-validation";

const broker = vi.hoisted(() => ({ connection: vi.fn(), updatePreferences: vi.fn() }));
vi.mock("../apps/desktop/src/calendar/google-calendar", async (importOriginal) => ({
  ...await importOriginal<object>(), createDesktopCalendarBroker: () => broker,
}));
const deepLink = vi.hoisted(() => ({ onOpenUrl: vi.fn<(handler: (urls: string[]) => void) => Promise<() => undefined>>(async () => () => undefined), getCurrent: async () => [] }));
vi.mock("@tauri-apps/plugin-deep-link", () => deepLink);
afterEach(() => vi.restoreAllMocks());

it("publishes manual Settings refresh and refreshes again when Timeline opens", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const snapshot = validateExternalEventSnapshot(fixture);
  const preferences = { selectedCalendarIds: [...snapshot.requestedRange.selectedCalendarIds], hiddenCalendarIds: [], visible: true, showAllDay: true };
  const view = { accountId: snapshot.accountId, status: "connected" as const, generation: snapshot.connectionGeneration, selectionRevision: 1, preferences };
  broker.connection.mockResolvedValue(view);
  broker.updatePreferences.mockResolvedValue(view);
  vi.spyOn(DesktopCalendarCache.prototype, "readCurrent").mockResolvedValue(null);
  vi.spyOn(DesktopCalendarCache.prototype, "clear").mockResolvedValue(undefined);
  const refresh = vi.spyOn(DesktopCalendarCoordinator.prototype, "refresh").mockResolvedValue({ snapshot, source: "network", stale: false, refreshError: null });
  let current!: DesktopGoogleCalendarHookResult;
  const client = {} as SupabaseClient;
  function Probe({ screen }: { screen: "timeline" | "settings" }) {
    current = useDesktopGoogleCalendar({ client, accountId: snapshot.accountId, timezone: snapshot.requestedRange.timezone,
      range: snapshot.requestedRange, enabled: true, screen });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<Probe screen="settings" />));
    expect(current.snapshot).toEqual(snapshot);
    let finishCallback!: (result: Awaited<ReturnType<DesktopCalendarConnection["complete"]>>) => void;
    let failCallback!: (error: Error) => void;
    vi.spyOn(DesktopCalendarConnection.prototype, "complete").mockImplementation(() => new Promise((resolve, reject) => {
      finishCallback = resolve;
      failCallback = reject;
    }));
    await act(async () => { deepLink.onOpenUrl.mock.lastCall![0](["cadence://calendar/callback?state=opaque&result=same_account_required"]); });
    await act(async () => { await current.refresh("resume"); });
    expect(current.wrongAccount).toBe(false);
    await act(async () => { finishCallback({ result: "same_account_required", connection: view }); });
    expect(current.panelVersion).toBe(1);
    expect(current.wrongAccount).toBe(true);
    await act(async () => { await current.coordinator!.savePreferences(preferences); });
    expect(current.snapshot).toBeNull();
    expect(current.wrongAccount).toBe(false);
    await act(async () => { await current.coordinator!.refreshEvents(snapshot.requestedRange); });
    expect(current.snapshot).toEqual(snapshot);
    const calls = refresh.mock.calls.length;
    await act(() => root.render(<Probe screen="timeline" />));
    expect(refresh.mock.calls.length).toBe(calls + 1);
    expect(refresh.mock.lastCall?.[1]).toBe("open");
    const callsAfterOpen = refresh.mock.calls.length;
    await act(async () => { deepLink.onOpenUrl.mock.lastCall![0](["cadence://calendar/callback?state=expired&result=connected"]); });
    await act(async () => { failCallback(new Error("Cadence rejected an invalid Calendar connection callback.")); });
    expect(current.panelVersion).toBe(2);
    expect(refresh.mock.calls.length).toBe(callsAfterOpen + 1);
    expect(current.error).toBeNull();
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});

it.each(["account", "range"] as const)("ignores a late Settings callback after a %s change", async (change) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const old = validateExternalEventSnapshot(fixture);
  const next = { ...old, ...(change === "account" ? { accountId: "another-account" } : {}),
    requestedRange: { ...old.requestedRange, ...(change === "range" ? { endLocalDate: "2026-11-20" } : {}) } };
  const preferences = { selectedCalendarIds: [...old.requestedRange.selectedCalendarIds], hiddenCalendarIds: [], visible: true, showAllDay: true };
  const view = { accountId: old.accountId, status: "connected" as const, generation: old.connectionGeneration, selectionRevision: 1, preferences };
  broker.connection.mockResolvedValue(view);
  vi.spyOn(DesktopCalendarCache.prototype, "readCurrent").mockResolvedValue(null);
  vi.spyOn(DesktopCalendarCache.prototype, "clear").mockResolvedValue(undefined);
  const result = (snapshot: typeof old) => ({ snapshot, source: "network" as const, stale: false, refreshError: null });
  const refresh = vi.spyOn(DesktopCalendarCoordinator.prototype, "refresh").mockResolvedValue(result(old));
  let current!: DesktopGoogleCalendarHookResult;
  const client = {} as SupabaseClient;
  function Probe({ snapshot }: { snapshot: typeof old }) {
    current = useDesktopGoogleCalendar({ client, accountId: snapshot.accountId, timezone: snapshot.requestedRange.timezone,
      range: snapshot.requestedRange, enabled: true, screen: "settings" });
    return null;
  }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<Probe snapshot={old} />));
    let releaseOld!: (value: ReturnType<typeof result>) => void;
    refresh.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }));
    let manual!: ReturnType<NonNullable<DesktopGoogleCalendarHookResult["coordinator"]>["refreshEvents"]>;
    await act(async () => { manual = current.coordinator!.refreshEvents(old.requestedRange); await Promise.resolve(); });
    let releaseNext!: (value: ReturnType<typeof result>) => void;
    refresh.mockImplementationOnce(() => new Promise((resolve) => { releaseNext = resolve; }));
    broker.connection.mockResolvedValue({ ...view, accountId: next.accountId });
    await act(() => root.render(<Probe snapshot={next} />));
    await act(async () => { releaseOld(result(old)); await manual; });
    await act(async () => { releaseNext(result(next)); await Promise.resolve(); });
    expect(current.snapshot).toEqual(next);
  } finally {
    await act(() => root.unmount()); container.remove();
  }
});

it("routes purpose=ai_mcp deep-link callbacks to aiCallbackMessage without overwriting Timeline callbackMessage", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const snapshot = validateExternalEventSnapshot(fixture);
  const preferences = { selectedCalendarIds: [...snapshot.requestedRange.selectedCalendarIds], hiddenCalendarIds: [], visible: true, showAllDay: true };
  const view = { accountId: snapshot.accountId, status: "connected" as const, generation: snapshot.connectionGeneration, selectionRevision: 1, preferences };
  broker.connection.mockResolvedValue(view);
  vi.spyOn(DesktopCalendarCache.prototype, "readCurrent").mockResolvedValue(null);
  vi.spyOn(DesktopCalendarCache.prototype, "clear").mockResolvedValue(undefined);
  vi.spyOn(DesktopCalendarCoordinator.prototype, "refresh").mockResolvedValue({ snapshot, source: "network", stale: false, refreshError: null });
  vi.spyOn(DesktopAiCalendarConnection.prototype, "complete").mockResolvedValue({ result: "connected", connection: view });

  const onAiChanged = vi.fn();
  window.addEventListener("cadence:google-calendar-ai-changed", onAiChanged);

  let current!: DesktopGoogleCalendarHookResult;
  const client = {} as SupabaseClient;
  function Probe() {
    current = useDesktopGoogleCalendar({ client, accountId: snapshot.accountId, timezone: snapshot.requestedRange.timezone,
      range: snapshot.requestedRange, enabled: true, screen: "settings" });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() => root.render(<Probe />));
    await act(async () => {
      deepLink.onOpenUrl.mock.lastCall![0](["cadence://calendar/callback?state=ai-state&result=connected&purpose=ai_mcp"]);
    });
    expect(current.aiCallbackMessage).toBe("Google Calendar for AI features is connected.");
    expect(current.callbackMessage).toBeUndefined();
    expect(onAiChanged).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("cadence:google-calendar-ai-changed", onAiChanged);
    await act(() => root.unmount());
    container.remove();
  }
});
