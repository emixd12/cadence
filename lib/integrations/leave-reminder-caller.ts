import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Database } from "@/lib/db/database.types";
import type { CalendarReadCaller } from "@/lib/services/google-calendar.service";
import {
  getSupabaseRuntimeConfig,
  type SupabaseRuntimeConfig,
} from "@/lib/supabase/env";
import {
  getIntegrationSigningKey,
  mintLeaveReminderAccessToken,
  type IntegrationSigningKey,
} from "@/lib/supabase/integration-token";
import { fetchWithJwtIssuedAtFutureRetry } from "@/lib/supabase/server";

// Server-only. Ticket 276, decision D3. The leave reminder job acts as one
// user with no session. It uses its own token channel, never an MCP grant.
// The client sends a minted token of 5 minutes or less with the publishable
// key, so every read and write goes through RLS as that user, and
// `reserve_travel_provider_spend` sees that user's `auth.uid()`. The service
// role is never used here. The token stays inside the client: it is not
// returned, stored or logged.

export type LeaveReminderCaller = Readonly<{
  client: AppSupabaseClient;
  userId: string;
  tokenExpiresAt: Date;
}>;

export type CreateLeaveReminderCallerOptions = {
  now: Date;
  ttlSeconds?: number;
  signingKey?: IntegrationSigningKey;
  runtimeConfig?: SupabaseRuntimeConfig;
  fetch?: typeof fetch;
};

export class LeaveReminderCallerError extends Error {
  constructor(public readonly code: "google_identity_unavailable") {
    super(code);
    this.name = "LeaveReminderCallerError";
  }
}

export function createLeaveReminderCaller(
  userId: string,
  options: CreateLeaveReminderCallerOptions,
): LeaveReminderCaller {
  const signingKey = options.signingKey ?? getIntegrationSigningKey();
  const { url, publishableKey } =
    options.runtimeConfig ?? getSupabaseRuntimeConfig();
  const { token, expiresAt } = mintLeaveReminderAccessToken(signingKey, {
    userId,
    now: options.now,
    ttlSeconds: options.ttlSeconds,
  });

  // `accessToken` sends the minted token on Data API requests and disables
  // `supabase.auth`, so the token cannot reach the Auth user API.
  const client = createSupabaseClient<Database>(url, publishableKey, {
    accessToken: async () => token,
    global: {
      fetch: options.fetch ?? fetchWithJwtIssuedAtFutureRetry,
    },
  });

  return { client, userId, tokenExpiresAt: expiresAt };
}

// The Calendar service checks that the connection belongs to the user's one
// Google identity. A minted client has no Auth user, so this reads only that
// identity's provider id, for this user, through a function that refuses
// every other token channel.
export async function leaveReminderCalendarCaller(
  caller: LeaveReminderCaller,
): Promise<CalendarReadCaller> {
  const { data, error } = await caller.client.rpc("leave_reminder_google_subject");

  if (error || typeof data !== "string" || data.length === 0) {
    throw new LeaveReminderCallerError("google_identity_unavailable");
  }

  return {
    client: caller.client,
    user: {
      id: caller.userId,
      identities: [{ provider: "google", provider_id: data }],
    },
  };
}
