export * from "@cadence/core/types/period";

import type { PeriodActionState } from "@cadence/core/types/period";

export type PeriodFormAction = (
  previousState: PeriodActionState,
  formData: FormData,
) => Promise<PeriodActionState>;

/**
 * The three Period writes a screen may offer (Ticket 369). Web passes Server Actions;
 * Cadence for Mac will pass its local actions (Ticket 374). FormData:
 * - `save`: `label`, `start_on`, `end_on` (empty means ongoing) and `note`; an edit
 *   adds `period_id` and `expected_revision`.
 * - `end` ("End today") and `remove`: `period_id` and `expected_revision`.
 */
export type PeriodActions = Readonly<{
  save: PeriodFormAction;
  end: PeriodFormAction;
  remove: PeriodFormAction;
}>;
