import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Temporal } from "@js-temporal/polyfill";
import { buildFixtureBundle, FIXTURE_SOURCE } from "../scripts/build-mcp-hosted-fixtures.mjs";
import { buildCleanupSql, QA_USERS, TABLES } from "../scripts/mcp-fixture-cleanup.mjs";
import { partialGraph } from "./helpers/mcp-fixture-partial.mjs";

const enabled = process.env.CADENCE_MCP_ARCHIVE_REHEARSAL === "1";
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
const execute = query => {
  const r = spawnSync("docker", ["exec", "-i", "supabase_db_cadence-mcp-232", "psql", "-X", "-q", "-t", "-A",
    "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-v", "SHOW_CONTEXT=never", "-U", "postgres", "-d", "postgres"],
  { input: query, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  return { ok: r.status === 0, output: r.stdout.trim(), state: r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] };
};
const sql = query => { const r = execute(query); if (!r.ok) throw Error(`local-sql-${r.state ?? "failed"}`); return r.output; };

it.skipIf(!enabled)("archives only the captured partial A graph, preserving generated rows and empty B", async () => {
  expect(process.versions.node.split(".")[0]).toBe("24");
  expect(process.env.CADENCE_LOCAL_SUPABASE_URL).toBe("http://127.0.0.1:56121");
  expect(execFileSync("/opt/homebrew/bin/supabase", ["--version"], { encoding: "utf8" }).trim()).toBe("2.109.1");
  const versions = execFileSync("git", ["ls-tree", "-r", "--name-only", FIXTURE_SOURCE, "supabase/migrations"], { encoding: "utf8" })
    .trim().split("\n").map(p => p.split("/").at(-1).split("_")[0]).sort();
  expect(versions).toHaveLength(94);
  expect(JSON.parse(sql("select json_agg(version order by version) from supabase_migrations.schema_migrations;"))).toEqual(versions);
  const root = mkdtempSync(".intent/artifacts/archive-rehearsal-");
  try {
    buildFixtureBundle(`${root}/frozen.mjs`);
    const frozen = await import(pathToFileURL(resolve(root, "frozen.mjs")).href);
    const graph = partialGraph(frozen), walk = graph.behaviors[0], category = graph.categories[0];
    graph.occurrence_status_events[0].local_date = "2026-10-25";
    graph.behavior_definition_events[0].recorded_at = walk.created_at;
    Object.assign(graph.behavior_configuration_events[0], { recorded_at: walk.created_at, effective_at: walk.created_at,
      changed_fields: ["category_id", "location_text", "where_kind", "schedule_graph", "browser_reminder_enabled", "email_reminder_enabled", "reminder_offset_minutes", "active", "timezone"] });
    for (let i = 1; i <= 30; i++) {
      const day = Temporal.PlainDate.from("2026-10-28").add({ days: i });
      graph.occurrences.push({ ...graph.occurrences.find(o => o.status === "unresolved"), id: randomUUID(),
        local_date: day.toString(), scheduled_for: day.toZonedDateTime({ timeZone: "America/New_York", plainTime: "09:00" }).toInstant().toString(),
        note: null, created_at: "2026-10-28T20:42:34.811680Z" });
    }
    // Disposable local users only. This harness has no hosted transport or credential lookup.
    for (const user of QA_USERS) sql(`insert into auth.users(id,email) values ('${user}','${randomUUID()}@example.invalid');`);
    const insert = (table, row) => {
      const columns = Object.keys(row).map(k => `"${k}"`).join(",");
      sql(`insert into public.${table} (${columns}) select ${columns} from json_populate_record(null::public.${table},${literal(row)});`);
    };
    for (const table of TABLES) for (const row of graph[table]) insert(table, row);
    const preserved = [];
    for (let i = 0; i < 3; i++) {
      const b = { ...walk, id: randomUUID(), category_id: null, title: `Preserved ${i}`, created_at: "2026-09-18T00:00:00Z" };
      insert("behaviors", b); preserved.push(b.id);
      for (let j = 0; j < 32; j++) {
        const day = Temporal.PlainDate.from("2026-09-01").add({ days: j });
        insert("occurrences", { id: randomUUID(), user_id: QA_USERS[0], behavior_id: b.id, status: "unresolved",
          schedule_kind: "exact", schedule_start_time: "09:00:00",
          scheduled_for: day.toZonedDateTime({ timeZone: "America/New_York", plainTime: "09:00" }).toInstant().toString(),
          local_date: day.toString(), created_at: "2026-09-18T00:00:00Z" });
      }
    }
    sql(`insert into public.occurrence_sync_state(user_id,stale) values ('${QA_USERS[0]}',true) on conflict(user_id) do nothing;`);
    const read = table => JSON.parse(sql(`select coalesce(json_agg(t order by id),'[]') from public.${table} t where ${table === "categories" ? `id='${category.id}'` : table === "behaviors" ? `id='${walk.id}'` : `behavior_id='${walk.id}'`};`));
    const snapshot = () => Object.fromEntries(TABLES.map(t => [t, read(t)]));
    const before = snapshot();
    const preservedSnapshot = () => sql(`select json_build_object('behaviors',(select json_agg(t order by id) from public.behaviors t where id in (${preserved.map(id => `'${id}'`).join(",")})),'occurrences',(select json_agg(t order by id) from public.occurrences t where behavior_id in (${preserved.map(id => `'${id}'`).join(",")})));`);
    const preservedBefore = preservedSnapshot();
    const rows = TABLES.flatMap(table => before[table].map(({ id, user_id, created_at }) => ({ table, id, user_id, created_at, run_id: frozen.PRIOR_RESUME.runId })));
    const manifest = { version: 1, project: "qjodzutjxtmtzczbloxa", runId: frozen.PRIOR_RESUME.runId, users: QA_USERS,
      emptyUsers: [QA_USERS[1]], startedAt: "2026-10-28T02:17:18.882Z", capturedAt: new Date().toISOString(), rows,
      counts: Object.fromEntries(TABLES.map(t => [t, before[t].length])) };
    expect(manifest.counts.occurrences).toBe(38);
    const implicit = structuredClone(manifest); delete implicit.emptyUsers;
    expect(() => buildCleanupSql(implicit)).toThrowError("cleanup-manifest-refused");
    const nonempty = structuredClone(manifest); nonempty.rows.push({ ...rows[0], table: "occurrences", id: randomUUID(), user_id: QA_USERS[1] }); nonempty.counts.occurrences++;
    expect(() => buildCleanupSql(nonempty)).toThrowError("cleanup-manifest-refused");
    for (const change of [
      m => { const row = m.rows.find(r => r.table === "occurrences"); m.rows = m.rows.filter(r => r !== row); m.counts.occurrences--; },
      m => { m.rows.find(r => r.table === "occurrences").created_at = "2026-10-28T20:42:35Z"; },
    ]) {
      const invalid = structuredClone(manifest); change(invalid);
      expect(execute(buildCleanupSql(invalid)).ok).toBe(false);
      expect(snapshot()).toEqual(before);
    }
    const cleanup = buildCleanupSql(manifest);
    expect(execute(cleanup.replace("archived_count <> expected_count", "true OR archived_count <> expected_count")).ok).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(execute(cleanup).ok).toBe(true);
    const after = snapshot();
    expect(after.behaviors[0].active).toBe(false);
    expect(after.behaviors[0].archived_at).not.toBeNull();
    for (const table of TABLES.filter(t => !["behaviors", "behavior_configuration_events"].includes(t))) expect(after[table]).toEqual(before[table]);
    expect(after.behavior_configuration_events).toHaveLength(2);
    expect(after.behavior_configuration_events.find(r => r.id === before.behavior_configuration_events[0].id)).toEqual(before.behavior_configuration_events[0]);
    expect(preservedSnapshot()).toBe(preservedBefore);
    expect(sql(`select count(*) from public.behaviors where user_id='${QA_USERS[1]}';`)).toBe("0");
    expect(sql(`select stale from public.occurrence_sync_state where user_id='${QA_USERS[0]}';`)).toBe("t");
    writeFileSync(".intent/artifacts/trust232/archive-only/rehearsal.json", JSON.stringify({ timestamp: new Date().toISOString(), source: FIXTURE_SOURCE,
      migrations: 94, cli: "2.109.1", before: manifest.counts, archived: 1, retainedOccurrences: 38, preservedBehaviors: 3,
      preservedOccurrences: 96, emptyB: true, syncStateRetained: true, refusals: 4, rollback: true }) + "\n");
  } finally {
    // Local-only deletion releases the synthetic identities, never hosted accounts.
    sql(`delete from auth.users where id in (${QA_USERS.map(id => `'${id}'`).join(",")});`);
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
