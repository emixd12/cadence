import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { buildCleanupSql, main, QA_USERS, TABLES } from "../scripts/mcp-fixture-cleanup.mjs";

function fixture() {
  const runId = randomUUID();
  const rows = QA_USERS.flatMap(user_id => ["categories", "behaviors"].map(table => ({
    table, id: randomUUID(), user_id, created_at: "2026-10-28T01:00:01Z", run_id: runId,
  })));
  return { version: 1, runId, project: "qjodzutjxtmtzczbloxa", users: QA_USERS,
    startedAt: "2026-10-28T01:00:00Z", capturedAt: "2026-10-28T01:00:02Z", rows,
    counts: Object.fromEntries(TABLES.map(table => [table, rows.filter(row => row.table === table).length])) };
}
it("prepares a bounded atomic archive through the supported RPC, without deletes or connection", () => {
  expect(process.versions.node.split(".")[0]).toBe("24");
  const sql = buildCleanupSql(fixture());
  expect(sql).toContain("BEGIN;"); expect(sql).toContain("COMMIT;");
  expect(sql).toContain("public.update_behavior_with_schedule_graph");
  expect(sql).toContain("FOR UPDATE"); expect(sql).toContain("statement_timeout = '8s'");
  expect(sql).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bUPDATE public\.behaviors/i);
  expect(sql).not.toContain("MANIFEST_HEX");
});
it.each([
  m => { m.users = [randomUUID(), QA_USERS[1]]; },
  m => { m.rows[0].user_id = randomUUID(); },
  m => { m.rows[0].id = "not-an-id"; },
  m => { m.rows[0].run_id = randomUUID(); },
  m => { m.rows[0].created_at = "2026-09-01T00:00:00Z"; },
  m => { m.rows[0].created_at = "2027-01-01T00:00:00Z"; },
  m => { m.rows[0].table = "auth.users"; },
  m => { m.rows[0].note = "must never enter a cleanup manifest"; },
  m => { m.rows.push(m.rows[0]); },
  m => { m.rows.pop(); },
  m => { m.counts.behaviors++; },
  m => { delete m.counts.occurrences; },
  m => { m.project = "another-project"; },
  m => { m.note = "unexpected content"; },
  m => { m.capturedAt = "invalid"; },
])("refuses invalid or widened manifest before producing SQL", change => {
  const manifest = fixture(); change(manifest);
  expect(() => buildCleanupSql(manifest)).toThrowError("cleanup-manifest-refused");
});

it("requires the separately retained capture digest, writes private SQL once, and redacts errors", () => {
  const root = mkdtempSync(join(tmpdir(), "cleanup-offline-"));
  const output = join(root, "cleanup.sql"), input = join(root, "manifest.json");
  const bytes = JSON.stringify(fixture()); writeFileSync(input, bytes);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const args = ["--allow-hosted-project", "qjodzutjxtmtzczbloxa", "--manifest", input, "--output", output];
  try {
    expect(main(args)).toBe(1);
    expect(main([...args, "--manifest-sha256", "0".repeat(64)])).toBe(1);
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(main([...args, "--manifest-sha256", hash])).toBe(0);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    const original = readFileSync(output, "utf8");
    expect(main([...args, "--manifest-sha256", hash])).toBe(1);
    expect(readFileSync(output, "utf8")).toBe(original);
    expect(error.mock.calls.every(call => call[0] === "Cleanup preparation refused. No database operation ran.")).toBe(true);
    expect(log.mock.calls).toHaveLength(1);
  } finally { log.mockRestore(); error.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
