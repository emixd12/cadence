import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/database.types";
import { createIntegrationContext, type IntegrationContext } from "@/lib/integrations/request-context";
import { parseIntegrationSigningKey } from "@/lib/supabase/integration-token";
import { registerOAuthClient, approveOAuthConsent } from "@/lib/db/oauth.repo";
import { writeOperationHandlers } from "@/lib/integrations/operations/write";
import { readOperationHandlers } from "@/lib/integrations/operations/read";
import { applyOccurrenceStatusTransition } from "@/lib/services/occurrence.service";
import { moveOccurrenceForDay, revertOccurrenceMove } from "@/lib/services/occurrence-move.service";

// Advisor Phase 2A move-on checks against an isolated local Supabase:
//   - an MCP client moves and undoes today's item and sees effective_start_at;
//   - the moved item's reminder follows the new time, and a passed item gets none;
//   - a schedule edit and a resync keep the move and add no second copy;
//   - a status mark after a move needs no review.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const url = process.env.CADENCE_LOCAL_SUPABASE_URL;
const serviceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const signingKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const localDescribe = url && serviceKey && publishableKey && signingKey ? describe : describe.skip;

/** An Etc/GMT zone where the local time is about 10:00, so 09:00 has passed and 15:00 has not. */
function morningZone(now: Temporal.Instant): string {
  const utcHour = now.toZonedDateTimeISO("UTC").hour;
  let offset = 10 - utcHour;
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

localDescribe("per-day moves on isolated local Supabase (advisor Phase 2A)", () => {
  let admin: ReturnType<typeof createClient<Database>>;
  let mcp: IntegrationContext;
  let userId: string;
  let timezone: string;
  let today: string;
  const clientId = `dcr-moves-2a-${randomUUID()}`;
  const call = async (name: keyof typeof writeOperationHandlers, input: unknown) => {
    const result = await writeOperationHandlers[name]({ ...mcp, now: new Date() }, input);
    if (!result.ok) throw new Error(`${name} failed: ${JSON.stringify(result.error)}`);
    // Test-only loose view of the validated output.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.value as Record<string, any>;
  };
  const occurrencesToday = async (behaviorId: string) => {
    const { data, error } = await admin.from("occurrences").select("*").eq("user_id", userId)
      .eq("behavior_id", behaviorId).eq("local_date", today).order("scheduled_for");
    if (error) throw error;
    return data;
  };
  const localInstant = (time: string) => Temporal.PlainDate.from(today).toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(timezone).toInstant().toString();

  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local writes require loopback.");
    admin = createClient<Database>(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = Temporal.Now.instant();
    timezone = morningZone(now);
    today = now.toZonedDateTimeISO(timezone).toPlainDate().toString();
    await registerOAuthClient(admin, { clientId, registrationType: "dcr", clientName: "Move test", clientUri: null,
      logoUri: null, redirectUris: ["https://client.example/callback"], applicationType: "web", metadata: {},
      verifiedClient: null, metadataExpiresAt: null });
    const created = await admin.auth.admin.createUser({ email: `moves-${randomUUID()}@example.test`, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create local fixture user.");
    userId = created.data.user.id;
    const profile = await admin.from("profiles").update({ timezone }).eq("id", userId);
    if (profile.error) throw profile.error;
    const grant = { userId, grantId: randomUUID(), clientId, clientLabel: "Move test", channel: "mcp" as const,
      scopes: ["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"] as const };
    const options = { now: new Date(), signingKey: parseIntegrationSigningKey(signingKey!), runtimeConfig: { url: url!, publishableKey: publishableKey! } };
    const temporary = createIntegrationContext(grant, options);
    const consent = await approveOAuthConsent(temporary.supabase, { clientId, redirectUri: "https://client.example/callback",
      codeChallenge: "a".repeat(43), resource: "https://app.cadence-me.com/mcp", scopes: [...grant.scopes], codeHash: randomUUID().replaceAll("-", "").repeat(2) });
    mcp = createIntegrationContext({ ...grant, grantId: consent.grantId }, options);
  }, 30_000);

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("moves and undoes today's item, keeps it through a schedule edit and resync, and moves its reminder", async () => {
    const behavior = (await call("create_behavior", {
      title: "Move walk", default_duration_minutes: 30, reminders: { browser_enabled: true, offset_minutes: 15 },
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "09:00" }] }],
    })).behavior;
    expect(behavior.timezone).toBe(timezone);
    const [planned] = await occurrencesToday(behavior.id);
    expect(planned).toBeDefined();

    // 09:00 has passed, so it has no pending reminder.
    const before = await admin.from("reminder_deliveries").select("*").eq("occurrence_id", planned!.id).eq("status", "pending");
    expect(before.data).toEqual([]);

    // A refused move explains itself and offers free times.
    const read = await readOperationHandlers.get_occurrence({ ...mcp, now: new Date() }, { occurrence_id: planned!.id });
    if (!read.ok) throw new Error("get_occurrence failed");
    const revision = read.value.occurrence.revision;
    const late = await call("move_occurrence_for_day", { occurrence_id: planned!.id, start_time: "08:00", expected_revision: revision });
    expect(late).toMatchObject({ outcome: "refused", move: null, refusal: { reason: "time_passed" } });
    expect(late.refusal.alternatives.length).toBeGreaterThan(0);

    const moved = await call("move_occurrence_for_day", {
      occurrence_id: planned!.id, start_time: "15:00", expected_revision: revision, idempotency_key: "move-walk-15",
    });
    expect(moved.outcome).toBe("moved");
    expect(moved.occurrence.scheduled_for).toBe(Temporal.Instant.from(planned!.scheduled_for).toString());
    expect(moved.occurrence.effective_start_at).toBe(localInstant("15:00"));
    expect(moved.occurrence.move).toEqual({
      planned_start_at: moved.occurrence.scheduled_for, start_at: localInstant("15:00"), end_at: localInstant("15:30"),
    });
    expect(moved.move).toMatchObject({ kind: "move", source: "mcp", chain_position: 1, to_planned: false });

    // The same key replays; different input with it is refused.
    const replay = await call("move_occurrence_for_day", {
      occurrence_id: planned!.id, start_time: "15:00", expected_revision: revision, idempotency_key: "move-walk-15",
    });
    expect(replay.move.id).toBe(moved.move.id);
    const reused = await writeOperationHandlers.move_occurrence_for_day({ ...mcp, now: new Date() }, {
      occurrence_id: planned!.id, start_time: "16:00", expected_revision: revision, idempotency_key: "move-walk-15",
    });
    expect(reused).toMatchObject({ ok: false, error: { code: "idempotency_key_reused" } });

    // The reminder follows the moved time.
    const reminder = await admin.from("reminder_deliveries").select("*").eq("occurrence_id", planned!.id).eq("status", "pending");
    expect(reminder.data?.map((row) => Temporal.Instant.from(row.scheduled_send_at).toString()))
      .toEqual([Temporal.Instant.from(localInstant("15:00")).subtract({ minutes: 15 }).toString()]);

    // A schedule edit to another past time, then a resync: one item today, still moved.
    const current = await readOperationHandlers.get_behavior({ ...mcp, now: new Date() }, { behavior_id: behavior.id });
    if (!current.ok) throw new Error("get_behavior failed");
    await call("update_behavior", {
      behavior_id: behavior.id, expected_revision: current.value.behavior.revision,
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "09:30" }] }],
    });
    const afterEdit = await occurrencesToday(behavior.id);
    expect(afterEdit.map((row) => row.id)).toEqual([planned!.id]);
    expect(Temporal.Instant.from(afterEdit[0]!.effective_start_at!).toString()).toBe(localInstant("15:00"));

    // A status mark from another client after the move applies without review.
    const marked = await applyOccurrenceStatusTransition(mcp.supabase, userId, {
      occurrenceId: planned!.id, nextStatus: "completed", expectedStatus: "unresolved",
      now: Temporal.Now.instant(), sourceCaptureMethod: "manual_text",
    });
    expect(marked).toBeDefined();
    const undo = await call("revert_occurrence_move", { occurrence_id: planned!.id, expected_revision: moved.occurrence.revision });
    expect(undo).toMatchObject({ outcome: "refused", refusal: { reason: "occurrence_resolved" } });
    // A resolved item's reminder is cancelled by the usual status path, and the move record stays.
    const history = await admin.from("occurrence_moves").select("id").eq("occurrence_id", planned!.id);
    expect(history.data).toHaveLength(1);
  }, 60_000);

  it("undoes the latest move back to the plan", async () => {
    const behavior = (await call("create_behavior", {
      title: "Move stretch",
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "13:00" }] }],
    })).behavior;
    const [planned] = await occurrencesToday(behavior.id);
    const read = await readOperationHandlers.get_occurrence({ ...mcp, now: new Date() }, { occurrence_id: planned!.id });
    if (!read.ok) throw new Error("get_occurrence failed");
    const moved = await call("move_occurrence_for_day", { occurrence_id: planned!.id, start_time: "17:00", expected_revision: read.value.occurrence.revision });
    expect(moved.outcome).toBe("moved");
    const stale = await call("revert_occurrence_move", { occurrence_id: planned!.id, expected_revision: read.value.occurrence.revision });
    expect(stale).toMatchObject({ outcome: "refused", refusal: { reason: "revision_changed" } });
    const undone = await call("revert_occurrence_move", { occurrence_id: planned!.id, expected_revision: moved.occurrence.revision });
    expect(undone.outcome).toBe("undone");
    expect(undone.occurrence.move).toBeNull();
    expect(undone.occurrence.effective_start_at).toBe(undone.occurrence.scheduled_for);
    expect(undone.move).toMatchObject({ kind: "revert", to_planned: true, chain_position: 2 });
    const reminder = await admin.from("reminder_deliveries").select("scheduled_send_at").eq("occurrence_id", planned!.id).eq("status", "pending");
    expect(reminder.data?.map((row) => Temporal.Instant.from(row.scheduled_send_at).toString())).toEqual([localInstant("13:00")]);
  }, 60_000);

  it("refuses a late move that runs into tomorrow's first item", async () => {
    const midnight = (await call("create_behavior", {
      title: "Move midnight read", default_duration_minutes: 20,
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "00:00" }] }],
    })).behavior;
    const tomorrow = Temporal.PlainDate.from(today).add({ days: 1 }).toString();
    const next = await admin.from("occurrences").select("id").eq("behavior_id", midnight.id).eq("local_date", tomorrow);
    expect(next.data).toHaveLength(1);
    const late = (await call("create_behavior", {
      title: "Move late walk", default_duration_minutes: 30,
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "20:00" }] }],
    })).behavior;
    const [planned] = await occurrencesToday(late.id);
    const read = await readOperationHandlers.get_occurrence({ ...mcp, now: new Date() }, { occurrence_id: planned!.id });
    if (!read.ok) throw new Error("get_occurrence failed");
    const refused = await call("move_occurrence_for_day", { occurrence_id: planned!.id, start_time: "23:45", expected_revision: read.value.occurrence.revision });
    expect(refused).toMatchObject({ outcome: "refused", refusal: { reason: "slot_taken" } });
    const fits = await call("move_occurrence_for_day", { occurrence_id: planned!.id, start_time: "23:15", expected_revision: read.value.occurrence.revision });
    expect(fits.outcome).toBe("moved");
  }, 60_000);

  it("accepts an idempotency key from a caller that sends no request hash, as the web actions do", async () => {
    const behavior = (await call("create_behavior", {
      title: "Move web tidy",
      schedules: [{ recurrence: { frequency: "daily", interval: 1 }, time_entries: [{ kind: "exact", start_time: "14:00" }] }],
    })).behavior;
    const [planned] = await occurrencesToday(behavior.id);
    const caller = { supabase: mcp.supabase, userId, now: Temporal.Now.instant() };
    const request = { occurrenceId: planned!.id, expectedRevision: planned!.updated_at, startTime: "18:00", idempotencyKey: "web-tidy-18" };
    const moved = await moveOccurrenceForDay(caller, request);
    expect(moved.outcome).toBe("moved");
    if (moved.outcome === "refused") throw new Error("move refused");
    const replay = await moveOccurrenceForDay(caller, request);
    expect(replay).toMatchObject({ outcome: "moved", replayed: true, move: { id: moved.move.id } });
    await expect(moveOccurrenceForDay(caller, { ...request, startTime: "19:00" })).rejects.toThrow();
    const undone = await revertOccurrenceMove(caller, {
      occurrenceId: planned!.id, expectedRevision: moved.occurrence.updated_at, idempotencyKey: "web-tidy-undo",
    });
    expect(undone.outcome).toBe("undone");
  }, 60_000);
});
