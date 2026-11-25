// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBriefSettings } from "@cadence/core/types/daily-brief";

import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import type { CalendarConnectionView, CalendarListEntry } from "@/lib/types/google-calendar";
import type { GoogleCalendarAiConnectionView, GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import { googleCalendarDualSectionState, settingsSectionLoad } from "@/lib/ui/settings-sections";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderAsync(element: ReactElement) {
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const RANGE = { startLocalDate: "2026-11-25", endLocalDate: "2026-12-02", timezone: "America/New_York" } as const;

const CALENDARS: readonly CalendarListEntry[] = [
  { id: "primary", name: "Primary", timezone: "America/New_York", primary: true, selected: true, accessRole: "owner" },
  { id: "work", name: "Work", timezone: "America/New_York", primary: false, selected: false, accessRole: "writer" },
];

function makeView(
  status: CalendarConnectionView["status"],
  selectedCalendarIds: string[] = [],
  extra: Partial<GoogleCalendarAiConnectionView> = {},
): GoogleCalendarAiConnectionView {
  return {
    accountId: "user-1",
    status,
    generation: 1,
    selectionRevision: 1,
    preferences: { selectedCalendarIds, hiddenCalendarIds: [], visible: true, showAllDay: true },
    ...extra,
  };
}

function makeDualCoordinator(options: Readonly<{
  timeline: CalendarConnectionView;
  ai: GoogleCalendarAiConnectionView;
  syncResult?: Readonly<{ view: CalendarConnectionView; hiddenCalendarsSkipped: number }>;
}>): GoogleCalendarCoordinator {
  return {
    getConnection: vi.fn(async () => options.timeline),
    beginConnect: vi.fn(async () => {}),
    listCalendars: vi.fn(async () => CALENDARS),
    savePreferences: vi.fn(async (preferences) => ({ ...options.timeline, preferences })),
    refreshEvents: vi.fn(async () => { throw new Error("unused"); }),
    disconnect: vi.fn(async () => ({ view: makeView("disconnected"), revocationFailed: false })),
    ai: {
      getConnection: vi.fn(async () => options.ai),
      beginConnect: vi.fn(async () => {}),
      listCalendars: vi.fn(async () => CALENDARS),
      savePreferences: vi.fn(async (preferences) => ({ ...options.ai, preferences })),
      syncFromTimeline: vi.fn(async () => options.syncResult ?? {
        view: makeView("connected", options.timeline.preferences.selectedCalendarIds),
        hiddenCalendarsSkipped: 0,
      }),
      disconnect: vi.fn(async () => ({ view: makeView("disconnected"), revocationFailed: false })),
    },
  };
}

describe("googleCalendarDualSectionState (Q6 status pills)", () => {
  it("reports Not connected, Timeline only, AI only, Timeline & AI, and Needs reconnection", () => {
    const disc = settingsSectionLoad(makeView("disconnected"), false);
    const conn = settingsSectionLoad(makeView("connected", ["primary"]), false);
    const reconn = settingsSectionLoad(makeView("reconnect_required"), false);

    expect(googleCalendarDualSectionState(disc, disc)).toEqual({ text: "Not connected", on: false, attention: false });
    expect(googleCalendarDualSectionState(conn, disc)).toEqual({ text: "Timeline only", on: true, attention: false });
    expect(googleCalendarDualSectionState(disc, conn)).toEqual({ text: "AI only", on: true, attention: false });
    expect(googleCalendarDualSectionState(conn, conn)).toEqual({ text: "Timeline & AI", on: true, attention: false });
    expect(googleCalendarDualSectionState(conn, reconn)).toEqual({ text: "Needs reconnection", on: true, attention: true });
    expect(googleCalendarDualSectionState(reconn, disc)).toEqual({ text: "Needs reconnection", on: true, attention: true });
  });
});

describe("GoogleCalendarPanel dual-grant UX (Q3, Q4, Q6)", () => {
  it("renders collapsed AI pills picker with simple checkboxes only (no Visible on Timeline)", async () => {
    const coordinator = makeDualCoordinator({
      timeline: makeView("connected", ["primary"]),
      ai: makeView("connected", ["primary"]),
    });

    await renderAsync(<GoogleCalendarPanel coordinator={coordinator} refreshRange={RANGE} />);

    const aiPicker = container.querySelector<HTMLElement>("[data-testid='ai-calendar-picker']")!;
    expect(aiPicker).toBeTruthy();
    expect(aiPicker.textContent).toContain("Primary");
    expect(aiPicker.querySelectorAll("input[type='checkbox']")).toHaveLength(0);

    const toggleBtn = Array.from(aiPicker.querySelectorAll("button")).find((b) => b.textContent === "Change calendars")!;
    await act(async () => { toggleBtn.click(); });

    expect(aiPicker.querySelectorAll("input[type='checkbox']")).toHaveLength(2);
    expect(aiPicker.textContent).not.toMatch(/Visible on Timeline/i);
  });

  it("shows one-time hidden-calendar seeding note when aiHiddenSkipped > 0", async () => {
    const coordinator = makeDualCoordinator({
      timeline: makeView("connected", ["primary"]),
      ai: makeView("connected", ["primary"]),
    });

    await renderAsync(<GoogleCalendarPanel coordinator={coordinator} refreshRange={RANGE} aiHiddenSkipped={2} />);

    const note = container.querySelector<HTMLElement>("[data-testid='google-calendar-hidden-skipped-note']")!;
    expect(note).toBeTruthy();
    expect(note.textContent).toContain("2 hidden Google calendars could not be copied automatically.");
  });

  it("shows quiet drift hint and one-click Sync to AI when Timeline and AI selections differ", async () => {
    const coordinator = makeDualCoordinator({
      timeline: makeView("connected", ["primary", "work"]),
      ai: makeView("connected", ["primary"]),
    });

    await renderAsync(<GoogleCalendarPanel coordinator={coordinator} refreshRange={RANGE} />);

    const hint = container.querySelector<HTMLElement>("[data-testid='google-calendar-drift-hint']")!;
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain("AI features use a separate selection (1 calendar).");

    const syncBtn = Array.from(hint.querySelectorAll("button")).find((b) => b.textContent === "Sync to AI")!;
    await act(async () => { syncBtn.click(); });
    expect(coordinator.ai?.syncFromTimeline).toHaveBeenCalledTimes(1);
  });

  it("shows chained Step 2 prompt when Timeline just connected and AI is enabled", async () => {
    const coordinator = makeDualCoordinator({
      timeline: makeView("connected", ["primary"]),
      ai: makeView("disconnected"),
    });

    await renderAsync(
      <GoogleCalendarPanel
        coordinator={coordinator}
        refreshRange={RANGE}
        callbackMessage="Google Calendar connected. Choose the calendars Cadence can show."
        aiEnabled
      />,
    );

    const step2 = container.querySelector<HTMLElement>("[data-testid='google-calendar-step2-prompt']")!;
    expect(step2).toBeTruthy();
    expect(step2.textContent).toMatch(/Step 2/i);
    expect(Array.from(step2.querySelectorAll("button")).some((b) => b.textContent === "Connect Google Calendar for AI")).toBe(true);
  });

  it("shows exact affectedChatCount warning on AI disconnect confirmation (Q4)", async () => {
    const coordinator = makeDualCoordinator({
      timeline: makeView("connected", ["primary"]),
      ai: makeView("connected", ["primary"], { affectedChatCount: 3 }),
    });

    await renderAsync(<GoogleCalendarPanel coordinator={coordinator} refreshRange={RANGE} />);

    const disconnectBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Disconnect Google Calendar for AI")!;
    await act(async () => { disconnectBtn.click(); });

    expect(container.textContent).toContain(
      "Disconnecting removes 3 conversations that used Google Calendar and clears Undo for changes made in them; your completed schedule changes stay.",
    );
  });
});

describe("DailyBriefSettingsPanel dual-grant & longitudinal review UX (Q2, Q6)", () => {
  function makeSettings(overrides: Partial<DailyBriefSettings> = {}): DailyBriefSettings {
    return {
      accountRef: "acct-1",
      available: true,
      enabled: true,
      useConnectedSources: true,
      excludedSources: { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false },
      sourceStatus: { googleCalendar: "not_connected", outlookCalendar: "not_connected", icloudCalendar: "not_connected", hevy: "not_connected" },
      includeCalendar: false,
      includeNotes: true,
      includeReminderHistory: true,
      revision: 1,
      localDate: "2026-11-25",
      timezone: "America/New_York",
      ai: { approved: true, tipsEnabled: true, chatEnabled: true },
      timelineGoogleCalendarConnected: true,
      longitudinalCalendarReviewEnabled: false,
      longitudinalCalendarReviewCadence: "weekly",
      ...overrides,
    };
  }

  it("shows compact inline Connect Google Calendar for AI shortcut only when Timeline connected and AI not", async () => {
    const onConnect = vi.fn();
    const client: DailyBriefClient = {
      preferences: vi.fn(async () => makeSettings()),
      updatePreferences: vi.fn(async () => makeSettings()),
      requestBrief: vi.fn(async () => ({ state: "already_attempted" as const })),
    };

    await renderAsync(<DailyBriefSettingsPanel client={client} onConnectGoogleCalendarAi={onConnect} />);

    const shortcut = container.querySelector<HTMLElement>("[data-testid='ai-connect-google-calendar-shortcut']")!;
    expect(shortcut).toBeTruthy();
    const btn = Array.from(shortcut.querySelectorAll("button")).find((b) => b.textContent === "Connect Google Calendar for AI")!;
    await act(async () => { btn.click(); });
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("shows Manage in Connected sources link under Choose sources and hides shortcut when AI is connected", async () => {
    const client: DailyBriefClient = {
      preferences: vi.fn(async () => makeSettings({
        sourceStatus: { googleCalendar: "ready", outlookCalendar: "not_connected", icloudCalendar: "not_connected", hevy: "not_connected" },
      })),
      updatePreferences: vi.fn(async () => makeSettings()),
      requestBrief: vi.fn(async () => ({ state: "already_attempted" as const })),
    };

    await renderAsync(<DailyBriefSettingsPanel client={client} />);

    expect(container.querySelector("[data-testid='ai-connect-google-calendar-shortcut']")).toBeNull();
    const manageLink = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Manage in Connected sources")!;
    expect(manageLink).toBeTruthy();
    expect(manageLink.getAttribute("href")).toBe("#connector-google_calendar");
  });

  it("renders longitudinal calendar-load review opt-in toggle and saves cadence", async () => {
    const updatePreferences = vi.fn(async () => makeSettings({ longitudinalCalendarReviewEnabled: true, longitudinalCalendarReviewCadence: "weekly" }));
    const client: DailyBriefClient = {
      preferences: vi.fn(async () => makeSettings()),
      updatePreferences,
      requestBrief: vi.fn(async () => ({ state: "already_attempted" as const })),
    };

    await renderAsync(<DailyBriefSettingsPanel client={client} />);

    const section = container.querySelector<HTMLElement>("[data-testid='longitudinal-calendar-review-section']")!;
    const toggle = section.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    expect(toggle.checked).toBe(false);

    await act(async () => { toggle.click(); });
    expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
      longitudinalCalendarReviewEnabled: true,
      longitudinalCalendarReviewCadence: "weekly",
    }));
  });

  it("refreshes immediately when cadence:google-calendar-ai-changed fires", async () => {
    const preferences = vi.fn()
      .mockResolvedValueOnce(makeSettings())
      .mockResolvedValueOnce(makeSettings({
        sourceStatus: { googleCalendar: "ready", outlookCalendar: "not_connected", icloudCalendar: "not_connected", hevy: "not_connected" },
      }));
    const client: DailyBriefClient = {
      preferences,
      updatePreferences: vi.fn(async () => makeSettings()),
      requestBrief: vi.fn(async () => ({ state: "already_attempted" as const })),
    };

    await renderAsync(<DailyBriefSettingsPanel client={client} />);
    expect(container.querySelector("[data-testid='ai-connect-google-calendar-shortcut']")).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event("cadence:google-calendar-ai-changed"));
      await Promise.resolve();
    });

    expect(preferences).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-testid='ai-connect-google-calendar-shortcut']")).toBeNull();
  });
});
