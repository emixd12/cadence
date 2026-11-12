import { Temporal } from "@js-temporal/polyfill";
import type { ReactNode } from "react";
import type { NativeReminderCoverage } from "@cadence/core/resolvers/native-reminder.resolver";
import {
  TimezonePanel,
  type TimezoneUpdateAction,
} from "@/components/settings/TimezonePanel";
import {
  CATEGORY_PANEL_PURPOSE,
  DAY_NOTE_SHORTCUTS_PURPOSE,
  SETTINGS_DAILY_BRIEF_PURPOSE,
  SETTINGS_TRAVEL_PURPOSE,
  drawerLabel,
} from "@/lib/ui/settings-sections";
import { SettingsPanel } from "@/components/settings/SettingsPanels";
import {
  DESKTOP_SETTINGS_GROUPS,
  SettingsDrawer,
  SettingsExportEntry,
  SettingsGroup,
  SettingsSections,
} from "@/components/settings/SettingsSections";
import { timezonePlaceLabel } from "@/lib/ui/timezone-labels";
import { SettingsPartHeading, useSettingsHeading } from "@/components/settings/settings-heading";
import { categoriesSectionState, type SettingsSectionState } from "@/lib/ui/settings-sections";
import { DesktopScreenFrame } from "./desktop-screen-frame";

export type NativeNotificationPermission =
  | "checking"
  | "notDetermined"
  | "authorized"
  | "provisional"
  | "denied"
  | "unknown"
  | "unavailable";
export type NativeSettingsCoverage = NativeReminderCoverage &
  Readonly<{ targetThrough: string; checkedAt: string | null }>;
export type SettingsScreenProps = Readonly<{
  currentTimezone: string;
  accountConnected: boolean;
  updateTimezoneAction: TimezoneUpdateAction;
  permission: NativeNotificationPermission;
  coverage: NativeSettingsCoverage | null;
  busy: boolean;
  error?: string;
  onRequestPermission: () => void;
  onReconcile: () => void;
  onShowOnboarding: () => void;
  updates?: ReactNode;
  databaseControls?: ReactNode;
  accountControls?: ReactNode;
  calendarControls?: ReactNode;
  dailyBriefControls?: ReactNode;
  /** Ticket 299: the "Use your ChatGPT plan" card; omitted unless the ChatGPT plan switch is on. */
  chatGptPlanControls?: ReactNode;
  travelControls?: ReactNode;
  categoryControls?: ReactNode;
  /** Shown as the Categories drawer state; omit to render `categoryControls` on its own. */
  categoryCount?: number;
  /** Ticket 292: reviews the day-note shortcut pool in a General drawer. */
  dayNoteShortcutControls?: ReactNode;
  dayNoteShortcutState?: SettingsSectionState;
  /** The Cadence account drawer's state line (`desktopAccountSectionState`). */
  accountState?: SettingsSectionState;
  /** A fixed Daily Brief state when its panel cannot load, such as on a local Mac. */
  dailyBriefState?: SettingsSectionState;
  /** The shell's sync-conflict cue is showing; the section index sits below it. */
  shellCue?: boolean;
  onOpenExport?: () => void;
}>;

/** Ticket 302: purposes for the Mac-only drawer and sections. */
export const SETTINGS_ACCOUNT_PURPOSE = "Optional. Link this Mac to your Cadence account to synchronize tracking data and connect sources.";

const PERMISSION_LABELS: Record<NativeNotificationPermission, string> = {
  checking: "Checking…",
  notDetermined: "Not asked yet",
  authorized: "Allowed",
  provisional: "Allowed quietly",
  denied: "Not allowed",
  unknown: "Unknown",
  unavailable: "Not available here",
};

export function SettingsScreen({
  currentTimezone,
  accountConnected,
  updateTimezoneAction,
  permission,
  coverage,
  busy,
  error,
  onRequestPermission,
  onReconcile,
  onShowOnboarding,
  updates,
  databaseControls,
  accountControls,
  calendarControls,
  dailyBriefControls,
  chatGptPlanControls,
  travelControls,
  categoryControls,
  categoryCount,
  dayNoteShortcutControls,
  dayNoteShortcutState,
  accountState,
  dailyBriefState,
  shellCue = false,
  onOpenExport,
}: SettingsScreenProps) {
  // Ticket 302: the web groups, index, rows and drawers, plus a Mac group.
  // Native notifications sit where web shows Notifications.
  return (
    <DesktopScreenFrame title="Settings">
      <SettingsSections groups={DESKTOP_SETTINGS_GROUPS} shellCue={shellCue}>
        <SettingsGroup id="settings-general">
          <SettingsPanel title="Local profile">
            <p className="max-w-2xl text-sm leading-6 text-muted-readable">
              {accountConnected
                ? "Tracking data uses this Mac’s SQLite database as an offline working copy. Account changes synchronize while Cadence runs with connectivity. Native reminders stay on this Mac, and desktop email delivery remains inactive."
                : "Tracking data stays on this Mac. No cloud account or email delivery is connected."}
            </p>
          </SettingsPanel>
          {accountControls ? (
            <SettingsDrawer
              title="Cadence account"
              description={SETTINGS_ACCOUNT_PURPOSE}
              label="Account settings"
              setupLabel="Link a Cadence account"
              state={accountState}
            >
              {accountControls}
            </SettingsDrawer>
          ) : null}
          <TimezonePanel
            currentTimezone={currentTimezone}
            updateTimezoneAction={updateTimezoneAction}
          />
          <NativeNotifications
            currentTimezone={currentTimezone}
            permission={permission}
            coverage={coverage}
            busy={busy}
            error={error}
            onRequestPermission={onRequestPermission}
            onReconcile={onReconcile}
          />
          {categoryControls && categoryCount !== undefined ? (
            <SettingsDrawer
              title="Categories"
              description={CATEGORY_PANEL_PURPOSE}
              label={drawerLabel(categoryCount)}
              state={categoriesSectionState(categoryCount)}
            >
              {categoryControls}
            </SettingsDrawer>
          ) : categoryControls}
          {dayNoteShortcutControls ? (
            <SettingsDrawer
              title="Day note shortcuts"
              description={DAY_NOTE_SHORTCUTS_PURPOSE}
              label="Day note shortcuts"
              state={dayNoteShortcutState}
            >
              {dayNoteShortcutControls}
            </SettingsDrawer>
          ) : null}
        </SettingsGroup>

        <SettingsGroup id="settings-connections">{calendarControls}</SettingsGroup>

        <SettingsGroup id="settings-planning">
          {travelControls ? (
            <SettingsDrawer
              title="Travel"
              description={SETTINGS_TRAVEL_PURPOSE}
              label="Travel settings"
              setupLabel="Set up Travel"
            >
              {travelControls}
            </SettingsDrawer>
          ) : null}
          {dailyBriefControls ? (
            <SettingsDrawer
              title="Daily Brief"
              description={SETTINGS_DAILY_BRIEF_PURPOSE}
              label="Daily Brief settings"
              setupLabel="Set up Daily Brief"
              state={dailyBriefState}
            >
              {dailyBriefControls}
            </SettingsDrawer>
          ) : null}
          {chatGptPlanControls}
        </SettingsGroup>

        <SettingsGroup id="settings-account">
          <SettingsExportEntry onOpen={onOpenExport} />
        </SettingsGroup>

        <SettingsGroup id="settings-mac">
          {databaseControls}
          {updates}
          <SettingsPanel
            title="Setup guide"
            description="Go through the Behavior, notification, timezone and import steps again. The guide only opens controls; it changes nothing by itself."
          >
            <button
              type="button"
              onClick={onShowOnboarding}
              className="product-action product-action-secondary min-h-11 w-fit py-2 text-sm"
            >
              Show setup guide
            </button>
          </SettingsPanel>
        </SettingsGroup>
      </SettingsSections>
    </DesktopScreenFrame>
  );
}

/** Native notifications and Reminder coverage: one General section where web shows Notifications. */
function NativeNotifications({
  currentTimezone,
  permission,
  coverage,
  busy,
  error,
  onRequestPermission,
  onReconcile,
}: Readonly<Pick<SettingsScreenProps, "currentTimezone" | "permission" | "coverage" | "busy" | "error" | "onRequestPermission" | "onReconcile">>) {
  const heading = useSettingsHeading();
  const hasPermission =
    permission === "authorized" || permission === "provisional";
  const verified = Boolean(
    hasPermission &&
    !error &&
    coverage?.checkedAt &&
    coverage.status !== "unverified",
  );
  const status = verified ? coverage!.status : "unverified";

  return (
    <section
      id="notifications"
      aria-busy={busy}
      className="bg-background py-4 first:pt-0 last:pb-0"
    >
      <heading.Tag className="text-xl leading-tight">Notifications</heading.Tag>
      <dl className="mt-4 grid gap-3 text-sm leading-6">
        <div>
          <dt className="text-foreground">macOS permission</dt>
          <dd className="text-muted-readable">
            {PERMISSION_LABELS[permission]}
          </dd>
        </div>
      </dl>
      {permission === "notDetermined" ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRequestPermission}
          className="product-action product-action-primary mt-4 min-h-11 w-fit py-2 text-sm"
        >
          Allow notifications
        </button>
      ) : null}
      {permission === "denied" ? (
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
          Turn on notifications for Cadence in System Settings ›
          Notifications, then choose Check reminders. Tracking works without
          notifications.
        </p>
      ) : null}
      {permission === "unavailable" ? (
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
          Notifications are not available here. Open Cadence for Mac to
          check them.
        </p>
      ) : null}

      <div className="mt-6 border-t border-line pt-4">
        <SettingsPartHeading className="text-lg leading-tight">Reminder coverage</SettingsPartHeading>
        <p
          role="status"
          aria-live="polite"
          className={[
            "mt-3 text-sm leading-6",
            status === "complete" ? "text-foreground" : "text-accent",
          ].join(" ")}
        >
          {busy
            ? "Checking reminders…"
            : status === "complete"
              ? "Every reminder for the next 30 days is scheduled."
              : status === "limited"
                ? "macOS kept fewer reminders than Cadence scheduled. Reminders are set only through the date below."
                : "Cadence has not confirmed which reminders are scheduled."}
        </p>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm leading-6 sm:grid-cols-2">
          <CoverageValue
            label="Scheduled through"
            value={verified ? coverage!.scheduledThrough : null}
            timezone={currentTimezone}
            unavailable="Not confirmed"
          />
          <CoverageValue
            label="30-day goal"
            value={coverage?.targetThrough ?? null}
            timezone={currentTimezone}
            unavailable="Not available yet"
          />
          <div>
            <dt>Reminders macOS kept</dt>
            <dd className="text-muted-readable">
              {verified ? coverage!.scheduledCount : "Not confirmed"}
            </dd>
          </div>
          <div>
            <dt>Reminders to schedule</dt>
            <dd className="text-muted-readable">
              {coverage?.expectedCount ?? "Not available yet"}
            </dd>
          </div>
          <CoverageValue
            label="Last checked"
            value={coverage?.checkedAt ?? null}
            timezone={currentTimezone}
            unavailable="Not checked"
          />
          {status === "limited" ? (
            <CoverageValue
              label="First reminder not scheduled"
              value={coverage!.firstUnscheduledAt}
              timezone={currentTimezone}
              unavailable="Not available"
            />
          ) : null}
        </dl>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
          Cadence schedules up to 30 days of reminders, nearest first. macOS
          may keep fewer. Scheduled through stops at the first reminder macOS
          did not keep. Opening Cadence checks again.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">
          Times use {timezonePlaceLabel(currentTimezone)} time. macOS decides
          whether and how each scheduled reminder shows.
        </p>
        <button
          type="button"
          disabled={
            busy ||
            permission === "checking" ||
            permission === "unavailable"
          }
          onClick={onReconcile}
          className="product-action product-action-secondary mt-4 min-h-11 w-fit py-2 text-sm"
        >
          {busy ? "Checking reminders…" : "Check reminders"}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-4 max-w-2xl text-sm leading-6 text-accent"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function CoverageValue({
  label,
  value,
  timezone,
  unavailable,
}: Readonly<{
  label: string;
  value: string | null;
  timezone: string;
  unavailable: string;
}>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="text-muted-readable">
        {value ? (
          <time dateTime={value}>{formatReminderInstant(value, timezone)}</time>
        ) : (
          unavailable
        )}
      </dd>
    </div>
  );
}

function formatReminderInstant(value: string, timezone: string): string {
  try {
    return Temporal.Instant.from(value)
      .toZonedDateTimeISO(timezone)
      .toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
  } catch {
    return "Unavailable";
  }
}
