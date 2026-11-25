import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Floor = { value: number; file: string };
type ContractModule = {
  FILES: Record<string, string>;
  parseAccountSyncContract: (source: string) => number;
  parseWriterFloor: (migrations: { name: string; text: string }[]) => Floor | null;
  checkRpcWriteContract: (rpcSmoke: string, contract: number, floor: Floor) => string[];
  parseMigrationTuples: (dbRs: string) => string[];
  checkDesktopMigrations: (dbRs: string, files: string[]) => { errors: string[]; highest: number };
  checkDesktopSchemaExpectation: (testsRs: string, highest: number) => string[];
  checkContractNumbers: (root?: string) => { errors: string[]; contract: number; floor: number | null; schema: number };
};

const repoRoot = path.resolve(__dirname, "..");
const mergedTupleFixture = path.join(repoRoot, "tests/fixtures/governance/desktop-migrations-merged-tuple.rs.txt");
let check: ContractModule;
let tmp: string;

beforeAll(async () => {
  // @ts-expect-error The check is a plain Node ESM script.
  check = await import("../scripts/check-contract-numbers.mjs");
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-contract-numbers-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A copy of every file the check reads, so a test can break one of them. */
function copyRepository(name: string) {
  const root = path.join(tmp, name);
  for (const file of Object.values(check.FILES)) {
    fs.cpSync(path.join(repoRoot, file), path.join(root, file), { recursive: true });
  }
  return root;
}

function edit(root: string, file: string, from: string | RegExp, to: string) {
  const target = path.join(root, file);
  const text = fs.readFileSync(target, "utf8");
  const next = text.replace(from, to);
  expect(next, `fixture edit did not apply to ${file}`).not.toBe(text);
  fs.writeFileSync(target, next);
}

const migrationFiles = ["0001_current_local_model.sql", "0002_native_reminder_coverage.sql", "0003_bound_behaviorlog_plans.sql"];
function migrationsRs(entries: [number, string, string][]) {
  const tuples = entries.map(([version, name, file]) => `    (\n        ${version},\n        "${name}",\n        include_str!("../../migrations/${file}"),\n    ),`);
  return `pub(super) const MIGRATIONS: &[(i64, &str, &str)] = &[\n${tuples.join("\n")}\n];\n`;
}
const wellFormed: [number, string, string][] = [
  [1, "current_local_model", migrationFiles[0]],
  [2, "native_reminder_coverage", migrationFiles[1]],
  [3, "bound_behaviorlog_plans", migrationFiles[2]],
];

describe("contract numbers check", () => {
  it("passes on the repository", () => {
    const result = check.checkContractNumbers(repoRoot);
    expect(result.errors).toEqual([]);
    expect(result.contract).toBeGreaterThan(0);
    expect(result.floor).toBeLessThanOrEqual(result.contract);
  });

  it("fails on a lagging current-contract literal in the SQL smoke", () => {
    const root = copyRepository("lagging-current");
    const contract = check.parseAccountSyncContract(fs.readFileSync(path.join(root, check.FILES.resolver), "utf8"));
    edit(root, check.FILES.contractSmoke, `account_sync_current_contract() <> ${contract}`, `account_sync_current_contract() <> ${contract - 1}`);
    const { errors } = check.checkContractNumbers(root);
    expect(errors).toEqual([expect.stringContaining(`${check.FILES.contractSmoke}: current contract guard is ${contract - 1}, expected ${contract}`)]);
    expect(errors[0]).toContain("ACCOUNT_SYNC_CONTRACT in packages/core/src/resolvers/account-sync.resolver.ts");
  });

  it("fails on a lagging unknown-contract literal in the SQL write smoke", () => {
    const root = copyRepository("lagging-unknown");
    edit(root, check.FILES.writeSmoke, /array\[null::integer, 0, (\d+)\]/, "array[null::integer, 0, 4]");
    expect(check.checkContractNumbers(root).errors).toEqual([expect.stringMatching(/unknown read contract \(current \+ 1\) is 4, expected \d+/)]);
  });

  it("flags every copied literal when ACCOUNT_SYNC_CONTRACT moves without them", () => {
    const root = copyRepository("contract-bump");
    edit(root, check.FILES.resolver, /export const ACCOUNT_SYNC_CONTRACT = (\d+);/, "export const ACCOUNT_SYNC_CONTRACT = 40;");
    const { errors } = check.checkContractNumbers(root);
    expect(errors).toHaveLength(2);
    expect(errors.join("\n")).toContain("expected 40");
    expect(errors.join("\n")).toContain("expected 41");
  });

  it("fails when the RPC smoke brings back a stale unknown-contract literal", () => {
    const root = copyRepository("rpc-literal");
    edit(root, check.FILES.rpcSmoke, '{ contract: UNKNOWN_CONTRACT }), "unknown read contract"', '{ contract: 3 }), "unknown read contract"');
    expect(check.checkContractNumbers(root).errors).toEqual([expect.stringContaining(`${check.FILES.rpcSmoke}: unknown read contract (current + 1) is 3`)]);
  });

  it("keeps the RPC smoke's write contract between the writer floor and the current contract", () => {
    const floor = { value: 8, file: "supabase/migrations/x.sql" };
    expect(check.checkRpcWriteContract("const CURRENT_CONTRACT = 8;", 9, floor)).toEqual([]);
    expect(check.checkRpcWriteContract("const CURRENT_CONTRACT = 9;", 9, floor)).toEqual([]);
    expect(check.checkRpcWriteContract("const CURRENT_CONTRACT = 7;", 9, floor)[0]).toContain("CURRENT_CONTRACT (the contract its writes use) is 7, expected 8–9");
    expect(check.checkRpcWriteContract("const CURRENT_CONTRACT = 10;", 9, floor)).toHaveLength(1);
  });

  it("reads the writer floor from the last migration that defines it", () => {
    const define = (n: number) => `create or replace function cadence_private.account_sync_min_writer_contract()\nreturns integer\nlanguage sql\nas $$ select ${n} $$;`;
    expect(check.parseWriterFloor([
      { name: "b_20261121.sql", text: define(8) },
      { name: "a_20261027.sql", text: define(1) },
      { name: "c_20261122.sql", text: "select 1;" },
    ])).toEqual({ value: 8, file: "b_20261121.sql" });
    expect(check.parseWriterFloor([])).toBeNull();
  });
});

describe("desktop SQLite migration list", () => {
  it("accepts one entry per file in order", () => {
    expect(check.checkDesktopMigrations(migrationsRs(wellFormed), migrationFiles)).toEqual({ errors: [], highest: 3 });
  });

  it("fails on two migrations merged into one tuple (the 3f59eed6 shape)", () => {
    const { errors } = check.checkDesktopMigrations(fs.readFileSync(mergedTupleFixture, "utf8"), migrationFiles);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("entry 2 holds 1 version(s) [2], 2 name(s) and 2 file(s) [0002_native_reminder_coverage.sql, 0003_bound_behaviorlog_plans.sql]");
  });

  it("fails on a missing, duplicated or reordered file", () => {
    expect(check.checkDesktopMigrations(migrationsRs(wellFormed.slice(0, 2)), migrationFiles).errors[0]).toContain("missing 0003_bound_behaviorlog_plans.sql");
    expect(check.checkDesktopMigrations(migrationsRs([...wellFormed, wellFormed[2]]), migrationFiles).errors[0]).toContain("listed twice 0003_bound_behaviorlog_plans.sql");
    expect(check.checkDesktopMigrations(migrationsRs([wellFormed[0], wellFormed[2], wellFormed[1]]), migrationFiles).errors[0]).toContain("listed out of order");
  });

  it("fails when a version or name disagrees with its file", () => {
    const { errors } = check.checkDesktopMigrations(migrationsRs([wellFormed[0], wellFormed[1], [4, "bound_plans", migrationFiles[2]]]), migrationFiles);
    expect(errors).toEqual([
      expect.stringContaining("entry for 0003_bound_behaviorlog_plans.sql has version 4, expected 3"),
      expect.stringContaining('is named "bound_plans", expected "bound_behaviorlog_plans"'),
    ]);
  });

  it("does not count parentheses inside strings as tuples", () => {
    expect(check.parseMigrationTuples('MIGRATIONS: &[(i64, &str, &str)] = &[\n    (1, "a (b)", include_str!("x")),\n];')).toHaveLength(1);
  });

  it("fails on a wrong schema_version expectation and ignores the BehaviorLog schema_version string", () => {
    const testsRs = 'json!({"schema_version":"1.0"});\n    assert_eq!(db::schema_version(&fixture.db).unwrap(), 27);\n';
    expect(check.checkDesktopSchemaExpectation(testsRs, 28)).toEqual([expect.stringContaining("expected schema version is 27, expected 28")]);
    expect(check.checkDesktopSchemaExpectation(testsRs.replace("27", "28"), 28)).toEqual([]);
    expect(check.checkDesktopSchemaExpectation('json!({"schema_version":"1.0"});', 28)[0]).toContain("cannot find");
  });

  it("fails the full check when tests.rs lags the highest migration", () => {
    const root = copyRepository("schema-lag");
    edit(root, check.FILES.desktopTests, /db::schema_version\(&fixture\.db\)\.unwrap\(\), (\d+)\)/, "db::schema_version(&fixture.db).unwrap(), 2)");
    expect(check.checkContractNumbers(root).errors).toEqual([expect.stringContaining(`${check.FILES.desktopTests}: expected schema version is 2`)]);
  });
});
