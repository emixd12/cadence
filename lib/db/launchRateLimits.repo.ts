import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";

export type LaunchRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
};

export async function consumeExportDownloadRateLimit(
  supabase: AppSupabaseClient,
): Promise<LaunchRateLimitResult> {
  return consumeLaunchRateLimit(supabase, "export_download");
}

export async function consumePushSubscriptionRegistrationRateLimit(
  supabase: AppSupabaseClient,
): Promise<LaunchRateLimitResult> {
  return consumeLaunchRateLimit(supabase, "push_subscription_registration");
}

/** Ticket 308: Home lookups from the current location, five per account per hour. */
export async function consumeTravelHomeLookupRateLimit(
  supabase: AppSupabaseClient,
): Promise<LaunchRateLimitResult> {
  return consumeLaunchRateLimit(supabase, "travel_home_lookup");
}

async function consumeLaunchRateLimit(
  supabase: AppSupabaseClient,
  action: "export_download" | "push_subscription_registration" | "travel_home_lookup",
): Promise<LaunchRateLimitResult> {
  const { data, error } = await supabase.rpc("consume_launch_rate_limit", {
    p_action: action,
  });

  if (error) {
    throw error;
  }

  const row = data?.[0];

  if (
    !row ||
    typeof row.allowed !== "boolean" ||
    !Number.isInteger(row.limit_count) ||
    !Number.isInteger(row.remaining) ||
    typeof row.reset_at !== "string" ||
    !Number.isInteger(row.retry_after_seconds)
  ) {
    throw new Error("Launch rate limit did not return a decision.");
  }

  return {
    allowed: row.allowed,
    limit: row.limit_count,
    remaining: row.remaining,
    resetAt: row.reset_at,
    retryAfterSeconds: Math.max(1, row.retry_after_seconds),
  };
}
