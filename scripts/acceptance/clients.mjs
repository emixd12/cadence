// Ticket 251: headless real-client adapters. Each adapter starts one real AI
// client against Cadence's MCP endpoint with a bearer token it holds only in
// memory, and turns the client's own output into token-free evidence: tool
// names, outcomes, Cadence error codes, counts and usage. Prompts, tool
// inputs, tool outputs and model text are parsed in memory and never kept.
//
// Clients:
// - claude-code: `claude -p` with --strict-mcp-config and an inline MCP config
//   whose Authorization header is `${CADENCE_ACCEPT_MCP_TOKEN}`, expanded by
//   Claude Code from the child's environment. Nothing is written to disk.
// - claude-ai: `claude -p` using the claude.ai-hosted "Cadence QA" connector.
//   claude.ai connectors load only without --strict-mcp-config (checked with
//   the stream-json init event, 2026-10-30), so this adapter instead removes
//   built-in tools, allowlists the connector's tools, denies every other MCP
//   server by name and answers no permission prompts.
// - anthropic-api: Messages API MCP connector (beta mcp-client-2026-09-15).
// - openai-api: Responses API `mcp` tool.
// - inspector: MCP Inspector CLI mode, one process per call, with its config
//   (including the Authorization header) passed on file descriptor 3 and an
//   in-memory secret store.
// The API clients reach the server from the provider's cloud, so they need a
// public HTTPS issuer; local stacks test them with recorded fixtures only.
//
// The Anthropic and OpenAI calls use fetch rather than an SDK: wave 2 may not
// add dependencies, and a raw request keeps full control of what is read back.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export const CLAUDE_MODEL = 'claude-opus-5-5';
export const OPENAI_MODEL = 'gpt-6-luna';
export const ANTHROPIC_MCP_BETA = 'mcp-client-2026-09-15';
export const ANTHROPIC_VERSION = '2026-10-21';
export const INSPECTOR_VERSION = '2.13.0';
export const CLAUDE_AI_CONNECTOR = 'claude.ai Cadence QA';
export const TOKEN_ENV = 'CADENCE_ACCEPT_MCP_TOKEN';
export const LIMITS = Object.freeze({ maxTurns: 12, maxTokens: 4096, maxBudgetUsd: 1, maxToolCalls: 12, timeoutMs: 240_000 });

export const ERROR_CODES = Object.freeze(['invalid_input', 'limit_exceeded', 'not_found', 'conflict', 'idempotency_key_reused', 'invalid_state',
  'authentication_required', 'insufficient_scope', 'rate_limited', 'service_unavailable', 'internal_error']);
const CODE_PATTERN = new RegExp(`\\b(${ERROR_CODES.join('|')})\\b`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export class ClientStop extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

// ---------------------------------------------------------------------------
// Shared parsing
// ---------------------------------------------------------------------------

const texts = (content) => {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && typeof b.text === 'string').map((b) => b.text);
};
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

/**
 * One tool result → { ok, errorCode, behaviorId }. `structured` is the MCP
 * structuredContent when the client exposes it. Text is scanned only for a
 * known Cadence error code; it is never returned.
 */
export function toolOutcome({ isError, structured = null, content = null }) {
  let errorCode = null;
  let behaviorId = null;
  const candidates = [structured, ...texts(content).map(parseJson)].filter((v) => v && typeof v === 'object');
  for (const value of candidates) {
    const code = value.error?.code ?? value.structuredContent?.error?.code;
    if (typeof code === 'string' && ERROR_CODES.includes(code)) errorCode ??= code;
    const id = value.behavior?.id ?? value.structuredContent?.behavior?.id;
    if (typeof id === 'string' && UUID.test(id)) behaviorId ??= id.toLowerCase();
  }
  const failed = Boolean(isError) || errorCode !== null;
  if (failed && errorCode === null) {
    // Clients often show an HTTP 403 step-up challenge as text ("Insufficient scope: …") instead of the tool error.
    for (const t of texts(content)) {
      const m = t.match(CODE_PATTERN);
      if (m) { errorCode = m[1]; break; }
      if (/insufficient[ _]scope/i.test(t)) { errorCode = 'insufficient_scope'; break; }
    }
  }
  return { ok: !failed, errorCode: failed ? errorCode ?? 'unknown' : null, behaviorId: failed ? null : behaviorId };
}

/** Classify the model's final line without keeping it. */
export const finalLine = (text) => {
  const first = String(text ?? '').trim().split('\n').at(-1)?.trim() ?? '';
  if (/^DONE\b/.test(first)) return 'done';
  if (/^FAILED\b/.test(first)) return 'failed';
  return first ? 'other' : 'none';
};

const cadenceTool = (name, prefix) => {
  if (typeof name !== 'string') return null;
  const bare = prefix ? (name.startsWith(prefix) ? name.slice(prefix.length) : null) : name;
  return bare && TOOL_NAME.test(bare) ? bare : null;
};

function callsFrom(uses, results) {
  const calls = [];
  for (const use of uses) {
    const result = results.get(use.id);
    const outcome = result ? toolOutcome(result) : { ok: false, errorCode: 'no-result', behaviorId: null };
    calls.push({ tool: use.tool, ok: outcome.ok, errorCode: outcome.errorCode, ...(outcome.behaviorId ? { behaviorId: outcome.behaviorId } : {}) });
  }
  return calls;
}

// ---------------------------------------------------------------------------
// Claude Code (and the claude.ai connector through Claude Code)
// ---------------------------------------------------------------------------

/** MCP server name → Claude Code's tool prefix (`claude.ai Cadence QA` → `mcp__claude_ai_Cadence_QA__`). */
export const claudeToolPrefix = (serverName) => `mcp__${serverName.replace(/[^A-Za-z0-9_-]/g, '_')}__`;

/** The inline --mcp-config. The header holds an environment reference, never the token. */
export const claudeCodeMcpConfig = (issuer) => JSON.stringify({
  mcpServers: { cadence: { type: 'http', url: `${issuer}/mcp`, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } } },
});

/**
 * `claude -p` arguments. The prompt goes on stdin. Variadic flags are always
 * followed by another flag so they cannot swallow a value.
 */
export function claudeCodeArgs({ mode, issuer = null, model = CLAUDE_MODEL, limits = LIMITS, apiKeyAuth = false, denyServers = [] }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--max-turns', String(limits.maxTurns),
    '--max-budget-usd', String(limits.maxBudgetUsd), '--no-session-persistence'];
  // claude.ai connectors come from the user's claude.ai sign-in; `--setting-sources
  // project` hid them on the first production run (Ticket 256), so only the
  // self-contained claude-code mode narrows setting sources.
  if (mode === 'claude-code') args.push('--setting-sources', 'project');
  if (mode === 'claude-code') {
    if (!issuer) throw new ClientStop('issuer-required');
    if (apiKeyAuth) args.push('--bare');
    args.push('--tools', '', '--strict-mcp-config', '--mcp-config', claudeCodeMcpConfig(issuer), '--allowedTools', 'mcp__cadence');
  } else if (mode === 'claude-ai') {
    const server = claudeToolPrefix(CLAUDE_AI_CONNECTOR).slice(0, -2);
    args.push('--tools', '', '--allowedTools', server);
    const deny = denyServers.filter((name) => name !== CLAUDE_AI_CONNECTOR).map((name) => claudeToolPrefix(name).slice(0, -2));
    if (deny.length) args.push('--disallowedTools', ...deny);
  } else throw new ClientStop('claude-mode-invalid');
  args.push('--permission-mode', 'default', '--permission-prompts', 'none');
  return args;
}

/** Parse Claude Code stream-json output into evidence. */
export function parseClaudeStream(stdout, { serverName = 'cadence' } = {}) {
  const prefix = claudeToolPrefix(serverName);
  const uses = [];
  const results = new Map();
  let init = null;
  let result = null;
  let foreign = 0;
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    const event = parseJson(line);
    if (!event) continue;
    if (event.type === 'system' && event.subtype === 'init') init = event;
    else if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block?.type !== 'tool_use') continue;
        const tool = cadenceTool(block.name, prefix);
        if (tool) uses.push({ id: block.id, tool }); else foreign += 1;
      }
    } else if (event.type === 'user') {
      for (const block of event.message?.content ?? []) {
        if (block?.type === 'tool_result') results.set(block.tool_use_id, { isError: block.is_error, content: block.content, structured: event.tool_use_result?.structuredContent ?? null });
      }
    } else if (event.type === 'result') result = event;
  }
  const server = init?.mcp_servers?.find((s) => s?.name === serverName) ?? null;
  return {
    mcpStatus: server?.status ?? (init ? 'absent' : 'no-init'),
    toolCount: Array.isArray(init?.tools) ? init.tools.filter((t) => typeof t === 'string' && t.startsWith(prefix)).length : null,
    model: typeof init?.model === 'string' ? init.model : null,
    authSource: typeof init?.apiKeySource === 'string' ? init.apiKeySource : null,
    toolCalls: callsFrom(uses, results),
    foreignToolCallCount: foreign,
    resultSubtype: typeof result?.subtype === 'string' ? result.subtype : 'none',
    turnCount: Number.isInteger(result?.num_turns) ? result.num_turns : null,
    costUsd: typeof result?.total_cost_usd === 'number' ? Math.round(result.total_cost_usd * 10000) / 10000 : null,
    inputTokenCount: result?.usage?.input_tokens ?? null,
    outputTokenCount: result?.usage?.output_tokens ?? null,
    permissionDenialCount: Array.isArray(result?.permission_denials) ? result.permission_denials.length : 0,
    finalLine: finalLine(result?.result),
  };
}

/** Read only the init event's MCP server list (the run is killed before any model call). */
export function parseClaudeInit(stdout) {
  for (const line of String(stdout).split('\n')) {
    const event = parseJson(line);
    if (event?.type === 'system' && event.subtype === 'init') {
      return (event.mcp_servers ?? []).filter((s) => typeof s?.name === 'string').map((s) => ({ name: s.name, status: s.status, source: s.source ?? null }));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Anthropic Messages API MCP connector
// ---------------------------------------------------------------------------

export function anthropicRequest({ issuer, token, prompt, model = CLAUDE_MODEL, limits = LIMITS, messages = null }) {
  return {
    model, max_tokens: limits.maxTokens,
    output_config: { effort: 'low' },
    messages: messages ?? [{ role: 'user', content: prompt }],
    mcp_servers: [{ type: 'url', url: `${issuer}/mcp`, name: 'cadence', authorization_token: token }],
    tools: [{ type: 'mcp_toolset', mcp_server_name: 'cadence' }],
  };
}

/** Parse one or more Messages API responses (pause_turn continuations) into evidence. */
export function parseAnthropicResponses(responses) {
  const uses = [];
  const results = new Map();
  let foreign = 0;
  let listed = null;
  let input = 0;
  let output = 0;
  for (const response of responses) {
    for (const block of response?.content ?? []) {
      if (block?.type === 'mcp_tool_listing' && block.mcp_server_name === 'cadence') listed = Array.isArray(block.tools) ? block.tools.length : listed;
      else if (block?.type === 'mcp_tool_use') {
        const tool = block.server_name === 'cadence' ? cadenceTool(block.name) : null;
        if (tool) uses.push({ id: block.id, tool }); else foreign += 1;
      } else if (block?.type === 'mcp_tool_result') results.set(block.tool_use_id, { isError: block.is_error, content: block.content });
    }
    input += Number(response?.usage?.input_tokens) || 0;
    output += Number(response?.usage?.output_tokens) || 0;
  }
  const last = responses.at(-1);
  const text = (last?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  return {
    toolCount: listed, toolCalls: callsFrom(uses, results), foreignToolCallCount: foreign,
    stopReason: typeof last?.stop_reason === 'string' ? last.stop_reason : 'none',
    refusalCategory: last?.stop_reason === 'refusal' && typeof last?.stop_details?.category === 'string' ? last.stop_details.category : null,
    turnCount: responses.length, inputTokenCount: input, outputTokenCount: output, model: typeof last?.model === 'string' ? last.model : null,
    finalLine: finalLine(text),
  };
}

const apiError = async (response) => {
  const body = await response.json().catch(() => null);
  const type = typeof body?.error?.type === 'string' && /^[a-z_]{1,40}$/.test(body.error.type) ? body.error.type : 'unknown';
  return new ClientStop(`api-${response.status}-${type}`.replace(/_/g, '-'));
};

export async function runAnthropicApi({ issuer, token, prompt, apiKey, fetchImpl = fetch, limits = LIMITS, model = CLAUDE_MODEL }) {
  const responses = [];
  let messages = [{ role: 'user', content: prompt }];
  for (let turn = 0; turn < limits.maxTurns; turn += 1) {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(limits.timeoutMs),
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': ANTHROPIC_MCP_BETA },
      body: JSON.stringify(anthropicRequest({ issuer, token: token.reveal(), prompt, model, limits, messages })),
    }).catch(() => { throw new ClientStop('api-network-failed'); });
    if (response.status !== 200) throw await apiError(response);
    const body = await response.json();
    responses.push(body);
    if (body.stop_reason !== 'pause_turn') break;
    // Send the assistant turn back unchanged (mcp_tool_listing blocks included) to resume it.
    messages = [...messages, { role: 'assistant', content: body.content }];
  }
  return parseAnthropicResponses(responses);
}

// ---------------------------------------------------------------------------
// OpenAI Responses API mcp tool
// ---------------------------------------------------------------------------

export function openaiRequest({ issuer, token, prompt, model = OPENAI_MODEL, limits = LIMITS }) {
  return {
    model, input: prompt, store: false,
    max_output_tokens: limits.maxTokens, max_tool_calls: limits.maxToolCalls,
    tools: [{ type: 'mcp', server_label: 'cadence', server_url: `${issuer}/mcp`, authorization: token, require_approval: 'never' }],
  };
}

export function parseOpenaiResponse(body) {
  const calls = [];
  let listed = null;
  let listError = false;
  let approvals = 0;
  let foreign = 0;
  for (const item of body?.output ?? []) {
    if (item?.type === 'mcp_list_tools' && item.server_label === 'cadence') { listed = Array.isArray(item.tools) ? item.tools.length : null; listError = Boolean(item.error); }
    else if (item?.type === 'mcp_approval_request') approvals += 1;
    else if (item?.type === 'mcp_call') {
      const tool = item.server_label === 'cadence' ? cadenceTool(item.name) : null;
      if (!tool) { foreign += 1; continue; }
      const outcome = toolOutcome({ isError: Boolean(item.error), content: [item.output, item.error].filter((v) => typeof v === 'string').map((text) => ({ text })) });
      calls.push({ tool, ok: outcome.ok, errorCode: outcome.errorCode, ...(outcome.behaviorId ? { behaviorId: outcome.behaviorId } : {}) });
    }
  }
  const text = (body?.output ?? []).filter((i) => i?.type === 'message').flatMap((i) => i.content ?? []).filter((c) => c?.type === 'output_text').map((c) => c.text).join('\n');
  return {
    toolCount: listed, toolListError: listError, toolCalls: calls, foreignToolCallCount: foreign, approvalRequestCount: approvals,
    status: typeof body?.status === 'string' ? body.status : 'none',
    incompleteReason: typeof body?.incomplete_details?.reason === 'string' ? body.incomplete_details.reason : null,
    turnCount: 1, inputTokenCount: body?.usage?.input_tokens ?? null, outputTokenCount: body?.usage?.output_tokens ?? null,
    model: typeof body?.model === 'string' ? body.model : null, finalLine: finalLine(text),
  };
}

export async function runOpenaiApi({ issuer, token, prompt, apiKey, fetchImpl = fetch, limits = LIMITS, model = OPENAI_MODEL }) {
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(limits.timeoutMs),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(openaiRequest({ issuer, token: token.reveal(), prompt, model, limits })),
  }).catch(() => { throw new ClientStop('api-network-failed'); });
  if (response.status !== 200) throw await apiError(response);
  return parseOpenaiResponse(await response.json());
}

// ---------------------------------------------------------------------------
// MCP Inspector CLI
// ---------------------------------------------------------------------------

/** Find the pinned Inspector in the npx cache, or CADENCE_INSPECTOR_CLI. */
export function findInspector({ env = process.env, cacheRoot = join(homedir(), '.npm', '_npx'), version = INSPECTOR_VERSION } = {}) {
  if (env.CADENCE_INSPECTOR_CLI) return existsSync(env.CADENCE_INSPECTOR_CLI) ? env.CADENCE_INSPECTOR_CLI : null;
  let dirs = [];
  try { dirs = readdirSync(cacheRoot); } catch { return null; }
  for (const dir of dirs.sort()) {
    const root = join(cacheRoot, dir, 'node_modules', '@modelcontextprotocol', 'inspector');
    try {
      if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version !== version) continue;
    } catch { continue; }
    const cli = join(root, 'clients', 'cli', 'build', 'index.js');
    if (existsSync(cli)) return cli;
  }
  return null;
}

/** The Inspector session config sent on fd 3. Built in memory only. */
export const inspectorConfig = (issuer, token) => JSON.stringify({
  mcpServers: { cadence: { type: 'streamable-http', url: `${issuer}/mcp`, headers: { Authorization: `Bearer ${token}` } } },
});

export function inspectorArgs({ method, tool = null, args = null }) {
  // --stored-auth-only: never start interactive OAuth; the bearer header is the only credential.
  const out = ['--config', '/dev/fd/3', '--server', 'cadence', '--method', method, '--format', 'json', '--quiet', '--stored-auth-only'];
  if (tool) out.push('--tool-name', tool, '--tool-args-json', JSON.stringify(args ?? {}));
  return out;
}

/**
 * Inspector --format json prints the result object on stdout; with --quiet a
 * failure is one `{ error: { code, message } }` envelope on stderr. Only the
 * error code is kept.
 */
export function parseInspectorResult(stdout, { method, stderr = '' }) {
  const raw = parseJson(String(stdout).trim());
  // 2.13.0 wraps the payload as { result } (or { error }).
  const body = raw && typeof raw === 'object' && raw.result && typeof raw.result === 'object' ? raw.result : raw;
  const envelopeError = (error) => {
    const status = Number(error?.status) || null;
    const message = typeof error?.message === 'string' ? error.message : '';
    const own = typeof error?.code === 'string' && /^[a-z0-9_-]{1,40}$/.test(error.code) ? `inspector-${error.code}`.replace(/_/g, '-') : 'transport-error';
    // The SDK client reports a 403 step-up challenge as "Insufficient scope: required …" with no status.
    const code = message.match(CODE_PATTERN)?.[1] ?? (status === 403 || /^insufficient scope\b/i.test(message) ? 'insufficient_scope'
      : status === 401 ? 'authentication_required' : own);
    return { parsed: true, ok: false, errorCode: code, behaviorId: null };
  };
  if (!body || typeof body !== 'object') {
    const envelope = parseJson(String(stderr).trim().split('\n').at(-1) ?? '');
    return envelope?.error && typeof envelope.error === 'object' ? envelopeError(envelope.error) : { parsed: false };
  }
  if (method === 'tools/list') return { parsed: true, toolCount: Array.isArray(body.tools) ? body.tools.length : null, error: Boolean(body.error) };
  if (body.error && !body.content && !body.structuredContent) return envelopeError(body.error);
  const outcome = toolOutcome({ isError: body.isError, structured: body.structuredContent ?? null, content: body.content });
  return { parsed: true, ...outcome };
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

/** Minimal child environment: no inherited keys or tokens unless passed in `extra`. */
export function childEnv(base, extra = {}) {
  const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'SHELL'];
  const env = Object.fromEntries(keep.filter((k) => typeof base[k] === 'string').map((k) => [k, base[k]]));
  return { ...env, DISABLE_AUTOUPDATER: '1', ...extra };
}

/** Find an executable on PATH without running a shell. */
export function which(name, env = process.env) {
  const { PATH: searchPath = '' } = env;
  for (const dir of String(searchPath).split(delimiter)) {
    const candidate = join(dir, name);
    if (dir && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Spawn and collect stdout in memory. stderr is counted, not kept. Output is
 * never echoed. `fd3` writes a string to an extra pipe and closes it.
 */
export function runProcess(file, args, { env, cwd, stdin = null, fd3 = null, timeoutMs = LIMITS.timeoutMs, maxBytes = 8 * 1024 * 1024, stopWhen = null, keepStderr = false }) {
  return new Promise((resolve) => {
    const stdio = ['pipe', 'pipe', 'pipe', ...(fd3 === null ? [] : ['pipe'])];
    let child;
    try { child = spawn(file, args, { env, cwd, stdio }); } catch { resolve({ code: null, signal: null, stdout: '', stderr: '', stderrBytes: 0, spawnFailed: true }); return; }
    let stdout = '';
    let stderrBytes = 0;
    let stderr = '';
    let killed = null;
    const kill = (why) => { if (!killed) { killed = why; child.kill('SIGKILL'); } };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > maxBytes) kill('output-too-large');
      else if (stopWhen?.(stdout)) kill('stopped');
    });
    // stderr is kept (in memory only) when the caller parses an error envelope from it.
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; if (keepStderr && stderr.length < 64 * 1024) stderr += chunk; });
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
    if (fd3 !== null) { child.stdio[3].on('error', () => {}); child.stdio[3].end(fd3); }
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderrBytes, killed, ...(keepStderr ? { stderr } : {}) }); });
  });
}
