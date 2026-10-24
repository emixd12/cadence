#!/usr/bin/env node
// Drives registered test devices over Tailscale SSH. See docs/TEST_DEVICES.md.
// The inventory stays outside this public repository; this script never changes
// device permissions, quits apps, or prints record content.
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
  node scripts/test-device.mjs update-install <device>
Inventory: CADENCE_TEST_DEVICES or ${DEFAULT_INVENTORY}`;

function fail(message) { console.error(message); process.exit(1); }

function loadInventory() {
  const path = process.env.CADENCE_TEST_DEVICES || DEFAULT_INVENTORY;
  if (!existsSync(path)) fail(`No device inventory at ${path}. Copy docs/examples/test-devices.example.json there.`);
  const devices = JSON.parse(readFileSync(path, "utf8")).devices;
  if (!Array.isArray(devices)) fail(`${path} must contain a "devices" array.`);
  for (const device of devices) {
    for (const key of ["name", "host", "user"]) {
      if (typeof device[key] !== "string" || !/^[A-Za-z0-9._-]+$/.test(device[key])) fail(`Device ${JSON.stringify(device.name)} needs a plain "${key}".`);
    }
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
  return spawnSync("ssh", [...SSH_OPTIONS, `${target.user}@${target.host}`, command], { encoding: "utf8", input, timeout: timeoutMs });
}

function run(target, command, options) {
  const result = ssh(target, command, options);
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error?.code === "ETIMEDOUT") fail("Timed out. A first System Events call can wait on an Automation prompt on the device; the owner answers it.");
  process.exitCode = result.status ?? 1;
  return result;
}

function syncAxHelpers(target) {
  for (const file of ["read.js", "find.js", "press.js"]) {
    const body = readFileSync(join(AX_DIR, file), "utf8");
    const result = ssh(target, `mkdir -p "$HOME/${REMOTE_AX_DIR}" && cat > "$HOME/${REMOTE_AX_DIR}/${file}"`, { input: body });
    if (result.status !== 0) fail(`Could not copy ${file}: ${result.stderr.trim()}`);
  }
}

// Native helpers compile on the device; a source hash marks each build.
function syncNativeHelpers(target) {
  for (const tool of ["axelement", "click"]) {
    const body = readFileSync(join(AX_DIR, `${tool}.swift`), "utf8");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const dir = `"$HOME/${REMOTE_AX_DIR}"`;
    const result = ssh(target, `mkdir -p ${dir} && cd ${dir} && if [ "$(cat ${tool}.sha 2>/dev/null)" != ${hash} ]; then cat > ${tool}.swift && swiftc -O -o ${tool} ${tool}.swift && echo ${hash} > ${tool}.sha; else cat > /dev/null; fi`,
      { input: body, timeoutMs: 300_000 });
    if (result.status !== 0) fail(`Could not build ${tool} on ${target.name}: ${result.stderr.trim()}`);
  }
}

function helper(target, args) {
  const result = ssh(target, `"$HOME/${REMOTE_AX_DIR}/${args[0]}" ${args.slice(1).map(quote).join(" ")}`);
  let parsed = null;
  try { parsed = JSON.parse(result.stdout.trim().split("\n").pop()); } catch { /* click prints nothing */ }
  return { status: result.status, parsed, stderr: result.stderr };
}

const appPid = (target) => {
  const app = target.app ?? "/Applications/Cadence.app";
  return ssh(target, `pgrep -f ${quote(`${app}/Contents/MacOS/`)} | head -1`).stdout.trim();
};
const appVersion = (target) => ssh(target, `/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' ${quote(`${target.app ?? "/Applications/Cadence.app"}/Contents/Info.plist`)}`).stdout.trim();
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Install a downloaded update, then restart. After the updater deletes the old
// bundle, macOS refuses accessibility to the still-running process (-25211), so
// Restart Cadence is clicked by position. Once installed, the panel drops Check for
// updates and Restart Cadence takes its slot (desktop-update-panel.tsx, canCheck),
// so the slot is recorded before installing and clicked near its left edge.
function updateInstall(target) {
  syncNativeHelpers(target);
  const pid = appPid(target);
  if (!pid) fail("Cadence is not running.");
  const before = appVersion(target);
  const slot = helper(target, ["axelement", pid, "show", "AXButton", "Check for updates"]).parsed;
  if (!slot?.width) fail("Could not locate Check for updates. Open Settings › App updates on the device first.");
  if (slot.top < 0 || slot.left < 0 || slot.top + slot.height > slot.screenHeight || slot.left + slot.width > slot.screenWidth)
    fail(`Check for updates is off-screen at ${slot.left},${slot.top} (screen ${slot.screenWidth}x${slot.screenHeight}). Scroll Settings so it is visible, then retry.`);
  const install = helper(target, ["axelement", pid, "press", "AXButton", "Install update"]);
  if (install.status !== 0) fail(`Could not press Install update: ${JSON.stringify(install.parsed)} ${install.stderr.trim()}`);
  const x = Math.round(slot.left + Math.min(24, slot.width / 2));
  const y = Math.round(slot.top + slot.height / 2);
  console.log(`pid ${pid}, version ${before}; pressed Install update; restart slot ${x},${y}`);
  let installed = "";
  for (let i = 0; i < 60 && !installed; i += 1) { pause(2000); const now = appVersion(target); if (now && now !== before) installed = now; }
  if (!installed) fail("The bundle on disk did not change within 2 minutes. Read the update panel with: ax <device> find update");
  console.log(`installed ${installed} on disk`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    pause(3000);
    helper(target, ["click", String(x), String(y)]);
    for (let i = 0; i < 10; i += 1) {
      pause(2000);
      const next = appPid(target);
      if (next && next !== pid) { console.log(`restarted: pid ${next}, version ${appVersion(target)} (click ${attempt})`); return; }
    }
  }
  fail("Cadence did not restart. The click may have missed, or the restart was refused for pending writes or drafts; the owner checks the window.");
}

const [command, name, ...rest] = process.argv.slice(2);
if (command === "list") {
  for (const entry of loadInventory()) console.log(`${entry.name}\t${entry.platform ?? "macos"}\t${entry.description ?? ""}`);
} else if (command === "check") {
  const target = device(name);
  const app = target.app ?? "/Applications/Cadence.app";
  const proc = target.process ?? "cadence-desktop-spike";
  run(target, [
    "echo \"macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)) $(uname -m) $(sysctl -n hw.model)\"",
    `echo "Cadence $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' ${quote(`${app}/Contents/Info.plist`)} 2>/dev/null || echo 'not installed')"`,
    `pgrep -f ${quote(`${app}/Contents/MacOS/`)} >/dev/null && echo "Cadence running" || echo "Cadence not running"`,
    `echo "node: $(${quote(target.node ?? "node")} -v 2>/dev/null || echo missing)"`,
    `osascript -l JavaScript -e ${quote(`Application("System Events").processes.whose({backgroundOnly:false})().length + " apps visible to System Events"`)} 2>&1 | sed 's/^/accessibility: /'`,
    `osascript -l JavaScript -e ${quote(`const p=Application("System Events").processes.byName("${proc}"); p.exists() ? p.windows.length + " Cadence windows" : "no Cadence process"`)} 2>&1 | sed 's/^/cadence window: /'`,
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
  syncAxHelpers(target);
  run(target, `osascript -l JavaScript "$HOME/${REMOTE_AX_DIR}/${action}.js" ${args.map(quote).join(" ")}`);
} else if (command === "click") {
  const target = device(name);
  if (rest.length !== 2 || !rest.every((value) => /^-?\d+(\.\d+)?$/.test(value))) fail(USAGE);
  syncNativeHelpers(target);
  process.exit(helper(target, ["click", ...rest]).status ?? 1);
} else if (command === "update-install") {
  updateInstall(device(name));
} else {
  fail(USAGE);
}
