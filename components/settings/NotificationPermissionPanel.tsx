"use client";

import { useEffect, useMemo, useState } from "react";
import { SettingsSectionHeading } from "@/components/settings/settings-heading";

import {
  getBrowserPushSupport,
  readBrowserPushSubscriptionStatus,
  readNotificationPermission,
  registerBrowserPushSubscription,
  requestNotificationPermission,
  type BrowserNotificationPermission,
  type BrowserPushSupport,
  type BrowserPushSubscriptionStatus,
} from "@/lib/push/browser";

type NotificationPermissionPanelProps = Readonly<{
  vapidPublicKey: string;
}>;

export type NotificationSaveState = "idle" | "saving" | "saved" | "error";
type DeviceNotificationStatus = "checking" | BrowserPushSubscriptionStatus;
type BrowserPushUnavailableReason = Extract<
  BrowserPushSupport,
  { supported: false }
>["reason"];

type BrowserNotificationInspectionDependencies = Readonly<{
  getSupport?: typeof getBrowserPushSupport;
  readPermission?: typeof readNotificationPermission;
  readSubscriptionStatus?: typeof readBrowserPushSubscriptionStatus;
}>;

type BrowserNotificationEnableDependencies = Readonly<{
  getSupport?: typeof getBrowserPushSupport;
  readPermission?: typeof readNotificationPermission;
  requestPermission?: typeof requestNotificationPermission;
  registerSubscription?: typeof registerBrowserPushSubscription;
}>;

export type BrowserNotificationInspection = Readonly<{
  support: BrowserPushSupport;
  permission: BrowserNotificationPermission;
  subscriptionStatus: BrowserPushSubscriptionStatus;
  errorMessage: string;
}>;

export type BrowserNotificationEnableResult = Readonly<{
  support: BrowserPushSupport;
  permission: BrowserNotificationPermission;
  subscriptionStatus: BrowserPushSubscriptionStatus;
  saveState: Extract<NotificationSaveState, "saved" | "error">;
  message: string;
}>;

export function NotificationPermissionPanel({
  vapidPublicKey,
}: NotificationPermissionPanelProps) {
  const [support, setSupport] = useState<BrowserPushSupport | null>(null);
  const [permission, setPermission] =
    useState<BrowserNotificationPermission>("unavailable");
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<DeviceNotificationStatus>("checking");
  const [saveState, setSaveState] =
    useState<NotificationSaveState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let isActive = true;
    const timeoutId = window.setTimeout(() => {
      if (!isActive) {
        return;
      }

      void loadBrowserNotificationState();
    }, 0);

    async function loadBrowserNotificationState() {
      const inspection = await inspectBrowserNotificationState(vapidPublicKey);

      if (!isActive) {
        return;
      }

      setSupport(inspection.support);
      setPermission(inspection.permission);
      setSubscriptionStatus(inspection.subscriptionStatus);

      if (inspection.errorMessage) {
        setSaveState("error");
        setMessage(inspection.errorMessage);
      } else {
        setSaveState("idle");
        setMessage("");
      }
    }

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
    };
  }, [vapidPublicKey]);

  const unavailableMessage = useMemo(
    () => (support?.supported === false ? supportMessage(support.reason) : ""),
    [support],
  );
  const isBusy = saveState === "saving";
  const notificationsEnabled =
    permission === "granted" && subscriptionStatus === "saved";
  const actionModel = resolveNotificationPanelAction({
    support,
    permission,
    notificationsEnabled,
    inspectionFailed: saveState === "error" && permission === "granted",
  });
  const canRequest = actionModel.showAction && !isBusy;
  const statusLabel = deviceNotificationStatusLabel({
    permission,
    subscriptionStatus,
    support,
  });

  async function handleEnable() {
    setSaveState("saving");
    setMessage("");
    const result = await enableBrowserNotificationsOnDevice(vapidPublicKey);

    setSupport(result.support);
    setPermission(result.permission);
    setSubscriptionStatus(result.subscriptionStatus);
    setSaveState(result.saveState);
    setMessage(result.message);
  }

  return (
    <section
      id="notifications"
      className="scroll-mt-20 bg-background py-4 first:pt-0 last:pb-0"
    >
      <SettingsSectionHeading>Notifications</SettingsSectionHeading>
      <dl className="mt-4 grid gap-3 text-sm leading-6 text-muted-readable">
        <div>
          <dt className="font-bold text-foreground">Browser notifications</dt>
          <dd>{statusLabel}</dd>
        </div>
      </dl>

      {actionModel.showAction ? (
        <button
          type="button"
          disabled={!canRequest}
          onClick={handleEnable}
          className="product-action product-action-primary mt-4 min-h-11 w-fit py-2 text-sm"
        >
          {isBusy
            ? "Saving…"
            : actionModel.label}
        </button>
      ) : null}

      {actionModel.permissionBlocked ? (
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-readable">
          Allow notifications for Cadence in your browser&apos;s site settings,
          then come back and choose Refresh this device.
        </p>
      ) : null}

      {message || unavailableMessage ? (
        <p
          role={notificationMessageSemantics(saveState).role}
          aria-live={notificationMessageSemantics(saveState).ariaLive}
          aria-atomic="true"
          className={[
            "mt-5 text-sm leading-6",
            saveState === "error" ? "text-accent" : "text-muted-readable",
          ].join(" ")}
        >
          {message || unavailableMessage}
        </p>
      ) : null}
    </section>
  );
}

export async function enableBrowserNotificationsOnDevice(
  vapidPublicKey: string,
  dependencies: BrowserNotificationEnableDependencies = {},
): Promise<BrowserNotificationEnableResult> {
  const getSupport = dependencies.getSupport ?? getBrowserPushSupport;
  const readPermission =
    dependencies.readPermission ?? readNotificationPermission;
  const requestPermission =
    dependencies.requestPermission ?? requestNotificationPermission;
  const registerSubscription =
    dependencies.registerSubscription ?? registerBrowserPushSubscription;
  const support = getSupport(vapidPublicKey);
  let permission = readPermission();

  if (!support.supported) {
    return {
      support,
      permission,
      subscriptionStatus: "unavailable",
      saveState: "error",
      message: supportMessage(support.reason),
    };
  }

  try {
    if (permission === "default") {
      permission = await requestPermission();
    }

    if (permission === "denied") {
      return {
        support,
        permission,
        subscriptionStatus: "missing",
        saveState: "error",
        message: "Notifications are still blocked in this browser.",
      };
    }

    if (permission !== "granted") {
      return {
        support,
        permission,
        subscriptionStatus: "missing",
        saveState: "error",
        message:
          "Notifications are still off. Choose Enable notifications on this device to try again.",
      };
    }

    await registerSubscription(vapidPublicKey);

    return {
      support,
      permission,
      subscriptionStatus: "saved",
      saveState: "saved",
      message: "Notifications are enabled on this device.",
    };
  } catch (error) {
    return {
      support,
      permission,
      subscriptionStatus: "missing",
      saveState: "error",
      message:
        error instanceof Error
          ? error.message
          : "Browser notifications could not be enabled.",
    };
  }
}

export function notificationMessageSemantics(
  saveState: NotificationSaveState,
): Readonly<{
  role: "alert" | "status";
  ariaLive: "assertive" | "polite";
}> {
  return saveState === "error"
    ? { role: "alert", ariaLive: "assertive" }
    : { role: "status", ariaLive: "polite" };
}

function deviceNotificationStatusLabel(input: {
  permission: BrowserNotificationPermission;
  subscriptionStatus: DeviceNotificationStatus;
  support: BrowserPushSupport | null;
}): string {
  if (input.support === null || input.subscriptionStatus === "checking") {
    return "Checking…";
  }

  if (input.support.supported === false || input.permission === "unavailable") {
    return "Not supported on this device";
  }

  if (input.permission === "denied") {
    return "Blocked in this browser";
  }

  if (
    input.permission === "granted" &&
    input.subscriptionStatus === "saved"
  ) {
    return "Enabled on this device";
  }

  return "Not enabled on this device";
}

export function resolveNotificationPanelAction({
  support,
  permission,
  notificationsEnabled,
  inspectionFailed,
}: Readonly<{
  support: BrowserPushSupport | null;
  permission: BrowserNotificationPermission;
  notificationsEnabled: boolean;
  inspectionFailed: boolean;
}>): Readonly<{
  showAction: boolean;
  permissionBlocked: boolean;
  label: string;
}> {
  const showAction = support?.supported === true;
  const permissionBlocked = showAction && permission === "denied";

  return {
    showAction,
    permissionBlocked,
    label:
      notificationsEnabled || permissionBlocked || inspectionFailed
        ? "Refresh this device"
        : "Enable notifications on this device",
  };
}

export async function inspectBrowserNotificationState(
  vapidPublicKey: string,
  dependencies: BrowserNotificationInspectionDependencies = {},
): Promise<BrowserNotificationInspection> {
  const getSupport = dependencies.getSupport ?? getBrowserPushSupport;
  const readPermission =
    dependencies.readPermission ?? readNotificationPermission;
  const readSubscriptionStatus =
    dependencies.readSubscriptionStatus ?? readBrowserPushSubscriptionStatus;
  const support = getSupport(vapidPublicKey);
  const permission = readPermission();

  if (!support.supported) {
    return {
      support,
      permission,
      subscriptionStatus: "unavailable",
      errorMessage: "",
    };
  }

  try {
    return {
      support,
      permission,
      subscriptionStatus: await readSubscriptionStatus(vapidPublicKey),
      errorMessage: "",
    };
  } catch {
    return {
      support,
      permission,
      subscriptionStatus: "missing",
      errorMessage:
        "Cadence could not check notifications on this device. Choose Refresh this device to try again.",
    };
  }
}

function supportMessage(reason: BrowserPushUnavailableReason): string {
  switch (reason) {
    case "missing_public_key":
      return "This Cadence server has not set up notifications.";
    case "notifications_unavailable":
      return "Notifications are not supported on this device.";
    case "service_worker_unavailable":
      return "Notifications are not supported on this device.";
    case "push_unavailable":
      return "Notifications are not supported on this device.";
  }
}
