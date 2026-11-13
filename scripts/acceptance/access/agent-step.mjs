#!/usr/bin/env node
// Placeholder renewal for agent steps that have no script yet (Ticket 293).
//
//   node scripts/acceptance/access/agent-step.mjs --step <id>
//
// The step belongs to an agent (docs/DECISIONS.md, 2026-11-06 and 2026-11-07), but no
// command performs it yet. It exits 1, so the preflight reports a check error, which
// the contract assigns to an agent, never an owner step. The detail names the step and
// where its manual procedure lives. Replace the manifest's renew line when a script exists.
import { USAGE, cliMain, finish, parseFlags } from './lib.mjs';

export const STEPS = Object.freeze({
  'gcal-connect-a': 'connect Google Calendar for A in Settings (docs/qa/travel-release.md)',
  'outlook-connect-a': 'connect Outlook for A in Settings with outlook-test-account-a (docs/DESKTOP_RELEASE.md, Connector check)',
  'test-mac-cadence-signin-a': 'sign Cadence for Mac on the test Mac in as A (docs/TEST_DEVICES.md)',
  'qa-chrome-notifications-a': 'allow notifications for app.cadence-me.com in QA Chrome and subscribe A (docs/qa/travel-release.md)',
  'qa-chrome-location-a': 'block location for app.cadence-me.com in QA Chrome (docs/qa/travel-release.md)',
  'travel-settings-a': "turn on A's Travel estimates, routing consent, Home and leave reminders (docs/qa/travel-release.md)",
  'local-stack-tools': 'install Docker, the Supabase CLI, psql and openssl (docs/qa/mcp-server.md)',
  'dev-signed-env': 'recreate dev-signed-env.sh (docs/DESKTOP_RELEASE.md, Local preparation)',
  'auth-email-provider': 'turn on the hosted Auth email provider (docs/qa/2026-11-13-ticket-332-hosted-auth-changes.md)',
  'auth-apple-provider': 'turn on the hosted Auth Apple provider (docs/qa/2026-11-13-ticket-333-apple-hosted-changes.md)',
  'auth-manual-linking': 'turn on hosted manual identity linking (docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md, step 4)',
  'auth-secure-email-change': 'turn on hosted secure email change (docs/qa/2026-11-13-ticket-334-hosted-auth-changes.md, step 3)',
});

export async function main(argv, { out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  let flags;
  try { flags = parseFlags(argv, { values: ['step'] }); } catch { flags = {}; }
  const text = STEPS[flags.step ?? ''];
  if (!text) return finish(out, USAGE, { detail: 'usage: --step <known id>' });
  return finish(out, 1, { detail: `agent step not scripted: ${text}` });
}

cliMain(import.meta, main);
