import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import type { FirstRunOnboardingState } from "@/lib/types/onboarding";

export function createFirstRunOnboardingState(input: {
  hasAnyBehavior: boolean;
  hasImportRuns: boolean;
  timezone: string | null;
}): FirstRunOnboardingState {
  return {
    hasAnyBehavior: input.hasAnyBehavior,
    hasImportRuns: input.hasImportRuns,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
    vapidPublicKey: normalizePublicVapidKey(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    ),
  };
}

function normalizePublicVapidKey(value: string | undefined): string {
  return value?.trim() ?? "";
}
