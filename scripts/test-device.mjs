#!/usr/bin/env node
// Drives registered test devices over Tailscale SSH. See docs/TEST_DEVICES.md.
// The inventory stays outside this public repository; this script never changes
// device permissions, quits apps, or prints record content.
import { spawnSync } from "node:child_process";
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
  node scripts/test-device.mjs ax <device> read [limit] | find <regex> | press <role> <name>
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
  if (!["read", "find", "press"].includes(action)) fail(USAGE);
  syncAxHelpers(target);
  run(target, `osascript -l JavaScript "$HOME/${REMOTE_AX_DIR}/${action}.js" ${args.map(quote).join(" ")}`);
} else {
  fail(USAGE);
}
