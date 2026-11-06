import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = resolve(process.cwd(), "supabase/migrations/20261106040000_travel_leave_reminders.sql");
const syncMigration = resolve(process.cwd(), "supabase/migrations/20261027120000_account_sync_contracts.sql");

// Text-only: this suite cannot execute SQL. tests/sql/ticket-275-leave-reminders-smoke.sql runs
// off-by-default, turning off, the three-route cap and one update (D15), final rows, owner
// isolation, the service-role column limit and account deletion against a local database.
describe("leave reminder migration (Ticket 275)", () => {
  it("adds owner-scoped hosted tables that hold no title, place, position or duration", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table public.travel_leave_reminder_settings");
    expect(sql).toContain("create table public.travel_leave_reminders");
    expect(sql).toContain("enabled boolean not null default false");
    expect(sql).toContain("trip_digest text not null check (trip_digest ~ '^[a-f0-9]{64}$')");
    expect(sql).toContain("constraint travel_leave_reminders_one_per_trip unique (user_id, trip_digest, local_date)");
    expect(sql).toContain("route_count smallint not null default 0 check (route_count between 0 and 3)");
    expect(sql).toContain("check (route_count < 3 or status = 'sent')");
    expect(sql).toContain("update_sent_at timestamptz,");
    expect(sql).toContain("error text check (error ~ '^[a-z][a-z0-9_]{0,63}$')");
    expect(sql.match(/enable row level security/g)).toHaveLength(2);
    expect(sql.match(/using \(\(select auth\.uid\(\)\) = user_id\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("revoke all on table public.travel_leave_reminders from public, anon, authenticated");
    expect(sql).toContain("revoke all on table public.travel_leave_reminders from service_role");
    expect(sql).toContain(
      "grant select (user_id, enabled, next_check_at) on table public.travel_leave_reminder_settings to service_role",
    );
    // The pending guard locks the setting row, so a concurrent switch to off cannot leave a pending row.
    expect(sql).toMatch(/settings\.user_id = new\.user_id and settings\.enabled\s+for share/);
    const code = sql.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/title|location|latitude|longitude|place_id|address|duration|leave_at|arrive/i);
  });

  it("stays out of the synced profile so released Mac builds keep syncing", async () => {
    const sync = await readFile(syncMigration, "utf8");
    expect(sync).not.toContain("leave_reminder");
    const sql = await readFile(migration, "utf8");
    expect(sql).not.toMatch(/account_sync/);
  });
});

describe("get-ready change time (Ticket 277, Wave 4 final check)", () => {
  const prepMigration = resolve(process.cwd(), "supabase/migrations/20261106060000_travel_preparation_changed_at.sql");

  it("stamps the database time on every get-ready change and keeps no client value", async () => {
    const sql = await readFile(prepMigration, "utf8");
    expect(sql).toContain("add column preparation_changed_at timestamptz");
    expect(sql).toContain("new.preparation_minutes is distinct from old.preparation_minutes then\n    new.preparation_changed_at := statement_timestamp();");
    expect(sql).toContain("new.preparation_changed_at := old.preparation_changed_at;");
    expect(sql).toContain("before insert or update on public.travel_settings");
    expect(sql).toContain("revoke all on function cadence_private.stamp_travel_preparation_change() from public, anon, authenticated");
    const code = sql.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/security definer|account_sync|location|latitude|longitude|duration|leave_at/i);
  });

  it("stays out of the synced profile", async () => {
    const sync = await readFile(syncMigration, "utf8");
    expect(sync).not.toContain("preparation_changed_at");
  });
});

describe("planned get-ready time (Ticket 277, Codex review)", () => {
  const plannedMigration = resolve(process.cwd(), "supabase/migrations/20261106070000_leave_reminder_planned_preparation.sql");

  it("keeps only whole get-ready minutes, so a pending check can move without a route", async () => {
    const sql = await readFile(plannedMigration, "utf8");
    expect(sql).toContain("add column planned_preparation_minutes smallint");
    expect(sql).toContain("check (planned_preparation_minutes is null or planned_preparation_minutes between 0 and 60)");
    const code = sql.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/title|location|latitude|longitude|place_id|address|duration|leave_at|arrive|account_sync|grant/i);
  });
});

// tests/sql/ticket-277-visit-after-preparation-change-smoke.sql runs these rules against a local database.
describe("job visit after a get-ready change (decision D19)", () => {
  const visitMigration = resolve(process.cwd(), "supabase/migrations/20261106080000_leave_reminder_visit_after_preparation_change.sql");

  it("moves only an enabled account's later visit to now, and only on a real get-ready change", async () => {
    const sql = await readFile(visitMigration, "utf8");
    expect(sql).toContain("after insert or update of preparation_minutes on public.travel_settings");
    expect(sql).toContain("if tg_op = 'UPDATE' and new.preparation_minutes is not distinct from old.preparation_minutes then\n    return null;");
    expect(sql).toContain("set next_check_at = statement_timestamp()\n  where settings.user_id = new.user_id\n    and settings.enabled\n    and settings.next_check_at > statement_timestamp();");
    expect(sql).toContain("revoke all on function cadence_private.bring_leave_reminder_visit_forward() from public, anon, authenticated");
    const code = sql.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/security definer|grant|travel_leave_reminders\b|route_count|location|latitude|longitude|duration|leave_at/i);
  });
});
