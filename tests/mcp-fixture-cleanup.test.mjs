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
it("keeps the original run window bounded to 48 hours", () => {
  const manifest = fixture();
  manifest.capturedAt = "2026-10-30T01:00:00Z";
  expect(() => buildCleanupSql(manifest)).not.toThrow();
  manifest.capturedAt = "2026-10-30T01:00:00.001Z";
  expect(() => buildCleanupSql(manifest)).toThrowError("cleanup-manifest-refused");
});
function partialRun() {
  const m = fixture();
  m.runId = "4db9fe6e-a966-4cca-938b-aee5a1b955b7";
  m.startedAt = "2026-10-28T02:17:18.882Z";
  m.capturedAt = "2026-10-29T13:00:00Z";
  m.emptyUsers = [QA_USERS[1]];
  m.rows = m.rows.filter(r => r.user_id === QA_USERS[0]).map(r => ({ ...r,
    id: r.table === "categories" ? "a29dd2d0-5425-4180-a29a-01a026ebb8c0" : "b2c5b6b1-457a-4e58-a14f-e4270c3d341e",
    run_id: m.runId, created_at: "2026-10-28T18:11:34Z" }));
  m.counts = Object.fromEntries(TABLES.map(t => [t, m.rows.filter(r => r.table === t).length]));
  return m;
}
it("accepts explicitly empty B only for the captured partial A run", () => {
  expect(() => buildCleanupSql(partialRun())).not.toThrow();
});
it.each([
  m => { delete m.emptyUsers; },
  m => { m.emptyUsers = [QA_USERS[0]]; },
  m => { m.emptyUsers = QA_USERS; },
  m => { m.runId = randomUUID(); m.rows.forEach(r => { r.run_id = m.runId; }); },
  m => { m.startedAt = "2026-10-28T02:17:18Z"; },
  m => { m.rows.find(r => r.table === "behaviors").id = randomUUID(); },
  m => { m.rows.find(r => r.table === "categories").id = randomUUID(); },
  m => { m.rows.push({ ...m.rows[0], table: "occurrences", id: randomUUID(), user_id: QA_USERS[1] }); m.counts.occurrences++; },
])("refuses an implicit, foreign or widened empty-account declaration", change => {
  const m = partialRun(); change(m);
  expect(() => buildCleanupSql(m)).toThrowError("cleanup-manifest-refused");
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
