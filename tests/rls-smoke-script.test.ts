import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

type SmokeScriptModule = {
  PUBLIC_DATA_API_RELATIONS: Array<{
    table: string;
    ownerColumn: string;
    selectColumn?: string;
  }>;
  PUBLIC_AUTHENTICATED_FUNCTIONS: string[];
  buildSmokePassword: (runId: string) => string;
  buildSmokeUserEmail: (runId: string, slot: string) => string;
  cleanupTemporaryUsers: (
    admin: {
      auth: {
        admin: {
          deleteUser: (id: string) => Promise<{ error?: unknown } | undefined>;
        };
      };
    },
    users: Array<{ id: string }>,
  ) => Promise<void>;
  readSmokeConfig: (
    env?: Record<string, string | undefined>,
    envFilePath?: string,
  ) => {
    url: string;
    publishableKey: string;
    serviceRoleKey: string;
  };
  parseLocalSmokeConfig: (output: string) => {
    url: string;
    publishableKey: string;
    serviceRoleKey: string;
  };
  summarizeSmokeResult: (result: {
    runId: string;
    createdUsers: number;
    checkedAssertions: number;
  }) => string;
  assertSuccessfulSessionRows: (
    response: {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    },
    expectedIds: string[],
    action: string,
  ) => void;
};

let smokeScript: SmokeScriptModule;

beforeAll(async () => {
  // @ts-expect-error The smoke command is a plain Node ESM script.
  smokeScript = await import("../scripts/supabase-rls-smoke.mjs");
});

describe("Supabase RLS smoke script helpers", () => {
  it("registers every public Data API relation and authenticated function", () => {
    expect(smokeScript.PUBLIC_DATA_API_RELATIONS.map(({ table }) => table)).toEqual([
      "profiles",
      "categories",
      "behaviors",
      "behavior_definition_events",
      "behavior_configuration_events",
      "behavior_schedules",
      "behavior_schedule_slots",
      "occurrences",
      "reminder_deliveries",
      "push_subscriptions",
      "occurrence_status_events",
      "occurrence_sync_state",
      "behaviorlog_import_runs",
      "behaviorlog_import_record_mappings",
      "imported_notes",
      "imported_interventions",
      "launch_rate_limits",
      "occurrence_time_sessions",
      "periods",
    ]);
    expect(smokeScript.PUBLIC_AUTHENTICATED_FUNCTIONS).toHaveLength(16);
    expect(smokeScript.PUBLIC_AUTHENTICATED_FUNCTIONS).toEqual(
      expect.arrayContaining(["create_period", "create_period_if_absent", "update_period", "delete_period"]),
    );
  });

  it("creates behaviors through the history-aware RPC and expects direct updates to fail", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts", "supabase-rls-smoke.mjs"),
      "utf8",
    );

    expect(source).toContain('"create_behavior_with_schedule_graph"');
    expect(source).toContain("configuration_event_plan");
    expect(source).toContain("Authenticated direct behavior update was not denied");
    expect(source).toContain('.from("behavior_configuration_events")');
    expect(source).toContain("configuration_event_insert_denied");
    expect(source).toContain("configuration_event_update_denied");
    expect(source).toContain("configuration_event_delete_denied");
    expect(source).toContain('"apply_occurrence_generation_plan"');
    expect(source).toContain(
      '"mark_occurrence_sync_fresh_if_configuration_current"',
    );
    expect(source).toContain("occurrence_lineage_direct_update_denied");
    expect(source).toContain("occurrence_lineage_cross_owner_fk");
    expect(source).toContain("occurrence_lineage_wrong_behavior_fk");
    expect(source).toContain("occurrence_generation_two_step_lineage");
    expect(source).toContain("occurrence_status_note_lineage_preserved");
    expect(source).toContain("occurrence_restore_snapshot_lineage_cleared");
    expect(source).toContain("occurrence_freshness_stale_plan_rejected");
    expect(source).toContain("occurrence_freshness_state_version_race");
    expect(source).toContain(
      "occurrence_freshness_zero_behavior_state_creation_race",
    );
    expect(source).toContain("profile_timezone_update");
    expect(source).toContain("profile_email_update_denied");
    expect(source).toContain("profile_display_name_update_denied");
    expect(source).toContain("profile_delete_denied");
    expect(source).toContain("profile_insert_denied");
    expect(source).toContain("profile_identity_email_sync");
    expect(source).toContain("reminder_pending_planning");
    expect(source).toContain("reminder_pending_cancellation");
    expect(source).toContain("reminder_cancelled_reactivation");
    expect(source).toContain("reminder_sent_recycle_denied");
    expect(source).toContain("reminder_failed_recycle_denied");
    expect(source).toContain("reminder_processing_claim_clear_denied");
    expect(source).toContain(
      '"update_profile_and_behavior_timezones_with_config_events"',
    );
    expect(source).toContain("settings_timezone_behavior_failure_rollback");
    expect(source).toContain(
      "settings_timezone_profile_behavior_atomic_commit",
    );
    expect(source).toContain("settings_timezone_configuration_event_once");
    expect(source).toContain("settings_timezone_stale_mark_once");
    expect(source).toContain(
      "settings_timezone_stale_profile_precondition",
    );
  });

  it("reads required Supabase config with publishable key preference", () => {
    expect(
      smokeScript.readSmokeConfig(
        {
          NEXT_PUBLIC_SUPABASE_URL: " https://example.supabase.co ",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " publishable ",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: " anon ",
          SUPABASE_SERVICE_ROLE_KEY: " service ",
        },
        "missing-env-file",
      ),
    ).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "publishable",
      serviceRoleKey: "service",
    });
  });

  it("falls back to the legacy anon key name", () => {
    expect(
      smokeScript.readSmokeConfig(
        {
          NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
          SUPABASE_SERVICE_ROLE_KEY: "service",
        },
        "missing-env-file",
      ).publishableKey,
    ).toBe("anon");
  });

  it("parses CLI-reported local config and rejects hosted URLs", () => {
    expect(
      smokeScript.parseLocalSmokeConfig(
        [
          'API_URL="http://127.0.0.1:55321"',
          'PUBLISHABLE_KEY="publishable"',
          'SERVICE_ROLE_KEY="service"',
        ].join("\n"),
      ),
    ).toEqual({
      url: "http://127.0.0.1:55321",
      publishableKey: "publishable",
      serviceRoleKey: "service",
    });

    expect(() =>
      smokeScript.parseLocalSmokeConfig(
        [
          'API_URL="https://project.supabase.co"',
          'PUBLISHABLE_KEY="publishable"',
          'SERVICE_ROLE_KEY="service"',
        ].join("\n"),
      ),
    ).toThrow("loopback API URL");
  });

  it("reports missing config without printing secret values", () => {
    expect(() => smokeScript.readSmokeConfig({}, "missing-env-file")).toThrow(
      "Missing Supabase RLS smoke config",
    );
  });

  it("builds deterministic temporary credentials from a run id", () => {
    expect(smokeScript.buildSmokeUserEmail("abc123", "a")).toBe(
      "cadence-rls-smoke-abc123-a@example.invalid",
    );
    expect(smokeScript.buildSmokePassword("abc123")).toContain("abc123");
  });

  it("summarizes smoke results without user ids or emails", () => {
    const summary = smokeScript.summarizeSmokeResult({
      runId: "abc123",
      createdUsers: 2,
      checkedAssertions: 6,
    });

    expect(summary).toContain("RLS smoke passed");
    expect(summary).toContain("6 ownership checks");
    expect(summary).not.toContain("@");
  });

  it("fails closed unless every temporary user is deleted", async () => {
    const deleted: string[] = [];
    const admin = {
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            deleted.push(id);
            if (id === "user-b") {
              return { error: new Error("provider cleanup failure") };
            }
          },
        },
      },
    };

    await expect(
      smokeScript.cleanupTemporaryUsers(admin, [
        { id: "user-a" },
        { id: "user-b" },
        { id: "user-c" },
      ]),
    ).rejects.toThrow("cleanup failed for 1 temporary users");
    expect(deleted).toEqual(["user-a", "user-b", "user-c"]);
  });

  it("fails closed when an RPC returns a foreign, duplicate, or errored session", () => {
    expect(() =>
      smokeScript.assertSuccessfulSessionRows(
        { data: [{ id: "session-own" }], error: null },
        ["session-own"],
        "own read",
      ),
    ).not.toThrow();

    expect(() =>
      smokeScript.assertSuccessfulSessionRows(
        { data: [{ id: "session-foreign" }], error: null },
        ["session-own"],
        "mixed read",
      ),
    ).toThrow("unexpected time-session scope");

    expect(() =>
      smokeScript.assertSuccessfulSessionRows(
        {
          data: null,
          error: { message: "permission denied" },
        },
        [],
        "owner read",
      ),
    ).toThrow("Unexpected error during owner read");
  });
});
