// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { resolveExportBundle } from "@cadence/core/resolvers/export.resolver";
import { Product } from "../apps/desktop/src/product";
import { LocalExportScreen } from "../apps/desktop/src/export-screen";

const mocks = vi.hoisted(() => ({ timeline: vi.fn(), behaviors: vi.fn(), command: vi.fn(), exportData: vi.fn(), imports: vi.fn(), restores: vi.fn(),
  listen: vi.fn(), events: vi.fn(), reminders: vi.fn(), reconcileEndDates: vi.fn(), retainDeliveries: vi.fn(), shortcutContext: vi.fn(), shortcutStates: vi.fn(), shortcutCommit: vi.fn(), linked: false, sync: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async (command: string) => {
  if (command === "read_update_configuration") return { configured: false, version: "0.1.0" };
  throw new Error(`Unexpected native command: ${command}`);
}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../apps/desktop/src/account/auth", () => ({
  readDesktopAuthConfig: () => mocks.linked ? { url: "https://example.invalid", key: "synthetic" } : null,
  DesktopAuth: class {
    constructor(_config: unknown, private changed: (state: unknown) => void) {}
    async initialize() { this.changed({ status: "linked", userId: "synthetic-account", email: "owner@example.test", name: "Cadence User" }); return () => {}; }
    async firstLinkBaseline() { return "synthetic-baseline"; }
    accountClient() { return {}; }
    async dispose() {}
  },
}));
vi.mock("../apps/desktop/src/account/account-sync", () => ({
  synchronizeAccount: mocks.sync, planAccountSync: vi.fn(), synchronizeReviewedAccount: vi.fn(),
}));
vi.mock("../apps/desktop/src/native-spike", () => ({ readNativeEvents: mocks.events }));
vi.mock("../apps/desktop/src/local-timeline.service", () => ({ loadLocalTimeline: mocks.timeline }));
vi.mock("../apps/desktop/src/local-behaviors-read.service", () => ({ getLocalBehaviorsPageData: mocks.behaviors }));
vi.mock("../apps/desktop/src/local-behavior-lifecycle.service", () => ({ reconcileLocalBehaviorEndDates: mocks.reconcileEndDates }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: mocks.command }));
vi.mock("../apps/desktop/src/local-note-shortcut.service", () => ({
  createLocalNoteShortcutStore: () => ({
    userId: "11111111-1111-4111-8111-111111111111",
    readContext: mocks.shortcutContext,
    readStates: mocks.shortcutStates,
    commit: mocks.shortcutCommit,
  }),
}));
vi.mock("../apps/desktop/src/local-reminder.service", () => ({
  reconcileLocalReminders: mocks.reminders,
  retainNativeDeliveryEvents: mocks.retainDeliveries,
  requestLocalNotificationPermission: vi.fn(), reminderCoverageView: vi.fn(),
}));
vi.mock("../apps/desktop/src/local-export.service", () => ({ getLocalExportPageData: mocks.exportData, getLocalExportDownload: vi.fn() }));
vi.mock("../apps/desktop/src/local-import.service", () => ({ getLocalBehaviorLogImportPageData: mocks.imports,
  previewLocalBehaviorLogImport: vi.fn(), applyLocalBehaviorLogImport: vi.fn() }));
vi.mock("../apps/desktop/src/local-restore.service", () => ({ getLocalBehaviorLogRestorePageData: mocks.restores,
  previewLocalBehaviorLogRestore: vi.fn(), applyLocalBehaviorLogRestore: vi.fn() }));

const now = Temporal.Instant.from("2026-08-30T12:00:00Z");
const profile = { id: "11111111-1111-4111-8111-111111111111", email: "", display_name: null, timezone: "America/New_York",
  created_at: now.toString(), updated_at: now.toString() };
let root: Root;
let container: HTMLDivElement;
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
async function retry() {
  const button = Array.from(container.querySelectorAll("button")).find((element) => element.textContent === "Try again");
  expect(button).toBeDefined();
  await act(() => button!.click()); await settle();
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.linked = false; mocks.sync.mockResolvedValue({ state: "current", completedAt: "2026-08-30T12:00:00Z" }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  localStorage.setItem("cadence-first-run-dismissed", "true");
  mocks.listen.mockResolvedValue(() => {}); mocks.events.mockResolvedValue([]);
  mocks.reconcileEndDates.mockResolvedValue(0);
  mocks.reminders.mockRejectedValue(new Error("OS readback unavailable in this test"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mocks.command.mockImplementation(async (operation: string) => {
    if (operation === "readProfile") return profile;
    if (operation === "readImportRuns") return [];
    if (operation === "readImportSnapshot") return {};
    throw new Error(`Unexpected mutation or read: ${operation}`);
  });
  mocks.shortcutContext.mockImplementation(async (behaviorId: string | null) => ({
    state: null,
    globalState: null,
    behavior: behaviorId ? { id: behaviorId, user_id: profile.id, active: true, timezone: profile.timezone } : null,
    notes: [],
    importedOccurrenceIds: [],
  }));
  mocks.shortcutStates.mockResolvedValue([]);
  mocks.timeline.mockResolvedValue({ profile, behaviors: [], categories: [],
    timeline: resolveTimeline({ now, timezone: profile.timezone, occurrences: [] }) });
  mocks.behaviors.mockResolvedValue({ behaviors: { activeBehaviors: [], archivedBehaviors: [], categories: [] },
    analytics: resolveAnalytics({ now, timezone: profile.timezone, occurrences: [] }) });
  mocks.exportData.mockResolvedValue(resolveExportBundle({ now, timezone: profile.timezone, profile: { timezone: profile.timezone, subjectId: "local" },
    behaviors: [], categories: [], occurrences: [], range: "30" }));
  mocks.imports.mockResolvedValue({ recentRuns: [] }); mocks.restores.mockResolvedValue({ recentRuns: [] });
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("desktop lifecycle refresh", () => {
  async function mountAt(instant: string) {
    vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
    await act(() => root.render(<Product />));
    await act(() => vi.advanceTimersByTimeAsync(0));
  }

  it.each([false, true])("does no periodic reads, sync, or reminder work during six idle hours (linked=%s)", async (linked) => {
    mocks.linked = linked;
    await mountAt("2026-08-30T12:00:00Z");
    const accountRow = container.querySelector('[aria-label="Desktop navigation"] [aria-label="Open account settings"]');
    expect(accountRow?.textContent ?? null).toBe(linked ? "CUCadence User" : null);
    const reads = mocks.timeline.mock.calls.length;
    const syncs = mocks.sync.mock.calls.length;
    const reminders = mocks.reminders.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(6 * 60 * 60_000));
    expect(mocks.timeline).toHaveBeenCalledTimes(reads);
    expect(mocks.sync).toHaveBeenCalledTimes(syncs);
    expect(mocks.reminders).toHaveBeenCalledTimes(reminders);
  });

  it("runs one synchronization on launch and native resume with stable profile identity", async () => {
    mocks.linked = true;
    await mountAt("2026-08-30T12:00:00Z");
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    const loaded = await mocks.timeline.mock.results[0].value;
    mocks.timeline.mockResolvedValue({ ...loaded, profile: { ...profile } });
    mocks.events.mockResolvedValueOnce([{ kind: "resume", at: "2026-08-30T12:00:00Z" }]);
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(mocks.sync).toHaveBeenCalledTimes(3);
  });

  it("coalesces native refresh bursts behind a slow read", async () => {
    const loaded = await mocks.timeline();
    mocks.timeline.mockClear();
    let finish!: (value: unknown) => void;
    mocks.timeline.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mountAt("2026-08-30T12:00:00Z");
    for (let index = 0; index < 8; index++) {
      mocks.events.mockResolvedValueOnce([{ kind: "resume", at: "2026-08-30T12:00:00Z" }]);
      await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    }
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    // Reminder cancellation must not wait for this blocked screen read.
    expect(mocks.reminders).toHaveBeenCalledTimes(9);
    await act(async () => { finish(loaded); });
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.timeline.mock.calls[1][1].epochMilliseconds).toBe(Date.parse("2026-08-30T12:01:00Z"));
    expect(mocks.reminders).toHaveBeenCalledTimes(9);
    expect(mocks.behaviors).toHaveBeenCalledTimes(1);
  });

  it("awaits the newest archive reconciliation before a coalesced read", async () => {
    const loaded = await mocks.timeline();
    mocks.timeline.mockClear();
    let finishRead!: (value: unknown) => void;
    mocks.timeline.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    await mountAt("2026-08-30T12:00:00Z");
    let finishArchive!: (value: number) => void;
    mocks.reconcileEndDates.mockImplementationOnce(() => new Promise((resolve) => { finishArchive = resolve; }));
    mocks.events.mockResolvedValueOnce([{ kind: "resume", at: "2026-08-30T12:00:00Z" }]);
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    await act(async () => { finishRead(loaded); });
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    await act(async () => { finishArchive(1); });
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.behaviors).toHaveBeenCalledTimes(1);
  });

  it("runs the queued refresh after the active read fails", async () => {
    let fail!: (reason: Error) => void;
    mocks.timeline.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    await mountAt("2026-08-30T12:00:00Z");
    mocks.events.mockResolvedValueOnce([{ kind: "resume", at: "2026-08-30T12:00:00Z" }]);
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    await act(async () => { fail(new Error("Superseded read failed")); });
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(container.querySelector("h1")?.textContent).toBe("Timeline");
    expect(container.textContent).not.toContain("Superseded read failed");
  });

  it("keeps one pending synchronization when refreshed data arrives during a synchronization", async () => {
    mocks.linked = true;
    let finish!: (value: unknown) => void;
    mocks.sync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mountAt("2026-08-30T12:00:00Z");
    mocks.events.mockResolvedValueOnce([{ kind: "resume", at: "2026-08-30T12:02:00Z" }]);
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ state: "current", completedAt: "2026-08-30T12:02:00Z" }); });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it("finishes occurrence generation before synchronizing a refreshed local copy", async () => {
    mocks.linked = true;
    await mountAt("2026-08-30T12:00:00Z");
    const loaded = await mocks.timeline.mock.results[0].value;
    let finish!: (value: unknown) => void;
    mocks.timeline.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mocks.events.mockResolvedValueOnce([{ kind: "resume", at: "2026-08-30T12:00:00Z" }]);
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await act(async () => { finish(loaded); });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it("reloads local data after sync finishes without starting another sync", async () => {
    mocks.linked = true;
    let finish!: (value: unknown) => void;
    mocks.sync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mountAt("2026-08-30T12:00:00Z");
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ state: "current", completedAt: "2026-08-30T12:00:00Z" }); });
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    // macOS native resume owns foreground refresh; DOM events must not duplicate it.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("reports offline reload success only in local mode (linked=%s)", async (linked) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mocks.linked = linked;
    mocks.sync.mockResolvedValue({ state: "offline" });
    await act(() => root.render(<Product />));
    await settle();
    mocks.timeline.mockClear();
    mocks.sync.mockClear();
    const timeline = container.querySelector<HTMLElement>("h1")!.parentElement!;
    await act(() => timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 })));
    await settle();
    expect(mocks.timeline).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledTimes(linked ? 1 : 0);
    expect(container.textContent).toContain(linked
      ? "Reload incomplete. Cadence or connector data may be stale."
      : "Cadence and connectors reloaded.");
  });

  it("awaits connected account sync before the wheel reload reads the local copy", async () => {
    mocks.linked = true;
    let finish!: (status: { state: "current"; completedAt: string }) => void;
    mocks.sync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(() => root.render(<Product />));
    await settle();
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    mocks.timeline.mockClear();
    const timeline = container.querySelector<HTMLElement>("h1")!.parentElement!;
    await act(() => timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 })));
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.timeline).not.toHaveBeenCalled();

    await act(async () => { finish({ state: "current", completedAt: "2026-08-30T12:01:00Z" }); await Promise.resolve(); });
    await settle();
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.sync.mock.invocationCallOrder[1]).toBeLessThan(mocks.timeline.mock.invocationCallOrder[1]);
    expect(container.textContent).toContain("Cadence and connectors reloaded.");
  });

  it("reloads the local copy but withholds success after a revoked connected sync", async () => {
    mocks.linked = true;
    await act(() => root.render(<Product />));
    await settle();
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    await settle();
    mocks.sync.mockClear();
    mocks.timeline.mockClear();
    mocks.sync.mockResolvedValueOnce({ state: "revoked" });
    const timeline = container.querySelector<HTMLElement>("h1")!.parentElement!;
    await act(() => timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 })));
    await settle();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.timeline).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Reload incomplete. Cadence or connector data may be stale.");
    expect(container.textContent).not.toContain("Cadence and connectors reloaded.");
  });

  it("retries a failed synchronization without another bundle or duplicate immediate attempt", async () => {
    mocks.linked = true;
    mocks.sync.mockResolvedValueOnce({ state: "failed", message: "Synthetic failure" });
    await mountAt("2026-08-30T12:00:00Z");
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_251));
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it.each(["wake", "resume"])("refreshes Timeline and reminder state after %s without leaving the selected screen", async (kind) => {
    await mountAt("2026-08-30T12:00:00Z");
    const behaviors = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Behaviors")!;
    await act(() => behaviors.click());
    vi.setSystemTime(new Date("2026-08-31T14:00:00Z"));
    mocks.events.mockResolvedValueOnce([{ kind, at: "2026-08-31T14:00:00Z" }]);
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.timeline.mock.calls[1][1].epochMilliseconds).toBe(Date.parse("2026-08-31T14:00:00Z"));
    expect(mocks.reminders).toHaveBeenCalledTimes(2);
    expect(container.querySelector("h1")?.textContent).toBe("Behaviors");
  });

  it("refreshes at profile-local midnight and stops after unmount", async () => {
    mocks.timeline.mockImplementation(async (_days, at: Temporal.Instant) => ({ profile, behaviors: [], categories: [],
      timeline: resolveTimeline({ now: at, timezone: profile.timezone, occurrences: [{
        id: "midnight-occurrence", behaviorId: "midnight-behavior", title: "Evening walk", description: "", categoryName: "No category",
        scheduleSummary: "Daily", scheduledFor: "2026-08-31T03:00:00Z", scheduledTimeLabel: "11:00 PM",
        localDate: "2026-08-30", status: "unresolved", statusMarkedAt: null, note: "",
        timeTracking: { recordedSeconds: 0, runningStartedAt: null }, canStartTimeTracking: true,
      }] }) }));
    await mountAt("2026-08-31T03:59:59.500Z");
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-occurrence-id="midnight-occurrence"]')).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(mocks.timeline).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.timeline.mock.calls[1][1].epochMilliseconds).toBe(Date.parse("2026-08-31T04:00:00Z"));
    expect(mocks.reminders).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-occurrence-id="midnight-occurrence"]')).toBeNull();
    const needsDecision = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Needs decision"));
    expect(needsDecision?.textContent).toContain("1");
    await act(() => root.unmount());
    await act(() => vi.advanceTimersByTimeAsync(86_400_000));
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
  });

  it("replaces the midnight timer after the loaded profile timezone changes", async () => {
    await mountAt("2026-08-31T03:59:59.500Z");
    const changedProfile = { ...profile, timezone: "UTC" };
    mocks.timeline.mockResolvedValueOnce({ profile: changedProfile, behaviors: [], categories: [],
      timeline: resolveTimeline({ now, timezone: changedProfile.timezone, occurrences: [] }) });
    mocks.events.mockResolvedValueOnce([{ kind: "resume", at: "2026-08-31T03:59:59.500Z" }]);
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.reminders).toHaveBeenCalledTimes(2);
  });

  it("does not lose a wake arriving while the initial native event drain is pending", async () => {
    let finishInitial!: (events: unknown[]) => void;
    mocks.events.mockImplementationOnce(() => new Promise((resolve) => { finishInitial = resolve; }));
    await mountAt("2026-08-30T12:00:00Z");
    mocks.events.mockResolvedValueOnce([{ kind: "wake", at: "2026-08-30T12:01:00Z" }]);
    vi.setSystemTime(new Date("2026-08-30T12:01:00Z"));
    await act(async () => { mocks.listen.mock.calls[0][1]({ payload: null }); });
    await act(async () => { finishInitial([]); });
    expect(mocks.events).toHaveBeenCalledTimes(2);
    expect(mocks.timeline).toHaveBeenCalledTimes(2);
    expect(mocks.reminders).toHaveBeenCalledTimes(2);
  });

  it("retains launch activation evidence before the first reminder repair and keeps persistence failures visible", async () => {
    let finishInitial!: (events: unknown[]) => void;
    mocks.events.mockImplementationOnce(() => new Promise((resolve) => { finishInitial = resolve; }));
    await mountAt("2026-08-30T12:00:00Z");
    expect(mocks.reminders).not.toHaveBeenCalled();
    const delivery = { requestId: "cadence.local.33333333-3333-4333-8333-333333333333", fireAt: "2026-08-30T11:00:00Z",
      title: "Walk", body: "Synthetic", deliveredAt: "2026-08-30T11:00:01Z" };
    const events = [{ kind: "notificationActivated", id: delivery.requestId, at: "2026-08-30T12:00:00Z", delivery }];
    mocks.reminders.mockRejectedValue(new Error("Could not persist OS delivery"));
    await act(async () => { finishInitial(events); });
    expect(mocks.retainDeliveries).toHaveBeenCalledExactlyOnceWith(events);
    expect(mocks.retainDeliveries.mock.invocationCallOrder[0]).toBeLessThan(mocks.reminders.mock.invocationCallOrder[0]);
    const settings = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Settings")!;
    await act(() => settings.click());
    expect(container.textContent).toContain("Could not persist OS delivery");
  });
});

describe("desktop failed-read retries", () => {
  it("keeps Timeline and Settings usable when optional shortcut reads fail", async () => {
    mocks.shortcutContext.mockRejectedValue(new Error("Shortcut context exceeds its read limit"));
    mocks.shortcutStates.mockRejectedValue(new Error("Shortcut state unavailable"));
    await act(() => root.render(<Product />)); await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Timeline");
    const settings = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Settings")!;
    await act(() => settings.click()); await settle();
    // Ticket 305: desktop Settings has no global Note shortcuts control.
    expect(container.querySelector("#note-shortcuts")).toBeNull();
    expect(container.textContent).not.toContain("Enable Note shortcuts");
    // Ticket 292: the Day note shortcuts drawer reports the failed read; Settings stays usable.
    const drawer = [...container.querySelectorAll("[data-settings-drawer]")].find((item) => item.textContent?.startsWith("Day note shortcuts"));
    expect(drawer?.textContent).toContain("Status unavailable");
    expect(drawer?.textContent).toContain("Note shortcuts are temporarily unavailable. You can still write and save Notes.");
    expect(container.querySelector("h1")?.textContent).toBe("Settings");
  });

  it("clears the Product forced-setup request after dismissal and screen navigation", async () => {
    await act(() => root.render(<Product />)); await settle();
    async function click(label: string) {
      const element = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) =>
        item.getAttribute("aria-label") === label || item.textContent?.trim() === label);
      expect(element).toBeDefined(); await act(() => element!.click()); await settle();
    }
    await click("Settings"); await click("Show setup guide");
    expect(container.querySelector('[aria-labelledby="desktop-setup-title"]')).not.toBeNull();
    await click("Dismiss setup");
    expect(container.querySelector('[aria-labelledby="desktop-setup-title"]')).toBeNull();
    await click("Behaviors"); await click("Timeline");
    expect(container.querySelector('[aria-labelledby="desktop-setup-title"]')).toBeNull();
    expect(localStorage.getItem("cadence-first-run-dismissed")).toBe("true");
  });

  it("retries the product read, keeps a repeated error visible, then opens the same local profile", async () => {
    mocks.timeline.mockRejectedValueOnce(new Error("SQLite temporarily busy")).mockRejectedValueOnce(new Error("SQLite still busy"));
    await act(() => root.render(<Product />)); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("SQLite temporarily busy");
    await retry(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("SQLite still busy");
    await retry();
    expect(mocks.timeline).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Timeline");
    expect(mocks.command).toHaveBeenCalledExactlyOnceWith("readImportRuns", { profileId: profile.id, limit: 1 });
  });

  it("retries Export without resetting profile or invoking an import or restore mutation", async () => {
    mocks.exportData.mockRejectedValueOnce(new Error("Export snapshot unavailable"));
    const changed = vi.fn();
    await act(() => root.render(<LocalExportScreen onChanged={changed} />)); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Export snapshot unavailable");
    await retry();
    expect(mocks.exportData).toHaveBeenCalledTimes(2);
    expect(mocks.exportData).toHaveBeenLastCalledWith(profile, {});
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("BehaviorLog bundle (.behaviorlog.zip)");
    expect(mocks.command.mock.calls).toEqual([["readProfile", {}], ["readProfile", {}]]);
    expect(changed).not.toHaveBeenCalled();
  });
});
