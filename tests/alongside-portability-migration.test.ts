import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ticket 364: a static check of migration 20261125180000. It patches function text by
 * anchor, so every anchor must already exist in the text an earlier migration wrote. The
 * patch itself raises if an anchor is missing or repeated; this test catches that before
 * `supabase db reset` runs.
 */
const dir = path.resolve(__dirname, "../supabase/migrations");
const NAME = "20261125180000_alongside_mcp_and_portability.sql";
const migration = fs.readFileSync(path.join(dir, NAME), "utf8");
const earlier = fs.readdirSync(dir).filter((file) => file.endsWith(".sql") && file < NAME)
  .map((file) => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");

describe("alongside MCP and portability migration", () => {
  it("is additive: no table, column, policy or grant changes", () => {
    expect(migration).not.toMatch(/\b(alter|create|drop)\s+table\b/i);
    expect(migration).not.toMatch(/\b(grant|revoke)\b/i);
    expect(migration).not.toMatch(/\bpolicy\b/i);
    expect(migration.match(/\bdrop function\b/gi)).toEqual(["drop function"]);
    expect(migration).toContain("drop function pg_temp.patch_definition");
  });

  it("patches only anchors an earlier migration wrote", () => {
    const anchors = [...migration.matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map((match) => match[1]!);
    expect(anchors).toHaveLength(6);
    for (const anchor of anchors) expect(earlier.includes(anchor), anchor).toBe(true);
  });

  it("reads the answer only from the key the web app sends", () => {
    expect(migration).toContain("row_value ->> 'cadenceAlongside'");
    expect(migration).toContain("source ? 'alongside'");
    expect(migration).toContain("'is_opportunity','alongside','end_on'");
    expect(migration).not.toMatch(/behavior_advisor_estimates/);
  });
});
