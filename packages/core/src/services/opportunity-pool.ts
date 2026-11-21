import { Temporal } from "@js-temporal/polyfill";

import type { BehaviorGraphRecord } from "../behavior-store";
import { runFieldsFromStored } from "../resolvers/behavior-run.resolver";
import {
  briefMoveItemBlocks,
  resolveBriefMoveLength,
  type BriefMoveDayItem,
} from "../resolvers/brief-move.resolver";
import { isBehaviorInOpportunityPool, suggestDefaultOpportunitySlot } from "../resolvers/opportunity.resolver";
import type { TimelineOccurrenceView, TimelineOpportunityPoolItem, TimelineView } from "../types/timeline";
import { storedBehaviorWhere } from "./behavior-where";

/**
 * Behaviors of Opportunity: today's pool for the Timeline's Opportunity Basket. Each
 * Behavior gets a default start from today's open items under the shared free-slot rule.
 * Calendar events stay on the device, so a client that holds them can call
 * `suggestDefaultOpportunitySlot` again with those blocks added.
 */
export function resolveOpportunityPool(input: Readonly<{
  behaviors: readonly BehaviorGraphRecord[];
  timeline: TimelineView;
  now: Temporal.Instant;
  timezone: string;
}>): TimelineOpportunityPoolItem[] {
  const pool = input.behaviors.filter((behavior) => isBehaviorInOpportunityPool({
    ...runFieldsFromStored(behavior), isOpportunity: behavior.is_opportunity === true,
  }, input.now));
  if (pool.length === 0) return [];

  const today = input.timeline.todayLocalDate;
  const todayRows = input.timeline.daySections
    .filter((section) => section.localDate === today)
    .flatMap((section) => section.occurrences);
  const blocks = briefMoveItemBlocks(todayRows.flatMap((row) => dayItem(row, input.timeline, input.timezone)), null);
  const onToday = new Set(todayRows.map((row) => row.behaviorId));

  return pool.map((behavior) => {
    const lengthMinutes = lengthFor(behavior.id, behavior.default_duration_minutes ?? null, input.timeline).minutes;
    const slot = suggestDefaultOpportunitySlot({ localDate: today, timezone: input.timezone, now: input.now, lengthMinutes, blocks });
    const where = readWhere(behavior);
    return {
      behaviorId: behavior.id,
      title: behavior.title,
      categoryName: behavior.category?.name ?? "No category",
      defaultDurationMinutes: behavior.default_duration_minutes ?? null,
      whereKind: where.where_kind,
      locationText: where.location_text,
      onToday: onToday.has(behavior.id),
      suggestedStart: { startsAt: slot.startsAt.toString(), localTime: slot.localTime, source: slot.source },
      lengthMinutes,
    };
  }).sort((left, right) => left.title.localeCompare(right.title) || left.behaviorId.localeCompare(right.behaviorId));
}

function lengthFor(behaviorId: string, defaultMinutes: number | null, timeline: TimelineView) {
  const estimate = timeline.durationEstimates?.[behaviorId];
  return resolveBriefMoveLength({
    behaviorDefaultMinutes: defaultMinutes,
    loggedAverageSeconds: estimate?.kind === "known" ? estimate.seconds : null,
    estimateMinutes: null,
  });
}

function dayItem(row: TimelineOccurrenceView, timeline: TimelineView, timezone: string): BriefMoveDayItem[] {
  if (row.status !== "unresolved") return [];
  const start = Temporal.Instant.from(row.scheduledFor);
  // The estimate already folds in the Behavior's default duration.
  const length = lengthFor(row.behaviorId, null, timeline);
  const scheduleKind = row.scheduleKind === "range" && row.scheduleEndTime ? "range" : "exact";
  const end = scheduleKind === "range"
    ? rangeEnd(start, row.localDate, row.scheduleEndTime as string, timezone)
    : start.add({ minutes: length.minutes });
  return [{
    occurrenceId: row.id, behaviorId: row.behaviorId, title: row.title, status: row.status,
    localDate: row.localDate, scheduleKind, start, end, length, alongside: false,
    revision: row.revision ?? "", behaviorRevision: "",
  }];
}

function rangeEnd(start: Temporal.Instant, localDate: string, endTime: string, timezone: string): Temporal.Instant {
  const end = Temporal.PlainDate.from(localDate)
    .toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(endTime) }).toInstant();
  return Temporal.Instant.compare(end, start) > 0 ? end : end.add({ hours: 24 });
}

function readWhere(behavior: BehaviorGraphRecord): ReturnType<typeof storedBehaviorWhere> {
  try {
    return storedBehaviorWhere(behavior);
  } catch {
    return { where_kind: null, location_text: null };
  }
}
