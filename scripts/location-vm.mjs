#!/usr/bin/env node
// Runs Cadence for Mac location checks in a disposable copy of a Tart VM image.
// See docs/plans/2026-10-27-location-vm-images.md. The owner sets each image's
// location state by hand once; this script never changes Location Services,
// TCC, Gatekeeper or other privacy settings, and never answers a prompt.
// Checks reuse scripts/test-device.mjs and its accessibility helpers.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATES = ["never-asked", "allowed", "denied"];
const PREFIX = "cadence-loc-";
const VM_HOME = join(homedir(), "Library", "Application Support", "Cadence Release", "location-vm");
const TART = process.env.CADENCE_TART || join(homedir(), "Library", "Application Support", "Cadence Release", "tools", "tart.app", "Contents", "MacOS", "tart");
const TEST_DEVICE = join(dirname(fileURLToPath(import.meta.url)), "test-device.mjs");
const SHARE = "/Volumes/My Shared Files/cadence-dmg";
// Cadence logs state and reason only. CoreLocationAgent logs the prompt and its answer.
const LOG_PREDICATE = 'eventMessage CONTAINS "cadence location result" OR (process == "CoreLocationAgent" AND (eventMessage CONTAINS "auth-prompt" OR eventMessage CONTAINS "AuthPrompt"))';
const USAGE = `Usage:
  node scripts/location-vm.mjs images
  node scripts/location-vm.mjs run <${STATES.join("|")}> <path to Cadence DMG> [--keep]
Images are Tart VMs named ${PREFIX}<state>. Results go to ${join(VM_HOME, "runs")}.`;

function fail(message) { console.error(message); process.exit(1); }
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function tart(args, { timeoutMs = 600_000 } = {}) {
  const result = spawnSync(TART, args, { encoding: "utf8", timeout: timeoutMs });
  if (result.error) throw new Error(`tart ${args[0]} failed: ${result.error.code ?? result.error.message}`);
  return result;
}

function images() {
  const result = tart(["list", "--source", "local", "--format", "json"]);
  if (result.status !== 0) throw new Error(`tart list failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout).filter((vm) => vm.Name.startsWith(PREFIX));
}

// Drops anything that looks like a coordinate, so results never record a position.
export function scrubLog(text) {
  return text.split("\n").filter((line) => line.trim() && !/-?\d{1,3}\.\d{4,}/.test(line)).slice(-200);
}

// The "Device location: …" line from an accessibility find.
export function permissionLine(text) {
  return text.match(/Device location: [^|\n]*/)?.[0].trim() ?? null;
}

function device(inventory, name, args, timeoutMs = 120_000) {
  const result = spawnSync(process.execPath, [TEST_DEVICE, args[0], name, ...args.slice(1)], {
    encoding: "utf8", timeout: timeoutMs, env: { ...process.env, CADENCE_TEST_DEVICES: inventory },
  });
  return { status: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function run(state, dmg, keep) {
  if (!STATES.includes(state)) fail(USAGE);
  if (!existsSync(dmg) || !statSync(dmg).isFile() || !dmg.endsWith(".dmg")) fail(`No DMG at ${dmg}.`);
  for (const file of ["id_ed25519", "known_hosts"]) if (!existsSync(join(VM_HOME, file))) fail(`Missing ${join(VM_HOME, file)}; see the plan's image setup.`);
  const image = `${PREFIX}${state}`;
  if (!images().some((vm) => vm.Name === image)) fail(`No image ${image}. Run: node scripts/location-vm.mjs images`);
  if (images().some((vm) => vm.Name.startsWith(`${PREFIX}run-`) && vm.State === "running")) fail("Another run copy is running; one copy runs at a time.");

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const clone = `${PREFIX}run-${state}-${stamp}-${randomUUID().slice(0, 8)}`;
  const result = { image, clone, startedAt: new Date().toISOString(),
    dmg: { name: basename(dmg), sha256: createHash("sha256").update(readFileSync(dmg)).digest("hex") }, steps: {} };
  const scratch = mkdtempSync(join(tmpdir(), "cadence-location-vm-"));
  let cloneCreated = false;
  try {
    // Share only the selected DMG, under a fixed name. Its original basename is
    // evidence only and never enters a shell command or a Tart share argument.
    const share = join(scratch, "share");
    mkdirSync(share);
    copyFileSync(dmg, join(share, "candidate.dmg"));
    if (tart(["clone", image, clone]).status !== 0) throw new Error(`tart clone ${image} failed`);
    cloneCreated = true;
    const vm = spawn(TART, ["run", clone, "--no-audio", "--no-clipboard", `--dir=cadence-dmg:${share}:ro`], { stdio: "ignore", detached: true });
    vm.unref();
    const address = tart(["ip", clone, "--wait", "240"]);
    if (address.status !== 0) throw new Error("The copy did not report an IP address.");
    const ip = address.stdout.trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error("The copy did not report an IP address.");
    const inventory = join(scratch, "devices.json");
    writeFileSync(inventory, JSON.stringify({ devices: [{ name: clone, host: ip, user: "admin", process: "cadence-desktop-spike",
      identity: join(VM_HOME, "id_ed25519"), knownHosts: join(VM_HOME, "known_hosts"), hostKeyAlias: "cadence-loc-vm" }] }));
    const exec = (command, timeoutMs) => device(inventory, clone, ["exec", "--", command], timeoutMs);
    const ax = (...args) => device(inventory, clone, ["ax", ...args]);
    const step = (key, value) => { result.steps[key] = value; console.log(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`); };

    checkGuest(state, { exec, ax, step });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error(result.error);
  } finally {
    result.deleted = false;
    if (cloneCreated && (!keep || !result.error)) {
      try {
        const stopped = tart(["stop", clone, "--timeout", "30"]);
        if (stopped.status !== 0) throw new Error("The VM copy did not stop.");
        result.deleted = tart(["delete", clone]).status === 0;
        if (!result.deleted) throw new Error("The VM copy could not be deleted.");
      } catch (error) {
        result.cleanupError = error instanceof Error ? error.message : String(error);
        console.error(result.cleanupError);
      }
    }
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(join(VM_HOME, "runs"), { recursive: true, mode: 0o700 });
    const file = join(VM_HOME, "runs", `${clone}.json`);
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`result: ${file}${result.deleted ? "" : ` (copy ${clone} kept)`}`);
    if (result.error || result.cleanupError) process.exitCode = 1;
  }
}

function checked(label, response) {
  if (response.status !== 0) throw new Error(`${label} failed (exit ${response.status}).`);
  return response.out;
}

// The same sequence runs against SSH in the CLI and a synthetic peer in tests.
// A successful command alone is insufficient: the observed state must match
// the selected image, and Gatekeeper must identify a notarized Developer ID.
export function checkGuest(state, { exec, ax, step = () => {}, pause: delay = pause, waitUntil: wait = waitUntil }) {
  const expected = { "never-asked": "not yet allowed", allowed: "allowed", denied: "blocked" }[state];
  if (!expected) throw new Error("Unknown location VM state.");
  const record = (key, response) => { step(key, response.out); return checked(key, response); };
  const permission = (key) => {
    const line = permissionLine(checked(key, ax("find", "Device location")));
    step(key, line);
    if (!line?.startsWith(`Device location: ${expected}.`)) throw new Error(`${key}: expected ${expected}, observed ${line ?? "no permission line"}.`);
  };
  const button = (name) => checked(`Find ${name}`, ax("find", `^AXButton ${name}$`)).includes(name);

  if (!wait(() => exec("true", 15_000).status === 0, 180_000)) throw new Error("SSH did not answer in the copy.");
  const guest = record("guest", exec("sw_vers -productVersion && sw_vers -buildVersion && spctl --status"));
  if (!guest.includes("assessments enabled")) throw new Error("Gatekeeper assessments are not enabled in the copy.");

  // The host stages only this file. No user-provided basename enters the shell.
  const downloaded = '"$HOME/Downloads/cadence-location-candidate.dmg"';
  checked("Copy and quarantine DMG", exec(`cp ${quote(`${SHARE}/candidate.dmg`)} ${downloaded} && xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;" ${downloaded}`));
  const assess = (key, command) => {
    if (!record(key, exec(command)).includes("source=Notarized Developer ID")) throw new Error(`${key} did not identify a Notarized Developer ID.`);
  };
  assess("gatekeeperDmg", `spctl -a -vv -t open --context context:primary-signature ${downloaded} 2>&1`);
  // Do not pipe to awk: the pipeline would hide an attach failure.
  const mounted = checked("Mount DMG", exec(`hdiutil attach -nobrowse -readonly ${downloaded} 2>/dev/null`));
  const mount = mounted.split("\n").map((line) => line.split("\t").at(-1)?.trim()).filter((line) => line?.startsWith("/Volumes/")).pop();
  if (!mount) throw new Error("The DMG did not mount in the copy.");
  const candidate = `${mount}/Cadence.app`;
  assess("gatekeeperApp", `spctl -a -vv -t exec ${quote(candidate)} 2>&1`);
  record("syspolicyCheck", exec(`syspolicy_check distribution ${quote(candidate)} 2>&1`, 300_000));
  const candidateVersion = record("candidateVersion", exec(`/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' ${quote(`${candidate}/Contents/Info.plist`)}`));
  if (!candidateVersion) throw new Error("The candidate has no version.");
  record("previousVersion", exec("/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Cadence.app/Contents/Info.plist"));
  if (!quitCadence(exec, wait)) throw new Error("Cadence did not quit normally before the install.");
  checked("Install DMG", exec(`rm -rf /Applications/Cadence.app && ditto --noqtn ${quote(candidate)} /Applications/Cadence.app && hdiutil detach -quiet ${quote(mount)}`));
  const installedVersion = record("installedVersion", exec("/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Cadence.app/Contents/Info.plist"));
  if (installedVersion !== candidateVersion) throw new Error("The installed version does not match the candidate.");
  record("codesign", exec("codesign --verify --strict /Applications/Cadence.app 2>&1"));

  checked("Start location log", exec(`nohup /usr/bin/log stream --level info --style compact --predicate ${quote(LOG_PREDICATE)} > "$HOME/cadence-location.log" 2>&1 &`));
  checked("Open Cadence", exec("open -a /Applications/Cadence.app"));
  // open returns before the process and window exist; AX lookup failures are
  // expected during startup. Keep retrying until the window is ready or timeout.
  if (!wait(() => {
    const response = ax("find", "^AXButton Open navigation$");
    return response.status === 0 && response.out.includes("Open navigation");
  }, 90_000)) throw new Error("No Cadence window in the copy.");
  openSettings(ax, wait, delay);
  step("permissionAtLaunch", permissionLine(checked("Read launch permission", ax("find", "Device location"))));

  const travelAtLaunch = travelState(ax);
  step("travelAtLaunch", travelAtLaunch);
  if (travelAtLaunch === "unknown") throw new Error("Settings did not show the Travel estimates checkbox.");
  if (travelAtLaunch === "on") setTravel(ax, "off", wait);
  setTravel(ax, "on", wait);
  step("travelOn", "on");
  delay(15_000);
  permission("permissionAfterRequest");
  if (button("Check again")) {
    checked("Press Check again", ax("press", "AXButton", "Check again")); delay(15_000);
    permission("permissionAfterCheckAgain");
  } else {
    if (state !== "allowed") throw new Error("Check again is missing for a permission that is not allowed.");
    step("permissionAfterCheckAgain", "Not required: the allowed state has no recovery button.");
  }
  if (button("Open Location Services")) {
    checked("Press Open Location Services", ax("press", "AXButton", "Open Location Services")); delay(4000);
    const frontmost = record("openLocationServices", exec(`osascript -l JavaScript -e 'Application("System Events").processes.whose({frontmost:true})()[0].name()'`));
    if (frontmost !== "System Settings") throw new Error("Open Location Services did not open System Settings.");
    checked("Quit System Settings", exec(`osascript -e 'tell application "System Settings" to quit'`));
  } else {
    if (state !== "allowed") throw new Error("Open Location Services is missing for a permission that is not allowed.");
    step("openLocationServices", "Not required: the allowed state has no recovery button.");
  }
  step("log", scrubLog(checked("Read location log", exec(`cat "$HOME/cadence-location.log"`))));
}

function quitCadence(exec, wait) {
  // pgrep -f also matches the SSH shell whose argument mentions the app path.
  const running = () => checked("Read Cadence process", exec("ps -axww -o pid=,comm=")).split("\n")
    .some((line) => /^\s*\d+\s+\/Applications\/Cadence\.app\/Contents\/MacOS\/[^/]+$/.test(line));
  if (!running()) return true;
  checked("Quit Cadence", exec(`osascript -e 'tell application "Cadence" to quit'`));
  return wait(() => !running(), 30_000);
}

function waitUntil(test, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (test()) return true; pause(3000); }
  return false;
}

// find.js prints a checkbox's numeric value, so the line ends "| 1" when it is on.
export function checkboxState(text) {
  const value = text.match(/AXCheckBox: [^\n]*\| ([01])$/m)?.[1];
  return value === "1" ? "on" : value === "0" ? "off" : "unknown";
}

function travelState(ax) {
  return checkboxState(checked("Read Travel estimates", ax("find", "^AXCheckBox Travel estimates")));
}

// find.js matches "<role> <text>" and prints "<role>: <text>".
function setTravel(ax, want, wait) {
  if (ax("press", "AXCheckBox", "Travel estimates").status !== 0) throw new Error(`Could not press Travel estimates to turn it ${want}.`);
  if (!wait(() => travelState(ax) === want, 15_000)) throw new Error(`Travel estimates did not turn ${want}.`);
}

function openSettings(ax, wait, delay) {
  checked("Open navigation", ax("press", "AXButton", "Open navigation")); delay(2000);
  checked("Open Settings", ax("press", "AXButton", "Settings"));
  if (!wait(() => checked("Read Device location", ax("find", "Device location")).includes("Device location"), 30_000)) throw new Error("Settings › Travel did not show the Device location line.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "images") {
    for (const vm of images()) console.log(`${vm.Name}\t${vm.State}\t${vm.Size ?? ""} GB`);
  } else if (command === "run" && (args.length === 2 || (args.length === 3 && args[2] === "--keep"))) {
    run(args[0], args[1], args[2] === "--keep");
  } else fail(USAGE);
}
