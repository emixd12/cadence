import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorRecord } from "../behavior-store";
import type { OccurrenceRecord } from "../data-store";
import { resolveReminderDeliveries } from "./reminder.resolver";
import { effectiveStartAt, isMoved } from "./time.resolver";
import { formatOccurrenceScheduleLabel } from "../services/schedule";
import { normalizeScheduleKind, normalizeSchedulePreset } from "../services/occurrence-generation";
import { normalizeOccurrenceStatus } from "../services/occurrence.service";

export type NativeReminderRequest = Readonly<{
  id: string;
  title: string;
  body: string;
  fireAt: string;
}>;

export type NativeReminderPendingRequest = Readonly<
  Omit<NativeReminderRequest, "fireAt"> & { fireAt: string | null }
>;

export type NativeReminderCoverage = Readonly<{
  status: "complete" | "limited" | "unverified";
  scheduledThrough: string;
  firstUnscheduledAt: string | null;
  expectedCount: number;
  scheduledCount: number;
  missingIds: string[];
}>;

type NativeReminderWindow = {
  requests: readonly NativeReminderRequest[];
  now: Temporal.Instant;
  targetThrough: Temporal.Instant;
};

export function resolveNativeReminderGenerationHorizon(behaviors: BehaviorRecord[]) {
  let maxOffset = 0;
  let unsupportedOffset = false;
  for (const behavior of behaviors) {
    if (!behavior.active || !behavior.browser_reminder_enabled) continue;
    const offset = behavior.reminder_offset_minutes;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 527_040) unsupportedOffset = true;
    else maxOffset = Math.max(maxOffset, offset);
  }
  // ponytail: bound imported offsets to one year; stream larger windows if ever supported.
  // Tracking stays available even when reminder coverage cannot be planned.
  return { horizonDays: 31 + Math.ceil((unsupportedOffset ? 0 : maxOffset) / 1440), unsupportedOffset };
}

export function planNativeReminderRequests(input: {
  behaviors: BehaviorRecord[]; occurrences: OccurrenceRecord[];
  now: Temporal.Instant; targetThrough: Temporal.Instant;
}): NativeReminderRequest[] {
  const behaviors = new Map(input.behaviors.map((behavior) => [behavior.id, behavior]));
  const requests: NativeReminderRequest[] = [];
  for (const occurrence of input.occurrences) {
    const behavior = behaviors.get(occurrence.behavior_id);
    if (!behavior?.active) continue;
    const deliveries = resolveReminderDeliveries({
      behavior: { id: behavior.id, userId: behavior.user_id,
        browserReminderEnabled: behavior.browser_reminder_enabled,
        emailReminderEnabled: false, reminderOffsetMinutes: behavior.reminder_offset_minutes },
      occurrence: { id: occurrence.id, userId: occurrence.user_id,
        // Advisor plan, Phase 2: a moved Occurrence reminds at its moved time.
        status: normalizeOccurrenceStatus(occurrence.status), scheduledFor: effectiveStartAt(occurrence) },
    });
    const delivery = deliveries[0];
    if (!delivery) continue;
    const schedule = formatOccurrenceScheduleLabel({
      scheduleKind: normalizeScheduleKind(occurrence.schedule_kind),
      schedulePreset: normalizeSchedulePreset(occurrence.schedule_preset),
      scheduleStartTime: occurrence.schedule_start_time, scheduleEndTime: occurrence.schedule_end_time,
    });
    requests.push({ id: `cadence.local.${occurrence.id}`, title: behavior.title.trim() || "Behavior reminder",
      body: isMoved(occurrence) ? `Moved for today. Planned for ${schedule}.` : `Scheduled for ${schedule}.`, fireAt: delivery.scheduledSendAt });
  }
  return selectNativeReminderRequests({ ...input, requests, capacity: requests.length });
}

export function selectNativeReminderRequests(
  input: NativeReminderWindow & { capacity: number },
): NativeReminderRequest[] {
  if (!Number.isSafeInteger(input.capacity) || input.capacity < 0) {
    throw new Error("Native reminder capacity must be a non-negative safe integer.");
  }

  return eligibleRequests(input).slice(0, input.capacity);
}

export function assessNativeReminderCoverage(
  input: NativeReminderWindow & {
    pending: readonly NativeReminderPendingRequest[] | null;
  },
): NativeReminderCoverage {
  const expected = eligibleRequests(input);
  assertUniqueIds(input.pending ?? []);
  const pendingById = new Map(
    (input.pending ?? []).map((request) => [
      request.id,
      {
        ...request,
        fireAt: request.fireAt === null
          ? null
          : Temporal.Instant.from(request.fireAt).toString(),
      },
    ]),
  );
  const missing = expected.filter((request) => {
    const pending = pendingById.get(request.id);
    return !pending || pending.fireAt !== request.fireAt ||
      pending.title !== request.title || pending.body !== request.body;
  });
  const firstMissing = missing[0];
  const status = input.pending === null
    ? "unverified"
    : missing.length > 0 ? "limited" : "complete";
  let scheduledThrough = input.now.toString();

  if (status === "complete") {
    scheduledThrough = input.targetThrough.toString();
  } else if (firstMissing) {
    for (const request of expected) {
      if (Temporal.Instant.compare(request.fireAt, firstMissing.fireAt) >= 0) {
        break;
      }
      scheduledThrough = request.fireAt;
    }
  }

  return {
    status,
    scheduledThrough,
    firstUnscheduledAt: firstMissing?.fireAt ?? null,
    expectedCount: expected.length,
    scheduledCount: expected.length - missing.length,
    missingIds: missing.map(({ id }) => id),
  };
}

function eligibleRequests(input: NativeReminderWindow): NativeReminderRequest[] {
  if (Temporal.Instant.compare(input.targetThrough, input.now) < 0) {
    throw new Error("Native reminder horizon cannot precede now.");
  }
  assertUniqueIds(input.requests);
  const eligible: { request: NativeReminderRequest; epochMilliseconds: number }[] = [];

  for (const request of input.requests) {
    const instant = Temporal.Instant.from(request.fireAt);
    if (Temporal.Instant.compare(instant, input.now) <= 0) continue;

    // Native calendar triggers retain seconds. Rounding upward prevents early delivery.
    const canonical = instant.round({ smallestUnit: "second", roundingMode: "ceil" });
    if (Temporal.Instant.compare(canonical, input.targetThrough) <= 0) {
      eligible.push({ request: { ...request, fireAt: canonical.toString() }, epochMilliseconds: canonical.epochMilliseconds });
    }
  }

  // Parse each timestamp once. Sort comparisons must not rebuild Temporal objects.
  return eligible.sort((left, right) =>
    left.epochMilliseconds - right.epochMilliseconds ||
    (left.request.id < right.request.id ? -1 : left.request.id > right.request.id ? 1 : 0),
  ).map(({ request }) => request);
}

function assertUniqueIds(requests: readonly { id: string }[]): void {
  const ids = new Set<string>();
  for (const { id } of requests) {
    if (typeof id !== "string" || id.trim().length === 0 || ids.has(id)) {
      throw new Error("Native reminder request IDs must be nonempty and unique.");
    }
    ids.add(id);
  }
}
