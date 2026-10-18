import { integrationWriteHash } from "@/lib/services/integration-write.service";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { Database } from "@/lib/db/database.types";
import { createIntegrationContext, type IntegrationContext } from "@/lib/integrations/request-context";
import { parseIntegrationSigningKey } from "@/lib/supabase/integration-token";
import { registerOAuthClient, approveOAuthConsent, listOAuthActivity } from "@/lib/db/oauth.repo";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import { beginIdempotentWrite } from "@/lib/db/integration.repo";
import { getBehaviorById } from "@/lib/db/behaviors.repo";
import { getOccurrenceById } from "@/lib/db/occurrences.repo";
import { createBehaviorForUser } from "@/lib/services/behavior.service";
import { applyOccurrenceStatusTransition, updateOccurrenceNote } from "@/lib/services/occurrence.service";
import { integrationBehaviorInput } from "@/lib/services/integration-behavior-input";
import { listOccurrenceStatusEventsByOccurrenceIds } from "@/lib/db/occurrenceStatusEvents.repo";
import { validateOperationOutput, type IntegrationOperationInput } from "@cadence/core/integration";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const url = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const signingKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const localDescribe = url && serviceKey && publishableKey && signingKey ? describe : describe.skip;
const createInput: IntegrationOperationInput<"create_behavior"> = { title: "Integration walk", schedules: [
  { recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "09:00" }] },
] };

localDescribe("integration writes on isolated local Supabase", () => {
  let admin: ReturnType<typeof createClient<Database>>;
  let a: IntegrationContext;
  let b: IntegrationContext;
  let behaviorId: string;
  let occurrenceId: string;
  const users: string[] = [];
  const clientId = `dcr-write-225-${randomUUID()}`;
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local writes require loopback.");
    admin = createClient<Database>(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    await registerOAuthClient(admin, { clientId, registrationType: "dcr", clientName: "Write test", clientUri: null,
      logoUri: null, redirectUris: ["https://client.example/callback"], applicationType: "web", metadata: {},
      verifiedClient: null, metadataExpiresAt: null });
    const contexts: IntegrationContext[] = [];
    for (const label of ["a", "b"]) {
      const result = await admin.auth.admin.createUser({ email: `write-${label}-${randomUUID()}@example.test`, email_confirm: true });
      if (result.error || !result.data.user) throw new Error("Could not create local fixture user.");
      users.push(result.data.user.id);
      const grant = { userId: result.data.user.id, grantId: randomUUID(), clientId, clientLabel: "Write test", channel: "mcp" as const,
        scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] as const };
      const options = { now: new Date(), signingKey: parseIntegrationSigningKey(signingKey!), runtimeConfig: { url: url!, publishableKey: publishableKey! } };
      const temporary = createIntegrationContext(grant, options);
      const consent = await approveOAuthConsent(temporary.supabase, { clientId, redirectUri: "https://client.example/callback",
        codeChallenge: "a".repeat(43), resource: "https://app.cadence-me.com/mcp", scopes: [...grant.scopes], codeHash: randomUUID().replaceAll("-", "").repeat(2) });
      contexts.push(createIntegrationContext({ ...grant, grantId: consent.grantId }, options));
    }
    [a, b] = contexts;
  }, 30_000);
  afterAll(async () => {
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error("Local write fixture cleanup failed.");
    }
  });

  it("creates with web defaults, syncs occurrences, and replays exactly", async () => {
    const input = { ...createInput, idempotency_key: "create-225", external_ref: "facets:walk" };
    const first = await writeOperationHandlers.create_behavior(a, input);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    if (!first.ok) return;
    expect(validateOperationOutput("create_behavior", first.value).ok).toBe(true);
    expect(first.value.behavior.reminders).toMatchObject({ browser_enabled: true, email_enabled: false, offset_minutes: 0 });
    expect(first.value.behavior.external_ref).toBe("facets:walk");
    behaviorId = first.value.behavior.id;
    const replay = await writeOperationHandlers.create_behavior(a, input);
    expect(replay).toEqual(first);
    const { data, error } = await a.supabase.from("occurrences").select("id").eq("behavior_id", behaviorId).order("scheduled_for").limit(1);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    occurrenceId = data![0].id;
    const { data: behaviors } = await a.supabase.from("behaviors").select("id");
    expect(behaviors).toHaveLength(1);
    expect(await writeOperationHandlers.create_behavior(a, { ...input, title: "Different" }))
      .toMatchObject({ ok: false, error: { code: "idempotency_key_reused" } });
  });

  it("preserves correction history and rejects stale status", async () => {
    for (const status of ["completed", "not_completed", "unresolved", "completed"] as const) {
      a.now = new Date();
      const result = await writeOperationHandlers.set_occurrence_status(a, { occurrence_id: occurrenceId, status });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }
    const repeat = await writeOperationHandlers.set_occurrence_status(a, { occurrence_id: occurrenceId, status: "completed" });
    expect(repeat).toMatchObject({ ok: true, value: { changed: false } });
    expect(await writeOperationHandlers.set_occurrence_status(a, { occurrence_id: occurrenceId, status: "not_completed", expected_status: "unresolved" }))
      .toMatchObject({ ok: false, error: { code: "conflict" } });
    const events = await listOccurrenceStatusEventsByOccurrenceIds(a.supabase, a.userId, [occurrenceId]);
    expect(events).toHaveLength(4);
    expect(events.map(event => event.status_semantics)).toEqual(["explicit_user_mark", "explicit_user_correction", "explicit_user_correction", "explicit_user_correction"]);
    expect(events.every(event => event.source_capture_method === "manual_text")).toBe(true);
  });

  it("uses note revision fencing and stores the original result after later edits", async () => {
    const before = await getOccurrenceById(a.supabase, a.userId, occurrenceId);
    const input = { occurrence_id: occurrenceId, note: " First note ", expected_revision: Temporal.Instant.from(before!.updated_at).toString(), idempotency_key: "note-225" };
    const first = await writeOperationHandlers.update_occurrence_note(a, input);
    expect(first).toMatchObject({ ok: true, value: { occurrence: { note: "First note" }, changed: true } });
    const second = await writeOperationHandlers.update_occurrence_note(a, { occurrence_id: occurrenceId, note: "Second note" });
    expect(second.ok, JSON.stringify(second)).toBe(true);
    expect(await writeOperationHandlers.update_occurrence_note(a, { ...input, idempotency_key: "stale-note-225" }))
      .toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(await writeOperationHandlers.update_occurrence_note({ ...a, now: new Date(a.now.getTime() + 86_400_000) }, input)).toEqual(first);
    // The RPC receipt is committed before any HTTP response or post-write work.
    const receipt = await beginIdempotentWrite(a.supabase, { operation: "update_occurrence_note", idempotencyKey: input.idempotency_key,
      requestHash: integrationWriteHash("update_occurrence_note", input) });
    expect(receipt.state).toBe("replay");
    expect((await getOccurrenceById(a.supabase, a.userId, occurrenceId))?.note).toBe("Second note");
  });

  it("merges partial updates, rejects stale edits, and makes archive/restore no-ops", async () => {
    const current = await getBehaviorById(a.supabase, a.userId, behaviorId);
    const input = { behavior_id: behaviorId, expected_revision: Temporal.Instant.from(current!.updated_at).toString(), title: "Updated walk" };
    const update = await writeOperationHandlers.update_behavior(a, input);
    expect(update, JSON.stringify(update)).toMatchObject({ ok: true, value: { behavior: { title: "Updated walk" }, changed: true } });
    expect(await writeOperationHandlers.update_behavior(a, { ...input, title: "Stale" })).toMatchObject({ ok: false, error: { code: "conflict" } });
    for (const handler of [writeOperationHandlers.archive_behavior, writeOperationHandlers.restore_behavior]) {
      const first = await handler(a, { behavior_id: behaviorId });
      expect(first).toMatchObject({ ok: true, value: { changed: true } });
      const again = await handler(a, { behavior_id: behaviorId });
      expect(again).toMatchObject({ ok: true, value: { changed: false } });
    }
    expect((await getOccurrenceById(a.supabase, a.userId, occurrenceId))?.note).toBe("Second note");
  });

  it("rolls back external-reference conflicts without orphan Behaviors", async () => {
    const { count: before } = await a.supabase.from("behaviors").select("id", { count: "exact", head: true });
    expect(await writeOperationHandlers.create_behavior(a, { ...createInput, external_ref: "facets:walk", idempotency_key: "duplicate-external-225" }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    const { count: after } = await a.supabase.from("behaviors").select("id", { count: "exact", head: true });
    expect(after).toBe(before);
  });

  it("serializes simultaneous retries", async () => {
    const input = { ...createInput, title: "Concurrent", idempotency_key: "concurrent-225" };
    const results = await Promise.all([writeOperationHandlers.create_behavior(a, input), writeOperationHandlers.create_behavior(a, input)]);
    expect(results.some(result => result.ok)).toBe(true);
    const replay = await writeOperationHandlers.create_behavior(a, input);
    expect(replay.ok).toBe(true);
    const { data } = await a.supabase.from("behaviors").select("id").eq("title", "Concurrent");
    expect(data).toHaveLength(1);
  });

  it("recovers a committed create after losing the response without another write", async () => {
    const input = { ...createInput, title: "Interrupted", idempotency_key: "interrupted-225" };
    const rpc = a.supabase.rpc.bind(a.supabase);
    const spy = vi.spyOn(a.supabase, "rpc").mockImplementation(((...args: Parameters<typeof rpc>) => {
      if (args[0] !== "integration_apply_write") return rpc(...args);
      return Promise.resolve(rpc(...args)).then(result => {
        expect(result.error).toBeNull();
        return { data: null, error: { message: "Simulated response loss" } };
      }) as never;
    }) as typeof a.supabase.rpc);
    const interrupted = await writeOperationHandlers.create_behavior(a, input);
    spy.mockRestore();
    expect(interrupted).toMatchObject({ ok: false, error: { code: "internal_error" } });
    const replay = await writeOperationHandlers.create_behavior(a, input);
    expect(replay.ok, JSON.stringify(replay)).toBe(true);
    const { data } = await a.supabase.from("behaviors").select("id").eq("title", "Interrupted");
    expect(data).toHaveLength(1);
    const { count } = await a.supabase.from("occurrences").select("id", { count: "exact", head: true }).eq("behavior_id", data![0].id);
    expect(count).toBeGreaterThan(0);
  });

  it("rejects one of two note writers with the same revision", async () => {
    const row = await getOccurrenceById(a.supabase, a.userId, occurrenceId);
    const expected_revision = Temporal.Instant.from(row!.updated_at).toString();
    const results = await Promise.all(["Concurrent one", "Concurrent two"].map(note =>
      writeOperationHandlers.update_occurrence_note(a, { occurrence_id: occurrenceId, expected_revision, note })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toMatchObject({ error: { code: "conflict" } });
    expect(await writeOperationHandlers.update_occurrence_note(a, { occurrence_id: occurrenceId, note: "Second note" })).toMatchObject({ ok: true });
  });

  it("cancels and repairs reminders through the shared status service", async () => {
    const { data } = await a.supabase.from("occurrences").select("id").eq("behavior_id", behaviorId)
      .eq("status", "unresolved").gt("scheduled_for", new Date().toISOString()).order("scheduled_for").limit(1);
    const id = data![0].id;
    const deliveries = () => a.supabase.from("reminder_deliveries").select("status").eq("occurrence_id", id);
    expect((await deliveries()).data?.some(row => row.status === "pending")).toBe(true);
    a.now = new Date();
    expect(await writeOperationHandlers.set_occurrence_status(a, { occurrence_id: id, status: "completed" })).toMatchObject({ ok: true });
    expect((await deliveries()).data?.some(row => row.status === "pending")).toBe(false);
    a.now = new Date();
    expect(await writeOperationHandlers.set_occurrence_status(a, { occurrence_id: id, status: "unresolved" })).toMatchObject({ ok: true });
    expect((await deliveries()).data?.some(row => row.status === "pending")).toBe(true);
  });

  it("denies other users for every target operation", async () => {
    const behavior = await getBehaviorById(a.supabase, a.userId, behaviorId);
    const inputs = {
      set_occurrence_status: { occurrence_id: occurrenceId, status: "completed" },
      update_occurrence_note: { occurrence_id: occurrenceId, note: "Foreign" },
      update_behavior: { behavior_id: behaviorId, expected_revision: Temporal.Instant.from(behavior!.updated_at).toString(), title: "Foreign" },
      archive_behavior: { behavior_id: behaviorId }, restore_behavior: { behavior_id: behaviorId },
    };
    for (const name of Object.keys(inputs) as (keyof typeof inputs)[]) {
      expect(await writeOperationHandlers[name](b, inputs[name])).toMatchObject({ ok: false, error: { code: "not_found" } });
    }
  });

  it("writes the same row fields and history semantics as web services, accepted by desktop sync", async () => {
    const web = await createBehaviorForUser(b.supabase, b.userId, integrationBehaviorInput(createInput), b.now.toISOString());
    const integration = await getBehaviorById(a.supabase, a.userId, behaviorId);
    expect(Object.keys(web).sort()).toEqual(Object.keys(integration!).sort());
    const { data } = await b.supabase.from("occurrences").select("id").eq("behavior_id", web.id).limit(1);
    const webOccurrenceId = data![0].id;
    await applyOccurrenceStatusTransition(b.supabase, b.userId, { occurrenceId: webOccurrenceId, nextStatus: "completed", now: Temporal.Instant.from(b.now.toISOString()) });
    await updateOccurrenceNote(b.supabase, b.userId, { occurrenceId: webOccurrenceId, expectedNote: "", note: "Second note" });
    const [webRow, integrationRow] = await Promise.all([getOccurrenceById(b.supabase, b.userId, webOccurrenceId), getOccurrenceById(a.supabase, a.userId, occurrenceId)]);
    expect(Object.keys(webRow!).sort()).toEqual(Object.keys(integrationRow!).sort());
    expect(webRow?.status).toBe(integrationRow?.status);
    expect(webRow?.note).toBe(integrationRow?.note);
    const webEvents = await listOccurrenceStatusEventsByOccurrenceIds(b.supabase, b.userId, [webOccurrenceId]);
    const integrationEvents = await listOccurrenceStatusEventsByOccurrenceIds(a.supabase, a.userId, [occurrenceId]);
    expect(Object.keys(webEvents[0]).sort()).toEqual(Object.keys(integrationEvents[0]).sort());
    expect(webEvents[0].status_semantics).toBe(integrationEvents[0].status_semantics);
    expect(webEvents[0].source_capture_method).toBe("manual_tap");
    const sync = await a.supabase.rpc("read_account_sync_snapshot");
    expect(sync.error).toBeNull();
    expect(JSON.stringify(sync.data)).toContain(behaviorId);
    const activity = await listOAuthActivity(a.supabase, { limit: 100 });
    expect(activity.some(event => event.operation === "create_behavior" && event.outcome === "success")).toBe(true);
  });
  it("rechecks actual grant scope inside the atomic transaction", async () => {
    const consent = await approveOAuthConsent(b.supabase, { clientId, redirectUri: "https://client.example/callback",
      codeChallenge: "b".repeat(43), resource: "https://app.cadence-me.com/mcp", scopes: ["cadence.read"],
      codeHash: randomUUID().replaceAll("-", "").repeat(2) });
    const staleActor = createIntegrationContext({ userId: b.userId, grantId: consent.grantId, clientId,
      clientLabel: "Write test", channel: "mcp", scopes: ["cadence.read", "cadence.behaviors.write"] }, {
      now: new Date(), signingKey: parseIntegrationSigningKey(signingKey!), runtimeConfig: { url: url!, publishableKey: publishableKey! },
    });
    expect(await writeOperationHandlers.create_behavior(staleActor, createInput)).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
  });

});
