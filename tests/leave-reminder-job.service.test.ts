import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";

import { leaveReminderTripDigest, type LeaveReminderRecord } from "@cadence/core/services/leave-reminder-plan";
import type { LeaveReminderRecordPatch, LeaveReminderStore } from "../lib/db/leave-reminders.repo";
import type { LeaveReminderCaller } from "../lib/integrations/leave-reminder-caller";
import type { LeaveReminderDelivery, LeaveReminderMessage } from "../lib/services/leave-reminder-delivery";
import {
  processLeaveReminders,
  visitLeaveReminderAccount,
  type LeaveReminderAccountPort,
  type LeaveReminderPlannedTrip,
  type LeaveReminderRouted,
  type LeaveReminderSendRead,
} from "../lib/services/leave-reminder-job.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TZ = "America/New_York";
const PREP_SECONDS = 10 * 60;
const TITLE = "Dentist appointment";

/**
 * An in-memory `travel_leave_reminders` and settings row that refuses what the
 * Ticket 275 migration refuses, with the repository's compare-and-set semantics.
 */
class MemoryStore implements LeaveReminderStore {
  enabled = true;
  accountNextCheckAt: string | null = "2026-11-06T15:00:00.000Z";
  rows = new Map<string, LeaveReminderRecord & { error: string | null }>();
  private nextId = 1;

  async claimAccount(expected: string, lease: string) {
    if (!this.enabled || !sameInstant(this.accountNextCheckAt, expected)) return false;
    this.accountNextCheckAt = lease;
    return true;
  }
  async releaseAccount(lease: string, next: string) {
    if (!this.enabled) return false;
    if (sameInstant(this.accountNextCheckAt, lease)) {
      this.accountNextCheckAt = next;
      return true;
    }
    // Decision D19: a lost lease only brings a later next check forward.
    if (this.accountNextCheckAt && Temporal.Instant.compare(Temporal.Instant.from(this.accountNextCheckAt), Temporal.Instant.from(next)) > 0) {
      this.accountNextCheckAt = next;
    }
    return false;
  }
  async remindersEnabled() { return this.enabled; }
  async listRecords() { return [...this.rows.values()].map((row) => this.strip(row)); }
  async deleteBefore(localDate: string) {
    for (const [id, row] of this.rows) if (row.localDate < localDate) this.rows.delete(id);
  }
  async insertClaimed(input: { tripDigest: string; localDate: string; now: string }) {
    if (!this.enabled) return null;
    if ([...this.rows.values()].some((row) => row.tripDigest === input.tripDigest && row.localDate === input.localDate)) return null;
    const row = { id: `r${this.nextId++}`, tripDigest: input.tripDigest, localDate: input.localDate, status: "pending" as const,
      nextCheckAt: input.now, routeCount: 0, processingStartedAt: input.now, sentAt: null, updateSentAt: null, error: null,
      plannedPreparationMinutes: null };
    this.rows.set(row.id, row);
    return this.strip(row);
  }
  async claim(record: LeaveReminderRecord, now: string, staleBefore: string) {
    const row = this.rows.get(record.id);
    if (!row || !this.same(row, record) || !this.unclaimed(row, staleBefore)) return null;
    this.write(row, { processing_started_at: now });
    return this.strip(this.rows.get(record.id)!);
  }
  async finish(record: LeaveReminderRecord, patch: LeaveReminderRecordPatch) {
    const row = this.rows.get(record.id);
    if (!row || !this.same(row, record) || row.processingStartedAt !== record.processingStartedAt) return false;
    this.write(row, patch);
    return true;
  }
  async updateUnclaimed(record: LeaveReminderRecord, staleBefore: string, patch: LeaveReminderRecordPatch) {
    const row = this.rows.get(record.id);
    if (!row || !this.same(row, record) || !this.unclaimed(row, staleBefore)) return false;
    this.write(row, patch);
    return true;
  }
  turnOff() { this.enabled = false; this.accountNextCheckAt = null; this.rows.clear(); }

  private same(row: LeaveReminderRecord, record: LeaveReminderRecord) {
    return row.status === record.status && row.routeCount === record.routeCount && sameInstant(row.nextCheckAt, record.nextCheckAt) &&
      (record.updateSentAt !== null || row.updateSentAt === null);
  }
  private unclaimed(row: LeaveReminderRecord, staleBefore: string) {
    return !row.processingStartedAt || Temporal.Instant.compare(Temporal.Instant.from(row.processingStartedAt), Temporal.Instant.from(staleBefore)) <= 0;
  }
  private strip(row: LeaveReminderRecord & { error: string | null }): LeaveReminderRecord {
    return { id: row.id, tripDigest: row.tripDigest, localDate: row.localDate, status: row.status, nextCheckAt: row.nextCheckAt,
      routeCount: row.routeCount, processingStartedAt: row.processingStartedAt, sentAt: row.sentAt, updateSentAt: row.updateSentAt,
      plannedPreparationMinutes: row.plannedPreparationMinutes ?? null };
  }
  private write(row: LeaveReminderRecord & { error: string | null }, patch: LeaveReminderRecordPatch) {
    const next = {
      ...row,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.next_check_at !== undefined ? { nextCheckAt: patch.next_check_at } : {}),
      ...(patch.route_count !== undefined ? { routeCount: patch.route_count } : {}),
      ...(patch.processing_started_at !== undefined ? { processingStartedAt: patch.processing_started_at } : {}),
      ...(patch.sent_at !== undefined ? { sentAt: patch.sent_at } : {}),
      ...(patch.update_sent_at !== undefined ? { updateSentAt: patch.update_sent_at } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.planned_preparation_minutes !== undefined ? { plannedPreparationMinutes: patch.planned_preparation_minutes } : {}),
    };
    if (next.plannedPreparationMinutes != null && (next.plannedPreparationMinutes < 0 || next.plannedPreparationMinutes > 60)) throw new Error("preparation");
    // The migration's checks and guard trigger.
    if (next.routeCount > 3 || next.routeCount < row.routeCount) throw new Error("route_count");
    if (next.routeCount === 3 && next.status !== "sent") throw new Error("third_route_after_send");
    if ((row.status === "sent" || row.status === "failed") && (next.status !== row.status || next.sentAt !== row.sentAt)) throw new Error("final");
    if (row.updateSentAt && next.updateSentAt !== row.updateSentAt) throw new Error("one_update");
    if (row.status === "sent" && row.nextCheckAt === null && next.nextCheckAt !== null) throw new Error("one_check");
    if (next.status === "pending" && row.status !== "pending" && !this.enabled) throw new Error("off");
    if (next.status === "pending" && (!next.nextCheckAt || next.sentAt)) throw new Error("shape");
    if (next.status === "sent" && next.processingStartedAt && !next.nextCheckAt) throw new Error("shape");
    if ((next.status === "failed" || next.status === "cancelled") && (next.nextCheckAt || next.processingStartedAt)) throw new Error("shape");
    this.rows.set(row.id, next);
  }
}

function sameInstant(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  return Temporal.Instant.compare(Temporal.Instant.from(left), Temporal.Instant.from(right)) === 0;
}

const EVENT_START = "2026-11-06T18:00:00Z"; // 13:00 local
const tripFor = (ref: string, startAt: string): LeaveReminderPlannedTrip => ({
  digest: leaveReminderTripDigest("calendar", ref, startAt), destinationRef: ref, role: "outbound", originRef: null, startAt, mode: "walking",
});

type World = {
  trips: LeaveReminderPlannedTrip[];
  leaveAt: Map<string, string>;
  budgetRefused: boolean;
  updatePaused: boolean;
  routeThrows: boolean;
  titleGone: boolean;
  /** A connected Outlook or iCloud Calendar's read failed. */
  calendarsLeftOut: boolean;
  /** Google Calendar's read fails, which fails the whole trip list. */
  googleFails: boolean;
  /** The send step's Calendar read leaves out the destination's Outlook or iCloud Calendar. */
  sendReadLeftOut: boolean;
  /** The send step's Calendar read leaves out the previous stop's Outlook or iCloud Calendar. */
  sendReadOriginLeftOut: boolean;
  /** The send-time read throws, as a failed Google Calendar read does. */
  sendReadThrows: boolean;
  /** Send-time reads, one per visit at most. */
  sendReads: number;
  routes: string[];
};

function harness(options: Readonly<{ store?: MemoryStore; preparationSeconds?: number }> = {}) {
  const store = options.store ?? new MemoryStore();
  const world: World = { trips: [tripFor("event-1", EVENT_START)], leaveAt: new Map([["event-1", "2026-11-06T17:20:00Z"]]),
    budgetRefused: false, updatePaused: false, routeThrows: false, titleGone: false, calendarsLeftOut: false, googleFails: false, sendReadLeftOut: false, sendReadOriginLeftOut: false, sendReadThrows: false, sendReads: 0, routes: [] };
  const preparation = { seconds: options.preparationSeconds ?? PREP_SECONDS };
  const sent: LeaveReminderMessage[] = [];
  const deliver = vi.fn<LeaveReminderDelivery>(async (_caller, message) => { sent.push(message); return { status: "sent" }; });
  const port = (): LeaveReminderAccountPort => ({
    caller: { userId: USER_ID } as LeaveReminderCaller,
    store,
    readContext: async () => ({ timezone: TZ, preparationSeconds: preparation.seconds, travelOn: true, habitsUpdatedAt: null }),
    listTrips: async () => {
      if (world.googleFails) throw new Error("google_calendar_unavailable");
      return { trips: world.trips, calendarsLeftOut: world.calendarsLeftOut };
    },
    routeTrips: async (_localDate, trips) => {
      if (world.routeThrows) throw new Error("provider_unavailable");
      const routed = new Map<string, LeaveReminderRouted>();
      for (const trip of trips) {
        world.routes.push(trip.destinationRef);
        const leaveAt = world.leaveAt.get(trip.destinationRef);
        if (!world.trips.some((current) => current.digest === trip.digest)) continue;
        routed.set(trip.digest, world.budgetRefused || !leaveAt
          ? { result: { kind: "unavailable", budgetRefused: world.budgetRefused }, estimate: null, mode: "walking", originRef: trip.originRef }
          : { result: { kind: "estimate", leaveAt }, mode: "walking", originRef: trip.originRef,
            estimate: { departureAt: leaveAt, arrivalAt: Temporal.Instant.from(leaveAt).add({ minutes: 30 }).toString(), durationSeconds: 1800 } });
      }
      return routed;
    },
    readSendCalendar: async () => {
      world.sendReads += 1;
      if (world.sendReadThrows) throw new Error("google_calendar_unavailable");
      const read: LeaveReminderSendRead = world.sendReadLeftOut ? { kind: "left_out" }
        : world.titleGone ? { kind: "gone" } : { kind: "found", details: { title: TITLE, origin: { kind: "home" } } };
      return { read: (_trip, originRef) => originRef !== null && world.sendReadOriginLeftOut ? { kind: "left_out" } : read };
    },
    updatePaused: async () => world.updatePaused,
  });
  const visit = async (at: string) => {
    const account = { userId: USER_ID, nextCheckAt: store.accountNextCheckAt ?? at };
    return visitLeaveReminderAccount(port(), account, Temporal.Instant.from(at), deliver);
  };
  return { store, world, sent, deliver, port, visit, preparation };
}

const only = (store: MemoryStore) => {
  expect(store.rows.size).toBe(1);
  return [...store.rows.values()][0]!;
};

describe("leave reminder job", () => {
  it("plans a trip, sends one reminder at its time, and never sends it twice", async () => {
    const { store, world, sent, visit } = harness();

    await visit("2026-11-06T15:00:00Z");
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T17:10:00Z", processingStartedAt: null });
    expect(store.accountNextCheckAt).toBe("2026-11-06T15:30:00Z");
    expect(sent).toEqual([]);

    // Due within the next 5 minutes: the reminder goes now rather than late.
    await visit("2026-11-06T17:06:00Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "reminder", leaveAt: "2026-11-06T17:20:00Z", expiresAt: "2026-11-06T17:20:00Z",
      startAt: EVENT_START, origin: { kind: "home" }, title: TITLE, travelMinutes: 30, mode: "walking" });
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2, sentAt: "2026-11-06T17:06:00Z", nextCheckAt: "2026-11-06T17:10:00Z" });

    // The update route: 5 minutes earlier is not enough for an update.
    world.leaveAt.set("event-1", "2026-11-06T17:15:00Z");
    await visit("2026-11-06T17:11:00Z");
    await visit("2026-11-06T17:16:00Z");
    expect(sent).toHaveLength(1);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 3, nextCheckAt: null, updateSentAt: null });
    expect(world.routes).toHaveLength(3);
  });

  it("sends the one update when the leave time moves 10 minutes or more earlier", async () => {
    const { store, world, sent, visit } = harness({ preparationSeconds: 30 * 60 });
    world.leaveAt.set("event-1", "2026-11-06T18:00:00Z");
    await visit("2026-11-06T15:00:00Z");
    expect(only(store).nextCheckAt).toBe("2026-11-06T17:30:00Z");
    await visit("2026-11-06T17:26:00Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder"]);

    // Too soon after sending: the update route waits for the next run.
    world.leaveAt.set("event-1", "2026-11-06T17:45:00Z");
    await visit("2026-11-06T17:28:00Z");
    expect(world.routes).toHaveLength(2);

    await visit("2026-11-06T17:31:00Z");
    expect(sent.map((message) => [message.kind, message.leaveAt])).toEqual([
      ["reminder", "2026-11-06T18:00:00Z"],
      ["update", "2026-11-06T17:45:00Z"],
    ]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 3, updateSentAt: "2026-11-06T17:31:00Z", nextCheckAt: null });

    // Nothing routes or sends again, however the estimate moves.
    world.leaveAt.set("event-1", "2026-11-06T17:35:00Z");
    await visit("2026-11-06T17:33:00Z");
    expect(world.routes).toHaveLength(3);
    expect(sent).toHaveLength(2);
  });

  it("skips the update route at 80% of the monthly budget (decision D16)", async () => {
    const { store, world, sent, visit } = harness({ preparationSeconds: 30 * 60 });
    world.leaveAt.set("event-1", "2026-11-06T18:00:00Z");
    await visit("2026-11-06T15:00:00Z");
    await visit("2026-11-06T17:26:00Z");
    world.updatePaused = true;
    world.leaveAt.set("event-1", "2026-11-06T17:45:00Z");
    await visit("2026-11-06T17:31:00Z");
    expect(sent).toHaveLength(1);
    expect(world.routes).toHaveLength(2);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2, nextCheckAt: null, error: "budget_paused" });
  });

  it("fails a reminder the budget refuses, without sending", async () => {
    const { store, world, deliver, visit } = harness();
    world.budgetRefused = true;
    await visit("2026-11-06T15:00:00Z");
    expect(only(store)).toMatchObject({ status: "failed", error: "budget_refused", routeCount: 1, nextCheckAt: null });
    expect(deliver).not.toHaveBeenCalled();
    await visit("2026-11-06T15:30:00Z");
    expect(world.routes).toHaveLength(1);
  });

  it("drops a removed event and treats a moved event as a new trip", async () => {
    const { store, world, sent, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    const first = only(store);

    // Moved an hour later: the old trip is dropped and the new one planned.
    const moved = tripFor("event-1", "2026-11-06T19:00:00Z");
    world.trips = [moved];
    world.leaveAt.set("event-1", "2026-11-06T18:20:00Z");
    await visit("2026-11-06T15:30:00Z");
    expect(store.rows.get(first.id)).toMatchObject({ status: "cancelled", nextCheckAt: null });
    const next = [...store.rows.values()].find((row) => row.tripDigest === moved.digest)!;
    expect(next).toMatchObject({ status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T18:10:00Z" });

    // Cancelled, declined, unlocated or resolved: it leaves the plan, so nothing sends.
    world.trips = [];
    await visit("2026-11-06T18:06:00Z");
    expect(store.rows.get(next.id)).toMatchObject({ status: "cancelled" });
    expect(sent).toEqual([]);
  });

  it("skips routing and drops pending trips while Travel estimates is off", async () => {
    const { store, world, sent, port, deliver, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    const listTrips = vi.fn(async () => ({ trips: world.trips, calendarsLeftOut: false }));
    const off = { ...port(), listTrips, readContext: async () => ({ timezone: TZ, preparationSeconds: PREP_SECONDS, travelOn: false, habitsUpdatedAt: null }) };
    await visitLeaveReminderAccount(off, { userId: USER_ID, nextCheckAt: store.accountNextCheckAt! }, Temporal.Instant.from("2026-11-06T17:06:00Z"), deliver);
    expect(listTrips).not.toHaveBeenCalled();
    expect(world.routes).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(only(store)).toMatchObject({ status: "cancelled" });
  });

  it("keeps a planned trip through an Outlook or iCloud outage and sends it once the Calendar reads again (Ticket 283)", async () => {
    const { store, world, sent, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    const planned = only(store);

    // The trip's Calendar read fails: the trip is missing from the list, but nothing is cancelled or routed.
    world.trips = [];
    world.calendarsLeftOut = true;
    await visit("2026-11-06T15:30:00Z");
    await visit("2026-11-06T17:06:00Z");
    expect(only(store)).toMatchObject({ id: planned.id, status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T17:10:00Z" });
    expect(world.routes).toHaveLength(1);
    expect(sent).toEqual([]);
    // The check is due, so the next run visits again.
    expect(store.accountNextCheckAt).toBe("2026-11-06T17:10:00Z");

    // The Calendar reads again: the kept record's send route runs while the leave time is ahead.
    world.trips = [tripFor("event-1", EVENT_START)];
    world.calendarsLeftOut = false;
    await visit("2026-11-06T17:11:00Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder"]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2 });
  });

  it("cancels nothing and retries later when Google Calendar's read fails", async () => {
    const { store, world, sent, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    const planned = only(store);
    world.googleFails = true;
    store.accountNextCheckAt = "2026-11-06T17:06:00Z";
    await expect(visit("2026-11-06T17:06:00Z")).resolves.toMatchObject({ kind: "failed", cancelled: 0 });
    expect(only(store)).toEqual(planned);
    expect(store.accountNextCheckAt).toBe("2026-11-06T17:16:00Z");
    expect(world.routes).toHaveLength(1);

    world.googleFails = false;
    await visit("2026-11-06T17:16:00Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder"]);
  });

  it("keeps a reminder pending, with no route spent, when the send step's Calendar read leaves its Calendar out", async () => {
    const { store, world, sent, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    const planned = only(store);

    // The trip list read every Calendar; the send step's read then fails for the destination's Calendar.
    world.sendReadLeftOut = true;
    await visit("2026-11-06T17:06:00Z");
    expect(sent).toEqual([]);
    expect(world.routes).toHaveLength(1);
    expect(only(store)).toMatchObject({ id: planned.id, status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T17:10:00Z", processingStartedAt: null });
    expect(store.accountNextCheckAt).toBe("2026-11-06T17:10:00Z");

    // The next visit reads it: the send route runs while the leave time is ahead.
    world.sendReadLeftOut = false;
    await visit("2026-11-06T17:11:00Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder"]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2 });
    expect(world.routes).toHaveLength(2);
  });

  it("keeps a reminder pending, with no route spent, when the send-time read leaves out the previous stop's Calendar", async () => {
    const { store, world, sent, visit } = harness();
    world.trips = [{ ...tripFor("event-1", EVENT_START), role: "onward", originRef: "outlook_calendar/breakfast" }];
    await visit("2026-11-06T15:00:00Z");

    world.sendReadOriginLeftOut = true;
    await visit("2026-11-06T17:06:00Z");
    expect(sent).toEqual([]);
    expect(world.routes).toHaveLength(1);
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T17:10:00Z", processingStartedAt: null });

    world.sendReadOriginLeftOut = false;
    await visit("2026-11-06T17:11:00Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder"]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2 });
  });

  it("keeps the update check, with no route spent, when the update step's read leaves out the previous stop's Calendar", async () => {
    const { store, world, sent, visit } = harness({ preparationSeconds: 30 * 60 });
    world.trips = [{ ...tripFor("event-1", EVENT_START), role: "onward", originRef: "outlook_calendar/breakfast" }];
    world.leaveAt.set("event-1", "2026-11-06T18:00:00Z");
    await visit("2026-11-06T15:00:00Z");
    await visit("2026-11-06T17:26:00Z");
    world.leaveAt.set("event-1", "2026-11-06T17:45:00Z");

    world.sendReadOriginLeftOut = true;
    await visit("2026-11-06T17:31:00Z");
    expect(world.routes).toHaveLength(2);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2, nextCheckAt: "2026-11-06T17:30:00Z", updateSentAt: null, processingStartedAt: null });

    world.sendReadOriginLeftOut = false;
    await visit("2026-11-06T17:36:00Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder", "update"]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 3, nextCheckAt: null });
  });

  it("keeps a reminder the plan route found due when the send-time read leaves its Calendar out", async () => {
    const { store, world, sent, visit } = harness();
    // First seen with its reminder time already due: the plan route is also the send route.
    world.sendReadLeftOut = true;
    await visit("2026-11-06T17:06:00Z");
    expect(sent).toEqual([]);
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T17:10:00Z", processingStartedAt: null, plannedPreparationMinutes: 10 });

    world.sendReadLeftOut = false;
    await visit("2026-11-06T17:11:00Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder"]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2 });
  });

  it("keeps the update check, with no route spent, when the update step's read leaves its Calendar out", async () => {
    const { store, world, sent, visit } = harness({ preparationSeconds: 30 * 60 });
    world.leaveAt.set("event-1", "2026-11-06T18:00:00Z");
    await visit("2026-11-06T15:00:00Z");
    await visit("2026-11-06T17:26:00Z");
    world.leaveAt.set("event-1", "2026-11-06T17:45:00Z");

    world.sendReadLeftOut = true;
    await visit("2026-11-06T17:31:00Z");
    expect(world.routes).toHaveLength(2);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2, nextCheckAt: "2026-11-06T17:30:00Z", updateSentAt: null, processingStartedAt: null });

    world.sendReadLeftOut = false;
    await visit("2026-11-06T17:36:00Z");
    expect(sent.map((message) => [message.kind, message.leaveAt])).toEqual([
      ["reminder", "2026-11-06T18:00:00Z"],
      ["update", "2026-11-06T17:45:00Z"],
    ]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 3, nextCheckAt: null });
  });

  it("releases its claims, with no route spent, when the send-time read fails outright", async () => {
    const { store, world, sent, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    world.sendReadThrows = true;
    await expect(visit("2026-11-06T17:06:00Z")).resolves.toMatchObject({ kind: "failed", cancelled: 0 });
    expect(world.routes).toHaveLength(1);
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, processingStartedAt: null });

    world.sendReadThrows = false;
    await visit(store.accountNextCheckAt!);
    expect(sent).toHaveLength(1);
  });

  it("reads Calendar once at send time for every trip the visit sends", async () => {
    const { store, world, sent, visit } = harness();
    world.trips = [tripFor("event-1", EVENT_START), tripFor("event-2", "2026-11-06T18:05:00Z")];
    world.leaveAt.set("event-2", "2026-11-06T17:20:00Z");
    await visit("2026-11-06T15:00:00Z");
    expect(world.sendReads).toBe(0);
    await visit(store.accountNextCheckAt!);
    await visit("2026-11-06T17:06:00Z");
    expect(sent).toHaveLength(2);
    expect(world.sendReads).toBe(1);
  });

  it("does not send when the event is gone at send time", async () => {
    const { store, world, sent, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    world.titleGone = true;
    await visit("2026-11-06T17:06:00Z");
    expect(sent).toEqual([]);
    expect(only(store)).toMatchObject({ status: "cancelled", routeCount: 2 });
  });

  it("does not send after reminders are turned off", async () => {
    const { store, sent, port, deliver } = harness();
    const visitPort = port();
    await visitLeaveReminderAccount(visitPort, { userId: USER_ID, nextCheckAt: store.accountNextCheckAt! }, Temporal.Instant.from("2026-11-06T15:00:00Z"), deliver);
    const original = store.remindersEnabled.bind(store);
    store.remindersEnabled = async () => { store.turnOff(); return original(); };
    store.accountNextCheckAt = "2026-11-06T17:10:00Z";
    await visitLeaveReminderAccount(visitPort, { userId: USER_ID, nextCheckAt: "2026-11-06T17:10:00Z" }, Temporal.Instant.from("2026-11-06T17:06:00Z"), deliver);
    expect(sent).toEqual([]);
    expect(store.rows.size).toBe(0);
  });

  it("never sends twice from overlapping runs", async () => {
    const { store, sent, visit, port, deliver } = harness();
    await visit("2026-11-06T15:00:00Z");
    store.accountNextCheckAt = "2026-11-06T17:10:00Z";
    // Both runs selected the account with the same next check time.
    const account = { userId: USER_ID, nextCheckAt: "2026-11-06T17:10:00Z" };
    const at = Temporal.Instant.from("2026-11-06T17:06:00Z");
    const results = await Promise.all([visitLeaveReminderAccount(port(), account, at, deliver), visitLeaveReminderAccount(port(), account, at, deliver)]);
    expect(results.map((result) => result.kind).sort()).toEqual(["skipped", "visited"]);
    expect(sent).toHaveLength(1);
  });

  it("claims each reminder, so runs that both reach an account still send once", async () => {
    class NoLeaseStore extends MemoryStore {
      override async claimAccount() { return true; }
      override async releaseAccount() { return true; }
    }
    const { store, sent, visit } = harness({ store: new NoLeaseStore() });
    await visit("2026-11-06T15:00:00Z");
    await Promise.all([visit("2026-11-06T17:06:00Z"), visit("2026-11-06T17:06:00Z"), visit("2026-11-06T17:07:00Z")]);
    expect(sent).toHaveLength(1);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2 });
  });

  it("releases its claims and retries soon when routing fails", async () => {
    const { store, world, sent, visit } = harness();
    await visit("2026-11-06T15:00:00Z");
    world.routeThrows = true;
    const result = await visit("2026-11-06T17:06:00Z");
    expect(result.kind).toBe("failed");
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, processingStartedAt: null });
    expect(store.accountNextCheckAt).toBe("2026-11-06T17:16:00Z");
    world.routeThrows = false;
    await visit("2026-11-06T17:16:00Z");
    expect(sent).toHaveLength(1);
  });

  it("keeps no title, place, duration or leave time in its records", async () => {
    const { store, visit } = harness({ preparationSeconds: 30 * 60 });
    await visit("2026-11-06T15:00:00Z");
    await visit("2026-11-06T16:46:00Z");
    const stored = JSON.stringify([...store.rows.values()]);
    expect(stored).not.toContain(TITLE);
    expect(stored).not.toContain("event-1");
    expect(stored).not.toContain("2026-11-06T17:20:00Z");
    expect(stored).not.toContain("1800");
  });

  it("cancels yesterday's unsent reminders at the new local date across the fall-back change", async () => {
    const store = new MemoryStore();
    const { world, visit } = harness({ store });
    world.trips = [tripFor("late", "2026-11-01T05:30:00Z")]; // 1:30 EDT, Sunday November 1
    world.leaveAt = new Map([["late", "2026-11-01T05:10:00Z"]]);
    store.accountNextCheckAt = "2026-11-01T04:00:00Z";
    await visit("2026-11-01T04:00:00Z"); // 0:00 EDT
    expect(only(store)).toMatchObject({ localDate: "2026-11-01", nextCheckAt: "2026-11-01T05:00:00Z" });
    world.trips = [];
    store.accountNextCheckAt = "2026-11-02T05:00:00Z";
    await visit("2026-11-02T05:00:00Z"); // midnight EST, November 2
    expect(only(store)).toMatchObject({ status: "cancelled" });
  });
});

describe("processLeaveReminders", () => {
  it("selects accounts due within the next 5 minutes, bounded, and visits each as its user", async () => {
    const selectDueAccounts = vi.fn(async () => [
      { userId: "a", nextCheckAt: "2026-11-06T15:00:00Z" },
      { userId: "b", nextCheckAt: "2026-11-06T15:03:00Z" },
    ]);
    const opened: string[] = [];
    const result = await processLeaveReminders({
      now: () => Temporal.Instant.from("2026-11-06T15:00:00Z"),
      limit: 500,
      deliver: vi.fn(),
      selectDueAccounts,
      openAccount: (userId) => {
        opened.push(userId);
        const { port } = harness();
        return { ...port(), store: Object.assign(new MemoryStore(), { accountNextCheckAt: userId === "a" ? "2026-11-06T15:00:00Z" : "2026-11-06T15:03:00Z" }) };
      },
    });
    expect(selectDueAccounts).toHaveBeenCalledWith({ dueBy: new Date("2026-11-06T15:05:00Z"), limit: 100 });
    expect(opened.sort()).toEqual(["a", "b"]);
    expect(result).toMatchObject({ selected: 2, visited: 2, planned: 2 });
  });

  it("starts no visit after its run budget", async () => {
    let clock = Temporal.Instant.from("2026-11-06T15:00:00Z");
    const result = await processLeaveReminders({
      now: () => (clock = clock.add({ seconds: 30 })),
      runBudgetMs: 40_000,
      deliver: vi.fn(),
      selectDueAccounts: async () => [{ userId: "a", nextCheckAt: "x" }, { userId: "b", nextCheckAt: "x" }, { userId: "c", nextCheckAt: "x" }],
      openAccount: () => { throw new Error("not reached for skipped accounts"); },
    });
    expect(result.selected).toBe(3);
    expect(result.skipped + result.failed).toBe(3);
    expect(result.skipped).toBeGreaterThan(0);
  });
});

describe("get-ready change before the reminder sends (Codex review, Ticket 277)", () => {
  // Leave time 17:20Z. Planned with 10 minutes of get-ready time, the check is 17:10Z.
  it("moves the pending check to the new reminder time without a route, then sends at it", async () => {
    const { store, world, sent, visit, preparation } = harness();
    await visit("2026-11-06T15:00:00Z");
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T17:10:00Z", plannedPreparationMinutes: 10 });

    preparation.seconds = 60 * 60;
    await visit("2026-11-06T15:30:00Z");
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T16:20:00Z", plannedPreparationMinutes: 60 });
    expect(world.routes).toHaveLength(1);
    expect(store.accountNextCheckAt).toBe("2026-11-06T16:00:00Z");

    await visit("2026-11-06T16:16:00Z");
    expect(sent.map((message) => [message.kind, message.leaveAt])).toEqual([["reminder", "2026-11-06T17:20:00Z"]]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2, sentAt: "2026-11-06T16:16:00Z" });
    expect(world.routes).toHaveLength(2);
  });

  it("sends at once when the moved reminder time has passed but the leave time is ahead", async () => {
    const { store, world, sent, visit, preparation } = harness();
    await visit("2026-11-06T15:00:00Z");
    preparation.seconds = 60 * 60;
    await visit("2026-11-06T16:40:00Z");
    expect(sent.map((message) => [message.kind, message.leaveAt])).toEqual([["reminder", "2026-11-06T17:20:00Z"]]);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2 });
    expect(world.routes).toHaveLength(2);
  });

  it("moves the check later when get-ready time shrinks, so the reminder does not fire early", async () => {
    const { store, world, sent, visit, preparation } = harness({ preparationSeconds: 30 * 60 });
    await visit("2026-11-06T15:00:00Z");
    expect(only(store).nextCheckAt).toBe("2026-11-06T16:50:00Z");
    preparation.seconds = 0;
    await visit("2026-11-06T16:47:00Z");
    expect(sent).toEqual([]);
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, nextCheckAt: "2026-11-06T17:20:00Z", plannedPreparationMinutes: 0 });
    expect(world.routes).toHaveLength(1);
    await visit("2026-11-06T17:16:00Z");
    expect(sent).toHaveLength(1);
    expect(world.routes).toHaveLength(2);
  });

  it("never routes a trip more than three times across a get-ready change", async () => {
    const { store, world, sent, visit, preparation } = harness();
    await visit("2026-11-06T15:00:00Z");
    preparation.seconds = 60 * 60;
    await visit("2026-11-06T15:30:00Z");
    await visit("2026-11-06T16:16:00Z");
    world.leaveAt.set("event-1", "2026-11-06T17:05:00Z");
    for (const at of ["2026-11-06T16:21:00Z", "2026-11-06T16:26:00Z", "2026-11-06T16:31:00Z", "2026-11-06T16:36:00Z"]) await visit(at);
    expect(world.routes.length).toBeLessThanOrEqual(3);
    expect(only(store).routeCount).toBeLessThanOrEqual(3);
    expect(sent.length).toBeLessThanOrEqual(2);
  });
});

describe("decision D15 update threshold (verifier, Ticket 277)", () => {
  // get-ready 30 min, named leave 18:00, so the stored check is the named reminder time 17:30.
  async function sentReminder(options: Readonly<{ preparation?: { seconds: number } }> = {}) {
    const preparation = options.preparation ?? { seconds: 30 * 60 };
    const h = harness({ preparationSeconds: 30 * 60 });
    const port = h.port;
    h.world.leaveAt.set("event-1", "2026-11-06T18:00:00Z");
    const visitWith = async (at: string, habitsUpdatedAt: string | null = null, preparationChangedAt: string | null = null) => {
      const base = port();
      const custom = { ...base, readContext: async () => ({ timezone: TZ, preparationSeconds: preparation.seconds, travelOn: true, habitsUpdatedAt,
        preparationChangedAt }) };
      return visitLeaveReminderAccount(custom, { userId: USER_ID, nextCheckAt: h.store.accountNextCheckAt ?? at }, Temporal.Instant.from(at), h.deliver);
    };
    await visitWith("2026-11-06T15:00:00Z");
    await visitWith("2026-11-06T17:26:00Z");
    expect(h.sent.map((message) => [message.kind, message.leaveAt])).toEqual([["reminder", "2026-11-06T18:00:00Z"]]);
    expect(only(h.store)).toMatchObject({ status: "sent", nextCheckAt: "2026-11-06T17:30:00Z", routeCount: 2 });
    return { ...h, preparation, visitWith };
  }

  it("sends exactly one update when the leave time moves exactly 10 minutes earlier", async () => {
    const { store, world, sent, visitWith } = await sentReminder();
    world.leaveAt.set("event-1", "2026-11-06T17:50:00Z");
    await visitWith("2026-11-06T17:31:00Z");
    world.leaveAt.set("event-1", "2026-11-06T17:38:00Z");
    await visitWith("2026-11-06T17:36:00Z");
    await visitWith("2026-11-06T17:41:00Z");
    expect(sent.map((message) => [message.kind, message.leaveAt])).toEqual([
      ["reminder", "2026-11-06T18:00:00Z"], ["update", "2026-11-06T17:50:00Z"],
    ]);
    expect(only(store)).toMatchObject({ routeCount: 3, updateSentAt: "2026-11-06T17:31:00Z", nextCheckAt: null });
    expect(world.routes).toHaveLength(3);
  });

  it("sends no update when the leave time moves 9 minutes earlier, and never routes again", async () => {
    const { store, world, sent, visitWith } = await sentReminder();
    world.leaveAt.set("event-1", "2026-11-06T17:51:00Z");
    await visitWith("2026-11-06T17:31:00Z");
    world.leaveAt.set("event-1", "2026-11-06T17:40:00Z");
    await visitWith("2026-11-06T17:36:00Z");
    expect(sent).toHaveLength(1);
    expect(only(store)).toMatchObject({ routeCount: 3, updateSentAt: null, nextCheckAt: null });
    expect(world.routes).toHaveLength(3);
  });

  it("sends no false update when get-ready time grows after sending and the leave time holds", async () => {
    const { store, world, sent, preparation, visitWith } = await sentReminder();
    preparation.seconds = 45 * 60; // the user adds 15 minutes of get-ready time at 17:28
    await visitWith("2026-11-06T17:31:00Z", "2026-11-06T17:28:00.000000Z");
    expect(sent).toHaveLength(1);
    expect(only(store)).toMatchObject({ updateSentAt: null, nextCheckAt: null });
    // The named leave time is unknown, so the check closes without a route.
    expect(world.routes).toHaveLength(2);
  });

  it("closes the check without a route when get-ready time shrinks after sending", async () => {
    const { store, world, sent, preparation, visitWith } = await sentReminder();
    preparation.seconds = 20 * 60;
    world.leaveAt.set("event-1", "2026-11-06T17:50:00Z");
    await visitWith("2026-11-06T17:31:00Z", "2026-11-06T17:28:00.000000Z");
    expect(sent).toHaveLength(1);
    expect(only(store)).toMatchObject({ updateSentAt: null, nextCheckAt: null, routeCount: 2 });
    expect(world.routes).toHaveLength(2);
  });

  it("keeps the exact rule when habits last changed before the reminder was sent", async () => {
    const { sent, world, visitWith } = await sentReminder();
    world.leaveAt.set("event-1", "2026-11-06T17:50:00Z");
    await visitWith("2026-11-06T17:31:00Z", "2026-11-06T09:00:00.000000Z", "2026-11-06T09:00:00.000000Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder", "update"]);
  });

  // Wave 4 final check: habits_updated_at comes from the Mac's clock and arrives when the Mac
  // syncs. The database stamps preparation_changed_at itself, so skew can only close a check.
  it.each([
    ["a slow Mac clock dates the change before sending", "2026-11-06T17:00:00.000000Z"],
    ["an offline Mac change made before sending syncs after it", "2026-11-06T17:10:00.000000Z"],
  ])("sends no false update when %s", async (_case, habitsUpdatedAt) => {
    const { store, world, sent, preparation, visitWith } = await sentReminder();
    preparation.seconds = 45 * 60; // the hosted row's get-ready time grows at 17:28:30, database time
    await visitWith("2026-11-06T17:31:00Z", habitsUpdatedAt, "2026-11-06T17:28:30.000000Z");
    expect(sent).toHaveLength(1);
    expect(only(store)).toMatchObject({ updateSentAt: null, nextCheckAt: null, routeCount: 2 });
    expect(world.routes).toHaveLength(2);
  });

  it("treats a get-ready change within a minute before sending as after it, so clock difference only closes the check", async () => {
    const { store, world, sent, visitWith } = await sentReminder();
    world.leaveAt.set("event-1", "2026-11-06T17:50:00Z");
    // Sent at 17:26:00 by the job's clock; the database stamped the change 30 s earlier.
    await visitWith("2026-11-06T17:31:00Z", "2026-11-06T09:00:00.000000Z", "2026-11-06T17:25:30.000000Z");
    expect(sent).toHaveLength(1);
    expect(only(store)).toMatchObject({ updateSentAt: null, nextCheckAt: null, routeCount: 2 });
    expect(world.routes).toHaveLength(2);
  });

  it("keeps the exact rule when the database stamped the change more than a minute before sending", async () => {
    const { sent, world, visitWith } = await sentReminder();
    world.leaveAt.set("event-1", "2026-11-06T17:50:00Z");
    await visitWith("2026-11-06T17:31:00Z", "2026-11-06T09:00:00.000000Z", "2026-11-06T17:24:59.000000Z");
    expect(sent.map((message) => message.kind)).toEqual(["reminder", "update"]);
  });
});

describe("spend after a routing failure (Wave 4 final check)", () => {
  // The hosted port routes through the shared travel refresh, which reserves list price in
  // reserve_travel_provider_spend before every provider call and never refunds a reservation.
  // A refused reservation reserves nothing and surfaces as a budget-refused result.
  it("reserves again on each retry after a throw that followed spending, and never passes the monthly ceiling", async () => {
    const { store, world, sent, port } = harness();
    const ledger = { ceiling: 3, reserved: 0, attempts: 0 };
    let throwAfterSpend = false;
    const spendingPort = (): LeaveReminderAccountPort => {
      const base = port();
      return { ...base, routeTrips: async (localDate, trips) => {
        ledger.attempts += 1;
        if (ledger.reserved + trips.length > ledger.ceiling) {
          return new Map(trips.map((trip) => [trip.digest, { result: { kind: "unavailable", budgetRefused: true }, estimate: null, mode: trip.mode,
            originRef: trip.originRef } satisfies LeaveReminderRouted]));
        }
        ledger.reserved += trips.length;
        if (throwAfterSpend) throw new Error("context_changed");
        return base.routeTrips(localDate, trips);
      } };
    };
    const visit = (at: string) => visitLeaveReminderAccount(spendingPort(), { userId: USER_ID, nextCheckAt: store.accountNextCheckAt ?? at },
      Temporal.Instant.from(at), vi.fn<LeaveReminderDelivery>(async (_caller, message) => { sent.push(message); return { status: "sent" }; }));

    await visit("2026-11-06T15:00:00Z"); // plan route: 1 reserved
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1 });
    throwAfterSpend = true;
    expect((await visit("2026-11-06T17:06:00Z")).kind).toBe("failed"); // send route reserves, then throws
    expect(only(store)).toMatchObject({ status: "pending", routeCount: 1, processingStartedAt: null });
    expect((await visit("2026-11-06T17:16:00Z")).kind).toBe("failed"); // the retry reserves again
    expect(ledger).toMatchObject({ reserved: 3, attempts: 3 });
    await visit("2026-11-06T17:26:00Z"); // the next retry is refused at the ceiling
    expect(ledger).toMatchObject({ reserved: 3, attempts: 4 });
    expect(ledger.reserved).toBeLessThanOrEqual(ledger.ceiling);
    expect(sent).toHaveLength(0);
    expect(store.rows.get(only(store).id)).toMatchObject({ status: "failed", error: "budget_refused", routeCount: 2 });
    expect(world.routes).toHaveLength(1);
  });
});

describe("a get-ready change during a running visit (decision D19)", () => {
  // The D19 trigger sets the account's next check to now, replacing a running visit's
  // lease. The next run then visits while the first is still running. Each record's own
  // claim must keep the two visits from routing or sending one reminder twice.
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => { reached = resolve; });
    return { open, opened, reached, waiting };
  };

  it("does not route or send again while the first visit holds the record", async () => {
    const { store, world, sent, visit, port, deliver, preparation } = harness();
    await visit("2026-11-06T15:00:00Z");
    store.accountNextCheckAt = "2026-11-06T17:10:00Z";

    const routing = gate();
    const first = port();
    const route = first.routeTrips;
    const firstPort: LeaveReminderAccountPort = { ...first, routeTrips: async (localDate, trips) => {
      routing.reached();
      await routing.opened;
      return route(localDate, trips);
    } };
    const running = visitLeaveReminderAccount(firstPort, { userId: USER_ID, nextCheckAt: "2026-11-06T17:10:00Z" },
      Temporal.Instant.from("2026-11-06T17:06:00Z"), deliver);
    await routing.waiting;
    const lease = store.accountNextCheckAt;

    // The user saves a new get-ready time; the trigger moves the visit to now.
    preparation.seconds = 20 * 60;
    store.accountNextCheckAt = "2026-11-06T17:07:00Z";
    const overlapping = await visit("2026-11-06T17:07:00Z");
    expect(overlapping.kind).toBe("visited");
    expect(world.routes).toHaveLength(1);
    expect(sent).toEqual([]);

    routing.open();
    expect((await running).kind).toBe("visited");
    expect(sent).toHaveLength(1);
    expect(world.routes).toHaveLength(2);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2, processingStartedAt: null });
    // The first visit's release missed: the account keeps the overlapping visit's next check.
    expect(store.accountNextCheckAt).not.toBe(lease);
  });

  it("keeps the first visit's own next check when its release misses, so the reminder is not late", async () => {
    const { store, world, sent, visit, port, deliver, preparation } = harness();
    // Leave 15:16, 10 minutes to get ready: the reminder is at 15:06.
    world.leaveAt.set("event-1", "2026-11-06T15:16:00Z");

    const routing = gate();
    const first = port();
    const route = first.routeTrips;
    const firstPort: LeaveReminderAccountPort = { ...first, routeTrips: async (localDate, trips) => {
      routing.reached();
      await routing.opened;
      return route(localDate, trips);
    } };
    const running = visitLeaveReminderAccount(firstPort, { userId: USER_ID, nextCheckAt: "2026-11-06T15:00:00Z" },
      Temporal.Instant.from("2026-11-06T15:00:00Z"), deliver);
    await routing.waiting;

    // A get-ready change moves the visit to now. The overlapping visit sees the record
    // held, so it sets the next check from that claim, 20 minutes on.
    preparation.seconds = 12 * 60;
    store.accountNextCheckAt = "2026-11-06T15:01:00Z";
    await visit("2026-11-06T15:01:00Z");
    expect(store.accountNextCheckAt).toBe("2026-11-06T15:20:00Z");

    routing.open();
    await running;
    expect(only(store)).toMatchObject({ status: "pending", nextCheckAt: "2026-11-06T15:06:00Z", plannedPreparationMinutes: 10 });
    // The first visit's lease was replaced, but its own next check still counts.
    expect(store.accountNextCheckAt).toBe("2026-11-06T15:06:00Z");

    await visit("2026-11-06T15:05:00Z");
    expect(sent.map((message) => [message.kind, message.leaveAt])).toEqual([["reminder", "2026-11-06T15:16:00Z"]]);
    expect(world.routes).toHaveLength(2);
  });

  it("does not route or send from a stale read after the overlapping visit sent", async () => {
    const { store, world, sent, visit, port, deliver, preparation } = harness();
    await visit("2026-11-06T15:00:00Z");
    store.accountNextCheckAt = "2026-11-06T17:10:00Z";

    const listing = gate();
    const first = port();
    const list = first.listTrips;
    const firstPort: LeaveReminderAccountPort = { ...first, listTrips: async (localDate) => {
      listing.reached();
      await listing.opened;
      return list(localDate);
    } };
    const running = visitLeaveReminderAccount(firstPort, { userId: USER_ID, nextCheckAt: "2026-11-06T17:10:00Z" },
      Temporal.Instant.from("2026-11-06T17:06:00Z"), deliver);
    await listing.waiting;

    preparation.seconds = 20 * 60;
    store.accountNextCheckAt = "2026-11-06T17:07:00Z";
    await visit("2026-11-06T17:07:00Z");
    expect(sent).toHaveLength(1);
    expect(world.routes).toHaveLength(2);

    // The first visit read the records before the overlapping visit sent.
    listing.open();
    await running;
    expect(sent).toHaveLength(1);
    expect(world.routes).toHaveLength(2);
    expect(only(store)).toMatchObject({ status: "sent", routeCount: 2 });
  });
});
