import { Temporal } from "@js-temporal/polyfill";
import type { ReactNode } from "react";
import type { NativeReminderCoverage } from "@cadence/core/resolvers/native-reminder.resolver";
import {
  TimezonePanel,
  type TimezoneUpdateAction,
} from "@/components/settings/TimezonePanel";
import { CATEGORY_PANEL_PURPOSE, drawerLabel } from "@/components/settings/CategoryPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanels";
import {
  DESKTOP_SETTINGS_GROUPS,
  SETTINGS_DAILY_BRIEF_PURPOSE,
  SETTINGS_TRAVEL_PURPOSE,
  SettingsDrawer,
  SettingsExportEntry,
  SettingsGroup,
  SettingsSections,
} from "@/components/settings/SettingsSections";
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
  travelControls?: ReactNode;
  categoryControls?: ReactNode;
  /** Shown as the Categories drawer state; omit to render `categoryControls` on its own. */
  categoryCount?: number;
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
  checking: "Checking macOS permission",
  notDetermined: "Not requested",
  authorized: "Allowed",
  provisional: "Provisional permission",
  denied: "Denied",
  unknown: "Not verified",
  unavailable: "Unavailable",
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
  travelControls,
  categoryControls,
  categoryCount,
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
        </SettingsGroup>

        <SettingsGroup id="settings-account">
          <SettingsExportEntry onOpen={onOpenExport} />
        </SettingsGroup>

        <SettingsGroup id="settings-mac">
          {databaseControls}
          {updates}
          <SettingsPanel
            title="Setup guide"
            description="Review the Behavior, notification, timezone, and optional import steps. The guide opens existing controls without changing tracking data."
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
      <heading.Tag className="text-xl leading-tight">Native notifications</heading.Tag>
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
          Request notification permission
        </button>
      ) : null}
      {permission === "denied" ? (
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
          Allow notifications for Cadence in macOS System Settings, then
          refresh reminder coverage. Tracking still works without
          notification permission.
        </p>
      ) : null}
      {permission === "unavailable" ? (
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
          Native notifications are unavailable in this runtime. Open the
          installed macOS app to check permission.
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
            ? "Checking reminder coverage…"
            : status === "complete"
              ? "All eligible reminders in the target window are scheduled."
              : status === "limited"
                ? "Limited reminder coverage. The verified horizon is shorter than the target."
                : "Reminder coverage is not verified."}
        </p>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm leading-6 sm:grid-cols-2">
          <CoverageValue
            label="Verified through"
            value={verified ? coverage!.scheduledThrough : null}
            timezone={currentTimezone}
            unavailable="Not verified"
          />
          <CoverageValue
            label="30-day target through"
            value={coverage?.targetThrough ?? null}
            timezone={currentTimezone}
            unavailable="Not available yet"
          />
          <div>
            <dt>Retained reminders</dt>
            <dd className="text-muted-readable">
              {verified ? coverage!.scheduledCount : "Not verified"}
            </dd>
          </div>
          <div>
            <dt>Eligible reminders</dt>
            <dd className="text-muted-readable">
              {coverage?.expectedCount ?? "Not available yet"}
            </dd>
          </div>
          <CoverageValue
            label="Last readback check"
            value={coverage?.checkedAt ?? null}
            timezone={currentTimezone}
            unavailable="Not checked"
          />
          {status === "limited" ? (
            <CoverageValue
              label="First unverified reminder"
              value={coverage!.firstUnscheduledAt}
              timezone={currentTimezone}
              unavailable="Not available"
            />
          ) : null}
        </dl>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
          Cadence targets 30 days and schedules the nearest eligible
          reminders first. macOS may retain fewer requests. Later reminders
          do not extend coverage past a missing reminder. Open Cadence to
          refresh the verified horizon.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-readable">
          Times use {currentTimezone}. Scheduling does not prove delivery;
          macOS controls notification presentation.
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
          {busy ? "Refreshing reminders…" : "Refresh reminder coverage"}
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
