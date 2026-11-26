import type { PeriodDataStore } from "../data-store";
import {
  PERIOD_LIMITS,
  PERIOD_MESSAGES,
  comparePeriods,
  parsePeriodLocalDate,
  periodsOverlappingRange,
  resolvePeriodCreate,
  resolvePeriodEnd,
  resolvePeriodRange,
  resolvePeriodRevision,
  resolvePeriodUpdate,
  type PeriodChanges,
  type PeriodCreateInput,
  type PeriodRecord,
} from "../resolvers/period.resolver";

export const PERIOD_CONFLICT_MESSAGE =
  "This period changed elsewhere. Review the latest version before saving again.";

export const PERIOD_LIMIT_MESSAGE =
  `You have reached the limit of ${PERIOD_LIMITS.perAccount} periods. Remove one before adding another.`;

export type PeriodWriteResult = Readonly<{
  period: PeriodRecord;
  /** False when the write matched the stored Period and nothing was saved. */
  changed: boolean;
}>;

export type PeriodDeleteResult = Readonly<{ id: string }>;

export type PeriodUpdateInput = PeriodChanges & Readonly<{
  id: unknown;
  /** The revision the caller last read: a number, or digits from a form field. */
  expectedRevision: unknown;
}>;

export type PeriodTargetInput = Readonly<{ id: unknown; expectedRevision: unknown }>;

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(PERIOD_MESSAGES.revisionInvalid);
  return value.trim();
}

/**
 * Every Period of the account in display order, or with a range only those with a
 * day inside it. A range is limited to 366 days unless `maxDays` says otherwise.
 */
export async function listPeriods(
  store: Pick<PeriodDataStore, "listPeriods">,
  range?: Readonly<{ from: unknown; to: unknown }>,
  options: Readonly<{ maxDays?: number | null }> = {},
): Promise<PeriodRecord[]> {
  if (!range) return [...await store.listPeriods()].sort(comparePeriods);
  const resolved = resolvePeriodRange(range, options);
  return periodsOverlappingRange(await store.listPeriods(resolved), resolved.from, resolved.to);
}

/** Adds a Period. The store refuses the write when the account is at the cap. */
export async function createPeriod(
  store: Pick<PeriodDataStore, "createPeriod">,
  input: PeriodCreateInput,
): Promise<PeriodWriteResult> {
  const plan = resolvePeriodCreate(input);
  return { period: await store.createPeriod(plan), changed: true };
}

/**
 * Edits a Period. Only the fields present in the input change. Throws the conflict
 * message when the Period is gone or its revision is not the one the caller read.
 */
export async function updatePeriod(
  store: Pick<PeriodDataStore, "getPeriod" | "updatePeriod">,
  input: PeriodUpdateInput,
): Promise<PeriodWriteResult> {
  const { id, expectedRevision: readRevision, ...changes } = input;
  const expectedRevision = resolvePeriodRevision(readRevision);
  const current = await store.getPeriod(requireId(id));
  if (!current || current.revision !== expectedRevision) throw new Error(PERIOD_CONFLICT_MESSAGE);
  const plan = resolvePeriodUpdate({ period: current, expectedRevision, changes });
  if (!plan.changed) return { period: current, changed: false };
  return commitUpdate(store, plan);
}

/**
 * "End today": sets the last day to `today`, the account's local date at the time
 * of the write. Throws when the Period has not started or has already ended.
 */
export async function endPeriod(
  store: Pick<PeriodDataStore, "getPeriod" | "updatePeriod">,
  input: PeriodTargetInput & Readonly<{ today: string }>,
): Promise<PeriodWriteResult> {
  const today = parsePeriodLocalDate(input.today);
  const expectedRevision = resolvePeriodRevision(input.expectedRevision);
  const current = await store.getPeriod(requireId(input.id));
  if (!current || current.revision !== expectedRevision) throw new Error(PERIOD_CONFLICT_MESSAGE);
  return commitUpdate(store, resolvePeriodEnd({ period: current, today, expectedRevision }));
}

/** Removes a Period for good. Throws the conflict message when it changed or is gone. */
export async function deletePeriod(
  store: Pick<PeriodDataStore, "deletePeriod">,
  input: PeriodTargetInput,
): Promise<PeriodDeleteResult> {
  const id = requireId(input.id);
  const expectedRevision = resolvePeriodRevision(input.expectedRevision);
  const deletedId = await store.deletePeriod({ id, expectedRevision });
  if (!deletedId) throw new Error(PERIOD_CONFLICT_MESSAGE);
  return { id: deletedId };
}

async function commitUpdate(
  store: Pick<PeriodDataStore, "updatePeriod">,
  plan: ReturnType<typeof resolvePeriodUpdate>,
): Promise<PeriodWriteResult> {
  const period = await store.updatePeriod({
    id: plan.id,
    expectedRevision: plan.expectedRevision,
    label: plan.label,
    startOn: plan.startOn,
    endOn: plan.endOn,
    note: plan.note,
  });
  if (!period) throw new Error(PERIOD_CONFLICT_MESSAGE);
  return { period, changed: true };
}
