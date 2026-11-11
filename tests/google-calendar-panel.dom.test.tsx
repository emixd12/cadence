// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalEventSnapshotV1 } from "@cadence/core/types/external-event";

import { GoogleCalendarPanel } from "@/components/settings/GoogleCalendarPanel";
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
    expect(container.textContent).toContain("Continue in the browser to connect Calendar.");

    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={range} refreshVersion={1} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Google Calendar is not connected."));
    expect(container.textContent).not.toContain("Continue in the browser to connect Calendar.");

    await act(() => button("Connect Google Calendar").click());
    getConnection.mockResolvedValue(connection());
    await act(() => root.render(<GoogleCalendarPanel coordinator={adapter} refreshRange={range} refreshVersion={2} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Google Calendar connected."));
    expect(container.textContent).toContain("Work");
    expect(container.textContent).not.toContain("Continue in the browser to connect Calendar.");
  });

  it("saves global visibility and selected calendars through its coordinator", async () => {
    const adapter = coordinator();
    await render(adapter);

    await act(() => checkbox("Show Calendar context").click());
    await act(() => checkbox("Visible on Timeline").click());
    await act(() => checkbox("Visible on Timeline").click());
    await act(() => checkbox("Personal").click());
    await act(() => button("Save Calendar settings").click());

    await vi.waitFor(() => expect(adapter.savePreferences).toHaveBeenCalledWith({
      selectedCalendarIds: ["work", "personal"], hiddenCalendarIds: [], visible: false, showAllDay: true,
    }));
    expect(container.textContent).toContain("Calendar preferences saved.");
  });

  it("refreshes the supplied inclusive range and disconnects with the cross-device explanation", async () => {
    const adapter = coordinator();
    await render(adapter);

    await act(() => button("Refresh Calendar").click());
    await vi.waitFor(() => expect(adapter.refreshEvents).toHaveBeenCalledWith(
      { startLocalDate: "2026-09-16", endLocalDate: "2026-09-23" },
      { force: true },
    ));
    expect(container.textContent).toContain("No Calendar events in this range. Calendar current.");

    await act(() => button("Disconnect Google Calendar").click());
    await vi.waitFor(() => expect(adapter.disconnect).toHaveBeenCalledOnce());
    expect(container.textContent).toContain("Other devices stop refreshing after they receive this account change.");
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
    await act(() => checkbox("Personal").click());
    expect(summary.textContent).toContain("WorkPersonal");
    expect(adapter.savePreferences).not.toHaveBeenCalled();
    await act(() => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    await act(() => button("Save Calendar settings").click());
    expect(adapter.savePreferences).toHaveBeenCalledWith({ ...defaults(), selectedCalendarIds: ["work", "personal"] });
  });

  it("reloads discovery without saved calendars and preserves unsaved selections", async () => {
    const adapter = coordinator({ getConnection: vi.fn(async () => connection({ ...defaults(), selectedCalendarIds: [] })) });
    await render(adapter);
    await act(() => checkbox("Personal").click());
    await act(() => button("Refresh Calendar").click());
    expect(adapter.listCalendars).toHaveBeenCalledTimes(2);
    expect(adapter.refreshEvents).not.toHaveBeenCalled();
    expect(checkbox("Personal").checked).toBe(true);
    expect(container.textContent).toContain("Calendar list refreshed.");
  });

  it("retains selections and reports discovery failures, including after a successful save", async () => {
    const adapter = coordinator();
    await render(adapter);
    vi.mocked(adapter.listCalendars).mockRejectedValue(new Error("private provider detail"));
    await act(() => button("Refresh Calendar").click());
    expect(checkbox("Work").checked).toBe(true);
    expect(adapter.refreshEvents).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Calendar refresh did not finish.");
    await act(() => button("Save Calendar settings").click());
    expect(container.textContent).toContain("Calendar preferences saved. Calendar list could not reload");
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
    await vi.waitFor(() => expect(container.textContent).toContain("Calendar connection could not start."));
    expect(container.textContent).not.toContain("raw OAuth provider detail");
  });
});
