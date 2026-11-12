# Implementation Status

## How to use this file

This file holds current state: the open-work table and the newest dated entries.
History lives in `docs/status/archive/`, one file per month, moved there unchanged.
`docs/status/README.md` maps each ticket number to its archive file and heading.
Search the archive with grep for older facts; do not read it in full.
`npm run agents:check` fails when this file is larger than 40,000 bytes.

## Update rules

Update this file whenever a ticket starts, completes, becomes blocked, is reopened, or materially changes scope.

Use these status values:

- `not_started`: No implementation work has begun.
- `in_progress`: Work has begun but is not complete or verified.
- `blocked`: Work cannot continue until a specific dependency or decision is resolved.
- `complete`: Acceptance criteria are satisfied and required verification has run, or unavailable commands are explicitly noted.
- `deferred`: Work is intentionally postponed and should not be implemented in v1 unless the docs change.

When updating a ticket row:

1. Keep the ticket scope anchored to `docs/TICKETS.md`.
2. Record key files changed, not every trivial file.
3. Record verification commands with pass/fail status.
4. Record blockers and follow-ups as concrete next actions.
5. Do not mark a ticket `complete` if `npm run lint`, `npm run typecheck`, `npm run test`, or `npm run build` failed or could not be run without explanation.
6. Do not use this file to expand v1 scope. Put future ideas in `docs/FUTURE_UPDATES.md` unless a user explicitly moves them into scope.

Recent entries and the archive:

- Add each new dated entry at the top of "Recent entries", newest first, with the date in its heading (`## <title> — <Month D, YYYY>`).
- When `npm run agents:check` reports that this file is too large, run `npm run status:archive`. It moves the oldest entries, unchanged, into `docs/status/archive/` and regenerates the index.
- Never delete history. Do not edit or reword archived entries.

## Open work

Sources: `docs/TICKETS.md` `Status:` lines for tickets that are not complete, and dated entries
from October 18, 2026 onward (in "Recent entries" below or in `docs/status/archive/`). "TICKETS"
means `docs/TICKETS.md`; "STATUS" means a dated entry, found here or through
`docs/status/README.md`. Where an entry and `git log` disagree, the row says so. Older
owner-gated items are grouped into one row per area (marked "grouped").

Compiled November 9, 2026; MCP, acceptance tooling and travel rows reconciled November 11, 2026.
Check the cited entry before acting on a row.

| Ticket or area | State | Next action or blocker | Source |
| --- | --- | --- | --- |
| Tickets 301–309: Settings regroup and simplification | Merged to `main` November 11 as PR #205 (`6dd414f8`); all six hosted migrations pushed; Daily Brief grant retired; signed-in hosted check passed November 11 as test account A at 1280 and 390 px | Owner sets the Google Maps spend cap, then an agent runs one hosted Home lookup (308); owner deletes the vault item `google-calendar-agent-retire-secret`; owner reads `docs/qa/2026-11-10-settings-wording.md`; installed Mac check (302) waits on the Mac 0.1.10 release (credential backup is Ticket 325) | TICKETS, Tickets 301–309; STATUS, "Tickets 301–309 hosted verification — November 11, 2026" |
| Tickets 310–324: connector completion (D28) | 310–319, 321 and 322 merged to `main` with PR #207 on November 11, 2026, off behind `CADENCE_CONNECTOR_COMPLETION`; hosted migrations `20261111140000` and `20261111150000` applied November 11; Hevy read by events cursor (strategy A) | Ticket 320 (contract 5, SQLite schema 24) merged with PR #216, hosted `20261111160000` applied: installed acceptance on a dev-signed build. Ticket 323 waits on published Mac 0.1.10 (includes 319 and 320; release authorized in the November 12 PR review; configured release Mac required) and Ticket 241's release steps 6–7 and installed connector acceptance; then the flag turns on by owner instruction. 324 after 323 | TICKETS, Tickets 310–324; STATUS, "Connector completion hosted push and merge — November 11, 2026" |
| Ticket 326: configuration history in two key shapes (defect D2, web export 500) | Read-side fix on branch `claude/fix-export-camelcase-60ae30`: export, BehaviorLog restore and Daily Brief history normalize camelCase snapshots; the export route logs failures | Merge and check export as account A on production; Mac account sync still uploads camelCase snapshots (writer fix ships with a later Mac release); optional data migration needs the owner's approval | TICKETS, Ticket 326; STATUS, "Ticket 326: web export reads Mac-written configuration history — November 11, 2026" |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294, 295 and 296 complete (PR #238 merged); 297 implemented on PR #241 (connection and native token storage; no UI); 298 complete in source on PR #240 (gated device routes); 299 in progress; 300 not started | 298: apply the additive release migration before activation; the production flag must stay unset. Ticket 299 wires the hidden UI and model call; hidden until the owner turns it on (`docs/DECISIONS.md`, 2026-11-12). Ticket 300 needs a Mac build (mac-release) | TICKETS, Tickets 294–300; STATUS, "Ticket 298: Daily Brief device prepare and complete — November 12, 2026" |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned; comparison on H1–H10 and S1 prepared November 11 | Owner sets a spend cap (US$2 asked) and optionally names extra models; agents run the comparison; the owner promotes or rejects under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md`, "Prepared owner comparison" |
| Ticket 291: skill-rule acceptance scenarios | Local-stack run with `claude-code` passed all three scenarios November 11 | Production run with the API clients; needs a spend cap for the QA keys | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "First local run — November 11, 2026" |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | Entry says "not pushed"; `git log` shows PR #198 merged | Not yet rechecked on an installed Mac | STATUS, "Follow-up after Mac 0.1.9: reminders for newly added Calendar events — November 7, 2026" |
| Updater key rotation and new Developer ID identity | New key, certificate, profile and notarization password in place; release `check` passes | Build notarized 0.1.10 on a configured release Mac (authorized November 12); hand install on both Macs; publish `latest.json`; owner attaches key files to 1Password; renew the certificate before December 11, 2027 | DECISIONS, 2026-11-11; STATUS, "Updater signing key rotated — November 11, 2026" |
| Ticket 325: release credential backup and restore | Cadence Release vault and service account in place; identity, notarization and updater backups made and `verify-backups` passes (November 12) | Owner creates the App Store Connect API key; agents back it up and switch notarization to it; certificate-renewal spike | DECISIONS, 2026-11-11 (D29); TICKETS, Ticket 325; STATUS, "Ticket 325: live backups verified — November 12, 2026" |
| Cadence for Mac 0.1.9 | Published November 7, 2026 | macOS 14 not tested; 0.1.8 users with an auto-archived Behavior must download 0.1.9 | STATUS, "Cadence for Mac 0.1.9 published — November 7, 2026" |
| Ticket 285: installed Mac acceptance | Run November 6–7, including Calendar-event activation on published 0.1.9 | Closure not stated: unclear — see source; user guide line for `P-027` still to add | TICKETS, Ticket 285; STATUS, "Ticket 285 defect fixed: blank Mac window from the archive notice — November 7, 2026" |
| Ticket 284: web acceptance with the real clock | Evidence recorded, awaiting verification; seven findings fixed on `travel-wave6` (merged as PR #196 per `git log`) | Verification of the evidence and fixes; Ticket 283 Outlook or iCloud routed event not checked (no test connector) | TICKETS, Ticket 284; STATUS, "Travel advisory revamp Wave 6: Ticket 284 web acceptance with the real clock — November 6, 2026" |
| Travel revamp Tickets 260–283 | Merged as PRs #189–#194 and #196, November 5–7, 2026; live on web; Mac parts released in 0.1.9; hosted equals git, so the 275–277 migrations are applied; TICKETS reconciled November 11, 2026 | Release acceptance continues under Tickets 165, 284 and 285; production setting of `CADENCE_LEAVE_REMINDER_JOB` not checked | TICKETS, Tickets 260–283; STATUS, "Ledger cleanup — November 11, 2026" |
| Ticket 165: travel release acceptance | In progress | Denied state; installed Open Location Services and Check again; installed status-only permission regression. Directions matrix: web rows in Ticket 284, installed Mac row in Ticket 285 | TICKETS, Ticket 165; STATUS, Ticket 284 and Ticket 285 entries (November 6–7) |
| Ticket 187: agentic Calendar access | Live since October 24, 2026 | Google sensitive-scope verification (Ticket 245); published Mac against the 187 server; installed desktop consent; `P-012` | TICKETS, Ticket 187 |
| Tickets 245–246: messaging track | Filed October 27; not development tickets | 245: Google verification submission, gated on `P-010` and `P-012`. 246: pre-launch messaging pass | TICKETS, Tickets 245–246; STATUS, "Messaging track — October 27, 2026" |
| Ticket 212: home and travel in onboarding | Live on web since October 24 | Authenticated browser QA of the setup row against a real routing report; installed desktop QA | TICKETS, Ticket 212 |
| Ticket 216: completion place labels | Live on web since October 24 | iPhone Safari re-prompt check; installed signed-desktop CoreLocation acceptance; `P-001` | TICKETS, Ticket 216 |
| Ticket 217: learned travel habits | Live on web since October 24 | Production QA; installed desktop acceptance; `P-002` | TICKETS, Ticket 217 |
| Ticket 218: weather travel margin | Code live; weather off | Operator clearance (`CADENCE_WEATHER_PROVIDER_CLEARANCE`); paid plan; deployed-web and installed acceptance; `P-003` | TICKETS, Ticket 218 |
| Ticket 219: travel facts in Daily Brief input | Stages 1 and 2 live on web | Google's reply to support case 76805292 and the day-level-facts decision; `P-004`, `P-012`; installed desktop acceptance | TICKETS, Ticket 219 |
| Ticket 184: owner-reviewed briefing candidate | Candidate 3 (`daily_brief@1.2`) from the October 23 review | Held-out cases, quality acceptance, promotion and rollback execution | TICKETS, Ticket 184; STATUS, "Ticket 184 candidate 3 — October 23, 2026" |
| Ticket 188: duration estimates from descriptions | Implementation started; recovered for owner review October 22 | Landing decision: unclear — see source | TICKETS, Ticket 188; STATUS, "Tickets 187, 184 candidate 2 and 188 recovered for review — October 22, 2026" |
| Ticket 130: account synchronization | TICKETS says in progress (2026-09-08) | The owner decides its state | TICKETS, Ticket 130; STATUS, "Ticket ledger reconciled with production — October 27, 2026" |
| Account sync timezone rule | PR #159 merged October 28; hosted push authorized | Not verified: a timezone change synced from an installed Mac after the push; authenticated hosted sync against the new rule | STATUS, "Account sync timezone rule for archived Behaviors — October 27, 2026" |
| Ticket 232: MCP production acceptance | Live acceptance complete October 31 | Trust Preview → Production run: unclear — see source | STATUS, "Ticket 232 live acceptance complete — October 31, 2026" |
| Trust evidence binding (launch gate) | Marketing-ID refresh paused before public launch; the Trust page reads Stale; the nightly collection still runs | Before launch: automate the refresh after each production deploy, run it once, collect Production evidence and confirm Passed. No agent refreshes or asks before then | DECISIONS, 2026-11-11, "No Trust marketing-ID refresh before launch"; `docs/OPERATIONS.md`, "Public-product operations" |
| MCP acceptance tooling, Tickets 247–258 | Complete except conditional Ticket 253 (on hold); TICKETS reconciled November 11, 2026 | Consent Allow or Deny before hydration returns 500 (product finding, not fixed) | STATUS, "Automated MCP client acceptance: Tickets 247–258 — October 31, 2026"; TICKETS, Ticket 253 |
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Hevy passed on production web November 11; Outlook production OAuth settings checked | Owner creates vault items `outlook-test-account-a` and `icloud-test-account-a`, then agents run iCloud (240), Outlook (242) and the rest of 241 step 6; 242 cross-tenant needs a work or school account outside the home tenant; installed desktop waits on the 0.1.10 install on the test Mac; 241 step 7 copy is live and awaits the owner's review | TICKETS, Tickets 236, 240, 241, 242; STATUS, "Connector production acceptance — November 11, 2026" |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: verify deployed browser-push delivery after the reviewed web-push 4.0.0 upgrade; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## PR #240 integration review — November 12, 2026

Integrated the device routes with the reviewed PR #238 source (`2601bac8`), including
PR #242's owner decisions. Earlier status entries and archived history are preserved.

- Added `/api/advisor/brief/device/release` and the authenticated, pending-only
  `release_daily_brief` RPC. Migration `20261112041029_release_pending_daily_brief.sql`
  preserves completed attempts, replacement leases, daily admissions and rate limits.
- Fixed complete-request replay downgrading a successful attempt. Only a request that
  completed its own lease may undo it after a failed final context fence. Complete also
  rechecks context expiry after the final fence. No hosted model behavior changes.
- Fresh `npm ci`, agents, interactions, resolvers, full lint, typecheck and web build
  passed. Lint retains six existing warnings. The full suite passed 5,729 tests and
  skipped 230; 29 failed because this executor denies Unix-socket binding (`listen
  EPERM`) in the unchanged session-broker and Docker-proxy suites. An additional
  consumer-test failure under a dependency overlay disappeared after fresh `npm ci`;
  no product change was needed for it.
- Local `supabase db reset --local` failed before reset because Docker socket access is
  denied. The SQL ownership, replay and quota regression runs in Local Supabase
  rehearsal. GitHub CI and that rehearsal remain merge gates. The RPC type is
  synchronized in source; generation against the applied migration is not verified.
- Apply the additive migration before activation. The production device-model flag
  stays unset under PR #242. Ticket 299 wires the hidden client and release call.
  This change adds no desktop schema or sync-contract change.

Platform impact: web, gated device routes; desktop, Ticket 299 consumes them; marketing
and future mobile, not applicable. Messaging impact: P-029, unchanged.

## Ticket 297: Mac app ChatGPT connection — November 12, 2026

Cadence for Mac can connect, refresh and disconnect one ChatGPT account (D27). Branch
`claude/ticket-297-mac-chatgpt`, PR #241. No UI uses it until Ticket 299, whose desktop
switch stays off by default under the November 12 owner decision.

- Rust (`apps/desktop/src-tauri/src/chatgpt/`) runs discovery, the one-shot `127.0.0.1`
  callback listener, code exchange, RS256 ID-token validation, the plan-scope check,
  single-flight refresh, revocation and the catalog read. The webview gets state, email
  and `slug`/`visibility` rows through `apps/desktop/src/chatgpt/connection.ts`.
- Tokens and the per-installation host ID stay in two native-only Keychain items,
  `chatgpt-installation` and `chatgpt-session`. The webview secret commands refuse both.
  The CSP is unchanged.
- Direct dependencies `reqwest`, `rustls`, `ring` and `base64` were already in
  `Cargo.lock` through the updater; the lock adds no crate.
- Mocked tests pass: 22 new Rust tests (154 Rust lib tests in all) and 6 TypeScript tests,
  including one that scans an export, two backups and the database for ChatGPT values.
  No live sign-in ran. Installed acceptance is Ticket 300.
- PR review added streaming response limits, a callback deadline that incomplete requests
  cannot extend, grant revocation after failed Keychain persistence, and strict issued-at,
  audience and authorized-party validation. Three new native regressions cover response
  limits, stalled callbacks and persistence failures. The six TypeScript connection tests
  and governance checks passed; Rust is unavailable in the review executor. The reviewed
  head still requires GitHub Desktop native CI. These changes do not enable the plan path.

## Ticket 298: Daily Brief device prepare and complete — November 12, 2026

Implemented in source on `claude/ticket-298-device-brief`; not pushed or deployed.

- `POST /api/advisor/brief/device/prepare` admits the attempt, builds the context and
  returns the model request with a signed envelope. `/complete` verifies the envelope and
  lease, validates the device's output, finishes the lease and records the tip. The server
  makes no model call on this path and stores no prepared payload.
- The envelope is HMAC-SHA256 signed under `CADENCE_DAILY_BRIEF_ENVELOPE_SECRET` and
  expires with the 75-second lease. It binds the user, installation, lease, preferences,
  configuration and context revisions. `readBriefingContextFence` lets complete fence the
  stored inputs without a capture in memory. Recipe 1.0 only.
- `CADENCE_DAILY_BRIEF_DEVICE_MODEL` gates the mode, off by default. Settings report
  `deviceModelAvailable` without `OPENAI_API_KEY`.
- Platform impact: web, the hosted routes and flag; desktop, Ticket 299 calls them;
  marketing and future mobile, not applicable. Messaging impact: P-029 (data flow note).
- Checks: agents, interactions and resolvers checks, typecheck, lint (six existing
  warnings) and build passed. Vitest on the 50 Daily Brief, briefing and advisor test
  files: 769 passed. Dagger was not run. Vercel variables are owner-gated and unset.

## Ticket 296: ChatGPT plan adapter — November 12, 2026

**On branch `claude/ticket-296-plan-adapter`.**

- `lib/services/daily-brief-chatgpt-plan.ts`: catalog read, model choice in the owner's
  order (`gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`; none listed means not eligible, no
  fallback), the plan request body, SSE reading without a Content-Type, a 256 KB stream cap
  and 64 KB output cap, and error mapping to `usage_limit`, `not_eligible`, `reconnect`,
  `retry_later`, `advisor_unavailable` and `timeout`. Browser-safe; no bodies logged.
- `lib/services/daily-brief-schema.ts` holds the output schema both adapters share;
  `daily-brief-openai.ts` imports it, so the hosted request is unchanged.
- Tests: `tests/daily-brief-chatgpt-plan.test.ts` (16). The briefing, Daily Brief and spike
  tests pass. Ticket 296 is complete; 297 and 298 can start.
- Platform impact: web, none (hosted path unchanged); desktop, the adapter Ticket 299
  wires in; marketing and future mobile, not applicable. Messaging impact: none.

## Ticket 295: ChatGPT plan spike passed live — November 12, 2026

**On branch `claude/brief-chatgpt-plan-086210`.**

- The owner signed in with ChatGPT Pro three times on November 12 (UTC). The third run
  passed. Results and recommendations are in `docs/qa/2026-11-07-chatgpt-plan-spike.md`.
- Sign-in, the `chatgpt.tokens.use.direct` grant, the catalog (10 models), refresh with
  rotation and revocation work. CORS allows `tauri://localhost` on both endpoints.
- Daily Brief through Cadence's validation: `gpt-5.6-luna`, `gpt-6.1-terra` and
  `gpt-6.1-sol` valid on 8 of 8 fixtures; `gpt-6-astra` 7 of 8 (one
  `server_is_overloaded`). Slowest call 14.3 s; none over 30 s.
- The plan route rejects `background`, a string `input` and `stream: false` with 400. It
  accepts strict `json_schema`, `reasoning`, `tools: []` and `max_output_tokens`.
- Spike fix: the plan route's streaming 200 has no `Content-Type`. The first two runs read
  those replies as JSON and marked them interrupted. `scripts/chatgpt-plan-spike.ts` now
  reads any non-JSON reply as SSE; the mock omits the header, and a test covers it. An
  uncommitted diagnostic edit (event names and content type in the probe report, no
  bodies) appeared in the worktree during the first run; it is kept and committed here.
- The owner approved the recommendations on November 12 and set the model order:
  `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna` (`gpt-6-luna` untested).
- Next: the Ticket 296 adapter, then Tickets 297 and 298.
- Platform impact: none (development script and QA record). Messaging impact: none.

## Ticket 325: live backups verified — November 12, 2026

The owner created the Cadence Release vault and its read/write service account and stored
the token in the login keychain (service `cadence-release-1password`). With the owner's
`release-secrets` approval in chat, recorded in `.intent/acceptance/mac-0.1.10-20261111`,
an agent ran `backup` for the identity, the notarization credential and the updater key.

- **Verified:** `verify-backups` reports all three items complete with matching
  fingerprints. The `desktop-release` preflight shows `release-vault-token` and
  `release-backups` ready.
- **Fixed in `release-credentials.mjs`:** `op item create` ignored a template on Node's
  stdin pipe (a socket, not a FIFO) and created "Untitled SecureNote" items, so `backup`
  now passes a 0600 `--template` file and checks the returned title. Attachment names with
  periods (`identity.p12`, `cadence-updater.key.pub`) are escaped. Two Untitled items and
  one partial updater item were deleted from the vault. `tests/release-credentials.test.mjs`
  covers both (14 pass).
- **Still open:** the App Store Connect API key (owner creates it), switching notarization
  to it, and the certificate-renewal spike.

## PR integration review and release access — November 12, 2026

Reviewed PRs #218–224, #226–229 and #234 in one protected integration candidate,
based on `d3314e33`, preserving each original PR head. The uploaded source stage
`22c792f0` matches the checked local tree. Findings, merge order, implementation
fixes and deployment steps are recorded in `docs/qa/pr-integration-2026-11-11.md`.

- Fixed export snapshot fixtures and private-error logging (#226), a spaced-checkout
  acceptance entrypoint (#228), dialog focus ordering (#220), dependency manifest
  and compiler alignment (#219, #222), broker test port collisions (#234), and the
  Travel-off permission probe (#223). The Daily Brief validation contract remains
  trusted server data (#229); client signing is still Ticket 298.
- Fresh `npm ci`, lint, typecheck, web build, desktop frontend build, marketing
  build/check, public source check and Trust checks/fixtures passed. Lint retains
  six existing warnings. Full tests: 5,660 passed, 230 skipped, 29 failed solely
  on unavailable Unix sockets (`listen EPERM`: 21 broker and eight proxy tests).
  Per-stage governance passed. Dagger and Docker are unavailable here.
- Source integration is not deployment acceptance. The final GitHub `verify`,
  Desktop native, Local Supabase rehearsal and Web client runner results must pass
  before merge. Both production sites are Ready at baseline `d3314e33`; signed-in
  export and deployed push delivery remain unverified.
- The owner authorized release in this review. Mac 0.1.10 source is prepared;
  notarized artifacts and publication remain pending. `desktop-release` preflight
  exits 10: this Linux workspace lacks release-Mac, test-device and credential
  access. Published 0.1.9 remains current. Existing installations need one manual
  upgrade after the updater-key rotation. Installed acceptance must preserve data
  through inherited SQLite migrations 21–24 and verify linked sessions under the
  new signing identity. Existing activation and Trust-refresh gates stay unchanged.

## Cadence for Mac 0.1.10 prepared — November 11, 2026

The desktop source version is now 0.1.10. The release commit will be this change's merge on
`main`, which carries Ticket 292 (SQLite 0021–0023, sync contract 4), the Settings regroup
(P-037), Ticket 319 and Ticket 320 (SQLite 0024, contract 5).

- `release:credentials -- status` passes on the owner's Mac: new identity (394 days left),
  2026-11 profile, notarization password and the rotated updater key.
- Preflight `desktop-release,desktop-test-mac,desktop-owner-mac`
  (`.intent/acceptance/mac-0.1.10-20261111`): 13 ready, 5 owner steps (test-Mac app
  permissions, the owner's Mac has no Cadence install, Cadence Release service account,
  `release-secrets` approval, notarization go-ahead).
- Release check 4 (real updater) cannot run: 0.1.9 and earlier reject the rotated key, so
  every installed copy upgrades by hand once (`docs/DECISIONS.md`, 2026-11-11). Check 3 runs
  from a downloaded DMG.
- Not done: notarized build, installed acceptance, publication. The version change does
  not publish an installer; Mac release access and artifact verification remain required.
- Review fixed the permission probe when Travel is off: it opens and closes the
  "Set up Travel" drawer as well as "Travel settings". All 40 adapter tests pass.

## PR 218: browser-push compatibility review — November 11, 2026

- Upgraded web-push to 4.0.0 and removed Ticket 105's obsolete upstream-blocked
  exception. Cadence's named service APIs remain compatible on Node 24.
- The real encrypted-transport test now rejects every Node deprecation. All 51
  push and reminder tests pass; `npm audit --omit=dev` reports zero vulnerabilities.
- Verification: agents, interactions, resolvers, lint and typecheck pass. The full
  suite passes 5,610 tests; all 29 failures come from this environment denying Unix
  socket creation in the session-broker and Docker-proxy tests. Dagger and Docker
  are unavailable. Refreshed GitHub CI remains the merge gate.
- Ticket 105 stays open until deployment verification. No real push send ran.

Platform impact: web dependency only. Desktop uses native reminders; marketing and
future mobile are not affected. Messaging impact: none.

## Connector production acceptance — November 11, 2026

Run `conn-accept-20261111`, as test account A on production. Evidence:
`docs/qa/2026-11-11-connector-acceptance.md`.

- **Hevy (236): passed on web.** A complete 31-day read (5/5 pages, counts equal), timing
  fields only, range validation, a new private test workout on Timeline at 1280 and 390 px
  without its title, Settings panel, disconnect (reads fenced with 409) and reconnect.
  The agent added one workout, "Cadence test (connector acceptance)", to the owner's Hevy
  account (additions only, decision 2026-11-11); the owner may delete it.
- **Outlook (242):** production OAuth settings checked (authority `common`,
  `Calendars.Read`, PKCE S256, production callback). Connect not run.
- **iCloud (240):** not run.
- **241 step 6:** Hevy done; Outlook and iCloud wait on the vault items
  `outlook-test-account-a` and `icloud-test-account-a` (preflight exit 10, owner steps).
  Step 7 copy is already live on the FAQ and Privacy pages; owner review in the messaging
  track.
- **Waiting:** installed desktop checks for all three wait on the 0.1.10 install on the
  test Mac (mac-release). Cross-tenant Outlook consent needs a work or school account in a
  tenant other than the app's home tenant.
- **Defects:** none found.

## Tickets 301–309 hosted verification — November 11, 2026

An agent checked production as test account A on November 11. The in-app browser had no
Cadence sign-in, so a headless Chrome script used A's kept session instead. It gave the
browser A's current access token with a placeholder refresh token, so the kept session
cannot rotate. Script and evidence: `.intent/acceptance/settings-301-309-20261111/` (not
committed).

- **`GET /api/advisor/preferences`:** `200` with the version 4 shape: `useConnectedSources`,
  `excludedSources` for all four sources, `sourceStatus` and `connectorSources`. A's Daily
  Brief is off.
- **`/settings` at 1280 and 390 px:** `200`, no console or page errors, no horizontal
  overflow. Four groups in order: General, Connections, Planning, Account and data. State
  rows read "9 categories", "On" (Day note shortcuts), "Connected · 1 calendar" (Google
  Calendar), "Connected" (Hevy), "On · Walking from Home" (Travel) and "Off" (Daily Brief).
  The 1280 px page is 2,687 px tall.
- **Section index:** it stays in view at the bottom of the page (top 0 px at 1280, 64 px
  under the mobile header at 390). The Planning link lands its heading below the index.
- **Home lookup (308), free checks:** `POST /api/travel/home-lookup` returns `401` without a
  session and `400 invalid_request` for an extra body key. Both stop before the rate limit
  and the spend reservation.
- **Wording (309):** every "After" string in `docs/qa/2026-11-10-settings-wording.md` was
  found in source (112 rows). The file is ready for the owner.
- **Not verified:** one paid Home lookup (US$0.005, inside the US$5 monthly ceiling) waits
  for the owner's spend cap, preflight item `maps-spend-cap`. Drag reorder in a real
  browser at 390 px (304). The installed Mac (302) waits on the Mac 0.1.10 release track; Ticket 325 owns credential backup and restore.
- **Preflight:** `web-travel` exited 11. Owner items `qa-oauth-client` and
  `qa-consent-test-users` and the unscripted QA Chrome steps are not needed for these checks.

Platform impact: web hosted checks only; no code change. Desktop: 302 waits on 0.1.10.
Marketing and future mobile: not applicable. Messaging impact: none.

## Tickets 288 and 291: measured usage and local acceptance; 289–290 comparison prepared — November 11, 2026

- **Ticket 288 complete.** Production logs `daily_brief.model` usage (`CADENCE_PERF_LOG=1`
  is on). The Vercel runtime logs (one-day retention) held two successful briefs: 8,260
  and 9,106 input tokens, 585 and 376 output tokens, none cached. That is about
  US$0.0023 per brief at the rechecked `gpt-5.6-luna` price; the assumption was
  US$0.004. `docs/COSTS.md` now shows Daily Brief at US$0.03 / US$0.07 / US$0.14 a
  month and records the US$0.02 cached-input price. Two samples is a small base.
- **Ticket 291:** first local-stack run with a real client. `claude-code` (subscription,
  no API charge) passed `skill-check-in-unconfirmed`, `skill-routine-unconfirmed` and
  `skill-routine-confirmed` on test account A; the watcher matched every client call and
  `check` found all 3 grants revoked. Runs `local-291-t1-1111t193138`, `…193212`,
  `…193226`. The production run with the API clients remains.
- Fixed `local-stack.mjs` doing nothing when the checkout path has a space. Documented
  the Supabase CLI workaround: Homebrew 3.1.0 rejects `[inbucket]`, and the npm 2.105.0
  binary fails its code signature in a fresh worktree.
- **Tickets 289–290:** the side-by-side comparison is prepared on reserved cases H1–H10
  and S1, which have never run. It waits for the owner's spend cap; no model call was made
  and nothing was promoted.
- Verification: `dagger check` passed agents, interactions, resolvers, lint, typecheck,
  build, desktop-build, marketing and public-trust. Its `test` check failed 5 files that
  read `.claude/` or git history, which the Dagger source excluded at the time;
  locally the full `npx vitest run` showed no failure, and the local-stack, client-prompts
  and client-runners tests pass (57 tests). This run preceded the Dagger repairs in PR #231.
- Review added a subprocess regression for a checkout path containing spaces. It checks
  that the CLI reports an invalid command instead of silently exiting successfully.
  The 58 local-stack, client-prompts and client-runners tests pass; agents, interactions
  and resolvers checks also pass. The original script reproduces the silent exit.

## Ticket 296: Daily Brief prepare and validate split — November 11, 2026

**Merged with PR #229.**

- `lib/services/daily-brief-consumer.ts` now has `prepareDailyBrief` (estimates, planning,
  model request) and `validateDailyBrief` (model output to briefing from plain-JSON
  `DailyBriefValidationData`). `generateDailyBrief` composes them; its signature and
  behavior are unchanged. The 512 KB payload check uses `TextEncoder`, not `Buffer`.
- Tests: the 41 existing briefing and Daily Brief test files pass unchanged (619 tests).
  `tests/daily-brief-prepare-validate.test.ts` adds 39 tests: every preset on 7 fixtures
  matches `generateDailyBrief` after a JSON round trip, plus unknown-ref, expiry,
  configuration-revision and version rejections.
- Assumption, recorded in `docs/AGENT_RESOLVERS.md`: both steps stay server-side, because
  Ticket 298's routes call them and the Mac runs only the model call. `briefing-pipeline.ts`
  still uses `node:crypto`, so the ticket's "runs in the browser" line is not met and not
  needed under D27.
- No production gate is needed: hosted behavior is unchanged and nothing new is reachable.
- PR review reconciled this branch with current `main` and documented that validation data
  is trusted server output. Ticket 298 must authenticate its signed envelope before calling
  `validateDailyBrief` with data returned by a device.
- Review verification: agents, interactions, resolvers, lint, typecheck and web build passed;
  92 focused consumer, prepare/validate, analysis and recipe tests passed. The full suite
  passed 5,649 tests and skipped 230; 29 tests failed because this cloud executor denies
  Unix-socket binding (`listen EPERM`) in the unchanged session-broker and Docker-proxy
  suites. Dagger and Docker are unavailable. GitHub CI remains the merge gate.
- Still open in Ticket 296: the ChatGPT plan adapter and its error mapping, which wait for
  the request contract from the live Ticket 295 run.
- Ticket 295: no preflight suite covers the ChatGPT spike sign-in. The owner ask for the
  live run (`node scripts/run-chatgpt-plan-spike.mjs --live`) went to the owner on
  November 11.
- Platform impact: web, `daily-brief-consumer.ts`, hosted behavior unchanged; desktop,
  none yet (Ticket 299 wires it); marketing and future mobile, not applicable. Messaging
  impact: none.
