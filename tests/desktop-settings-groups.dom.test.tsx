// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectorLibrary, ConnectorUnavailable, connectorUnavailableReason } from "@/components/settings/ConnectorLibrary";
import { connectorUnavailableSectionState } from "@/lib/ui/settings-sections";
import { scrollAfterDesktopNavigation } from "../apps/desktop/src/desktop-navigation";
import { LocalDatabaseSection } from "../apps/desktop/src/local-database-controls";
import { SettingsScreen, type SettingsScreenProps } from "../apps/desktop/src/settings-screen";

// Ticket 302: Mac Settings uses the web groups, index, rows and drawers, plus a Mac group.

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
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const local = connectorUnavailableSectionState("local");
const SOURCES = [["google_calendar", "Google Calendar"], ["outlook_calendar", "Outlook Calendar"], ["icloud_calendar", "iCloud Calendar"], ["hevy", "Hevy"]] as const;
const localSources = <ConnectorLibrary rows sources={SOURCES.map(([id, name]) => ({
  id, content: <ConnectorUnavailable id={id} state={local} reason={connectorUnavailableReason(name, "local")} />,
}))} />;

async function render(overrides: Partial<SettingsScreenProps> = {}) {
  const props: SettingsScreenProps = {
    currentTimezone: "America/New_York",
    accountConnected: false,
    updateTimezoneAction: async (state) => state,
    permission: "authorized",
    coverage: null,
    busy: false,
    onRequestPermission: vi.fn(),
    onReconcile: vi.fn(),
    onShowOnboarding: vi.fn(),
    accountControls: <section id="account"><p>Sign in with Google</p></section>,
    accountState: { text: "Not linked", attention: false, on: false },
    calendarControls: localSources,
    travelControls: <section id="travel"><p>Travel controls</p></section>,
    dailyBriefControls: <p>Daily Brief is unavailable.</p>,
    dailyBriefState: local,
    categoryControls: <section id="categories"><p>Category list</p></section>,
    categoryCount: 2,
    databaseControls: <LocalDatabaseSection info={{ path: "/Application Support/cadence.sqlite3", localMode: true }} confirmation="" busy={false} message=""
      onConfirmationChange={vi.fn()} onReveal={vi.fn()} onBackup={vi.fn()} onRestore={vi.fn()} />,
    updates: <div id="app-updates"><section><h3>App updates</h3></section></div>,
    onOpenExport: vi.fn(),
    ...overrides,
  };
  await act(() => root.render(<SettingsScreen {...props} />));
  await flush();
  return props;
}

const group = (id: string) => container.querySelector<HTMLElement>(`#${id}`)!;
const drawer = (title: string) => [...container.querySelectorAll<HTMLElement>("[data-settings-drawer]")]
  .find((section) => section.querySelector("h3")?.textContent === title)!;
const row = (name: string) => [...container.querySelectorAll<HTMLDetailsElement>("details[data-settings-row]")]
  .find((details) => details.querySelector("summary")?.textContent?.includes(name))!;

describe("desktop Settings groups (Ticket 302)", () => {
  it("shows the web groups in order, then the Mac group, with a five-link index", async () => {
    await render();
    const index = container.querySelector('nav[aria-label="Settings sections"]')!;
    expect([...index.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["General", "#settings-general"], ["Connections", "#settings-connections"], ["Planning", "#settings-planning"],
      ["Account", "#settings-account"], ["Mac", "#settings-mac"],
    ]);
    expect(index.className).toContain("sticky top-16");
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent))
      .toEqual(["General", "Connections", "Planning", "Account and data", "This Mac"]);
  });

  it("places shared and Mac-only sections in their groups, one heading level below the group", async () => {
    await render();
    const titles = (id: string) => [...group(id).querySelectorAll("h3")].map((heading) => heading.textContent);
    expect(titles("settings-general")).toEqual(["Local profile", "Cadence account", "Timezone", "Native notifications", "Categories"]);
    expect(group("settings-general").querySelector("h4")?.textContent).toBe("Reminder coverage");
    expect(titles("settings-connections")[0]).toBe("Connected sources");
    expect(titles("settings-planning")).toEqual(["Travel", "Daily Brief"]);
    expect(titles("settings-account")).toEqual(["Export"]);
    expect(titles("settings-mac")).toEqual(["Local database", "App updates", "Setup guide"]);
    expect(container.textContent).not.toContain("Note shortcuts");
  });

  it("opens the Export screen from Account and data", async () => {
    const props = await render();
    const open = [...group("settings-account").querySelectorAll("button")].find((button) => button.textContent === "Open Export")!;
    await act(async () => open.click());
    expect(props.onOpenExport).toHaveBeenCalledOnce();
  });

  it("shows each source that needs a linked account as a closed row with that state", async () => {
    await render();
    for (const name of ["Google Calendar", "Outlook Calendar", "iCloud Calendar", "Hevy"]) {
      expect(row(name).open).toBe(false);
      expect(row(name).querySelector("summary [data-settings-state]")?.textContent).toBe("Link a Cadence account");
    }
    expect(container.textContent).toContain("Link a Cadence account on this Mac to connect Hevy.");
    expect(group("settings-connections").textContent).not.toContain("Checking…");
  });

  it("keeps drawers closed with their state and setup labels on a local Mac", async () => {
    await render();
    const account = drawer("Cadence account");
    expect(account.querySelector("[data-settings-state]")?.textContent).toBe("Not linked");
    expect(account.querySelector("summary")?.textContent).toBe("Link a Cadence account");
    expect(account.querySelector("details")?.open).toBe(false);
    expect(drawer("Daily Brief").querySelector("[data-settings-state]")?.textContent).toBe("Link a Cadence account");
    expect(drawer("Categories").querySelector("summary")?.textContent).toBe("Edit 2 categories");
  });

  it("opens the account drawer by itself on a sync conflict and moves the index below the shell cue", async () => {
    await render({ shellCue: true, accountState: { text: "2 sync conflicts to review", attention: true, on: true },
      accountControls: <section id="account-conflicts"><p>Review conflicts</p></section> });
    expect(drawer("Cadence account").querySelector("details")?.open).toBe(true);
    expect(container.querySelector('nav[aria-label="Settings sections"]')?.className).toContain("sticky top-32");
    expect(group("settings-general").className).toContain("scroll-mt-48");
  });

  it.each([
    ["account-conflicts", "Cadence account"],
    ["travel", "Travel"],
  ])("in-app navigation to #%s opens its drawer and scrolls to it", async (anchor, title) => {
    const scrolled: Element[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true,
      value(this: Element) { scrolled.push(this); } });
    await render({ accountControls: <section id="account-conflicts"><p>Review conflicts</p></section> });
    expect(drawer(title).querySelector("details")?.open).toBe(false);
    let stop: () => void = () => undefined;
    await act(async () => {
      stop = scrollAfterDesktopNavigation(anchor);
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    });
    expect(drawer(title).querySelector("details")?.open).toBe(true);
    expect(scrolled[0]).toBe(drawer(title));
    stop();
  });
});
