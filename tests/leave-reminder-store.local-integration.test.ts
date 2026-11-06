import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { leaveReminderStaleClaimBefore } from "@cadence/core/services/leave-reminder-plan";
import type { Database } from "../lib/db/database.types";
import { createLeaveReminderStore, selectDueLeaveReminderAccounts, type LeaveReminderStore } from "../lib/db/leave-reminders.repo";
import { createLeaveReminderCaller, type LeaveReminderCaller } from "../lib/integrations/leave-reminder-caller";
import { parseIntegrationSigningKey, type IntegrationSigningKey } from "../lib/supabase/integration-token";

// Opt-in, Ticket 277. Same isolated local project and four variables as
// tests/leave-reminder-caller.local-integration.test.ts (docs/SUPABASE_WORKFLOW.md,
// "Integration request tokens"). Refuses non-loopback URLs. Proves the job's
// compare-and-set writes against the Ticket 275 migration, as the user, under RLS.
const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localSigningKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const enabled = Boolean(localUrl && localServiceKey && localPublishableKey && localSigningKey);
const localDescribe = enabled ? describe : describe.skip;

const DATE = "2026-11-06";
const digest = (character: string) => character.repeat(64);

localDescribe("leave reminder store against local Supabase", () => {
  let admin: SupabaseClient<Database>;
  let key: IntegrationSigningKey;
  let userA: string;
  let userB: string;
  let callerA: LeaveReminderCaller;
  let callerB: LeaveReminderCaller;
  let storeA: LeaveReminderStore;
  let storeB: LeaveReminderStore;
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Runs only against loopback Supabase.");
    key = parseIntegrationSigningKey(localSigningKey!);
    admin = createClient<Database>(localUrl!, localServiceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    userA = await createUser(`store-a-${runId}@example.test`);
    userB = await createUser(`store-b-${runId}@example.test`);
    callerA = callerFor(userA);
    callerB = callerFor(userB);
    storeA = createLeaveReminderStore(callerA.client, userA);
    storeB = createLeaveReminderStore(callerB.client, userB);
    for (const [caller, id] of [[callerA, userA], [callerB, userB]] as const) {
      const { error } = await caller.client.from("travel_leave_reminder_settings").insert({ user_id: id, enabled: true });
      if (error) throw new Error("Unable to turn reminders on.");
    }
  }, 60_000);

  afterAll(async () => {
    for (const id of [userA, userB]) if (id) await admin?.auth.admin.deleteUser(id);
  });

  it("leases an account visit once, from the selected next check time", async () => {
    const due = await selectDueLeaveReminderAccounts(admin, { dueBy: new Date(Date.now() + 300_000), limit: 100 });
    const account = due.find((row) => row.userId === userA)!;
    const lease = new Date(Date.now() + 900_000).toISOString();
    const [first, second] = await Promise.all([storeA.claimAccount(account.nextCheckAt, lease), storeA.claimAccount(account.nextCheckAt, lease)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await storeB.claimAccount(account.nextCheckAt, lease)).toBe(false);
    expect(await storeA.releaseAccount("2026-01-01T00:00:00Z", lease)).toBe(false);
    expect(await storeA.releaseAccount(lease, "2026-11-06T15:30:00Z")).toBe(true);
  });

  it("inserts one claimed record per trip, and claims it once", async () => {
    const now = "2026-11-06T15:00:00.000Z";
    const [one, two] = await Promise.all([
      storeA.insertClaimed({ tripDigest: digest("1"), localDate: DATE, now }),
      storeA.insertClaimed({ tripDigest: digest("1"), localDate: DATE, now }),
    ]);
    const record = (one ?? two)!;
    expect([one, two].filter(Boolean)).toHaveLength(1);
    expect(record).toMatchObject({ status: "pending", routeCount: 0 });

    // A fresh claim is held; finishing writes once.
    expect(await storeA.claim(record, now, leaveReminderStaleClaimBefore(now))).toBeNull();
    expect(await storeA.finish(record, { next_check_at: "2026-11-06T17:10:00Z", route_count: 1, processing_started_at: null })).toBe(true);
    expect(await storeA.finish(record, { route_count: 2 })).toBe(false);

    const [pending] = (await storeA.listRecords()).filter((row) => row.tripDigest === digest("1"));
    const later = "2026-11-06T17:06:00.000Z";
    const claims = await Promise.all([1, 2, 3].map(() => storeA.claim(pending!, later, leaveReminderStaleClaimBefore(later))));
    const claimed = claims.filter(Boolean);
    expect(claimed).toHaveLength(1);

    // Send with a post-send check, then the one update.
    expect(await storeA.finish(claimed[0]!, { status: "sent", sent_at: later, next_check_at: "2026-11-06T17:10:00Z", route_count: 2, processing_started_at: null })).toBe(true);
    const [sent] = (await storeA.listRecords()).filter((row) => row.tripDigest === digest("1"));
    expect(sent).toMatchObject({ status: "sent", routeCount: 2 });
    const updateAt = "2026-11-06T17:11:00.000Z";
    const updating = (await storeA.claim(sent!, updateAt, leaveReminderStaleClaimBefore(updateAt)))!;
    expect(updating).not.toBeNull();
    expect(await storeA.finish(updating, { update_sent_at: updateAt, next_check_at: null, route_count: 3, processing_started_at: null })).toBe(true);
    // The stale copy cannot send a second update, and nothing reopens the check.
    expect(await storeA.finish(updating, { update_sent_at: updateAt, next_check_at: null, route_count: 3, processing_started_at: null })).toBe(false);
    await expect(storeA.updateUnclaimed({ ...updating, processingStartedAt: null, nextCheckAt: null, updateSentAt: updateAt, routeCount: 3 },
      leaveReminderStaleClaimBefore(updateAt), { next_check_at: "2026-11-06T17:20:00Z" })).rejects.toBeTruthy();
  });

  it("refuses a third route before sending", async () => {
    const now = "2026-11-06T15:00:00.000Z";
    const record = (await storeA.insertClaimed({ tripDigest: digest("2"), localDate: DATE, now }))!;
    await expect(storeA.finish(record, { route_count: 3, processing_started_at: null })).rejects.toBeTruthy();
  });

  it("cancels and restores unclaimed records, and purges earlier dates", async () => {
    const now = "2026-11-06T15:00:00.000Z";
    const old = (await storeA.insertClaimed({ tripDigest: digest("3"), localDate: "2026-11-04", now }))!;
    const record = (await storeA.insertClaimed({ tripDigest: digest("4"), localDate: DATE, now }))!;
    await storeA.finish(record, { processing_started_at: null });
    const [unclaimed] = (await storeA.listRecords()).filter((row) => row.tripDigest === digest("4"));
    const stale = leaveReminderStaleClaimBefore(now);
    expect(await storeA.updateUnclaimed(unclaimed!, stale, { status: "cancelled", next_check_at: null })).toBe(true);
    const [cancelled] = (await storeA.listRecords()).filter((row) => row.tripDigest === digest("4"));
    expect(await storeA.updateUnclaimed(cancelled!, stale, { status: "pending", next_check_at: now, processing_started_at: now })).toBe(true);
    await storeA.deleteBefore("2026-11-05");
    expect((await storeA.listRecords()).some((row) => row.id === old.id)).toBe(false);
  });

  it("sees only its own account, and inserts nothing once reminders are off", async () => {
    expect(await storeB.listRecords()).toEqual([]);
    const { error } = await callerA.client.from("travel_leave_reminder_settings").update({ enabled: false }).eq("user_id", userA);
    expect(error).toBeNull();
    expect(await storeA.listRecords()).toEqual([]);
    expect(await storeA.remindersEnabled()).toBe(false);
    expect(await storeA.insertClaimed({ tripDigest: digest("5"), localDate: DATE, now: "2026-11-06T15:00:00.000Z" })).toBeNull();
  });

  it("brings a later next check forward when a get-ready change replaced its lease (D19)", async () => {
    const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const nextCheck = async () => {
      const { data, error } = await callerB.client.from("travel_leave_reminder_settings").select("next_check_at").eq("user_id", userB).single();
      if (error) throw error;
      return data.next_check_at!;
    };
    const lease = at(900_000);
    expect(await storeB.claimAccount(await nextCheck(), lease)).toBe(true);

    // The user's own get-ready write runs the trigger under RLS and replaces the lease with now.
    const { error } = await callerB.client.from("travel_settings").update({ preparation_minutes: 25, habits_updated_at: new Date().toISOString() }).eq("user_id", userB);
    expect(error).toBeNull();
    const moved = await nextCheck();
    expect(Date.parse(moved)).toBeLessThan(Date.parse(lease));

    // An overlapping visit takes the account and sets a later next check.
    const overlapLease = at(900_000);
    expect(await storeB.claimAccount(moved, overlapLease)).toBe(true);
    expect(await storeB.releaseAccount(overlapLease, at(1_200_000))).toBe(true);

    // The first visit's release misses its lease but brings the next check forward.
    const earlier = at(360_000);
    expect(await storeB.releaseAccount(lease, earlier)).toBe(false);
    expect(Date.parse(await nextCheck())).toBe(Date.parse(earlier));
    // It never moves the next check later.
    expect(await storeB.releaseAccount(lease, at(1_500_000))).toBe(false);
    expect(Date.parse(await nextCheck())).toBe(Date.parse(earlier));
  });

  function callerFor(userId: string): LeaveReminderCaller {
    return createLeaveReminderCaller(userId, { now: new Date(), signingKey: key, runtimeConfig: { url: localUrl!, publishableKey: localPublishableKey! } });
  }

  async function createUser(email: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({ email, password: `Leave-${randomUUID()}`, email_confirm: true });
    if (error || !data.user) throw new Error("Unable to create local test user.");
    return data.user.id;
  }
});
