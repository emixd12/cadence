// Ticket 255: the Chrome profile guard and the command line of the web client
// runner. These tests start no browser, so they do not use harness.mjs.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_DIR, SCENARIOS, assertProfileDir, attachProfile, guidedFallback, main, openProfile, parseCli, profileOwnsPort,
} from '../../scripts/acceptance/web-client.mjs';
import { WebStop } from '../../scripts/acceptance/web-sites.mjs';

describe('profile guard', () => {
  const home = homedir();
  it('accepts the default dedicated profile outside the repo', () => {
    expect(assertProfileDir(DEFAULT_PROFILE_DIR)).toMatch(/Cadence QA Chrome$/);
  });
  it.each([
    ['relative', 'Cadence QA Chrome', 'profile-path'],
    ['home', home, 'profile-path'],
    ['repository', join(process.cwd(), 'tmp-profile'), 'profile-in-repo'],
    ['sibling worktree', join(process.cwd(), '..', 'cadence', 'x'), 'profile-in-repo'],
    ['everyday Chrome', join(home, 'Library', 'Application Support', 'Google', 'Chrome'), 'profile-everyday-chrome'],
    ['everyday Chrome profile', join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Profile 3'), 'profile-everyday-chrome'],
  ])('refuses %s', (_name, dir, step) => {
    expect(() => assertProfileDir(dir)).toThrow(WebStop);
    try { assertProfileDir(dir); } catch (e) { expect(e).toMatchObject({ reason: 'profile-unsafe', step }); }
  });
  it.each(['Identity Scaffolding', 'Emi Chrome'])('refuses a folder whose Local State names %s', (name) => {
    const dir = mkdtempSync(join(tmpdir(), 'accept-255-profile-'));
    try {
      writeFileSync(join(dir, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Cadence QA' }, 'Profile 1': { name } } } }));
      expect(() => assertProfileDir(dir)).toThrow(WebStop);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('attaches only when the profile owns the port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accept-255-profile-'));
    try {
      const ours = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${dir} --remote-debugging-port=4430 --no-first-run`;
      const owns = (commands, port = 4430) => profileOwnsPort({ profileDir: dir, port, listenerPids: () => Object.keys(commands).join('\n'), commandOf: (pid) => commands[pid] });
      expect(owns({ 101: ours })).toBe(true);
      expect(owns({ 101: ours.replace(dir, '/other') })).toBe(false);
      expect(owns({ 101: ours.replace(dir, `${dir}-copy`) })).toBe(false);
      // Another launcher puts the profile flag last, with no argument after it.
      const last = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --no-startup-window --remote-debugging-port=4430 --user-data-dir=${dir}`;
      expect(owns({ 101: last })).toBe(true);
      expect(owns({ 101: `${last}\n` })).toBe(true);
      expect(owns({ 101: `${last}-copy` })).toBe(false);
      expect(owns({ 101: ours }, 4431)).toBe(false);
      expect(owns({ 101: ours, 202: '/usr/bin/nc -l 4430' })).toBe(false);
      expect(owns({})).toBe(false);
      expect(owns({ 101: `/tmp/fake-chrome --user-data-dir=${dir} --remote-debugging-port=4430` })).toBe(false);
      let connected = false;
      await expect(attachProfile({ profileDir: dir, owns: () => false, connect: async () => { connected = true; } })).rejects.toMatchObject({ reason: 'profile-not-open' });
      expect(connected).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('opens the profile as a normal Chrome window with only the loopback DevTools port', async () => {
    const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'accept-255-profile-'))), 'QA Chrome');
    const calls = [];
    let up = false;
    const result = await openProfile({
      profileDir: dir, port: 4430, urls: ['https://chatgpt.com/'],
      spawnImpl: (bin, args, opts) => { calls.push({ bin, args, opts }); up = true; return { unref() {} }; },
      fetchImpl: async () => ({ ok: up }), owns: () => up, timeoutMs: 2_000,
    });
    expect(result.state).toBe('opened');
    expect(calls[0].bin).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(calls[0].args).toEqual([`--user-data-dir=${dir}`, '--remote-debugging-port=4430', '--no-first-run', '--no-default-browser-check', 'https://chatgpt.com/']);
    expect(calls[0].args.some((a) => /enable-automation|headless|mock-keychain/.test(a))).toBe(false);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    await expect(openProfile({ profileDir: dir, port: 4321 })).rejects.toMatchObject({ reason: 'port-not-allowed' });
  });
});

describe('CLI', () => {
  it('archives test chats by default; --keep-chats turns it off', () => {
    expect(parseCli(['run', '--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write', '--allow-production']).keepChats).toBe(false);
    expect(parseCli(['run', '--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write', '--allow-production', '--keep-chats']).keepChats).toBe(true);
    expect(parseCli(['run', '--client', 'claude-web', '--account', 'A', '--scenario', 'read-write', '--allow-production']).deleteClaudeChats).toBe(false);
    expect(parseCli(['run', '--client', 'claude-web', '--account', 'A', '--scenario', 'read-write', '--allow-production', '--delete-claude-chats']).deleteClaudeChats).toBe(true);
    expect(parseCli(['run', '--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write', '--allow-production']).screenshots).toBe('off');
    expect(parseCli(['run', '--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write', '--allow-production', '--screenshots']).screenshots).toBe('conversation');
    expect(parseCli(['dry-run', '--screenshots']).screenshots).toBe('conversation');
  });

  it('parses the task-note form without a subcommand and requires --allow-production', () => {
    expect(() => parseCli(['--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write'])).toThrow(/allow-production-required/);
    expect(parseCli(['--client', 'chatgpt', '--account', 'A', '--scenario', 'read-write', '--allow-production'])).toMatchObject({ command: 'run', client: 'chatgpt', slot: 'A', scenario: 'read-write', port: 4430 });
    expect(parseCli(['dry-run'])).toMatchObject({ command: 'dry-run', clients: ['chatgpt', 'claude-web'] });
    expect(() => parseCli(['dry-run', '--port', '4321'])).toThrow(/port-not-allowed/);
    expect(() => parseCli(['--client', 'gemini', '--account', 'A', '--scenario', 'deny', '--allow-production'])).toThrow(/client-invalid/);
  });
  it('lists scenarios and refuses bad usage with exit 2', async () => {
    const lines = [];
    expect(await main(['--list-scenarios'], {}, (l) => lines.push(l))).toBe(0);
    expect(lines.map((l) => l.split(':')[0])).toEqual(Object.keys(SCENARIOS));
    expect(await main(['run', '--client', 'chatgpt'], {}, (l) => lines.push(l))).toBe(2);
  });
  it('runs through a symlinked script path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'accept-255-link-'));
    try {
      const link = join(dir, 'web-client.mjs');
      symlinkSync(join(process.cwd(), 'scripts', 'acceptance', 'web-client.mjs'), link);
      const r = spawnSync(process.execPath, [link, '--list-scenarios'], { encoding: 'utf8', timeout: 30_000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('read-write:');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('prints a guided fallback naming the client, account and reason', () => {
    const lines = guidedFallback({ client: 'claude-web', slot: 'B', scenario: 'read-write', reason: 'bot-check' });
    expect(lines[0]).toBe('guided-fallback claude-web reason=bot-check');
    expect(lines.join('\n')).toContain('test account B');
    expect(lines.join('\n')).toContain('--expect claude-web');
  });
});
