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
| Tickets 383–386: alongside follow-ups after the audit (D37) | Written November 25, 2026; all `not_started` | 386 and 383 first, then 384; 385's card needs the owner's review before it shows a tip | TICKETS, Tickets 383–386; DECISIONS, 2026-11-25 (D37) |
| Tickets 375–382: MCP Apps, the "Cadence day" view (D36) | 375 (spike) `in_progress`: local answers done and the `show_day` schema frozen November 26, 2026; real-host answers missing. 376 (server) complete November 26 behind `CADENCE_MCP_APPS`, off in production, no migration. Others not started; 382 (later views) `deferred` | 375: the owner's four `mcp-web` preflight steps and a way for Claude and ChatGPT to reach a flag-on server, then three checks on each host. 377 replaces the placeholder `lib/mcp/apps/day-view-html.ts`; 378 tests hosts; 379 (consent 500) any time; production flag, listings and public copy wait for the marketing site overhaul (Ticket 246) | TICKETS, Tickets 375–382; `docs/qa/2026-11-26-mcp-apps-spike.md`; `docs/plans/2026-11-25-mcp-apps-expansion.md`; DECISIONS, 2026-11-25 (D36) |
| Tickets 367–374: Periods, and day notes and Periods in the Daily Brief (D35) | 367–373 complete and live on web November 26, 2026; hosted migrations `20261126130000`, `20261126135000` and `20261126140000` pushed; 374 (Mac) blocked | Owner: say yes or no to draft PR #423 (Chat writes Periods; its migration drops and re-adds a check constraint). 374 starts when Ticket 363 (PR #407) is on `main`. Not yet done: a look at `/timeline` and `/behaviors` in a browser against a database, a live MCP client run, a live brief | TICKETS, Tickets 367–374; `docs/plans/2026-11-25-periods.md`; STATUS, "Periods: Tickets 367–373 — November 26, 2026" |
| Ticket 366: tracked time decides a Behavior's length from 3 tracked completions (D34) | Implemented in source November 25, 2026; all checks pass; not yet looked at in a browser | Check a Behavior with 3 tracked completions on production web after merge; installed Mac check with the next Mac release; advisor wording that compares tracked and intended time needs its own ticket | TICKETS, Ticket 366; DECISIONS, 2026-11-25 (D34) |
| Tickets 356–365: alongside Behaviors and the guessed Where (D33) | 356–361 and 364 complete November 25, 2026 (flag off; hosted migrations `20261125140000`, `20261125150000`, `20261125180000` and `20261125190000` not pushed; 360 and 361 add none); 362, 363 and 365 `not_started`; behind `CADENCE_ALONGSIDE` | Push the additive migrations before the flag goes on anywhere; 362 next; the alongside advice card needs a reviewed source (Ticket 360 gap); 363 adds sync, configuration history and the Mac export of the column; the owner decides the Production flag and the Mac release after Ticket 365 | TICKETS, Tickets 356–365; DECISIONS, 2026-11-25 (D33) |
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
| Cadence for Mac 0.1.17 | Published November 26, 2026, 00:32–00:43Z (November 25 EST): schema 28, contract 9, PR #398 Google Calendar dual-grant Settings and `purpose=ai_mcp` broker; real-updater upgrade (`0.1.15` → `0.1.17`), same-schema check, Calendar callback replay and public readback passed on `test-mac` | Defect: **Connect Google Calendar for AI** fails on the Mac because `pending-ai-calendar-state` is missing from `ALLOWED_KEYS` in `apps/desktop/src-tauri/src/auth.rs`; the fix needs a ticket and a Mac release. 1-hour session renewal and revoked-session check for `@supabase/supabase-js` 2.119.0 still deferred from 0.1.15; macOS 14 not tested | `docs/qa/2026-11-25-desktop-0.1.17-release-packet.md` |
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

## Periods: Tickets 367–373 — November 26, 2026

- **Owner's decision:** `docs/DECISIONS.md`, 2026-11-25 (D35). Plan with its outside review
  record: `docs/plans/2026-11-25-periods.md`.
- **Merged:** 367 (PR #410, the brief reads day notes), 368 (#411, table, resolver, services),
  372 (#415, Period day counts in `completion_drop`; `coach-signals-5` and `-6`), 371 (#416,
  the brief and tips read Periods; `coach-tips-4`), 373 (#414, export, import, restore),
  369 (#420, web Timeline and Behaviors), 370 (#422, MCP contract 1.8.0; the alongside
  edition is now 1.9.0).
- **Hosted migrations pushed under the standing approval**, each read back (RLS on,
  `authenticated` only): `20261126130000_periods.sql`,
  `20261126135000_create_period_if_absent.sql`,
  `20261126140000_period_integration_writes.sql`. The clean replay ran in CI's Local
  Supabase rehearsal, not on the shared local stack; the SQL smokes also ran locally in
  rolled-back transactions.
- **Review findings fixed:** two overlapping imports could duplicate a Period (now
  `create_period_if_absent`); the OAuth persistence smoke needed the Period write wrapper
  on its list.
- **Open:** draft PR #423 (Chat writes Periods) needs the owner's yes for a migration with
  a `drop constraint`. Ticket 374 (Mac) is blocked on Ticket 363 in draft PR #407.
- **Also fixed:** PR #424, `tests/sql/google-calendar-agent-mcp-contract.sql` used fixed
  November dates and failed the rehearsal on every branch from November 26.
- **Verification:** each PR passed the eight required checks locally with Node 24 and CI
  `verify`. Dagger was not run. Web UI seen only on the `/design-system` bench. Not run: a
  browser pass on the real pages, a live MCP protocol or client run, a live brief or eval,
  `*.local-integration` suites.
- **Seen, not fixed:** `tests/desktop-controls.dom.test.tsx` ("persists the rail
  preference…") fails intermittently in full runs.

Platform impact: web implemented; desktop follow-up Ticket 374 (a linked Mac shows hosted
brief words that may name a Period); marketing: the generated developer reference;
future mobile inherits `@cadence/core` and the hosted functions. Messaging impact: P-095,
P-096.

## Ticket 379 complete: consent works before hydration — November 26, 2026

- **Cause:** the consent page's `no-referrer` policy made the browser send
  `Origin: null` on the plain form post, and the Server Action origin check answered 500.
- **Fix:** the policy is `same-origin` (`proxy.ts`, `app/oauth/consent/page.tsx`). The
  origin check, cookie secret and atomic consume are unchanged. The runner no longer
  waits for hydration.
- **Verification:** local stack, Chrome with JavaScript off: Allow and Deny answer 303;
  a double post grants once. `dagger check --cadence` and `npm run test:web-client`
  passed. Not run on production.

Platform impact: web only. Messaging impact: none.

## Ticket 376: MCP Apps server behind `CADENCE_MCP_APPS` — November 26, 2026

- **Complete, flag off in production.** With `CADENCE_MCP_APPS=true`, `/mcp` lists the
  transport tool `show_day` and serves `resources/list` and `resources/read` for
  `ui://cadence/day/v1.html`. Off: `tools/list` is byte-identical (digest pinned).
- **No migration, nothing to push.** The activity table accepts the labels `show_day`,
  `list_view_resources` and `read_view_resource`. The three reads check `cadence.read`,
  count against the read limit, write an activity row and fail closed.
- **Key files:** `lib/mcp/apps/`, `lib/mcp/server.ts`, `lib/integrations/transport-read.ts`,
  `lib/services/integration-day.service.ts`, `scripts/acceptance/protocol.mjs`.
- **Open:** the view HTML is a placeholder until Ticket 377; no host has run it
  (Ticket 378). Details: `docs/MCP_INTEGRATION.md`, section 17.
- **Verification:** `dagger check --cadence` passed 11 of 11; `npm run test:web-client`
  passed. The SQL smoke for the three labels runs only in `Local Supabase rehearsal`.

Platform impact: web only; desktop, marketing (until `P-099`) and future mobile not
applicable. Messaging impact: `P-098`, `P-099`.

## MCP Apps spike: local answers and the frozen `show_day` contract (Ticket 375) — November 26, 2026

- **In progress.** Note: `docs/qa/2026-11-26-mcp-apps-spike.md`. Tickets 376 and 377 can
  start from the frozen schema and view contract in it.
- **Answered locally:** the stateless handler serves `resources/list` and
  `resources/read` on the 2026-07-28 and legacy paths; the view completed status, note
  and parent slot writes in `basic-host` 2.0.4 and MCP Inspector 2.13.0; React 19 with
  `ext-apps` is 461 KB raw, Preact is 261 KB, so the note recommends Preact.
- **Not obtained:** approval prompts, the 403 step-up and view caching on Claude web and
  ChatGPT web. The `mcp-web` preflight exited 10 with four owner steps, and Preview has no
  Supabase or MCP variables, so no flag-on server is reachable from a host.
- **Ticket 381:** no gap found for VS Code from documentation; Gemini undecided.
- **Docs only on `main`:** the note, plan corrections, Ticket 375 and this file. Spike
  code stays on the local branch `spike/mcp-apps-375`. No production setting changed.

Platform impact: web only (`docs/qa/` note); desktop, marketing and future mobile not
applicable. Messaging impact: none.

## MCP Apps moved into scope; Tickets 375–382 filed (D36) — November 25, 2026

- **Owner's decision:** `docs/DECISIONS.md`, 2026-11-25 (D36). Cadence's MCP server will
  serve one "Cadence day" view that an AI client renders: today only, Needs decision as a
  count line. A click in the view is the user's confirmation.
- **Filed, none started:** 375 spike; 376 server; 377 view; 378 acceptance on Claude web,
  ChatGPT web, Claude Desktop and mobile, VS Code Copilot and Gemini Apps Developer Mode;
  379 consent 500 before hydration; 380 listing preparation with nothing published; 381
  host sign-in compatibility, only if the spike finds a gap; 382 later views, deferred.
- **Waits for the marketing site overhaul (Ticket 246):** the production flag, every
  submission and listing, and public copy.
- **Docs only:** `AGENTS.md`, `docs/FUTURE_UPDATES.md`, `docs/MCP_INTEGRATION.md`
  (sections 1, 3 and 17), `docs/TICKETS.md`, `docs/MESSAGING_CHANGES.md` and the plan
  `docs/plans/2026-11-25-mcp-apps-expansion.md`. No code changed.

Platform impact: web in Tickets 375–381; desktop not applicable; marketing waits for
Ticket 246; future mobile has no Cadence code. Messaging impact: P-097 to P-101.

## Cadence for Mac 0.1.17 published — November 25, 2026

- **Published** on the owner's instruction: versioned assets and `desktop-stable/latest.json` at
  00:32–00:33Z on November 26 (UTC); version-free `Cadence_aarch64.dmg` (upload, delete, rename)
  and `desktop-preview/latest.json` at 00:43Z. Rollback copies of both 0.1.16 feeds are kept.
- **Verified:** `test-mac` upgraded `0.1.15` → `0.1.17` through the real updater. The
  same-schema check passed: schema 28, no table lost rows, `launchSyncChanges` 1 baseline,
  1 cursor and 1 reminder delivery, 0 secret findings. Calendar callback replay left the Timeline
  connection unchanged. Public readback: every SHA-256 matches, both feeds serve 0.1.17, Minisign
  verifies, and a quarantined public DMG passes Gatekeeper and `syspolicy_check distribution`.
- **Defect found:** on the Mac, **Connect Google Calendar for AI** shows "Google Calendar for AI
  could not start connecting. Try again." `pending-ai-calendar-state` is missing from
  `ALLOWED_KEYS` in `apps/desktop/src-tauri/src/auth.rs`, so the Keychain write fails before any
  network call. It needs a ticket and a Mac release. No data is at risk.

Platform impact: desktop released; web, marketing and future mobile not applicable. Messaging
impact: none.

## Ticket 366: tracked time decides a Behavior's length from 3 tracked completions (D34) — November 25, 2026

- **Owner's decision:** `docs/DECISIONS.md`, 2026-11-25 (D34). From 3 tracked completions the
  tracked figure (median of the 10 most recent) is the planning length; below 3 the saved
  duration wins. The saved duration is now the "Intended duration" and stays visible.
- **Implemented:** one order and one measurement in `@cadence/core`
  (`time-tracking.resolver.ts`, `timeline-context.resolver.ts`, `brief-move.resolver.ts`,
  `briefing-config.ts`), read by every move caller through
  `lib/services/behavior-length.service.ts` (Move for today, Daily Brief moves, Opportunity
  suggestions, Chat moves). Timeline row and Behavior form copy; the length tip says "Update
  Gym's intended duration to 45 minutes?". `docs/RULES_REGISTER.md` lists the length rules.
  No schema change.
- **Verified:** `dagger check --cadence` (11 passed), `core:check`, and CI's Local Supabase
  rehearsal. Not done: a look at the Timeline row in a browser.
- **Open, each needs a ticket:** advisor wording that compares tracked and intended time; rows
  in the rules register for the rule sets under its "Not yet listed".

Platform impact: web implemented; desktop through shared resolvers and components, in the next
Mac release; marketing not applicable; future mobile inherits `@cadence/core`. Messaging
impact: P-094.
