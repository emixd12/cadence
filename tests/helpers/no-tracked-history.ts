import { Temporal } from "@js-temporal/polyfill";
import { resolveBehaviorDurationEstimate } from "@cadence/core/resolvers/timeline-context.resolver";
import type { BehaviorLengthInput } from "@/lib/services/behavior-length.service";

/**
 * A stand-in for `readBehaviorLengths` in tests whose fake database holds no tracked
 * history: the real length order (Ticket 366) with zero tracked completions.
 */
export async function readBehaviorLengthsWithoutHistory(_client: unknown, input: Readonly<{ behaviors: readonly BehaviorLengthInput[] }>) {
  return new Map(input.behaviors.map((behavior) => [behavior.id, resolveBehaviorDurationEstimate({
    behaviorId: behavior.id, defaultDurationMinutes: behavior.defaultDurationMinutes,
    descriptionEstimateMinutes: behavior.estimateMinutes ?? null,
    occurrences: [], now: Temporal.Instant.from("2026-11-25T17:00:00Z"), timezone: "America/New_York",
  })]));
}
