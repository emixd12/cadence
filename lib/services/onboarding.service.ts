import { readTravelSetupPresence } from "@/lib/db/travelSettings.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import type {
  FirstRunOnboardingState,
  FirstRunTravelSetup,
} from "@/lib/types/onboarding";

export function createFirstRunOnboardingState(input: {
  hasAnyBehavior: boolean;
  hasImportRuns: boolean;
  timezone: string | null;
  travel: FirstRunTravelSetup | null;
}): FirstRunOnboardingState {
  return {
    hasAnyBehavior: input.hasAnyBehavior,
    hasImportRuns: input.hasImportRuns,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
    vapidPublicKey: normalizePublicVapidKey(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    ),
    travel: input.travel
      ? { hasHome: input.travel.hasHome, hasMode: input.travel.hasMode }
      : null,
  };
}

/**
 * Optional setup must not break Timeline: a failed or missing travel settings
 * read hides the Home and travel item instead of failing the page.
 */
export async function readFirstRunTravelSetup(
  client: AppSupabaseClient,
  userId: string,
): Promise<FirstRunTravelSetup | null> {
  try {
    return await readTravelSetupPresence(client, userId);
  } catch {
    return null;
  }
}

function normalizePublicVapidKey(value: string | undefined): string {
  return value?.trim() ?? "";
}
