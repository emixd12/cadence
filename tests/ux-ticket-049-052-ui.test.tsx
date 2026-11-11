import { renderToStaticMarkup } from "./helpers/render-with-refresh";

import { describe, expect, it, vi } from "vitest";

import { focusAccountDeletedNotice } from "../app/(auth)/login/AccountDeletedNotice";
import { focusSignedOutNotice } from "../app/(auth)/login/SignedOutNotice";
import LoginPage from "../app/(auth)/login/page";
import {
  AccountDeletionPanel,
  isAccountDeletionReady,
  type DeleteAccountAction,
} from "../components/settings/AccountDeletionPanel";
import { BehaviorActionResultAnnouncement } from "../components/behaviors/BehaviorList";
import { inspectFirstRunNotificationSubscriptionStatus } from "../components/onboarding/FirstRunOnboardingPanel";
import {
  enableBrowserNotificationsOnDevice,
  inspectBrowserNotificationState,
  notificationMessageSemantics,
  resolveNotificationPanelAction,
} from "../components/settings/NotificationPermissionPanel";
import {
  TimezonePanel,
  type TimezoneUpdateAction,
} from "../components/settings/TimezonePanel";
import { NeedsDecisionDialog } from "../components/timeline/NeedsDecisionDialog";
import { TimelineGroup } from "../components/timeline/TimelineGroup";
import type {
  OccurrenceActionState,
  OccurrenceFormAction,
  TimeTrackingActionState,
  TimeTrackingFormAction,
  TimelineDaySection,
} from "../lib/types/timeline";
import type { TimezoneActionState } from "../lib/types/settings";

const timezoneAction: TimezoneUpdateAction = async (
  state: TimezoneActionState,
) => state;

const deleteAccountAction: DeleteAccountAction = async () => ({
  status: "idle",
  message: "",
});

const occurrenceAction: OccurrenceFormAction = async (
  state: OccurrenceActionState,
) => state;
const timeTrackingAction: TimeTrackingFormAction = async (
  state: TimeTrackingActionState,
) => state;

describe("UX Tickets 049-052 UI regressions", () => {
  it("keeps the Settings timezone anchor separate from the labeled input", () => {
    const html = renderToStaticMarkup(
      <TimezonePanel
        currentTimezone="America/New_York"
        updateTimezoneAction={timezoneAction}
      />,
    );

    expect(html.match(/id="timezone"/g)).toHaveLength(1);
    expect(html).toContain('for="timezone-select"');
    expect(html).toContain('id="timezone-select"');
    expect(html).toContain("<select");
    expect(html).not.toContain("Browser timezone");
    expect(html).not.toContain("datalist");
    expect(html).toContain("Saving moves active Behavior schedules and future Unresolved Occurrences to this timezone.");
    expect(html).toContain("Past Occurrences and ones you have marked stay as they are.");
    // Ticket 309: the option reads as a place; its value stays the IANA name.
    expect(html).toMatch(/<option value="America\/New_York"[^>]*>New York<\/option>/);
  });

  it("mirrors account deletion gates before submit", () => {
    expect(
      isAccountDeletionReady({
        exportAcknowledged: false,
        confirmation: "DELETE",
        confirmationLabel: "DELETE",
      }),
    ).toBe(false);
    expect(
      isAccountDeletionReady({
        exportAcknowledged: true,
        confirmation: "delete",
        confirmationLabel: "DELETE",
      }),
    ).toBe(false);
    expect(
      isAccountDeletionReady({
        exportAcknowledged: true,
        confirmation: " DELETE ",
        confirmationLabel: "DELETE",
      }),
    ).toBe(true);

    const html = renderToStaticMarkup(
      <AccountDeletionPanel
        confirmationLabel="DELETE"
        deleteAccountAction={deleteAccountAction}
      />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain(
      "Delete account turns on after you check the box and type the confirmation.",
    );
  });

  it("announces behavior lifecycle and account-deletion results once with the matching urgency", () => {
    const successHtml = renderToStaticMarkup(
      <BehaviorActionResultAnnouncement
        result={{ status: "success", message: "Behavior restored." }}
      />,
    );
    const failureHtml = renderToStaticMarkup(
      <BehaviorActionResultAnnouncement
        result={{ status: "error", message: "Behavior could not be archived." }}
      />,
    );
    const deletionHtml = renderToStaticMarkup(
      <AccountDeletionPanel
        confirmationLabel="DELETE"
        deleteAccountAction={deleteAccountAction}
        initialState={{
          status: "error",
          message:
            "Unable to delete this account. Your account and session are unchanged. Try again.",
        }}
      />,
    );

    expect(successHtml.match(/role="status"/g)).toHaveLength(1);
    expect(successHtml).toContain('aria-live="polite"');
    expect(failureHtml.match(/role="alert"/g)).toHaveLength(1);
    expect(failureHtml).toContain('aria-live="assertive"');
    expect(deletionHtml.match(/role="alert"/g)).toHaveLength(1);
    expect(deletionHtml).toContain(
      "Unable to delete this account. Your account and session are unchanged. Try again.",
    );
  });

  it("focuses and announces the real account-deletion success target", async () => {
    const focus = vi.fn();

    focusAccountDeletedNotice({ focus });

    expect(focus).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });

    const html = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ account_deleted: "1" }),
      }),
    );
    const successMessage = html.match(
      /<p[^>]*role="status"[^>]*>Account deleted\.<\/p>/,
    )?.[0];

    expect(successMessage).toContain('aria-live="polite"');
    expect(successMessage).toContain('aria-atomic="true"');
    expect(successMessage).toContain('tabindex="-1"');
    expect(successMessage).not.toContain("autofocus");
  });

  it("focuses and announces only a sanitized signed-out login status", async () => {
    const focus = vi.fn();

    focusSignedOutNotice({ focus });

    expect(focus).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });

    const signedOutHtml = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ signedout: "1" }),
      }),
    );
    const invalidHtml = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ signedout: ["1"] }),
      }),
    );
    const statusMessage = signedOutHtml.match(
      /<p[^>]*role="status"[^>]*>Signed out\.<\/p>/,
    )?.[0];

    expect(statusMessage).toContain('aria-live="polite"');
    expect(statusMessage).toContain('aria-atomic="true"');
    expect(statusMessage).toContain('tabindex="-1"');
    expect(statusMessage).not.toContain("autofocus");
    expect(invalidHtml).not.toContain("Signed out.");
  });

  it("settles a failed notification inspection into a retryable device state", async () => {
    const inspection = await inspectBrowserNotificationState("public-key", {
      getSupport: () => ({ supported: true }),
      readPermission: () => "granted",
      readSubscriptionStatus: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(inspection).toEqual({
      support: { supported: true },
      permission: "granted",
      subscriptionStatus: "missing",
      errorMessage:
        "Cadence could not check notifications on this device. Choose Refresh this device to try again.",
    });

    await expect(
      inspectFirstRunNotificationSubscriptionStatus(
        { supported: true },
        "public-key",
        async () => {
          throw new Error("network unavailable");
        },
      ),
    ).resolves.toBe("missing");

    expect(
      resolveNotificationPanelAction({
        support: { supported: true },
        permission: "denied",
        notificationsEnabled: false,
        inspectionFailed: false,
      }),
    ).toEqual({
      showAction: true,
      permissionBlocked: true,
      label: "Refresh this device",
    });
    expect(
      resolveNotificationPanelAction({
        support: { supported: true },
        permission: "default",
        notificationsEnabled: false,
        inspectionFailed: false,
      }).label,
    ).toBe("Enable notifications on this device");
  });

  it("uses alert semantics for every failed notification-enable outcome", async () => {
    const requestPermission = vi.fn(async () => "default" as const);
    const registerSubscription = vi.fn(async () => undefined);
    const unsupported = await enableBrowserNotificationsOnDevice("public-key", {
      getSupport: () => ({
        supported: false,
        reason: "push_unavailable",
      }),
      readPermission: () => "unavailable",
      requestPermission,
      registerSubscription,
    });
    const denied = await enableBrowserNotificationsOnDevice("public-key", {
      getSupport: () => ({ supported: true }),
      readPermission: () => "denied",
      requestPermission,
      registerSubscription,
    });
    const notGranted = await enableBrowserNotificationsOnDevice("public-key", {
      getSupport: () => ({ supported: true }),
      readPermission: () => "default",
      requestPermission,
      registerSubscription,
    });
    const enabled = await enableBrowserNotificationsOnDevice("public-key", {
      getSupport: () => ({ supported: true }),
      readPermission: () => "granted",
      requestPermission,
      registerSubscription,
    });

    for (const result of [unsupported, denied, notGranted]) {
      expect(result.saveState).toBe("error");
      expect(notificationMessageSemantics(result.saveState)).toEqual({
        role: "alert",
        ariaLive: "assertive",
      });
    }

    expect(unsupported.message).toBe(
      "Notifications are not supported on this device.",
    );
    expect(denied.message).toBe(
      "Notifications are still blocked in this browser.",
    );
    expect(notGranted.message).toBe(
      "Notifications are still off. Choose Enable notifications on this device to try again.",
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(registerSubscription).toHaveBeenCalledTimes(1);
    expect(enabled).toMatchObject({
      permission: "granted",
      subscriptionStatus: "saved",
      saveState: "saved",
      message: "Notifications are enabled on this device.",
    });
    expect(notificationMessageSemantics(enabled.saveState).role).toBe("status");
    expect(notificationMessageSemantics("idle").role).toBe("status");
  });

  it("clarifies Needs Decision retained rows when there is nothing left to decide", () => {
    const html = renderToStaticMarkup(
      <NeedsDecisionDialog
        title="Needs decision"
        occurrenceCount={0}
        hasRetainedRows
      >
        <span>Retained row</span>
      </NeedsDecisionDialog>,
    );

    expect(html).toContain("Review decisions from today");
    expect(html).toContain(
      "Open Needs decision, no prior unresolved occurrences, review decisions from today",
    );
  });

  it("labels resolved Needs Decision date groups without calling past dates today", () => {
    const html = renderToStaticMarkup(
      <TimelineGroup
        section={needsDecisionSection({
          unresolvedOccurrenceCount: 0,
        })}
        statusAction={occurrenceAction}
        noteAction={occurrenceAction}
        startTimeTrackingAction={timeTrackingAction}
        stopTimeTrackingAction={timeTrackingAction}
        resetTimeTrackingAction={timeTrackingAction}
        variant="needsDecisionDialog"
      />,
    );

    expect(html).toContain("None left to decide");
    expect(html).not.toContain("All decided today");
    expect(html).not.toContain("0 left to decide");
  });
});

function needsDecisionSection(
  overrides: Partial<TimelineDaySection> = {},
): TimelineDaySection {
  return {
    key: "needs-2026-07-05",
    kind: "needs_decision_day",
    localDate: "2026-07-05",
    label: "Sunday, July 5",
    relativeLabel: "Yesterday",
    emptyMessage: "No behaviors on this day",
    occurrences: [],
    unresolvedOccurrenceCount: 0,
    occurrenceGroups: [],
    ...overrides,
  };
}
