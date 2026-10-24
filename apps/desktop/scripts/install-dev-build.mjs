import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { compareVersions, DEV_VERSION_PATTERN, RELEASE_IDENTIFIER, RELEASE_NAME } from "./release-config.mjs";

// Installs one verified dev-signed build as /Applications/Cadence.app after keeping a ZIP of the installed
// app and a consistent copy of the local database. It never quits Cadence (quitting discards unsaved
// drafts), notarizes, publishes or restores anything. Output names paths, hashes, versions, counts and
// check results only, never record content. See docs/DESKTOP_RELEASE.md, "Dev-signed builds".

const usage = "Usage: install-dev-build.mjs <X.Y.Z-dev.N> [--no-launch] [--allow-unmerged-migrations]";
const [version, ...flags] = process.argv.slice(2);
const store = path.resolve(process.env.CADENCE_RELEASE_STORE || path.join(os.homedir(), "Library", "Application Support", "Cadence Release"));
const installed = path.resolve(process.env.CADENCE_APP || path.join("/Applications", `${RELEASE_NAME}.app`));
const database = path.join(path.resolve(process.env.CADENCE_DATA_DIR
  || path.join(os.homedir(), "Library", "Application Support", RELEASE_IDENTIFIER)), "cadence.sqlite3");

function tool(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(binary)} ${args[0] ?? ""} failed.\n${result.stderr ?? ""}`.trim());
  return result.stdout.trim();
}
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sql = (file, statement) => tool("sqlite3", ["-readonly", file, statement]);

function inspect(app) {
  const value = (key) => tool("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents", "Info.plist")]);
  if (value("CFBundleIdentifier") !== RELEASE_IDENTIFIER) throw new Error(`${app} is not ${RELEASE_IDENTIFIER}.`);
  const executableName = value("CFBundleExecutable");
  if (!/^[A-Za-z0-9_.-]+$/.test(executableName) || [".", ".."].includes(executableName)) throw new Error("The app executable name is invalid.");
  return { version: value("CFBundleShortVersionString"), executableName,
    executableSha256: sha256(path.join(app, "Contents", "MacOS", executableName)) };
}

function verifySigned(app, report) {
  const facts = inspect(app);
  if (facts.version !== report.version || facts.executableSha256 !== report.binarySha256) throw new Error(`${app} does not match verified dev build ${report.version}.`);
  tool("codesign", ["--verify", "--deep", "--strict", app]);
  const display = spawnSync("codesign", ["--display", "--verbose=2", app], { encoding: "utf8" });
  if (display.status !== 0 || !/^Authority=Developer ID Application: /m.test(display.stderr)) throw new Error(`${app} is not signed with a Developer ID Application identity.`);
  return facts;
}

// Any Cadence build opens the same database, whether bundled or started by desktop:dev.
function running(executableName) {
  const result = spawnSync("pgrep", ["-f", `/${executableName}( |$)`], { encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1) throw new Error("Could not determine whether Cadence is running.");
  return result.status === 0;
}

function protectDatabase(destination) {
  if (destination.includes("'")) throw new Error("The protected copy path cannot contain a single quote.");
  // The online backup API takes a consistent copy and only reads the source.
  tool("sqlite3", [database, `.backup '${destination}'`]);
  // The copy keeps WAL mode; a rollback journal lets read-only checks open it later.
  tool("sqlite3", [destination, "PRAGMA journal_mode=DELETE;"]);
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${destination}${suffix}`, { force: true });
  fs.chmodSync(destination, 0o600);
  const tables = sql(destination, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;").split("\n").filter(Boolean);
  return { path: destination, sha256: sha256(destination),
    integrity: sql(destination, "PRAGMA integrity_check;") === "ok" ? "ok" : "failed",
    foreignKeyErrors: sql(destination, "PRAGMA foreign_key_check;").split("\n").filter(Boolean).length,
    schemaVersion: tables.includes("schema_migrations") ? Number(sql(destination, "SELECT coalesce(max(version),0) FROM schema_migrations;")) : 0,
    rowCounts: Object.fromEntries(tables.map((table) => [table, Number(sql(destination, `SELECT count(*) FROM "${table.replaceAll('"', '""')}";`))])) };
}

function checkAfterLaunch(directory, expectedSchema, before) {
  // Wait for the new build to open and migrate the database, then check a consistent copy.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const result = fs.existsSync(database) ? spawnSync("sqlite3", [database, "SELECT coalesce(max(version),0) FROM schema_migrations;"], { encoding: "utf8" }) : null;
    const schema = result?.status === 0 ? Number(result.stdout.trim()) : 0;
    if ((expectedSchema === null ? schema > 0 : schema >= expectedSchema) || Date.now() >= deadline) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  if (!fs.existsSync(database)) return { failures: ["Cadence did not create its database within 60 seconds."] };
  const after = protectDatabase(path.join(directory, "after.sqlite3"));
  const failures = [];
  if (after.integrity !== "ok" || after.foreignKeyErrors) failures.push("The database failed its integrity or foreign-key check after launch.");
  if (expectedSchema !== null && after.schemaVersion !== expectedSchema) failures.push(`The database schema is ${after.schemaVersion}, not ${expectedSchema}; Cadence may not have opened it.`);
  const lostRows = Object.entries(before?.rowCounts ?? {}).filter(([table, count]) => (after.rowCounts[table] ?? 0) < count)
    .map(([table, count]) => ({ table, before: count, after: after.rowCounts[table] ?? 0 }));
  return { ...after, expectedSchemaVersion: expectedSchema, lostRows, failures };
}

function install() {
  if (!DEV_VERSION_PATTERN.test(version ?? "") || flags.some((flag) => !["--no-launch", "--allow-unmerged-migrations"].includes(flag))) throw new Error(usage);
  const buildDirectory = path.join(store, "dev-builds", version);
  const reportPath = path.join(buildDirectory, "dev-verification.json");
  if (!fs.existsSync(reportPath)) throw new Error(`No verified dev build ${version} in ${path.dirname(buildDirectory)}. Run release.mjs dev-build ${version} first.`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.milestone !== "dev-signed build" || report.identifier !== RELEASE_IDENTIFIER || report.version !== version) throw new Error("The dev build report does not describe this version.");
  const candidate = path.join(buildDirectory, "bundle", "macos", `${RELEASE_NAME}.app`);
  if (!fs.existsSync(candidate)) throw new Error(`Dev build ${version} was already installed and is no longer staged. Build the next dev number.`);
  const unmerged = report.source?.unmergedMigrations ?? [];
  if (unmerged.length && !flags.includes("--allow-unmerged-migrations")) {
    throw new Error(`This build has SQLite migrations that are not on origin/main: ${unmerged.join(", ")}. If they change before merging, later builds cannot open the migrated database. Build from main, or pass --allow-unmerged-migrations on the owner's instruction.`);
  }
  const incoming = verifySigned(candidate, report);
  const previous = fs.existsSync(installed) ? inspect(installed) : null;
  if (previous && compareVersions(version, previous.version) <= 0) throw new Error(`Installed Cadence ${previous.version} is the same as or newer than ${version}. Downgrades are refused.`);
  if ([...new Set([incoming.executableName, previous?.executableName].filter(Boolean))].some(running)) {
    throw new Error("Cadence is running. Quit it (Cadence › Quit Cadence), then run this again. This script never quits Cadence, because quitting discards unsaved drafts.");
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const directory = path.join(store, "dev-installs", `${stamp}-${version}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = { capturedAt: new Date().toISOString(), candidate: { version, binarySha256: report.binarySha256, source: report.source ?? null },
    previousApp: null, before: null, installedAt: null, after: null };
  const save = () => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  if (fs.existsSync(database)) {
    manifest.before = protectDatabase(path.join(directory, "before.sqlite3"));
    save();
    if (manifest.before.integrity !== "ok" || manifest.before.foreignKeyErrors) throw new Error(`The protected database copy failed its integrity or foreign-key check. Nothing was installed. See ${manifestPath}.`);
  }
  if (previous) {
    const zip = path.join(directory, `${RELEASE_NAME}-${previous.version}.zip`);
    tool("ditto", ["-c", "-k", "--keepParent", "--sequesterRsrc", installed, zip]);
    fs.chmodSync(zip, 0o600);
    manifest.previousApp = { version: previous.version, executableSha256: previous.executableSha256, zip, zipSha256: sha256(zip) };
  }
  save();

  // Copy beside the installed app and swap by rename. Any failure puts the previous app back.
  const incomingPath = path.join(path.dirname(installed), `.${RELEASE_NAME}.app.installing-${stamp}`);
  const outgoingPath = path.join(path.dirname(installed), `.${RELEASE_NAME}.app.previous-${stamp}`);
  try {
    tool("ditto", [candidate, incomingPath]);
    if (previous) fs.renameSync(installed, outgoingPath);
    fs.renameSync(incomingPath, installed);
    verifySigned(installed, report);
  } catch (error) {
    if (fs.existsSync(outgoingPath)) {
      fs.rmSync(installed, { recursive: true, force: true });
      fs.renameSync(outgoingPath, installed);
    } else if (!previous) fs.rmSync(installed, { recursive: true, force: true });
    throw error;
  } finally { fs.rmSync(incomingPath, { recursive: true, force: true }); }
  fs.rmSync(outgoingPath, { recursive: true, force: true });
  // The installed copy is now the only unpacked app; the report keeps its hash.
  fs.rmSync(path.join(buildDirectory, "bundle"), { recursive: true, force: true });
  manifest.installedAt = new Date().toISOString();
  save();

  const lines = [`Installed Cadence ${version}${previous ? ` over ${previous.version}` : ""}.`,
    `Source: ${report.source?.branch ?? "unknown branch"} at ${report.source?.commit?.slice(0, 12) ?? "unknown commit"}${report.source?.clean === false ? ", with uncommitted changes" : ""}.`,
    `Protected copy: ${directory}`,
    manifest.before ? `Before: schema ${manifest.before.schemaVersion}, integrity ${manifest.before.integrity}.` : "Before: no database existed."];
  if (flags.includes("--no-launch")) {
    process.stdout.write(`${[...lines, "Not launched; no after-launch check ran."].join("\n")}\n`);
    return;
  }
  tool("open", [installed]);
  manifest.after = checkAfterLaunch(directory, report.source?.sqliteSchemaVersion ?? null, manifest.before);
  save();
  const { after } = manifest;
  if (after.schemaVersion !== undefined) lines.push(`After launch: schema ${after.schemaVersion}${after.expectedSchemaVersion === null ? "" : ` (expected ${after.expectedSchemaVersion})`}, integrity ${after.integrity}, foreign-key errors ${after.foreignKeyErrors}.`);
  for (const { table, before, after: count } of after.lostRows ?? []) {
    lines.push(`Warning: ${table} has fewer rows (${before} → ${count}). Account sync or launch cleanup can explain this; check before restoring anything.`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  if (after.failures.length) throw new Error(`${after.failures.join("\n")}\nRollback steps: docs/DESKTOP_RELEASE.md, "Dev-signed builds". Protected copy: ${directory}`);
}

try {
  install();
} catch (error) {
  process.stderr.write(`Dev build install stopped:\n${error.message}\n`);
  process.exitCode = 1;
}
