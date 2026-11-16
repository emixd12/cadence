import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { ensureAgentGrant } from "@/lib/db/agent-runs.repo";
import type { Database } from "@/lib/db/database.types";
import type { IntegrationContext, IntegrationScope } from "@/lib/integrations/request-context";
import { getSupabaseRuntimeConfig, type SupabaseRuntimeConfig } from "@/lib/supabase/env";
import {
  getIntegrationSigningKey,
  mintAgentAccessToken,
  readIntegrationSigningKey,
  type AgentTokenChannel,
  type IntegrationSigningKey,
} from "@/lib/supabase/integration-token";
import { fetchWithJwtIssuedAtFutureRetry } from "@/lib/supabase/server";

// Server-only. Advisor plan Phase 1A: the first-party caller.
//
// Cadence's own agents call the integration operation layer
// (lib/integrations/operations/execute.ts) as the signed-in person. Each agent
// has its own token channel. The database resolves the agent's first-party
// grant from that channel (migration 20261116200000), which gives the agent
// its own scopes, idempotency namespace, activity label and rate limit. The
// same client also writes the agent's run log and spend budget.
//
// Like the leave reminder caller, the token goes only into this client: it is
// never returned, stored or logged. The client re-mints a short token when the
// current one is near expiry, so a long chat turn keeps working. The service
// role is never used here.

export type AgentChannel = AgentTokenChannel;

export type CreateAgentContextOptions = {
  now?: () => Date;
  signingKey?: IntegrationSigningKey;
  runtimeConfig?: SupabaseRuntimeConfig;
  fetch?: typeof fetch;
};

const REFRESH_MARGIN_MS = 30_000;
const KNOWN_SCOPES: readonly IntegrationScope[] = ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"];

/**
 * True when this deployment can mint agent tokens, false when no key is set.
 * Throws when a key is set but invalid: callers must fail closed, because an
 * agent without a token cannot check its spend budget.
 */
export function agentCallerConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readIntegrationSigningKey(env) !== null;
}

/** A Supabase client that acts as `userId` through `agent`'s channel. */
export function createAgentClient(userId: string, agent: AgentChannel, options: CreateAgentContextOptions = {}) {
  const signingKey = options.signingKey ?? getIntegrationSigningKey();
  const { url, publishableKey } = options.runtimeConfig ?? getSupabaseRuntimeConfig();
  const clock = options.now ?? (() => new Date());
  let current = mintAgentAccessToken(signingKey, { userId, agent, now: clock() });
  const client = createSupabaseClient<Database>(url, publishableKey, {
    accessToken: async () => {
      if (current.expiresAt.getTime() - clock().getTime() < REFRESH_MARGIN_MS) {
        current = mintAgentAccessToken(signingKey, { userId, agent, now: clock() });
      }
      return current.token;
    },
    global: { fetch: options.fetch ?? fetchWithJwtIssuedAtFutureRetry },
  });
  return { client, tokenExpiresAt: () => current.expiresAt };
}

/**
 * Builds the operation context for one agent acting as one person. The grant,
 * label and scopes come from the database, so an agent's scopes change there
 * without a deploy.
 */
export async function createAgentContext(
  userId: string,
  agent: AgentChannel,
  options: CreateAgentContextOptions = {},
): Promise<IntegrationContext> {
  const clock = options.now ?? (() => new Date());
  const { client, tokenExpiresAt } = createAgentClient(userId, agent, options);
  const grant = await ensureAgentGrant(client);
  const scopes = grant.scopes.filter((scope): scope is IntegrationScope => (KNOWN_SCOPES as readonly string[]).includes(scope));
  return {
    supabase: client,
    userId,
    now: clock(),
    actor: {
      channel: agent,
      clientId: grant.clientId,
      grantId: grant.grantId,
      clientLabel: grant.clientLabel,
      grantedScopes: Object.freeze(scopes),
    },
    tokenExpiresAt: tokenExpiresAt(),
  };
}
