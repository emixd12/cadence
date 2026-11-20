import { checkOperationScope } from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { MoveCalendarBusy } from "@cadence/core/resolvers/move.resolver";
import { executeIntegrationWrite, type WriteOperationName } from "@/lib/services/integration-write.service";
import { executeOccurrenceMoveWrite, type MoveOperationName } from "@/lib/services/occurrence-move-integration.service";
export type { WriteOperationName, WriteOperationResult } from "@/lib/services/integration-write.service";

function handler<N extends WriteOperationName>(name: N) {
  return (context: IntegrationContext, input: unknown) => executeIntegrationWrite(
    name, context, input, checkOperationScope(name, context.actor.grantedScopes),
  );
}

function moveHandler<N extends MoveOperationName>(name: N) {
  return (context: IntegrationContext, input: unknown, options: Readonly<{ calendarBusy?: readonly MoveCalendarBusy[] }> = {}) => executeOccurrenceMoveWrite(
    name, context, input, checkOperationScope(name, context.actor.grantedScopes), options.calendarBusy,
  );
}

export const writeOperationHandlers = {
  set_occurrence_status: handler("set_occurrence_status"),
  update_occurrence_note: handler("update_occurrence_note"),
  move_occurrence_for_day: moveHandler("move_occurrence_for_day"),
  revert_occurrence_move: moveHandler("revert_occurrence_move"),
  update_day_note: handler("update_day_note"),
  create_behavior: handler("create_behavior"),
  update_behavior: handler("update_behavior"),
  archive_behavior: handler("archive_behavior"),
  restore_behavior: handler("restore_behavior"),
};
