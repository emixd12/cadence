import { invoke } from "@tauri-apps/api/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_SYNC_ENTITY_KINDS, ACCOUNT_SYNC_TIME_LIMIT_MS, accountSyncFingerprint, resolveAccountSync, resolveReviewedAccountSync, type AccountSyncConflictDecision, type AccountSyncEntity, type AccountSyncPlan, type AccountSyncSnapshot } from "@cadence/core/resolvers/account-sync.resolver";
import { sha256 } from "@cadence/core/hash";
import { travelHabitSyncJson } from "@cadence/core/services/travel-habits";
import type { Json } from "@cadence/core/types/json";
import type { PortabilitySnapshot } from "@cadence/core/types/portability-rows";
import type { NoteShortcutState } from "@cadence/core/types/note-shortcut";
import { localCommand } from "../local-store";
import { runAccountSync, syncFailureStatus, type AccountSyncOperations, type SyncStatus } from "../sync-engine";
import { canonicalJson } from "./canonical-json";

type SyncContext = {
  hostedUserId: string;
  baselineFingerprint: string;
  baselineJson: string;
  outboxHighWater: number;
  tombstones: { entityType: string; entityId: string; deletedAt: string; mutationId: string }[];
};
export type HostedEnvelope = { schemaVersion: number; userId: string; fingerprint: string; entities: AccountSyncEntity[] };
export type AccountSyncInputs = {
  accountLinkId: string;
  baseline: AccountSyncSnapshot;
  local: AccountSyncSnapshot;
  hosted: AccountSyncSnapshot;
  baselineFingerprint: string;
  hostedFingerprint: string;
  outboxHighWater: number;
};
export type AccountSyncReadOperations = {
  readContext: () => Promise<SyncContext | null>;
  readLocal: () => Promise<AccountSyncPortabilitySnapshot>;
  readHosted: () => Promise<unknown>;
};
type HostedApplyResult = { fingerprint: string; snapshot: HostedEnvelope };
type AccountSyncPortabilitySnapshot = PortabilitySnapshot & { noteShortcutStates?: NoteShortcutState[] };

export async function readAccountSyncInputs(profileId: string, client: SupabaseClient, operations: Partial<AccountSyncReadOperations> = {}): Promise<AccountSyncInputs> {
  const controller = new AbortController();
  return deadline(readAccountSyncInputsWithin(profileId, client, operations, controller.signal), controller);
}

async function readAccountSyncInputsWithin(profileId: string, client: SupabaseClient, operations: Partial<AccountSyncReadOperations>, signal: AbortSignal): Promise<AccountSyncInputs> {
  const readContext = operations.readContext ?? (() => invoke<SyncContext | null>("auth_account_sync_context"));
  const context = await readContext();
  if (!context) throw new Error("Finish linking the account before synchronizing.");
  const [local, hostedValue] = await Promise.all([
    (operations.readLocal ?? (() => localCommand("readImportSnapshot", { profileId })))(),
    (operations.readHosted ?? (() => readHostedAccountSyncEnvelope(client, signal)))(),
  ]);
  const hosted = hostedEnvelope(hostedValue);
  if (hosted.userId !== context.hostedUserId) throw new Error("The hosted snapshot belongs to another account.");
  return {
    accountLinkId: context.hostedUserId,
    baseline: baselineSnapshot(context.baselineJson),
    local: { entities: portabilityEntities(local) },
    hosted: { fingerprint: hosted.fingerprint, entities: hosted.entities },
    baselineFingerprint: context.baselineFingerprint,
    hostedFingerprint: hosted.fingerprint,
    outboxHighWater: context.outboxHighWater,
  };
}

// Supabase drops a revoked session after its refresh fails, so the next request runs
// unauthenticated and PostgREST answers 401. Keep that status so the failure reads as
// "revoked" (Reconnect account) instead of a raw permission error.
function withSessionStatus<T extends object>(error: T, status: number): T {
  return status === 401 ? Object.assign(error, { status }) : error;
}

export async function readHostedAccountSyncEnvelope(client: SupabaseClient, signal?: AbortSignal): Promise<HostedEnvelope> {
  if (!signal) {
    const controller = new AbortController();
    return deadline(readHostedAccountSyncEnvelope(client, controller.signal), controller);
  }
  let request = client.rpc("read_account_sync_snapshot");
  request = request.abortSignal(signal);
  const { data, error, status } = await request;
  if (error) throw withSessionStatus(error, status);
  const envelope = hostedEnvelope(data);
  if (accountSyncFingerprint(envelope) !== envelope.fingerprint) throw new Error("The hosted account snapshot fingerprint is invalid.");
  await localCommand("validateAccountSyncSnapshot", { entities: envelope.entities });
  return envelope;
}

export async function planAccountSync(profileId: string, client: SupabaseClient, operations?: Partial<AccountSyncReadOperations>): Promise<{ inputs: AccountSyncInputs; plan: AccountSyncPlan }> {
  const controller = new AbortController();
  return deadline((async () => {
    const inputs = await readAccountSyncInputsWithin(profileId, client, operations ?? {}, controller.signal);
    if (accountSyncFingerprint(inputs.hosted) !== inputs.hostedFingerprint) throw new Error("The hosted account snapshot fingerprint is invalid.");
    return { inputs, plan: resolveAccountSync(inputs) };
  })(), controller);
}

export async function applyHostedAccountSync(client: SupabaseClient, inputs: AccountSyncInputs, plan: AccountSyncPlan, attemptedAt = new Date().toISOString()): Promise<HostedApplyResult> {
  if (plan.conflicts.length || !plan.idempotencyKey || !plan.fingerprints.merged) throw new Error("Account synchronization conflicts must be resolved before apply.");
  if (plan.fingerprints.baseline !== accountSyncFingerprint(inputs.baseline) || plan.fingerprints.local !== accountSyncFingerprint(inputs.local) || plan.fingerprints.hosted !== inputs.hostedFingerprint) throw new Error("The account synchronization plan is stale.");
  const rpcPlan = { writes: plan.hostedWrites, mergedFingerprint: plan.fingerprints.merged, conflicts: [] };
  const syncPayload = { schemaVersion: 1, idempotencyKey: plan.idempotencyKey, baselineFingerprint: plan.fingerprints.baseline,
      localFingerprint: plan.fingerprints.local, hostedFingerprint: plan.fingerprints.hosted, planFingerprint: sha256(canonicalJson(rpcPlan)), plan: rpcPlan, attemptedAt };
  const applied = await client.rpc("apply_account_sync_plan", { sync_payload: syncPayload });
  if (applied.error) throw withSessionStatus(applied.error, applied.status);
  const result = applied.data;
  if (!isRecord(result) || result.status !== "applied" || typeof result.fingerprint !== "string") throw new Error("Hosted account synchronization returned an invalid result.");
  const snapshot = hostedEnvelope(result.snapshot);
  if (snapshot.fingerprint !== result.fingerprint || accountSyncFingerprint(snapshot) !== result.fingerprint) throw new Error("Hosted account synchronization returned an invalid fingerprint.");
  return { fingerprint: result.fingerprint, snapshot };
}

export async function synchronizeAccount(profileId: string, client: SupabaseClient, now = () => new Date().toISOString()): Promise<SyncStatus> {
  let inputs: AccountSyncInputs | null = null;
  let planned: AccountSyncPlan | null = null;
  let hosted: HostedApplyResult | null = null;
  const operations: AccountSyncOperations = {
    readInputs: async () => {
      const result = await planAccountSync(profileId, client);
      inputs = result.inputs;
      planned = result.plan;
      return result.inputs;
    },
    plan: () => {
      if (!planned) throw new Error("The synchronization plan is unavailable.");
      return planned;
    },
    applyHosted: async (plan) => {
      if (!inputs) throw new Error("The synchronization inputs are unavailable.");
      hosted = await applyHostedAccountSync(client, inputs, plan, now());
      return { fingerprint: hosted.fingerprint };
    },
    applyLocal: async (plan) => {
      await localCommand("applyAccountSync", { profileId, writes: [...plan.localWrites] });
    },
    complete: async ({ plan, fingerprint, outboxHighWater, completedAt }) => {
      if (!inputs || !hosted || !plan.idempotencyKey) throw new Error("The synchronization result is unavailable.");
      await invoke("auth_complete_account_sync", {
        hostedUserId: inputs.accountLinkId,
        expectedBaselineFingerprint: inputs.baselineFingerprint,
        idempotencyKey: plan.idempotencyKey,
        baselineFingerprint: fingerprint,
        baselineJson: JSON.stringify(hosted.snapshot),
        outboxHighWater,
        completedAt,
      });
    },
    now,
  };
  return runAccountSync(operations);
}

export async function synchronizeReviewedAccount(profileId: string, client: SupabaseClient, reviewed: AccountSyncInputs,
  decisions: readonly AccountSyncConflictDecision[], now = () => new Date().toISOString()): Promise<SyncStatus> {
  try {
    const current = await readAccountSyncInputs(profileId, client);
    const plan = resolveReviewedAccountSync({ ...current, reviewedFingerprints: {
      baseline: accountSyncFingerprint(reviewed.baseline), local: accountSyncFingerprint(reviewed.local), hosted: reviewed.hostedFingerprint,
    }, decisions });
    const hosted = await applyHostedAccountSync(client, current, plan, now());
    await localCommand("applyAccountSync", { profileId, writes: [...plan.localWrites] });
    const completedAt = now();
    await invoke("auth_complete_account_sync", { hostedUserId: current.accountLinkId, expectedBaselineFingerprint: current.baselineFingerprint,
      idempotencyKey: plan.idempotencyKey, baselineFingerprint: hosted.fingerprint, baselineJson: JSON.stringify(hosted.snapshot),
      outboxHighWater: current.outboxHighWater, completedAt });
    return { state: "current", completedAt };
  } catch (error) {
    return syncFailureStatus(error);
  }
}

export function portabilityEntities(snapshot: AccountSyncPortabilitySnapshot): AccountSyncEntity[] {
  const travel = snapshot.travelSettings ?? {
    enabled: false, baseLocationText: null, mode: null, navigationPreference: null,
    routingConsentAt: null, onboardingCompletedAt: null, updatedAt: snapshot.profile.created_at,
  };
  const entities: AccountSyncEntity[] = [{ kind: "profile", id: "profile", value: {
    timezone: snapshot.profile.timezone,
    travel_enabled: travel.enabled,
    base_location_text: travel.baseLocationText,
    travel_mode: travel.mode,
    navigation_preference: travel.navigationPreference,
    routing_consent_at: travel.routingConsentAt,
    onboarding_completed_at: travel.onboardingCompletedAt,
    updated_at: travel.updatedAt,
    ...travelHabitSyncJson(travel.habits),
  } }];
  add(entities, "category", snapshot.categories);
  for (const graph of snapshot.graphs) {
    add(entities, "behavior", [graph.behavior]);
    add(entities, "schedule", graph.schedules);
    add(entities, "schedule_slot", graph.slots);
  }
  add(entities, "definition_event", snapshot.definitionEvents);
  add(entities, "configuration_event", snapshot.configurationEvents);
  add(entities, "occurrence", snapshot.occurrences);
  add(entities, "status_event", snapshot.statusEvents);
  add(entities, "time_session", snapshot.timeSessions);
  add(entities, "import_run", snapshot.importRuns);
  add(entities, "mapping", snapshot.mappings);
  add(entities, "imported_note", snapshot.importedNotes);
  add(entities, "imported_intervention", snapshot.importedInterventions);
  add(entities, "reminder_delivery", snapshot.reminderDeliveries ?? []);
  add(entities, "note_shortcut_state", snapshot.noteShortcutStates ?? []);
  return entities;
}

export function normalizeAccountSyncBaseline(snapshot: AccountSyncSnapshot | AccountSyncPortabilitySnapshot): AccountSyncSnapshot {
  return "entities" in snapshot ? { entities: snapshot.entities.map(entity) } : { entities: portabilityEntities(snapshot) };
}

function add(output: AccountSyncEntity[], kind: AccountSyncEntity["kind"], rows: readonly unknown[]) {
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string") throw new Error(`The local ${kind} snapshot contains an invalid row.`);
    const value = kind === "category" ? { description: null, ...row }
      : kind === "note_shortcut_state" ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== "user_id"))
      : row;
    output.push({ kind, id: row.id, value: json(value) });
  }
}

function baselineSnapshot(value: string): AccountSyncSnapshot {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("The saved account baseline is invalid."); }
  if (isRecord(parsed) && Array.isArray(parsed.entities)) return { fingerprint: typeof parsed.fingerprint === "string" ? parsed.fingerprint : undefined, entities: parsed.entities.map(entity) };
  if (isPortabilitySnapshot(parsed)) return normalizeAccountSyncBaseline(parsed);
  throw new Error("The saved account baseline is invalid.");
}

function hostedEnvelope(value: unknown): HostedEnvelope {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.userId !== "string" || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !Array.isArray(value.entities)) {
    throw new Error("The hosted account snapshot is invalid.");
  }
  return { schemaVersion: 1, userId: value.userId, fingerprint: value.fingerprint, entities: value.entities.map(entity) };
}

function entity(value: unknown): AccountSyncEntity {
  if (!isRecord(value) || typeof value.kind !== "string" || !ACCOUNT_SYNC_ENTITY_KINDS.includes(value.kind as AccountSyncEntity["kind"]) || typeof value.id !== "string" || !("value" in value)) throw new Error("The account snapshot contains an invalid entity.");
  return { kind: value.kind as AccountSyncEntity["kind"], id: value.id, value: json(value.kind === "category" && isRecord(value.value) ? { description: null, ...value.value } : value.value) };
}
function isPortabilitySnapshot(value: unknown): value is PortabilitySnapshot {
  return isRecord(value) && isRecord(value.profile) && typeof value.profile.timezone === "string" && Array.isArray(value.categories) && Array.isArray(value.graphs) && Array.isArray(value.occurrences);
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function deadline<T>(operation: Promise<T>, controller: AbortController): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => { controller.abort(); reject(new Error("The account synchronization attempt exceeded 30 seconds.")); }, ACCOUNT_SYNC_TIME_LIMIT_MS);
    operation.then(resolve, reject).finally(() => globalThis.clearTimeout(timeout));
  });
}
function json(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(json);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, json(item)]));
  throw new Error("The account snapshot contains a non-JSON value.");
}
