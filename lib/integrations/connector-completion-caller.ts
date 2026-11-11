import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import type { ConnectorCaller } from "@/lib/services/connector-credentials";
import { getSupabaseRuntimeConfig, type SupabaseRuntimeConfig } from "@/lib/supabase/env";
import {
  getIntegrationSigningKey,
  mintConnectorCompletionAccessToken,
  type IntegrationSigningKey,
} from "@/lib/supabase/integration-token";
import { fetchWithJwtIssuedAtFutureRetry } from "@/lib/supabase/server";

// Server-only. Ticket 321 (D28.5), modeled on the leave reminder caller (Ticket 276).
// The connector completion job acts as one user with no session, on its own token
// channel. The client sends a minted token of 5 minutes or less with the publishable
// key, so every read and write goes through RLS as that user. The service role is
// never used here. The token stays inside the client: it is not returned, stored or
// logged.

export type CreateConnectorCompletionCallerOptions = {
  now: Date;
  ttlSeconds?: number;
  signingKey?: IntegrationSigningKey;
  runtimeConfig?: SupabaseRuntimeConfig;
  fetch?: typeof fetch;
};

export function createConnectorCompletionCaller(
  userId: string,
  options: CreateConnectorCompletionCallerOptions,
): ConnectorCaller {
  const signingKey = options.signingKey ?? getIntegrationSigningKey();
  const { url, publishableKey } = options.runtimeConfig ?? getSupabaseRuntimeConfig();
  const { token } = mintConnectorCompletionAccessToken(signingKey, {
    userId,
    now: options.now,
    ttlSeconds: options.ttlSeconds,
  });
  // `accessToken` sends the minted token on Data API requests and disables
  // `supabase.auth`, so the token cannot reach the Auth user API.
  const client = createSupabaseClient<Database>(url, publishableKey, {
    accessToken: async () => token,
    global: { fetch: options.fetch ?? fetchWithJwtIssuedAtFutureRetry },
  });
  // Hevy reads need only the user ID; no Google identity is read.
  return { client, user: { id: userId, identities: [] } } as ConnectorCaller;
}
