import type { Temporal } from "@js-temporal/polyfill";
import type { PeriodCreateCommit, PeriodDataStore } from "@cadence/core/data-store";
import { PERIOD_LIMIT_MESSAGE } from "@cadence/core/services/period.service";
import { localCommand, localMutation } from "./local-store";

/**
 * Ticket 374 (D35): Periods in the local SQLite store. The native store enforces the cap
 * of 500 Periods and compares the revision on every edit and removal, as the hosted
 * functions do. Each write is one transaction with its outbox entry.
 */
export function createLocalPeriodStore(profileId: string, now: Temporal.Instant): PeriodDataStore {
  const fields = (input: PeriodCreateCommit) => ({ label: input.label, startOn: input.startOn, endOn: input.endOn, note: input.note });
  const mutation = () => localMutation(profileId, now.toString());
  return {
    listPeriods: (range) => localCommand("readPeriods", range
      ? { profileId, startLocalDate: range.from, endLocalDate: range.to }
      : { profileId }),
    getPeriod: (id) => localCommand("readPeriod", { profileId, periodId: id }),
    createPeriod: (input) => atLimit(localCommand("createPeriod", { ...mutation(), newId: crypto.randomUUID(), ...fields(input) })),
    createPeriodIfAbsent: (input) => atLimit(localCommand("createPeriodIfAbsent", { ...mutation(), newId: crypto.randomUUID(), ...fields(input) })),
    updatePeriod: (input) => localCommand("updatePeriod", {
      ...mutation(), periodId: input.id, expectedRevision: input.expectedRevision, ...fields(input) }),
    deletePeriod: (input) => localCommand("deletePeriod", { ...mutation(), periodId: input.id, expectedRevision: input.expectedRevision }),
  };
}

/** The native store reports the cap in the shared words; any wrapping around them is dropped. */
async function atLimit<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (errorText(error).includes(PERIOD_LIMIT_MESSAGE)) throw new Error(PERIOD_LIMIT_MESSAGE);
    throw error;
  }
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}
