import { Temporal } from "@js-temporal/polyfill";
import type { ReactNode } from "react";
import type { NativeReminderCoverage } from "@cadence/core/resolvers/native-reminder.resolver";
import {
  TimezonePanel,
  type TimezoneUpdateAction,
} from "@/components/settings/TimezonePanel";
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
}>;

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
}: SettingsScreenProps) {
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
    <DesktopScreenFrame title="Settings">
      <div className="grid divide-y divide-line">
        <section className="bg-background pb-4">
          <h2 className="text-xl leading-tight">Local profile</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
            {accountConnected
              ? "Tracking data uses this Mac’s SQLite database as an offline working copy. Account changes synchronize while Cadence runs with connectivity. Native reminders stay on this Mac, and desktop email delivery remains inactive."
              : "Tracking data stays on this Mac. No cloud account or email delivery is connected."}
          </p>
        </section>
        {accountControls}
        {calendarControls}
        {travelControls}
        {dailyBriefControls}
        <TimezonePanel
          currentTimezone={currentTimezone}
          updateTimezoneAction={updateTimezoneAction}
        />
        {categoryControls}
        {databaseControls}
        <section
          id="notifications"
          aria-busy={busy}
          className="scroll-mt-20 bg-background py-4"
        >
          <h2 className="text-xl leading-tight">Native notifications</h2>
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
            <h3 className="text-lg leading-tight">Reminder coverage</h3>
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
        {updates}
        <section className="bg-background py-4 last:pb-0">
          <h2 className="text-xl leading-tight">Setup guide</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
            Review the Behavior, notification, timezone, and optional import
            steps. The guide opens existing controls without changing tracking
            data.
          </p>
          <button
            type="button"
            onClick={onShowOnboarding}
            className="product-action product-action-secondary mt-4 min-h-11 w-fit py-2 text-sm"
          >
            Show setup guide
          </button>
        </section>
      </div>
    </DesktopScreenFrame>
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
