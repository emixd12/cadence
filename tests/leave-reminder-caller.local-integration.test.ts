import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../lib/db/database.types";
import { selectDueLeaveReminderAccounts } from "../lib/db/leave-reminders.repo";
import { reserveTravelProviderSpend } from "../lib/db/travelSpend.repo";
import {
  createLeaveReminderCaller,
  leaveReminderCalendarCaller,
  LeaveReminderCallerError,
  type LeaveReminderCaller,
} from "../lib/integrations/leave-reminder-caller";
import {
  parseIntegrationSigningKey,
  type IntegrationSigningKey,
} from "../lib/supabase/integration-token";

// Opt-in, Ticket 276. Same isolated local project and variables as
// tests/integration-request-context.local-integration.test.ts (see
// docs/SUPABASE_WORKFLOW.md "Integration request tokens"). Refuses
// non-loopback URLs. The service-role client creates and deletes the test
// users and runs the due-account selection, the one read the job makes on the
// service role. Every other read and write goes through the minted caller.
const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localSigningKey = process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY;
const enabled = Boolean(localUrl && localServiceKey && localPublishableKey && localSigningKey);
const localDescribe = enabled ? describe : describe.skip;

type AdminClient = SupabaseClient<Database>;
const TRIP_A = "a".repeat(64);
const TRIP_B = "b".repeat(64);

localDescribe("leave reminder caller against local Supabase RLS", () => {
  let admin: AdminClient;
  let signingKey: IntegrationSigningKey;
  let userA: string;
  let userB: string;
  let callerA: LeaveReminderCaller;
  let callerB: LeaveReminderCaller;
  let reminderB: string;
  const createdUserIds: string[] = [];
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error("The leave reminder RLS test only runs against loopback Supabase.");
    }
    signingKey = parseIntegrationSigningKey(localSigningKey!);
    admin = createClient<Database>(localUrl!, localServiceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    userA = await createUser(admin, `leave-a-${runId}@example.test`);
    createdUserIds.push(userA);
    userB = await createUser(admin, `leave-b-${runId}@example.test`);
    createdUserIds.push(userB);
    callerA = callerFor(userA, signingKey);
    callerB = callerFor(userB, signingKey);

    // A turns leave reminders on; B saves them off, then on for its own row, then off.
    await expectOk(callerA.client.from("travel_leave_reminder_settings").insert({ user_id: userA, enabled: true }));
    await expectOk(callerA.client.from("travel_leave_reminders").insert({
      user_id: userA, trip_digest: TRIP_A, local_date: "2026-11-06", next_check_at: "2026-11-06T14:00:00Z",
    }));
    await expectOk(callerB.client.from("travel_leave_reminder_settings").insert({ user_id: userB, enabled: true }));
    const inserted = await callerB.client.from("travel_leave_reminders").insert({
      user_id: userB, trip_digest: TRIP_B, local_date: "2026-11-06", next_check_at: "2026-11-06T14:00:00Z",
    }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error("Unable to add B's reminder.");
    reminderB = inserted.data.id;
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin?.auth.admin.deleteUser(id);
  });

  it("reads only its own account's rows", async () => {
    const client = callerA.client;
    const profiles = await client.from("profiles").select("id");
    const settings = await client.from("travel_leave_reminder_settings").select("user_id");
    const reminders = await client.from("travel_leave_reminders").select("user_id, trip_digest");

    expect(profiles.error).toBeNull();
    expect(profiles.data).toEqual([{ id: userA }]);
    expect(settings.data).toEqual([{ user_id: userA }]);
    expect(reminders.data).toEqual([{ user_id: userA, trip_digest: TRIP_A }]);
  });

  it("cannot read or write another account's rows", async () => {
    const client = callerA.client;
    const byId = await client.from("travel_leave_reminders").select("id").eq("id", reminderB);
    const settings = await client.from("travel_leave_reminder_settings").select("user_id").eq("user_id", userB);
    const update = await client.from("travel_leave_reminders").update({ status: "cancelled", next_check_at: null }).eq("id", reminderB).select("id");
    const remove = await client.from("travel_leave_reminders").delete().eq("id", reminderB).select("id");
    const insert = await client.from("travel_leave_reminders").insert({
      user_id: userB, trip_digest: "c".repeat(64), local_date: "2026-11-06", next_check_at: "2026-11-06T14:00:00Z",
    }).select("id");
    const settingsUpdate = await client.from("travel_leave_reminder_settings").update({ enabled: false }).eq("user_id", userB).select("user_id");

    expect(byId.data).toEqual([]);
    expect(settings.data).toEqual([]);
    expect(update.data ?? []).toEqual([]);
    expect(remove.data ?? []).toEqual([]);
    expect(insert.error).not.toBeNull();
    expect(settingsUpdate.data ?? []).toEqual([]);

    const ownerView = await callerB.client.from("travel_leave_reminders").select("status").eq("id", reminderB).single();
    expect(ownerView.data?.status).toBe("pending");
  });

  it("reserves travel spend as its own user", async () => {
    const before = { a: await monthSpend(callerA, userA), b: await monthSpend(callerB, userB) };
    const decision = await reserveTravelProviderSpend(callerA.client, 5_000);
    const after = { a: await monthSpend(callerA, userA), b: await monthSpend(callerB, userB) };

    expect(decision.allowed).toBe(true);
    expect(after.a - before.a).toBe(5_000);
    expect(after.b).toBe(before.b);
    const crossRead = await callerA.client.from("travel_spend_owner_month").select("user_id").eq("user_id", userB);
    expect(crossRead.data).toEqual([]);
  });

  it("is not an MCP grant", async () => {
    const result = await callerA.client.rpc("integration_record_activity", {
      p_operation: "cadence.read", p_target_ids: [], p_outcome: "ok", p_error_code: null as never,
    });
    expect(result.error?.message).toBe("integration_grant_required");
  });

  it("fails closed for Calendar when the account has no Google identity", async () => {
    // Test users have an email identity only. The Google-identity case runs in
    // tests/sql/ticket-276-leave-reminder-identity-smoke.sql.
    await expect(leaveReminderCalendarCaller(callerA)).rejects.toBeInstanceOf(LeaveReminderCallerError);
  });

  it("is refused once its token expires", async () => {
    const expired = createLeaveReminderCaller(userA, {
      now: new Date(Date.now() - 10 * 60 * 1000),
      signingKey,
      runtimeConfig: { url: localUrl!, publishableKey: localPublishableKey! },
      fetch,
    });
    const result = await expired.client.from("profiles").select("id");
    expect(result.error).not.toBeNull();
    expect(result.data).toBeNull();
  });

  it("selects due accounts on the service role from ids and next check times only", async () => {
    await expectOk(callerB.client.from("travel_leave_reminder_settings").update({ enabled: false }).eq("user_id", userB));
    const due = await selectDueLeaveReminderAccounts(admin as never, { dueBy: new Date(Date.now() + 60_000), limit: 100 });
    const extra = await admin.from("travel_leave_reminder_settings").select("enabled_at").limit(1);
    const reminders = await admin.from("travel_leave_reminders").select("id").limit(1);

    expect(due.some((account) => account.userId === userA)).toBe(true);
    expect(due.some((account) => account.userId === userB)).toBe(false);
    expect(extra.error).not.toBeNull();
    expect(reminders.error).not.toBeNull();
  });
});

function callerFor(userId: string, key: IntegrationSigningKey): LeaveReminderCaller {
  return createLeaveReminderCaller(userId, {
    now: new Date(),
    signingKey: key,
    runtimeConfig: { url: localUrl!, publishableKey: localPublishableKey! },
  });
}

async function monthSpend(caller: LeaveReminderCaller, userId: string): Promise<number> {
  const { data, error } = await caller.client.from("travel_spend_owner_month").select("user_id, reserved_microdollars");
  if (error) throw error;
  expect((data ?? []).every((row) => row.user_id === userId)).toBe(true);
  return (data ?? []).reduce((sum, row) => sum + row.reserved_microdollars, 0);
}

async function expectOk(request: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await request;
  if (error) throw new Error("Local setup write failed.");
}

async function createUser(admin: AdminClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Leave-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Unable to create local test user: ${error?.message}`);
  return data.user.id;
}
