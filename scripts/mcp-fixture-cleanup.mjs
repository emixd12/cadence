import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const QA_USERS = ["caefd1b8-ea46-485f-8869-119a715fb092", "c05b0d9d-dbdc-4f49-80d2-c55e211ebe7b"];
export const TABLES = ["categories", "behaviors", "behavior_schedules", "behavior_schedule_slots", "occurrences",
  "occurrence_status_events", "behavior_definition_events", "behavior_configuration_events", "occurrence_time_sessions"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const check = (ok) => { if (!ok) throw new Error("cleanup-manifest-refused"); };

// Only produces a reviewable transaction. It has no database or provider transport.
export function buildCleanupSql(manifest, expectedUsers = QA_USERS) {
  check(manifest && Object.keys(manifest).sort().join() === "capturedAt,counts,project,rows,runId,startedAt,users,version");
  check(manifest?.version === 1 && UUID.test(manifest.runId) && manifest.project === "qjodzutjxtmtzczbloxa");
  check(JSON.stringify(manifest.users) === JSON.stringify(expectedUsers)
    && expectedUsers.length === 2 && expectedUsers.every((id) => UUID.test(id)) && expectedUsers[0] !== expectedUsers[1]);
  const start = Date.parse(manifest.startedAt), end = Date.parse(manifest.capturedAt);
  check(Number.isFinite(start) && Number.isFinite(end) && start < end && end - start <= 172800000);
  check(Array.isArray(manifest.rows) && manifest.rows.length >= 2 && manifest.rows.length <= 500);
  const keys = new Set();
  for (const row of manifest.rows) {
    check(Object.keys(row).sort().join() === "created_at,id,run_id,table,user_id");
    check(TABLES.includes(row.table) && UUID.test(row.id) && expectedUsers.includes(row.user_id));
    check(row.run_id === manifest.runId && Date.parse(row.created_at) >= start && Date.parse(row.created_at) <= end);
    const key = `${row.table}/${row.id}`;
    check(!keys.has(key)); keys.add(key);
  }
  check(Object.keys(manifest.counts ?? {}).sort().join() === [...TABLES].sort().join());
  for (const table of TABLES) check(manifest.counts[table] === manifest.rows.filter((row) => row.table === table).length);
  for (const user of expectedUsers) {
    check(manifest.rows.some((row) => row.table === "categories" && row.user_id === user));
    check(manifest.rows.some((row) => row.table === "behaviors" && row.user_id === user));
  }
  // Hex keeps even hostile JSON inert in psql and dollar-quoted PL/pgSQL.
  const encoded = Buffer.from(JSON.stringify(manifest)).toString("hex");
  const template = readFileSync(new URL("./mcp-fixture-cleanup.sql", import.meta.url), "utf8");
  return template.replace("MANIFEST_HEX", encoded);
}

export function main(args = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args, strict: true, options: {
      "allow-hosted-project": { type: "string" }, manifest: { type: "string" }, output: { type: "string" },
      "manifest-sha256": { type: "string" },
    } });
    check(values["allow-hosted-project"] === "qjodzutjxtmtzczbloxa" && values.manifest && values.output);
    const bytes = readFileSync(values.manifest);
    check(/^[a-f0-9]{64}$/.test(values["manifest-sha256"] ?? "")
      && createHash("sha256").update(bytes).digest("hex") === values["manifest-sha256"]);
    const sql = buildCleanupSql(JSON.parse(bytes.toString("utf8")));
    writeFileSync(values.output, sql, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ result: "prepared-not-executed", sha256: createHash("sha256").update(sql).digest("hex") }));
    return 0;
  } catch {
    console.error("Cleanup preparation refused. No database operation ran.");
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
