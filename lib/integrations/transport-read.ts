/**
 * Admission and activity for a read that an MCP transport serves outside the contract
 * registry (Ticket 376: `show_day` and the view resources). Registry tools go through
 * `executeMcpOperation` (`operations/execute.ts`); these reads cannot, because they have
 * no registry entry. They follow the same rules here: scope check, then the per-grant
 * read limit, then one activity row per call. A failed limit or activity write refuses
 * the read; nothing here fails open.
 */
import { createIntegrationError, insufficientScopeError, INTEGRATION_SCOPES, type IntegrationError } from "@cadence/core/integration";
import { recordIntegrationActivity } from "@/lib/db/integration.repo";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { consumeMcpRateLimit } from "@/lib/services/oauth/server";

const unavailable = () => createIntegrationError("service_unavailable", "Cadence could not finish this request. Retry the request.");

/**
 * Scope, then the per-grant read limit. Returns the refusal, or null when the read may
 * run. A refusal is recorded as `denied` or `rate_limited`, as registry tools record it.
 * `label` is the activity operation; it must match the activity table's
 * `^[a-z][a-z0-9_]{0,63}$`.
 */
export async function admitTransportRead(context: IntegrationContext, label: string): Promise<IntegrationError | null> {
  try {
    let error: IntegrationError | null = context.actor.grantedScopes.includes(INTEGRATION_SCOPES.read)
      ? null : insufficientScopeError(INTEGRATION_SCOPES.read, label);
    if (!error) {
      const admission = await consumeMcpRateLimit(context.actor.grantId, "read");
      if (!admission.allowed) error = createIntegrationError("rate_limited", "Too many requests. Retry after the indicated delay.", {
        retryAfterSeconds: admission.retryAfterSeconds,
      });
    }
    if (error) {
      await recordIntegrationActivity(context.supabase, { operation: label, targetIds: [],
        outcome: error.code === "insufficient_scope" ? "denied" : "rate_limited", errorCode: error.code });
    }
    return error;
  } catch {
    return unavailable();
  }
}

/**
 * Records the outcome of an admitted read. Returns an error when the row cannot be
 * written: the caller then returns that error and no data, as registry reads do.
 */
export async function recordTransportRead(context: IntegrationContext, label: string, error: IntegrationError | null): Promise<IntegrationError | null> {
  try {
    await recordIntegrationActivity(context.supabase, { operation: label, targetIds: [],
      outcome: !error ? "success" : error.code === "invalid_input" || error.code === "not_found" ? "invalid" : "error",
      errorCode: error?.code ?? null });
    return null;
  } catch {
    return unavailable();
  }
}
