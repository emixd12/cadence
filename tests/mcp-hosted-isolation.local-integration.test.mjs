import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Temporal } from "@js-temporal/polyfill";
import { expect, it } from "vitest";
import { createBehavior, setBehaviorActive } from "../packages/core/src/services/behavior.service.ts";
import { createBehaviorStore } from "../lib/db/behavior-store.ts";
import { PROJECT, runHostedIsolation } from "../scripts/mcp-hosted-isolation.mjs";

// This separate harness alone redirects the injected transport. The hosted CLI stays pinned.
const enabled = process.env.CADENCE_MCP_HOSTED_ISOLATION_LOCAL === "1";
it.skipIf(!enabled)("exercises the hosted procedure with real grants in the isolated local project", async () => {
  expect(process.versions.node.split(".")[0]).toBe("24");
  const origin = process.env.CADENCE_LOCAL_SUPABASE_URL;
  expect(origin).toBe("http://127.0.0.1:56121");
  const publishableKey = process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(origin, process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY, options);
  const users = [], fixtures = {}, clients = [];
  const now = new Date();
  const date = Temporal.Now.plainDateISO("America/New_York").subtract({ days: 1 }).toString();
  try {
    for (const slot of ["a", "b"]) {
      const email = `mcp-isolation-${randomUUID()}@example.invalid`, password = `Qa-${randomUUID()}-aA1!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      expect(created.error).toBeNull();
      const user = created.data.user.id;
      users.push(user);
      const client = createClient(origin, publishableKey, options);
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
      clients.push(client);
      const category = await client.from("categories").insert({ user_id: user, name: "Review examples" }).select("id").single();
      expect(category.error).toBeNull();
      const fixture = fixtures[slot] = { category: category.data.id };
      const store = createBehaviorStore(client, user);
      for (const [field, title] of [["walk", "Review walk"], ["reading", "Review reading"], ["stretch", "Review stretch"]]) {
        const behavior = await createBehavior(store, { userId: user, timezone: "America/New_York", recordedAt: now.toISOString(), values: {
          title, description: null, categoryId: fixture.category,
          recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: "09:00",
          browserReminderEnabled: false, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
          schedules: [{ id: null, recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
            timeEntries: [{ id: null, kind: "exact", preset: null, startTime: "09:00", endTime: null, sortOrder: 0 }] }],
        } });
        fixture[field] = behavior.id;
        if (field === "stretch") await setBehaviorActive(store, { behaviorId: behavior.id, active: false,
          recordedAt: now.toISOString(), newArchiveNoteId: randomUUID() });
      }
      const occurrence = await client.from("occurrences").insert({ user_id: user, behavior_id: fixture.walk,
        scheduled_for: `${date}T13:00:00Z`, local_date: date, schedule_kind: "exact", schedule_start_time: "09:00:00",
        status: "unresolved", note: "Review sample note" }).select("id").single();
      expect(occurrence.error).toBeNull();
      fixture.occurrence = occurrence.data.id;
    }
    // A real blanket table denial reproduces why the old own-write test was invalid.
    const forbidden = await clients[0].from("behaviors").update({ title: "Review walk" }).eq("id", fixtures.a.walk).select("id");
    expect(forbidden.status).toBe(403);
    const snapshots = async () => Promise.all(clients.map(async (client, index) => {
      const row = await client.from("behaviors").select("*,schedules:behavior_schedules!behavior_schedules_behavior_owner_fkey(*,slots:behavior_schedule_slots!behavior_schedule_slots_schedule_owner_fkey(*))")
        .in("id", [fixtures[index ? "b" : "a"].walk, fixtures[index ? "b" : "a"].reading, fixtures[index ? "b" : "a"].stretch]).order("id");
      expect(row.error).toBeNull();
      return row.data;
    }));
    const before = await snapshots(), rpcResults = [];
    const fetcher = async (url, init) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe(`https://${PROJECT}.supabase.co`);
      const response = await fetch(`${origin}${parsed.pathname}${parsed.search}`, init);
      if (parsed.pathname.startsWith("/rest/v1/rpc/")) {
        expect(parsed.pathname).toBe("/rest/v1/rpc/update_behavior_with_schedule_graph");
        const value = await response.clone().json();
        rpcResults.push({ status: response.status, id: value?.id ?? null });
      }
      return response;
    };
    const result = await runHostedIsolation(["--allow-hosted-project", PROJECT, "--qa-a", users[0], "--qa-b", users[1],
      "--fixtures", "local-only.json"], { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      CADENCE_INTEGRATION_JWT_SIGNING_KEY: process.env.CADENCE_LOCAL_INTEGRATION_SIGNING_KEY }, fixtures, fetcher, now);
    expect(result.result).toBe("passed");
    expect(rpcResults).toEqual([
      ...Array.from({ length: 3 }, () => ({ status: 200, id: null })),
      ...[fixtures.a.walk, fixtures.a.reading, fixtures.a.stretch].map((id) => ({ status: 200, id })),
    ]);
    const after = await snapshots();
    expect(after[1]).toEqual(before[1]);
    // Same-value atomic writes change timestamps, but must preserve the entire graph.
    const content = (rows) => JSON.parse(JSON.stringify(rows, (key, value) => key === "updated_at" ? undefined : value));
    expect(content(after[0])).toEqual(content(before[0]));
  } finally {
    for (const id of users) expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
  }
}, 60_000);
