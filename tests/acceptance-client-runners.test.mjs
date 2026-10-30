// Ticket 251: headless real-client runners. Fixture tests only; no client,
// provider or Cadence server is contacted. Claude Code fixtures are reduced
// recordings from the local stack; API fixtures follow the documented shapes.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CLIENT_SCENARIOS, behaviorTitle } from '../scripts/acceptance/client-prompts.mjs';
import {
  ANTHROPIC_MCP_BETA, ANTHROPIC_VERSION, CLAUDE_AI_CONNECTOR, CLAUDE_MODEL, ClientStop, TOKEN_ENV, parseAnthropicResponses,
  parseClaudeStream, parseInspectorResult, parseOpenaiResponse, runAnthropicApi, runOpenaiApi, toolOutcome,
} from '../scripts/acceptance/clients.mjs';
import { compareCalls, createAdapters, evaluate, localIssuer, main, parseClientArgs, readiness, runOneClient } from '../scripts/acceptance/client-runners.mjs';
import { assertSafe, createRun } from '../scripts/acceptance/ledger.mjs';
import { Secret } from '../scripts/acceptance/test-account-sessions.mjs';
import { KINDS, OPERATION_ACCESS } from '../scripts/acceptance/watch.mjs';

const FIX = (name) => fileURLToPath(new URL(`./fixtures/acceptance-clients/${name}`, import.meta.url));
const json = (name) => JSON.parse(readFileSync(FIX(name), 'utf8'));
const RUNNER = fileURLToPath(new URL('../scripts/acceptance/client-runners.mjs', import.meta.url));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SECRET = `tok_${randomBytes(30).toString('base64url')}`;
const KEY = `sk-ant-fake-${randomBytes(20).toString('hex')}`;
const dirs = [];
const tmp = (prefix = 'cadence-251-') => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
const readTree = (dir) => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
const strip = ({ tool, ok, errorCode }) => ({ tool, ok, errorCode });

describe('recorded Claude Code streams', () => {
  it('read-write: the canned scenario reads, creates and archives, and finishes DONE', () => {
    const e = parseClaudeStream(readFileSync(FIX('claude-code-read-write.jsonl'), 'utf8'));
    expect(e.mcpStatus).toBe('connected');
    expect(e.toolCount).toBe(16);
    expect(e.model).toBe(CLAUDE_MODEL);
    expect(e.toolCalls.map(strip)).toEqual([
      { tool: 'get_timeline', ok: true, errorCode: null },
      { tool: 'create_behavior', ok: true, errorCode: null },
      { tool: 'archive_behavior', ok: true, errorCode: null },
    ]);
    expect(e.toolCalls[1].behaviorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(e).toMatchObject({ foreignToolCallCount: 0, resultSubtype: 'success', finalLine: 'done', permissionDenialCount: 0 });
    expect(() => assertSafe(e)).not.toThrow();
  });

  it('step-up: the denied write is read as insufficient_scope from the client text', () => {
    const e = parseClaudeStream(readFileSync(FIX('claude-code-step-up.jsonl'), 'utf8'));
    expect(e.toolCalls.map(strip)).toEqual([
      { tool: 'get_account_context', ok: true, errorCode: null },
      { tool: 'create_behavior', ok: false, errorCode: 'insufficient_scope' },
    ]);
    expect(e.finalLine).toBe('failed');
  });

  it('counts tools from other servers as foreign and a missing init as no-init', () => {
    const stream = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__other__delete_all' }, { type: 'tool_use', id: 't2', name: 'Bash' }] } },
      { type: 'result', subtype: 'error_max_turns', num_turns: 12, result: '' },
    ].map((e) => JSON.stringify(e)).join('\n');
    expect(parseClaudeStream(stream)).toMatchObject({ mcpStatus: 'no-init', toolCalls: [], foreignToolCallCount: 2, resultSubtype: 'error_max_turns', finalLine: 'none' });
  });
});

describe('Anthropic Messages API MCP connector', () => {
  it('parses the documented blocks across a pause_turn continuation', () => {
    const e = parseAnthropicResponses(json('anthropic-api-read-write.json').responses);
    expect(e.toolCount).toBe(16);
    expect(e.toolCalls.map(strip)).toEqual([
      { tool: 'get_timeline', ok: true, errorCode: null },
      { tool: 'create_behavior', ok: true, errorCode: null },
      { tool: 'archive_behavior', ok: true, errorCode: null },
    ]);
    expect(e).toMatchObject({ stopReason: 'end_turn', turnCount: 2, inputTokenCount: 4200, outputTokenCount: 530, finalLine: 'done' });
    const denied = parseAnthropicResponses(json('anthropic-api-step-up.json').responses);
    expect(denied.toolCalls.map(strip).at(-1)).toEqual({ tool: 'create_behavior', ok: false, errorCode: 'insufficient_scope' });
  });

  it('sends the current beta, API version, model and token only in the request body, and resumes pause_turn', async () => {
    const requests = [];
    const fixture = json('anthropic-api-read-write.json').responses;
    const fetchImpl = async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(fixture[requests.length - 1]), { status: 200 });
    };
    const e = await runAnthropicApi({ issuer: 'https://app.cadence-me.com', token: new Secret(SECRET), prompt: 'p', apiKey: KEY, fetchImpl });
    expect(requests).toHaveLength(2);
    const [first, second] = requests;
    expect(first.url).toBe('https://api.anthropic.com/v1/messages');
    expect(first.init.headers).toMatchObject({ 'anthropic-beta': ANTHROPIC_MCP_BETA, 'anthropic-version': ANTHROPIC_VERSION, 'x-api-key': KEY });
    expect(ANTHROPIC_MCP_BETA).toBe('mcp-client-2026-09-15');
    expect(first.body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 4096, output_config: { effort: 'low' },
      mcp_servers: [{ type: 'url', url: 'https://app.cadence-me.com/mcp', name: 'cadence', authorization_token: SECRET }],
      tools: [{ type: 'mcp_toolset', mcp_server_name: 'cadence' }] });
    expect(first.body).not.toHaveProperty('temperature');
    expect(first.body).not.toHaveProperty('fallbacks');
    expect(second.body.messages.at(-1)).toEqual({ role: 'assistant', content: fixture[0].content });
    expect(e.toolCalls).toHaveLength(3);
    expect(JSON.stringify(e)).not.toContain(SECRET);
  });

  it('turns an API error into a fixed reason without the provider message', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `bad ${SECRET}` } }), { status: 400 });
    const error = await runAnthropicApi({ issuer: 'https://app.cadence-me.com', token: new Secret(SECRET), prompt: 'p', apiKey: KEY, fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(ClientStop);
    expect(error.reason).toBe('api-400-invalid-request-error');
    expect(error.message).not.toContain(SECRET);
  });
});

describe('OpenAI Responses API mcp tool', () => {
  it('parses mcp_list_tools and mcp_call items, including a failed call', () => {
    const e = parseOpenaiResponse(json('openai-api-read-write.json').response);
    expect(e).toMatchObject({ toolCount: 16, status: 'completed', approvalRequestCount: 0, finalLine: 'done', model: 'gpt-6-luna' });
    expect(e.toolCalls.map(strip)).toEqual([
      { tool: 'get_timeline', ok: true, errorCode: null },
      { tool: 'create_behavior', ok: true, errorCode: null },
      { tool: 'archive_behavior', ok: true, errorCode: null },
    ]);
    expect(parseOpenaiResponse(json('openai-api-step-up.json').response).toolCalls.map(strip).at(-1)).toEqual({ tool: 'create_behavior', ok: false, errorCode: 'insufficient_scope' });
  });

  it('never asks for approval, caps tool calls and stores nothing at OpenAI', async () => {
    let captured;
    const fetchImpl = async (url, init) => { captured = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify(json('openai-api-read-write.json').response), { status: 200 }); };
    await runOpenaiApi({ issuer: 'https://app.cadence-me.com', token: new Secret(SECRET), prompt: 'p', apiKey: KEY, fetchImpl });
    expect(captured.url).toBe('https://api.openai.com/v1/responses');
    expect(captured.init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(captured.body).toMatchObject({ model: 'gpt-6-luna', store: false, max_output_tokens: 4096, max_tool_calls: 12,
      tools: [{ type: 'mcp', server_label: 'cadence', server_url: 'https://app.cadence-me.com/mcp', authorization: SECRET, require_approval: 'never' }] });
  });
});

describe('Inspector CLI output', () => {
  const o = json('inspector-outputs.json');
  it('reads 2.13.0 result wrappers and stderr envelopes', () => {
    expect(parseInspectorResult(o.toolsList, { method: 'tools/list' })).toMatchObject({ parsed: true, toolCount: 16 });
    expect(parseInspectorResult(o.createOk, { method: 'tools/call' })).toEqual({ parsed: true, ok: true, errorCode: null, behaviorId: 'e3e71997-b9a6-4e0c-a6f2-d08a9afc562b' });
    expect(parseInspectorResult(o.toolError, { method: 'tools/call' })).toMatchObject({ ok: false, errorCode: 'not_found' });
    expect(parseInspectorResult('', { method: 'tools/call', stderr: o.stepUpStderr })).toMatchObject({ ok: false, errorCode: 'insufficient_scope' });
    expect(parseInspectorResult('', { method: 'tools/call', stderr: o.authRequiredStderr })).toMatchObject({ ok: false, errorCode: 'inspector-auth-required' });
    expect(parseInspectorResult('garbage', { method: 'tools/call' })).toEqual({ parsed: false });
  });
});

describe('client launch: tokens never reach argv or disk', () => {
  const env = { PATH: process.env.PATH, HOME: '/nonexistent-home', SOME_OTHER_SECRET: 'leak-me' };

  it('Claude Code: strict MCP config with an environment reference, the token only in the child environment', async () => {
    const calls = [];
    const run = async (file, args, opts) => { calls.push({ file, args, opts }); return { code: 0, stdout: readFileSync(FIX('claude-code-read-write.jsonl'), 'utf8'), stderrBytes: 0 }; };
    const adapters = createAdapters({ issuer: 'https://127.0.0.1:4450', env, caFile: '/tmp/ca.pem', claudeAuth: 'auto', openaiModel: 'gpt-6-luna', run });
    const e = await adapters['claude-code']({ token: new Secret(SECRET), scenario: CLIENT_SCENARIOS['read-write'], label: 'abc123-cc-1' });
    const [{ args, opts }] = calls;
    expect(args.join(' ')).not.toContain(SECRET);
    expect(args).toEqual(expect.arrayContaining(['-p', '--strict-mcp-config', '--no-session-persistence', '--permission-prompts', 'none']));
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('12');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__cadence');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    expect(config.mcpServers.cadence).toEqual({ type: 'http', url: 'https://127.0.0.1:4450/mcp', headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } });
    expect(args).not.toContain('--bare');
    expect(opts.env[TOKEN_ENV]).toBe(SECRET);
    expect(opts.env.NODE_EXTRA_CA_CERTS).toBe('/tmp/ca.pem');
    expect(opts.env).not.toHaveProperty('SOME_OTHER_SECRET');
    expect(opts.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(opts.stdin).toContain(behaviorTitle('abc123-cc-1'));
    expect(e.auth).toBe('subscription');
    // With an agent key, Claude Code runs --bare on that key.
    const keyed = createAdapters({ issuer: 'https://127.0.0.1:4450', env: { ...env, ANTHROPIC_API_KEY: KEY }, claudeAuth: 'auto', openaiModel: 'x', run });
    await keyed['claude-code']({ token: new Secret(SECRET), scenario: CLIENT_SCENARIOS['read-only'], label: 'abc123-cc-2' });
    expect(calls[1].args).toContain('--bare');
    expect(calls[1].opts.env.ANTHROPIC_API_KEY).toBe(KEY);
  });

  it('claude.ai connector: no strict config, connector allowlisted, every other server denied, no key or token', async () => {
    const calls = [];
    const run = async (file, args, opts) => { calls.push({ args, opts }); return { code: 0, stdout: '', stderrBytes: 0 }; };
    const adapters = createAdapters({ issuer: 'https://app.cadence-me.com', env: { ...env, ANTHROPIC_API_KEY: KEY }, claudeAuth: 'auto', openaiModel: 'x', run,
      connectorServers: () => [CLAUDE_AI_CONNECTOR, 'claude.ai Gmail', 'pomerado'] });
    await adapters['claude-ai']({ scenario: CLIENT_SCENARIOS['read-write'], label: 'abc123-cai-1' });
    const [{ args, opts }] = calls;
    expect(args).not.toContain('--strict-mcp-config');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__claude_ai_Cadence_QA');
    const deny = args.slice(args.indexOf('--disallowedTools') + 1, args.indexOf('--permission-mode'));
    expect(deny).toEqual(['mcp__claude_ai_Gmail', 'mcp__pomerado']);
    expect(opts.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(opts.env).not.toHaveProperty(TOKEN_ENV);
  });

  it('Inspector: the token goes only through file descriptor 3, and the created Behavior id feeds the archive call', async () => {
    const o = json('inspector-outputs.json');
    const calls = [];
    const run = async (file, args, opts) => {
      calls.push({ args, opts });
      const tool = args[args.indexOf('--tool-name') + 1];
      return { code: 0, stdout: args.includes('tools/list') ? o.toolsList : tool === 'create_behavior' ? o.createOk : '{"result":{"content":[{"type":"text","text":"ok"}]}}', stderr: '', stderrBytes: 0 };
    };
    const adapters = createAdapters({ issuer: 'https://127.0.0.1:4450', env, claudeAuth: 'auto', openaiModel: 'x', run, inspectorCli: () => '/fake/inspector.js' });
    const e = await adapters.inspector({ token: new Secret(SECRET), scenario: CLIENT_SCENARIOS['read-write'], label: 'abc123-insp-1' });
    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain(SECRET);
      expect(JSON.parse(call.opts.fd3).mcpServers.cadence.headers.Authorization).toBe(`Bearer ${SECRET}`);
      expect(call.args).toEqual(expect.arrayContaining(['--config', '/dev/fd/3', '--stored-auth-only']));
      expect(call.opts.env).toMatchObject({ MCP_INSPECTOR_SECRET_STORE: 'memory', MCP_INSPECTOR_PERSIST_TOKENS: 'none' });
    }
    const archive = calls.at(-1).args;
    expect(JSON.parse(archive[archive.indexOf('--tool-args-json') + 1])).toEqual({ behavior_id: 'e3e71997-b9a6-4e0c-a6f2-d08a9afc562b' });
    expect(e.toolCount).toBe(16);
    expect(e.toolCalls.map((c) => c.tool)).toEqual(['get_account_context', 'get_timeline', 'create_behavior', 'archive_behavior']);
  });
});

describe('scenarios and checks', () => {
  it('every scenario names real registry tools and Review practice titles', () => {
    for (const s of Object.values(CLIENT_SCENARIOS)) {
      for (const step of s.inspector('abc123-x-1')) expect(OPERATION_ACCESS[step.tool]).toBeDefined();
      for (const tool of s.expect.writesOk) expect(OPERATION_ACCESS[tool]).toBe('write');
      expect(s.prompt('abc123-x-1')).toMatch(/Cadence/);
    }
    expect(behaviorTitle('abc123-cc-1')).toBe('Review practice abc123-cc-1');
    expect(() => behaviorTitle('Bad Label')).toThrow();
  });

  it('compareCalls and evaluate flag a write the server never saw', () => {
    const client = [{ tool: 'get_timeline', ok: true }, { tool: 'create_behavior', ok: true }];
    const server = [{ kind: 'tool.call', operation: 'get_timeline', outcome: 'success' }];
    const calls = compareCalls(client, server);
    expect(calls).toEqual({ clientCallCount: 2, serverCallCount: 1, unmatchedClientCount: 1, unmatchedServerCount: 0 });
    const verdict = evaluate({ expect: CLIENT_SCENARIOS['read-write'].expect, evidence: { toolCount: 16, toolCalls: client, foreignToolCallCount: 0 },
      watcher: { satisfied: true, steps: [] }, calls, behaviors: { count: 1, archivedCount: 0 } });
    expect(verdict.outcome).toBe('fail');
    expect(verdict.failedChecks).toEqual(['writesSucceeded', 'clientMatchesWatcher', 'behaviorsAsExpected']);
  });
});

// ---------------------------------------------------------------------------
// One client end to end with a fake harness
// ---------------------------------------------------------------------------

function fakeHarness({ adapter, activity = null, behaviorRows = null }) {
  const at = (s) => new Date(Date.now() + s * 1000).toISOString();
  const G = id(2);
  const revoked = [];
  const snapshot = {
    grants: [{ account: 'A', grantId: G, clientId: id(1), clientName: 'Cadence acceptance inspector', verifiedClient: null, scopes: ['cadence.read', 'cadence.behaviors.write', 'cadence.occurrences.write'],
      createdAt: at(1), lastUsedAt: null, updatedAt: null, revokedAt: null, revokedReason: null, registrationType: 'dcr' }],
    families: [{ account: 'A', familyId: id(3), grantId: G, createdAt: at(2), revokedAt: null, revokedReason: null, offlineAccess: true }],
    activity: (activity ?? ['get_account_context', 'get_timeline', 'create_behavior', 'archive_behavior']).map((operation, i) => ({
      account: 'A', activityId: String(i + 1), grantId: G, clientName: 'Cadence acceptance inspector', operation, outcome: 'success', errorCode: null, occurredAt: at(3 + i), targetCount: null })),
    clients: [], refreshes: [], complete: { revocations: true },
  };
  return {
    revoked,
    driver: {
      registerDynamic: async ({ name }) => ({ type: 'dcr', clientId: id(1), clientName: name }),
      authorize: async () => ({ accessToken: new Secret(SECRET), revoke: async () => { revoked.push('token'); } }),
      grantsFor: async () => [{ grantId: G, scopes: snapshot.grants[0].scopes }],
      revokeGrants: async () => { revoked.push('grant'); return 1; },
    },
    userIdOf: () => id(9),
    source: () => ({ name: 'db', kinds: KINDS, snapshot: async () => snapshot }),
    behaviors: async ({ title }) => behaviorRows ?? [{ id: id(7), archived: true, created_at: at(4), title }],
    connectorGrant: async () => G,
    adapters: { inspector: adapter },
    now: () => Date.now(),
    watchTimeoutMs: 50,
    connectorStatus: async () => 'needs-auth',
    close: async () => {},
  };
}

const passingInspector = async ({ token }) => {
  expect(token.reveal()).toBe(SECRET);
  return { toolCount: 16, foreignToolCallCount: 0, toolCalls: [
    { tool: 'get_account_context', ok: true, errorCode: null }, { tool: 'get_timeline', ok: true, errorCode: null },
    { tool: 'create_behavior', ok: true, errorCode: null, behaviorId: id(7) }, { tool: 'archive_behavior', ok: true, errorCode: null, behaviorId: id(7) }] };
};

describe('runOneClient', () => {
  it('passes, checkpoints the grant and Behavior, writes watcher events and revokes the grant; nothing secret on disk', async () => {
    const root = tmp();
    const run = createRun({ root, target: 'local', accounts: ['A'], scenarios: ['read-write'], steps: ['client:inspector'], gitSha: null, runId: 'r251' });
    const h = fakeHarness({ adapter: passingInspector });
    const result = await run.step('client:inspector', (ctx) => runOneClient('inspector', { h, run, runId: run.runId, slot: 'A', scenario: CLIENT_SCENARIOS['read-write'], ...ctx }));
    expect(result.outcome).toBe('pass');
    expect(result.watcher.steps.map((s) => s.status)).toEqual(['matched', 'matched', 'matched', 'matched']);
    expect(result.calls).toEqual({ clientCallCount: 4, serverCallCount: 4, unmatchedClientCount: 0, unmatchedServerCount: 0 });
    expect(h.revoked).toEqual(['token', 'grant']);
    const inputs = run.cleanupInputs();
    expect(inputs.grants.map((g) => g.grantId)).toEqual([id(2)]);
    expect(inputs.creations.map((c) => c.behaviorId)).toEqual([id(7)]);
    run.close();
    const dir = join(root, 'r251');
    const text = readTree(dir);
    expect(text).not.toContain(SECRET);
    expect(text).toMatch(/"type":"watcher.event"/);
    for (const f of readdirSync(dir)) expect(statSync(join(dir, f)).mode & 0o077).toBe(0);
  });

  it('fails when the server saw no write, and still revokes when the client crashes', async () => {
    const root = tmp();
    const run = createRun({ root, target: 'local', accounts: ['A'], scenarios: ['read-write'], steps: ['client:inspector'], gitSha: null, runId: 'r251b' });
    const h = fakeHarness({ adapter: passingInspector, activity: ['get_account_context', 'get_timeline'], behaviorRows: [] });
    const result = await run.step('client:inspector', (ctx) => runOneClient('inspector', { h, run, runId: run.runId, slot: 'A', scenario: CLIENT_SCENARIOS['read-write'], ...ctx }));
    expect(result.outcome).toBe('fail');
    expect(result.failedChecks).toEqual(expect.arrayContaining(['watcherSatisfied', 'clientMatchesWatcher', 'behaviorsAsExpected']));
    run.close();
    const run2 = createRun({ root, target: 'local', accounts: ['A'], scenarios: ['read-write'], steps: ['client:inspector'], gitSha: null, runId: 'r251b2' });
    const crash = fakeHarness({ adapter: async () => { throw new ClientStop('missing-inspector'); } });
    const crashed = await runOneClient('inspector', { h: crash, run: run2, runId: run2.runId, slot: 'A', scenario: CLIENT_SCENARIOS['read-write'], attempt: 1, interrupted: false, checkpoint: (k, d) => run2.recordCheckpoint(k, d) });
    expect(crashed).toMatchObject({ outcome: 'fail', failedChecks: ['client-run'], evidence: { error: 'missing-inspector' } });
    expect(crash.revoked).toEqual(['token', 'grant']);
    run2.close();
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe('CLI', () => {
  const localArgs = ['--target', 'local', '--issuer', 'https://127.0.0.1:4450', '--ca-file', '/tmp/ca.pem', '--db-url', 'postgresql://postgres:postgres@127.0.0.1:56532/postgres'];

  it('guards targets, issuers and production', () => {
    const reason = (argv) => { try { parseClientArgs(argv); return 'ok'; } catch (e) { return e.reason; } };
    expect(reason(['--target', 'production'])).toBe('production-requires-allow-production');
    expect(reason(['--target', 'production', '--allow-production', '--issuer', 'https://127.0.0.1:4450'])).toBe('production-fixed-issuer');
    expect(reason(['--target', 'local'])).toBe('local-needs-issuer-ca-file-db-url');
    expect(reason([...localArgs.slice(0, 2), '--issuer', 'https://127.0.0.1:4321', ...localArgs.slice(4)])).toBe('local-issuer-invalid');
    expect(reason([...localArgs, '--client', 'codex'])).toBe('client-unknown');
    expect(reason([...localArgs.slice(0, 6), '--db-url', 'postgresql://x@db.example.com:5432/postgres'])).toBe('db-url-not-loopback');
    expect(reason(localArgs)).toBe('ok');
    expect(() => localIssuer('http://127.0.0.1:4450')).toThrow();
  });

  it('readiness names what is missing, and API clients never target a local stack', () => {
    const env = { PATH: '/nonexistent' };
    expect(readiness('anthropic-api', { target: 'local', env })).toBe('missing ANTHROPIC_API_KEY (run through npm run agent:secret)');
    expect(readiness('anthropic-api', { target: 'local', env: { ...env, ANTHROPIC_API_KEY: KEY } })).toMatch(/^missing public issuer/);
    expect(readiness('anthropic-api', { target: 'production', env: { ...env, ANTHROPIC_API_KEY: KEY } })).toBeNull();
    expect(readiness('openai-api', { target: 'production', env })).toBe('missing OPENAI_API_KEY (run through npm run agent:secret)');
    expect(readiness('claude-ai', { target: 'local', env })).toMatch(/production only/);
    expect(readiness('claude-code', { target: 'local', env })).toBe('missing claude CLI on PATH');
    expect(readiness('inspector', { target: 'local', env: { CADENCE_INSPECTOR_CLI: '/nonexistent/index.js' } })).toMatch(/^missing MCP Inspector 2\.13\.0/);
  });

  it('a skipped client does not fail the others, and every outcome lands in the ledger', async () => {
    const root = tmp();
    const bin = tmp();
    writeFileSync(join(bin, 'claude'), '');
    chmodSync(join(bin, 'claude'), 0o700);
    const lines = [];
    let built = 0;
    const harnessFactory = async () => { built += 1; return { ...fakeHarness({ adapter: passingInspector }), adapters: { 'claude-code': passingInspector } }; };
    const code = await main([...localArgs, '--client', 'claude-code,anthropic-api,openai-api', '--run', 'r251c'], { env: { PATH: bin }, out: (l) => lines.push(JSON.parse(l)), harnessFactory, root });
    expect(code).toBe(0);
    expect(built).toBe(1);
    expect(lines.filter((l) => l.client).map((l) => [l.client, l.outcome])).toEqual([['claude-code', 'pass'], ['anthropic-api', 'skipped'], ['openai-api', 'skipped']]);
    expect(lines.find((l) => l.client === 'anthropic-api').reason).toBe('missing ANTHROPIC_API_KEY (run through npm run agent:secret)');
    expect(lines.at(-1)).toEqual({ step: 'summary', pass: 1, fail: 0, skipped: 2 });
    const checkpoints = readFileSync(join(root, 'r251c', 'checkpoints.jsonl'), 'utf8');
    expect(checkpoints).toContain('skipped');
    expect(checkpoints + lines.map((l) => JSON.stringify(l)).join('')).not.toContain(SECRET);
    // All skipped: no harness, exit 0.
    built = 0;
    const skipped = await main([...localArgs, '--client', 'anthropic-api', '--run', 'r251d'], { env: { PATH: '/nonexistent' }, out: () => {}, harnessFactory, root });
    expect(skipped).toBe(0);
    expect(built).toBe(0);
  });

  it('a failing client sets exit 1 without stopping the next client', async () => {
    const root = tmp();
    const lines = [];
    const harnessFactory = async () => ({ ...fakeHarness({ adapter: async () => { throw new ClientStop('missing-inspector'); } }) });
    const code = await main([...localArgs, '--client', 'inspector,anthropic-api', '--run', 'r251e'], {
      env: { PATH: '/nonexistent', CADENCE_INSPECTOR_CLI: RUNNER }, out: (l) => lines.push(JSON.parse(l)), harnessFactory, root });
    expect(code).toBe(1);
    expect(lines.filter((l) => l.client).map((l) => l.outcome)).toEqual(['fail', 'skipped']);
  });

  it('--check reports readiness without starting anything, and runs through a symlinked path', () => {
    const link = join(tmp(), 'runner.mjs');
    symlinkSync(RUNNER, link);
    const r = spawnSync(process.execPath, [link, '--check', '--target', 'local', '--client', 'anthropic-api,claude-ai'], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n').map((l) => JSON.parse(l))).toEqual([
      { client: 'anthropic-api', ready: false, skipped: 'missing ANTHROPIC_API_KEY (run through npm run agent:secret)' },
      { client: 'claude-ai', ready: false, skipped: 'missing public issuer: the claude.ai connector reaches production only' },
    ]);
  });

  it('toolOutcome keeps only codes and Behavior ids', () => {
    expect(toolOutcome({ isError: true, content: [{ type: 'text', text: `secret note ${SECRET}` }] })).toEqual({ ok: false, errorCode: 'unknown', behaviorId: null });
    expect(toolOutcome({ isError: false, structured: { behavior: { id: id(7).toUpperCase() } } })).toEqual({ ok: true, errorCode: null, behaviorId: id(7) });
  });
});
