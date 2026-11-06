import type { LeaveReminderDeviceNotifications } from "@cadence/core/services/departure-phrases";
import { inspectBrowserNotificationState } from "@/components/settings/NotificationPermissionPanel";

/** Ticket 279: the account's leave reminder switch on the hosted server. */
export type LeaveReminderSetting = Readonly<{ enabled: boolean }>;
export type LeaveReminderClient = Readonly<{
  load: () => Promise<LeaveReminderSetting>;
  save: (enabled: boolean) => Promise<LeaveReminderSetting>;
}>;

async function readSetting(response: Response): Promise<LeaveReminderSetting> {
  if (!response.ok) throw new Error("Leave reminder setting unavailable.");
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
    throw new Error("Leave reminder setting unavailable.");
  }
  return { enabled: (body as { enabled: boolean }).enabled };
}

/**
 * One client for web (same-origin session) and a linked Mac (the hosted origin with a bearer
 * token). Nothing is stored on the device.
 */
export function createLeaveReminderClient(input: Readonly<{ origin?: string; accessToken?: () => Promise<string> }> = {}): LeaveReminderClient {
  const request = async (init: RequestInit = {}) => {
    const token = input.accessToken ? await input.accessToken() : null;
    return readSetting(await fetch(`${input.origin ?? ""}/api/travel/leave-reminders`, { ...init, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }));
  };
  return {
    load: () => request(),
    save: (enabled) => request({ method: "PUT", body: JSON.stringify({ enabled }) }),
  };
}

export const webLeaveReminderClient: LeaveReminderClient = createLeaveReminderClient();

/** This browser's state, by the Notifications panel's rule: enabled needs permission and a saved subscription. */
export async function readWebDeviceNotifications(vapidPublicKey: string): Promise<LeaveReminderDeviceNotifications> {
  const inspection = await inspectBrowserNotificationState(vapidPublicKey);
  if (!inspection.support.supported || inspection.permission === "unavailable") return "unsupported";
  if (inspection.permission === "denied") return "blocked";
  return inspection.permission === "granted" && inspection.subscriptionStatus === "saved" ? "enabled" : "not_enabled";
}
