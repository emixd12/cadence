#!/usr/bin/env node
// Drives registered test devices over Tailscale SSH. See docs/TEST_DEVICES.md.
// The inventory stays outside this public repository; this script never changes
// device permissions. AX reads and explicit exec commands can expose private data.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INVENTORY = join(homedir(), "Library", "Application Support", "Cadence Release", "test-devices.json");
const AX_DIR = join(dirname(fileURLToPath(import.meta.url)), "test-device-ax");
const REMOTE_AX_DIR = "Library/Application Support/Cadence Release/test-device-ax";
const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes"];
const USAGE = `Usage:
  node scripts/test-device.mjs list
  node scripts/test-device.mjs check <device>
  node scripts/test-device.mjs exec <device> -- <remote shell command>
  node scripts/test-device.mjs ax <device> read [limit] | find <regex> | press <role> <name> | locate <role> <name>
  node scripts/test-device.mjs click <device> <x> <y>
  node scripts/test-device.mjs update-install <device> <expected-version>
Inventory: CADENCE_TEST_DEVICES or ${DEFAULT_INVENTORY}`;

function fail(message) { console.error(message); process.exit(1); }

function loadInventory() {
  const path = process.env.CADENCE_TEST_DEVICES || DEFAULT_INVENTORY;
  if (!existsSync(path)) fail(`No device inventory at ${path}. Copy docs/examples/test-devices.example.json there.`);
  let inventory;
  try { inventory = JSON.parse(readFileSync(path, "utf8")); }
  catch { fail(`${path} must contain valid JSON.`); }
  const devices = inventory?.devices;
  if (!Array.isArray(devices)) fail(`${path} must contain a "devices" array.`);
  const names = new Set();
  for (const device of devices) {
    if (!device || typeof device !== "object") fail("Every device must be an object.");
    for (const key of ["name", "host", "user"]) {
      if (typeof device[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(device[key])) fail(`Device ${JSON.stringify(device.name)} needs a plain "${key}".`);
    }
    if (names.has(device.name)) fail(`Duplicate device name "${device.name}".`);
    names.add(device.name);
    for (const key of ["app", "process", "node"]) {
      if (device[key] !== undefined && (typeof device[key] !== "string" || !device[key] || /[\x00-\x1f]/.test(device[key])))
        fail(`Device "${device.name}" needs a nonempty "${key}" without control characters.`);
    }
    if (device.app !== undefined && !device.app.startsWith("/")) fail(`Device "${device.name}" needs an absolute app path.`);
  }
  return devices;
}

function device(name) {
  const found = loadInventory().find((entry) => entry.name === name);
  if (!found) fail(`Unknown device "${name}". Run: node scripts/test-device.mjs list`);
  return found;
}

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function ssh(target, command, { input, timeoutMs = 120_000 } = {}) {
  return spawnSync("ssh", [...SSH_OPTIONS, "--", `${target.user}@${target.host}`, command], { encoding: "utf8", input, timeout: timeoutMs });
}

function run(target, command, options) {
  const result = ssh(target, command, options);
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) fail(result.error.code === "ETIMEDOUT" ? "SSH command timed out. A first System Events call may need the owner to answer its prompt." : `SSH failed: ${result.error.code ?? "unknown error"}`);
  process.exitCode = result.status ?? 1;
  return result;
}

function syncAxHelpers(target) {
  for (const file of ["read.js", "find.js", "press.js"]) {
    const body = readFileSync(join(AX_DIR, file), "utf8");
    const result = ssh(target, `umask 077; mkdir -p "$HOME/${REMOTE_AX_DIR}" && cat > "$HOME/${REMOTE_AX_DIR}/${file}"`, { input: body });
    if (result.status !== 0) fail(`Could not copy ${file}: ${(result.stderr ?? "").trim()}`);
  }
}

// Native helpers compile on the device; a source hash marks each build.
function syncNativeHelpers(target) {
  for (const tool of ["axelement", "click"]) {
    const body = readFileSync(join(AX_DIR, `${tool}.swift`), "utf8");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const dir = `"$HOME/${REMOTE_AX_DIR}"`;
    const result = ssh(target, `umask 077; mkdir -p ${dir} && cd ${dir} && if [ ! -x ${tool} ] || [ "$(cat ${tool}.sha 2>/dev/null)" != ${hash} ]; then cat > ${tool}.swift && swiftc -O -o ${tool}.next ${tool}.swift && mv ${tool}.next ${tool} && echo ${hash} > ${tool}.sha; else cat > /dev/null; fi`,
      { input: body, timeoutMs: 300_000 });
    if (result.status !== 0) fail(`Could not build ${tool} on ${target.name}: ${(result.stderr ?? "").trim()}`);
  }
}

function helper(target, args) {
  const result = ssh(target, `"$HOME/${REMOTE_AX_DIR}/${args[0]}" ${args.slice(1).map(quote).join(" ")}`);
  let parsed = null;
  try { parsed = JSON.parse((result.stdout ?? "").trim().split("\n").pop()); } catch { /* click prints nothing */ }
  return { status: result.status, parsed, stderr: result.stderr ?? "" };
}

function readRemote(target, command) {
  const result = ssh(target, command, { timeoutMs: 10_000 });
  if (result.status !== 0) fail(`Could not read device state (${result.error?.code ?? result.status ?? "SSH failure"}).`);
  return result.stdout.trim();
}

function appExecutable(target) {
  const app = target.app ?? "/Applications/Cadence.app";
  const executable = readRemote(target, `/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' ${quote(`${app}/Contents/Info.plist`)}`);
  if (!executable || /[/\\\x00-\x1f]/.test(executable)) fail("The app has no valid executable name.");
  return `${app}/Contents/MacOS/${executable}`;
}

function appPid(target, executable = appExecutable(target)) {
  // comm contains the executable path, without arguments. Unlike pgrep -f, this
  // cannot select the SSH shell merely because its command mentions the app.
  const pids = readRemote(target, "ps -axww -o pid=,comm=").split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && match[2] === executable ? [match[1]] : [];
  });
  if (pids.length > 1) fail("Multiple copies of Cadence are running; inspect the device before continuing.");
  return pids[0] ?? "";
}

function appVersion(target, installing = false) {
  const command = `/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' ${quote(`${target.app ?? "/Applications/Cadence.app"}/Contents/Info.plist`)}`;
  // The updater briefly removes the old bundle before moving the new one in.
  // An SSH failure still aborts; an absent plist during installation is retried.
  return readRemote(target, installing ? `${command} 2>/dev/null || true` : command);
}
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitFor(read, accepts, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = read();
    if (accepts(value)) return value;
    if (Date.now() >= deadline) return null;
    pause(Math.min(2000, deadline - Date.now()));
  } while (Date.now() <= deadline);
  return null;
}

// Only a fresh, named AX action may restart automatically. Installation changes
// the panel layout (including removing release notes), so pre-install coordinates
// cannot identify Restart Cadence. If macOS refuses AX after bundle replacement,
// stop for a fresh visual inspection instead of clicking the old position.
function updateInstall(target, expectedVersion) {
  syncNativeHelpers(target);
  const executable = appExecutable(target);
  const pid = appPid(target, executable);
  if (!pid) fail("Cadence is not running.");
  const before = appVersion(target);
  if (before === expectedVersion) fail(`Cadence ${expectedVersion} is already on disk; inspect the running app before continuing.`);
  const ready = helper(target, ["axelement", pid, "find", "AXStaticText", `Cadence ${expectedVersion} is ready to install.`]);
  if (ready.status !== 0) fail(`The expected update ${expectedVersion} is not ready to install. Open Settings › App updates and verify the candidate.`);
  const install = helper(target, ["axelement", pid, "press", "AXButton", "Install update"]);
  if (install.status !== 0) fail("Could not press Install update.");
  console.log(`pid ${pid}, version ${before}; pressed Install update for ${expectedVersion}`);
  const installed = waitFor(() => appVersion(target, true), (version) => version && version !== before, 120_000);
  if (!installed) fail("The bundle on disk did not change within 2 minutes. Inspect the update panel.");
  if (installed !== expectedVersion) fail(`Unexpected installed version ${installed}; expected ${expectedVersion}. No restart was attempted.`);
  console.log(`installed ${installed} on disk`);
  if (appPid(target, executable) !== pid) fail("The running process changed during installation. Inspect the device; no restart was attempted.");
  const restart = helper(target, ["axelement", pid, "press", "AXButton", "Restart Cadence"]);
  if (restart.status !== 0) fail("The update is installed but was not restarted. Fresh accessibility could not press Restart Cadence. Inspect the current window with Computer Use; never reuse pre-install coordinates.");
  const next = waitFor(() => appPid(target), (value) => value && value !== pid, 30_000);
  if (!next) fail("Cadence did not restart within 30 seconds. Inspect pending writes or unsaved drafts; no coordinate click was attempted.");
  if (appVersion(target) !== expectedVersion) fail("The installed version changed during restart; acceptance is not verified.");
  console.log(`restarted: pid ${next}, version ${expectedVersion}`);
}

const [command, name, ...rest] = process.argv.slice(2);
if (command === "list") {
  for (const entry of loadInventory()) console.log(`${entry.name}\t${entry.platform ?? "macos"}\t${entry.description ?? ""}`);
} else if (command === "check") {
  const target = device(name);
  const app = target.app ?? "/Applications/Cadence.app";
  const proc = JSON.stringify(target.process ?? "cadence-desktop-spike");
  console.log(appPid(target) ? "Cadence running" : "Cadence not running");
  run(target, [
    "echo \"macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)) $(uname -m) $(sysctl -n hw.model)\"",
    `echo "Cadence $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' ${quote(`${app}/Contents/Info.plist`)} 2>/dev/null || echo 'not installed')"`,
    `echo "node: $(${quote(target.node ?? "node")} -v 2>/dev/null || echo missing)"`,
    `osascript -l JavaScript -e ${quote(`Application("System Events").processes.whose({backgroundOnly:false})().length + " apps visible to System Events"`)}`,
    `osascript -l JavaScript -e ${quote(`const p=Application("System Events").processes.byName(${proc}); if (!p.exists()) throw new Error("no Cadence process"); p.windows.length + " Cadence windows"`)}`,
  ].join("; "), { timeoutMs: 60_000 });
} else if (command === "exec") {
  const target = device(name);
  if (rest[0] !== "--" || rest.length < 2) fail(USAGE);
  run(target, rest.slice(1).join(" "));
} else if (command === "ax") {
  const target = device(name);
  const [action, ...args] = rest;
  if (action === "locate") {
    syncNativeHelpers(target);
    const pid = appPid(target);
    if (!pid || args.length !== 2) fail(pid ? USAGE : "Cadence is not running.");
    const found = helper(target, ["axelement", pid, "find", ...args]);
    console.log(JSON.stringify(found.parsed));
    process.exit(found.status ?? 1);
  }
  if (!["read", "find", "press"].includes(action)) fail(USAGE);
  if ((action === "read" && (args.length > 1 || (args[0] !== undefined && !/^[1-9]\d{0,3}$/.test(args[0]))))
    || (action === "find" && args.length !== 1) || (action === "press" && args.length !== 2)) fail(USAGE);
  if (action === "find") { try { new RegExp(args[0]); } catch { fail("Invalid find regular expression."); } }
  syncAxHelpers(target);
  run(target, `osascript -l JavaScript "$HOME/${REMOTE_AX_DIR}/${action}.js" ${[target.process ?? "cadence-desktop-spike", ...args].map(quote).join(" ")}`);
} else if (command === "click") {
  const target = device(name);
  if (rest.length !== 2 || !rest.every((value) => /^-?\d+(\.\d+)?$/.test(value))) fail(USAGE);
  syncNativeHelpers(target);
  const pid = appPid(target);
  if (!pid) fail("Cadence is not running.");
  const result = helper(target, ["click", pid, ...rest]);
  if (result.status !== 0) fail(`Click refused: ${(result.stderr ?? "").trim() || "Cadence must be frontmost and own the target point."}`);
} else if (command === "update-install") {
  if (rest.length !== 1 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rest[0])) fail(USAGE);
  updateInstall(device(name), rest[0]);
} else {
  fail(USAGE);
}
