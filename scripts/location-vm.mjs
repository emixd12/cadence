#!/usr/bin/env node
// Runs Cadence for Mac location checks in a disposable copy of a Tart VM image.
// See docs/plans/2026-10-27-location-vm-images.md. The owner sets each image's
// location state by hand once; this script never changes Location Services,
// TCC, Gatekeeper or other privacy settings, and never answers a prompt.
// Checks reuse scripts/test-device.mjs and its accessibility helpers.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATES = ["never-asked", "allowed", "denied"];
const PREFIX = "cadence-loc-";
const HOME = join(homedir(), "Library", "Application Support", "Cadence Release", "location-vm");
const TART = process.env.CADENCE_TART || join(homedir(), "Library", "Application Support", "Cadence Release", "tools", "tart.app", "Contents", "MacOS", "tart");
const TEST_DEVICE = join(dirname(fileURLToPath(import.meta.url)), "test-device.mjs");
const SHARE = "/Volumes/My Shared Files/cadence-dmg";
// Cadence logs state and reason only. CoreLocationAgent logs the prompt and its answer.
const LOG_PREDICATE = 'eventMessage CONTAINS "cadence location result" OR (process == "CoreLocationAgent" AND (eventMessage CONTAINS "auth-prompt" OR eventMessage CONTAINS "AuthPrompt"))';
const USAGE = `Usage:
  node scripts/location-vm.mjs images
  node scripts/location-vm.mjs run <${STATES.join("|")}> <path to Cadence DMG> [--keep]
Images are Tart VMs named ${PREFIX}<state>. Results go to ${join(HOME, "runs")}.`;

function fail(message) { console.error(message); process.exit(1); }
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function tart(args, { timeoutMs = 600_000 } = {}) {
  const result = spawnSync(TART, args, { encoding: "utf8", timeout: timeoutMs });
  if (result.error) fail(`tart ${args[0]} failed: ${result.error.code ?? result.error.message}`);
  return result;
}

function images() {
  const result = tart(["list", "--source", "local", "--format", "json"]);
  if (result.status !== 0) fail(`tart list failed: ${result.stderr.trim()}`);
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
  for (const file of ["id_ed25519", "known_hosts"]) if (!existsSync(join(HOME, file))) fail(`Missing ${join(HOME, file)}; see the plan's image setup.`);
  const image = `${PREFIX}${state}`;
  if (!images().some((vm) => vm.Name === image)) fail(`No image ${image}. Run: node scripts/location-vm.mjs images`);
  if (images().some((vm) => vm.Name.startsWith(`${PREFIX}run-`) && vm.State === "running")) fail("Another run copy is running; one copy runs at a time.");

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const clone = `${PREFIX}run-${state}-${stamp}`;
  const result = { image, clone, startedAt: new Date().toISOString(),
    dmg: { name: basename(dmg), sha256: createHash("sha256").update(readFileSync(dmg)).digest("hex") }, steps: {} };
  const scratch = mkdtempSync(join(tmpdir(), "cadence-location-vm-"));
  let vm = null;
  try {
    if (tart(["clone", image, clone]).status !== 0) throw new Error(`tart clone ${image} failed`);
    vm = spawn(TART, ["run", clone, "--no-audio", "--no-clipboard", `--dir=cadence-dmg:${dirname(dmg)}:ro`], { stdio: "ignore", detached: true });
    vm.unref();
    const ip = tart(["ip", clone, "--wait", "240"]).stdout.trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error("The copy did not report an IP address.");
    const inventory = join(scratch, "devices.json");
    writeFileSync(inventory, JSON.stringify({ devices: [{ name: clone, host: ip, user: "admin", process: "cadence-desktop-spike",
      identity: join(HOME, "id_ed25519"), knownHosts: join(HOME, "known_hosts"), hostKeyAlias: "cadence-loc-vm" }] }));
    const exec = (command, timeoutMs) => device(inventory, clone, ["exec", "--", command], timeoutMs);
    const ax = (...args) => device(inventory, clone, ["ax", ...args]);
    const step = (key, value) => { result.steps[key] = value; console.log(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`); };

    if (!waitUntil(() => exec("true", 15_000).status === 0, 180_000)) throw new Error("SSH did not answer in the copy.");
    step("guest", exec("sw_vers -productVersion; sw_vers -buildVersion; spctl --status").out);

    // A quarantined copy stands in for a browser download, so Gatekeeper assesses it as one.
    const downloaded = `$HOME/Downloads/${basename(dmg)}`;
    exec(`cp ${quote(`${SHARE}/${basename(dmg)}`)} "${downloaded}" && xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;" "${downloaded}"`);
    step("gatekeeperDmg", exec(`spctl -a -vv -t open --context context:primary-signature "${downloaded}" 2>&1`).out);
    // exec() joins stdout and stderr, and hdiutil warns that attach is deprecated.
    const mount = exec(`hdiutil attach -nobrowse -readonly "${downloaded}" 2>/dev/null | awk -F'\\t' '/\\/Volumes\\// {print $NF}'`).out
      .split("\n").filter((line) => line.startsWith("/Volumes/")).pop();
    if (!mount?.startsWith("/Volumes/")) throw new Error("The DMG did not mount in the copy.");
    step("gatekeeperApp", exec(`spctl -a -vv -t exec ${quote(`${mount}/Cadence.app`)} 2>&1`).out);
    step("syspolicyCheck", exec(`syspolicy_check distribution ${quote(`${mount}/Cadence.app`)} 2>&1 | tail -3`, 300_000).out);
    // Upgrade in place, as a user dragging the app over the old one. Gatekeeper's
    // first-open dialog is a consent prompt, so the running copy has no quarantine.
    step("previousVersion", exec("/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Cadence.app/Contents/Info.plist 2>/dev/null || echo none").out);
    // Deleting a running app's bundle stops accessibility for that process, so quit normally first.
    if (!quitCadence(exec)) throw new Error("Cadence did not quit normally before the install.");
    exec(`rm -rf /Applications/Cadence.app && ditto --noqtn ${quote(`${mount}/Cadence.app`)} /Applications/Cadence.app && hdiutil detach -quiet ${quote(mount)}`);
    step("installedVersion", exec("/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Cadence.app/Contents/Info.plist; codesign --verify --strict /Applications/Cadence.app && echo codesign ok").out);

    exec(`nohup /usr/bin/log stream --level info --style compact --predicate ${quote(LOG_PREDICATE)} > "$HOME/cadence-location.log" 2>&1 &`);
    exec("open -a /Applications/Cadence.app");
    // The window appears before its web content; the navigation button marks a loaded page.
    if (!waitUntil(() => ax("find", "^AXButton Open navigation$").out.includes("Open navigation"), 90_000)) throw new Error("No Cadence window in the copy.");
    openSettings(ax);
    step("permissionAtLaunch", permissionLine(ax("find", "Device location").out));

    // Turning Travel on starts one location request. In the never-asked image it is
    // the first request, and the prompt stays unanswered until the copy is deleted.
    // A run that never started the request must fail rather than report a permission.
    const travelAtLaunch = travelState(ax);
    step("travelAtLaunch", travelAtLaunch);
    if (travelAtLaunch === "unknown") throw new Error("Settings did not show the Travel estimates checkbox.");
    if (travelAtLaunch === "on") setTravel(ax, "off");
    setTravel(ax, "on");
    step("travelOn", "on");
    pause(15_000);
    step("permissionAfterRequest", permissionLine(ax("find", "Device location").out));
    if (ax("find", "^AXButton Check again$").out.includes("Check again")) {
      ax("press", "AXButton", "Check again"); pause(15_000);
      step("permissionAfterCheckAgain", permissionLine(ax("find", "Device location").out));
    } else step("permissionAfterCheckAgain", "Check again not shown");
    if (ax("find", "^AXButton Open Location Services$").out.includes("Open Location Services")) {
      ax("press", "AXButton", "Open Location Services"); pause(4000);
      step("openLocationServices", exec(`osascript -l JavaScript -e 'Application("System Events").processes.whose({frontmost:true})()[0].name()'`).out);
      exec(`osascript -e 'tell application "System Settings" to quit'`);
    } else step("openLocationServices", "button not shown");
    step("log", scrubLog(exec(`cat "$HOME/cadence-location.log"`).out));
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error(result.error);
  } finally {
    if (!keep || !result.error) {
      tart(["stop", clone, "--timeout", "30"]);
      result.deleted = tart(["delete", clone]).status === 0;
    } else result.deleted = false;
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(join(HOME, "runs"), { recursive: true, mode: 0o700 });
    const file = join(HOME, "runs", `${clone}.json`);
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`result: ${file}${result.deleted ? "" : ` (copy ${clone} kept)`}`);
    if (result.error) process.exitCode = 1;
  }
}

function quitCadence(exec) {
  const running = () => exec("pgrep -f /Applications/Cadence.app/Contents/MacOS/ >/dev/null && echo yes || echo no").out === "yes";
  if (!running()) return true;
  exec(`osascript -e 'tell application "Cadence" to quit'`);
  return waitUntil(() => !running(), 30_000);
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
  return checkboxState(ax("find", "^AXCheckBox Travel estimates").out);
}

// find.js matches "<role> <text>" and prints "<role>: <text>".
function setTravel(ax, want) {
  if (ax("press", "AXCheckBox", "Travel estimates").status !== 0) throw new Error(`Could not press Travel estimates to turn it ${want}.`);
  if (!waitUntil(() => travelState(ax) === want, 15_000)) throw new Error(`Travel estimates did not turn ${want}.`);
}

function openSettings(ax) {
  ax("press", "AXButton", "Open navigation"); pause(2000);
  ax("press", "AXButton", "Settings");
  if (!waitUntil(() => ax("find", "Device location").out.includes("Device location"), 30_000)) throw new Error("Settings › Travel did not show the Device location line.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "images") {
    for (const vm of images()) console.log(`${vm.Name}\t${vm.State}\t${vm.Size ?? ""} GB`);
  } else if (command === "run" && (args.length === 2 || (args.length === 3 && args[2] === "--keep"))) {
    run(args[0], args[1], args[2] === "--keep");
  } else fail(USAGE);
}
