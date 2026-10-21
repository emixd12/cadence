import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildSmokePassword, cleanupTemporaryUsers, readLocalSmokeConfig, readSmokeConfig } from "./supabase-rls-smoke.mjs";

const config = process.argv.includes("--local") ? readLocalSmokeConfig() : readSmokeConfig();
const admin = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false } });
const password = buildSmokePassword(randomUUID().slice(0, 8));
const users = [];

try {
  for (const slot of ["a", "b"]) {
    const email = `cadence-sync-smoke-${randomUUID()}-${slot}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("Temporary sync user creation failed.");
    users.push(data.user);
  }
  const clients = await Promise.all(users.map(async (user) => {
    const value = createClient(config.url, config.publishableKey, { auth: { persistSession: false } });
    const { error } = await value.auth.signInWithPassword({ email: user.email, password });
    if (error) throw error;
    return value;
  }));
  const anonymous = createClient(config.url, config.publishableKey, { auth: { persistSession: false } });
  await rejects(anonymous.rpc("read_account_sync_snapshot"), "unauthenticated snapshot");
  await rejects(anonymous.rpc("apply_account_sync_plan", { sync_payload: {} }), "unauthenticated apply");

  const [snapshotA, snapshotB] = await Promise.all(clients.map(readSnapshot));
  assert(snapshotA.userId === users[0].id && snapshotB.userId === users[1].id, "snapshot owner isolation");
  assert(snapshotA.entities.every((row) => !contains(row.value, users[1].id)), "account A row isolation");
  assert(snapshotB.entities.every((row) => !contains(row.value, users[0].id)), "account B row isolation");

  const categoryB = snapshotB.entities.find((row) => row.kind === "category");
  assert(categoryB, "second account default category");
  const foreignWrite = { kind: "category", id: categoryB.id, operation: "upsert", expected: null, value: categoryB.value };
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(snapshotA, [foreignWrite], snapshotA.fingerprint, "1".repeat(64)) }), "cross-account apply");
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: { ...payload(snapshotA, [], snapshotA.fingerprint, "2".repeat(64)), hostedFingerprint: "f".repeat(64) } }), "stale apply");

  const profile = snapshotA.entities.find((row) => row.kind === "profile");
  assert(profile, "profile snapshot");
  const nextProfile = { ...profile, value: { ...profile.value, timezone: "Europe/London" } };
  const merged = snapshotA.entities.map((row) => row.kind === "profile" ? nextProfile : row);
  const mergedFingerprint = entityDigest(merged);
  const write = { kind: "profile", id: "profile", operation: "upsert", expected: profile.value, value: nextProfile.value };
  const request = payload(snapshotA, [write], mergedFingerprint, "3".repeat(64));
  const first = await applied(clients[0].rpc("apply_account_sync_plan", { sync_payload: request }));
  const replay = await applied(clients[0].rpc("apply_account_sync_plan", { sync_payload: request }));
  assert(JSON.stringify(first) === JSON.stringify(replay), "receipt replay equality");
  assert(first.fingerprint === mergedFingerprint, "merged fingerprint binding");
  const returnedProfile = first.snapshot.entities.find((row) => row.kind === "profile");
  assert(returnedProfile, "updated profile snapshot");
  assert(entityDigest([returnedProfile]) === entityDigest([nextProfile]), "timezone update preserves remaining profile fields");
  const category = first.snapshot.entities.find((row) => row.kind === "category");
  assert(category, "timestamp roundtrip category");
  const timestampValue = { ...category.value, name: "Timestamp roundtrip", description: "Synced category context", updated_at: "2026-09-01T06:00:00.123457Z" };
  const timestampMerged = first.snapshot.entities.map((row) => row.kind === "category" && row.id === category.id ? { ...row, value: timestampValue } : row);
  const timestampPlan = { writes: [{ kind: "category", id: category.id, operation: "upsert", expected: category.value, value: timestampValue }], mergedFingerprint: entityDigest(timestampMerged), conflicts: [] };
  const timestampRequest = { schemaVersion: 1, idempotencyKey: "4".repeat(64), baselineFingerprint: first.fingerprint, localFingerprint: first.fingerprint,
    hostedFingerprint: first.fingerprint, planFingerprint: digest(timestampPlan), plan: timestampPlan, attemptedAt: "2026-09-01T06:00:01.000Z" };
  const timestampResult = await applied(clients[0].rpc("apply_account_sync_plan", { sync_payload: timestampRequest }));
  assert(timestampResult.fingerprint === timestampPlan.mergedFingerprint, "timestamp precision roundtrip");
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: request }), "receipt replay after account advance");
  const returnedCategory = timestampResult.snapshot.entities.find((row) => row.kind === "category" && row.id === category.id);
  assert(returnedCategory?.value.name === "Timestamp roundtrip", "timestamp roundtrip product value");
  assert(returnedCategory?.value.updated_at !== timestampValue.updated_at, "server-owned updated_at remains authoritative");
  assert(returnedCategory.value.description === "Synced category context", "category description roundtrip");
  const legacyValue = { ...returnedCategory.value, name: "Old client overwrite" };
  delete legacyValue.description;
  const oldClientWrite = { kind: "category", id: category.id, operation: "upsert", expected: returnedCategory.value, value: legacyValue };
  const oldClient = await clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(timestampResult.snapshot, [oldClientWrite], timestampResult.fingerprint, "6".repeat(64)) });
  assert(oldClient.error?.message.includes("Update Cadence"), "old clients cannot erase category descriptions");
  assert((await readSnapshot(clients[0])).fingerprint === timestampResult.fingerprint, "old-client rejection rolls back");
  const insertedCategory = { kind: "category", id: randomUUID(), value: { id: "", description: null, name: "Expected null insert", sort_order: 9,
    created_at: "2026-09-01T06:00:02.000000Z", updated_at: "2026-09-01T06:00:02.000000Z" } };
  insertedCategory.value.id = insertedCategory.id;
  const insertMerged = [...timestampResult.snapshot.entities, insertedCategory].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const insertRequest = payload(timestampResult.snapshot, [{ kind: "category", id: insertedCategory.id, operation: "upsert", expected: null, value: insertedCategory.value }], entityDigest(insertMerged), "5".repeat(64));
  const insertResult = await applied(clients[0].rpc("apply_account_sync_plan", { sync_payload: insertRequest }));
  assert(insertResult.snapshot.entities.some((row) => row.kind === "category" && row.id === insertedCategory.id), "expected null insert");
  const collision = { kind: "category", id: insertedCategory.id, operation: "upsert", expected: null, value: insertedCategory.value };
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(insertResult.snapshot, [collision], insertResult.fingerprint, "6".repeat(64)) }), "existing row with null expectation");
  const absentId = randomUUID();
  const absentValue = { ...insertedCategory.value, id: absentId, name: "Absent expectation" };
  const absent = { kind: "category", id: absentId, operation: "upsert", expected: absentValue, value: absentValue };
  const absentMerged = [...insertResult.snapshot.entities, { kind: "category", id: absentId, value: absentValue }]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(insertResult.snapshot, [absent], entityDigest(absentMerged), "7".repeat(64)) }), "absent row with non-null expectation");
  const unchanged = await readSnapshot(clients[0]);
  assert(unchanged.fingerprint === insertResult.fingerprint, "failed compare-and-set attempts leave the snapshot unchanged");
  assert(!unchanged.entities.some((row) => row.id === absentId), "failed absent-row compare-and-set writes nothing");
  const behaviorId = randomUUID();
  const seeded = await admin.from("behaviors").insert({ id: behaviorId, user_id: users[0].id, category_id: insertedCategory.id, title: "Occurrence sync seed",
    description: null, recurrence_rule: { type: "daily", interval: 1 }, scheduled_time: "09:00:00", timezone: "America/New_York",
    browser_reminder_enabled: true, email_reminder_enabled: false, reminder_offset_minutes: 0, active: true });
  if (seeded.error) throw seeded.error;
  const configurationEventId = randomUUID();
  const seededConfiguration = await admin.from("behavior_configuration_events").insert({ id: configurationEventId, user_id: users[0].id, behavior_id: behaviorId,
    event_kind: "baseline", previous_configuration: null, next_configuration: { timezone: "America/New_York" }, changed_fields: ["timezone"],
    recorded_at: "2026-09-02T12:00:00Z", effective_at: "2026-09-02T12:00:00Z", effective_local_date: "2026-09-02",
    timezone: "America/New_York", source: "system", reason_code: "account_sync_smoke" });
  if (seededConfiguration.error) throw seededConfiguration.error;
  const occurrenceBase = await readSnapshot(clients[0]);
  assert(occurrenceBase.entities.some((row) => row.kind === "behavior" && row.id === behaviorId), "seeded behavior snapshot");
  const configurationEvent = occurrenceBase.entities.find((row) => row.kind === "configuration_event" && row.id === configurationEventId);
  assert(configurationEvent, "seeded behavior configuration lineage");
  const occurrenceId = randomUUID();
  const occurrenceValue = { id: occurrenceId, behavior_configuration_event_id: configurationEvent.id, behavior_id: behaviorId, behavior_schedule_slot_id: null,
    completed_at: null, created_at: "2026-09-02T13:00:00.000000Z", local_date: "2026-09-02", note: null, schedule_end_time: null,
    schedule_kind: "exact", schedule_preset: null, schedule_range_identity: 123, schedule_start_time: "09:00:00", scheduled_for: "2026-09-02T13:00:00.000000Z",
    status: "unresolved", status_marked_at: null, updated_at: "2026-09-02T13:00:00.000000Z" };
  const occurrenceMerged = [...occurrenceBase.entities, { kind: "occurrence", id: occurrenceId, value: occurrenceValue }]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const occurrenceWrite = { kind: "occurrence", id: occurrenceId, operation: "upsert", expected: null, value: occurrenceValue };
  const occurrenceResult = await applied(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(occurrenceBase, [occurrenceWrite], entityDigest(occurrenceMerged), "8".repeat(64)) }));
  const returnedOccurrence = occurrenceResult.snapshot.entities.find((row) => row.kind === "occurrence" && row.id === occurrenceId);
  assert(returnedOccurrence?.value.status === "unresolved", "new unresolved occurrence without status history");
  assert(!("schedule_range_identity" in returnedOccurrence.value), "derived occurrence identity stays outside the sync snapshot");

  const deletionOccurrenceId = randomUUID();
  const deletionOccurrence = { ...returnedOccurrence.value, id: deletionOccurrenceId, scheduled_for: "2026-09-04T13:00:00.000000Z", local_date: "2026-09-04" };
  const seededDeletionOccurrence = await admin.from("occurrences").insert({ ...deletionOccurrence, user_id: users[0].id });
  if (seededDeletionOccurrence.error) throw seededDeletionOccurrence.error;
  const deliveryStatuses = ["pending", "sent", "failed", "cancelled"];
  const deletionDeliveryIds = deliveryStatuses.map(() => randomUUID());
  const seededDeletionDeliveries = await admin.from("reminder_deliveries").insert(deliveryStatuses.map((status, index) => ({
    id: deletionDeliveryIds[index], user_id: users[0].id, occurrence_id: deletionOccurrenceId, channel: "browser_push",
    scheduled_send_at: `2026-09-04T12:${String(50 + index).padStart(2, "0")}:00Z`, status,
  })));
  if (seededDeletionDeliveries.error) throw seededDeletionDeliveries.error;
  const deletionBase = await readSnapshot(clients[0]);
  const deletionOccurrenceRow = deletionBase.entities.find((row) => row.kind === "occurrence" && row.id === deletionOccurrenceId);
  const deletionReminderRows = deletionBase.entities.filter((row) => row.kind === "reminder_delivery" && deletionDeliveryIds.includes(row.id));
  assert(deletionOccurrenceRow && deletionReminderRows.length === 4, "all-status deletion fixtures");
  const reminderDeletes = deletionReminderRows.map((row) => ({ kind: row.kind, id: row.id, operation: "delete", expected: row.value }));
  const occurrenceDelete = { kind: "occurrence", id: deletionOccurrenceId, operation: "delete", expected: deletionOccurrenceRow.value };
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(deletionBase, [reminderDeletes[0]],
    entityDigest(deletionBase.entities.filter((row) => row.id !== reminderDeletes[0].id)), digest("standalone-reminder-delete")) }), "standalone reminder deletion");
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(deletionBase, [occurrenceDelete],
    entityDigest(deletionBase.entities.filter((row) => row.id !== deletionOccurrenceId && !deletionDeliveryIds.includes(row.id))), digest("orphaning-occurrence-delete")) }), "Occurrence deletion without every reminder");
  const deletionWrites = [...reminderDeletes, occurrenceDelete];
  const deletionMerged = deletionBase.entities.filter((row) => row.id !== deletionOccurrenceId && !deletionDeliveryIds.includes(row.id));
  const deletionResult = await applied(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(deletionBase, deletionWrites,
    entityDigest(deletionMerged), digest("dependency-safe-occurrence-delete")) }));
  assert(!deletionResult.snapshot.entities.some((row) => row.id === deletionOccurrenceId || deletionDeliveryIds.includes(row.id)), "all-status reminder and Occurrence deletion");

  const deliveryId = randomUUID();
  const seededDelivery = await admin.from("reminder_deliveries").insert({ id: deliveryId, user_id: users[0].id, occurrence_id: occurrenceId,
    channel: "browser_push", scheduled_send_at: "2026-09-02T12:55:00Z", status: "pending" });
  if (seededDelivery.error) throw seededDelivery.error;
  const transitionBase = await readSnapshot(clients[0]);
  const pendingDelivery = transitionBase.entities.find((row) => row.kind === "reminder_delivery" && row.id === deliveryId);
  assert(pendingDelivery, "pending reminder delivery snapshot");
  const transitionedValue = { ...returnedOccurrence.value, status: "completed", completed_at: "2026-09-02T13:05:00.000000Z", status_marked_at: "2026-09-02T13:05:00.000000Z" };
  const transitioned = transitionBase.entities.map((row) => row.kind === "occurrence" && row.id === occurrenceId ? { ...row, value: transitionedValue } : row);
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(transitionBase,
    [{ kind: "occurrence", id: occurrenceId, operation: "upsert", expected: returnedOccurrence.value, value: transitionedValue }], entityDigest(transitioned), "9".repeat(64)) }), "existing occurrence status transition without history");
  const eventId = randomUUID();
  const eventValue = { id: eventId, occurrence_id: occurrenceId, behavior_id: behaviorId, previous_status: "unresolved", status: "completed",
    status_semantics: "explicit_user_mark", recorded_at: "2026-09-02T13:05:00.000000Z", effective_at: "2026-09-02T13:05:00.000000Z",
    local_date: "2026-09-02", timezone: "America/New_York", source_capture_method: "manual_tap", source_confidence: "high",
    revises_event_id: null, reason_code: null, created_at: "2026-09-02T13:05:00.000000Z", updated_at: "2026-09-02T13:05:00.000000Z" };
  const cancelledDelivery = { ...pendingDelivery.value, status: "cancelled", error: null };
  const statusMerged = [...transitioned.map((row) => row.kind === "reminder_delivery" && row.id === deliveryId ? { ...row, value: cancelledDelivery } : row), { kind: "status_event", id: eventId, value: eventValue }]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const statusResult = await applied(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(transitionBase, [
    { kind: "occurrence", id: occurrenceId, operation: "upsert", expected: returnedOccurrence.value, value: transitionedValue },
    { kind: "status_event", id: eventId, operation: "upsert", expected: null, value: eventValue },
    { kind: "reminder_delivery", id: deliveryId, operation: "upsert", expected: pendingDelivery.value, value: cancelledDelivery },
  ], entityDigest(statusMerged), "b".repeat(64)) }));
  assert(statusResult.fingerprint === entityDigest(statusMerged), "status transition history preserves the accepted merged fingerprint");
  assert(statusResult.snapshot.entities.some((row) => row.kind === "status_event" && row.id === eventId), "status transition history persisted");
  assert(statusResult.snapshot.entities.some((row) => row.kind === "occurrence" && row.id === occurrenceId && row.value.behavior_configuration_event_id === configurationEvent.id), "status transition preserved occurrence configuration lineage");
  assert(statusResult.snapshot.entities.some((row) => row.kind === "reminder_delivery" && row.id === deliveryId && row.value.status === "cancelled"), "status transition reminder cancellation persisted");
  const protectedOccurrence = statusResult.snapshot.entities.find((row) => row.kind === "occurrence" && row.id === occurrenceId);
  const protectedReminder = statusResult.snapshot.entities.find((row) => row.kind === "reminder_delivery" && row.id === deliveryId);
  assert(protectedOccurrence && protectedReminder, "protected deletion fixtures");
  const protectedMerged = statusResult.snapshot.entities.filter((row) => row.id !== occurrenceId && row.id !== deliveryId && row.id !== eventId);
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(statusResult.snapshot, [
    { kind: "reminder_delivery", id: deliveryId, operation: "delete", expected: protectedReminder.value },
    { kind: "occurrence", id: occurrenceId, operation: "delete", expected: protectedOccurrence.value },
  ], entityDigest(protectedMerged), digest("protected-occurrence-delete")) }), "protected Occurrence deletion");
  assert((await readSnapshot(clients[0])).fingerprint === statusResult.fingerprint, "protected deletion rolls back every write");
  const resolvedId = randomUUID();
  const resolvedValue = { ...occurrenceValue, id: resolvedId, scheduled_for: "2026-09-03T13:00:00.000000Z", local_date: "2026-09-03", status: "completed",
    completed_at: "2026-09-03T13:05:00.000000Z", status_marked_at: "2026-09-03T13:05:00.000000Z" };
  const resolvedMerged = [...occurrenceResult.snapshot.entities, { kind: "occurrence", id: resolvedId, value: resolvedValue }]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: payload(occurrenceResult.snapshot,
    [{ kind: "occurrence", id: resolvedId, operation: "upsert", expected: null, value: resolvedValue }], entityDigest(resolvedMerged), "a".repeat(64)) }), "new resolved occurrence without history");
  const occurrenceUnchanged = await readSnapshot(clients[0]);
  assert(occurrenceUnchanged.fingerprint === statusResult.fingerprint, "rejected status-history writes leave Occurrences unchanged");

  const sameAccountBase = await readSnapshot(clients[1]);
  const sameAccountProfile = sameAccountBase.entities.find((row) => row.kind === "profile");
  assert(sameAccountProfile, "same-account race profile");
  const sameAccountRequests = ["Asia/Tokyo", "Europe/Paris"].map((timezone, index) => {
    const value = { ...sameAccountProfile.value, timezone };
    const entities = sameAccountBase.entities.map((row) => row.kind === "profile" ? { ...row, value } : row);
    return payload(sameAccountBase, [{ kind: "profile", id: "profile", operation: "upsert", expected: sameAccountProfile.value, value }], entityDigest(entities), (index ? "d" : "c").repeat(64));
  });
  const sameAccountRace = await Promise.all(sameAccountRequests.map((syncPayload) => clients[1].rpc("apply_account_sync_plan", { sync_payload: syncPayload })));
  assert(sameAccountRace.filter(({ error }) => Boolean(error)).length === 1, "same-account stale plans serialize");

  const [crossAccountA, crossAccountB] = await Promise.all(clients.map(readSnapshot));
  const sharedId = randomUUID();
  const crossAccountRequests = [crossAccountA, crossAccountB].map((snapshot, index) => {
    const value = { id: sharedId, description: null, name: `Cross-account race ${index}`, sort_order: 99, created_at: "2026-09-02T14:00:00.000000Z", updated_at: "2026-09-02T14:00:00.000000Z" };
    const entities = [...snapshot.entities, { kind: "category", id: sharedId, value }].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    return payload(snapshot, [{ kind: "category", id: sharedId, operation: "upsert", expected: null, value }], entityDigest(entities), (index ? "f" : "e").repeat(64));
  });
  const crossAccountRace = await Promise.all(crossAccountRequests.map((syncPayload, index) => clients[index].rpc("apply_account_sync_plan", { sync_payload: syncPayload })));
  assert(crossAccountRace.filter(({ error }) => Boolean(error)).length === 1, "cross-account insert identities serialize");
  const crossAccountRows = await Promise.all(clients.map(async (client) => (await readSnapshot(client)).entities.filter((row) => row.kind === "category" && row.id === sharedId).length));
  assert(crossAccountRows[0] + crossAccountRows[1] === 1, "cross-account insert identity has one owner");

  await rejects(clients[0].rpc("apply_account_sync_plan", { sync_payload: { ...request, localFingerprint: "e".repeat(64) } }), "idempotency-key substitution");
  console.log("Account sync RPC smoke passed: unauthenticated rejection, two-account isolation, stale and cross-account rejection, bounded receipt replay, serialized same-account plans and cross-account identities, timestamp precision, compare-and-set rejection, dependency-safe all-status reminder deletion, occurrence history, and idempotency substitution rejection.");
} finally {
  await cleanupTemporaryUsers(admin, users);
}

async function readSnapshot(client) {
  const { data, error } = await client.rpc("read_account_sync_snapshot");
  if (error) throw error;
  return data;
}
function payload(snapshot, writes, mergedFingerprint, idempotencyKey) {
  const plan = { writes, mergedFingerprint, conflicts: [] };
  return { schemaVersion: 1, idempotencyKey, baselineFingerprint: snapshot.fingerprint, localFingerprint: snapshot.fingerprint,
    hostedFingerprint: snapshot.fingerprint, planFingerprint: digest(plan), plan, attemptedAt: "2026-09-01T06:00:00.000Z" };
}
async function rejects(operation, label) { const { error } = await operation; assert(error, label); }
async function applied(operation) { const { data, error } = await operation; if (error) throw error; return data; }
function contains(value, needle) { return JSON.stringify(value).includes(needle); }
function digest(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function entityDigest(entities) { return digest(entities.map((entity) => ({ ...entity, value: Object.fromEntries(Object.entries(entity.value).filter(([key]) => key !== "updated_at" && key !== "schedule_range_identity")) }))); }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; return JSON.stringify(value); }
function assert(condition, label) { if (!condition) throw new Error(`Account sync RPC smoke failed: ${label}.`); }
