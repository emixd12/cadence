import type { TravelMode } from "@cadence/core/types/travel";

import type { LeaveReminderCaller } from "@/lib/integrations/leave-reminder-caller";
import { createLeaveReminderWebPushDelivery } from "@/lib/services/leave-reminder-web-push";
import { BrowserPushConfigurationError, createWebPushReminderSender } from "@/lib/services/web-push.service";

/**
 * Ticket 277 defines this contract; Ticket 278 delivers it through web push
 * (`lib/services/leave-reminder-web-push.ts`).
 * `docs/NOTIFICATION_SPEC.md`, "Leave reminders", "Send payload", documents it.
 *
 * The message lives in memory for one send. The titles are read from Calendar or the
 * Behavior at send time and must never be stored, logged or put in a link: the link
 * carries `tripDigest` only. Leave reminder records never hold any of these fields
 * except the digest and the local date.
 */
export type LeaveReminderMessage = Readonly<{
  /** `reminder` is the first notification; `update` is the one update (decision D15). */
  kind: "reminder" | "update";
  /** The record's trip digest: hex SHA-256 of the destination's event reference and start. */
  tripDigest: string;
  /** The trip's local date, `YYYY-MM-DD`. */
  localDate: string;
  /** ISO instants. `leaveAt` is the leave time the text names; for an update, the new one. */
  leaveAt: string;
  arriveAt: string;
  /** The destination's start. */
  startAt: string;
  /** The notification is useless once the trip has started: expire it at the leave time. */
  expiresAt: string;
  mode: TravelMode;
  /** Route time, whole minutes, for "Walking, 65 min from Home." */
  travelMinutes: number;
  /** Where the estimate starts (decision D3). The web job never starts from a device position. */
  origin: Readonly<{ kind: "home" }> | Readonly<{ kind: "previous_stop"; title: string }>;
  /** The destination's title, read at send time. In memory only. */
  title: string;
}>;

export type LeaveReminderDeliveryResult =
  | Readonly<{ status: "sent" }>
  | Readonly<{ status: "failed"; error: "no_subscription" | "delivery_failed" }>;

/** Sends one message to the account's active push subscriptions, as the user. */
export type LeaveReminderDelivery = (
  caller: LeaveReminderCaller,
  message: LeaveReminderMessage,
) => Promise<LeaveReminderDeliveryResult>;

/**
 * The hosted delivery: web push (Ticket 278). Null when browser push sending is not
 * configured; the job route then reports `delivery_unavailable` and visits no account.
 */
export function createLeaveReminderDelivery(): LeaveReminderDelivery | null {
  let sendBrowserPush;
  try {
    sendBrowserPush = createWebPushReminderSender();
  } catch (error) {
    if (error instanceof BrowserPushConfigurationError) return null;
    throw error;
  }
  return createLeaveReminderWebPushDelivery({ sendBrowserPush, siteUrl: process.env.NEXT_PUBLIC_SITE_URL });
}
