import { Temporal } from "@js-temporal/polyfill";
import { effectiveStartAt } from "@cadence/core/resolvers/time.resolver";
import { behaviorRunState, runFieldsFromStored } from "@cadence/core/resolvers/behavior-run.resolver";

import type {
  AppSupabaseClient,
  BehaviorWithCategory,
} from "@/lib/db/behaviors.repo";
import { getBehaviorById, listUserBehaviors } from "@/lib/db/behaviors.repo";
import {
  cancelPendingReminderDeliveryById,
  cancelPendingReminderDeliveriesForOccurrence,
  cancelUnclaimedPendingReminderDeliveriesById,
  claimPendingBrowserPushReminderDelivery,
  claimPendingEmailReminderDelivery,
  createMissingReminderDeliveries,
  listDuePendingBrowserPushReminderDeliveries,
  listDuePendingEmailReminderDeliveries,
  listReminderDeliveriesByOccurrenceIds,
  markReminderDeliveryFailed,
  markReminderDeliverySent,
  reactivateCancelledReminderDeliveriesById,
} from "@/lib/db/reminderDeliveries.repo";
import {
  getOccurrenceById,
  listBehaviorOccurrencesFrom,
} from "@/lib/db/occurrences.repo";
import { getProfileSettings } from "@/lib/db/profiles.repo";
import { reportMonitoringEvent } from "@/lib/monitoring/privacy-safe-events";
import {
  deactivatePushSubscriptionById,
  listActivePushSubscriptionsForUser,
} from "@/lib/db/pushSubscriptions.repo";
import {
  resolveReminderDeliveries,
  resolveReminderDeliveryCancellation,
  resolveReminderDeliveryReconciliation,
  resolveRoutineReminderDeliveries,
  type ResolvedReminderDelivery,
  type ReminderResolverBehavior,
  type ReminderResolverOccurrence,
} from "@/lib/resolvers/reminder.resolver";
import { formatOccurrenceScheduleLabel } from "@/lib/services/schedule";
import { measurePerformanceSpan } from "@/lib/services/performance-timing";
import {
  readLaunchCircuitBreaker,
  reportOpenLaunchCircuitBreaker,
} from "@/lib/security/launch-circuit-breakers";
import {
  createSequenzyReminderEmailSender,
  SequenzyConfigurationError,
  type SequenzyReminderEmailInput,
  type SequenzySendOptions,
} from "@/lib/services/sequenzy.service";
import { runProviderCallWithTimeout } from "@/lib/services/provider-call-timeout";
import {
  BrowserPushConfigurationError,
  BrowserPushSubscriptionExpiredError,
  createWebPushReminderSender,
  type BrowserPushReminderPayload,
  type BrowserPushReminderSender,
} from "@/lib/services/web-push.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import type {
  Behavior,
  NewReminderDelivery,
  Occurrence,
  OccurrenceStatus,
  PushSubscription,
  ReminderChannel,
  ReminderDelivery,
  ReminderDeliveryStatus,
} from "@/lib/types/database";

export type ReminderEmailSender = (
  input: SequenzyReminderEmailInput,
  options?: SequenzySendOptions,
) => Promise<unknown>;

export type ProcessDueEmailRemindersOptions = {
  now?: Temporal.Instant;
  limit?: number;
  supabase?: AppSupabaseClient;
  sendEmail?: ReminderEmailSender;
  providerTimeoutMs?: number;
  circuitBreakerEnvironment?: Readonly<
    Record<string, string | undefined>
  >;
};

export type ProcessDueRemindersOptions = ProcessDueEmailRemindersOptions & {
  sendBrowserPush?: BrowserPushReminderSender;
};

export type ProcessDueRemindersResult = {
  checked: number;
  claimed: number;
  skipped: number;
  sent: number;
  failed: number;
  cancelled: number;
};

export type ProcessDueEmailRemindersResult = ProcessDueRemindersResult;

export type SyncReminderDeliveriesForBehaviorsInput = {
  behavior: Behavior | BehaviorWithCategory;
  occurrences: Occurrence[];
};

const DEFAULT_PROCESS_LIMIT = 25;
const MAX_PROCESS_LIMIT = 100;
const CLAIM_RECLAIM_AFTER_MINUTES = 15;
const MAX_BROWSER_PUSH_SUBSCRIPTIONS_PER_DELIVERY = 20;
const BROWSER_PUSH_SEND_CONCURRENCY = 4;

export async function syncReminderDeliveriesForBehavior(
  supabase: AppSupabaseClient,
  userId: string,
  behavior: Behavior | BehaviorWithCategory,
  options: {
    scheduledFrom: string;
    occurrences?: Occurrence[];
    now?: Temporal.Instant;
  },
): Promise<void> {
  const now = options.now ?? Temporal.Now.instant();

  // An inheriting sub-behavior shares one routine reminder with its siblings, so the
  // whole routine is reconciled together.
  if (behavior.parent_behavior_id && behavior.inherit_parent_schedule) {
    const behaviors = await listUserBehaviors(supabase, userId);
    const parent = behaviors.find((candidate) => candidate.id === behavior.parent_behavior_id);
    if (parent) {
      const siblings = behaviors.filter((candidate) =>
        candidate.parent_behavior_id === parent.id && candidate.inherit_parent_schedule);
      const inputs = await Promise.all(siblings.map(async (sibling) => ({
        behavior: sibling,
        occurrences: await listBehaviorOccurrencesFrom(supabase, userId, sibling.id, options.scheduledFrom),
      })));
      await syncReminderDeliveriesForBehaviors(supabase, userId, [{ behavior: parent, occurrences: [] }, ...inputs], { now });
      return;
    }
  }

  await measurePerformanceSpan(
    {
      span: "service.sync_reminder_deliveries_for_behavior",
      counts: {
        behaviors: 1,
      },
    },
    async () => {
      const occurrences =
        options.occurrences ??
        (await listBehaviorOccurrencesFrom(
          supabase,
          userId,
          behavior.id,
          options.scheduledFrom,
        ));

      const deliveries = behavior.active
        ? resolveReminderDeliveriesForBehaviorOccurrences(
            behavior,
            userId,
            occurrences,
          )
        : [];

      await reconcileReminderDeliveries(
        supabase,
        userId,
        occurrences,
        deliveries,
        now,
      );
    },
  );
}

export async function syncReminderDeliveriesForBehaviors(
  supabase: AppSupabaseClient,
  userId: string,
  inputs: SyncReminderDeliveriesForBehaviorsInput[],
  options: { now?: Temporal.Instant } = {},
): Promise<void> {
  const now = options.now ?? Temporal.Now.instant();

  await measurePerformanceSpan(
    {
      span: "service.sync_reminder_deliveries_for_behaviors",
      counts: {
        behaviors: inputs.length,
        occurrences: inputs.reduce(
          (sum, input) => sum + input.occurrences.length,
          0,
        ),
      },
    },
    async () => {
      const occurrences: Occurrence[] = [];
      const deliveries: ResolvedReminderDelivery[] = [];
      const inputsById = new Map(inputs.map((input) => [input.behavior.id, input]));
      const routines = new Map<string, SyncReminderDeliveriesForBehaviorsInput[]>();

      for (const input of inputs) {
        occurrences.push(...input.occurrences);

        if (!input.behavior.active) {
          continue;
        }

        // Inheriting sub-behaviors of an active parent share one routine reminder per slot.
        const parentId = input.behavior.parent_behavior_id;
        if (parentId && input.behavior.inherit_parent_schedule && inputsById.get(parentId)?.behavior.active) {
          routines.set(parentId, [...(routines.get(parentId) ?? []), input]);
          continue;
        }

        deliveries.push(
          ...resolveReminderDeliveriesForBehaviorOccurrences(
            input.behavior,
            userId,
            input.occurrences,
          ),
        );
      }

      for (const [parentId, children] of routines) {
        deliveries.push(...resolveRoutineReminderDeliveries({
          parent: toReminderResolverBehavior(inputsById.get(parentId)!.behavior, userId),
          children: children.map((child) => ({
            behavior: toReminderResolverBehavior(child.behavior, userId),
            inheritParentSchedule: true,
            title: child.behavior.title,
            subBehaviorSortOrder: child.behavior.sub_behavior_sort_order,
            occurrences: child.occurrences.map(toReminderResolverOccurrence),
          })),
        }).deliveries);
      }

      await measurePerformanceSpan(
        {
          span: "reminder_sync.planning_writes",
          counts: {
            reminders_planned: deliveries.length,
            occurrences: occurrences.length,
          },
        },
        () =>
          reconcileReminderDeliveries(
            supabase,
            userId,
            occurrences,
            deliveries,
            now,
          ),
      );
    },
  );
}

export async function cancelReminderDeliveriesForResolvedOccurrence(
  supabase: AppSupabaseClient,
  userId: string,
  occurrence: Occurrence,
): Promise<void> {
  const cancellation = resolveReminderDeliveryCancellation({
    occurrence: toReminderResolverOccurrence(occurrence),
  });

  if (!cancellation.cancelPending) {
    return;
  }

  await cancelPendingReminderDeliveriesForOccurrence(
    supabase,
    userId,
    occurrence.id,
  );
}

export async function processDueReminders(
  options: ProcessDueRemindersOptions = {},
): Promise<ProcessDueRemindersResult> {
  const now = options.now ?? Temporal.Now.instant();
  const supabase = options.supabase ?? createServiceRoleClient();
  const [emailResult, browserPushResult] = await Promise.all([
    processDueEmailReminders({
      ...options,
      now,
      supabase,
    }),
    processDueBrowserPushReminders({
      ...options,
      now,
      supabase,
    }),
  ]);

  return mergeProcessResults(emailResult, browserPushResult);
}

export async function processDueEmailReminders(
  options: ProcessDueEmailRemindersOptions = {},
): Promise<ProcessDueEmailRemindersResult> {
  const breaker = readLaunchCircuitBreaker(
    "email_sends",
    options.circuitBreakerEnvironment,
  );

  if (breaker.open) {
    reportOpenLaunchCircuitBreaker(breaker);
    return emptyProcessResult();
  }

  const now = options.now ?? Temporal.Now.instant();
  const dueAt = now.toString();
  const reclaimBefore = now
    .subtract({ minutes: CLAIM_RECLAIM_AFTER_MINUTES })
    .toString();
  const processingStartedAt = dueAt;
  const limit = normalizeProcessLimit(options.limit);
  const supabase = options.supabase ?? createServiceRoleClient();
  const dueDeliveries = await listDuePendingEmailReminderDeliveries(supabase, {
    dueAt,
    reclaimBefore,
    limit,
  });
  const result: ProcessDueEmailRemindersResult = {
    checked: dueDeliveries.length,
    claimed: 0,
    skipped: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };

  if (dueDeliveries.length === 0) {
    return result;
  }

  let sendEmail: ReminderEmailSender;

  try {
    sendEmail = options.sendEmail ?? createSequenzyReminderEmailSender();
  } catch (error) {
    if (!(error instanceof SequenzyConfigurationError)) {
      throw error;
    }

    for (const delivery of dueDeliveries) {
      const claimedDelivery = await claimPendingEmailReminderDelivery(supabase, {
        id: delivery.id,
        userId: delivery.user_id,
        dueAt,
        reclaimBefore,
        processingStartedAt,
      });

      if (!claimedDelivery) {
        result.skipped += 1;
        continue;
      }

      reportReclaimedDelivery(delivery);
      result.claimed += 1;
      result.failed += 1;
      await markReminderDeliveryFailed(supabase, {
        id: claimedDelivery.id,
        userId: claimedDelivery.user_id,
        error: error.message,
      });
    }

    return result;
  }

  for (const delivery of dueDeliveries) {
    const claimedDelivery = await claimPendingEmailReminderDelivery(supabase, {
      id: delivery.id,
      userId: delivery.user_id,
      dueAt,
      reclaimBefore,
      processingStartedAt,
    });

    if (!claimedDelivery) {
      result.skipped += 1;
      continue;
    }

    reportReclaimedDelivery(delivery);
    result.claimed += 1;

    const outcome = await processClaimedEmailReminder({
      supabase,
      delivery: claimedDelivery,
      sendEmail,
      processedAt: dueAt,
      providerTimeoutMs: options.providerTimeoutMs,
    });

    result[outcome] += 1;
  }

  return result;
}

export async function processDueBrowserPushReminders(
  options: ProcessDueRemindersOptions = {},
): Promise<ProcessDueRemindersResult> {
  const breaker = readLaunchCircuitBreaker(
    "browser_push_sends",
    options.circuitBreakerEnvironment,
  );

  if (breaker.open) {
    reportOpenLaunchCircuitBreaker(breaker);
    return emptyProcessResult();
  }

  const now = options.now ?? Temporal.Now.instant();
  const dueAt = now.toString();
  const reclaimBefore = now
    .subtract({ minutes: CLAIM_RECLAIM_AFTER_MINUTES })
    .toString();
  const processingStartedAt = dueAt;
  const limit = normalizeProcessLimit(options.limit);
  const supabase = options.supabase ?? createServiceRoleClient();
  const dueDeliveries = await listDuePendingBrowserPushReminderDeliveries(
    supabase,
    {
      dueAt,
      reclaimBefore,
      limit,
    },
  );
  const result: ProcessDueRemindersResult = {
    checked: dueDeliveries.length,
    claimed: 0,
    skipped: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };

  if (dueDeliveries.length === 0) {
    return result;
  }

  let sendBrowserPush: BrowserPushReminderSender;

  try {
    sendBrowserPush = options.sendBrowserPush ?? createWebPushReminderSender();
  } catch (error) {
    if (!(error instanceof BrowserPushConfigurationError)) {
      throw error;
    }

    for (const delivery of dueDeliveries) {
      const claimedDelivery = await claimPendingBrowserPushReminderDelivery(
        supabase,
        {
          id: delivery.id,
          userId: delivery.user_id,
          dueAt,
          reclaimBefore,
          processingStartedAt,
        },
      );

      if (!claimedDelivery) {
        result.skipped += 1;
        continue;
      }

      reportReclaimedDelivery(delivery);
      result.claimed += 1;
      result.failed += 1;
      await markReminderDeliveryFailed(supabase, {
        id: claimedDelivery.id,
        userId: claimedDelivery.user_id,
        error: error.message,
      });
    }

    return result;
  }

  for (const delivery of dueDeliveries) {
    const claimedDelivery = await claimPendingBrowserPushReminderDelivery(
      supabase,
      {
        id: delivery.id,
        userId: delivery.user_id,
        dueAt,
        reclaimBefore,
        processingStartedAt,
      },
    );

    if (!claimedDelivery) {
      result.skipped += 1;
      continue;
    }

    reportReclaimedDelivery(delivery);
    result.claimed += 1;

    const outcome = await processClaimedBrowserPushReminder({
      supabase,
      delivery: claimedDelivery,
      sendBrowserPush,
      processedAt: dueAt,
      providerTimeoutMs: options.providerTimeoutMs,
    });

    result[outcome] += 1;
  }

  return result;
}

/** An ended or paused Behavior sends no reminder; its Occurrence is not running. */
function behaviorHasEnded(behavior: Behavior, processedAt: string): boolean {
  const state = behaviorRunState(runFieldsFromStored(behavior), Temporal.Instant.from(processedAt)).state;
  return state === "ended" || state === "paused";
}

/**
 * The Behavior whose reminder settings planned this delivery. An inheriting sub-behavior
 * shares its parent's routine reminder (`resolveRoutineReminderDeliveries`), so the
 * parent's settings apply. Null when that parent is missing, archived, ended or paused.
 */
async function loadReminderSettingsBehavior(
  supabase: AppSupabaseClient,
  userId: string,
  behavior: BehaviorWithCategory,
  processedAt: string,
): Promise<Behavior | BehaviorWithCategory | null> {
  if (!behavior.parent_behavior_id || !behavior.inherit_parent_schedule) return behavior;
  const parent = await getBehaviorById(supabase, userId, behavior.parent_behavior_id);
  if (!parent || parent.user_id !== userId || !parent.active || behaviorHasEnded(parent, processedAt)) return null;
  return parent;
}

async function processClaimedEmailReminder(input: {
  supabase: AppSupabaseClient;
  delivery: ReminderDelivery;
  sendEmail: ReminderEmailSender;
  processedAt: string;
  providerTimeoutMs?: number;
}): Promise<"sent" | "failed" | "cancelled"> {
  const occurrence = await getOccurrenceById(
    input.supabase,
    input.delivery.user_id,
    input.delivery.occurrence_id,
  );

  if (!occurrence) {
    await cancelPendingReminderDeliveryById(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
    });
    return "cancelled";
  }

  const [behavior, profile] = await Promise.all([
    getBehaviorById(input.supabase, input.delivery.user_id, occurrence.behavior_id),
    getProfileSettings(input.supabase, input.delivery.user_id),
  ]);

  const settings = behavior
    ? await loadReminderSettingsBehavior(input.supabase, input.delivery.user_id, behavior, input.processedAt)
    : null;

  if (
    !behavior ||
    !settings ||
    !behavior.active ||
    behaviorHasEnded(behavior, input.processedAt) ||
    !isCurrentExpectedEmailDelivery(input.delivery, settings, occurrence)
  ) {
    await cancelPendingReminderDeliveryById(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
    });
    return "cancelled";
  }

  const recipientEmail = profile?.email.trim();

  if (!recipientEmail) {
    await markReminderDeliveryFailed(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
      error: "Profile email is missing for email reminder delivery.",
    });
    return "failed";
  }

  try {
    const emailInput = toSequenzyReminderEmailInput({
      delivery: input.delivery,
      behavior,
      occurrence,
      recipientEmail,
    });
    await runProviderCallWithTimeout(
      (signal) => input.sendEmail(emailInput, { signal }),
      { timeoutMs: input.providerTimeoutMs },
    );
  } catch (error) {
    await markReminderDeliveryFailed(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
      error: errorToMessage(error),
    });
    return "failed";
  }

  const markedSent = await markReminderDeliverySent(input.supabase, {
    id: input.delivery.id,
    userId: input.delivery.user_id,
    sentAt: input.processedAt,
  });

  if (!markedSent) {
    reportMidSendCancellation("email");
    return "cancelled";
  }

  return "sent";
}

async function processClaimedBrowserPushReminder(input: {
  supabase: AppSupabaseClient;
  delivery: ReminderDelivery;
  sendBrowserPush: BrowserPushReminderSender;
  processedAt: string;
  providerTimeoutMs?: number;
}): Promise<"sent" | "failed" | "cancelled"> {
  const occurrence = await getOccurrenceById(
    input.supabase,
    input.delivery.user_id,
    input.delivery.occurrence_id,
  );

  if (!occurrence) {
    await cancelPendingReminderDeliveryById(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
    });
    return "cancelled";
  }

  const behavior = await getBehaviorById(
    input.supabase,
    input.delivery.user_id,
    occurrence.behavior_id,
  );

  const settings = behavior
    ? await loadReminderSettingsBehavior(input.supabase, input.delivery.user_id, behavior, input.processedAt)
    : null;

  if (
    !behavior ||
    !settings ||
    !behavior.active ||
    behaviorHasEnded(behavior, input.processedAt) ||
    !isCurrentExpectedBrowserPushDelivery(input.delivery, settings, occurrence)
  ) {
    await cancelPendingReminderDeliveryById(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
    });
    return "cancelled";
  }

  const subscriptions = await listActivePushSubscriptionsForUser(
    input.supabase,
    input.delivery.user_id,
  );

  if (subscriptions.length === 0) {
    await markReminderDeliveryFailed(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
      error: "No active browser push subscription is available.",
    });
    return "failed";
  }

  const sendResult = await sendBrowserPushToSubscriptions({
    supabase: input.supabase,
    userId: input.delivery.user_id,
    subscriptions,
    sendBrowserPush: input.sendBrowserPush,
    providerTimeoutMs: input.providerTimeoutMs,
    payload: toBrowserPushReminderPayload({
      behavior,
      occurrence,
    }),
  });

  if (sendResult.sent > 0) {
    const markedSent = await markReminderDeliverySent(input.supabase, {
      id: input.delivery.id,
      userId: input.delivery.user_id,
      sentAt: input.processedAt,
    });

    if (!markedSent) {
      reportMidSendCancellation("browser_push");
      return "cancelled";
    }

    return "sent";
  }

  await markReminderDeliveryFailed(input.supabase, {
    id: input.delivery.id,
    userId: input.delivery.user_id,
    error: sendResult.error ?? "Browser push reminder could not be sent.",
  });
  return "failed";
}

function isCurrentExpectedEmailDelivery(
  delivery: ReminderDelivery,
  behavior: Behavior | BehaviorWithCategory,
  occurrence: Occurrence,
): boolean {
  return resolveReminderDeliveries({
    behavior: toReminderResolverBehavior(behavior, delivery.user_id),
    occurrence: toReminderResolverOccurrence(occurrence),
  }).some(
    (expectedDelivery) =>
      expectedDelivery.channel === "email" &&
      sameInstant(expectedDelivery.scheduledSendAt, delivery.scheduled_send_at),
  );
}

function isCurrentExpectedBrowserPushDelivery(
  delivery: ReminderDelivery,
  behavior: Behavior | BehaviorWithCategory,
  occurrence: Occurrence,
): boolean {
  return resolveReminderDeliveries({
    behavior: toReminderResolverBehavior(behavior, delivery.user_id),
    occurrence: toReminderResolverOccurrence(occurrence),
  }).some(
    (expectedDelivery) =>
      expectedDelivery.channel === "browser_push" &&
      sameInstant(expectedDelivery.scheduledSendAt, delivery.scheduled_send_at),
  );
}

function sameInstant(first: string, second: string): boolean {
  try {
    return Temporal.Instant.compare(first, second) === 0;
  } catch {
    return first === second;
  }
}

function emptyProcessResult(): ProcessDueRemindersResult {
  return {
    checked: 0,
    claimed: 0,
    skipped: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };
}

function reportReclaimedDelivery(delivery: ReminderDelivery): void {
  if (delivery.processing_started_at === null) {
    return;
  }

  reportMonitoringEvent({
    name: "reminder_delivery_claim_reclaimed",
    severity: "warning",
    context: {
      channel: delivery.channel,
      retry: true,
    },
  });
}

function reportMidSendCancellation(channel: ReminderChannel): void {
  reportMonitoringEvent({
    name: "reminder_delivery_cancelled_mid_send",
    severity: "warning",
    context: { channel },
  });
}

async function sendBrowserPushToSubscriptions(input: {
  supabase: AppSupabaseClient;
  userId: string;
  subscriptions: PushSubscription[];
  sendBrowserPush: BrowserPushReminderSender;
  providerTimeoutMs?: number;
  payload: BrowserPushReminderPayload;
}): Promise<{ sent: number; error: string | null }> {
  let sent = 0;
  let error: string | null = null;
  let nextSubscriptionIndex = 0;
  const subscriptions = input.subscriptions.slice(
    0,
    MAX_BROWSER_PUSH_SUBSCRIPTIONS_PER_DELIVERY,
  );

  async function sendNextSubscription(): Promise<void> {
    while (nextSubscriptionIndex < subscriptions.length) {
      const subscription = subscriptions[nextSubscriptionIndex];
      nextSubscriptionIndex += 1;

      if (!subscription) {
        return;
      }

      try {
        await runProviderCallWithTimeout(
          (signal) =>
            input.sendBrowserPush(
              {
                endpoint: subscription.endpoint,
                p256dh: subscription.p256dh,
                auth: subscription.auth,
                payload: input.payload,
              },
              { signal },
            ),
          { timeoutMs: input.providerTimeoutMs },
        );
        sent += 1;
      } catch (sendError) {
        if (sendError instanceof BrowserPushSubscriptionExpiredError) {
          await deactivatePushSubscriptionById(input.supabase, {
            userId: input.userId,
            subscriptionId: subscription.id,
          });
        }

        error = errorToMessage(
          sendError,
          "Browser push reminder could not be sent.",
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(BROWSER_PUSH_SEND_CONCURRENCY, subscriptions.length),
      },
      () => sendNextSubscription(),
    ),
  );

  return {
    sent,
    error,
  };
}

function toSequenzyReminderEmailInput(input: {
  delivery: ReminderDelivery;
  behavior: Behavior | BehaviorWithCategory;
  occurrence: Occurrence;
  recipientEmail: string;
}): SequenzyReminderEmailInput {
  return {
    to: input.recipientEmail,
    subscriberExternalId: input.behavior.user_id,
    variables: {
      BEHAVIOR_ID: input.behavior.id,
      BEHAVIOR_TITLE: input.behavior.title,
      BEHAVIOR_DESCRIPTION: input.behavior.description ?? "",
      OCCURRENCE_ID: input.occurrence.id,
      OCCURRENCE_LOCAL_DATE: input.occurrence.local_date,
      OCCURRENCE_SCHEDULED_FOR: input.occurrence.scheduled_for,
      REMINDER_SCHEDULED_SEND_AT: input.delivery.scheduled_send_at,
      SCHEDULED_TIME: formatOccurrenceScheduleLabel({
        scheduleKind: normalizeScheduleKind(input.occurrence.schedule_kind),
        schedulePreset: normalizeSchedulePreset(input.occurrence.schedule_preset),
        scheduleStartTime: input.occurrence.schedule_start_time,
        scheduleEndTime: input.occurrence.schedule_end_time,
      }),
      TIMEZONE: input.behavior.timezone,
      TIMELINE_URL: buildTimelineUrl(),
    },
  };
}

function toBrowserPushReminderPayload(input: {
  behavior: Behavior | BehaviorWithCategory;
  occurrence: Occurrence;
}): BrowserPushReminderPayload {
  const scheduleLabel = formatOccurrenceScheduleLabel({
    scheduleKind: normalizeScheduleKind(input.occurrence.schedule_kind),
    schedulePreset: normalizeSchedulePreset(input.occurrence.schedule_preset),
    scheduleStartTime: input.occurrence.schedule_start_time,
    scheduleEndTime: input.occurrence.schedule_end_time,
  });

  return {
    title: formatBrowserPushReminderTitle(input.behavior.title),
    body: `Scheduled for ${scheduleLabel}.`,
    tag: `cadence-reminder-${input.occurrence.id}`,
    url: buildTimelineUrl(),
    icon: "/icons/cadence-notification-icon.png",
    badge: "/icons/cadence-notification-badge.png",
  };
}

function formatBrowserPushReminderTitle(title: string): string {
  const normalizedTitle = title.trim();

  return normalizedTitle.length > 0 ? normalizedTitle : "Behavior reminder";
}

function toReminderResolverBehavior(
  behavior: Behavior | BehaviorWithCategory,
  userId: string,
): ReminderResolverBehavior {
  return {
    id: behavior.id,
    userId,
    browserReminderEnabled: behavior.browser_reminder_enabled,
    emailReminderEnabled: behavior.email_reminder_enabled,
    reminderOffsetMinutes: behavior.reminder_offset_minutes,
  };
}

function resolveReminderDeliveriesForBehaviorOccurrences(
  behavior: Behavior | BehaviorWithCategory,
  userId: string,
  occurrences: Occurrence[],
): ResolvedReminderDelivery[] {
  const resolverBehavior = toReminderResolverBehavior(behavior, userId);

  return occurrences.flatMap((occurrence) =>
    resolveReminderDeliveries({
      behavior: resolverBehavior,
      occurrence: toReminderResolverOccurrence(occurrence),
    }),
  );
}

async function reconcileReminderDeliveries(
  supabase: AppSupabaseClient,
  userId: string,
  occurrences: Occurrence[],
  expected: ResolvedReminderDelivery[],
  now: Temporal.Instant,
): Promise<void> {
  const occurrenceIds = [
    ...new Set(occurrences.map((occurrence) => occurrence.id)),
  ];
  const existing = await listReminderDeliveriesByOccurrenceIds(
    supabase,
    userId,
    occurrenceIds,
  );
  const plan = resolveReminderDeliveryReconciliation({
    expected,
    now,
    existing: existing.map((delivery) => ({
      id: delivery.id,
      userId: delivery.user_id,
      occurrenceId: delivery.occurrence_id,
      channel: normalizeReminderChannel(delivery.channel),
      scheduledSendAt: delivery.scheduled_send_at,
      status: normalizeReminderDeliveryStatus(delivery.status),
      processingStartedAt: delivery.processing_started_at,
    })),
  });

  await Promise.all([
    cancelUnclaimedPendingReminderDeliveriesById(
      supabase,
      userId,
      plan.cancelIds,
    ),
    reactivateCancelledReminderDeliveriesById(
      supabase,
      userId,
      plan.reactivateIds,
    ),
    createMissingReminderDeliveries(
      supabase,
      plan.create.map(toNewReminderDelivery),
    ),
  ]);
}

function toReminderResolverOccurrence(
  occurrence: Occurrence,
): ReminderResolverOccurrence {
  return {
    id: occurrence.id,
    userId: occurrence.user_id,
    scheduledFor: effectiveStartAt(occurrence),
    status: normalizeOccurrenceStatus(occurrence.status),
  };
}

function toNewReminderDelivery(
  delivery: ReturnType<typeof resolveReminderDeliveries>[number],
): NewReminderDelivery {
  return {
    user_id: delivery.userId,
    occurrence_id: delivery.occurrenceId,
    channel: delivery.channel,
    scheduled_send_at: delivery.scheduledSendAt,
    status: delivery.status,
    sent_at: null,
    error: null,
  };
}

function normalizeOccurrenceStatus(value: string): OccurrenceStatus {
  if (value === "unresolved" || value === "completed" || value === "not_completed") {
    return value;
  }

  throw new Error(`Unsupported occurrence status: ${value}.`);
}

function normalizeReminderChannel(value: string): ReminderChannel {
  if (value === "browser_push" || value === "email") {
    return value;
  }

  throw new Error(`Unsupported reminder channel: ${value}.`);
}

function normalizeReminderDeliveryStatus(
  value: string,
): ReminderDeliveryStatus {
  if (
    value === "pending" ||
    value === "sent" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(`Unsupported reminder delivery status: ${value}.`);
}

function normalizeScheduleKind(value: string): "exact" | "range" {
  if (value === "exact" || value === "range") {
    return value;
  }

  throw new Error(`Unsupported schedule kind: ${value}.`);
}

function normalizeSchedulePreset(
  value: string | null,
): "morning" | "afternoon" | "evening" | "night" | null {
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

function normalizeProcessLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PROCESS_LIMIT;
  }

  if (!Number.isInteger(value) || value < 1) {
    return DEFAULT_PROCESS_LIMIT;
  }

  return Math.min(value, MAX_PROCESS_LIMIT);
}

function mergeProcessResults(
  first: ProcessDueRemindersResult,
  second: ProcessDueRemindersResult,
): ProcessDueRemindersResult {
  return {
    checked: first.checked + second.checked,
    claimed: first.claimed + second.claimed,
    skipped: first.skipped + second.skipped,
    sent: first.sent + second.sent,
    failed: first.failed + second.failed,
    cancelled: first.cancelled + second.cancelled,
  };
}

function buildTimelineUrl(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!siteUrl) {
    return "/timeline";
  }

  try {
    return new URL("/timeline", siteUrl).toString();
  } catch {
    return "/timeline";
  }
}

function errorToMessage(
  error: unknown,
  fallback = "Email reminder send failed.",
): string {
  return error instanceof Error ? error.message : fallback;
}
