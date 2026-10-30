import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Exercise the CLI with a synthetic SSH peer. These tests never connect to a
// device, run Swift, or establish installed release acceptance.
describe("test-device CLI", () => {
  let directory: string;
  let inventory: string;
  let log: string;
  let env: NodeJS.ProcessEnv;
  const target = { name: "test-mac", host: "test-host", user: "qa", process: "Custom Cadence" };
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "cadence-test-device-"));
    inventory = path.join(directory, "devices.json");
    log = path.join(directory, "commands.jsonl");
    mkdirSync(path.join(directory, "bin"));
    writeFileSync(inventory, JSON.stringify({ devices: [target] }));
    const ssh = path.join(directory, "bin", "ssh");
    writeFileSync(ssh, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2), command = args.at(-1), mode = process.env.TEST_DEVICE_MODE;
fs.appendFileSync(process.env.TEST_DEVICE_LOG, JSON.stringify({ args, command }) + "\\n");
const file = process.env.TEST_DEVICE_STATE;
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
function save() { fs.writeFileSync(file, JSON.stringify(state)); }
if (mode === "ssh-failure") process.exit(255);
if (command.includes("swiftc") || command.startsWith("umask 077;")) process.exit(0);
if (command.includes("Print :CFBundleExecutable")) console.log("cadence-desktop-spike");
else if (command === "ps -axww -o pid=,comm=") {
  console.log("777 /bin/sh");
  console.log("778 pgrep -f /Applications/Cadence.app/Contents/MacOS/");
  if (mode !== "no-app") console.log((state.restarted || (state.installed && mode === "changed-process") ? "222" : "111") + " /Applications/Cadence.app/Contents/MacOS/cadence-desktop-spike");
  if (mode === "two-apps") console.log("333 /Applications/Cadence.app/Contents/MacOS/cadence-desktop-spike");
} else if (command.includes("Print :CFBundleShortVersionString")) {
  if (mode === "transient-bundle" && state.installed && !state.missingOnce) { state.missingOnce = true; save(); }
  else console.log(state.installed ? (mode === "wrong-version" ? "0.2.0" : "0.1.6") : "0.1.5");
}
else if (command.includes("/axelement")) {
  if (command.includes("ready to install") && !command.includes("Cadence 0.1.6 is ready to install.")) process.exit(1);
  if (command.includes("'Install update'")) { state.installed = true; save(); }
  if (command.includes("'Restart Cadence'")) {
    if (mode === "ax-denied") { console.log('{"error":"windows","axError":-25211}'); process.exit(1); }
    state.restarted = true; save();
  }
  console.log('{"width":100,"axError":0}');
} else if (command.includes("/click") && mode === "click-refused") {
  console.error("Cadence is not frontmost."); process.exit(1);
} else if (command.startsWith("osascript")) console.log("synthetic AX result");
`);
    chmodSync(ssh, 0o700);
    env = { ...process.env, PATH: `${path.join(directory, "bin")}:${process.env.PATH}`,
      CADENCE_TEST_DEVICES: inventory, TEST_DEVICE_LOG: log, TEST_DEVICE_STATE: path.join(directory, "state.json") };
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  const calls = (): { args: string[]; command: string }[] => existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  const run = (args: string[], mode = "") => spawnSync(process.execPath, ["scripts/test-device.mjs", ...args], {
    encoding: "utf8", timeout: 10_000, env: { ...env, TEST_DEVICE_MODE: mode },
  });

  it("uses the configured process and retains strict host checking", () => {
    const result = run(["ax", "test-mac", "find", "Sync now"]);
    expect(result.status, result.stderr).toBe(0);
    expect(calls().at(-1)?.command).toContain("'Custom Cadence' 'Sync now'");
    expect(calls().at(-1)?.args).toEqual(expect.arrayContaining(["BatchMode=yes", "StrictHostKeyChecking=yes", "--", "qa@test-host"]));
  });

  it("preserves quotes and shell metacharacters as one remote AX argument", () => {
    const value = "Bob's $(touch /tmp/do-not-run)";
    const result = run(["ax", "test-mac", "press", "AXButton", value]);
    expect(result.status, result.stderr).toBe(0);
    expect(calls().at(-1)?.command).toContain("'Bob'\\''s $(touch /tmp/do-not-run)'");
  });

  it.each([null, { ...target, user: "-o" }, { ...target, host: "host;echo" }, { ...target, app: "relative.app" }])("rejects malformed inventory entries before SSH: %j", (entry) => {
    writeFileSync(inventory, JSON.stringify({ devices: [entry] }));
    expect(run(["check", "test-mac"]).status).toBe(1);
    expect(calls()).toEqual([]);
  });

  it("rejects duplicate device names instead of choosing the first", () => {
    writeFileSync(inventory, JSON.stringify({ devices: [target, { ...target, host: "other-host" }] }));
    expect(run(["check", "test-mac"]).stderr).toContain("Duplicate device name");
    expect(calls()).toEqual([]);
  });

  it("does not confuse a shell mentioning the app with a running Cadence process", () => {
    const result = run(["ax", "test-mac", "locate", "AXButton", "Sync now"], "no-app");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cadence is not running");
    expect(calls().some(({ command }) => command.includes("/axelement\""))).toBe(false);
  });

  it("refuses ambiguous running copies", () => {
    const result = run(["click", "test-mac", "12", "34"], "two-apps");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Multiple copies");
    expect(calls().some(({ command }) => command.includes("/click\""))).toBe(false);
  });

  it("requires the exact expected downloaded update", () => {
    const result = run(["update-install", "test-mac", "0.1.7"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("0.1.7 is not ready");
    expect(calls().some(({ command }) => command.includes("'Install update'"))).toBe(false);
  });

  it("stops on an unexpected installed version without restarting", () => {
    const result = run(["update-install", "test-mac", "0.1.6"], "wrong-version");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unexpected installed version 0.2.0");
    expect(calls().some(({ command }) => command.includes("'Restart Cadence'"))).toBe(false);
  });

  it("does not report an unrelated process change during installation as a restart", () => {
    const result = run(["update-install", "test-mac", "0.1.6"], "changed-process");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("process changed during installation");
    expect(result.stdout).not.toContain("restarted:");
  });

  it("never clicks pre-install coordinates when macOS denies fresh accessibility", () => {
    const result = run(["update-install", "test-mac", "0.1.6"], "ax-denied");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("installed 0.1.6 on disk");
    expect(result.stderr).toContain("installed but was not restarted");
    expect(result.stdout).not.toContain("restarted:");
    expect(calls().some(({ command }) => command.includes("'Check for updates'") || command.includes("/click\""))).toBe(false);
  });

  it("confirms a named restart using the configured executable and expected version", () => {
    const result = run(["update-install", "test-mac", "0.1.6"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("restarted: pid 222, version 0.1.6");
    expect(calls().some(({ command }) => command.includes("/click\""))).toBe(false);
  });

  it("tolerates the brief missing bundle during updater replacement", () => {
    const result = run(["update-install", "test-mac", "0.1.6"], "transient-bundle");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("restarted: pid 222, version 0.1.6");
  });

  it("passes the exact Cadence PID to the guarded click and surfaces refusal", () => {
    const result = run(["click", "test-mac", "12", "34"], "click-refused");
    expect(result.status).toBe(1);
    expect(calls().at(-1)?.command).toContain("/click\" '111' '12' '34'");
    expect(result.stderr).toContain("Cadence is not frontmost");
  });

  it("fails a device read when SSH fails instead of interpreting empty output", () => {
    const result = run(["ax", "test-mac", "locate", "AXButton", "Sync now"], "ssh-failure");
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("restarted:");
  });
});

describe("device JXA helpers", () => {
  it.each(["read", "find", "press"])("%s selects the supplied process and fails if it does not exist", (helper) => {
    let selected = "";
    const context = { Application: () => ({ processes: { byName: (name: string) => {
      selected = name;
      return { exists: () => false };
    } } }) };
    const script = readFileSync(`scripts/test-device-ax/${helper}.js`, "utf8");
    expect(() => runInNewContext(script + '\nrun(["Configured Cadence", "AXButton", "Sync now"]);', context)).toThrow("process not found");
    expect(selected).toBe("Configured Cadence");
  });
});
