// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { DesktopApp } from "../apps/desktop/src/desktop-app";
import { BehaviorsScreen } from "../apps/desktop/src/behaviors-screen";
import { TimelineScreen } from "../apps/desktop/src/timeline-screen";
import { SettingsScreen } from "../apps/desktop/src/settings-screen";
import { DesktopOnboardingGuide } from "../apps/desktop/src/onboarding-guide";
import { BehaviorForm } from "../components/behaviors/BehaviorForm";
import { toBehaviorView } from "@cadence/core/services/behavior-views";
import { storedBehavior } from "./helpers/export-row-fixture";
import { resolveAnalytics } from "@cadence/core/resolvers/analytics.resolver";
import { resolveTimeline } from "@cadence/core/resolvers/timeline.resolver";
import { resolvePersistedTimelineOccurrence } from "@cadence/core/services/timeline.service";
import type { BehaviorActionState } from "../lib/types/behavior";

const now = Temporal.Instant.from("2026-08-30T12:00:00Z");
const timezone = "America/New_York";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  document.body.style.overflow = "";
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});
async function render(node: ReactNode) { await act(() => root.render(node)); }
function button(label: string) {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((element) =>
    element.getAttribute("aria-label") === label || element.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function field(name: string) {
  const result = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
  if (!result) throw new Error(`Missing field: ${name}`);
  return result;
}
async function click(element: HTMLElement) { await act(() => element.click()); }
async function change(name: string, value: string) {
  const element = field(name);
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
function draft() { return new FormData(container.querySelector("form")!); }
function behaviorScreen() {
  const action = vi.fn(async (): Promise<BehaviorActionState> => ({ status: "idle", message: "" }));
  const review = vi.fn();
  const unchanged = async <T,>(state: T) => state;
  return { action, review, node: <BehaviorsScreen activeBehaviors={[]} archivedBehaviors={[]} categories={[{ id: "category-health", name: "Health" }]}
    analytics={resolveAnalytics({ occurrences: [], now, timezone })} createAction={action} updateAction={action} archiveAction={action} restoreAction={action}
    archiveNoteAction={action}
    statusAction={unchanged} noteAction={unchanged} stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged}
    defaultTimezone={timezone} onRefresh={vi.fn()} onNavigateReview={review} /> };
}

describe("desktop form controls execute local draft changes", () => {
  it("changes recurrence details through the mounted desktop form without saving", async () => {
    const screen = behaviorScreen(); await render(screen.node);
    await change("schedule_0_daily_interval", "3");
    expect(draft().get("schedule_0_daily_interval")).toBe("3");
    await change("schedule_0_recurrence_kind", "every_days");
    await change("schedule_0_every_days", "4");
    expect(draft().get("schedule_0_every_days")).toBe("4");
    expect(draft().has("schedule_0_daily_interval")).toBe(false);
    await change("schedule_0_recurrence_kind", "weekly");
    await change("schedule_0_weekly_interval", "2");
    await click(container.querySelector<HTMLInputElement>('[name="schedule_0_weekly_days"][value="wednesday"]')!);
    expect(draft().getAll("schedule_0_weekly_days")).toEqual(["monday", "wednesday"]);
    expect(draft().get("schedule_0_weekly_interval")).toBe("2");
    await change("schedule_0_recurrence_kind", "monthly");
    await change("schedule_0_monthly_interval", "2"); await change("schedule_0_monthly_day", "31");
    expect(draft().get("schedule_0_monthly_day")).toBe("31");
    expect(draft().has("schedule_0_weekly_days")).toBe(false);
    expect(screen.action).not.toHaveBeenCalled();
  });

  it("adds and removes schedule/time drafts while enforcing both limits", async () => {
    const screen = behaviorScreen(); await render(screen.node);
    for (let index = 0; index < 7; index++) await click(button("Add time"));
    expect(draft().get("schedule_0_time_entry_count")).toBe("8");
    expect(button("Add time").disabled).toBe(true);
    await click(button("Add time")); expect(draft().get("schedule_0_time_entry_count")).toBe("8");
    for (let index = 0; index < 7; index++) await click(button("Remove time"));
    expect(draft().get("schedule_0_time_entry_count")).toBe("1");
    expect(container.textContent).not.toContain("Remove time");
    for (let index = 0; index < 5; index++) await click(button("Add schedule"));
    expect(draft().get("behavior_schedule_count")).toBe("6");
    expect(button("Add schedule").disabled).toBe(true);
    await click(button("Add schedule")); expect(draft().get("behavior_schedule_count")).toBe("6");
    for (let index = 0; index < 5; index++) await click(button("Remove schedule"));
    expect(draft().get("behavior_schedule_count")).toBe("1");
    expect(container.textContent).not.toContain("Remove schedule");
    expect(screen.action).not.toHaveBeenCalled();
  });

  it("serializes exact times, each named range, and custom endpoints", async () => {
    const screen = behaviorScreen(); await render(screen.node);
    await change("schedule_0_time_entry_exact_time_0", "10:15");
    expect(draft().get("schedule_0_time_entry_exact_time_0")).toBe("10:15");
    await change("schedule_0_time_entry_kind_0", "range");
    expect(draft().get("schedule_0_time_entry_range_preset_0")).toBe("morning");
    for (const [preset, start, end] of [["morning", "06:00", "12:00"], ["afternoon", "12:00", "18:00"], ["evening", "18:00", "00:00"], ["night", "00:00", "06:00"]]) {
      await change("schedule_0_time_entry_range_preset_0", preset);
      expect(draft().get("schedule_0_time_entry_range_preset_0")).toBe(preset);
      await change("schedule_0_time_entry_range_preset_0", "custom");
      expect(draft().get("schedule_0_time_entry_range_start_0")).toBe(start);
      expect(draft().get("schedule_0_time_entry_range_end_0")).toBe(end);
    }
    await change("schedule_0_time_entry_range_preset_0", "custom");
    await change("schedule_0_time_entry_range_start_0", "07:15"); await change("schedule_0_time_entry_range_end_0", "09:40");
    expect(draft().get("schedule_0_time_entry_range_start_0")).toBe("07:15");
    expect(draft().get("schedule_0_time_entry_range_end_0")).toBe("09:40");
    await change("schedule_0_time_entry_kind_0", "exact");
    expect(draft().get("schedule_0_time_entry_exact_time_0")).toBe("10:15");
    expect(screen.action).not.toHaveBeenCalled();
  });

  it("changes native reminder intent and every offset without permission requests or saves", async () => {
    const screen = behaviorScreen(); await render(screen.node);
    expect(draft().get("browser_reminder")).toBe("on");
    await click(field("browser_reminder")); expect(draft().has("browser_reminder")).toBe(false);
    await click(field("browser_reminder")); expect(draft().get("browser_reminder")).toBe("on");
    for (const value of ["0", "15", "60", "1440", "4320"]) {
      await change("reminder_offset", value); expect(draft().get("reminder_offset")).toBe(value);
    }
    expect(field("email_reminder").getAttribute("type")).toBe("hidden");
    expect(screen.action).not.toHaveBeenCalled();
  });

  it("Cancel runs native form reset plus controlled-state reset without submitting", async () => {
    const screen = behaviorScreen(); await render(screen.node);
    const original = Array.from(draft().entries());
    await change("title", "Unsaved title"); await change("description", "Unsaved description"); await change("category_id", "category-health");
    await change("schedule_0_recurrence_kind", "weekly"); await click(button("Add schedule")); await click(button("Add time"));
    await change("schedule_0_time_entry_kind_0", "range"); await change("schedule_0_time_entry_range_preset_0", "night");
    await click(field("browser_reminder")); await change("reminder_offset", "4320");
    expect(Array.from(draft().entries())).not.toEqual(original);
    await click(button("Cancel"));
    expect(Array.from(draft().entries())).toEqual(original);
    expect(screen.action).not.toHaveBeenCalled();
  });

  it("review links invoke the desktop selection callback without document navigation", async () => {
    const screen = behaviorScreen(); await render(screen.node);
    const locationBefore = location.href;
    for (const range of [7, 30, 90]) {
      const link = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).find((element) => element.textContent?.trim() === `${range} days`)!;
      await click(link);
      expect(screen.review).toHaveBeenLastCalledWith({ rangeDays: range, selectedBehaviorId: undefined, selectedDayLocalDate: undefined });
    }
    expect(location.href).toBe(locationBefore);
    expect(screen.action).not.toHaveBeenCalled();
  });

  it("Cancel restores an edit draft, including active state and dormant email intent", async () => {
    const action = vi.fn(async (): Promise<BehaviorActionState> => ({ status: "idle", message: "" }));
    const behavior = toBehaviorView({ ...storedBehavior(), email_reminder_enabled: true, reminder_offset_minutes: 60 });
    await render(<BehaviorForm mode="edit" action={action} categories={[]} behavior={behavior} reminderRuntime="desktop" />);
    const original = Array.from(draft().entries());
    await change("title", "Changed title"); await change("description", "Changed description");
    await click(field("active")); await click(field("browser_reminder")); await change("reminder_offset", "1440");
    await change("schedule_0_recurrence_kind", "monthly"); await change("schedule_0_monthly_day", "31");
    await click(button("Add time")); await change("schedule_0_time_entry_exact_time_1", "18:15");
    await click(button("Cancel"));
    expect(Array.from(draft().entries())).toEqual(original);
    expect(draft().get("email_reminder")).toBe("on");
    expect(draft().get("active")).toBe("on");
    expect(action).not.toHaveBeenCalled();
  });
});

describe("desktop preference and dialog side effects", () => {
  it("focuses an opened reminder outside the feed without stealing focus on ordinary refresh", async () => {
    const unchanged = async <T,>(state: T) => state;
    const behavior = storedBehavior();
    const occurrence = resolvePersistedTimelineOccurrence({ behavior, timeSessions: [], now, timezone, occurrence: {
      id: "33333333-3333-4333-8333-333333333333", user_id: behavior.user_id, behavior_id: behavior.id,
      behavior_configuration_event_id: null, behavior_schedule_slot_id: null,
      scheduled_for: "2026-06-01T13:00:00Z", local_date: "2026-06-01", schedule_kind: "exact",
      schedule_preset: null, schedule_start_time: "09:00", schedule_end_time: null, schedule_range_identity: null,
      status: "completed", completed_at: "2026-06-01T13:01:00Z", status_marked_at: "2026-06-01T13:01:00Z",
      note: "Reminder context", created_at: now.toString(), updated_at: now.toString(),
    } })!;
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    const props = { timeline: resolveTimeline({ now, timezone, occurrences: [] }), statusAction: unchanged,
      noteAction: unchanged, startTimeTrackingAction: unchanged, stopTimeTrackingAction: unchanged,
      resetTimeTrackingAction: unchanged, onRefresh: vi.fn(), onShowMore: vi.fn() };
    await render(<TimelineScreen {...props} notificationTarget={{ requestKey: 1, status: "available", occurrence }} />);
    const row = container.querySelector<HTMLElement>(`[data-occurrence-id="${occurrence.id}"]`)!;
    const summary = row.querySelector("summary")!;
    expect(row.querySelector("details")!.open).toBe(true);
    expect(document.activeElement).toBe(summary);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "center" });
    const nextControl = button("Show more days"); nextControl.focus();
    await render(<TimelineScreen {...props} notificationTarget={{ requestKey: 1, status: "available", occurrence: { ...occurrence } }} />);
    expect(document.activeElement).toBe(nextControl);
    await render(<TimelineScreen {...props} notificationTarget={{ requestKey: 2, status: "available", occurrence }} />);
    expect(document.activeElement).toBe(summary);
    await render(<TimelineScreen {...props} notificationTarget={{ requestKey: 3, status: "unavailable" }} />);
    expect(container.querySelector("[data-occurrence-id]")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("[data-notification-result]"));
  });

  it("persists the rail preference and still toggles when storage fails", async () => {
    const navigate = vi.fn();
    const node = <DesktopApp activeScreen="timeline" onNavigate={navigate}>Content</DesktopApp>;
    await render(node); await click(button("Collapse navigation"));
    expect(localStorage.getItem("sidebar-open")).toBe("false");
    expect(button("Expand navigation")).toBeTruthy();
    await render(null); await render(node);
    expect(button("Expand navigation")).toBeTruthy();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    await click(button("Expand navigation")); expect(button("Collapse navigation")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows the connected account in both footers and opens Settings from the collapsed rail and drawer", async () => {
    const navigate = vi.fn();
    const props = { activeScreen: "timeline" as const, availableScreens: ["timeline", "settings"] as const, onNavigate: navigate };
    await render(<DesktopApp {...props} account={{ status: "linked", userId: "hosted", email: "owner@example.test", name: "Cadence User" }}>Content</DesktopApp>);
    const rail = container.querySelector('[aria-label="Desktop navigation"]')!;
    const accountButton = () => rail.querySelector<HTMLButtonElement>('[aria-label="Open account settings"]')!;
    expect(accountButton().textContent).toBe("CUCadence User");
    expect(container.textContent).not.toContain("Local profile");
    await click(button("Collapse navigation"));
    expect(accountButton().title).toBe("Cadence User");
    await click(accountButton());
    expect(navigate).toHaveBeenLastCalledWith("settings", undefined);
    await click(button("Open navigation"));
    await click(container.querySelector<HTMLButtonElement>('#desktop-mobile-navigation [aria-label="Open account settings"]')!);
    expect(button("Open navigation").getAttribute("aria-expanded")).toBe("false");
    expect(navigate).toHaveBeenCalledTimes(2);
    await render(<DesktopApp {...props} account={{ status: "linked", userId: "hosted", email: "owner@example.test" }}>Content</DesktopApp>);
    expect(accountButton().textContent).toBe("Oowner@example.test");
    await render(<DesktopApp {...props} account={{ status: "linked", userId: "hosted", email: null }}>Content</DesktopApp>);
    expect(accountButton().textContent).toBe("AAccount");
    await render(<DesktopApp {...props} account={{ status: "local" }}>Content</DesktopApp>);
    expect(accountButton()).toBeNull();
    await click(button("Expand navigation"));
    expect(rail.textContent).toContain("Local profile");
  });

  it("keeps the conflict cue in a sticky flow banner and navigates to conflict review", async () => {
    const navigate = vi.fn();
    await render(<DesktopApp activeScreen="timeline" availableScreens={["timeline", "behaviors", "export", "settings"]} conflictCount={2} onNavigate={navigate}>Content</DesktopApp>);
    const cue = button("Review 2 sync conflicts");
    expect(cue.parentElement?.className).toContain("sticky");
    expect(cue.parentElement?.className).toContain("top-16");
    expect(cue.parentElement?.className).toContain("z-20");
    expect(cue.className).not.toContain("fixed");
    await click(cue);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", "account-conflicts");
  });

  it("restores narrow-navigation focus after a pointer click and Escape", async () => {
    await render(<DesktopApp activeScreen="timeline" onNavigate={vi.fn()}>Content</DesktopApp>);
    const launcher = button("Open navigation");
    expect(document.activeElement).not.toBe(launcher);
    await click(launcher);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(launcher);
    expect(document.body.style.overflow).toBe("");
  });

  it.each(["button", "Escape", "backdrop"])("opens review and restores focus/scroll after %s dismissal", async (close) => {
    const unchanged = async <T,>(state: T) => state;
    const more = vi.fn();
    const view = resolveTimeline({ now, timezone, occurrences: [] });
    await render(<TimelineScreen timeline={view} statusAction={unchanged} noteAction={unchanged} startTimeTrackingAction={unchanged}
      stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged} onRefresh={vi.fn()} onShowMore={more} />);
    await click(button("Show more days")); expect(more).toHaveBeenCalledExactlyOnceWith(14);
    const launcher = container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    launcher.focus(); document.body.style.overflow = "scroll";
    await click(launcher);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(button("Close Needs decision"));
    expect(document.body.style.overflow).toBe("hidden");
    if (close === "button") await click(button("Close Needs decision"));
    else if (close === "Escape") await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    else await act(() => container.querySelector('[role="dialog"]')!.parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("copies detected timezone to the desktop draft without saving", async () => {
    const resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({ resolvedOptions: () => ({ ...resolvedOptions, timeZone: "Europe/London" }) } as Intl.DateTimeFormat);
    const save = vi.fn(async (state) => state);
    await render(<SettingsScreen currentTimezone={timezone} accountConnected={false} updateTimezoneAction={save} permission="denied" coverage={null} busy={false}
      onRequestPermission={vi.fn()} onReconcile={vi.fn()} onShowOnboarding={vi.fn()} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    await click(button("Use device timezone"));
    expect(field("timezone").value).toBe("Europe/London");
    expect(container.textContent).not.toContain("Use device timezone");
    expect(save).not.toHaveBeenCalled();
  });

  it("restores the launcher after a macOS-style click that did not focus the button", async () => {
    const unchanged = async <T,>(state: T) => state;
    await render(<TimelineScreen timeline={resolveTimeline({ now, timezone, occurrences: [] })}
      statusAction={unchanged} noteAction={unchanged} startTimeTrackingAction={unchanged}
      stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged} onRefresh={vi.fn()} onShowMore={vi.fn()} />);
    const launcher = container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    expect(document.activeElement).not.toBe(launcher);
    await click(launcher);
    await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(launcher);
  });

  it("reloads once for a top-edge upward wheel gesture and reports only completed success", async () => {
    const unchanged = async <T,>(state: T) => state;
    let finish!: (success: boolean) => void;
    const reload = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await render(<TimelineScreen timeline={resolveTimeline({ now, timezone, occurrences: [] })}
      statusAction={unchanged} noteAction={unchanged} startTimeTrackingAction={unchanged}
      stopTimeTrackingAction={unchanged} resetTimeTrackingAction={unchanged} onRefresh={vi.fn()}
      onReload={reload} onShowMore={vi.fn()} />);
    const timeline = container.querySelector<HTMLElement>("h1")!.parentElement!;
    await act(() => {
      timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 }));
      timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -60 }));
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Reloading Cadence and connectors");
    expect(container.textContent).not.toContain("Cadence and connectors reloaded.");
    await act(async () => { finish(true); await Promise.resolve(); });
    expect(container.textContent).toContain("Cadence and connectors reloaded.");
  });

  it("persists guide dismissal after forced review and a navigation remount", async () => {
    const dismissed = vi.fn();
    const props = { hasAnyBehavior: false, hasImportRuns: false, currentTimezone: timezone, permission: "denied" as const,
      coverage: null, onNavigate: vi.fn(), availableScreens: ["timeline", "behaviors", "export", "settings"] as const, onDismiss: dismissed };
    await render(<DesktopOnboardingGuide {...props} forceOpen />);
    await click(button("Dismiss setup"));
    expect(dismissed).toHaveBeenCalledOnce(); expect(localStorage.getItem("cadence-first-run-dismissed")).toBe("true");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await render(null); await render(<DesktopOnboardingGuide {...props} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await render(null); await render(<DesktopOnboardingGuide {...props} forceOpen />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    await click(button("Skip setup"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
