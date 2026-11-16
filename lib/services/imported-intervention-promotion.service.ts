import { Temporal } from "@js-temporal/polyfill";
import { effectiveStartAt } from "@cadence/core/resolvers/time.resolver";

import { getBehaviorById } from "@/lib/db/behaviors.repo";
import type { AppSupabaseClient } from "@/lib/db/behaviors.repo";
import { listImportedInterventionsByIds } from "@/lib/db/importedInterventions.repo";
import { getOccurrenceById } from "@/lib/db/occurrences.repo";
import {
  attachImportProvenanceToPendingReminderDelivery,
  createMissingReminderDeliveries,
  listReminderDeliveriesByOccurrenceIds,
} from "@/lib/db/reminderDeliveries.repo";
import {
  resolveImportedInterventionPromotion,
  type ExistingReminderDeliveryForPromotion,
  type ImportedInterventionPromotionBehavior,
  type ImportedInterventionPromotionCandidate,
  type ImportedInterventionPromotionOccurrence,
  type ImportedInterventionPromotionPlan,
  type ImportedInterventionPromotionRecord,
  type ImportedInterventionPromotionResult,
} from "@/lib/resolvers/imported-intervention-promotion.resolver";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import type {
  Behavior,
  ImportedIntervention,
  NewReminderDelivery,
  Occurrence,
  OccurrenceStatus,
  ReminderDelivery,
} from "@/lib/types/database";

export type PromoteImportedInterventionsOptions = {
  selectedImportedInterventionIds: string[];
  confirmPromotion: boolean;
  now?: Temporal.Instant;
  supabase?: AppSupabaseClient;
  userId?: string;
};

export type PromoteImportedInterventionsResult =
  ImportedInterventionPromotionResult & {
    promotedCount: number;
    ineligibleCount: number;
  };

export class ImportedInterventionPromotionAuthError extends Error {
  constructor(message = "Sign in again before promoting imported reminders.") {
    super(message);
    this.name = "ImportedInterventionPromotionAuthError";
  }
}

export async function promoteImportedInterventionsToReminderDeliveries(
  options: PromoteImportedInterventionsOptions,
): Promise<PromoteImportedInterventionsResult> {
  const supabase = options.supabase ?? (await createClient());
  const userId = options.userId ?? (await requireUserId(supabase));
  const selectedIds = normalizeSelectedIds(options.selectedImportedInterventionIds);
  const now = options.now ?? Temporal.Now.instant();

  if (selectedIds.length === 0) {
    return withCounts(
      resolveImportedInterventionPromotion({
        now,
        selectedImportedInterventionIds: selectedIds,
        confirmPromotion: options.confirmPromotion,
        candidates: [],
        existingReminderDeliveries: [],
      }),
    );
  }

  const importedInterventions = await listImportedInterventionsByIds(supabase, {
    userId,
    ids: selectedIds,
  });
  const candidates = await buildPromotionCandidates(supabase, {
    userId,
    importedInterventions,
  });
  const occurrenceIds = Array.from(
    new Set(
      importedInterventions
        .map((intervention) => intervention.occurrence_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const existingReminderDeliveries = await listReminderDeliveriesByOccurrenceIds(
    supabase,
    userId,
    occurrenceIds,
  );
  const resolution = resolveImportedInterventionPromotion({
    now,
    selectedImportedInterventionIds: selectedIds,
    confirmPromotion: options.confirmPromotion,
    candidates,
    existingReminderDeliveries: existingReminderDeliveries.map(
      toExistingReminderDeliveryForPromotion,
    ),
  });

  if (resolution.deliveryPlans.length === 0) {
    return withCounts(resolution);
  }

  await createMissingReminderDeliveries(
    supabase,
    resolution.deliveryPlans.map(toNewReminderDelivery),
  );

  for (const plan of resolution.deliveryPlans) {
    await attachImportProvenanceToPendingReminderDelivery(supabase, {
      userId: plan.userId,
      occurrenceId: plan.occurrenceId,
      channel: plan.channel,
      scheduledSendAt: plan.scheduledSendAt,
      importRunId: plan.importRunId,
      importedInterventionId: plan.importedInterventionId,
    });
  }

  return withCounts(resolution);
}

async function buildPromotionCandidates(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    importedInterventions: ImportedIntervention[];
  },
): Promise<ImportedInterventionPromotionCandidate[]> {
  return Promise.all(
    input.importedInterventions.map(async (importedIntervention) => {
      const [behavior, occurrence] = await Promise.all([
        importedIntervention.behavior_id
          ? getBehaviorById(supabase, input.userId, importedIntervention.behavior_id)
          : Promise.resolve(null),
        importedIntervention.occurrence_id
          ? getOccurrenceById(
              supabase,
              input.userId,
              importedIntervention.occurrence_id,
            )
          : Promise.resolve(null),
      ]);

      return {
        importedIntervention: toPromotionRecord(importedIntervention),
        behavior: behavior ? toPromotionBehavior(behavior) : null,
        occurrence: occurrence ? toPromotionOccurrence(occurrence) : null,
      };
    }),
  );
}

function toPromotionRecord(
  intervention: ImportedIntervention,
): ImportedInterventionPromotionRecord {
  return {
    id: intervention.id,
    userId: intervention.user_id,
    importRunId: intervention.import_run_id,
    behaviorId: intervention.behavior_id,
    occurrenceId: intervention.occurrence_id,
    interventionType: intervention.intervention_type,
    channel: intervention.channel,
    deliveryStatus: intervention.delivery_status,
    scheduledSendAt: intervention.scheduled_send_at,
    sourceConfidence: intervention.source_confidence,
  };
}

function toPromotionBehavior(
  behavior: Behavior,
): ImportedInterventionPromotionBehavior {
  return {
    id: behavior.id,
    userId: behavior.user_id,
    active: behavior.active,
    browserReminderEnabled: behavior.browser_reminder_enabled,
    emailReminderEnabled: behavior.email_reminder_enabled,
    reminderOffsetMinutes: behavior.reminder_offset_minutes,
  };
}

function toPromotionOccurrence(
  occurrence: Occurrence,
): ImportedInterventionPromotionOccurrence {
  return {
    id: occurrence.id,
    userId: occurrence.user_id,
    behaviorId: occurrence.behavior_id,
    scheduledFor: effectiveStartAt(occurrence),
    status: normalizeOccurrenceStatus(occurrence.status),
  };
}

function toExistingReminderDeliveryForPromotion(
  delivery: ReminderDelivery,
): ExistingReminderDeliveryForPromotion {
  return {
    id: delivery.id,
    userId: delivery.user_id,
    occurrenceId: delivery.occurrence_id,
    channel: delivery.channel,
    scheduledSendAt: delivery.scheduled_send_at,
    status: delivery.status,
    processingStartedAt: delivery.processing_started_at,
    importedInterventionId: delivery.imported_intervention_id,
  };
}

function toNewReminderDelivery(
  plan: ImportedInterventionPromotionPlan,
): NewReminderDelivery {
  return {
    user_id: plan.userId,
    occurrence_id: plan.occurrenceId,
    channel: plan.channel,
    scheduled_send_at: plan.scheduledSendAt,
    sent_at: null,
    processing_started_at: null,
    status: plan.status,
    error: null,
    import_run_id: plan.importRunId,
    imported_intervention_id: plan.importedInterventionId,
  };
}

function withCounts(
  result: ImportedInterventionPromotionResult,
): PromoteImportedInterventionsResult {
  return {
    ...result,
    promotedCount: result.deliveryPlans.length,
    ineligibleCount: result.decisions.filter((decision) => !decision.eligible)
      .length,
  };
}

function normalizeSelectedIds(ids: string[]): string[] {
  return Array.from(
    new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
}

function normalizeOccurrenceStatus(value: string): OccurrenceStatus {
  if (value === "unresolved" || value === "completed" || value === "not_completed") {
    return value;
  }

  throw new Error(`Unsupported occurrence status: ${value}.`);
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  try {
    return await requireCurrentUserId(
      "Sign in again before promoting imported reminders.",
    );
  } catch {
    throw new ImportedInterventionPromotionAuthError();
  }
}
