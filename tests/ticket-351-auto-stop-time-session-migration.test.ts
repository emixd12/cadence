import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261123183000_auto_stop_time_session_on_completed.sql",
  ),
  "utf8",
);
const normalizedSql = migrationSql.replace(/\s+/g, " ");

describe("Ticket 351 auto-stop running time session on Completed migration", () => {
  it("preserves the 12-argument status transition signature, security invoker, and P0001 contention errors", () => {
    expect(migrationSql).toContain(
      "create or replace function public.apply_occurrence_status_transition(",
    );
    expect(migrationSql).toContain("security invoker");
    expect(migrationSql).toContain("set search_path = ''");
    expect(migrationSql).toContain(
      "planned_event_source_capture_method not in ('manual_tap', 'manual_text')",
    );
    expect(migrationSql.match(/using errcode = 'P0001';/g)).toHaveLength(2);
    expect(migrationSql).not.toContain("using errcode = '40001';");
  });

  it("stops a running time session atomically only on changed transitions to completed", () => {
    expect(normalizedSql).toContain(
      "if planned_status = 'completed' then update public.occurrence_time_sessions as time_session set stopped_at = greatest(time_session.started_at, planned_status_marked_at) where time_session.user_id = current_user_id and time_session.occurrence_id = updated_occurrence.id and time_session.stopped_at is null; end if;",
    );
    const unchangedReturnIndex = migrationSql.indexOf(
      "'status_changed', false,\n      'concurrent_duplicate', false,",
    );
    const stopUpdateIndex = migrationSql.indexOf(
      "update public.occurrence_time_sessions as time_session",
    );
    expect(unchangedReturnIndex).toBeGreaterThan(-1);
    expect(stopUpdateIndex).toBeGreaterThan(unchangedReturnIndex);
  });

  it("does not retroactively backfill existing completed occurrences", () => {
    expect(
      migrationSql.match(/update public\.occurrence_time_sessions/g),
    ).toHaveLength(1);
  });
});
