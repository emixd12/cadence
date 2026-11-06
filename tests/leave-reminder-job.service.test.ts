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
    if (!this.enabled || !sameInstant(this.accountNextCheckAt, lease)) return false;
    this.accountNextCheckAt = next;
    return true;
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
      nextCheckAt: input.now, routeCount: 0, processingStartedAt: input.now, sentAt: null, updateSentAt: null, error: null };
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
      routeCount: row.routeCount, processingStartedAt: row.processingStartedAt, sentAt: row.sentAt, updateSentAt: row.updateSentAt };
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
    };
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
  routes: string[];
};

function harness(options: Readonly<{ store?: MemoryStore; preparationSeconds?: number }> = {}) {
  const store = options.store ?? new MemoryStore();
  const world: World = { trips: [tripFor("event-1", EVENT_START)], leaveAt: new Map([["event-1", "2026-11-06T17:20:00Z"]]),
    budgetRefused: false, updatePaused: false, routeThrows: false, titleGone: false, routes: [] };
  const sent: LeaveReminderMessage[] = [];
  const deliver = vi.fn<LeaveReminderDelivery>(async (_caller, message) => { sent.push(message); return { status: "sent" }; });
  const port = (): LeaveReminderAccountPort => ({
    caller: { userId: USER_ID } as LeaveReminderCaller,
    store,
    readContext: async () => ({ timezone: TZ, preparationSeconds: options.preparationSeconds ?? PREP_SECONDS, travelOn: true }),
    listTrips: async () => world.trips,
    routeTrips: async (_localDate, trips) => {
      if (world.routeThrows) throw new Error("provider_unavailable");
      const routed = new Map<string, LeaveReminderRouted>();
      for (const trip of trips) {
        world.routes.push(trip.destinationRef);
        const leaveAt = world.leaveAt.get(trip.destinationRef);
        if (!world.trips.some((current) => current.digest === trip.digest)) continue;
        routed.set(trip.digest, world.budgetRefused || !leaveAt
          ? { result: { kind: "unavailable", budgetRefused: world.budgetRefused }, estimate: null, mode: "walking", originRef: null }
          : { result: { kind: "estimate", leaveAt }, mode: "walking", originRef: null,
            estimate: { departureAt: leaveAt, arrivalAt: Temporal.Instant.from(leaveAt).add({ minutes: 30 }).toString(), durationSeconds: 1800 } });
      }
      return routed;
    },
    readSendDetails: async () => world.titleGone ? null : { title: TITLE, origin: { kind: "home" } },
    updatePaused: async () => world.updatePaused,
  });
  const visit = async (at: string) => {
    const account = { userId: USER_ID, nextCheckAt: store.accountNextCheckAt ?? at };
    return visitLeaveReminderAccount(port(), account, Temporal.Instant.from(at), deliver);
  };
  return { store, world, sent, deliver, port, visit };
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
