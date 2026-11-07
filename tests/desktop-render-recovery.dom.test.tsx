// @vitest-environment jsdom
// Ticket 285: the archive notice blanked the Mac window. Its link needs a LinkProvider on the
// desktop Timeline, and a render error must show a recovery message instead of unmounting the app.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { Product } from "../apps/desktop/src/product";
import { DesktopErrorBoundary } from "../apps/desktop/src/desktop-error-boundary";

const mocks = vi.hoisted(() => ({ timeline: vi.fn(), behaviors: vi.fn(), command: vi.fn(),
  listen: vi.fn(), events: vi.fn(), reminders: vi.fn(), reconcileEndDates: vi.fn(), retainDeliveries: vi.fn(), shortcutContext: vi.fn(), shortcutStates: vi.fn(), shortcutCommit: vi.fn(), linked: false, sync: vi.fn(),
  failTimeline: false }));
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
vi.mock("../apps/desktop/src/timeline-screen", async (importOriginal) => {
  const original = await importOriginal<typeof import("../apps/desktop/src/timeline-screen")>();
  return { TimelineScreen: (props: Parameters<typeof original.TimelineScreen>[0]) => {
    if (mocks.failTimeline) throw new Error("Synthetic Timeline render failure");
    return <original.TimelineScreen {...props} />;
  } };
});

const now = Temporal.Instant.from("2026-08-30T12:00:00Z");
const profile = { id: "11111111-1111-4111-8111-111111111111", email: "", display_name: null, timezone: "America/New_York",
  created_at: now.toString(), updated_at: now.toString() };
let root: Root;
let container: HTMLDivElement;
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.trim() === text);
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.linked = false; mocks.failTimeline = false;
  mocks.sync.mockResolvedValue({ state: "current", completedAt: "2026-08-30T12:00:00Z" }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  // React reports caught render errors to the console; the assertions below check the outcome.
  vi.spyOn(console, "error").mockImplementation(() => {});
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
  mocks.shortcutContext.mockResolvedValue({ state: null, globalState: null, behavior: null, notes: [], importedOccurrenceIds: [] });
  mocks.shortcutStates.mockResolvedValue([]);
  // Account A's state at the defect: one automatically archived Behavior.
  mocks.timeline.mockResolvedValue({ profile, behaviors: [], categories: [],
    timeline: { ...resolveTimeline({ now, timezone: profile.timezone, occurrences: [] }),
      archiveNotifications: [{ behaviorId: "22222222-2222-4222-8222-222222222222", title: "W6 Library stop", endDate: "2026-08-29" }] } });
  mocks.behaviors.mockResolvedValue({ behaviors: { activeBehaviors: [], archivedBehaviors: [], categories: [] },
    analytics: resolveAnalytics({ now, timezone: profile.timezone, occurrences: [] }) });
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe("desktop Timeline archive notice", () => {
  it("renders the notice and opens Behaviors from its link", async () => {
    await act(() => root.render(<Product />)); await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Timeline");
    expect(container.textContent).toContain("“W6 Library stop” was automatically archived for its 2026-08-29 end date.");
    const link = Array.from(container.querySelectorAll("a")).find((element) => element.textContent === "Review archived behaviors");
    expect(link?.getAttribute("href")).toBe("/behaviors");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(() => { link!.dispatchEvent(click); }); await settle();
    // The webview never loads the href; the app switches screens instead.
    expect(click.defaultPrevented).toBe(true);
    expect(container.querySelector("h1")?.textContent).toBe("Behaviors");
  });
});

describe("desktop render recovery", () => {
  it("shows the recovery message for a failed screen and keeps navigation and Settings working", async () => {
    mocks.failTimeline = true;
    await act(() => root.render(<Product />)); await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("This screen could not be shown. Try again, or open another screen.");
    expect(container.querySelector('[aria-label="Desktop navigation"]')).not.toBeNull();
    await act(() => button("Try again")!.click());
    expect(container.textContent).toContain("This screen could not be shown.");
    await act(() => button("Settings")!.click()); await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Settings");
    expect(container.textContent).not.toContain("This screen could not be shown.");
    mocks.failTimeline = false;
    await act(() => button("Timeline")!.click()); await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Timeline");
  });

  it("shows the app recovery message when the whole product fails to render", async () => {
    function Broken(): never { throw new Error("Synthetic shell failure"); }
    await act(() => root.render(<DesktopErrorBoundary scope="app"><Broken /></DesktopErrorBoundary>));
    expect(container.querySelector('main[role="alert"]')?.textContent).toBe("Cadence could not open. Quit and reopen the app to try again.");
  });
});
