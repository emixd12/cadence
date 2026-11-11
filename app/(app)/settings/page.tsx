import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ScreenContentLoading,
  ScreenFrame,
} from "@/components/layout/ScreenFrame";
import { AccountDeletionPanel } from "@/components/settings/AccountDeletionPanel";
import { NotificationPermissionPanel } from "@/components/settings/NotificationPermissionPanel";
import { TimezonePanel } from "@/components/settings/TimezonePanel";
import { SettingsProfile } from "@/components/settings/SettingsPanels";
import {
  SETTINGS_DAILY_BRIEF_PURPOSE,
  SETTINGS_TRAVEL_PURPOSE,
  SettingsDrawer,
  SettingsExportEntry,
  SettingsGroup,
  SettingsPageEnd,
  SettingsSections,
} from "@/components/settings/SettingsSections";
import { CATEGORY_PANEL_PURPOSE, CategoryPanel, drawerLabel } from "@/components/settings/CategoryPanel";
import { ConnectedAppsPanel } from "@/components/settings/ConnectedAppsPanel";
import { getConnectedApps } from "@/lib/services/oauth-ui.service";
import { WebConnectorLibrary } from "@/components/settings/WebConnectorLibrary";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { getCategorySettings } from "@/lib/services/category.service";
import { getSettingsPageData } from "@/lib/services/settings.service";
import { withPerformanceRoute } from "@/lib/services/performance-timing";
import { categoriesSectionState, dayNoteShortcutsSectionState } from "@/lib/ui/settings-sections";
import { changeCategoryAction, deleteAccountAction, disconnectAppAction, updateTimezoneAction } from "./actions";
import { manageNoteShortcutAction } from "@/app/(app)/note-shortcuts/actions";
import { DAY_NOTE_SHORTCUTS_PURPOSE, DayNoteShortcutSettings } from "@/components/note-shortcuts/NoteShortcutControls";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import { getNoteShortcutViewForCurrentUser } from "@/lib/services/note-shortcut.service";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <ScreenFrame title="Settings">
      <Suspense fallback={<ScreenContentLoading label="Loading settings" />}>
        <SettingsContent />
      </Suspense>
    </ScreenFrame>
  );
}

async function SettingsContent() {
  const settings = await withPerformanceRoute(
    "/settings",
    "page.data_load",
    () => getSettingsPageData(),
  );

  const [categorySettings, connectedApps, dayNoteShortcutView] = await Promise.all([
    getCategorySettings(),
    getConnectedApps(),
    getNoteShortcutViewForCurrentUser(DAY_NOTE_SHORTCUT_POOL_ID),
  ]);

  // Ticket 301: four groups, a sticky index, closed source rows and drawers.
  // Note shortcuts has no Settings control here (Ticket 305). Day note shortcuts are
  // reviewed here because day notes have no Behavior settings (Ticket 292).
  return (
    <SettingsSections>
      <SettingsGroup id="settings-general">
        <SettingsProfile email={settings.email} />
        <TimezonePanel
          currentTimezone={settings.timezone}
          updateTimezoneAction={updateTimezoneAction}
        />
        <NotificationPermissionPanel vapidPublicKey={settings.vapidPublicKey} />
        <SettingsDrawer
          title="Categories"
          description={CATEGORY_PANEL_PURPOSE}
          label={drawerLabel(categorySettings.categories.length)}
          state={categoriesSectionState(categorySettings.categories.length)}
        >
          <CategoryPanel {...categorySettings} action={changeCategoryAction} />
        </SettingsDrawer>
        <SettingsDrawer
          title="Day note shortcuts"
          description={DAY_NOTE_SHORTCUTS_PURPOSE}
          label="Day note shortcuts"
          state={dayNoteShortcutsSectionState(dayNoteShortcutView)}
        >
          <DayNoteShortcutSettings view={dayNoteShortcutView} action={manageNoteShortcutAction} />
        </SettingsDrawer>
      </SettingsGroup>

      <SettingsGroup id="settings-connections">
        <WebConnectorLibrary timezone={settings.timezone} />
        <ConnectedAppsPanel view={connectedApps} timezone={settings.timezone} action={disconnectAppAction} />
      </SettingsGroup>

      <SettingsGroup id="settings-planning">
        <SettingsDrawer
          title="Travel"
          description={SETTINGS_TRAVEL_PURPOSE}
          label="Travel settings"
          setupLabel="Set up Travel"
        >
          <TravelSettingsPanel vapidPublicKey={settings.vapidPublicKey} />
        </SettingsDrawer>
        <SettingsDrawer
          title="Daily Brief"
          description={SETTINGS_DAILY_BRIEF_PURPOSE}
          label="Daily Brief settings"
          setupLabel="Set up Daily Brief"
        >
          <DailyBriefSettingsPanel />
        </SettingsDrawer>
      </SettingsGroup>

      <SettingsGroup id="settings-account">
        <SettingsExportEntry />
      </SettingsGroup>

      <SettingsPageEnd
        deleteAccount={
          <AccountDeletionPanel
            headingLevel={null}
            confirmationLabel={settings.deleteConfirmationLabel}
            deleteAccountAction={deleteAccountAction}
          />
        }
      />
    </SettingsSections>
  );
}
