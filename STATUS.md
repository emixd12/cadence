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
| Tickets 383–386: alongside follow-ups after the audit (D37) | 383 (web + Mac, SQLite schema 30, account sync contract 11), 384, 385 (`do-it-during-something-else` reviewed and active, 2026-11-28) and 386 complete in PR #407; hosted migrations `20261126200000`–`20261126260000` pushed November 28, 2026; PR #407 merged November 28, 2026 | Finish Ticket 365 acceptance | TICKETS, Tickets 383–386; DECISIONS, 2026-11-25 (D37) |
| Tickets 375–382: MCP Apps, the "Cadence day" view (D36) | 375 (spike) `in_progress`: local answers done and the `show_day` schema frozen November 26, 2026; real-host answers missing. 376 (server) complete November 26 behind `CADENCE_MCP_APPS`, off in production, no migration. 377 (view) complete November 26: the real view replaces the placeholder. 380 (listing preparation) `in_progress`: drafts, capture script, skill draft and owner checklist done November 26, host screenshots wait for 378. 378 and 381 not started; 379 complete; 382 (later views) `deferred` | 375: the owner's four `mcp-web` preflight steps and a way for Claude and ChatGPT to reach a flag-on server, then three checks on each host. 378 tests hosts (notes for it: `docs/qa/2026-11-25-mcp-day-view.md`); 379 (consent 500) any time; production flag, listings and public copy wait for the marketing site overhaul (Ticket 246) | TICKETS, Tickets 375–382; `docs/qa/2026-11-26-mcp-apps-spike.md`; `docs/plans/2026-11-25-mcp-apps-expansion.md`; DECISIONS, 2026-11-25 (D36) |
| Tickets 367–374: Periods, and day notes and Periods in the Daily Brief (D35) | 367–373 complete and live on web November 26, 2026; hosted migrations `20261126130000`, `20261126135000` and `20261126140000` pushed; 374 (Mac) `in_progress` since November 28, 2026 | Chat writes Periods since PR #423 (owner's yes, November 26; hosted migration `20261126150000` pushed). 374: implemented in two pull requests (store and sync at contract 12 and SQLite 0031; screens, export, import and restore). Remaining: the hosted push of `20261128120000`, a dev-signed installed check and a Mac release on the owner's instruction. Not yet done: a look at `/timeline` and `/behaviors` in a browser against a database, a live MCP client run, a live brief | TICKETS, Tickets 367–374; `docs/plans/2026-11-25-periods.md`; STATUS, "Periods: Tickets 367–373 — November 26, 2026" |
| Ticket 366: tracked time decides a Behavior's length from 3 tracked completions (D34) | Merged November 25, 2026 (PR #403); the Timeline row checked on production web November 26 as test account A | Installed Mac check with the next Mac release | TICKETS, Ticket 366; DECISIONS, 2026-11-25 (D34) |
| Ticket 387: the advisor compares tracked time with the intended duration | Not started; coach tips already compare for "longer" | Owner decides the three open decisions in the ticket | TICKETS, Ticket 387 |
| Tickets 356–365: alongside Behaviors and the guessed Where (D33) | 356–364 and 383–386 complete, flag off; 365 local-stack acceptance done and defect D1 fixed. All on `main` since PR #407 merged November 28, 2026 (362, 363, 360/361 follow-ups, audit fixes, 383–386, local acceptance evidence and the D1 history/older-contract fix); hosted migrations `20261125140000`–`20261125190000` and `20261126200000`–`20261126260000` pushed. Web behind `CADENCE_ALONGSIDE`, Mac behind `VITE_CADENCE_ALONGSIDE` | Finish Ticket 365 (Preview as account A, installed Mac dev-signed build, MCP acceptance). Older Macs (contracts 8–9) stay safe via `20261126260000` and `20261126250000`. The owner decides the Production flag and the Mac release | TICKETS, Tickets 356–365; DECISIONS, 2026-11-25 (D33, D37) |
| Ticket 350: move the repository to the `cadence-me` organization; merge queue | Preparation done November 22: `CI` runs on `merge_group`, the Trust history downloader accepts the new Pages root, and the archive holds a staged copy of the evidence. | Owner: create the organization `cadence-me`, then tell the agent before transferring. The agent refreshes the archive first. | TICKETS, Ticket 350 |
| Tickets 343–348: advisor avatar | 343 master confirmed in round 4 on November 22 ("go with A"); round 5: exact-size files per size and screen density, built November 22 ("Go with B"). 343–346 complete on web November 22: vector master approved, sized files, resolver, animated avatar on the Timeline, panel and Chat, shipped without a flag on the owner's instruction. 347, 348 deferred by the owner | Installed Mac check with the next Mac release; a brief move in flight does not reach the avatar yet; the old trial bench stays | TICKETS, Tickets 343–348; `docs/plans/2026-11-21-advisor-avatar.md`; DECISIONS, 2026-11-21 and 2026-11-22 |
| Tickets 331–337: sign-in by email and Apple (D31) | 331–335 complete. Email (`CADENCE_SIGN_IN_EMAIL`, 21:35Z), Apple and Settings sign-in methods (`CADENCE_SIGN_IN_APPLE`, `CADENCE_SIGN_IN_LINKING`, 21:36Z) **live on production web** since November 13, 2026; hosted migrations equal git; final production check passed November 13, 22:05–22:20Z. 336 published in Cadence for Mac 0.1.11 (November 14, 06:14Z; release packet). 337 web rows done | 337: acceptance row 6 on the installed 0.1.11 (each method links, syncs, refuses a second account); row 3's Apple half (a Google account adds Apple, then signs in with it: needs the owner's Apple Account). Follow-ups: next row | TICKETS, Tickets 331–337; DECISIONS, 2026-11-13 (D31); `docs/qa/2026-11-13-sign-in-final-verification.md` |
| Sign-in follow-ups (from the November 13 final check) | Open, none blocks users today | (1) Done November 14: reminder email sender renamed from "Identity Scaffolding" to "Cadence" (next entry). (2) Done November 14: replies to `hello@`, `login@` and `support@cadence-me.com` reach a Microsoft 365 shared mailbox (next entry). (3) Sequenzy open tracking on (pixel in sign-in email). (4) SMTP key is full access; a `transactional_sender` key would do. (5) Turnstile widget allows `localhost` and `127.0.0.1`. (6) Test login host check passes from the LAN under `next dev`. (7) First link refused for branched status history: Ticket 341 (row below). (8) After a refused CAPTCHA the email form clears the typed address. (9) Shared per-IP OTP and verify limits: fixed and live under Ticket 338 (next row). (10) 32 acceptance OAuth clients and the `localhost` redirect entries remain on production. (11) Token refresh in `proxy.ts` shared one per-address limit and a refused refresh signed people out: fixed and live under Ticket 339 (next row) | `docs/qa/2026-11-13-sign-in-final-verification.md` |
| Tickets 338–340: sign-in limits per person | **Live in production since November 14, 2026, 01:44Z.** Hosted `security_sb_forwarded_for_enabled` on; Vercel Production `CADENCE_TURNSTILE_SECRET_KEY` and `SUPABASE_SECRET_KEY` (existing `default` key) set, owner-approved 01:34Z. Two-network checks passed for wrong codes, refresh and the sign-in callback | Follow-up ticket needed: forward Change address (`PUT /user`); hosted measurement shows it works. Remove-a-method check not run (no spare provider account) | TICKETS, Tickets 338–340; `docs/qa/2026-11-13-ticket-338-email-rate-limit.md`, section G |
| Ticket 341: account link accepts a hosted connector and manual mark pair | Resolver fix and tests rebuilt on current main (replaces PR #283) | Installed check: a dev-signed build on the test Mac re-links account A without restoring its database; ships with the next Mac release | TICKETS, Ticket 341 |
| Sign in with Apple client-secret rotation (Ticket 333), row dated November 13, 2026 | Current secret made November 13, 2026, 18:58Z; **expires May 12, 2027**; **rotate by April 12, 2027**. Held by the Supabase Apple provider and Vercel Production `APPLE_SIGN_IN_CLIENT_SECRET` | Rotate with `docs/OPERATIONS.md`, "Sign in with Apple (Ticket 333)" (owner approves the key read); the same section covers a missed rotation. Update this row with the new dates | OPERATIONS, "Sign in with Apple (Ticket 333)" |
| Tickets 310–324: connector completion (D28) | 310–324 complete; `CADENCE_CONNECTOR_COMPLETION` on in Production since November 13, 2026, 04:30 UTC. Ticket 323 matrix passed on a local stack, deployed web and the installed Mac 0.1.10 (`docs/qa/2026-11-12-connector-completion-acceptance.md`) | Owner deletes the Hevy test workouts and routines, then an agent records the `deleted`-event rows. One-day Vercel usage measurement due after November 14, 04:30 UTC (US$5/month ceiling, `docs/COSTS.md`). Mac count control is a follow-up | TICKETS, Tickets 310–324; DECISIONS, 2026-11-12 |
| First account link times out for a large account | Fixed: PR #247 merged as `7e829202` with hosted migration `20261112120000`; the owner's Mac first link passed November 12 at 05:52Z | The Mac error-text fix shipped in 0.1.11 | STATUS, "Owner's Mac first link after the hosted fix — November 12, 2026" |
| Ticket 326: configuration history in two key shapes (defect D2, web export 500) | Read-side fix on branch `claude/fix-export-camelcase-60ae30`: export, BehaviorLog restore and Daily Brief history normalize camelCase snapshots; the export route logs failures | Merge and check export as account A on production; Mac account sync still uploads camelCase snapshots (writer fix ships with a later Mac release); optional data migration needs the owner's approval | TICKETS, Ticket 326; STATUS, "Ticket 326: web export reads Mac-written configuration history — November 11, 2026" |
| Ticket 293: test-access preflight | Merged November 10, 2026; awaiting verification | First live preflight run per suite | TICKETS, Ticket 293; STATUS, "Ticket 293: test-access preflight for acceptance runs — November 7, 2026" |
| Tickets 294–300: Daily Brief on the user's ChatGPT plan | 294–299 merged; hidden behind `VITE_CADENCE_CHATGPT_PLAN`; 300 deferred | Paused by the owner on November 12: the feature stays hidden and Ticket 300 waits until the owner turns it on. The production device-model flag must stay unset; L-019 logo gap and P-029 to P-031, P-045 and P-046 messaging review remain activation gates | TICKETS, Tickets 294–300; `docs/DECISIONS.md`, 2026-11-12 |
| Tickets 289–290: Daily Brief prompt, model and effort candidates | Candidates in the development workbench; production pinned; comparison on H1–H10 and S1 prepared November 11 | Owner sets a spend cap (US$2 asked) and optionally names extra models; agents run the comparison; the owner promotes or rejects under Ticket 184's rules | TICKETS, Tickets 289–290; `docs/qa/daily-brief-prompt-consolidation.md`, "Prepared owner comparison" |
| Ticket 291: skill-rule acceptance scenarios | Local-stack run with `claude-code` passed all three scenarios November 11 | Production run with the API clients; needs a spend cap for the QA keys | TICKETS, Ticket 291; `docs/qa/mcp-server.md`, "First local run — November 11, 2026" |
| Leave reminder send-time Calendar read (follow-up) | Entry says "not pushed"; `git log` shows PR #200 merged as `2d16bf12` | Deployment not recorded: unclear — see source | STATUS, "Follow-up: keep a leave reminder when the send-time Calendar read fails — November 8, 2026" |
| Behavior place edit withdraws its leave time (web) | Entry says "not pushed"; `git log` shows PR #198 merged as `d643a6e7` | Not yet rechecked live | STATUS, "Follow-up after the Wave 6 deploy: a Behavior place edit withdraws its leave time — November 7, 2026" |
| Mac leave reminders for newly added Calendar events | PR #198 in 0.1.10; installed run on November 12 inconclusive (event too close to plan a reminder) | Rerun on the test Mac with an event at least two hours ahead | STATUS, "Cadence for Mac 0.1.10 notarized — November 12, 2026" |
| Updater key rotation and new Developer ID identity | 0.1.10 published November 12, 05:29–05:33Z, with the rotated key and new identity; 0.1.9 and earlier install it by hand once | Renew the certificate before December 11, 2027. PR #241 and PR #243 shipped dormant in 0.1.11 after ordinary installed acceptance | DECISIONS, 2026-11-11; STATUS, "Cadence for Mac 0.1.10 notarized — November 12, 2026"; release packet, "PR review follow-up" |
| Ticket 325: release credential backup and restore | Identity, notarization-password and updater backups verified November 12; API-key backup and checks recorded as passed in `dd4cb67b`; notarization uses the API key (0.1.10) | Certificate-renewal spike | DECISIONS, 2026-11-11 (D29); TICKETS, Ticket 325; STATUS, "Ticket 325: live backups verified — November 12, 2026"; 0.1.10 release packet |
| Cadence for Mac 0.1.18 | Published November 28, 2026, 05:14Z: hotfix on the 0.1.17 base carrying PR #432 only, so **Connect Google Calendar for AI** now opens the Google OAuth flow; schema 28, contract 9. Real-updater upgrade (`0.1.17` → `0.1.18`), same-schema check, sign-in and Calendar callback replays, the live connect check and public readback passed on `test-mac` | Session renewal and revoked-session check not run: the trigger applies, but the diff touches only the Keychain allow-list and calendar cleanup, so the owner should confirm the exception. It has stayed deferred since 0.1.15. macOS 14 not tested. The Google AI Calendar client shows the unverified-app warning until Ticket 245. Later `main` work, such as Ticket 366, waits for the next Mac release | `docs/qa/2026-11-26-desktop-0.1.18-release-packet.md`; 0.1.17: `docs/qa/2026-11-25-desktop-0.1.17-release-packet.md` |
| Ticket 285: installed Mac acceptance | Run November 6–7, including Calendar-event activation on published 0.1.9 | Closure not stated: unclear — see source; user guide line for `P-027` still to add | TICKETS, Ticket 285; STATUS, "Ticket 285 defect fixed: blank Mac window from the archive notice — November 7, 2026" |
| Ticket 284: web acceptance with the real clock | Evidence recorded, awaiting verification; seven findings fixed on `travel-wave6` (merged as PR #196 per `git log`) | Verification of the evidence and fixes; Ticket 283 Outlook or iCloud routed event not checked (no test connector) | TICKETS, Ticket 284; STATUS, "Travel advisory revamp Wave 6: Ticket 284 web acceptance with the real clock — November 6, 2026" |
| Travel revamp Tickets 260–283 | Merged as PRs #189–#194 and #196, November 5–7, 2026; live on web; Mac parts released in 0.1.9; hosted equals git, so the 275–277 migrations are applied; TICKETS reconciled November 11, 2026 | Release acceptance continues under Tickets 165, 284 and 285; production setting of `CADENCE_LEAVE_REMINDER_JOB` not checked | TICKETS, Tickets 260–283; STATUS, "Ledger cleanup — November 11, 2026" |
| Ticket 165: travel release acceptance | In progress | Denied state; installed Open Location Services and Check again; installed status-only permission regression. Directions matrix: web rows in Ticket 284, installed Mac row in Ticket 285 | TICKETS, Ticket 165; STATUS, Ticket 284 and Ticket 285 entries (November 6–7) |
| Ticket 187 / Calendar MCP migration (PR #398) | Live on web (`cadence-lo22vs16w`, November 25, 2026): `calendarmcp.googleapis.com` + Model Armor `INSPECT_AND_BLOCK` + `P-090` Privacy live; Phase 0 live wire check passed (`docs/qa/2026-11-25-google-calendar-mcp-spike.md`) | Google sensitive-scope verification (Ticket 245) held until the pre-beta marketing site overhaul (`P-048` / Ticket 246) ships (submit before Feb 1, 2027); Mac `0.1.17` publication | TICKETS, Tickets 187 & 245; `docs/qa/2026-11-25-google-calendar-mcp-spike.md` |
| Launch narrative follow-ups (D30, Ticket 327 complete) | `docs/NARRATIVE.md` accepted November 13; positioning is "behavioral remodeling assistant"; no public copy changed | Owner decides the beta audience from the Ticket 328 report and approves interviews; the pre-beta marketing site overhaul (`P-048`), listings, visual identity and the social system each need a ticket; claims table not checked against production. **Reminder:** once the marketing site overhaul deploys, return to Ticket 245 to re-record the demo video & submit `cadence-calendar-agent-prod` before Feb 1, 2027 | TICKETS, Tickets 327 & 245; DECISIONS, 2026-11-13 (D30); P-048, P-090 |
| Tickets 245–246: messaging track | Filed October 27; not development tickets | 245: Google verification submission (`cadence-calendar-agent-prod`, `P-090` Privacy live, dry-run video verified Nov 25; **held until pre-beta marketing site overhaul (`P-048` / Ticket 246) ships — re-record & submit before Feb 1, 2027**). 246: pre-launch messaging pass | TICKETS, Tickets 245–246; P-048, P-090; `docs/qa/2026-11-25-google-calendar-mcp-spike.md` |
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
| MCP acceptance tooling, Tickets 247–258 | Complete except conditional Ticket 253 (on hold); TICKETS reconciled November 11, 2026 | None: the consent 500 before hydration is fixed (Ticket 379, November 26) | STATUS, "Automated MCP client acceptance: Tickets 247–258 — October 31, 2026"; TICKETS, Ticket 253 |
| Connector Tickets 236, 240–242 (Hevy, iCloud, Outlook) | Hevy, Outlook (personal account) and iCloud (owner's Apple Account) passed on production web and installed Mac 0.1.10 (November 11–12); cross-tenant Outlook checks skipped by owner decision | Not verified on production: an iCloud event on Timeline (no events in the selected calendars), the Outlook `cadence://` completion, sign-out and account-switch cache cleanup, Hevy key entry on the Mac. Owner revokes the "Cadence QA" app-specific password when testing ends. 241 step 7 copy is live and awaits the owner's review | TICKETS, Tickets 236, 240, 241, 242; STATUS, "iCloud production acceptance — November 12, 2026" |
| Tickets 243–244: travel backlog | Filed October 22; backlog | None scheduled | TICKETS, Tickets 243–244 |
| Daily Brief release acceptance (grouped): Tickets 147, 148, 155, 161, 168, 169, 172, 173, 174, 182, 183, 185 | In progress or implemented in source; reconciled October 27: still open | Ticket 174 carries hosted, deployed-web and installed-desktop gates; 182–183 owner-run live checks; 185 awaits owner product decisions | TICKETS, Ticket 174 and each listed ticket |
| Google Calendar Timeline (grouped): Tickets 133–137, 141, 150 | In progress; reconciled October 27: still open | Post-approval web and native consent smoke checks; 137 provider-failure, Workspace and installed fixture cases; 150 live custom-name check | TICKETS, Tickets 137, 141, 150 |
| Earlier travel tickets (grouped): 160, 162–164, 166, 167, 170, 171 | Implemented in source or discovery complete | Release gates sit in Tickets 165 and 174; owner re-acceptance for 166–167 | TICKETS, each listed ticket |
| Desktop release follow-ups (grouped): Tickets 142, 143 | Complete in source; web deployed September 18 | Installed-native release acceptance | TICKETS, Tickets 142–143 |
| Operations (grouped): Tickets 091, 104, 105, 128 | 091 and 105 in progress; 104 and 128 blocked; reconciled October 27 | 104: operator diagnostics or an authorized route test; 105: verify deployed browser-push delivery after the reviewed web-push 4.0.0 upgrade; 128: a revised candidate needs a new measured gate | TICKETS, Tickets 091, 104, 105, 128 |

## Recent entries

## Ticket 374, second pull request: Periods on the Mac's screens — November 28, 2026

- **Screens:** the Mac Timeline shows Period chips under each date and "Add period" on
  today; Behaviors lists every Period with the editor. Both use the web's components
  with local actions (`createLocalPeriodActions`): save, End today, Remove and the note's
  own save. "End today" reads the profile timezone at the time of the write.
- **Portability:** local export carries Periods; local import and restore save them
  through `createPeriodIfAbsent` after the main commit, as on web.
- **Shared code:** the Period error-state mapper moved to `@cadence/core`
  (`periodErrorActionState`); the web keeps its sign-in sentence.
- **Registry:** `INT-PERIOD-001` to `004` are implemented on desktop.
- **Messaging:** `P-104` logs the user guide sentence "Cadence for Mac does not show
  Periods yet". The guide is unchanged.
- **Not verified:** the screens in a running Mac build. A dev-signed installed check and
  the hosted push of `20261128120000` remain. A Mac release needs the owner's instruction.

Platform impact: web unchanged in behavior; desktop implemented; marketing not
applicable; future mobile deferred. Messaging impact: `P-096`, `P-104`.

## Ticket 374, first pull request: Periods in the Mac store and account sync — November 28, 2026

- **Store:** SQLite schema 31 (`0031_periods.sql`). Commands `readPeriods`, `readPeriod`,
  `createPeriod`, `createPeriodIfAbsent`, `updatePeriod` and `deletePeriod`
  (`local_store/period.rs`): cap of 500, compare-and-set on `revision`, tombstoned delete.
  `apps/desktop/src/local-period.service.ts` adapts them to `PeriodDataStore`.
- **Sync:** account sync contract 12 adds kind `period` on the generic row path. A
  removal against an edited copy and two different edits go to review; a decided edit
  conflict takes a revision above both sides. Writer floor stays 8. Contracts 8 to 11
  never see the kind and their writes keep hosted Periods.
- **Hosted migration, not pushed:** `20261128120000_account_sync_periods.sql`: one
  registry row, the snapshot and apply patches, and the cap trigger function now lets a
  sync edit of a held Period through at 500. No drop.
- **Verified:** native tests (the two new ones and the full suite), the resolver and
  store tests, and five SQL smokes with the migration inside a rolled-back transaction on
  the local database. Not run locally: `scripts/account-sync-rpc-smoke.mjs` and a clean
  `db reset`; CI's Local Supabase rehearsal runs both.
- **Not done:** the screens, local export, import and restore (second pull request);
  the hosted push; a dev-signed installed check. No Period can be made on the Mac yet.

Platform impact: web, the hosted sync migration only; desktop implemented for store and
sync, screens follow; marketing not applicable; future mobile deferred. Messaging
impact: `P-096`.

## MCP Apps: tunnel route and first Gemini run — November 28, 2026

- **Tunnel route works:** `local-stack.mjs up --public-url <tunnel> --mcp-apps` puts a local
  flag-on server behind a `cloudflared` URL. A scripted client completed sign-in, consent,
  `show_day` and the view resource read through it.
- **Gemini (consumer web, test account A):** connects through its custom connector after
  one fix. Gemini's OAuth `state` is 1,170 characters; Cadence allowed 1,024 (Ticket 381,
  now `in_progress`; the migration was pushed to the hosted database on November 28, 2026). Gemini called
  `show_day` and answered in text. It did not render the day view.
- **Test account B's Google sign-in:** fixed in `scripts/acceptance/google-signin.mjs`
  (passkey dialog). The preflight step is no longer an owner step.
- **Not run:** ChatGPT web, Claude web, Claude Desktop and mobile, VS Code Copilot. The QA
  Chrome profile is signed out of the owner's ChatGPT and Claude accounts. Tickets 375,
  378 and 380 stay open on those hosts.
- **Record:** `docs/qa/2026-11-28-mcp-apps-gemini-tunnel.md`.

## Vercel build billing optimization (Phases 1–3) — November 28, 2026

- **Phase 1 (PR #438, merged `2b6038fc`):** path-filtered `ignoreCommand` scripts with
  shallow-clone fetch and zero-secret opt-in previews. `cadence-marketing` moved to Basic
  (2 vCPU). The team Spend Management budget is US$30, alert-only (pause off). Live check: 8 of
  8 later non-web and preview pushes were canceled with zero billed CPU-minutes.
- **Phase 2 (PR #439, merged `d463c8a8`):** root-anchored `.vercelignore` trim (1,310 of 2,785
  files, about 33 of 76 MB). A local webpack and Turbopack benchmark kept `--webpack` until a
  separate `.next/server` Preview check. Updated `docs/VERCEL_WORKFLOW.md`, `docs/COSTS.md`
  (30-day baseline 15,380 Cadence CPU-minutes, US$53.83 after December 8) and `AGENTS.md`.
- **Phase 3 (this PR):** Public Trust provenance (`scripts/collect-public-trust-evidence.mjs`,
  `.github/workflows/public-trust-evidence.yml`) accepts a Ready deployment that names a
  verified ancestor of the source commit with no change in that surface's ignore-script paths.
  This covers a surface that skipped its build. The `collect` job now fetches full history.
- **Open:** the 14-day billing measurement is due December 12, 2026. Deployment retention stays
  at Vercel's 30-day default (REST API writes returned HTTP 400 on Pro) unless optionally
  shortened to 7 days in the Vercel Dashboard (`Settings → Deployment Retention`). Ticket 350
  (`cadence-me` organization and Merge Queue batching) stays owner-gated; `orgs/cadence-me`
  does not exist.

Platform impact: web and marketing deploy and Public Trust only; desktop and future mobile not
applicable.
Messaging impact: none.

## Cadence for Mac 0.1.18 published — November 28, 2026

- **Published:** the versioned assets and `desktop-stable/latest.json` at 17:44–17:46Z on
  November 27. The version-free `Cadence_aarch64.dmg` and `desktop-preview/latest.json` moved at
  05:14Z on November 28, after `test-mac` checks passed. Owner instruction: November 27.
- **Fix:** PR #432 adds `pending-ai-calendar-state` to the Mac Keychain allow-list. On installed
  0.1.18, **Connect Google Calendar for AI** opened the Google OAuth page instead of "could not
  start connecting". The agent closed the tab without consent, so no grant was made.
- **Checks:** the real updater moved `test-mac` from 0.1.17 to 0.1.18. The same-schema check
  found no lost rows and 0 secret findings; `launchSyncChanges` was
  `{"account_sync_baselines":1,"sync_cursors":1}`. Sign-in and Calendar callback replays showed
  their notices and changed no connection. All 7 public URLs read back with matching SHA-256.
  Minisign and the quarantined public DMG checks passed.
- **Not run:** the session renewal and revoked-session check (see the open-work row).

Platform impact: desktop only (release); web, marketing and future mobile not applicable.
Messaging impact: none.

## Alongside history fix: an unanswered Behavior leaves no trace (defect D1, Ticket 363) — November 26, 2026

Branch `feat/alongside-history-fix` (main plus the unmerged alongside feature). Fixes D1 of
`docs/qa/2026-11-26-alongside-local-acceptance.md` and a release blocker found with it.

- **Finding (local database, before the fix).** With `CADENCE_ALONGSIDE` unset, every
  baseline listed `alongside` and every snapshot held `"alongside": null`; contracts 8 and
  9 read those events unchanged. Cadence for Mac 0.1.14 to 0.1.17 export rejects that
  changed field, so deploying the branch with the flag off would have broken their export.
- **History rule.** An event carries the answer only when either side has one; a baseline
  names it only for an answered Behavior. Planner `withHistoryAlongside`, the web payload,
  the Mac store and, in `20261126220000` (edited in place, unpushed),
  `behavior_configuration_history_snapshot` and the changed-fields baseline.
- **Older contracts.** New `20261126260000_account_sync_alongside_history.sql` (unpushed,
  needs the owner's yes, must be on the database before the flag turns on): contracts 8
  and 9 read no `alongside` in history, answer-only revisions are hidden, and pointers at
  them read as the revision before.
- **Exports.** Flag on: snapshots carry the answer wherever an event names it. Flag off:
  history names it nowhere and answer-only revisions are left out; an unanswered account
  exports the pre-363 bytes (digest pinned).
- **Checks:** agents, interactions, map, resolvers, lint (warnings only), typecheck,
  desktop typecheck, test (7,979 passed, 212 skipped), build, desktop build, `cargo test --offline`
  (186), all 71 SQL fixtures after `db reset`, and the new local-database test.

Platform impact: web and hosted database implemented; desktop follows through the shared
planner (no SQLite change, schema 30); marketing not applicable; future mobile inherits the
planner rule. Messaging impact: none.
