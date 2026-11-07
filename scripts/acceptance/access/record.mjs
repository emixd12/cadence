#!/usr/bin/env node
// Test-access probe for owner approvals and owner-confirmed facts (Ticket 286).
//
//   record.mjs decision --file <repo file> --contains "<text>"         a recorded decision or rule exists
//   record.mjs approval --id <id>                                       this run's folder holds the owner's approval
//   record.mjs confirmation --id <id> --max-age-days <n>                this Mac holds a recent owner confirmation
//   record.mjs record --scope run|host --id <id> --source "<words>"    write an approval or confirmation (agent, after the owner says so)
//
// Approvals live in `$TEST_ACCESS_RUN_DIR/owner-approvals.json` (or --run-dir), one run
// only. Confirmations live in `.agentic/runtime/test-access-confirmations.json`, which is
// git-ignored. Both hold ids, times and a short source note: never a value.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PROBE, USAGE, cliMain, finish, parseFlags } from './lib.mjs';

export const APPROVALS_FILE = 'owner-approvals.json';
export const CONFIRMATIONS_PATH = join('.agentic', 'runtime', 'test-access-confirmations.json');
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SOURCE = /^[A-Za-z0-9 ,.:;()'/-]{1,160}$/;
const DAY_MS = 86_400_000;

const readJson = (path, read) => {
  try { const data = JSON.parse(read(path)); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
};

export function entryState(entry, { now, maxAgeDays = null }) {
  const at = Date.parse(entry?.recorded_at ?? '');
  if (!Number.isFinite(at) || at > now + 60_000) return 'missing';
  if (maxAgeDays !== null && at + maxAgeDays * DAY_MS <= now) return 'expired';
  return 'present';
}

function writeEntry(path, id, source, now) {
  const data = existsSync(path) ? readJson(path, (file) => readFileSync(file, 'utf8')) : {};
  data[id] = { recorded_at: new Date(now).toISOString(), source };
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

export async function main(argv, {
  out = (line) => process.stdout.write(`${line}\n`), env = process.env, cwd = process.cwd(), now = () => Date.now(),
  read = (path) => readFileSync(path, 'utf8'), exists = existsSync, write = writeEntry,
} = {}) {
  const [command, ...rest] = argv;
  let flags;
  try { flags = parseFlags(rest, { values: ['file', 'contains', 'id', 'max-age-days', 'scope', 'source', 'run-dir'] }); } catch { flags = null; }
  const usage = () => finish(out, USAGE, { detail: 'usage: decision | approval | confirmation | record (see the file header)' });
  if (!flags || !['decision', 'approval', 'confirmation', 'record'].includes(command ?? '')) return usage();
  const runDir = flags['run-dir'] ? resolve(cwd, flags['run-dir']) : (env.TEST_ACCESS_RUN_DIR || null);

  if (command === 'decision') {
    if (!flags.file || !flags.contains || flags.file.includes('..') || flags.file.startsWith('/')) return usage();
    const path = resolve(cwd, flags.file);
    if (!exists(path)) return finish(out, PROBE.ERROR, { detail: 'decision file missing' });
    return read(path).includes(flags.contains) ? finish(out, PROBE.PRESENT, { detail: 'recorded' }) : finish(out, PROBE.MISSING, { detail: 'not recorded' });
  }
  if (!ID.test(flags.id ?? '')) return usage();
  if (command === 'approval') {
    if (!runDir) return finish(out, PROBE.MISSING, { detail: 'no run folder; approvals are per run' });
    const path = join(runDir, APPROVALS_FILE);
    const state = exists(path) ? entryState(readJson(path, read)[flags.id], { now: now() }) : 'missing';
    return finish(out, state === 'present' ? PROBE.PRESENT : PROBE.MISSING, { detail: state === 'present' ? 'approved for this run' : 'no approval for this run' });
  }
  if (command === 'confirmation') {
    const maxAgeDays = Number(flags['max-age-days']);
    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) return usage();
    const path = resolve(cwd, CONFIRMATIONS_PATH);
    const state = exists(path) ? entryState(readJson(path, read)[flags.id], { now: now(), maxAgeDays }) : 'missing';
    const code = { present: PROBE.PRESENT, expired: PROBE.EXPIRED, missing: PROBE.MISSING }[state];
    return finish(out, code, { detail: state === 'present' ? 'confirmed' : `confirmation ${state}` });
  }
  if (!['run', 'host'].includes(flags.scope ?? '') || !SOURCE.test(flags.source ?? '')) return usage();
  if (flags.scope === 'run' && !runDir) return usage();
  const path = flags.scope === 'run' ? join(runDir, APPROVALS_FILE) : resolve(cwd, CONFIRMATIONS_PATH);
  write(path, flags.id, flags.source, now());
  return finish(out, 0, { detail: `recorded ${flags.scope} ${flags.id}` });
}

cliMain(import.meta, main);
