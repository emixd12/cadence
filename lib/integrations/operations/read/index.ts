import {
  checkOperationScope, createIntegrationError, validateOperationInput, validateOperationOutput,
  type IntegrationError, type IntegrationOperationInput, type IntegrationOperationOutput,
} from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import {
  IntegrationReadError, getIntegrationAccountContext, listIntegrationBehaviors, getIntegrationBehavior,
  listIntegrationCategories, getIntegrationTimeline, listIntegrationOccurrences, getIntegrationOccurrence,
  getIntegrationAdherenceSummary, searchIntegrationRecords, fetchIntegrationRecord,
} from "@/lib/services/integration-read.service";

export type ReadOperationName = "get_account_context" | "list_behaviors" | "get_behavior" | "list_categories" |
  "get_timeline" | "list_occurrences" | "get_occurrence" | "get_adherence_summary" | "search" | "fetch";
export type ReadOperationResult<N extends ReadOperationName> =
  | { ok: true; value: IntegrationOperationOutput<N> }
  | { ok: false; error: IntegrationError };

function handler<N extends ReadOperationName>(name: N,
  read: (context: IntegrationContext, input: IntegrationOperationInput<N>) => Promise<IntegrationOperationOutput<N>>,
) {
  return async (context: IntegrationContext, input: unknown): Promise<ReadOperationResult<N>> => {
    const scopeError = checkOperationScope(name, context.actor.grantedScopes);
    if (scopeError) return { ok: false, error: scopeError };
    const validated = validateOperationInput(name, input);
    if (!validated.ok) return { ok: false, error: validated.error };
    try {
      const result = validateOperationOutput(name, await read(context, validated.value));
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    } catch (error) {
      if (error instanceof IntegrationReadError) return { ok: false, error: error.error };
      if (error instanceof Error && error.message.includes("absolute read ceiling")) {
        return { ok: false, error: createIntegrationError("limit_exceeded", "The read exceeds the account read limit. Narrow the request.") };
      }
      return { ok: false, error: createIntegrationError("internal_error", "Cadence could not read tracking data. Retry the request.") };
    }
  };
}

/** Transport-independent. The transport supplies a verified, RLS-scoped context. */
export const readOperationHandlers = {
  get_account_context: handler("get_account_context", getIntegrationAccountContext),
  list_behaviors: handler("list_behaviors", listIntegrationBehaviors),
  get_behavior: handler("get_behavior", getIntegrationBehavior),
  list_categories: handler("list_categories", listIntegrationCategories),
  get_timeline: handler("get_timeline", getIntegrationTimeline),
  list_occurrences: handler("list_occurrences", listIntegrationOccurrences),
  get_occurrence: handler("get_occurrence", getIntegrationOccurrence),
  get_adherence_summary: handler("get_adherence_summary", getIntegrationAdherenceSummary),
  search: handler("search", searchIntegrationRecords),
  fetch: handler("fetch", fetchIntegrationRecord),
};
