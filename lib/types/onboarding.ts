import type {
  BrowserNotificationPermission,
  BrowserPushSubscriptionStatus,
} from "@/lib/push/browser";

/** Presence flags only; the saved Home text never enters onboarding state. */
export type FirstRunTravelSetup = {
  hasHome: boolean;
  hasMode: boolean;
};

export type FirstRunOnboardingState = {
  hasAnyBehavior: boolean;
  hasImportRuns: boolean;
  timezone: string;
  vapidPublicKey: string;
  /** Null when travel settings could not be read; the travel item stays hidden. */
  travel: FirstRunTravelSetup | null;
};

export type FirstRunOnboardingClientSnapshot = {
  dismissed: boolean;
  notificationPermission: BrowserNotificationPermission;
  notificationSupported: boolean | null;
  notificationSubscriptionStatus: BrowserPushSubscriptionStatus;
  browserTimezone: string | null;
  /** The deployment's travel routing report; null while unchecked or unreachable. */
  travelRoutingConfigured: boolean | null;
};

export type FirstRunOnboardingItemKey =
  | "behavior"
  | "notifications"
  | "timezone"
  | "import"
  | "travel";

export type FirstRunOnboardingItem = {
  key: FirstRunOnboardingItemKey;
  label: string;
  statusLabel: string;
  href: string;
  actionLabel: string;
  complete: boolean;
  optional: boolean;
  /** One line shown under an optional item. */
  description: string | null;
};

export type FirstRunOnboardingModel = {
  shouldRender: boolean;
  requiredComplete: boolean;
  items: FirstRunOnboardingItem[];
};
