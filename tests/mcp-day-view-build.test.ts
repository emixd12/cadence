// Ticket 377: the generated module lib/mcp/apps/day-view-html.ts must equal a fresh build
// of packages/mcp-views, byte for byte. A stale or hand-edited module fails here, and so
// does a build that stops being deterministic.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { validateAgainstSchema } from "@cadence/core/integration";
import { DAY_VIEW_URI, GRANTED_SCOPES_META_KEY, MCP_APP_RESOURCE_BYTE_CAP } from "@/lib/mcp/apps/config";
import { DAY_VIEW_HTML } from "@/lib/mcp/apps/day-view-html";
import { SHOW_DAY_OUTPUT_SCHEMA } from "@/lib/mcp/apps/show-day";
import * as viewContract from "@/packages/mcp-views/src/contract";
import { FIXTURE_DAYS } from "@/packages/mcp-views/src/fixtures";
import catalog from "@/packages/core/src/notices/catalog/day-view.json";
import { NOTICES } from "@cadence/core/notices";

const root = join(__dirname, "..");

describe("Cadence day view build", () => {
  it("rebuilds to the committed bytes", () => {
    const output = execFileSync(process.execPath, ["packages/mcp-views/scripts/build.mjs", "--check"], { cwd: root, encoding: "utf8", timeout: 120_000 });
    expect(output).toContain("lib/mcp/apps/day-view-html.ts matches the build");
  }, 130_000);

  it("stays within the size the spike measured for Preact with ext-apps", () => {
    // Ticket 375 measured 261 KB raw and 70 KB gzip. A jump past these limits means a
    // dependency entered the bundle; one view read costs this many bytes per grant.
    expect(Buffer.byteLength(DAY_VIEW_HTML)).toBeLessThan(300_000);
    expect(gzipSync(DAY_VIEW_HTML, { level: 9 }).length).toBeLessThan(80_000);
    expect(Buffer.byteLength(DAY_VIEW_HTML)).toBeLessThan(MCP_APP_RESOURCE_BYTE_CAP);
  });

  it("uses the server's resource URI and scopes key, and fixtures the server's schema accepts", () => {
    expect(viewContract.DAY_VIEW_RESOURCE_URI).toBe(DAY_VIEW_URI);
    expect(viewContract.GRANTED_SCOPES_META_KEY).toBe(GRANTED_SCOPES_META_KEY);
    for (const [id, build] of Object.entries(FIXTURE_DAYS)) {
      const checked = validateAgainstSchema(SHOW_DAY_OUTPUT_SCHEMA, build());
      expect(checked.ok ? [] : checked.issues, id).toEqual([]);
    }
  });

  it("carries its words from the notices library and from nowhere else", () => {
    for (const [id, entry] of Object.entries(catalog.notices)) {
      expect(NOTICES[id as keyof typeof NOTICES].text, id).toBe(entry.text);
      // The catalog text is in the bundle as written (JSON escapes aside).
      expect(DAY_VIEW_HTML.includes(entry.text.replaceAll("\"", "\\\"")) || DAY_VIEW_HTML.includes(entry.text), id).toBe(true);
    }
    expect(DAY_VIEW_HTML).toContain("Reconnect to allow changes");
  });

  it("keeps ext-apps and zod out of the Next.js root manifest", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const name of ["@modelcontextprotocol/ext-apps", "zod", "preact", "vite-plugin-singlefile"]) {
      expect(manifest.dependencies[name], name).toBeUndefined();
      expect(manifest.devDependencies[name], name).toBeUndefined();
    }
  });
});
