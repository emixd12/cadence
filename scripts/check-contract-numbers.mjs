#!/usr/bin/env node
// Fails when a version number copied into a smoke script or test disagrees with its
// source of truth. Two sequences are covered:
// - the account sync contract (ACCOUNT_SYNC_CONTRACT in the core resolver), copied into
//   the Local Supabase rehearsal's SQL smokes and RPC smoke, which `verify` never runs;
// - the desktop SQLite schema, where `MIGRATIONS` in db.rs must list every migration file
//   once, in order, and the native test must expect the highest version.
// The MCP contract version is pinned by tests/integration-contract.test.ts, not here.
// tests/sql/sub-behaviors-smoke.sql tests fixed contracts 8 and 9 on purpose; it is not read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export const FILES = {
  resolver: "packages/core/src/resolvers/account-sync.resolver.ts",
  supabaseMigrations: "supabase/migrations",
  contractSmoke: "tests/sql/account-sync-contract-smoke.sql",
  writeSmoke: "tests/sql/account-sync-contract-write-smoke.sql",
  rpcSmoke: "scripts/account-sync-rpc-smoke.mjs",
  desktopDb: "apps/desktop/src-tauri/src/local_store/db.rs",
  desktopMigrations: "apps/desktop/src-tauri/migrations",
  desktopTests: "apps/desktop/src-tauri/src/local_store/tests.rs",
};

const RESOLVER_SOURCE = `ACCOUNT_SYNC_CONTRACT in ${FILES.resolver}`;

export function parseAccountSyncContract(source) {
  const match = /export const ACCOUNT_SYNC_CONTRACT = (\d+);/.exec(source);
  if (!match) throw new Error(`${FILES.resolver}: cannot find "export const ACCOUNT_SYNC_CONTRACT = <number>;".`);
  return Number(match[1]);
}

/** The writer floor is the last definition of account_sync_min_writer_contract() across the migrations. */
export function parseWriterFloor(migrations) {
  let floor = null;
  for (const { name, text } of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    const pattern = /function cadence_private\.account_sync_min_writer_contract\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*\$\$/g;
    for (const match of text.matchAll(pattern)) floor = { value: Number(match[1]), file: name };
  }
  return floor;
}

/** Each entry: { file, pattern, label, expected, source, optional }. Pattern group 1 is the literal. */
export function compareLiterals(texts, rules) {
  const errors = [];
  for (const rule of rules) {
    const matches = [...(texts[rule.file] ?? "").matchAll(new RegExp(rule.pattern, "g"))];
    if (matches.length === 0) {
      if (!rule.optional) errors.push(`${rule.file}: cannot find the ${rule.label} (pattern ${rule.pattern}). Update scripts/check-contract-numbers.mjs if the file moved on purpose.`);
      continue;
    }
    for (const match of matches) {
      const found = Number(match[1]);
      if (found !== rule.expected) {
        errors.push(`${rule.file}: ${rule.label} is ${found}, expected ${rule.expected} (${rule.source}). Change the literal to ${rule.expected}.`);
      }
    }
  }
  return errors;
}

export function accountSyncRules(contract) {
  return [
    {
      file: FILES.contractSmoke,
      pattern: String.raw`account_sync_current_contract\(\) <> (\d+)`,
      label: "current contract guard",
      expected: contract,
      source: RESOLVER_SOURCE,
    },
    {
      file: FILES.writeSmoke,
      pattern: String.raw`array\[null::integer, 0, (\d+)\]`,
      label: "unknown read contract (current + 1)",
      expected: contract + 1,
      source: `${RESOLVER_SOURCE}, plus 1`,
    },
    {
      // The RPC smoke derives the unknown contract from the resolver; a literal that comes back must still agree.
      file: FILES.rpcSmoke,
      pattern: String.raw`\{ contract: (\d+) \}\), "unknown read contract"`,
      label: "unknown read contract (current + 1)",
      expected: contract + 1,
      source: `${RESOLVER_SOURCE}, plus 1`,
      optional: true,
    },
    {
      file: FILES.rpcSmoke,
      pattern: String.raw`contract: (\d+) \} \}\), "unknown apply contract"`,
      label: "unknown apply contract (current + 1)",
      expected: contract + 1,
      source: `${RESOLVER_SOURCE}, plus 1`,
      optional: true,
    },
  ];
}

/** The RPC smoke writes at CURRENT_CONTRACT, so it must sit between the writer floor and the current contract. */
export function checkRpcWriteContract(rpcSmoke, contract, floor) {
  const match = /const CURRENT_CONTRACT = (\d+);/.exec(rpcSmoke);
  if (!match) return [`${FILES.rpcSmoke}: cannot find "const CURRENT_CONTRACT = <number>;".`];
  const found = Number(match[1]);
  if (found < floor.value || found > contract) {
    return [`${FILES.rpcSmoke}: CURRENT_CONTRACT (the contract its writes use) is ${found}, expected ${floor.value}–${contract}: at least the writer floor (account_sync_min_writer_contract() in ${floor.file}) and at most ${RESOLVER_SOURCE}.`];
  }
  return [];
}

/** Splits the MIGRATIONS array of db.rs into its top-level tuples. */
export function parseMigrationTuples(dbRs) {
  const start = /MIGRATIONS:\s*&\[\(i64, &str, &str\)\]\s*=\s*&\[/.exec(dbRs);
  if (!start) throw new Error(`${FILES.desktopDb}: cannot find "MIGRATIONS: &[(i64, &str, &str)] = &[".`);
  const tuples = [];
  let depth = 0;
  let tupleStart = -1;
  for (let index = start.index + start[0].length; index < dbRs.length; index += 1) {
    const char = dbRs[index];
    if (char === '"') {
      index = dbRs.indexOf('"', index + 1);
      if (index === -1) break;
      continue;
    }
    if (char === "(") {
      if (depth === 0) tupleStart = index;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) tuples.push(dbRs.slice(tupleStart + 1, index));
    } else if (char === "]" && depth === 0) {
      return tuples;
    }
  }
  throw new Error(`${FILES.desktopDb}: the MIGRATIONS array is not closed.`);
}

export function checkDesktopMigrations(dbRs, migrationFiles) {
  const errors = [];
  const files = migrationFiles.filter((name) => name.endsWith(".sql")).sort();
  const where = `${FILES.desktopDb} MIGRATIONS`;
  const truth = `the files in ${FILES.desktopMigrations}/`;
  const entries = parseMigrationTuples(dbRs).map((body, index) => {
    const versions = [...body.matchAll(/(?:^|,)\s*(\d+)\s*(?=,)/g)].map((match) => Number(match[1]));
    const includes = [...body.matchAll(/include_str!\(\s*"([^"]+)"\s*\)/g)].map((match) => path.posix.basename(match[1]));
    const names = [...body.replace(/include_str!\(\s*"[^"]+"\s*\)/g, "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    if (versions.length !== 1 || includes.length !== 1 || names.length !== 1) {
      errors.push(`${where}: entry ${index + 1} holds ${versions.length} version(s) [${versions.join(", ")}], ${names.length} name(s) and ${includes.length} file(s) [${includes.join(", ")}]; expected one (version, "name", include_str!) per migration file (${truth}). Split it into one tuple per file.`);
    }
    return { version: versions[0], name: names[0], file: includes[0], includes };
  });

  const listed = entries.flatMap((entry) => entry.includes);
  if (listed.join("\n") !== files.join("\n")) {
    const missing = files.filter((file) => !listed.includes(file));
    const extra = listed.filter((file) => !files.includes(file));
    const duplicates = listed.filter((file, index) => listed.indexOf(file) !== index);
    const detail = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      extra.length ? `no such file ${extra.join(", ")}` : "",
      duplicates.length ? `listed twice ${duplicates.join(", ")}` : "",
      !missing.length && !extra.length && !duplicates.length ? "listed out of order" : "",
    ].filter(Boolean).join("; ");
    errors.push(`${where}: found files [${listed.join(", ")}], expected [${files.join(", ")}] (${truth}): ${detail}.`);
  }

  for (const entry of entries) {
    if (!entry.file || entry.includes.length !== 1) continue;
    const match = /^(\d{4})_(.+)\.sql$/.exec(entry.file);
    if (!match) {
      errors.push(`${where}: file ${entry.file} does not follow NNNN_name.sql.`);
      continue;
    }
    if (entry.version !== Number(match[1])) {
      errors.push(`${where}: entry for ${entry.file} has version ${entry.version}, expected ${Number(match[1])} (the file's NNNN prefix).`);
    }
    if (entry.name !== undefined && entry.name !== match[2]) {
      errors.push(`${where}: entry for ${entry.file} is named "${entry.name}", expected "${match[2]}" (the file name after the NNNN_ prefix).`);
    }
  }
  const highest = files.length ? Number(/^(\d{4})_/.exec(files.at(-1))?.[1] ?? 0) : 0;
  return { errors, highest };
}

/** The desktop native test asserts the schema version after every migration ran. */
export function checkDesktopSchemaExpectation(testsRs, highest) {
  const matches = [...testsRs.matchAll(/assert_eq!\(\s*db::schema_version\([^)]*\)\.unwrap\(\),\s*(\d+)\s*\)/g)];
  if (matches.length === 0) {
    return [`${FILES.desktopTests}: cannot find "assert_eq!(db::schema_version(...).unwrap(), <number>)".`];
  }
  return matches
    .map((match) => Number(match[1]))
    .filter((found) => found !== highest)
    .map((found) => `${FILES.desktopTests}: expected schema version is ${found}, expected ${highest} (the highest migration in ${FILES.desktopMigrations}/). Change the assertion to ${highest}.`);
}

export function checkContractNumbers(root = repositoryRoot) {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const contract = parseAccountSyncContract(read(FILES.resolver));
  const supabaseDir = path.join(root, FILES.supabaseMigrations);
  const floor = parseWriterFloor(fs.readdirSync(supabaseDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name: `${FILES.supabaseMigrations}/${name}`, text: fs.readFileSync(path.join(supabaseDir, name), "utf8") })));
  const errors = [];
  if (!floor) {
    errors.push(`${FILES.supabaseMigrations}: no migration defines cadence_private.account_sync_min_writer_contract().`);
  } else if (floor.value > contract) {
    errors.push(`${floor.file}: writer floor is ${floor.value}, expected at most ${contract} (${RESOLVER_SOURCE}).`);
  }

  const texts = Object.fromEntries([FILES.contractSmoke, FILES.writeSmoke, FILES.rpcSmoke].map((file) => [file, read(file)]));
  errors.push(...compareLiterals(texts, accountSyncRules(contract)));
  if (floor) errors.push(...checkRpcWriteContract(texts[FILES.rpcSmoke], contract, floor));

  const desktop = checkDesktopMigrations(read(FILES.desktopDb), fs.readdirSync(path.join(root, FILES.desktopMigrations)));
  errors.push(...desktop.errors);
  errors.push(...checkDesktopSchemaExpectation(read(FILES.desktopTests), desktop.highest));
  return { errors, contract, floor: floor?.value ?? null, schema: desktop.highest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { errors, contract, floor, schema } = checkContractNumbers();
    if (errors.length) {
      console.error(`contract-numbers check failed with ${errors.length} issue(s):`);
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`contract-numbers check passed (account sync contract ${contract}, writer floor ${floor}, desktop SQLite schema ${schema}).`);
    }
  } catch (error) {
    console.error(`contract-numbers check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
