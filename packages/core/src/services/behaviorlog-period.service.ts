import type { PeriodDataStore } from "../data-store";
import {
  planBehaviorLogPeriodWrites,
  previewBehaviorLogPeriodOutcome,
  readBehaviorLogPeriodReviews,
  unavailableBehaviorLogPeriodOutcome,
  type BehaviorLogPeriodMode,
  type BehaviorLogPeriodOutcome,
  type BehaviorLogPeriodPlan,
} from "../resolvers/behaviorlog-period.resolver";
import { PERIOD_LIMIT_MESSAGE } from "./period.service";

type BundleFile = Readonly<{ path: string; content: string }>;

/** `setNotes: false` keeps every stored note (retried restore). */
export type BehaviorLogPeriodOptions = Readonly<{ setNotes?: boolean }>;

/**
 * Ticket 373: plans Period writes for a BehaviorLog import or restore against
 * every stored Period of the account. Returns null when the bundle has no Cadence
 * Periods. Never log a plan: it holds labels and notes.
 */
export async function planBehaviorLogPeriods(
  store: Pick<PeriodDataStore, "listPeriods">,
  files: readonly BundleFile[],
  mode: BehaviorLogPeriodMode,
  options: BehaviorLogPeriodOptions = {},
): Promise<BehaviorLogPeriodPlan | null> {
  const read = readBehaviorLogPeriodReviews(files);
  if (!read.periods.length && !read.skipped.length) return null;
  // No range: the cap counts every Period, and a match can lie anywhere.
  const existing = read.periods.length ? await store.listPeriods() : [];
  return planBehaviorLogPeriodWrites({ read, existing, mode, setNotes: options.setNotes });
}

export async function previewBehaviorLogPeriods(
  store: Pick<PeriodDataStore, "listPeriods">,
  files: readonly BundleFile[],
  mode: BehaviorLogPeriodMode,
  options: BehaviorLogPeriodOptions = {},
): Promise<BehaviorLogPeriodOutcome | null> {
  let plan: BehaviorLogPeriodPlan | null;
  try {
    plan = await planBehaviorLogPeriods(store, files, mode, options);
  } catch {
    return unavailableBehaviorLogPeriodOutcome(mode);
  }
  return plan ? previewBehaviorLogPeriodOutcome(plan) : null;
}

/**
 * Saves planned Periods after the main import or restore commits. It plans again
 * from the stored Periods, so a repeated call adds nothing twice. A Period the
 * store refuses at the account cap is counted as not fitting. A note is set with a
 * compare-and-set on the revision; a Period that changed since the plan is counted
 * as failed and left as it is. This function never throws: a failed write is
 * counted and does not undo the committed import, and a failed read of the stored
 * Periods returns an unavailable outcome.
 */
export async function applyBehaviorLogPeriods(
  store: Pick<PeriodDataStore, "listPeriods" | "createPeriod" | "updatePeriod">,
  files: readonly BundleFile[],
  mode: BehaviorLogPeriodMode,
  options: BehaviorLogPeriodOptions = {},
): Promise<BehaviorLogPeriodOutcome | null> {
  let plan: BehaviorLogPeriodPlan | null;
  try {
    plan = await planBehaviorLogPeriods(store, files, mode, options);
  } catch {
    return unavailableBehaviorLogPeriodOutcome(mode);
  }
  if (!plan) return null;
  const outcome = { mode, unavailable: false, added: 0, notesSet: 0, existing: 0, overLimit: 0, failed: 0, skippedCount: plan.skipped.length };
  let capReached = false;
  for (const action of plan.actions) {
    if (action.action === "keep") {
      outcome.existing++;
      continue;
    }
    if (action.action === "over_limit" || (action.action === "create" && capReached)) {
      outcome.overLimit++;
      continue;
    }
    try {
      if (action.action === "create") {
        await store.createPeriod({ label: action.label, startOn: action.startOn, endOn: action.endOn, note: action.note });
        outcome.added++;
        continue;
      }
      const updated = await store.updatePeriod({
        id: action.existing!.id,
        expectedRevision: action.existing!.revision,
        label: action.label,
        startOn: action.startOn,
        endOn: action.endOn,
        note: action.note,
      });
      outcome.existing++;
      if (updated) outcome.notesSet++;
      else outcome.failed++;
    } catch (error) {
      // Another writer filled the account between the plan and this save.
      if (action.action === "create" && error instanceof Error && error.message === PERIOD_LIMIT_MESSAGE) {
        capReached = true;
        outcome.overLimit++;
      } else {
        if (action.action === "set_note") outcome.existing++;
        outcome.failed++;
      }
    }
  }
  return outcome;
}
