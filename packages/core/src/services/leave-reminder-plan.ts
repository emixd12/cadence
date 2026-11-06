import { Temporal } from "@js-temporal/polyfill";

import { sha256 } from "../hash";
import { travelEventRef } from "./travel-habits";

/**
 * Ticket 277 (decisions D3, D12, D15 and D16): the leave reminder job's pure planner.
 * `docs/NOTIFICATION_SPEC.md`, "Leave reminders", has the rules. Nothing here reads a
 * clock, a database or a provider; `now` is injected. No title, place, position,
 * duration or leave time enters a record. The one stored time is a check time.
 */

/** The job runs every 5 minutes and treats work due within the next 5 minutes as due. */
export const LEAVE_REMINDER_LOOKAHEAD_SECONDS = 5 * 60;
/** The job re-reads Calendar at least this often for an account with reminders on. */
export const LEAVE_REMINDER_CALENDAR_REREAD_SECONDS = 30 * 60;
/** A claim older than this can be reclaimed, as for Behavior reminders. */
export const LEAVE_REMINDER_CLAIM_STALE_SECONDS = 15 * 60;
/** The update route runs at the first run this long after sending: the next run, about 5 minutes later. */
export const LEAVE_REMINDER_UPDATE_AFTER_SEND_SECONDS = 4 * 60;
/** One update, only when the leave time moves at least this much earlier. */
export const LEAVE_REMINDER_UPDATE_MIN_EARLIER_SECONDS = 10 * 60;
/**
 * `preparation_changed_at` comes from the database clock and `sent_at` from the job's. A
 * get-ready change this close before sending still counts as after it, so a small
 * difference between the two clocks can only close a check, never keep one open.
 */
export const LEAVE_REMINDER_SERVER_CLOCK_MARGIN_SECONDS = 60;
/** Decision D15: plan, send, and one route after sending. The database refuses a fourth. */
export const LEAVE_REMINDER_MAX_ROUTES = 3;

export type LeaveReminderStatus = "pending" | "sent" | "failed" | "cancelled";

/** One `travel_leave_reminders` row as the job reads it. */
export type LeaveReminderRecord = Readonly<{
  id: string;
  tripDigest: string;
  localDate: string;
  status: LeaveReminderStatus;
  nextCheckAt: string | null;
  routeCount: number;
  processingStartedAt: string | null;
  sentAt: string | null;
  updateSentAt: string | null;
  /**
   * The get-ready time, in minutes, the plan route used for a pending record's check.
   * Null for a record planned before it was kept; such a check stays where it is.
   */
  plannedPreparationMinutes?: number | null;
}>;

/** A trip the current plan has: a located destination on the local date, not the trip home. */
export type LeaveReminderTrip = Readonly<{
  digest: string;
  /** The destination commitment ref the route request names. */
  destinationRef: string;
}>;

export type LeaveReminderStep = "plan" | "send" | "update";

export type LeaveReminderVisitPlan = Readonly<{
  localDate: string;
  /** Trips with no record yet: insert a claimed pending record, then plan. */
  create: readonly LeaveReminderTrip[];
  /** Cancelled records, never routed, whose trip came back: make them pending, then plan. */
  restore: ReadonlyArray<Readonly<{ record: LeaveReminderRecord; trip: LeaveReminderTrip }>>;
  /**
   * Pending records whose get-ready time changed after the plan route: the check moves
   * by the difference, with no route. A moved check that is already due is in `work`.
   */
  reschedule: ReadonlyArray<Readonly<{ record: LeaveReminderRecord; nextCheckAt: string; preparationMinutes: number }>>;
  /** Existing records due now. */
  work: ReadonlyArray<Readonly<{ record: LeaveReminderRecord; trip: LeaveReminderTrip; step: LeaveReminderStep }>>;
  /** Pending records whose trip was dropped or whose date has passed. */
  cancel: readonly LeaveReminderRecord[];
  /** Sent records whose open check can no longer send an update. */
  closeCheck: readonly LeaveReminderRecord[];
  /** Records dated before this local date are deleted. */
  purgeBefore: string;
}>;

/**
 * The trip digest the migration describes: SHA-256 over the destination's event reference
 * (Ticket 217's `travelEventRef`) and its start instant. A moved event is a new trip.
 */
export function leaveReminderTripDigest(kind: "calendar" | "behavior", ref: string, startAt: string): string {
  return sha256(`${travelEventRef(kind, ref)}\n${Temporal.Instant.from(startAt).toString()}`);
}

/** The local date the job plans, and the previous one it keeps. */
export function leaveReminderLocalDate(now: string, timezone: string): string {
  return Temporal.Instant.from(now).toZonedDateTimeISO(timezone).toPlainDate().toString();
}

/** True while another run's claim on the record is fresh. */
export function leaveReminderClaimFresh(record: Pick<LeaveReminderRecord, "processingStartedAt">, now: string): boolean {
  if (!record.processingStartedAt) return false;
  return Temporal.Instant.compare(
    Temporal.Instant.from(record.processingStartedAt).add({ seconds: LEAVE_REMINDER_CLAIM_STALE_SECONDS }),
    Temporal.Instant.from(now),
  ) > 0;
}

/** Claims at or before this instant are stale. */
export function leaveReminderStaleClaimBefore(now: string): string {
  return Temporal.Instant.from(now).subtract({ seconds: LEAVE_REMINDER_CLAIM_STALE_SECONDS }).toString();
}

/**
 * Decides one account visit from its records and the trips the current plan has. Records
 * another run holds are left alone. A trip is dropped when it leaves the plan: its event
 * moved (new digest), was cancelled or declined, lost its location, or its Occurrence was
 * resolved or its Where stopped routing. While a Calendar read failed, a missing trip may
 * be that Calendar's, so today's records are kept and decided on a later visit.
 */
export function planLeaveReminderVisit(input: Readonly<{
  now: string;
  timezone: string;
  preparationSeconds: number;
  /**
   * When Travel habits last changed. A change after a reminder was sent may have changed
   * its get-ready time, so the leave time it named is unknown and its check closes unrouted.
   */
  habitsUpdatedAt?: string | null;
  /**
   * The database's time of the last hosted get-ready change. A Mac writes `habitsUpdatedAt`
   * from its own clock, and an offline Mac change arrives when it syncs, so only this one
   * reliably shows a change after sending. Either one after the send time closes the check.
   */
  preparationChangedAt?: string | null;
  records: readonly LeaveReminderRecord[];
  trips: readonly LeaveReminderTrip[];
  /**
   * True when a connected Calendar's read failed, so `trips` may lack its trips. A record for
   * today whose trip is missing is then neither cancelled nor closed. A record is only a digest,
   * so its Calendar is unknown: every missing trip for today is kept until a complete read.
   */
  calendarsLeftOut?: boolean;
}>): LeaveReminderVisitPlan {
  const now = Temporal.Instant.from(input.now);
  const localDate = leaveReminderLocalDate(input.now, input.timezone);
  const purgeBefore = Temporal.PlainDate.from(localDate).subtract({ days: 1 }).toString();
  const dueBy = now.add({ seconds: LEAVE_REMINDER_LOOKAHEAD_SECONDS });
  const tripByDigest = new Map(input.trips.map((trip) => [trip.digest, trip]));
  const recorded = new Set<string>();
  const restore: Array<{ record: LeaveReminderRecord; trip: LeaveReminderTrip }> = [];
  const work: Array<{ record: LeaveReminderRecord; trip: LeaveReminderTrip; step: LeaveReminderStep }> = [];
  const reschedule: Array<{ record: LeaveReminderRecord; nextCheckAt: string; preparationMinutes: number }> = [];
  const cancel: LeaveReminderRecord[] = [];
  const closeCheck: LeaveReminderRecord[] = [];
  const due = (at: string | null) => !!at && Temporal.Instant.compare(Temporal.Instant.from(at), dueBy) <= 0;

  for (const record of input.records) {
    if (record.localDate === localDate) recorded.add(record.tripDigest);
    if (Temporal.PlainDate.compare(Temporal.PlainDate.from(record.localDate), Temporal.PlainDate.from(purgeBefore)) < 0) continue;
    if (leaveReminderClaimFresh(record, input.now)) continue;
    const trip = record.localDate === localDate ? tripByDigest.get(record.tripDigest) ?? null : null;
    const openCheck = record.status === "sent" && record.nextCheckAt !== null && record.updateSentAt === null;

    if (!trip) {
      if (input.calendarsLeftOut && record.localDate === localDate) continue;
      if (record.status === "pending") cancel.push(record);
      else if (openCheck) closeCheck.push(record);
      continue;
    }
    if (record.status === "cancelled") {
      // A routed trip that comes back is not routed again: its reminder time is gone, and a
      // send route would send at once, possibly hours early.
      if (record.routeCount === 0) restore.push({ record, trip });
      continue;
    }
    if (record.status === "pending") {
      const moved = movedPendingCheck(record, input.preparationSeconds);
      if (moved && !due(moved)) {
        reschedule.push({ record, nextCheckAt: moved, preparationMinutes: leaveReminderPreparationMinutes(input.preparationSeconds) });
        continue;
      }
      // A moved check that is already due sends now through the send route, while the leave time is ahead.
      if (due(moved ?? record.nextCheckAt)) work.push({ record, trip, step: record.routeCount === 0 ? "plan" : "send" });
      continue;
    }
    if (openCheck && (habitsChangedAfter(input.habitsUpdatedAt, record.sentAt) || preparationChangedAfter(input.preparationChangedAt, record.sentAt))) {
      closeCheck.push(record);
      continue;
    }
    if (openCheck && record.routeCount < LEAVE_REMINDER_MAX_ROUTES) {
      const namedLeaveAt = Temporal.Instant.from(record.nextCheckAt!).add({ seconds: input.preparationSeconds });
      if (Temporal.Instant.compare(namedLeaveAt, now) <= 0) closeCheck.push(record);
      else if (due(record.nextCheckAt) && updateWaitOver(record.sentAt!, now)) work.push({ record, trip, step: "update" });
    }
  }

  const create = input.trips.filter((trip) => !recorded.has(trip.digest));
  return { localDate, create, restore, reschedule, work, cancel, closeCheck, purgeBefore };
}

/** The get-ready time a record keeps, in whole minutes as Travel habits store it. */
export function leaveReminderPreparationMinutes(preparationSeconds: number): number {
  return Math.max(0, Math.round(preparationSeconds / 60));
}

/**
 * A planned pending check is the leave time minus the get-ready time the plan route used.
 * When the get-ready time has changed since, the same leave time gives the check moved by
 * the difference. Null when nothing moved or the record does not say what it used.
 */
function movedPendingCheck(record: LeaveReminderRecord, preparationSeconds: number): string | null {
  if (record.routeCount === 0 || !record.nextCheckAt || record.plannedPreparationMinutes == null) return null;
  const current = leaveReminderPreparationMinutes(preparationSeconds);
  if (record.plannedPreparationMinutes === current) return null;
  return Temporal.Instant.from(record.nextCheckAt).add({ minutes: record.plannedPreparationMinutes - current }).toString();
}

function habitsChangedAfter(habitsUpdatedAt: string | null | undefined, sentAt: string | null): boolean {
  if (!habitsUpdatedAt || !sentAt) return false;
  return Temporal.Instant.compare(Temporal.Instant.from(habitsUpdatedAt), Temporal.Instant.from(sentAt)) > 0;
}

function preparationChangedAfter(preparationChangedAt: string | null | undefined, sentAt: string | null): boolean {
  if (!preparationChangedAt || !sentAt) return false;
  const after = Temporal.Instant.from(sentAt).subtract({ seconds: LEAVE_REMINDER_SERVER_CLOCK_MARGIN_SECONDS });
  return Temporal.Instant.compare(Temporal.Instant.from(preparationChangedAt), after) > 0;
}

function updateWaitOver(sentAt: string, now: Temporal.Instant): boolean {
  return Temporal.Instant.compare(Temporal.Instant.from(sentAt).add({ seconds: LEAVE_REMINDER_UPDATE_AFTER_SEND_SECONDS }), now) <= 0;
}

/** One trip's route result: the leave time from its estimate, or why there is none. */
export type LeaveReminderRouteResult =
  | Readonly<{ kind: "estimate"; leaveAt: string }>
  | Readonly<{ kind: "unavailable"; budgetRefused: boolean }>;

export type LeaveReminderOutcome =
  /** Plan route: the reminder is not due yet. Check again at the reminder time. */
  | Readonly<{ kind: "schedule"; nextCheckAt: string }>
  /**
   * Send now. `nextCheckAt` is the reminder time this reminder names, kept as the one check
   * after sending while its leave time is still ahead; null when no update can follow.
   */
  | Readonly<{ kind: "send"; leaveAt: string; nextCheckAt: string | null }>
  | Readonly<{ kind: "fail"; error: "budget_refused" | "route_unavailable" | "leave_time_passed" }>
  /** Send the one update: the leave time moved 10 minutes or more earlier and is still ahead. */
  | Readonly<{ kind: "send_update"; leaveAt: string }>
  /** Close the check after sending. Nothing more sends. */
  | Readonly<{ kind: "close"; error: "budget_paused" | null }>;

/**
 * What one routed step does. The plan route sends at once when the reminder time is
 * already due. The send route sends at once while the leave time is ahead, even if its
 * reminder time is a little later. The update route compares with the leave time the
 * reminder named: its stored check time plus the get-ready time.
 */
export function resolveLeaveReminderOutcome(input: Readonly<{
  step: LeaveReminderStep;
  now: string;
  preparationSeconds: number;
  result: LeaveReminderRouteResult;
  /** For the update step: the record's check time, the reminder time the reminder named. */
  namedReminderAt?: string | null;
}>): LeaveReminderOutcome {
  const now = Temporal.Instant.from(input.now);
  if (input.step === "update") {
    if (input.result.kind !== "estimate" || !input.namedReminderAt) return { kind: "close", error: null };
    const namedLeaveAt = Temporal.Instant.from(input.namedReminderAt).add({ seconds: input.preparationSeconds });
    const leaveAt = Temporal.Instant.from(input.result.leaveAt);
    const earlierBy = namedLeaveAt.since(leaveAt).total("seconds");
    return Temporal.Instant.compare(leaveAt, now) > 0 && earlierBy >= LEAVE_REMINDER_UPDATE_MIN_EARLIER_SECONDS
      ? { kind: "send_update", leaveAt: leaveAt.toString() }
      : { kind: "close", error: null };
  }
  if (input.result.kind !== "estimate") return { kind: "fail", error: input.result.budgetRefused ? "budget_refused" : "route_unavailable" };
  const leaveAt = Temporal.Instant.from(input.result.leaveAt);
  if (Temporal.Instant.compare(leaveAt, now) <= 0) return { kind: "fail", error: "leave_time_passed" };
  const reminderAt = leaveAt.subtract({ seconds: Math.max(0, input.preparationSeconds) });
  const dueBy = now.add({ seconds: LEAVE_REMINDER_LOOKAHEAD_SECONDS });
  if (input.step === "plan" && Temporal.Instant.compare(reminderAt, dueBy) > 0) return { kind: "schedule", nextCheckAt: reminderAt.toString() };
  const updatePossible = Temporal.Instant.compare(leaveAt, now.add({ seconds: LEAVE_REMINDER_UPDATE_AFTER_SEND_SECONDS })) > 0;
  return { kind: "send", leaveAt: leaveAt.toString(), nextCheckAt: updatePossible ? reminderAt.toString() : null };
}

/**
 * When the job should visit the account next. The account selection treats a visit due
 * within the lookahead as due, so a record's time is stored as the time it may be worked.
 * Calendar is re-read at least every 30 minutes, and the new local date is planned from
 * its local midnight.
 */
export function nextLeaveReminderAccountCheck(input: Readonly<{
  now: string;
  timezone: string;
  records: readonly LeaveReminderRecord[];
}>): string {
  const now = Temporal.Instant.from(input.now);
  const nextMidnight = Temporal.PlainDate.from(leaveReminderLocalDate(input.now, input.timezone))
    .add({ days: 1 }).toZonedDateTime({ timeZone: input.timezone }).toInstant();
  let next = now.add({ seconds: LEAVE_REMINDER_CALENDAR_REREAD_SECONDS });
  const consider = (at: Temporal.Instant) => { if (Temporal.Instant.compare(at, next) < 0) next = at; };
  consider(nextMidnight);
  for (const record of input.records) {
    if (record.processingStartedAt && leaveReminderClaimFresh(record, input.now)) {
      consider(Temporal.Instant.from(record.processingStartedAt).add({ seconds: LEAVE_REMINDER_CLAIM_STALE_SECONDS + LEAVE_REMINDER_LOOKAHEAD_SECONDS }));
    } else if (record.status === "pending" && record.nextCheckAt) {
      consider(Temporal.Instant.from(record.nextCheckAt));
    } else if (record.status === "sent" && record.nextCheckAt && !record.updateSentAt && record.sentAt) {
      const afterWait = Temporal.Instant.from(record.sentAt).add({ seconds: LEAVE_REMINDER_UPDATE_AFTER_SEND_SECONDS + LEAVE_REMINDER_LOOKAHEAD_SECONDS });
      const check = Temporal.Instant.from(record.nextCheckAt);
      consider(Temporal.Instant.compare(check, afterWait) > 0 ? check : afterWait);
    }
  }
  return (Temporal.Instant.compare(next, now) < 0 ? now : next).toString();
}
