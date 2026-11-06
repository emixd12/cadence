import { Temporal } from "@js-temporal/polyfill";
import { departurePhraseContext, webLeaveReminderPhrases } from "@cadence/core/services/departure-phrases";

import { getProfileTimezone } from "@/lib/db/behaviors.repo";
import {
  deactivatePushSubscriptionById,
  listActivePushSubscriptionsForUser,
} from "@/lib/db/pushSubscriptions.repo";
import type { LeaveReminderCaller } from "@/lib/integrations/leave-reminder-caller";
import type {
  LeaveReminderDelivery,
  LeaveReminderDeliveryResult,
  LeaveReminderMessage,
} from "@/lib/services/leave-reminder-delivery";
import { runProviderCallWithTimeout } from "@/lib/services/provider-call-timeout";
import {
  BrowserPushSubscriptionExpiredError,
  type BrowserPushReminderPayload,
  type BrowserPushReminderSender,
} from "@/lib/services/web-push.service";
import { leaveReminderTimelineUrl } from "@/lib/ui/leave-reminder-link";

/**
 * Ticket 278: leave reminders through web push. The message is read in memory for one send;
 * nothing here stores, logs or puts a title in the link. Behavior reminders keep their own path
 * in `reminder.service.ts`, with its 24-hour lifetime at normal urgency.
 */

const DEFAULT_TIMEZONE = "America/New_York";
/** The same caps as Behavior reminders: at most 20 subscriptions, four sends at a time. */
const MAX_SUBSCRIPTIONS = 20;
const SEND_CONCURRENCY = 4;

export type LeaveReminderWebPushOptions = Readonly<{
  sendBrowserPush: BrowserPushReminderSender;
  /** Injected for tests; defaults to the system clock. */
  now?: () => Date;
  siteUrl?: string;
  providerTimeoutMs?: number;
}>;

/** The notification for one message, in the account's timezone. */
export function leaveReminderPushPayload(
  message: LeaveReminderMessage,
  timezone: string,
  siteUrl: string | undefined,
): BrowserPushReminderPayload {
  // Times on the trip's own date show without a date.
  const context = departurePhraseContext(message.leaveAt, timezone);
  const { title, body } = webLeaveReminderPhrases({
    update: message.kind === "update",
    destinationLabel: message.title,
    leaveAt: message.leaveAt,
    arriveAt: message.arriveAt,
    travelMinutes: message.travelMinutes,
    mode: message.mode,
    start: message.origin,
  }, context);
  return {
    title,
    body,
    // One tag per trip, so the update replaces the first notification and its older leave time.
    tag: `cadence-leave-${message.tripDigest}`,
    url: leaveReminderTimelineUrl(message.tripDigest, siteUrl),
    icon: "/icons/cadence-notification-icon.png",
    badge: "/icons/cadence-notification-badge.png",
    ...(message.kind === "update" ? { renotify: true } : {}),
  };
}

/** Whole seconds until the trip starts, when the notification stops being useful. */
export function leaveReminderTtlSeconds(expiresAt: string, now: Date): number {
  const remaining = Temporal.Instant.from(expiresAt).epochMilliseconds - now.getTime();
  return Math.floor(remaining / 1000);
}

export function createLeaveReminderWebPushDelivery(options: LeaveReminderWebPushOptions): LeaveReminderDelivery {
  const clock = options.now ?? (() => new Date());

  return async function deliverLeaveReminder(
    caller: LeaveReminderCaller,
    message: LeaveReminderMessage,
  ): Promise<LeaveReminderDeliveryResult> {
    const ttlSeconds = leaveReminderTtlSeconds(message.expiresAt, clock());
    // The trip has started: a late notification would only mislead.
    if (ttlSeconds <= 0) return { status: "failed", error: "delivery_failed" };

    const [subscriptions, timezone] = await Promise.all([
      listActivePushSubscriptionsForUser(caller.client, caller.userId),
      getProfileTimezone(caller.client, caller.userId),
    ]);
    if (subscriptions.length === 0) return { status: "failed", error: "no_subscription" };

    const payload = leaveReminderPushPayload(message, timezone ?? DEFAULT_TIMEZONE, options.siteUrl);
    const queue = subscriptions.slice(0, MAX_SUBSCRIPTIONS);
    let next = 0;
    let sent = 0;

    async function sendNext(): Promise<void> {
      while (next < queue.length) {
        const subscription = queue[next];
        next += 1;
        if (!subscription) return;
        try {
          await runProviderCallWithTimeout(
            (signal) => options.sendBrowserPush(
              { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth, payload },
              { signal, ttlSeconds, urgency: "high" },
            ),
            { timeoutMs: options.providerTimeoutMs },
          );
          sent += 1;
        } catch (error) {
          if (error instanceof BrowserPushSubscriptionExpiredError) {
            // A failed cleanup must not hide a send that worked on another device.
            await deactivatePushSubscriptionById(caller.client, { userId: caller.userId, subscriptionId: subscription.id }).catch(() => undefined);
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, queue.length) }, () => sendNext()));
    return sent > 0 ? { status: "sent" } : { status: "failed", error: "delivery_failed" };
  };
}
