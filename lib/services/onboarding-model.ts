import type {
  FirstRunOnboardingClientSnapshot,
  FirstRunOnboardingItem,
  FirstRunOnboardingModel,
  FirstRunOnboardingState,
} from "@/lib/types/onboarding";

export const FIRST_RUN_IMPORT_DESCRIPTION =
  "Use this only if you already have a BehaviorLog bundle.";
export const FIRST_RUN_TRAVEL_DESCRIPTION =
  "Cadence uses these to estimate travel time to and from located Behaviors and Calendar events.";

export function resolveFirstRunOnboardingModel(
  state: FirstRunOnboardingState,
  client: FirstRunOnboardingClientSnapshot,
): FirstRunOnboardingModel {
  const items: FirstRunOnboardingItem[] = [
    {
      key: "behavior",
      label: "Create first behavior",
      statusLabel: state.hasAnyBehavior ? "Done" : "Start here",
      href: "/behaviors#create-behavior",
      actionLabel: state.hasAnyBehavior ? "Open behaviors" : "Create behavior",
      complete: state.hasAnyBehavior,
      optional: false,
      description: null,
    },
    {
      key: "notifications",
      label: "Browser notifications",
      statusLabel: notificationStatusLabel(client),
      href: "/settings#notifications",
      actionLabel: "Open settings",
      complete: notificationComplete(client),
      optional: false,
      description: null,
    },
    {
      key: "timezone",
      label: "Timezone",
      statusLabel: timezoneStatusLabel(state.timezone, client.browserTimezone),
      href: "/settings#timezone",
      actionLabel: "Review timezone",
      complete: timezoneComplete(state.timezone, client.browserTimezone),
      optional: false,
      description: null,
    },
    {
      key: "import",
      label: "Import existing records",
      statusLabel: state.hasImportRuns ? "Started" : "Optional",
      href: "/export#behaviorlog-import",
      actionLabel: "Open import",
      complete: state.hasImportRuns,
      optional: true,
      description: FIRST_RUN_IMPORT_DESCRIPTION,
    },
  ];
  // Ticket 212: ask for Home and usual travel only where routing can use them.
  if (state.travel && client.travelRoutingConfigured === true) {
    const complete = state.travel.hasHome && state.travel.hasMode;
    items.push({
      key: "travel",
      label: "Home and travel",
      statusLabel: complete ? "Saved" : "Optional",
      href: "/settings#travel",
      actionLabel: "Open travel",
      complete,
      optional: true,
      description: FIRST_RUN_TRAVEL_DESCRIPTION,
    });
  }
  const requiredComplete = items
    .filter((item) => !item.optional)
    .every((item) => item.complete);

  return {
    shouldRender: !client.dismissed && !requiredComplete,
    requiredComplete,
    items,
  };
}

function notificationComplete(
  client: FirstRunOnboardingClientSnapshot,
): boolean {
  if (client.notificationSupported === false) {
    return true;
  }

  if (client.notificationPermission === "denied") {
    return true;
  }

  if (client.notificationPermission !== "granted") {
    return false;
  }

  return client.notificationSubscriptionStatus === "saved";
}

function notificationStatusLabel(
  client: FirstRunOnboardingClientSnapshot,
): string {
  if (client.notificationSupported === null) {
    return "Checking";
  }

  if (client.notificationSupported === false) {
    return "Unavailable";
  }

  switch (client.notificationPermission) {
    case "granted":
      return client.notificationSubscriptionStatus === "saved"
        ? "Enabled"
        : "Not enabled";
    case "denied":
      return "Blocked";
    case "default":
      return "Not enabled";
    case "unavailable":
      return "Unavailable";
  }
}

function timezoneComplete(
  savedTimezone: string,
  browserTimezone: string | null,
): boolean {
  return browserTimezone === null || browserTimezone === savedTimezone;
}

function timezoneStatusLabel(
  savedTimezone: string,
  browserTimezone: string | null,
): string {
  if (browserTimezone === null) {
    return "Saved";
  }

  return browserTimezone === savedTimezone ? "Confirmed" : "Review";
}
