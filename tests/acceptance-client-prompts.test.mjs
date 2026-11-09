// Ticket 291: skill scenarios for the headless client acceptance. Prompt
// construction only; no client, provider or Cadence server is contacted.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT_SCENARIOS, SKILL_NAMES, behaviorTitle, skillPrompt, skillText } from '../scripts/acceptance/client-prompts.mjs';
import { OPERATION_ACCESS } from '../scripts/acceptance/watch.mjs';

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
