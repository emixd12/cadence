# Agent-scoped secrets (Ticket 254)

Agents read the keys meant for them through a 1Password service account. They
see no Touch ID prompt. Owner secrets stay behind Emi's approval: the service
account can read only the "Cadence Agents" vault. The "Cadence" vault and the
MCP signing key are untouched and still prompt.

## Capability check (2026-10-30)

- 1Password CLI 2.40.0; one account on `my.1password.com` (an Individual or
  Families account; the plan type was not read).
- `op service-account create --help` is available in this CLI. It accepts
  per-vault `read_items` access and an expiry, and it cannot grant access to
  Personal or Private vaults.
- 1Password's service-account rate-limit page lists limits for Individual and
  Families accounts: 1,000 reads per hour per token and 1,000 reads and writes per
  day per account. One acceptance run reads two items, so the limit is not a
  constraint.
- Vaults today: Automation, Cadence, Personal. No "Cadence Agents" vault yet.
- Not verified: actually creating a service account on this account. Emi's step 4
  below is the first real test. If it fails, the fallback is macOS Keychain items
  behind the same wrapper (not built).

## Emi's one-time setup

1. In the 1Password app, create a vault named **Cadence Agents**. Put only agent
   keys in it.
2. In the Anthropic Console, create an API key for agent acceptance runs, in a
   workspace with a monthly spend limit you choose. Save it in Cadence Agents as
   an **API Credential** item named `anthropic-api-key`, with the key in the
   **credential** field.
3. On the OpenAI platform, create a project for agent acceptance runs, with a
   monthly budget you choose, and a project API key. Save it in Cadence Agents as
   an **API Credential** item named `openai-api-key`, with the key in the
   **credential** field.
4. Create a service account that can read Cadence Agents and nothing else. Either
   use 1Password.com (Developer → service accounts; the exact menu path is not
   verified) with read access to Cadence Agents only, or run this in your own
   Terminal:

   ```bash
   op service-account create "Cadence agents" --vault "Cadence Agents:read_items" --expires-in 90d
   ```

   1Password shows the token (`ops_…`) once. Optionally keep a copy in your
   Personal vault, not in Cadence Agents.
5. Store the token in the macOS Keychain. Copy the token, then run **one** of
   these in your own Terminal. Both read the token from the clipboard and pass it
   to `security -i` on stdin, so it never appears in a process argument list or
   in shell history. Both check that it looks like a token (`ops_`, then 246 to
   3,796 base64 characters, with no spaces or line breaks), store it under
   service `cadence-agent-1password` and account `service-account-token`, read
   it back and compare lengths. They print only lengths, never the token.

   Don't use `security add-generic-password … -w` with no value. Its password
   prompt keeps only the first 128 characters, and the token is much longer.

   From the Cadence checkout:

   ```bash
   pbpaste | npm run agent:secret -- --store-token
   ```

   Or from any directory, with no checkout (zsh or bash; `printf` is a shell
   builtin, so the token is never a process argument):

   ```bash
   t="$(pbpaste)"; if [[ $t == ops_* && ${#t} -ge 250 && ${#t} -le 3800 && $t != *[^A-Za-z0-9+/=._-]* ]]; then if printf 'add-generic-password -U -s cadence-agent-1password -a service-account-token -T /usr/bin/security -w %s\n' "$t" | security -i >/dev/null 2>&1; then n="$(security find-generic-password -s cadence-agent-1password -a service-account-token -w 2>/dev/null | tr -d '\n' | wc -c | tr -d ' ')"; if [[ $n == "${#t}" ]]; then echo "OK: stored ${#t} characters, read back $n"; else echo "NOT OK: read back $n characters, expected ${#t}"; fi; else echo "NOT OK: the Keychain write failed"; fi; else echo "NOT OK: the clipboard does not hold an ops_ token; nothing stored"; fi; unset t n
   ```

   Success looks like `OK: stored 900 characters, read back 900` (your numbers
   will differ, but the two must match). Then copy something else to clear the
   clipboard.

   **Redo after an older attempt.** An earlier version of this step used the
   `-w` password prompt, which stored only the first 128 characters. To check,
   run `security find-generic-password -s cadence-agent-1password -a
   service-account-token -w | tr -d '\n' | wc -c`; it prints a length only. If
   it prints 128, copy the token again (from your Personal vault copy, or create
   a new service account in step 4 and delete the old one) and run either
   command above. `-U` replaces the item. An agent then runs `--check`.

That is all. An agent then verifies the setup with the `--check` command below and
reports the result. Nothing else is asked of Emi.

## For agents

Run a command with keys in its environment:

```bash
npm run agent:secret -- --run .intent/acceptance/<run-id> --caller <agent-or-ticket> \
  --env ANTHROPIC_API_KEY=anthropic-api-key \
  --env OPENAI_API_KEY=openai-api-key \
  -- node scripts/acceptance/<runner>.mjs
```

Verify setup without reading any value (prints vault and item names only):

```bash
npm run agent:secret -- --check --env ANTHROPIC_API_KEY=anthropic-api-key --env OPENAI_API_KEY=openai-api-key
```

- Item references are `item`, `item/field` or `op://Cadence Agents/item/field`.
  The default field is `credential`. The wrapper refuses any other vault before it
  calls `op`. It also refuses reserved variable names such as `PATH`, `NODE_OPTIONS`
  and `OP_*`.
- The wrapper reads the token from the Keychain and runs `op read` with only that
  token in op's environment, so op never uses the desktop app or Emi's vaults.
  The child gets the values; the token and all other `OP_*` variables are removed.
- Each access appends one line to `<run-dir>/events.jsonl` (with `--run`), or
  else to `.intent/acceptance/secret-access.jsonl`. `--caller` defaults to the
  command's name. Fields:
  `type`, `at`, `caller`, `vault`, `item`, `field`, `env`, `outcome`
  (`ok`, `refused` or `failed`) and a fixed `reason` on failure. Never a value.
- Give the wrapper and the runner the same `--run`. If that folder does not exist
  yet, the wrapper leaves it for the runner to create (a runner stops with
  `run-exists` on an existing folder): the lines wait in
  `<run-dir>.secret-access.jsonl` and move into `<run-dir>/events.jsonl` when the
  child exits, creating the folder if the child did not. An existing folder is
  appended to directly (Ticket 257).
- The wrapper prints no value or token. op's error text is classified into a
  fixed reason and never relayed. What the child prints is the child's
  responsibility: runners must not log the keys they receive.
- `--check` fails if the service account can reach any vault other than Cadence
  Agents.
- Exit codes: the child's code; 2 usage; 3 refused; 4 no token in the Keychain;
  5 op could not read an item; 6 `--check` failed; 7 `--store-token` input is not
  a plausible token; 8 `--store-token` write or read-back failed; 127 command not
  found.

## Google sign-in for test accounts (2026-11-06)

Decision 2026-11-06, "Agents act as the test accounts, end to end". The vault holds one
Login item per test account: `google-test-account-a` (and `google-test-account-b`), with
fields `username`, `password` and `one-time password` (the authenticator seed). Emi creates
or changes these items; agents only read them.

Sign the account in to Google in the open Cadence QA Chrome profile
(`npm run mcp:accept:web -- open` starts it on port 4430):

```bash
npm run agent:secret -- --caller google-signin \
  --env GOOGLE_TEST_PASSWORD=google-test-account-a/password \
  --env "GOOGLE_TEST_OTP=google-test-account-a/one-time password" \
  -- node scripts/acceptance/google-signin.mjs --slot A
```

- It prints `{"slot":"A","state":"signed-in"}` or `already-signed-in`, or
  `{"state":"stopped","reason":…}` with exit 3. Reasons are fixed names:
  `phone-prompt`, `captcha`, `verification-required`, `browser-not-secure`,
  `password-rejected`, `otp-rejected`, `challenge-unsupported`, `stuck-<step>`. A stop
  that needs a person goes to Emi as one step.
- It computes the authenticator code itself from the seed (RFC 6238), so a code never
  sits in the environment long enough to expire. It never prints the password, a code
  or another signed-in account's address. Set `GOOGLE_SIGNIN_STOP_SCREENSHOT` to a
  path to save Google's page when it stops.
- It picks the password and then the authenticator app on Google's method pages, never
  a passkey or a phone prompt.
- First run, November 6, 2026: account A signed in through identifier, "Try another
  way", password and authenticator steps with no owner step.

## Calendar fixtures for test accounts (2026-11-07)

Decision 2026-11-06, item 4: agents create and delete test events in accounts A and B's own
Calendars through `scripts/acceptance/google-calendar-fixtures.mjs`.

- **Cloud project.** The tool uses a Desktop OAuth client in `cadence-qa-498717`. That project
  is kept apart from Cadence's production sign-in and Calendar projects, so a QA grant,
  test-user list or client change can never affect production users or Google's review of
  the production apps. A and B are listed as test users on its consent screen. The app
  stays in Testing and is not published.
- **Keychain items** (macOS login Keychain, readable by `/usr/bin/security`):
  - `cadence-qa-google-oauth-client`, account `cadence-qa-498717`: the client JSON that
    Google's Console downloads, base64-encoded. The tool reads `.installed.client_id` and
    `.installed.client_secret`. Emi stores or replaces it.
  - `cadence-qa-google-calendar`, account `production:A` (or `production:B`): the account's
    refresh token. `consent` writes it through `security -i` on stdin, never in a process
    argument.
- **Scope**: `https://www.googleapis.com/auth/calendar.events` only.

Consent signs the account in to Google first (the same code as `google-signin.mjs`), then
clicks through Google's consent in the open Cadence QA Chrome profile and stores the refresh
token. An account already signed in to the profile needs no vault variables:

```bash
npm run agent:secret -- --caller google-calendar-fixtures \
  --env GOOGLE_TEST_PASSWORD=google-test-account-a/password \
  --env "GOOGLE_TEST_OTP=google-test-account-a/one-time password" \
  -- node scripts/acceptance/google-calendar-fixtures.mjs consent --slot A
```

List, create and delete need no vault variables. Use "QA …" titles for new fixtures and
delete them at the end of the run:

```bash
node scripts/acceptance/google-calendar-fixtures.mjs list --slot A --calendar <calendar-id> \
  --from 2026-11-08T00:00:00-05:00 --to 2026-11-09T00:00:00-05:00
node scripts/acceptance/google-calendar-fixtures.mjs create --slot A --calendar <calendar-id> \
  --title "QA Leave reminder fixture" --start 2026-11-08T15:00:00-05:00 \
  --end 2026-11-08T16:00:00-05:00 [--timezone America/New_York] [--location "Evanston, IL"]
node scripts/acceptance/google-calendar-fixtures.mjs delete --slot A --calendar <calendar-id> --event <event-id>
```

- Output is one JSON line: event ids, titles, start and end times and locations, or
  `{"deleted":…,"title":…}`, or `{"slot":"A","state":"consented",…}`. `consent` also prints
  fixed step names. The tool never prints, logs or passes in a process argument the client
  secret, an access token or a refresh token.
- `--timezone` defaults to `America/New_York`. `consent` takes `--port` (default 4430).
- Exit codes: 0 done; 2 usage (unknown command, `--slot` not A or B, or a missing
  `--calendar`, `--from`, `--to`, `--title`, `--start`, `--end` or `--event`); 3 stopped.
- **Title guard.** `create` and `delete` act only on titles that start with `QA `, `Test ` or
  `W6 ` followed by text (case-sensitive). `create` checks the title before any Keychain
  read or network call. `delete` re-reads the event and refuses it when its current title
  does not match. Both stop with `title-not-test`. The `W6 ` prefix stays accepted for
  existing fixtures; agents must not create, edit or delete "W6 …" events while Ticket 284's
  live acceptance runs.
- **Stop reasons** (`{"state":"stopped","reason":…}`, exit 3): `client-missing`,
  `client-invalid`, `consent-required` (no refresh token for the slot), `token-<error>` (for
  example `token-invalid_grant`), `token-missing`, `calendar-<status>-<error>`,
  `title-not-test`, `slot-invalid`, `signin-<reason>` (any `google-signin.mjs` reason, such
  as `signin-password-missing`), `access-denied-not-a-test-user`, `consent-timeout`,
  `consent-<error>`, `no-refresh-token`, `scope-not-granted`, `keychain-value-invalid`,
  `keychain-write-failed`. Set `GOOGLE_SIGNIN_STOP_SCREENSHOT` to save Google's page when
  sign-in or consent stops.
- **Refresh-token expiry.** While the QA app is in Testing, Google expires its refresh tokens
  after 7 days. `token-invalid_grant` usually means that: run `consent` again for the slot.
- Tests (`tests/acceptance-google-calendar-fixtures.test.mjs`) use a fake Keychain and a
  fake `fetch`. They make no Google calls and check that output never contains the fake
  secret or tokens.
- `GET /api/google-calendar/events` takes local dates (`?start=2026-11-07&end=2026-11-07`),
  not instants, and `start` must be today in the account's timezone. It accepts the kept
  session's access token as `Authorization: Bearer`.

Live runs:

- **2026-11-07, account A: passed.** `qa:preflight --suite calendar-fixtures` exited 0; the
  agent renewed A's QA Calendar grant itself. In "Cadence demonstration", `create` made
  "QA Fixture round trip 2026-11-07" (20:00–20:30 ET); `list` showed it beside the two
  "W6 …" events; Cadence's events endpoint, called with A's kept session, returned it; `delete`
  removed it; a second `list` showed only the "W6 …" events. A's kept Cadence session had
  expired and was re-enrolled with `cadence-session.mjs enroll --slot A` first.
- **2026-11-07, account B: not run.** `qa:preflight --suite calendar-fixtures-b` exited 10:
  the `google-test-account-b` vault item is missing (owner step).

## Test-access preflight (2026-11-07, Ticket 286)

`npm run qa:preflight -- --suite <suite>` checks every credential and authorization a suite
needs before the run, renews what agents may renew, and prints one numbered owner list for
the rest. The engine is `.agentic/scripts/test-access-preflight.mjs`, installed from the
`service-connections-bootstrap` skill; Cadence's manifest is `.agentic/test-access.json` and
its adapters are in `scripts/acceptance/access/`.

```bash
npm run qa:preflight -- --suite all --dry-run            # the plan and every possible owner step; runs nothing
npm run qa:preflight -- --suite calendar-fixtures --run-dir .intent/acceptance/<run-id>
```

- Exit codes: 0 ready; 10 owner steps needed (send the list as one message, stop, rerun after
  the owner answers); 11 a probe or renewal failed to run (agent work, never an owner step);
  2 usage or manifest error.
- Suites: `mcp-local`, `mcp-protocol`, `mcp-clients`, `mcp-web`, `calendar-fixtures` (A),
  `calendar-fixtures-b` (B), `web-travel`, `connectors`, `desktop-owner-mac`,
  `desktop-test-mac`, `desktop-release`, `email`.
- Vault probes call `agent:secret --check` through `scripts/acceptance/access/vault.mjs
  --item <name>`; they list names only. The manifest never carries `--env NAME=item`; the
  engine refuses it.
- Agent renewals: Google sign-in (`google-signin.mjs`), QA Calendar consent
  (`google-calendar-fixtures.mjs consent`), Cadence session re-enrollment (`mcp:oauth`
  enroll in one QA Chrome tab), Cadence web sign-in, and the iCloud and Hevy connectors
  (posted once to Cadence's own API with A's kept session). Each runs through
  `agent:secret`, so the vault values reach one child process only (decision 2026-11-07).
- Steps that belong to agents but have no script yet (Google Calendar and Outlook connect,
  test-Mac sign-in, QA Chrome permission grants, travel settings) report exit 11 with the
  step's name from `scripts/acceptance/access/agent-step.mjs`.
- Owner approvals for one run (`maps-spend-cap`, `notarization-go-ahead`) live in
  `<run-dir>/owner-approvals.json`. Record one after the owner gives it:
  `node scripts/acceptance/access/record.mjs record --scope run --run-dir <run-dir> --id maps-spend-cap --source "owner set the cap in chat"`.
  The source note allows letters, digits, spaces and `,.:;()'/-` only.
  Host confirmations (`qa-consent-test-users`) use `--scope host` and live in the git-ignored
  `.agentic/runtime/test-access-confirmations.json`.
- Results: the engine keeps status only in `.agentic/runtime/test-access-evidence.json`
  (git-ignored) and, with `--run-dir`, `test-access-preflight.json`. A rerun reuses fresh
  `present` results and rechecks the rest.
- Tests: `tests/acceptance-access-adapters.test.mjs` (every adapter's exit codes with stubs)
  and `tests/acceptance-access-manifest.test.mjs` (the manifest validates and every suite
  dry-runs).
- Adapter flags must not use Node's own option names. Node 24 reads `--env-file` anywhere
  in argv and exits 9 before the script runs, so `host.mjs` takes `--dotenv <file>`.
- `host.mjs --env-name NAME --dotenv .env.local` checks this checkout's `.env.local` first,
  then the main checkout's (the parent of `git rev-parse --git-common-dir`), so agent
  worktrees without their own file still see the owner's names. It searches nowhere else:
  absolute, `~/` and `..` paths get no fallback. It reports only whether the name is set,
  and in which checkout.

First live `--suite all` run, 2026-11-07 (worktree `accounts-test`): exit 11.

- Ready 33. Agent renewals that day: A's QA Calendar grant and A's kept Cadence session.
- Owner steps: the vault items `google-test-account-b`, `outlook-test-account-a`,
  `icloud-test-account-a` and `hevy-test-account-a`; the claude.ai connector for A;
  `maps-spend-cap`; `notarization-go-ahead`; and the two `.env.local` names (false asks
  from the worktree; fixed below).
- Waiting on those items: B's Google sign-in and Calendar grant; A's Outlook, iCloud and
  Hevy connections.
- Error: `travel-settings-a` (A's Travel estimates, routing consent, Home and leave
  reminders are off, and that agent step has no script). Not acted on: it changes A's
  Cadence settings.
- The first attempt also failed `sequenzy-cli` and `agentmail-key` with Node's exit 9; the
  `--dotenv` rename fixed them.
- After the main-checkout fallback, the next run also exited 11: ready 35, owner steps 7, waiting 5,
  error 1 (`travel-settings-a`). `sequenzy-cli` and `agentmail-key` read "name set in main
  checkout" and left the owner list.

Not in the manifest (from the test access inventory), one reason each:

- `supabase-cli-login`: the owner's Supabase CLI token serves only the Ticket 232 tools and
  `supabase db push`; routine acceptance must not use an owner credential.
- `mcp-signing-key`: kept in the owner's "Cadence" vault behind Touch ID and used only for key
  custody and hosted fixtures, each use with the owner's approval; no value-free probe exists.
- `owner-mac-desktop-control`: desktop-control consent is given per agent session, not stored,
  so a preflight cannot check it ahead of a run.
- `prod-feature-config` is narrowed to `prod-mcp-enabled`, which reads
  `/.well-known/oauth-protected-resource` without credentials. The travel flags
  (`CADENCE_TRAVEL_PROVIDER_CLEARANCE`, `CADENCE_LEAVE_REMINDER_JOB`) and connector flags
  (`CONNECTOR_CREDENTIAL_*`, `OUTLOOK_CALENDAR_*`) are not probed: listing them needs the
  owner's Vercel login, and no credential-free read of their state is known. A missing
  connector flag still shows up, as `not_configured` from that connector's status probe.
- `mcp-prod-go-ahead`: the go-ahead for the first production MCP run was one-time, and
  Ticket 256 has already run on production (`STATUS.md`), so later runs need none. Checking
  it by searching a sentence in the skill would break on any wording change.
- `notary-credentials` and `updater-signing-key` are folded into `notarization-go-ahead`: their
  custody is not documented in the repo, and the owner supplies them with each notarization
  instruction through the per-version `build-env.sh`.

## Security notes

- `-T /usr/bin/security` lets any process running as Emi read the token without a
  prompt. That is the point: agents need no Touch ID. The token reaches only
  Cadence Agents, which holds spend-limited API keys.
- To revoke: delete the service account on 1Password.com, then run
  `security delete-generic-password -s cadence-agent-1password -a service-account-token`.
  To rotate a key, replace the item's credential; nothing else changes.
- Tests (`tests/acceptance-agent-secret.test.mjs`) drive the wrapper with a fake
  `op` and a fake Keychain. They scan stdout, stderr, the ledger and every written
  file for the fake token and values.
