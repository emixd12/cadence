// Archive-by-ledger cleanup, for test Behaviors a finished run left active (web
// and guided runs do not archive what they create):
//
//   npm run mcp:accept:archive -- --from <run-id>[,<run-id>...] --confirm-production [--run <id> [--resume]] [--root <dir>]
//
// Reads the creation checkpoints of finished production runs (read-only). For each
// test account with a Behavior still active: saves a DCR registration to this
// command's own ledger before consent, grants read plus Behavior writes through the
// consent screen, archives each Behavior with archive_behavior, reads it back as the
// account (RLS), and revokes the cleanup grant. Nothing is deleted. Only runner test
// Behaviors ("Review practice <label>", optionally "edited") are archived.
//
// Recovery follows the protocol and client runners: revocation counts only when a
// readback shows no grant. If it cannot be confirmed the command stops, and
// `--run <id> --resume` reconciles the saved registrations before registering
// another client. Archived Behaviors are skipped, so a re-run is safe. Output and the
// ledger hold IDs, outcomes and counts only, never tokens.
import { randomUUID } from 'node:crypto';
import { isCliEntry } from './cli-entry.mjs';
import { assertRunContext, createRun, DEFAULT_ROOT, LedgerStop, readRun, resumeRun } from './ledger.mjs';
import { launchChrome } from './consent-page.mjs';
import { createOAuthDriver } from './oauth-driver.mjs';
import { AcceptanceError, PRODUCTION, createKeychainSessionStore, createSessionManager } from './test-account-sessions.mjs';
import { createRest } from '../mcp-acceptance-cleanup.mjs';
import { qaPublishableKey } from './qa-config.mjs';

export const CLEANUP_CLIENT_NAME = 'Cadence acceptance cleanup';
const SCENARIO = 'archive-by-ledger';
export const CLEANUP_SCOPES = Object.freeze(['cadence.read', 'cadence.behaviors.write']);
const TEST_TITLE = /^Review practice [a-z0-9-]{1,40}( edited)?$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const codeOf = (error) => (error instanceof AcceptanceError ? error.code : error instanceof LedgerStop ? error.reason : 'unexpected');

/** Creation checkpoints from finished production runs, first occurrence of each Behavior kept. */
export function collectCreations({ runIds, root = DEFAULT_ROOT }) {
  const seen = new Set();
  const out = [];
  for (const runId of runIds) {
    const source = readRun({ runId, root });
    // Local test-login accounts do not outlive their run.
    assertRunContext(source.meta, { target: 'production' });
    for (const c of source.cleanupInputs().creations) {
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

/** A failed revoke request can still have succeeded; only the readback confirms cleanup. */
async function confirmRevoked(driver, slot, clientId) {
  const revoked = await driver.revokeGrants(slot, clientId).catch(() => 0);
  const active = await driver.grantsFor(slot, clientId).catch(() => null);
  if (!Array.isArray(active) || active.length !== 0) throw new AcceptanceError('grant-revocation-unconfirmed');
  return revoked;
}

const skipOutcome = (row) => {
  if (!row) return 'missing';
  if (!TEST_TITLE.test(row.title ?? '')) return 'refused-title';
  return row.archived_at ? 'already-archived' : null;
};

/**
 * Archive the Behaviors, one cleanup grant per account. Returns
 * { ok, results: [{ slot, behaviorId, outcome }], grants }; ok means every Behavior
 * is archived, now or before. Unconfirmed revocation throws and stops the next
 * account, so a resumed run must reconcile it first.
 */
export async function archiveByLedger({ creations, driver, rest, listGrants, run, emit = () => {}, newKey = randomUUID }) {
  const results = [];
  const grants = [];
  const finish = (slot, behaviorId, outcome) => {
    results.push({ slot, behaviorId, outcome });
    run.appendEvent({ type: 'archive.result', slot, behaviorId, outcome });
    emit({ step: 'archive', slot, behaviorId, outcome });
  };
  for (const slot of ['A', 'B']) {
    const stepPrefix = `registration:${slot.toLowerCase()}-`;
    const prior = run.checkpoints.filter((r) => r.kind === 'step' && r.state === 'done' && r.name.startsWith(stepPrefix)).map((r) => r.result);
    // Consent may have created a grant before an earlier attempt stopped.
    for (const previous of prior) await confirmRevoked(driver, slot, previous.clientId);
    const pending = [];
    for (const behaviorId of [...new Set(creations.filter((c) => c.slot === slot).map((c) => c.behaviorId))]) {
      const outcome = skipOutcome(await readBehavior(rest, slot, behaviorId));
      if (outcome) finish(slot, behaviorId, outcome); else pending.push(behaviorId);
    }
    // No consent or registration (rate limited) when nothing needs archiving.
    if (!pending.length) continue;
    const attempt = prior.length + 1;
    const client = await run.step(`${stepPrefix}${attempt}`, async () => {
      const registered = await driver.registerDynamic({ name: CLEANUP_CLIENT_NAME });
      return { type: registered.type, clientId: registered.clientId, clientName: registered.clientName ?? CLEANUP_CLIENT_NAME, slot };
    });
    let captured = 0;
    const capture = (active) => {
      const known = new Set(run.cleanupInputs().grants.map((g) => g.grantId));
      for (const g of active) {
        if (known.has(g.grantId)) continue;
        captured += 1;
        const cp = { label: `archive-${slot.toLowerCase()}-${attempt}${captured > 1 ? `-g${captured}` : ''}`, slot, grantId: g.grantId,
          clientId: client.clientId, clientName: CLEANUP_CLIENT_NAME, scopes: g.scopes };
        run.recordCheckpoint('grant', cp);
        grants.push(cp);
      }
    };
    let tokens = null;
    try {
      tokens = await driver.authorize({ slot, client, grant: 'behaviors', requestScopes: [...CLEANUP_SCOPES] });
      capture(await driver.grantsFor(slot, client.clientId));
      emit({ step: 'grant', slot, scopes: tokens.scopes });
      for (const behaviorId of pending) {
        const call = await driver.probe(tokens, { name: 'archive_behavior', args: { behavior_id: behaviorId, idempotency_key: newKey() } });
        const after = await readBehavior(rest, slot, behaviorId);
        finish(slot, behaviorId, call.ok && after?.archived_at ? 'archived' : 'archive-failed');
      }
    } finally {
      if (tokens?.revoke) await tokens.revoke().catch(() => {});
      // Consent can create a grant even when the token exchange throws: keep its ID first.
      try { capture(await driver.grantsFor(slot, client.clientId)); } catch { /* confirmRevoked reports it */ }
      const revoked = await confirmRevoked(driver, slot, client.clientId);
      emit({ step: 'revoke', slot, revoked, remaining: 0, activeGrantCount: await listGrants(slot) });
    }
  }
  return { ok: results.every((r) => r.outcome === 'archived' || r.outcome === 'already-archived'), results, grants };
}

export function parseArgs(argv) {
  const options = { from: null, runId: null, resume: false, confirmProduction: false, root: DEFAULT_ROOT };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    const value = () => { const next = args.shift(); if (next === undefined || next.startsWith('--')) throw new AcceptanceError('argument-missing'); return next; };
    switch (flag) {
      case '--from': options.from = value().split(','); break;
      case '--run': options.runId = value(); break;
      case '--resume': options.resume = true; break;
      case '--confirm-production': options.confirmProduction = true; break;
      case '--root': options.root = value(); break;
      default: throw new AcceptanceError('argument-unknown');
    }
  }
  if (!options.from) throw new AcceptanceError('from-required');
  if (options.resume && !options.runId) throw new AcceptanceError('resume-needs-run');
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
  let run;
  try {
    run = options.resume
      ? resumeRun({ runId: options.runId, root: options.root, expected: { target: 'production', scenarios: [SCENARIO] } })
      : createRun({ target: 'production', accounts: ['A', 'B'], scenarios: [SCENARIO], runId: options.runId ?? undefined, root: options.root });
  } catch (error) { out(JSON.stringify({ result: 'stopped', error: codeOf(error) })); return 1; }
  out(JSON.stringify({ result: 'run', runId: run.runId, from: options.from, behaviorCount: creations.length }));
  if (!creations.length && !options.resume) { run.close(); out(JSON.stringify({ result: 'pass', runId: run.runId, archived: 0 })); return 0; }
  let browser;
  try {
    const publishableKey = qaPublishableKey(env);
    const sessions = createSessionManager({ target: 'production', supabaseUrl: PRODUCTION.supabaseUrl, publishableKey, store: createKeychainSessionStore() });
    browser = await launchChrome();
    const driver = createOAuthDriver({ target: 'production', issuer: PRODUCTION.issuer, sessions, browser, clientName: CLEANUP_CLIENT_NAME,
      onConsentView: (view) => run.appendEvent({ type: 'consent.view', ...view }) });
    const rest = createRest({ origin: PRODUCTION.supabaseUrl, publishableKey, tokenFor: async (slot) => (await sessions.current(slot)).accessToken });
    const listGrants = async (slot) => {
      const rows = await sessions.userRpc(slot, 'oauth_list_grants');
      return Array.isArray(rows) ? rows.length : null;
    };
    const result = await archiveByLedger({ creations, driver, rest, listGrants, run, emit: (e) => out(JSON.stringify(e)) });
    out(JSON.stringify({ result: result.ok ? 'pass' : 'fail', runId: run.runId, archived: result.results.filter((r) => r.outcome === 'archived').length }));
    return result.ok ? 0 : 1;
  } catch (error) {
    out(JSON.stringify({ result: 'stopped', runId: run.runId, error: codeOf(error) }));
    return 1;
  } finally {
    run.close();
    await browser?.close().catch(() => {});
  }
}

if (isCliEntry(import.meta)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ result: 'stopped', error: codeOf(error) })}\n`);
    process.exitCode = 1;
  });
}
