import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BehaviorInput } from "@cadence/core/behavior-store";
import { createBehavior, updateBehavior } from "@cadence/core/services/behavior.service";
import { createBehaviorStore } from "@/lib/db/behavior-store";
import { listBehaviorConfigurationEvents } from "@/lib/db/behaviorConfigurationEvents.repo";
import type { Database } from "@/lib/db/database.types";

// Ticket 215 opt-in check of the hosted Where columns, graph writers, history and
// account-sync read against a loopback Supabase. It creates and deletes one user.
const localUrl = process.env.CADENCE_LOCAL_SUPABASE_URL;
const localServiceKey = process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY;
const localPublishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
const localDescribe = localUrl && localServiceKey && localPublishableKey ? describe : describe.skip;

const VALUES: BehaviorInput = {
  title: "Where contract", description: null, categoryId: null,
  recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: "09:00",
  schedules: [{ recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
    timeEntries: [{ kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }] }],
  browserReminderEnabled: true, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
};

localDescribe("Behavior Where against local Supabase", () => {
  let admin: SupabaseClient<Database>;
  let client: SupabaseClient<Database>;
  let userId = "";

  beforeAll(async () => {
    const host = new URL(localUrl!).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error("The Where check only runs against loopback Supabase.");
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    admin = createClient<Database>(localUrl!, localServiceKey!, options);
    const email = `behavior-where-${randomUUID().slice(0, 8)}@example.test`;
    const password = `Where-${randomUUID()}-aA1!`;
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

  it("stores Where through the graph writers, history and account sync read", async () => {
    const at = (seconds: number) => new Date(Date.parse("2026-10-19T12:00:00Z") + seconds * 1000).toISOString();
    const store = createBehaviorStore(client, userId);
    const home = await createBehavior(store, { userId, timezone: "America/New_York", recordedAt: at(0), values: { ...VALUES, whereKind: "home" } });
    expect(home).toMatchObject({ where_kind: "home", location_text: null });
    const place = await updateBehavior(store, { behaviorId: home.id, expectedUpdatedAt: home.updated_at, recordedAt: at(1),
      values: { ...VALUES, whereKind: "place", locationText: "1 Example Street" } });
    expect(place).toMatchObject({ where_kind: "place", location_text: "1 Example Street" });
    // MCP input carries only location text; clearing A place means Not set.
    const cleared = await updateBehavior(store, { behaviorId: home.id, expectedUpdatedAt: place.updated_at, recordedAt: at(2),
      values: { ...VALUES, locationText: null } });
    expect(cleared).toMatchObject({ where_kind: null, location_text: null });

    const events = (await listBehaviorConfigurationEvents(client, userId))
      .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at));
    expect(events.map((event) => [(event.next_configuration as { where_kind?: unknown }).where_kind, event.changed_fields])).toEqual([
      ["home", ["category_id", "location_text", "where_kind", "schedule_graph", "browser_reminder_enabled", "email_reminder_enabled", "reminder_offset_minutes", "active", "timezone"]],
      ["place", ["location_text", "where_kind"]],
      [null, ["location_text", "where_kind"]],
    ]);

    const snapshot = await client.rpc("read_account_sync_snapshot");
    expect(snapshot.error).toBeNull();
    const rows = JSON.stringify(snapshot.data);
    expect(rows).toContain('"where_kind":null');

    // The table rule holds even for privileged writes.
    const invalid = await admin.from("behaviors").update({ where_kind: "home", location_text: "1 Example Street" }).eq("id", home.id);
    expect(invalid.error?.code).toBe("23514");
    const unknown = await admin.from("behaviors").update({ where_kind: "office" }).eq("id", home.id);
    expect(unknown.error?.code).toBe("23514");
  });
});
