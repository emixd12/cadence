// Ticket 251: headless real-client runners.
//
//   npm run mcp:accept:clients -- --client <name>[,<name>]|all --account A|B --scenario <name> --target local|production [options]
//
// Clients: claude-code, claude-ai, anthropic-api, openai-api, inspector (see clients.mjs).
// Scenarios: read-write, read-only, step-up (see client-prompts.mjs).
//
// For each enabled client the runner:
//   1. registers a fresh DCR client and gets its own grant from Ticket 248's
//      OAuth driver (the claude.ai connector brings its own grant instead), so
//      the watcher tells clients apart by grant: the server never records
//      initialize or the client's name (Ticket 250 gap report);
//   2. runs the real client with the canned scenario and the token held in memory;
//   3. cross-checks the client's own tool calls against Ticket 250's watcher
//      events for that grant, and the final database state of the Behaviors
//      the scenario names;
//   4. revokes the grant and writes token-free JSON evidence to the Ticket 247
//      run ledger (one step per client).
// A client whose key, tool or reachable issuer is missing reports
// "skipped: missing X" and never fails the others.
//
// Local (isolated stack, HTTPS issuer on 4450-4459, loopback database):
//   CADENCE_LOCAL_SUPABASE_URL=… CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY=… \
//   npm run mcp:accept:clients -- --target local --issuer https://127.0.0.1:4450 --ca-file <ca.pem> --db-url <loopback url> --client claude-code,inspector
// Production (Ticket 256 onward; key from qa-config.mjs; needs kept Ticket 248 sessions):
//   npm run agent:secret -- --run .intent/acceptance/<run-id> --caller client-runners \
//     --env ANTHROPIC_API_KEY=anthropic-api-key --env OPENAI_API_KEY=openai-api-key -- \
//     node scripts/acceptance/client-runners.mjs --target production --allow-production --run <run-id> --client all
// Readiness only (no client is started, nothing is called): add --check.
//
// Exit: 0 every enabled client passed (skips allowed); 1 a client failed; 2 usage or setup error.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { parseArgs } from 'node:util';
import { isCliEntry } from './cli-entry.mjs';
import { CLIENT_SCENARIOS, behaviorTitle, boundGrantWatcherScenario, driverWatcherScenario } from './client-prompts.mjs';
import {
  CLAUDE_AI_CONNECTOR, CLAUDE_MODEL, ClientStop, LIMITS, OPENAI_MODEL, TOKEN_ENV, childEnv, claudeCodeArgs, findInspector,
  inspectorArgs, inspectorConfig, parseClaudeInit, parseClaudeStream, parseInspectorResult, runAnthropicApi, runOpenaiApi, runProcess, which,
} from './clients.mjs';
import { DEFAULT_ROOT, LedgerStop, createRun, resumeRun } from './ledger.mjs';
import { OPERATION_ACCESS, TEST_ACCOUNTS, PRODUCTION_SUPABASE_ORIGIN, assertLocalDbUrl, createDbSource, createDiffer, createRpcSource, ledgerRecord, matchScenario, psqlQuery } from './watch.mjs';
import { qaPublishableKey } from './qa-config.mjs';

export const CLIENTS = Object.freeze(['claude-code', 'claude-ai', 'anthropic-api', 'openai-api', 'inspector']);
const SHORT = Object.freeze({ 'claude-code': 'cc', 'claude-ai': 'cai', 'anthropic-api': 'aapi', 'openai-api': 'oapi', inspector: 'insp' });
export const CALLBACK_PORT = 4459;
const LOCAL_PORTS = { min: 4450, max: 4459 };

export class RunnerStop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const stop = (reason) => { throw new RunnerStop(reason); };
const reasonOf = (error) => (typeof error?.reason === 'string' ? error.reason : typeof error?.code === 'string' && /^[a-z0-9-]{1,60}$/.test(error.code) ? error.code : 'internal-error');

// ---------------------------------------------------------------------------
// Arguments and readiness
// ---------------------------------------------------------------------------

export function parseClientArgs(argv) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    client: { type: 'string', default: 'all' }, account: { type: 'string', default: 'A' }, scenario: { type: 'string', default: 'read-write' },
    target: { type: 'string' }, 'allow-production': { type: 'boolean', default: false }, issuer: { type: 'string' },
    'ca-file': { type: 'string' }, 'db-url': { type: 'string' }, run: { type: 'string' }, check: { type: 'boolean', default: false },
    'claude-auth': { type: 'string', default: 'auto' }, 'openai-model': { type: 'string', default: OPENAI_MODEL },
    'watch-timeout': { type: 'string', default: '60' }, list: { type: 'boolean', default: false },
  } });
  if (values.list) return { list: true };
  const clients = values.client === 'all' ? [...CLIENTS] : values.client.split(',').map((c) => c.trim());
  if (!clients.length || !clients.every((c) => CLIENTS.includes(c)) || new Set(clients).size !== clients.length) stop('client-unknown');
  if (!['A', 'B'].includes(values.account)) stop('account-invalid');
  if (!CLIENT_SCENARIOS[values.scenario]) stop('scenario-unknown');
  if (!['local', 'production'].includes(values.target)) stop('target-required');
  if (values.target === 'production' && !values['allow-production']) stop('production-requires-allow-production');
  if (!['auto', 'api-key', 'subscription'].includes(values['claude-auth'])) stop('claude-auth-invalid');
  if (!/^[a-z0-9][a-z0-9.-]{1,40}$/.test(values['openai-model'])) stop('openai-model-invalid');
  if (values.run !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(values.run)) stop('run-id-invalid');
  const watchTimeoutS = Number(values['watch-timeout']);
  if (!Number.isInteger(watchTimeoutS) || watchTimeoutS < 5 || watchTimeoutS > 600) stop('watch-timeout-invalid');
  let issuer = null;
  if (values.target === 'local') {
    if (values.check) issuer = values.issuer ?? null;
    else {
      if (!values.issuer || !values['ca-file'] || !values['db-url']) stop('local-needs-issuer-ca-file-db-url');
      issuer = localIssuer(values.issuer);
      try { assertLocalDbUrl(values['db-url']); } catch (error) { stop(typeof error?.code === 'string' ? error.code : 'db-url-invalid'); }
    }
  } else {
    if (values.issuer || values['db-url'] || values['ca-file']) stop('production-fixed-issuer');
  }
  return {
    clients, slot: values.account, scenario: values.scenario, target: values.target, issuer, caFile: values['ca-file'] ?? null,
    dbUrl: values['db-url'] ?? null, runId: values.run ?? null, check: values.check, claudeAuth: values['claude-auth'],
    openaiModel: values['openai-model'], watchTimeoutMs: watchTimeoutS * 1000,
  };
}

/** Local issuers must be HTTPS on loopback inside this ticket's port range. */
export function localIssuer(value) {
  let url;
  try { url = new URL(value); } catch { return stop('local-issuer-invalid'); }
  const port = Number(url.port);
  if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1' || url.origin !== value || port < LOCAL_PORTS.min || port > LOCAL_PORTS.max) stop('local-issuer-invalid');
  return url.origin;
}

/**
 * Why a client cannot run here, or null. Nothing is started and no network is used.
 * The claude.ai connector's own status is checked later, in production only,
 * because loading it contacts the connected server.
 */
export function readiness(client, { target, env, findTool = which, findInspectorCli = findInspector }) {
  const publicIssuer = target === 'production';
  switch (client) {
    case 'claude-code': return findTool('claude', env) ? null : 'missing claude CLI on PATH';
    case 'claude-ai':
      if (!publicIssuer) return 'missing public issuer: the claude.ai connector reaches production only';
      return findTool('claude', env) ? null : 'missing claude CLI on PATH';
    case 'anthropic-api':
      if (!env.ANTHROPIC_API_KEY) return 'missing ANTHROPIC_API_KEY (run through npm run agent:secret)';
      return publicIssuer ? null : 'missing public issuer: the Anthropic API cannot reach a local stack';
    case 'openai-api':
      if (!env.OPENAI_API_KEY) return 'missing OPENAI_API_KEY (run through npm run agent:secret)';
      return publicIssuer ? null : 'missing public issuer: the OpenAI API cannot reach a local stack';
    case 'inspector': return findInspectorCli({ env }) ? null : 'missing MCP Inspector 2.13.0 (run npx -y @modelcontextprotocol/inspector@2.13.0 --cli --version once)';
    default: return 'unknown client';
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const isRead = (tool) => OPERATION_ACCESS[tool] === 'read';
const isWrite = (tool) => OPERATION_ACCESS[tool] === 'write';

/** Pair client-side calls with the watcher's tool.call events for the same grant. */
export function compareCalls(clientCalls, serverEvents) {
  const server = serverEvents.filter((e) => e.kind === 'tool.call').map((e) => ({ tool: e.operation, ok: e.outcome === 'success', used: false }));
  let unmatchedClient = 0;
  for (const call of clientCalls) {
    const hit = server.find((s) => !s.used && s.tool === call.tool && s.ok === call.ok);
    if (hit) hit.used = true; else unmatchedClient += 1;
  }
  return { clientCallCount: clientCalls.length, serverCallCount: server.length, unmatchedClientCount: unmatchedClient, unmatchedServerCount: server.filter((s) => !s.used).length };
}

/** Pass/fail per check; null means not applicable to this client. */
export function evaluate({ expect, evidence, watcher, calls, behaviors }) {
  const toolCalls = evidence.toolCalls ?? [];
  const writesOk = toolCalls.filter((c) => isWrite(c.tool) && c.ok).map((c) => c.tool);
  const checks = {
    connected: evidence.toolCount === null || evidence.toolCount === undefined ? null : evidence.toolCount > 0,
    readSucceeded: expect.readOk ? toolCalls.some((c) => isRead(c.tool) && c.ok) : null,
    writesSucceeded: expect.writesOk.length ? expect.writesOk.every((tool) => writesOk.includes(tool)) : writesOk.length === 0,
    writeDenied: expect.deniedWrite
      ? toolCalls.some((c) => isWrite(c.tool) && c.errorCode === expect.deniedWrite) || watcher?.steps?.some((s) => s.id === 'write-denied' && s.status === 'matched') === true
      : null,
    onlyCadenceTools: (evidence.foreignToolCallCount ?? 0) === 0,
    watcherSatisfied: watcher ? watcher.satisfied : null,
    clientMatchesWatcher: calls ? calls.unmatchedClientCount === 0 && calls.unmatchedServerCount === 0 : null,
    behaviorsAsExpected: behaviors ? behaviors.count === expect.createdBehaviors && (!expect.archived || behaviors.archivedCount === behaviors.count) : null,
  };
  const failed = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k);
  return { outcome: failed.length ? 'fail' : 'pass', checks, failedChecks: failed };
}

// ---------------------------------------------------------------------------
// Server-side cross-check and final state
// ---------------------------------------------------------------------------

/**
 * Poll the watcher source until the scenario's steps match on `grantId`, or
 * the deadline passes. Every event for the grant goes to the run ledger.
 */
export async function crossCheck({ source, scenario, grantId, sinceIso, run, runId, timeoutMs, intervalMs = 3000, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const differ = createDiffer({ sinceIso, sourceName: source.name });
  const events = [];
  const deadline = now() + timeoutMs;
  let failures = 0;
  let result = null;
  while (true) {
    try {
      const fresh = differ(await source.snapshot(), new Date(now()).toISOString()).filter((e) => e.grantId === grantId);
      failures = 0;
      events.push(...fresh);
      for (const e of fresh) run.appendEvent(ledgerRecord(e, runId));
      result = matchScenario(scenario, events, { kinds: source.kinds });
      if (result.satisfied) break;
    } catch {
      failures += 1;
      if (failures >= 3) return { satisfied: false, error: 'source-unreadable', steps: [], events };
    }
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  return { satisfied: Boolean(result?.satisfied), steps: (result?.steps ?? []).map((s) => ({ id: s.id, status: s.status })), events };
}

const BEHAVIOR_SQL = `
begin transaction read only;
select coalesce(json_agg(json_build_object('id', id, 'archived', archived_at is not null, 'created_at', created_at) order by created_at), '[]'::json)
from public.behaviors where user_id = :'uid'::uuid and title = :'title';
rollback;
`;

/** Local final state: Behaviors with the scenario's exact title, read in a read-only transaction. */
export function localBehaviorState({ dbUrl, execFileImpl = execFile }) {
  const url = assertLocalDbUrl(dbUrl);
  return ({ userId, title }) => new Promise((resolve, reject) => {
    const child = execFileImpl('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', `uid=${userId}`, '-v', `title=${title}`, url], {
      encoding: 'utf8', timeout: 10_000, env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '5' },
    }, (error, stdout) => {
      if (error) return reject(new RunnerStop('db-unreadable'));
      try { resolve(JSON.parse(String(stdout).split('\n').find((l) => l.trim().startsWith('[')))); } catch { reject(new RunnerStop('db-unreadable')); }
    });
    child.stdin?.end(BEHAVIOR_SQL);
  });
}

/** Production final state through the account's own session (RLS), the same read path as the watcher. */
export function restBehaviorState({ rest, slotOf }) {
  return async ({ userId, title }) => {
    const r = await rest(slotOf(userId), 'GET', `/rest/v1/behaviors?user_id=eq.${userId}&title=eq.${encodeURIComponent(title)}&select=id,archived_at,created_at&order=created_at`);
    if (!r || r.status !== 200 || !Array.isArray(r.json)) throw new RunnerStop('behaviors-unreadable');
    return r.json.map((b) => ({ id: b.id, archived: b.archived_at !== null, created_at: b.created_at }));
  };
}

const summarizeBehaviors = (rows) => ({
  count: rows.length, archivedCount: rows.filter((r) => r.archived).length,
  behaviorIds: rows.map((r) => String(r.id).toLowerCase()).filter((id) => /^[0-9a-f-]{36}$/.test(id)),
});

// ---------------------------------------------------------------------------
// One client
// ---------------------------------------------------------------------------

export const runTag = (runId) => createHash('sha256').update(runId).digest('hex').slice(0, 6);

/**
 * Run one client inside its ledger step. `h` is the harness (driver, sessions,
 * source factory, behavior reader, adapters). Returns token-free evidence.
 */
export async function runOneClient(client, { h, run, runId, slot, scenario, attempt, interrupted, checkpoint }) {
  const label = `${runTag(runId)}-${SHORT[client]}-${attempt}`;
  const title = behaviorTitle(label);
  const userId = h.userIdOf(slot);
  if (interrupted) {
    // A previous attempt died after it may have created a grant: revoke what the ledger recorded for this client first.
    for (const g of run.cleanupInputs().grants.filter((x) => x.label.startsWith(`${runTag(runId)}-${SHORT[client]}-`))) {
      await h.driver.revokeGrants(g.slot, g.clientId).catch(() => 0);
    }
  }
  const sinceIso = new Date(h.now() - 2000).toISOString();
  let tokens = null;
  let registration = null;
  let grantId;
  let watcherScenario;
  try {
    if (client === 'claude-ai') {
      grantId = await h.connectorGrant(slot);
      watcherScenario = boundGrantWatcherScenario(client, scenario);
    } else {
      registration = await h.driver.registerDynamic({ name: `Cadence acceptance ${client}` });
      tokens = await h.driver.authorize({ slot, client: registration, grant: scenario.grant });
      const grants = await h.driver.grantsFor(slot, registration.clientId);
      if (grants.length !== 1) stop('expected-one-grant');
      grantId = grants[0].grantId;
      checkpoint('grant', { label, slot, grantId, clientId: registration.clientId, clientName: registration.clientName ?? null, scopes: grants[0].scopes });
      watcherScenario = driverWatcherScenario(client, scenario);
    }
    let evidence;
    try {
      evidence = await h.adapters[client]({ token: tokens?.accessToken ?? null, scenario, label, slot });
    } catch (error) {
      evidence = { toolCalls: [], error: reasonOf(error) };
    }
    const watcher = await crossCheck({ source: h.source(slot, sinceIso), scenario: watcherScenario, grantId, sinceIso, run, runId, timeoutMs: h.watchTimeoutMs, now: h.now });
    const serverEvents = watcher.events;
    delete watcher.events;
    const calls = compareCalls(evidence.toolCalls ?? [], serverEvents);
    const behaviors = summarizeBehaviors(await h.behaviors({ userId, title }));
    for (const [index, behaviorId] of behaviors.behaviorIds.entries()) {
      checkpoint('creation', { label: `${label}-b${index + 1}`, slot, behaviorId, grantId });
    }
    const verdict = evidence.error ? { outcome: 'fail', checks: {}, failedChecks: ['client-run'] } : evaluate({ expect: scenario.expect, evidence, watcher, calls, behaviors });
    return {
      client, scenario: scenario.name, slot, label, grantId, outcome: verdict.outcome, failedChecks: verdict.failedChecks, checks: verdict.checks,
      evidence, watcher: { satisfied: watcher.satisfied, error: watcher.error ?? null, steps: watcher.steps }, calls, behaviors,
    };
  } finally {
    if (tokens) {
      await tokens.revoke().catch(() => {});
      await h.driver.revokeGrants(slot, registration.clientId).catch(() => 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Adapters bound to the environment
// ---------------------------------------------------------------------------

export function createAdapters({ issuer, env, caFile, claudeAuth, openaiModel, connectorServers = () => [], limits = LIMITS, fetchImpl = fetch, run = runProcess, inspectorCli = () => findInspector({ env }) }) {
  const caEnv = caFile ? { NODE_EXTRA_CA_CERTS: caFile } : {};
  const apiKeyAuth = claudeAuth === 'api-key' || (claudeAuth === 'auto' && Boolean(env.ANTHROPIC_API_KEY));
  const withTemp = async (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'cadence-251-'));
    try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  return {
    'claude-code': async ({ token, scenario, label }) => withTemp(async (cwd) => {
      if (apiKeyAuth && !env.ANTHROPIC_API_KEY) throw new ClientStop('missing-anthropic-api-key');
      const args = claudeCodeArgs({ mode: 'claude-code', issuer, limits, apiKeyAuth });
      const childEnvironment = childEnv(env, { [TOKEN_ENV]: token.reveal(), ...caEnv, ...(apiKeyAuth ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}) });
      const result = await run(which('claude', env) ?? 'claude', args, { env: childEnvironment, cwd, stdin: scenario.prompt(label), timeoutMs: limits.timeoutMs });
      return { auth: apiKeyAuth ? 'api-key' : 'subscription', exitCode: result.code, killed: result.killed ?? null, ...parseClaudeStream(result.stdout) };
    }),
    'claude-ai': async ({ scenario, label }) => withTemp(async (cwd) => {
      const args = claudeCodeArgs({ mode: 'claude-ai', limits, denyServers: connectorServers() });
      // claude.ai connectors need the claude.ai sign-in, so no API key reaches this child.
      const result = await run(which('claude', env) ?? 'claude', args, { env: childEnv(env), cwd, stdin: scenario.prompt(label), timeoutMs: limits.timeoutMs });
      return { auth: 'subscription', exitCode: result.code, killed: result.killed ?? null, ...parseClaudeStream(result.stdout, { serverName: CLAUDE_AI_CONNECTOR }) };
    }),
    'anthropic-api': async ({ token, scenario, label }) => ({ model: CLAUDE_MODEL, ...(await runAnthropicApi({ issuer, token, prompt: scenario.prompt(label), apiKey: env.ANTHROPIC_API_KEY, fetchImpl, limits })) }),
    'openai-api': async ({ token, scenario, label }) => ({ ...(await runOpenaiApi({ issuer, token, prompt: scenario.prompt(label), apiKey: env.OPENAI_API_KEY, fetchImpl, limits, model: openaiModel })) }),
    inspector: async ({ token, scenario, label }) => withTemp(async (cwd) => {
      const cli = inspectorCli();
      if (!cli) throw new ClientStop('missing-inspector');
      // HOME points at the run's empty temp folder, so Inspector's own storage stays there and is deleted afterwards.
      const childEnvironment = childEnv(env, { ...caEnv, MCP_INSPECTOR_SECRET_STORE: 'memory', MCP_INSPECTOR_PERSIST_TOKENS: 'none', HOME: cwd });
      const call = async (method, tool = null, args = null) => {
        const result = await run(process.execPath, [cli, ...inspectorArgs({ method, tool, args })], { env: childEnvironment, cwd, fd3: inspectorConfig(issuer, token.reveal()), timeoutMs: 60_000, keepStderr: true });
        return { exitCode: result.code, ...parseInspectorResult(result.stdout, { method, stderr: result.stderr }) };
      };
      const listed = await call('tools/list');
      const toolCalls = [];
      const created = new Map();
      for (const step of scenario.inspector(label)) {
        const args = Object.fromEntries(Object.entries(step.args).map(([k, v]) => [k, v && typeof v === 'object' && v.from ? created.get(v.from) ?? null : v]));
        if (Object.values(args).some((v) => v === null)) { toolCalls.push({ tool: step.tool, ok: false, errorCode: 'missing-input' }); continue; }
        const r = await call('tools/call', step.tool, args);
        if (!r.parsed) { toolCalls.push({ tool: step.tool, ok: false, errorCode: `unparsed-exit-${r.exitCode}` }); continue; }
        if (r.behaviorId) created.set(step.tool, r.behaviorId);
        toolCalls.push({ tool: step.tool, ok: r.ok, errorCode: r.errorCode, ...(r.behaviorId ? { behaviorId: r.behaviorId } : {}) });
      }
      return { toolCount: listed.toolCount ?? null, toolCalls, foreignToolCallCount: 0, listExitCode: listed.exitCode, listErrorCode: listed.errorCode ?? null };
    }),
  };
}

// ---------------------------------------------------------------------------
// Harness (Ticket 248 driver, sessions, watcher source, final state)
// ---------------------------------------------------------------------------

function trustLocalCertificate(caFile) {
  let pem;
  try { pem = readFileSync(caFile, 'utf8'); } catch { return stop('ca-file-unreadable'); }
  if (!/-----BEGIN CERTIFICATE-----/.test(pem)) stop('ca-file-invalid');
  setDefaultCACertificates([...getCACertificates('default'), pem]);
}

/** Start the claude.ai connector check: read only the init event, then kill the client. */
async function claudeConnectorServers(env) {
  const claude = which('claude', env);
  const dir = mkdtempSync(join(tmpdir(), 'cadence-251-'));
  try {
    const result = await runProcess(claude, ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1', '--model', CLAUDE_MODEL,
      '--no-session-persistence', '--tools', '', '--permission-prompts', 'none'], {
      env: childEnv(env), cwd: dir, stdin: 'Reply with OK.', timeoutMs: 60_000,
      stopWhen: (out) => /"subtype":"init"/.test(out) && out.includes('\n'),
    });
    return parseClaudeInit(result.stdout) ?? [];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function createHarness(options, env) {
  const [{ createOAuthDriver }, sessionsModule, { launchChrome }] = await Promise.all([
    import('./oauth-driver.mjs'), import('./test-account-sessions.mjs'), import('./consent-page.mjs'),
  ]);
  const { createSessionManager, createMemorySessionStore, createKeychainSessionStore, PRODUCTION } = sessionsModule;
  const local = options.target === 'local';
  const issuer = local ? options.issuer : PRODUCTION.issuer;
  if (local) trustLocalCertificate(options.caFile);
  const publishableKey = local ? env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY : qaPublishableKey(env);
  if (!publishableKey) stop(local ? 'missing-local-publishable-key' : 'missing-qa-publishable-key');
  const sessions = createSessionManager({
    target: options.target, publishableKey, supabaseUrl: local ? env.CADENCE_LOCAL_SUPABASE_URL : PRODUCTION.supabaseUrl,
    store: local ? createMemorySessionStore() : createKeychainSessionStore(),
  });
  const browser = await launchChrome();
  const slot = options.slot;
  if (local) await sessions.enrollLocalTestLogin(slot, { browser, issuer, contextOptions: { ignoreHTTPSErrors: true } });
  const userIdOf = (s) => (local ? sessions.account(s)?.userId : TEST_ACCOUNTS[s].userId) ?? stop('account-unknown');
  const driver = createOAuthDriver({ target: options.target, issuer, sessions, browser, callbackPort: CALLBACK_PORT, ignoreLocalCertificate: local });
  let source;
  let behaviors;
  let rest = null;
  if (local) {
    source = (s, sinceIso) => createDbSource({ query: ({ users, sinceIso: since }) => psqlQuery({ dbUrl: options.dbUrl, users, sinceIso: since }), userIds: { [s]: userIdOf(s) }, sinceIso });
    behaviors = localBehaviorState({ dbUrl: options.dbUrl });
  } else {
    const { createRest, USERS } = await import('../mcp-acceptance-cleanup.mjs');
    if (USERS.A !== TEST_ACCOUNTS.A.userId || USERS.B !== TEST_ACCOUNTS.B.userId) stop('test-account-mismatch');
    rest = createRest({ origin: PRODUCTION_SUPABASE_ORIGIN, publishableKey,
      tokenFor: async (s) => { try { return (await sessions.current(s, { expectUserId: TEST_ACCOUNTS[s].userId }))?.accessToken ?? null; } catch { return null; } } });
    source = (s, sinceIso) => createRpcSource({ rest, accounts: [s], sinceIso });
    behaviors = restBehaviorState({ rest, slotOf: (id) => (id === TEST_ACCOUNTS.A.userId ? 'A' : 'B') });
  }
  let connector = [];
  /** The claude.ai connector's own active grant for the account (verified client "claude"); exactly one is required. */
  const connectorGrant = async (s) => {
    const rows = (await sessions.userRpc(s, 'oauth_list_grants')) ?? [];
    const claude = rows.filter((row) => row.verified_client === 'claude');
    if (claude.length !== 1) stop(claude.length ? 'claude-ai-grant-ambiguous' : 'claude-ai-grant-missing');
    return claude[0].grant_id;
  };
  const adapters = createAdapters({ issuer, env, caFile: local ? options.caFile : null, claudeAuth: options.claudeAuth, openaiModel: options.openaiModel, connectorServers: () => connector });
  return {
    issuer, driver, sessions, userIdOf, source, behaviors, connectorGrant, adapters, now: () => Date.now(), watchTimeoutMs: options.watchTimeoutMs,
    /** Production only: the claude.ai connector must be connected in Claude Code before the run. */
    async connectorStatus() {
      const servers = await claudeConnectorServers(env);
      connector = servers.map((s) => s.name);
      return servers.find((s) => s.name === CLAUDE_AI_CONNECTOR)?.status ?? 'absent';
    },
    close: () => browser.close().catch(() => {}),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), { env = process.env, out = (line) => process.stdout.write(`${line}\n`), harnessFactory = createHarness, root = DEFAULT_ROOT } = {}) {
  let options;
  try { options = parseClientArgs(argv); } catch (error) { out(JSON.stringify({ step: 'usage', ok: false, error: reasonOf(error) })); return 2; }
  if (options.list) {
    for (const s of Object.values(CLIENT_SCENARIOS)) out(`${s.name} (grant ${s.grant}): ${s.description}`);
    out(`clients: ${CLIENTS.join(', ')}`);
    return 0;
  }
  const ready = Object.fromEntries(options.clients.map((c) => [c, readiness(c, { target: options.target, env })]));
  if (options.check) {
    for (const c of options.clients) out(JSON.stringify({ client: c, ready: ready[c] === null, ...(ready[c] ? { skipped: ready[c] } : {}) }));
    return 0;
  }
  const scenario = CLIENT_SCENARIOS[options.scenario];
  const steps = options.clients.map((c) => `client:${c}`);
  let run;
  try {
    run = options.runId ? openRun(options, steps, root) : createRun({ target: options.target, accounts: [options.slot], scenarios: [scenario.name], steps, root });
  } catch (error) { out(JSON.stringify({ step: 'ledger', ok: false, error: reasonOf(error) })); return 2; }
  const { runId } = run;
  out(JSON.stringify({ step: 'run', runId }));
  const results = [];
  let harness = null;
  try {
    for (const client of options.clients) {
      let result;
      try {
        result = await run.step(`client:${client}`, async ({ attempt, interrupted, checkpoint }) => {
          if (ready[client]) return { client, scenario: scenario.name, slot: options.slot, outcome: 'skipped', reason: ready[client] };
          harness ??= await harnessFactory(options, env);
          if (client === 'claude-ai') {
            const status = await harness.connectorStatus();
            if (status !== 'connected') return { client, scenario: scenario.name, slot: options.slot, outcome: 'skipped', reason: `missing claude.ai connector authorization (status ${status})` };
          }
          return runOneClient(client, { h: harness, run, runId, slot: options.slot, scenario, attempt, interrupted, checkpoint });
        });
      } catch (error) {
        result = { client, scenario: scenario.name, slot: options.slot, outcome: 'fail', reason: error instanceof LedgerStop ? `ledger-${error.reason}` : reasonOf(error) };
      }
      results.push(result);
      out(JSON.stringify({ client, outcome: result.outcome, ...(result.reason ? { reason: result.reason } : {}), ...(result.failedChecks?.length ? { failedChecks: result.failedChecks } : {}) }));
    }
  } finally {
    await harness?.close();
    run.close();
  }
  out(JSON.stringify({ step: 'summary', pass: results.filter((r) => r.outcome === 'pass').length, fail: results.filter((r) => r.outcome === 'fail').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length }));
  return results.some((r) => r.outcome === 'fail') ? 1 : 0;
}

function openRun(options, steps, root) {
  try { return resumeRun({ runId: options.runId, root }); } catch (error) {
    if (error instanceof LedgerStop && error.reason === 'run-missing') {
      return createRun({ target: options.target, accounts: [options.slot], scenarios: [options.scenario], steps, runId: options.runId, root });
    }
    throw error;
  }
}

if (isCliEntry(import.meta)) {
  main().then((code) => { process.exitCode = code; }).catch(() => { process.stdout.write(`${JSON.stringify({ step: 'stopped', ok: false })}\n`); process.exitCode = 2; });
}
