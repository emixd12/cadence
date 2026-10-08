import { Temporal } from "@js-temporal/polyfill";
import { toExistingOccurrenceForGeneration } from "@cadence/core/services/occurrence-generation";

import {
  type AppSupabaseClient,
  type BehaviorWithCategory,
  getBehaviorById,
  listBehaviorScheduleSlots,
  listUserBehaviors,
} from "@/lib/db/behaviors.repo";
import {
  applyOccurrenceGenerationPlan,
  getOccurrenceWithBehaviorTimezoneById,
  listBehaviorOccurrencesFrom,
  updateOccurrenceNoteIfExpected,
} from "@/lib/db/occurrences.repo";
import {
  applyOccurrenceStatusTransitionRpc,
  getLatestOccurrenceStatusEventForOccurrence,
  type ApplyOccurrenceStatusTransitionRpcResult,
} from "@/lib/db/occurrenceStatusEvents.repo";
import {
  DEFAULT_OCCURRENCE_HORIZON_DAYS,
  normalizeOccurrenceScheduleGraph,
  planOccurrenceGeneration,
  resolveGenerationWindow,
  type OccurrenceGenerationSchedule,
  type OccurrenceGenerationScheduleSlot,
  type OccurrenceGenerationPlan,
} from "@/lib/resolvers/occurrence.resolver";
import { listProfileOccurrenceSyncTargets } from "@/lib/db/profiles.repo";
import { listOccurrenceIdsWithTimeSessions } from "@/lib/db/timeSessions.repo";
import {
  applyOccurrenceStatusTransition as applySharedStatusTransition,
  updateOccurrenceNote as updateSharedOccurrenceNote,
  normalizeOccurrenceStatus, parseOccurrenceId, parseOccurrenceStatus, parseOccurrenceNote,
} from "@cadence/core/services/occurrence.service";
import {
  normalizeRecurrenceRule,
  normalizeScheduledTime,
} from "@/lib/services/behavior-form";
import {
  compareScheduleSlots,
  toScheduleSlotView,
} from "@/lib/services/schedule";
import { requireCurrentUserId } from "@/lib/auth/current-user";
import { reportMonitoringError } from "@/lib/monitoring/privacy-safe-events";
import {
  syncReminderDeliveriesForBehaviors,
  syncReminderDeliveriesForBehavior,
} from "@/lib/services/reminder.service";
import {
  decideOccurrenceSyncCoverage,
  markOccurrenceSyncFreshForPlans,
  markOccurrenceSyncStale,
  readOccurrenceSyncState,
  type OccurrenceSyncCoverageDecision,
} from "@/lib/services/occurrence-sync-state.service";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { processDueBehaviorArchives } from "@/lib/services/behavior-lifecycle.service";
import type {
  Behavior,
  Occurrence,
  OccurrenceSyncState,
  OccurrenceStatus,
} from "@/lib/types/database";
import { DEFAULT_TIMEZONE } from "@/lib/types/recurrence";
import type { ScheduleKind, TimeRangePreset } from "@/lib/types/schedule";
import type { OccurrenceActionState } from "@/lib/types/timeline";

export type SyncBehaviorOccurrencesOptions = {
  now?: Temporal.Instant;
  horizonDays?: number;
};

export type SyncUserOccurrencesOptions = SyncBehaviorOccurrencesOptions & {
  behaviors?: BehaviorWithCategory[];
  timezone?: string | null;
  planReminderDeliveries?: boolean;
};

export type EnsureUserOccurrencesFreshOptions = SyncUserOccurrencesOptions & {
  syncState?: OccurrenceSyncState | null;
};

export type EnsureUserOccurrencesFreshResult = {
  synced: boolean;
  coverage: OccurrenceSyncCoverageDecision;
  startLocalDate: string;
  endLocalDate: string;
  horizonDays: number;
  plans: OccurrenceGenerationPlan[];
};

export type ProcessOccurrenceSyncHorizonsOptions = {
  now?: Temporal.Instant;
  horizonDays?: number;
  limit?: number;
  supabase?: AppSupabaseClient;
};

export type ProcessOccurrenceSyncHorizonsResult = {
  checked: number;
  synced: number;
  skipped: number;
  failed: number;
};

const DEFAULT_OCCURRENCE_SYNC_PROCESS_LIMIT = 25;
const MAX_OCCURRENCE_SYNC_PROCESS_LIMIT = 100;


export async function syncUserOccurrences(
  supabase: AppSupabaseClient,
  userId: string,
  options: SyncUserOccurrencesOptions = {},
): Promise<OccurrenceGenerationPlan[]> {
  let failureTimezone = options.timezone ?? DEFAULT_TIMEZONE;

  return measurePerformanceSpan(
    {
      span: "service.sync_user_occurrences",
      counts: (plans) => countGenerationPlans(plans),
    },
    async () => {
      const expectedSyncState = await readOccurrenceSyncState(
        supabase,
        userId,
      );
      const behaviors = await measurePerformanceSpan(
        {
          span: "occurrence_sync.behavior_list_reuse",
          counts: (resolvedBehaviors) => ({
            behaviors: resolvedBehaviors.length,
            reused_behavior_list: options.behaviors ? 1 : 0,
          }),
        },
        async () => options.behaviors ?? listUserBehaviors(supabase, userId),
      );
      const now = options.now ?? Temporal.Now.instant();
      const syncTimezone = resolveUserSyncTimezone(
        behaviors,
        options.timezone,
      );
      failureTimezone = syncTimezone ?? failureTimezone;
      const fallbackWindow = resolveGenerationWindow({
        now,
        timezone: syncTimezone ?? DEFAULT_TIMEZONE,
        horizonDays: options.horizonDays,
      });

      if (behaviors.length === 0) {
        await markOccurrenceSyncFreshForPlans(supabase, {
          userId,
          plans: [],
          fallbackWindow,
          syncedAt: now.toString(),
          timezone: syncTimezone,
          expectedBehaviorConfigurationEvents: [],
          expectedSyncState,
        });

        return [];
      }

      const behaviorWindows = behaviors.map((behavior) => ({
        behavior,
        generationWindow: resolveGenerationWindow({
          now,
          timezone: behavior.timezone,
          behaviorEndDate: behavior.end_date,
          horizonDays: options.horizonDays,
        }),
      }));
      const schedulesByBehaviorId = await resolveBehaviorScheduleMap(
        supabase,
        userId,
        behaviors,
      );
      const existingOccurrencesByBehaviorId = await measurePerformanceSpan(
        {
          span: "occurrence_sync.existing_occurrence_reads",
          counts: (occurrencesByBehaviorId) => ({
            behaviors: occurrencesByBehaviorId.size,
            occurrences: countMapValues(occurrencesByBehaviorId),
          }),
        },
        () =>
          listExistingOccurrencesForBehaviorWindows(
            supabase,
            userId,
            behaviorWindows,
          ),
      );
      const existingOccurrences = Array.from(
        existingOccurrencesByBehaviorId.values(),
      ).flat();
      const timeSessionOccurrenceIds = new Set(
        await listOccurrenceIdsWithTimeSessions(supabase, {
          userId,
          occurrenceIds: existingOccurrences.map(
            (occurrence) => occurrence.id,
          ),
        }),
      );
      const plans = await measurePerformanceSpan(
        {
          span: "occurrence_sync.generation_planning",
          counts: (resolvedPlans) => countGenerationPlans(resolvedPlans),
        },
        async () =>
          Promise.all(
            behaviorWindows.map(async ({ behavior, generationWindow }) => {
              const schedules = schedulesByBehaviorId.get(behavior.id) ?? [];
              const behaviorOccurrences = occurrencesFromWindowStart(
                existingOccurrencesByBehaviorId.get(behavior.id) ?? [],
                generationWindow.rangeStart,
              );

              return planOccurrenceGeneration({
                behavior: {
                  id: behavior.id,
                  userId,
                  configurationEventId:
                    requireCurrentConfigurationEventId(behavior),
                  recurrenceRule: normalizeRecurrenceRule(
                    behavior.recurrence_rule,
                  ),
                  schedules,
                  scheduleSlots: schedules.flatMap(
                    (schedule) => schedule.timeEntries,
                  ),
                  timezone: behavior.timezone,
                  active: behavior.active,
                  endDate: behavior.end_date,
                  createdAt: behavior.created_at,
                },
                existingOccurrences: behaviorOccurrences.map(
                  (occurrence) =>
                    toExistingOccurrenceForGeneration(
                      occurrence,
                      timeSessionOccurrenceIds,
                    ),
                ),
                now,
                horizonDays: options.horizonDays,
              });
            }),
          ),
      );
      const createdCount = plans.reduce(
        (sum, plan) => sum + plan.create.length,
        0,
      );
      const updatedCount = plans.reduce(
        (sum, plan) => sum + plan.updateUnresolved.length,
        0,
      );
      const deletedCount = plans.reduce(
        (sum, plan) => sum + plan.deleteUnresolved.length,
        0,
      );

      await measurePerformanceSpan(
        {
          span: "occurrence_sync.occurrence_writes",
          counts: {
            created: createdCount,
            updated: updatedCount,
            deleted: deletedCount,
          },
        },
        async () => {
          await Promise.all(
            behaviorWindows.map(({ behavior }, index) =>
              applyOccurrenceGenerationPlan(supabase, {
                userId,
                behaviorId: behavior.id,
                expectedConfigurationEventId:
                  requireCurrentConfigurationEventId(behavior),
                now: now.toString(),
                plan: plans[index]!,
              }),
            ),
          );
        },
      );

      const mutatedOccurrences =
        createdCount > 0 || updatedCount > 0 || deletedCount > 0;
      const plannedReminderDeliveries =
        options.planReminderDeliveries !== false;
      if (plannedReminderDeliveries) {
        const reminderOccurrences = mutatedOccurrences
          ? await measurePerformanceSpan(
              {
                span: "occurrence_sync.reminder_occurrence_refresh",
                counts: (occurrencesByBehaviorId) => ({
                  behaviors: occurrencesByBehaviorId.size,
                  occurrences: countMapValues(occurrencesByBehaviorId),
                }),
              },
              () =>
                listExistingOccurrencesForBehaviorWindows(
                  supabase,
                  userId,
                  behaviorWindows,
                ),
            )
          : existingOccurrencesByBehaviorId;
        const reminderOccurrencesByBehaviorId = reminderOccurrences;

        const reminderInputs = behaviorWindows.map(
          ({ behavior, generationWindow }) => ({
            behavior,
            occurrences: occurrencesFromWindowStart(
              reminderOccurrencesByBehaviorId.get(behavior.id) ?? [],
              generationWindow.rangeStart,
            ),
          }),
        );

        await measurePerformanceSpan(
          {
            span: "occurrence_sync.reminder_planning_writes",
            counts: {
              behaviors: reminderInputs.length,
              occurrences: reminderInputs.reduce(
                (sum, input) => sum + input.occurrences.length,
                0,
              ),
            },
          },
          () =>
            syncReminderDeliveriesForBehaviors(
              supabase,
              userId,
              reminderInputs,
              { now },
            ),
        );
      }

      if (plannedReminderDeliveries) {
        await markOccurrenceSyncFreshForPlans(supabase, {
          userId,
          plans,
          coverageWindows: plans.flatMap((plan, index) => behaviors[index]!.active ? [plan.generationWindow] : []),
          fallbackWindow,
          syncedAt: now.toString(),
          timezone: syncTimezone,
          expectedBehaviorConfigurationEvents: behaviors.map((behavior) => ({
            behaviorId: behavior.id,
            configurationEventId:
              requireCurrentConfigurationEventId(behavior),
          })),
          expectedSyncState,
        });
      }

      return plans;
    },
  ).catch(async (error: unknown) => {
    await markSyncFailedWithoutMaskingError(supabase, {
      userId,
      timezone: failureTimezone,
    });

    throw error;
  });
}

export async function syncUserOccurrencesAndReminders(
  supabase: AppSupabaseClient,
  userId: string,
  options: Omit<SyncUserOccurrencesOptions, "planReminderDeliveries"> = {},
): Promise<OccurrenceGenerationPlan[]> {
  return syncUserOccurrences(supabase, userId, {
    ...options,
    planReminderDeliveries: true,
  });
}

export async function ensureUserOccurrencesFresh(
  supabase: AppSupabaseClient,
  userId: string,
  options: EnsureUserOccurrencesFreshOptions = {},
): Promise<EnsureUserOccurrencesFreshResult> {
  const now = options.now ?? Temporal.Now.instant();
  const timezone =
    options.timezone ??
    resolveUserSyncTimezone(options.behaviors ?? [], null) ??
    DEFAULT_TIMEZONE;
  const horizonDays = options.horizonDays ?? DEFAULT_OCCURRENCE_HORIZON_DAYS;
  const requiredWindow = resolveGenerationWindow({
    now,
    timezone,
    horizonDays,
  });

  return measurePerformanceSpan(
    {
      span: "service.ensure_user_occurrences_fresh",
      counts: (result) => ({
        covered: result.coverage.covered ? 1 : 0,
        synced: result.synced ? 1 : 0,
        horizon_days: result.horizonDays,
        behaviors: result.plans.length,
        created: result.plans.reduce(
          (sum, plan) => sum + plan.create.length,
          0,
        ),
        updated: result.plans.reduce(
          (sum, plan) => sum + plan.updateUnresolved.length,
          0,
        ),
        deleted: result.plans.reduce(
          (sum, plan) => sum + plan.deleteUnresolved.length,
          0,
        ),
      }),
    },
    async () => {
      const behaviors =
        options.behaviors ?? (await listUserBehaviors(supabase, userId));

      try {
        await resolveBehaviorScheduleMap(supabase, userId, behaviors);
      } catch (error) {
        await markSyncFailedWithoutMaskingError(supabase, {
          userId,
          timezone,
        });

        throw error;
      }

      const state = hasPreloadedSyncState(options)
        ? (options.syncState ?? null)
        : await readOccurrenceSyncState(supabase, userId);
      const coverage = decideOccurrenceSyncCoverage(state, {
        timezone,
        startLocalDate: requiredWindow.startLocalDate,
        endLocalDate: requiredWindow.endLocalDate,
      });

      if (coverage.covered) {
        if (options.planReminderDeliveries) {
          await syncCoveredReminderDeliveries(supabase, userId, behaviors, {
            now,
            horizonDays,
          });
        }

        return {
          synced: false,
          coverage,
          startLocalDate: requiredWindow.startLocalDate,
          endLocalDate: requiredWindow.endLocalDate,
          horizonDays,
          plans: [],
        };
      }

      const plans = await syncUserOccurrences(supabase, userId, {
        behaviors,
        horizonDays,
        now,
        planReminderDeliveries: options.planReminderDeliveries ?? false,
        timezone,
      });

      return {
        synced: true,
        coverage,
        startLocalDate: requiredWindow.startLocalDate,
        endLocalDate: requiredWindow.endLocalDate,
        horizonDays,
        plans,
      };
    },
  );
}

async function syncCoveredReminderDeliveries(
  supabase: AppSupabaseClient,
  userId: string,
  behaviors: BehaviorWithCategory[],
  options: {
    now: Temporal.Instant;
    horizonDays: number;
  },
): Promise<void> {
  const behaviorWindows = behaviors.map((behavior) => ({
    behavior,
    generationWindow: resolveGenerationWindow({
      now: options.now,
      timezone: behavior.timezone,
      horizonDays: options.horizonDays,
    }),
  }));
  const occurrencesByBehaviorId = await listExistingOccurrencesForBehaviorWindows(
    supabase,
    userId,
    behaviorWindows,
  );

  await syncReminderDeliveriesForBehaviors(
    supabase,
    userId,
    behaviorWindows.map(({ behavior, generationWindow }) => ({
      behavior,
      occurrences: occurrencesFromWindowStart(
        occurrencesByBehaviorId.get(behavior.id) ?? [],
        generationWindow.rangeStart,
      ),
    })),
    { now: options.now },
  );
}

function hasPreloadedSyncState(
  options: EnsureUserOccurrencesFreshOptions,
): options is EnsureUserOccurrencesFreshOptions & {
  syncState: OccurrenceSyncState | null;
} {
  return options.syncState !== undefined;
}

export async function processOccurrenceSyncHorizons(
  options: ProcessOccurrenceSyncHorizonsOptions = {},
): Promise<ProcessOccurrenceSyncHorizonsResult> {
  const supabase = options.supabase ?? createServiceRoleClient();
  const now = options.now ?? Temporal.Now.instant();
  const horizonDays = options.horizonDays ?? DEFAULT_OCCURRENCE_HORIZON_DAYS;
  await processDueBehaviorArchives({
    supabase,
    now,
    limit: options.limit,
  });
  const targets = await listProfileOccurrenceSyncTargets(supabase, {
    limit: normalizeOccurrenceSyncProcessLimit(options.limit),
  });
  const result: ProcessOccurrenceSyncHorizonsResult = {
    checked: targets.length,
    synced: 0,
    skipped: 0,
    failed: 0,
  };

  return measurePerformanceSpan(
    {
      span: "service.process_occurrence_sync_horizons",
      counts: (resolvedResult) => ({
        users: resolvedResult.checked,
        synced: resolvedResult.synced,
        skipped: resolvedResult.skipped,
        failed: resolvedResult.failed,
        horizon_days: horizonDays,
      }),
    },
    async () => {
      for (const target of targets) {
        try {
          const behaviors = await listUserBehaviors(supabase, target.id);
          const syncResult = await ensureUserOccurrencesFresh(
            supabase,
            target.id,
            {
              now,
              horizonDays,
              planReminderDeliveries: true,
              timezone: target.timezone || DEFAULT_TIMEZONE,
              behaviors,
            },
          );

          if (syncResult.synced) {
            result.synced += 1;
          } else {
            result.skipped += 1;
          }
        } catch {
          result.failed += 1;
        }
      }

      return result;
    },
  );
}

export async function markOccurrenceStatusFromFormData(
  formData: FormData,
): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await applyOccurrenceStatusTransition(supabase, userId, {
    occurrenceId: getOccurrenceIdFromFormData(formData),
    expectedStatus: getExpectedStatusFromFormData(formData),
    nextStatus: getStatusFromFormData(formData),
    now: Temporal.Now.instant(),
  });
}

export async function applyOccurrenceStatusTransition(
  supabase: AppSupabaseClient,
  userId: string,
  input: {
    occurrenceId: string;
    expectedStatus?: OccurrenceStatus;
    nextStatus: OccurrenceStatus;
    now: Temporal.Instant;
  },
): Promise<ApplyOccurrenceStatusTransitionRpcResult> {
  const { result, timezone } = await applySharedStatusTransition({
    async readStatusContext(occurrenceId) {
      const [occurrence, latestStatusEvent] = await Promise.all([
        getOccurrenceWithBehaviorTimezoneById(supabase, userId, occurrenceId),
        getLatestOccurrenceStatusEventForOccurrence(supabase, userId, occurrenceId),
      ]);
      return occurrence ? {
        occurrence,
        latestStatusEventId: latestStatusEvent?.id ?? null,
        timezone: occurrence.behavior?.timezone ?? DEFAULT_TIMEZONE,
      } : null;
    },
    applyStatusTransition: (plan) => applyOccurrenceStatusTransitionRpc(supabase, plan),
  }, input);

  if (
    input.nextStatus === "unresolved" &&
    normalizeOccurrenceStatus(result.occurrence.status) === "unresolved"
  ) {
    await repairClearedDecisionReminderCoverage(supabase, userId, {
      occurrence: result.occurrence,
      timezone,
      now: input.now,
    });
  }

  return result;
}

async function repairClearedDecisionReminderCoverage(
  supabase: AppSupabaseClient,
  userId: string,
  input: {
    occurrence: Occurrence;
    timezone: string;
    now: Temporal.Instant;
  },
): Promise<void> {
  try {
    const behavior = await getBehaviorById(
      supabase,
      userId,
      input.occurrence.behavior_id,
    );

    if (!behavior) {
      throw new Error("Behavior not found for reminder repair.");
    }

    await syncReminderDeliveriesForBehavior(supabase, userId, behavior, {
      scheduledFrom: input.occurrence.scheduled_for,
      occurrences: [input.occurrence],
      now: input.now,
    });
  } catch (error) {
    await markSyncFailedWithoutMaskingError(supabase, {
      userId,
      timezone: input.timezone,
    });

    try {
      reportMonitoringError(
        "clear_decision_reminder_repair_failed",
        error,
        { operation: "clear_decision" },
      );
    } catch {
      // Monitoring must not change the already-committed status result.
    }
  }
}

export async function updateOccurrenceNoteFromFormData(
  formData: FormData,
): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  await updateOccurrenceNote(supabase, userId, {
    occurrenceId: getOccurrenceIdFromFormData(formData),
    expectedNote: getExpectedNoteFromFormData(formData),
    note: getNoteFromFormData(formData),
    ...(formData.get("used_shortcut") === "true"
      ? { usedShortcut: true }
      : {}),
  });
}

export async function updateOccurrenceNote(
  supabase: AppSupabaseClient,
  userId: string,
  input: {
    occurrenceId: string;
    expectedNote: string;
    note: string;
    usedShortcut?: boolean;
  },
): Promise<Occurrence> {
  return updateSharedOccurrenceNote({
    updateOccurrenceNote: (plan) => updateOccurrenceNoteIfExpected(supabase, { userId, ...plan }),
  }, input);
}

export function occurrenceErrorToActionState(
  error: unknown,
): OccurrenceActionState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Unable to update this occurrence.",
  };
}

async function listExistingOccurrencesForBehaviorWindows(
  supabase: AppSupabaseClient,
  userId: string,
  behaviorWindows: Array<{
    behavior: BehaviorWithCategory;
    generationWindow: ReturnType<typeof resolveGenerationWindow>;
  }>,
): Promise<Map<string, Occurrence[]>> {
  return new Map(
    await Promise.all(
      behaviorWindows.map(
        async ({ behavior, generationWindow }) =>
          [
            behavior.id,
            await listBehaviorOccurrencesFrom(
              supabase,
              userId,
              behavior.id,
              generationWindow.rangeStart.toString(),
            ),
          ] as const,
      ),
    ),
  );
}

function occurrencesFromWindowStart(
  occurrences: Occurrence[],
  rangeStart: Temporal.Instant,
): Occurrence[] {
  return occurrences.filter(
    (occurrence) =>
      Temporal.Instant.compare(
        Temporal.Instant.from(occurrence.scheduled_for),
        rangeStart,
      ) >= 0,
  );
}

function countMapValues<T>(valuesByKey: Map<string, T[]>): number {
  let count = 0;

  for (const values of valuesByKey.values()) {
    count += values.length;
  }

  return count;
}

function countGenerationPlans(plans: OccurrenceGenerationPlan[]) {
  return {
    behaviors: plans.length,
    created: plans.reduce((sum, plan) => sum + plan.create.length, 0),
    updated: plans.reduce((sum, plan) => sum + plan.updateUnresolved.length, 0),
    deleted: plans.reduce(
      (sum, plan) => sum + plan.deleteUnresolved.length,
      0,
    ),
  };
}

function resolveUserSyncTimezone(
  behaviors: BehaviorWithCategory[],
  explicitTimezone?: string | null,
): string | null {
  if (explicitTimezone) {
    return explicitTimezone;
  }

  const timezoneSource = behaviors.some((behavior) => behavior.active)
    ? behaviors.filter((behavior) => behavior.active)
    : behaviors;
  const timezones = new Set(
    timezoneSource.map((behavior) => behavior.timezone),
  );

  if (timezones.size === 1) {
    return [...timezones][0] ?? DEFAULT_TIMEZONE;
  }

  if (timezones.size === 0) {
    return DEFAULT_TIMEZONE;
  }

  return null;
}

async function markSyncFailedWithoutMaskingError(
  supabase: AppSupabaseClient,
  input: {
    userId: string;
    timezone: string;
  },
): Promise<void> {
  try {
    await markOccurrenceSyncStale(supabase, {
      userId: input.userId,
      reason: "sync_failed",
      timezone: input.timezone,
    });
  } catch {
    // Preserve the sync failure as the error surfaced to the route.
  }
}

function normalizeOccurrenceSyncProcessLimit(
  value: number | undefined,
): number {
  if (value === undefined) {
    return DEFAULT_OCCURRENCE_SYNC_PROCESS_LIMIT;
  }

  if (!Number.isInteger(value) || value < 1) {
    return DEFAULT_OCCURRENCE_SYNC_PROCESS_LIMIT;
  }

  return Math.min(value, MAX_OCCURRENCE_SYNC_PROCESS_LIMIT);
}

async function resolveBehaviorScheduleSlots(
  supabase: AppSupabaseClient,
  userId: string,
  behavior: Behavior | BehaviorWithCategory,
): Promise<OccurrenceGenerationScheduleSlot[]> {
  const scheduleSlots =
    "schedule_slots" in behavior && Array.isArray(behavior.schedule_slots)
      ? behavior.schedule_slots
      : await listBehaviorScheduleSlots(supabase, userId, behavior.id);

  if (scheduleSlots.length === 0) {
    return [
      {
        id: null,
        scheduleId: null,
        kind: "exact",
        preset: null,
        startTime: normalizeScheduledTime(behavior.scheduled_time),
        endTime: null,
        sortOrder: 0,
      },
    ];
  }

  return scheduleSlots
    .map((slot) =>
      toScheduleSlotView({
        id: slot.id,
        scheduleId: slot.behavior_schedule_id,
        kind: normalizeScheduleKind(slot.kind),
        preset: normalizeSchedulePreset(slot.preset),
        startTime: slot.start_time,
        endTime: slot.end_time,
        sortOrder: slot.sort_order,
      }),
    )
    .sort(compareScheduleSlots)
    .map((slot) => ({
      id: slot.id,
      scheduleId: slot.scheduleId,
      kind: slot.kind,
      preset: slot.preset,
      startTime: slot.startTime,
      endTime: slot.endTime,
      sortOrder: slot.sortOrder,
    }));
}

async function resolveBehaviorSchedulesForGeneration(
  supabase: AppSupabaseClient,
  userId: string,
  behavior: Behavior | BehaviorWithCategory,
): Promise<OccurrenceGenerationSchedule[]> {
  requireCurrentConfigurationEventId(behavior);

  const persistedSchedules =
    "schedules" in behavior &&
    Array.isArray(behavior.schedules) &&
    behavior.schedules.length > 0
      ? behavior.schedules
        .map((schedule) => {
          const timeEntries = schedule.schedule_slots
            .map((slot) =>
              toScheduleSlotView({
                id: slot.id,
                scheduleId: slot.behavior_schedule_id ?? schedule.id,
                kind: normalizeScheduleKind(slot.kind),
                preset: normalizeSchedulePreset(slot.preset),
                startTime: slot.start_time,
                endTime: slot.end_time,
                sortOrder: slot.sort_order,
              }),
            )
            .sort(compareScheduleSlots)
            .map((slot) => ({
              id: slot.id,
              scheduleId: slot.scheduleId,
              kind: slot.kind,
              preset: slot.preset,
              startTime: slot.startTime,
              endTime: slot.endTime,
              sortOrder: slot.sortOrder,
            }));

          return {
            id: schedule.id,
            recurrenceRule: normalizeRecurrenceRule(schedule.recurrence_rule),
            timeEntries,
            sortOrder: schedule.sort_order,
          };
        })
      : [];

  if (!behavior.active) {
    return persistedSchedules;
  }

  const compatibilitySchedule: OccurrenceGenerationSchedule = {
    id: null,
    recurrenceRule: normalizeRecurrenceRule(behavior.recurrence_rule),
    timeEntries: await resolveBehaviorScheduleSlots(
      supabase,
      userId,
      behavior,
    ),
    sortOrder: 0,
  };
  const normalization = normalizeOccurrenceScheduleGraph({
    schedules: persistedSchedules,
    compatibilitySchedule,
  });

  if (normalization.status !== "valid") {
    throw new OccurrenceScheduleIntegrityError(normalization.reason);
  }

  return normalization.schedules;
}

function requireCurrentConfigurationEventId(
  behavior: Behavior | BehaviorWithCategory,
): string {
  const eventId = behavior.current_configuration_event_id;

  if (!eventId) {
    throw new Error(
      "Behavior configuration history is unavailable for occurrence generation.",
    );
  }

  return eventId;
}

class OccurrenceScheduleIntegrityError extends Error {
  readonly reason:
    | "single_empty_schedule"
    | "missing_schedule"
    | "ambiguous_empty_schedule"
    | "malformed_schedule_graph";

  constructor(reason: OccurrenceScheduleIntegrityError["reason"]) {
    super(
      "This behavior schedule needs repair before occurrences can be generated.",
    );
    this.name = "OccurrenceScheduleIntegrityError";
    this.reason = reason;
  }
}

async function resolveBehaviorScheduleMap(
  supabase: AppSupabaseClient,
  userId: string,
  behaviors: Array<Behavior | BehaviorWithCategory>,
): Promise<Map<string, OccurrenceGenerationSchedule[]>> {
  return measurePerformanceSpan(
    {
      span: "occurrence_sync.schedule_slot_resolution",
      counts: (resolvedSchedulesByBehaviorId) => ({
        behaviors: resolvedSchedulesByBehaviorId.size,
        schedules: countMapValues(resolvedSchedulesByBehaviorId),
        schedule_slots: Array.from(
          resolvedSchedulesByBehaviorId.values(),
        ).reduce(
          (sum, schedules) =>
            sum +
            schedules.reduce(
              (scheduleSum, schedule) =>
                scheduleSum + schedule.timeEntries.length,
              0,
            ),
          0,
        ),
      }),
    },
    async () =>
      new Map(
        await Promise.all(
          behaviors.map(
            async (behavior) =>
              [
                behavior.id,
                await resolveBehaviorSchedulesForGeneration(
                  supabase,
                  userId,
                  behavior,
                ),
              ] as const,
          ),
        ),
      ),
  );
}

function normalizeScheduleKind(value: string): ScheduleKind {
  if (value === "exact" || value === "range") {
    return value;
  }

  throw new Error(`Unsupported schedule kind: ${value}.`);
}

function normalizeSchedulePreset(value: string | null): TimeRangePreset | null {
  if (
    value === null ||
    value === "morning" ||
    value === "afternoon" ||
    value === "evening" ||
    value === "night"
  ) {
    return value;
  }

  throw new Error(`Unsupported schedule preset: ${value}.`);
}

async function requireUserId(supabase: AppSupabaseClient): Promise<string> {
  void supabase;

  return requireCurrentUserId("Sign in again before updating occurrences.");
}

function getOccurrenceIdFromFormData(formData: FormData): string {
  return parseOccurrenceId(formData.get("occurrence_id"));
}

function getStatusFromFormData(formData: FormData): OccurrenceStatus {
  return parseOccurrenceStatus(formData.get("status"));
}

function getExpectedStatusFromFormData(formData: FormData): OccurrenceStatus {
  return parseOccurrenceStatus(formData.get("expected_status"), true);
}

function getNoteFromFormData(formData: FormData): string {
  return parseOccurrenceNote(formData.get("note"));
}

function getExpectedNoteFromFormData(formData: FormData): string {
  return parseOccurrenceNote(formData.get("expected_note"), true);
}
