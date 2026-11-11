"use client";

import { SettingsPanel } from "@/components/settings/SettingsPanels";
import {
  SettingsDrawer,
  SettingsExportEntry,
  SettingsGroup,
  SettingsPageEnd,
  SettingsRow,
  SettingsSourceIcon,
} from "@/components/settings/SettingsSections";
import { SETTINGS_SECTION_CHECKING, SETTINGS_SECTION_UNAVAILABLE, type SettingsSectionState } from "@/lib/ui/settings-sections";
import { SettingsDisconnect } from "@/components/settings/SettingsDisconnect";
import { SETTINGS_SAVED, SETTINGS_SAVING, SettingsLiveLine, settingsSaveFailed } from "@/components/settings/settings-result";

// Ticket 301 bench previews for the Settings layout components. Fixed states stand
// in for the panels that report them on /settings; nothing here loads or saves.

const body = (text: string) => <SettingsPanel title="Panel" description={text}><p className="text-sm text-muted-readable">Existing panel controls.</p></SettingsPanel>;

const ROW_STATES: ReadonlyArray<readonly [string, string, string, SettingsSectionState]> = [
  ["Google Calendar", "Calendar", "/brand/google-calendar.svg", SETTINGS_SECTION_CHECKING],
  ["Outlook Calendar", "Calendar", "/brand/outlook-calendar.svg", { text: "Needs reconnection", attention: true, on: true }],
  ["iCloud Calendar", "Calendar", "/brand/icloud-calendar.png", { text: "Connected · 2 calendars", attention: false, on: true }],
  ["Hevy", "Recorded activity", "/brand/hevy.png", { text: "Not connected", attention: false, on: false }],
];

/** Source rows in each state: checking, needs action (opens by itself), connected and not connected. */
export function SettingsRowBench() {
  return (
    <SettingsGroup id="settings-connections">
      <SettingsPanel title="Connected sources" description="Rows start closed; the one that needs action opens by itself.">
        <div className="grid min-w-0 divide-y divide-line border-t border-line">
          {ROW_STATES.map(([title, kind, icon, state]) => <SettingsRow key={title} title={title} kind={kind} state={state}
            icon={<SettingsSourceIcon src={icon} />}>{body(`${title} panel. Its own heading is hidden because the row shows the title.`)}</SettingsRow>)}
          <SettingsRow title="Status unavailable" kind="Calendar" state={SETTINGS_SECTION_UNAVAILABLE}>{body("A failed read opens the row.")}</SettingsRow>
        </div>
      </SettingsPanel>
    </SettingsGroup>
  );
}

/** Drawers off (setup label), on (settings label) and needing action. */
export function SettingsDrawerBench() {
  return (
    <SettingsGroup id="settings-planning">
      <SettingsDrawer title="Travel" description="Know when to leave for events and Behaviors that have a place." label="Travel settings" setupLabel="Set up Travel"
        state={{ text: "Off", attention: false, on: false }}>{body("Travel controls.")}</SettingsDrawer>
      <SettingsDrawer title="Daily Brief" description="A short briefing the first time you open Timeline each day." label="Daily Brief settings" setupLabel="Set up Daily Brief"
        state={{ text: "On", attention: false, on: true }}>{body("Daily Brief controls.")}</SettingsDrawer>
      <SettingsDrawer title="Categories" description="Organize Behaviors with your own categories." label="Edit categories"
        state={{ text: "Status unavailable", attention: true, on: false }}>{body("Opens by itself when its state needs action.")}</SettingsDrawer>
    </SettingsGroup>
  );
}

/** One group, the Export entry and the end of the page: legal links and the Delete account link. */
export function SettingsSectionsBench() {
  return (
    <div className="grid max-w-xl gap-12">
      <SettingsGroup id="settings-account"><SettingsExportEntry /></SettingsGroup>
      <SettingsPageEnd deleteAccount={<p className="text-sm text-muted-readable">The existing Delete account form opens here.</p>} />
      <p className="text-sm text-muted-readable">The full page with the sticky index: /design-system?preview=settings-regroup.</p>
    </div>
  );
}

/** Ticket 303: one result line per section in each state, and a source's Disconnect confirmation. */
export function SettingsSavingBench() {
  return (
    <div className="grid max-w-xl gap-6 text-sm leading-6">
      <SettingsPanel title="Result line" description="One live region per section, visually hidden while empty.">
        <div className="grid gap-2">
          <SettingsLiveLine text={SETTINGS_SAVING} className="text-muted-readable" />
          <SettingsLiveLine text={SETTINGS_SAVED} className="text-muted-readable" />
          <SettingsLiveLine text={settingsSaveFailed("Usual travel could not save. Try again, or reload Settings if another device changed it.")} error />
        </div>
      </SettingsPanel>
      <SettingsPanel title="Disconnect" description="The first click asks in place; Cancel returns focus to the button. Nothing disconnects here.">
        <div className="flex flex-wrap gap-3">
          <SettingsDisconnect label="Disconnect Hevy" question="Disconnect Hevy?" pendingLabel="Disconnecting Hevy…" pending={false} disabled={false} onConfirm={() => undefined} />
        </div>
      </SettingsPanel>
    </div>
  );
}
