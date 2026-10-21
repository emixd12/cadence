import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATION_SQL = [
  "20260607204951_create_database_schema.sql",
  "20260609202707_add_behavior_schedule_slots.sql",
  "20260612075036_add_occurrence_status_events.sql",
  "20260612221022_add_behaviorlog_import_tracking.sql",
  "20260618120000_add_imported_notes.sql",
  "20260618220226_add_imported_intervention_history.sql",
  "20260625204148_add_occurrence_sync_state.sql",
  "20260626140000_add_behavior_schedules.sql",
  "20260709201516_add_behavior_definition_events.sql",
  "20260815015023_add_behavior_configuration_events.sql",
  "20260815023424_link_occurrences_to_behavior_configuration_events.sql",
  "20260801051601_add_launch_export_rate_limit.sql",
  "20260802000000_add_occurrence_time_sessions.sql",
]
  .map((fileName) => readFileSync(join(MIGRATION_DIR, fileName), "utf8"))
  .join("\n");

const USER_OWNED_TABLES = [
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
] as const;

const NORMALIZED_MIGRATION_SQL = MIGRATION_SQL.replace(/\s+/g, " ");

const HISTORICAL_AUTHENTICATED_TABLE_GRANTS = new Map<
  (typeof USER_OWNED_TABLES)[number],
  string
>([
  ["profiles", "select, insert, update, delete"],
  ["categories", "select, insert, update, delete"],
  ["behaviors", "select, insert, update, delete"],
  ["behavior_definition_events", "select"],
  ["behavior_configuration_events", "select"],
  ["behavior_schedules", "select, insert, update, delete"],
  ["behavior_schedule_slots", "select, insert, update, delete"],
  ["occurrences", "select, insert, update, delete"],
  ["reminder_deliveries", "select, insert, update, delete"],
  ["push_subscriptions", "select, insert, update, delete"],
  ["occurrence_status_events", "select, insert"],
  ["occurrence_sync_state", "select, insert, update, delete"],
  ["behaviorlog_import_runs", "select, insert, update, delete"],
  ["behaviorlog_import_record_mappings", "select, insert, update, delete"],
  ["imported_notes", "select, insert, update, delete"],
  ["imported_interventions", "select, insert, update, delete"],
  ["launch_rate_limits", "select"],
  ["occurrence_time_sessions", "select, insert, update, delete"],
]);

describe("RLS policy registry", () => {
  it("keeps every user-owned public table behind row level security", () => {
    for (const table of USER_OWNED_TABLES) {
      expect(MIGRATION_SQL).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("keeps every user-owned table scoped by auth.uid policies", () => {
    for (const table of USER_OWNED_TABLES) {
      const policyPattern = new RegExp(
        `create policy [\\s\\S]+?on public\\.${table}[\\s\\S]+?auth\\.uid\\(\\)`,
        "i",
      );

      expect(MIGRATION_SQL).toMatch(policyPattern);
    }
  });

  it("records an explicit historical authenticated grant for every user-owned public table", () => {
    for (const table of USER_OWNED_TABLES) {
      const expectedPrivileges =
        HISTORICAL_AUTHENTICATED_TABLE_GRANTS.get(table);

      expect(expectedPrivileges).toBeDefined();
      expect(NORMALIZED_MIGRATION_SQL).toMatch(
        new RegExp(
          `grant ${expectedPrivileges} on table public\\.${table} to [^;]*\\bauthenticated\\b[^;]*;`,
        ),
      );
    }
  });
});

// Ticket 222: OAuth and integration records live in a non-exposed private
// schema. The only service-role boundary is the token-endpoint function set.
const OAUTH_MIGRATION_SQL = readFileSync(
  join(MIGRATION_DIR, "20261018160000_add_oauth_integration_persistence.sql"),
  "utf8",
).replace(/\s+/g, " ");

const OAUTH_PRIVATE_TABLES = [
  "clients",
  "grants",
  "authorization_codes",
  "token_families",
  "tokens",
  "activity",
  "idempotency_records",
  "external_references",
  "rate_limit_counters",
] as const;

const OAUTH_SERVICE_ROLE_FUNCTIONS = [
  "oauth_register_client(text, text, text, text, text, text[], text, jsonb, text, timestamptz)",
  "oauth_get_client(text)",
  "oauth_exchange_authorization_code(text, text, text, text, text, text, text)",
  "oauth_rotate_refresh_token(text, text, text, text[], text, text)",
  "oauth_verify_access_token(text, text)",
  "oauth_revoke_token(text, text)",
  "oauth_consume_rate_limit(text, uuid, text)",
  "oauth_purge_expired()",
  "oauth_revoke_all_grants()",
] as const;

const OAUTH_AUTHENTICATED_FUNCTIONS = [
  "oauth_approve_consent(text, text, text, text, text[], text)",
  "oauth_list_grants()",
  "oauth_revoke_grant(uuid)",
  "oauth_list_activity(integer, timestamptz)",
  "integration_record_activity(text, uuid[], text, text)",
  "integration_idempotency_begin(text, text, text)",
  "integration_idempotency_complete(text, text, jsonb)",
  "integration_idempotency_release(text, text)",
  "integration_link_external_reference(text, uuid, text)",
  "integration_find_external_reference(text, text)",
  "integration_list_external_references(text, uuid[])",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("OAuth private-schema registry (Ticket 222)", () => {
  it("keeps the schema and every table unreachable for API roles", () => {
    expect(OAUTH_MIGRATION_SQL).toContain(
      "revoke all on schema cadence_oauth_private from public, anon, authenticated, service_role;",
    );
    expect(OAUTH_MIGRATION_SQL).toContain(
      "revoke all on all tables in schema cadence_oauth_private from public, anon, authenticated, service_role;",
    );
    expect(OAUTH_MIGRATION_SQL).not.toMatch(
      /grant [^;]* on (table )?cadence_oauth_private\./,
    );
    for (const table of OAUTH_PRIVATE_TABLES) {
      expect(OAUTH_MIGRATION_SQL).toContain(
        `alter table cadence_oauth_private.${table} enable row level security`,
      );
    }
  });

  it("ties every user-owned OAuth record to its Auth owner with a cascade", () => {
    for (const table of OAUTH_PRIVATE_TABLES.filter(
      (name) => name !== "clients" && name !== "rate_limit_counters",
    )) {
      expect(OAUTH_MIGRATION_SQL).toMatch(
        new RegExp(
          `create table cadence_oauth_private\\.${table} \\([^;]*user_id uuid not null references auth\\.users\\(id\\) on delete cascade`,
        ),
      );
    }
  });

  it("limits token-endpoint functions to service_role", () => {
    for (const signature of OAUTH_SERVICE_ROLE_FUNCTIONS) {
      const escaped = escapeRegExp(signature);
      expect(OAUTH_MIGRATION_SQL).toMatch(
        new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`),
      );
      expect(OAUTH_MIGRATION_SQL).toMatch(
        new RegExp(`grant execute on function public\\.${escaped} to service_role;`),
      );
    }
  });

  it("limits user-session functions to authenticated callers", () => {
    for (const signature of OAUTH_AUTHENTICATED_FUNCTIONS) {
      const escaped = escapeRegExp(signature);
      expect(OAUTH_MIGRATION_SQL).toMatch(
        new RegExp(`revoke all on function public\\.${escaped} from public, anon, service_role;`),
      );
      expect(OAUTH_MIGRATION_SQL).toMatch(
        new RegExp(`grant execute on function public\\.${escaped} to authenticated;`),
      );
    }
  });

  it("defines every public OAuth function as SECURITY DEFINER with an empty search_path", () => {
    const definitions = OAUTH_MIGRATION_SQL.match(
      /create function public\.[a-z_]+\([\s\S]*?as \$\$/g,
    );
    expect(definitions).toHaveLength(
      OAUTH_SERVICE_ROLE_FUNCTIONS.length + OAUTH_AUTHENTICATED_FUNCTIONS.length,
    );
    for (const definition of definitions ?? []) {
      expect(definition).toContain("security definer");
      expect(definition).toContain("set search_path = ''");
    }
  });
});
