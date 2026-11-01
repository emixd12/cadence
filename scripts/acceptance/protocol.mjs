// Ticket 249: protocol acceptance suite. One command replaces the manual MCP
// Inspector and per-tool checks:
//
//   npm run mcp:accept:protocol -- --target local [--run <id>] [--issuer https://127.0.0.1:4440] [--ca-file <ca.pem>]
//   npm run mcp:accept:protocol -- --target production --confirm-production [--run <id>]   (Ticket 256 onward)
//   npm run mcp:accept:protocol -- --target <t> --run <id> --resume
//     (a local run resumes only if it recorded nothing; otherwise start a new run)
//
// Local needs an isolated stack and a Next dev server with CADENCE_MCP_ENABLED=true,
// CADENCE_ENABLE_TEST_LOGIN=1 and an HTTPS loopback issuer, plus
// CADENCE_LOCAL_SUPABASE_URL and CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY for that
// stack. Production reads its publishable key from qa-config.mjs and needs Ticket 248's
// kept Keychain sessions for accounts A and B.
//
// Tokens come from Ticket 248's driver (one DCR client per run, a fresh grant per
// scenario, so every activity row belongs to exactly one scenario). MCP calls go
// through the official SDK client; checks that must see an HTTP status (401, 403,
// 429) use one raw JSON-RPC request. Steps, grants and created Behaviors are
// recorded in Ticket 247's run ledger; cleanup archives the created Behaviors and
// revokes every checkpointed grant as its own account. The run writes report.md
// (pass/fail table) and evidence.json to the run folder and exits 1 on any
// failure. Nothing written or printed holds a token, code, cookie or note text.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { isCliEntry } from './cli-entry.mjs';
import { assertSafe, createRun, DEFAULT_ROOT, LedgerStop, resumeRun } from './ledger.mjs';
import { GRANTS, launchChrome, READ_SCOPE } from './consent-page.mjs';
import { createOAuthDriver, parseMcpBody } from './oauth-driver.mjs';
import { AcceptanceError, PRODUCTION, createKeychainSessionStore, createMemorySessionStore, createSessionManager } from './test-account-sessions.mjs';
import { createRest, revokeCaptured } from '../mcp-acceptance-cleanup.mjs';
import { qaPublishableKey } from './qa-config.mjs';

// Mirrors INTEGRATION_OPERATIONS in packages/core/src/integration/operations.ts
// (tools/list order); tests/acceptance-protocol.test.mjs keeps them equal.
export const REGISTRY_TOOLS = Object.freeze([
  'get_account_context', 'list_behaviors', 'get_behavior', 'list_categories', 'get_timeline', 'list_occurrences',
  'get_occurrence', 'get_adherence_summary', 'search', 'fetch',
  'set_occurrence_status', 'update_occurrence_note', 'create_behavior', 'update_behavior', 'archive_behavior', 'restore_behavior',
]);
export const WRITE_SCOPE = Object.freeze({
  set_occurrence_status: 'cadence.occurrences.write', update_occurrence_note: 'cadence.occurrences.write',
  create_behavior: 'cadence.behaviors.write', update_behavior: 'cadence.behaviors.write',
  archive_behavior: 'cadence.behaviors.write', restore_behavior: 'cadence.behaviors.write',
});
export const READ_TOOLS = Object.freeze(REGISTRY_TOOLS.filter((name) => !WRITE_SCOPE[name]));
export const SCENARIOS = Object.freeze(['preflight', 'behaviors-a', 'read-a', 'full-a', 'isolation-b', 'ratelimit-a', 'cleanup-a', 'cleanup-grants']);
export const LOCAL_ISSUER = 'https://127.0.0.1:4440';
export const LOCAL_CALLBACK_PORT = 4449;
export const READ_LIMIT = 120;
export const WRITE_LIMIT = 30;
// Ticket 232's cleanup recognizes these: titles that start with "Review practice" and this note.
export const SAMPLE_NOTE = 'Review sample note';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const isLoopbackOrigin = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.origin === value; } catch { return false; }
};
const codeOf = (error) => (error instanceof AcceptanceError || error instanceof LedgerStop ? (error.code ?? error.reason) : 'unexpected');
const safeDetail = (value) => (value === null || value === undefined ? null : String(value).replace(/[^A-Za-z0-9 ._:=/-]/g, '').slice(0, 80));

// ---- Live MCP and token-endpoint access ------------------------------------

/**
 * The live protocol surface. `connect` uses the official SDK client with an
 * auth provider that reads the token set's current access token on every
 * request, so a refresh is picked up without reconnecting. `raw` sends one
 * stateless JSON-RPC request and returns only statuses and error codes.
 */
export async function createLiveProtocol({ issuer, fetchImpl = fetch }) {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const endpoint = `${issuer}/mcp`;
  const http = (url, init = {}) => fetchImpl(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(20_000) }).catch(() => {
    throw new AcceptanceError('network-failed');
  });
  const connect = async (tokens) => {
    const client = new Client({ name: 'cadence-protocol-acceptance', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      authProvider: { token: async () => tokens.accessToken.reveal() }, fetch: fetchImpl,
    }));
    return {
      listTools: async () => (await client.listTools()).tools.map((tool) => tool.name),
      call: async (name, args = {}) => {
        try {
          const result = await client.callTool({ name, arguments: args });
          return { ok: result.isError !== true, structured: result.structuredContent ?? null, errorCode: result.structuredContent?.error?.code ?? null };
        } catch (error) {
          return { ok: false, structured: null, errorCode: typeof error?.code === 'string' || typeof error?.code === 'number' ? `sdk-${error.code}` : 'sdk-error' };
        }
      },
      close: () => client.close().catch(() => {}),
    };
  };
  const raw = async (authorization, name, args = {}) => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': MCP_PROTOCOL_VERSION };
    if (authorization) headers.Authorization = authorization;
    const response = await http(endpoint, {
      method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = parseMcpBody(await response.text(), response.headers.get('content-type') ?? '');
    const result = body?.result;
    return {
      status: response.status,
      isError: result?.isError === true || Boolean(body?.error),
      errorCode: result?.structuredContent?.error?.code ?? body?.error?.data?.error?.code ?? body?.error?.data?.code ?? null,
      wwwAuthenticate: response.headers.get('www-authenticate') ?? '',
      retryAfter: Number(response.headers.get('retry-after') ?? NaN),
      stepUpMeta: Array.isArray(result?._meta?.['mcp/www_authenticate']),
    };
  };
  const metadata = async () => {
    const resource = await http(`${issuer}/.well-known/oauth-protected-resource/mcp`);
    const server = await http(`${issuer}/.well-known/oauth-authorization-server`);
    return { resourceStatus: resource.status, resource: await resource.json().catch(() => null), serverStatus: server.status, server: await server.json().catch(() => null) };
  };
  const postToken = async (tokenEndpoint, params) => {
    const response = await http(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, error: typeof json.error === 'string' ? json.error : null };
  };
  return { endpoint, connect, raw, metadata, postToken };
}

// ---- Suite -----------------------------------------------------------------

/**
 * Runs every scenario inside `run.step()` so an interrupted run resumes from the
 * ledger. Returns `{ ok, checks }`; a scenario error becomes a failed check, and
 * cleanup runs whether or not earlier scenarios passed.
 */
export async function runProtocolSuite({
  run, target, issuer, driver, sessions, protocol, rest, runTag, grantHoldMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  emit = () => {},
}) {
  const all = [];
  const behaviorTitle = `Review practice ${runTag}`;
  const key = (suffix) => `p249-${runTag}-${suffix}`;
  const schedules = [{ recurrence: { frequency: 'daily', interval: 1 }, time_entries: [{ kind: 'exact', start_time: '09:00' }] }];
  const createInput = { title: behaviorTitle, schedules, reminders: { browser_enabled: false, email_enabled: false }, idempotency_key: key('create') };

  const scenario = async (name, fn, { retryFailed = false } = {}) => {
    let stoppedResult;
    let result;
    try {
      result = await run.step(name, async (context) => {
        const checks = [];
        const check = (id, ok, detail = null) => {
          const row = { scenario: name, check: id, ok: Boolean(ok) };
          const d = safeDetail(detail);
          if (d) row.detail = d;
          checks.push(row); emit(row);
          return Boolean(ok);
        };
        // A skipped check is neither a pass nor a failure; the report lists it as SKIPPED with its reason.
        const skip = (id, reason) => {
          const row = { scenario: name, check: id, ok: null, skipped: true, detail: safeDetail(reason) };
          checks.push(row); emit(row);
        };
        let data = {};
        try { data = (await fn({ check, skip, ...context })) ?? {}; } catch (error) { check('completed', false, codeOf(error)); }
        if (retryFailed && checks.some((c) => c.ok === false)) {
          stoppedResult = { ...data, checks };
          throw new AcceptanceError('grant-revocation-unconfirmed');
        }
        return { ...data, checks };
      });
    } catch (error) {
      if (!stoppedResult || codeOf(error) !== 'grant-revocation-unconfirmed') throw error;
      result = stoppedResult;
    }
    all.push(...(result.checks ?? []));
    return result;
  };

  const grantsRevoked = async (slot) => {
    const active = await driver.grantsFor(slot, client.clientId).catch(() => null);
    return Array.isArray(active) && active.length === 0;
  };

  /** A fresh grant for one scenario, checkpointed before use and revoked at the end. */
  const withGrant = async ({ check, attempt, checkpoint }, { label, slot, grant }, body) => {
    let tokens = null;
    let session = null;
    let capturedCount = 0;
    const capture = (active) => {
      const known = new Set(run.cleanupInputs().grants.map((g) => g.grantId));
      for (const g of active) {
        if (known.has(g.grantId)) continue;
        capturedCount += 1;
        checkpoint('grant', { label: `${label}-${attempt}${capturedCount > 1 ? `-g${capturedCount}` : ''}`, slot,
          grantId: g.grantId, clientId: client.clientId, clientName: client.clientName ?? null, scopes: g.scopes, createdAt: null });
        known.add(g.grantId);
      }
    };
    try {
      // Reconcile earlier attempts before consent, using the client persisted in preflight.
      await driver.revokeGrants(slot, client.clientId).catch(() => {});
      if (!(await grantsRevoked(slot))) throw new AcceptanceError('grant-revocation-unconfirmed');
      tokens = await driver.authorize({ slot, client, grant });
      const active = await driver.grantsFor(slot, client.clientId);
      capture(active);
      if (!check('grant-created', active.length === 1 && sameSet(active[0].scopes, GRANTS[grant]), `active=${active.length}`)) {
        throw new AcceptanceError('grant-not-created');
      }
      const grantId = active[0].grantId;
      session = await protocol.connect(tokens);
      const data = await body({ tokens, session, grantId });
      if (grantHoldMs > 0) await sleep(grantHoldMs);
      return { grantId, ...data };
    } finally {
      if (session) await session.close().catch((error) => check('session-closed', false, codeOf(error)));
      if (tokens) await tokens.revoke().catch(() => {});
      // Consent can create a grant even when token exchange or scope validation
      // throws. Retain any discoverable IDs before attempting their revocation.
      try { capture(await driver.grantsFor(slot, client.clientId)); } catch (error) { check('grant-captured', false, codeOf(error)); }
      await driver.revokeGrants(slot, client.clientId).catch(() => {});
      check('grant-revoked', await grantsRevoked(slot));
    }
  };
  /** One successful SDK call; returns the structured output or null. */
  const expectOk = async (session, check, name, args, id = name) => {
    const result = await session.call(name, args);
    check(id, result.ok && result.structured !== null, result.ok ? null : result.errorCode);
    return result.ok ? result.structured : null;
  };

  // preflight: discovery, an unauthenticated request, and one DCR client for the run.
  const pre = await scenario('preflight', async ({ check }) => {
    const meta = await protocol.metadata();
    check('protected-resource-metadata', meta.resourceStatus === 200 && meta.resource?.resource === `${issuer}/mcp`
      && Array.isArray(meta.resource?.authorization_servers) && meta.resource.authorization_servers.includes(issuer)
      && sameSet(meta.resource?.scopes_supported ?? [], GRANTS.full), `status=${meta.resourceStatus}`);
    const server = meta.server ?? {};
    check('authorization-server-metadata', meta.serverStatus === 200 && server.issuer === issuer
      && (server.code_challenge_methods_supported ?? []).includes('S256') && server.authorization_response_iss_parameter_supported === true
      && ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint'].every((k) => String(server[k] ?? '').startsWith(`${issuer}/`)),
    `status=${meta.serverStatus}`);
    const anonymous = await protocol.raw(null, 'get_account_context');
    check('unauthenticated-401', anonymous.status === 401 && /resource_metadata=/.test(anonymous.wwwAuthenticate), `status=${anonymous.status}`);
    const registered = await driver.registerDynamic({ name: 'Cadence protocol acceptance' });
    check('client-registered', Boolean(registered.clientId), registered.type);
    return { clientId: registered.clientId, clientName: registered.clientName ?? null, clientType: registered.type };
  });
  const client = { type: pre.clientType ?? 'dcr', clientId: pre.clientId ?? null, clientName: pre.clientName ?? null };
  const stop = (name) => scenario(name, ({ check }) => { check('prerequisite', false, 'earlier-scenario-failed'); });

  // behaviors-a: a Behaviors-only grant creates, retries, updates, archives and restores, but cannot touch Occurrences.
  const behaviors = client.clientId ? await scenario('behaviors-a', async (ctx) => withGrant(ctx, { label: 'behaviors-a', slot: 'A', grant: 'behaviors' }, async ({ session, tokens, grantId }) => {
    const { check } = ctx;
    const context = await expectOk(session, check, 'get_account_context', {});
    const today = context?.today_local_date ?? null;
    check('granted-scopes', sameSet(context?.granted_scopes ?? [], GRANTS.behaviors), (context?.granted_scopes ?? []).length);
    const prior = ctx.interrupted ? run.cleanupInputs().creations.find((c) => c.label === 'protocol-behavior') : null;
    const first = await session.call('create_behavior', createInput);
    const created = first.structured?.behavior ?? null;
    if (!check('create_behavior', first.ok && Boolean(created?.id), first.errorCode)) throw new AcceptanceError('create-failed');
    if (!prior) {
      ctx.checkpoint('creation', { label: 'protocol-behavior', slot: 'A', behaviorId: created.id, grantId, activityIds: [], behaviorCreatedAt: created.created_at ?? null });
    }
    const retry = await session.call('create_behavior', createInput);
    check('create-retry-idempotent', retry.ok && retry.structured?.behavior?.id === created.id && sha(JSON.stringify(retry.structured)) === sha(JSON.stringify(first.structured)));
    const listed = await expectOk(session, check, 'list_behaviors', { state: 'all' }, 'list-after-create');
    check('create-retry-single-behavior', (listed?.behaviors ?? []).filter((b) => b.title === behaviorTitle).length === 1);
    const updated = await expectOk(session, check, 'update_behavior', {
      behavior_id: created.id, expected_revision: created.revision, title: `${behaviorTitle} updated`, idempotency_key: key('update'),
    });
    check('update-applied', updated?.changed === true && updated?.behavior?.title === `${behaviorTitle} updated`);
    const archived = await expectOk(session, check, 'archive_behavior', { behavior_id: created.id, idempotency_key: key('archive-1') });
    check('archive-applied', archived?.behavior?.state === 'archived');
    const restored = await expectOk(session, check, 'restore_behavior', { behavior_id: created.id, idempotency_key: key('restore-1') });
    check('restore-applied', restored?.behavior?.state === 'active');
    const occurrences = today ? await expectOk(session, check, 'list_occurrences', { start_local_date: today, end_local_date: today, behavior_ids: [created.id] }) : null;
    const occurrenceId = occurrences?.occurrences?.[0]?.id ?? null;
    check('occurrence-scheduled', Boolean(occurrenceId));
    for (const [name, args] of [
      ['set_occurrence_status', { occurrence_id: occurrenceId, status: 'completed' }],
      ['update_occurrence_note', { occurrence_id: occurrenceId, note: SAMPLE_NOTE }],
    ]) {
      const response = await protocol.raw(tokens.authorization(), name, args);
      check(`${name}-denied`, response.status === 403 && response.errorCode === 'insufficient_scope', `status=${response.status}`);
    }
    return { behaviorId: created.id, occurrenceId, today, behaviorRevision: restored?.behavior?.revision ?? null };
  })) : await stop('behaviors-a');

  const behaviorId = behaviors.behaviorId ?? null;
  const occurrenceId = behaviors.occurrenceId ?? null;
  const today = behaviors.today ?? null;
  const ready = Boolean(client.clientId && behaviorId && occurrenceId && today);

  // read-a: a read-only grant sees the registry and every read tool; every write is a 403 with step-up metadata.
  const read = ready ? await scenario('read-a', async (ctx) => withGrant(ctx, { label: 'read-a', slot: 'A', grant: 'read' }, async ({ session, tokens }) => {
    const { check } = ctx;
    const names = await session.listTools();
    check('tools-list-equals-registry', JSON.stringify(names) === JSON.stringify(REGISTRY_TOOLS), `count=${names.length}`);
    const context = await expectOk(session, check, 'get_account_context', {});
    check('granted-scopes', sameSet(context?.granted_scopes ?? [], [READ_SCOPE]));
    const list = await expectOk(session, check, 'list_behaviors', {});
    check('list-has-behavior', (list?.behaviors ?? []).some((b) => b.id === behaviorId));
    await expectOk(session, check, 'get_behavior', { behavior_id: behaviorId });
    await expectOk(session, check, 'list_categories', {});
    const timeline = await expectOk(session, check, 'get_timeline', { start_local_date: today, days: 1 });
    check('timeline-has-occurrence', (timeline?.days ?? []).some((d) => (d.occurrences ?? []).some((o) => o.id === occurrenceId)));
    const occurrences = await expectOk(session, check, 'list_occurrences', { start_local_date: today, end_local_date: today });
    check('occurrences-have-occurrence', (occurrences?.occurrences ?? []).some((o) => o.id === occurrenceId));
    await expectOk(session, check, 'get_occurrence', { occurrence_id: occurrenceId });
    await expectOk(session, check, 'get_adherence_summary', { start_local_date: today, end_local_date: today });
    const found = await expectOk(session, check, 'search', { query: behaviorTitle });
    check('search-finds-behavior', (found?.results ?? []).some((r) => r.id === `behavior:${behaviorId}`));
    await expectOk(session, check, 'fetch', { id: `behavior:${behaviorId}` });
    const writes = {
      set_occurrence_status: { occurrence_id: occurrenceId, status: 'completed' },
      update_occurrence_note: { occurrence_id: occurrenceId, note: SAMPLE_NOTE },
      create_behavior: { title: `${behaviorTitle} denied`, schedules },
      update_behavior: { behavior_id: behaviorId, expected_revision: behaviors.behaviorRevision ?? 1, title: `${behaviorTitle} denied` },
      archive_behavior: { behavior_id: behaviorId },
      restore_behavior: { behavior_id: behaviorId },
    };
    for (const [name, args] of Object.entries(writes)) {
      const response = await protocol.raw(tokens.authorization(), name, args);
      check(`${name}-step-up`, response.status === 403 && response.errorCode === 'insufficient_scope' && response.stepUpMeta
        && /insufficient_scope/.test(response.wwwAuthenticate) && response.wwwAuthenticate.includes(WRITE_SCOPE[name]), `status=${response.status}`);
    }
    return { accountRefHash: context?.account_ref ? sha(context.account_ref) : null };
  })) : await stop('read-a');

  // full-a: Occurrence status and note writes, then the token lifecycle.
  const full = ready ? await scenario('full-a', async (ctx) => withGrant(ctx, { label: 'full-a', slot: 'A', grant: 'full' }, async ({ session, tokens }) => {
    const { check } = ctx;
    const before = await expectOk(session, check, 'get_occurrence', { occurrence_id: occurrenceId }, 'get_occurrence-before');
    const start = before?.occurrence?.status ?? 'unresolved';
    const completed = await expectOk(session, check, 'set_occurrence_status', { occurrence_id: occurrenceId, status: 'completed', expected_status: start, idempotency_key: key('completed') }, 'mark-completed');
    check('status-completed', completed?.occurrence?.status === 'completed');
    const notCompleted = await expectOk(session, check, 'set_occurrence_status', { occurrence_id: occurrenceId, status: 'not_completed', expected_status: 'completed', idempotency_key: key('not-completed') }, 'mark-not-completed');
    check('status-not-completed', notCompleted?.occurrence?.status === 'not_completed' && notCompleted?.previous_status === 'completed');
    const noted = await expectOk(session, check, 'update_occurrence_note', { occurrence_id: occurrenceId, note: SAMPLE_NOTE, idempotency_key: key('note') }, 'edit-note');
    check('note-saved', noted?.occurrence?.note === SAMPLE_NOTE);
    const after = await expectOk(session, check, 'get_occurrence', { occurrence_id: occurrenceId }, 'get_occurrence-after');
    check('history-recorded', (after?.occurrence?.status_history ?? []).filter((h) => ['completed', 'not_completed'].includes(h.status)).length >= 2);

    const { server, resource } = await driver.discover();
    const wrongResource = await protocol.postToken(server.token_endpoint, {
      grant_type: 'refresh_token', client_id: client.clientId, refresh_token: tokens.refreshToken.reveal(), resource: `${resource}-other`,
    });
    check('wrong-resource-token-refused', wrongResource.status === 400 && wrongResource.error === 'invalid_grant', `status=${wrongResource.status}`);
    const supabaseSession = await sessions.current('A');
    const foreign = await protocol.raw(`Bearer ${supabaseSession.accessToken}`, 'get_account_context');
    check('wrong-resource-token-401', foreign.status === 401 && /Bearer/.test(foreign.wwwAuthenticate), `status=${foreign.status}`);
    const { previous } = await tokens.refresh();
    check('refresh-rotates', sameSet(tokens.scopes, [...GRANTS.full, 'offline_access']));
    await expectOk(session, check, 'get_account_context', {}, 'refreshed-token-works');
    await tokens.revoke();
    const revoked = await protocol.raw(tokens.authorization(), 'get_account_context');
    check('revoked-token-401', revoked.status === 401, `status=${revoked.status}`);
    const reuse = await protocol.postToken(server.token_endpoint, {
      grant_type: 'refresh_token', client_id: client.clientId, refresh_token: previous.reveal(), resource,
    });
    check('rotated-refresh-rejected', reuse.status === 400 && reuse.error === 'invalid_grant', `status=${reuse.status}`);
    return { noteHash: sha(SAMPLE_NOTE), finalStatus: notCompleted?.occurrence?.status ?? null };
  })) : await stop('full-a');

  // isolation-b: account B cannot read or change A's records.
  if (ready) {
    await scenario('isolation-b', async (ctx) => withGrant(ctx, { label: 'isolation-b', slot: 'B', grant: 'full' }, async ({ session, tokens }) => {
      const { check } = ctx;
      const context = await expectOk(session, check, 'get_account_context', {});
      check('account-ref-differs', Boolean(read.accountRefHash) && Boolean(context?.account_ref) && sha(context.account_ref) !== read.accountRefHash);
      const list = await expectOk(session, check, 'list_behaviors', { state: 'all' });
      check('list-excludes-a', list !== null && !(list.behaviors ?? []).some((b) => b.id === behaviorId));
      const occurrences = await expectOk(session, check, 'list_occurrences', { start_local_date: today, end_local_date: today });
      check('occurrences-exclude-a', occurrences !== null && !(occurrences.occurrences ?? []).some((o) => o.id === occurrenceId));
      const timeline = await expectOk(session, check, 'get_timeline', { start_local_date: today, days: 1 });
      check('timeline-excludes-a', timeline !== null && !(timeline.days ?? []).some((d) => (d.occurrences ?? []).some((o) => o.id === occurrenceId)));
      const found = await expectOk(session, check, 'search', { query: behaviorTitle });
      check('search-excludes-a', found !== null && !(found.results ?? []).some((r) => [`behavior:${behaviorId}`, `occurrence:${occurrenceId}`].includes(r.id)));
      for (const [name, args] of [
        ['get_behavior', { behavior_id: behaviorId }], ['get_occurrence', { occurrence_id: occurrenceId }], ['fetch', { id: `behavior:${behaviorId}` }],
        ['set_occurrence_status', { occurrence_id: occurrenceId, status: 'completed' }], ['update_occurrence_note', { occurrence_id: occurrenceId, note: SAMPLE_NOTE }],
        ['update_behavior', { behavior_id: behaviorId, title: `${behaviorTitle} foreign`, expected_revision: behaviors.behaviorRevision ?? 1 }],
        ['archive_behavior', { behavior_id: behaviorId }], ['restore_behavior', { behavior_id: behaviorId }],
      ]) {
        const response = await protocol.raw(tokens.authorization(), name, args);
        check(`${name}-not-found`, response.isError && response.errorCode === 'not_found', `status=${response.status} code=${response.errorCode}`);
      }
      return {};
    }));
  } else await stop('isolation-b');

  // ratelimit-a: durable read and write limits, enforced independently. Local only.
  if (target === 'production') {
    await scenario('ratelimit-a', ({ skip }) => { skip('rate-limits', 'production-skips-rate-limit-exhaustion'); return { skipped: true }; });
  } else if (ready) {
    await scenario('ratelimit-a', async (ctx) => withGrant(ctx, { label: 'ratelimit-a', slot: 'A', grant: 'occurrences' }, async ({ tokens }) => {
      const { check } = ctx;
      const firstLimited = async (count, name, args) => {
        for (let i = 1; i <= count; i += 1) {
          const response = await protocol.raw(tokens.authorization(), name, args);
          if (response.status === 429) return { index: i, response };
          if (response.status !== 200) return { index: i, response, unexpected: true };
        }
        return { index: null, response: null };
      };
      const reads = await firstLimited(READ_LIMIT + 5, 'list_categories', {});
      check('read-limit', reads.index === READ_LIMIT + 1 && reads.response?.errorCode === 'rate_limited' && reads.response.retryAfter > 0,
        `first-429=${reads.index ?? 'none'}`);
      const write = await protocol.raw(tokens.authorization(), 'set_occurrence_status', { occurrence_id: occurrenceId, status: 'not_completed' });
      check('write-independent-of-read-limit', write.status === 200 && !write.isError, `status=${write.status}`);
      const writes = await firstLimited(WRITE_LIMIT + 5, 'set_occurrence_status', { occurrence_id: occurrenceId, status: 'not_completed' });
      check('write-limit', writes.index === WRITE_LIMIT && writes.response?.errorCode === 'rate_limited' && writes.response.retryAfter > 0,
        `first-429=${writes.index === null ? 'none' : writes.index + 1}`);
      return {};
    }));
  } else await stop('ratelimit-a');

  // cleanup-a: A's records are unchanged by B, then every created Behavior is archived.
  await scenario('cleanup-a', async (ctx) => {
    const creations = run.cleanupInputs().creations.filter((c) => c.slot === 'A');
    if (!creations.length || !client.clientId) { ctx.check('nothing-to-archive', true); return { archived: 0 }; }
    return withGrant(ctx, { label: 'cleanup-a', slot: 'A', grant: 'behaviors' }, async ({ session }) => {
      const { check } = ctx;
      if (occurrenceId && full.finalStatus) {
        const occurrence = await expectOk(session, check, 'get_occurrence', { occurrence_id: occurrenceId }, 'a-occurrence-readback');
        check('a-occurrence-unchanged-by-b', occurrence?.occurrence?.status === full.finalStatus && sha(occurrence?.occurrence?.note ?? '') === full.noteHash);
      }
      if (behaviorId) {
        const behavior = await expectOk(session, check, 'get_behavior', { behavior_id: behaviorId }, 'a-behavior-readback');
        check('a-behavior-unchanged-by-b', behavior?.behavior?.state === 'active' && behavior?.behavior?.title === `${behaviorTitle} updated`);
      }
      let archived = 0;
      for (const creation of creations) {
        const result = await session.call('archive_behavior', { behavior_id: creation.behaviorId, idempotency_key: key(`cleanup-${creation.label}`) });
        const ok = result.ok && result.structured?.behavior?.state === 'archived';
        if (ok) archived += 1;
        check(`archived-${creation.label}`, ok, result.errorCode);
      }
      return { archived };
    });
  });

  // cleanup-grants: reconcile the run's client even if an earlier grant lookup
  // failed, then verify captured IDs and both accounts. Failed cleanup stays
  // resumable without replaying any completed scenario that writes test data.
  await scenario('cleanup-grants', async ({ check }) => {
    if (client.clientId) {
      for (const slot of ['A', 'B']) await driver.revokeGrants(slot, client.clientId).catch(() => {});
    }
    const { grants } = run.cleanupInputs();
    let results = [];
    try { results = await revokeCaptured({ rest, captured: grants }); } catch (error) { check('captured-grants-revoked', false, codeOf(error)); }
    check('all-grants-revoked', results.length === grants.length && results.every((r) => ['revoked', 'already-revoked'].includes(r.outcome)), `grants=${grants.length}`);
    if (client.clientId) {
      for (const slot of ['A', 'B']) check(`client-${slot.toLowerCase()}-grants-revoked`, await grantsRevoked(slot));
    }
    return { revoked: results.filter((r) => r.outcome === 'revoked').length, alreadyRevoked: results.filter((r) => r.outcome === 'already-revoked').length };
  }, { retryFailed: true });

  return { ok: suitePassed(all), checks: all };
}

// ---- Report ----------------------------------------------------------------

/** Pass, fail and skip counts. Skipped rows count toward neither total nor passed. */
export function tally(checks) {
  const counted = checks.filter((c) => !c.skipped);
  return { total: counted.length, passed: counted.filter((c) => c.ok).length, skipped: checks.length - counted.length };
}
const suitePassed = (checks) => { const t = tally(checks); return t.total > 0 && t.passed === t.total; };

export function renderReport({ runId, target, checks }) {
  const { total, passed, skipped } = tally(checks);
  const lines = [
    `# Protocol acceptance ${runId}`, '',
    `Target: ${target} · ${passed}/${total} checks passed${skipped ? ` · ${skipped} skipped` : ''} · ${suitePassed(checks) ? 'PASS' : 'FAIL'}`, '',
    '| Scenario | Check | Result | Detail |', '|---|---|---|---|',
    ...checks.map((c) => `| ${c.scenario} | ${c.check} | ${c.skipped ? 'SKIPPED' : c.ok ? 'pass' : 'FAIL'} | ${c.detail ?? ''} |`),
  ];
  return `${lines.join('\n')}\n`;
}

export function writeReport(run, { target, checks, ok }) {
  const evidence = assertSafe({ runId: run.runId, target, ok, ...tally(checks), checks });
  writeFileSync(join(run.dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const report = renderReport({ runId: run.runId, target, checks });
  writeFileSync(join(run.dir, 'report.md'), report, { mode: 0o600 });
  return report;
}

// ---- CLI -------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { target: null, runId: null, resume: false, confirmProduction: false, issuer: null, caFile: null, callbackPort: LOCAL_CALLBACK_PORT, grantHoldMs: null, root: DEFAULT_ROOT };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    const value = () => { const next = args.shift(); if (next === undefined || next.startsWith('--')) throw new AcceptanceError('argument-missing'); return next; };
    switch (flag) {
      case '--target': options.target = value(); break;
      case '--run': options.runId = value(); break;
      case '--resume': options.resume = true; break;
      case '--confirm-production': options.confirmProduction = true; break;
      case '--issuer': options.issuer = value(); break;
      case '--ca-file': options.caFile = value(); break;
      case '--callback-port': options.callbackPort = Number(value()); break;
      case '--grant-hold-ms': options.grantHoldMs = Number(value()); break;
      case '--root': options.root = value(); break;
      default: throw new AcceptanceError('argument-unknown');
    }
  }
  if (!['local', 'production'].includes(options.target)) throw new AcceptanceError('target-required');
  if (options.target === 'production') {
    if (!options.confirmProduction) throw new AcceptanceError('production-requires-confirm-production');
    if (options.issuer || options.caFile) throw new AcceptanceError('production-issuer-fixed');
  } else {
    options.issuer ??= LOCAL_ISSUER;
    if (!isLoopbackOrigin(options.issuer)) throw new AcceptanceError('local-issuer-not-loopback');
  }
  if (options.resume && !options.runId) throw new AcceptanceError('resume-needs-run');
  if (!Number.isInteger(options.callbackPort) || options.callbackPort < 1024 || options.callbackPort > 65535) throw new AcceptanceError('callback-port-invalid');
  options.grantHoldMs ??= options.target === 'production' ? 8_000 : 0;
  if (!Number.isInteger(options.grantHoldMs) || options.grantHoldMs < 0 || options.grantHoldMs > 120_000) throw new AcceptanceError('grant-hold-invalid');
  return options;
}

function trustLocalCertificate(caFile) {
  let pem;
  try { pem = readFileSync(caFile, 'utf8'); } catch { throw new AcceptanceError('ca-file-unreadable'); }
  if (!/-----BEGIN CERTIFICATE-----/.test(pem)) throw new AcceptanceError('ca-file-invalid');
  setDefaultCACertificates([...getCACertificates('default'), pem]);
}

export async function main(argv = process.argv.slice(2), env = process.env, out = (line) => process.stdout.write(`${line}\n`)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { out(JSON.stringify({ result: 'usage', error: codeOf(error) })); return 2; }
  const local = options.target === 'local';
  const issuer = local ? options.issuer : PRODUCTION.issuer;
  const publishableKey = local ? env.CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY : qaPublishableKey(env);
  const supabaseUrl = local ? env.CADENCE_LOCAL_SUPABASE_URL : PRODUCTION.supabaseUrl;
  const sessions = createSessionManager({ target: options.target, supabaseUrl, publishableKey, store: local ? createMemorySessionStore() : createKeychainSessionStore() });
  const run = options.resume
    ? resumeRun({ runId: options.runId, root: options.root, expected: { target: options.target, accounts: ['A', 'B'], scenarios: ['protocol'] } })
    : createRun({ target: options.target, accounts: ['A', 'B'], scenarios: ['protocol'], steps: [...SCENARIOS, 'report'], runId: options.runId ?? undefined, root: options.root });
  out(JSON.stringify({ result: 'run', runId: run.runId, target: options.target }));
  if (local && options.resume && run.checkpoints.length) {
    // Local test-login creates a new Auth user per sign-in, so a resumed run cannot
    // sign the original A and B accounts back in. Recorded steps, grants and
    // Behaviors belong to those accounts; start a new run instead of mixing them.
    out(JSON.stringify({ result: 'stopped', runId: run.runId, error: 'local-resume-needs-new-run' }));
    run.close();
    return 1;
  }
  let browser;
  try {
    if (local && options.caFile) trustLocalCertificate(options.caFile);
    browser = await launchChrome();
    if (local) {
      // Local test-login sessions live in this process. Only a run with no recorded work gets here on --resume.
      for (const slot of ['A', 'B']) await sessions.enrollLocalTestLogin(slot, { browser, issuer, contextOptions: { ignoreHTTPSErrors: true } });
    }
    // User IDs only, so a watcher (npm run mcp:watch -- --user-a/--user-b) can follow this run.
    out(JSON.stringify({ result: 'accounts', userIdA: sessions.account('A')?.userId ?? null, userIdB: sessions.account('B')?.userId ?? null }));
    const driver = createOAuthDriver({ target: options.target, issuer, sessions, browser, callbackPort: options.callbackPort, ignoreLocalCertificate: local });
    const protocol = await createLiveProtocol({ issuer });
    const rest = createRest({ origin: supabaseUrl, publishableKey, tokenFor: async (slot) => (await sessions.current(slot)).accessToken });
    const runTag = sha(run.runId).slice(0, 8);
    const { ok, checks } = await runProtocolSuite({
      run, target: options.target, issuer, driver, sessions, protocol, rest, runTag, grantHoldMs: options.grantHoldMs,
      emit: (row) => out(JSON.stringify(row)),
    });
    await run.step('report', async () => tally(checks));
    out(writeReport(run, { target: options.target, checks, ok }).trimEnd());
    out(JSON.stringify({ result: ok ? 'pass' : 'fail', runId: run.runId, report: join(run.dir, 'report.md') }));
    return ok ? 0 : 1;
  } catch (error) {
    out(JSON.stringify({ result: 'stopped', runId: run.runId, error: codeOf(error) }));
    return 1;
  } finally {
    run.close();
    await browser?.close().catch(() => {});
  }
}

// Realpath-safe entry check (shared cli-entry.mjs): a symlinked path still runs main.
if (isCliEntry(import.meta)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ result: 'stopped', error: codeOf(error) })}\n`);
    process.exitCode = 1;
  });
}
