// Ticket 286: the Cadence test-access manifest validates with the installed engine,
// every suite dry-runs without running a probe, and every command it names exists.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, validateManifest } from '../.agentic/scripts/test-access-preflight.mjs';
import { STEPS } from '../scripts/acceptance/access/agent-step.mjs';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, '.agentic', 'test-access.json'), 'utf8'));
const model = validateManifest(manifest);

function dryRun(suite) {
  const out = [];
  const err = [];
  const code = run(['--suite', suite, '--dry-run', '--json', '--project-root', root], { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
  return { code, record: out.length ? JSON.parse(out.join('')) : null, stderr: err.join('') };
}

describe('Cadence test-access manifest', () => {
  it('validates against the engine and declares every inventory suite', () => {
    expect(model.project).toBe('cadence');
    expect([...model.suites.keys()]).toEqual([
      'mcp-local', 'mcp-protocol', 'mcp-clients', 'mcp-web', 'calendar-fixtures', 'calendar-fixtures-b', 'web-travel',
      'connectors', 'desktop-owner-mac', 'desktop-test-mac', 'desktop-release', 'email',
    ]);
  });

  it.each([...model.suites.keys()])('dry-runs suite %s without probing', (suite) => {
    const { code, record, stderr } = dryRun(suite);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(record.mode).toBe('dry_run');
    expect(record.requirements.length).toBeGreaterThan(0);
    for (const requirement of record.requirements) expect(['would_probe', 'reused']).toContain(requirement.source);
  });

  it('dry-runs all suites as one numbered owner list', () => {
    const { code, record } = dryRun('all');
    expect(code).toBe(0);
    expect(record.possible_owner_steps.map((step) => step.number)).toEqual(record.possible_owner_steps.map((_, index) => index + 1));
  });

  it('keeps calendar-fixtures to account A, so a missing B item cannot block A', () => {
    const ids = dryRun('calendar-fixtures').record.requirements.map((requirement) => requirement.id);
    expect(ids).toContain('qa-calendar-grant-a');
    expect(ids.filter((id) => id.endsWith('-b'))).toEqual([]);
  });

  it('applies the 2026-11-07 owner decisions: agent renewals where the owner made them agent steps', () => {
    const byId = model.byId;
    for (const id of ['supabase-session-a', 'supabase-session-b', 'icloud-connection-a', 'hevy-connection-a', 'outlook-connection-a', 'test-mac-cadence-link-a']) {
      expect(byId.get(id).renew, id).not.toBeNull();
    }
    for (const id of ['vault-outlook-a', 'vault-icloud-a', 'vault-hevy-a']) {
      expect(byId.get(id).owner_step, id).toBeTruthy();
      expect(byId.get(id).renew, id).toBeNull();
    }
    expect(byId.get('outlook-connection-a').depends_on).toEqual(expect.arrayContaining(['vault-outlook-a', 'cadence-web-a']));
    expect(byId.get('email-test-recipient').probe.argv).toContain('docs/DECISIONS.md');
  });

  it('names only existing scripts and known agent steps, and no inline secret options', () => {
    for (const requirement of model.requirements) {
      for (const command of [requirement.probe, requirement.renew].filter(Boolean)) {
        expect(command.argv[0], requirement.id).toBe('node');
        expect(existsSync(join(root, command.argv[1])), `${requirement.id}: ${command.argv[1]}`).toBe(true);
        expect(command.argv.some((part) => /^--env$/.test(part)), requirement.id).toBe(false);
        if (command.argv[1].endsWith('agent-step.mjs')) expect(Object.keys(STEPS)).toContain(command.argv.at(-1));
      }
    }
  });

  it('refuses a manifest that carries a secret value', () => {
    const bad = structuredClone(manifest);
    bad.requirements[0].summary = 'password=hunter22';
    expect(() => validateManifest(bad)).toThrow(/looks like a secret/);
  });
});
