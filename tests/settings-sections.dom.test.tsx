// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountDeletionPanel } from "@/components/settings/AccountDeletionPanel";
import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { ConnectorLibrary } from "@/components/settings/ConnectorLibrary";
import { HevyPanel } from "@/components/settings/HevyPanel";
import { OutlookCalendarPanel } from "@/components/settings/OutlookCalendarPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanels";
import {
  SETTINGS_GROUPS,
  SettingsDrawer,
  SettingsExportEntry,
  SettingsGroup,
  SettingsPageEnd,
  SettingsRow,
  SettingsSections,
  useReportSettingsSection,
} from "@/components/settings/SettingsSections";
import type { ConnectorConnectionView } from "@/lib/types/connectors";
import type { HevyCoordinator, OutlookCalendarCoordinator } from "@/lib/ui/connectors";
import type { SettingsSectionState } from "@/lib/ui/settings-sections";

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
  window.history.replaceState(null, "", "/");
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const view = (provider: ConnectorConnectionView["provider"], status: ConnectorConnectionView["status"], selected: string[] = ["c-1"]): ConnectorConnectionView => ({
  accountId: "account-1", provider, status, generation: 1, selectionRevision: 1,
  preferences: { selectedSourceIds: selected, hiddenSourceIds: [], visible: true, showAllDay: true } });
function hevy(getConnection: HevyCoordinator["getConnection"]): HevyCoordinator {
  return { getConnection, connect: vi.fn(), refreshActivities: vi.fn(), disconnect: vi.fn() } as unknown as HevyCoordinator;
}
function outlook(status: ConnectorConnectionView["status"]): OutlookCalendarCoordinator {
  return { getConnection: vi.fn(async () => view("outlook_calendar", status)), beginConnect: vi.fn(), savePreferences: vi.fn(),
    refreshEvents: vi.fn(), disconnect: vi.fn(), listCalendars: vi.fn(async () => [{ id: "c-1", name: "Calendar", isDefault: true }]) } as unknown as OutlookCalendarCoordinator;
}
const range = { startLocalDate: "2026-11-10", endLocalDate: "2026-11-17", timezone: "America/New_York" };
const row = (name: string) => [...container.querySelectorAll<HTMLDetailsElement>("details[data-settings-row]")]
  .find((details) => details.querySelector("summary")?.textContent?.includes(name))!;

function Reporter({ state }: Readonly<{ state: SettingsSectionState | null }>) {
  useReportSettingsSection(state);
  return <p>Panel body</p>;
}

describe("Settings source rows", () => {
  it("start closed and show Checking… while the panel loads", async () => {
    let resolve: (value: ConnectorConnectionView) => void = () => undefined;
    const coordinator = hevy(vi.fn(() => new Promise<ConnectorConnectionView>((done) => { resolve = done; })));
    await act(async () => root.render(<ConnectorLibrary rows sources={[{ id: "hevy", content: <HevyPanel coordinator={coordinator} localDate="2026-11-10" timezone="America/New_York" /> }]} />));
    const hevyRow = row("Hevy");
    expect(hevyRow.open).toBe(false);
    expect(hevyRow.querySelector("summary")?.textContent).toContain("Recorded activity");
    expect(hevyRow.querySelector("summary")?.textContent).toContain("Checking…");
    expect(hevyRow.querySelector("summary img")?.getAttribute("src")).toBe("/brand/hevy.png");
    await act(async () => resolve(view("hevy", "connected")));
    expect(hevyRow.querySelector("summary")?.textContent).toContain("Connected");
    expect(hevyRow.open).toBe(false);
  });

  it("drops the panel's own heading so the row title is the only one", async () => {
    await act(async () => root.render(<SettingsGroup id="settings-connections">
      <ConnectorLibrary rows sources={[{ id: "hevy", content: <HevyPanel coordinator={hevy(vi.fn(async () => view("hevy", "disconnected")))} localDate="2026-11-10" timezone="America/New_York" /> }]} />
    </SettingsGroup>));
    await flush();
    const headings = [...container.querySelectorAll("h2, h3, h4, h5")].map((heading) => `${heading.tagName}:${heading.textContent}`);
    expect(headings).toEqual(["H2:Connections", "H3:Connected sources", "H4:Hevy"]);
    expect(row("Hevy").querySelector("summary")?.textContent).toContain("Not connected");
  });

  it("opens a row whose source needs reconnection", async () => {
    await act(async () => root.render(<ConnectorLibrary rows sources={[{ id: "outlook_calendar", content: <OutlookCalendarPanel coordinator={outlook("reconnect_required")} refreshRange={range} /> }]} />));
    await flush();
    const outlookRow = row("Outlook Calendar");
    expect(outlookRow.querySelector("summary")?.textContent).toContain("Needs reconnection");
    expect(outlookRow.open).toBe(true);
  });

  it("says Status unavailable and opens on a failed read", async () => {
    const coordinator = hevy(vi.fn(async () => { throw new Error("offline"); }));
    await act(async () => root.render(<ConnectorLibrary rows sources={[{ id: "hevy", content: <HevyPanel coordinator={coordinator} localDate="2026-11-10" timezone="America/New_York" /> }]} />));
    await flush();
    expect(row("Hevy").querySelector("summary")?.textContent).toContain("Status unavailable");
    expect(row("Hevy").open).toBe(true);
  });

  it("leaves a row closed again after the person closes it", async () => {
    const state: SettingsSectionState = { text: "Needs reconnection", attention: true, on: true };
    await act(async () => root.render(<SettingsRow title="Example" kind="Calendar"><Reporter state={state} /></SettingsRow>));
    const details = row("Example");
    expect(details.open).toBe(true);
    await act(async () => { details.open = false; });
    await act(async () => root.render(<SettingsRow title="Example" kind="Calendar"><Reporter state={{ ...state }} /></SettingsRow>));
    expect(details.open).toBe(false);
  });

  it("ignores a panel that reports null", async () => {
    await act(async () => root.render(<SettingsRow title="Example" kind="Calendar"><Reporter state={null} /></SettingsRow>));
    expect(row("Example").querySelector("summary")?.textContent).toContain("Checking…");
  });
});

describe("Settings drawers", () => {
  it("keeps title, purpose and state in view and names the button by state", async () => {
    const off: SettingsSectionState = { text: "Off", attention: false, on: false };
    await act(async () => root.render(<SettingsGroup id="settings-planning">
      <SettingsDrawer title="Travel" description="Know when to leave." label="Travel settings" setupLabel="Set up Travel">
        <Reporter state={off} />
      </SettingsDrawer>
    </SettingsGroup>));
    const drawer = container.querySelector<HTMLElement>("[data-settings-drawer]")!;
    expect(drawer.querySelector("h3")?.textContent).toBe("Travel");
    expect(drawer.textContent).toContain("Know when to leave.");
    expect(drawer.querySelector("[data-settings-state]")?.textContent).toBe("Off");
    expect(drawer.querySelector("summary")?.textContent).toBe("Set up Travel");
    expect(drawer.querySelector("details")?.open).toBe(false);
    await act(async () => root.render(<SettingsGroup id="settings-planning">
      <SettingsDrawer title="Travel" description="Know when to leave." label="Travel settings" setupLabel="Set up Travel">
        <Reporter state={{ text: "On · Walking", attention: false, on: true }} />
      </SettingsDrawer>
    </SettingsGroup>));
    expect(drawer.querySelector("summary")?.textContent).toBe("Travel settings");
    expect(drawer.querySelector("[data-settings-state]")?.textContent).toBe("On · Walking");
  });

  it("uses the neutral label while checking", async () => {
    await act(async () => root.render(<SettingsDrawer title="Daily Brief" description="A briefing." label="Daily Brief settings" setupLabel="Set up Daily Brief">
      <p>Body</p></SettingsDrawer>));
    expect(container.querySelector("summary")?.textContent).toBe("Daily Brief settings");
    expect(container.querySelector("[data-settings-state]")?.textContent).toBe("Checking…");
  });

  it("opens on a failed read", async () => {
    await act(async () => root.render(<SettingsDrawer title="Travel" description="Know when to leave." label="Travel settings">
      <Reporter state={{ text: "Status unavailable", attention: true, on: false }} /></SettingsDrawer>));
    expect(container.querySelector("details")?.open).toBe(true);
  });

  it("wraps Categories with one heading and a known count", async () => {
    await act(async () => root.render(<SettingsGroup id="settings-general">
      <SettingsDrawer title="Categories" description="Organize Behaviors." label="Edit categories" state={{ text: "1 category", attention: false, on: true }}>
        <CategoryPanel categories={[{ id: "c-1", name: "Health", description: null, sort_order: 0, updated_at: "2026-11-10T00:00:00Z" }]} assignments={[]}
          action={async () => ({ status: "idle", message: "" })} />
      </SettingsDrawer>
    </SettingsGroup>));
    const headings = [...container.querySelectorAll("h2, h3, h4")].map((heading) => `${heading.tagName}:${heading.textContent}`);
    // Ticket 304: each category is one line (handle, name, Edit), not a heading.
    expect(headings).toEqual(["H2:General", "H3:Categories"]);
    expect(container.querySelector("details[data-settings-row] details")).toBeNull();
    expect(container.querySelector("#categories")?.getAttribute("aria-label")).toBe("Categories");
  });
});

describe("Settings headings", () => {
  it("SettingsPanel follows the group level and has a no-heading mode", () => {
    const html = renderToStaticMarkup(<SettingsGroup id="settings-account"><SettingsExportEntry /><SettingsPanel title="Hidden" headingLevel={null}><p>Body</p></SettingsPanel></SettingsGroup>);
    expect(html).toContain('<h3 class="text-xl leading-tight">Export</h3>');
    expect(html).not.toContain("Hidden");
    expect(html).toContain('href="/export"');
    expect(html).toContain("Download your history as JSONL, CSV, full JSON, or a BehaviorLog bundle.");
  });

  it("Delete account and Categories accept a heading level", () => {
    const action = async () => ({ status: "idle" as const, message: "" });
    expect(renderToStaticMarkup(<AccountDeletionPanel confirmationLabel="a@example.test" deleteAccountAction={action} headingLevel={null} />)).not.toContain(">Delete account</h");
    expect(renderToStaticMarkup(<AccountDeletionPanel confirmationLabel="a@example.test" deleteAccountAction={action} headingLevel={3} />)).toContain("<h3");
    expect(renderToStaticMarkup(<CategoryPanel categories={[]} assignments={[]} action={async () => ({ status: "idle", message: "" })} headingLevel={3} />)).toContain('<h3 id="categories-title"');
    // Outside Settings groups (desktop), panels keep their level-2 headings.
    expect(renderToStaticMarkup(<CategoryPanel categories={[]} assignments={[]} action={async () => ({ status: "idle", message: "" })} />)).toContain('<h2 id="categories-title"');
  });
});

describe("Settings page frame", () => {
  it("renders the four-link index and the end-of-page links", () => {
    const action = async () => ({ status: "idle" as const, message: "" });
    const html = renderToStaticMarkup(<SettingsSections>
      {SETTINGS_GROUPS.map((group) => <SettingsGroup key={group.id} id={group.id}><p>{group.label}</p></SettingsGroup>)}
      <SettingsPageEnd deleteAccount={<AccountDeletionPanel confirmationLabel="a@example.test" deleteAccountAction={action} headingLevel={null} />} />
    </SettingsSections>);
    const index = html.slice(html.indexOf('<nav aria-label="Settings sections"'), html.indexOf("</nav>"));
    expect([...index.matchAll(/href="(#[^"]+)"/g)].map((match) => match[1])).toEqual(["#settings-general", "#settings-connections", "#settings-planning", "#settings-account"]);
    expect(index).toContain("sticky top-16");
    expect(html).toContain('<h2 id="settings-account-title" class="border-b border-line pb-4 text-2xl leading-tight">Account and data</h2>');
    const footer = html.slice(html.indexOf("<footer"));
    expect([...footer.matchAll(/href="(\/[^"]+)"/g)].map((match) => match[1])).toEqual(["/privacy", "/terms", "/trust", "/export"]);
    expect(footer).toContain(">Delete account</summary>");
    // The existing form is unchanged: export acknowledgement and typed confirmation.
    expect(footer).toContain('name="confirm_export"');
    expect(footer).toContain("Type a@example.test to confirm");
    expect(html).not.toContain("Trust and legal");
  });

  it.each([
    ["#connector-hevy", "Hevy"],
    ["#travel", "Travel settings"],
    ["#delete-account", "Delete account"],
  ])("a link to %s opens its row or drawer and scrolls to it", async (hash, summary) => {
    const scrolled: Element[] = [];
    // jsdom has no scrollIntoView; record which element the hook scrolls to.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true,
      value: function (this: HTMLElement) { scrolled.push(this); } });
    window.history.replaceState(null, "", `/settings${hash}`);
    const action = async () => ({ status: "idle" as const, message: "" });
    await act(async () => root.render(<SettingsSections>
      <SettingsGroup id="settings-connections">
        <SettingsRow title="Hevy" kind="Recorded activity"><SettingsPanel id="connector-hevy" title="Hevy"><p>Hevy body</p></SettingsPanel></SettingsRow>
      </SettingsGroup>
      <SettingsGroup id="settings-planning">
        <SettingsDrawer title="Travel" description="Know when to leave." label="Travel settings"><SettingsPanel id="travel" title="Travel"><p>Travel body</p></SettingsPanel></SettingsDrawer>
      </SettingsGroup>
      <SettingsPageEnd deleteAccount={<AccountDeletionPanel confirmationLabel="a@example.test" deleteAccountAction={action} headingLevel={null} />} />
    </SettingsSections>));
    const details = row(summary);
    expect(details.open).toBe(true);
    const others = [...container.querySelectorAll<HTMLDetailsElement>("details[data-settings-row]")].filter((item) => item !== details);
    expect(others.every((item) => !item.open)).toBe(true);
    const expected = hash === "#travel" ? container.querySelector("[data-settings-drawer]") : details;
    expect(scrolled.at(-1)).toBe(expected);
  });

  it("drops the Note shortcuts control from the Settings page", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("app/(app)/settings/page.tsx", "utf8");
    expect(page).not.toContain("GlobalNoteShortcutControl");
    expect(page).not.toContain("TrustAndLegalPanel");
    expect(page).toContain("<WebGoogleCalendarPanel timezone={settings.timezone} agent />");
  });
});
