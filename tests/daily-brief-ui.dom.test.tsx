// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyBriefResponse, DailyBriefSettings } from "@cadence/core/types/daily-brief";

import { DailyBriefLauncher } from "@/components/briefing/DailyBriefLauncher";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import type { DailyBriefClient } from "@/lib/ui/daily-brief";
import { DevelopmentBuildProvider } from "@cadence/ui/runtime";
import { DailyBriefBubble } from "@/components/briefing/DailyBriefBubble";
import type { BriefTravelGuidance } from "@cadence/core/services/brief-travel-guidance";

const travelToken = vi.hoisted(() => vi.fn<(accountId: string | null, localDate: string) => string | null>(() => null));
// A held token returns at once from the Ticket 272 wait, as the real module does.
vi.mock("@/lib/ui/travel", async (load) => ({ ...(await load<typeof import("@/lib/ui/travel")>()), travelConclusionsToken: travelToken,
  waitForDailyBriefTravel: async (accountId: string | null, localDate: string) => accountId ? travelToken(accountId, localDate) : null }));

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
    const adapter = client({ preferences: vi.fn(async () => connectedSettings({ hevy: "ready" })) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Plan around my connected sources"));
    const controls = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...controls].map((control) => control.closest("label")?.textContent)).toEqual(["Daily Brief", "Plan around my connected sources", "Hevy"]);
    expect(container.textContent).not.toContain("Include Notes");
    expect(controls[1]!.checked).toBe(false);
    await act(() => controls[1]!.click());
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenCalledWith({ enabled: true, useConnectedSources: true, excludedSources: none,
      includeReminderHistory: false, includeNotes: false }));
    expect(container.querySelector('a[href="https://developers.openai.com/api/docs/guides/your-data"]')).not.toBeNull();
    expect(container.textContent).toContain("cannot change tracking or Calendar records");
    expect(container.textContent).toContain("nothing from them is sent unless a choice here covers it");
  });
});

const none = { googleCalendar: false, outlookCalendar: false, icloudCalendar: false, hevy: false };
const notConnected = { googleCalendar: "not_connected", outlookCalendar: "not_connected", icloudCalendar: "not_connected", hevy: "not_connected" } as const;
function connectedSettings(status: Partial<NonNullable<DailyBriefSettings["sourceStatus"]>>, overrides: Partial<DailyBriefSettings> = {}): DailyBriefSettings {
  return { ...settings, useConnectedSources: false, excludedSources: none, sourceStatus: { ...notConnected, ...status }, ...overrides };
}

describe("one choice for every connected source (Ticket 306)", () => {
  const checkbox = (id: string) => container.querySelector<HTMLInputElement>(`input[aria-describedby="${id}"]`)!;
  const allConnected = { googleCalendar: "ready", outlookCalendar: "ready", icloudCalendar: "no_calendars", hevy: "ready" } as const;

  it("names the covered sources and lists each connected source under Advanced with its statement of what is sent", async () => {
    const on = connectedSettings(allConnected, { useConnectedSources: true, excludedSources: { ...none, outlookCalendar: true } });
    await act(() => root.render(<DailyBriefSettingsPanel client={client({ preferences: vi.fn(async () => on) })} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Advanced: choose sources"));
    expect(checkbox("daily-brief-sources-coverage").checked).toBe(true);
    expect(container.querySelector("#daily-brief-sources-coverage")?.textContent).toBe("Covers Google Calendar, iCloud Calendar and Hevy, and any source you connect later. Only timing is sent, never event titles, descriptions, locations, attendees or workout details.");
    expect(container.querySelector("details")?.open).toBe(false);
    const google = container.querySelector("#daily-brief-google-disclosure")?.textContent ?? "";
    expect(google).toContain("Sends today’s event times, timezone, availability and your response for the calendars you selected for Timeline.");
    expect(google).toContain("Event titles, descriptions, locations and attendees are not sent.");
    expect(google).toContain("Daily Brief uses it.");
    expect(container.querySelector("#daily-brief-outlook-disclosure")?.textContent).toBe("Sends today’s event times, availability and your response for the selected Outlook calendars. Event titles and details are not sent.");
    expect(container.querySelector("#daily-brief-icloud-disclosure")?.textContent).toContain("No iCloud Calendar calendars are selected, so the brief cannot use it.");
    const hevy = container.querySelector("#daily-brief-hevy-disclosure")?.textContent ?? "";
    expect(hevy).toContain("Exercises, sets, weights, notes and titles are not sent");
    expect(hevy).toContain("never completes a Behavior");
    expect(hevy).toContain("Daily Brief uses it.");
    expect(checkbox("daily-brief-google-disclosure").checked).toBe(true);
    expect(checkbox("daily-brief-outlook-disclosure").checked).toBe(false);
  });

  it("excludes and restores one source without touching the others", async () => {
    const on = connectedSettings(allConnected, { useConnectedSources: true });
    const adapter = client({ preferences: vi.fn(async () => on), updatePreferences: vi.fn(async (input) => ({ ...on, ...input })) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(checkbox("daily-brief-outlook-disclosure")).not.toBeNull());
    await act(() => checkbox("daily-brief-outlook-disclosure").click());
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith({ enabled: true, useConnectedSources: true,
      excludedSources: { ...none, outlookCalendar: true }, includeReminderHistory: false, includeNotes: false }));
    await vi.waitFor(() => expect(checkbox("daily-brief-outlook-disclosure").checked).toBe(false));
    await act(() => checkbox("daily-brief-outlook-disclosure").click());
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith(expect.objectContaining({ excludedSources: none })));
  });

  it("says when every connected source is excluded or nothing is connected yet, and offers no choice to turn on with nothing connected", async () => {
    const excluded = connectedSettings({ hevy: "ready" }, { useConnectedSources: true, excludedSources: { ...none, hevy: true } });
    await act(() => root.render(<DailyBriefSettingsPanel client={client({ preferences: vi.fn(async () => excluded) })} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Every connected source is excluded under Advanced. A source you connect later is covered."));
    expect(container.querySelector("#daily-brief-hevy-disclosure")?.textContent).not.toContain("Daily Brief uses it.");

    await act(() => root.unmount());
    root = createRoot(container);
    await act(() => root.render(<DailyBriefSettingsPanel client={client({ preferences: vi.fn(async () => connectedSettings({})) })} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Nothing is connected yet."));
    expect(checkbox("daily-brief-sources-coverage").disabled).toBe(true);
    expect(container.textContent).not.toContain("Advanced: choose sources");

    // A choice made earlier stays visible so it can be turned off after every source disconnects.
    await act(() => root.unmount());
    root = createRoot(container);
    await act(() => root.render(<DailyBriefSettingsPanel client={client({ preferences: vi.fn(async () => connectedSettings({}, { useConnectedSources: true })) })} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Nothing is connected yet."));
    expect(checkbox("daily-brief-sources-coverage").checked).toBe(true);
    expect(checkbox("daily-brief-sources-coverage").disabled).toBe(false);
  });

  it("shows a source connected after the choice as used without another choice", async () => {
    const later = connectedSettings({ icloudCalendar: "ready" }, { useConnectedSources: true });
    await act(() => root.render(<DailyBriefSettingsPanel client={client({ preferences: vi.fn(async () => later) })} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Covers iCloud Calendar"));
    expect(checkbox("daily-brief-icloud-disclosure").checked).toBe(true);
    expect(container.querySelector("#daily-brief-icloud-disclosure")?.textContent).toContain("Daily Brief uses it.");
  });

  it("disables source rows while the one choice is off", async () => {
    await act(() => root.render(<DailyBriefSettingsPanel client={client({ preferences: vi.fn(async () => connectedSettings({ hevy: "ready" })) })} />));
    await vi.waitFor(() => expect(checkbox("daily-brief-hevy-disclosure")).not.toBeNull());
    expect(checkbox("daily-brief-hevy-disclosure").disabled).toBe(true);
    expect(checkbox("daily-brief-hevy-disclosure").checked).toBe(false);
    expect(container.querySelector("#daily-brief-hevy-disclosure")?.textContent).not.toContain("Daily Brief uses it.");
  });

  it("offers reminder history and Notes under Advanced and withdraws every choice when Daily Brief is turned off", async () => {
    const offered = connectedSettings({ outlookCalendar: "ready" }, { useConnectedSources: true, excludedSources: { ...none, hevy: true },
      includeNotes: true, includeReminderHistory: true, optionalSources: { reminders: true, notes: true } });
    const adapter = client({ preferences: vi.fn(async () => offered), updatePreferences: vi.fn(async (input) => ({ ...offered, ...input })) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Include Notes on Not Completed Occurrences"));
    expect(container.querySelector("details")?.textContent).toContain("Include reminder delivery history");
    expect(container.textContent).toContain("up to 12 Notes, the first 280 characters of each");
    expect(container.textContent).toContain("never reminder content");
    expect(checkbox("daily-brief-notes-disclosure").checked).toBe(true);
    await act(() => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!.click());
    await vi.waitFor(() => expect(adapter.updatePreferences).toHaveBeenLastCalledWith({ enabled: false, useConnectedSources: false, excludedSources: none,
      includeReminderHistory: false, includeNotes: false }));
  });

  it("shows a save error and keeps the settings", async () => {
    const { DailyBriefRequestError } = await import("@/lib/ui/daily-brief");
    const adapter = client({ preferences: vi.fn(async () => connectedSettings({ hevy: "ready" })), updatePreferences: vi.fn(async () => { throw new DailyBriefRequestError("invalid_request"); }) });
    await act(() => root.render(<DailyBriefSettingsPanel client={adapter} />));
    await vi.waitFor(() => expect(checkbox("daily-brief-sources-coverage")).not.toBeNull());
    await act(() => checkbox("daily-brief-sources-coverage").click());
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("Daily Brief settings could not save. Try again."));
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
      items: [{ kind: "overlap", phrase: "Travel to Dentist overlaps Walk.", weather: null }, { kind: "departure", phrase: "Leave by 2:30 PM for Dentist · transit, arrive 3:00 PM.", weather: null }, { kind: "return", phrase: "Return time unknown.", weather: null }],
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
  expect(container.textContent).toContain("Leave by 2:30 PM for Dentist · transit, arrive 3:00 PM.");
  expect(container.textContent).toContain("Return time unknown.");
  expect(container.textContent).toContain("Calculated by Cadence · Google Maps · 9:00 AM.");
  expect(container.textContent).not.toContain("Not written by the model.");
  expect(container.textContent).toContain("This time overlaps planned travel.");
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Close"]);
});

it("omits travel from another day", async () => {
  const { DailyBriefBubble } = await import("@/components/briefing/DailyBriefBubble");
  await act(() => root.render(<DailyBriefBubble state="ready" onDismiss={() => undefined}
    travel={{ localDate: "2026-09-19", observedAt: "2026-09-19T13:00:00Z", expiresAt: "2999-09-20T16:00:00Z", attribution: null, weather: null, items: [{ kind: "return", phrase: "Return time unknown.", weather: null }], conflictingOptionIds: [], occupiedSpans: [] }}
    briefing={{ text: "Quiet day.", localDate: settings.localDate, timezone: settings.timezone, generatedAt: "2026-09-20T12:00:00Z", expiresAt: "2999-09-20T16:00:00Z", coverage: "complete", warnings: [] }} />));
  expect(container.textContent).not.toContain("Travel");
});

it("shows the weather mode advice in the travel line in development builds only (Tickets 260 and 261)", async () => {
  const travel: BriefTravelGuidance = { localDate: "2026-11-01", observedAt: "2026-11-01T13:00:00Z", expiresAt: "2999-11-01T16:00:00Z", attribution: "Google Maps",
    items: [{ kind: "departure", phrase: "Leave by 6:05 PM for Dentist · cycling, arrive 6:35 PM.",
      weather: { marginMinutes: 15, conditions: ["thunderstorm"], suggestion: { instead: "cycling", alternatives: ["transit", "driving"] } } }],
    conflictingOptionIds: [], occupiedSpans: [], weather: null };
  const briefing = { text: "Dentist anchors the afternoon.", localDate: "2026-11-01", timezone: "UTC",
    generatedAt: "2026-11-01T12:00:00Z", expiresAt: "2999-11-01T16:00:00Z", coverage: "complete" as const, warnings: [] };
  const line = "Leave by 6:05 PM for Dentist · cycling, arrive 6:35 PM. 15 min added for thunderstorms.";
  const advice = "Consider transit or driving instead of cycling.";
  await act(() => root.render(<DevelopmentBuildProvider value={true}><DailyBriefBubble state="ready" briefing={briefing} travel={travel} onDismiss={() => undefined} /></DevelopmentBuildProvider>));
  expect(container.textContent).toContain(`${line} ${advice}`);
  await act(() => root.render(<DevelopmentBuildProvider value={false}><DailyBriefBubble state="ready" briefing={briefing} travel={travel} onDismiss={() => undefined} /></DevelopmentBuildProvider>));
  expect(container.textContent).toContain(line);
  expect(container.textContent).not.toContain(advice);
});
