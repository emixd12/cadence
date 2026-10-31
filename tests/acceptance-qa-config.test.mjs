// Ticket 257: the production project ref and public publishable key live in one
// committed QA config, so production runs need no key lookup. The watcher, the
// session store, every runner and the skill read it from there.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRODUCTION_QA, QA_PUBLISHABLE_KEY_ENV, qaPublishableKey } from '../scripts/acceptance/qa-config.mjs';
import { PRODUCTION } from '../scripts/acceptance/test-account-sessions.mjs';
import { PRODUCTION_SUPABASE_ORIGIN, publishableKeyFrom } from '../scripts/acceptance/watch.mjs';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('production QA config', () => {
  it('holds the production project ref, its Supabase URL and a public publishable key only', () => {
    expect(PRODUCTION_QA.projectRef).toBe('qjodzutjxtmtzczbloxa');
    expect(PRODUCTION_QA.supabaseUrl).toBe(`https://${PRODUCTION_QA.projectRef}.supabase.co`);
    expect(PRODUCTION_QA.publishableKey).toMatch(/^sb_publishable_[A-Za-z0-9_-]{20,}$/);
    expect(Object.isFrozen(PRODUCTION_QA)).toBe(true);
    const text = source('scripts/acceptance/qa-config.mjs');
    for (const banned of [/sb_secret_/, /service_role/i, /eyJ[A-Za-z0-9_-]{10,}/]) expect(text).not.toMatch(banned);
  });

  it('uses the committed key unless the environment overrides it', () => {
    expect(QA_PUBLISHABLE_KEY_ENV).toBe('CADENCE_QA_SUPABASE_PUBLISHABLE_KEY');
    expect(qaPublishableKey({})).toBe(PRODUCTION_QA.publishableKey);
    expect(qaPublishableKey({ [QA_PUBLISHABLE_KEY_ENV]: '' })).toBe(PRODUCTION_QA.publishableKey);
    expect(qaPublishableKey({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_other' })).toBe(PRODUCTION_QA.publishableKey);
    expect(qaPublishableKey({ [QA_PUBLISHABLE_KEY_ENV]: 'sb_publishable_override_1' })).toBe('sb_publishable_override_1');
  });

  it('is the single source for the watcher and the session store', () => {
    expect(PRODUCTION.supabaseUrl).toBe(PRODUCTION_QA.supabaseUrl);
    expect(PRODUCTION_SUPABASE_ORIGIN).toBe(PRODUCTION_QA.supabaseUrl);
    expect(publishableKeyFrom({})).toBe(PRODUCTION_QA.publishableKey);
  });

  it('every production runner reads the key through qaPublishableKey, never the variable directly', () => {
    for (const path of ['protocol.mjs', 'client-runners.mjs', 'oauth-driver.mjs', 'web-client.mjs', 'guided.mjs', 'watch.mjs']) {
      const text = source(`scripts/acceptance/${path}`);
      expect(text, path).toContain('qaPublishableKey');
      expect(text, path).not.toMatch(/env(\?)?\.CADENCE_QA_SUPABASE_PUBLISHABLE_KEY/);
      expect(text, path).not.toContain(PRODUCTION_QA.publishableKey);
    }
    for (const path of ['test-account-sessions.mjs', 'watch.mjs']) {
      expect(source(`scripts/acceptance/${path}`), path).not.toContain(`'${PRODUCTION_QA.supabaseUrl}'`);
    }
  });

  it('the skill points at the config and no longer asks for the key', () => {
    const skill = source('.claude/skills/mcp-acceptance/SKILL.md');
    expect(skill).toContain('scripts/acceptance/qa-config.mjs');
    expect(skill).not.toMatch(/ask the coordinator\s+once per session/);
    expect(skill).not.toMatch(/export CADENCE_QA_SUPABASE_PUBLISHABLE_KEY=/);
  });
});
