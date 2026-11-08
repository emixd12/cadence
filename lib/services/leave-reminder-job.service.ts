import { Temporal } from "@js-temporal/polyfill";

import {
  LEAVE_REMINDER_CLAIM_STALE_SECONDS,
  LEAVE_REMINDER_LOOKAHEAD_SECONDS,
  leaveReminderPreparationMinutes,
  leaveReminderStaleClaimBefore,
  leaveReminderTripDigest,
  nextLeaveReminderAccountCheck,
  planLeaveReminderVisit,
  resolveLeaveReminderOutcome,
  type LeaveReminderOutcome,
  type LeaveReminderRecord,
  type LeaveReminderRouteResult,
  type LeaveReminderStep,
  type LeaveReminderTrip,
} from "@cadence/core/services/leave-reminder-plan";
import { travelHabitBuffers } from "@cadence/core/services/travel-habits";
import { travelBudgetPausesAutomatic } from "@cadence/core/services/travel-refresh-policy";
import type { TravelMode } from "@cadence/core/types/travel";
import { getProfileTimezone, listUserBehaviors, type AppSupabaseClient } from "@/lib/db/behaviors.repo";
import {
  LEAVE_REMINDER_ACCOUNT_BATCH_MAX,
  createLeaveReminderStore,
  readTravelPreparationChangedAt,
  selectDueLeaveReminderAccounts,
  type DueLeaveReminderAccount,
  type LeaveReminderRecordPatch,
  type LeaveReminderStore,
} from "@/lib/db/leave-reminders.repo";
import { listOccurrencesBetweenLocalDates } from "@/lib/db/occurrences.repo";
import { TRAVEL_OWNER_MONTH_CEILING_MICRODOLLARS, readTravelMonthSpend } from "@/lib/db/travelSpend.repo";
import {
  createLeaveReminderCaller,
  leaveReminderCalendarCaller,
  type LeaveReminderCaller,
} from "@/lib/integrations/leave-reminder-caller";
import type { CalendarReadCaller } from "@/lib/services/google-calendar.service";
import type { LeaveReminderDelivery, LeaveReminderMessage } from "@/lib/services/leave-reminder-delivery";
import type { TravelProviderConfig } from "@/lib/services/travel-provider";
import { readTravelCalendarConnections, readTravelCalendarEvents } from "@/lib/services/travel-calendar-sources";
import { refreshTravelRoutes, refreshTravelRoutesReportingCalendars } from "@/lib/services/travel-route-refresh.service";
import { TravelRoutingError } from "@/lib/services/travel-routing.service";
import { readTravelRouteSource, type TravelRouteBehavior } from "@/lib/services/travel-settings.service";

/**
 * Ticket 277 (decisions D3, D12, D15, D16): the hosted leave reminder job. The one
 * cross-account read selects due accounts on the service role (Ticket 276). Every other
 * read and write runs as the user on a minted client. Routes start from Home or the
 * previous stop, never a device position. Records hold no title, place, position,
 * duration or leave time; titles are read at send time and kept in memory.
 */

export const LEAVE_REMINDER_DEFAULT_ACCOUNT_BATCH = 20;
const ACCOUNT_CONCURRENCY = 4;
/** No new account visit starts after this long, so a run ends before the next one. */
const RUN_BUDGET_MS = 40_000;
/** A visit that fails is retried at the second run after this one. */
const FAILED_VISIT_RETRY_SECONDS = 2 * LEAVE_REMINDER_LOOKAHEAD_SECONDS;
const DEFAULT_TIMEZONE = "America/New_York";

/** One trip in the account's current plan, with the refs a route request names. */
export type LeaveReminderPlannedTrip = LeaveReminderTrip & Readonly<{
  role: "outbound" | "onward";
  originRef: string | null;
  startAt: string;
  mode: TravelMode;
}>;

/**
 * The current plan's trips. `calendarsLeftOut`: a connected Outlook or iCloud Calendar's read
 * failed, so its trips may be missing; the visit keeps their records (Ticket 283).
 */
export type LeaveReminderTripList = Readonly<{ trips: LeaveReminderPlannedTrip[]; calendarsLeftOut: boolean }>;

export type LeaveReminderRouted = Readonly<{
  result: LeaveReminderRouteResult;
  estimate: Readonly<{ departureAt: string; arrivalAt: string; durationSeconds: number }> | null;
  mode: TravelMode;
  originRef: string | null;
}>;

/** At send time, read again in memory. */
export type LeaveReminderSendDetails = Readonly<{
  title: string;
  origin: LeaveReminderMessage["origin"];
}>;

/** What the send-time read says about one trip. */
export type LeaveReminderSendRead =
  | Readonly<{ kind: "found"; details: LeaveReminderSendDetails }>
  /** The destination or previous stop is gone, has no title, or its start moved: nothing sends. */
  | Readonly<{ kind: "gone" }>
  /** A failed Outlook or iCloud read left out a Calendar the stop may be in: it is unknown. */
  | Readonly<{ kind: "left_out" }>;

/** One Calendar and Behavior read with titles, for the visit's sends. Titles stay in memory. */
export type LeaveReminderSendCalendar = Readonly<{
  read(trip: LeaveReminderPlannedTrip, originRef: string | null): LeaveReminderSendRead;
}>;

/** Everything the job does for one account, as that user. Tests replace it. */
export type LeaveReminderAccountPort = Readonly<{
  caller: LeaveReminderCaller;
  store: LeaveReminderStore;
  /**
   * `habitsUpdatedAt`: when Travel habits last changed, by the writing device's clock.
   * `preparationChangedAt`: the database's time of the last hosted get-ready change.
   */
  readContext(): Promise<Readonly<{ timezone: string; preparationSeconds: number; travelOn: boolean; habitsUpdatedAt: string | null;
    preparationChangedAt?: string | null }>>;
  listTrips(localDate: string): Promise<LeaveReminderTripList>;
  routeTrips(localDate: string, trips: readonly LeaveReminderPlannedTrip[]): Promise<ReadonlyMap<string, LeaveReminderRouted>>;
  readSendCalendar(localDate: string): Promise<LeaveReminderSendCalendar>;
  /** Decision D16: true from 80% of the monthly budget. */
  updatePaused(timezone: string): Promise<boolean>;
}>;

export type LeaveReminderRunResult = {
  selected: number;
  visited: number;
  skipped: number;
  failed: number;
  planned: number;
  sent: number;
  updates: number;
  failedReminders: number;
  cancelled: number;
};

export type ProcessLeaveRemindersOptions = Readonly<{
  now?: () => Temporal.Instant;
  limit?: number;
  deliver: LeaveReminderDelivery;
  selectDueAccounts: (input: Readonly<{ dueBy: Date; limit: number }>) => Promise<DueLeaveReminderAccount[]>;
  openAccount: (userId: string, now: Temporal.Instant) => LeaveReminderAccountPort | Promise<LeaveReminderAccountPort>;
  runBudgetMs?: number;
}>;

export async function processLeaveReminders(options: ProcessLeaveRemindersOptions): Promise<LeaveReminderRunResult> {
  const clock = options.now ?? (() => Temporal.Now.instant());
  const started = clock();
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? LEAVE_REMINDER_DEFAULT_ACCOUNT_BATCH)), LEAVE_REMINDER_ACCOUNT_BATCH_MAX);
  const dueBy = new Date(started.add({ seconds: LEAVE_REMINDER_LOOKAHEAD_SECONDS }).epochMilliseconds);
  const accounts = await options.selectDueAccounts({ dueBy, limit });
  const total: LeaveReminderRunResult = { selected: accounts.length, visited: 0, skipped: 0, failed: 0, planned: 0, sent: 0, updates: 0, failedReminders: 0, cancelled: 0 };
  const budgetEndsAt = started.epochMilliseconds + (options.runBudgetMs ?? RUN_BUDGET_MS);
  let index = 0;

  const worker = async () => {
    while (index < accounts.length) {
      const account = accounts[index++]!;
      if (clock().epochMilliseconds >= budgetEndsAt) { total.skipped += 1; continue; }
      const now = clock();
      let port: LeaveReminderAccountPort;
      try { port = await options.openAccount(account.userId, now); }
      catch { total.failed += 1; continue; }
      const visit = await visitLeaveReminderAccount(port, account, now, options.deliver);
      if (visit.kind === "skipped") { total.skipped += 1; continue; }
      total[visit.kind === "failed" ? "failed" : "visited"] += 1;
      total.planned += visit.planned;
      total.sent += visit.sent;
      total.updates += visit.updates;
      total.failedReminders += visit.failedReminders;
      total.cancelled += visit.cancelled;
    }
  };
  await Promise.all(Array.from({ length: Math.min(ACCOUNT_CONCURRENCY, accounts.length) }, worker));
  return total;
}

type VisitResult =
  | Readonly<{ kind: "skipped" }>
  | Readonly<{ kind: "visited" | "failed"; planned: number; sent: number; updates: number; failedReminders: number; cancelled: number }>;

type Claimed = { record: LeaveReminderRecord; trip: LeaveReminderPlannedTrip; step: LeaveReminderStep };

/**
 * One account visit. The account's next check is leased first, so overlapping runs never
 * visit one account at once; each record is also claimed before it is routed or sent.
 */
export async function visitLeaveReminderAccount(
  port: LeaveReminderAccountPort,
  account: DueLeaveReminderAccount,
  now: Temporal.Instant,
  deliver: LeaveReminderDelivery,
): Promise<VisitResult> {
  const store = port.store;
  const nowText = now.toString();
  const leaseUntil = now.add({ seconds: LEAVE_REMINDER_CLAIM_STALE_SECONDS }).toString();
  if (!await store.claimAccount(account.nextCheckAt, leaseUntil)) return { kind: "skipped" };

  const counts = { planned: 0, sent: 0, updates: 0, failedReminders: 0, cancelled: 0 };
  let timezone = DEFAULT_TIMEZONE;
  let failed = false;
  try {
    const context = await port.readContext();
    timezone = context.timezone;
    const records = await store.listRecords();
    const localDate = Temporal.Instant.from(nowText).toZonedDateTimeISO(timezone).toPlainDate().toString();
    // A failed Google read fails listTrips, and with it this visit: nothing is cancelled and the account is retried.
    const { trips, calendarsLeftOut } = context.travelOn ? await port.listTrips(localDate) : { trips: [], calendarsLeftOut: false };
    const plan = planLeaveReminderVisit({ now: nowText, timezone, preparationSeconds: context.preparationSeconds, habitsUpdatedAt: context.habitsUpdatedAt,
      preparationChangedAt: context.preparationChangedAt ?? null, records, trips, calendarsLeftOut });
    const tripByDigest = new Map(trips.map((trip) => [trip.digest, trip]));
    const staleBefore = leaveReminderStaleClaimBefore(nowText);

    await store.deleteBefore(plan.purgeBefore);
    for (const record of plan.cancel) {
      if (await store.updateUnclaimed(record, staleBefore, { status: "cancelled", next_check_at: null, processing_started_at: null })) counts.cancelled += 1;
    }
    for (const record of plan.closeCheck) {
      await store.updateUnclaimed(record, staleBefore, { next_check_at: null, processing_started_at: null });
    }
    // The get-ready time changed after the plan route: the check moves with no route.
    for (const { record, nextCheckAt, preparationMinutes } of plan.reschedule) {
      await store.updateUnclaimed(record, staleBefore, { next_check_at: nextCheckAt, planned_preparation_minutes: preparationMinutes });
    }

    const claimed: Claimed[] = [];
    for (const trip of plan.create) {
      const record = await store.insertClaimed({ tripDigest: trip.digest, localDate: plan.localDate, now: nowText });
      if (record) claimed.push({ record, trip: tripByDigest.get(trip.digest)!, step: "plan" });
    }
    for (const { record, trip } of plan.restore) {
      const patch = { status: "pending" as const, next_check_at: nowText, processing_started_at: nowText };
      if (await store.updateUnclaimed(record, staleBefore, patch)) {
        claimed.push({ record: { ...record, status: "pending", nextCheckAt: nowText, processingStartedAt: nowText }, trip: tripByDigest.get(trip.digest)!, step: "plan" });
      }
    }
    for (const { record, trip, step } of plan.work) {
      const current = await store.claim(record, nowText, staleBefore);
      if (current) claimed.push({ record: current, trip: tripByDigest.get(trip.digest)!, step });
    }

    // Decision D16: the update route stops at 80% of the monthly budget.
    const updates = claimed.filter((item) => item.step === "update");
    let toRoute = claimed.filter((item) => item.step !== "update");
    if (updates.length) {
      if (await port.updatePaused(timezone)) {
        for (const item of updates) await store.finish(item.record, { next_check_at: null, processing_started_at: null, error: "budget_paused" });
      } else {
        toRoute.push(...updates);
      }
    }

    // One send-time read per visit. The send and update steps read before their route: a
    // destination or planned previous stop whose Calendar a failed read left out is released
    // unrouted, keeping its check, and the next visit tries again. The plan step reads only
    // when it sends.
    let sendCalendar: Promise<LeaveReminderSendCalendar> | null = null;
    const readSendCalendar = () => (sendCalendar ??= port.readSendCalendar(plan.localDate));
    if (toRoute.some((item) => item.step !== "plan")) {
      let calendar: LeaveReminderSendCalendar;
      try {
        calendar = await readSendCalendar();
      } catch (error) {
        for (const item of toRoute) await store.finish(item.record, { processing_started_at: null }).catch(() => false);
        throw error;
      }
      const unread = toRoute.filter((item) => item.step !== "plan" && calendar.read(item.trip, item.trip.originRef).kind === "left_out");
      for (const item of unread) await store.finish(item.record, { processing_started_at: null });
      toRoute = toRoute.filter((item) => !unread.includes(item));
    }
    if (!toRoute.length) return { kind: "visited", ...counts };

    let routed: ReadonlyMap<string, LeaveReminderRouted>;
    try {
      routed = await port.routeTrips(plan.localDate, toRoute.map((item) => item.trip));
    } catch (error) {
      for (const item of toRoute) await store.finish(item.record, { processing_started_at: null }).catch(() => false);
      throw error;
    }

    for (const item of toRoute) {
      const outcome = await applyRoute(port, item, routed.get(item.trip.digest) ?? null, {
        now: nowText, preparationSeconds: context.preparationSeconds, deliver, readSendCalendar,
      });
      if (outcome === "planned") counts.planned += 1;
      else if (outcome === "sent") counts.sent += 1;
      else if (outcome === "updated") counts.updates += 1;
      else if (outcome === "failed") counts.failedReminders += 1;
      else if (outcome === "cancelled") counts.cancelled += 1;
    }
    return { kind: "visited", ...counts };
  } catch {
    failed = true;
    return { kind: "failed", ...counts };
  } finally {
    const after = failed ? null : await store.listRecords().catch(() => null);
    const nextCheckAt = after
      ? nextLeaveReminderAccountCheck({ now: nowText, timezone, records: after })
      : now.add({ seconds: FAILED_VISIT_RETRY_SECONDS }).toString();
    await store.releaseAccount(leaseUntil, nextCheckAt).catch(() => false);
  }
}

type ApplyOutcome = "planned" | "sent" | "updated" | "failed" | "cancelled" | "closed" | "released";

async function applyRoute(
  port: LeaveReminderAccountPort,
  item: Claimed,
  routed: LeaveReminderRouted | null,
  input: Readonly<{ now: string; preparationSeconds: number; deliver: LeaveReminderDelivery; readSendCalendar: () => Promise<LeaveReminderSendCalendar> }>,
): Promise<ApplyOutcome> {
  const { store } = port;
  const { record, trip, step } = item;
  // The trip left the plan between the read and the route request: nothing was routed for it.
  if (!routed) {
    await store.finish(record, { processing_started_at: null });
    return "released";
  }
  const routeCount = record.routeCount + 1;
  const outcome: LeaveReminderOutcome = resolveLeaveReminderOutcome({
    step, now: input.now, preparationSeconds: input.preparationSeconds, result: routed.result, namedReminderAt: record.nextCheckAt,
  });

  switch (outcome.kind) {
    case "schedule":
      await store.finish(record, { next_check_at: outcome.nextCheckAt, route_count: routeCount, processing_started_at: null,
        planned_preparation_minutes: leaveReminderPreparationMinutes(input.preparationSeconds) });
      return "planned";
    case "fail":
      await store.finish(record, { status: "failed", error: outcome.error, next_check_at: null, route_count: routeCount, processing_started_at: null });
      return "failed";
    case "close":
      await store.finish(record, { next_check_at: null, route_count: routeCount, processing_started_at: null, error: outcome.error });
      return "closed";
    case "send":
    case "send_update": {
      const update = outcome.kind === "send_update";
      // Calendar and Behaviors are read again at send time; the title stays in memory.
      const read: LeaveReminderSendRead = routed.estimate ? (await input.readSendCalendar()).read(trip, routed.originRef) : { kind: "gone" };
      // The plan route found the reminder due but a Calendar read failed: it stays pending at
      // its reminder time, so the send route sends at the next visit while the leave time is ahead.
      if (read.kind === "left_out" && step === "plan" && outcome.kind === "send") {
        const reminderAt = Temporal.Instant.from(outcome.leaveAt).subtract({ seconds: Math.max(0, input.preparationSeconds) }).toString();
        await store.finish(record, { next_check_at: reminderAt, route_count: routeCount, processing_started_at: null,
          planned_preparation_minutes: leaveReminderPreparationMinutes(input.preparationSeconds) });
        return "planned";
      }
      if (read.kind !== "found" || !routed.estimate) {
        await store.finish(record, update
          ? { next_check_at: null, route_count: routeCount, processing_started_at: null }
          : { status: "cancelled", next_check_at: null, route_count: routeCount, processing_started_at: null });
        return update ? "closed" : "cancelled";
      }
      // Turning reminders off deletes the records; a run that started before must not send.
      if (!await store.remindersEnabled()) return "released";
      const details = read.details;
      const message: LeaveReminderMessage = {
        kind: update ? "update" : "reminder",
        tripDigest: record.tripDigest,
        localDate: record.localDate,
        leaveAt: outcome.leaveAt,
        arriveAt: routed.estimate.arrivalAt,
        startAt: trip.startAt,
        expiresAt: outcome.leaveAt,
        mode: routed.mode,
        travelMinutes: Math.max(1, Math.round(routed.estimate.durationSeconds / 60)),
        origin: details.origin,
        title: details.title,
      };
      const delivery = await input.deliver(port.caller, message);
      if (update) {
        const patch: LeaveReminderRecordPatch = delivery.status === "sent"
          ? { update_sent_at: input.now, next_check_at: null, route_count: routeCount, processing_started_at: null }
          : { next_check_at: null, route_count: routeCount, processing_started_at: null, error: delivery.error };
        await store.finish(record, patch);
        return delivery.status === "sent" ? "updated" : "closed";
      }
      if (delivery.status !== "sent") {
        await store.finish(record, { status: "failed", error: delivery.error, next_check_at: null, route_count: routeCount, processing_started_at: null });
        return "failed";
      }
      await store.finish(record, { status: "sent", sent_at: input.now, next_check_at: outcome.nextCheckAt, route_count: routeCount, processing_started_at: null });
      return "sent";
    }
  }
}

/**
 * Ticket 277: a route request naming only this trip routes nothing. It matches no planned
 * leg (`travelTripMatches`), so the job reads the plan's trips without a route call. Place
 * lookups the plan needs still reserve spend first and are kept for the Timeline.
 */
const LIST_ONLY_TRIP = { role: "return", originRef: "leave-reminder:list-only", destinationRef: null } as const;

type Destination = Readonly<{ kind: "calendar" | "behavior"; startAt: string; title: string | null }>;

/** The hosted port: everything runs as the user on a client minted for this visit. */
export function createHostedLeaveReminderAccountPort(
  userId: string,
  now: Temporal.Instant,
  config: TravelProviderConfig,
): LeaveReminderAccountPort {
  const caller = createLeaveReminderCaller(userId, { now: new Date(now.epochMilliseconds) });
  const store = createLeaveReminderStore(caller.client, userId);
  let calendarCaller: Promise<CalendarReadCaller> | null = null;
  const calendar = () => (calendarCaller ??= leaveReminderCalendarCaller(caller));
  const routeRequest = (localDate: string, trips: ReadonlyArray<Readonly<{ role: string; originRef: string | null; destinationRef: string | null }>>) =>
    ({ scope: "day", startLocalDate: localDate, endLocalDate: localDate, device: null, corrections: [], trips });

  return {
    caller,
    store,
    async readContext() {
      const [timezone, source, preparationChangedAt] = await Promise.all([getProfileTimezone(caller.client, userId),
        readTravelRouteSource(caller.client, userId), readTravelPreparationChangedAt(caller.client, userId)]);
      return {
        timezone: timezone ?? DEFAULT_TIMEZONE,
        preparationSeconds: travelHabitBuffers(source.settings.habits).preparationSeconds,
        travelOn: source.settings.enabled && !!source.settings.mode && !!source.settings.routingConsentAt,
        habitsUpdatedAt: source.habitsRevision,
        preparationChangedAt,
      };
    },
    async listTrips(localDate) {
      const calendarReader = await calendar();
      // Ticket 283: the refresh and the destination read each leave out an Outlook or iCloud
      // Calendar whose read failed. Either one leaving a Calendar out keeps its records.
      const { response, calendarsLeftOut } = await refreshTravelRoutesReportingCalendars(calendarReader, routeRequest(localDate, [LIST_ONLY_TRIP]), config, now);
      const { destinations, calendarsLeftOut: destinationsLeftOut } = await readDestinations(calendarReader, localDate, false);
      const trips = (response.evidence?.legs ?? []).flatMap(({ leg }): LeaveReminderPlannedTrip[] => {
        // The trip home gets no reminder (decision D15).
        if (leg.role === "return" || !leg.destinationCommitmentRef) return [];
        const destination = destinations.get(leg.destinationCommitmentRef);
        if (!destination) return [];
        return [{
          digest: leaveReminderTripDigest(destination.kind, leg.destinationCommitmentRef, destination.startAt),
          destinationRef: leg.destinationCommitmentRef,
          role: leg.role,
          originRef: leg.originCommitmentRef,
          startAt: destination.startAt,
          mode: leg.mode,
        }];
      });
      return { trips, calendarsLeftOut: calendarsLeftOut.length > 0 || destinationsLeftOut };
    },
    async routeTrips(localDate, trips) {
      const calendarReader = await calendar();
      const refs = trips.map((trip) => ({ role: trip.role, originRef: trip.originRef, destinationRef: trip.destinationRef }));
      let legs;
      try {
        legs = (await refreshTravelRoutes(calendarReader, routeRequest(localDate, refs), config, now)).evidence?.legs ?? [];
      } catch (error) {
        // A place lookup the budget refused fails every trip in the request the same way.
        if (error instanceof TravelRoutingError && error.failure.code === "quota_exceeded") {
          return new Map(trips.map((trip) => [trip.digest, { result: { kind: "unavailable", budgetRefused: true }, estimate: null, mode: trip.mode, originRef: trip.originRef }]));
        }
        throw error;
      }
      const routed = new Map<string, LeaveReminderRouted>();
      for (const trip of trips) {
        const evidence = legs.find(({ leg }) => leg.role !== "return" && leg.destinationCommitmentRef === trip.destinationRef);
        if (!evidence) continue;
        routed.set(trip.digest, {
          result: evidence.estimate
            ? { kind: "estimate", leaveAt: evidence.estimate.departureAt }
            : { kind: "unavailable", budgetRefused: evidence.reason === "quota_exceeded" },
          estimate: evidence.estimate
            ? { departureAt: evidence.estimate.departureAt, arrivalAt: evidence.estimate.arrivalAt, durationSeconds: evidence.estimate.durationSeconds }
            : null,
          mode: evidence.leg.mode,
          originRef: evidence.leg.originCommitmentRef,
        });
      }
      return routed;
    },
    async readSendCalendar(localDate) {
      const { destinations, calendarsLeftOut } = await readDestinations(await calendar(), localDate, true);
      // A missing stop may be in a Calendar this read left out. A Behavior's Occurrence never is.
      const missing = (behavior: boolean): LeaveReminderSendRead => ({ kind: calendarsLeftOut && !behavior ? "left_out" : "gone" });
      return {
        read(trip, originRef) {
          const destination = destinations.get(trip.destinationRef);
          if (!destination) return missing(leaveReminderTripDigest("behavior", trip.destinationRef, trip.startAt) === trip.digest);
          if (!destination.title || leaveReminderTripDigest(destination.kind, trip.destinationRef, destination.startAt) !== trip.digest) return { kind: "gone" };
          if (originRef === null) return { kind: "found", details: { title: destination.title, origin: { kind: "home" } } };
          const origin = destinations.get(originRef);
          if (!origin) return missing(false);
          return origin.title
            ? { kind: "found", details: { title: destination.title, origin: { kind: "previous_stop", title: origin.title } } }
            : { kind: "gone" };
        },
      };
    },
    async updatePaused(timezone) {
      try {
        const month = now.toZonedDateTimeISO(timezone).toPlainDate().with({ day: 1 });
        const reserved = await readTravelMonthSpend(caller.client, userId, month.toString());
        return travelBudgetPausesAutomatic({ reservedMicrodollars: reserved, ceilingMicrodollars: TRAVEL_OWNER_MONTH_CEILING_MICRODOLLARS,
          resetsAt: month.add({ months: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant().toString() }, now);
      } catch {
        // An unreadable budget pauses the update rather than spending past the line.
        return true;
      }
    },
  };

  /**
   * The located destinations on the local date, by commitment ref: Calendar events that
   * are not cancelled or declined and have a location (decision D12), and unresolved
   * Occurrences whose Where routes. Titles are read only when sending. Ticket 283: Google,
   * Outlook and iCloud events alike, read as the user; locations and titles stay in memory.
   */
  async function readDestinations(calendarReader: CalendarReadCaller, localDate: string, withTitles: boolean):
    Promise<Readonly<{ destinations: ReadonlyMap<string, Destination>; calendarsLeftOut: boolean }>> {
    const client: AppSupabaseClient = caller.client;
    const [connections, source, occurrences, behaviors] = await Promise.all([
      readTravelCalendarConnections(calendarReader),
      readTravelRouteSource(client, userId),
      listOccurrencesBetweenLocalDates(client, userId, localDate, localDate),
      withTitles ? listUserBehaviors(client, userId) : Promise.resolve(null),
    ]);
    const destinations = new Map<string, Destination>();
    const calendarEvents = await readTravelCalendarEvents(calendarReader, connections, { scope: "day", startLocalDate: localDate, endLocalDate: localDate });
    for (const event of calendarEvents.all) {
      if (event.kind !== "timed" || event.state === "cancelled" || event.currentUserResponse === "declined" || !event.location.trim()) continue;
      destinations.set(event.id, { kind: "calendar", startAt: event.startAt, title: withTitles ? event.title : null });
    }
    const whereById = new Map(source.behaviors.map((behavior) => [behavior.id, behavior]));
    const titleById = new Map((behaviors ?? []).map((behavior) => [behavior.id, behavior.title]));
    for (const occurrence of occurrences) {
      if (occurrence.status !== "unresolved" || !routes(whereById.get(occurrence.behavior_id), source.settings.baseLocationText)) continue;
      destinations.set(occurrence.id, { kind: "behavior", startAt: occurrence.scheduled_for, title: withTitles ? titleById.get(occurrence.behavior_id) ?? null : null });
    }
    return { destinations, calendarsLeftOut: calendarEvents.unavailable.length > 0 };
  }
}

/** Ticket 215: a place routes to its text and Home to the saved Home. */
function routes(behavior: TravelRouteBehavior | undefined, homeText: string | null): boolean {
  return (behavior?.whereKind === "place" && !!behavior.locationText) || (behavior?.whereKind === "home" && !!homeText);
}

/** The route's due-account selection, on the service role, as Ticket 276 states. */
export function hostedDueAccountSelection(serviceRole: AppSupabaseClient) {
  return (input: Readonly<{ dueBy: Date; limit: number }>) => selectDueLeaveReminderAccounts(serviceRole, input);
}
