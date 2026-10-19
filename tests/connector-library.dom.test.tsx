// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateRecordedActivitySnapshot } from "@cadence/core/services/recorded-activity-validation";
import type { ExternalEventSnapshotV1_1 } from "@cadence/core/types/external-event";
import { AccountDeletionPanel } from "@/components/settings/AccountDeletionPanel";
import { ConnectorLibrary, ConnectorUnavailable, connectorUnavailableReason, ICLOUD_CALENDAR_UNAVAILABLE } from "@/components/settings/ConnectorLibrary";
import { HevyPanel } from "@/components/settings/HevyPanel";
import { OutlookCalendarPanel } from "@/components/settings/OutlookCalendarPanel";
import { RecordedActivityList, workoutDuration } from "@/components/timeline/RecordedActivityList";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import { ConnectorClientError, type HevyCoordinator, type OutlookCalendarCoordinator } from "@/lib/ui/connectors";
import outlookFixture from "./fixtures/external-event-snapshot.outlook.valid.json";
import hevyFixture from "./fixtures/recorded-activity-snapshot.valid.json";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const hevySnapshot = validateRecordedActivitySnapshot(hevyFixture, { now: Temporal.Instant.from("2026-11-01T15:00:00Z") });
const view = (provider: "hevy" | "outlook_calendar", overrides: Partial<ConnectorConnectionView> = {}): ConnectorConnectionView => ({
  accountId: "account-1", provider, status: "connected", generation: 2, selectionRevision: 1,
  preferences: { selectedSourceIds: ["calendar-1"], hiddenSourceIds: [], visible: true, showAllDay: true }, ...overrides });

function button(label: string) {
  const element = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function hevyCoordinator(overrides: Partial<HevyCoordinator> = {}): HevyCoordinator {
  return {
    getConnection: vi.fn(async () => view("hevy", { status: "disconnected", generation: 0 })),
    connect: vi.fn(async () => view("hevy")),
    refreshActivities: vi.fn(async () => ({ snapshot: hevySnapshot, replaced: true, refreshFailures: [] })),
    disconnect: vi.fn(async () => ({ view: view("hevy", { status: "disconnected" }), revocation: "hevy_api_key" as const })),
    ...overrides,
  };
}
function outlookCoordinator(overrides: Partial<OutlookCalendarCoordinator> = {}): OutlookCalendarCoordinator {
  return {
    getConnection: vi.fn(async () => view("outlook_calendar")),
    beginConnect: vi.fn(async () => undefined),
    listCalendars: vi.fn(async () => [{ id: "calendar-1", name: "Work calendar", isDefault: true }, { id: "calendar-2", name: "Family", isDefault: false }]),
    savePreferences: vi.fn(async (preferences) => view("outlook_calendar", { preferences })),
    refreshEvents: vi.fn(async () => outlookFixture as unknown as ExternalEventSnapshotV1_1),
    disconnect: vi.fn(async () => ({ view: view("outlook_calendar", { status: "disconnected" }), revocation: "microsoft_account_permissions" as const })),
    ...overrides,
  };
}

describe("ConnectorLibrary", () => {
  it("lists every source in a fixed order with truthful iCloud availability", () => {
    const html = renderToStaticMarkup(<ConnectorLibrary sources={[
      { id: "hevy", content: <p>Hevy controls</p> },
      { id: "icloud_calendar" },
      { id: "google_calendar", content: <p>Google controls</p> },
      { id: "outlook_calendar", content: <ConnectorUnavailable id="outlook_calendar" reason={connectorUnavailableReason("Outlook Calendar", "local")} /> },
    ]} />);
    expect(html).toContain("Connected sources");
    expect(html.indexOf("Google controls")).toBeLessThan(html.indexOf("Outlook Calendar"));
    expect(html.indexOf("Outlook Calendar")).toBeLessThan(html.indexOf("iCloud Calendar"));
    expect(html.indexOf("iCloud Calendar")).toBeLessThan(html.indexOf("Hevy controls"));
    expect(html).toContain(ICLOUD_CALENDAR_UNAVAILABLE);
    expect(html).toContain("Link a Cadence account on this Mac to connect Outlook Calendar.");
    expect(html).toMatch(/<h3[^>]*>iCloud Calendar<\/h3>/);
    expect(html).not.toMatch(/Connect iCloud/);
    expect(connectorUnavailableReason("Hevy", "build")).toBe("Hevy is unavailable in this build.");
  });
});

describe("HevyPanel", () => {
  it("states the Pro requirement and 500-workout limit, and clears the key before the request settles", async () => {
    let finish!: () => void;
    const coordinator = hevyCoordinator({ connect: vi.fn(() => new Promise<ConnectorConnectionView>((resolve) => { finish = () => resolve(view("hevy")); })) });
    await act(() => root.render(<HevyPanel coordinator={coordinator} localDate="2026-11-01" timezone="America/New_York" />));
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy is not connected."));
    expect(container.textContent).toContain("requires Hevy Pro");
    expect(container.textContent).toContain("at most 500 workouts");
    const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(container.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Hevy API key");
    await act(() => type(input, "  secret-hevy-key  "));
    expect(input.value).toBe("  secret-hevy-key  ");
    await act(() => button("Connect Hevy").click());
    expect(coordinator.connect).toHaveBeenCalledWith("secret-hevy-key");
    expect(input.value).toBe("");
    expect(container.innerHTML).not.toContain("secret-hevy-key");
    await act(async () => { finish(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy connected."));
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it("explains a non-Pro key and keeps the field empty after failure", async () => {
    const coordinator = hevyCoordinator({ connect: vi.fn(async () => { throw new ConnectorClientError("permission_denied"); }) });
    await act(() => root.render(<HevyPanel coordinator={coordinator} localDate="2026-11-01" timezone="America/New_York" />));
    await vi.waitFor(() => expect(container.querySelector('input[type="password"]')).not.toBeNull());
    const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(() => type(input, "not-pro"));
    await act(async () => { button("Connect Hevy").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("requires Hevy Pro. This key's account does not have it."));
    expect(input.value).toBe("");
  });

  it("refreshes, isolates a failure, and disconnects without claiming Hevy revoked the key", async () => {
    const coordinator = hevyCoordinator({ getConnection: vi.fn(async () => view("hevy")) });
    await act(() => root.render(<HevyPanel coordinator={coordinator} localDate="2026-11-01" timezone="America/New_York" />));
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy connected."));
    await act(async () => { button("Refresh Hevy").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy refreshed. 3 recorded workouts today."));
    vi.mocked(coordinator.refreshActivities).mockRejectedValueOnce(new ConnectorClientError("timeout"));
    await act(async () => { button("Refresh Hevy").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Hevy did not respond in time. Try again; other sources and tracking are unchanged."));
    await act(async () => { button("Disconnect Hevy").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Cadence deleted its saved API key."));
    expect(container.textContent).toContain("remove or regenerate it in Hevy settings");
    expect(container.textContent).not.toMatch(/Cadence revoked|revoked the key/i);
    for (const control of container.querySelectorAll("button, input")) expect(control.className).toContain("min-h-11");
  });
});

describe("OutlookCalendarPanel", () => {
  it("reuses the calendar selector and saves Outlook selection keys", async () => {
    const coordinator = outlookCoordinator();
    await act(() => root.render(<OutlookCalendarPanel coordinator={coordinator} refreshRange={{ startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York" }} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Work calendar"));
    const family = [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Family"))!.querySelector("input")!;
    await act(() => family.click());
    await act(async () => { button("Save Outlook settings").click(); });
    expect(coordinator.savePreferences).toHaveBeenCalledWith({ selectedSourceIds: ["calendar-1", "calendar-2"], hiddenSourceIds: [], visible: true, showAllDay: true });
    await act(async () => { button("Refresh Outlook Calendar").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Outlook Calendar refreshed."));
    await act(async () => { button("Disconnect Outlook Calendar").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Cadence deleted its saved Microsoft access."));
    expect(container.textContent).toContain("My Apps for a work or school account");
    expect(container.textContent).not.toMatch(/Cadence revoked|Microsoft revoked/i);
  });

  it("keeps not-configured and failing status inside the Outlook row", async () => {
    await act(() => root.render(<OutlookCalendarPanel coordinator={outlookCoordinator({ getConnection: vi.fn(async () => view("outlook_calendar", { status: "not_configured" })) })}
      refreshRange={{ startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York" }} />));
    await vi.waitFor(() => expect(container.textContent).toContain("not configured for this Cadence deployment"));
    expect([...container.querySelectorAll("button")].some((node) => node.textContent?.includes("Connect Outlook"))).toBe(false);
    await act(() => root.render(<OutlookCalendarPanel key="failing" coordinator={outlookCoordinator({ getConnection: vi.fn(async () => { throw new ConnectorClientError("provider_unavailable"); }) })}
      refreshRange={{ startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York" }} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Other sources and tracking are unaffected."));
  });

  it("shows callback results and an incomplete refresh honestly", async () => {
    const coordinator = outlookCoordinator({ refreshEvents: vi.fn(async () => ({ ...outlookFixture, completeness: "incomplete" }) as unknown as ExternalEventSnapshotV1_1) });
    await act(() => root.render(<OutlookCalendarPanel coordinator={coordinator} callbackMessage="Your organization must approve Cadence before Outlook Calendar can connect."
      refreshRange={{ startLocalDate: "2026-11-01", endLocalDate: "2026-11-03", timezone: "America/New_York" }} />));
    await vi.waitFor(() => expect(container.textContent).toContain("Your organization must approve Cadence"));
    await vi.waitFor(() => expect(container.textContent).toContain("Work calendar"));
    await act(async () => { button("Refresh Outlook Calendar").click(); });
    await vi.waitFor(() => expect(container.textContent).toContain("Outlook Calendar refresh was incomplete."));
  });
});

describe("RecordedActivityList", () => {
  const day = { localDate: "2026-11-01", state: "current" as const, fetchedAt: "2026-11-01T15:00:00Z",
    items: [{ id: "hevy/abc", startAt: "2026-11-01T12:05:00Z", endAt: "2026-11-01T13:10:00Z", durationSeconds: 3900 }] };
  it("shows when and how long, with recorded-activity semantics and no workout details", () => {
    const html = renderToStaticMarkup(<RecordedActivityList activity={{ state: "ready", day, error: null }} timezone="America/New_York" label="Sunday" />);
    expect(html).toContain('aria-label="Recorded activity · Sunday"');
    expect(html).toContain("Recorded activity · Hevy");
    expect(html).toContain("Workout");
    expect(html).toContain("7:05 AM–8:10 AM");
    expect(html).toContain("1 hr 5 min");
    expect(html).not.toMatch(/Completed|Not Completed|button|Calendar/);
    expect(workoutDuration(2700)).toBe("45 min");
    expect(workoutDuration(7200)).toBe("2 hr");
  });
  it("labels stale, incomplete, and failing reads and hides disconnected sources", () => {
    expect(renderToStaticMarkup(<RecordedActivityList activity={{ state: "stale", day, error: null }} timezone="America/New_York" label="Sunday" />)).toContain("may be out of date. Last read 10:00 AM.");
    expect(renderToStaticMarkup(<RecordedActivityList activity={{ state: "incomplete", day, error: null }} timezone="America/New_York" label="Sunday" />)).toContain("may be incomplete");
    expect(renderToStaticMarkup(<RecordedActivityList activity={{ state: "error", day: null, error: "timeout" }} timezone="America/New_York" label="Sunday" />)).toContain("could not refresh: timeout");
    expect(renderToStaticMarkup(<RecordedActivityList activity={{ state: "disconnected", day: null, error: null }} timezone="America/New_York" label="Sunday" />)).toBe("");
    expect(renderToStaticMarkup(<RecordedActivityList activity={{ state: "not_loaded", day: null, error: null }} timezone="America/New_York" label="Sunday" />)).toBe("");
  });
});

describe("account deletion copy", () => {
  it("names each provider's own removal step without claiming Cadence revoked it", () => {
    const html = renderToStaticMarkup(<AccountDeletionPanel confirmationLabel="person@example.com" deleteAccountAction={async (state) => state} />);
    expect(html).toContain("Cadence asks Google to revoke Calendar access");
    expect(html).toContain("Microsoft account privacy app permissions");
    expect(html).toContain("remove or regenerate it in Hevy settings");
    expect(html).not.toMatch(/Cadence revokes (Outlook|Microsoft|Hevy)/);
  });
});
