import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(
  new URL("../supabase/migrations/20260926150000_daily_brief_bounded_recovery.sql", import.meta.url),
  "utf8",
);

describe("Daily Brief bounded recovery migration", () => {
  it("adds a content-free, bounded admission count", () => {
    expect(migration).toMatch(/^begin;/);
    expect(migration.trim()).toMatch(/commit;$/);
    expect(migration).toContain("add column admissions smallint not null default 1");
    expect(migration).toContain("check (admissions between 1 and 4)");
    expect(migration).not.toMatch(/prompt_(text|content)|generated_(text|content)|output_content/i);
  });

  it("lets deliberate retries replace completed attempts without clearing quota or pending leases", () => {
    const body = migration.slice(migration.indexOf("create or replace function cadence_advisor_private.begin_daily_brief"));
    expect(body).toContain("security definer");
    expect(body).not.toMatch(/if existing\.status = 'completed' then\s+return jsonb_build_object\('state', 'already_attempted'\)/);
    const pending = body.indexOf("existing.status = 'pending' and existing.lease_expires_at > observed_at");
    const automatic = body.indexOf("if not p_retry then");
    const exhausted = body.indexOf("if existing.admissions >= 4 then");
    const rateLimit = body.indexOf("cardinality(recent_starts) >= 6");
    expect(pending).toBeGreaterThan(0);
    expect(automatic).toBeGreaterThan(pending);
    expect(exhausted).toBeGreaterThan(automatic);
    expect(rateLimit).toBeGreaterThan(exhausted);
    expect(body).toContain("'state', 'retry_exhausted'");
    expect(body).toContain("case when same_attempt_day then existing.admissions + 1 else 1 end");
    expect(body).not.toMatch(/delete from cadence_advisor_private\.daily_brief_rate_limits/);
  });
});
