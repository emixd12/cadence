// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBriefSettings } from "@cadence/core/types/daily-brief";

import { AiFeaturesApproval } from "@/components/onboarding/AiFeaturesApproval";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import { dailyBriefSectionState } from "@/lib/ui/settings-sections";

// Advisor plan Phase 4, workstream 4F: the one AI features question and Settings > AI features.

let container: HTMLDivElement;
let root: Root;
const none = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
const base: DailyBriefSettings = {
  accountRef: "account-a", available: true, enabled: false, includeCalendar: false, revision: 2, localDate: "2026-11-20", timezone: "America/New_York",
  useConnectedSources: false, excludedSources: none, includeNotes: false, includeReminderHistory: false, optionalSources: { reminders: true, notes: true },
  sourceStatus: { googleCalendar: "ready", outlookCalendar: "not_connected", icloudCalendar: "not_connected", hevy: "ready" },
  ai: { approved: false, tipsEnabled: false, chatEnabled: false },
};
const approved: DailyBriefSettings = { ...base, enabled: true, useConnectedSources: true, includeNotes: true, includeReminderHistory: true,
  ai: { approved: true, tipsEnabled: true, chatEnabled: true } };

function client(settings: DailyBriefSettings, update: DailyBriefClient["updatePreferences"] = vi.fn(async () => approved)): DailyBriefClient {
  return { preferences: vi.fn(async () => settings), updatePreferences: update, requestBrief: vi.fn() };
}
const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;
const checkbox = (id: string) => container.querySelector<HTMLInputElement>(`input[aria-describedby="${id}"]`)!;

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
});

describe("the AI features question", () => {
  it("lists every feature and source as on, with what turning each off loses, before the setup pop-up", async () => {
    await act(() => root.render(<AiFeaturesApproval client={client(base)}><p>Setup pop-up</p></AiFeaturesApproval>));
    await vi.waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    const text = container.textContent ?? "";
    for (const item of ["Daily Brief", "Advisor tips", "Chat", "Behaviors and history", "Notes", "Reminder history", "Connected calendars and Hevy"]) expect(text).toContain(item);
    expect(text).toContain("If you turn it off: no morning plan and no suggested moves.");
    expect(text).toContain("If you turn it off: no Chat page.");
    expect(text).toContain("If you turn it off: plans and moves ignore your meetings and workouts.");
    expect(text).not.toContain("Setup pop-up");
  });

  it("turns everything on with one Continue, tells the Daily Brief, then shows the setup pop-up", async () => {
    const update = vi.fn(async () => approved);
    const heard = vi.fn();
    window.addEventListener("cadence:daily-brief-settings", heard);
    await act(() => root.render(<AiFeaturesApproval client={client(base, update)}><p>Setup pop-up</p></AiFeaturesApproval>));
    await vi.waitFor(() => expect(button("Continue")).toBeDefined());
    await act(() => button("Continue").click());
    expect(update).toHaveBeenCalledWith({ approval: "all_on" });
    await vi.waitFor(() => expect(container.textContent).toBe("Setup pop-up"));
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener("cadence:daily-brief-settings", heard);
  });

  it("keeps every feature off on request", async () => {
    const update = vi.fn(async () => ({ ...base, ai: { approved: true, tipsEnabled: false, chatEnabled: false } }));
    await act(() => root.render(<AiFeaturesApproval client={client(base, update)} />));
    await vi.waitFor(() => expect(button("Keep AI features off")).toBeDefined());
    await act(() => button("Keep AI features off").click());
    expect(update).toHaveBeenCalledWith({ approval: "all_off" });
    await vi.waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
  });

  it("keeps the question and says so when the answer cannot save", async () => {
    await act(() => root.render(<AiFeaturesApproval client={client(base, vi.fn(async () => { throw new Error("offline"); }))} />));
    await vi.waitFor(() => expect(button("Continue")).toBeDefined());
    await act(() => button("Continue").click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("Your answer could not be saved. Try again."));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("does not ask an account that answered, a server before 4F, or when settings cannot load", async () => {
    for (const adapter of [client(approved), client({ ...base, ai: undefined }), { ...client(base), preferences: vi.fn(async () => { throw new Error("down"); }) }]) {
      await act(() => root.unmount());
      root = createRoot(container);
      await act(() => root.render(<AiFeaturesApproval client={adapter}><p>Setup pop-up</p></AiFeaturesApproval>));
      await vi.waitFor(() => expect(container.textContent).toBe("Setup pop-up"));
    }
  });
});

describe("Settings > AI features", () => {
  it("shows a switch per feature and saves one change with every other choice unchanged", async () => {
    const update = vi.fn(async () => approved);
    await act(() => root.render(<DailyBriefSettingsPanel client={client(approved, update)} />));
    await vi.waitFor(() => expect(checkbox("ai-feature-chat")).not.toBeNull());
    expect(checkbox("ai-feature-dailyBrief").checked).toBe(true);
    expect(checkbox("ai-feature-tips").checked).toBe(true);
    await act(() => checkbox("ai-feature-chat").click());
    expect(update).toHaveBeenCalledWith({ enabled: true, tipsEnabled: true, chatEnabled: false, useConnectedSources: true, excludedSources: none,
      includeReminderHistory: true, includeNotes: true });
  });

  it("says what is lost while a feature or source is off, and keeps sources usable while Daily Brief is off", async () => {
    const update = vi.fn(async () => approved);
    const partly = { ...approved, enabled: false, includeNotes: false, ai: { approved: true, tipsEnabled: true, chatEnabled: false } };
    await act(() => root.render(<DailyBriefSettingsPanel client={client(partly, update)} />));
    await vi.waitFor(() => expect(container.querySelector("#ai-feature-dailyBrief")).not.toBeNull());
    expect(container.querySelector("#ai-feature-dailyBrief")?.textContent).toBe("Off. No morning plan and no suggested moves.");
    expect(container.querySelector("#ai-feature-chat")?.textContent).toBe("Off. No Chat page.");
    expect(container.querySelector("#ai-source-notes")?.textContent).toBe("Off. Tips and Chat cannot see what got in the way.");
    expect(checkbox("ai-source-notes").disabled).toBe(false);
    expect(checkbox("daily-brief-sources-coverage").disabled).toBe(false);
    await act(() => checkbox("ai-source-notes").click());
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, includeNotes: true, useConnectedSources: true }));
  });

  it("asks an account that has not answered and turns everything on from Settings", async () => {
    const update = vi.fn(async () => approved);
    await act(() => root.render(<DailyBriefSettingsPanel client={client(base, update)} />));
    await vi.waitFor(() => expect(container.textContent).toContain("You have not answered the AI features question yet."));
    await act(() => button("Turn everything on").click());
    expect(update).toHaveBeenCalledWith({ approval: "all_on" });
    await vi.waitFor(() => expect(container.textContent).not.toContain("You have not answered"));
  });

  it("reports the drawer state from every feature", () => {
    const loaded = (value: DailyBriefSettings) => ({ phase: "loaded" as const, value });
    expect(dailyBriefSectionState(loaded(base))).toEqual({ text: "Not answered yet", attention: true, on: false });
    expect(dailyBriefSectionState(loaded(approved))).toEqual({ text: "On", attention: false, on: true });
    expect(dailyBriefSectionState(loaded({ ...approved, enabled: false }))).toEqual({ text: "On · 2 of 3 features", attention: false, on: true });
    expect(dailyBriefSectionState(loaded({ ...approved, enabled: false, ai: { approved: true, tipsEnabled: false, chatEnabled: false } })))
      .toEqual({ text: "Off", attention: false, on: false });
  });
});
