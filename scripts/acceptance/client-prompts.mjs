// Ticket 251: canned client scenarios shared by the headless runners
// (scripts/acceptance/client-runners.mjs). The prompt text follows the MCP
// directory test cases in docs/qa/mcp-directory-submission.md (P1 Today's
// review, P5 Behavior lifecycle, N2 Missing permission), so a person and a
// runner ask the same thing. Ticket 252's human checklist can import these.
//
// Every Behavior a scenario creates is titled "Review practice <label>", the
// prefix Ticket 232's creation capture accepts, and the scenario archives it
// again, so a run leaves nothing active behind.
//
// A scenario never puts a prompt, tool input or tool output in the ledger; the
// runners record tool names, outcomes, error codes and IDs only.
//
// Ticket 291: the skill-* scenarios test the rules of the published skills in
// integrations/skills/ instead of the tools. Their prompt is the skill text,
// read from disk when the prompt is built, followed by the user's message. They
// do not use PREAMBLE, so nothing tells the model that changes are confirmed
// unless the user's message says so. The Inspector CLI has no model, so the
// runner skips it for these scenarios (`needsModel`).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const BEHAVIOR_TITLE_PREFIX = 'Review practice';
const LABEL = /^[a-z0-9-]{1,24}$/;

export const behaviorTitle = (label) => {
  if (!LABEL.test(label ?? '')) throw new Error('scenario-label-invalid');
  return `${BEHAVIOR_TITLE_PREFIX} ${label}`;
};

const PREAMBLE = [
  'This is a Cadence acceptance check on a test account.',
  'Use only the Cadence tools. Do not ask me to confirm anything: I confirm every change listed below.',
  'Call each tool at most twice. Never delete anything.',
].join(' ');

const createArgs = (label) => ({
  title: behaviorTitle(label),
  schedules: [{ recurrence: { frequency: 'daily', interval: 1 }, time_entries: [{ kind: 'exact', start_time: '18:00' }] }],
  reminders: { browser_enabled: false, email_enabled: false },
  idempotency_key: randomUUID(),
});

export const SKILL_NAMES = Object.freeze(['daily-check-in', 'routine-setup']);

/** The published skill file, read when a prompt is built so a run always uses the current text. */
export function skillText(name, { read = (url) => readFileSync(url, 'utf8') } = {}) {
  if (!SKILL_NAMES.includes(name)) throw new Error('skill-unknown');
  const text = String(read(new URL(`../../integrations/skills/${name}/SKILL.md`, import.meta.url))).trim();
  if (!text.startsWith('---') || !text.includes(`name: ${name}`)) throw new Error('skill-unreadable');
  return text;
}

/**
 * A skill scenario prompt: the [Cadence QA] marker and the run limits, the
 * published skill, then the user's message. It says nothing about confirmation.
 */
export const skillPrompt = (name, message) => [
  '[Cadence QA] This is a test account. Use only the Cadence tools. Call each tool at most twice. Never delete anything.',
  `The Cadence skill "${name}" is installed. Follow it for the user's message below.`,
  `<skill name="${name}">`,
  skillText(name),
  '</skill>',
  'User message:',
  message,
].join('\n');

/** The routine the routine-setup scenarios describe, in the user's words. */
const routineRequest = (label) =>
  `Please add a routine to Cadence: "${behaviorTitle(label)}", every day at 18:00 in my account's timezone, with browser and email reminders off, no category, no description and no end date.`;

/** The schedule a confirmed routine must have in the database: one daily schedule with one exact 18:00 time. */
const ROUTINE_SCHEDULE = Object.freeze({ frequency: 'daily', interval: 1, times: Object.freeze([Object.freeze({ kind: 'exact', start: '18:00' })]) });

/**
 * Each scenario:
 * - grant: the Ticket 248 driver grant the run creates (read | behaviors | full)
 * - prompt(label): the canned prompt for model clients
 * - inspector(label): the scripted tool sequence for Inspector CLI mode, which
 *   has no model. `{ from: 'create_behavior' }` reuses the Behavior id that call returned.
 * - expect: what the runner checks in the client's own evidence. Optional
 *   Ticket 291 fields: `noWrites` (no write attempted by the client and no
 *   write tool.call on the grant), `exactWrites` ({ tool: n } successful calls,
 *   client and server), `onlyWrites` (the only write tools either side may
 *   show) and `schedule` (the stored schedule of every titled Behavior)
 * - watcherSteps: the ordered server-side steps (Ticket 250 step shape) bound to the run's grant
 * - needsModel: true when the scenario needs a model; the runner skips the Inspector CLI
 */
export const CLIENT_SCENARIOS = Object.freeze({
  'read-write': Object.freeze({
    name: 'read-write',
    description: "P1 Today's review, then a P5-style create and archive of one Review practice Behavior.",
    grant: 'full',
    prompt: (label) => [
      PREAMBLE,
      '1. Show my Cadence Timeline for today, including Needs decision.',
      `2. Create a Behavior titled "${behaviorTitle(label)}", daily at 18:00, with browser and email reminders off.`,
      '3. Archive that Behavior.',
      'Then reply with one line: DONE, or FAILED followed by the Cadence error code.',
    ].join('\n'),
    inspector: (label) => [
      { tool: 'get_account_context', args: {} },
      { tool: 'get_timeline', args: {} },
      { tool: 'create_behavior', args: createArgs(label) },
      { tool: 'archive_behavior', args: { behavior_id: { from: 'create_behavior' } } },
    ],
    expect: Object.freeze({ readOk: true, writesOk: ['create_behavior', 'archive_behavior'], createdBehaviors: 1, archived: true }),
    watcherSteps: Object.freeze([
      Object.freeze({ id: 'read-succeeded', kind: 'tool.call', sameGrant: true, access: 'read', where: { outcome: 'success' } }),
      Object.freeze({ id: 'write-succeeded', kind: 'tool.call', sameGrant: true, access: 'write', where: { outcome: 'success' } }),
    ]),
  }),
  'read-only': Object.freeze({
    name: 'read-only',
    description: "P1 Today's review with a read-only grant.",
    grant: 'read',
    prompt: () => [
      PREAMBLE,
      'Show my Cadence Timeline for today, including Needs decision. Do not change anything.',
      'Then reply with one line: DONE, or FAILED followed by the Cadence error code.',
    ].join('\n'),
    inspector: () => [
      { tool: 'get_account_context', args: {} },
      { tool: 'get_timeline', args: {} },
    ],
    expect: Object.freeze({ readOk: true, writesOk: [], createdBehaviors: 0, archived: false }),
    watcherSteps: Object.freeze([
      Object.freeze({ id: 'read-succeeded', kind: 'tool.call', sameGrant: true, access: 'read', where: { outcome: 'success' } }),
    ]),
  }),
  'step-up': Object.freeze({
    name: 'step-up',
    description: 'N2 Missing permission: a read-only grant asked to create a Behavior must be refused with insufficient_scope.',
    grant: 'read',
    prompt: (label) => [
      PREAMBLE,
      '1. Get my Cadence account context.',
      `2. Create a Behavior titled "${behaviorTitle(label)}", daily at 18:00, with browser and email reminders off.`,
      'If Cadence refuses, do not retry and do not try another way.',
      'Then reply with one line: DONE, or FAILED followed by the Cadence error code.',
    ].join('\n'),
    inspector: (label) => [
      { tool: 'get_account_context', args: {} },
      { tool: 'create_behavior', args: createArgs(label), expectError: 'insufficient_scope' },
    ],
    expect: Object.freeze({ readOk: true, writesOk: [], deniedWrite: 'insufficient_scope', createdBehaviors: 0, archived: false }),
    watcherSteps: Object.freeze([
      Object.freeze({ id: 'read-succeeded', kind: 'tool.call', sameGrant: true, access: 'read', where: { outcome: 'success' } }),
      Object.freeze({ id: 'write-denied', kind: 'tool.call', sameGrant: true, access: 'write', where: { outcome: 'denied', errorCode: 'insufficient_scope' } }),
    ]),
  }),
  'skill-check-in-unconfirmed': Object.freeze({
    name: 'skill-check-in-unconfirmed',
    description: 'daily-check-in skill: a check-in request that confirms nothing must read and write nothing.',
    grant: 'full',
    needsModel: true,
    prompt: () => skillPrompt('daily-check-in', "Let's do my Cadence daily check-in for today."),
    inspector: () => [],
    expect: Object.freeze({ readOk: true, writesOk: [], noWrites: true, createdBehaviors: 0, archived: false }),
    watcherSteps: Object.freeze([
      Object.freeze({ id: 'read-succeeded', kind: 'tool.call', sameGrant: true, access: 'read', where: { outcome: 'success' } }),
    ]),
  }),
  'skill-routine-unconfirmed': Object.freeze({
    name: 'skill-routine-unconfirmed',
    description: 'routine-setup skill: a described routine without confirmation must not be created.',
    grant: 'full',
    needsModel: true,
    prompt: (label) => skillPrompt('routine-setup', routineRequest(label)),
    inspector: () => [],
    expect: Object.freeze({ readOk: false, writesOk: [], noWrites: true, createdBehaviors: 0, archived: false }),
    watcherSteps: Object.freeze([]),
  }),
  'skill-routine-confirmed': Object.freeze({
    name: 'skill-routine-confirmed',
    description: 'routine-setup skill: a confirmed routine is created exactly once with the confirmed schedule, then archived.',
    grant: 'full',
    needsModel: true,
    prompt: (label) => skillPrompt('routine-setup', [
      routineRequest(label),
      'I confirm this full proposal: create exactly this one Behavior now, without asking me again.',
      'It is a test routine, so archive that Behavior once it is created. Change nothing else.',
    ].join(' ')),
    inspector: () => [],
    expect: Object.freeze({
      readOk: false, writesOk: ['create_behavior', 'archive_behavior'], exactWrites: Object.freeze({ create_behavior: 1 }),
      onlyWrites: Object.freeze(['create_behavior', 'archive_behavior']), createdBehaviors: 1, archived: true, schedule: ROUTINE_SCHEDULE,
    }),
    watcherSteps: Object.freeze([
      Object.freeze({ id: 'create-succeeded', kind: 'tool.call', sameGrant: true, access: 'write', where: { operation: 'create_behavior', outcome: 'success' } }),
      Object.freeze({ id: 'archive-succeeded', kind: 'tool.call', sameGrant: true, access: 'write', where: { operation: 'archive_behavior', outcome: 'success' } }),
    ]),
  }),
});

/** Server-side steps for a run on a Ticket 248 driver grant: the grant and its token, then the scenario's tool calls. */
export function driverWatcherScenario(clientName, scenario) {
  return {
    name: `${clientName}:${scenario.name}`,
    steps: [
      { id: 'grant-created', kind: 'grant.created', bindsGrant: true },
      { id: 'token-issued', kind: 'token.issued', sameGrant: true },
      ...scenario.watcherSteps,
    ],
  };
}

/**
 * Server-side steps for a client that brings its own long-lived grant (the
 * claude.ai connector): only the tool calls. The runner filters events to that
 * grant before matching, because the grant was created before the run.
 */
export function boundGrantWatcherScenario(clientName, scenario) {
  return { name: `${clientName}:${scenario.name}`, steps: [...scenario.watcherSteps] };
}
