import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { purgeExpiredOAuthRecords } from "@/lib/db/oauth.repo";
import { runOAuthMaintenance } from "@/lib/services/oauth-maintenance.service";
import { createServiceRoleClient } from "@/lib/supabase/admin";

const localIt = process.env.CADENCE_OAUTH_MAINTENANCE_LOCAL === "1" ? it : it.skip;
const container = "supabase_db_cadence-mcp-232";
const args = ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"];
function sql(query: string) {
  return execFileSync("docker", args, { input: query, encoding: "utf8" }).trim();
}
function assertTarget() {
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:56121");
  expect(sql("select count(*) from supabase_migrations.schema_migrations;")).toBe("85");
  expect(sql("select count(*) from auth.users;")).toBe("0");
}
function activePurge() {
  return Number(sql("select count(*) from pg_stat_activity where usename='authenticator' and state='active' and query like '%oauth_purge_expired%';"));
}
async function holdPurgeLock() {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "exit");
  const ready = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (data) => { if (String(data).includes("lock-ready")) resolve(); });
    child.stderr.on("data", () => reject(new Error("Local fixture failed")));
  });
  child.stdin.write("begin; lock table cadence_oauth_private.authorization_codes in access exclusive mode; select 'lock-ready';\n");
  try { await ready; } catch (error) { child.stdin.end("rollback;\n"); await exited; throw error; }
  return async () => { child.stdin.end("rollback;\n"); await exited; };
}
afterEach(() => vi.restoreAllMocks());

localIt("runs the maintenance service against the assigned empty isolated stack", async () => {
  assertTarget();
  vi.spyOn(console, "info").mockImplementation(() => {});
  await runOAuthMaintenance();
  expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toMatchObject({
    name: "oauth_maintenance_completed", context: {
      codes_deleted: 0, access_deleted: 0, families_deleted: 0, clients_deleted: 0,
      retries_deleted: 0, activity_deleted: 0, counters_deleted: 0,
    },
  });
});

localIt("settles locked maintenance within its deadline and observes backend termination", async () => {
  assertTarget();
  const release = await holdPurgeLock();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const started = performance.now();
    const maintenance = runOAuthMaintenance();
    await vi.waitFor(() => expect(activePurge()).toBe(1), { timeout: 3000 });
    await maintenance;
    expect(performance.now() - started).toBeLessThan(10000);
    expect(console.info).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0]).context).toEqual({ outcome: "unknown" });
    await vi.waitFor(() => expect(activePurge()).toBe(0), { timeout: 3000 });
  } finally { await release(); }
}, 15000);

localIt("does not mistake HTTP abort for database cancellation; existing SQL timeout bounds the backend", async () => {
  assertTarget();
  expect(sql("select rolconfig::text from pg_roles where rolname='authenticator';")).toContain("statement_timeout=8s");
  const release = await holdPurgeLock();
  const controller = new AbortController();
  try {
    const pending = purgeExpiredOAuthRecords(createServiceRoleClient(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "database_error" });
    await vi.waitFor(() => expect(activePurge()).toBe(1), { timeout: 3000 });
    const started = performance.now();
    controller.abort();
    await rejected;
    expect(performance.now() - started).toBeLessThan(1000);
    // Local PostgREST continues the SQL statement after the HTTP client leaves.
    expect(activePurge()).toBe(1);
    await vi.waitFor(() => expect(activePurge()).toBe(0), { timeout: 10000 });
  } finally { controller.abort(); await release(); }
}, 15000);
