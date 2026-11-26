// Ticket 291: skill scenarios for the headless client acceptance. Prompt
// construction only; no client, provider or Cadence server is contacted.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT_SCENARIOS, DRAFT_SKILL_NAMES, SKILL_NAMES, behaviorTitle, skillPrompt, skillText } from '../scripts/acceptance/client-prompts.mjs';
import { REGISTRY_TOOLS, TRANSPORT_TOOLS } from '../scripts/acceptance/protocol.mjs';
import { OPERATION_ACCESS, TRANSPORT_OPERATION_ACCESS } from '../scripts/acceptance/watch.mjs';

const SKILL_FILE = (name) => readFileSync(new URL(`../integrations/skills/${name}/SKILL.md`, import.meta.url), 'utf8').trim();
const SKILL_SCENARIOS = ['skill-check-in-unconfirmed', 'skill-routine-unconfirmed', 'skill-routine-confirmed'];
const LABEL = 'abc123-cc-1';
/** The user's message: everything after the closing skill tag and the "User message:" line. */
const userMessage = (prompt) => prompt.slice(prompt.indexOf('</skill>\nUser message:\n') + '</skill>\nUser message:\n'.length);

describe('published skill text', () => {
  it('reads each published skill file unchanged', () => {
    for (const name of SKILL_NAMES) expect(skillText(name)).toBe(SKILL_FILE(name));
  });

  it('reads the file each time a prompt is built and refuses unknown or malformed skills', () => {
    const reads = [];
    const read = (url) => { reads.push(url.pathname); return '---\nname: routine-setup\n---\nchanged text'; };
    expect(skillText('routine-setup', { read })).toBe('---\nname: routine-setup\n---\nchanged text');
    expect(reads).toEqual([expect.stringMatching(/\/integrations\/skills\/routine-setup\/SKILL\.md$/)]);
    expect(() => skillText('weekly-review')).toThrow('skill-unknown');
    expect(() => skillText('../secrets')).toThrow('skill-unknown');
    expect(() => skillText('routine-setup', { read: () => 'no front matter' })).toThrow('skill-unreadable');
    expect(() => skillText('routine-setup', { read: () => '---\nname: daily-check-in\n---\n' })).toThrow('skill-unreadable');
  });
});

describe('skill scenarios', () => {
  it('use a full grant, need a model and give the Inspector CLI no steps', () => {
    for (const name of SKILL_SCENARIOS) {
      const s = CLIENT_SCENARIOS[name];
      expect(s.name).toBe(name);
      expect(s.grant).toBe('full');
      expect(s.needsModel).toBe(true);
      expect(s.inspector(LABEL)).toEqual([]);
    }
    for (const name of ['read-write', 'read-only', 'step-up']) expect(CLIENT_SCENARIOS[name].needsModel).toBeUndefined();
  });

  it('prompt with the [Cadence QA] marker, the whole published skill, then the user message, and never the confirm-everything preamble', () => {
    const skills = { 'skill-check-in-unconfirmed': 'daily-check-in', 'skill-routine-unconfirmed': 'routine-setup', 'skill-routine-confirmed': 'routine-setup' };
    for (const [name, skill] of Object.entries(skills)) {
      const prompt = CLIENT_SCENARIOS[name].prompt(LABEL);
      expect(prompt.startsWith('[Cadence QA] ')).toBe(true);
      expect(prompt).toContain(`<skill name="${skill}">\n${SKILL_FILE(skill)}\n</skill>\nUser message:\n`);
      expect(prompt).not.toMatch(/Do not ask me to confirm/i);
      expect(prompt).not.toMatch(/I confirm every change/i);
      expect(prompt).toMatch(/Never delete anything/);
    }
  });

  it('confirm nothing in the unconfirmed messages and the full proposal in the confirmed one', () => {
    const checkIn = userMessage(CLIENT_SCENARIOS['skill-check-in-unconfirmed'].prompt(LABEL));
    const unconfirmed = userMessage(CLIENT_SCENARIOS['skill-routine-unconfirmed'].prompt(LABEL));
    const confirmed = userMessage(CLIENT_SCENARIOS['skill-routine-confirmed'].prompt(LABEL));
    expect(checkIn).toMatch(/daily check-in/);
    for (const message of [checkIn, unconfirmed]) expect(message).not.toMatch(/confirm|go ahead|yes,/i);
    // The confirmed message is the unconfirmed one plus the confirmation and the archive cleanup.
    expect(confirmed.startsWith(unconfirmed)).toBe(true);
    expect(unconfirmed).toContain(`"${behaviorTitle(LABEL)}"`);
    expect(unconfirmed).toMatch(/every day at 18:00/);
    expect(unconfirmed).toMatch(/browser and email reminders off/);
    expect(confirmed).toMatch(/I confirm this full proposal/);
    expect(confirmed).toMatch(/archive that Behavior once it is created/);
  });

  it('expect no write unless confirmed, and exactly the confirmed create when confirmed', () => {
    const checkIn = CLIENT_SCENARIOS['skill-check-in-unconfirmed'];
    expect(checkIn.expect).toMatchObject({ readOk: true, writesOk: [], noWrites: true, createdBehaviors: 0 });
    expect(checkIn.watcherSteps.map((s) => [s.id, s.access, s.where.outcome])).toEqual([['read-succeeded', 'read', 'success']]);
    const unconfirmed = CLIENT_SCENARIOS['skill-routine-unconfirmed'];
    expect(unconfirmed.expect).toMatchObject({ writesOk: [], noWrites: true, createdBehaviors: 0 });
    expect(unconfirmed.watcherSteps).toEqual([]);
    const confirmed = CLIENT_SCENARIOS['skill-routine-confirmed'];
    expect(confirmed.expect).toMatchObject({
      exactWrites: { create_behavior: 1 }, onlyWrites: ['create_behavior', 'archive_behavior'], createdBehaviors: 1, archived: true,
      schedule: { frequency: 'daily', interval: 1, times: [{ kind: 'exact', start: '18:00' }] },
    });
    expect(confirmed.watcherSteps.map((s) => s.where.operation)).toEqual(['create_behavior', 'archive_behavior']);
    for (const tool of [...Object.keys(confirmed.expect.exactWrites), ...confirmed.expect.onlyWrites]) expect(OPERATION_ACCESS[tool]).toBe('write');
  });

  it('skillPrompt builds the same layout for any message', () => {
    expect(skillPrompt('daily-check-in', 'hello').endsWith('</skill>\nUser message:\nhello')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ticket 380: the unpublished daily-check-in draft that names `show_day`
// ---------------------------------------------------------------------------

describe('draft skill scenario (Ticket 380)', () => {
  const DRAFT_FILE = (name) => readFileSync(new URL(`../integrations/drafts/skills/${name}/SKILL.md`, import.meta.url), 'utf8').trim();
  const NAME = 'skill-check-in-view-unconfirmed';
  const toolsNamed = (text) => [...text.matchAll(/`([a-z][a-z0-9_]*)\(\)`/g)].map((match) => match[1]);

  it('reads the draft only when asked, and the published file otherwise', () => {
    expect(DRAFT_SKILL_NAMES).toEqual(['daily-check-in']);
    // Every draft folder is one the runner can read, and nothing else is there.
    expect(readdirSync(new URL('../integrations/drafts/skills/', import.meta.url)).sort()).toEqual([...DRAFT_SKILL_NAMES].sort());
    expect(TRANSPORT_TOOLS).toEqual(['show_day']);
    expect(skillText('daily-check-in', { draft: true })).toBe(DRAFT_FILE('daily-check-in'));
    expect(skillText('daily-check-in')).toBe(SKILL_FILE('daily-check-in'));
    expect(skillText('daily-check-in', { draft: true })).not.toBe(skillText('daily-check-in'));
    const reads = [];
    skillText('daily-check-in', { draft: true, read: (url) => { reads.push(url.pathname); return '---\nname: daily-check-in\n---\n'; } });
    expect(reads).toEqual([expect.stringMatching(/\/integrations\/drafts\/skills\/daily-check-in\/SKILL\.md$/)]);
    // No draft exists for routine-setup, and a path can never be passed as a name.
    expect(() => skillText('routine-setup', { draft: true })).toThrow('skill-unknown');
    expect(() => skillText('../skills/daily-check-in', { draft: true })).toThrow('skill-unknown');
  });

  it('prompts with the whole draft and a message that confirms nothing', () => {
    const s = CLIENT_SCENARIOS[NAME];
    expect(s).toMatchObject({ name: NAME, grant: 'full', needsModel: true, draftSkill: true });
    expect(s.inspector(LABEL)).toEqual([]);
    const prompt = s.prompt(LABEL);
    expect(prompt.startsWith('[Cadence QA] ')).toBe(true);
    expect(prompt).toContain(`<skill name="daily-check-in">\n${DRAFT_FILE('daily-check-in')}\n</skill>\nUser message:\n`);
    expect(prompt).not.toMatch(/Do not ask me to confirm|I confirm every change/i);
    // The same user message as the published skill's scenario, so the two runs compare like for like.
    expect(userMessage(prompt)).toBe(userMessage(CLIENT_SCENARIOS['skill-check-in-unconfirmed'].prompt(LABEL)));
    expect(userMessage(prompt)).not.toMatch(/confirm|go ahead|yes,/i);
    // Only this scenario carries a draft.
    expect(Object.values(CLIENT_SCENARIOS).filter((x) => x.draftSkill).map((x) => x.name)).toEqual([NAME]);
  });

  it('expects a read and no write, with show_day counted as a read', () => {
    const s = CLIENT_SCENARIOS[NAME];
    expect(s.expect).toEqual(CLIENT_SCENARIOS['skill-check-in-unconfirmed'].expect);
    expect(s.expect).toMatchObject({ readOk: true, writesOk: [], noWrites: true, createdBehaviors: 0 });
    expect(s.watcherSteps.map((step) => [step.id, step.access, step.where.outcome])).toEqual([['read-succeeded', 'read', 'success']]);
    expect(TRANSPORT_OPERATION_ACCESS.show_day).toBe('read');
  });

  it('names only tools that exist: registry tools and the transport tool show_day', () => {
    const tools = toolsNamed(DRAFT_FILE('daily-check-in'));
    expect(tools).toContain('show_day');
    expect(tools).toContain('get_timeline');
    for (const tool of tools) expect([...REGISTRY_TOOLS, ...TRANSPORT_TOOLS], tool).toContain(tool);
    // Every tool it names has a known access, so the runner can tell a read from a write.
    for (const tool of tools) expect(OPERATION_ACCESS[tool] ?? TRANSPORT_OPERATION_ACCESS[tool], tool).toMatch(/^(read|write)$/);
    // The published skill still names no transport tool.
    for (const tool of toolsNamed(SKILL_FILE('daily-check-in'))) expect(REGISTRY_TOOLS, tool).toContain(tool);
  });
});
