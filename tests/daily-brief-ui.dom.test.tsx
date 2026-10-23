// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBriefResponse, DailyBriefSettings } from "@cadence/core/types/daily-brief";

import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";

const travelToken = vi.hoisted(() => vi.fn<(accountId: string | null, localDate: string) => string | null>(() => null));
vi.mock("@/lib/ui/travel", async (load) => ({ ...(await load<typeof import("@/lib/ui/travel")>()), travelConclusionsToken: travelToken }));

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
  it("returns the latest signed travel conclusions with the request, and nothing without a travel account (Ticket 219)", async () => {
    travelToken.mockImplementation((accountId) => accountId === "owner" ? "signed.token" : null);
    const linked = client();
    await act(() => root.render(<DailyBriefLauncher client={linked} travelAccountId="owner" sessionKey="owner" />));
    await vi.waitFor(() => expect(linked.requestBrief).toHaveBeenCalledOnce());
    expect(travelToken).toHaveBeenCalledWith("owner", settings.localDate);
    expect(linked.requestBrief).toHaveBeenCalledWith(expect.objectContaining({ travelConclusions: "signed.token" }), expect.any(AbortSignal));
    await act(() => root.unmount());
    root = createRoot(container);
    localStorage.clear();
    // Account-free desktop and signed-out views have no travel account, so the request carries no token.
    const local = client();
    await act(() => root.render(<DailyBriefLauncher client={local} sessionKey="local" />));
    await vi.waitFor(() => expect(local.requestBrief).toHaveBeenCalledOnce());
    expect(vi.mocked(local.requestBrief).mock.calls[0]![0]).not.toHaveProperty("travelConclusions");
    travelToken.mockReset();
    travelToken.mockReturnValue(null);
  });

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

it("offers each connected source as a separate default-off disclosure and revokes all of them on disable (Ticket 239)", async () => {
  const offered: DailyBriefSettings = { ...settings, includeOutlookCalendar: false, includeIcloudCalendar: false, includeHevy: false,
    connectorSources: { outlookCalendar: true, icloudCalendar: false, hevy: true } };
  const adapter = client({ preferences: vi.fn(async () => offered), updatePreferences: vi.fn(async (input) => ({ ...offered, ...input })) });
  await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
  await vi.waitFor(() => expect(container.textContent).toContain("Include selected Outlook Calendar timing"));
  expect(container.textContent).toContain("Include today’s recorded Hevy workout times");
  expect(container.textContent).toContain("Exercises, sets, weights, notes and titles are not sent");
  expect(container.textContent).toContain("never completes a Behavior");
  expect(container.textContent).not.toContain("iCloud");
  const outlook = container.querySelector<HTMLInputElement>('input[aria-describedby="daily-brief-outlook-disclosure"]')!;
  expect(outlook.checked).toBe(false);
  await act(() => outlook.click());
  await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith({ enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false,
    includeOutlookCalendar: true, includeIcloudCalendar: false, includeHevy: false }));
  await act(() => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!.click());
  await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith({ enabled: false, includeCalendar: false, includeReminderHistory: false, includeNotes: false,
    includeOutlookCalendar: false, includeIcloudCalendar: false, includeHevy: false }));
});

it("keeps a disclosure for a disconnected source visible so it can be turned off, and sends four keys to older servers", async () => {
  const stale: DailyBriefSettings = { ...settings, includeHevy: true, includeOutlookCalendar: false, includeIcloudCalendar: false,
    connectorSources: { outlookCalendar: false, icloudCalendar: false, hevy: false } };
  const adapter = client({ preferences: vi.fn(async () => stale) });
  await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
  await vi.waitFor(() => expect(container.textContent).toContain("Hevy is not connected"));
  expect(container.textContent).not.toContain("Outlook");
  const hevy = container.querySelector<HTMLInputElement>('input[aria-describedby="daily-brief-hevy-disclosure"]')!;
  expect(hevy.checked).toBe(true);
  expect(hevy.disabled).toBe(false);

  await act(() => root.unmount());
  root = createRoot(container);
  const older = client();
  await act(() => root.render(<DailyBriefSettingsPanel client={older} />));
  await vi.waitFor(() => expect(container.textContent).toContain("Enable Daily Brief"));
  expect(container.textContent).not.toMatch(/Outlook|Hevy|iCloud/);
  await act(() => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.click());
  await vi.waitFor(() => expect(older.updatePreferences).toHaveBeenCalledWith({ enabled: true, includeCalendar: true, includeReminderHistory: false, includeNotes: false }));
});

describe("connector disclosure recovery (Ticket 239)", () => {
  const recovery: DailyBriefSettings = { ...settings, includeReminderHistory: false, includeNotes: false,
    includeOutlookCalendar: true, includeIcloudCalendar: false, includeHevy: true,
    connectorSources: { outlookCalendar: true, icloudCalendar: false, hevy: true },
    connectorAttention: { outlookCalendar: "changed", icloudCalendar: null, hevy: "changed" } };
  const checkbox = (id: string) => container.querySelector<HTMLInputElement>(`input[aria-describedby="${id}"]`)!;
  const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text);

  it("explains a reconnected or reselected source and allows exactly that source again", async () => {
    const adapter = client({ preferences: vi.fn(async () => recovery), updatePreferences: vi.fn(async (input) => ({ ...recovery, ...input,
      connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: null } })) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Outlook Calendar was reconnected or its selected calendars changed after you allowed it"));
    expect(container.textContent).toContain("Hevy was reconnected after you allowed it");
    expect(container.textContent).not.toContain("Hevy was reconnected or its selected calendars");
    await act(() => button("Allow Outlook Calendar again")!.click());
    // Allowing Outlook never renews the other changed source.
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith({ enabled: true, includeCalendar: false, includeReminderHistory: false, includeNotes: false,
      includeOutlookCalendar: true, includeIcloudCalendar: false, includeHevy: false }));
    await vi.waitFor(() => expect(button("Allow Outlook Calendar again")).toBeUndefined());
  });

  it("revokes, never renews, changed or unavailable sources on an unrelated save", async () => {
    const adapter = client({ preferences: vi.fn(async (): Promise<DailyBriefSettings> => ({ ...recovery, connectorAttention: { outlookCalendar: "no_calendars", icloudCalendar: null, hevy: "changed" },
      connectorSources: { outlookCalendar: false, icloudCalendar: false, hevy: true } })) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("No Outlook Calendar calendars are selected"));
    expect(container.textContent).not.toContain("Outlook Calendar is not connected");
    expect(button("Allow Outlook Calendar again")).toBeUndefined();
    await act(() => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.click());
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith({ enabled: true, includeCalendar: true, includeReminderHistory: false, includeNotes: false,
      includeOutlookCalendar: false, includeIcloudCalendar: false, includeHevy: false }));
  });

  it("keeps a current source on during an unrelated save and lets a changed source be turned off", async () => {
    const adapter = client({ preferences: vi.fn(async (): Promise<DailyBriefSettings> => ({ ...recovery, connectorAttention: { outlookCalendar: null, icloudCalendar: null, hevy: "changed" } })) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(button("Allow Hevy again")).toBeDefined());
    await act(() => checkbox("daily-brief-hevy-disclosure").click());
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith(expect.objectContaining({ includeOutlookCalendar: true, includeHevy: false })));
  });

  it("shows a source-specific error when a source cannot be allowed", async () => {
    const { DailyBriefRequestError } = await import("@/lib/ui/daily-brief");
    const adapter = client({ preferences: vi.fn(async () => recovery), updatePreferences: vi.fn(async () => { throw new DailyBriefRequestError("source_unavailable"); }) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(button("Allow Hevy again")).toBeDefined());
    await act(() => button("Allow Hevy again")!.click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("not connected or has no selected calendar"));
  });
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
      items: [{ kind: "overlap", behaviorLabel: "Walk", travelLabel: "Dentist" }, { kind: "departure", at: "2026-09-20T18:30:00Z", label: "Dentist", mode: "transit", weather: null }, { kind: "return_unknown" }],
      weather: null, conflictingOptionIds: [], occupiedSpans: [{ startAt: "2026-09-20T18:30:00Z", endAt: "2026-09-20T20:00:00Z" }] }}
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
    travel={{ localDate: "2026-09-19", observedAt: "2026-09-19T13:00:00Z", expiresAt: "2999-09-20T16:00:00Z", attribution: null, weather: null, items: [{ kind: "return_unknown" }], conflictingOptionIds: [], occupiedSpans: [] }}
    briefing={{ text: "Quiet day.", localDate: settings.localDate, timezone: settings.timezone, generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete", warnings: [] }} />));
  expect(container.textContent).not.toContain("Travel");
});
