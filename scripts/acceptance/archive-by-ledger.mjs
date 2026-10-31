// Archive-by-ledger cleanup. Replaces Ticket 256's and Ticket 259's one-off
// cleanup scripts:
//
//   npm run mcp:accept:archive -- --from <run-id>[,<run-id>...] --confirm-production [--run <id>] [--root <dir>]
//
// Reads the creation checkpoints of finished runs (read-only), then, for each
// test account that owns one of those Behaviors: registers one DCR client with
// Ticket 248's driver, grants read plus Behavior writes through the consent
// screen, archives each still-active Behavior with archive_behavior, reads it
// back as the account (RLS), and revokes the cleanup grant. Nothing is deleted.
// Only runner test Behaviors ("Review practice <label>", optionally "edited")
// are archived; anything else is refused. Running it again is safe: archived
// Behaviors are skipped. The cleanup grant is checkpointed in its own run folder.
// Output and the ledger hold IDs, outcomes and counts only, never tokens.
import { randomUUID } from 'node:crypto';
import { isCliEntry } from './cli-entry.mjs';
import { createRun, DEFAULT_ROOT, readRun } from './ledger.mjs';
import { launchChrome } from './consent-page.mjs';
import { createOAuthDriver } from './oauth-driver.mjs';
import { AcceptanceError, PRODUCTION, createKeychainSessionStore, createSessionManager } from './test-account-sessions.mjs';
import { createRest } from '../mcp-acceptance-cleanup.mjs';
import { qaPublishableKey } from './qa-config.mjs';

export const CLEANUP_CLIENT_NAME = 'Cadence acceptance cleanup';
export const CLEANUP_SCOPES = Object.freeze(['cadence.read', 'cadence.behaviors.write']);
const TEST_TITLE = /^Review practice [a-z0-9-]{1,40}( edited)?$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const codeOf = (error) => (error instanceof AcceptanceError ? error.code : error?.reason ?? 'unexpected');

/** Creation checkpoints from finished runs, first occurrence of each Behavior kept. */
export function collectCreations({ runIds, root = DEFAULT_ROOT }) {
  const seen = new Set();
  const out = [];
  for (const runId of runIds) {
    for (const c of readRun({ runId, root }).cleanupInputs().creations) {
      if (seen.has(c.behaviorId)) continue;
      seen.add(c.behaviorId);
      out.push({ slot: c.slot, behaviorId: c.behaviorId, fromRun: runId });
    }
  }
  return out;
}

async function readBehavior(rest, slot, behaviorId) {
  const r = await rest(slot, 'GET', `/rest/v1/behaviors?id=eq.${behaviorId}&select=id,title,archived_at`);
  if (r.status !== 200 || !Array.isArray(r.json)) throw new AcceptanceError('behavior-unreadable');
  return r.json[0] ?? null;
}

/**
 * Archive the Behaviors, one cleanup grant per account. Returns
 * { ok, results: [{ slot, behaviorId, outcome }], grants }. ok means every
 * Behavior is archived (now or before) and no cleanup grant is left.
 */
export async function archiveByLedger({ creations, driver, rest, listGrants, run, emit = () => {}, newKey = randomUUID }) {
  const results = [];
  const grants = [];
  let clean = true;
  for (const slot of ['A', 'B']) {
    const ids = [...new Set(creations.filter((c) => c.slot === slot).map((c) => c.behaviorId))];
    if (!ids.length) continue;
    const client = await driver.registerDynamic({ name: CLEANUP_CLIENT_NAME });
    try {
      const tokens = await driver.authorize({ slot, client, grant: 'behaviors', requestScopes: [...CLEANUP_SCOPES] });
      const [grant] = await driver.grantsFor(slot, client.clientId);
      if (grant) {
        const cp = { label: `archive-${slot.toLowerCase()}`, slot, grantId: grant.grantId, clientId: client.clientId, clientName: CLEANUP_CLIENT_NAME, scopes: grant.scopes };
        run.recordCheckpoint('grant', cp);
        grants.push(cp);
      }
      emit({ step: 'grant', slot, scopes: tokens.scopes, grantId: grant?.grantId ?? null });
      for (const behaviorId of ids) {
        const before = await readBehavior(rest, slot, behaviorId);
        let outcome;
        if (!before) outcome = 'missing';
        else if (!TEST_TITLE.test(before.title ?? '')) outcome = 'refused-title';
        else if (before.archived_at) outcome = 'already-archived';
        else {
          const call = await driver.probe(tokens, { name: 'archive_behavior', args: { behavior_id: behaviorId, idempotency_key: newKey() } });
          const after = await readBehavior(rest, slot, behaviorId);
          outcome = call.ok && after?.archived_at ? 'archived' : 'archive-failed';
        }
        results.push({ slot, behaviorId, outcome });
        emit({ step: 'archive', slot, behaviorId, outcome });
      }
    } finally {
      const revoked = await driver.revokeGrants(slot, client.clientId);
      const remaining = (await driver.grantsFor(slot, client.clientId)).length;
      const activeGrantCount = await listGrants(slot);
      if (remaining) clean = false;
      emit({ step: 'revoke', slot, revoked, remaining, activeGrantCount });
    }
  }
  const ok = clean && results.every((r) => r.outcome === 'archived' || r.outcome === 'already-archived');
  return { ok, results, grants };
}

export function parseArgs(argv) {
  const options = { from: null, runId: null, confirmProduction: false, root: DEFAULT_ROOT };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    const value = () => { const next = args.shift(); if (next === undefined || next.startsWith('--')) throw new AcceptanceError('argument-missing'); return next; };
    switch (flag) {
      case '--from': options.from = value().split(','); break;
      case '--run': options.runId = value(); break;
      case '--confirm-production': options.confirmProduction = true; break;
      case '--root': options.root = value(); break;
      default: throw new AcceptanceError('argument-unknown');
    }
  }
  if (!options.from) throw new AcceptanceError('from-required');
  if (!options.from.every((id) => RUN_ID.test(id)) || (options.runId !== null && !RUN_ID.test(options.runId))) throw new AcceptanceError('from-invalid');
  // Local test-login accounts do not outlive their run, so only production has accounts to clean.
  if (!options.confirmProduction) throw new AcceptanceError('production-requires-confirm-production');
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env, out = (line) => process.stdout.write(`${line}\n`)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { out(JSON.stringify({ result: 'usage', error: codeOf(error) })); return 2; }
  let creations;
  try { creations = collectCreations({ runIds: options.from, root: options.root }); } catch (error) { out(JSON.stringify({ result: 'stopped', error: codeOf(error) })); return 1; }
  if (!creations.every((c) => UUID.test(c.behaviorId))) { out(JSON.stringify({ result: 'stopped', error: 'creation-invalid' })); return 1; }
  const run = createRun({ target: 'production', accounts: [...new Set(creations.map((c) => c.slot))], scenarios: ['archive-by-ledger'], runId: options.runId ?? undefined, root: options.root });
  out(JSON.stringify({ result: 'run', runId: run.runId, from: options.from, behaviorCount: creations.length }));
  if (!creations.length) { run.close(); out(JSON.stringify({ result: 'pass', runId: run.runId, archived: 0 })); return 0; }
  const publishableKey = qaPublishableKey(env);
  const sessions = createSessionManager({ target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey, store: createKeychainSessionStore() });
  const browser = await launchChrome();
  try {
    const driver = createOAuthDriver({ target: 'production', issuer: PRODUCTION.issuer, sessions, browser, clientName: CLEANUP_CLIENT_NAME,
      onConsentView: (view) => run.appendEvent({ type: 'consent.view', ...view }) });
    const rest = createRest({ origin: PRODUCTION.supabaseUrl, publishableKey, tokenFor: async (slot) => (await sessions.current(slot)).accessToken });
    const listGrants = async (slot) => ((await sessions.userRpc(slot, 'oauth_list_grants')) ?? []).length;
    const result = await run.step('archive', async () => {
      const r = await archiveByLedger({ creations, driver, rest, listGrants, run, emit: (e) => out(JSON.stringify(e)) });
      return { ok: r.ok, results: r.results };
    });
    out(JSON.stringify({ result: result.ok ? 'pass' : 'fail', runId: run.runId, archived: result.results.filter((r) => r.outcome === 'archived').length }));
    return result.ok ? 0 : 1;
  } catch (error) {
    out(JSON.stringify({ result: 'stopped', runId: run.runId, error: codeOf(error) }));
    return 1;
  } finally {
    run.close();
    await browser.close().catch(() => {});
  }
}

if (isCliEntry(import.meta)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ result: 'stopped', error: codeOf(error) })}\n`);
    process.exitCode = 1;
  });
}
