import { SETTINGS_SECTION_CHECKING, type SettingsSectionState } from "@/lib/ui/settings-sections";
import type { SyncStatus } from "../sync-engine";
import type { DesktopAccountState } from "./auth";

// Ticket 302. The Mac's Cadence account drawer shows one line of state while it
// is closed, from the same inputs the account panels render. Pure: no browser,
// native or network access. A state that needs action opens the drawer.

export type DesktopAccountSectionInput = Readonly<{
  /** False until the saved session has been read; "local" is only the default before that. */
  known: boolean;
  account: DesktopAccountState;
  /** Sign-in is configured in this build. */
  configured: boolean;
  /** The account link is complete and synchronization runs. */
  connected: boolean;
  syncStatus: SyncStatus;
  /** Conflicts waiting in the review. */
  conflictCount: number;
  /** A first-link choice (import or ignore local data) is waiting. */
  firstLinkPending: boolean;
}>;

const state = (text: string, on: boolean, attention = false): SettingsSectionState => ({ text, attention, on });

export function desktopAccountSectionState(input: DesktopAccountSectionInput): SettingsSectionState {
  const conflicts = input.conflictCount > 0 ? input.conflictCount
    : input.connected && input.syncStatus.state === "conflict" ? input.syncStatus.count : 0;
  if (conflicts > 0) return state(`${conflicts} sync ${conflicts === 1 ? "conflict" : "conflicts"} to review`, true, true);
  if (input.firstLinkPending) return state("Choose which data to use", true, true);
  if (input.connected) {
    switch (input.syncStatus.state) {
      case "revoked": return state("Needs reconnection", true, true);
      case "update_required": return state("Update required to sync", true, true);
      // A failed run retries by itself and the panel shows why; it does not open the drawer.
      case "failed": return state("Linked · Sync failed", true);
      case "syncing": return state("Linked · Syncing…", true);
      case "current": return state("Linked · Up to date", true);
      case "offline": return state("Linked · Offline", true);
      case "conflict": return state("Linked", true);
    }
  }
  if (!input.known) return SETTINGS_SECTION_CHECKING;
  switch (input.account.status) {
    case "waiting": return state("Waiting for sign-in", false);
    // Ticket 336: the code is typed in this drawer, so it opens.
    case "code": return state("Waiting for the email code", false, true);
    case "error": return state("Sign-in did not finish", false, true);
    // Linked but not yet synchronizing: the link is still being set up.
    case "linked": return SETTINGS_SECTION_CHECKING;
    case "local": return input.configured ? state("Not linked", false) : state("Not in this version", false);
  }
}
