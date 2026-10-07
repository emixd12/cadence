import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// These tests exercise orchestration with stubbed platform tools. They do not prove native signing or installation.
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("desktop candidate CLI", () => {
  let directory: string;
  let desktop: string;
  let log: string;
  let environment: NodeJS.ProcessEnv;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "cadence-release-cli-"));
    desktop = path.join(directory, "apps", "desktop");
    log = path.join(directory, "commands.jsonl");
    mkdirSync(path.join(desktop, "scripts"), { recursive: true });
    mkdirSync(path.join(desktop, "src-tauri"));
    mkdirSync(path.join(directory, "scripts"));
    mkdirSync(path.join(directory, "bin"));
    for (const file of ["release.mjs", "release-config.mjs", "verify-updater-signature.mjs", "verify-updater-archive.py", "verify-dmg.py"]) {
      cpSync(path.join("apps/desktop/scripts", file), path.join(desktop, "scripts", file));
    }
    writeFileSync(path.join(desktop, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: "0.1.0", app: { windows: [{ label: "main", title: "Cadence" }] },
      bundle: { macOS: { minimumSystemVersion: "14.0", hardenedRuntime: true } } }));
    writeFileSync(path.join(directory, "scripts", "check-interactions.mjs"), `import fs from 'node:fs';
fs.appendFileSync(process.env.TEST_COMMAND_LOG, JSON.stringify({tool:'interactions',args:process.argv.slice(2)})+'\\n');
if(process.argv.includes('--desktop-release')) { process.stderr.write('updater interaction is still planned'); process.exit(1); }
`);
    const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const tool=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(process.env.TEST_COMMAND_LOG,JSON.stringify({tool,args,appleKeys:Object.keys(process.env).filter(k=>k.startsWith('APPLE_')),privateKey:Object.keys(process.env).some(k=>k.startsWith('TAURI_SIGNING_PRIVATE_KEY'))})+'\\n');
if(tool==='security') process.stdout.write('1) TEST "Developer ID Application: Test (ABCDEFGHIJ)"\\n');
if(tool==='xcrun') process.stdout.write(args[0]==='vtool'?'platform MACOS\\nminos 14.0\\n':'/fake/tool\\n');
if(tool==='lipo') process.stdout.write('arm64\\n');
if(tool==='codesign'&&args.includes('--display')) process.stderr.write('Signature=adhoc\\nflags=0x10002(adhoc,runtime)\\nInfo.plist entries=14\\nSealed Resources version=2 rules=13 files=1\\n');
if(tool==='minisign'&&args.includes('-V')&&process.env.TEST_SIGNATURE_FAILURE==='1') process.exit(3);
if(tool==='npm') {
 if(args[0]==='run'&&args[1]==='build') {
  const dist=path.join(process.cwd(),'dist/assets');fs.mkdirSync(dist,{recursive:true});
  fs.writeFileSync(path.join(dist,'index.js'),(process.env.TEST_OMIT_PUBLIC_AUTH==='url'?'':process.env.VITE_SUPABASE_URL||'')+' '+(process.env.TEST_OMIT_PUBLIC_AUTH==='key'?'':process.env.VITE_SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_ANON_KEY||''));
  return;
 }
 const config=JSON.parse(fs.readFileSync(args[args.indexOf('--config')+1],'utf8'));
 const bundle=path.join(process.cwd(),'src-tauri/target/aarch64-apple-darwin/release/bundle');
 const app=path.join(bundle,'macos/Cadence.app');fs.mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});fs.mkdirSync(path.join(bundle,'dmg'),{recursive:true});
 fs.writeFileSync(path.join(app,'Contents/Info.plist'),'<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.cadence.desktop</string><key>CFBundleShortVersionString</key><string>'+(config.version||'0.1.0')+'</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>CFBundleExecutable</key><string>cadence</string></dict></plist>');
 fs.writeFileSync(path.join(app,'Contents/MacOS/cadence'),'synthetic '+(config.version||'0.1.0')+' '+(process.env.CADENCE_LEGACY_KEYCHAIN_QA==='1'?'app.cadence.desktop.auth.legacy-qa':''),{mode:0o755});
 fs.writeFileSync(app+'.tar.gz','synthetic archive');fs.writeFileSync(app+'.tar.gz.sig',Buffer.from('synthetic signature').toString('base64'));
 fs.writeFileSync(path.join(bundle,'dmg/Cadence_aarch64.dmg'),'synthetic image');
}
`;
    for (const tool of ["security", "xcrun", "minisign", "python3", "lipo", "codesign", "npm", "spctl"]) {
      const executable = path.join(directory, "bin", tool);
      writeFileSync(executable, stub); chmodSync(executable, 0o700);
    }
    environment = { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("APPLE_") && !key.startsWith("TAURI_") && !key.startsWith("CADENCE_UPDATER_"))) };
    Object.assign(environment, { PATH: `${path.join(directory, "bin")}:${process.env.PATH}`, TEST_COMMAND_LOG: log,
      CADENCE_UPDATER_ENDPOINT: "https://github.com/emixd12/cadence/releases/download/desktop-preview/latest.json",
      CADENCE_UPDATER_PUBLIC_KEY: Buffer.from("untrusted comment: test public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n").toString("base64") });
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  const calls = (): { tool: string; args: string[]; appleKeys?: string[]; privateKey?: boolean }[] =>
    existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  const run = (args: string[], env = environment) => spawnSync(process.execPath, [path.join(desktop, "scripts", "release.mjs"), ...args], { env, encoding: "utf8" });
  const previewPath = (version = "0.1.1-preview.1") => path.join(desktop, ".release", "preview", version);

  it("allows preview preparation without Apple credentials, private keys, or completed updater evidence", () => {
    const result = run(["preview-check", "0.1.1-preview.1"]);
    expect(result.status, result.stderr).toBe(0);
    expect(calls().find(({ tool }) => tool === "interactions")?.args).toEqual([]);
    expect(calls().some(({ tool }) => tool === "security" || tool === "npm")).toBe(false);
    expect(existsSync(path.join(desktop, ".release"))).toBe(false);
    const missingKey = run(["preview-build", "0.1.1-preview.1"]);
    expect(missingKey.status).toBe(1);
    expect(missingKey.stderr).toContain("TAURI_SIGNING_PRIVATE_KEY");
    const missingPublicAuth = run(["preview-build", "0.1.1-preview.1"], { ...environment, TAURI_SIGNING_PRIVATE_KEY: "synthetic-key" });
    expect(missingPublicAuth.status).toBe(1);
    expect(missingPublicAuth.stderr).toContain("VITE_SUPABASE_URL");
    expect(calls().some(({ tool }) => tool === "npm")).toBe(false);
  });

  it("keeps final production parity strict while candidate construction still reaches strict Apple artifact checks", () => {
    const production = { ...environment, APPLE_SIGNING_IDENTITY: "Developer ID Application: Test (ABCDEFGHIJ)", APPLE_ID: "test@example.invalid",
      APPLE_PASSWORD: "synthetic-password", APPLE_TEAM_ID: "ABCDEFGHIJ", TAURI_SIGNING_PRIVATE_KEY: "synthetic-key",
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    const readiness = run(["check"], production);
    expect(readiness.status).toBe(1);
    expect(readiness.stderr).toContain("updater interaction is still planned");
    const candidate = run(["build"], production);
    expect(calls().filter(({ tool }) => tool === "interactions").map(({ args }) => args)).toEqual([["--desktop-release"], []]);
    expect(calls().some(({ tool }) => tool === "npm")).toBe(true);
    expect(candidate.status).toBe(1);
    expect(candidate.stderr).toContain("expected Developer ID authority");
    expect(existsSync(path.join(desktop, ".release", "artifact-verification.json"))).toBe(false);
  });

  it("rejects a production build before frontend construction when public Supabase configuration is absent", () => {
    const production = { ...environment, APPLE_SIGNING_IDENTITY: "Developer ID Application: Test (ABCDEFGHIJ)", APPLE_ID: "test@example.invalid",
      APPLE_PASSWORD: "synthetic-password", APPLE_TEAM_ID: "ABCDEFGHIJ", TAURI_SIGNING_PRIVATE_KEY: "synthetic-key" };
    const result = run(["build"], production);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("VITE_SUPABASE_URL");
    expect(calls().some(({ tool }) => tool === "npm")).toBe(false);
  });

  it("stages two verified previews separately, strips Apple secrets, and refuses to replace existing evidence", () => {
    const buildEnvironment = { ...environment, APPLE_ID: "must-not-inherit", APPLE_PASSWORD: "must-not-inherit", APPLE_SIGNING_IDENTITY: "must-not-inherit",
      TAURI_SIGNING_PRIVATE_KEY: "synthetic-updater-key", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "synthetic-updater-password", TAURI_SIGNING_PRIVATE_KEY_PATH: "/synthetic/key",
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    const first = run(["preview-build", "0.1.1-preview.1"], buildEnvironment);
    expect(first.status, first.stderr).toBe(0);
    expect(existsSync(path.join(desktop, "src-tauri", "target", "aarch64-apple-darwin", "release", "bundle", "macos", "Cadence.app"))).toBe(false);
    const reportPath = path.join(previewPath(), "artifact-verification.json");
    const savedReport = readFileSync(reportPath, "utf8");
    const report = JSON.parse(savedReport);
    expect(report).toMatchObject({ version: "0.1.1-preview.1", milestone: "unnotarized preview", publication: "not performed",
      downloadedLaunch: "not verified by this script", upgradePreservation: "not verified by this script" });
    for (const artifact of report.artifacts) expect(existsSync(artifact.file)).toBe(true);
    const second = run(["preview-build", "0.1.1-preview.2"], buildEnvironment);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(reportPath, "utf8")).toBe(savedReport);
    expect(existsSync(path.join(previewPath(), "bundle", "macos", "Cadence.app"))).toBe(false);
    for (const artifact of report.artifacts) expect(existsSync(artifact.file)).toBe(true);
    expect(existsSync(path.join(previewPath("0.1.1-preview.2"), "bundle", "macos", "Cadence.app"))).toBe(true);
    const repeated = run(["preview-build", "0.1.1-preview.1"], buildEnvironment);
    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("existing evidence was not replaced");
    const npmCalls = calls().filter(({ tool }) => tool === "npm");
    expect(npmCalls).toHaveLength(4);
    expect(npmCalls.filter(({ args }) => args.slice(0, 2).join(" ") === "run build")).toHaveLength(2);
    for (const call of npmCalls.filter(({ args }) => args.includes("--config"))) {
      const config = JSON.parse(readFileSync(call.args[call.args.indexOf("--config") + 1], "utf8"));
      expect(config.build.beforeBuildCommand).toBe("");
    }
    expect(calls().filter(({ tool }) => tool !== "interactions").every(({ appleKeys }) => appleKeys?.length === 0)).toBe(true);
    expect(calls().filter(({ tool }) => tool !== "npm").every(({ privateKey }) => !privateKey)).toBe(true);
    expect(calls().some(({ tool }) => tool === "spctl")).toBe(false);
    expect(calls().some(({ tool, args }) => tool === "xcrun" && args.includes("stapler"))).toBe(false);
    expect(calls().filter(({ tool, args }) => tool === "python3" && args[0]?.endsWith("verify-dmg.py"))).toHaveLength(2);
    expect(calls().filter(({ tool, args }) => tool === "python3" && args[0]?.endsWith("verify-updater-archive.py"))).toHaveLength(5);
    const recheck = run(["preview-verify", "0.1.1-preview.2", path.join(previewPath("0.1.1-preview.2"), "bundle")]);
    expect(recheck.status, recheck.stderr).toBe(0);
  });

  it("preserves every unpacked app when a retained archive changes, and permits an idempotent retry", () => {
    const env = { ...environment, TAURI_SIGNING_PRIVATE_KEY: "synthetic-key",
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    expect(run(["preview-build", "0.1.1-preview.1"], env).status).toBe(0);
    const oldApp = path.join(previewPath(), "bundle", "macos", "Cadence.app");
    const archive = `${oldApp}.tar.gz`;
    const original = readFileSync(archive);
    writeFileSync(archive, "corrupt archive");
    const failed = run(["preview-build", "0.1.1-preview.2"], env);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("no longer matches");
    expect(existsSync(oldApp)).toBe(true);
    const keptApp = path.join(previewPath("0.1.1-preview.2"), "bundle", "macos", "Cadence.app");
    expect(existsSync(keptApp)).toBe(true);
    writeFileSync(archive, original);
    const pruned = run(["preview-prune", "0.1.1-preview.2"]);
    expect(pruned.status, pruned.stderr).toBe(0);
    expect(existsSync(oldApp)).toBe(false);
    expect(existsSync(keptApp)).toBe(true);
    expect(run(["preview-prune", "0.1.1-preview.2"]).status).toBe(0);
    expect(run(["preview-prune", "../../outside"]).status).toBe(1);
  });

  it("never publishes staged evidence after updater signature verification fails", () => {
    const result = run(["preview-build", "0.1.1-preview.1"], { ...environment, TAURI_SIGNING_PRIVATE_KEY: "synthetic-key", TEST_SIGNATURE_FAILURE: "1",
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("signature verification failed");
    expect(existsSync(path.join(previewPath(), "bundle"))).toBe(false);
    expect(existsSync(path.join(previewPath(), "artifact-verification.json"))).toBe(false);
  });

  it.each(["url", "key"])("refuses to invoke Tauri or stage when the frontend omits the public auth %s", (missing) => {
    const result = run(["preview-build", `0.1.1-preview.${missing === "url" ? "1" : "2"}`], { ...environment, TAURI_SIGNING_PRIVATE_KEY: "synthetic-key", TEST_OMIT_PUBLIC_AUTH: missing,
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("freshly built desktop frontend omits its reviewed public Supabase configuration");
    expect(calls().filter(({ tool, args }) => tool === "npm" && args[0] === "exec")).toHaveLength(0);
    expect(existsSync(path.join(previewPath(`0.1.1-preview.${missing === "url" ? "1" : "2"}`), "bundle"))).toBe(false);
    expect(existsSync(path.join(previewPath(`0.1.1-preview.${missing === "url" ? "1" : "2"}`), "artifact-verification.json"))).toBe(false);
  });

  it("rejects a production build when the fresh frontend omits reviewed public auth", () => {
    const production = { ...environment, APPLE_SIGNING_IDENTITY: "Developer ID Application: Test (ABCDEFGHIJ)", APPLE_ID: "test@example.invalid",
      APPLE_PASSWORD: "synthetic-password", APPLE_TEAM_ID: "ABCDEFGHIJ", TAURI_SIGNING_PRIVATE_KEY: "synthetic-key", TEST_OMIT_PUBLIC_AUTH: "key",
      VITE_SUPABASE_URL: "https://project.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
    const result = run(["build"], production);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("freshly built desktop frontend omits its reviewed public Supabase configuration");
    expect(calls().filter(({ tool, args }) => tool === "npm" && args[0] === "exec")).toHaveLength(0);
  });
});
