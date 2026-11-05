import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { TRAVEL_OWNER_MONTH_CEILING_MICRODOLLARS } from "@/lib/db/travelSpend.repo";

const exec = promisify(execFile);
// Explicit opt-in; this uses only the disposable, loopback Cadence database.
const enabled = process.env.CADENCE_TRAVEL_SQL_CONTRACT === "1";
async function sql(query: string): Promise<string> {
  const { stdout } = await exec("psql", ["postgresql://postgres:postgres@127.0.0.1:55322/postgres", "-XAt", "-v", "ON_ERROR_STOP=1", "-c", query]);
  return stdout.trim();
}
const authenticate = (id: string) => `set local role authenticated; set local request.jwt.claim.sub = '${id}';`;

it.skipIf(!enabled)("serializes concurrent reservations at both ceilings without overspending", async () => {
  expect(await sql("select (select count(*) from auth.users) + (select count(*) from public.travel_spend_global_day)")).toBe("0");
  const owners = [randomUUID(), randomUUID()];
  const ids = owners.map(id => `'${id}'`).join(",");
  try {
    await sql(`insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
      select id::uuid, 'authenticated', 'authenticated', id || '@example.invalid', '{"provider":"email","providers":["email"]}', '{}'
      from unnest(array[${ids}]) id;
      insert into public.travel_spend_owner_month (user_id, local_month, reserved_microdollars)
      select id, date_trunc('month', statement_timestamp() at time zone timezone)::date, 4990000
      from public.profiles where id in (${ids});
      insert into public.travel_spend_global_day (utc_date, reserved_microdollars)
      values ((statement_timestamp() at time zone 'UTC')::date, 9990000);`);
    const decisions = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      sql(`begin; ${authenticate(owners[index % 2]!)} select allowed from public.reserve_travel_provider_spend(5000); commit;`)));
    expect(decisions.filter(result => result.split("\n").includes("t"))).toHaveLength(2);
    expect(await sql(`select max(reserved_microdollars) <= 5000000 and sum(reserved_microdollars) = 9990000
      from public.travel_spend_owner_month where user_id in (${ids});`)).toBe("t");
    expect(await sql("select reserved_microdollars from public.travel_spend_global_day")).toBe("10000000");
  } finally {
    await sql(`delete from auth.users where id in (${ids}); delete from public.travel_spend_global_day;`);
  }
  expect(await sql("select count(*) from auth.users")).toBe("0");
});

it.skipIf(!enabled)("renews at local midnight across a DST month boundary", async () => {
  const owner = randomUUID();
  // Replace only the clock in the real function, inside a transaction that always rolls back.
  const result = await sql(`begin;
    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    values ('${owner}', 'authenticated', 'authenticated', '${owner}@example.invalid', '{"provider":"email","providers":["email"]}', '{}');
    create temporary table original_budget_function as select pg_get_functiondef('public.reserve_travel_provider_spend(integer)'::regprocedure) as definition;
    do $$ begin execute replace((select definition from original_budget_function), 'statement_timestamp()', '''2026-11-01T03:59:59Z''::timestamptz'); end $$;
    ${authenticate(owner)}
    do $$ begin for i in 1..25 loop perform public.reserve_travel_provider_spend(200000); end loop; end $$;
    select not allowed and resets_at = '2026-11-01T04:00:00Z'::timestamptz from public.reserve_travel_provider_spend(1);
    reset role;
    do $$ begin execute replace((select definition from original_budget_function), 'statement_timestamp()', '''2026-11-01T04:00:00Z''::timestamptz'); end $$;
    ${authenticate(owner)}
    select allowed from public.reserve_travel_provider_spend(5000);
    select count(*) = 2 from public.travel_spend_owner_month;
    rollback;`);
  expect(result.split("\n").filter(line => line === "t")).toHaveLength(3);
});

it("reports the same monthly ceiling the reservation function enforces (Ticket 267)", () => {
  // The latest migration that defines the function holds the enforced ceiling.
  const definitions = readdirSync("supabase/migrations").sort()
    .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
    .filter((sql) => sql.includes("function public.reserve_travel_provider_spend("));
  const ceiling = /owner_month_ceiling constant bigint := (\d+);/.exec(definitions.at(-1) ?? "")?.[1];
  expect(Number(ceiling)).toBe(TRAVEL_OWNER_MONTH_CEILING_MICRODOLLARS);
});

it.skipIf(!enabled)("lets the owner read back its own reserved spend, and nobody else's (Ticket 267)", async () => {
  const owners = [randomUUID(), randomUUID()];
  const ids = owners.map(id => `'${id}'`).join(",");
  const result = await sql(`begin;
    insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
    select id::uuid, 'authenticated', 'authenticated', id || '@example.invalid', '{"provider":"email","providers":["email"]}', '{}'
    from unnest(array[${ids}]) id;
    ${authenticate(owners[0]!)}
    select allowed from public.reserve_travel_provider_spend(5000);
    select coalesce(sum(reserved_microdollars), 0) from public.travel_spend_owner_month;
    reset role;
    ${authenticate(owners[1]!)}
    select count(*) from public.travel_spend_owner_month;
    rollback;`);
  expect(result.split("\n").filter(Boolean).slice(-3)).toEqual(["t", "5000", "0"]);
});
