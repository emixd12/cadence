import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = resolve(process.cwd(), "supabase/migrations/20260922013000_add_travel_route_quota.sql");

describe("travel route quota migration", () => {
  it("uses one atomic owner and global admission function without location fields", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("create table public.travel_route_owner_quota");
    expect(sql).toContain("create table public.travel_route_global_quota");
    expect(sql).toContain("create or replace function public.consume_travel_route_quota()");
    expect(sql).toContain("owner_limit constant integer := 6");
    expect(sql).toContain("global_limit constant integer := 100");
    expect(sql).toContain("initial_budget_refreshes constant integer := 40");
    expect(sql.indexOf("pg_advisory_xact_lock")).toBeLessThan(sql.indexOf("select coalesce(sum(attempt_count)"));
    expect(sql.indexOf("select coalesce(sum(attempt_count)")).toBeLessThan(sql.indexOf("insert into public.travel_route_owner_quota as quota"));
    expect(sql).not.toMatch(/latitude|longitude|place_id|address|route_response/i);
  });
});

const admissions = resolve(process.cwd(), "supabase/migrations/20260922200000_travel_route_quota_admissions.sql");

// Text-only: this suite cannot execute SQL. tests/sql/ticket-165-travel-budget-smoke.sql executes the
// 24th-allowed / 25th-rejected / unchanged-count behavior against a local database.
describe("travel route quota admissions migration", () => {
  it("allows 24 owner admissions and rejects without incrementing", async () => {
    const sql = await readFile(admissions, "utf8");
    expect(sql).toContain("create or replace function public.consume_travel_route_quota()");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("owner_limit constant integer := 24");
    expect(sql).toContain("global_limit constant integer := 100");
    expect(sql).toContain("initial_budget_refreshes constant integer := 40");
    expect(sql).toContain("if coalesce(owner_attempt_count, 0) >= owner_limit then");
    expect(sql).toContain("if coalesce(global_attempt_count, 0) >= global_limit then");
    const firstInsert = sql.indexOf("insert into public.travel_route_owner_quota");
    expect(sql.indexOf("pg_advisory_xact_lock")).toBeLessThan(sql.indexOf("select coalesce(sum(attempt_count)"));
    expect(sql.indexOf("owner_attempt_count, 0) >= owner_limit")).toBeLessThan(firstInsert);
    expect(sql.indexOf("global_attempt_count, 0) >= global_limit")).toBeLessThan(firstInsert);
    expect(sql.lastIndexOf("return query select false")).toBeLessThan(firstInsert);
    expect(sql).toContain("grant execute on function public.consume_travel_route_quota() to authenticated");
    expect(sql).toContain("revoke all on function public.consume_travel_route_quota() from anon");
    expect(sql).not.toMatch(/latitude|longitude|place_id|address|route_response/i);
  });
});

const monthlyBudget = resolve(process.cwd(), "supabase/migrations/20261017150000_travel_monthly_budget.sql");

// Text-only: tests/sql/ticket-213-travel-monthly-budget-smoke.sql executes the ceiling, refusal and renewal behavior.
describe("travel monthly budget migration (Ticket 213)", () => {
  it("reserves list-price spend under a US$5 owner-month ceiling and a daily circuit breaker", async () => {
    const sql = await readFile(monthlyBudget, "utf8");
    expect(sql).toContain("create or replace function public.reserve_travel_provider_spend(requested_microdollars integer)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("owner_month_ceiling constant bigint := 5000000");
    expect(sql).toContain("global_day_ceiling constant bigint := 10000000");
    expect(sql).toContain("date_trunc('month', observed_at at time zone actor_timezone)::date");
    // Both rows are locked, owner first, before any decision; refusals return before any increment.
    const ownerLock = sql.indexOf("from public.travel_spend_owner_month as spend\n  where spend.user_id = actor_id and spend.local_month = owner_month\n  for update");
    const globalLock = sql.indexOf("from public.travel_spend_global_day as spend\n  where spend.utc_date = utc_day\n  for update");
    const firstIncrement = sql.indexOf("set reserved_microdollars = spend.reserved_microdollars + requested_microdollars");
    expect(ownerLock).toBeGreaterThan(0);
    expect(ownerLock).toBeLessThan(globalLock);
    expect(globalLock).toBeLessThan(sql.indexOf("if owner_reserved + requested_microdollars > owner_month_ceiling then"));
    expect(sql.lastIndexOf("return query select false")).toBeLessThan(firstIncrement);
    expect(sql).toContain("grant execute on function public.reserve_travel_provider_spend(integer) to authenticated");
    expect(sql).toContain("revoke all on function public.reserve_travel_provider_spend(integer) from anon");
    expect(sql).toContain("revoke all on table public.travel_spend_global_day from public, anon, authenticated");
    expect(sql).not.toMatch(/latitude|longitude|place_id|address|route_response/i);
  });
});

const placeCache = resolve(process.cwd(), "supabase/migrations/20261017150100_travel_place_cache.sql");

describe("travel place cache migration (Ticket 214)", () => {
  it("stores only owner-scoped text hashes and place IDs and clears them when travel turns off", async () => {
    const sql = await readFile(placeCache, "utf8");
    expect(sql).toContain("create table public.travel_place_cache");
    expect(sql).toContain("text_key text not null check (text_key ~ '^[A-Za-z0-9_-]{43}$')");
    expect(sql).toContain("alter table public.travel_place_cache enable row level security");
    for (const action of ["select", "insert", "update", "delete"]) expect(sql).toContain(`for ${action} to authenticated`);
    expect(sql).toContain("revoke all on table public.travel_place_cache from public, anon, authenticated");
    expect(sql).toContain("if old.enabled and not new.enabled then");
    expect(sql).toContain("after update of enabled on public.travel_settings");
    expect(sql).not.toMatch(/latitude|longitude|location_text|address/i);
  });
});
