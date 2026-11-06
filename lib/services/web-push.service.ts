import * as webPush from "web-push";
import type { PushSubscription as WebPushSubscription } from "web-push";

import {
  PROVIDER_CALL_TIMEOUT_MS,
  runProviderCallWithTimeout,
} from "@/lib/services/provider-call-timeout";

export type BrowserPushReminderPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
  icon?: string;
  badge?: string;
  /** Ticket 278: alert again when this replaces a shown notification with the same tag. */
  renotify?: boolean;
};

export type BrowserPushReminderSendInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: BrowserPushReminderPayload;
};

/**
 * Behavior reminders use the defaults: a 24-hour lifetime at normal urgency. A leave reminder
 * (Ticket 278) passes its own lifetime, ending when the trip starts, at high urgency.
 */
export type BrowserPushSendOptions = {
  signal?: AbortSignal;
  ttlSeconds?: number;
  urgency?: "normal" | "high";
};

export type BrowserPushReminderSender = (
  input: BrowserPushReminderSendInput,
  options?: BrowserPushSendOptions,
) => Promise<void>;

const BEHAVIOR_REMINDER_TTL_SECONDS = 60 * 60 * 24;

export class BrowserPushConfigurationError extends Error {
  constructor() {
    super("Browser push sending is not configured.");
    this.name = "BrowserPushConfigurationError";
  }
}

export class BrowserPushSubscriptionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserPushSubscriptionExpiredError";
  }
}

export function createWebPushReminderSender(): BrowserPushReminderSender {
  const vapidDetails = readVapidDetails();

  return async function sendBrowserPushReminder(input, options) {
    try {
      await runProviderCallWithTimeout(
        () =>
          webPush.sendNotification(
            toWebPushSubscription(input),
            JSON.stringify(input.payload),
            {
              TTL: options?.ttlSeconds ?? BEHAVIOR_REMINDER_TTL_SECONDS,
              urgency: options?.urgency ?? "normal",
              timeout: PROVIDER_CALL_TIMEOUT_MS,
              vapidDetails,
            },
          ),
        {
          timeoutMs: PROVIDER_CALL_TIMEOUT_MS,
          signal: options?.signal,
        },
      );
    } catch (error) {
      if (isExpiredSubscriptionError(error)) {
        throw new BrowserPushSubscriptionExpiredError(
          errorToMessage(error, "Browser push subscription is no longer valid."),
        );
      }

      throw error;
    }
  };
}

function readVapidDetails() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

  if (!publicKey || !privateKey) {
    throw new BrowserPushConfigurationError();
  }

  return {
    subject: readVapidSubject(),
    publicKey,
    privateKey,
  };
}

function readVapidSubject(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!siteUrl) {
    return "mailto:notifications@cadence.local";
  }

  try {
    const url = new URL(siteUrl);

    if (url.protocol === "https:") {
      return url.origin;
    }
  } catch {
    // Fall through to a non-routable contact subject.
  }

  return "mailto:notifications@cadence.local";
}

function toWebPushSubscription(
  input: BrowserPushReminderSendInput,
): WebPushSubscription {
  return {
    endpoint: input.endpoint,
    keys: {
      p256dh: input.p256dh,
      auth: input.auth,
    },
  };
}

function isExpiredSubscriptionError(
  error: unknown,
): error is webPush.WebPushError {
  return (
    error instanceof webPush.WebPushError &&
    (error.statusCode === 404 || error.statusCode === 410)
  );
}

function errorToMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
