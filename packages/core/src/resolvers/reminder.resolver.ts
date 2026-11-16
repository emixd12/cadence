import { Temporal } from "@js-temporal/polyfill";

import type {
  OccurrenceStatus,
  ReminderChannel,
  ReminderDeliveryStatus,
} from "../types/database";

export type ReminderResolverBehavior = {
  id: string;
  userId: string;
  browserReminderEnabled: boolean;
  emailReminderEnabled: boolean;
  reminderOffsetMinutes: number;
};

export type ReminderResolverOccurrence = {
  id: string;
  userId: string;
  /** Effective start (`effectiveStartAt`): where the Occurrence sits today, after any per-day move. */
  scheduledFor: string;
  status: OccurrenceStatus;
};

export type ResolvedReminderDelivery = {
  userId: string;
  occurrenceId: string;
  channel: ReminderChannel;
  scheduledSendAt: string;
  status: Extract<ReminderDeliveryStatus, "pending">;
};

export type ReminderDeliveryCancellation = {
  cancelPending: boolean;
  reason: "occurrence_resolved" | null;
};

export type ExistingReminderDeliveryForReconciliation = {
  id: string;
  userId: string;
  occurrenceId: string;
  channel: ReminderChannel;
  scheduledSendAt: string;
  status: ReminderDeliveryStatus;
  processingStartedAt: string | null;
};

export type ReminderDeliveryReconciliation = {
  create: ResolvedReminderDelivery[];
  reactivateIds: string[];
  cancelIds: string[];
};

export function resolveReminderDeliveries(input: {
  behavior: ReminderResolverBehavior;
  occurrence: ReminderResolverOccurrence;
}): ResolvedReminderDelivery[] {
  assertSameUser(input.behavior, input.occurrence);

  if (input.occurrence.status !== "unresolved") {
    return [];
  }

  const channels = resolveReminderChannels(input.behavior);

  if (channels.length === 0) {
    return [];
  }

  const scheduledSendAt = Temporal.Instant.from(input.occurrence.scheduledFor)
    .subtract({
      minutes: normalizeReminderOffset(input.behavior.reminderOffsetMinutes),
    })
    .toString();

  return channels.map((channel) => ({
    userId: input.occurrence.userId,
    occurrenceId: input.occurrence.id,
    channel,
    scheduledSendAt,
    status: "pending",
  }));
}

export function resolveReminderDeliveryCancellation(input: {
  occurrence: Pick<ReminderResolverOccurrence, "status">;
}): ReminderDeliveryCancellation {
  if (input.occurrence.status === "unresolved") {
    return {
      cancelPending: false,
      reason: null,
    };
  }

  return {
    cancelPending: true,
    reason: "occurrence_resolved",
  };
}

export function resolveReminderDeliveryReconciliation(input: {
  expected: ResolvedReminderDelivery[];
  existing: ExistingReminderDeliveryForReconciliation[];
  now: Temporal.Instant;
}): ReminderDeliveryReconciliation {
  const expectedByIdentity = new Map(
    input.expected.map((delivery) => [
      reminderDeliveryIdentity(delivery),
      delivery,
    ]),
  );
  const existingIdentities = new Set(
    input.existing.map(reminderDeliveryIdentity),
  );
  const reactivateIds: string[] = [];
  const cancelIds: string[] = [];

  for (const delivery of input.existing) {
    const isExpected = expectedByIdentity.has(reminderDeliveryIdentity(delivery));
    const isFuture = isScheduledAfter(delivery.scheduledSendAt, input.now);

    if (isExpected && delivery.status === "cancelled" && isFuture) {
      reactivateIds.push(delivery.id);
      continue;
    }

    if (
      !isExpected &&
      delivery.status === "pending" &&
      delivery.processingStartedAt === null &&
      isFuture
    ) {
      cancelIds.push(delivery.id);
    }
  }

  return {
    create: input.expected.filter(
      (delivery) =>
        isScheduledAfter(delivery.scheduledSendAt, input.now) &&
        !existingIdentities.has(reminderDeliveryIdentity(delivery)),
    ),
    reactivateIds,
    cancelIds,
  };
}

function isScheduledAfter(
  scheduledSendAt: string,
  now: Temporal.Instant,
): boolean {
  return Temporal.Instant.compare(
    Temporal.Instant.from(scheduledSendAt),
    now,
  ) > 0;
}

function resolveReminderChannels(
  behavior: ReminderResolverBehavior,
): ReminderChannel[] {
  const channels: ReminderChannel[] = [];

  if (behavior.browserReminderEnabled) {
    channels.push("browser_push");
  }

  if (behavior.emailReminderEnabled) {
    channels.push("email");
  }

  return channels;
}

function normalizeReminderOffset(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Reminder offset must be a non-negative integer.");
  }

  return value;
}

function assertSameUser(
  behavior: ReminderResolverBehavior,
  occurrence: ReminderResolverOccurrence,
): void {
  if (behavior.userId !== occurrence.userId) {
    throw new Error("Reminder behavior and occurrence must belong to the same user.");
  }
}

function reminderDeliveryIdentity(delivery: {
  userId: string;
  occurrenceId: string;
  channel: ReminderChannel;
  scheduledSendAt: string;
}): string {
  return [
    delivery.userId,
    delivery.occurrenceId,
    delivery.channel,
    Temporal.Instant.from(delivery.scheduledSendAt).toString(),
  ].join("\u0000");
}
