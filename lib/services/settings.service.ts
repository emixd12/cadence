import { Temporal } from "@js-temporal/polyfill";

import {
  listUserBehaviors,
} from "@/lib/db/behaviors.repo";
import { updateProfileAndActiveBehaviorTimezonesWithConfigurationEvents } from "@/lib/db/behaviorConfigurationEvents.repo";
import {
  getCurrentUserClaims,
  requireCurrentUserId,
} from "@/lib/auth/current-user";
import { syncUserOccurrencesAndReminders } from "@/lib/services/occurrence.service";
import { normalizeTimezoneInput, planProfileTimezoneChange, TimezoneSettingsUserError } from "@cadence/core/services/settings.service";
export { normalizeTimezoneInput, TimezoneSettingsUserError } from "@cadence/core/services/settings.service";
import {
  invalidateBehaviorData,
  invalidateProfileData,
  readCachedProfileSettings,
} from "@/lib/cache/stable-user-data.cache";
import { createClient } from "@/lib/supabase/server";
import { accountDeletionConfirmationText } from "@/lib/auth/account-sign-in-methods";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import type { TimezoneActionState } from "@/lib/types/settings";

export type SettingsPageData = {
  email: string;
  timezone: string;
  vapidPublicKey: string;
  deleteConfirmationLabel: string;
};

export type TimezoneUpdateResult = {
  timezone: string;
  activeBehaviorCount: number;
  changed: boolean;
};

export async function getSettingsPageData(): Promise<SettingsPageData> {
  const supabase = await createClient();
  const { userId, email: claimsEmail, error } = await getCurrentUserClaims();

  if (error || !userId) {
    throw new Error("Sign in again before opening settings.");
  }

  const profile = await readCachedProfileSettings(supabase, userId);
  const email = profile?.email ?? claimsEmail ?? "Signed in";

  return {
    email,
    timezone: profile?.timezone ?? DEFAULT_TIMEZONE,
    vapidPublicKey: normalizePublicVapidKey(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    ),
    deleteConfirmationLabel: accountDeletionConfirmationText(claimsEmail),
  };
}

export async function updateCurrentUserTimezoneFromFormData(
  formData: FormData,
): Promise<TimezoneUpdateResult> {
  const supabase = await createClient();
  const userId = await requireTimezoneUserId(
    "Sign in again before changing timezone.",
  );

  const timezone = normalizeTimezoneInput(formData.get("timezone"));
  const profile = await readCachedProfileSettings(supabase, userId);
  const currentTimezone = profile?.timezone ?? DEFAULT_TIMEZONE;
  const changed = currentTimezone !== timezone;
  const beforeBehaviors = (await listUserBehaviors(supabase, userId)).filter(
    (behavior) => behavior.active,
  );
  const effectiveAt = Temporal.Now.instant().toString();

  await updateProfileAndActiveBehaviorTimezonesWithConfigurationEvents(
    supabase,
    {
      timezone,
      expectedProfileTimezone: currentTimezone,
      behaviorChanges: planProfileTimezoneChange(beforeBehaviors, timezone, effectiveAt),
    },
  );

  invalidateProfileData(userId);
  invalidateBehaviorData(userId);
  // The final sync fence checks the complete Behavior set, including archives.
  const behaviors = await listUserBehaviors(supabase, userId);
  const now = Temporal.Instant.from(effectiveAt);

  await syncUserOccurrencesAndReminders(supabase, userId, {
    behaviors,
    now,
    timezone,
  });

  return {
    timezone,
    activeBehaviorCount: behaviors.filter((behavior) => behavior.active).length,
    changed,
  };
}

async function requireTimezoneUserId(message: string): Promise<string> {
  try {
    return await requireCurrentUserId(message);
  } catch {
    throw new TimezoneSettingsUserError(message);
  }
}

export function timezoneErrorToActionState(
  error: unknown,
): TimezoneActionState {
  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "Unable to save timezone.",
    timezone: null,
    activeBehaviorCount: 0,
  };
}

function normalizePublicVapidKey(value: string | undefined): string {
  return value?.trim() ?? "";
}
