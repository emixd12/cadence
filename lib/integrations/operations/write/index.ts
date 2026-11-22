import { checkOperationScope } from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import type { MoveCalendarBusy } from "@cadence/core/resolvers/move.resolver";
import { executeIntegrationWrite, type WriteOperationName } from "@/lib/services/integration-write.service";
import { executeOccurrenceMoveWrite, type MoveOperationName } from "@/lib/services/occurrence-move-integration.service";
import { executeOpportunityWrite, type OpportunityOperationName } from "@/lib/services/opportunity-integration.service";
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

function opportunityHandler<N extends OpportunityOperationName>(name: N) {
  return (context: IntegrationContext, input: unknown, options: Readonly<{ calendarBusy?: readonly MoveCalendarBusy[] }> = {}) => executeOpportunityWrite(
    name, context, input, checkOperationScope(name, context.actor.grantedScopes), options,
  );
}

export const writeOperationHandlers = {
  set_occurrence_status: handler("set_occurrence_status"),
  set_parent_occurrence_status: handler("set_parent_occurrence_status"),
  update_occurrence_note: handler("update_occurrence_note"),
  move_occurrence_for_day: moveHandler("move_occurrence_for_day"),
  revert_occurrence_move: moveHandler("revert_occurrence_move"),
  update_day_note: handler("update_day_note"),
  add_opportunity_occurrence: opportunityHandler("add_opportunity_occurrence"),
  remove_opportunity_occurrence: opportunityHandler("remove_opportunity_occurrence"),
  create_behavior: handler("create_behavior"),
  update_behavior: handler("update_behavior"),
  archive_behavior: handler("archive_behavior"),
  restore_behavior: handler("restore_behavior"),
  end_behavior: handler("end_behavior"),
  pause_behavior: handler("pause_behavior"),
  resume_behavior: handler("resume_behavior"),
};
