import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { buildCleanupSql, TABLES } from "../scripts/mcp-fixture-cleanup.mjs";
import { createBehavior } from "../packages/core/src/services/behavior.service.ts";
import { createBehaviorStore } from "../lib/db/behavior-store.ts";

// Opt-in: runs the reviewed archive transaction against a disposable, migrated
// local stack. Acceptance runners create uncategorized "Review practice <label>"
// Behaviors that captureCreations() adds to the manifest.
const enabled = process.env.CADENCE_ACCEPT_CLEANUP_LOCAL === "1";
const container = process.env.CADENCE_LOCAL_DB_CONTAINER;

const schedule = (time) => ({
  recurrenceRule: { frequency: "daily", interval: 1 }, scheduledTime: time,
  browserReminderEnabled: false, emailReminderEnabled: false, reminderOffsetMinutes: 0, active: true,
  schedules: [{ id: null, recurrenceRule: { frequency: "daily", interval: 1 }, sortOrder: 0,
    timeEntries: [{ id: null, kind: "exact", preset: null, startTime: time, endTime: null, sortOrder: 0 }] }],
});

it.skipIf(!enabled)("archives checkpointed client Behaviors and still refuses unrelated uncategorized rows", async () => {
  expect(process.versions.node.split(".")[0]).toBe("24");
  expect(container).toMatch(/^supabase_db_cadence-accept-[a-z0-9-]+$/);
  const origin = process.env.CADENCE_LOCAL_SUPABASE_URL;
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const adminAuth = createClient(origin, process.env.CADENCE_LOCAL_SUPABASE_SERVICE_KEY, options).auth.admin;
  const now = new Date();
  const users = [], clients = [], ids = {};
  for (const slot of ["a", "b"]) {
    const email = `accept-cleanup-${randomUUID()}@example.invalid`, password = `Qa-${randomUUID()}-aA1!`;
    const created = await adminAuth.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const user = created.data.user.id;
    users.push(user);
    const client = createClient(origin, process.env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY, options);
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    clients.push(client);
    const category = await client.from("categories").insert({ user_id: user, name: "Review examples" }).select("id").single();
    expect(category.error).toBeNull();
    const store = createBehaviorStore(client, user);
    const make = async (title, categoryId, time) => (await createBehavior(store, { userId: user, timezone: "America/New_York",
      recordedAt: now.toISOString(), values: { title, description: null, categoryId, ...schedule(time) } })).id;
    ids[slot] = {
      category: category.data.id,
      walk: await make("Review walk", category.data.id, "09:00"),
      client: await make(slot === "a" ? "Review practice t174-a" : "Review practice t174-b edited", null, "18:00"),
      unrelated: await make("Unrelated title", null, "10:00"),
      preserved: await make("Preserved baseline", null, "11:00"),
    };
  }
  const readOwned = async (table, column, values) => {
    const rows = [];
    for (const [index, client] of clients.entries()) {
      const result = await client.from(table).select("id,user_id,created_at").eq("user_id", users[index]).in(column, values).order("id");
      expect(result.error).toBeNull();
      rows.push(...result.data);
    }
    return rows;
  };
  const manifestFor = async (behaviorIds) => {
    const runId = randomUUID(), rows = [];
    for (const table of TABLES) {
      const found = table === "categories" ? await readOwned(table, "id", Object.values(ids).map((r) => r.category))
        : await readOwned(table, table === "behaviors" ? "id" : "behavior_id", behaviorIds);
      rows.push(...found.map((row) => ({ ...row, table, run_id: runId })));
    }
    return { version: 1, project: "qjodzutjxtmtzczbloxa", users, runId, startedAt: new Date(now.getTime() - 1000).toISOString(),
      capturedAt: new Date().toISOString(), rows,
      counts: Object.fromEntries(TABLES.map((table) => [table, rows.filter((row) => row.table === table).length])) };
  };
  let lastSqlState;
  const execute = (sql) => {
    const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate",
      "-v", "SHOW_CONTEXT=never", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8", timeout: 15000, maxBuffer: 32768 });
    lastSqlState = result.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1];
    return result.status === 0;
  };
  const states = async () => {
    const all = Object.values(ids).flatMap((r) => [r.walk, r.client, r.unrelated, r.preserved]);
    const rows = [];
    for (const [index, client] of clients.entries()) {
      const result = await client.from("behaviors").select("id,active,archived_at").eq("user_id", users[index]).in("id", all).order("id");
      expect(result.error).toBeNull();
      rows.push(...result.data);
    }
    return Object.fromEntries(rows.map((r) => [r.id, r.active && r.archived_at === null]));
  };
  const before = await states();
  expect(Object.values(before).every(Boolean)).toBe(true);

  // An uncategorized Behavior without the runners' title stays refused.
  const withUnrelated = await manifestFor(Object.values(ids).flatMap((r) => [r.walk, r.client, r.unrelated]));
  expect(execute(buildCleanupSql(withUnrelated, users))).toBe(false);
  expect(lastSqlState).toBe("P0001");
  expect(await states()).toEqual(before);

  // Fixture Behaviors plus checkpointed client creations archive together.
  const captured = await manifestFor(Object.values(ids).flatMap((r) => [r.walk, r.client]));
  expect(execute(buildCleanupSql(captured, users))).toBe(true);
  const after = await states();
  for (const r of Object.values(ids)) {
    expect(after[r.walk]).toBe(false);
    expect(after[r.client]).toBe(false);
    expect(after[r.unrelated]).toBe(true);
    expect(after[r.preserved]).toBe(true);
  }
}, 120_000);
