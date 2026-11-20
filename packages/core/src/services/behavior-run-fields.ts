import { Temporal } from "@js-temporal/polyfill";
import type { BehaviorLogImportBehaviorRun } from "../types/behaviorlog-import";

/** The stored end and pause columns. */
export type StoredBehaviorRunColumns = {
  end_on: string | null;
  end_time: string | null;
  pause_from_on: string | null;
  pause_from_time: string | null;
  pause_back_on: string | null;
};

export const BEHAVIOR_RUN_COLUMNS = ["end_on", "end_time", "pause_from_on", "pause_from_time", "pause_back_on"] as const;

/** Stored columns from an import or restore plan's run fields. */
export function storedRunColumns(run: BehaviorLogImportBehaviorRun): StoredBehaviorRunColumns {
  return {
    end_on: run.endOn,
    end_time: run.endTime,
    pause_from_on: run.pauseFromOn,
    pause_from_time: run.pauseFromTime,
    pause_back_on: run.pauseBackOn,
  };
}

/**
 * The end and pause of a full JSON Behavior record. A record written before Ended and
 * Paused carries `end_date`, the first day the Behavior no longer ran: it reads as
 * `end_on` the day before (rule T9). Returns an empty object when the record carries
 * none of the fields, so a restore keeps what is stored.
 */
export function storedRunColumnsFromJson(source: Readonly<Record<string, unknown>>): Partial<StoredBehaviorRunColumns> {
  if (BEHAVIOR_RUN_COLUMNS.some((column) => source[column] !== undefined)) {
    return Object.fromEntries(BEHAVIOR_RUN_COLUMNS.map((column) => {
      const value = source[column];
      return [column, typeof value === "string" && value.length > 0 ? value : null];
    })) as StoredBehaviorRunColumns;
  }
  if (source.end_date === undefined) return {};
  return { ...legacyEndDateColumns(typeof source.end_date === "string" ? source.end_date : null) };
}

/** `end_date` (first day not running) as stored columns (last day running). */
export function legacyEndDateColumns(endDate: string | null): StoredBehaviorRunColumns {
  return {
    end_on: endDate && endDate > "0001-01-01" ? Temporal.PlainDate.from(endDate).subtract({ days: 1 }).toString() : null,
    end_time: null,
    pause_from_on: null,
    pause_from_time: null,
    pause_back_on: null,
  };
}
