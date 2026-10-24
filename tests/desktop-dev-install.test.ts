import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Real sqlite3, ditto and PlistBuddy run against a synthetic app and database. codesign, pgrep and open are
// stubbed, and every path is overridden, so nothing touches /Applications, the real database or a real app.
describe.skipIf(process.platform !== "darwin")("dev-signed build installation", () => {
  let directory: string;
  let store: string;
  let applications: string;
  let data: string;
  let log: string;
  let environment: NodeJS.ProcessEnv;
  const installedApp = () => path.join(applications, "Cadence.app");
  const executable = (app: string) => path.join(app, "Contents", "MacOS", "cadence-desktop-spike");
  const makeApp = (app: string, version: string) => {
    mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
    writeFileSync(path.join(app, "Contents", "Info.plist"), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>'
      + `<key>CFBundleIdentifier</key><string>app.cadence.desktop</string><key>CFBundleShortVersionString</key><string>${version}</string>`
      + "<key>CFBundleExecutable</key><string>cadence-desktop-spike</string></dict></plist>");
    writeFileSync(executable(app), `synthetic ${version}`, { mode: 0o755 });
  };
  const stageBuild = (version: string, source: Record<string, unknown> = {}) => {
    const build = path.join(store, "dev-builds", version);
    makeApp(path.join(build, "bundle", "macos", "Cadence.app"), version);
    writeFileSync(path.join(build, "dev-verification.json"), JSON.stringify({ milestone: "dev-signed build", identifier: "app.cadence.desktop", version,
      binarySha256: createHash("sha256").update(`synthetic ${version}`).digest("hex"),
      source: { commit: "0123456789abcdef", branch: "main", clean: true, sqliteSchemaVersion: 18, unmergedMigrations: [], ...source } }));
    return path.join(build, "bundle", "macos", "Cadence.app");
  };
  const sqlite = (statement: string) => execFileSync("sqlite3", [path.join(data, "cadence.sqlite3"), statement], { encoding: "utf8" }).trim();
  const run = (args: string[], env: NodeJS.ProcessEnv = environment) =>
    spawnSync(process.execPath, ["apps/desktop/scripts/install-dev-build.mjs", ...args], { env, encoding: "utf8" });
  const calls = (): { tool: string; args: string[] }[] =>
    existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  const manifests = () => existsSync(path.join(store, "dev-installs"))
    ? readdirSync(path.join(store, "dev-installs")).map((name) => path.join(store, "dev-installs", name)) : [];
  const manifest = () => JSON.parse(readFileSync(path.join(manifests()[0], "manifest.json"), "utf8"));

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "cadence-dev-install-"));
    store = path.join(directory, "store");
    applications = path.join(directory, "Applications");
    data = path.join(directory, "data");
    log = path.join(directory, "commands.jsonl");
    for (const folder of ["bin", "Applications", "data"]) mkdirSync(path.join(directory, folder));
    makeApp(installedApp(), "0.1.2");
    sqlite("PRAGMA journal_mode=WAL; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (16), (17);"
      + " CREATE TABLE behaviors (id TEXT PRIMARY KEY); INSERT INTO behaviors VALUES ('b1'), ('b2'), ('b3');"
      + " CREATE TABLE occurrences (id TEXT PRIMARY KEY, behavior_id TEXT REFERENCES behaviors(id)); INSERT INTO occurrences VALUES ('o1', 'b1');");
    const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const tool=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(process.env.TEST_COMMAND_LOG,JSON.stringify({tool,args})+'\\n');
if(tool==='pgrep') process.exit(process.env.TEST_RUNNING==='1'?0:1);
if(tool==='codesign'&&args[0]==='--verify'&&args.at(-1)===process.env.TEST_FAIL_VERIFY_AT) process.exit(1);
if(tool==='codesign'&&args.includes('--display')) process.stderr.write(process.env.TEST_AD_HOC==='1'?'Signature=adhoc\\n':'Authority=Developer ID Application: Test (ABCDEFGHIJ)\\n');
if(tool==='open'&&process.env.TEST_LAUNCH_SQL) execFileSync('sqlite3',[path.join(process.env.CADENCE_DATA_DIR,'cadence.sqlite3'),process.env.TEST_LAUNCH_SQL]);
`;
    for (const tool of ["codesign", "pgrep", "open"]) {
      writeFileSync(path.join(directory, "bin", tool), stub);
      chmodSync(path.join(directory, "bin", tool), 0o700);
    }
    environment = { NODE_ENV: process.env.NODE_ENV, PATH: `${path.join(directory, "bin")}:${process.env.PATH}`, HOME: directory, TEST_COMMAND_LOG: log,
      CADENCE_RELEASE_STORE: store, CADENCE_APP: installedApp(), CADENCE_DATA_DIR: data };
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("protects the database and previous app before swapping, then removes the staged copy", () => {
    stageBuild("0.1.6-dev.1");
    const result = run(["0.1.6-dev.1", "--no-launch"]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(executable(installedApp()), "utf8")).toBe("synthetic 0.1.6-dev.1");
    expect(readdirSync(applications)).toEqual(["Cadence.app"]);
    expect(existsSync(path.join(store, "dev-builds", "0.1.6-dev.1", "bundle"))).toBe(false);
    expect(manifests()).toHaveLength(1);
    expect(path.basename(manifests()[0])).toMatch(/^\d{8}T\d{6}Z-0\.1\.6-dev\.1$/);
    expect(statSync(manifests()[0]).mode & 0o777).toBe(0o700);
    const saved = manifest();
    expect(saved.before).toMatchObject({ integrity: "ok", foreignKeyErrors: 0, schemaVersion: 17,
      rowCounts: { behaviors: 3, occurrences: 1, schema_migrations: 2 } });
    expect(saved.previousApp).toMatchObject({ version: "0.1.2", executableSha256: createHash("sha256").update("synthetic 0.1.2").digest("hex") });
    for (const file of [saved.before.path, saved.previousApp.zip, path.join(manifests()[0], "manifest.json")]) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(execFileSync("sqlite3", ["-readonly", saved.before.path, "SELECT count(*) FROM behaviors;"], { encoding: "utf8" }).trim()).toBe("3");
    expect(execFileSync("unzip", ["-Z1", saved.previousApp.zip], { encoding: "utf8" })).toContain("Cadence.app/Contents/MacOS/cadence-desktop-spike");
    expect(saved).toMatchObject({ installedAt: expect.any(String), after: null });
    expect(calls().some(({ tool }) => tool === "open")).toBe(false);
    expect(result.stdout).toContain("Installed Cadence 0.1.6-dev.1 over 0.1.2.");
    expect(result.stdout).toContain("Not launched");
    expect(result.stdout + result.stderr).not.toMatch(/\b(b1|o1)\b/);
    const again = run(["0.1.6-dev.1", "--no-launch"]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("already installed");
  });

  it("launches the installed path, waits for its migration and warns about tables that lost rows", () => {
    stageBuild("0.1.6-dev.1");
    const result = run(["0.1.6-dev.1"], { ...environment, TEST_LAUNCH_SQL: "INSERT INTO schema_migrations VALUES (18); DELETE FROM occurrences;" });
    expect(result.status, result.stderr).toBe(0);
    expect(calls().filter(({ tool }) => tool === "open").map(({ args }) => args)).toEqual([[installedApp()]]);
    expect(result.stdout).toContain("After launch: schema 18 (expected 18), integrity ok, foreign-key errors 0.");
    expect(result.stdout).toContain("Warning: occurrences has fewer rows (1 → 0).");
    expect(manifest().after).toMatchObject({ schemaVersion: 18, expectedSchemaVersion: 18, failures: [],
      lostRows: [{ table: "occurrences", before: 1, after: 0 }] });
    expect(statSync(manifest().after.path).mode & 0o777).toBe(0o600);
  });

  it("fails with the protected copy named when the launched database does not reach the built schema", () => {
    stageBuild("0.1.6-dev.1");
    const result = run(["0.1.6-dev.1"], { ...environment, TEST_LAUNCH_SQL: "INSERT INTO schema_migrations VALUES (18), (19);" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("The database schema is 19, not 18");
    expect(result.stderr).toContain(manifests()[0]);
    expect(readFileSync(executable(installedApp()), "utf8")).toBe("synthetic 0.1.6-dev.1");
  });

  it("refuses unmerged migrations, running copies, downgrades, unsigned or changed builds and bad arguments without changes", () => {
    stageBuild("0.1.6-dev.1", { unmergedMigrations: ["0019_new.sql"] });
    const unmerged = run(["0.1.6-dev.1", "--no-launch"]);
    expect(unmerged.status).toBe(1);
    expect(unmerged.stderr).toContain("not on origin/main: 0019_new.sql");
    expect(run(["0.1.6-dev.1", "--no-launch", "--allow-unmerged-migrations"], { ...environment, TEST_RUNNING: "1" }).stderr)
      .toContain("Cadence is running");
    stageBuild("0.1.6-dev.2");
    expect(run(["0.1.6-dev.2", "--no-launch"], { ...environment, TEST_AD_HOC: "1" }).stderr).toContain("not signed with a Developer ID");
    writeFileSync(executable(path.join(store, "dev-builds", "0.1.6-dev.2", "bundle", "macos", "Cadence.app")), "changed after verification");
    expect(run(["0.1.6-dev.2", "--no-launch"]).stderr).toContain("does not match verified dev build 0.1.6-dev.2");
    stageBuild("0.1.1-dev.3");
    expect(run(["0.1.1-dev.3", "--no-launch"]).stderr).toContain("Downgrades are refused");
    for (const args of [[], ["0.1.6"], ["0.1.6-preview.1"], ["0.1.6-dev.1", "--force"], ["../0.1.6-dev.1"]]) {
      expect(run(args).stderr).toContain("Usage: install-dev-build.mjs");
    }
    expect(run(["0.1.6-dev.9", "--no-launch"]).stderr).toContain("No verified dev build 0.1.6-dev.9");
    expect(readFileSync(executable(installedApp()), "utf8")).toBe("synthetic 0.1.2");
    expect(manifests()).toEqual([]);
    expect(calls().some(({ tool }) => tool === "open")).toBe(false);
  });

  it("stops before installing when the protected database copy fails its checks", () => {
    sqlite("INSERT INTO occurrences VALUES ('o2', 'missing-behavior');");
    stageBuild("0.1.6-dev.1");
    const result = run(["0.1.6-dev.1", "--no-launch"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing was installed");
    expect(readFileSync(executable(installedApp()), "utf8")).toBe("synthetic 0.1.2");
    expect(manifest()).toMatchObject({ before: { foreignKeyErrors: 1 }, previousApp: null, installedAt: null });
  });

  it("puts the previous app back when the installed copy fails verification after the swap", () => {
    stageBuild("0.1.6-dev.1");
    const result = run(["0.1.6-dev.1", "--no-launch"], { ...environment, TEST_FAIL_VERIFY_AT: installedApp() });
    expect(result.status).toBe(1);
    expect(readFileSync(executable(installedApp()), "utf8")).toBe("synthetic 0.1.2");
    expect(readdirSync(applications)).toEqual(["Cadence.app"]);
    expect(existsSync(path.join(store, "dev-builds", "0.1.6-dev.1", "bundle", "macos", "Cadence.app"))).toBe(true);
    expect(manifest()).toMatchObject({ previousApp: { version: "0.1.2" }, installedAt: null });
  });

  it("installs on a Mac without Cadence or its database", () => {
    rmSync(installedApp(), { recursive: true });
    rmSync(data, { recursive: true });
    stageBuild("0.1.6-dev.1");
    const result = run(["0.1.6-dev.1", "--no-launch"]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(executable(installedApp()), "utf8")).toBe("synthetic 0.1.6-dev.1");
    expect(result.stdout).toContain("Before: no database existed.");
    expect(manifest()).toMatchObject({ before: null, previousApp: null });
    expect(existsSync(path.join(data, "cadence.sqlite3"))).toBe(false);
  });
});
