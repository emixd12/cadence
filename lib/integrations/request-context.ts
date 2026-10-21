import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import type { Database } from "@/lib/db/database.types";
import {
  getSupabaseRuntimeConfig,
  type SupabaseRuntimeConfig,
} from "@/lib/supabase/env";
import {
  getIntegrationSigningKey,
  mintIntegrationAccessToken,
  type IntegrationSigningKey,
  type IntegrationTokenChannel,
} from "@/lib/supabase/integration-token";
import { fetchWithJwtIssuedAtFutureRetry } from "@/lib/supabase/server";

// Server-only. Builds the per-request context that integration operations use
// to call existing services as the grant's user. Database access goes through
// the publishable key plus a minted user token, so normal RLS applies. The
// service role is never used here.

export type IntegrationChannel = IntegrationTokenChannel;

// Scope names from the MCP plan. Ticket 221's contract is the source of truth
// for the full operation catalog; this list must stay equal to it.
export type IntegrationScope =
  | "cadence.read"
  | "cadence.occurrences.write"
  | "cadence.behaviors.write";

// A grant that the caller has already verified: the opaque access token was
// valid, the grant is active, and the token's resource matched. This module
// does not perform those checks.
export type VerifiedIntegrationGrant = {
  userId: string;
  grantId: string;
  clientId: string;
  clientLabel: string;
  channel: IntegrationChannel;
  scopes: readonly IntegrationScope[];
};

export type IntegrationActor = {
  channel: IntegrationChannel;
  clientId: string;
  grantId: string;
  clientLabel: string;
  grantedScopes: readonly IntegrationScope[];
};

export type IntegrationContext = {
  supabase: AppSupabaseClient;
  userId: string;
  now: Date;
  actor: IntegrationActor;
  tokenExpiresAt: Date;
};

export type CreateIntegrationContextOptions = {
  now: Date;
  signingKey?: IntegrationSigningKey;
  runtimeConfig?: SupabaseRuntimeConfig;
  fetch?: typeof fetch;
};

export function createIntegrationContext(
  grant: VerifiedIntegrationGrant,
  options: CreateIntegrationContextOptions,
): IntegrationContext {
  const signingKey = options.signingKey ?? getIntegrationSigningKey();
  const { url, publishableKey } =
    options.runtimeConfig ?? getSupabaseRuntimeConfig();
  const { token, expiresAt } = mintIntegrationAccessToken(signingKey, {
    userId: grant.userId,
    channel: grant.channel,
    grantId: grant.grantId,
    clientId: grant.clientId,
    now: options.now,
  });

  // `accessToken` makes supabase-js send this token on Data API, Storage, and
  // Realtime requests and disables `supabase.auth`, so the minted token cannot
  // reach the Supabase Auth user API through this client.
  const supabase = createSupabaseClient<Database>(url, publishableKey, {
    accessToken: async () => token,
    global: {
      fetch: options.fetch ?? fetchWithJwtIssuedAtFutureRetry,
    },
  });

  return {
    supabase,
    userId: grant.userId,
    now: options.now,
    actor: {
      channel: grant.channel,
      clientId: grant.clientId,
      grantId: grant.grantId,
      clientLabel: grant.clientLabel,
      grantedScopes: Object.freeze([...grant.scopes]),
    },
    tokenExpiresAt: expiresAt,
  };
}
