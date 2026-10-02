import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeReminderState } from "../apps/desktop/src/local-store";
import type { NativeReminderPendingRequest, NativeReminderRequest } from "@cadence/core/resolvers/native-reminder.resolver";
import { storedBehavior, storedExportOccurrence, USER_ID, uuid } from "./helpers/export-row-fixture";

const mocks = vi.hoisted(() => ({ command: vi.fn(), notifications: vi.fn() }));
vi.mock("../apps/desktop/src/local-store", () => ({ localCommand: mocks.command,
  localMutation: (profileId: string, now: string) => ({ profileId, now, mutationId: "test-mutation" }) }));
vi.mock("../apps/desktop/src/local-generation.service", () => ({ ensureLocalOccurrencesFresh: async () => {} }));
vi.mock("../apps/desktop/src/native-spike", () => ({ notifications: mocks.notifications }));
import { reconcileLocalReminders, retainNativeDeliveryEvents } from "../apps/desktop/src/local-reminder.service";
import type { DeliveredReminder, NativeDeliveryProof } from "../apps/desktop/src/native-spike";

const NOW = Temporal.Instant.from("2026-08-30T12:00:00Z");
let state: NativeReminderState;
let active = true;
let count = 29;
let pending = new Map<string, NativeReminderPendingRequest>();
let delivered: ({ id: string } & Partial<DeliveredReminder>)[] = [];
type OsRequest = { operation: string; reminders?: NativeReminderRequest[]; ids?: string[] };

beforeEach(() => {
  vi.useFakeTimers();
  state = { revision: 0, reminders: [], coverage: null }; active = true; count = 29;
  pending = new Map(); delivered = [];
  mocks.command.mockImplementation(async (operation, input) => {
    if (operation === "readProfile") return { id: USER_ID, timezone: "America/New_York" };
    if (operation === "readNativeReminderState") return structuredClone(state);
    if (operation === "readBehaviorGraphs") return [{ behavior: { ...storedBehavior(), active } }];
    if (operation === "readOccurrences") return Array.from({ length: count }, (_, index) => ({ ...storedExportOccurrence(), id: uuid(index + 1), user_id: USER_ID,
      scheduled_for: NOW.add({ hours: 24, minutes: index }).toString(), local_date: "2026-08-31" }));
    if (operation === "commitNativeReminderPlan") {
      const next = new Map(state.reminders.map((row) => [row.id, row]));
      for (const row of input.reminders) next.set(row.id, row);
      for (const id of input.cancelIds) next.get(id)!.status = "cancelled";
      state.reminders = [...next.values()];
    } else if (operation === "recordNativeReminderCoverage") {
      state.coverage = input.coverage;
      for (const observation of input.observed) {
        const row = state.reminders.find(({ id }) => id === observation.id)!;
        row.status = observation.status; row.error = observation.error; row.verified_at = input.now;
      }
    }
    else throw new Error(`Unexpected local operation ${operation}`);
    state.revision += 1;
    return structuredClone(state);
  });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

function ordinary(request: OsRequest) {
  if (request.operation === "status") return { authorization: "authorized" };
  if (request.operation === "delivered") return { delivered };
  if (["cancel", "cancelPending"].includes(request.operation)) {
    for (const id of request.ids ?? []) pending.delete(id);
    if (request.operation === "cancel") delivered = delivered.filter(({ id }) => !request.ids?.includes(id));
  }
  if (request.operation === "schedule") for (const item of request.reminders ?? []) pending.set(item.id, item);
  return { pending: [...pending.values()], errors: [] };
}
async function reconcile() { const result = reconcileLocalReminders(NOW); await vi.runAllTimersAsync(); return result; }
const cancellations = () => mocks.notifications.mock.calls.filter(([request]) => ["cancel", "cancelPending"].includes(request.operation)).flatMap(([request]) => request.ids);

describe("observed native delivery", () => {
  const delivery: NativeDeliveryProof = { requestId: `cadence.local.${uuid(900)}`, fireAt: "2026-08-30T11:00:00Z",
    title: "Walk", body: "Synthetic reminder", deliveredAt: "2026-08-30T11:00:01Z" };
  function existing(status: "scheduled" | "cancelled" = "scheduled") {
    state.reminders.push({ id: uuid(901), occurrence_id: uuid(900), user_id: USER_ID,
      request_id: delivery.requestId, fire_at: delivery.fireAt, title: delivery.title, body: delivery.body,
      status, error: null, verified_at: null, created_at: "2026-08-29T12:00:00Z", updated_at: NOW.toString() });
    mocks.notifications.mockImplementation(async (request: OsRequest) => ordinary(request));
  }
  function capture(proof = delivery) {
    retainNativeDeliveryEvents([{ kind: "notificationActivated", id: delivery.requestId, at: NOW.toString(), delivery: proof }]);
  }

  it("preserves unresolved delivered entries with unknown fire time while cancelling expired pending requests", async () => {
    existing();
    const read = mocks.command.getMockImplementation()!;
    let status = "unresolved";
    mocks.command.mockImplementation(async (operation, input) => operation === "readOccurrences"
      ? [{ ...storedExportOccurrence(), id: uuid(900), user_id: USER_ID, scheduled_for: delivery.fireAt, status }]
      : read(operation, input));
    delivered = [{ id: delivery.requestId, fireAt: null, title: delivery.title, body: delivery.body, deliveredAt: delivery.deliveredAt }];
    pending.set(delivery.requestId, { id: delivery.requestId, fireAt: delivery.fireAt, title: delivery.title, body: delivery.body });

    await reconcile();
    await reconcile();
    expect(pending.size).toBe(0);
    expect(delivered).toHaveLength(1);
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("cancelled");
    expect(mocks.notifications.mock.calls.some(([request]) => request.operation === "cancel" && request.ids.includes(delivery.requestId))).toBe(false);
    expect(state.coverage).toMatchObject({ status: "complete", expected_count: 0 });

    status = "completed";
    await reconcile();
    expect(delivered).toEqual([]);
  });

  it.each(["scheduled", "cancelled"] as const)("preserves clicked OS delivery from %s when Notification Center is already empty", async (status) => {
    existing(status); capture();
    await reconcile();
    expect(state.reminders.find(({ id }) => id === uuid(901))).toMatchObject({ status: "delivered" });
    expect(cancellations()).not.toContain(delivery.requestId);
    const writes = mocks.command.mock.calls.filter(([operation]) => operation === "recordNativeReminderCoverage");
    expect(writes[0][1].observed).toEqual([{ id: uuid(901), status: "delivered", error: null, delivery }]);
    await reconcile();
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("delivered");
    expect(mocks.command.mock.calls.filter(([operation, input]) => operation === "recordNativeReminderCoverage" && input.observed.some((row: { status: string }) => row.status === "delivered"))).toHaveLength(1);
  });

  it.each([
    { fireAt: "2026-08-30T10:00:00Z" }, { title: "Previous title" }, { body: "Previous body" },
    { requestId: `cadence.local.${uuid(902)}` }, { deliveredAt: "2026-08-30T10:59:59Z" },
    { deliveredAt: "2026-08-31T12:00:00Z" }, { fireAt: "invalid" },
  ])("does not attribute stale or invalid delivery proof: %j", async (change) => {
    existing(); capture({ ...delivery, ...change });
    await reconcile();
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("cancelled");
    expect(mocks.command.mock.calls.some(([operation, input]) => operation === "recordNativeReminderCoverage" && input.observed.some((row: { status: string }) => row.status === "delivered"))).toBe(false);
  });

  it("retains failed observation persistence for retry and performs no cleanup before that write succeeds", async () => {
    existing(); capture();
    const ordinaryCommand = mocks.command.getMockImplementation()!;
    let fail = true;
    mocks.command.mockImplementation(async (operation, input) => {
      if (fail && operation === "recordNativeReminderCoverage") throw new Error("SQLite temporarily busy");
      return ordinaryCommand(operation, input);
    });
    const attempt = expect(reconcileLocalReminders(NOW)).rejects.toThrow("SQLite temporarily busy");
    await vi.runAllTimersAsync(); await attempt;
    expect(mocks.command.mock.calls.some(([operation]) => operation === "commitNativeReminderPlan")).toBe(false);
    expect(cancellations()).toEqual([]);
    fail = false;
    await reconcile();
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("delivered");
  });

  it("retains an activation arriving during OS reads after the current planning clock", async () => {
    existing();
    let received = false;
    const laterProof = { ...delivery, deliveredAt: NOW.add({ seconds: 1 }).toString() };
    mocks.notifications.mockImplementation(async (request: OsRequest) => {
      if (request.operation === "status" && !received) {
        received = true;
        retainNativeDeliveryEvents([{ kind: "notificationActivated", id: delivery.requestId,
          at: NOW.add({ seconds: 2 }).toString(), delivery: laterProof }]);
      }
      return ordinary(request);
    });
    await reconcile();
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("cancelled");
    const next = reconcileLocalReminders(NOW.add({ seconds: 3 }));
    await vi.runAllTimersAsync(); await next;
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("delivered");
  });

  it("retains exact delivered readback across a failed write even if Notification Center is cleared before retry", async () => {
    existing();
    delivered = [{ id: delivery.requestId, fireAt: delivery.fireAt, title: delivery.title, body: delivery.body, deliveredAt: delivery.deliveredAt }];
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW);
    const ordinaryCommand = mocks.command.getMockImplementation()!;
    let fail = true;
    mocks.command.mockImplementation(async (operation, input) => {
      if (fail && operation === "recordNativeReminderCoverage") throw new Error("SQLite temporarily busy");
      return ordinaryCommand(operation, input);
    });
    const attempt = expect(reconcileLocalReminders(NOW)).rejects.toThrow("SQLite temporarily busy");
    await vi.runAllTimersAsync(); await attempt;
    expect(cancellations()).toEqual([]);
    delivered = []; fail = false;
    await reconcile();
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("delivered");
  });

  it("retains delivery first observed during settlement when Notification Center is empty on the next refresh", async () => {
    existing();
    vi.spyOn(Temporal.Now, "instant").mockReturnValue(NOW);
    let deliveredReads = 0;
    mocks.notifications.mockImplementation(async (request: OsRequest) => {
      if (request.operation === "delivered" && ++deliveredReads === 2) {
        return { delivered: [{ id: delivery.requestId, fireAt: delivery.fireAt, title: delivery.title,
          body: delivery.body, deliveredAt: delivery.deliveredAt }] };
      }
      return ordinary(request);
    });
    await reconcile();
    expect(deliveredReads).toBeGreaterThan(2);
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("cancelled");
    await reconcile();
    expect(state.reminders.find(({ id }) => id === uuid(901))?.status).toBe("delivered");
  });
});

describe("bounded native reminder repair", () => {
  it("waits for 21→23→26→29 readback without cancelling or lowering requested coverage", async () => {
    let reads = 0;
    mocks.notifications.mockImplementation(async (request: OsRequest) => {
      const result = ordinary(request);
      if (request.operation === "pending" && pending.size) return { pending: [...pending.values()].slice(0, [21, 23, 26, 29][Math.min(reads++, 3)]) };
      return result;
    });
    expect((await reconcile()).state.coverage).toMatchObject({ status: "complete", scheduled_count: 29 });
    expect(cancellations()).toEqual([]);
    expect(mocks.notifications.mock.calls.filter(([request]) => request.operation === "schedule")).toHaveLength(1);
    expect(pending.size).toBe(29);
  });

  it("repairs holes under a real 100-request limit while retaining matching nearest requests", async () => {
    count = 128;
    mocks.notifications.mockImplementation(async (request: OsRequest) => {
      const result = ordinary(request);
      if (request.operation === "schedule") {
        while (pending.size > 100) pending.delete(pending.keys().next().value!);
      }
      return result;
    });
    expect((await reconcile()).state.coverage).toMatchObject({ status: "limited", scheduled_count: 100, expected_count: 128 });
    expect([...pending.keys()].sort()).toEqual(Array.from({ length: 100 }, (_, index) => `cadence.local.${uuid(index + 1)}`));
    expect(cancellations().sort()).toEqual(Array.from({ length: 28 }, (_, index) => `cadence.local.${uuid(index + 101)}`));
  });

  it("does not mistake wrong times or content for reduced OS occupancy", async () => {
    count = 5;
    mocks.notifications.mockImplementation(async (request: OsRequest) => {
      const result = ordinary(request);
      if (request.operation === "pending" && pending.size) return { pending: [...pending.values()].map((row, index) => index === 0 ? { ...row, fireAt: null } : index === 1 ? { ...row, title: "Old title" } : index === 2 ? { ...row, body: "Old body" } : row) };
      return result;
    });
    expect((await reconcile()).state.coverage).toMatchObject({ status: "limited", scheduled_count: 2, expected_count: 5 });
    expect(cancellations()).toEqual([]);
    expect(pending.size).toBe(5);
  });

  it("leaves unstable readback limited without destructive repair", async () => {
    let reads = 0;
    mocks.notifications.mockImplementation(async (request: OsRequest) => {
      const result = ordinary(request);
      if (request.operation === "pending" && pending.size) return { pending: [...pending.values()].slice(++reads, reads + 10) };
      return result;
    });
    expect((await reconcile()).state.coverage?.status).toBe("limited");
    expect(cancellations()).toEqual([]);
    expect(pending.size).toBe(29);
  });

  it("archives delivered-only and untracked owned requests but leaves unrelated notifications alone", async () => {
    active = false;
    const owned = `cadence.local.${uuid(1)}`;
    delivered = [{ id: owned }, { id: "unrelated-notification" }];
    pending.set(`cadence.local.${uuid(999)}`, { id: `cadence.local.${uuid(999)}`, title: "Old", body: "Old", fireAt: NOW.add({ hours: 1 }).toString() });
    mocks.notifications.mockImplementation(async (request: OsRequest) => ordinary(request));
    expect((await reconcile()).state.coverage).toMatchObject({ status: "complete", expected_count: 0 });
    expect(delivered).toEqual([{ id: "unrelated-notification" }]);
    expect(pending.size).toBe(0);
    expect(cancellations()).toContain(owned);
  });

  it("does not verify archive cleanup while macOS retains a delivered notification", async () => {
    active = false;
    delivered = [{ id: `cadence.local.${uuid(1)}` }];
    mocks.notifications.mockImplementation(async (request: OsRequest) => ["cancel", "cancelPending"].includes(request.operation) ? {} : ordinary(request));
    expect((await reconcile()).state.coverage).toMatchObject({ status: "unverified", verified_at: null });
    expect(state.coverage?.reason).toContain("retained a cancelled reminder");
  });
});


describe("coalesced reminder refreshes", () => {
  it("bounds a 10,000-request burst to one running and one pending reconciliation", async () => {
    mocks.notifications.mockImplementation(async (request: OsRequest) => ordinary(request));
    const command = mocks.command.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    mocks.command.mockImplementation(async (operation, input) => {
      if (operation === "readProfile" && ++reads === 1) await held;
      return command(operation, input);
    });
    const first = reconcileLocalReminders(NOW);
    const pendingPass = reconcileLocalReminders(NOW.add({ seconds: 1 }));
    for (let index = 2; index <= 10_000; index++) {
      expect(reconcileLocalReminders(NOW.add({ seconds: index }))).toBe(pendingPass);
    }
    expect(reads).toBe(1);
    release();
    await vi.runAllTimersAsync();
    await Promise.all([first, pendingPass]);
    expect(reads).toBe(2);
    const plans = mocks.command.mock.calls.filter(([operation]) => operation === "commitNativeReminderPlan");
    expect(plans).toHaveLength(2);
    expect(plans[1][1].now).toBe(NOW.add({ seconds: 10_000 }).toString());
    await reconcile();
    expect(reads).toBe(3);
  });

  it("runs the pending refresh after a running pass fails", async () => {
    mocks.notifications.mockImplementation(async (request: OsRequest) => ordinary(request));
    const command = mocks.command.getMockImplementation()!;
    let reject!: (error: Error) => void;
    const held = new Promise<void>((_, fail) => { reject = fail; });
    let reads = 0;
    mocks.command.mockImplementation(async (operation, input) => {
      if (operation === "readProfile" && ++reads === 1) await held;
      return command(operation, input);
    });
    const first = expect(reconcileLocalReminders(NOW)).rejects.toThrow("SQLite temporarily busy");
    const pendingPass = reconcileLocalReminders(NOW.add({ seconds: 1 }));
    reject(new Error("SQLite temporarily busy"));
    await vi.runAllTimersAsync();
    await first;
    await expect(pendingPass).resolves.toMatchObject({ permission: "authorized" });
    expect(reads).toBe(2);
  });
});
