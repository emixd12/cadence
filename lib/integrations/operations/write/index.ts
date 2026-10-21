import { checkOperationScope } from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { executeIntegrationWrite, type WriteOperationName } from "@/lib/services/integration-write.service";
export type { WriteOperationName, WriteOperationResult } from "@/lib/services/integration-write.service";

function handler<N extends WriteOperationName>(name: N) {
  return (context: IntegrationContext, input: unknown) => executeIntegrationWrite(
    name, context, input, checkOperationScope(name, context.actor.grantedScopes),
  );
}

export const writeOperationHandlers = {
  set_occurrence_status: handler("set_occurrence_status"),
  update_occurrence_note: handler("update_occurrence_note"),
  create_behavior: handler("create_behavior"),
  update_behavior: handler("update_behavior"),
  archive_behavior: handler("archive_behavior"),
  restore_behavior: handler("restore_behavior"),
};
