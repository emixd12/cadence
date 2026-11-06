import { Temporal } from "@js-temporal/polyfill";

import { sha256 } from "../hash";
import type { DepartureStop, DepartureTrip } from "../types/departure";
import { departurePhraseContext, macLeaveReminderPhrases, type MacLeaveReminderStart } from "./departure-phrases";

/**
 * Ticket 280 (decisions D3 and D15): the Mac's native leave reminders, planned from its last
 * estimate. `docs/NOTIFICATION_SPEC.md`, "Mac: native notifications", has the rules. Pure: `now`
 * is injected, and nothing here reads a clock, storage or macOS. The hosted job's planner is
 * `leave-reminder-plan.ts` (Ticket 277); the two share only the rules, not records.
 */

/** Native identifiers: `cadence.leave.<trip digest>` and `cadence.leave.<trip digest>.update`. */
export const MAC_LEAVE_REMINDER_PREFIX = "cadence.leave.";
export const MAC_LEAVE_REMINDER_UPDATE_SUFFIX = ".update";
/** A reminder whose time has passed fires this long after planning, so macOS accepts it as a future instant. */
export const MAC_LEAVE_REMINDER_IMMEDIATE_SECONDS = 10;
/** Decision D15: one update, only when the leave time moves at least this much earlier. */
export const MAC_LEAVE_REMINDER_UPDATE_MIN_EARLIER_SECONDS = 10 * 60;

const IDENTIFIER = /^cadence\.leave\.([0-9a-f]{64})(\.update)?$/;

/**
 * What the Mac remembers about one trip's reminder, on this device only. No title, place,
 * position or duration: the trip is a digest, and the times say when the reminder fires and
 * which leave time it named.
 */
export type MacLeaveReminderRecord = Readonly<{
  digest: string;
  localDate: string;
  /** When the scheduled reminder fires. Once passed, the reminder counts as sent. */
  reminderAt: string;
  /** The leave time the reminder names. The update compares with it. */
  leaveAt: string;
  /** The one update, once scheduled. */
  update: Readonly<{ fireAt: string; leaveAt: string }> | null;
}>;

export type MacLeaveReminderRequest = Readonly<{ id: string; title: string; body: string; fireAt: string }>;

/** A pending native request with a leave reminder identifier. */
export type MacLeaveReminderPending = Readonly<{ id: string; title: string; body: string; fireAt: string | null }>;

export type MacLeaveReminderPlan = Readonly<{
  /** Requests to add. A request with a pending identifier replaces it. */
  schedule: ReadonlyArray<MacLeaveReminderRequest & Readonly<{ digest: string }>>;
  /** Pending identifiers to remove. */
  cancelPending: readonly string[];
  /** Remove every leave reminder, pending and delivered: reminders are off. */
  removeAll: boolean;
  /** The records once every request above is scheduled. */
  records: readonly MacLeaveReminderRecord[];
}>;

/** One trip is one destination at one start time. A moved event is a new trip. */
export function macLeaveReminderDigest(destinationRef: string, startAt: string): string {
  return sha256(`${destinationRef}\n${Temporal.Instant.from(startAt).toString()}`);
}

export function macLeaveReminderId(digest: string, update = false): string {
  return `${MAC_LEAVE_REMINDER_PREFIX}${digest}${update ? MAC_LEAVE_REMINDER_UPDATE_SUFFIX : ""}`;
}

/** The trip digest a leave reminder identifier names, or null for any other identifier. */
export function macLeaveReminderDigestFromId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  return IDENTIFIER.exec(id)?.[1] ?? null;
}

type Candidate = Readonly<{ digest: string; trip: DepartureTrip; stop: DepartureStop; leaveAt: Temporal.Instant }>;

/**
 * Trips that get a reminder: a known leave time still ahead, on the way to an event or a
 * Behavior. The trip home gets none (decision D15).
 */
function candidates(trips: readonly DepartureTrip[], stops: readonly DepartureStop[], now: Temporal.Instant): Candidate[] {
  const byRef = new Map(stops.map((stop) => [stop.ref, stop]));
  const result: Candidate[] = [];
  const seen = new Set<string>();
  for (const trip of trips) {
    if (trip.role === "return" || !trip.destinationRef || !trip.leaveAt || !trip.arriveAt || !trip.checkedAt || !trip.mode) continue;
    const stop = byRef.get(trip.destinationRef);
    if (!stop) continue;
    const leaveAt = Temporal.Instant.from(trip.leaveAt);
    if (Temporal.Instant.compare(leaveAt, now) <= 0) continue;
    const digest = macLeaveReminderDigest(trip.destinationRef, stop.startAt);
    if (seen.has(digest)) continue;
    seen.add(digest);
    result.push({ digest, trip, stop, leaveAt });
  }
  return result;
}

function start(trip: DepartureTrip): MacLeaveReminderStart {
  if (trip.fromHome) return "home";
  return trip.originRef ? "previous_stop" : "position";
}

/**
 * Plans one reconcile. `departure` is null when no current plan is known, such as at launch
 * before travel loads: what is scheduled stays. A plan for another local date counts as unknown.
 */
export function planMacLeaveReminders(input: Readonly<{
  now: string;
  timezone: string;
  enabled: boolean;
  preparationSeconds: number;
  departure: Readonly<{ localDate: string; trips: readonly DepartureTrip[]; stops: readonly DepartureStop[] }> | null;
  records: readonly MacLeaveReminderRecord[];
  pending: readonly MacLeaveReminderPending[];
}>): MacLeaveReminderPlan {
  const now = Temporal.Instant.from(input.now);
  const today = now.toZonedDateTimeISO(input.timezone).toPlainDate().toString();
  const pending = input.pending.filter((request) => macLeaveReminderDigestFromId(request.id));
  if (!input.enabled) return { schedule: [], cancelPending: pending.map(({ id }) => id), removeAll: true, records: [] };

  const pendingById = new Map(pending.map((request) => [request.id, request]));
  const cancel = new Set<string>();
  const current = input.records.filter((record) => record.localDate === today);
  for (const record of input.records) {
    if (record.localDate === today) continue;
    cancel.add(macLeaveReminderId(record.digest));
    cancel.add(macLeaveReminderId(record.digest, true));
  }
  const departure = input.departure?.localDate === today ? input.departure : null;
  if (!departure) {
    return { schedule: [], cancelPending: [...cancel].filter((id) => pendingById.has(id)), removeAll: false, records: current };
  }

  const context = departurePhraseContext(input.now, input.timezone);
  const immediate = now.add({ seconds: MAC_LEAVE_REMINDER_IMMEDIATE_SECONDS });
  const fired = (at: string) => Temporal.Instant.compare(Temporal.Instant.from(at), now) <= 0;
  const recordByDigest = new Map(current.map((record) => [record.digest, record]));
  const schedule: Array<MacLeaveReminderRequest & { digest: string }> = [];
  const records: MacLeaveReminderRecord[] = [];
  const planned = new Set<string>();
  const text = (candidate: Candidate, update: boolean) => macLeaveReminderPhrases({ update,
    destinationLabel: candidate.stop.label, leaveAt: candidate.trip.leaveAt!, arriveAt: candidate.trip.arriveAt!,
    checkedAt: candidate.trip.checkedAt!, mode: candidate.trip.mode!, start: start(candidate.trip) }, context);

  for (const candidate of candidates(departure.trips, departure.stops, now)) {
    planned.add(candidate.digest);
    const record = recordByDigest.get(candidate.digest);
    const id = macLeaveReminderId(candidate.digest);
    if (record && fired(record.reminderAt)) {
      records.push(record);
      if (record.update) continue;
      // Decision D15: one update after the reminder fired, only for a leave time 10+ minutes earlier and still ahead.
      const earlierBy = Temporal.Instant.from(record.leaveAt).since(candidate.leaveAt).total("seconds");
      if (earlierBy < MAC_LEAVE_REMINDER_UPDATE_MIN_EARLIER_SECONDS) continue;
      const fireAt = immediate.toString();
      schedule.push({ id: macLeaveReminderId(candidate.digest, true), digest: candidate.digest, fireAt, ...text(candidate, true) });
      records[records.length - 1] = { ...record, update: { fireAt, leaveAt: candidate.leaveAt.toString() } };
      continue;
    }
    // Before it fires, a new estimate replaces the scheduled reminder. That is not an update.
    const { title, body } = text(candidate, false);
    const existing = pendingById.get(id);
    if (record && existing && record.leaveAt === candidate.leaveAt.toString() && existing.title === title && existing.body === body) {
      records.push(record);
      continue;
    }
    const reminderAt = candidate.leaveAt.subtract({ seconds: Math.max(0, Math.ceil(input.preparationSeconds)) });
    const fireAt = (Temporal.Instant.compare(reminderAt, immediate) < 0 ? immediate : reminderAt).toString();
    schedule.push({ id, digest: candidate.digest, title, body, fireAt });
    records.push({ digest: candidate.digest, localDate: today, reminderAt: fireAt, leaveAt: candidate.leaveAt.toString(), update: null });
  }

  for (const record of current) {
    if (planned.has(record.digest)) continue;
    // A dropped trip sends nothing more. A sent reminder is remembered, so a trip that comes back is not reminded twice.
    cancel.add(macLeaveReminderId(record.digest));
    if (fired(record.reminderAt)) {
      if (record.update && !fired(record.update.fireAt)) {
        cancel.add(macLeaveReminderId(record.digest, true));
        records.push({ ...record, update: null });
      } else records.push(record);
    }
  }
  for (const request of pending) {
    if (!planned.has(macLeaveReminderDigestFromId(request.id)!)) cancel.add(request.id);
  }
  const scheduled = new Set(schedule.map(({ id }) => id));
  return { schedule, cancelPending: [...cancel].filter((id) => pendingById.has(id) && !scheduled.has(id)), removeAll: false, records };
}
