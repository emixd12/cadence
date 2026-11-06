import { Temporal } from "@js-temporal/polyfill";
import {
  macLeaveReminderDigestFromId, planMacLeaveReminders,
  type MacLeaveReminderPending, type MacLeaveReminderRecord,
} from "@cadence/core/services/mac-leave-reminder-plan";
import type { DepartureStop, DepartureTrip } from "@cadence/core/types/departure";
import { notifications } from "./native-spike";

/**
 * Ticket 280 (decisions D3 and D15): native leave reminders from the Mac's last estimate. They
 * fire with Cadence quit, so there is no background helper and no route call of their own.
 * Separate from Behavior reminders: own identifiers, own state, and no part in coverage.
 */

/** What the Timeline's departure model knows now. Null trips mean no current plan. */
export type LeaveReminderDeparture = Readonly<{
  localDate: string;
  timezone: string;
  preparationSeconds: number;
  trips: readonly DepartureTrip[];
  stops: readonly DepartureStop[];
}>;

export type LeaveReminderReconcileInput = Readonly<{
  /** The linked account. Null on an unlinked Mac, which has no hosted travel and no leave reminders. */
  accountId: string | null;
  timezone: string;
  /** The hosted switch (Ticket 279). Throws when it cannot be read; the last known value is used. */
  loadEnabled: (() => Promise<boolean>) | null;
  departure: LeaveReminderDeparture | null;
  now?: Temporal.Instant;
}>;

/** Device-only memory: trip digests and times, never a title, place, position or duration. */
type Stored = Readonly<{ version: 1; accountId: string | null; enabled: boolean | null; records: readonly MacLeaveReminderRecord[] }>;
const STORAGE_KEY = "cadence.leave-reminders.v1";
const EMPTY: Stored = { version: 1, accountId: null, enabled: null, records: [] };

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function readLeaveReminderMemory(): Stored {
  try {
    const value = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "null") as Stored | null;
    if (!value || value.version !== 1 || !Array.isArray(value.records)) return EMPTY;
    const records = value.records.filter((record) => typeof record?.digest === "string" && /^[0-9a-f]{64}$/.test(record.digest)
      && typeof record.localDate === "string" && typeof record.reminderAt === "string" && typeof record.leaveAt === "string");
    return { version: 1, accountId: typeof value.accountId === "string" ? value.accountId : null,
      enabled: typeof value.enabled === "boolean" ? value.enabled : null, records };
  } catch { return EMPTY; }
}

function writeMemory(value: Stored) {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* The next reconcile plans again from macOS. */ }
}

let running: Promise<void> | undefined;
let queued: { input: LeaveReminderReconcileInput; result: Promise<void> } | undefined;

/** One reconcile at a time. Bursts share one pass after the running one, with the latest input. */
export function reconcileLeaveReminders(input: LeaveReminderReconcileInput): Promise<void> {
  if (queued) { queued.input = input; return queued.result; }
  if (running) {
    const next: { input: LeaveReminderReconcileInput; result: Promise<void> } = { input, result: running.catch(() => undefined).then(() => {
      queued = undefined;
      return start(next.input);
    }) };
    queued = next;
    return next.result;
  }
  return start(input);
}

function start(input: LeaveReminderReconcileInput): Promise<void> {
  const result = reconcile(input);
  running = result;
  const clear = () => { if (running === result) running = undefined; };
  void result.then(clear, clear);
  return result;
}

async function leavePending(): Promise<MacLeaveReminderPending[]> {
  const result = await notifications({ operation: "pending" });
  if (!result.pending) throw new Error("Pending reminder readback is unavailable.");
  return result.pending.filter(({ id }) => macLeaveReminderDigestFromId(id));
}

async function removeAll() {
  const pending = await leavePending();
  const delivered = await notifications({ operation: "delivered" });
  const ids = [...new Set([...pending.map(({ id }) => id), ...(delivered.delivered ?? []).map(({ id }) => id)
    .filter((id) => macLeaveReminderDigestFromId(id))])];
  for (let index = 0; index < ids.length; index += 512) await notifications({ operation: "cancel", ids: ids.slice(index, index + 512) });
}

async function reconcile(input: LeaveReminderReconcileInput): Promise<void> {
  const now = input.now ?? Temporal.Now.instant();
  let memory = readLeaveReminderMemory();
  if (memory.accountId !== input.accountId) {
    // Another account's reminders, or an unlinked Mac: nothing from before may fire.
    await removeAll();
    memory = { ...EMPTY, accountId: input.accountId };
    writeMemory(memory);
  }
  if (!input.accountId || !input.loadEnabled) return;
  let enabled = memory.enabled;
  try { enabled = await input.loadEnabled(); } catch { /* Offline: keep the last known switch. */ }
  if (enabled === null) return;
  if (enabled !== memory.enabled) { memory = { ...memory, enabled }; writeMemory(memory); }

  const permission = (await notifications({ operation: "status" })).authorization;
  const allowed = permission === "authorized" || permission === "provisional";
  const pending = await leavePending();
  const plan = planMacLeaveReminders({ now: now.toString(), timezone: input.timezone, enabled,
    preparationSeconds: input.departure?.preparationSeconds ?? 0,
    departure: input.departure ? { localDate: input.departure.localDate, trips: input.departure.trips, stops: input.departure.stops } : null,
    records: memory.records, pending });
  if (plan.removeAll) {
    await removeAll();
    writeMemory({ ...memory, records: [] });
    return;
  }
  if (plan.cancelPending.length) await notifications({ operation: "cancelPending", ids: [...plan.cancelPending] });
  const failed = new Set<string>();
  if (plan.schedule.length && allowed) {
    const result = await notifications({ operation: "schedule", reminders: plan.schedule.map(({ id, title, body, fireAt }) => ({ id, title, body, fireAt })) });
    for (const id of [...(result.missingIds ?? []), ...(result.errors ?? []).map((error) => error.id)]) failed.add(id);
  } else for (const { id } of plan.schedule) failed.add(id);
  // A request macOS did not keep is planned again next time: its record returns to what it was.
  const previous = new Map(memory.records.map((record) => [record.digest, record]));
  const failedDigests = new Set(plan.schedule.filter(({ id }) => failed.has(id)).map(({ digest }) => digest));
  const records = plan.records.flatMap((record) => !failedDigests.has(record.digest) ? [record]
    : previous.has(record.digest) ? [previous.get(record.digest)!] : []);
  writeMemory({ ...memory, records });
}

/** Test seam: forget queued work and device memory. */
export function resetLeaveRemindersForTest() {
  running = undefined;
  queued = undefined;
  try { storage()?.removeItem(STORAGE_KEY); } catch { /* No storage in this runtime. */ }
}
