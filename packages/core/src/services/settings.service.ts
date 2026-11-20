import type { BehaviorGraphRecord } from "../behavior-store";
import { planBehaviorConfigurationChangeEvent } from "../resolvers/behavior-configuration.resolver";
import { Temporal } from "@js-temporal/polyfill";
import { reexpressPastStops, runFieldsFromStored } from "../resolvers/behavior-run.resolver";
import { toBehaviorConfigurationSnapshot, toStoredBehaviorScheduleGraph } from "./behavior.service";

export class TimezoneSettingsUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimezoneSettingsUserError";
  }
}

export function normalizeTimezoneInput(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TimezoneSettingsUserError("Enter an IANA timezone.");
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    throw new TimezoneSettingsUserError("Enter a valid IANA timezone.");
  }
}

/**
 * A Settings timezone change moves every active Behavior. An end or a pause start
 * that already happened is re-expressed in the new timezone so its moment stays
 * (rule T1); one still to come keeps its wall-clock time. `run` carries the stored
 * end and pause start the change writes.
 */
export function planProfileTimezoneChange(
  behaviors: BehaviorGraphRecord[], timezone: string, recordedAt: string,
) {
  const now = Temporal.Instant.from(recordedAt);
  return behaviors.filter((behavior) => behavior.active).map((behavior) => {
    const schedules = toStoredBehaviorScheduleGraph(behavior);
    const previous = toBehaviorConfigurationSnapshot(behavior, schedules);
    const stops = reexpressPastStops(runFieldsFromStored(behavior), timezone, now);
    const run = {
      end_on: stops.endOn, end_time: stops.endTime,
      pause_from_on: stops.pauseFromOn, pause_from_time: stops.pauseFromTime,
    };
    return {
      behaviorId: behavior.id,
      expectedUpdatedAt: behavior.updated_at,
      run,
      configurationEventPlan: planBehaviorConfigurationChangeEvent({
        previousConfiguration: previous,
        nextConfiguration: toBehaviorConfigurationSnapshot({ ...behavior, ...run, timezone }, schedules),
        recordedAt, effectiveAt: recordedAt, source: "manual", reasonCode: "timezone_changed",
      }),
    };
  });
}
