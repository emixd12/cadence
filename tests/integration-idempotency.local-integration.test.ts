import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { INTEGRATION_LIMITS, validateOperationOutput } from "@cadence/core/integration";
import statusFixture from "./fixtures/integration/operations/set_occurrence_status.json";
import behaviorFixture from "./fixtures/integration/operations/update_behavior.json";

// Opt-in: point only at an isolated local database. Each RPC exercise rolls back.
const databaseUrl = process.env.CADENCE_LOCAL_SUPABASE_DB_URL;
const localIt = databaseUrl ? it : it.skip;
const wireLimit = INTEGRATION_LIMITS.maxResponseBytes;

function statusOutput(bytes: number, seed: string) {
  const output = structuredClone(statusFixture.valid_outputs[0].value);
  output.occurrence.note = seed;
  output.occurrence.note += "x".repeat(bytes - Buffer.byteLength(JSON.stringify(output)));
  return output;
}

const schedule = {
  id: "00000006-1111-4111-8111-000000000006",
  recurrence: { frequency: "daily", interval: 1e308 },
  recurrence_summary: "",
  time_entries: [],
  time_summary: "",
};
const schedules: (typeof schedule)[] = [];
const expandedBehavior = {
  ...behaviorFixture.valid_outputs[0].value,
  behavior: { ...behaviorFixture.valid_outputs[0].value.behavior, schedules },
};
const scheduleCount = Math.floor(
  (wireLimit - Buffer.byteLength(JSON.stringify(expandedBehavior))) /
  (Buffer.byteLength(JSON.stringify(schedule)) + 1),
);
expandedBehavior.behavior.schedules = Array.from({ length: scheduleCount }, () => schedule);

const cases = [
  { name: "existing 70,000-character note", operation: "set_occurrence_status", output: statusOutput(70_624, "x".repeat(70_000)) },
  { name: "one byte below the wire limit", operation: "set_occurrence_status", output: statusOutput(wireLimit - 1, "") },
  { name: "exact wire limit with Unicode and JSON escapes", operation: "set_occurrence_status", output: statusOutput(wireLimit, "é🐴\n\t\"\\'".repeat(2000)) },
  { name: "JSONB numeric expansion in Behavior schedules", operation: "update_behavior", output: expandedBehavior },
] as const;

describe("contract output and idempotency storage boundaries", () => {
  for (const { name, operation, output } of cases) {
    it(`accepts ${name} under the output contract`, () => {
      expect(validateOperationOutput(operation, output).ok).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(wireLimit);
    });

    localIt(`completes and replays ${name} through the real RPCs`, () => {
      expect(validateOperationOutput(operation, output).ok).toBe(true);
      const saved = completeAndReplay(operation, output);
      expect(saved.state).toBe("replay");
      expect(isDeepStrictEqual(saved.result, output)).toBe(true);
      expect(validateOperationOutput(operation, saved.result).ok).toBe(true);
      expect(saved.bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(output)));
      if (operation === "update_behavior") expect(saved.bytes).toBeGreaterThan(256 * 1024);
    });
  }

  it("still rejects a response one byte over the wire limit", () => {
    const output = statusOutput(wireLimit + 1, "é🐴");
    expect(Buffer.byteLength(JSON.stringify(output))).toBe(wireLimit + 1);
    const result = validateOperationOutput("set_occurrence_status", output);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("limit_exceeded");
  });

  localIt("bounds storage at 512 KiB independently of the wire limit", () => {
    // JSON string quotes consume two bytes. These are storage probes, not tool outputs.
    const exact = completeAndReplay("set_occurrence_status", "x".repeat(512 * 1024 - 2));
    expect(exact.bytes).toBe(512 * 1024);
    expect(() => completeAndReplay("set_occurrence_status", "x".repeat(512 * 1024 - 1)))
      .toThrow("Idempotency SQL failed (23514)");
  });
});

function completeAndReplay(operation: string, output: unknown): { state: string; result: unknown; bytes: number } {
  const url = new URL(databaseUrl!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Idempotency tests require an isolated loopback database.");
  }
  const serialized = JSON.stringify(output).replaceAll("'", "''");
  const result = spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], {
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1),
    },
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    input: `
begin;
set local standard_conforming_strings = on;
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('22200000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated',
  'ticket-222-size@example.invalid', '{"provider":"email","providers":["email"]}', '{}');
set local role service_role;
do $$ begin
  perform public.oauth_register_client('dcr-ticket-222-size', 'dcr', 'Size fixture', null, null,
    array['https://client.example/callback'], 'web', '{}'::jsonb, null, null);
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22200000-0000-4000-8000-00000000000c","role":"authenticated"}';
do $$ declare consent jsonb; begin
  consent := public.oauth_approve_consent('dcr-ticket-222-size', 'https://client.example/callback',
    repeat('a', 43), 'https://app.cadence-me.com/mcp',
    array['cadence.read','cadence.occurrences.write','cadence.behaviors.write'], repeat('b', 64));
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '22200000-0000-4000-8000-00000000000c', 'role', 'authenticated',
    'cadence_grant_id', consent->>'grant_id')::text, true);
end $$;
do $$ begin
  if (select state from public.integration_idempotency_begin('size-probe', '${operation}', repeat('c', 64)))
    is distinct from 'started' then raise exception 'Expected new claim'; end if;
end $$;
create temporary table size_result (value jsonb);
insert into size_result values ('${serialized}'::jsonb);
do $$ begin
  if public.integration_idempotency_complete('size-probe', repeat('c', 64), (select value from size_result))
    is distinct from true then raise exception 'Expected completion'; end if;
end $$;
select jsonb_build_object('state', state, 'result', result, 'bytes', octet_length(result::text))
from public.integration_idempotency_begin('size-probe', '${operation}', repeat('c', 64));
rollback;
`,
  });
  if (result.error || result.status !== 0) {
    // Never include SQL inputs or result notes in test failure logs.
    const sqlState = result.stderr?.match(/ERROR:\s+([0-9A-Z]{5})/)?.[1] ?? "unavailable";
    throw new Error(`Idempotency SQL failed (${sqlState})`);
  }
  return JSON.parse(result.stdout.trim());
}
