export * from "@cadence/core/types/timeline";

import type {
  DefaultDurationActionState,
  OccurrenceActionState,
  OpportunityActionState,
  TimeTrackingActionState,
} from "@cadence/core/types/timeline";

export type OccurrenceFormAction = (
  previousState: OccurrenceActionState,
  formData: FormData,
) => Promise<OccurrenceActionState>;

export type TimeTrackingFormAction = (
  previousState: TimeTrackingActionState,
  formData: FormData,
) => Promise<TimeTrackingActionState>;

export type OpportunityFormAction = (
  previousState: OpportunityActionState,
  formData: FormData,
) => Promise<OpportunityActionState>;

export type DefaultDurationFormAction = (
  previousState: DefaultDurationActionState,
  formData: FormData,
) => Promise<DefaultDurationActionState>;
