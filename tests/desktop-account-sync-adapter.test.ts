import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyHostedAccountSync, normalizeAccountSyncBaseline, planAccountSync, portabilityEntities, readAccountSyncInputs, readHostedAccountSyncEnvelope, synchronizeAccount } from "../apps/desktop/src/account/account-sync";
import { accountSyncFingerprint, resolveAccountSync } from "@cadence/core/resolvers/account-sync.resolver";
import { emptyPortabilitySnapshot } from "./helpers/portability-fixture";
import { canonicalJson } from "../apps/desktop/src/account/canonical-json";
import { syncFailureStatus } from "../apps/desktop/src/sync-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
beforeEach(() => { native.invoke.mockReset().mockResolvedValue(null); });

const digest = accountSyncFingerprint({ entities: [{ kind: "profile", id: "profile", value: { timezone: "America/New_York" } }] });
const context = { hostedUserId: "hosted", baselineFingerprint: digest, baselineJson: JSON.stringify({ entities: [{ kind: "profile", id: "profile", value: { timezone: "America/New_York" } }] }), outboxHighWater: 7, tombstones: [] };
const hosted = { schemaVersion: 1, userId: "hosted", fingerprint: digest, entities: [{ kind: "profile", id: "profile", value: { timezone: "America/New_York" } }] };

describe("desktop account sync adapter", () => {
  it("upgrades old category baselines without erasing a description edited on another copy", () => {
    const profile = { kind: "profile" as const, id: "profile", value: { timezone: "America/New_York" } };
    const old = { entities: [profile, { kind: "category" as const, id: "category", value: { name: "Home", sort_order: 0 } }] };
    const baseline = normalizeAccountSyncBaseline(old);
    const category = baseline.entities.find(({ kind }) => kind === "category")!;
    expect(category.value).toMatchObject({ description: null });
    const hosted = { entities: [profile, { ...category, value: { name: "Home", sort_order: 0, description: "Household routines" } }] };
    const plan = resolveAccountSync({ accountLinkId: "hosted", baseline, local: baseline, hosted });
    expect(plan.conflicts).toEqual([]);
    expect(plan.hostedWrites).toEqual([]);
    expect(plan.localWrites[0].value).toMatchObject({ description: "Household routines" });
    const competing = { entities: [profile, { ...category, value: { name: "Home", sort_order: 0, description: "Other context" } }] };
    expect(resolveAccountSync({ accountLinkId: "hosted", baseline, local: competing, hosted }).conflicts).toHaveLength(1);
  });
  it("canonicalizes nested Unicode keys in PostgreSQL C order", () => {
    expect(canonicalJson({ nested: { "𐀀": 2, "": 1 } })).toBe('{"nested":{"":1,"𐀀":2}}');
  });
  it("flattens every synchronized portability collection and excludes native state", () => {
    const source = { ...emptyPortabilitySnapshot(), reminderDeliveries: [{ id: "delivery", user_id: "local" }], nativeReminders: [{ id: "native" }],
      noteShortcutStates: [{ id: "global", user_id: "local", behavior_id: null, enabled: true, entries: [], excluded_occurrence_ids: [], revision: 1, updated_at: "2026-09-01T12:00:00Z" }] };
    const entities = portabilityEntities(source);
    expect(entities.map(({ kind }) => kind)).toContain("reminder_delivery");
    expect(entities.map(({ kind }) => kind)).toContain("note_shortcut_state");
    expect(entities.find(({ kind }) => kind === "note_shortcut_state")?.value).not.toHaveProperty("user_id");
    expect(entities.some(({ id }) => id === "native")).toBe(false);
  });

  it("reads the saved baseline, local snapshot, hosted RPC envelope, and outbox high-water", async () => {
    const inputs = await readAccountSyncInputs("local", {} as never, { readContext: vi.fn(async () => context), readLocal: vi.fn(async () => emptyPortabilitySnapshot()), readHosted: vi.fn(async () => hosted) });
    expect(inputs).toMatchObject({ accountLinkId: "hosted", baselineFingerprint: digest, hostedFingerprint: digest, outboxHighWater: 7 });
    expect(inputs.local.entities).toHaveLength(1);
  });

  it("uses one atomic hosted snapshot RPC and verifies its fingerprint", async () => {
    const abortSignal = vi.fn(async () => ({ data: hosted, error: null }));
    const rpc = vi.fn(() => ({ abortSignal }));
    const client = { rpc } as unknown as SupabaseClient;
    await expect(readHostedAccountSyncEnvelope(client)).resolves.toEqual(hosted);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_account_sync_snapshot");
    expect(abortSignal).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenCalledWith("local_store", { request: { operation: "validateAccountSyncSnapshot", entities: hosted.entities } });

    const invalid = { ...hosted, fingerprint: "0".repeat(64) };
    const invalidClient = { rpc: vi.fn(() => ({ abortSignal: vi.fn(async () => ({ data: invalid, error: null })) })) } as unknown as SupabaseClient;
    await expect(readHostedAccountSyncEnvelope(invalidClient)).rejects.toThrow("fingerprint is invalid");
  });

  it("reports a revoked session when sync RPCs run without a session", async () => {
    // After a failed refresh Supabase drops the session; PostgREST then answers 401 with 42501.
    const denied = (name: string) => ({ code: "42501", message: `permission denied for function ${name}`, details: null, hint: null });
    const snapshotClient = (status: number) => ({ rpc: vi.fn(() => ({ abortSignal: vi.fn(async () => ({ data: null, error: denied("read_account_sync_snapshot"), status })) })) }) as unknown as SupabaseClient;
    const revoked = await readHostedAccountSyncEnvelope(snapshotClient(401)).catch((error: unknown) => error);
    expect(syncFailureStatus(revoked)).toEqual({ state: "revoked" });
    // A signed-in permission failure is not a session problem and keeps its message.
    const forbidden = await readHostedAccountSyncEnvelope(snapshotClient(403)).catch((error: unknown) => error);
    expect(syncFailureStatus(forbidden)).toEqual({ state: "failed", message: "permission denied for function read_account_sync_snapshot" });

    const baseline = { entities: [{ kind: "profile", id: "profile", value: { timezone: "UTC" } }] } as const;
    const local = { entities: [{ kind: "profile", id: "profile", value: { timezone: "America/New_York" } }] } as const;
    const hostedSnapshot = { entities: [...baseline.entities] };
    const syncPlan = resolveAccountSync({ accountLinkId: "hosted", baseline, local, hosted: hostedSnapshot });
    const inputs = { accountLinkId: "hosted", baseline, local, hosted: hostedSnapshot, baselineFingerprint: accountSyncFingerprint(baseline), hostedFingerprint: accountSyncFingerprint(hostedSnapshot), outboxHighWater: 2 };
    const applyClient = { rpc: vi.fn(async () => ({ data: null, error: denied("apply_account_sync_plan"), status: 401 })) } as never;
    const applyFailure = await applyHostedAccountSync(applyClient, inputs, syncPlan, "2026-09-01T12:00:00Z").catch((error: unknown) => error);
    expect(syncFailureStatus(applyFailure)).toEqual({ state: "revoked" });
  });

  it("stops incompatible downloads before either sync commit or acknowledgement", async () => {
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "auth_account_sync_context") return context;
      if (args?.request.operation === "readImportSnapshot") return emptyPortabilitySnapshot();
      if (args?.request.operation === "validateAccountSyncSnapshot") throw "Update Cadence before synchronizing account data.";
      throw new Error("Unexpected native write");
    });
    const rpc = vi.fn(() => ({ abortSignal: vi.fn(async () => ({ data: hosted, error: null })) }));
    await expect(synchronizeAccount("local", { rpc } as unknown as SupabaseClient)).resolves.toEqual({ state: "update_required", message: "Update required to synchronize" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_account_sync_snapshot");
    expect(native.invoke.mock.calls.some(([name, args]) => name === "auth_complete_account_sync" || args?.request.operation === "applyAccountSync")).toBe(false);
  });

  it("converts the legacy first-link portability baseline and produces a real planner result", async () => {
    const legacy = { ...context, baselineJson: JSON.stringify(emptyPortabilitySnapshot()) };
    const result = await planAccountSync("local", {} as never, { readContext: vi.fn(async () => legacy), readLocal: vi.fn(async () => emptyPortabilitySnapshot()), readHosted: vi.fn(async () => hosted) });
    expect(result.plan.conflicts).toEqual([]);
    expect(result.plan.idempotencyKey).toHaveLength(64);
  });

  it("normalizes a first-link portability snapshot before fingerprinting it", () => {
    const normalized = normalizeAccountSyncBaseline(emptyPortabilitySnapshot());
    expect(normalized).toEqual({ entities: [{ kind: "profile", id: "profile", value: {
      timezone: "America/New_York",
      travel_enabled: false,
      base_location_text: null,
      travel_mode: null,
      navigation_preference: null,
      routing_consent_at: null,
      onboarding_completed_at: null,
      updated_at: "2026-06-08T16:00:00Z",
    } }] });
    expect(accountSyncFingerprint(normalized)).toBe(digest);
  });

  it("rejects another account and malformed saved state before planning", async () => {
    await expect(readAccountSyncInputs("local", {} as never, { readContext: vi.fn(async () => context), readLocal: vi.fn(async () => emptyPortabilitySnapshot()), readHosted: vi.fn(async () => ({ ...hosted, userId: "other" })) })).rejects.toThrow("another account");
    await expect(readAccountSyncInputs("local", {} as never, { readContext: vi.fn(async () => ({ ...context, baselineJson: "{}" })), readLocal: vi.fn(async () => emptyPortabilitySnapshot()), readHosted: vi.fn(async () => hosted) })).rejects.toThrow("baseline is invalid");
  });

  it("fails closed when the complete snapshot read exceeds 30 seconds", async () => {
    vi.useFakeTimers();
    const pending = readAccountSyncInputs("local", {} as never, { readContext: vi.fn(async () => context), readLocal: vi.fn(() => new Promise<ReturnType<typeof emptyPortabilitySnapshot>>(() => undefined)), readHosted: vi.fn(async () => hosted) });
    const rejected = expect(pending).rejects.toThrow("exceeded 30 seconds");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    vi.useRealTimers();
  });

  it("applies one deterministic typed hosted-write payload", async () => {
    const baseline = { entities: [{ kind: "profile", id: "profile", value: { timezone: "UTC" } }] } as const;
    const local = { entities: [{ kind: "profile", id: "profile", value: { timezone: "America/New_York" } }] } as const;
    const hostedSnapshot = { entities: [...baseline.entities] };
    const syncPlan = resolveAccountSync({ accountLinkId: "hosted", baseline, local, hosted: hostedSnapshot });
    const mergedFingerprint = accountSyncFingerprint({ entities: syncPlan.mergedEntities });
    const payloads: unknown[] = [];
    const client = { rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      payloads.push(args.sync_payload);
      return { data: { status: "applied", fingerprint: mergedFingerprint, snapshot: { schemaVersion: 1, userId: "hosted", fingerprint: mergedFingerprint, entities: syncPlan.mergedEntities } }, error: null };
    }) } as never;
    const inputs = { accountLinkId: "hosted", baseline, local, hosted: hostedSnapshot, baselineFingerprint: accountSyncFingerprint(baseline), hostedFingerprint: accountSyncFingerprint(hostedSnapshot), outboxHighWater: 2 };
    await applyHostedAccountSync(client, inputs, syncPlan, "2026-09-01T12:00:00Z");
    await applyHostedAccountSync(client, inputs, syncPlan, "2026-09-01T12:00:00Z");
    expect(payloads[0]).toEqual(payloads[1]);
    expect(payloads[0]).toMatchObject({ idempotencyKey: syncPlan.idempotencyKey, plan: { writes: [{ kind: "profile", operation: "upsert" }], mergedFingerprint, conflicts: [] } });
  });
});
