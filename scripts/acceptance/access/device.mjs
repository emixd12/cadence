#!/usr/bin/env node
// Test-access adapter for test devices and the Cadence for Mac link (Ticket 286).
//
//   node scripts/acceptance/access/device.mjs inventory        --device <name>   probe: device listed in the private inventory
//   node scripts/acceptance/access/device.mjs reachable        --device <name>   probe: Tailscale SSH with the agent key
//   node scripts/acceptance/access/device.mjs accessibility    --device <name>   probe: System Events answers over SSH
//   node scripts/acceptance/access/device.mjs screen-recording --device <name>   probe: screencapture works (file deleted)
//   node scripts/acceptance/access/device.mjs app-permissions  --device <name>   probe: Cadence Settings shows notifications and location allowed
//   node scripts/acceptance/access/device.mjs cadence-link     --device <name> --slot A
//   node scripts/acceptance/access/device.mjs cadence-link     --local            probe: this Mac's Cadence is linked to an account
//
// Every device call goes through scripts/test-device.mjs (docs/TEST_DEVICES.md). The
// link probe runs a read-only SQLite count; it prints neither ids nor email addresses.
// The agent never changes TCC grants or answers prompts.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION } from '../test-account-sessions.mjs';
import { PROBE, SLOT_IDS, USAGE, cliMain, finish, parseFlags, runProcess } from './lib.mjs';

const TEST_DEVICE = fileURLToPath(new URL('../../test-device.mjs', import.meta.url));
const DEVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMANDS = ['inventory', 'reachable', 'accessibility', 'screen-recording', 'app-permissions', 'cadence-link'];
const SSH_FAILED = 255;
const DB_RELATIVE = 'Library/Application Support/app.cadence.desktop/cadence.sqlite3';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const exec = (run, device, command, timeoutMs = 90_000) => run(process.execPath, [TEST_DEVICE, 'exec', device, '--', command], { timeoutMs });

export function linkQuery(slot) {
  if (!slot) return 'select count(*) from account_link_metadata;';
  const userId = PRODUCTION.accounts[slot].userId;
  if (!UUID.test(userId)) throw new Error('account id is not a uuid');
  return `select count(*) from account_link_metadata where hosted_user_id = '${userId}';`;
}

/** Shared failure mapping for device commands: an unreachable device is "missing", not an error. */
function deviceFailure(result) {
  if (result.error) return { code: PROBE.ERROR, detail: `test-device did not run (${result.error})` };
  if (result.status === SSH_FAILED) return { code: PROBE.MISSING, detail: 'device unreachable over SSH' };
  if (/No device inventory|Unknown device/.test(result.stderr)) return { code: PROBE.MISSING, detail: 'device not in the inventory' };
  return null;
}

export function classifyDevice(command, result) {
  if (command === 'inventory') {
    if (result.error) return { code: PROBE.ERROR, detail: `test-device did not run (${result.error})` };
    return null;
  }
  const failure = deviceFailure(result);
  if (failure) return failure;
  if (command === 'reachable') return result.status === 0 ? { code: PROBE.PRESENT, detail: 'reachable' } : { code: PROBE.ERROR, detail: `exec exited ${result.status}` };
  if (command === 'accessibility') {
    if (result.status === 0) return { code: PROBE.PRESENT, detail: 'System Events answers' };
    if (/-1712|-1719|-25211|assistive|not allowed/i.test(result.stderr)) return { code: PROBE.MISSING, detail: 'Accessibility not granted' };
    return { code: PROBE.ERROR, detail: `accessibility check exited ${result.status}` };
  }
  if (command === 'screen-recording') {
    return result.status === 0 ? { code: PROBE.PRESENT, detail: 'screencapture works' } : { code: PROBE.MISSING, detail: 'screencapture failed' };
  }
  if (command === 'cadence-link') {
    if (result.status !== 0) return { code: PROBE.ERROR, detail: `link query exited ${result.status}` };
    const count = Number.parseInt(result.stdout.trim().split(/\s+/).pop() ?? '', 10);
    if (count >= 1) return { code: PROBE.PRESENT, detail: 'linked' };
    if (count === 0) return { code: PROBE.MISSING, detail: 'not linked to the expected account' };
    return { code: PROBE.ERROR, detail: 'link query unreadable' };
  }
  return null;
}

export function classifyAppPermissions(notifications, location) {
  for (const result of [notifications, location]) {
    const failure = deviceFailure(result);
    if (failure) return failure;
  }
  const seen = (result) => result.status === 0 && !/^no match$/m.test(result.stdout) && result.stdout.trim() !== '';
  if (seen(notifications) && seen(location)) return { code: PROBE.PRESENT, detail: 'notifications and location allowed' };
  return { code: PROBE.MISSING, detail: 'not shown as allowed (open Cadence Settings on the device first)' };
}

export async function main(argv, { run = runProcess, out = (line) => process.stdout.write(`${line}\n`), home = homedir() } = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['device', 'slot'], flags: ['local'] }); } catch { flags = null; }
  const usage = () => finish(out, USAGE, { detail: `usage: ${COMMANDS.join('|')} --device <name> (see the file header)` });
  if (!flags || !COMMANDS.includes(command ?? '')) return usage();
  if (flags.local ? command !== 'cadence-link' : !DEVICE_NAME.test(flags.device ?? '')) return usage();
  if (command === 'cadence-link' && !flags.local && !SLOT_IDS.includes(flags.slot ?? '')) return usage();

  if (command === 'inventory') {
    const result = run(process.execPath, [TEST_DEVICE, 'list'], { timeoutMs: 30_000 });
    const failure = classifyDevice('inventory', result);
    if (failure) return finish(out, failure.code, { detail: failure.detail });
    const listed = result.status === 0 && result.stdout.split('\n').some((line) => line.split('\t')[0] === flags.device);
    return listed ? finish(out, PROBE.PRESENT, { detail: 'listed' }) : finish(out, PROBE.MISSING, { detail: 'device not in the inventory' });
  }
  if (command === 'cadence-link' && flags.local) {
    const result = run('/usr/bin/sqlite3', ['-readonly', join(home, DB_RELATIVE), linkQuery(null)], { timeoutMs: 30_000 });
    if (result.status !== 0 && /unable to open|no such table/i.test(result.stderr)) return finish(out, PROBE.MISSING, { detail: 'no linked Cadence database' });
    const { code, detail } = classifyDevice('cadence-link', result);
    return finish(out, code, { detail });
  }
  if (command === 'app-permissions') {
    const find = (pattern) => run(process.execPath, [TEST_DEVICE, 'ax', flags.device, 'find', pattern], { timeoutMs: 90_000 });
    const { code, detail } = classifyAppPermissions(find('Notifications: Enabled on this device'), find('Device location: allowed'));
    return finish(out, code, { detail });
  }
  const remote = {
    reachable: 'true',
    accessibility: 'osascript -l JavaScript -e \'Application("System Events").processes.whose({backgroundOnly:false})().length\' >/dev/null',
    'screen-recording': 'f="$(mktemp -t cadence-access).png"; screencapture -x "$f"; s=$?; rm -f "$f"; exit $s',
    'cadence-link': `sqlite3 -readonly "$HOME/${DB_RELATIVE}" "${command === 'cadence-link' ? linkQuery(flags.slot) : ''}"`,
  }[command];
  const { code, detail } = classifyDevice(command, exec(run, flags.device, remote));
  return finish(out, code, { detail });
}

cliMain(import.meta, main);
