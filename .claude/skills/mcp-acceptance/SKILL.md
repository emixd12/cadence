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
- **Privacy (Emi's ChatGPT and Claude accounts):** the QA Chrome profile may hold
  Emi's own ChatGPT and Claude accounts. Open new chats only. Never open, read or
  search existing chats, projects, memory or history, not even to recover from a
  changed page: stop with the named reason instead. Every test prompt starts with
  `[Cadence QA]`, so test chats are easy to find.
  - ChatGPT: archive every test chat the run created once its reply is captured
    (archiving can be undone). The web runner does this by default.
  - Claude: keep test chats. Deleting cannot be undone, so the runner deletes them
    only with `--delete-claude-chats`, and only when the coordinator asks for it.
  - The ledger step `archive-chats` records `chatCount`, `archivedCount`,
    `keptCount` and `unknownCount`. `--keep-chats` turns cleanup off for both sites
    and needs a reason in the report. Any ChatGPT chat it could not archive is a
    cleanup item in the report. The archive and delete controls are first checked on
    the real sites in Ticket 256.
  - **If a run ever stops with `archive-unconfirmed` or `archive-touched-other-chat`,
    tell Emi straight away**, in one message, before anything else: the reason, the
    run ID, the site and the chat title. For `archive-touched-other-chat` the stop
    line's `affectedChats` lists each missing chat's ID and sidebar title, which is
    printed to the console only and never written to the run folder. For
    `archive-unconfirmed` it is the run's own test chat, whose title starts with
    `[Cadence QA]`. Do not retry the run, and do not open any chat to check.
  - Screenshots: the web runner takes none on the real sites by default.
    `--screenshots` captures only the conversation area, and skips the shot when
    that area shows navigation or any chat link, so the sidebar and chat titles
    never reach the run folder.

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
| Production project ref, Supabase URL and publishable key (all public) | committed in `scripts/acceptance/qa-config.mjs`; env `CADENCE_QA_SUPABASE_PUBLISHABLE_KEY` overrides the key when set | a bad override stops runners with `publishable-key-required` (watcher: `qa-publishable-key-missing`) |
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
  the service account for "Cadence Agents" only (step 4), then step 5. (Emi's setup
  was done and checked on 2026-10-30: the account reads only "Cadence Agents".)
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
  `local-<you, first 10 characters>-t0|t1-<UTC mmdd't'hhmmss>` (under 32 characters,
  lowercase, so the ledger never mistakes it for a secret), printed on the first line; pass
  `--run <id>` only to resume an empty run. Once a local Tier 0 or Tier 1 run has
  checkpoints, start a new run: test-login creates a new Auth user and cannot
  confirm the earlier user's cleanup. Inspect and report the old run before
  clearing its named disposable stack. Tier 0 and Tier 1 never share a run ID.
- **Callback ports:** the OAuth redirect is caught inside the driver's browser and
  never bound on the host. `tier0` still picks a free ephemeral port per run; the
  Tier 1 runner's fixed 4459 cannot clash for the same reason.
- **Tier 0 pass:** the last line reads
  `tier0 <id>: PASS (protocol <n>/<n> checks passed · PASS; watcher exit 0)`. The count
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
   `agent:secret -- --check` passes, both sessions pass `mcp:oauth -- status`. The
   publishable key needs no lookup: every runner, the watcher and the session store
   read it from `scripts/acceptance/qa-config.mjs`. Set
   `CADENCE_QA_SUPABASE_PUBLISHABLE_KEY` only to override it (for example after a
   key rotation, until that file is updated). Never look it up with an owner
   credential.
2. Tier 0: `npm run mcp:accept:protocol -- --target production --confirm-production --run <id>`.
   Start the watcher first (`npm run mcp:watch -- --target production --confirm-production --account both --since 2m --expect inspector --run <id>`);
   the production watcher sees only active grants, so keep the default grant hold.
   Production never exhausts the rate limits: `report.md` lists `ratelimit-a` as
   `SKIPPED` (`production-skips-rate-limit-exhaustion`) and leaves it out of the
   count, so a pass reads `<n>/<n> checks passed · 1 skipped · PASS`.
3. Tier 1: `npm run agent:secret -- --run .intent/acceptance/<id> --caller client-runners --env ANTHROPIC_API_KEY=anthropic-api-key --env OPENAI_API_KEY=openai-api-key -- node scripts/acceptance/client-runners.mjs --target production --allow-production --run <id> --client claude-code,anthropic-api,openai-api,inspector`.
   Both get the same `<id>`. agent:secret does not create a new run folder: it keeps
   its access lines in `.intent/acceptance/<id>.secret-access.jsonl` while the runner
   creates the folder, then moves them into `<id>/events.jsonl` when the runner exits.
   A leftover `<id>.secret-access.jsonl` means the wrapper was killed; the next
   agent:secret call with the same `--run` moves it. (Before Ticket 257 the runner
   stopped with `run-exists` here.)
   **After a wrapper failure before `run.json` exists, use a new `<id>`.** If agent:secret stops before the
   runner starts (exit 3, 4 or 5: a refused mapping, no token, or an `op read`
   failure) or the runner fails during setup before it creates `run.json`, the
   wrapper still creates `<id>/` holding only `events.jsonl`. A retry with the same
   `<id>` stops with `run-exists`. Fix the cause, then run both commands again with a
   new `<id>`; leave the old folder as the record of the failed attempt. If the
   production runner started and recorded checkpoints, resume its existing run
   after fixing the cause so it can reconcile earlier registrations and grants.
   Do not abandon unconfirmed cleanup by choosing another run ID.
   **Web runs (steps 4 and 5): omit `--run` to start a new run.** `mcp:accept:web`
   names its own run (`<UTC time>-<hex>`) and prints it on the last line,
   `{"step":"done",…,"runId":"<web-id>"}`. Pass `--run <web-id>` only to resume that
   run or to `revoke` it; `run --run <new-id>` stops with `run-missing`.
4. Claude web and the claude.ai runner **one after the other**: they share the
   claude.ai "Cadence QA" connector grant. Web's preflight refuses an active Claude
   grant, and the claude.ai runner needs exactly one. Run
   `npm run mcp:accept:web -- run --client claude-web --account A --scenario read-write --allow-production --keep-grant`
   (note `<web-id>` from its last line),
   then `node scripts/acceptance/client-runners.mjs --target production --allow-production --client claude-ai --run <id2>`,
   then `npm run mcp:accept:web -- revoke --run <web-id> --allow-production`.
5. ChatGPT web: `npm run mcp:accept:web -- run --client chatgpt --account A --scenario read-write --allow-production`,
   then the same with `--scenario step-up` (a new run). On a stop it prints
   `guided-fallback … reason=…`; use guided mode below.
   Privacy: both web runs open a new `[Cadence QA]` chat per prompt. ChatGPT archives
   it after the reply: check the `archive-chats` line (`archivedCount` equals
   `chatCount`, `unknownCount` 0). Claude keeps it (`keptCount` equals `chatCount`)
   unless the coordinator asked for `--delete-claude-chats`. The controls are
   unverified on the real sites until this run: if `archive-chats` stops with
   `page-changed`, report the run ID and the chats left as a cleanup item. Never open
   other chats to find them.
   The runner acts only on the run's own chat: it checks the URL carries the recorded
   chat ID, uses the one options control inside the conversation (never the sidebar),
   and stops with `page-changed` before clicking if that control is missing or
   ambiguous, or if the conversation area links to any other chat. It also refuses,
   with `no-other-chats-listed`, when no other chat is listed before the click,
   because a wrong click could not be detected then; the chat stays in place, so
   report it as a cleanup item.
   After clicking it stops with `archive-touched-other-chat` if any other listed chat
   disappeared (checked first, also when it times out), or `archive-unconfirmed` if
   the run's chat is still there. Both go to Emi straight away, with the chat title
   (Hard rules, Privacy).
6. Cleanup: every runner revokes its grants. Check with
   `node scripts/acceptance/ledger.mjs ids <id>` and the watcher (`--once`).
   Archive created Behaviors through the run log (`Review practice …` titles), and
   confirm every ChatGPT test chat was archived and every Claude test chat was kept
   (step 5).

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
step is marked `seen:` when the records show it; you do not ask her anything. The
steps keep the privacy rule: Emi starts a new chat (the prompts start with
`[Cadence QA]`), opens no other chat, archives a ChatGPT test chat after the reply,
and keeps a Claude test chat.
It checkpoints the grant and the created Behavior, then revokes the grant
(`--keep-grant` keeps it). `--print-only` previews the list without starting
anything. Exit 0 all steps seen; 1 a step was not seen (it prints the resume
command); 2 usage. Local rehearsal of the plumbing:
`node $S exec --name $N -- sh -c 'npm run -s mcp:accept:guided -- --client chatgpt --target local --db-url "$CADENCE_ACCEPT_DB_URL" --timeout 1m'`
(no verified ChatGPT client exists locally, so it stops with `step-not-seen`).

## Resume

Every runner writes `.intent/acceptance/<run-id>/` (run.json, checkpoints.jsonl,
events.jsonl, STATE.md, report or evidence files). Inspect that folder before
resuming. Local Tier 0 and Tier 1 runs with checkpoints stop with
`local-resume-needs-new-run` before enrolling another test user; use a fresh run
after reporting and clearing any unresolved grants in the named disposable stack.
For resumable runs:

1. `node scripts/acceptance/ledger.mjs state <run-id>` (or read `STATE.md`): status,
   blocked steps, pending human steps, next steps, granted and created IDs.
2. Re-run the same command with `--run <run-id>` (`--resume` for
   `mcp:accept:protocol` and `mcp:accept:guided`). Done steps are skipped; an
   interrupted step reads back before writing. Production client runs reconcile
   recorded registrations even when token exchange failed before a grant was
   checkpointed; unresolved revocation stops the retry before another client is
   registered.
3. If the owner process died, the lock is taken over automatically. A live owner
   stops you with `run-locked`; find and stop that process first.
4. Cleanup inputs: `node scripts/acceptance/ledger.mjs ids <run-id>`.

## Known client quirks

Live findings from Ticket 256 (production, 2026-10-30/31) are marked *live*.

- **Claude web metadata (fixed):** Cadence first rejected Claude's client metadata
  document (`invalid_client_metadata`), then answered `/oauth/authorize` with 503
  `server_error` because the database accepted the "claude" label only for
  dynamically registered clients. PR #172 (7ff01a5, migration 20261031003000) fixed
  it; the live Claude web run and the claude.ai runner passed. The watcher cannot see
  failed registrations, so a repeat shows up only as a stop before the grant.
- **ChatGPT step-up never starts (*live*):** on a read-only grant ChatGPT called no
  write tool and started no step-up or re-authorization (run
  `20261031T000553Z-1cde41`). The step-up scenario fails with this every time; record
  it as known ChatGPT behaviour, not a Cadence defect, and do not work around it.
  ChatGPT and Inspector link asking for `cadence.read` only unless all scopes are
  requested; with a full request ChatGPT granted all three scopes.
- **ChatGPT layout changes (*live*, fixed in 260bdd1):** the real site moved away
  from what Ticket 255 was built against. Reconnect sits behind a "Connect Cadence
  QA" data-sharing dialog or the "Actions for … Cadence QA account → Reconnect" menu;
  the composer's plugin search inserts an inline app mention (the developer-mode
  toggle is gone), so the prompt text goes after the mention; finished turns carry
  `data-talvt-turn-state=complete` (`data-message-author-role` is gone); the chat
  menu is "Chat actions". `tests/acceptance-web-client.test.mjs` stubs this layout.
  When the site changes again the runner stops with `page-changed` or
  `reply-timeout`; fix the selectors in `scripts/acceptance/web-sites.mjs` with a
  stub test, never by opening other chats.
- **`--setting-sources` hides claude.ai connectors (*live*, fixed in bd5b728):**
  `claude -p --setting-sources project` loads no claude.ai connectors, so the
  claude-ai runner saw no "Cadence QA" server. The claude-ai runner no longer passes
  it; claude-code still does (it uses `--strict-mcp-config` and its own inline
  server). Don't add `--setting-sources` back to the claude-ai runner.
- **Unrecorded ChatGPT chats (*live*):** a run that stops after sending a prompt but
  before `archive-chats` leaves a `[Cadence QA]` chat whose ID is not in the ledger.
  Report it as a cleanup item; archive it only with the runner's own archiveChat
  checks, never by browsing the chat list.
- **Inspector scope request:** Inspector 2.13.0 asks for `cadence.read` and
  `offline_access` unless its OAuth scopes are set to all three tracking scopes. The
  Tier 1 runner uses its own DCR client and grant, so this matters only for manual
  Inspector use.
- **Consent write default:** both write boxes are ticked by default
  (`ConsentForm` `defaultChecked`), so one click grants writes. The product decision
  stays with Ticket 232. Read-only scenarios must untick them; the drivers do.
- **Consent offers every advertised scope (Ticket 259, PR #175):** before #175 the
  screen shows only the scopes the client requested; after it deploys, the screen
  shows read plus both writes, writes on, even for a read-only request (ChatGPT,
  Inspector). The tooling accepts both screens. `checkConsentView` requires read as
  the fixed scope, every requested scope shown, and only advertised scopes, each
  once. The driver no longer refuses a grant wider than the request
  (`grant-not-requested` is gone); `submitConsent` stops with `scope-not-offered` if
  the page lacks a box the grant needs. The grant must equal what the run left on:
  the driver compares the token's `scope`, and the web runner stops with
  `grant-scope-mismatch` at `grant-checkpoint`. After #175, a ChatGPT run that asks
  for read only can still get writes with one Allow.
- **Test Behavior reminders:** the archive cleanup refuses a test Behavior with a
  reminder on. Every canned create prompt asks for browser and email reminders off.
  After `creation-checkpoint` the web runner reads the Behavior back. If a reminder
  is on, it sends `prompt-reminders-off` in a new chat with the same client and grant,
  then reads back again. It stops with `behavior-reminders-on` if a reminder is still
  on, or if the scenario already revoked the grant. The creation stays checkpointed, so
  report the Behavior for a manual reminders-off update before cleanup.
- **Consent before hydration:** clicking Allow or Deny before the page hydrates
  returns 500 (`Origin: null`). The drivers wait for hydration; a slow human may hit it.
- **Claude Code CIMD grant:** a grant made with Claude Code's public metadata shows
  as verified "Claude Code"; do not count it as a real Claude Code client.

## Recovery

- **`keychain-failed` / `keychain-write-conflict` (Ticket 257):** the kept A and B
  sessions are one Keychain item each. A web or guided run starts the watcher as a
  second process; both refresh the slot at start (the access token is never stored)
  and write the rotation back at once. Two concurrent `security add-generic-password
  -U` updates of one item make one exit 45 ("already exists"), reproduced with a
  throwaway item. Ticket 256 saw this three times as `keychain-failed`, the last on
  the first call of a resumed Claude web run after a pause. The store now retries
  that write up to three times; both writers hold a fresh rotation of the same
  session, so the last write wins. Ticket 258 confirmed by test that the retry also
  covers the first call after a pause past token expiry: both processes' tokens
  expire together, so both refresh and write again at once. If a run still stops with
  `keychain-write-conflict`, re-run it. Any other `keychain-failed` is a different
  `security` failure (a locked Keychain, a denied prompt or a 20-second timeout):
  check `npm run mcp:oauth -- status --target production --allow-production`, and
  ask Emi only if the Keychain itself asks for her password.
- **`run-exists` on a Tier 1 retry:** an earlier attempt with that `<id>` stopped
  before the runner created `run.json` (agent:secret exit 3, 4 or 5, or a runner
  setup failure). Fix the cause and retry with a new `<id>` (production step 3).
- **Usage limits:** a stopped or limit-hit agent keeps its uncommitted work in its
  worktree. Check `git -C <worktree> status`, then wake it
  (`ws.agent.wakeOrCreate(taskNoteId, context)`) or start a replacement pointed at the
  same worktree and run folder. Never redo a done ledger step by hand.
- **Docker restarts** stop local stacks (seen about 6 hours in). `local-stack.mjs status`
  reports `containers are gone`; run `down`, then `up`, then start new runs (a fresh
  stack has none of the old run's users or grants). A local Tier 0 or Tier 1 run
  with checkpoints cannot resume even if its stack is still up: a fresh test-login
  user cannot read or revoke the earlier user's grants.
- **Local limits:** test login allows 10 users per app process (each Tier 0 run uses
  2, each Tier 1 process 1) and DCR allows 10 registrations an hour. On
  `test-login-quota-reached`, run `down` and `up`.
- **Parallel test ports:** the web-client stub tests listen on ephemeral ports (port
  0) since Ticket 255's 1d11161, so worktrees can run them in parallel. An
  `EADDRINUSE` now points at a stray process, not the tests.
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
