import {
  checkOperationScope, createIntegrationError, getIntegrationOperation,
  type IntegrationError, type IntegrationOperationName,
} from "@cadence/core/integration";
import { recordIntegrationActivity } from "@/lib/db/integration.repo";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { consumeMcpRateLimit } from "@/lib/services/oauth/server";
import { readOperationHandlers } from "./read";
import { writeOperationHandlers } from "./write";

const handlers = { ...readOperationHandlers, ...writeOperationHandlers };

export async function executeMcpOperation(name: IntegrationOperationName, context: IntegrationContext, input: unknown) {
  const operation = getIntegrationOperation(name);
  let error: IntegrationError | null = checkOperationScope(name, context.actor.grantedScopes);
  try {
    if (!error) {
      const admission = await consumeMcpRateLimit(context.actor.grantId, operation.access);
      if (!admission.allowed) error = createIntegrationError("rate_limited", "Too many requests. Retry after the indicated delay.", {
        retryAfterSeconds: admission.retryAfterSeconds,
      });
    }
    if (error) {
      await recordIntegrationActivity(context.supabase, { operation: name, targetIds: [],
        outcome: error.code === "insufficient_scope" ? "denied" : "rate_limited", errorCode: error.code });
      return { ok: false as const, error };
    }
    // Operations own output validation; writes also own transactional success and failure activity.
    const result = await handlers[name](context, input);
    if (operation.access === "read") {
      await recordIntegrationActivity(context.supabase, { operation: name, targetIds: [],
        outcome: result.ok ? "success" : result.error.code === "invalid_input" ? "invalid" : "error",
        errorCode: result.ok ? null : result.error.code });
    }
    return result;
  } catch {
    return { ok: false as const, error: createIntegrationError("service_unavailable", "Cadence could not finish this request. Retry with the same idempotency key.") };
  }
}
