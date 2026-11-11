// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";

import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
import { SETTINGS_SAVED, SETTINGS_SAVING, SETTINGS_UNDONE } from "@/components/settings/settings-result";
import type { CalendarConnectionView, CalendarListEntry, CalendarPreferences } from "@/lib/types/google-calendar";
import type { GoogleCalendarCoordinator } from "@/lib/ui/google-calendar";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(coordinator: GoogleCalendarCoordinator) {
  await act(() => root.render(
    <GoogleCalendarPanel
      coordinator={coordinator}
      refreshRange={{ startLocalDate: "2026-09-16", endLocalDate: "2026-09-23" }}
    />,
  ));
  await vi.waitFor(() => expect(container.textContent).toContain("Work"));
}

function checkbox(label: string) {
  const element = [...container.querySelectorAll("label")].find((node) => node.textContent?.includes(label))?.querySelector<HTMLInputElement>("input");
  if (!element) throw new Error(`Missing checkbox: ${label}`);
  return element;
}

function button(label: string) {
  const element = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

function statusLines(): string[] {
  return [...container.querySelectorAll('[role="status"]')].map((node) => node.textContent ?? "").filter(Boolean);
}

function connection(preferences: CalendarPreferences = defaults()): CalendarConnectionView {
  return { accountId: "account-a", status: "connected", generation: 2, selectionRevision: 3, preferences };
}

function defaults(): CalendarPreferences {
  return { selectedCalendarIds: ["work"], hiddenCalendarIds: [], visible: true, showAllDay: true };
}

function disconnectedConnection(): CalendarConnectionView {
  return { ...connection(), status: "disconnected" };
}

function reconnectConnection(): CalendarConnectionView {
  return { ...connection(), status: "reconnect_required" };
}

function snapshot(): ExternalEventSnapshotV1 {
  const capability = { support: "supported", permission: "granted", availability: "available" } as const;
  return {
    schemaVersion: "1.0.0", adapterVersion: "google-calendar-v1", accountId: "account-a", connectionGeneration: 2, source: "google_calendar",
    requestedRange: { startLocalDate: "2026-09-16", endLocalDate: "2026-09-23", timezone: "America/New_York", selectedCalendarIds: ["work"] },
    fetchedAt: "2026-09-16T14:00:00Z", completeness: "complete",
    freshness: { state: "current", refreshedAt: "2026-09-16T14:00:00Z", label: "Calendar current", canAssertNoOverlap: true },
    capabilities: { calendar_listing: capability, timed_events: capability, all_day_events: capability, recurrence: capability, details: capability, source_links: capability },
    coverage: [], failures: [], events: [], tombstones: [],
  };
}

function coordinator(overrides: Partial<GoogleCalendarCoordinator> = {}): GoogleCalendarCoordinator {
  return {
    getConnection: vi.fn(async () => connection()),
    beginConnect: vi.fn(async () => undefined),
    listCalendars: vi.fn(async (): Promise<readonly CalendarListEntry[]> => [
      { id: "work", name: "Work", timezone: "America/New_York", primary: true, selected: true, accessRole: "owner" },
      { id: "personal", name: "Personal", timezone: "America/New_York", primary: false, selected: false, accessRole: "reader" },
    ]),
    savePreferences: vi.fn(async (preferences) => connection(preferences)),
    refreshEvents: vi.fn(async () => snapshot()),
    disconnect: vi.fn(async () => ({ view: disconnectedConnection(), revocationFailed: false })),
    ...overrides,
  };
}

describe("GoogleCalendarPanel", () => {
  it("offers explicit wrong-account cleanup without revoking the grant", async () => {
    const adapter = coordinator({ getConnection: vi.fn(async () => disconnectedConnection()) });
    const range = { startLocalDate: "2026-09-16", endLocalDate: "2026-09-23" };
    const openExternalUrl = vi.fn(async () => undefined);
    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={range} wrongAccount openExternalUrl={openExternalUrl} />));
    const link = container.querySelector<HTMLAnchorElement>('a[href="https://myaccount.google.com/connections"]');
    expect(link?.textContent).toBe("Google Account connections");
    expect(container.textContent).toContain("same Google account");
    expect(container.textContent).toContain("entire Calendar project");
    expect(container.textContent).toContain("other Cadence accounts or devices");
    await act(() => link!.click());
    expect(openExternalUrl).toHaveBeenCalledWith("https://myaccount.google.com/connections");
    expect(adapter.disconnect).not.toHaveBeenCalled();
    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={range} wrongAccount={false} />));
    expect(container.querySelector("a")).toBeNull();
  });

  it("ignores an old account calendar list and reloads after a native callback", async () => {
    let finish!: (value: readonly CalendarListEntry[]) => void;
    const old = coordinator({ listCalendars: vi.fn(() => new Promise<readonly CalendarListEntry[]>((resolve) => { finish = resolve; })) });
    const getConnection = vi.fn(async () => disconnectedConnection());
    const next = coordinator({ getConnection });
    const range = { startLocalDate: "2026-09-16", endLocalDate: "2026-09-23" };
    await act(() => root.render(<GoogleCalendarPanel coordinator={old} refreshRange={range} />));
    await act(() => root.render(<GoogleCalendarPanel coordinator={next} refreshRange={range} />));
    await act(() => finish([{ id: "secret", name: "Old account calendar", timezone: "UTC", primary: false, selected: true, accessRole: "owner" }]));
    expect(container.textContent).not.toContain("Old account calendar");
    getConnection.mockResolvedValue(connection());
    await act(() => root.render(<GoogleCalendarPanel coordinator={next} refreshRange={range} refreshVersion={1} />));
    expect(container.textContent).toContain("Work");
    expect(container.textContent).not.toContain("Old account calendar");
  });

  it("clears the browser handoff message after cancelled and successful native callbacks", async () => {
    const getConnection = vi.fn(async () => disconnectedConnection());
    const adapter = coordinator({ getConnection });
    const range = { startLocalDate: "2026-09-16", endLocalDate: "2026-09-23" };
    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={range} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Google Calendar is not connected."));

    await act(() => button("Connect Google Calendar").click());
    expect(container.textContent).toContain("Continue in your browser to connect Google Calendar.");

    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={range} refreshVersion={1} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Google Calendar is not connected."));
    expect(container.textContent).not.toContain("Continue in your browser to connect Google Calendar.");

    await act(() => button("Connect Google Calendar").click());
    getConnection.mockResolvedValue(connection());
    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={range} refreshVersion={2} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Google Calendar connected."));
    expect(container.textContent).toContain("Work");
    expect(container.textContent).not.toContain("Continue in your browser to connect Google Calendar.");
  });

  it("saves each display and selection change as it happens, then reloads the list (Ticket 303)", async () => {
    const adapter = coordinator();
    await render(adapter);
    expect([...container.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Save Calendar settings")).toBe(false);

    await act(async () => checkbox("Show Google Calendar events").click());
    expect(adapter.savePreferences).toHaveBeenLastCalledWith({ ...defaults(), visible: false });
    await act(async () => checkbox("Visible on Timeline").click());
    expect(adapter.savePreferences).toHaveBeenLastCalledWith({ ...defaults(), visible: false, hiddenCalendarIds: ["work"] });
    await act(async () => checkbox("Visible on Timeline").click());
    await act(async () => checkbox("Personal").click());
    expect(adapter.savePreferences).toHaveBeenLastCalledWith({
      selectedCalendarIds: ["work", "personal"], hiddenCalendarIds: [], visible: false, showAllDay: true,
    });
    expect(adapter.savePreferences).toHaveBeenCalledTimes(4);
    expect(adapter.listCalendars).toHaveBeenCalledTimes(5);
    expect(statusLines()).toEqual([SETTINGS_SAVED]);
  });

  it("shows Saving… and saves only the newest choice made while a save runs", async () => {
    let finish!: () => void;
    const adapter = coordinator();
    vi.mocked(adapter.savePreferences).mockImplementationOnce((preferences) => new Promise((resolve) => { finish = () => resolve(connection(preferences)); }));
    await render(adapter);
    await act(async () => checkbox("Show Google Calendar events").click());
    expect(statusLines()).toEqual([SETTINGS_SAVING]);
    expect(checkbox("Show Google Calendar events").disabled).toBe(false);
    await act(async () => checkbox("Show all-day Google Calendar events").click());
    await act(async () => checkbox("Show Google Calendar events").click());
    expect(adapter.savePreferences).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    expect(adapter.savePreferences).toHaveBeenCalledTimes(2);
    expect(adapter.savePreferences).toHaveBeenLastCalledWith({ ...defaults(), visible: true, showAllDay: false });
    expect(checkbox("Show all-day Google Calendar events").checked).toBe(false);
    expect(statusLines()).toEqual([SETTINGS_SAVED]);
  });

  it("puts a choice back to its saved value when the save fails, and says so", async () => {
    const adapter = coordinator({ savePreferences: vi.fn(async () => { throw new Error("private provider detail"); }) });
    await render(adapter);
    await act(async () => checkbox("Personal").click());
    expect(checkbox("Personal").checked).toBe(false);
    expect(statusLines()).toEqual([`Google Calendar settings could not save. Try again. ${SETTINGS_UNDONE}`]);
    expect(container.textContent).not.toContain("private provider detail");
  });

  it("refreshes the supplied inclusive range and disconnects with the cross-device explanation", async () => {
    const adapter = coordinator();
    await render(adapter);

    await act(() => button("Refresh Google Calendar").click());
    await vi.waitFor(() => expect(adapter.refreshEvents).toHaveBeenCalledWith(
      { startLocalDate: "2026-09-16", endLocalDate: "2026-09-23" },
      { force: true },
    ));
    expect(container.textContent).toContain("No Google Calendar events to show. Calendar current.");

    await act(() => button("Disconnect Google Calendar").click());
    expect(adapter.disconnect).not.toHaveBeenCalled();
    await act(() => button("Disconnect").click());
    await vi.waitFor(() => expect(adapter.disconnect).toHaveBeenCalledOnce());
    expect(container.textContent).toContain("Other devices stop refreshing after they receive this account change.");
  });

  it("asks before disconnecting, in the destructive style, and Cancel keeps the connection", async () => {
    const adapter = coordinator();
    await render(adapter);
    const trigger = button("Disconnect Google Calendar");
    expect(trigger.className).toContain("product-action-danger");
    await act(() => trigger.click());
    const question = container.querySelector('[role="group"][aria-label="Disconnect Google Calendar"]')!;
    expect(question.textContent).toContain("Disconnect Google Calendar?");
    expect(button("Disconnect").className).toContain("product-action-danger");
    expect(document.activeElement).toBe(button("Cancel"));
    await act(() => button("Cancel").click());
    expect(adapter.disconnect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Disconnect Google Calendar"));
  });

  it("keeps selection compact and drafts intact across searching, hiding, and Escape", async () => {
    const adapter = coordinator();
    await render(adapter);
    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    expect(details.open).toBe(false);
    expect(summary.textContent).toContain("Work");
    await act(() => summary.click());
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "PERSONAL");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Visible on Timeline: Work"]')).toBeNull();
    await act(async () => checkbox("Personal").click());
    expect(summary.textContent).toContain("WorkPersonal");
    expect(adapter.savePreferences).toHaveBeenCalledWith({ ...defaults(), selectedCalendarIds: ["work", "personal"] });
    // The list reload after a save keeps the search and the open field.
    expect(search.value).toBe("PERSONAL");
    expect(details.open).toBe(true);
    await act(() => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("reloads discovery without saved calendars", async () => {
    const adapter = coordinator({ getConnection: vi.fn(async () => connection({ ...defaults(), selectedCalendarIds: [] })) });
    await render(adapter);
    await act(() => button("Refresh Google Calendar").click());
    expect(adapter.listCalendars).toHaveBeenCalledTimes(2);
    expect(adapter.refreshEvents).not.toHaveBeenCalled();
    expect(checkbox("Personal").checked).toBe(false);
    expect(container.textContent).toContain("Calendar list updated. Choose calendars to show their events.");
  });

  it("retains selections and reports discovery failures, including after a successful save", async () => {
    const adapter = coordinator();
    await render(adapter);
    vi.mocked(adapter.listCalendars).mockRejectedValue(new Error("private provider detail"));
    await act(() => button("Refresh Google Calendar").click());
    expect(checkbox("Work").checked).toBe(true);
    expect(adapter.refreshEvents).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Google Calendar did not refresh.");
    await act(async () => checkbox("Show all-day Google Calendar events").click());
    expect(container.textContent).toContain("Saved. The calendar list did not reload. Try Refresh Google Calendar.");
    expect(container.textContent).not.toContain("private provider detail");
  });

  it("keeps provider errors private and offers reconnect when required", async () => {
    const adapter = coordinator({
      getConnection: vi.fn(async () => reconnectConnection()),
      beginConnect: vi.fn(async () => { throw new Error("raw OAuth provider detail"); }),
    });
    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={{ startLocalDate: "2026-09-16", endLocalDate: "2026-09-23" }} />));
    await vi.waitFor(() => expect(container.textContent).toContain("needs reconnection"));

    await act(() => button("Reconnect Google Calendar").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Google Calendar could not start connecting. Try again."));
    expect(container.textContent).not.toContain("raw OAuth provider detail");
  });
});
