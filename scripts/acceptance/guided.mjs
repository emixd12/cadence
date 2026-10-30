// Ticket 252. Guided ChatGPT web and Claude web acceptance: the fallback when
// Ticket 255's browser run stops with a named reason.
//
// The agent runs this command; Emi follows one numbered list in the Cadence QA
// Chrome window. The command starts the Ticket 250 watcher with --expect
// before printing the list, and marks each step done when Cadence's own
// records show it. Emi never reports results, pastes output or remembers
// settings: the records are the evidence.
//
//   npm run mcp:accept:guided -- --client chatgpt|claude-web [--scenario read-write|step-up] [--account A|B]
//     --target production --confirm-production      (Ticket 256 onward; kept Ticket 248 sessions,
//                                                    CADENCE_QA_SUPABASE_PUBLISHABLE_KEY)
//     --target local --db-url <loopback url> [--user-a <uuid>] [--user-b <uuid>]   (rehearsal)
//   [--run <id> [--resume]] [--timeout 30m] [--keep-grant] [--print-only]
//
// Production: preflight (no Ticket 232 grant and no earlier grant of the same
// client active), grant checkpoint as soon as the grant appears, creation
// checkpoint after the write, revoke at the end. Local: watcher only; whoever
// made a local grant revokes it.
//
// Output and the ledger hold step names, fixed reasons, IDs, scopes and
// counts. The prompts Emi sends are canned and contain no user data.
//
// Exit: 0 every step seen (and cleanup done); 1 a step was not seen before the
// timeout or the run stopped; 2 usage or setup error.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isCliEntry } from './cli-entry.mjs';
import { createRun, resumeRun } from './ledger.mjs';
import { SCENARIOS as WATCH_SCENARIOS, SOURCE_KINDS, matchScenario } from './watch.mjs';
import { CONNECTOR_NAME, PRODUCTION_MCP_URL, PROMPTS, SITES, TICKET_232_GRANT_PREFIXES } from './web-client.mjs';

export const CLIENTS = Object.freeze(['chatgpt', 'claude-web']);
export const GUIDED_SCENARIOS = Object.freeze(['read-write', 'step-up']);
const SLOTS = ['A', 'B'];
const RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT = Object.freeze({ chatgpt: 'gpt', 'claude-web': 'claude' });
const EMAILS = Object.freeze({ A: 'cadence.testing.is@gmail.com', B: 'brittlebeliefs@gmail.com' });

// Paths verified against the real sites by Ticket 255's dry run (b2fc960).
const WHERE = Object.freeze({
  chatgpt: 'Settings → Plugins → Cadence QA → Reconnect. If Cadence QA is missing: Settings → Apps → Advanced settings → Developer mode on → Create',
  'claude-web': 'Customize → Connectors → Yours → Cadence QA → Connect. If Cadence QA is missing: Add connector → Add custom connector',
});

export class GuidedStop extends Error {
  constructor(reason, step = null) { super(reason); this.reason = reason; this.step = step; }
}
const stop = (reason, step = null) => { throw new GuidedStop(reason, step); };

/**
 * Emi's numbered steps for one client and scenario. `waitFor` lists the
 * watcher scenario steps whose records complete the step. `text` is what Emi
 * reads; `instruction` is the short ledger form (one line, no prompts).
 */
export function guidedSteps({ client, scenario = 'read-write', slot = 'A', label }) {
  if (!CLIENTS.includes(client)) stop('client-invalid', 'usage');
  if (!GUIDED_SCENARIOS.includes(scenario)) stop('scenario-invalid', 'usage');
  if (!SLOTS.includes(slot)) stop('account-invalid', 'usage');
  const site = SITES[client];
  const readOnly = scenario === 'step-up';
  const consent = readOnly
    ? 'untick both write boxes ("Change Occurrence statuses and notes" and "Create, edit, archive, and restore Behaviors") if they appear, then click Allow'
    : 'leave any write boxes ticked (if none appear, the client asked for read only), then click Allow';
  const write = `If ${site.label} says it needs more access, follow its reconnect link; on Cadence's screen leave the write boxes ticked and click Allow. Approve the tool call if ${site.label} asks.`;
  // Privacy rule for Emi's own ChatGPT and Claude accounts (SKILL.md, Hard rules).
  const privacy = 'Do not open, read or search any other chat.';
  const cleanup = client === 'chatgpt'
    ? 'After the reply, archive this test chat (chat menu → Archive).'
    : 'After the reply, delete this test chat (chat menu → Delete).';
  return [
    {
      id: 'connect', waitFor: ['client-registered', 'grant-created', 'token-issued'],
      text: `In the Cadence QA Chrome window, open ${site.label}: ${WHERE[client]} (name "${CONNECTOR_NAME}", URL ${PRODUCTION_MCP_URL}). On Cadence's consent screen, check it shows test account ${slot} (${EMAILS[slot]}), ${consent}. ${privacy}`,
      instruction: `Connect ${site.label} to Cadence QA as account ${slot} and allow the ${readOnly ? 'read-only' : 'full'} grant`,
    },
    {
      id: 'read', waitFor: ['read-succeeded'],
      text: `Start a new ${site.label} chat and send exactly: ${PROMPTS.read()} Approve the tool call if ${site.label} asks. ${privacy}`,
      instruction: `Send the canned read prompt in a new ${site.label} chat`,
    },
    {
      id: 'write', waitFor: ['write-succeeded'],
      text: `In the same chat, send exactly: ${PROMPTS.write(label)} ${write} ${cleanup} ${privacy}`,
      instruction: `Send the canned write prompt in ${site.label}${readOnly ? ' and allow the step-up' : ''}`,
    },
  ];
}

/** Human steps already recorded as done in the run folder (for a resumed run). */
export function doneHumanSteps(run) {
  const done = new Set();
  let text = '';
  try { text = readFileSync(join(run.dir, 'checkpoints.jsonl'), 'utf8'); } catch { return done; }
  for (const line of text.split('\n')) {
    try {
      const r = JSON.parse(line);
      if (r.kind === 'step' && r.state === 'done' && /^human-/.test(r.name)) done.add(r.name);
    } catch { /* torn or empty line */ }
  }
  return done;
}

/** The list Emi gets: one numbered message, nothing to report back. */
export function formatSteps(steps, { client, done = new Set() }) {
  const site = SITES[client];
  return [
    `--- Steps for Emi (${site.label}; this run notices each step itself, no need to report anything) ---`,
    ...steps.map((s, i) => `${i + 1}. ${done.has(s.id) ? '(done) ' : ''}${s.text}`),
    '--- end of steps ---',
  ];
}

/**
 * Which guided steps the watcher result already proves. A step counts only
 * when every watcher step up to its last `waitFor` is matched or not visible
 * to the source, so steps complete in order.
 */
export function completedSteps(steps, result) {
  const order = result.steps.map((s) => s.id);
  const firstMissing = result.steps.findIndex((s) => s.status === 'missing');
  const reach = firstMissing === -1 ? order.length : firstMissing;
  const done = new Set();
  for (const step of steps) {
    const last = Math.max(...step.waitFor.map((id) => order.indexOf(id)));
    if (last < 0 || last >= reach) break;
    done.add(step.id);
  }
  return done;
}

export function parseGuidedArgs(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      client: { type: 'string' }, scenario: { type: 'string', default: 'read-write' }, account: { type: 'string', default: 'A' },
      target: { type: 'string' }, 'confirm-production': { type: 'boolean', default: false },
      'db-url': { type: 'string' }, 'user-a': { type: 'string' }, 'user-b': { type: 'string' },
      run: { type: 'string' }, resume: { type: 'boolean', default: false }, timeout: { type: 'string', default: '30m' },
      'keep-grant': { type: 'boolean', default: false }, 'print-only': { type: 'boolean', default: false },
    } }));
  } catch { stop('usage-invalid', 'usage'); }
  if (!CLIENTS.includes(values.client)) stop('client-invalid', 'usage');
  if (!GUIDED_SCENARIOS.includes(values.scenario)) stop('scenario-invalid', 'usage');
  if (!SLOTS.includes(values.account)) stop('account-invalid', 'usage');
  const options = {
    client: values.client, scenario: values.scenario, slot: values.account, printOnly: values['print-only'],
    target: values.target ?? null, runId: values.run ?? null, resume: values.resume, timeout: values.timeout,
    keepGrant: values['keep-grant'], dbUrl: values['db-url'] ?? null,
    userIds: { A: values['user-a'] ?? null, B: values['user-b'] ?? null },
  };
  if (options.printOnly) return options;
  if (!['local', 'production'].includes(options.target)) stop('target-required', 'usage');
  if (!/^\d{1,4}m$/.test(options.timeout)) stop('timeout-invalid', 'usage');
  if (options.runId !== null && !RUN_ID.test(options.runId)) stop('run-id-invalid', 'usage');
  if (options.resume && options.runId === null) stop('resume-needs-run', 'usage');
  for (const slot of SLOTS) if (options.userIds[slot] !== null && !UUID.test(options.userIds[slot])) stop('user-id-invalid', 'usage');
  if (options.target === 'production') {
    if (!values['confirm-production']) stop('confirm-production-required', 'usage');
    if (options.dbUrl || options.userIds.A || options.userIds.B) stop('production-fixed-accounts', 'usage');
  } else if (!options.dbUrl) stop('db-url-required', 'usage');
  return options;
}

/** Watcher arguments: always --expect, always into the same run folder. */
export function watcherArgs({ options, scenario, sinceIso, runId }) {
  const args = ['--target', options.target, '--account', options.slot, '--since', sinceIso, '--expect', scenario,
    '--run', runId, '--timeout', options.timeout, '--json'];
  if (options.target === 'production') args.push('--confirm-production');
  else {
    args.push('--db-url', options.dbUrl);
    for (const slot of SLOTS) if (options.userIds[slot]) args.push(`--user-${slot.toLowerCase()}`, options.userIds[slot]);
  }
  return args;
}

/**
 * Ticket 250 watcher as a child process. Event lines (--json) are parsed and
 * handed to `onEvent`; other lines are the watcher's own fixed-label text.
 */
export function spawnWatcher({ spawnImpl = spawn, node = process.execPath } = {}) {
  return {
    start({ args, onEvent, onText }) {
      const script = fileURLToPath(new URL('./watch.mjs', import.meta.url));
      const child = spawnImpl(node, [script, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        let parsed = null;
        if (line.startsWith('{')) { try { parsed = JSON.parse(line); } catch { parsed = null; } }
        if (parsed?.type === 'watcher.event') onEvent(parsed);
        else onText(line);
      });
      // 'close' fires after stdout ends, so every event line is handled first.
      const result = new Promise((resolveExit) => {
        child.once('close', (code) => resolveExit(typeof code === 'number' ? code : 3));
        child.once('error', () => resolveExit(3));
      });
      return { result, stop: () => { if (child.exitCode === null) child.kill('SIGTERM'); } };
    },
  };
}

/**
 * One guided run. Production passes `rest` (Ticket 232 createRest as the test
 * account) and `cleanup` ({ listGrants, checkpointGrant, checkpointCreation,
 * revokeCaptured }); local passes neither.
 */
export async function runGuided({ options, run, watcher, rest = null, cleanup = null, out, now = () => new Date(), label: labelArg = null }) {
  const site = SITES[options.client];
  const watchScenario = WATCH_SCENARIOS[site.watcherScenario];
  const kinds = SOURCE_KINDS[options.target === 'production' ? 'rpc' : 'db'];
  const production = options.target === 'production';
  if (production && (!rest || !cleanup)) stop('production-deps-missing', 'setup');
  let watch = null;
  try {
    const pre = await run.step('preflight', async () => {
      let known = [];
      if (production) {
        const grants = await cleanup.listGrants({ rest, slot: options.slot });
        if (grants.some((g) => TICKET_232_GRANT_PREFIXES.some((p) => g.grant_id.startsWith(p)))) stop('ticket-232-grants-active', 'preflight');
        if (grants.some((g) => g.client_name === site.consentClient)) stop('client-grant-active', 'preflight');
        known = grants.map((g) => g.grant_id);
      }
      const label = labelArg ?? `guided-${SHORT[options.client]}-${options.slot.toLowerCase()}-${randomBytes(3).toString('hex')}`;
      return { windowStartAt: now().toISOString(), knownGrantIds: known, runLabel: label };
    });
    const steps = guidedSteps({ client: options.client, scenario: options.scenario, slot: options.slot, label: pre.runLabel });

    const events = [];
    let seen = new Set();
    const waiters = new Map();
    let exited = null;
    const settle = () => {
      const result = matchScenario(watchScenario, events, { kinds });
      seen = completedSteps(steps, result);
      for (const [id, resolveStep] of waiters) if (seen.has(id)) { waiters.delete(id); resolveStep(result); }
    };
    watch = watcher.start({
      args: watcherArgs({ options, scenario: watchScenario.name, sinceIso: pre.windowStartAt, runId: run.runId }),
      onEvent: (event) => { events.push(event); settle(); },
      onText: (line) => out(`watcher: ${line}`),
    });
    watch.result.then((code) => {
      exited = code;
      if (events.length) settle();
      for (const [, resolveStep] of waiters) resolveStep(null);
      waiters.clear();
    });
    const waitFor = (id) => (seen.has(id) ? Promise.resolve(true) : exited !== null ? Promise.resolve(null)
      : new Promise((resolveStep) => waiters.set(id, resolveStep)));

    const doneBefore = doneHumanSteps(run);
    for (const line of formatSteps(steps, { client: options.client, done: new Set(steps.filter((s) => doneBefore.has(`human-${s.id}`)).map((s) => s.id)) })) out(line);

    let grant = null;
    for (const [index, step] of steps.entries()) {
      await run.step(`human-${step.id}`, async ({ checkpoint }) => {
        checkpoint('human', { name: `human-${step.id}`, state: 'pending', instruction: `Step ${index + 1}: ${step.instruction}` });
        const ok = await waitFor(step.id);
        if (!ok) stop(exited === 1 ? 'step-not-seen' : 'watcher-failed', `human-${step.id}`);
        checkpoint('human', { name: `human-${step.id}`, state: 'done', instruction: null });
        return { seenAt: now().toISOString() };
      });
      out(`seen: step ${index + 1} (${step.id})${index + 1 < steps.length ? ` · waiting for step ${index + 2}` : ''}`);
      if (step.id === 'connect' && production) {
        grant = await run.step('grant-checkpoint', async ({ checkpoint }) => {
          const existing = run.cleanupInputs().grants.find((g) => g.label === `${pre.runLabel}-grant`);
          if (existing) return existing;
          const cp = await cleanup.checkpointGrant({ rest, slot: options.slot, label: `${pre.runLabel}-grant`, known: pre.knownGrantIds, since: pre.windowStartAt });
          if (cp.clientName !== site.consentClient) stop('grant-client-mismatch', 'grant-checkpoint');
          checkpoint('grant', cp);
          return cp;
        });
        out(`grant: ${grant.grantId.slice(0, 8)} scopes=${grant.scopes.join(',')}`);
      }
    }
    if (production) {
      const creation = await run.step('creation-checkpoint', async ({ checkpoint }) => {
        const existing = run.cleanupInputs().creations.find((c) => c.label === `${pre.runLabel}-create`);
        if (existing) return existing;
        const cp = await cleanup.checkpointCreation({ rest, slot: options.slot, label: `${pre.runLabel}-create`, grantId: grant.grantId, windowStart: pre.windowStartAt, recorded: [] });
        checkpoint('creation', cp);
        return cp;
      });
      out(`created: behavior ${creation.behaviorId.slice(0, 8)}`);
    }
    const code = exited ?? await watch.result;
    watch = null;
    if (code !== 0) stop(code === 1 ? 'watcher-unsatisfied' : 'watcher-failed', 'watcher');
    if (production && !options.keepGrant) {
      const revoked = await run.step('revoke', async () => {
        const results = await cleanup.revokeCaptured({ rest, captured: run.cleanupInputs().grants.filter((g) => g.label === `${pre.runLabel}-grant`) });
        return { revokedCount: results.filter((r) => r.outcome !== 'revoke-failed').length };
      });
      out(`revoked: ${revoked.revokedCount} grant(s)`);
    } else if (!production) {
      out('local rehearsal: no grant checkpoint or revoke; whoever made the local grant revokes it');
    }
    out(`done: all ${steps.length} steps seen in Cadence's records`);
    return { ok: true, runId: run.runId };
  } catch (error) {
    const reason = error instanceof GuidedStop ? error.reason : typeof error?.reason === 'string' ? error.reason : typeof error?.code === 'string' ? error.code : 'internal-error';
    out(`stopped: ${reason}${error?.step ? ` at ${error.step}` : ''}. Resume: npm run mcp:accept:guided -- <same flags> --run ${run.runId} --resume`);
    return { ok: false, runId: run.runId, reason };
  } finally {
    watch?.stop();
  }
}

async function productionDeps(env) {
  const key = env.CADENCE_QA_SUPABASE_PUBLISHABLE_KEY;
  if (!/^sb_publishable_/.test(key ?? '')) stop('publishable-key-required', 'setup');
  const sessionsModule = await import('./test-account-sessions.mjs');
  const cleanup = await import('../mcp-acceptance-cleanup.mjs');
  const { PRODUCTION } = sessionsModule;
  const sessions = sessionsModule.createSessionManager({
    target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey: key, store: sessionsModule.createKeychainSessionStore(),
  });
  const rest = cleanup.createRest({
    origin: PRODUCTION.supabaseUrl, publishableKey: key,
    tokenFor: async (slot) => { try { return (await sessions.current(slot, { expectUserId: PRODUCTION.accounts[slot].userId })).accessToken; } catch { return null; } },
  });
  return { rest, cleanup };
}

export async function main(argv = process.argv.slice(2), env = process.env, out = (line) => process.stdout.write(`${line}\n`), deps = {}) {
  let options;
  try { options = parseGuidedArgs(argv); } catch (error) {
    out(`guided-stopped ${error instanceof GuidedStop ? error.reason : 'usage-invalid'}`);
    return 2;
  }
  if (options.printOnly) {
    const steps = guidedSteps({ client: options.client, scenario: options.scenario, slot: options.slot, label: 'guided-preview' });
    for (const line of formatSteps(steps, { client: options.client })) out(line);
    out('Preview only: a real run prints its own label and starts the watcher before Emi acts.');
    return 0;
  }
  let run;
  try {
    const production = options.target === 'production';
    const { rest = null, cleanup = null } = production ? (deps.production ?? await productionDeps(env)) : {};
    run = options.resume ? resumeRun({ runId: options.runId, ...(deps.root ? { root: deps.root } : {}) }) : createRun({
      target: options.target, accounts: [options.slot], scenarios: [`guided:${options.client}:${options.scenario}`],
      steps: ['preflight', 'human-connect', ...(production ? ['grant-checkpoint'] : []), 'human-read', 'human-write',
        ...(production ? ['creation-checkpoint'] : []), ...(production && !options.keepGrant ? ['revoke'] : [])],
      ...(options.runId ? { runId: options.runId } : {}), ...(deps.root ? { root: deps.root } : {}),
    });
    out(`run: ${run.runId}`);
    const result = await runGuided({ options, run, watcher: deps.watcher ?? spawnWatcher(), rest, cleanup, out, now: deps.now, label: deps.label ?? null });
    return result.ok ? 0 : 1;
  } catch (error) {
    out(`guided-stopped ${error instanceof GuidedStop ? error.reason : typeof error?.code === 'string' ? error.code : typeof error?.reason === 'string' ? error.reason : 'internal-error'}`);
    return 2;
  } finally {
    run?.renderState?.();
    run?.close?.();
  }
}

if (isCliEntry(import.meta)) process.exitCode = await main();
