// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBriefResponse, DailyBriefSettings } from "@cadence/core/types/daily-brief";

import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";

let container: HTMLDivElement;
let root: Root;

const settings: DailyBriefSettings = {
  accountRef: "account-a", available: true, enabled: true, includeCalendar: false,
  revision: 1, localDate: "2026-09-20", timezone: "America/New_York",
};

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

function client(overrides: Partial<DailyBriefClient> = {}): DailyBriefClient {
  return {
    preferences: vi.fn(async () => settings),
    updatePreferences: vi.fn(async (input) => ({ ...settings, ...input })),
    requestBrief: vi.fn(async (): Promise<DailyBriefResponse> => ({
      state: "ready",
      briefing: {
        text: "Start with water before your first meeting.", localDate: settings.localDate, timezone: settings.timezone,
        generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "partial", warnings: ["Calendar timing is unavailable."],
      },
    })),
    ...overrides,
  };
}

describe("Daily Brief UI", () => {
  it("starts once, announces ready text politely, and keeps the dismiss control reachable", async () => {
    const adapter = client();
    await act(() => root.render(<DailyBriefLauncher client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Start with water"));
    expect(container.textContent).not.toContain("Some context was unavailable.");
    expect(adapter.requestBrief).toHaveBeenCalledWith(expect.objectContaining({ retry: false }), expect.any(AbortSignal));
    const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss Daily Brief"]');
    expect(dismiss?.className).toContain("min-h-11");
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
  });

  it("does not reopen a dismissed request when generation finishes", async () => {
    let resolve!: (response: DailyBriefResponse) => void;
    const adapter = client({ requestBrief: vi.fn(() => new Promise<DailyBriefResponse>((done) => { resolve = done; })) });
    await act(() => root.render(<DailyBriefLauncher client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Preparing today’s"));
    await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss Daily Brief"]')!.click());
    await act(() => resolve({ state: "ready", briefing: { text: "Never reopen", localDate: settings.localDate, timezone: settings.timezone,
      generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete", warnings: [] } }));
    expect(container.textContent).not.toContain("Never reopen");
    expect(localStorage.getItem("cadence.daily-brief.presentation.v1:account-a:2026-09-20")).toContain('"dismissed":true');
  });

  it("retries only after an explicit action", async () => {
    const adapter = client({ requestBrief: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ state: "already_attempted" }) });
    await act(() => root.render(<DailyBriefLauncher client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("could not prepare"));
    expect(adapter.requestBrief).toHaveBeenCalledTimes(1);
    await act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again")!.click());
    await vi.waitFor(() => expect(adapter.requestBrief).toHaveBeenCalledTimes(2));
    expect(adapter.requestBrief).toHaveBeenLastCalledWith(expect.objectContaining({ retry: true }), expect.any(AbortSignal));
  });

  it("keeps pending responses retryable and wraps unbroken model text", async () => {
    const pending = client({ requestBrief: vi.fn(async (): Promise<DailyBriefResponse> => ({ state: "pending" })) });
    await act(() => root.render(<DailyBriefLauncher client={pending} />));
    await vi.waitFor(() => expect(pending.requestBrief).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(container.textContent).toContain("Try again shortly"));
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Try again")).toBe(true);
    const ready = client({ preferences: vi.fn(async () => ({ ...settings, accountRef: "account-b" })), requestBrief: vi.fn(async (): Promise<DailyBriefResponse> => ({ state: "ready", briefing: {
      text: "x".repeat(2_000), localDate: settings.localDate, timezone: settings.timezone,
      generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete", warnings: [],
    } })) });
    await act(() => root.render(<DailyBriefLauncher client={ready} sessionKey="account-b" />));
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')?.textContent).toHaveLength(2_000));
    expect(container.querySelector('[role="status"]')?.className).toContain("[overflow-wrap:anywhere]");
  });

  it("saves only the declared Daily Brief settings and discloses the external model", async () => {
    const adapter = client();
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Enable Daily Brief"));
    const controls = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(controls).toHaveLength(2);
    expect(container.textContent).not.toContain("Include Notes");
    await act(() => controls[1]!.click());
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenCalledWith({ enabled: true, includeCalendar: true, includeReminderHistory: false, includeNotes: false }));
    expect(container.querySelector('a[href="https://developers.openai.com/api/docs/guides/your-data"]')).not.toBeNull();
    expect(container.textContent).toContain("cannot change tracking or Calendar records");
  });
});

it("offers optional sources with exact disclosures and revokes them when Daily Brief is turned off", async () => {
  const offered = { ...settings, includeNotes: true, includeReminderHistory: true, optionalSources: { reminders: true, notes: true } };
  const adapter = client({ preferences: vi.fn(async () => offered), updatePreferences: vi.fn(async (input) => ({ ...offered, ...input })) });
  await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
  await vi.waitFor(() => expect(container.textContent).toContain("Include Notes on Not Completed occurrences"));
  expect(container.textContent).toContain("up to 12 Notes, the first 280 characters of each");
  expect(container.textContent).toContain("never reminder content");
  const notes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.getAttribute("aria-describedby") === "daily-brief-notes-disclosure")!;
  expect(notes.checked).toBe(true);
  await act(() => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!.click());
  await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith({ enabled: false, includeCalendar: false, includeReminderHistory: false, includeNotes: false }));
});

it("renders suggestion provenance from trusted metadata without an apply action", async () => {
  const { DailyBriefBubble } = await import("@/components/briefing/DailyBriefBubble");
  const { BRIEFING_REFERENCES } = await import("@cadence/core/services/briefing-references");
  await act(() => root.render(<DailyBriefBubble state="ready" onDismiss={() => undefined} briefing={{
    text: "One planned Behavior remains unresolved.", localDate: settings.localDate, timezone: settings.timezone,
    generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete", warnings: [],
    references: [BRIEFING_REFERENCES[0]], suggestions: [{ text: "Review your priority.", occurrenceRefs: [], referenceIds: [BRIEFING_REFERENCES[0].id], optionId: null }],
  }} />));
  const link = container.querySelector("a");
  expect(link?.href).toBe(BRIEFING_REFERENCES[0].url);
  expect(link?.rel).toBe("noreferrer");
  expect(link?.textContent).toContain("interpretation");
  expect(container.textContent).toContain("Review your priority.");
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Close"]);
});

it("shows a tip with its deterministic evidence and travel guidance labeled as calculated", async () => {
  const { DailyBriefBubble } = await import("@/components/briefing/DailyBriefBubble");
  await act(() => root.render(<DailyBriefBubble state="ready" onDismiss={() => undefined}
    travel={{ localDate: settings.localDate, observedAt: "2026-09-20T13:00:00Z", expiresAt: "2999-09-20T16:00:00Z", attribution: "Google Maps",
      items: [{ kind: "overlap", behaviorLabel: "Walk", travelLabel: "Dentist" }, { kind: "departure", at: "2026-09-20T18:30:00Z", label: "Dentist", mode: "transit" }, { kind: "return_unknown" }],
      conflictingOptionIds: [], occupiedSpans: [{ startAt: "2026-09-20T18:30:00Z", endAt: "2026-09-20T20:00:00Z" }] }}
    briefing={{
      text: "Dentist anchors the afternoon.", localDate: settings.localDate, timezone: settings.timezone,
      generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete", warnings: [],
      tip: { text: "Try recording the walk right after it.", laneId: "decision-debt", basis: "Walk: 6 of 15 past occurrences are still Unresolved; the oldest is 15 days old.", limitation: null },
      suggestions: [{ text: "Consider moving the walk.", occurrenceRefs: [], referenceIds: [], optionId: "option-1", option: {
        id: "option-1", occurrenceRef: "occurrence_1", intervals: { current: { startAt: "2026-09-20T18:45:00Z", endAt: "2026-09-20T19:15:00Z" }, proposed: { startAt: "2026-09-20T19:00:00Z", endAt: "2026-09-20T19:30:00Z" } },
      } as never }],
    }} />));
  expect(container.textContent).toContain("Pattern tip");
  expect(container.textContent).toContain("6 of 15 past occurrences are still Unresolved");
  expect(container.textContent).toContain("Travel to Dentist overlaps Walk.");
  expect(container.textContent).toContain("Leave by 2:30 PM for Dentist (transit).");
  expect(container.textContent).toContain("Return time is unknown.");
  expect(container.textContent).toContain("Not written by the model.");
  expect(container.textContent).toContain("This time overlaps planned travel.");
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Close"]);
});

it("omits travel from another day", async () => {
  const { DailyBriefBubble } = await import("@/components/briefing/DailyBriefBubble");
  await act(() => root.render(<DailyBriefBubble state="ready" onDismiss={() => undefined}
    travel={{ localDate: "2026-09-19", observedAt: "2026-09-19T13:00:00Z", expiresAt: "2999-09-20T16:00:00Z", attribution: null, items: [{ kind: "return_unknown" }], conflictingOptionIds: [], occupiedSpans: [] }}
    briefing={{ text: "Quiet day.", localDate: settings.localDate, timezone: settings.timezone, generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete", warnings: [] }} />));
  expect(container.textContent).not.toContain("Travel");
});
