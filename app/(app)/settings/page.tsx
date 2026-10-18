import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ScreenContentLoading,
  ScreenFrame,
} from "@/components/layout/ScreenFrame";
import { AccountDeletionPanel } from "@/components/settings/AccountDeletionPanel";
import { NotificationPermissionPanel } from "@/components/settings/NotificationPermissionPanel";
import { TimezonePanel } from "@/components/settings/TimezonePanel";
import {
  SettingsPanelGrid,
  SettingsProfile,
  TrustAndLegalPanel,
} from "@/components/settings/SettingsPanels";
import { CategoryPanel } from "@/components/settings/CategoryPanel";
import { ConnectedAppsPanel } from "@/components/settings/ConnectedAppsPanel";
import { getConnectedApps } from "@/lib/services/oauth-ui.service";
import { disconnectAppAction } from "./actions";
import { GlobalNoteShortcutControl } from "@/components/note-shortcuts/NoteShortcutControls";
import { WebGoogleCalendarPanel } from "@/components/settings/WebGoogleCalendarPanel";
import { DailyBriefSettingsPanel } from "@/components/briefing/DailyBriefSettingsPanel";
import { TravelSettingsPanel } from "@/components/settings/TravelSettingsPanel";
import { getNoteShortcutViewForCurrentUser } from "@/lib/services/note-shortcut.service";
import { manageNoteShortcutAction } from "@/app/(app)/note-shortcuts/actions";
import { getCategorySettings } from "@/lib/services/category.service";
import { changeCategoryAction } from "./actions";
import { getSettingsPageData } from "@/lib/services/settings.service";
import { withPerformanceRoute } from "@/lib/services/performance-timing";
import { deleteAccountAction, updateTimezoneAction } from "./actions";

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

  const [categorySettings, noteShortcutView, connectedApps] = await Promise.all([
    getCategorySettings(),
    getNoteShortcutViewForCurrentUser(null),
    getConnectedApps(),
  ]);

  return (
    <SettingsPanelGrid>
      <SettingsProfile email={settings.email} />

      <TimezonePanel
        currentTimezone={settings.timezone}
        updateTimezoneAction={updateTimezoneAction}
      />

      <NotificationPermissionPanel
        vapidPublicKey={settings.vapidPublicKey}
      />

      <WebGoogleCalendarPanel timezone={settings.timezone} />

      <TravelSettingsPanel />

      <DailyBriefSettingsPanel />

      <ConnectedAppsPanel view={connectedApps} timezone={settings.timezone} action={disconnectAppAction} />

      <CategoryPanel {...categorySettings} action={changeCategoryAction} />

      <GlobalNoteShortcutControl view={noteShortcutView} action={manageNoteShortcutAction} />

      <TrustAndLegalPanel />

      <AccountDeletionPanel
        confirmationLabel={settings.deleteConfirmationLabel}
        deleteAccountAction={deleteAccountAction}
      />
    </SettingsPanelGrid>
  );
}
