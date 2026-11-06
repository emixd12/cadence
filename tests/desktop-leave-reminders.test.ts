import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { macLeaveReminderDigest, macLeaveReminderId } from "@cadence/core/services/mac-leave-reminder-plan";
import type { DepartureStop, DepartureTrip } from "@cadence/core/types/departure";
import { notifications, type Reminder } from "../apps/desktop/src/native-spike";
import { readLeaveReminderMemory, reconcileLeaveReminders, resetLeaveRemindersForTest } from "../apps/desktop/src/local-leave-reminder.service";
import { latestNotificationActivation, leaveReminderTarget } from "../apps/desktop/src/notification-activation";

vi.mock("../apps/desktop/src/native-spike", () => ({ notifications: vi.fn() }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: vi.fn() }));

const TZ = "America/New_York";
const at = (time: string) => Temporal.ZonedDateTime.from(`2026-11-10T${time}[${TZ}]`).toInstant().toString();
const DENTIST: DepartureStop = { ref: "event-dentist", label: "Dentist", startAt: at("14:30"), endAt: at("15:30") };
const ID = macLeaveReminderId(macLeaveReminderDigest(DENTIST.ref, DENTIST.startAt));
const BEHAVIOR_ID = "cadence.local.33333333-3333-4333-8333-333333333333";
const trip: DepartureTrip = { key: "k", legId: "leg", role: "outbound", originRef: null, destinationRef: DENTIST.ref, mode: "walking",
  fromHome: true, state: "upcoming", lateBasis: null, freshness: "current", checkedAt: at("12:40"), leaveAt: at("13:15"),
  arriveAt: at("14:20"), getReadyAt: at("13:05"), minutesUntilLeave: 35, appearsAt: null, timeUnknownCause: null,
  blockingRef: null, blockingLabel: null, action: null, phrase: "", linePhrase: "" };
const departure = { localDate: "2026-11-10", timezone: TZ, preparationSeconds: 600, trips: [trip], stops: [DENTIST] };

/** A small macOS Notification Center: pending and delivered requests by identifier. */
function fakeCenter(options: { permission?: string; keep?: (id: string) => boolean } = {}) {
  const pending = new Map<string, Reminder>();
  const delivered = new Map<string, Reminder>();
  vi.mocked(notifications).mockImplementation(async (request) => {
    switch (request.operation) {
      case "status": return { authorization: options.permission ?? "authorized" };
      case "pending": return { pending: [...pending.values()] };
      case "delivered": return { delivered: [...delivered.values()].map((item) => ({ ...item, deliveredAt: item.fireAt })) };
      case "cancelPending": for (const id of request.ids ?? []) pending.delete(id); return { pending: [...pending.values()] };
      case "cancel": for (const id of request.ids ?? []) { pending.delete(id); delivered.delete(id); } return { pending: [...pending.values()] };
      case "schedule": {
        const kept = (request.reminders ?? []).filter(({ id }) => options.keep?.(id) ?? true);
        for (const reminder of kept) pending.set(reminder.id, reminder);
        return { pending: [...pending.values()], missingIds: (request.reminders ?? []).filter((item) => !kept.includes(item)).map(({ id }) => id), errors: [] };
      }
      default: return {};
    }
  });
  return { pending, delivered };
}

function storageStub() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } });
}

describe("Mac leave reminder service (Ticket 280)", () => {
  beforeEach(() => {
    vi.mocked(notifications).mockReset();
    storageStub();
    resetLeaveRemindersForTest();
  });

  it("schedules from the last estimate, remembers it, and does not reschedule an unchanged plan", async () => {
    const center = fakeCenter();
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure, now: Temporal.Instant.from(at("12:45")) });
    expect([...center.pending.keys()]).toEqual([ID]);
    expect(center.pending.get(ID)).toMatchObject({ fireAt: at("13:05"), title: "Leave by 1:15 PM for Dentist" });
    expect(readLeaveReminderMemory()).toMatchObject({ accountId: "user-a", enabled: true, records: [{ reminderAt: at("13:05") }] });
    const calls = vi.mocked(notifications).mock.calls.length;
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure, now: Temporal.Instant.from(at("12:50")) });
    expect(vi.mocked(notifications).mock.calls.slice(calls).map(([request]) => request.operation)).not.toContain("schedule");
  });

  it("turning reminders off removes leave reminders only, pending and delivered", async () => {
    const center = fakeCenter();
    center.pending.set(BEHAVIOR_ID, { id: BEHAVIOR_ID, title: "Stretch", body: "b", fireAt: at("13:00") });
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure, now: Temporal.Instant.from(at("12:45")) });
    center.delivered.set(`${ID}.update`, { id: `${ID}.update`, title: "t", body: "b", fireAt: at("12:46") });
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => false, departure, now: Temporal.Instant.from(at("12:47")) });
    expect([...center.pending.keys()]).toEqual([BEHAVIOR_ID]);
    expect([...center.delivered.keys()]).toEqual([]);
    expect(readLeaveReminderMemory()).toMatchObject({ enabled: false, records: [] });
  });

  it("clears another account's reminders and an unlinked Mac's", async () => {
    const center = fakeCenter();
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure, now: Temporal.Instant.from(at("12:45")) });
    await reconcileLeaveReminders({ accountId: null, timezone: TZ, loadEnabled: null, departure: null, now: Temporal.Instant.from(at("12:46")) });
    expect(center.pending.size).toBe(0);
    expect(readLeaveReminderMemory()).toMatchObject({ accountId: null, records: [] });
  });

  it("keeps the last known switch offline and plans nothing before the switch was ever read", async () => {
    const center = fakeCenter();
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => { throw new Error("offline"); }, departure, now: Temporal.Instant.from(at("12:45")) });
    expect(center.pending.size).toBe(0);
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure: null, now: Temporal.Instant.from(at("12:45")) });
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => { throw new Error("offline"); }, departure, now: Temporal.Instant.from(at("12:46")) });
    expect([...center.pending.keys()]).toEqual([ID]);
  });

  it("does not remember a reminder macOS did not keep, so the next reconcile schedules it again", async () => {
    let keep = false;
    const center = fakeCenter({ keep: () => keep });
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure, now: Temporal.Instant.from(at("12:45")) });
    expect(readLeaveReminderMemory().records).toEqual([]);
    keep = true;
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure, now: Temporal.Instant.from(at("12:46")) });
    expect([...center.pending.keys()]).toEqual([ID]);
  });

  it("schedules nothing without notification permission", async () => {
    const center = fakeCenter({ permission: "denied" });
    await reconcileLeaveReminders({ accountId: "user-a", timezone: TZ, loadEnabled: async () => true, departure, now: Temporal.Instant.from(at("12:45")) });
    expect(center.pending.size).toBe(0);
    expect(vi.mocked(notifications).mock.calls.map(([request]) => request.operation)).not.toContain("schedule");
    expect(readLeaveReminderMemory().records).toEqual([]);
  });
});

describe("leave reminder activation (Ticket 280)", () => {
  it("takes the latest activated reminder of either kind", () => {
    const digest = macLeaveReminderDigest(DENTIST.ref, DENTIST.startAt);
    expect(latestNotificationActivation([
      { kind: "notificationActivated", id: BEHAVIOR_ID, at: "1" },
      { kind: "notificationActivated", id: `${ID}.update`, at: "2" },
      { kind: "notificationPresented", id: BEHAVIOR_ID, at: "3" },
    ])).toEqual({ kind: "leave", digest });
    expect(latestNotificationActivation([
      { kind: "notificationActivated", id: ID, at: "1" },
      { kind: "notificationActivated", id: BEHAVIOR_ID, at: "2" },
    ])).toEqual({ kind: "occurrence", occurrenceId: "33333333-3333-4333-8333-333333333333" });
    expect(latestNotificationActivation([{ kind: "notificationActivated", id: "cadence.leave.nope", at: "1" }])).toBeNull();
  });

  it("finds the event or Occurrence the reminder names, and nothing once the event moved", () => {
    const digest = macLeaveReminderDigest(DENTIST.ref, DENTIST.startAt);
    expect(leaveReminderTarget(digest, { events: [{ id: DENTIST.ref, kind: "timed", startAt: DENTIST.startAt }], occurrences: [] }))
      .toEqual({ kind: "event", eventId: DENTIST.ref });
    expect(leaveReminderTarget(digest, { events: [{ id: DENTIST.ref, kind: "timed", startAt: at("15:00") }], occurrences: [] })).toBeNull();
    const occurrence = { id: "33333333-3333-4333-8333-333333333333", scheduledFor: at("18:00") };
    expect(leaveReminderTarget(macLeaveReminderDigest(occurrence.id, occurrence.scheduledFor), { events: [], occurrences: [occurrence] }))
      .toEqual({ kind: "occurrence", occurrenceId: occurrence.id });
  });
});
