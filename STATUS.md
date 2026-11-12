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
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294 and 295 complete; 296 in progress (prepare/validate split done; adapter next); 297–300 not started | None for 296–298; Ticket 300 needs a Mac build (mac-release) | TICKETS, Tickets 294–300; STATUS, "Ticket 295: ChatGPT plan spike passed live — November 12, 2026" |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned; comparison on H1–H10 and S1 prepared November 11 | Owner sets a spend cap (US$2 asked) and optionally names extra models; agents run the comparison; the owner promotes or rejects under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md`, "Prepared owner comparison" |
| Ticket 291: skill-rule acceptance scenarios | Local-stack run with `claude-code` passed all three scenarios November 11 | Production run with the API clients; needs a spend cap for the QA keys | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "First local run — November 11, 2026" |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | Entry says "not pushed"; `git log` shows PR #198 merged | Not yet rechecked on an installed Mac | STATUS, "Follow-up after Mac 0.1.9: reminders for newly added Calendar events — November 7, 2026" |
| Updater key rotation and new Developer ID identity | New key, certificate, profile and notarization password in place; release `check` passes | Build notarized 0.1.10 on a configured release Mac (authorized November 12); hand install on both Macs; publish `latest.json`; owner attaches key files to 1Password; renew the certificate before December 11, 2027 | DECISIONS, 2026-11-11; STATUS, "Updater signing key rotated — November 11, 2026" |
| Ticket 325: release credential backup and restore | `release:credentials` status, verify-backups, restore and backup; preflight checks; runbook; decision D29 | Owner creates the Cadence Release vault, its service account and an App Store Connect API key; agents back up and verify live; notarization switches to the API key; certificate-renewal spike | DECISIONS, 2026-11-11 (D29); TICKETS, Ticket 325; STATUS, "Ticket 325 started — November 11, 2026" |
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
- Next: the Ticket 296 adapter, then Tickets 297 and 298.
- Platform impact: none (development script and QA record). Messaging impact: none.

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

- `daily-brief-consumer.ts`: `prepareDailyBrief` returns the model request and plain-JSON
  `DailyBriefValidationData`; `validateDailyBrief` turns output into a briefing from it.
  `generateDailyBrief` composes both; hosted behavior is unchanged.
- `tests/daily-brief-prepare-validate.test.ts` (39 tests) proves the composition after a
  JSON round trip; the 41 existing briefing test files pass unchanged.
- Both steps stay server-side (Ticket 298 calls them); `briefing-pipeline.ts` still uses
  `node:crypto` (`docs/AGENT_RESOLVERS.md`). Open in 296: the adapter and error mapping.
- Platform impact: web only, unchanged behavior. Messaging impact: none.

## Ticket 326: web export reads Mac-written configuration history — November 11, 2026

**On branch `claude/fix-export-camelcase-60ae30`. Not merged; production not rechecked.**

- Cause of defect D2: Cadence for Mac stores configuration snapshots in camelCase, and
  account sync (`apps/desktop/src/account/account-sync.ts`) uploads `configuration_event`
  rows unchanged. Only the first-link path converted them. Export assembly validated the
  snake_case shape, so every web export for test account A returned 500.
- `toStoredConfigurationSnapshot` (`packages/core/src/services/configuration-payload.ts`)
  reads both shapes. Export assembly and `listBehaviorConfigurationEvents` use it, which
  covers web and Mac export, BehaviorLog restore and Daily Brief history (it read reminder
  flags as false for camelCase rows). The Mac export dropped its own copy of the mapping.
  MCP does not read configuration history.
- The export route now logs `export_download_failed` with the error class, the format and,
  for export validation failures only, the code-defined label. No raw messages or note text.
- Not done: the Mac sync writer (Ticket 326, later Mac release; `account-sync.resolver.ts`
  untouched) and an optional rewrite of the existing hosted rows (owner approval).
- Tests: `tests/export-camelcase-configuration.test.ts` (fails on `main` with "Invalid
  configuration schedule_graph."), `tests/export-download-route.test.ts`.
- PR review fixed four CI failures by giving repository pagination fixtures valid snapshots;
  a mixed-shape test checks both revisions and unchanged pagination metadata. The export
  failure classifier now permits exact code-defined labels only; a provider error that
  resembles a validation message cannot leak private text. The classifier stays in
  `lib/services/export.service.ts`, keeping the API route thin.
- Review verification: agents, interactions, resolvers, lint, typecheck and web build passed; 17 focused
  tests passed. The full suite passed 5,618 tests and skipped 230; 29 tests failed because
  this cloud executor denies Unix-socket binding (`listen EPERM`) in the unchanged session
  broker and Docker-proxy suites. Dagger and Docker are unavailable. GitHub CI remains the
  merge gate. Production acceptance has not run.

## Trust marketing-ID refresh paused until launch — November 11, 2026

The owner decided that the pre-launch development process must not include the Trust
marketing-ID refresh (`docs/DECISIONS.md`, 2026-11-11). `docs/VERCEL_WORKFLOW.md`,
"Deployment", no longer asks for it after a merge. The open item is the launch-gate row in
"Open work" and the list in `docs/OPERATIONS.md`, "Public-product operations". The stored
ID was last set on November 11 and is stale now; nobody needs to act on that.

Platform impact: operations docs only. Web: the Trust page shows Stale until launch.
Desktop, marketing and future mobile: not applicable. Messaging impact: none.

## Dagger repairs — November 11, 2026

**PR #231 (`dagger/repairs`).** Decision: `docs/DECISIONS.md`, 2026-11-11,
"Keep Dagger as the local pre-push check".

- **Command:** `dagger check --cadence --progress=report`. A bare `dagger check` also runs
  the Dang SDK's staleness check, which took 268 s and 337 s.
- **Module:** tracked files under `.claude/skills` and `.intent/artifacts` now reach the
  container; every path in the owner's `.git/info/exclude` is excluded by name; the `test`
  check mounts the Git data of the pinned fixture commit and skips
  `tests/acceptance-web-client.test.mjs`.
- **Verified from a worktree:** ten checks pass in 31 s after a change and in 1 s
  unchanged; a deliberately broken test fails `cadence/test` and prints the failure;
  through the new module, the main checkout's `exports`, `apps/desktop/signing`,
  `.intent/acceptance`, `.claude/worktrees` and local sound files are absent.
- **Not done:** per-check input filters (deferred); `public-source:check` in Dagger; a cold
  first run was not re-measured.
- **Docker memory:** an agent raised Docker Desktop's VM from 8 GB to 16 GB on November 11
  at the owner's request. After the restart, ten checks passed from the main checkout in
  42 s.

## CI checks run in parallel — November 11, 2026

**Merged November 11 as PR #230 (`58577086`).** Decision: `docs/DECISIONS.md`, 2026-11-11,
"CI checks run in parallel".

- **Measured before:** a passing `CI` run took 754 s (median of 160 runs since October 28).
  `tests/acceptance-web-client.test.mjs` took 589 s of it.
- **Changed:** `npm run test` skips that file; `npm run test:web-client` and the new
  `Web client runner` workflow run it for changes to the acceptance runner. `ci.yml` runs
  `checks`, `lint`, `test` (three shards), `build` and `sites` in parallel, and the required
  `verify` job fails unless all passed. `.github/actions/setup` restores `node_modules`
  from the Actions cache.
- **Not changed:** branch protection, the Dagger module and the web client test's waits.
- **Measured after:** `CI` took 145 s on its first run and 100 s with warm caches. The
  `Web client runner` workflow took 673 s on its own.
- **Dagger:** decided and repaired in the entry above.

Platform impact: development tooling only. Web, desktop, marketing and future mobile: not
applicable. Messaging impact: none.

## Ledger cleanup — November 11, 2026

- **Merge markers:** removed the stray `||||||| 46016e57` and `||||||| 20feeaff` lines from
  STATUS (left by the PR #214 branch merges `109fedf3` and `4c8e2466`; `git show --cc` shows
  no entry text lost). The same merge replaced the last line of D29 in `docs/DECISIONS.md`
  with `||||||| 20feeaff`; restored it from `8c3a474c`.
- **Guard:** `npm run agents:check` now fails on a conflict marker line (`<<<<<<<`,
  `|||||||`, `=======`, `>>>>>>>`) in STATUS, `docs/TICKETS.md` or `docs/DECISIONS.md`.
- **TICKETS reconciled:** MCP Tickets 220–231 complete (MCP live since October 29; Ticket 232
  acceptance complete October 31). Ticket 252 complete (PR #176, `89b4a6b6`); 256 complete
  (October 31 production retest); 259 complete (Tier 2 ChatGPT web write
  `20261031T230336Z-cf9e6e`). Travel Tickets 260–283 merged as PRs #189–#194 (November 5–6),
  live on web; Ticket 280 released in Mac 0.1.9; the 275–277 migrations are on hosted (hosted
  equals git, 114 rows, per the connector completion push entry). Open-work rows for MCP
  220–231 and Ticket 259 removed; 232, 247–258 and 260–283 rows refreshed.
- **Trust marketing-ID refresh:** done by this session right after this PR merges, so this
  entry cannot record its result. Every later merge to `main` stales it again, so it must be
  repeated after the other November 11 sessions merge.

Platform impact: docs and governance check only. Web, desktop, marketing and future mobile:
not applicable. Messaging impact: none.

## Ticket 320: connector records sync to the Mac — November 11, 2026

**PR #216 merged November 11 by the owner. Hosted `20261111160000` applied before the merge.
In the Mac 0.1.10 release branch; not yet in a published build.**

- Account sync contract 5 (hosted `20261111160000`) adds `behavior_source_link` and
  `occurrence_source_match` as read-only kinds, with only the fields a Mac shows: no
  routine digests, account digest or activity references. Contracts 1–4 receive neither.
- The planner (`account-sync.resolver.ts`) lets the hosted row win, never writes them to
  the hosted account, and drops a row whose Behavior or Occurrence leaves the merge.
- SQLite schema 24 (`0024_connector_completion_records.sql`) stores them; account sync is
  the only writer. The Mac Timeline row lists workout times, as the web row does.
- Verification: a clean local stack replayed all 115 migrations; the new fixture
  `ticket-320-connector-completion-sync.sql`, the account-sync contract fixtures and the
  Ticket 292 sync fixture pass. Planner, desktop adapter and Mac Timeline tests pass; 132
  Rust tests pass.
- Hosted push: an agent applied `20261111160000` with the vault token `supabase-access-token`
  under the standing approval for additive migrations. Readback: the snapshot carries both
  kinds without digests or activity references; `apply_account_sync_plan`'s writable list
  has neither; `account_sync_snapshot()` executes for `authenticated` only; hosted
  migration history equals git (115 rows).
- Second readback after the merge (another agent, read-only SQL): contract additions list
  both kinds at 5; the current contract is 5; projecting a synthetic snapshot keeps both
  kinds at contract 5 and drops them at 1–4; RLS is on for `behavior_source_links` and
  `occurrence_source_matches`, with no `anon` or `PUBLIC` table grants; hosted migration
  history still equals git (117 rows).
- The pinned CLI 2.105.0 binary fails `codesign -v` straight from the npm registry, so
  macOS kills it. An ad-hoc signed copy outside the repository ran `migration list`
  (`docs/SUPABASE_WORKFLOW.md`, "Installed pathway").
- Not verified: an installed dev-signed Mac build syncing a real account.
- Ticket 323 waits on: (1) Mac 0.1.10 notarized and published by owner instruction; the
  release branch contains Tickets 319 and 320 (mac-release track); (2) Ticket 241's
  release steps 6–7 and installed connector acceptance (connector acceptance track);
  (3) the acceptance matrix in plan Task 14 as test account A; (4) the owner's instruction
  to set `CADENCE_CONNECTOR_COMPLETION` in production. Ticket 324 waits on 323.

## Ticket 325 started: release credential backup and restore — November 11, 2026

Decision D29 (`docs/DECISIONS.md`, 2026-11-11) moves release secrets into a Cadence Release
vault that a write-capable service account reaches, with the owner's approval per run.

- **Done:** `apps/desktop/release-credentials.json` (non-secret inventory);
  `npm run release:credentials` with `status`, `probe`, `verify-backups`, `restore` and
  `backup`; preflight requirements `updater-signing-key`, `notarization-credential`,
  `release-vault-token` and `release-backups`. The `developer-id` and
  `provisioning-profile` probes now read the inventory, so the preflight no longer checks
  the retired profile. Runbook: `docs/DESKTOP_RELEASE.md`, "Signing credentials".
- **Verified:** `status` passes on the owner's Mac, and it reports the retired profile as
  not listing the installed identity. Unit tests use a fake `op`.
- **Not done:** the vault, service account and App Store Connect API key (owner steps);
  live backup and `verify-backups`; notarization through the API key; the certificate
  renewal spike. The owner reports having stored the Developer ID `.p12`, the notarization
  password and the updater key in the Cadence vault; not verified by an agent.

## Connector completion hosted push and merge — November 11, 2026

The owner said on November 11 to merge PR #207 and continue.

- Hosted already had main's `20261111120000` and `20261111130000`, so the connector
  completion migrations moved, unchanged, from `20261110200000` and `20261110210000` to
  `20261111140000` and `20261111150000`. Both create only new objects. A clean local start
  replayed all 114 migrations and all 44 SQL fixtures passed.
- An agent pushed both with the vault token `supabase-access-token` and CLI 2.105.0, before
  the merge: `20261111140000` under the standing approval for additive migrations,
  `20261111150000` (the `service_role` column read) with the owner's November 10 approval.
- Readback: RLS on `behavior_source_links`, `occurrence_source_matches` and
  `connector_completion_state`, each with policies for `authenticated` only; no `anon`
  grants; `service_role` may select only `user_id`, `source` and `next_check_at` on
  `connector_completion_state`. `apply_connector_completion`, `attach_source_activity` and
  `remove_source_match` are security definer with an empty search path and execute for
  `authenticated` only. The six `cadence_private` helpers are revoked from `public`.
- `migration list`: hosted equals git (114 rows).
- The feature stays off until `CADENCE_CONNECTOR_COMPLETION` is `on`; this work set no Vercel variable.
