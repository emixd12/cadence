#!/usr/bin/env node
// Test-access probe for things on this Mac (Ticket 286). One check per call:
//
//   host.mjs --path <file> [--path …]               files or folders exist (a leading ~/ is the home folder)
//   host.mjs --command <name> [--command …]         commands are on PATH
//   host.mjs --codesign "<identity name>"           a valid code-signing identity with that name (names only)
//   host.mjs --profile-expiry <file>                a provisioning profile; reports its ExpirationDate
//   host.mjs --env-name <NAME> --env-file <file>    the file sets NAME to something (the value is never kept or printed)
//   host.mjs --url <https-url> --expect-status <n>  a public URL answers with that status
//   host.mjs --ax                                   this Mac lets the agent's process read windows through System Events
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { PROBE, USAGE, cliMain, finish, parseFlags, runProcess } from './lib.mjs';

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

export const expandPath = (path, home = homedir(), cwd = process.cwd()) =>
  (path.startsWith('~/') ? join(home, path.slice(2)) : isAbsolute(path) ? path : resolve(cwd, path));

/** True when a dotenv-style file assigns a non-empty value to `name`. Only the boolean leaves. */
export function envFileSets(text, name) {
  return String(text).split(/\r?\n/).some((line) => {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    return match !== null && match[1] === name && match[2].replace(/^["']|["']$/g, '').trim() !== '';
  });
}

/** ExpirationDate from `security cms -D` plist output, as RFC3339, or null. */
export function profileExpiry(plist) {
  const match = /<key>ExpirationDate<\/key>\s*<date>([0-9T:-]+Z)<\/date>/.exec(String(plist));
  return match ? match[1] : null;
}

export async function main(argv, {
  run = runProcess, out = (line) => process.stdout.write(`${line}\n`), exists = existsSync, readFile = (path) => readFileSync(path, 'utf8'),
  fetchImpl = fetch, now = () => Date.now(), home = homedir(),
} = {}) {
  let flags;
  try {
    flags = parseFlags(argv, { values: ['codesign', 'profile-expiry', 'env-name', 'env-file', 'url', 'expect-status'], flags: ['ax'], repeat: ['path', 'command'] });
  } catch { flags = null; }
  const usage = () => finish(out, USAGE, { detail: 'usage: one of --path, --command, --codesign, --profile-expiry, --env-name/--env-file, --url/--expect-status, --ax' });
  if (!flags) return usage();
  const modes = [flags.path.length > 0, flags.command.length > 0, Boolean(flags.codesign), Boolean(flags['profile-expiry']),
    Boolean(flags['env-name']), Boolean(flags.url), Boolean(flags.ax)].filter(Boolean).length;
  if (modes !== 1) return usage();

  if (flags.path.length) {
    const missing = flags.path.filter((path) => !exists(expandPath(path, home)));
    return missing.length ? finish(out, PROBE.MISSING, { detail: `${missing.length} of ${flags.path.length} missing` }) : finish(out, PROBE.PRESENT, { detail: 'present' });
  }
  if (flags.command.length) {
    if (!flags.command.every((name) => COMMAND_NAME.test(name))) return usage();
    const missing = flags.command.filter((name) => run('/bin/sh', ['-c', 'command -v "$1" >/dev/null', 'sh', name], { timeoutMs: 10_000 }).status !== 0);
    return missing.length ? finish(out, PROBE.MISSING, { detail: `missing: ${missing.join(' ')}` }) : finish(out, PROBE.PRESENT, { detail: 'all on PATH' });
  }
  if (flags.codesign) {
    const result = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { timeoutMs: 30_000 });
    if (result.error || result.status !== 0) return finish(out, PROBE.ERROR, { detail: 'security find-identity failed' });
    return result.stdout.includes(`"${flags.codesign}`) ? finish(out, PROBE.PRESENT, { detail: 'identity valid' }) : finish(out, PROBE.MISSING, { detail: 'identity missing or invalid' });
  }
  if (flags['profile-expiry']) {
    const file = expandPath(flags['profile-expiry'], home);
    if (!exists(file)) return finish(out, PROBE.MISSING, { detail: 'profile file missing' });
    const result = run('/usr/bin/security', ['cms', '-D', '-i', file], { timeoutMs: 30_000 });
    const expiresAt = result.status === 0 ? profileExpiry(result.stdout) : null;
    if (!expiresAt) return finish(out, PROBE.ERROR, { detail: 'profile unreadable' });
    if (Date.parse(expiresAt) <= now()) return finish(out, PROBE.EXPIRED, { detail: 'profile expired', expires_at: expiresAt });
    return finish(out, PROBE.PRESENT, { detail: 'profile valid', expires_at: expiresAt });
  }
  if (flags['env-name']) {
    if (!ENV_NAME.test(flags['env-name']) || !flags['env-file']) return usage();
    const file = expandPath(flags['env-file'], home);
    if (!exists(file)) return finish(out, PROBE.MISSING, { detail: 'env file missing' });
    let text = '';
    try { text = readFile(file); } catch { return finish(out, PROBE.ERROR, { detail: 'env file unreadable' }); }
    const set = envFileSets(text, flags['env-name']);
    text = '';
    return set ? finish(out, PROBE.PRESENT, { detail: 'name set' }) : finish(out, PROBE.MISSING, { detail: 'name not set' });
  }
  if (flags.url) {
    const expected = Number(flags['expect-status']);
    if (!/^https:\/\//.test(flags.url) || !Number.isInteger(expected)) return usage();
    try {
      const response = await fetchImpl(flags.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      return response.status === expected ? finish(out, PROBE.PRESENT, { detail: `status ${response.status}` }) : finish(out, PROBE.MISSING, { detail: `status ${response.status}` });
    } catch (error) {
      return finish(out, PROBE.ERROR, { detail: `request failed (${error?.name ?? 'error'})` });
    }
  }
  const result = run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', 'Application("System Events").processes.whose({backgroundOnly:false})().length'], { timeoutMs: 30_000 });
  if (result.status === 0) return finish(out, PROBE.PRESENT, { detail: 'System Events answers' });
  if (/-1712|-1719|-25211|assistive|not allowed/i.test(result.stderr)) return finish(out, PROBE.MISSING, { detail: 'Accessibility not granted' });
  return finish(out, PROBE.ERROR, { detail: `osascript exited ${result.status}` });
}

cliMain(import.meta, main);
