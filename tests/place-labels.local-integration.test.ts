import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BehaviorInput } from "@cadence/core/behavior-store";
import { sha256 } from "@cadence/core/hash";
import {
  accountSyncFingerprint,
  resolveAccountSync,
  type AccountSyncEntity,
  type AccountSyncPlan,
  type AccountSyncSnapshot,
} from "@cadence/core/resolvers/account-sync.resolver";
import { createBehavior } from "@cadence/core/services/behavior.service";
import { travelPlaceKey } from "@cadence/core/services/travel-place-key";
import { canonicalJson } from "../apps/desktop/src/account/canonical-json";
import { createBehaviorStore } from "@/lib/db/behavior-store";
import type { Database } from "@/lib/db/database.types";
import { insertCompletionPlaceLabelRow, savePlaceLabelSettingsRow, upsertPlaceMarkerRow } from "@/lib/db/placeLabels.repo";

// Ticket 216 opt-in check against a loopback Supabase: TypeScript and SQL agree on
// snapshot fingerprints for the four new kinds, and planned writes apply through the
// hosted account-sync RPC with its triggers. It creates and deletes one user.
const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localDescribe = localUrl && localServiceKey && localPublishableKey ? describe : describe.skip;

const VALUES: BehaviorInput = {
  title: "Place label contract", description: null, categoryId: null,
  recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: "09:00",
  schedules: [{ recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
    timeEntries: [{ kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }] }],
  browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
};

type Envelope = { fingerprint: string; entities: AccountSyncEntity[] };

localDescribe("Completion place labels against local Supabase", () => {
  let admin: SupabaseClient<Database>;
  let client: SupabaseClient<Database>;
  let userId = "";

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("The place label check only runs against loopback Supabase.");
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    admin = createClient<Database>(localUrl!, localServiceKey!, options);
    const email = `place-labels-${randomUUID().slice(0, 8)}@example.test`;
    const password = `Places-${randomUUID()}-aA1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create the local test user.");
    userId = created.data.user.id;
    client = createClient<Database>(localUrl!, localPublishableKey!, options);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error("Could not sign in the local test user.");
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function snapshot(): Promise<Envelope> {
    const { data, error } = await client.rpc("read_account_sync_snapshot");
    if (error) throw error;
    return data as unknown as Envelope;
  }

  async function apply(baseline: Envelope, local: AccountSyncSnapshot): Promise<{ plan: AccountSyncPlan; result: Envelope }> {
    const plan = resolveAccountSync({ accountLinkId: "integration", baseline, local, hosted: baseline });
    expect(plan.conflicts).toEqual([]);
    const rpcPlan = { writes: plan.hostedWrites, mergedFingerprint: plan.fingerprints.merged, conflicts: [] };
    const { data, error } = await client.rpc("apply_account_sync_plan", { sync_payload: {
      schemaVersion: 1, idempotencyKey: plan.idempotencyKey, baselineFingerprint: plan.fingerprints.baseline,
      localFingerprint: plan.fingerprints.local, hostedFingerprint: plan.fingerprints.hosted,
      planFingerprint: sha256(canonicalJson(rpcPlan)), plan: rpcPlan, attemptedAt: new Date().toISOString(),
    } as never });
    if (error) throw error;
    return { plan, result: (data as unknown as { snapshot: Envelope }).snapshot };
  }

  it("matches SQL fingerprints and applies planned place label writes", async () => {
    const behavior = await createBehavior(createBehaviorStore(client, userId), {
      userId, timezone: "America/New_York", recordedAt: "2026-10-23T12:00:00.000Z", values: { ...VALUES, whereKind: "home" } });
    await savePlaceLabelSettingsRow(client, { enabled: true, retention: "90_days", markerPromptDismissed: false, expectedUpdatedAt: null, retentionCutoff: null });
    const homeKey = travelPlaceKey("1 Example Lane");
    await upsertPlaceMarkerRow(client, userId, { id: "home", place_key: homeKey, latitude_e6: 41_878_100, longitude_e6: -87_629_800,
      accuracy_meters: 15, rule_version: "place-label-rules@1", recorded_at: "2026-10-23T12:01:00.123456Z" });
    const occurrenceId = randomUUID();
    const inserted = await admin.from("occurrences").insert({ id: occurrenceId, user_id: userId, behavior_id: behavior.id,
      scheduled_for: "2026-10-23T13:00:00Z", local_date: "2026-10-23", schedule_start_time: "09:00:00",
      status: "completed", completed_at: "2026-10-23T13:05:00Z", status_marked_at: "2026-10-23T13:05:00Z" });
    if (inserted.error) throw inserted.error;
    await insertCompletionPlaceLabelRow(client, userId, { id: occurrenceId, behavior_id: behavior.id, local_date: "2026-10-23",
      label: "home", rule_version: "place-label-rules@1", recorded_at: "2026-10-23T13:05:30.5Z" });

    // TypeScript normalization and the SQL snapshot agree for every new kind.
    const hosted = await snapshot();
    expect(hosted.entities.filter(({ kind }) => ["place_label_settings", "place_marker", "completion_place_label"].includes(kind))).toHaveLength(3);
    expect(accountSyncFingerprint(hosted)).toBe(hosted.fingerprint);

    // A desktop that recorded a newer marker and dismissed a suggestion uploads both.
    const marker = hosted.entities.find(({ kind }) => kind === "place_marker")!;
    const newerMarker = { ...marker, value: { ...(marker.value as object), latitude_e6: 41_878_200, recorded_at: "2026-10-23T14:00:00.000000Z" } };
    const dismissal: AccountSyncEntity = { kind: "where_suggestion_dismissal", id: behavior.id, value: {
      id: behavior.id, suggestion: "anywhere", rule_version: "where-suggestion-rules@1", dismissed_at: "2026-10-23T14:01:00.000000Z" } };
    const uploaded = await apply(hosted, { entities: [...hosted.entities.filter((entity) => entity !== marker), newerMarker, dismissal] });
    expect(uploaded.result.fingerprint).toBe(uploaded.plan.fingerprints.merged);
    expect(accountSyncFingerprint(uploaded.result)).toBe(uploaded.result.fingerprint);

    // A desktop that turned labels off removes every location-derived row in one apply.
    const settings = uploaded.result.entities.find(({ kind }) => kind === "place_label_settings")!;
    const off = { ...settings, value: { ...(settings.value as object), enabled: false, enabled_at: null, updated_at: "2026-10-23T15:00:00.000000Z" } };
    const disabled = await apply(uploaded.result, { entities: [...uploaded.result.entities.filter((entity) => entity !== settings), off] });
    expect(disabled.result.entities.filter(({ kind }) => ["place_marker", "completion_place_label", "where_suggestion_dismissal"].includes(kind))).toEqual([]);
    expect(disabled.result.fingerprint).toBe(disabled.plan.fingerprints.merged);
  });
});
