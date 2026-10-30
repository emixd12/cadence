---
name: mcp-acceptance
description: Automated acceptance of Cadence's MCP server and AI clients (Claude Code, the claude.ai connector, Anthropic and OpenAI API connectors, MCP Inspector, ChatGPT web, Claude web). Use when running, resuming or finishing MCP or connector acceptance, a Ticket 256-style client retest, a local MCP rehearsal, or when checking a client against Cadence's own server records.
---

# Cadence MCP acceptance

Agents run every tier and check each client step against Cadence's own records
(the watcher). Emi signs in, creates keys and vaults, approves owner secrets and
makes release decisions. Nothing else goes to her.

## Read first

1. `AGENTS.md`, "Installed and live acceptance".
2. `STATUS.md`, top section, and `docs/TICKETS.md`, Tickets 247–256.
3. `docs/qa/mcp-server.md`, "Automated acceptance", and `docs/qa/agent-secrets.md`.
4. The run folder's `STATE.md` if you are resuming (see "Resume").

Use Node 24 for everything: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.
Work in your own git worktree, never in Ticket 232's checkout
(`/Users/emi/intent/workspaces/mcp-create/cadence`) or `cadence-claudeweb-fix`.

## Hard rules

- **Production:** no call to app.cadence-me.com, hosted Supabase, Vercel or GitHub
  settings unless your task authorizes a production run. The first production run
  (Ticket 256) needs Emi's go-ahead; later runs need none. Never run production while
  Ticket 232's cleanup runs (deadline 2026-11-04T02:17Z), and never read, change or
  revoke its captured records (grants 5d764426, 9919ddc7, d3b99bcc, 59e3ae31;
  occurrence 471a3766; Behavior d7b30845). Ports 4321–4330 and the session broker's
  socket belong to live runs.
- **Secrets:** never print, log or write tokens, codes, cookies, refresh tokens, API
  keys or note text. Use secrets only through `npm run agent:secret`. Never use a
  service-role key outside the local stack. Never put a secret into a prompt.
- **Accounts:** only test accounts A (`cadence.testing.is@gmail.com`) and B
  (`brittlebeliefs@gmail.com`). Stop if anything points at another account.
- **Local data:** never start, reset or stop `habit-tracking-app` (Emi's local
  stack, ports 553xx). Use the helper below with your own `cadence-accept-<x>` name.
- **Merges:** nothing from this work merges to main without the coordinator; a main
  merge rebuilds both Vercel projects and needs a Trust refresh.

## Agent autonomy (spec, "Automated MCP client acceptance")

You may, without asking:
- sign in as test accounts A and B from kept sessions, and click Allow or Deny on
  Cadence's consent screen for them;
- read agent-scoped keys (the "Cadence Agents" vault through `agent:secret`);
- run Tier 0, 1 and 2 clients against production test accounts (after the first
  run's go-ahead);
- create, change, archive and restore test data in accounts A and B, and revoke
  your own grants.

Stop and ask Emi (these stay hers):
- a Google, ChatGPT or Claude sign-in when a kept session ends;
- creating vaults, service accounts or API keys;
- the production signing key (owner vault, Touch ID);
- turning MCP on or off;
- deploys and merges to main;
- anything touching a non-test account.

Also stop with a named reason, without asking, when: a preflight finds a Ticket 232
grant active; a page shows a login wall or bot check; a watcher step is not seen
before its timeout; an account check fails; or a command exits 2 (usage or setup).

## Asking Emi

- Run the testing agent as a **top-level agent**:
  `ws.agent.create(name, message, { topLevel: true })`. Delegated agents cannot call
  `ws.app.question.ask`; if you are delegated, send one numbered list to your
  coordinator to relay instead.
- One numbered list per batch, each item a single action (sign in, create a key,
  approve). Say what you will do yourself after she finishes.
- Never ask her to report outputs, paste JSON, take screenshots, check a page for
  you or remember settings. You read the result from the watcher, the ledger or the
  tool itself.

Emi's whole part, in the normal path:
1. Sign-ins: Google for accounts A and B (`mcp:oauth -- enroll`), ChatGPT and Claude
   in the Cadence QA Chrome profile (`mcp:accept:web -- open`), and authorizing the
   claude.ai "Cadence QA" connector once.
2. Keys, vaults and service accounts: `docs/qa/agent-secrets.md` steps 1–5.
3. Owner-secret approvals: Touch ID for the "Cadence" vault and the signing key.
4. Release decisions: the first production run's go-ahead, MCP on or off, deploys
   and merges.

The guided fallback is the only exception, and only after a browser run stopped
with a named reason.

## Accounts, sessions and secrets

| What | Where | Check (reads no value) |
|---|---|---|
| A and B Supabase sessions (production) | Keychain service `cadence-qa-oauth-session`, accounts `production:A`, `production:B` | `npm run mcp:oauth -- status --target production --allow-production` |
| 1Password service-account token | Keychain service `cadence-agent-1password`, account `service-account-token` | see below |
| Anthropic key | 1Password "Cadence Agents" item `anthropic-api-key`, field `credential` | see below |
| OpenAI key | 1Password "Cadence Agents" item `openai-api-key`, field `credential` | see below |
| QA publishable key (public) | env `CADENCE_QA_SUPABASE_PUBLISHABLE_KEY` | runners stop with `publishable-key-required` (or `qa-publishable-key-missing`) |
| ChatGPT and Claude sign-ins | Chrome profile `~/Library/Application Support/Cadence QA Chrome` | `npm run mcp:accept:web -- status` |

Verify the 1Password setup:

```bash
npm run agent:secret -- --check --env ANTHROPIC_API_KEY=anthropic-api-key --env OPENAI_API_KEY=openai-api-key
```

Pass (exit 0) prints `token: present in the Keychain`,
`service account vaults: Cadence Agents`, the item names and `item present` for each
mapping. Failures and the owner step each one needs:
- exit 4, no token: Emi runs step 5 of `docs/qa/agent-secrets.md`.
- exit 6, `cannot read "Cadence Agents"` or `can reach other vaults`: Emi recreates
  the service account for "Cadence Agents" only (step 4), then step 5. On
  2026-10-30 the account read "Cadence" instead; until fixed, the API runners skip.
- exit 6, an item `missing`: Emi creates that key (steps 2–3).

Production sessions expire when Google ends them. Enrollment is a sign-in (Emi's
step): `npm run mcp:oauth -- enroll --target production --allow-production --slot A --port <free 4321–4330>`,
only after Ticket 232 releases those ports.

## Tiers and commands

| Tier | Clients | Command |
|---|---|---|
| 0 | Official SDK client, scripted OAuth and consent | `npm run mcp:accept:protocol` |
| 1 | Claude Code, claude.ai connector, Anthropic API, OpenAI API, Inspector CLI | `npm run mcp:accept:clients` |
| 2 | ChatGPT web, Claude web (QA Chrome profile) | `npm run mcp:accept:web` |
| 2 fallback | Same, Emi clicks, the watcher confirms | `npm run mcp:accept:guided` |
| all | Server-side records for A and B | `npm run mcp:watch` |

### Local rehearsal (Tier 0 and Tier 1)

Needs Docker, the Homebrew Supabase CLI (`/opt/homebrew/bin/supabase`), `psql`,
`openssl`, a worktree with `npm ci` done and no `.env.local`. Run every command from
the worktree root. Each command loads the stack's `runner.env` itself, so it works
in a fresh shell (Bash-tool agents get one per call); there is nothing to source.

```bash
S=.claude/skills/mcp-acceptance/local-stack.mjs; N=cadence-accept-<you>
node $S up --name $N [--db-base 56150] [--app-port 4450]   # a few minutes
node $S tier0 --name $N                                     # protocol suite, then the watcher over the same run
node $S tier1 --name $N [--scenario read-write|step-up]     # headless clients
node $S check --name $N                                     # every grant and token family revoked?
node $S down --name $N
```

- **Names and ports:** `<you>` is your ticket or agent tag (for example
  `cadence-accept-256`). Pick a free 10-port block for `--db-base` in 56000–56990
  (API base+1, DB base+2; avoid 57xxx and 553xx) and an app port in 4450–4459, the
  only issuers the Tier 1 runner accepts. `up` stops on any port in use.
- **Run IDs:** one run ID per command. The default is
  `local-<you>-t0|t1-<UTC yyyymmddThhmmss>`, printed on the first line; pass
  `--run <id>` only to resume that run. Tier 0 and Tier 1 never share a run ID.
- **Callback ports:** the OAuth redirect is caught inside the driver's browser and
  never bound on the host. `tier0` still picks a free ephemeral port per run; the
  Tier 1 runner's fixed 4459 cannot clash for the same reason.
- **Tier 0 pass:** the last line reads
  `tier0 <id>: PASS (protocol 96/96 checks passed · PASS; watcher exit 0)`. The count
  comes from the run's `report.md`; the watcher's verdict block is printed above it,
  and its full event timeline stays in the run's `events.jsonl`.
- **Tier 1 pass:** `tier1 <id>: PASS`. claude-code and inspector must pass;
  claude-ai, anthropic-api and openai-api skip with a named reason (they need a
  public server or keys). Run `--scenario step-up` too when a change touches scopes.
  For readiness only, `node $S exec --name $N -- sh -c 'npm run -s mcp:accept:clients -- --target local --issuer "$CADENCE_ACCEPT_ISSUER" --check --client all'`;
  `--check` starts nothing and creates no run folder.
- **Cleanup check:** `check` exits 0 with `all revoked`. Anything else means a
  runner did not clean up: report it with the run ID before `down`. `down` repeats the
  check, then deletes containers, volumes and the workdir (local keys and TLS files)
  and restores `AGENTS.md` and `next-env.d.ts`, which `next dev` rewrites. Nothing is
  written to `/tmp` outside the workdir.
- **Other commands against the stack:** `node $S exec --name $N -- <command>` runs
  any command with the stack's variables (`CADENCE_ACCEPT_ISSUER`,
  `CADENCE_ACCEPT_CA_FILE`, `CADENCE_ACCEPT_DB_URL`,
  `CADENCE_LOCAL_SUPABASE_URL`, `CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY`); wrap it in
  `sh -c '…'` to use them in flags.
- Don't edit `AGENTS.md` while a stack is up: `down` restores the copy taken at `up`.

### Production (Ticket 256 onward)

Order, one run folder per command (`--run prod-<date>-<n>`):

1. Preconditions: go-ahead recorded (first run only), Ticket 232 cleanup not running,
   `agent:secret -- --check` passes, both sessions pass `mcp:oauth -- status`,
   `export CADENCE_QA_SUPABASE_PUBLISHABLE_KEY=…` (a public key; ask the coordinator
   once per session, and never look it up with an owner credential).
2. Tier 0: `npm run mcp:accept:protocol -- --target production --confirm-production --run <id>`.
   Start the watcher first (`npm run mcp:watch -- --target production --confirm-production --account both --since 2m --expect inspector --run <id>`);
   the production watcher sees only active grants, so keep the default grant hold.
3. Tier 1: `npm run agent:secret -- --run .intent/acceptance/<id> --caller client-runners --env ANTHROPIC_API_KEY=anthropic-api-key --env OPENAI_API_KEY=openai-api-key -- node scripts/acceptance/client-runners.mjs --target production --allow-production --run <id> --client claude-code,anthropic-api,openai-api,inspector`.
4. Claude web and the claude.ai runner **one after the other**: they share the
   claude.ai "Cadence QA" connector grant. Web's preflight refuses an active Claude
   grant, and the claude.ai runner needs exactly one. Run
   `npm run mcp:accept:web -- run --client claude-web --account A --scenario read-write --allow-production --keep-grant --run <web-id>`,
   then `node scripts/acceptance/client-runners.mjs --target production --allow-production --client claude-ai --run <id2>`,
   then `npm run mcp:accept:web -- revoke --run <web-id> --allow-production`.
5. ChatGPT web: `npm run mcp:accept:web -- run --client chatgpt --account A --scenario read-write --allow-production --run <id>`,
   then `--scenario step-up`. On a stop it prints `guided-fallback … reason=…`; use
   guided mode below.
6. Cleanup: every runner revokes its grants. Check with
   `node scripts/acceptance/ledger.mjs ids <id>` and the watcher (`--once`).
   Archive created Behaviors through the run log (`Review practice …` titles).

### Anthropic MCP connector header

Before a keyed Anthropic run, check the beta header against the live docs
(https://platform.claude.com/docs/en/agents-and-tools/mcp-connector). On 2026-10-30
the page listed `mcp-client-2026-09-15` (current; includes everything in
`mcp-client-2025-11-20`). The bundled claude-api skill still shows the 2025-11-20
value; trust the live page. The runner's value is `ANTHROPIC_MCP_BETA` in
`scripts/acceptance/clients.mjs`; if the page has moved on, update it and its test in
a ticket before the run.

### Guided fallback (ChatGPT web, Claude web)

Use only after `mcp:accept:web` stops with a named reason.

```bash
npm run mcp:accept:guided -- --client chatgpt|claude-web --scenario read-write|step-up --account A --target production --confirm-production --run <id>
```

Run it in the background. It starts the watcher, then prints
`--- Steps for Emi … ---`: send that list to Emi as one message, unchanged. Each
step is marked `seen:` when the records show it; you do not ask her anything.
It checkpoints the grant and the created Behavior, then revokes the grant
(`--keep-grant` keeps it). `--print-only` previews the list without starting
anything. Exit 0 all steps seen; 1 a step was not seen (it prints the resume
command); 2 usage. Local rehearsal of the plumbing:
`node $S exec --name $N -- sh -c 'npm run -s mcp:accept:guided -- --client chatgpt --target local --db-url "$CADENCE_ACCEPT_DB_URL" --timeout 1m'`
(no verified ChatGPT client exists locally, so it stops with `step-not-seen`).

## Resume

Every runner writes `.intent/acceptance/<run-id>/` (run.json, checkpoints.jsonl,
events.jsonl, STATE.md, report or evidence files). A new agent resumes from the
folder alone:

1. `node scripts/acceptance/ledger.mjs state <run-id>` (or read `STATE.md`): status,
   blocked steps, pending human steps, next steps, granted and created IDs.
2. Re-run the same command with `--run <run-id>` (`--resume` for
   `mcp:accept:protocol` and `mcp:accept:guided`). Done steps are skipped; an
   interrupted step reads back before writing.
3. If the owner process died, the lock is taken over automatically. A live owner
   stops you with `run-locked`; find and stop that process first.
4. Cleanup inputs: `node scripts/acceptance/ledger.mjs ids <run-id>`.

## Known client quirks

- **Claude web metadata:** Cadence rejected Claude's client metadata document
  (`invalid_client_metadata`, JWT-bearer grant listed). The fix is on
  `fix/oauth-client-extra-grant-types` (4fb3ee6) under Ticket 232. Until it deploys,
  Claude web stops and the claude.ai runner skips. The watcher cannot see failed
  registrations.
- **ChatGPT read-only, no step-up:** ChatGPT (and Inspector) link asking for
  `cadence.read` only, so Cadence's consent shows no write boxes. ChatGPT then
  refuses writes itself and never starts a step-up. The watcher shows
  `create_behavior denied insufficient_scope` but cannot show whether ChatGPT tried
  to re-authorize. Record it as a finding; do not work around it.
- **Inspector scope request:** Inspector 2.13.0 asks for `cadence.read` and
  `offline_access` unless its OAuth scopes are set to all three tracking scopes. The
  Tier 1 runner uses its own DCR client and grant, so this matters only for manual
  Inspector use.
- **Consent write default:** both write boxes are ticked by default
  (`ConsentForm` `defaultChecked`), so one click grants writes. The product decision
  stays with Ticket 232. Read-only scenarios must untick them; the drivers do.
- **Consent before hydration:** clicking Allow or Deny before the page hydrates
  returns 500 (`Origin: null`). The drivers wait for hydration; a slow human may hit it.
- **Claude Code CIMD grant:** a grant made with Claude Code's public metadata shows
  as verified "Claude Code"; do not count it as a real Claude Code client.

## Recovery

- **Usage limits:** a stopped or limit-hit agent keeps its uncommitted work in its
  worktree. Check `git -C <worktree> status`, then wake it
  (`ws.agent.wakeOrCreate(taskNoteId, context)`) or start a replacement pointed at the
  same worktree and run folder. Never redo a done ledger step by hand.
- **Docker restarts** stop local stacks (seen about 6 hours in). `local-stack.mjs status`
  reports `containers are gone`; run `down`, then `up`, then start new runs (a fresh
  stack has none of the old run's users or grants). On a stack that is still up, a
  resumed local run signs in fresh test-login users.
- **Local limits:** test login allows 10 users per app process (each Tier 0 run uses
  2, each Tier 1 process 1) and DCR allows 10 registrations an hour. On
  `test-login-quota-reached`, run `down` and `up`.
- **Parallel test ports:** `tests/acceptance-web-client.test.mjs` binds 4431–4433;
  two worktrees running it at once fail with `EADDRINUSE`. Run it alone.
- **Load timeouts:** under full-suite load, `core-portability`,
  `desktop-release-acceptance`, `briefing-sequence` and the ledger SIGKILL test can
  time out. Re-run the file alone before calling it a failure. On Node 26, Ticket 232
  tests fail by design; use Node 24.
- **Reading output:** when you filter a runner's output, use one filter. `grep … ;
  tail …` on the same file prints the last lines twice, which looks like a runner bug.

## Reporting

Report the run IDs, each tier's pass, fail or skip with its named reason, the
watcher verdicts, cleanup results (`local-stack.mjs check` locally; `ledger.mjs ids`
and a `--once` watcher read in production) and any finding.
Put long evidence in the run folder or the task note, never secrets.
