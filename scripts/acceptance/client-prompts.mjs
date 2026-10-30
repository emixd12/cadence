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
import { randomUUID } from 'node:crypto';

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

/**
 * Each scenario:
 * - grant: the Ticket 248 driver grant the run creates (read | behaviors | full)
 * - prompt(label): the canned prompt for model clients
 * - inspector(label): the scripted tool sequence for Inspector CLI mode, which
 *   has no model. `{ from: 'create_behavior' }` reuses the Behavior id that call returned.
 * - expect: what the runner checks in the client's own evidence
 * - watcherSteps: the ordered server-side steps (Ticket 250 step shape) bound to the run's grant
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
