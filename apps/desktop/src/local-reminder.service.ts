import { Temporal } from "@js-temporal/polyfill";
import { assessNativeReminderCoverage, planNativeReminderRequests, resolveNativeReminderGenerationHorizon, selectNativeReminderRequests,
  type NativeReminderPendingRequest, type NativeReminderRequest } from "@cadence/core/resolvers/native-reminder.resolver";
import { ensureLocalOccurrencesFresh } from "./local-generation.service";
import { localCommand, localMutation, type NativeReminderRow, type NativeReminderState } from "./local-store";
import { notifications, type DeliveredReminder, type NativeDeliveryProof, type NativeEvent } from "./native-spike";

export type NativePermission = "checking" | "notDetermined" | "authorized" | "provisional" | "denied" | "unknown" | "unavailable";
export type LocalReminderResult = { permission: NativePermission; state: NativeReminderState };
let reconciliation: Promise<LocalReminderResult> | undefined;
let pendingReconciliation: { now: Temporal.Instant; result: Promise<LocalReminderResult> } | undefined;
const deliveryEvents = new Map<string, NativeDeliveryProof>();

// Retain drained callback evidence until SQLite commits it. A failed write must not turn it into cancellation history.
export function retainNativeDeliveryEvents(events: NativeEvent[]) {
  for (const event of events) {
    const proof = event.delivery;
    if (!["notificationPresented", "notificationActivated"].includes(event.kind) || !proof || proof.requestId !== event.id
      || !validDeliveryProof(proof, event.at)) continue;
    deliveryEvents.set(JSON.stringify(proof), proof);
  }
}

// One local profile. Refresh bursts share one pending pass after the running pass.
export function reconcileLocalReminders(now = Temporal.Now.instant()): Promise<LocalReminderResult> {
  if (pendingReconciliation) {
    pendingReconciliation.now = now;
    return pendingReconciliation.result;
  }
  if (reconciliation) {
    const pending: { now: Temporal.Instant; result: Promise<LocalReminderResult> } = { now, result: reconciliation.catch(() => undefined).then(() => {
      pendingReconciliation = undefined;
      return startReconciliation(pending.now);
    }) };
    pendingReconciliation = pending;
    reconciliation = pending.result;
    return pending.result;
  }
  return startReconciliation(now);
}

function startReconciliation(now: Temporal.Instant): Promise<LocalReminderResult> {
  const result = reconcile(now);
  reconciliation = result;
  const clear = () => { if (reconciliation === result) reconciliation = undefined; };
  void result.then(clear, clear);
  return result;
}

export async function requestLocalNotificationPermission() {
  await notifications({ operation: "requestPermission" });
  return reconcileLocalReminders();
}

export function reminderCoverageView(state: NativeReminderState) {
  const row = state.coverage;
  return row ? { status: row.status, scheduledThrough: row.scheduled_through,
    firstUnscheduledAt: row.first_unscheduled_at, expectedCount: row.expected_count,
    scheduledCount: row.scheduled_count, missingIds: row.missing_ids,
    targetThrough: row.target_through, checkedAt: row.verified_at } : null;
}

async function reconcile(now: Temporal.Instant): Promise<LocalReminderResult> {
  const profile = await localCommand("readProfile", {});
  const profileId = profile.id;
  await ensureLocalOccurrencesFresh(profile, now);
  let state = await localCommand("readNativeReminderState", { profileId });
  const graphs = await localCommand("readBehaviorGraphs", { profileId });
  if (resolveNativeReminderGenerationHorizon(graphs.map(({ behavior }) => behavior)).unsupportedOffset) {
    throw new Error("Reminder coverage is unverified: an imported reminder offset exceeds the one-year planning limit. Edit that Behavior’s reminder offset.");
  }
  const occurrences = await localCommand("readOccurrences", { profileId,
    startLocalDate: "0001-01-01", endLocalDate: "9999-12-31" });
  const targetThrough = now.toZonedDateTimeISO(profile.timezone).add({ days: 30 }).toInstant();
  const requests = planNativeReminderRequests({ behaviors: graphs.map(({ behavior }) => behavior), occurrences, now, targetThrough });
  const context = { requests, now, targetThrough };
  let permission: NativePermission = "unknown";
  let pending: NativeReminderPendingRequest[] | null = null;
  let delivered: DeliveredReminder[] = [];
  let failure: string | null = null;
  try {
    permission = normalizePermission((await notifications({ operation: "status" })).authorization);
    pending = requirePending(await notifications({ operation: "pending" }));
    const result = await notifications({ operation: "delivered" });
    if (!result.delivered) throw new Error("Delivered reminder readback is unavailable.");
    delivered = result.delivered;
    retainDeliveredReadback(delivered);
  } catch (error) { failure = message(error); }

  // Exact callback/readback evidence may correct earlier expiry cleanup. It never reactivates scheduling or claims reading.
  const queued = [...deliveryEvents.entries()];
  const proofs = queued.map(([, proof]) => proof);
  const observedDelivered = state.reminders.flatMap((row) => {
    if (row.status === "delivered") return [];
    const proof = proofs.find((proof) => validDeliveryProof(proof, now.toString()) && proof.requestId === row.request_id
      && Temporal.Instant.compare(proof.fireAt, row.fire_at) === 0 && proof.title === row.title && proof.body === row.body);
    return proof ? [{ id: row.id, status: "delivered" as const, error: null, delivery: proof }] : [];
  });
  if (observedDelivered.length) {
    const unknown = assessNativeReminderCoverage({ ...context, pending: null });
    state = await localCommand("recordNativeReminderCoverage", { ...localMutation(profileId, now.toString()),
      expectedRevision: state.revision, coverage: receipt(unknown, targetThrough, null, "reconciling"),
      observed: observedDelivered });
  }
  // A callback can arrive during OS reads after this reconciliation's injected clock. The next queued refresh owns it.
  for (const [key, proof] of queued) {
    if (Temporal.Instant.compare(proof.deliveredAt, now) <= 0) deliveryEvents.delete(key);
  }
  const existing = new Map(state.reminders.map((row) => [row.request_id, row]));
  const desiredIds = new Set(requests.map(({ id }) => id));
  const planned: NativeReminderRow[] = requests.map((request) => {
    const old = existing.get(request.id);
    return { id: old?.id ?? crypto.randomUUID(), user_id: profileId,
      occurrence_id: request.id.slice("cadence.local.".length), request_id: request.id,
      fire_at: request.fireAt, title: request.title, body: request.body, status: "planned", error: null,
      verified_at: null, created_at: old?.created_at ?? now.toString(), updated_at: now.toString() };
  });
  const cancelled = state.reminders.filter((row) => !desiredIds.has(row.request_id)
    && ["planned", "scheduled", "failed"].includes(row.status));
  state = await localCommand("commitNativeReminderPlan", { ...localMutation(profileId, now.toString()),
    expectedRevision: state.revision, reminders: planned, cancelIds: cancelled.map(({ id }) => id) });
  const allowed = permission === "authorized" || permission === "provisional";
  const reminderBehaviorIds = new Set(graphs.filter(({ behavior }) => behavior.active && behavior.browser_reminder_enabled).map(({ behavior }) => behavior.id));
  // Keep already delivered reminders for unresolved active Occurrences, even after their fire time.
  // Resolution, archival, or deletion retires those Notification Center entries too.
  const retainedDeliveredIds = new Set(occurrences.filter((row) => row.status === "unresolved" && reminderBehaviorIds.has(row.behavior_id)).map(({ id }) => `cadence.local.${id}`));
  const obsoletePendingIds = new Set([
    ...state.reminders.filter((row) => row.status === "cancelled").map((row) => row.request_id),
    ...(pending ?? []).filter(({ id }) => owned(id) && (!allowed || !desiredIds.has(id))).map(({ id }) => id),
  ]);
  const obsoleteDeliveredIds = new Set([
    ...state.reminders.filter((row) => row.status === "cancelled" && (!allowed || !retainedDeliveredIds.has(row.request_id))).map((row) => row.request_id),
    ...delivered.filter(({ id }) => owned(id) && (!allowed || !retainedDeliveredIds.has(id))).map(({ id }) => id),
  ]);
  try {
    await cancel([...obsoletePendingIds], "cancelPending");
    await cancel([...obsoleteDeliveredIds]);
    if (allowed && !failure) {
      // Keep matching requests in place. Replace only changed or absent requests.
      const before = assessNativeReminderCoverage({ ...context, pending });
      const missing = new Set(before.missingIds);
      await schedule(requests.filter(({ id }) => missing.has(id)));
      let readback = await readSettledReminderState(context, obsoletePendingIds, obsoleteDeliveredIds);
      pending = readback.pending;
      const first = assessNativeReminderCoverage({ ...context, pending });
      const retainedCount = new Set(pending.filter(({ id }) => desiredIds.has(id)).map(({ id }) => id)).size;
      if (readback.stable && first.missingIds.length && retainedCount > 0) {
        // One bounded repair uses observed occupied IDs, not content matches or an assumed OS cap.
        // A changed title/time cannot lower occupancy. Preserve matching nearest reservations.
        const nearest = selectNativeReminderRequests({ ...context, capacity: retainedCount });
        const nearestIds = new Set(nearest.map(({ id }) => id));
        const fartherIds = pending.filter(({ id }) => owned(id) && !nearestIds.has(id)).map(({ id }) => id);
        await cancel(fartherIds, "cancelPending");
        for (const id of fartherIds) obsoletePendingIds.add(id);
        const missingIds = new Set(first.missingIds);
        await schedule(nearest.filter(({ id }) => missingIds.has(id)));
        readback = await readSettledReminderState(context, obsoletePendingIds, obsoleteDeliveredIds);
        pending = readback.pending;
      }
      delivered = readback.delivered;
    } else {
      const readback = await readSettledReminderState(context, obsoletePendingIds, obsoleteDeliveredIds, false);
      pending = readback.pending;
      delivered = readback.delivered;
    }
    if (pending.some(({ id }) => obsoletePendingIds.has(id)) || delivered.some(({ id }) => obsoleteDeliveredIds.has(id))) {
      throw new Error("macOS retained a cancelled reminder. Reconcile again.");
    }
  } catch (error) { failure = message(error); }
  const reason = failure ?? (!allowed ? "Notification permission is not enabled." : null);
  const coverage = assessNativeReminderCoverage({ ...context, pending: reason ? null : pending });
  const missing = new Set(coverage.missingIds);
  const pendingIds = pending === null ? null : new Set(pending.map(({ id }) => id));
  const observed: { id: string; status: "scheduled" | "cancelled" | "failed"; error: string | null }[] = [];
  for (const row of state.reminders) {
    if (desiredIds.has(row.request_id)) {
      observed.push(!reason && !missing.has(row.request_id)
        ? { id: row.id, status: "scheduled", error: null }
        : { id: row.id, status: "failed", error: reason ?? "macOS did not retain this reminder." });
    } else if (row.status === "cancelled") {
      observed.push(pendingIds && !pendingIds.has(row.request_id) && !failure
        ? { id: row.id, status: "cancelled", error: null }
        : { id: row.id, status: "failed", error: failure ?? "Cancellation could not be verified." });
    }
  }
  // Capacity omissions are expected limited coverage, not adapter failures. Retain planned intent for retry.
  const verifiedObservations = coverage.status === "limited" && !reason
    ? observed.filter((entry) => entry.status !== "failed") : observed;
  const checkedAt = Temporal.Now.instant().toString();
  state = await localCommand("recordNativeReminderCoverage", { ...localMutation(profileId, checkedAt), expectedRevision: state.revision,
    coverage: receipt(coverage, targetThrough, reason ? null : checkedAt, reason), observed: verifiedObservations });
  return { permission, state };
}

function receipt(coverage: ReturnType<typeof assessNativeReminderCoverage>, target: Temporal.Instant, verifiedAt: string | null, reason: string | null) {
  return { status: coverage.status, target_through: target.toString(), scheduled_through: coverage.scheduledThrough,
    first_unscheduled_at: coverage.firstUnscheduledAt, expected_count: coverage.expectedCount,
    scheduled_count: coverage.scheduledCount, missing_ids: coverage.missingIds, verified_at: verifiedAt, reason };
}
function normalizePermission(value: string | undefined): NativePermission {
  return ["notDetermined", "authorized", "provisional", "denied"].includes(value ?? "") ? value as NativePermission : "unknown";
}
function owned(id: string) { return /^cadence\.local\.[0-9a-f-]{36}$/.test(id); }
function validDeliveryProof(proof: NativeDeliveryProof, observedAt: string): boolean {
  try {
    return typeof proof.requestId === "string" && owned(proof.requestId) && typeof proof.title === "string" && typeof proof.body === "string"
      && Temporal.Instant.compare(proof.fireAt, proof.deliveredAt) <= 0 && Temporal.Instant.compare(proof.deliveredAt, observedAt) <= 0;
  } catch { return false; }
}
function retainDeliveredReadback(delivered: DeliveredReminder[]) {
  const observedAt = Temporal.Now.instant().toString();
  for (const row of delivered) {
    if (row.fireAt === null) continue;
    const proof = { requestId: row.id, fireAt: row.fireAt, title: row.title, body: row.body, deliveredAt: row.deliveredAt };
    if (validDeliveryProof(proof, observedAt)) deliveryEvents.set(JSON.stringify(proof), proof);
  }
}
function message(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 1500); }
function requirePending(result: Awaited<ReturnType<typeof notifications>>) {
  if (!result.pending) throw new Error("Pending reminder readback is unavailable.");
  return result.pending;
}
async function readSettledReminderState(context: Omit<Parameters<typeof assessNativeReminderCoverage>[0], "pending">, obsoletePendingIds: Set<string>, obsoleteDeliveredIds: Set<string>, verifyCoverage = true) {
  let pending: NativeReminderPendingRequest[] = [];
  let delivered: DeliveredReminder[] = [];
  let previous: string | undefined;
  let stable = false;
  // Scheduling callbacks can precede pending-request readback. Never infer occupancy from one read.
  for (const delay of [0, 100, 250, 500]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    pending = requirePending(await notifications({ operation: "pending" }));
    const result = await notifications({ operation: "delivered" });
    if (!result.delivered) throw new Error("Delivered reminder readback is unavailable.");
    delivered = result.delivered;
    retainDeliveredReadback(delivered);
    const fingerprint = JSON.stringify(pending.filter(({ id }) => owned(id)).map(({ id, fireAt, title, body }) => [id, fireAt, title, body]).sort(([left], [right]) => left!.localeCompare(right!)));
    stable = fingerprint === previous;
    previous = fingerprint;
    const cancelled = !pending.some(({ id }) => obsoletePendingIds.has(id)) && !delivered.some(({ id }) => obsoleteDeliveredIds.has(id));
    if (cancelled && (!verifyCoverage || assessNativeReminderCoverage({ ...context, pending }).status === "complete")) break;
  }
  return { pending, delivered, stable };
}
async function cancel(ids: string[], operation: "cancel" | "cancelPending" = "cancel") {
  for (let index = 0; index < ids.length; index += 512) {
    await notifications({ operation, ids: ids.slice(index, index + 512) });
  }
}
async function schedule(requests: NativeReminderRequest[]) {
  for (let index = 0; index < requests.length; index += 512) {
    const result = await notifications({ operation: "schedule", reminders: requests.slice(index, index + 512) });
    if (result.errors?.length) throw new Error("macOS rejected one or more reminder requests.");
  }
}
