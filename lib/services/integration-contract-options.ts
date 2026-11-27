import type { IntegrationContractOptions } from "@cadence/core/integration";
import { alongsideEnabled } from "@/lib/services/alongside-flag";

/**
 * The contract edition the hosted app serves (Ticket 364). With `CADENCE_ALONGSIDE`
 * off this is the published 1.8.0 contract and nothing reads `behaviors.alongside`;
 * with it on, contract 1.9.0 carries the person's alongside setting.
 */
export function integrationContractOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): IntegrationContractOptions {
  return alongsideEnabled(env) ? { alongside: true } : {};
}
