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
  SettingsDrawer,
  SettingsExportEntry,
  SettingsGroup,
  SettingsPageEnd,
  SettingsSections,
} from "@/components/settings/SettingsSections";
import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { ConnectedAppsPanel } from "@/components/settings/ConnectedAppsPanel";
import { getConnectedApps } from "@/lib/services/oauth-ui.service";
import { SignInMethodsRow } from "@/components/settings/SignInMethodsPanel";
import {
  SIGN_IN_METHODS_METHOD_PARAM,
  SIGN_IN_METHODS_RESULT_PARAM,
  signInMethodResultMessage,
} from "@/lib/auth/account-sign-in-methods";
import { getSignInMethodsView } from "@/lib/services/sign-in-methods.service";
import { WebConnectorLibrary } from "@/components/settings/WebConnectorLibrary";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { getCategorySettings } from "@/lib/services/category.service";
import { getSettingsPageData } from "@/lib/services/settings.service";
import { withPerformanceRoute } from "@/lib/services/performance-timing";
import {
  CATEGORY_PANEL_PURPOSE,
  DAY_NOTE_SHORTCUTS_PURPOSE,
  SETTINGS_DAILY_BRIEF_PURPOSE,
  SETTINGS_TRAVEL_PURPOSE,
  categoriesSectionState,
  dayNoteShortcutsSectionState,
  drawerLabel,
} from "@/lib/ui/settings-sections";
import { changeCategoryAction, deleteAccountAction, disconnectAppAction, updateTimezoneAction } from "./actions";
import { manageNoteShortcutAction } from "@/app/(app)/note-shortcuts/actions";
import { DayNoteShortcutSettings } from "@/components/note-shortcuts/NoteShortcutControls";
import { DAY_NOTE_SHORTCUT_POOL_ID } from "@cadence/core/resolvers/day-note.resolver";
import { getNoteShortcutViewForCurrentUser } from "@/lib/services/note-shortcut.service";

export const metadata: Metadata = {
  title: "Settings",
};

type SettingsSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function SettingsPage({ searchParams }: Readonly<{ searchParams: SettingsSearchParams }>) {
  return (
    <ScreenFrame title="Settings">
      <Suspense fallback={<ScreenContentLoading label="Loading settings" />}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </ScreenFrame>
  );
}

async function SettingsContent({ searchParams }: Readonly<{ searchParams: SettingsSearchParams }>) {
  const settings = await withPerformanceRoute(
    "/settings",
    "page.data_load",
    () => getSettingsPageData(),
  );

  const [categorySettings, connectedApps, dayNoteShortcutView, signInMethods, params] = await Promise.all([
    getCategorySettings(),
    getConnectedApps(),
    getNoteShortcutViewForCurrentUser(DAY_NOTE_SHORTCUT_POOL_ID),
    getSignInMethodsView(),
    searchParams,
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
        {/* Ticket 334: only while CADENCE_SIGN_IN_LINKING is on. */}
        {signInMethods ? (
          <SignInMethodsRow
            view={signInMethods}
            result={signInMethodResultMessage(
              params[SIGN_IN_METHODS_RESULT_PARAM],
              params[SIGN_IN_METHODS_METHOD_PARAM],
            )}
          />
        ) : null}
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
