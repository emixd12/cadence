// Wave 1 fix 6: the acceptance CLIs must run, not exit 0 silently, when started
// through a symlinked path (for example from /tmp on macOS).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCliEntry } from '../scripts/acceptance/cli-entry.mjs';

const script = (name) => fileURLToPath(new URL(`../scripts/acceptance/${name}`, import.meta.url));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cli-entry-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('isCliEntry', () => {
  it('matches the module through a symlinked path and refuses other files', () => {
    const real = join(dir, 'real.mjs');
    writeFileSync(real, '');
    const link = join(dir, 'link.mjs');
    symlinkSync(real, link);
    const other = join(dir, 'other.mjs');
    writeFileSync(other, '');
    const meta = { url: pathToFileURL(real).href };
    expect(isCliEntry(meta, { argv1: real })).toBe(true);
    expect(isCliEntry(meta, { argv1: link })).toBe(true);
    expect(isCliEntry(meta, { argv1: other })).toBe(false);
    expect(isCliEntry(meta, { argv1: undefined })).toBe(false);
    expect(isCliEntry(meta, { argv1: join(dir, 'missing.mjs') })).toBe(false);
  });

  it('fails loudly when Node says this file is the entry but the path check disagrees', () => {
    const real = join(dir, 'real.mjs');
    writeFileSync(real, '');
    const written = [];
    let exitCode = null;
    const result = isCliEntry({ url: pathToFileURL(real).href, main: true }, {
      argv1: join(dir, 'elsewhere.mjs'), stderr: { write: (text) => written.push(text) }, setExitCode: (code) => { exitCode = code; },
    });
    expect(result).toBe(false);
    expect(exitCode).toBe(70);
    expect(written.join('')).toMatch(/^real\.mjs: .*did not run/);
  });

  it('stays quiet when the module is only imported', () => {
    const real = join(dir, 'real.mjs');
    writeFileSync(real, '');
    const written = [];
    let exitCode = null;
    const result = isCliEntry({ url: pathToFileURL(real).href, main: false }, {
      argv1: join(dir, 'runner.mjs'), stderr: { write: (text) => written.push(text) }, setExitCode: (code) => { exitCode = code; },
    });
    expect(result).toBe(false);
    expect(exitCode).toBeNull();
    expect(written).toEqual([]);
  });
});

describe('acceptance CLIs run through a symlinked path', () => {
  const runLinked = (name, args) => {
    const link = join(dir, name);
    symlinkSync(script(name), link);
    const r = spawnSync(process.execPath, [link, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('ledger (247)', () => {
    const r = runLinked('ledger.mjs', ['list', '--root', join(dir, 'runs')]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('[]');
  });

  it('oauth-driver (248)', () => {
    const r = runLinked('oauth-driver.mjs', []);
    expect(r.code).toBe(1);
    expect(r.out).toContain('target-required');
  });

  it('watch (250)', () => {
    const r = runLinked('watch.mjs', ['--list-scenarios']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('inspector:');
  });

  it('agent-secret (254)', () => {
    const r = runLinked('agent-secret.mjs', []);
    expect(r.code).toBe(2);
    expect(r.out).toContain('agent-secret: missing "-- <command>"');
  });
});
