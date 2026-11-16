import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import allowlistJson from "./fixtures/governance/scheduled-for-allowlist.json";

// `scheduled_for` is an Occurrence's planned time and part of its identity. Once
// per-day moves land (advisor plan, Phase 2), the time an Occurrence actually sits
// at is its effective time, which comes only from the time helper
// (`packages/core/src/resolvers/time.resolver.ts`). Code that reads `scheduled_for`
// directly would show, remind or match at the planned time and ignore the move.
//
// This scan counts the lines that mention `scheduled_for` or `scheduledFor` in each
// source file. The allowlist holds the readers that existed on 2026-11-16, with
// their counts, so the test passes today and fails on any new reader. Phase 2 moves
// readers onto the helper and lowers their counts; it never raises them. Writers
// and identity uses (recurrence, sync, export, the database types) stay listed.
//
// To fix a failure: read the time through `effectiveStartAt` (or `zonedInstant`,
// `localDayBounds`, `todayIn`). Raise a count only when the code needs the planned
// time on purpose, and say why in the pull request. Rules: docs/DATETIME_STRATEGY.md.

type Allowlist = Readonly<{ files: Readonly<Record<string, number>> }>;

const root = path.resolve(__dirname, "..");
const allowlist = allowlistJson as Allowlist;

/** Source roots that ship to a person: web, core, desktop, marketing and plugins. */
const SCAN_ROOTS = ["app", "components", "lib", "packages", "apps", "integrations", "proxy.ts"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs|rs)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", ".astro", "dist", "build", "target", "tests", "__tests__", "gen"]);
const TEST_FILE = /(\.test\.[cm]?[jt]sx?$|(^|\/)tests\.rs$)/;
/** The time helper owns `scheduled_for`; it is the one place allowed to read it freely. */
const OWNER = "packages/core/src/resolvers/time.resolver.ts";
const PLANNED_TIME = /\bscheduled(?:_for|For)\b/;

function sourceFiles(relative: string): string[] {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return SOURCE_FILE.test(relative) ? [relative] : [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) return [];
    if (entry.isSymbolicLink()) return [];
    return sourceFiles(path.posix.join(relative, entry.name));
  });
}

/** Lines mentioning the planned time, per file, for every scanned source file except the owner. */
export function plannedTimeReaders(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of SCAN_ROOTS.flatMap(sourceFiles).sort()) {
    if (file === OWNER || TEST_FILE.test(file)) continue;
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    const count = lines.filter((line) => PLANNED_TIME.test(line)).length;
    if (count > 0) counts[file] = count;
  }
  return counts;
}

describe("scheduled_for drift", () => {
  const readers = plannedTimeReaders();

  it("finds the readers it is meant to watch", () => {
    // Guards the scan itself: if it ever finds nothing, the roots or pattern broke.
    expect(readers["lib/db/occurrences.repo.ts"]).toBeGreaterThan(0);
  });

  it("allows no new direct reads of scheduled_for outside the allowlist", () => {
    const additions = Object.entries(readers)
      .filter(([file, count]) => count > (allowlist.files[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} line(s) mention scheduled_for, allowlist has ${allowlist.files[file] ?? 0}`);
    expect(additions, [
      "New code reads an Occurrence's planned time directly.",
      "Use effectiveStartAt from @cadence/core/resolvers/time.resolver instead,",
      "or raise the count in tests/fixtures/governance/scheduled-for-allowlist.json",
      "with a reason in the pull request if the planned time is meant.",
    ].join(" ")).toEqual([]);
  });

  it("keeps the allowlist free of files that no longer read scheduled_for", () => {
    const stale = Object.keys(allowlist.files).filter((file) => !readers[file]);
    expect(stale, "Remove these entries from tests/fixtures/governance/scheduled-for-allowlist.json.").toEqual([]);
  });
});
